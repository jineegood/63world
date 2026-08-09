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
  assert.deepEqual(profile.skills, { warrior_basic_guard:3 });
  assert.equal(profile.maxHp, 26);
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
    attack:10000,
    defense:10,
    appearance:{},
    equipment:{},
    costume:{},
    skills:{ warrior_basic_strike:1 },
    cooldowns:{},
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

test('PvP attacks are halved, and wrong answers are halved once more', async () => {
  const rules = await import(rulesUrl.href);
  const resolved = rules.resolveRound({
    match:{ id:'match-1', round:1 },
    a:{ player:fighter('a', { attack:100 }), actionId:'warrior_basic_strike', correct:false },
    b:{ player:fighter('b', { hp:50, attack:100 }), actionId:'warrior_basic_strike', correct:true },
    randomInt:sequence([30, 1, 100, 100]),
  });
  const damageEvents = resolved.events.filter((event) => event.kind === 'damage');
  assert.equal(resolved.initiative.first, 'a');
  assert.equal(damageEvents.length, 2);
  assert.equal(damageEvents[0].source, 'a');
  assert.equal(damageEvents[0].amount, 43);
  assert.equal(damageEvents[0].requestedAmount, 43);
  assert.equal(resolved.state.b.hp, 7);
  assert.equal(rules.PVP_DAMAGE_MULTIPLIER, 0.5);
});

test('shield absorbs damage before HP and effects are assigned stable event ids', async () => {
  const rules = await import(rulesUrl.href);
  const resolved = rules.resolveRound({
    match:{ id:'match-2', round:3 },
    a:{ player:fighter('a', { attack:50 }), actionId:'basic', correct:true },
    b:{ player:fighter('b', { shield:30 }), actionId:'basic', correct:true },
    randomInt:sequence([20, 10, 100, 100]),
  });
  assert.equal(resolved.state.b.shield, 10);
  assert.equal(resolved.state.b.hp, 200);
  assert.equal(resolved.events[0].id, 'match-2:3:0');
  assert.equal(resolved.events[0].kind, 'action');
  assert.equal(resolved.events[1].absorbed, 20);
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
    randomInt:sequence([30, 1]),
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
    randomInt:sequence([30, 1]),
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
    randomInt:sequence([30, 1]),
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
    randomInt:sequence([30, 1]),
  });
  assert.equal(resolved.events.some((event) => event.skillId === 'warrior_basic_guard'), false);
});
