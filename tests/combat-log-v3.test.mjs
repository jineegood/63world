import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function load(file, key) {
  const window = {};
  vm.runInNewContext(read(file), { window }, { filename:file });
  return window[key];
}

const loadLog = () => load('src/combat-log-v3.js', 'YuksamCombatLogV3');
const loadRules = () => load('src/combat-rules.js', 'YuksamCombatRules');

const context = {
  monsterName:'버섯돌이',
  monsterId:'m1',
  correctAnswer:'56',
  batchId:'b1',
  fxProfile:{ source:'player', motion:'slash', impact:'burst' },
  monsterFxProfile:{ source:'monster', target:'player', motion:'venom-cast', impact:'poison-burst' },
  audioId:'basicAttack',
};

/* 서버가 실제로 보낼 수 있는 모든 이벤트 종류 (pve-combat-rules-v3.mjs의 EVENT_TYPES) */
const SERVER_EVENT_TYPES = [
  'answer-correct', 'answer-wrong', 'monster-damage', 'monster-dot', 'monster-action',
  'monster-miss', 'monster-status', 'monster-shield', 'player-action', 'player-damage',
  'player-dot', 'player-heal', 'player-miss', 'player-shield', 'player-status',
];

test('the whole battle log survives the sequence builder — the bug that erased it', () => {
  const log = loadLog();
  const rules = loadRules();
  const events = SERVER_EVENT_TYPES
    .filter((type) => !['rewards', 'surrender'].includes(type))
    .map((type) => ({ type, amount:5, status:'poison', action:'buff' }));

  const { notices } = log.translate(events, context);
  assert.ok(notices.length > 0, '번역된 로그가 없습니다');

  const queue = rules.buildCombatSequence(rules.deduplicateCombatStatusEvents(notices));
  assert.equal(queue.length, notices.length, '연출 재생기가 로그를 버렸습니다');
});

test('every server event type produces a log line', () => {
  const log = loadLog();
  for (const type of SERVER_EVENT_TYPES) {
    const { notices } = log.translate([{ type, amount:3, status:'stun', action:'charge' }], context);
    assert.equal(notices.length, 1, `${type} 가 로그를 만들지 못했습니다`);
    assert.ok(String(notices[0].text || '').trim(), `${type} 의 글자가 비어 있습니다`);
  }
});

test('the log keeps the order the old battle used', () => {
  const log = loadLog();
  const rules = loadRules();
  // 서버는 뒤섞인 순서로 보낼 수 있다
  const events = [
    { type:'player-damage', amount:4 },
    { type:'monster-action' },
    { type:'monster-damage', amount:12 },
    { type:'answer-correct' },
    { type:'player-dot', amount:2 },
    { type:'monster-status', status:'stun' },
  ];
  const { notices } = log.translate(events, context);
  const queue = rules.buildCombatSequence(notices);
  const order = queue.map((notice) => notice.type);
  assert.equal(JSON.stringify(order), JSON.stringify([
    'answer-correct',
    'player-hit',
    'enemy-status',
    'monster-action',
    'player-damage',
    'player-dot',
  ]));
});

test('a multi hit skill reports each blow and then the total', () => {
  const log = loadLog();
  const { notices, totalDamage, hits } = log.translate([
    { type:'monster-damage', amount:7, hit:0 },
    { type:'monster-damage', amount:5, hit:1 },
    { type:'monster-damage', amount:4, hit:2 },
  ], context);

  assert.equal(hits, 3);
  assert.equal(totalDamage, 16);
  assert.equal(notices[0].type, 'player-hit');
  assert.equal(notices[1].type, 'player-extra-hit');
  assert.equal(notices[2].type, 'player-extra-hit');
  const total = notices.at(-1);
  assert.equal(total.type, 'player-total');
  assert.equal(total.text, '총 16의 피해를 주었다!');
});

test('a single hit gets no total line, exactly as before', () => {
  const log = loadLog();
  const { notices } = log.translate([{ type:'monster-damage', amount:9 }], context);
  assert.equal(notices.length, 1);
  assert.doesNotMatch(notices[0].text, /총/);
});

test('a critical hit is announced and marked for the damage popup', () => {
  const log = loadLog();
  const { notices } = log.translate([{ type:'monster-damage', amount:30, critical:true }], context);
  assert.match(notices[0].text, /치명타/);
  assert.equal(notices[0].effect.critical, true);
});

test('damage popups are shaped so the effect handler accepts them', () => {
  const log = loadLog();
  const rules = loadRules();
  const events = [
    { type:'monster-damage', amount:12 },
    { type:'monster-dot', amount:3 },
    { type:'player-damage', amount:4 },
    { type:'player-dot', amount:2 },
    { type:'monster-shield', amount:8 },
    { type:'player-heal', amount:6 },
  ];
  const { notices } = log.translate(events, context);
  const queue = rules.buildCombatSequence(notices);
  const withEffects = queue.filter((notice) => notice.effect);
  assert.equal(withEffects.length, events.length, '데미지 숫자 지시가 걸러졌습니다');
  for (const notice of withEffects) {
    assert.ok(notice.effect.id, '효과에 id가 없습니다');
    assert.ok(notice.effect.combatId, '효과에 전투 id가 없습니다');
  }
});

test('attack animation and sound ride along with the first blow only', () => {
  const log = loadLog();
  const { notices } = log.translate([
    { type:'monster-damage', amount:7 },
    { type:'monster-damage', amount:5 },
  ], context);
  assert.equal(notices[0].fx.hitStage, 'primary');
  assert.equal(notices[0].audioId, 'basicAttack');
  assert.equal(notices[1].fx.hitStage, 'extra');
  assert.equal(notices[1].audioId, undefined, '추가타마다 소리가 겹치면 안 됩니다');
});

test('the monster winds up before its blow lands', () => {
  const log = loadLog();
  const { notices } = log.translate([
    { type:'monster-action' },
    { type:'player-damage', amount:4 },
  ], context);
  assert.equal(notices[0].fx.phase, 'wind-up');
  assert.equal(notices[1].fx.phase, 'impact');
  assert.equal(notices[1].tone, 'enemy-action');
});

test('the wrong answer notice shows the real answer and holds long enough to read', () => {
  const log = loadLog();
  const { notices } = log.translate(
    [{ type:'answer-wrong', minimumDurationMs:5000 }],
    { ...context, correctAnswer:'서울' },
  );
  assert.match(notices[0].text, /서울/);
  assert.equal(notices[0].duration, 5000, '서버가 요구한 최소 시간을 지켜야 합니다');
  assert.equal(notices[0].preserveDuration, true, '2배속에서도 정답은 끝까지 보여야 합니다');
});

test('a skill attack lingers longer than a basic one, as it used to', () => {
  const log = loadLog();
  const basic = log.translate([{ type:'monster-damage', amount:5 }], context);
  const skill = log.translate([{ type:'monster-damage', amount:5 }], { ...context, isSkill:true });
  assert.equal(basic.notices[0].duration, log.DURATIONS.playerAttack);
  assert.equal(skill.notices[0].duration, log.DURATIONS.skillAttack);
  assert.ok(skill.notices[0].duration > basic.notices[0].duration);
});

test('timings match the numbers the old battle used', () => {
  const log = loadLog();
  const game = read('game.js');
  const value = (name) => Number(game.match(new RegExp(`const ${name} = (\\d+);`))?.[1]);
  assert.equal(log.DURATIONS.correctAnswer, value('CORRECT_ANSWER_NOTICE_DELAY_V48'));
  // COMBAT_NOTICE_DELAY_V25 = shorten(1920 + 600) = 2120, DOT = shorten(2000 + 600) = 2200
  assert.equal(log.DURATIONS.notice, 2120);
  assert.equal(log.DURATIONS.dot, 2200);
  assert.equal(log.DURATIONS.playerAttack, 1000);
});

test('junk from the server never throws and never invents a log line', () => {
  const log = loadLog();
  for (const junk of [null, undefined, 'nope', 42, {}, [null], [{}], [{ type:'unknown' }]]) {
    const result = log.translate(junk, context);
    assert.ok(Array.isArray(result.notices));
    assert.equal(result.notices.length, 0);
  }
});

test('the server battle actually feeds this translator now', () => {
  const game = read('game.js');
  assert.match(game, /window\.YuksamCombatLogV3\.translate\(response\?\.events/);
  // 이름표 없는 알림을 만들던 옛 번역 함수가 남아 있으면 안 된다
  assert.doesNotMatch(game, /function messageForEvent/);

  const html = read('index.html');
  const logIndex = html.indexOf('<script src="src/combat-log-v3.js"></script>');
  const gameIndex = html.indexOf('<script src="game.js"></script>');
  const fxIndex = html.indexOf('<script src="src/combat-fx.js"></script>');
  assert.ok(logIndex > 0, '모듈이 index.html에 없습니다');
  assert.ok(logIndex > fxIndex, '연출 엔진보다 뒤에 실려야 합니다');
  assert.ok(logIndex < gameIndex, 'game.js보다 먼저 실려야 합니다');
});

test('the translator is handed the pieces it needs to animate and sound', () => {
  const game = read('game.js');
  const call = game.slice(game.indexOf('window.YuksamCombatLogV3.translate('));
  const block = call.slice(0, call.indexOf('});') + 3);
  for (const field of ['monsterName', 'monsterId', 'correctAnswer', 'isSkill', 'fxProfile', 'monsterFxProfile', 'audioId']) {
    assert.ok(block.includes(`${field}:`), `${field} 를 넘겨주지 않습니다`);
  }
});
