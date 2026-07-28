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
      authorityV3Enabled:false,
      status,
      enter:reject,
      createCharacter:reject,
      savePreferences:reject,
      transitionMap:reject,
      purchaseItem:reject,
      equipItem:reject,
      unequipSlot:reject,
      enhanceWeapon:reject,
      chooseSpecialization:reject,
      learnSkill:reject,
      summonPet:reject,
      setActivePet:reject,
      acceptQuest:reject,
      claimQuest:reject,
      receiveQuestGift:reject,
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
    authorityApi,
    sharedApi,
    storage,
    defaultWorkbooks,
  } = {}) {
    if (config?.securityV2Enabled !== true) {
      return closedController('off', new StudentAccessV2Error('DISABLED', '새 보안 로그인이 아직 켜지지 않았어요.'));
    }

    const projectUrl = normalizeProjectUrl(config.url);
    const anonKey = typeof config.anonKey === 'string' ? config.anonKey.trim() : '';
    const authorityV3Enabled = config?.serverAuthorityV3Enabled === true;
    if (!/^https:\/\/[^/]+$/i.test(projectUrl) || anonKey.length < 20
      || typeof clientFactory !== 'function'
      || typeof authApi?.createAuthService !== 'function'
      || (authorityV3Enabled
        ? typeof authorityApi?.create !== 'function'
        : typeof cloudApi?.create !== 'function')
      || typeof sharedApi?.create !== 'function') {
      return closedController(
        'misconfigured',
        new StudentAccessV2Error('CONFIG', '새 보안 로그인 설정을 확인해 주세요.'),
      );
    }

    const client = clientFactory(projectUrl, anonKey);
    const auth = authApi.createAuthService({ client });
    const cloud = authorityV3Enabled ? null : cloudApi.create({ client, storage });
    const authority = authorityV3Enabled ? authorityApi.create({ client }) : null;
    const shared = sharedApi.create({
      client,
      storage,
      defaultWorkbooks:authorityV3Enabled ? [] : defaultWorkbooks,
    });
    if (authorityV3Enabled) {
      for (const key of ['ysb_shared_v2_workbooks', 'ysb_workbooks_v3', 'ysb_questions_v2']) {
        storage.removeItem(key);
      }
    }
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
      if (!authorityV3Enabled) {
        try {
          await shared.refreshWorkbooks();
        } catch (error) {
          currentIdentity = null;
          throw error;
        }
      }
      if (entered.isNewAccount) {
        return Object.freeze({ kind:'new', identity:currentIdentity });
      }

      try {
        if (authorityV3Enabled) {
          try {
            const loaded = await authority.loadGame();
            return Object.freeze({
              kind:'existing',
              identity:currentIdentity,
              player:loaded.player,
              offline:false,
            });
          } catch (error) {
            if (error?.code === 'CHARACTER_NOT_FOUND') {
              return Object.freeze({ kind:'new', identity:currentIdentity });
            }
            throw error;
          }
        }
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
      if (authorityV3Enabled) {
        throw new StudentAccessV2Error(
          'AUTHORITATIVE_SAVE_REQUIRED',
          '서버가 관리하는 캐릭터 전체 값은 직접 저장할 수 없습니다.',
        );
      }
      cloud.queueSave(currentIdentity.userId, player);
    }

    async function flush() {
      if (!authorityV3Enabled) await cloud.flush();
    }

    function requireIdentity() {
      if (!currentIdentity) {
        throw new StudentAccessV2Error(
          'NOT_AUTHENTICATED',
          '로그인한 뒤 캐릭터 기능을 사용할 수 있습니다.',
        );
      }
    }

    async function createCharacter(input) {
      requireIdentity();
      if (!authorityV3Enabled) {
        throw new StudentAccessV2Error('DISABLED', '서버 캐릭터 저장 기능이 꺼져 있습니다.');
      }
      return authority.createCharacter(input);
    }

    async function savePreferences(input) {
      requireIdentity();
      if (!authorityV3Enabled) {
        throw new StudentAccessV2Error('DISABLED', '서버 설정 저장 기능이 꺼져 있습니다.');
      }
      return authority.savePreferences(input);
    }

    async function transitionMap(input) {
      requireIdentity();
      if (!authorityV3Enabled) {
        throw new StudentAccessV2Error('DISABLED', '서버 맵 이동 기능이 꺼져 있습니다.');
      }
      return authority.transitionMap(input);
    }

    async function forwardAuthorityAction(method, input) {
      requireIdentity();
      if (!authorityV3Enabled) {
        throw new StudentAccessV2Error('DISABLED', '서버 캐릭터 기능이 꺼져 있습니다.');
      }
      return authority[method](input);
    }

    const purchaseItem = (input) => forwardAuthorityAction('purchaseItem', input);
    const equipItem = (input) => forwardAuthorityAction('equipItem', input);
    const unequipSlot = (input) => forwardAuthorityAction('unequipSlot', input);
    const enhanceWeapon = (input) => forwardAuthorityAction('enhanceWeapon', input);
    const chooseSpecialization = (input) => forwardAuthorityAction('chooseSpecialization', input);
    const learnSkill = (input) => forwardAuthorityAction('learnSkill', input);
    const summonPet = (input) => forwardAuthorityAction('summonPet', input);
    const setActivePet = (input) => forwardAuthorityAction('setActivePet', input);
    // [v59] 퀘스트 수락·보상·코스튬 선물이 서버까지 연결되지 않아 진행이 막혔던 것을 잇는다
    const acceptQuest = (input) => forwardAuthorityAction('acceptQuest', input);
    const claimQuest = (input) => forwardAuthorityAction('claimQuest', input);
    const receiveQuestGift = (input) => forwardAuthorityAction('receiveQuestGift', input);

    async function signOut() {
      try {
        if (!authorityV3Enabled) await cloud.flush();
        await auth.signOut();
      } finally {
        currentIdentity = null;
      }
    }

    return Object.freeze({
      enabled:true,
      authorityV3Enabled,
      status:'ready',
      enter,
      createCharacter,
      savePreferences,
      transitionMap,
      purchaseItem,
      equipItem,
      unequipSlot,
      enhanceWeapon,
      chooseSpecialization,
      learnSkill,
      summonPet,
      setActivePet,
      acceptQuest,
      claimQuest,
      receiveQuestGift,
      savePlayer,
      flush,
      signOut,
      refreshClassroomSettings:shared.refreshClassroomSettings,
      isServerOpen:shared.getServerOpen,
      getWorkbooks:shared.getWorkbooks,
      setLocalWorkbooks:shared.setLocalWorkbooks,
      startSharedPolling:(options = {}) => shared.startPolling({
        ...options,
        includeWorkbooks:!authorityV3Enabled,
      }),
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
