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

test('전체 공격은 살아 있는 모두가 각자 배율로 맞는다', () => {
  const result = rules.resolveMonsterAttack({ members:party(), attack:10, kind:'all', rng:PLAIN });
  assert.equal(result.kind, 'all');
  assert.equal(result.hits.length, 3);
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
  assert.ok(rules.PARTY_POWER > 1, '레이드에서는 평소보다 세게 때린다');
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
    { id:'tank', slot:'front', hp:10, maxHp:60, attack:12, spec:'방어' },
    { id:'mid', slot:'middle', hp:50, maxHp:60, attack:11, spec:'화염' },
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

test('전투 사이 이동에서 최대 체력의 일부를 회복한다', () => {
  const members = [
    { id:'a', hp:20, maxHp:60 },
    { id:'b', hp:60, maxHp:60 },   // 멀쩡한 사람은 빠진다
    { id:'c', hp:0, maxHp:60 },    // 쓰러진 사람은 못 일어난다
  ];
  const recovery = rules.travelRecovery(members);
  assert.equal(recovery.length, 1);
  assert.equal(recovery[0].memberId, 'a');
  assert.equal(recovery[0].amount, Math.round(60 * rules.TRAVEL_RECOVERY));
});

test('1층은 일반 전투 3회 뒤에 레이드 보스가 나온다', () => {
  const encounters = rules.floorEncounters(1);
  assert.equal(encounters.length, 4);
  assert.equal(encounters.filter((e) => e.isBoss).length, 1);
  assert.equal(encounters[3].isBoss, true);
  assert.equal(encounters[3].name, '63빌딩 관리자');
  // 앞의 셋은 보스가 아니어야 한다.
  assert.ok(encounters.slice(0, 3).every((e) => !e.isBoss));
});

test('1층은 Lv.5 셋이 도전하는 난이도로 잡혀 있다', () => {
  const floor = rules.getFloor(1);
  assert.equal(floor.recommendedLevel, 5);
  const encounters = rules.floorEncounters(1);
  // 보스는 일반 몬스터보다 확실히 단단해야 한다.
  const boss = encounters[3];
  const normals = encounters.slice(0, 3);
  assert.ok(normals.every((m) => boss.hp > m.hp), '보스가 가장 단단해야 한다');
  assert.ok(normals.every((m) => boss.attack >= m.attack), '보스가 가장 아파야 한다');
  // Lv.5 사냥터 몬스터(스톰프 HP 28~31)보다 훨씬 단단해야 셋이 싸울 맛이 난다.
  assert.ok(normals.every((m) => m.hp >= 80), '3명이 함께 때릴 만큼은 단단해야 한다');
});

test('아직 열지 않은 층은 없는 것으로 나온다', () => {
  // 규칙 파일은 별도 vm 컨텍스트에서 돌아가 배열 프로토타입이 다르다. 네이티브 배열로 옮겨 비교한다.
  assert.deepEqual([...rules.availableFloors()], [1]);
  assert.equal(rules.getFloor(2), null);
  assert.equal([...rules.floorEncounters(2)].length, 0);
});

test('몬스터 공격 패턴은 정해진 순서를 반복한다', () => {
  const monster = { pattern:['single', 'single', 'all'] };
  assert.equal(rules.attackKindForRound(monster, 0), 'single');
  assert.equal(rules.attackKindForRound(monster, 1), 'single');
  assert.equal(rules.attackKindForRound(monster, 2), 'all');
  // 한 바퀴 돌면 처음으로 돌아온다 — 학생이 외워서 대비할 수 있어야 한다.
  assert.equal(rules.attackKindForRound(monster, 3), 'single');
  assert.equal(rules.attackKindForRound({}, 0), 'single');
});

test('보스는 전체 공격을 섞어 쓴다', () => {
  const boss = rules.MONSTERS.towerWarden;
  assert.ok(boss.pattern.includes('all'), '보스에게 전체 공격이 있어야 한다');
  assert.ok(boss.pattern.includes('single'));
  assert.equal(boss.boss, true);
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
