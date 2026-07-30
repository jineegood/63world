import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const serviceUrl = pathToFileURL(path.join(root, 'supabase/functions/_shared/pvp-service.mjs'));
const errorUrl = pathToFileURL(path.join(root, 'supabase/functions/_shared/pvp-error.mjs'));

test('Edge endpoint verifies JWT identity and never trusts a caller user id', () => {
  const source = fs.readFileSync(path.join(root, 'supabase/functions/pvp-match-v1/index.ts'), 'utf8');
  const config = fs.readFileSync(path.join(root, 'supabase/config.toml'), 'utf8');
  assert.match(source, /npm:@supabase\/supabase-js@2\.110\.8/);
  assert.match(source, /auth\.getUser\(\)/);
  assert.match(source, /Deno\.env\.get\(['"]SUPABASE_SERVICE_ROLE_KEY['"]\)/);
  assert.doesNotMatch(source, /body\.(?:userId|callerId)/);
  assert.match(source, /request\.method\s*!==\s*['"]POST['"]/);
  assert.match(source, /RETRYABLE_OPERATIONS[\s\S]*presence[\s\S]*profile[\s\S]*sync[\s\S]*heartbeat/);
  assert.match(source, /x-pvp-trace-id/);
  assert.match(source, /Retry-After/);
  assert.match(source, /\{\s*error:code,\s*traceId\s*\}/);
  assert.match(source, /transient retry/);
  assert.match(config, /\[functions\.pvp-match-v1\][\s\S]*verify_jwt\s*=\s*true/);
});

test('database error messages expose only known PvP codes and hide raw failures', async () => {
  const { publicPvpErrorCode } = await import(errorUrl.href);
  assert.equal(publicPvpErrorCode({ code:'P0001', message:'ROUND_CHANGED' }), 'ROUND_CHANGED');
  assert.equal(publicPvpErrorCode({ code:'NO_QUESTIONS', message:'ignored' }), 'NO_QUESTIONS');
  assert.equal(publicPvpErrorCode({ code:'PGRST002', message:'schema cache unavailable' }), 'TEMPORARY_UNAVAILABLE');
  assert.equal(publicPvpErrorCode({ status:503, message:'upstream unavailable' }), 'TEMPORARY_UNAVAILABLE');
  assert.equal(publicPvpErrorCode(new SyntaxError('bad json')), 'INVALID_REQUEST');
  assert.equal(publicPvpErrorCode({ code:'23505', message:'sensitive database detail' }), 'SERVER_ERROR');
});

test('service rejects challenges unless both students are available in town', async () => {
  const { createPvpService } = await import(serviceUrl.href);
  const presence = new Map([
    ['a', { userId:'a', map:'town', busy:false, lastSeenAt:1000 }],
    ['b', { userId:'b', map:'forest', busy:false, lastSeenAt:1000 }],
  ]);
  const service = createPvpService({
    now:() => 1000,
    randomInt:(min) => min,
    store:{
      expirePendingInvitesForUsers:async () => ({ ok:true }),
      getPresence:(id) => presence.get(id),
      findActiveMatchForUser:async () => null,
      createInvite:async () => { throw new Error('should not create'); },
    },
  });
  await assert.rejects(
    service.handle('a', { op:'invite', targetUserId:'b', requestId:'r1' }),
    (error) => error.code === 'TOWN_ONLY',
  );
});

test('presence grace tolerates delayed classroom timers but still rejects stale sessions', async () => {
  const { createPvpService } = await import(serviceUrl.href);
  const buildService = (targetLastSeenAt) => createPvpService({
    now:() => 100000,
    randomInt:(minimum) => minimum,
    store:{
      expirePendingInvitesForUsers:async () => ({ ok:true }),
      getPresence:async (id) => ({
        userId:id,
        map:'town',
        busy:false,
        lastSeenAt:id === 'a' ? 100000 : targetLastSeenAt,
      }),
      findActiveMatchForUser:async () => null,
      createInvite:async () => ({ id:'invite-new' }),
    },
  });

  assert.equal(
    (await buildService(10000).handle('a', {
      op:'invite', targetUserId:'b', requestId:'within-grace',
    })).id,
    'invite-new',
  );
  await assert.rejects(
    buildService(9999).handle('a', {
      op:'invite', targetUserId:'b', requestId:'outside-grace',
    }),
    (error) => error.code === 'OFFLINE',
  );
});

test('invite expires stale requests for both participants before availability checks', async () => {
  const { createPvpService } = await import(serviceUrl.href);
  const calls = [];
  const service = createPvpService({
    now:() => 5000,
    randomInt:(minimum) => minimum,
    store:{
      expirePendingInvitesForUsers:async (userIds, checkedAt) => {
        calls.push(['expire', userIds, checkedAt]);
      },
      getPresence:async (id) => ({
        userId:id, map:'town', busy:false, lastSeenAt:5000,
      }),
      findActiveMatchForUser:async () => null,
      createInvite:async (value) => {
        calls.push(['create', value]);
        return { id:'invite-new' };
      },
    },
  });

  const result = await service.handle('a', {
    op:'invite', targetUserId:'b', requestId:'request-1',
  });
  assert.equal(result.id, 'invite-new');
  assert.deepEqual(calls, [
    ['expire', ['a', 'b'], 5000],
    ['create', {
      challengerId:'a',
      targetId:'b',
      requestId:'request-1',
      requestedAt:5000,
      expiresAt:25000,
    }],
  ]);
});

test('early answer submission reveals only waiting state', async () => {
  const { createPvpService } = await import(serviceUrl.href);
  const match = {
    id:'m1',
    playerAId:'a',
    playerBId:'b',
    round:1,
    phase:'question',
    deadline:21000,
  };
  const inputs = [];
  const service = createPvpService({
    now:() => 5000,
    randomInt:(min) => min,
    store:{
      getMatchForUpdate:async () => match,
      submitRoundInput:async (input) => { inputs.push(input); return { resolver:false }; },
      listRoundInputs:async () => inputs,
      updateMatch:async () => {},
    },
  });
  assert.deepEqual(
    await service.handle('a', {
      op:'submit',
      matchId:'m1',
      round:1,
      actionId:'basic',
      answer:'5',
      requestId:'submit-a',
    }),
    { waiting:true, round:1 },
  );
});

test('a retried submit recovers the already-published round instead of returning ROUND_CHANGED', async () => {
  const { createPvpService } = await import(serviceUrl.href);
  let submittedAgain = false;
  const service = createPvpService({
    now:() => 5000,
    randomInt:(minimum) => minimum,
    store:{
      getMatchForUpdate:async () => ({
        id:'m1', playerAId:'a', playerBId:'b', round:2, phase:'question',
      }),
      findRoundInputByRequest:async () => ({
        matchId:'m1', round:1, userId:'a', requestId:'same-request',
      }),
      listEventsAfter:async () => [
        { id:'m1:1:dice', kind:'dice', round:1, sequenceNo:1000 },
        { id:'m1:1:damage', kind:'damage', round:1, sequenceNo:1001 },
      ],
      submitRoundInput:async () => { submittedAgain = true; },
    },
  });

  const result = await service.handle('a', {
    op:'submit',
    matchId:'m1',
    round:1,
    actionId:'basic',
    answer:'5',
    requestId:'same-request',
  });
  assert.equal(result.resolved, true);
  assert.equal(result.recovered, true);
  assert.equal(result.round, 1);
  assert.equal(result.events.length, 2);
  assert.equal(submittedAgain, false);
});

test('a retried final blow recovers the finished result and event batch', async () => {
  const { createPvpService } = await import(serviceUrl.href);
  const service = createPvpService({
    now:() => 5000,
    randomInt:(minimum) => minimum,
    store:{
      getMatchForUpdate:async () => ({
        id:'m1', playerAId:'a', playerBId:'b', round:1, phase:'finished',
        finishedAt:'2026-07-30T00:00:00Z',
      }),
      findRoundInputByRequest:async () => ({
        matchId:'m1', round:1, userId:'a', requestId:'final-request',
      }),
      listEventsAfter:async () => [
        { id:'m1:1:dice', kind:'dice', round:1, sequenceNo:1000 },
        { id:'m1:1:damage', kind:'damage', round:1, sequenceNo:1001 },
      ],
    },
  });

  const result = await service.handle('a', {
    op:'submit',
    matchId:'m1',
    round:1,
    actionId:'basic',
    answer:'5',
    requestId:'final-request',
  });
  assert.equal(result.finished, true);
  assert.equal(result.recovered, true);
  assert.equal(result.events.length, 2);
});

test('surrender finalizes one opponent win without client record values', async () => {
  const { createPvpService } = await import(serviceUrl.href);
  const calls = [];
  const service = createPvpService({
    now:() => 1000,
    randomInt:(min) => min,
    store:{
      getMatchForUpdate:async () => ({
        id:'m1', playerAId:'a', playerBId:'b', phase:'question', finishedAt:null,
      }),
      finishMatchOnce:async (...args) => { calls.push(args); return true; },
    },
  });
  const result = await service.handle('a', { op:'surrender', matchId:'m1', requestId:'s1' });
  assert.equal(result.finished, true);
  assert.deepEqual(calls, [['m1', 'b', 'a', 'surrender']]);
});

test('resolved simultaneous submissions publish dice before ordered combat effects', async () => {
  const { createPvpService } = await import(serviceUrl.href);
  const appended = [];
  const inputs = [{ userId:'a', actionId:'basic', answer:'5' }];
  const match = {
    id:'m1', playerAId:'a', playerBId:'b', round:1, phase:'waiting',
    deadline:21000, answerKey:'5',
    playerAState:{ userId:'a', name:'A', level:1, className:'warrior', maxHp:100, hp:100, attack:20, defense:0, skills:{}, cooldowns:{}, statuses:{} },
    playerBState:{ userId:'b', name:'B', level:1, className:'warrior', maxHp:100, hp:100, attack:20, defense:0, skills:{}, cooldowns:{}, statuses:{} },
  };
  const rolls = [7, 21];
  const service = createPvpService({
    now:() => 6000,
    randomInt:(minimum) => rolls.shift() ?? minimum,
    store:{
      getMatchForUpdate:async () => match,
      submitRoundInput:async (input) => { inputs.push(input); return { resolver:true }; },
      listRoundInputs:async () => inputs,
      appendEvents:async (_id, _round, events) => appended.push(...events),
      readEnabledWorkbooks:async () => [{ enabled:true, questions:[{ id:'q2', prompt:'3+3', answer:'6' }] }],
      updateMatch:async () => {},
    },
  });
  const result = await service.handle('b', { op:'submit', matchId:'m1', round:1, actionId:'basic', answer:'5', requestId:'b1' });
  assert.equal(result.resolved, true);
  assert.equal(result.round, 1);
  assert.deepEqual(result.events, appended);
  assert.equal(appended[0].kind, 'dice');
  assert.deepEqual(appended[0].rolls, [{ a:7, b:21 }]);
  assert.equal(appended[1].kind, 'action');
  assert.equal(appended[1].source, 'b');
  assert.equal(appended[1].correct, true);
  assert.equal(appended[1].actionId, 'basic');
  assert.equal(appended[1].correctAnswer, '5');
  assert.equal(appended[2].kind, 'damage');
  assert.equal(appended[2].source, 'b');
  assert.equal(appended[3].kind, 'action');
  assert.equal(appended[3].source, 'a');
  assert.equal(appended[4].kind, 'damage');
  assert.equal(appended[4].source, 'a');
});

test('heartbeat resolves an expired unanswered round so neither player can stall forever', async () => {
  const { createPvpService } = await import(serviceUrl.href);
  const calls = [];
  const match = {
    id:'m1', playerAId:'a', playerBId:'b', round:1, phase:'question',
    deadline:5000, answerKey:'5',
    playerAState:{ userId:'a', name:'A', level:1, className:'warrior', maxHp:100, hp:100, attack:20, defense:0, skills:{}, cooldowns:{}, statuses:{} },
    playerBState:{ userId:'b', name:'B', level:1, className:'warrior', maxHp:100, hp:100, attack:20, defense:0, skills:{}, cooldowns:{}, statuses:{} },
  };
  const inputs = [];
  const service = createPvpService({
    now:() => 6000,
    randomInt:(minimum) => minimum,
    store:{
      heartbeat:async () => { calls.push('heartbeat'); return { ok:true }; },
      getMatchForUpdate:async () => match,
      submitRoundInput:async (input) => { inputs.push(input); return { resolver:true }; },
      listRoundInputs:async () => inputs,
      appendEvents:async () => { calls.push('events'); },
      readEnabledWorkbooks:async () => [{ enabled:true, questions:[{ id:'q2', prompt:'3+3', answer:'6' }] }],
      updateMatch:async () => { calls.push('next'); },
    },
  });

  const result = await service.handle('a', { op:'heartbeat', matchId:'m1' });
  assert.deepEqual(calls, ['heartbeat', 'events', 'next']);
  assert.equal(inputs[0].requestId, 'timeout-m1-1-a');
  assert.equal(result.resolved, true);
  assert.equal(result.round, 1);
  assert.equal(result.events[0].kind, 'dice');
});

test('a last-strike submit returns the original round and its public event batch', async () => {
  const { createPvpService } = await import(serviceUrl.href);
  const appended = [];
  const finishes = [];
  const inputs = [{ userId:'a', actionId:'basic', answer:'5' }];
  const match = {
    id:'ko-match', playerAId:'a', playerBId:'b', round:4, phase:'waiting',
    deadline:21000, answerKey:'5',
    playerAState:{ userId:'a', name:'A', level:1, className:'warrior', maxHp:100, hp:100, attack:100, defense:0, skills:{}, cooldowns:{}, statuses:{} },
    playerBState:{ userId:'b', name:'B', level:1, className:'warrior', maxHp:100, hp:10, attack:1, defense:0, skills:{}, cooldowns:{}, statuses:{} },
  };
  const rolls = [30, 1];
  const service = createPvpService({
    now:() => 6000,
    randomInt:(minimum) => rolls.shift() ?? minimum,
    store:{
      getMatchForUpdate:async () => match,
      submitRoundInput:async (input) => { inputs.push(input); return { resolver:true }; },
      listRoundInputs:async () => inputs,
      appendEvents:async (_id, _round, events) => appended.push(...events),
      finishMatchOnce:async (...args) => { finishes.push(args); return true; },
    },
  });

  const result = await service.handle('b', {
    op:'submit', matchId:'ko-match', round:4, actionId:'basic', answer:'5', requestId:'ko-b',
  });
  assert.equal(result.finished, true);
  assert.equal(result.round, 4);
  assert.deepEqual(result.events, appended);
  assert.deepEqual(finishes, [['ko-match', 'a', 'b', 'defeat']]);
});

test('a resolved round cancelled for missing next questions still returns its round and events', async () => {
  const { createPvpService } = await import(serviceUrl.href);
  const inputs = [{ userId:'a', actionId:'basic', answer:'5' }];
  const cancelled = [];
  const match = {
    id:'cancel-match', playerAId:'a', playerBId:'b', round:3, phase:'waiting',
    deadline:21000, answerKey:'5',
    playerAState:{ userId:'a', name:'A', level:1, className:'warrior', maxHp:100, hp:100, attack:10, defense:0, skills:{}, cooldowns:{}, statuses:{} },
    playerBState:{ userId:'b', name:'B', level:1, className:'warrior', maxHp:100, hp:100, attack:10, defense:0, skills:{}, cooldowns:{}, statuses:{} },
  };
  const service = createPvpService({
    now:() => 6000,
    randomInt:(minimum) => minimum,
    store:{
      getMatchForUpdate:async () => match,
      submitRoundInput:async (input) => { inputs.push(input); return { resolver:true }; },
      listRoundInputs:async () => inputs,
      appendEvents:async () => {},
      readEnabledWorkbooks:async () => [],
      cancelMatch:async (...args) => { cancelled.push(args); },
    },
  });

  const result = await service.handle('b', {
    op:'submit', matchId:'cancel-match', round:3, actionId:'basic', answer:'5', requestId:'cancel-b',
  });
  assert.equal(result.cancelled, true);
  assert.equal(result.round, 3);
  assert.equal(result.events[0].kind, 'dice');
  assert.deepEqual(cancelled, [['cancel-match', 'no_questions']]);
});

test('answers cannot be submitted while a disconnected opponent is in the reconnect grace period', async () => {
  const { createPvpService } = await import(serviceUrl.href);
  const service = createPvpService({
    now:() => 6000,
    randomInt:(minimum) => minimum,
    store:{
      getMatchForUpdate:async () => ({
        id:'m1', playerAId:'a', playerBId:'b', round:1, phase:'reconnect',
        deadline:5000,
      }),
    },
  });
  await assert.rejects(
    service.handle('a', { op:'submit', matchId:'m1', round:1, answer:'5' }),
    (error) => error.code === 'RECONNECTING',
  );
});

test('presence returns the caller active match so a refreshed browser can restore it', async () => {
  const { createPvpService } = await import(serviceUrl.href);
  const activeMatch = { id:'m1', playerAId:'a', playerBId:'b', phase:'reconnect' };
  const pendingInvite = {
    id:'invite-1', challenger_id:'b', target_id:'a', status:'pending',
  };
  const service = createPvpService({
    now:() => 6000,
    randomInt:(minimum) => minimum,
    store:{
      upsertPresence:async () => ({ ok:true }),
      findActiveMatchForUser:async (userId) => userId === 'a' ? activeMatch : null,
      getPendingInviteForTarget:async (userId, checkedAt) => {
        assert.equal(userId, 'a');
        assert.equal(checkedAt, 6000);
        return pendingInvite;
      },
      getAuthoritativeProfile:async () => ({ name:'A', map:'town' }),
    },
  });
  assert.deepEqual(
    await service.handle('a', { op:'presence', map:'town', busy:true, publicProfile:{} }),
    { ok:true, activeMatch, pendingInvite },
  );
});

test('presence ignores caller profile and map claims in favor of the saved server profile', async () => {
  const { createPvpService } = await import(serviceUrl.href);
  let saved = null;
  const service = createPvpService({
    now:() => 6000,
    randomInt:(minimum) => minimum,
    store:{
      getAuthoritativeProfile:async () => ({
        name:'서버학생', map:'forest', level:4, className:'mage', attack:20,
      }),
      findActiveMatchForUser:async () => null,
      getPendingInviteForTarget:async () => null,
      upsertPresence:async (_id, value) => { saved = value; return { ok:true }; },
    },
  });
  await service.handle('a', {
    op:'presence',
    map:'town',
    busy:false,
    publicProfile:{ name:'조작', attack:999999 },
  });
  assert.equal(saved.map, 'forest');
  assert.equal(saved.busy, true);
  assert.equal(saved.publicProfile.name, '서버학생');
  assert.equal(saved.publicProfile.attack, 20);
});

test('sync never returns the private answer key to a participant', async () => {
  const { createPvpService } = await import(serviceUrl.href);
  const afterSequences = [];
  const service = createPvpService({
    now:() => 6000,
    randomInt:(minimum) => minimum,
    store:{
      getMatchForUser:async () => ({
        id:'m1', playerAId:'a', playerBId:'b', phase:'question',
        answerKey:'절대 노출 금지', question:{ prompt:'문제' },
      }),
      listEventsAfter:async (_matchId, afterSequence) => {
        afterSequences.push(afterSequence);
        return [{ id:'event-1', kind:'damage', round:1, sequenceNo:1001 }];
      },
    },
  });
  const result = await service.handle('a', { op:'sync', matchId:'m1', afterSequence:-500 });
  assert.equal(Object.hasOwn(result, 'answerKey'), false);
  assert.equal(result.question.prompt, '문제');
  assert.deepEqual(result.replayEvents, [{ id:'event-1', kind:'damage', round:1, sequenceNo:1001 }]);
  const noReplay = await service.handle('a', { op:'sync', matchId:'m1' });
  assert.deepEqual(noReplay.replayEvents, []);
  await service.handle('a', {
    op:'sync',
    matchId:'m1',
    afterSequence:'999999999999999999999999999',
  });
  assert.deepEqual(afterSequences, [0, Number.MAX_SAFE_INTEGER]);
});

test('heartbeat carries the public match and missed events without exposing its answer key', async () => {
  const { createPvpService } = await import(serviceUrl.href);
  const seen = [];
  const match = {
    id:'m1', playerAId:'a', playerBId:'b', phase:'question', round:2,
    deadline:9000, answerKey:'secret-answer', question:{ prompt:'2+2' },
  };
  const service = createPvpService({
    now:() => 6000,
    randomInt:(minimum) => minimum,
    store:{
      heartbeat:async () => ({ ok:true }),
      getMatchForUpdate:async () => match,
      listEventsAfter:async (matchId, afterSequence) => {
        seen.push([matchId, afterSequence]);
        return [{ id:'event-2', kind:'heal', round:1, sequenceNo:1004 }];
      },
    },
  });

  const result = await service.handle('a', {
    op:'heartbeat',
    matchId:'m1',
    afterSequence:1003.9,
  });
  assert.equal(result.ok, true);
  assert.equal(result.match.id, 'm1');
  assert.equal(Object.hasOwn(result.match, 'answerKey'), false);
  assert.deepEqual(result.replayEvents, [{ id:'event-2', kind:'heal', round:1, sequenceNo:1004 }]);
  assert.deepEqual(seen, [['m1', 1003]]);
  const noReplay = await service.handle('a', { op:'heartbeat', matchId:'m1' });
  assert.deepEqual(noReplay.replayEvents, []);
  assert.deepEqual(seen, [['m1', 1003]]);
});
