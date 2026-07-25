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
        subscribe() { channels.push({ channel, handlers }); return channel; },
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

test('match subscription emits each event sequence once and cleans up its channel', () => {
  const { api, channels, removed } = harness();
  const received = [];
  const unsubscribe = api.subscribe('match-1', (event) => received.push(event));
  const eventsHandler = channels[0].handlers.find((entry) => entry.filter.table === 'pvp_match_events_v1').handler;
  eventsHandler({ new:{ sequence_no:3, event:{ kind:'damage' } } });
  eventsHandler({ new:{ sequence_no:3, event:{ kind:'damage' } } });
  eventsHandler({ new:{ sequence_no:4, event:{ kind:'heal' } } });
  assert.deepEqual(received.map((event) => event.sequenceNo), [3, 4]);
  unsubscribe();
  assert.deepEqual(removed, ['pvp-match-match-1']);
});

test('incoming invitation subscription listens only for the signed-in target', () => {
  const { api, channels } = harness();
  const unsubscribe = api.onInvite(() => {});
  const filter = channels[0].handlers[0].filter;
  assert.equal(filter.table, 'pvp_invites_v1');
  assert.equal(filter.filter, 'target_id=eq.student-a');
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
