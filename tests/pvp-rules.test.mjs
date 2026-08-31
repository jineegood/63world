import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const rulesUrl = pathToFileURL(path.join(root, 'supabase/functions/_shared/pvp-rules.mjs'));
const profileUrl = pathToFileURL(path.join(root, 'supabase/functions/_shared/pvp-profile.mjs'));

function sequence(values) {
  let index = 0;
  return (min, max) => {
    const value = values[index++];
    assert.ok(value >= min && value <= max);
    return value;
  };
}

function fighter(id, overrides = {}) {
  return {
    userId:id,
    name:id.toUpperCase(),
    level:10,
    className:'warrior',
    spec:'무기',
    maxHp:200,
    hp:200,
    shield:0,
    attack:50,
    defense:10,
    skills:{ warrior_basic_strike:1 },
    cooldowns:{},
    elementalBarrierUsed:false,
    statuses:{ stun:0, chill:0, shadow:0 },
    ...overrides,
  };
}

test('committed PvP catalog matches current game skills', () => {
  execFileSync(process.execPath, ['tools/build-pvp-catalog.mjs', '--check'], {
    cwd:root,
    stdio:'pipe',
  });
});

test('server PvP profile reproduces saved level, equipment, health, attack, and skills', async () => {
  const { buildAuthoritativePvpProfile } = await import(profileUrl.href);
  const levelOne = buildAuthoritativePvpProfile({
    userId:'student-lv1',
    displayName:'첫째',
    data:{
      name:'첫째',
      class:'warrior',
      level:1,
      exp:0,
      baseStatsVersion:2,
      inventory:['training_greatsword'],
      equipment:{ weapon:'training_greatsword', head:null, armor:null, accessory:null },
      skills:{},
      map:'town',
      maxHp:99999,
      attack:99999,
    },
  });
  assert.equal(levelOne.level, 1);
  assert.equal(levelOne.maxHp, 22);
  assert.equal(levelOne.primaryStat, 9);
  assert.equal(levelOne.attack, 5);
  assert.deepEqual(levelOne.skills, {});

  const levelThree = buildAuthoritativePvpProfile({
    userId:'student-lv3',
    displayName:'셋째',
    data:{
      name:'셋째',
      class:'warrior',
      level:99,
      exp:56,
      baseStatsVersion:2,
      inventory:['training_greatsword', 'bronzeGreatsword', 'noviceHat', 'whiteCloak'],
      equipment:{
        weapon:'bronzeGreatsword',
        head:'noviceHat',
        armor:'whiteCloak',
        accessory:null,
      },
      skills:{ warrior_basic_guard:3, warrior_basic_strike:1 },
      map:'town',
    },
  });
  assert.equal(levelThree.level, 3);
  assert.equal(levelThree.maxHp, 35);
  assert.equal(levelThree.primaryStat, 10);
  assert.equal(levelThree.attack, 5);
  assert.deepEqual(levelThree.equipment, {
    weapon:'bronzeGreatsword',
    head:'noviceHat',
    armor:'whiteCloak',
    accessory:null,
  });
  assert.deepEqual(levelThree.skills, {
    warrior_basic_guard:3,
    warrior_basic_strike:1,
  });

  const maximumLevel = buildAuthoritativePvpProfile({
    userId:'student-max',
    displayName:'최고',
    data:{
      name:'최고',
      class:'mage',
      exp:700,
      baseStatsVersion:2,
      inventory:['training_staff'],
      equipment:{ weapon:'training_staff' },
      skills:{},
    },
  });
  assert.equal(maximumLevel.level, 11);
});

test('server PvP profile ignores request-like combat numbers and rejects impossible gear or skills', async () => {
  const { buildAuthoritativePvpProfile } = await import(profileUrl.href);
  const profile = buildAuthoritativePvpProfile({
    userId:'student-safe',
    displayName:'안전',
    data:{
      name:'안전',
      class:'warrior',
      level:100,
      exp:56,
      baseStatsVersion:2,
      inventory:['training_greatsword', 'mithrilSword'],
      equipment:{ weapon:'mithrilSword', head:'hacked-item' },
      skills:{
        warrior_basic_guard:99,
        warrior_weapon_judgment:1,
        mage_fire_meteor_v24:1,
        hacked_skill:99,
      },
      attack:999999,
      defense:999999,
      maxHp:999999,
    },
  });
  assert.equal(profile.level, 3);
  assert.equal(profile.equipment.weapon, 'training_greatsword');
  assert.equal(profile.equipment.head, null);
  assert.deepEqual(profile.skills, { warrior_basic_guard:4 });
  assert.equal(profile.maxHp, 26);
  assert.equal(profile.primaryStat, 9);
  assert.equal(profile.attack, 5);
  assert.equal(profile.defense, 0);
});

test('30-sided initiative rerolls ties and picks the higher player', async () => {
  const rules = await import(rulesUrl.href);
  assert.deepEqual(rules.rollInitiative(sequence([29, 29, 4, 18])), {
    rolls:[{ a:29, b:29 }, { a:4, b:18 }],
    first:'b',
  });
});

test('snapshot normalization drops unknown fields and clamps combat values', async () => {
  const rules = await import(rulesUrl.href);
  assert.deepEqual(rules.normalizeSnapshot({
    ...fighter('student-a'),
    maxHp:9999999,
    hp:-4,
    attack:999999,
    password:'secret',
    skills:{ warrior_basic_strike:99, hacked_skill:1 },
  }), {
    userId:'student-a',
    name:'STUDENT-A',
    level:10,
    className:'warrior',
    spec:'무기',
    maxHp:100000,
    hp:0,
    shield:0,
    primaryStat:20000,
    attack:10000,
    defense:10,
    appearance:{},
    equipment:{},
    costume:{},
    skills:{ warrior_basic_strike:1 },
    cooldowns:{},
    buffs:{ intBuffTurns:0, intBuffPct:0.30, battleRoarTurns:0 },
    chargeActive:false,
    bastionUsed:false,
    elementalBarrierUsed:false,
    statuses:{ stun:0, chill:0, shadow:0 },
  });
});

test('both players receive the same question while the private answer stays server-side', async () => {
  const rules = await import(rulesUrl.href);
  const picked = rules.selectQuestion([
    { enabled:true, questions:[
      { id:'q1', prompt:'2 + 3 = ?', answer:'5', choices:['4', '5', '6'] },
    ] },
  ], sequence([0]));
  assert.equal(rules.judgeAnswer(picked, ' 5 '), true);
  assert.equal(rules.judgeAnswer(picked, '4'), false);
  assert.deepEqual(rules.publicQuestion(picked), {
    id:'q1',
    prompt:'2 + 3 = ?',
    choices:['4', '5', '6'],
  });
});

test('shared workbook q fields are accepted by the PvP question selector', async () => {
  const rules = await import(rulesUrl.href);
  const picked = rules.selectQuestion([
    { enabled:true, questions:[
      { id:'shared-q1', q:'6 × 7 = ?', answer:'42', choices:['36', '42', '48'] },
    ] },
  ], sequence([0]));
  assert.deepEqual(rules.publicQuestion(picked), {
    id:'shared-q1',
    prompt:'6 × 7 = ?',
    choices:['36', '42', '48'],
  });
  assert.equal(rules.judgeAnswer(picked, '42'), true);
});

test('primary stat 12 rolls the same 2 to 4 final PvP damage range as hunting', async () => {
  const rules = await import(rulesUrl.href);
  const cases = [
    { attackRoll:0, expected:2 },
    { attackRoll:999999, expected:4 },
  ];
  for (const entry of cases) {
    const resolved = rules.resolveRound({
      match:{ id:`primary-range-${entry.attackRoll}`, round:1 },
      a:{ player:fighter('a', { primaryStat:12, attack:6 }), actionId:'basic', correct:true },
      b:{
        player:fighter('b', {
          defense:0,
          statuses:{ stun:1, chill:0, shadow:0 },
        }),
        actionId:'basic',
        correct:true,
      },
      randomInt:sequence([30, 1, entry.attackRoll, 999999, 999999]),
    });
    const damage = resolved.events.find((event) => event.kind === 'damage' && event.source === 'a');
    assert.equal(damage?.requestedAmount, entry.expected, `공격력 난수 ${entry.attackRoll}`);
  }
});

test('correct hostile hits consume power, miss, then critical RNG in hunting order', async () => {
  const rules = await import(rulesUrl.href);
  const values = [30, 1, 600000, 999999, 999999];
  const calls = [];
  const resolved = rules.resolveRound({
    match:{ id:'rng-order', round:1 },
    a:{ player:fighter('a'), actionId:'basic', correct:true },
    b:{
      player:fighter('b', { statuses:{ stun:1, chill:0, shadow:0 } }),
      actionId:'basic', correct:true,
    },
    randomInt:(minimum, maximum) => {
      calls.push([minimum, maximum]);
      return values[calls.length - 1];
    },
  });
  assert.ok(resolved.events.some((event) => event.kind === 'damage' && event.missed === false));
  assert.deepEqual(calls, [
    [1, 30], [1, 30],
    [0, 999999],
    [0, 999999],
    [0, 999999],
  ]);
});

test('a missed hit does not consume critical RNG', async () => {
  const rules = await import(rulesUrl.href);
  const values = [30, 1, 500000, 0];
  const calls = [];
  const resolved = rules.resolveRound({
    match:{ id:'miss-skips-crit', round:1 },
    a:{ player:fighter('a'), actionId:'basic', correct:true },
    b:{
      player:fighter('b', { statuses:{ stun:1, chill:0, shadow:0 } }),
      actionId:'basic', correct:true,
    },
    randomInt:(minimum, maximum) => {
      calls.push([minimum, maximum]);
      return values[calls.length - 1];
    },
  });
  const damage = resolved.events.find((event) => event.kind === 'damage');
  assert.equal(damage?.missed, true);
  assert.equal(damage?.critical, false);
  assert.equal(calls.length, 4);
});

test('multi-hit skills roll power, miss, and critical independently per hit', async () => {
  const rules = await import(rulesUrl.href);
  const resolved = rules.resolveRound({
    match:{ id:'independent-multihit', round:1 },
    a:{
      player:fighter('a', {
        className:'mage', spec:'화염', primaryStat:20, attack:10,
        skills:{ mage_fire_burst_v24:1 },
      }),
      actionId:'mage_fire_burst_v24', correct:true,
    },
    b:{
      player:fighter('b', {
        maxHp:500, hp:500, defense:0,
        statuses:{ stun:1, chill:0, shadow:0 },
      }),
      actionId:'basic', correct:true,
    },
    randomInt:sequence([
      30, 1,
      0, 999999, 999999,
      999999, 999999, 999999,
      500000, 0,
    ]),
  });
  const damage = resolved.events.filter((event) => event.kind === 'damage' && event.source === 'a');
  assert.deepEqual(damage.map((event) => event.hitIndex), [0, 1, 2]);
  assert.deepEqual(damage.map((event) => event.requestedAmount), [3, 7, 0]);
  assert.deepEqual(damage.map((event) => event.missed), [false, false, true]);
});

test('wrong answers roll only per-hit power and apply hunting half damage without miss or critical', async () => {
  const rules = await import(rulesUrl.href);
  const values = [30, 1, 0, 999999, 500000];
  const calls = [];
  const resolved = rules.resolveRound({
    match:{ id:'wrong-power-only', round:1 },
    a:{
      player:fighter('a', {
        className:'mage', spec:'화염', primaryStat:20, attack:10,
        skills:{ mage_fire_burst_v24:1 },
      }),
      actionId:'mage_fire_burst_v24', correct:false,
    },
    b:{
      player:fighter('b', {
        maxHp:500, hp:500, defense:0,
        statuses:{ stun:1, chill:0, shadow:0 },
      }),
      actionId:'basic', correct:true,
    },
    randomInt:(minimum, maximum) => {
      calls.push([minimum, maximum]);
      return values[calls.length - 1];
    },
  });
  const damage = resolved.events.filter((event) => event.kind === 'damage' && event.source === 'a');
  assert.deepEqual(damage.map((event) => event.requestedAmount), [2, 3, 2]);
  assert.ok(damage.every((event) => event.missed === false && event.critical === false));
  assert.deepEqual(calls, [
    [1, 30], [1, 30],
    [0, 999999], [0, 999999], [0, 999999],
  ]);
});

test('Fire Focus expands spell critical chance and Ember Amplification boosts critical damage', async () => {
  const rules = await import(rulesUrl.href);
  const resolved = rules.resolveRound({
    match:{ id:'fire-critical-passives', round:1 },
    a:{
      player:fighter('a', {
        className:'mage', spec:'화염', primaryStat:20, attack:10,
        skills:{
          mage_fireball_v24:1,
          mage_fire_focus_v24:5,
          mage_fire_ember_v24:5,
        },
      }),
      actionId:'mage_fireball_v24', correct:true,
    },
    b:{ player:fighter('b', { maxHp:1, hp:1, defense:0 }), actionId:'basic', correct:true },
    /* 20% 치명타 굴림: 기본 15%로는 실패하지만 화염 집중 5레벨(총 45%)로 성공한다. */
    randomInt:sequence([30, 1, 0, 999999, 200000]),
  });
  const damage = resolved.events.find((event) => event.kind === 'damage');
  assert.equal(damage?.critical, true);
  assert.equal(damage?.requestedAmount, 11);
});

test('critical damage never falls below the same action maximum normal roll', async () => {
  const rules = await import(rulesUrl.href);
  const resolved = rules.resolveRound({
    match:{ id:'critical-floor', round:1 },
    a:{ player:fighter('a', { primaryStat:12, attack:6 }), actionId:'basic', correct:true },
    b:{
      player:fighter('b', {
        defense:0,
        statuses:{ stun:1, chill:0, shadow:0 },
      }),
      actionId:'basic', correct:true,
    },
    randomInt:sequence([30, 1, 0, 999999, 0]),
  });
  const damage = resolved.events.find((event) => event.kind === 'damage');
  assert.equal(damage?.critical, true);
  assert.equal(damage?.requestedAmount, 4);
});

test('Faith Radiance adds its hunting evasion bonus to the universal miss chance', async () => {
  const rules = await import(rulesUrl.href);
  const resolved = rules.resolveRound({
    match:{ id:'faith-evasion', round:1 },
    a:{ player:fighter('a'), actionId:'basic', correct:true },
    b:{
      player:fighter('b', {
        className:'priest', spec:'신성',
        skills:{ priest_basic_life:5 },
        statuses:{ stun:1, chill:0, shadow:0 },
      }),
      actionId:'basic', correct:true,
    },
    /* 30%는 기본 10%보다 높지만 신앙의 광채 포함 35%보다 낮다. */
    randomInt:sequence([30, 1, 500000, 300000]),
  });
  const damage = resolved.events.find((event) => event.kind === 'damage');
  assert.equal(damage?.missed, true);
  assert.equal(damage?.amount, 0);
});

test('a missed status skill cannot apply its status', async () => {
  const rules = await import(rulesUrl.href);
  const resolved = rules.resolveRound({
    match:{ id:'miss-status-suppression', round:1 },
    a:{
      player:fighter('a', { skills:{ warrior_weapon_slash:1 } }),
      actionId:'warrior_weapon_slash', correct:true,
    },
    b:{
      player:fighter('b', {
        className:'warrior', spec:'방어',
        skills:{ warrior_def_stance:1 },
      }),
      actionId:'warrior_def_stance', correct:false,
    },
    randomInt:sequence([30, 1, 500000, 0]),
  });
  assert.equal(resolved.events.find((event) => event.kind === 'damage')?.missed, true);
  assert.equal(resolved.events.some((event) => event.kind === 'status'), false);
  assert.equal(resolved.state.b.statuses.stun, 0);
});

test('PvP halves hunting damage, and wrong answers halve hunting damage once more first', async () => {
  const rules = await import(rulesUrl.href);
  const resolved = rules.resolveRound({
    match:{ id:'match-1', round:1 },
    a:{ player:fighter('a', { attack:100 }), actionId:'warrior_basic_strike', correct:false },
    b:{ player:fighter('b', { hp:50, attack:100 }), actionId:'warrior_basic_strike', correct:true },
    randomInt:sequence([30, 1, 500000, 500000, 999999, 999999]),
  });
  const damageEvents = resolved.events.filter((event) => event.kind === 'damage');
  assert.equal(resolved.initiative.first, 'a');
  assert.equal(damageEvents.length, 2);
  assert.equal(damageEvents[0].source, 'a');
  assert.equal(damageEvents[0].amount, 40);
  assert.equal(damageEvents[0].requestedAmount, 40);
  assert.equal(resolved.state.b.hp, 10);
  assert.equal(rules.PVP_DAMAGE_MULTIPLIER, 0.5);
});

test('shield absorbs damage before HP and effects are assigned stable event ids', async () => {
  const rules = await import(rulesUrl.href);
  const resolved = rules.resolveRound({
    match:{ id:'match-2', round:3 },
    a:{ player:fighter('a', { attack:50 }), actionId:'basic', correct:true },
    b:{ player:fighter('b', { shield:30 }), actionId:'basic', correct:true },
    randomInt:sequence([20, 10, 500000, 999999, 999999, 500000, 999999, 999999]),
  });
  assert.equal(resolved.state.b.shield, 10);
  assert.equal(resolved.state.b.hp, 200);
  assert.equal(resolved.events[0].id, 'match-2:3:0');
  assert.equal(resolved.events[0].kind, 'action');
  assert.equal(resolved.events[1].absorbed, 20);
});

test('active shields use maximum HP even when the caster has only 1 HP left', async () => {
  const rules = await import(rulesUrl.href);
  const cases = [
    { id:'warrior_def_stance', className:'warrior', spec:'방어', expected:20 },
    { id:'warrior_def_wall', className:'warrior', spec:'방어', expected:20 },
    { id:'mage_frost_armor_v24', className:'mage', spec:'냉기', expected:70 },
  ];
  for (const entry of cases) {
    const resolved = rules.resolveRound({
      match:{ id:`max-hp-${entry.id}`, round:1 },
      a:{
        player:fighter('a', {
          className:entry.className,
          spec:entry.spec,
          maxHp:100,
          hp:1,
          attack:1,
          skills:{ [entry.id]:1 },
        }),
        actionId:entry.id,
        correct:true,
      },
      b:{ player:fighter('b', { attack:1 }), actionId:'basic', correct:true },
      randomInt:(_min, max) => max,
    });
    const shield = resolved.events.find((event) => event.kind === 'shield' && event.source === 'a');
    assert.equal(shield?.amount, entry.expected, entry.id);
  }
});

test('Block Training follows the hunting order: own action, shield, enemy counterattack', async () => {
  const rules = await import(rulesUrl.href);
  const resolved = rules.resolveRound({
    match:{ id:'match-guard', round:1 },
    a:{
      player:fighter('a', {
        attack:10,
        maxHp:20,
        hp:20,
        skills:{ warrior_basic_guard:1 },
      }),
      actionId:'basic',
      correct:true,
    },
    b:{ player:fighter('b', { attack:10 }), actionId:'basic', correct:true },
    randomInt:sequence([30, 1, 500000, 999999, 999999, 500000, 999999, 999999]),
  });
  const ownActionIndex = resolved.events.findIndex((event) => event.kind === 'action' && event.source === 'a');
  const ownDamageIndex = resolved.events.findIndex((event) => event.kind === 'damage' && event.source === 'a');
  const guardIndex = resolved.events.findIndex((event) => event.skillId === 'warrior_basic_guard');
  const counterActionIndex = resolved.events.findIndex((event) => event.kind === 'action' && event.source === 'b');
  const counterDamageIndex = resolved.events.findIndex((event) => event.kind === 'damage' && event.source === 'b');
  assert.ok(ownActionIndex >= 0);
  assert.ok(ownDamageIndex > ownActionIndex, '내 공격이 먼저 처리되어야 한다');
  assert.ok(guardIndex > ownDamageIndex, '보호막은 내 행동이 끝난 뒤 생성되어야 한다');
  assert.ok(counterActionIndex > guardIndex, '그 다음 상대 반격이 시작되어야 한다');
  assert.ok(counterDamageIndex > counterActionIndex);
  assert.equal(resolved.events[guardIndex].amount, 1);
  assert.equal(resolved.events[guardIndex].source, 'a');
  assert.equal(resolved.events[counterDamageIndex].absorbed, 1);
});

test('a slower Warrior cannot create Block Training before taking their own turn', async () => {
  const rules = await import(rulesUrl.href);
  const resolved = rules.resolveRound({
    match:{ id:'match-guard-slower', round:1 },
    a:{ player:fighter('a', { attack:10 }), actionId:'basic', correct:true },
    b:{
      player:fighter('b', {
        attack:10,
        maxHp:20,
        hp:20,
        skills:{ warrior_basic_guard:1 },
      }),
      actionId:'basic',
      correct:true,
    },
    randomInt:sequence([30, 1, 500000, 999999, 999999, 500000, 999999, 999999]),
  });
  const incomingDamageIndex = resolved.events.findIndex((event) => event.kind === 'damage' && event.source === 'a');
  const ownDamageIndex = resolved.events.findIndex((event) => event.kind === 'damage' && event.source === 'b');
  const guardIndex = resolved.events.findIndex((event) => event.skillId === 'warrior_basic_guard');
  assert.equal(resolved.events[incomingDamageIndex].absorbed, 0,
    '자신이 아직 행동하지 않았으므로 선공 피해를 미리 막으면 안 된다');
  assert.ok(guardIndex > ownDamageIndex, '막기 훈련은 자신의 행동 뒤에만 생성되어야 한다');
  assert.equal(resolved.state.b.shield, 1, '다음 상대 공격을 대비한 보호막은 유지되어야 한다');
});

test('Block Training does not appear after its owner has already ended the duel', async () => {
  const rules = await import(rulesUrl.href);
  const resolved = rules.resolveRound({
    match:{ id:'match-guard-finish', round:1 },
    a:{
      player:fighter('a', { attack:100, skills:{ warrior_basic_guard:1 } }),
      actionId:'basic',
      correct:true,
    },
    b:{ player:fighter('b', { hp:1, maxHp:1 }), actionId:'basic', correct:true },
    randomInt:sequence([30, 1, 999999, 999999, 999999]),
  });
  assert.equal(resolved.winner, 'a');
  assert.equal(resolved.events.some((event) => event.skillId === 'warrior_basic_guard'), false);
});

test('Block Training cannot activate for a non-warrior snapshot', async () => {
  const rules = await import(rulesUrl.href);
  const resolved = rules.resolveRound({
    match:{ id:'match-guard-class', round:1 },
    a:{ player:fighter('a', { attack:10 }), actionId:'basic', correct:true },
    b:{
      player:fighter('b', {
        className:'mage',
        maxHp:20,
        hp:20,
        skills:{ warrior_basic_guard:3 },
      }),
      actionId:'basic',
      correct:true,
    },
    randomInt:sequence([30, 1, 500000, 999999, 999999, 500000, 999999, 999999]),
  });
  assert.equal(resolved.events.some((event) => event.skillId === 'warrior_basic_guard'), false);
});

test('Elemental Barrier triggers after the full incoming action when a mage survives at 20 percent HP or less', async () => {
  const rules = await import(rulesUrl.href);
  const resolved = rules.resolveRound({
    match:{ id:'match-elemental-barrier', round:1 },
    a:{ player:fighter('a', { attack:50 }), actionId:'basic', correct:true },
    b:{
      player:fighter('b', {
        className:'mage', spec:'화염', maxHp:100, hp:40,
        skills:{ mage_basic_element:1 },
      }),
      actionId:'basic', correct:true,
    },
    randomInt:sequence([30, 1, 500000, 999999, 999999, 500000, 999999, 999999]),
  });
  const damageIndex = resolved.events.findIndex((event) => event.kind === 'damage' && event.target === 'b');
  const barrierIndex = resolved.events.findIndex((event) => event.skillId === 'mage_basic_element');
  assert.equal(resolved.state.b.hp, 20);
  assert.equal(resolved.state.b.shield, 10);
  assert.equal(resolved.state.b.elementalBarrierUsed, true);
  assert.ok(barrierIndex > damageIndex);
  assert.equal(resolved.events[barrierIndex].amount, 10);
});

test('Elemental Barrier does not rescue a mage killed by the incoming action', async () => {
  const rules = await import(rulesUrl.href);
  const resolved = rules.resolveRound({
    match:{ id:'match-elemental-fatal', round:1 },
    a:{ player:fighter('a', { attack:50 }), actionId:'basic', correct:true },
    b:{
      player:fighter('b', {
        className:'mage', spec:'화염', maxHp:100, hp:15,
        skills:{ mage_basic_element:5 },
      }),
      actionId:'basic', correct:true,
    },
    randomInt:sequence([30, 1, 500000, 999999, 999999]),
  });
  assert.equal(resolved.state.b.hp, 0);
  assert.equal(resolved.state.b.shield, 0);
  assert.equal(resolved.events.some((event) => event.skillId === 'mage_basic_element'), false);
});
