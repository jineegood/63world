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
      insertRoundInputOnce:async (input) => { inputs.push(input); return true; },
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
