import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCombatant,
  startEncounter,
  resolveTurn,
  resolveSurrender,
  sanitizeCombatResponse,
} from '../supabase/functions/_shared/pve-combat-rules-v3.mjs';

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
