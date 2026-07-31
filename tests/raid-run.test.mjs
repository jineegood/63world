import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync as readFileRaw } from 'node:fs';
import { dirname, join } from 'node:path';
import { Script, createContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const readFileSync = (path, options) => readFileRaw(path, options).replace(/\r\n/g, '\n');

function loadRun() {
  const context = createContext({ window:{} });
  for (const file of ['raid-rules.js', 'raid-run.js']) {
    new Script(readFileSync(join(root, 'src', file), 'utf8'), { filename:`src/${file}` })
      .runInContext(context);
  }
  return context.window;
}

const api = loadRun();

const member = (id, slot, extra = {}) => ({
  id, name:id, slot, klass:'warrior', maxHp:60, hp:60, attack:12, ...extra,
});

const makeRun = (overrides = {}) => api.YuksamRaidRun.createRun({
  floor:1,
  members:[
    member('me', 'front', { isPlayer:true }),
    member('ally1', 'middle'),
    member('ally2', 'back'),
  ],
  rng:() => 0, // 동료가 항상 정답
  ...overrides,
});

test('진행 엔진도 화면·소리·저장을 건드리지 않는다', () => {
  const source = readFileSync(join(root, 'src', 'raid-run.js'), 'utf8');
  assert.doesNotMatch(source, /document\.|localStorage|playSfx|openModal|fetch\(/);
  assert.ok(api.YuksamRaidRun);
});

test('아직 열지 않은 층으로는 시작할 수 없다', () => {
  assert.throws(() => makeRun({ floor:2 }), /열리지 않은 층/);
});

test('처음에는 대형을 정하는 장면에서 시작한다', () => {
  const run = makeRun();
  assert.equal(run.phase, 'formation');
  assert.equal(run.snapshot().encounterTotal, 4);
});

test('대형이 잘못되면 출발하지 못한다', () => {
  const run = makeRun();
  const bad = run.confirmFormation({ me:'front', ally1:'front', ally2:'back' });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /같은 자리/);
  assert.equal(run.phase, 'formation', '막혔으면 그대로 대형 화면이어야 한다');
});

test('대형을 확정하면 이동이 시작되고 몬스터를 만난다', () => {
  const run = makeRun();
  assert.equal(run.confirmFormation({ me:'front', ally1:'middle', ally2:'back' }).ok, true);
  assert.equal(run.phase, 'travel');

  const arrival = run.arriveAtEncounter();
  assert.equal(arrival.ok, true);
  assert.equal(run.phase, 'battle');
  assert.equal(arrival.monster.name, '경비 로봇');
  assert.equal(arrival.monster.isBoss, false);
});

test('이동 중이 아닐 때 도착 처리를 하면 막힌다', () => {
  const run = makeRun();
  const early = run.arriveAtEncounter();
  assert.equal(early.ok, false);
});

test('전투 중이 아닐 때 라운드를 굴리면 막힌다', () => {
  const run = makeRun();
  const early = run.resolveRound({ me:true });
  assert.equal(early.ok, false);
});

test('맞히면 몬스터 체력이 줄고, 오답이면 절반만 들어간다', () => {
  const run = makeRun();
  run.confirmFormation({ me:'front', ally1:'middle', ally2:'back' });
  run.arriveAtEncounter();
  const before = run.monster.hp;

  const result = run.resolveRound({ me:true, ally1:true, ally2:false });
  assert.equal(result.ok, true);
  // 12 + 12 + 6(오답 절반) = 30
  assert.equal(before - run.monster.hp, 30);
  const wrong = result.events.find((e) => e.memberId === 'ally2' && e.kind === 'party-hit');
  assert.equal(wrong.correct, false);
  assert.equal(wrong.damage, 6);
});

test('몬스터 반격은 대형에 따라 앞줄이 가장 아프다', () => {
  const run = makeRun();
  run.confirmFormation({ me:'front', ally1:'middle', ally2:'back' });
  run.arriveAtEncounter();
  // 경비 로봇 1라운드째는 단일 공격 → 앞줄만 맞는다.
  const monsterAttack = run.monster.attack;
  const first = run.resolveRound({ me:true, ally1:true, ally2:true });
  const hits = first.events.filter((e) => e.kind === 'monster-hit');
  assert.equal(first.attackKind, 'single');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].memberId, 'me');
  assert.equal(hits[0].damage, Math.round(monsterAttack * 1.5)); // 앞줄은 1.5배
});

test('전체 공격 라운드에는 셋 다 각자 배율로 맞는다', () => {
  const run = makeRun();
  run.confirmFormation({ me:'front', ally1:'middle', ally2:'back' });
  run.arriveAtEncounter();
  // 경비 로봇 패턴은 single, single, all → 세 번째 라운드가 전체 공격
  run.resolveRound({ me:false, ally1:false, ally2:false });
  run.resolveRound({ me:false, ally1:false, ally2:false });
  const third = run.resolveRound({ me:false, ally1:false, ally2:false });

  assert.equal(third.attackKind, 'all');
  const hits = third.events.filter((e) => e.kind === 'monster-hit');
  assert.equal(hits.length, 3);
  const byId = Object.fromEntries(hits.map((h) => [h.memberId, h.damage]));
  assert.ok(byId.me > byId.ally1 && byId.ally1 > byId.ally2,
    `앞>중간>뒤 순이어야 한다: ${JSON.stringify(byId)}`);
  assert.ok(third.events.some((e) => e.kind === 'monster-windup' && e.all === true),
    '전체 공격은 미리 알려 줘야 피할 준비를 한다');
});

test('몬스터를 쓰러뜨리면 반격 없이 다음 이동으로 넘어간다', () => {
  const run = makeRun({
    members:[
      member('me', 'front', { isPlayer:true, attack:500 }),
      member('ally1', 'middle', { attack:500 }),
      member('ally2', 'back', { attack:500 }),
    ],
  });
  run.confirmFormation({ me:'front', ally1:'middle', ally2:'back' });
  run.arriveAtEncounter();
  const result = run.resolveRound({ me:true, ally1:true, ally2:true });

  assert.equal(result.monsterDown, true);
  assert.equal(run.phase, 'travel');
  assert.ok(!result.events.some((e) => e.kind === 'monster-hit'), '죽은 몬스터는 반격하지 않는다');
});

test('일반 전투 3회를 지나면 마지막에 레이드 보스가 나온다', () => {
  const run = makeRun({
    members:[
      member('me', 'front', { isPlayer:true, attack:500, maxHp:9999, hp:9999 }),
      member('ally1', 'middle', { attack:500, maxHp:9999, hp:9999 }),
      member('ally2', 'back', { attack:500, maxHp:9999, hp:9999 }),
    ],
  });
  run.confirmFormation({ me:'front', ally1:'middle', ally2:'back' });

  const met = [];
  for (let i = 0; i < 4; i += 1) {
    const arrival = run.arriveAtEncounter();
    met.push({ name:arrival.monster.name, boss:arrival.monster.isBoss });
    run.resolveRound({ me:true, ally1:true, ally2:true });
  }

  assert.equal(met.length, 4);
  assert.deepEqual(met.slice(0, 3).map((m) => m.boss), [false, false, false]);
  assert.equal(met[3].boss, true);
  assert.equal(met[3].name, '63빌딩 관리자');
  assert.equal(run.phase, 'cleared', '보스를 잡으면 층을 깬 것이다');
});

test('전멸하면 진행이 끝난다', () => {
  const run = makeRun({
    members:[
      member('me', 'front', { isPlayer:true, attack:1, maxHp:1, hp:1 }),
      member('ally1', 'middle', { attack:1, maxHp:1, hp:1 }),
      member('ally2', 'back', { attack:1, maxHp:1, hp:1 }),
    ],
  });
  run.confirmFormation({ me:'front', ally1:'middle', ally2:'back' });
  run.arriveAtEncounter();

  let guard = 0;
  while (run.phase === 'battle' && guard < 20) {
    run.resolveRound({ me:false, ally1:false, ally2:false });
    guard += 1;
  }
  assert.equal(run.phase, 'wiped');
  assert.ok(run.log.some((e) => e.kind === 'wiped'));
  assert.ok(run.log.some((e) => e.kind === 'member-down'));
});

test('쓰러진 동료는 다음 라운드에 때리지도 맞지도 않는다', () => {
  const run = makeRun({
    members:[
      member('me', 'front', { isPlayer:true, attack:5, maxHp:1, hp:1 }),
      member('ally1', 'middle', { attack:5, maxHp:400, hp:400 }),
      member('ally2', 'back', { attack:5, maxHp:400, hp:400 }),
    ],
  });
  run.confirmFormation({ me:'front', ally1:'middle', ally2:'back' });
  run.arriveAtEncounter();
  run.resolveRound({ me:true, ally1:true, ally2:true }); // 앞줄이 쓰러진다

  const me = run.members.find((m) => m.id === 'me');
  assert.equal(me.hp, 0);

  const next = run.resolveRound({ me:true, ally1:true, ally2:true });
  assert.ok(!next.events.some((e) => e.kind === 'party-hit' && e.memberId === 'me'));
  assert.ok(!next.events.some((e) => e.kind === 'monster-hit' && e.memberId === 'me'));
});

test('동료 정답은 밖에서 준 무작위 값으로 정해지고 나만 빠진다', () => {
  const always = makeRun({ rng:() => 0 });
  const answers = always.rollAllyAnswers();
  assert.deepEqual(Object.keys(answers).sort(), ['ally1', 'ally2']);
  assert.equal(answers.ally1, true);
  assert.equal(answers.ally2, true);
  assert.equal('me' in answers, false, '내 정답은 내가 직접 푼다');

  const never = makeRun({ rng:() => 0.99 });
  const missed = never.rollAllyAnswers();
  assert.equal(missed.ally1, false);
  assert.equal(missed.ally2, false);
});

test('힐러가 있으면 라운드마다 가장 다친 동료가 회복된다', () => {
  const run = api.YuksamRaidRun.createRun({
    floor:1,
    rng:() => 0,
    members:[
      member('me', 'front', { isPlayer:true, spec:'방어', maxHp:60, hp:20 }),
      member('ally1', 'middle', { spec:'화염' }),
      member('ally2', 'back', { spec:'신성', attack:10 }),
    ],
  });
  run.confirmFormation({ me:'front', ally1:'middle', ally2:'back' });
  run.arriveAtEncounter();
  const result = run.resolveRound({ me:true, ally1:true, ally2:true });
  const heal = result.events.find((e) => e.kind === 'party-heal');
  assert.ok(heal, '힐러가 회복시켜야 한다');
  assert.equal(heal.memberId, 'me');
  assert.equal(heal.amount, 9); // 10 * 0.9
});

test('전투 사이 이동에서 체력을 회복한다', () => {
  const run = makeRun({
    members:[
      member('me', 'front', { isPlayer:true, attack:500, maxHp:60, hp:20 }),
      member('ally1', 'middle', { attack:500 }),
      member('ally2', 'back', { attack:500 }),
    ],
  });
  run.confirmFormation({ me:'front', ally1:'middle', ally2:'back' });
  run.arriveAtEncounter();
  run.resolveRound({ me:true, ally1:true, ally2:true }); // 한 방에 처치 → travel

  const before = run.members.find((m) => m.id === 'me').hp;
  run.arriveAtEncounter();
  const after = run.members.find((m) => m.id === 'me').hp;
  assert.ok(after > before, `이동하며 회복해야 한다: ${before} -> ${after}`);
  assert.ok(run.log.some((e) => e.kind === 'travel-recovery'));
});

/* 1층을 끝까지 돌려 결과를 돌려준다.
   정답률은 4라운드에 3번 맞히는 패턴(75%)으로 고정한다 — 무작위가 아니라 항상 같은 결과가 나온다. */
function playFloorOne(members) {
  const run = api.YuksamRaidRun.createRun({
    floor:1,
    rng:() => 0,
    members:members.map((m) => ({ ...m })),
  });
  run.confirmFormation(Object.fromEntries(members.map((m) => [m.id, m.slot])));

  let guard = 0;
  let round = 0;
  while (run.phase !== 'cleared' && run.phase !== 'wiped' && guard < 400) {
    if (run.phase === 'travel') {
      run.arriveAtEncounter();
    } else if (run.phase === 'battle') {
      const correct = round % 4 !== 3; // 네 번에 세 번 정답
      run.resolveRound(Object.fromEntries(members.map((m) => [m.id, correct])));
      round += 1;
    }
    guard += 1;
  }
  return { phase:run.phase, round, members:run.snapshot().members };
}

test('Lv.5 세 명(탱커·딜러·힐러)이면 1층을 깰 수 있다', () => {
  /* 제작자 요구: 1층은 Lv.5 세 명이 모이면 깰 수 있어야 한다.
     아래 수치는 실제 Lv.5 캐릭터 근처 값이다(HP 48~66, 공격 7~8).
     이 검사가 깨지면 1층이 너무 어려워진 것이다. */
  const result = playFloorOne([
    { id:'tank', name:'탱커', slot:'front', spec:'방어', maxHp:66, hp:66, attack:7, isPlayer:true },
    { id:'dps', name:'딜러', slot:'middle', spec:'화염', maxHp:52, hp:52, attack:8 },
    { id:'healer', name:'힐러', slot:'back', spec:'신성', maxHp:48, hp:48, attack:7 },
  ]);
  assert.equal(result.phase, 'cleared', `1층은 Lv.5 셋이 깰 수 있어야 한다 (${result.round}라운드에 ${result.phase})`);
});

test('힐러가 빠지면 같은 능력치로도 1층을 넘기지 못한다', () => {
  /* 힐러 역할이 실제로 의미가 있어야 한다. 신성을 냉기로 바꾸기만 해도 결과가 갈려야
     "탱커와 힐러의 역할이 나뉜다"는 설계가 말이 된다. */
  const result = playFloorOne([
    { id:'tank', name:'탱커', slot:'front', spec:'방어', maxHp:66, hp:66, attack:7, isPlayer:true },
    { id:'dps1', name:'딜러1', slot:'middle', spec:'화염', maxHp:52, hp:52, attack:8 },
    { id:'dps2', name:'딜러2', slot:'back', spec:'냉기', maxHp:48, hp:48, attack:7 },
  ]);
  assert.equal(result.phase, 'wiped', `힐러가 없으면 무너져야 한다 (${result.round}라운드에 ${result.phase})`);
});

test('대형을 거꾸로 세우면(약한 사람이 앞) 훨씬 위험해진다', () => {
  /* 앞줄이 1.5배를 맞으므로 누구를 앞에 세우는지가 실제로 결과를 바꿔야 한다. */
  const roster = [
    { id:'tank', name:'탱커', spec:'방어', maxHp:66, hp:66, attack:7 },
    { id:'dps', name:'딜러', spec:'화염', maxHp:52, hp:52, attack:8 },
    { id:'healer', name:'힐러', spec:'신성', maxHp:48, hp:48, attack:7, isPlayer:true },
  ];
  const good = playFloorOne(roster.map((m) => ({
    ...m, slot:m.id === 'tank' ? 'front' : m.id === 'dps' ? 'middle' : 'back',
  })));
  const bad = playFloorOne(roster.map((m) => ({
    ...m, slot:m.id === 'healer' ? 'front' : m.id === 'dps' ? 'middle' : 'back',
  })));

  const remaining = (result) => result.members.reduce((sum, m) => sum + m.hp, 0);
  assert.equal(good.phase, 'cleared');
  assert.ok(remaining(good) > remaining(bad),
    `튼튼한 사람을 앞에 세운 쪽이 더 많이 살아남아야 한다: 올바른 대형 ${remaining(good)} vs 거꾸로 ${remaining(bad)}`);
});

test('현재 상태를 화면이 읽을 수 있는 형태로 알려 준다', () => {
  const run = makeRun();
  run.confirmFormation({ me:'front', ally1:'middle', ally2:'back' });
  run.arriveAtEncounter();
  const snap = run.snapshot();

  assert.equal(snap.phase, 'battle');
  assert.equal(snap.floor, 1);
  assert.equal(snap.encounterIndex, 0);
  assert.equal(snap.encounterTotal, 4);
  assert.equal(snap.aliveCount, 3);
  assert.equal(snap.members.length, 3);
  assert.ok(snap.monster.name);
  assert.ok(snap.reward.exp > 0 && snap.reward.gold > 0);

  // 스냅샷을 고쳐도 진짜 상태는 바뀌지 않아야 한다.
  snap.members[0].hp = 1;
  assert.notEqual(run.members[0].hp, 1);
});
