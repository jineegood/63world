import assert from 'node:assert/strict';
import test from 'node:test';
import { createPveCombatService } from '../supabase/functions/_shared/pve-combat-service-v3.mjs';

function sequence(...values) {
  let index = 0;
  return () => values[index++] ?? 0.99;
}

const player = {
  className:'warrior',
  spec:null,
  level:1,
  exp:0,
  gold:20,
  currentHp:22,
  maxHp:22,
  revision:4,
  activePet:null,
  inventory:[],
  skills:{},
};

const session = {
  combatId:'11111111-1111-4111-8111-111111111111',
  monsterKey:'forest_mushroom',
  playerRevision:4,
  sessionRevision:2,
  turnNumber:0,
  status:'active',
  playerHp:22,
  playerMaxHp:22,
  playerShield:0,
  monsterHp:9,
  monsterMaxHp:9,
  monsterAttack:2,
  monsterShield:0,
  playerStatuses:{},
  monsterStatuses:{},
  cooldowns:{},
  question:{
    questionToken:'22222222-2222-4222-8222-222222222222',
    questionId:'q1',
    prompt:'2 + 2 = ?',
    choices:['3', '4'],
  },
};

test('start ignores forged browser stats and builds the encounter from server rows', async () => {
  const calls = [];
  const service = createPveCombatService({
    random:sequence(0, 0),
    store:{
      readCombatant:async (userId) => {
        calls.push(['readCombatant', userId]);
        return player;
      },
      start:async (value) => {
        calls.push(['start', value]);
        return { ok:true, session:{ ...session, monsterHp:value.state.monsterHp } };
      },
    },
  });
  const result = await service.handle('user-a', {
    op:'start',
    monsterKey:'forest_mushroom',
    requestId:'33333333-3333-4333-8333-333333333333',
    playerAttack:999999,
    monsterHp:1,
    rewards:{ exp:999999 },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls[0], ['readCombatant', 'user-a']);
  assert.equal(calls[1][1].userId, 'user-a');
  assert.equal(calls[1][1].expectedPlayerRevision, 4);
  assert.equal(calls[1][1].state.monsterHp, 9);
  assert.equal(Object.hasOwn(calls[1][1], 'playerAttack'), false);
  assert.equal(Object.hasOwn(calls[1][1], 'rewards'), false);
});

test('submit grades with the private answer and commits a bounded server outcome', async () => {
  let committed = null;
  const service = createPveCombatService({
    random:sequence(0.5, 0.9, 0.9, 0.9, 0.9),
    store:{
      prepareTurn:async () => ({
        replayed:false,
        session:{ ...session, monsterHp:20, monsterMaxHp:20 },
        answerKey:'4',
        questionId:'q1',
        player,
      }),
      commitTurn:async (value) => {
        committed = value;
        return { ...value.outcome, ok:true };
      },
    },
  });
  const result = await service.handle('user-a', {
    op:'submit_turn',
    questionToken:session.question.questionToken,
    sessionRevision:2,
    requestId:'44444444-4444-4444-8444-444444444444',
    actionId:'basic',
    answer:'4',
    correct:true,
    damage:999999,
  });

  assert.equal(result.correct, true);
  assert.equal(result.correctAnswer, undefined);
  assert.equal(committed.userId, 'user-a');
  assert.equal(committed.expectedSessionRevision, 2);
  assert.equal(committed.expectedPlayerRevision, 4);
  assert.equal(committed.outcome.submittedAnswer, '4');
  assert.equal(committed.outcome.state.monsterHp, 16);
  assert.equal(Object.hasOwn(committed.outcome, 'damage'), false);
});

test('wrong answer response reveals only that turn answer and still resolves retaliation', async () => {
  const service = createPveCombatService({
    random:sequence(0.5, 0.9, 0.9),
    store:{
      prepareTurn:async () => ({
        replayed:false,
        session:{ ...session, monsterHp:20, monsterMaxHp:20 },
        answerKey:'4',
        questionId:'q1',
        player,
      }),
      commitTurn:async ({ outcome }) => ({ ...outcome, ok:true }),
    },
  });
  const result = await service.handle('user-a', {
    op:'submit_turn',
    questionToken:session.question.questionToken,
    sessionRevision:2,
    requestId:'55555555-5555-4555-8555-555555555555',
    actionId:'basic',
    answer:'5',
  });
  assert.equal(result.correct, false);
  assert.equal(result.correctAnswer, '4');
  assert.ok(result.events.some((event) => event.type === 'player-damage'));
  assert.equal(JSON.stringify(result).includes('answerKey'), false);
});

test('a replayed request returns its stored safe response without recalculation', async () => {
  let commits = 0;
  const stored = { ok:true, outcome:'continue', session:{ sessionRevision:3 } };
  const service = createPveCombatService({
    random:() => { throw new Error('must not roll'); },
    store:{
      prepareTurn:async () => ({ replayed:true, response:stored }),
      commitTurn:async () => { commits += 1; },
    },
  });
  assert.deepEqual(await service.handle('user-a', {
    op:'submit_turn',
    questionToken:session.question.questionToken,
    sessionRevision:2,
    requestId:'66666666-6666-4666-8666-666666666666',
    actionId:'basic',
    answer:'4',
  }), stored);
  assert.equal(commits, 0);
});

test('resume and surrender use only authenticated identity and bounded revisions', async () => {
  const calls = [];
  const service = createPveCombatService({
    random:sequence(),
    store:{
      resume:async (userId) => {
        calls.push(['resume', userId]);
        return { ok:true, session };
      },
      surrender:async (value) => {
        calls.push(['surrender', value]);
        return { ok:true, outcome:'surrender', rewards:{ exp:0, gold:0, building:0 } };
      },
    },
  });
  await service.handle('real-user', { op:'resume', userId:'forged-user' });
  const surrendered = await service.handle('real-user', {
    op:'surrender',
    userId:'forged-user',
    sessionRevision:2,
    requestId:'77777777-7777-4777-8777-777777777777',
  });
  assert.deepEqual(calls[0], ['resume', 'real-user']);
  assert.equal(calls[1][1].userId, 'real-user');
  assert.equal(surrendered.rewards.gold, 0);
});

test('invalid identity, operations, IDs, answers, and revisions fail before store mutation', async () => {
  let calls = 0;
  const service = createPveCombatService({
    random:sequence(),
    store:new Proxy({}, { get:() => async () => { calls += 1; } }),
  });
  const rejects = [
    ['', { op:'resume' }, 'UNAUTHENTICATED'],
    ['u', { op:'unknown' }, 'INVALID_OPERATION'],
    ['u', { op:'start', monsterKey:'../bad', requestId:'bad' }, 'INVALID_REQUEST'],
    ['u', {
      op:'submit_turn',
      questionToken:'bad',
      sessionRevision:0,
      requestId:'bad',
      actionId:'basic',
      answer:'x'.repeat(513),
    }, 'INVALID_REQUEST'],
  ];
  for (const [userId, body, code] of rejects) {
    await assert.rejects(
      service.handle(userId, body),
      (error) => error.code === code,
    );
  }
  assert.equal(calls, 0);
});
