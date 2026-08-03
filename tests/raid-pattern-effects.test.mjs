/* 시트(63빌딩_기존몬스터_출현규칙_최종본.xlsx)의 「패턴 N」 한 칸에 적힌
   부가 효과가 실제 전투 결과에 그대로 나타나는지 확인한다.
   독·기절·냉기·흡혈·보호막·회복·강화·실명·반격·예고·연속타·노리는 자리. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync as readFileRaw } from 'node:fs';
import { dirname, join } from 'node:path';
import { Script, createContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const read = (file) => readFileRaw(join(root, file), 'utf8').replace(/\r\n/g, '\n');

function loadApi() {
  let uid = 0;
  const window = {
    YuksamCore:{ uid:() => `test-${++uid}` },
    YuksamAudioManifest:{ classBasicSounds:{ warrior:'warriorBasic' }, skillSounds:{}, assets:{} },
  };
  const context = createContext({ window, globalThis:window });
  new Script(read('src/game-data.js'), { filename:'src/game-data.js' }).runInContext(context);
  Object.assign(window.YuksamData.SKILL_DEFS, window.YuksamData.V24_SKILLS);
  for (const file of ['src/raid-combat-rules.js', 'src/raid-rules.js']) {
    new Script(read(file), { filename:file }).runInContext(context);
  }
  return window;
}

const api = loadApi();
const combat = api.YuksamRaidCombatRules;
const raid = api.YuksamRaidRules;

const member = (id, extra = {}) => combat.normalizeMember({
  id, name:id, klass:'warrior', spec:'무기', slot:'front',
  maxHp:400, hp:400, attack:1, skills:{}, ...extra,
});

const monster = (extra = {}) => combat.normalizeMonster({
  id:'monster', name:'연습 몬스터', maxHp:2000, hp:2000, attack:10, ...extra,
});

/* 굴림을 0.5로 고정하면 빗나감(10% 미만)·치명타(15% 미만)에 걸리지 않는다. */
const constant = (value = 0.5) => () => value;

function turn({ members, target = monster(), plan, submissions, rng = constant() }) {
  return combat.resolveRound({
    members, monster:target, submissions, plan,
    monsterAttack:target.attack, rng, raidRules:raid,
  });
}

/* 공격력 1짜리 파티원 한 명 — 몬스터를 거의 못 깎으므로 몬스터 턴만 깨끗하게 본다.
   오답이어도 최소 1은 들어가므로, 몬스터 체력을 따질 때는 이 몫을 빼고 본다. */
const dummy = (extra = {}) => member('dummy', extra);
const idle = { dummy:{ correct:false, actionId:'basic' } };
const wait = { name:'대기', kind:'none' };
const partyDamage = (result) => result.events
  .filter((event) => event.kind === 'party-hit' && !event.missed)
  .reduce((sum, event) => sum + (Number(event.hpDamage) || 0), 0);

test('노리는 자리가 정해진 기술은 그 자리 사람만 때린다', () => {
  const party = [
    member('front', { slot:'front' }),
    member('middle', { slot:'middle' }),
    member('back', { slot:'back' }),
  ];
  const result = turn({
    members:party,
    plan:{ name:'뒤 노리기', kind:'single', target:'back' },
    submissions:Object.fromEntries(party.map((m) => [m.id, { correct:false, actionId:'basic' }])),
  });
  const hits = result.events.filter((event) => event.kind === 'monster-hit');
  assert.ok(hits.length > 0);
  assert.ok(hits.every((hit) => hit.memberId === 'back'), '뒷자리만 맞아야 한다');
});

test('연속 타수는 시트에 적힌 만큼 실제로 나온다', () => {
  const result = turn({
    members:[dummy()],
    plan:{ name:'4연속', kind:'all', hits:4 },
    submissions:idle,
  });
  assert.equal(result.events.find((event) => event.kind === 'monster-windup').hitCount, 4);
  assert.equal(result.events.filter((event) => event.kind === 'monster-hit').length, 4);
});

test('전체 연속 공격은 한 사람을 연달아 때린 뒤 다음 사람으로 넘어간다', () => {
  /* 앞·앞·가운데·가운데·뒤·뒤 순서여야 누가 몇 대 맞았는지 읽힌다.
     앞·가운데·뒤를 한 바퀴씩 도는 순서가 아니다. */
  const party = [
    member('front', { slot:'front' }),
    member('middle', { slot:'middle' }),
    member('back', { slot:'back' }),
  ];
  const result = turn({
    members:party,
    plan:{ name:'2연속 전체', kind:'all', hits:2 },
    submissions:Object.fromEntries(party.map((m) => [m.id, { correct:false, actionId:'basic' }])),
  });
  const hits = result.events.filter((event) => event.kind === 'monster-hit');
  assert.deepEqual([...hits.map((event) => event.memberId)],
    ['front', 'front', 'middle', 'middle', 'back', 'back']);

  // 타수 번호도 사람마다 0,1로 다시 센다.
  assert.deepEqual([...hits.map((event) => event.hitIndex)], [0, 1, 0, 1, 0, 1]);
});

test('독은 다음 몬스터 턴마다 피해를 주고 정해진 턴 뒤에 사라진다', () => {
  const target = dummy();
  const boss = monster();
  turn({ members:[target], target:boss, plan:{ name:'포자', kind:'all', poison:5 }, submissions:idle });
  assert.equal(target.statuses.poisonDamage, 5);
  assert.equal(target.statuses.poisonTurns, 2);

  const before = target.hp;
  const second = turn({ members:[target], target:boss, plan:wait, submissions:idle });
  const dot = second.events.find((event) => event.kind === 'member-dot' && event.status === 'poison');
  assert.ok(dot, '독 피해 로그가 있어야 한다');
  assert.equal(dot.hpDamage, 5);
  assert.equal(target.hp, before - 5);
  assert.equal(target.statuses.poisonTurns, 1);

  turn({ members:[target], target:boss, plan:wait, submissions:idle });
  assert.equal(target.statuses.poisonTurns, 0);
  assert.equal(target.statuses.poisonDamage, 0, '다 닳으면 독이 완전히 사라진다');
});

test('기절한 파티원은 다음 턴에 행동하지 못한다', () => {
  const target = dummy();
  turn({ members:[target], plan:{ name:'강타', kind:'single', stun:true }, submissions:idle });
  assert.equal(target.statuses.stunTurns, 1);

  const next = turn({
    members:[target], plan:wait,
    submissions:{ dummy:{ correct:true, actionId:'basic' } },
  });
  assert.ok(next.events.some((event) => event.kind === 'party-skip' && event.status === 'stun'));
  assert.equal(target.statuses.stunTurns, 0, '한 턴 쉬면 풀린다');
});

test('냉기를 맞으면 다음 공격 피해가 절반이 된다', () => {
  const chilled = dummy({ attack:100 });
  turn({ members:[chilled], plan:{ name:'한파', kind:'all', chill:true }, submissions:idle });
  assert.equal(chilled.statuses.chillTurns, 1);

  const chilledBoss = monster();
  const chilledBefore = chilledBoss.hp;
  turn({
    members:[chilled], target:chilledBoss, plan:wait,
    submissions:{ dummy:{ correct:true, actionId:'basic' } },
  });
  const chilledDamage = chilledBefore - chilledBoss.hp;
  assert.equal(chilled.statuses.chillTurns, 0, '한 번 때리면 냉기가 소비된다');

  // 같은 조건에서 냉기 없이 때리면 더 아프다.
  const normalBoss = monster();
  const normalBefore = normalBoss.hp;
  turn({
    members:[dummy({ attack:100 })], target:normalBoss, plan:wait,
    submissions:{ dummy:{ correct:true, actionId:'basic' } },
  });
  assert.ok(normalBefore - normalBoss.hp > chilledDamage, '냉기가 걸린 쪽이 덜 아파야 한다');
});

test('흡혈 기술은 준 피해만큼 몬스터를 회복시킨다', () => {
  const boss = monster({ hp:500, maxHp:2000, attack:20 });
  const result = turn({
    members:[dummy()], target:boss,
    plan:{ name:'흡수', kind:'single', drain:true }, submissions:idle,
  });
  const hit = result.events.find((event) => event.kind === 'monster-hit' && !event.missed);
  const heal = result.events.find((event) => event.kind === 'monster-heal' && event.status === 'drain');
  assert.ok(hit && heal, '피격과 흡혈 로그가 함께 있어야 한다');
  assert.equal(heal.amount, hit.totalDamage);
  assert.equal(boss.hp, 500 - partyDamage(result) + heal.amount);
});

test('보호막·회복 기술은 몬스터를 더 단단하게 만든다', () => {
  const boss = monster({ hp:600, maxHp:1000, attack:10 });
  const shielded = turn({
    members:[dummy()], target:boss,
    plan:{ name:'방벽', kind:'none', shieldPct:0.5 }, submissions:idle,
  });
  assert.equal(boss.shield, 500);
  assert.ok(shielded.events.some((event) => event.kind === 'monster-shield'));

  const hpBeforeHeal = boss.hp;
  const healed = turn({
    members:[dummy()], target:boss,
    plan:{ name:'보수', kind:'none', healPct:0.3 }, submissions:idle,
  });
  // 최대 체력 1000의 30% → 300 회복 (파티가 넣은 몫은 따로 뺀다)
  assert.equal(boss.hp, hpBeforeHeal - partyDamage(healed) + 300);
  assert.ok(healed.events.some((event) => event.kind === 'monster-heal'));
});

test('강화 턴 동안 몬스터의 공격이 실제로 더 아프다', () => {
  const plain = dummy();
  const plainBefore = plain.hp;
  turn({ members:[plain], plan:{ name:'일반', kind:'single' }, submissions:idle });
  const plainDamage = plainBefore - plain.hp;
  assert.ok(plainDamage > 0);

  const buffed = dummy();
  const boss = monster();
  turn({ members:[buffed], target:boss, plan:{ name:'강화', kind:'none', empower:3 }, submissions:idle });
  assert.equal(buffed.hp, buffed.maxHp, '강화 턴에는 때리지 않는다');

  const buffedBefore = buffed.hp;
  turn({ members:[buffed], target:boss, plan:{ name:'일반', kind:'single' }, submissions:idle });
  assert.ok(buffedBefore - buffed.hp > plainDamage, '강화 중에는 더 아파야 한다');
});

test('실명에 걸리면 다음 공격이 정해진 횟수만큼 빗나간다', () => {
  const target = dummy({ attack:100 });
  turn({ members:[target], plan:{ name:'암전', kind:'none', blind:2 }, submissions:idle });
  assert.equal(target.statuses.blindHits, 2);

  const boss = monster();
  const before = boss.hp;
  const blinded = turn({
    members:[target], target:boss, plan:wait,
    submissions:{ dummy:{ correct:true, actionId:'basic' } },
  });
  assert.ok(blinded.events.some((event) => event.kind === 'party-hit' && event.blinded === true));
  assert.equal(boss.hp, before, '실명 중에는 피해가 들어가지 않는다');
  assert.equal(target.statuses.blindHits, 1, '한 번 쓰면 한 칸 닳는다');
});

test('반격 자세인 몬스터를 때리면 되받아친다', () => {
  const attacker = dummy({ attack:100 });
  const boss = monster({ attack:20 });
  turn({
    members:[attacker], target:boss,
    plan:{ name:'반격 자세', kind:'none', counter:'single' }, submissions:idle,
  });
  assert.equal(boss.counterMode, 'single');

  const before = attacker.hp;
  const countered = turn({
    members:[attacker], target:boss, plan:wait,
    submissions:{ dummy:{ correct:true, actionId:'basic' } },
  });
  assert.ok(countered.events.some((event) => event.kind === 'monster-counter'), '반격 로그가 있어야 한다');
  assert.ok(attacker.hp < before);
  assert.equal(boss.counterMode, null, '반격 자세는 몬스터의 다음 턴에 풀린다');
});

test('예고한 기술은 다음 턴에 반드시 두 배 피해로 나온다', () => {
  const pattern = [
    { name:'경고', kind:'none', chargeNext:'대재앙' },
    { name:'대재앙', kind:'all' },
  ];
  const target = dummy();
  const boss = monster({ attack:20, pattern });

  const warned = turn({ members:[target], target:boss, plan:pattern[0], submissions:idle });
  assert.equal(boss.chargedPlanName, '대재앙');
  assert.ok(warned.events.some((event) => event.kind === 'monster-charge'));

  /* 예고가 걸려 있으면 이번 턴의 원래 기술 대신 예고한 기술이 나온다. */
  const before = target.hp;
  const released = turn({ members:[target], target:boss, plan:pattern[0], submissions:idle });
  assert.ok(released.events.some((event) => event.kind === 'monster-charge-release'));
  const chargedDamage = before - target.hp;
  assert.equal(boss.chargedPlanName, null, '한 번 쓰면 예고가 풀린다');

  // 같은 기술을 예고 없이 맞으면 훨씬 덜 아프다.
  const plain = dummy();
  const plainBefore = plain.hp;
  turn({ members:[plain], target:monster({ attack:20 }), plan:pattern[1], submissions:idle });
  assert.ok(chargedDamage > (plainBefore - plain.hp), '예고한 쪽이 더 아파야 한다');
});

test('공격하지 않는 턴에는 아무도 맞지 않는다', () => {
  const target = dummy();
  const result = turn({ members:[target], plan:{ name:'숨 고르기', kind:'none' }, submissions:idle });
  assert.equal(result.events.filter((event) => event.kind === 'monster-hit').length, 0);
  assert.equal(target.hp, target.maxHp);
});

test('시트의 17마리가 쓰는 효과는 모두 계산에서 처리된다', () => {
  /* 패턴에 적힌 항목 중 계산이 모르는 이름이 있으면 조용히 무시되므로,
     여기서 실제로 쓰이는 항목만 있는지 확인한다. */
  const handled = new Set([
    'name', 'kind', 'hits', 'target', 'poison', 'stun', 'chill', 'drain',
    'shieldPct', 'healPct', 'counter', 'blind', 'empower', 'chargeNext',
  ]);
  Object.values(raid.MONSTERS).forEach((monsterDef) => {
    monsterDef.pattern.forEach((entry) => {
      Object.keys(entry).forEach((key) => {
        assert.ok(handled.has(key), `${monsterDef.id}의 '${key}'는 계산이 모르는 항목이다`);
      });
      // 다듬기를 거쳐도 종류와 이름이 그대로 남아야 한다.
      const plan = raid.normalizeAttackPlan(entry);
      assert.equal(plan.kind, entry.kind);
      assert.equal(plan.name, entry.name);
    });
  });
});
