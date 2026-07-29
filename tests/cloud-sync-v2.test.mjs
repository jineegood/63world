import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
  };
}

function loadApi() {
  const file = path.join(root, 'src/cloud-sync-v2.js');
  assert.ok(fs.existsSync(file), 'src/cloud-sync-v2.js must exist');
  const window = {};
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { window }, { filename:'src/cloud-sync-v2.js' });
  return window.YuksamCloudSyncV2;
}

function fakeClient({ loadData = null, loadError = null, updateError = null, throwOnLoad = null,
  claimData = null, claimError = null, throwOnClaim = null } = {}) {
  const calls = [];
  return {
    calls,
    client:{
      async rpc(name) {
        calls.push(['rpc', name]);
        if (throwOnClaim) throw throwOnClaim;
        return { data:claimData, error:claimError };
      },
      from(table) {
        calls.push(['from', table]);
        return {
          select(columns) {
            calls.push(['select', columns]);
            return {
              eq(column, value) {
                calls.push(['loadEq', column, value]);
                return {
                  async maybeSingle() {
                    calls.push(['maybeSingle']);
                    if (throwOnLoad) throw throwOnLoad;
                    return { data:loadData, error:loadError };
                  },
                };
              },
            };
          },
          update(payload) {
            calls.push(['update', payload]);
            return {
              async eq(column, value) {
                calls.push(['updateEq', column, value]);
                return { data:null, error:updateError };
              },
            };
          },
        };
      },
    },
  };
}

test('sanitizePlayerData removes nested sensitive fields without mutating input', () => {
  const api = loadApi();
  const input = {
    name:'별빛', password:'plain', level:3,
    nested:{ currentPassword:'plain', access_token:'token', keep:'yes', optional:undefined },
    list:[{ refresh_token:'token', value:1 }],
  };
  const safe = api.sanitizePlayerData(input);
  assert.equal(JSON.stringify(safe), JSON.stringify({
    name:'별빛', level:3, nested:{ keep:'yes' }, list:[{ value:1 }],
  }));
  assert.equal(input.password, 'plain');
  assert.equal(input.nested.access_token, 'token');
});

test('sanitizePlayerData rejects circular and non-JSON player values', () => {
  const api = loadApi();
  const circular = { name:'별빛' };
  circular.self = circular;
  assert.throws(() => api.sanitizePlayerData(circular), /저장/);
  assert.throws(() => api.sanitizePlayerData({ name:'별빛', bad:1n }), /저장/);
  assert.throws(() => api.sanitizePlayerData({ name:'별빛', bad() {} }), /저장/);
});

test('queueSave writes a user-isolated safe cache synchronously', () => {
  const api = loadApi();
  const storage = memoryStorage();
  const remote = fakeClient();
  const scheduled = [];
  const service = api.create({
    client:remote.client,
    storage,
    schedule(fn) { scheduled.push(fn); return scheduled.length; },
    cancelSchedule() {},
  });
  service.queueSave('user-a', { name:'별빛', password:'plain', level:2 });
  const cached = storage.getItem('ysb_player_v2_user-a');
  assert.equal(cached, JSON.stringify({ name:'별빛', level:2 }));
  assert.equal(storage.getItem('ysb_player_v2_user-b'), null);
  assert.equal(scheduled.length, 1);
});

test('loadPlayer reads only the authenticated profile data and refreshes that cache', async () => {
  const api = loadApi();
  const storage = memoryStorage({ 'ysb_player_v2_user-b':'{"name":"other"}' });
  const remote = fakeClient({ loadData:{ data:{ name:'별빛', level:4 }, updated_at:'2026-07-23T00:00:00Z' } });
  const service = api.create({ client:remote.client, storage });
  const result = await service.loadPlayer('user-a');
  assert.equal(JSON.stringify(result), JSON.stringify({
    player:{ name:'별빛', level:4 }, source:'remote', offline:false,
  }));
  assert.deepEqual(remote.calls.slice(0, 5), [
    ['rpc', 'claim_student_rewards_v2'],
    ['from', 'player_profiles_v2'],
    ['select', 'data,updated_at'],
    ['loadEq', 'user_id', 'user-a'],
    ['maybeSingle'],
  ]);
  assert.equal(storage.getItem('ysb_player_v2_user-a'), JSON.stringify({ name:'별빛', level:4 }));
  assert.equal(storage.getItem('ysb_player_v2_user-b'), '{"name":"other"}');
});

test('loadPlayer uses the atomic claimed profile without a second profile read', async () => {
  const api = loadApi();
  const remote = fakeClient({ claimData:{ name:'별빛', level:5, gold:99 } });
  const service = api.create({ client:remote.client, storage:memoryStorage() });
  const result = await service.loadPlayer('user-a');
  assert.equal(JSON.stringify(result), JSON.stringify({
    player:{ name:'별빛', level:5, gold:99 }, source:'remote', offline:false,
  }));
  assert.deepEqual(remote.calls, [['rpc', 'claim_student_rewards_v2']]);
});

test('reward claim database and authorization failures do not use stale cache', async () => {
  const api = loadApi();
  const storage = memoryStorage({ 'ysb_player_v2_user-a':'{"name":"cached"}' });
  const remote = fakeClient({ claimError:{ code:'42501', message:'permission denied' } });
  await assert.rejects(
    api.create({ client:remote.client, storage }).loadPlayer('user-a'),
    (error) => error.code === 'LOAD_FAILED',
  );
});

test('loadPlayer uses only the same user cache for a genuine network failure', async () => {
  const api = loadApi();
  const storage = memoryStorage({
    'ysb_player_v2_user-a':'{"name":"별빛","level":2}',
    'ysb_player_v2_user-b':'{"name":"other","level":9}',
  });
  const remote = fakeClient({ throwOnLoad:new TypeError('Failed to fetch') });
  const service = api.create({ client:remote.client, storage });
  assert.equal(JSON.stringify(await service.loadPlayer('user-a')), JSON.stringify({
    player:{ name:'별빛', level:2 }, source:'cache', offline:true,
  }));
  await assert.rejects(
    api.create({ client:remote.client, storage:memoryStorage() }).loadPlayer('user-a'),
    (error) => error.code === 'OFFLINE',
  );
});

test('authorization errors never fall back to cache', async () => {
  const api = loadApi();
  const storage = memoryStorage({ 'ysb_player_v2_user-a':'{"name":"cached"}' });
  const remote = fakeClient({ loadError:{ code:'42501', message:'permission denied' } });
  const service = api.create({ client:remote.client, storage });
  await assert.rejects(service.loadPlayer('user-a'), (error) => error.code === 'LOAD_FAILED');
});

test('flush updates only data and updated_at for the authenticated user', async () => {
  const api = loadApi();
  const storage = memoryStorage();
  const remote = fakeClient();
  const service = api.create({ client:remote.client, storage, schedule() { return 1; }, cancelSchedule() {} });
  service.queueSave('user-a', { name:'별빛', password:'plain', level:5 });
  await service.flush();
  const update = remote.calls.find(([name]) => name === 'update');
  assert.equal(JSON.stringify(update[1].data), JSON.stringify({ name:'별빛', level:5 }));
  assert.match(update[1].updated_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(Object.hasOwn(update[1], 'user_id'), false);
  assert.deepEqual(remote.calls.at(-1), ['updateEq', 'user_id', 'user-a']);
});

test('overlapping flushes serialize saves and leave the newest character on the server', async () => {
  const api = loadApi();
  const requests = [];
  const client = {
    async rpc() { return { data:null, error:null }; },
    from() {
      return {
        update(payload) {
          return {
            eq(_column, userId) {
              return new Promise((resolve) => {
                requests.push({ payload, userId, resolve });
              });
            },
          };
        },
      };
    },
  };
  const service = api.create({
    client,
    storage:memoryStorage(),
    schedule() { return 1; },
    cancelSchedule() {},
  });
  service.queueSave('user-a', { name:'별빛', level:1, map:'forest' });
  let firstDone = false;
  const firstFlush = service.flush().then(() => { firstDone = true; });
  await Promise.resolve();
  assert.equal(requests.length, 1);

  service.queueSave('user-a', { name:'별빛', level:3, map:'town' });
  const secondFlush = service.flush();
  await Promise.resolve();
  assert.equal(requests.length, 1, 'the newer save must wait for the in-flight save');

  requests[0].resolve({ data:null, error:null });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(requests.length, 2);
  assert.equal(firstDone, false, 'all flush callers wait until the newest pending save is stored');
  assert.equal(JSON.stringify(requests[1].payload.data), JSON.stringify({
    name:'별빛', level:3, map:'town',
  }));

  requests[1].resolve({ data:null, error:null });
  await Promise.all([firstFlush, secondFlush]);
  assert.equal(firstDone, true);
});

test('flush surfaces a remote save failure', async () => {
  const api = loadApi();
  const remote = fakeClient({ updateError:{ code:'42501', message:'permission denied' } });
  const service = api.create({ client:remote.client, storage:memoryStorage(), schedule() { return 1; }, cancelSchedule() {} });
  service.queueSave('user-a', { name:'별빛' });
  await assert.rejects(service.flush(), (error) => error.code === 'SAVE_FAILED');
});

test('clearCache removes only the requested user cache', () => {
  const api = loadApi();
  const storage = memoryStorage({
    'ysb_player_v2_user-a':'{}',
    'ysb_player_v2_user-b':'{}',
  });
  const service = api.create({ client:fakeClient().client, storage });
  service.clearCache('user-a');
  assert.equal(storage.getItem('ysb_player_v2_user-a'), null);
  assert.equal(storage.getItem('ysb_player_v2_user-b'), '{}');
});
