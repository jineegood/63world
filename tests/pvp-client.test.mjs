import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/pvp-client.js'), 'utf8');
const gameSource = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function harness() {
  const invokes = [];
  const removed = [];
  const channels = [];
  const client = {
    auth:{
      async getUser() {
        return { data:{ user:{ id:'student-a' } }, error:null };
      },
    },
    functions:{
      async invoke(name, options) {
        invokes.push({ name, body:options.body });
        return { data:{ data:{ ok:true } }, error:null };
      },
    },
    channel(name) {
      const handlers = [];
      const channel = {
        name,
        on(type, filter, handler) { handlers.push({ type, filter, handler }); return channel; },
        subscribe(onStatus) { channels.push({ channel, handlers, onStatus }); return channel; },
      };
      return channel;
    },
    removeChannel(channel) { removed.push(channel.name); },
  };
  const window = {};
  vm.runInNewContext(source, { window });
  const api = window.YuksamPvpClient.create({
    client,
    getIdentity:() => ({ userId:'student-a', displayName:'별빛', role:'student' }),
  });
  return { api, invokes, channels, removed };
}

test('PvP requests invoke only the secure endpoint and never send caller records', async () => {
  const { api, invokes } = harness();
  await api.invite('student-b');
  await api.surrender('match-1');
  assert.equal(invokes.every((call) => call.name === 'pvp-match-v1'), true);
  assert.equal(invokes[0].body.targetUserId, 'student-b');
  for (const call of invokes) {
    assert.equal('userId' in call.body, false);
    assert.equal('wins' in call.body, false);
    assert.equal('losses' in call.body, false);
  }
});

test('server response codes inside an Edge Function error replace the generic connection message', async () => {
  const window = {};
  vm.runInNewContext(source, { window, setTimeout });
  const response = {
    clone() { return this; },
    async json() { return { error:'NO_QUESTIONS' }; },
  };
  const api = window.YuksamPvpClient.create({
    client:{
      functions:{ invoke:async () => ({
        data:null,
        error:{ message:'Edge Function returned a non-2xx status code', context:response },
      }) },
    },
    getIdentity:() => ({ userId:'student-a' }),
  });
  await assert.rejects(
    api.invite('student-b'),
    (error) => error.code === 'NO_QUESTIONS' && error.message !== '대전 서버에 연결하지 못했어요.',
  );
});

test('a transient Edge Function connection failure retries the exact same request once', async () => {
  const window = {};
  const bodies = [];
  let attempts = 0;
  vm.runInNewContext(source, {
    window,
    setTimeout:(callback) => callback(),
  });
  const api = window.YuksamPvpClient.create({
    client:{
      functions:{ invoke:async (_name, options) => {
        attempts += 1;
        bodies.push(options.body);
        if (attempts === 1) throw new TypeError('Failed to fetch');
        return { data:{ data:{ ok:true } }, error:null };
      } },
    },
    getIdentity:() => ({ userId:'student-a' }),
  });
  assert.deepEqual(await api.profile('student-b'), { ok:true });
  assert.equal(attempts, 2);
  assert.deepEqual(bodies[0], bodies[1]);
});

test('challenge and acceptance stop before the server when another tab changed the login account', async () => {
  const window = {};
  let invokes = 0;
  vm.runInNewContext(source, { window, setTimeout });
  const api = window.YuksamPvpClient.create({
    client:{
      auth:{
        async getUser() {
          return { data:{ user:{ id:'student-other-tab' } }, error:null };
        },
      },
      functions:{
        async invoke() {
          invokes += 1;
          return { data:{ data:{ ok:true } }, error:null };
        },
      },
    },
    getIdentity:() => ({ userId:'student-a' }),
  });
  await assert.rejects(
    api.invite('student-b'),
    (error) => error.code === 'SESSION_CHANGED' && error.message.includes('다시 로그인'),
  );
  await assert.rejects(
    api.respond('invite-1', true),
    (error) => error.code === 'SESSION_CHANGED',
  );
  assert.equal(invokes, 0);
});

test('match subscription emits each event sequence once, including out-of-order delivery, and cleans up its channel', () => {
  const { api, channels, removed } = harness();
  const received = [];
  const unsubscribe = api.subscribe('match-1', (event) => received.push(event));
  const eventsHandler = channels[0].handlers.find((entry) => entry.filter.table === 'pvp_match_events_v1').handler;
  eventsHandler({ new:{ sequence_no:3, round_no:7, event:{ kind:'damage' } } });
  eventsHandler({ new:{ sequence_no:3, round_no:7, event:{ kind:'damage' } } });
  eventsHandler({ new:{ sequence_no:5, round_no:7, event:{ kind:'heal' } } });
  eventsHandler({ new:{ sequence_no:4, round_no:7, event:{ kind:'dice' } } });
  eventsHandler({ new:{ sequence_no:4, round_no:7, event:{ kind:'dice' } } });
  assert.deepEqual(received.map((event) => event.sequenceNo), [3, 5, 4]);
  assert.deepEqual(received.map((event) => event.round), [7, 7, 7]);
  unsubscribe();
  assert.deepEqual(removed, ['pvp-match-match-1']);
});

test('incoming invitation subscription listens only for the signed-in target', () => {
  const { api, channels } = harness();
  let ready = false;
  const unsubscribe = api.onInvite(() => {}, () => { ready = true; });
  const filters = channels[0].handlers.map((entry) => entry.filter.filter);
  assert.deepEqual(filters, ['target_id=eq.student-a', 'challenger_id=eq.student-a']);
  channels[0].onStatus('SUBSCRIBED');
  assert.equal(ready, true);
  unsubscribe();
});

test('game lazily creates one authenticated PvP client and clears it on logout', () => {
  assert.match(gameSource, /window\.getPvpIdentityV1\s*=/);
  assert.match(gameSource, /window\.getPvpClientV1\s*=/);
  assert.match(gameSource, /YuksamPvpClient\.create\(/);
  assert.match(gameSource, /pvpClientV1\?\.close\(\)/);
  const accessIndex = htmlSource.indexOf('src/student-access-v2.js');
  const pvpIndex = htmlSource.indexOf('src/pvp-client.js');
  const gameIndex = htmlSource.indexOf('game.js');
  assert.ok(accessIndex < pvpIndex && pvpIndex < gameIndex);
});
