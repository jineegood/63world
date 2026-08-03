import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync as readFileRaw } from 'node:fs';
import { dirname, join } from 'node:path';
import { Script, createContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const readFileSync = (path, options) => readFileRaw(path, options).replace(/\r\n/g, '\n');

const context = createContext({ window:{} });
new Script(readFileSync(join(root, 'src', 'raid-rules.js'), 'utf8'), { filename:'src/raid-rules.js' })
  .runInContext(context);
const rules = context.window.YuksamRaidRules;

/* 빗나감(10%)에도 치명타(15%)에도 걸리지 않는 평범한 굴림 */
const PLAIN = () => 0.5;

const party = (overrides = {}) => [
  { id:'a', slot:'front', hp:40, attack:12, ...(overrides.a || {}) },
  { id:'b', slot:'middle', hp:30, attack:11, ...(overrides.b || {}) },
  { id:'c', slot:'back', hp:24, attack:10, ...(overrides.c || {}) },
];

test('규칙 파일은 화면·소리·저장을 건드리지 않는다', () => {
  /* 서버가 이 파일을 그대로 다시 쓸 수 있어야 하므로 브라우저 전용 코드가 있으면 안 된다. */
  const source = readFileSync(join(root, 'src', 'raid-rules.js'), 'utf8');
  assert.doesNotMatch(source, /document\.|localStorage|playSfx|openModal|fetch\(/);
  assert.ok(rules, '규칙 객체가 만들어져야 한다');
});

test('앞에 설수록 많이 맞고 뒤에 설수록 덜 맞는다', () => {
  assert.equal(rules.damageMultiplier('front'), 1.5);
  assert.equal(rules.damageMultiplier('middle'), 1.0);
  assert.equal(rules.damageMultiplier('back'), 0.6);
  // 앞 > 중간 > 뒤 순서가 뒤집히면 탱커·힐러 역할이 무너진다.
  assert.ok(rules.damageMultiplier('front') > rules.damageMultiplier('middle'));
  assert.ok(rules.damageMultiplier('middle') > rules.damageMultiplier('back'));
});

test('대형은 세 명이 앞·중간·뒤에 하나씩 서야 한다', () => {
  assert.equal(rules.validateFormation(party()).ok, true);

  const twoInFront = party({ b:{ slot:'front' } });
  const duplicated = rules.validateFormation(twoInFront);
  assert.equal(duplicated.ok, false);
  assert.match(duplicated.reason, /같은 자리/);

  const tooFew = rules.validateFormation(party().slice(0, 2));
  assert.equal(tooFew.ok, false);
  assert.match(tooFew.reason, /3명/);

  const badSlot = rules.validateFormation(party({ c:{ slot:'sky' } }));
  assert.equal(badSlot.ok, false);
});

test('몬스터는 앞줄부터 노리고, 앞이 쓰러지면 다음 줄로 넘어간다', () => {
  assert.equal(rules.pickTarget(party()).id, 'a');
  assert.equal(rules.pickTarget(party({ a:{ hp:0 } })).id, 'b');
  assert.equal(rules.pickTarget(party({ a:{ hp:0 }, b:{ hp:0 } })).id, 'c');
  assert.equal(rules.pickTarget(party({ a:{ hp:0 }, b:{ hp:0 }, c:{ hp:0 } })), null);
});

test('단일 공격은 앞 한 명만, 배율이 곱해져 들어간다', () => {
  const result = rules.resolveMonsterAttack({ members:party(), attack:10, kind:'single', rng:PLAIN });
  assert.equal(result.kind, 'single');
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0].memberId, 'a');
  // 앞자리 1.5배 + 한 명만 노리는 집중 보정
  assert.equal(result.hits[0].damage, Math.round(10 * 1.5 * rules.SINGLE_TARGET_BONUS));
});

test('한 명만 노리는 공격이 전체 공격보다 한 방이 더 아프다', () => {
  const single = rules.resolveMonsterAttack({ members:party(), attack:10, kind:'single', rng:PLAIN });
  const all = rules.resolveMonsterAttack({ members:party(), attack:10, kind:'all', rng:PLAIN });
  const frontInAll = all.hits.find((h) => h.memberId === 'a');
  assert.ok(single.hits[0].damage > frontInAll.damage,
    `집중 공격이 더 아파야 한다: ${single.hits[0].damage} vs ${frontInAll.damage}`);
  assert.ok(rules.SINGLE_TARGET_BONUS > 1);
});

test('전체 공격은 입력 순서와 무관하게 앞→가운데→뒤로 살아 있는 모두가 맞는다', () => {
  const shuffled = party();
  const result = rules.resolveMonsterAttack({ members:[shuffled[2], shuffled[0], shuffled[1]], attack:10, kind:'all', rng:PLAIN });
  assert.equal(result.kind, 'all');
  assert.equal(result.hits.length, 3);
  assert.deepEqual(Array.from(result.hits, (hit) => hit.memberId), ['a', 'b', 'c']);
  const byId = Object.fromEntries(result.hits.map((h) => [h.memberId, h.damage]));
  assert.equal(byId.a, 15); // 앞줄 10 * 1.5
  assert.equal(byId.b, 10); // 중간 10 * 1.0
  assert.equal(byId.c, 6);  // 뒷줄 10 * 0.6
  // 앞줄이 뒷줄보다 확실히 더 아파야 한다.
  assert.ok(byId.a > byId.b && byId.b > byId.c);
});

test('쓰러진 사람은 전체 공격에도 맞지 않는다', () => {
  const result = rules.resolveMonsterAttack({ members:party({ a:{ hp:0 } }), attack:10, kind:'all', rng:PLAIN });
  assert.equal(result.hits.length, 2);
  assert.ok(!result.hits.some((h) => h.memberId === 'a'));
});

test('뒷줄이라도 피해가 0이 되지는 않는다', () => {
  const result = rules.resolveMonsterAttack({ members:party({ a:{ hp:0 }, b:{ hp:0 } }), attack:1, kind:'single', rng:PLAIN });
  assert.equal(result.hits[0].memberId, 'c');
  assert.ok(result.hits[0].damage >= 1, '최소 1은 들어가야 한다');
});

test('남은 체력보다 큰 피해는 남은 체력까지만 기록된다', () => {
  const result = rules.resolveMonsterAttack({ members:party({ a:{ hp:5 } }), attack:100, kind:'single', rng:PLAIN });
  assert.equal(result.hits[0].damage, 5);
  assert.equal(result.hits[0].lethal, true);
});

test('맞힌 사람은 제 몫을, 틀린 사람은 절반을 넣는다', () => {
  const result = rules.resolvePartyAttack({
    members:party(),
    answers:{ a:true, b:false, c:true }, rng:PLAIN,
  });
  const byId = Object.fromEntries(result.hits.map((h) => [h.memberId, h.damage]));
  // 레이드에서는 PARTY_POWER 만큼 세게 때린다.
  const power = (attack) => Math.max(1, Math.floor(attack * rules.PARTY_POWER));
  assert.equal(byId.a, power(12));                       // 정답 그대로
  assert.equal(byId.b, Math.floor(power(11) / 2));       // 오답이라 절반
  assert.equal(byId.c, power(10));
  assert.equal(result.total, byId.a + byId.b + byId.c);
  assert.equal(rules.PARTY_POWER, 1, '던전 피해는 일반 전투와 똑같아야 한다');
});

test('쓰러진 사람은 공격에 참여하지 않는다', () => {
  const result = rules.resolvePartyAttack({
    members:party({ b:{ hp:0 } }),
    answers:{ a:true, b:true, c:true }, rng:PLAIN,
  });
  assert.equal(result.hits.length, 2);
  assert.ok(!result.hits.some((h) => h.memberId === 'b'));
});

test('빗나가면 피해가 없고, 치명타면 더 아프다 (파티 쪽)', () => {
  const ALWAYS_MISS = () => 0;                 // 0 < 0.10 → 빗나감
  const ALWAYS_CRIT = (() => { let n = 0; return () => (n++ % 2 === 0 ? 0.5 : 0); })(); // 빗나감X, 치명타O

  const missed = rules.resolvePartyAttack({ members:party(), answers:{ a:true }, rng:ALWAYS_MISS });
  assert.ok(missed.hits.every((h) => h.missed === true));
  assert.equal(missed.total, 0, '빗나가면 피해가 없어야 한다');

  const crit = rules.resolvePartyAttack({ members:party(), answers:{ a:true, b:true, c:true }, rng:ALWAYS_CRIT });
  assert.ok(crit.hits.every((h) => h.critical === true));
  const plain = rules.resolvePartyAttack({ members:party(), answers:{ a:true, b:true, c:true }, rng:PLAIN });
  assert.ok(crit.total > plain.total, `치명타가 더 아파야 한다: ${crit.total} vs ${plain.total}`);
});

test('빗나가면 피해가 없고, 치명타면 더 아프다 (몬스터 쪽)', () => {
  const ALWAYS_MISS = () => 0;
  const ALWAYS_CRIT = (() => { let n = 0; return () => (n++ % 2 === 0 ? 0.5 : 0); })();

  const missed = rules.resolveMonsterAttack({ members:party(), attack:10, kind:'single', rng:ALWAYS_MISS });
  assert.equal(missed.hits[0].missed, true);
  assert.equal(missed.hits[0].damage, 0);

  const crit = rules.resolveMonsterAttack({ members:party(), attack:10, kind:'single', rng:ALWAYS_CRIT });
  assert.equal(crit.hits[0].critical, true);
  assert.ok(crit.hits[0].damage > 15, `치명타는 평소(15)보다 커야 한다: ${crit.hits[0].damage}`);
});

test('치명타·빗나감 확률은 일반 전투와 비슷한 범위다', () => {
  assert.ok(rules.MISS_CHANCE > 0 && rules.MISS_CHANCE <= 0.2, `빗나감 ${rules.MISS_CHANCE}`);
  assert.ok(rules.CRIT_CHANCE > 0 && rules.CRIT_CHANCE <= 0.3, `치명타 ${rules.CRIT_CHANCE}`);
  assert.ok(rules.CRIT_MULTIPLIER > 1, '치명타는 평타보다 세야 한다');
});

test('신성 전문화만 힐러로 인정된다', () => {
  assert.equal(rules.isHealer({ spec:'신성' }), true);
  assert.equal(rules.isHealer({ spec:'방어' }), false);
  assert.equal(rules.isHealer({ spec:'' }), false);
  assert.equal(rules.isHealer(null), false);
});

test('문제를 맞힌 힐러가 가장 많이 다친 동료를 회복시킨다', () => {
  const members = [
    { id:'tank', slot:'front', hp:10, maxHp:300, attack:12, spec:'방어' },
    { id:'mid', slot:'middle', hp:290, maxHp:300, attack:11, spec:'화염' },
    { id:'healer', slot:'back', hp:40, maxHp:40, attack:10, spec:'신성' },
  ];
  const { heals } = rules.resolvePartyHeal({ members, answers:{ healer:true } });
  assert.equal(heals.length, 1);
  assert.equal(heals[0].memberId, 'tank', '비율상 가장 다친 사람을 골라야 한다');
  assert.equal(heals[0].amount, Math.round(10 * rules.HEAL_RATIO));
});

test('힐러가 문제를 틀리거나 쓰러지면 회복이 없다', () => {
  const members = [
    { id:'tank', slot:'front', hp:10, maxHp:60, attack:12, spec:'방어' },
    { id:'healer', slot:'back', hp:40, maxHp:40, attack:10, spec:'신성' },
  ];
  assert.equal(rules.resolvePartyHeal({ members, answers:{ healer:false } }).heals.length, 0);
  const downed = members.map((m) => (m.id === 'healer' ? { ...m, hp:0 } : m));
  assert.equal(rules.resolvePartyHeal({ members:downed, answers:{ healer:true } }).heals.length, 0);
});

test('회복은 최대 체력을 넘지 않고, 멀쩡하면 회복하지 않는다', () => {
  const nearFull = [
    { id:'tank', slot:'front', hp:58, maxHp:60, attack:12, spec:'방어' },
    { id:'healer', slot:'back', hp:40, maxHp:40, attack:10, spec:'신성' },
  ];
  assert.equal(rules.resolvePartyHeal({ members:nearFull, answers:{ healer:true } }).heals[0].amount, 2);

  const allFull = [
    { id:'tank', slot:'front', hp:60, maxHp:60, attack:12, spec:'방어' },
    { id:'healer', slot:'back', hp:40, maxHp:40, attack:10, spec:'신성' },
  ];
  assert.equal(rules.resolvePartyHeal({ members:allFull, answers:{ healer:true } }).heals.length, 0);
});

test('다음 전투 전에는 쓰러진 사람만 HP 1로 부활하고 생존자는 회복하지 않는다', () => {
  const members = [
    { id:'a', hp:20, maxHp:60 },
    { id:'b', hp:60, maxHp:60 },
    { id:'c', hp:0, maxHp:60 },
  ];
  const recovery = rules.travelRecovery(members);
  assert.equal(recovery.length, 1);
  assert.equal(recovery[0].memberId, 'c');
  assert.equal(recovery[0].amount, 1);
  assert.equal(recovery[0].revived, true);
  assert.equal(rules.TRAVEL_RECOVERY, 0);
  assert.equal(rules.NEXT_ENCOUNTER_REVIVE_HP, 1);
});

test('1층은 일반 전투 3회 뒤에 레이드 보스가 나온다', () => {
  const encounters = rules.floorEncounters(1);
  assert.equal(encounters.length, 4);
  assert.equal(encounters.filter((e) => e.isBoss).length, 1);
  assert.equal(encounters[3].isBoss, true);
  // 시트의 출현 규칙: Lv.5 두 마리 → Lv.6 한 마리 → Lv.7 한 마리(보스 자리)
  assert.deepEqual([...encounters.map((e) => e.level)], [5, 5, 6, 7]);
  assert.deepEqual([...encounters.slice(0, 2).map((e) => e.name)], ['버섯돌이킹', '종이비둘기']);
  // 앞의 셋은 보스가 아니어야 한다.
  assert.ok(encounters.slice(0, 3).every((e) => !e.isBoss));
});

test('1층은 Lv.5 셋이 도전하는 난이도로 잡혀 있다', () => {
  const floor = rules.getFloor(1);
  assert.equal(floor.recommendedLevel, 5);
  const encounters = rules.floorEncounters(1);
  // 보스 자리는 그 층에서 가장 레벨이 높은 몬스터다.
  const boss = encounters[3];
  assert.ok(encounters.every((m) => m.level <= boss.level), '보스가 가장 높은 레벨이어야 한다');
  // Lv.5 사냥터 몬스터(스톰프 HP 28~31)보다 훨씬 단단해야 셋이 싸울 맛이 난다.
  assert.ok(encounters.every((m) => m.hp >= 80), '3명이 함께 때릴 만큼은 단단해야 한다');
  assert.ok(encounters.every((m) => m.attack > 0));
});

test('시트의 일곱 구간이 모두 있고 그 밖의 층은 없는 것으로 나온다', () => {
  // 규칙 파일은 별도 vm 컨텍스트에서 돌아가 배열 프로토타입이 다르다. 네이티브 배열로 옮겨 비교한다.
  assert.deepEqual([...rules.availableFloors()], [1, 11, 21, 31, 41, 51, 61]);
  assert.equal(rules.getFloor(2), null);
  assert.equal([...rules.floorEncounters(2)].length, 0);
});

test('몬스터 17마리가 시트 그대로 들어 있고 레벨별 출현표와 맞는다', () => {
  const ids = Object.keys(rules.MONSTERS);
  assert.equal(ids.length, 17, '시트의 몬스터는 17마리다');
  // 출현표에 적힌 id는 모두 실제 몬스터여야 한다.
  const rostered = Object.values(rules.LEVEL_ROSTER).flatMap((list) => [...list]);
  assert.equal(rostered.length, 17);
  assert.ok(rostered.every((id) => rules.MONSTERS[id]), '출현표의 id가 모두 있어야 한다');
  // 레벨 칸과 몬스터의 레벨이 어긋나면 안 된다.
  Object.entries(rules.LEVEL_ROSTER).forEach(([level, list]) => {
    [...list].forEach((id) => assert.equal(rules.MONSTERS[id].level, Number(level)));
  });
  // 체력·공격력·패턴이 빠진 몬스터가 없어야 한다.
  ids.forEach((id) => {
    const monster = rules.MONSTERS[id];
    assert.ok(monster.hp > 0 && monster.attack > 0, `${id} 수치 누락`);
    assert.ok(Array.isArray(monster.pattern) && monster.pattern.length > 0, `${id} 패턴 누락`);
    monster.pattern.forEach((entry) => assert.ok(entry && entry.name, `${id} 기술 이름 누락`));
  });
});

test('구간마다 시트가 정한 횟수만큼 싸우고 마지막이 그 구간의 보스다', () => {
  rules.availableFloors().forEach((floor) => {
    const encounters = rules.floorEncounters(floor);
    /* 대부분 네 번이지만 61~63층은 세 개 층뿐이라 세 번이다(시트 그대로). */
    const planned = [...rules.getFloor(floor).plan]
      .reduce((sum, step) => sum + (step.mode === 'both' ? 2 : 1), 0);
    assert.equal(encounters.length, planned, `${floor}층 조우 수`);
    assert.equal(encounters[encounters.length - 1].isBoss, true);
    assert.ok(encounters.slice(0, -1).every((e) => !e.isBoss));
    // 레벨이 내려가지 않고 올라가기만 해야 학생이 점점 어려워진다고 느낀다.
    encounters.slice(1).forEach((entry, index) => {
      assert.ok(entry.level >= encounters[index].level, `${floor}층 레벨 역전`);
    });
  });
});

test('두 마리 중 하나를 뽑는 자리는 무작위 값에 따라 갈린다', () => {
  // rollEncounters는 밖에서 준 난수만 쓴다 — 서버가 같은 목록을 다시 만들 수 있어야 한다.
  const low = rules.rollEncounters(1, () => 0);
  const high = rules.rollEncounters(1, () => 0.99);
  assert.deepEqual([...low].slice(0, 2), ['mushroomKing', 'paperPigeon']);
  assert.notDeepEqual([...low], [...high], '뽑기 자리가 난수에 따라 달라져야 한다');
  // 뽑아 둔 목록을 그대로 넘기면 그 순서대로 나온다(방 전원이 같은 몬스터를 본다).
  const fixed = rules.floorEncounters(1, ['guardBot', 'officeGhost']);
  assert.deepEqual(fixed.map((m) => m.id), ['guardBot', 'officeGhost']);
  assert.equal(fixed[1].isBoss, true);
});

test('기술 순서는 무작위지만 씨앗이 같으면 언제나 같은 순서다', () => {
  /* 방에 있는 셋과 서버가 각자 계산해도 같은 순서를 봐야 한다.
     그래서 난수를 그때그때 굴리지 않고 씨앗에서 다시 만들어 낸다. */
  const monster = { id:'m', index:0, pattern:[
    { name:'A', kind:'single' }, { name:'B', kind:'all' }, { name:'C', kind:'none' },
  ] };
  const orderFor = (seed) => Array.from({ length:9 }, (_, round) =>
    rules.attackPlanForRound(monster, round, seed).name).join('');

  assert.equal(orderFor('room-1'), orderFor('room-1'), '같은 씨앗이면 같은 순서');
  const seeds = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map(orderFor));
  assert.ok(seeds.size > 1, '씨앗이 다르면 순서도 달라져야 한다');
});

test('한 바퀴 안에서는 모든 기술이 한 번씩 나온다', () => {
  /* 한 기술만 계속 나오거나 회복·보호막이 아예 안 나오면 안 된다.
     기술 수만큼이 한 바퀴이고, 그 안에서 전부 한 번씩 쓴다. */
  const monster = { id:'m', index:0, pattern:[
    { name:'A', kind:'single' }, { name:'B', kind:'all' },
    { name:'C', kind:'none' }, { name:'D', kind:'single' },
  ] };
  for (const seed of ['room-1', 'room-2', 'room-3', 'room-4']) {
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const names = Array.from({ length:4 }, (_, step) =>
        rules.attackPlanForRound(monster, cycle * 4 + step, seed).name);
      assert.deepEqual([...names].sort(), ['A', 'B', 'C', 'D'], `${seed} ${cycle}바퀴`);
    }
  }
});

test('같은 몬스터라도 조우 자리와 바퀴가 다르면 순서가 다시 섞인다', () => {
  const first = { id:'m', index:0, pattern:[
    { name:'A', kind:'single' }, { name:'B', kind:'all' }, { name:'C', kind:'none' },
  ] };
  const second = { ...first, index:1 };
  const order = (monster, from) => Array.from({ length:3 }, (_, step) =>
    rules.attackPlanForRound(monster, from + step, 'room-1').name).join('');
  // 같은 방·같은 몬스터여도 조우 자리가 다르면 다른 순서가 나올 수 있다.
  const variants = new Set([order(first, 0), order(first, 3), order(second, 0)]);
  assert.ok(variants.size > 1, '자리·바퀴마다 다시 섞여야 한다');
});

test('기술이 하나뿐이면 그 기술만 나오고, 패턴이 없으면 기본 단일 공격이다', () => {
  const only = { id:'m', index:0, pattern:[{ name:'하나', kind:'all' }] };
  for (let round = 0; round < 5; round += 1) {
    assert.equal(rules.attackPlanForRound(only, round, 'seed').name, '하나');
  }
  assert.equal(rules.attackKindForRound({}, 0), 'single');
});

test('시트의 공격력에 60%가 이미 들어 있어 계산에서 다시 곱하지 않는다', () => {
  /* 예전에는 시트의 낮은 공격력에 여기서 1.6을 곱했다. 최종본의 「기본 공격력」은
     그 60% 상향이 이미 반영된 값이라 다시 곱하면 피해가 두 배가 된다. */
  assert.equal(rules.MONSTER_DAMAGE_MULTIPLIER, 1);

  // 시트 「예상 피해」와 실제 계산이 맞는지 대표로 몇 마리만 확인한다.
  const expected = {
    mushroomKing:{ single:[31, 21, 12], all:[20, 13, 8] },
    towerWarden:{ single:[70, 46, 28], all:[44, 29, 17] },
    rooftopMyeongjinRobot:{ single:[115, 77, 46], all:[72, 48, 29] },
  };
  Object.entries(expected).forEach(([id, want]) => {
    const attack = rules.MONSTERS[id].attack;
    ['front', 'middle', 'back'].forEach((slot, index) => {
      const single = Math.round(attack * rules.damageMultiplier(slot) * rules.SINGLE_TARGET_BONUS * rules.MONSTER_DAMAGE_MULTIPLIER);
      const all = Math.round(attack * rules.damageMultiplier(slot) * rules.MONSTER_DAMAGE_MULTIPLIER);
      assert.equal(single, want.single[index], `${id} 단일 ${slot}`);
      assert.equal(all, want.all[index], `${id} 전체 ${slot}`);
    });
  });
});

test('패턴 한 칸은 기술 이름·타수·노리는 자리·부가 효과까지 그대로 읽힌다', () => {
  /* 순서는 무작위이므로 '몇 번째 턴'이 아니라 기술 이름으로 찾아 확인한다. */
  const plan = (id, name) => rules.planByName(rules.MONSTERS[id], name);

  const stomp = plan('buildingStomp', '대지 찍기');
  assert.equal(stomp.kind, 'all');
  assert.equal(stomp.stun, true);

  const charge = plan('buildingStomp', '콘크리트 돌진');
  assert.equal(charge.kind, 'single');
  assert.equal(charge.hits, 2);
  assert.equal(charge.target, 'middle');

  // 명진쌤 로봇은 시트대로 4연속까지 때린다.
  const laser = plan('rooftopMyeongjinRobot', '레이저 지시봉');
  assert.equal(laser.hits, 4);
  assert.equal(laser.poison, 5);

  // 공격하지 않는 턴도 그대로 남는다.
  const guardUp = plan('engineIronGiant', '철갑 방벽');
  assert.equal(guardUp.kind, 'none');
  assert.equal(guardUp.shieldPct, 0.5);

  // chargeNext가 가리키는 기술은 같은 몬스터의 패턴 안에 반드시 있어야 한다.
  Object.values(rules.MONSTERS).forEach((monster) => {
    monster.pattern.forEach((entry) => {
      if (!entry.chargeNext) return;
      assert.ok(rules.planByName(monster, entry.chargeNext), `${monster.id}의 예고 대상 없음`);
    });
  });
});

test('보스급 몬스터는 전체 공격과 단일 공격을 섞어 쓴다', () => {
  ['towerWarden', 'nonexistentFloorLord', 'rooftopMyeongjinRobot'].forEach((id) => {
    const kinds = new Set(rules.MONSTERS[id].pattern.map((entry) => entry.kind));
    assert.ok(kinds.has('all'), `${id}에 전체 공격이 있어야 한다`);
    assert.ok(kinds.has('single'), `${id}에 단일 공격이 있어야 한다`);
  });
});

test('동료 정답 판정은 밖에서 준 무작위 값만 쓴다', () => {
  // 서버가 같은 값으로 같은 결과를 다시 만들 수 있어야 한다.
  assert.equal(rules.allyAnswersCorrectly(() => 0), true);
  assert.equal(rules.allyAnswersCorrectly(() => 0.99), false);
  assert.equal(rules.allyAnswersCorrectly(() => rules.ALLY_CORRECT_RATE - 0.01), true);
  assert.equal(rules.allyAnswersCorrectly(() => rules.ALLY_CORRECT_RATE), false);
});

test('전멸과 몬스터 처치를 올바르게 알아본다', () => {
  assert.equal(rules.isPartyWiped(party()), false);
  assert.equal(rules.isPartyWiped(party({ a:{ hp:0 }, b:{ hp:0 } })), false);
  assert.equal(rules.isPartyWiped(party({ a:{ hp:0 }, b:{ hp:0 }, c:{ hp:0 } })), true);
  assert.equal(rules.isMonsterDown({ hp:0 }), true);
  assert.equal(rules.isMonsterDown({ hp:1 }), false);
});
