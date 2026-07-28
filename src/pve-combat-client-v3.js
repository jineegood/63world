(function installYuksamPveCombatClientV3(global) {
  'use strict';

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const MONSTER_ID = /^[a-z0-9][a-z0-9_]{0,79}$/;
  const ACTION_ID = /^(?:basic|active:[a-z0-9][a-z0-9_]{0,79})$/;
  const FORBIDDEN_KEYS = new Set([
    'answerKey',
    'answer_key',
    'serviceRoleKey',
    'service_role_key',
  ]);
  const messages = Object.freeze({
    UNAUTHENTICATED:'로그인이 만료되었습니다. 다시 로그인해 주세요.',
    ORIGIN_NOT_ALLOWED:'허용되지 않은 주소에서 접속했습니다.',
    NO_QUESTIONS:'선생님이 활성화한 문제가 없습니다.',
    PLAYER_NOT_FOUND:'캐릭터 정보를 찾지 못했습니다. 다시 로그인해 주세요.',
    UNKNOWN_MONSTER:'몬스터 정보를 찾지 못했습니다.',
    MONSTER_MAP_MISMATCH:'몬스터 위치 정보가 달라 전투를 다시 불러옵니다.',
    COMBAT_NOT_ACTIVE:'진행 중인 전투를 찾지 못했습니다.',
    COMBAT_STATE_MISSING:'전투 기록을 찾지 못해 전투를 안전하게 종료합니다.',
    QUESTION_TOKEN_MISMATCH:'문제가 바뀌었습니다. 전투 화면을 다시 불러옵니다.',
    SESSION_REVISION_CONFLICT:'전투 상태가 바뀌었습니다. 최신 상태를 다시 불러옵니다.',
    PLAYER_REVISION_CONFLICT:'캐릭터 상태가 바뀌었습니다. 최신 상태를 다시 불러옵니다.',
    REQUEST_ID_REUSED:'이미 처리된 전투 요청입니다. 최신 상태를 다시 불러옵니다.',
    ACTION_NOT_LEARNED:'아직 배우지 않은 스킬입니다.',
    ACTION_ON_COOLDOWN:'아직 다시 사용할 수 없는 스킬입니다.',
    INVALID_ACTION:'사용할 수 없는 전투 행동입니다.',
    ESCAPE_ALREADY_FAILED:'이번 전투에서는 더 이상 도망칠 수 없습니다.',
    ESCAPE_NOT_ALLOWED:'이 전투에서는 도망칠 수 없습니다.',
    HEALING_NOT_ACTIVE:'치유 문제가 만료되었습니다. 다시 우물에 말을 걸어 주세요.',
    COMBAT_NETWORK_ERROR:'전투 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    COMBAT_SERVER_ERROR:'전투 서버에서 안전하게 처리하지 못했습니다.',
    UNSAFE_SERVER_RESPONSE:'전투 서버 응답을 안전하게 확인하지 못했습니다.',
  });

  function failure(code, fallback = 'COMBAT_SERVER_ERROR') {
    const safeCode = messages[code] ? code : fallback;
    const error = new Error(messages[safeCode]);
    error.code = safeCode;
    return error;
  }

  function uuid() {
    if (global.crypto?.randomUUID) return global.crypto.randomUUID();
    if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
    const values = new Uint8Array(16);
    crypto.getRandomValues(values);
    values[6] = (values[6] & 0x0f) | 0x40;
    values[8] = (values[8] & 0x3f) | 0x80;
    const hex = [...values].map((value) => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function validateAndFreeze(value, depth = 0) {
    if (depth > 12) throw failure('UNSAFE_SERVER_RESPONSE');
    if (value == null || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || Math.abs(value) > 1000000000) throw failure('UNSAFE_SERVER_RESPONSE');
      return value;
    }
    if (typeof value === 'string') {
      if (value.length > 4000) throw failure('UNSAFE_SERVER_RESPONSE');
      return value;
    }
    if (Array.isArray(value)) {
      if (value.length > 256) throw failure('UNSAFE_SERVER_RESPONSE');
      return Object.freeze(value.map((entry) => validateAndFreeze(entry, depth + 1)));
    }
    if (typeof value !== 'object') throw failure('UNSAFE_SERVER_RESPONSE');
    const entries = Object.entries(value);
    if (entries.length > 80) throw failure('UNSAFE_SERVER_RESPONSE');
    const safe = {};
    for (const [key, entry] of entries) {
      if (FORBIDDEN_KEYS.has(key) || key.length > 80) throw failure('UNSAFE_SERVER_RESPONSE');
      safe[key] = validateAndFreeze(entry, depth + 1);
    }
    if (Array.isArray(safe.events) && safe.events.length > 64) throw failure('UNSAFE_SERVER_RESPONSE');
    return Object.freeze(safe);
  }

  function create({ client, timeoutMs = 15000 } = {}) {
    if (!client?.functions?.invoke) throw new Error('PvE combat client dependencies are required');
    const pending = new Map();
    const timeout = Math.max(1000, Math.min(30000, Number(timeoutMs) || 15000));

    async function invoke(body) {
      let timer = null;
      const timedOut = new Promise((_, reject) => {
        timer = setTimeout(() => reject(failure('COMBAT_NETWORK_ERROR')), timeout);
      });
      let response;
      try {
        response = await Promise.race([
          client.functions.invoke('student-combat-v3', { body }),
          timedOut,
        ]);
      } catch {
        throw failure('COMBAT_NETWORK_ERROR');
      } finally {
        clearTimeout(timer);
      }
      const data = response?.data;
      const rawCode = data?.error || response?.error?.context?.error || response?.error?.message || '';
      const code = /^[A-Z][A-Z0-9_]{2,80}$/.test(String(rawCode)) ? String(rawCode) : '';
      if (response?.error || data?.error) {
        if (/fetch|network|timeout/i.test(String(rawCode))) throw failure('COMBAT_NETWORK_ERROR');
        throw failure(code, 'COMBAT_SERVER_ERROR');
      }
      return validateAndFreeze(data?.data ?? data);
    }

    function once(key, body) {
      if (pending.has(key)) return pending.get(key);
      const task = invoke(body).finally(() => pending.delete(key));
      pending.set(key, task);
      return task;
    }

    function requestId(value) {
      const id = value == null ? uuid() : String(value);
      if (!UUID.test(id)) throw failure('COMBAT_SERVER_ERROR');
      return id;
    }

    return Object.freeze({
      start(monsterKey, explicitRequestId) {
        const monster = String(monsterKey || '');
        if (!MONSTER_ID.test(monster)) return Promise.reject(failure('COMBAT_SERVER_ERROR'));
        const id = requestId(explicitRequestId);
        return once(`start:${monster}`, { op:'start', monsterKey:monster, requestId:id });
      },
      submitTurn(questionToken, sessionRevision, actionId, answer, explicitRequestId) {
        const token = String(questionToken || '');
        const revision = Number(sessionRevision);
        const action = String(actionId || '');
        const given = String(answer ?? '');
        if (!UUID.test(token) || !Number.isSafeInteger(revision) || revision < 1
          || !ACTION_ID.test(action) || given.length > 512) {
          return Promise.reject(failure('COMBAT_SERVER_ERROR'));
        }
        const id = requestId(explicitRequestId);
        return once(`turn:${token}:${revision}`, {
          op:'submit_turn',
          questionToken:token,
          sessionRevision:revision,
          actionId:action,
          answer:given,
          requestId:id,
        });
      },
      attemptEscape(sessionRevision, explicitRequestId) {
        const revision = Number(sessionRevision);
        if (!Number.isSafeInteger(revision) || revision < 1) {
          return Promise.reject(failure('COMBAT_SERVER_ERROR'));
        }
        const id = requestId(explicitRequestId);
        return once(`escape:${revision}`, {
          op:'attempt_escape',
          sessionRevision:revision,
          requestId:id,
        });
      },
      surrender(sessionRevision, explicitRequestId) {
        const revision = Number(sessionRevision);
        if (!Number.isSafeInteger(revision) || revision < 1) {
          return Promise.reject(failure('COMBAT_SERVER_ERROR'));
        }
        const id = requestId(explicitRequestId);
        return once(`surrender:${revision}`, {
          op:'surrender',
          sessionRevision:revision,
          requestId:id,
        });
      },
      resume() {
        return once('resume', { op:'resume' });
      },
      startHealing(expectedRevision, explicitRequestId) {
        const revision = Number(expectedRevision);
        if (!Number.isSafeInteger(revision) || revision < 1) {
          return Promise.reject(failure('COMBAT_SERVER_ERROR'));
        }
        const id = requestId(explicitRequestId);
        return once(`healing:start:${revision}`, {
          op:'start_healing', expectedRevision:revision, requestId:id,
        });
      },
      submitHealing(questionToken, answer, expectedRevision, explicitRequestId) {
        const token = String(questionToken || '');
        const given = String(answer ?? '');
        const revision = Number(expectedRevision);
        if (!UUID.test(token) || given.length > 512
          || !Number.isSafeInteger(revision) || revision < 1) {
          return Promise.reject(failure('COMBAT_SERVER_ERROR'));
        }
        const id = requestId(explicitRequestId);
        return once(`healing:submit:${token}`, {
          op:'submit_healing',
          questionToken:token,
          answer:given,
          expectedRevision:revision,
          requestId:id,
        });
      },
    });
  }

  global.YuksamPveCombatClientV3 = Object.freeze({ create });
})(window);
