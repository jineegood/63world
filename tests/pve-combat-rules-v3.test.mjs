import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  buildCombatant,
  startEncounter,
  resolveTurn,
  resolveEscapeAttempt,
  resolveSurrender,
  sanitizeCombatResponse,
} from '../supabase/functions/_shared/pve-combat-rules-v3.mjs';
import { SKILL_COMBAT_V3 } from '../supabase/functions/_shared/generated-combat-catalog-v3.mjs';

function sequence(...values) {
  let index = 0;
  return () => {
    assert.ok(index < values.length, `random sequence exhausted at ${index}`);
    return values[index++];
  };
}

const basicPlayer = {
  className:'warrior',
  spec:null,
  level:1,
  exp:0,
  currentHp:40,
  inventory:[
    { itemId:'bronzeGreatsword', equippedSlot:'weapon', enhancementTier:2 },
    { itemId:'featherWing', equippedSlot:null, enhancementTier:0 },
  ],
  skills:{ warrior_basic_body:2 },
  activePet:'chick',
};

test('every generated combat passive is consumed by the trusted engine', () => {
  const source = fs.readFileSync(
    path.resolve(import.meta.dirname, '../supabase/functions/_shared/pve-combat-rules-v3.mjs'),
    'utf8',
  );
  const passiveFields = new Set();
  const structural = new Set([
    'id', 'classOnly', 'specOnly', 'line', 'cost', 'maxPoints', 'prereq',
    'kind', 'active', 'bonuses', 'flatBonuses',
  ]);
  for (const skill of Object.values(SKILL_COMBAT_V3)) {
    for (const field of Object.keys(skill)) {
      if (!structural.has(field)) passiveFields.add(field);
    }
  }
  for (const field of passiveFields) {
    assert.match(
      source,
      new RegExp(`(?:\\.|['"])${field}\\b`),
      `${field} must affect authoritative combat`,
    );
  }
});

test('buildCombatant derives all combat stats from canonical catalogs', () => {
  const player = buildCombatant(basicPlayer);
  assert.deepEqual(player.stats, {
    intelligence:7,
    spirit:4,
    strength:12,
    vitality:10,
  });
  assert.equal(player.maxHp, 40);
  assert.equal(player.hp, 40);
  assert.equal(player.attackStat, 12);
  assert.equal(player.skills.warrior_basic_body, 2);
});

test('startEncounter owns monster health and attack rolls', () => {
  const player = buildCombatant({ ...basicPlayer, currentHp:31 });
  const started = startEncounter({
    player,
    monsterKey:'forest_mushroom',
    random:sequence(0, 0.999999),
  });
  assert.equal(started.playerHp, 31);
  assert.equal(started.monsterHp, 9);
  assert.equal(started.monsterMaxHp, 9);
  assert.equal(started.monsterAttack, 4);
  assert.equal(started.status, 'active');
  assert.equal(started.turnNumber, 0);
});

test('correct basic attack uses server attack, miss, crit, and monster rolls', () => {
  const player = buildCombatant({ ...basicPlayer, inventory:[], activePet:null, skills:{} });
  const state = {
    ...startEncounter({ player, monsterKey:'forest_mushroom', random:sequence(0.5, 0.5) }),
    monsterHp:20,
    monsterMaxHp:20,
    monsterAttack:3,
    monsterPatterns:[],
  };
  const result = resolveTurn({
    state,
    player,
    actionId:'basic',
    answer:' 4 ',
    answerKey:'4',
    random:sequence(
      0.5, // attack power
      0.9, // player miss
      0.9, // player critical
      0.9, // monster miss
      0.9, // monster critical
    ),
  });

  assert.equal(result.correct, true);
  assert.equal(result.correctAnswer, undefined);
  assert.equal(result.state.monsterHp, 16);
  assert.equal(result.state.playerHp, player.maxHp - 3);
  assert.equal(result.state.turnNumber, 1);
  assert.equal(result.outcome, 'continue');
  assert.deepEqual(result.events.map((event) => event.type), [
    'answer-correct', 'monster-damage', 'monster-action', 'player-damage',
  ]);
});

test('wrong answers deal half damage and reveal the answer without skipping retaliation', () => {
  const player = buildCombatant({ ...basicPlayer, inventory:[], activePet:null, skills:{} });
  const state = {
    ...startEncounter({ player, monsterKey:'forest_mushroom', random:sequence(0.5, 0.5) }),
    monsterHp:20,
    monsterMaxHp:20,
    monsterAttack:2,
    monsterPatterns:[],
  };
  const result = resolveTurn({
    state,
    player,
    actionId:'basic',
    answer:'5',
    answerKey:'4',
    random:sequence(0.5, 0.9, 0.9, 0.9, 0.9),
  });

  assert.equal(result.correct, false);
  assert.equal(result.correctAnswer, '4');
  assert.equal(result.state.monsterHp, 18);
  assert.equal(result.state.playerHp, player.maxHp - 2);
  assert.equal(result.events[0].type, 'answer-wrong');
  assert.equal(result.events[0].minimumDurationMs, 2000);
});

test('escape chance is 80 percent at equal level and 50 percent against a higher monster', () => {
  const player = buildCombatant({ ...basicPlayer, inventory:[], activePet:null, skills:{} });
  const equal = startEncounter({
    player,
    monsterKey:'forest_mushroom',
    random:sequence(0.5, 0.5),
  });
  const higher = startEncounter({
    player,
    monsterKey:'forest_slime',
    random:sequence(0.5, 0.5),
  });

  const equalResult = resolveEscapeAttempt({
    state:equal,
    player,
    random:sequence(0.79),
  });
  const higherResult = resolveEscapeAttempt({
    state:higher,
    player,
    random:sequence(0.49),
  });

  assert.equal(equalResult.escape.chance, 0.8);
  assert.equal(equalResult.escape.success, true);
  assert.equal(equalResult.outcome, 'escaped');
  assert.equal(equalResult.state.status, 'resolved');
  assert.equal(higherResult.escape.chance, 0.5);
  assert.equal(higherResult.escape.success, true);
});

test('failed escape locks another attempt and uses the normal monster counterattack', () => {
  const player = buildCombatant({ ...basicPlayer, inventory:[], activePet:null, skills:{} });
  const state = {
    ...startEncounter({
      player,
      monsterKey:'forest_mushroom',
      random:sequence(0.5, 0.5),
    }),
    monsterAttack:3,
    monsterPatterns:[],
  };
  const result = resolveEscapeAttempt({
    state,
    player,
    random:sequence(
      0.8, // equal-level 80% escape fails
      0.9, // monster miss
      0.9, // monster critical
    ),
  });

  assert.equal(result.escape.success, false);
  assert.equal(result.escape.locked, true);
  assert.equal(result.outcome, 'continue');
  assert.equal(result.state.escapeFailed, true);
  assert.equal(result.state.playerHp, player.maxHp - 3);
  assert.deepEqual(result.events.map((event) => event.type), [
    'escape', 'monster-action', 'player-damage',
  ]);
  assert.throws(
    () => resolveEscapeAttempt({ state:result.state, player, random:sequence(0) }),
    /ESCAPE_ALREADY_FAILED/,
  );
});

test('escape is forbidden in boss fights and a lethal failed counterattack defeats the player', () => {
  const player = buildCombatant({ ...basicPlayer, inventory:[], activePet:null, skills:{} });
  const boss = startEncounter({
    player,
    monsterKey:'final_teacher',
    random:sequence(0.5, 0.5),
  });
  assert.throws(
    () => resolveEscapeAttempt({ state:boss, player, random:sequence(0) }),
    /ESCAPE_NOT_ALLOWED/,
  );

  const lethal = {
    ...startEncounter({
      player,
      monsterKey:'forest_mushroom',
      random:sequence(0.5, 0.5),
    }),
    playerHp:1,
    monsterAttack:3,
    monsterPatterns:[],
  };
  const result = resolveEscapeAttempt({
    state:lethal,
    player,
    random:sequence(0.8, 0.9, 0.9),
  });
  assert.equal(result.outcome, 'defeat');
  assert.equal(result.state.playerHp, 0);
});

test('teacher chill halves the next damaging player action and is then consumed', () => {
  const player = buildCombatant({ ...basicPlayer, inventory:[], activePet:null, skills:{} });
  const state = {
    ...startEncounter({ player, monsterKey:'final_teacher', random:sequence(0, 0) }),
    monsterHp:20,
    monsterMaxHp:20,
    monsterAttack:1,
    playerStatuses:{ chillTurns:1 },
    monsterPatterns:[],
  };
  const result = resolveTurn({
    state,
    player,
    actionId:'basic',
    answer:'4',
    answerKey:'4',
    random:sequence(0.5, 0.9, 0.9, 0.9, 0.9),
  });
  assert.equal(result.state.monsterHp, 18);
  assert.equal(result.state.playerStatuses.chillTurns, undefined);
  assert.ok(result.events.some((event) => (
    event.type === 'player-status' && event.status === 'chill' && event.turns === 0
  )));
});

test('learned support skills create shields and enforce cooldowns', () => {
  const player = buildCombatant({
    ...basicPlayer,
    inventory:[],
    activePet:null,
    skills:{ warrior_def_stance:1 },
  });
  const state = {
    ...startEncounter({ player, monsterKey:'forest_mushroom', random:sequence(0.5, 0.5) }),
    monsterAttack:2,
    monsterPatterns:[],
  };
  const result = resolveTurn({
    state,
    player,
    actionId:'active:warrior_def_stance',
    answer:'4',
    answerKey:'4',
    random:sequence(0.9, 0.9),
  });

  assert.equal(result.state.cooldowns.warrior_def_stance, 5);
  assert.equal(result.state.playerShield, 1, '3 shield is created and 2 is consumed by retaliation');
  assert.ok(result.events.some((event) => event.type === 'player-shield' && event.amount === 3));
  assert.throws(
    () => resolveTurn({
      state:result.state,
      player,
      actionId:'active:warrior_def_stance',
      answer:'4',
      answerKey:'4',
      random:sequence(),
    }),
    /ACTION_ON_COOLDOWN/,
  );
});

test('victory emits canonical rewards and owns the building drop roll', () => {
  const player = buildCombatant({ ...basicPlayer, inventory:[], activePet:null, skills:{} });
  const state = {
    ...startEncounter({ player, monsterKey:'forest_mushroom', random:sequence(0, 0) }),
    monsterHp:1,
    monsterMaxHp:9,
    monsterAttack:2,
    monsterPatterns:[],
  };
  const result = resolveTurn({
    state,
    player,
    actionId:'basic',
    answer:'yes',
    answerKey:'yes',
    random:sequence(0.5, 0.9, 0.9, 0.05),
  });

  assert.equal(result.outcome, 'victory');
  assert.equal(result.state.status, 'resolved');
  assert.deepEqual(result.rewards, { exp:1, gold:2, building:1 });
  assert.deepEqual(result.events.at(-1), {
    type:'rewards',
    exp:1,
    gold:2,
    building:1,
  });
});

test('defeat preserves experience before specialization and surrender awards nothing', () => {
  const player = buildCombatant({
    ...basicPlayer,
    currentHp:1,
    exp:8,
    inventory:[],
    activePet:null,
    skills:{},
  });
  const state = {
    ...startEncounter({ player, monsterKey:'forest_mushroom', random:sequence(0, 0) }),
    playerHp:1,
    monsterHp:20,
    monsterMaxHp:20,
    monsterAttack:4,
    monsterPatterns:[],
  };
  const defeated = resolveTurn({
    state,
    player,
    actionId:'basic',
    answer:'4',
    answerKey:'4',
    random:sequence(0.5, 0.9, 0.9, 0.9, 0.9),
  });
  assert.equal(defeated.outcome, 'defeat');
  assert.equal(defeated.death.expAfter, 8);

  const surrendered = resolveSurrender(state);
  assert.equal(surrendered.outcome, 'surrender');
  assert.equal(surrendered.state.status, 'resolved');
  assert.deepEqual(surrendered.rewards, { exp:0, gold:0, building:0 });
});

test('poison and shadow damage tick after the monster action and remain server-owned', () => {
  const player = buildCombatant({ ...basicPlayer, inventory:[], activePet:null, skills:{} });
  const state = {
    ...startEncounter({ player, monsterKey:'forest_mushroom', random:sequence(0, 0) }),
    monsterHp:30,
    monsterMaxHp:30,
    monsterAttack:3,
    monsterPatterns:[],
    playerStatuses:{ poisonTurns:2, poisonDamage:2 },
    monsterStatuses:{ shadowStacks:3 },
  };
  const result = resolveTurn({
    state,
    player,
    actionId:'basic',
    answer:'4',
    answerKey:'4',
    random:sequence(0.5, 0.9, 0.9, 0.9, 0.9),
  });

  assert.equal(result.state.playerHp, player.maxHp - 5);
  assert.equal(result.state.playerStatuses.poisonTurns, 1);
  assert.equal(result.state.monsterHp, 23);
  assert.equal(result.state.monsterStatuses.shadowStacks, 3);
  assert.deepEqual(
    result.events.map((event) => event.type),
    [
      'answer-correct',
      'monster-damage',
      'monster-action',
      'player-damage',
      'monster-dot',
      'player-dot',
    ],
  );
});

test('warrior passive extra hits and Guardian Oath resolve inside the trusted turn', () => {
  const player = buildCombatant({
    className:'warrior',
    spec:'방어',
    level:10,
    currentHp:1,
    inventory:[],
    skills:{
      warrior_def_armor:5,
      warrior_weapon_breaker:3,
      warrior_def_bastion:1,
    },
  });
  const state = {
    ...startEncounter({ player, monsterKey:'forest_mushroom', random:sequence(0, 0) }),
    playerHp:1,
    monsterHp:100,
    monsterMaxHp:100,
    monsterAttack:10,
    monsterPatterns:[],
  };
  const result = resolveTurn({
    state,
    player,
    actionId:'basic',
    answer:'yes',
    answerKey:'yes',
    random:sequence(
      0.5, 0.5,
      0.9, 0.9,
      0.9, 0.9,
      0.9, 0.9,
      0.9, 0.9,
    ),
  });

  assert.equal(result.events.filter((event) => event.type === 'monster-damage').length, 3);
  assert.equal(result.state.playerStatuses.guardianOathUsed, true);
  assert.equal(result.state.playerHp, player.maxHp);
  assert.ok(result.events.some((event) => event.source === 'guardian-oath'));
  assert.equal(result.outcome, 'continue');
});

test('priest faith increases monster misses and Grace boosts healing', () => {
  const player = buildCombatant({
    className:'priest',
    spec:'신성',
    level:10,
    currentHp:1,
    inventory:[],
    skills:{
      priest_basic_life:5,
      priest_holy_absorb_v24:1,
      priest_holy_grace_v24:3,
    },
  });
  const state = {
    ...startEncounter({ player, monsterKey:'forest_mushroom', random:sequence(0, 0) }),
    playerHp:1,
    monsterHp:100,
    monsterMaxHp:100,
    monsterAttack:5,
    monsterPatterns:[],
  };
  const healed = resolveTurn({
    state,
    player,
    actionId:'active:priest_holy_absorb_v24',
    answer:'4',
    answerKey:'4',
    random:sequence(0.30),
  });

  assert.equal(healed.state.playerHp, player.maxHp);
  assert.ok(healed.events.some((event) => event.type === 'monster-miss'));
  assert.ok(healed.events.some((event) => event.type === 'player-heal'));
});

test('mage execution and shadow periodic critical lifesteal are authoritative', () => {
  const mage = buildCombatant({
    className:'mage',
    spec:'냉기',
    level:10,
    currentHp:50,
    inventory:[],
    skills:{ mage_basic_element:5, mage_basic_bolt:1 },
  });
  const mageState = {
    ...startEncounter({ player:mage, monsterKey:'forest_mushroom', random:sequence(0, 0) }),
    monsterHp:17,
    monsterMaxHp:17,
    monsterPatterns:[],
  };
  const executed = resolveTurn({
    state:mageState,
    player:mage,
    actionId:'active:mage_basic_bolt',
    answer:'4',
    answerKey:'4',
    random:sequence(0.5, 0.9, 0.9, 0.9, 0.9, 0.9),
  });
  assert.equal(executed.outcome, 'victory');
  assert.ok(executed.events.some((event) => event.execute === true));

  const priest = buildCombatant({
    className:'priest',
    spec:'암흑',
    level:10,
    currentHp:1,
    inventory:[],
    skills:{ priest_shadow_void_v24:5, priest_shadow_focus_v24:5 },
  });
  const shadowState = {
    ...startEncounter({ player:priest, monsterKey:'forest_mushroom', random:sequence(0, 0) }),
    playerHp:1,
    monsterHp:30,
    monsterMaxHp:30,
    monsterStatuses:{ shadowStacks:2, stunTurns:1 },
    monsterPatterns:[],
  };
  const shadowed = resolveTurn({
    state:shadowState,
    player:priest,
    actionId:'basic',
    answer:'4',
    answerKey:'4',
    random:sequence(0.5, 0.9, 0.9, 0.9, 0.1),
  });
  const dot = shadowed.events.find((event) => event.type === 'monster-dot');
  assert.equal(dot.critical, true);
  assert.equal(dot.amount, 4);
  assert.ok(shadowed.events.some((event) => event.source === 'shadow-focus'));
  assert.ok(shadowed.state.playerHp > 1);
});

test('monster chill covers every multi-hit and player stun consumes the next action', () => {
  const player = buildCombatant({
    className:'warrior',
    spec:null,
    level:10,
    currentHp:100,
    inventory:[],
    skills:{},
  });
  const chilledState = {
    ...startEncounter({ player, monsterKey:'swamp_tarantula', random:sequence(0, 0) }),
    playerHp:player.maxHp,
    monsterHp:100,
    monsterMaxHp:100,
    monsterAttack:10,
    monsterStatuses:{ chillTurns:1 },
    monsterPatterns:[{ chance:1, kind:'multi', hits:2, multiplier:0.62 }],
  };
  const chilled = resolveTurn({
    state:chilledState,
    player,
    actionId:'basic',
    answer:'4',
    answerKey:'4',
    random:sequence(0.5, 0.9, 0.9, 0, 0.9, 0.9, 0.9, 0.9),
  });
  assert.deepEqual(
    chilled.events
      .filter((event) => event.type === 'player-damage')
      .map((event) => event.amount),
    [4, 4],
  );
  assert.equal(chilled.state.monsterStatuses.chillTurns, 0);

  const stunnedState = {
    ...startEncounter({ player, monsterKey:'desert_stomp', random:sequence(0, 0) }),
    playerHp:player.maxHp,
    monsterHp:100,
    monsterMaxHp:100,
    monsterAttack:2,
    monsterPatterns:[{ chance:0.5, kind:'heavy', multiplier:1, stunTurns:1 }],
  };
  const stunned = resolveTurn({
    state:stunnedState,
    player,
    actionId:'basic',
    answer:'4',
    answerKey:'4',
    random:sequence(
      0.5, 0.9, 0.9,
      0, 0.9, 0.9,
      0.9, 0.9, 0.9,
    ),
  });
  assert.equal(stunned.events.filter((event) => event.type === 'monster-action').length, 2);
  assert.ok(stunned.events.some((event) => event.status === 'stun-skipped-action'));
});

test('invalid actions, state, answers, random values, and leaked fields fail closed', () => {
  const player = buildCombatant({ ...basicPlayer, inventory:[], activePet:null, skills:{} });
  const state = startEncounter({ player, monsterKey:'forest_mushroom', random:sequence(0, 0) });
  assert.throws(() => resolveTurn({
    state, player, actionId:'active:warrior_def_stance', answer:'4', answerKey:'4', random:sequence(),
  }), /ACTION_NOT_LEARNED/);
  assert.throws(() => resolveTurn({
    state:{ ...state, monsterHp:state.monsterMaxHp + 1 },
    player, actionId:'basic', answer:'4', answerKey:'4', random:sequence(),
  }), /INVALID_COMBAT_STATE/);
  assert.throws(() => resolveTurn({
    state, player, actionId:'basic', answer:'x'.repeat(513), answerKey:'4', random:sequence(),
  }), /INVALID_ANSWER/);
  assert.throws(() => startEncounter({
    player, monsterKey:'forest_mushroom', random:sequence(1),
  }), /INVALID_RANDOM/);
  assert.throws(() => sanitizeCombatResponse({ answerKey:'secret' }), /UNSAFE_RESPONSE_FIELD/);
});
