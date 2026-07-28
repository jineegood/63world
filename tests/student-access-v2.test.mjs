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
    setLocalWorkbooks(items) { calls.push(['setLocalWorkbooks', items]); },
    startPolling(options) { calls.push(['startPolling', options]); },
    stopPolling() { calls.push(['stopPolling']); },
    ...overrides.sharedService,
  };
  const authorityService = {
    async loadGame() {
      calls.push(['authorityLoadGame']);
      return { player:{ name:'별빛', level:3, serverRevision:7 }, revision:7 };
    },
    async createCharacter(input) {
      calls.push(['authorityCreateCharacter', input]);
      return { player:{ name:'별빛', level:1, serverRevision:1 }, revision:1 };
    },
    async savePreferences(input) {
      calls.push(['authoritySavePreferences', input]);
      return { player:{ name:'별빛', level:3, serverRevision:8 }, revision:8 };
    },
    async transitionMap(input) {
      calls.push(['authorityTransitionMap', input]);
      return { player:{ name:'별빛', level:3, map:'town', serverRevision:9 }, revision:9 };
    },
    async purchaseItem(input) { calls.push(['authorityPurchaseItem', input]); return { revision:10 }; },
    async equipItem(input) { calls.push(['authorityEquipItem', input]); return { revision:11 }; },
    async unequipSlot(input) { calls.push(['authorityUnequipSlot', input]); return { revision:12 }; },
    async enhanceWeapon(input) { calls.push(['authorityEnhanceWeapon', input]); return { revision:13 }; },
    async chooseSpecialization(input) { calls.push(['authorityChooseSpecialization', input]); return { revision:14 }; },
    async learnSkill(input) { calls.push(['authorityLearnSkill', input]); return { revision:15 }; },
    async summonPet(input) { calls.push(['authoritySummonPet', input]); return { revision:16 }; },
    async setActivePet(input) { calls.push(['authoritySetActivePet', input]); return { revision:17 }; },
    async acceptQuest(input) { calls.push(['authorityAcceptQuest', input]); return { revision:18 }; },
    async claimQuest(input) { calls.push(['authorityClaimQuest', input]); return { revision:19 }; },
    async receiveQuestGift(input) { calls.push(['authorityReceiveQuestGift', input]); return { revision:20 }; },
    ...overrides.authorityService,
  };
  return {
    calls,
    identity,
    clientFactory(url, key) { calls.push(['createClient', url, key]); return { auth:{} }; },
    authApi:{ createAuthService({ client }) { calls.push(['createAuthService', client]); return authService; } },
    cloudApi:{ create({ client, storage }) { calls.push(['createCloudService', client, storage]); return cloudService; } },
    authorityApi:{ create({ client }) { calls.push(['createAuthorityService', client]); return authorityService; } },
    sharedApi:{ create({ client, storage }) { calls.push(['createSharedService', client, storage]); return sharedService; } },
    defaultWorkbooks:[],
    storage:{
      getItem() { return null; },
      setItem() {},
      removeItem(key) { calls.push(['removeItem', key]); },
    },
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

test('v3 flag loads server-authoritative state without reading the writable v2 profile', async () => {
  const api = loadApi();
  const deps = dependencies();
  const service = api.create({
    config:validConfig({ serverAuthorityV3Enabled:true }),
    ...deps,
  });

  const result = await service.enter('별빛', 'secret-123');

  assert.equal(service.authorityV3Enabled, true);
  assert.equal(result.kind, 'existing');
  assert.equal(result.player.serverRevision, 7);
  assert.equal(deps.calls.some(([name]) => name === 'authorityLoadGame'), true);
  assert.equal(deps.calls.some(([name]) => name === 'loadPlayer'), false);
  assert.equal(deps.calls.some(([name]) => name === 'createCloudService'), false);
  assert.equal(
    deps.calls.some(([name]) => name === 'refreshWorkbooks'),
    false,
    'authoritative students must not download workbook answers',
  );
  service.startSharedPolling({});
  const pollingOptions = deps.calls.find(([name]) => name === 'startPolling')?.[1];
  assert.equal(pollingOptions.includeWorkbooks, false);
  assert.deepEqual(
    deps.calls.filter(([name]) => name === 'removeItem').map(([, key]) => key),
    ['ysb_shared_v2_workbooks', 'ysb_workbooks_v3', 'ysb_questions_v2'],
  );
});

test('v3 treats only CHARACTER_NOT_FOUND as a new character', async () => {
  const api = loadApi();
  const missing = Object.assign(new Error('missing'), { code:'CHARACTER_NOT_FOUND' });
  const deps = dependencies({
    authorityService:{ async loadGame() { throw missing; } },
  });
  const service = api.create({
    config:validConfig({ serverAuthorityV3Enabled:true }),
    ...deps,
  });
  const result = await service.enter('별빛', 'secret-123');
  assert.equal(result.kind, 'new');

  const brokenDeps = dependencies({
    authorityService:{ async loadGame() { throw Object.assign(new Error('offline'), { code:'RPC_FAILED' }); } },
  });
  const broken = api.create({
    config:validConfig({ serverAuthorityV3Enabled:true }),
    ...brokenDeps,
  });
  await assert.rejects(broken.enter('별빛', 'secret-123'), (error) => error.code === 'RPC_FAILED');
});

test('v3 exposes only bounded server actions and blocks the legacy whole-player save', async () => {
  const api = loadApi();
  const deps = dependencies();
  const service = api.create({
    config:validConfig({ serverAuthorityV3Enabled:true }),
    ...deps,
  });
  await service.enter('별빛', 'secret-123');

  assert.throws(
    () => service.savePlayer({ gold:999999 }),
    (error) => error.code === 'AUTHORITATIVE_SAVE_REQUIRED',
  );
  const created = await service.createCharacter({
    className:'mage',
    appearance:{ shirt:'#123456' },
  });
  const saved = await service.savePreferences({
    preferences:{ audio:{ bgmVolume:30 } },
    expectedRevision:7,
  });
  const moved = await service.transitionMap({ targetMap:'town', expectedRevision:8 });

  assert.equal(created.revision, 1);
  assert.equal(saved.revision, 8);
  assert.equal(moved.revision, 9);
  assert.equal(deps.calls.some(([name]) => name === 'queueSave'), false);
});

test('v3 forwards bounded economy and skill actions only after authentication', async () => {
  const api = loadApi();
  const deps = dependencies();
  const service = api.create({
    config:validConfig({ serverAuthorityV3Enabled:true }),
    ...deps,
  });
  await assert.rejects(service.purchaseItem({ itemId:'noviceHat' }), (error) => error.code === 'NOT_AUTHENTICATED');
  await service.enter('별빛', 'secret-123');
  await service.purchaseItem({ itemId:'noviceHat' });
  await service.equipItem({ inventoryId:'owned-id' });
  await service.unequipSlot({ inventoryKind:'gear', slot:'head' });
  await service.enhanceWeapon({});
  await service.chooseSpecialization({ specName:'냉기' });
  await service.learnSkill({ skillId:'mage_frost_focus_v24' });
  await service.summonPet({});
  await service.setActivePet({ petId:'chick' });
  assert.deepEqual(
    deps.calls.filter(([name]) => name.startsWith('authority')).map(([name]) => name),
    [
      'authorityLoadGame',
      'authorityPurchaseItem',
      'authorityEquipItem',
      'authorityUnequipSlot',
      'authorityEnhanceWeapon',
      'authorityChooseSpecialization',
      'authorityLearnSkill',
      'authoritySummonPet',
      'authoritySetActivePet',
    ],
  );
});

test('v3 signout skips legacy profile flush and still signs out Auth', async () => {
  const api = loadApi();
  const deps = dependencies();
  const service = api.create({
    config:validConfig({ serverAuthorityV3Enabled:true }),
    ...deps,
  });
  await service.enter('별빛', 'secret-123');
  await service.signOut();

  const important = deps.calls
    .filter(([name]) => ['flush', 'signOut'].includes(name))
    .map(([name]) => name);
  assert.equal(JSON.stringify(important), JSON.stringify(['signOut']));
});

/* [v59] 게임이 부르는 함수가 실제로 존재하는지 대조한다.
   퀘스트 수락이 "is not a function"으로 막혔던 사고를 다시 겪지 않기 위한 그물이다. */
test('every secureStudentAccess call in the game exists on both controllers', () => {
  const gameSource = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
  const used = new Set(
    [...gameSource.matchAll(/secureStudentAccess\.([a-zA-Z_$][\w$]*)/g)].map((match) => match[1]),
  );
  // 속성으로만 읽는 값은 호출 대상이 아니다
  for (const property of ['enabled', 'authorityV3Enabled', 'status']) used.delete(property);
  assert.ok(used.size > 0, 'game.js에서 secureStudentAccess 사용을 찾지 못했습니다');

  const api = loadApi();
  const open = api.create({ config:validConfig({ serverAuthorityV3Enabled:true }), ...dependencies() });
  const closed = api.create({});

  const missingOpen = [...used].filter((name) => typeof open[name] !== 'function');
  assert.deepEqual(missingOpen, [], `열린 상태에 없는 함수: ${missingOpen.join(', ')}`);

  const missingClosed = [...used].filter((name) => typeof closed[name] !== 'function');
  assert.deepEqual(missingClosed, [], `닫힌 상태에 없는 함수: ${missingClosed.join(', ')}`);
});

test('quest actions reach the authority layer instead of vanishing', async () => {
  const api = loadApi();
  const deps = dependencies();
  const controller = api.create({ config:validConfig({ serverAuthorityV3Enabled:true }), ...deps });
  await controller.enter('별빛', 'secret-123');

  const expected = {
    acceptQuest:'authorityAcceptQuest',
    claimQuest:'authorityClaimQuest',
    receiveQuestGift:'authorityReceiveQuestGift',
  };
  for (const [method, authorityCall] of Object.entries(expected)) {
    assert.equal(typeof controller[method], 'function', `${method} 가 없습니다`);
    await controller[method]({ questId:'mushroom_hunt', expectedRevision:1 });
    assert.ok(
      deps.calls.some(([name]) => name === authorityCall),
      `${method} 호출이 서버 판정 계층까지 가지 않았습니다`,
    );
  }
});
