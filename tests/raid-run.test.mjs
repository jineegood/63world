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

/* 빗나감(10%)·치명타(15%)에 걸리지 않고 동료는 정답을 맞히는(70% 미만) 평범한 굴림 */
const PLAIN = () => 0.5;

/* 몬스터의 기술 순서는 무작위지만 씨앗이 같으면 같은 순서가 나온다.
   검사에서는 씨앗을 고정해 순서를 알고 시작한다.
   'test-2'는 1층 첫 몬스터(버섯돌이킹)가 단일 → 전체 → 없음 순으로 쓰는 씨앗이다. */
const FIXED_SEED = 'test-2';

const makeRun = (overrides = {}) => api.YuksamRaidRun.createRun({
  floor:1,
  members:[
    member('me', 'front', { isPlayer:true }),
    member('ally1', 'middle'),
    member('ally2', 'back'),
  ],
  rng:PLAIN, // 동료가 항상 정답
  patternSeed:FIXED_SEED,
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

test('교사 던전 치트는 현재 몬스터를 서버 결과 한 번으로 즉시 처치한다', () => {
  const run = makeRun();
  run.confirmFormation({ me:'front', ally1:'middle', ally2:'back' });
  run.arriveAtEncounter();
  const before = run.snapshot();
  const result = run.resolveRound({}, { forceMonsterDefeat:true });
  const after = run.snapshot();
  assert.equal(result.ok, true);
  assert.equal(result.teacherKill, true);
  assert.equal(result.monsterDown, true);
  assert.equal(after.monster.hp, 0);
  assert.equal(after.encounterIndex, before.encounterIndex + 1);
  assert.equal(after.phase, 'travel');
  assert.equal(result.events[0].monsterHp, 0);
  assert.equal(result.events.at(-1).kind, 'monster-down');
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
  // 시트의 출현 규칙대로 1층의 첫 상대는 Lv.5 버섯돌이킹이다.
  assert.equal(arrival.monster.name, '버섯돌이킹');
  assert.equal(arrival.monster.isBoss, false);
});

test('같은 방에 있는 셋은 무작위 기술 순서를 똑같이 본다', () => {
  /* 방장과 참가자가 각자 진행 엔진을 만들지만, 방 id를 씨앗으로 쓰므로
     따로 계산해도 같은 순서가 나와야 한다. 어긋나면 다음 턴 예고가 서로 다르다. */
  const R = api.YuksamRaidRules;
  const start = (seed) => {
    const run = makeRun({ patternSeed:seed, encounterIds:['guardBot'] });
    run.confirmFormation({ me:'front', ally1:'middle', ally2:'back' });
    run.arriveAtEncounter();
    return run;
  };
  const readOrder = (run) => {
    const seed = run.snapshot().patternSeed;
    return Array.from({ length:8 }, (_, round) =>
      R.attackPlanForRound(run.monster, round, seed).name).join(' → ');
  };

  const host = start('room-abc');
  const guest = start('room-abc');
  assert.equal(host.snapshot().patternSeed, 'room-abc');
  assert.equal(readOrder(host), readOrder(guest), '같은 방이면 같은 순서');

  const other = start('room-zzz');
  assert.notEqual(readOrder(host), readOrder(other), '다른 방이면 다른 순서');

  // 씨앗을 안 주면 진행마다 알아서 하나 만든다.
  const auto = api.YuksamRaidRun.createRun({
    floor:1, rng:() => 0.42,
    members:[member('me', 'front'), member('a', 'middle'), member('b', 'back')],
  });
  assert.ok(auto.snapshot().patternSeed, '씨앗이 비어 있으면 안 된다');
});

test('진행 중 방장 스냅샷을 받으면 씨앗도 함께 맞춘다', () => {
  const run = makeRun({ patternSeed:'mine' });
  run.confirmFormation({ me:'front', ally1:'middle', ally2:'back' });
  assert.equal(run.snapshot().patternSeed, 'mine');
  run.importSnapshot({ patternSeed:'host-seed' });
  assert.equal(run.snapshot().patternSeed, 'host-seed');
  // 빈 값이 오면 쓰던 씨앗을 유지한다(순서가 도중에 바뀌면 안 된다).
  run.importSnapshot({ patternSeed:'' });
  assert.equal(run.snapshot().patternSeed, 'host-seed');
});

test('같은 난수를 주면 같은 몬스터 목록이 나오고, 목록을 주면 그대로 쓴다', () => {
  // 방에 셋이 들어와도 모두 같은 몬스터를 봐야 한다.
  const a = makeRun().snapshot().encounterIds;
  const b = makeRun().snapshot().encounterIds;
  assert.deepEqual([...a], [...b], '같은 난수면 같은 목록');

  const fixed = makeRun({ encounterIds:['guardBot', 'towerWarden'] });
  assert.deepEqual([...fixed.snapshot().encounterIds], ['guardBot', 'towerWarden']);
  fixed.confirmFormation({ me:'front', ally1:'middle', ally2:'back' });
  assert.equal(fixed.arriveAtEncounter().monster.name, '경비 로봇');
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
  const R = api.YuksamRaidRules;
  const power = Math.max(1, Math.floor(12 * R.PARTY_POWER));
  // 정답 둘은 제 몫, 오답 하나는 절반
  assert.equal(before - run.monster.hp, power + power + Math.floor(power / 2));
  const wrong = result.events.find((e) => e.memberId === 'ally2' && e.kind === 'party-hit');
  assert.equal(wrong.correct, false);
  assert.equal(wrong.damage, Math.floor(power / 2));
});

test('몬스터 반격은 대형에 따라 앞에 선 사람이 가장 아프다', () => {
  const run = makeRun();
  run.confirmFormation({ me:'front', ally1:'middle', ally2:'back' });
  run.arriveAtEncounter();
  // 고정 씨앗에서 버섯돌이킹의 첫 턴은 단일 공격 → 한 명만 맞는다.
  const monsterAttack = run.monster.attack;
  const first = run.resolveRound({ me:true, ally1:true, ally2:true });
  const hits = first.events.filter((e) => e.kind === 'monster-hit');
  assert.equal(first.attackKind, 'single');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].memberId, 'me');
  // 앞자리 1.5배만 적용하며 단일 공격 추가 배율은 1이다.
  const R = api.YuksamRaidRules;
  assert.equal(hits[0].damage, Math.round(monsterAttack * 1.5 * R.SINGLE_TARGET_BONUS));
});

test('전체 공격 라운드에는 셋 다 각자 배율로 맞는다', () => {
  const run = makeRun();
  run.confirmFormation({ me:'front', ally1:'middle', ally2:'back' });
  run.arriveAtEncounter();
  // 고정 씨앗에서 버섯돌이킹은 단일 → 전체(포자) → 회복 순으로 쓴다.
  run.resolveRound({ me:false, ally1:false, ally2:false });
  const second = run.resolveRound({ me:false, ally1:false, ally2:false });

  assert.equal(second.attackKind, 'all');
  const hits = second.events.filter((e) => e.kind === 'monster-hit');
  assert.equal(hits.length, 3);
  const byId = Object.fromEntries(hits.map((h) => [h.memberId, h.damage]));
  assert.ok(byId.me > byId.ally1 && byId.ally1 > byId.ally2,
    `앞>중간>뒤 순이어야 한다: ${JSON.stringify(byId)}`);
  assert.ok(second.events.some((e) => e.kind === 'monster-windup' && e.all === true),
    '전체 공격은 미리 알려 줘야 피할 준비를 한다');

  // 세 번째 라운드는 공격하지 않는 회복 턴이라 아무도 맞지 않는다.
  const third = run.resolveRound({ me:false, ally1:false, ally2:false });
  assert.equal(third.attackKind, 'none');
  assert.equal(third.events.filter((e) => e.kind === 'monster-hit').length, 0);
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
  assert.deepEqual([...met.slice(0, 3).map((m) => m.boss)], [false, false, false]);
  assert.equal(met[3].boss, true);
  // 마지막 자리는 그 구간에서 가장 레벨이 높은 Lv.7 몬스터다(시트의 출현 규칙).
  assert.ok(['오염된 슬라임', '폭주 복사기'].includes(met[3].name), `보스 이름: ${met[3].name}`);
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

test('힐러가 있으면 라운드마다 가장 다친 동료가 회복된다', () => {
  const run = api.YuksamRaidRun.createRun({
    floor:1,
    rng:PLAIN,
    members:[
      member('me', 'front', { isPlayer:true, spec:'방어', maxHp:300, hp:300 }),
      member('ally1', 'middle', { spec:'화염' }),
      member('ally2', 'back', { spec:'신성', attack:10 }),
    ],
  });
  run.confirmFormation({ me:'front', ally1:'middle', ally2:'back' });
  run.arriveAtEncounter();
  /* 이동 중 회복이 먼저 들어가 모두 가득 찬 상태로 도착한다.
     힐러가 회복할 대상이 생기도록 도착한 뒤에 다치게 한다. */
  run.members.find((m) => m.id === 'me').hp = 10;
  const result = run.resolveRound({ me:true, ally1:true, ally2:true });
  const heal = result.events.find((e) => e.kind === 'party-heal');
  assert.ok(heal, '힐러가 회복시켜야 한다');
  assert.equal(heal.memberId, 'me');
  // 회복량은 모자란 체력을 넘지 않는다.
  const want = Math.round(10 * api.YuksamRaidRules.HEAL_RATIO);
  assert.ok(heal.amount > 0 && heal.amount <= want, 'amount=' + heal.amount + ' want<=' + want);
});

test('다음 몬스터 전투에서 쓰러진 사람은 HP 1로 부활하고 생존자는 현재 HP를 유지한다', () => {
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

  // 다음 몬스터로 걸어가기 직전에 한 명은 쓰러지고 한 명은 다친 상태다.
  const me = run.members.find((m) => m.id === 'me');
  const ally = run.members.find((m) => m.id === 'ally1');
  me.hp = 0;
  ally.hp = 12;
  run.arriveAtEncounter();
  assert.equal(run.members.find((m) => m.id === 'me').hp, 1);
  assert.equal(run.members.find((m) => m.id === 'ally1').hp, 12);
  const revival = run.log.find((e) => e.kind === 'travel-recovery');
  assert.ok(revival);
  assert.equal(revival.recovered[0].memberId, 'me');
  assert.equal(revival.recovered[0].revived, true);
});

test('진행 중 전투를 다시 연결해도 HP 0인 학생은 즉시 부활하지 않는다', () => {
  const run = makeRun({
    members:[
      member('me', 'front', { isPlayer:true, hp:0 }),
      member('ally1', 'middle'),
      member('ally2', 'back'),
    ],
  });

  assert.equal(run.members.find((entry) => entry.id === 'me').hp, 0);
});

/* 1층을 끝까지 돌려 결과를 돌려준다.
   정답률은 4라운드에 3번 맞히는 패턴(75%)으로 고정한다 — 무작위가 아니라 항상 같은 결과가 나온다. */
function playFloorOne(members, encounterIds = null, patternSeed = FIXED_SEED) {
  const run = api.YuksamRaidRun.createRun({
    floor:1,
    rng:PLAIN,
    members:members.map((m) => ({ ...m })),
    encounterIds,
    patternSeed,
  });
  run.confirmFormation(Object.fromEntries(members.map((m) => [m.id, m.slot])));

  let guard = 0;
  let round = 0;
  // 이동 중 회복이 크기 때문에 "끝났을 때 체력"만 보면 대형 차이가 가려진다.
  // 전투 도중 가장 위험했던 순간(최저 체력 비율)을 함께 기록한다.
  let lowestRatio = 1;
  let firstDownRound = Infinity;   // 처음으로 누가 쓰러진 라운드
  while (run.phase !== 'cleared' && run.phase !== 'wiped' && guard < 400) {
    if (run.phase === 'travel') {
      run.arriveAtEncounter();
    } else if (run.phase === 'battle') {
      const correct = round % 4 !== 3; // 네 번에 세 번 정답
      run.resolveRound(Object.fromEntries(members.map((m) => [m.id, correct])));
      round += 1;
      run.snapshot().members.forEach((m) => {
        lowestRatio = Math.min(lowestRatio, m.hp / m.maxHp);
        if (m.hp <= 0 && firstDownRound === Infinity) firstDownRound = round;
      });
    }
    guard += 1;
  }
  return { phase:run.phase, round, lowestRatio, firstDownRound, members:run.snapshot().members };
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

test('대형을 거꾸로 세우면(약한 사람이 앞) 체력이 더 위험해진다', () => {
  /* 앞줄이 1.5배를 맞으므로 누구를 앞에 세우는지가 실제로 결과를 바꿔야 한다.
     시트 이후로 몬스터마다 노리는 자리가 달라졌으므로, 앞자리를 노리는
     종이비둘기(종이부리 쪼기 → 앞)로 상대를 고정해 대형만 비교한다. */
  const encounters = ['paperPigeon', 'paperPigeon', 'paperPigeon', 'paperPigeon'];
  const roster = [
    { id:'tank', name:'탱커', spec:'방어', maxHp:66, hp:66, attack:7 },
    { id:'dps', name:'딜러', spec:'화염', maxHp:52, hp:52, attack:8 },
    { id:'healer', name:'힐러', spec:'신성', maxHp:48, hp:48, attack:7, isPlayer:true },
  ];
  const good = playFloorOne(roster.map((m) => ({
    ...m, slot:m.id === 'tank' ? 'front' : m.id === 'dps' ? 'middle' : 'back',
  })), encounters);
  const bad = playFloorOne(roster.map((m) => ({
    ...m, slot:m.id === 'healer' ? 'front' : m.id === 'dps' ? 'middle' : 'back',
  })), encounters);

  /* 단일 공격 추가 배율을 없앴으므로 두 대형 모두 클리어할 수는 있다.
     그래도 앞에 선 사람이 1.5배를 맞아 약한 힐러를 앞에 세운 쪽이 더 위험해야 한다. */
  assert.equal(good.phase, 'cleared', `탱커를 앞에 세우면 깨야 한다 (${good.round}라운드에 ${good.phase})`);
  assert.ok(bad.lowestRatio < good.lowestRatio,
    `거꾸로 선 대형이 더 위험해야 한다: 올바른 ${good.lowestRatio} vs 거꾸로 ${bad.lowestRatio}`);
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
