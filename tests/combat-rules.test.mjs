import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Script, createContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const source = readFileSync(join(root, 'src', 'combat-rules.js'), 'utf8');
const context = createContext({ window: {}, Math });
context.globalThis = context.window;
new Script(source, { filename: 'src/combat-rules.js' }).runInContext(context);
const rules = context.window.YuksamCombatRules;

test('desert and swamp monster stats apply monster balance before a single regional scale', () => {
  assert.deepEqual(
    { ...rules.scaleMonsterStats({ hp: 100, attack: 20 }, 'desert') },
    { hp: 120, attack: 22 },
  );
  assert.deepEqual(
    { ...rules.scaleMonsterStats({ hp: 100, attack: 20 }, 'swamp') },
    { hp: 130, attack: 24 },
  );
  const alreadyScaled = { hp: 120, attack: 22, __zoneScale: 'desert' };
  assert.equal(rules.scaleMonsterStats(alreadyScaled, 'desert'), alreadyScaled);
  assert.deepEqual(
    { ...rules.scaleMonsterStats({ type: 'snake', hp: 40, attack: 10 }, 'desert') },
    { type: 'snake', hp: 62, attack: 14 },
  );
  assert.deepEqual(
    { ...rules.scaleMonsterStats({ type: 'stomp', hp: 30, attack: 10 }, 'desert') },
    { type: 'stomp', hp: 43, attack: 13 },
  );
});

test('element explosion uses absolute remaining HP thresholds by rank', () => {
  assert.deepEqual(Array.from({ length: 6 }, (_, rank) => rules.executeHpThreshold(rank)), [0, 3, 6, 9, 12, 15]);
});

test('universal and basic critical damage remains fixed at 150 percent', () => {
  for (const [damage, expected] of [[10, 15], [11, 17], [20, 30]]) {
    assert.equal(rules.mageBasicCriticalDamage(damage), expected);
  }
});

test('Shield Charge caps shield-derived base damage and applies critical damage after the cap', () => {
  assert.deepEqual({ ...rules.shieldChargeDamage(40, false) }, { baseDamage:40, damage:40 });
  assert.deepEqual({ ...rules.shieldChargeDamage(100, false) }, { baseDamage:100, damage:100 });
  assert.deepEqual({ ...rules.shieldChargeDamage(500, false) }, { baseDamage:100, damage:100 });
  assert.deepEqual({ ...rules.shieldChargeDamage(40, true) }, { baseDamage:40, damage:60 });
  assert.deepEqual({ ...rules.shieldChargeDamage(100, true) }, { baseDamage:100, damage:150 });
  assert.deepEqual({ ...rules.shieldChargeDamage(500, true) }, { baseDamage:100, damage:150 });
});

test('enhancement succeeds only when the random roll is below the displayed chance', () => {
  for (const chance of [0.8, 0.6, 0.4, 0.2]) {
    assert.equal(rules.rollEnhancement(chance, chance - Number.EPSILON), true);
    assert.equal(rules.rollEnhancement(chance, chance), false);
    assert.equal(rules.rollEnhancement(chance, chance + Number.EPSILON), false);
  }
});

test('hostile hits independently miss only below the configured chance', () => {
  assert.deepEqual({ ...rules.rollHostileHit(0.10, 0.099) }, { missed:true });
  assert.deepEqual({ ...rules.rollHostileHit(0.10, 0.10) }, { missed:false });
  assert.deepEqual({ ...rules.rollHostileHit(0.10, 0.75) }, { missed:false });
});

test('monster miss chance adds the universal ten percent and caps at one hundred percent', () => {
  assert.equal(rules.combinedMonsterMissChance(0), 0.10);
  assert.equal(rules.combinedMonsterMissChance(0.25), 0.35);
  assert.equal(rules.combinedMonsterMissChance(2), 1);
});

test('light flash heals every living ally for half maximum HP and clamps at max HP', () => {
  const allies = [
    { hp: 20, maxHp: 100 },
    { hp: 90, maxHp: 100 },
    { hp: 0, maxHp: 100 },
  ];
  const result = rules.healLivingAllies(allies, 0.5);
  assert.deepEqual(allies, [
    { hp: 70, maxHp: 100 },
    { hp: 100, maxHp: 100 },
    { hp: 0, maxHp: 100 },
  ]);
  assert.deepEqual(Array.from(result, entry => ({ ...entry })), [
    { targetIndex: 0, amount: 50 },
    { targetIndex: 1, amount: 10 },
  ]);
});

test('party heal planning reports healing without mutating allies before the queued event', () => {
  const allies = [{ hp:10, maxHp:20 }, { hp:0, maxHp:20 }, { hp:18, maxHp:20 }];
  const planned = rules.planLivingAllyHeals(allies, 0.5);
  assert.deepEqual(Array.from(planned, entry => ({ ...entry })), [
    { targetIndex:0, amount:10 },
    { targetIndex:2, amount:2 },
  ]);
  assert.deepEqual(allies.map(ally => ally.hp), [10, 0, 18]);
});

test('combat status badges normalize legacy weaken state and omit shield badges', () => {
  assert.deepEqual(
    { ...rules.normalizeCombatStatuses({ shield: 43, weakenTurns: 2, chillTurns: 1 }) },
    { shield: 43, chillTurns: 2 },
  );
  const badges = rules.buildStatusBadges({
    poisonTurns: 2,
    stunTurns: 1,
    shield: 9,
    weakenTurns: 3,
    missChance: 0.2,
    guardianOathReady: true,
  });
  assert.deepEqual(Array.from(badges, badge => badge.key), ['poison', 'stun', 'chill', 'missChance', 'guardianOath']);
  assert.ok(badges.every(badge => badge.label && badge.tooltip));
  assert.equal(badges.some((badge) => badge.key === 'shield'), false);
  assert.deepEqual({ ...rules.buildStatusBadges({ chillTurns: 1 })[0] }, {
    key: 'chill', label: '냉기 1', tooltip: '다음 공격 데미지가 50% 감소합니다.',
  });
  assert.match(rules.buildStatusBadges({ intBuffTurns: 2 })[0].tooltip, /지능이 30% 증가합니다\. 남은 2턴/);
});

test('normal combat notices remain visible 600ms longer', () => {
  assert.equal(rules.combatNoticeDelay(1920), 2520);
});

test('combat delays are shortened without becoming negative', () => {
  assert.equal(rules.shortenCombatDelay(2520), 2120);
  assert.equal(rules.shortenCombatDelay(300), 0);
});

test('chill status events deduplicate only within the same event target', () => {
  const events = rules.deduplicateCombatStatusEvents([
    { type:'enemy-status', text:'monster chill', effect:{ type:'monster-status', status:' Chill ' } },
    { type:'player-status', text:'player chill', effect:{ type:'player-status', status:'chill' } },
    { type:'enemy-status', text:'duplicate monster chill', effect:{ type:'monster-status', status:'chill' } },
    { type:'enemy-status', text:'stun', effect:{ type:'monster-status', status:'stun' } },
    { type:'enemy-status', text:'shadow', effect:{ type:'monster-status', status:'shadow' } },
  ]);
  assert.deepEqual(Array.from(events, event => event.text), ['monster chill', 'player chill', 'stun', 'shadow']);
});

test('duplicate chill events keep the strongest duration for each target', () => {
  const events = rules.deduplicateCombatStatusEvents([
    { type:'enemy-status', text:'빙결 창 냉기', effect:{ type:'monster-status', status:'chill', turns:1 } },
    { type:'enemy-status', text:'냉기 집중 냉기', effect:{ type:'monster-status', status:'chill', turns:2 } },
    { type:'player-status', text:'플레이어 냉기', effect:{ type:'player-status', status:'chill', turns:3 } },
  ]);
  assert.equal(events.length, 2);
  assert.equal(events[0].effect.turns, 2);
  assert.equal(events[0].text, '냉기 집중 냉기');
  assert.equal(events[1].effect.turns, 3);
});

test('damage events preserve their displayed amount and critical state', () => {
  const [event] = rules.buildCombatSequence([{
    type:'player-hit',
    text:'critical hit',
    effect:{ id:'turn-1-hit-1', type:'monster-damage', combatId:'monster-1', amount:7, critical:true },
  }]);
  assert.deepEqual({ ...event.effect }, {
    id:'turn-1-hit-1', type:'monster-damage', combatId:'monster-1', amount:7, critical:true,
  });
});

test('monster damage normalization preserves an explicit shield bypass', () => {
  const [event] = rules.buildCombatSequence([{
    type:'player-hit',
    text:'shield bypass',
    effect:{
      id:'turn-1-hit-1',
      type:'monster-damage',
      combatId:'monster-1',
      amount:7,
      ignoreShield:true,
    },
  }]);
  assert.deepEqual({ ...event.effect }, {
    id:'turn-1-hit-1',
    type:'monster-damage',
    combatId:'monster-1',
    amount:7,
    ignoreShield:true,
  });
});

test('queued player support effects preserve only their typed payload', () => {
  const [event] = rules.buildCombatSequence([{
    type:'player-support',
    text:'보호막을 생성했다!',
    audioId:'defensiveStance',
    effect:{ id:'support-1', type:'player-support', combatId:'monster-1', kind:'shield', amount:12, ignored:'x' },
  }]);
  assert.deepEqual({ ...event.effect }, {
    id:'support-1', type:'player-support', combatId:'monster-1', kind:'shield', amount:12,
  });
  assert.equal(event.audioId, 'defensiveStance');
});

test('chill halves every hit in one damaging action and consumes one turn only then', () => {
  const chilledHits = rules.applyChillToAttack([7, 7], 1);
  assert.deepEqual(
    { ...chilledHits, damages: Array.from(chilledHits.damages) },
    { damages: [4, 4], chillTurns: 0 },
  );
  const noAttack = rules.applyChillToAttack([], 1);
  assert.deepEqual(
    { ...noAttack, damages: Array.from(noAttack.damages) },
    { damages: [], chillTurns: 1 },
  );
});

test('question selection uses only enabled workbooks and returns null when none are usable', () => {
  const books = [
    { id:'off', enabled:false },
    { id:'on', enabled:true },
  ];
  const questions = [
    { id:'disabled-question', workbookId:'off', zone:'forest' },
    { id:'enabled-question', workbookId:'on', zone:'desert' },
  ];
  assert.equal(rules.selectEnabledQuestion(books, questions, () => 0).id, 'enabled-question');
  assert.equal(rules.selectEnabledQuestion([{ id:'off', enabled:false }], questions, () => 0), null);
  assert.equal(rules.selectEnabledQuestion([{ id:'empty', enabled:true }], questions, () => 0), null);
});

test('monster techniques produce separate activation and effect notices', () => {
  assert.deepEqual(Array.from(rules.buildMonsterTechniqueNotices({ name:'포자 뿌리기', kind:'poison', poisonTurns:2 })), [
    '포자 뿌리기를 사용했다!',
    '중독에 걸렸다! 2턴 동안 독 피해를 받습니다.',
  ]);
  assert.deepEqual(Array.from(rules.buildMonsterTechniqueNotices({ name:'점액 방패', kind:'selfShield', shield:12 })), [
    '점액 방패를 사용했다!',
    '보호막 12을 생성했다!',
  ]);
  assert.deepEqual(Array.from(rules.buildMonsterTechniqueNotices({ name:'대지 찍기', kind:'stun', stunTurns:1 })), [
    '대지 찍기를 사용했다!',
    '기절에 걸렸다! 다음 행동을 1턴 할 수 없습니다.',
  ]);
});

test('self-shield monster technique notices remain self-only without player damage text', () => {
  const notices = rules.buildMonsterTechniqueNotices({ name:'단단해지기', kind:'selfShield', shield:23 });
  assert.equal(notices.length, 2);
  assert.match(notices[1], /23/);
  assert.doesNotMatch(notices.join(' '), /피해/);
});
