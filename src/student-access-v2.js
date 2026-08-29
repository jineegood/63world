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

  const HALL_SCOPES = new Set(['all', 'warrior', 'mage', 'priest', 'raid', 'pvp']);

  function normalizeHallScope(value) {
    const scope = String(value == null ? 'all' : value).trim().toLowerCase();
    return HALL_SCOPES.has(scope) ? scope : 'all';
  }

  function safeHallText(value, maximum) {
    return typeof value === 'string' ? value.normalize('NFKC').trim().slice(0, maximum) : '';
  }

  function safeHallInteger(value, minimum, maximum, fallback = minimum) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(minimum, Math.min(maximum, Math.trunc(number)));
  }

  function copyHallObject(value, maximumBytes = 32768) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    try {
      const serialized = JSON.stringify(value);
      if (serialized.length > maximumBytes) return {};
      const copied = JSON.parse(serialized);
      return copied && typeof copied === 'object' && !Array.isArray(copied) ? copied : {};
    } catch {
      return {};
    }
  }

  function sanitizeHallEntry(row, scope) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    const classId = safeHallText(row.class, 20);
    const name = safeHallText(row.name, 20);
    if (!name || !['warrior', 'mage', 'priest'].includes(classId)) return null;

    const nameplate = copyHallObject(row.nameplate, 2048);
    const nameplateTheme = safeHallText(nameplate.theme, 80) || 'default';
    const result = {
      name,
      class:classId,
      spec:safeHallText(row.spec, 40) || null,
      level:safeHallInteger(row.level, 1, 100, 1),
      exp:safeHallInteger(row.exp, 0, 2147483647, 0),
      gold:safeHallInteger(row.gold, 0, 2147483647, 0),
      appearance:copyHallObject(row.appearance),
      equipment:copyHallObject(row.equipment),
      costume:copyHallObject(row.costume),
      weaponUpgrades:copyHallObject(row.weaponUpgrades, 8192),
      activePet:safeHallText(row.activePet, 80) || null,
      nameplate:{ ...nameplate, theme:nameplateTheme },
    };

    if (scope === 'raid') {
      result.floorGroup = safeHallInteger(row.floorGroup, 1, 7, 1);
      result.reachedFloor = safeHallInteger(row.reachedFloor, 1, 63, 1);
      result.encounterIndex = safeHallInteger(row.encounterIndex, 0, 20, 0);
      result.cleared = row.cleared === true;
    } else if (scope === 'pvp') {
      result.wins = safeHallInteger(row.wins, 0, 2147483647, 0);
      result.losses = safeHallInteger(row.losses, 0, 2147483647, 0);
    }
    return Object.freeze(result);
  }

  function closedController(status, error) {
    async function reject() { throw error; }
    function rejectSync() { throw error; }
    return Object.freeze({
      enabled:false,
      status,
      enter:reject,
      loadHallOfFame:reject,
      performWorldSpecialAction:reject,
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

  function create({
    config,
    clientFactory,
    authApi,
    cloudApi,
    sharedApi,
    storage,
    authStorage,
    defaultWorkbooks,
  } = {}) {
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

    const authOptions = {
      storageKey:'ysb_student_auth_v2',
      persistSession:true,
      autoRefreshToken:true,
      detectSessionInUrl:false,
    };
    if (authStorage && typeof authStorage.getItem === 'function') {
      authOptions.storage = authStorage;
    }
    const client = clientFactory(projectUrl, anonKey, { auth:authOptions });
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
        const workbookSync = await shared.refreshWorkbooks();
        if (workbookSync?.source !== 'remote' || workbookSync?.offline === true) {
          throw new StudentAccessV2Error(
            'WORKBOOK_SYNC_REQUIRED',
            '선생님 문제집을 동기화하지 못했어요. 인터넷 연결을 확인한 뒤 다시 로그인해 주세요.',
          );
        }
      } catch (error) {
        currentIdentity = null;
        try { await auth.signOut(); } catch {}
        if (error?.code === 'WORKBOOK_SYNC_REQUIRED') throw error;
        const syncError = new StudentAccessV2Error(
          'WORKBOOK_SYNC_REQUIRED',
          '선생님 문제집을 동기화하지 못했어요. 인터넷 연결을 확인한 뒤 다시 로그인해 주세요.',
        );
        syncError.cause = error;
        throw syncError;
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

    async function loadHallOfFame(scope = 'all') {
      const normalizedScope = normalizeHallScope(scope);
      const { data, error } = await client.rpc('load_hall_of_fame_v4', {
        p_scope:normalizedScope,
      });
      if (error) throw new Error('명예의 전당 기록을 불러오지 못했어요.');
      if (!Array.isArray(data)) return [];
      return data
        .map((row) => sanitizeHallEntry(row, normalizedScope))
        .filter(Boolean)
        .slice(0, 5);
    }

    async function performWorldSpecialAction(action, requestId) {
      if (!currentIdentity) {
        throw new StudentAccessV2Error('NOT_AUTHENTICATED', '로그인한 뒤 강화하거나 펫을 소환할 수 있어요.');
      }
      const safeAction = String(action || '');
      const safeRequestId = String(requestId || '').toLowerCase();
      if (!['enhance', 'summonPet'].includes(safeAction)
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(safeRequestId)) {
        throw new StudentAccessV2Error('INVALID_SPECIAL_ACTION', '강화 또는 펫 소환 요청이 올바르지 않아요.');
      }

      // 예약된 옛 저장이 RPC가 확정할 재화·강화·펫 상태를 되감지 않도록
      // 같은 인증 클라이언트의 저장을 모두 비운 다음 원자 작업을 요청한다.
      await cloud.flush();
      let data = null;
      let error = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const result = await client.rpc('perform_world_special_action_v1', {
            p_action:safeAction,
            p_request_id:safeRequestId,
          });
          data = result?.data;
          error = result?.error || null;
        } catch (rpcError) {
          data = null;
          error = rpcError;
        }
        if (!error) break;
      }
      if (error) {
        const wrapped = new StudentAccessV2Error(
          'SPECIAL_ACTION_FAILED',
          '서버에서 결과를 확인하지 못했어요. 잠시 뒤 같은 작업을 다시 시도해 주세요.',
        );
        wrapped.cause = error;
        throw wrapped;
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)
        || data.action !== safeAction || typeof data.ok !== 'boolean') {
        throw new StudentAccessV2Error('INVALID_SPECIAL_ACTION_RESPONSE', '서버 결과 형식이 올바르지 않아요.');
      }
      return data;
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
      performWorldSpecialAction,
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
