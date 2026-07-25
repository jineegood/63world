import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');

function loadApi() {
  const file = path.join(root, 'src/student-access-v2.js');
  assert.ok(fs.existsSync(file), 'src/student-access-v2.js must exist');
  const window = {};
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { window }, { filename:'src/student-access-v2.js' });
  return window.YuksamStudentAccessV2;
}

function dependencies(overrides = {}) {
  const calls = [];
  const identity = { userId:'user-a', displayName:'별빛', role:'student' };
  const authService = {
    async enterStudent() { calls.push(['enterStudent']); return { identity, isNewAccount:false }; },
    async restoreSession() { calls.push(['restoreSession']); return identity; },
    async signOut() { calls.push(['signOut']); },
    ...overrides.authService,
  };
  const cloudService = {
    async loadPlayer(userId) { calls.push(['loadPlayer', userId]); return { player:{ name:'별빛', level:3 }, source:'remote', offline:false }; },
    queueSave(userId, player) { calls.push(['queueSave', userId, player]); },
    async flush() { calls.push(['flush']); },
    ...overrides.cloudService,
  };
  const sharedService = {
    async refreshClassroomSettings() { calls.push(['refreshClassroomSettings']); return { serverOpen:true, source:'remote' }; },
    async refreshWorkbooks() { calls.push(['refreshWorkbooks']); return { workbooks:[], source:'remote' }; },
    getServerOpen() { return true; },
    getWorkbooks() { return []; },
    startPolling(options) { calls.push(['startPolling', options]); },
    stopPolling() { calls.push(['stopPolling']); },
    ...overrides.sharedService,
  };
  return {
    calls,
    identity,
    clientFactory(url, key) { calls.push(['createClient', url, key]); return { auth:{} }; },
    authApi:{ createAuthService({ client }) { calls.push(['createAuthService', client]); return authService; } },
    cloudApi:{ create({ client, storage }) { calls.push(['createCloudService', client, storage]); return cloudService; } },
    sharedApi:{ create({ client, storage }) { calls.push(['createSharedService', client, storage]); return sharedService; } },
    defaultWorkbooks:[],
    storage:{ getItem() { return null; }, setItem() {}, removeItem() {} },
  };
}

function validConfig(overrides = {}) {
  return {
    securityV2Enabled:true,
    url:'https://project.supabase.co/rest/v1/',
    anonKey:'publishable-key-that-is-long-enough',
    ...overrides,
  };
}

test('disabled configuration constructs no Supabase client', () => {
  const api = loadApi();
  const deps = dependencies();
  const service = api.create({ config:{ securityV2Enabled:false }, ...deps });
  assert.equal(service.enabled, false);
  assert.equal(service.status, 'off');
  assert.equal(deps.calls.length, 0);
});

test('enabled but invalid configuration stays closed without constructing a client', async () => {
  const api = loadApi();
  const deps = dependencies();
  const service = api.create({ config:validConfig({ url:'' }), ...deps });
  assert.equal(service.enabled, false);
  assert.equal(service.status, 'misconfigured');
  assert.equal(deps.calls.length, 0);
  await assert.rejects(service.enter('별빛', 'secret-123'), (error) => error.code === 'CONFIG' && /설정/.test(error.message));
});

test('ready controller normalizes the project URL and constructs one dependency chain', () => {
  const api = loadApi();
  const deps = dependencies();
  const service = api.create({ config:validConfig(), ...deps });
  assert.equal(service.enabled, true);
  assert.equal(service.status, 'ready');
  assert.equal(deps.calls[0][0], 'createClient');
  assert.equal(deps.calls[0][1], 'https://project.supabase.co');
  assert.equal(deps.calls.filter(([name]) => name === 'createClient').length, 1);
});

test('closed classroom rejects before any Auth login or signup attempt', async () => {
  const api = loadApi();
  const deps = dependencies({ sharedService:{
    async refreshClassroomSettings() { deps.calls.push(['refreshClassroomSettings']); return { serverOpen:false, source:'remote' }; },
  } });
  const service = api.create({ config:validConfig(), ...deps });
  await assert.rejects(service.enter('별빛', 'secret-123'), (error) => error.code === 'SERVER_CLOSED');
  assert.equal(deps.calls.some(([name]) => name === 'enterStudent'), false);
});

test('open classroom refreshes authenticated workbooks before loading a profile', async () => {
  const api = loadApi();
  const deps = dependencies();
  const service = api.create({ config:validConfig(), ...deps });
  await service.enter('별빛', 'secret-123');
  const names = deps.calls.map(([name]) => name);
  assert.equal(names.includes('refreshClassroomSettings'), true);
  assert.equal(names.includes('refreshWorkbooks'), true);
  assert.ok(names.indexOf('refreshClassroomSettings') < names.indexOf('enterStudent'));
  assert.ok(names.indexOf('refreshWorkbooks') < names.indexOf('loadPlayer'));
});

test('existing account returns only its authenticated profile', async () => {
  const api = loadApi();
  const deps = dependencies();
  const service = api.create({ config:validConfig(), ...deps });
  const result = await service.enter('별빛', 'secret-123');
  assert.equal(JSON.stringify(result), JSON.stringify({
    kind:'existing', identity:deps.identity, player:{ name:'별빛', level:3 }, offline:false,
  }));
  assert.deepEqual(deps.calls.filter(([name]) => name === 'loadPlayer')[0], ['loadPlayer', 'user-a']);
});

test('new account or empty profile returns character creation', async () => {
  const api = loadApi();
  const deps = dependencies({
    authService:{ async enterStudent() { return { identity:{ userId:'user-a', displayName:'별빛', role:'student' }, isNewAccount:true }; } },
    cloudService:{ async loadPlayer() { throw new Error('new account should not load a profile'); } },
  });
  const service = api.create({ config:validConfig(), ...deps });
  const result = await service.enter('별빛', 'secret-123');
  assert.equal(result.kind, 'new');
  assert.equal(result.identity.userId, 'user-a');
});

test('authenticated same-user session may load its isolated cache while offline', async () => {
  const api = loadApi();
  const offline = Object.assign(new Error('offline'), { code:'OFFLINE' });
  const deps = dependencies({
    authService:{
      async enterStudent() { throw offline; },
      async restoreSession() { return { userId:'user-a', displayName:'별빛', role:'student' }; },
    },
    cloudService:{
      async loadPlayer() { return { player:{ name:'별빛', level:2 }, source:'cache', offline:true }; },
    },
  });
  const service = api.create({ config:validConfig(), ...deps });
  const result = await service.enter(' 별빛 ', 'secret-123');
  assert.equal(result.kind, 'existing');
  assert.equal(result.offline, true);
  assert.equal(result.player.level, 2);
});

test('offline session for another displayed name cannot enter', async () => {
  const api = loadApi();
  const offline = Object.assign(new Error('offline'), { code:'OFFLINE' });
  const deps = dependencies({
    authService:{
      async enterStudent() { throw offline; },
      async restoreSession() { return { userId:'user-b', displayName:'다른학생', role:'student' }; },
    },
  });
  const service = api.create({ config:validConfig(), ...deps });
  await assert.rejects(service.enter('별빛', 'secret-123'), (error) => error.code === 'OFFLINE');
  assert.equal(deps.calls.some(([name]) => name === 'loadPlayer'), false);
});

test('save requires an authenticated identity and signout flushes before Auth logout', async () => {
  const api = loadApi();
  const deps = dependencies();
  const service = api.create({ config:validConfig(), ...deps });
  assert.throws(() => service.savePlayer({ name:'별빛' }), /로그인/);
  await service.enter('별빛', 'secret-123');
  service.savePlayer({ name:'별빛', level:4 });
  await service.signOut();
  const important = deps.calls.filter(([name]) => ['queueSave', 'flush', 'signOut'].includes(name));
  assert.deepEqual(important.map(([name]) => name), ['queueSave', 'flush', 'signOut']);
  assert.equal(important[0][1], 'user-a');
  assert.throws(() => service.savePlayer({ name:'별빛' }), /로그인/);
});

test('authenticated PvP boundary exposes only a frozen identity copy and the existing client', async () => {
  const api = loadApi();
  const deps = dependencies();
  const service = api.create({ config:validConfig(), ...deps });
  assert.equal(service.getIdentity(), null);
  assert.equal(service.getClient(), null);
  await service.enter('별빛', 'secret-123');
  const first = service.getIdentity();
  assert.equal(Object.isFrozen(first), true);
  assert.equal(JSON.stringify(first), JSON.stringify(deps.identity));
  assert.notEqual(first, deps.identity);
  assert.equal(service.getClient()?.auth != null, true);
  await service.signOut();
  assert.equal(service.getIdentity(), null);
  assert.equal(service.getClient(), null);
});

test('closed controller exposes no authenticated PvP boundary', () => {
  const api = loadApi();
  const service = api.create({ config:{ securityV2Enabled:false } });
  assert.equal(service.getIdentity(), null);
  assert.equal(service.getClient(), null);
});
