import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const serviceUrl = pathToFileURL(path.join(root, 'supabase/functions/_shared/pvp-service.mjs'));

test('Edge endpoint verifies JWT identity and never trusts a caller user id', () => {
  const source = fs.readFileSync(path.join(root, 'supabase/functions/pvp-match-v1/index.ts'), 'utf8');
  const config = fs.readFileSync(path.join(root, 'supabase/config.toml'), 'utf8');
  assert.match(source, /npm:@supabase\/supabase-js@2\.110\.8/);
  assert.match(source, /auth\.getUser\(\)/);
  assert.match(source, /Deno\.env\.get\(['"]SUPABASE_SERVICE_ROLE_KEY['"]\)/);
  assert.doesNotMatch(source, /body\.(?:userId|callerId)/);
  assert.match(source, /request\.method\s*!==\s*['"]POST['"]/);
  assert.match(config, /\[functions\.pvp-match-v1\][\s\S]*verify_jwt\s*=\s*true/);
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
  await service.handle('b', { op:'submit', matchId:'m1', round:1, actionId:'basic', answer:'5', requestId:'b1' });
  assert.equal(appended[0].kind, 'dice');
  assert.deepEqual(appended[0].rolls, [{ a:7, b:21 }]);
  assert.equal(appended[1].kind, 'damage');
  assert.equal(appended[1].source, 'b');
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

  await service.handle('a', { op:'heartbeat', matchId:'m1' });
  assert.deepEqual(calls, ['heartbeat', 'events', 'next']);
  assert.equal(inputs[0].requestId, 'timeout-m1-1-a');
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
  const service = createPvpService({
    now:() => 6000,
    randomInt:(minimum) => minimum,
    store:{
      upsertPresence:async () => ({ ok:true }),
      findActiveMatchForUser:async (userId) => userId === 'a' ? activeMatch : null,
      getAuthoritativeProfile:async () => ({ name:'A', map:'town' }),
    },
  });
  assert.deepEqual(
    await service.handle('a', { op:'presence', map:'town', busy:true, publicProfile:{} }),
    { ok:true, activeMatch },
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
  const service = createPvpService({
    now:() => 6000,
    randomInt:(minimum) => minimum,
    store:{
      getMatchForUser:async () => ({
        id:'m1', playerAId:'a', playerBId:'b', phase:'question',
        answerKey:'절대 노출 금지', question:{ prompt:'문제' },
      }),
    },
  });
  const result = await service.handle('a', { op:'sync', matchId:'m1' });
  assert.equal(Object.hasOwn(result, 'answerKey'), false);
  assert.equal(result.question.prompt, '문제');
});
