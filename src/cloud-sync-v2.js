(function installCloudSyncV2(global) {
  'use strict';

  const CACHE_PREFIX = 'ysb_player_v2_';
  const SENSITIVE_KEYS = new Set([
    'password',
    'currentpassword',
    'access_token',
    'refresh_token',
    'anonkey',
    'service_role',
  ]);

  class CloudSyncV2Error extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'CloudSyncV2Error';
      this.code = code;
    }
  }

  function sanitizePlayerData(player) {
    const seen = new WeakSet();

    function copy(value) {
      if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new CloudSyncV2Error('INVALID_SAVE', '저장할 수 없는 캐릭터 데이터가 있어요.');
        return value;
      }
      if (typeof value !== 'object') {
        throw new CloudSyncV2Error('INVALID_SAVE', '저장할 수 없는 캐릭터 데이터가 있어요.');
      }
      if (seen.has(value)) throw new CloudSyncV2Error('INVALID_SAVE', '저장 데이터가 서로 순환해 저장할 수 없어요.');
      seen.add(value);

      let result;
      if (Array.isArray(value)) {
        result = value.map((child) => child === undefined ? null : copy(child));
      } else {
        if (Object.prototype.toString.call(value) !== '[object Object]') {
          throw new CloudSyncV2Error('INVALID_SAVE', '저장할 수 없는 캐릭터 데이터가 있어요.');
        }
        result = {};
        for (const [key, child] of Object.entries(value)) {
          if (SENSITIVE_KEYS.has(key.toLowerCase())) continue;
          if (child === undefined) continue;
          result[key] = copy(child);
        }
      }
      seen.delete(value);
      return result;
    }

    if (!player || typeof player !== 'object' || Array.isArray(player)) {
      throw new CloudSyncV2Error('INVALID_SAVE', '저장할 캐릭터 정보가 올바르지 않아요.');
    }
    return copy(player);
  }

  function isNetworkFailure(error) {
    const code = String(error?.code || '').toLowerCase();
    const message = String(error?.message || error || '').toLowerCase();
    return error instanceof TypeError
      || code.includes('network')
      || message.includes('failed to fetch')
      || message.includes('network request');
  }

  function create({ client, storage, schedule, cancelSchedule } = {}) {
    if (!client || typeof client.from !== 'function' || typeof client.rpc !== 'function') {
      throw new TypeError('cloud sync v2 requires a Supabase client');
    }
    if (!storage || typeof storage.getItem !== 'function'
      || typeof storage.setItem !== 'function'
      || typeof storage.removeItem !== 'function') {
      throw new TypeError('cloud sync v2 requires storage');
    }

    const scheduleFn = typeof schedule === 'function' ? schedule : (fn, delay) => setTimeout(fn, delay);
    const cancelFn = typeof cancelSchedule === 'function' ? cancelSchedule : (id) => clearTimeout(id);
    let timer = null;
    let pending = null;

    function assertUserId(userId) {
      if (typeof userId !== 'string' || !userId.trim()) {
        throw new CloudSyncV2Error('INVALID_USER', '로그인한 사용자 정보를 확인할 수 없어요.');
      }
      return userId.trim();
    }

    function cacheKey(userId) {
      return CACHE_PREFIX + assertUserId(userId);
    }

    function readCache(userId) {
      const raw = storage.getItem(cacheKey(userId));
      if (!raw) return null;
      try {
        return sanitizePlayerData(JSON.parse(raw));
      } catch {
        return null;
      }
    }

    function writeCache(userId, player) {
      storage.setItem(cacheKey(userId), JSON.stringify(player));
    }

    async function loadPlayer(userId) {
      const safeUserId = assertUserId(userId);
      try {
        const { data:claimedData, error:claimError } = await client.rpc('claim_student_rewards_v2');
        if (claimError) {
          if (isNetworkFailure(claimError)) throw new TypeError('Failed to fetch');
          throw new CloudSyncV2Error('LOAD_FAILED', '보상과 캐릭터 정보를 확인할 권한이 없거나 서버에 문제가 있어요.');
        }
        if (claimedData && typeof claimedData === 'object' && !Array.isArray(claimedData)) {
          if (Object.keys(claimedData).length === 0) return null;
          const claimedPlayer = sanitizePlayerData(claimedData);
          writeCache(safeUserId, claimedPlayer);
          return { player:claimedPlayer, source:'remote', offline:false };
        }
        const { data, error } = await client
          .from('player_profiles_v2')
          .select('data,updated_at')
          .eq('user_id', safeUserId)
          .maybeSingle();
        if (error) {
          if (isNetworkFailure(error)) throw new TypeError('Failed to fetch');
          throw new CloudSyncV2Error('LOAD_FAILED', '캐릭터 정보를 불러올 권한이 없거나 서버에 문제가 있어요.');
        }
        if (!data || !data.data || Object.keys(data.data).length === 0) return null;
        const safePlayer = sanitizePlayerData(data.data);
        writeCache(safeUserId, safePlayer);
        return { player:safePlayer, source:'remote', offline:false };
      } catch (error) {
        if (!isNetworkFailure(error)) throw error;
        const cached = readCache(safeUserId);
        if (cached) return { player:cached, source:'cache', offline:true };
        throw new CloudSyncV2Error('OFFLINE', '인터넷 연결이 없어 캐릭터 정보를 확인할 수 없어요.');
      }
    }

    function queueSave(userId, player) {
      const safeUserId = assertUserId(userId);
      const safePlayer = sanitizePlayerData(player);
      writeCache(safeUserId, safePlayer);
      pending = { userId:safeUserId, player:safePlayer };
      if (timer !== null) cancelFn(timer);
      timer = scheduleFn(() => {
        timer = null;
        flush().catch(() => {});
      }, 1000);
    }

    async function flush() {
      if (timer !== null) {
        cancelFn(timer);
        timer = null;
      }
      if (!pending) return;
      const snapshot = pending;
      pending = null;
      const payload = { data:snapshot.player, updated_at:new Date().toISOString() };
      try {
        const { error } = await client
          .from('player_profiles_v2')
          .update(payload)
          .eq('user_id', snapshot.userId);
        if (error) throw new CloudSyncV2Error('SAVE_FAILED', '캐릭터를 서버에 저장하지 못했어요.');
      } catch (error) {
        if (!pending) pending = snapshot;
        if (error instanceof CloudSyncV2Error) throw error;
        if (isNetworkFailure(error)) {
          throw new CloudSyncV2Error('OFFLINE', '인터넷 연결이 없어 로컬에만 임시 저장했어요.');
        }
        throw new CloudSyncV2Error('SAVE_FAILED', '캐릭터를 서버에 저장하지 못했어요.');
      }
    }

    function clearCache(userId) {
      storage.removeItem(cacheKey(userId));
    }

    return Object.freeze({ loadPlayer, queueSave, flush, clearCache });
  }

  global.YuksamCloudSyncV2 = Object.freeze({
    CloudSyncV2Error,
    sanitizePlayerData,
    create,
  });
})(window);
