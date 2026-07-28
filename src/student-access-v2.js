(function installStudentAccessV2(global) {
  'use strict';

  class StudentAccessV2Error extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'StudentAccessV2Error';
      this.code = code;
    }
  }

  function normalizeProjectUrl(value) {
    if (typeof value !== 'string') return '';
    return value.trim().replace(/\/+$/, '').replace(/\/rest\/v1$/i, '');
  }

  function simpleNormalizeName(value) {
    return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ko-KR');
  }

  function closedController(status, error) {
    async function reject() { throw error; }
    function rejectSync() { throw error; }
    return Object.freeze({
      enabled:false,
      status,
      enter:reject,
      loadHallOfFame:reject,
      savePlayer:rejectSync,
      flush:reject,
      signOut:reject,
      refreshClassroomSettings:reject,
      isServerOpen:() => true,
      getWorkbooks:() => Object.freeze([]),
      setLocalWorkbooks:rejectSync,
      startSharedPolling() {},
      stopSharedPolling() {},
      getIdentity:() => null,
      getClient:() => null,
    });
  }

  function create({ config, clientFactory, authApi, cloudApi, sharedApi, storage, defaultWorkbooks } = {}) {
    if (config?.securityV2Enabled !== true) {
      return closedController('off', new StudentAccessV2Error('DISABLED', '새 보안 로그인이 아직 켜지지 않았어요.'));
    }

    const projectUrl = normalizeProjectUrl(config.url);
    const anonKey = typeof config.anonKey === 'string' ? config.anonKey.trim() : '';
    if (!/^https:\/\/[^/]+$/i.test(projectUrl) || anonKey.length < 20
      || typeof clientFactory !== 'function'
      || typeof authApi?.createAuthService !== 'function'
      || typeof cloudApi?.create !== 'function'
      || typeof sharedApi?.create !== 'function') {
      return closedController(
        'misconfigured',
        new StudentAccessV2Error('CONFIG', '새 보안 로그인 설정을 확인해 주세요.'),
      );
    }

    const client = clientFactory(projectUrl, anonKey);
    const auth = authApi.createAuthService({ client });
    const cloud = cloudApi.create({ client, storage });
    const shared = sharedApi.create({ client, storage, defaultWorkbooks });
    let currentIdentity = null;

    const normalizeName = typeof authApi.normalizeStudentName === 'function'
      ? authApi.normalizeStudentName
      : simpleNormalizeName;

    async function enter(name, password) {
      const classroom = await shared.refreshClassroomSettings();
      if (!classroom.serverOpen) {
        throw new StudentAccessV2Error('SERVER_CLOSED', '지금은 서버가 닫혀 있어요. 선생님이 열어주면 접속할 수 있어요.');
      }
      let entered;
      try {
        entered = await auth.enterStudent(name, password);
      } catch (error) {
        if (error?.code !== 'OFFLINE') throw error;
        const restored = await auth.restoreSession();
        if (!restored || normalizeName(restored.displayName) !== normalizeName(name)) throw error;
        entered = { identity:restored, isNewAccount:false };
      }

      currentIdentity = entered.identity;
      try {
        await shared.refreshWorkbooks();
      } catch (error) {
        currentIdentity = null;
        throw error;
      }
      if (entered.isNewAccount) {
        return Object.freeze({ kind:'new', identity:currentIdentity });
      }

      try {
        const loaded = await cloud.loadPlayer(currentIdentity.userId);
        if (!loaded) return Object.freeze({ kind:'new', identity:currentIdentity });
        return Object.freeze({
          kind:'existing',
          identity:currentIdentity,
          player:loaded.player,
          offline:Boolean(loaded.offline),
        });
      } catch (error) {
        currentIdentity = null;
        throw error;
      }
    }

    function savePlayer(player) {
      if (!currentIdentity) throw new StudentAccessV2Error('NOT_AUTHENTICATED', '로그인한 뒤 캐릭터를 저장할 수 있어요.');
      cloud.queueSave(currentIdentity.userId, player);
    }

    async function loadHallOfFame() {
      const { data, error } = await client.rpc('load_hall_of_fame_v2');
      if (error) throw new Error('명예의 전당 기록을 불러오지 못했어요.');
      return Array.isArray(data) ? data : [];
    }

    async function flush() {
      await cloud.flush();
    }

    async function signOut() {
      try {
        await cloud.flush();
        await auth.signOut();
      } finally {
        currentIdentity = null;
      }
    }

    return Object.freeze({
      enabled:true,
      status:'ready',
      enter,
      loadHallOfFame,
      savePlayer,
      flush,
      signOut,
      refreshClassroomSettings:shared.refreshClassroomSettings,
      isServerOpen:shared.getServerOpen,
      getWorkbooks:shared.getWorkbooks,
      setLocalWorkbooks:shared.setLocalWorkbooks,
      startSharedPolling:shared.startPolling,
      stopSharedPolling:shared.stopPolling,
      getIdentity:() => currentIdentity ? Object.freeze({
        userId:currentIdentity.userId,
        displayName:currentIdentity.displayName,
        role:currentIdentity.role,
      }) : null,
      getClient:() => currentIdentity ? client : null,
    });
  }

  global.YuksamStudentAccessV2 = Object.freeze({
    StudentAccessV2Error,
    normalizeProjectUrl,
    create,
  });
})(window);
