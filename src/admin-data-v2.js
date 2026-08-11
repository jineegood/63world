(function (global) {
  'use strict';

  class AdminDataV2Error extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'AdminDataV2Error';
      this.code = code;
    }
  }

  const MESSAGES = Object.freeze({
    OFFLINE:'인터넷 연결을 확인한 뒤 다시 시도해 주세요.',
    FORBIDDEN:'관리자 권한이 있는 계정만 사용할 수 있어요.',
    STUDENT_NOT_FOUND:'해당 학생 계정을 찾지 못했어요.',
    INVALID_REWARD:'보상은 0부터 1,000,000 사이의 정수로 입력해 주세요.',
    RATE_LIMITED:'요청이 너무 많아요. 잠시 후 다시 시도해 주세요.',
    LOAD_FAILED:'학생 목록을 불러오지 못했어요.',
    GRANT_FAILED:'학생 보상을 저장하지 못했어요.',
    DELETE_FAILED:'학생 계정을 삭제하지 못했어요.',
    CHEAT_FAILED:'교사 전용 치트를 적용하지 못했어요.',
    RAID_NOT_IN_BATTLE:'던전 전투 중에만 사용할 수 있어요.',
    RAID_PARTY_INCOMPLETE:'세 명이 모두 던전에 접속한 뒤 사용할 수 있어요.',
    AUDIT_FAILED:'보안 알림을 불러오지 못했어요.',
  });
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function error(code) {
    return new AdminDataV2Error(code, MESSAGES[code] || MESSAGES.LOAD_FAILED);
  }

  function sourceText(source) {
    return `${source?.code || ''} ${source?.message || ''}`.toLowerCase();
  }

  function statusOf(source) {
    return Number(source?.status || source?.context?.status || 0);
  }

  function mapError(source, fallback) {
    const status = statusOf(source);
    const text = sourceText(source);
    if (text.includes('failed to fetch') || text.includes('network request') || text.includes('networkerror')) return error('OFFLINE');
    if (status === 401 || status === 403 || text.includes('forbidden') || text.includes('jwt')) return error('FORBIDDEN');
    if (status === 404 || text.includes('student_not_found')) return error('STUDENT_NOT_FOUND');
    if (status === 429 || text.includes('rate_limit')) return error('RATE_LIMITED');
    return error(fallback);
  }

  function nonNegativeInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 ? number : 0;
  }

  function safeText(value, maximum = 200) {
    return typeof value === 'string' ? value.slice(0, maximum) : '';
  }

  function sanitizeWrongLog(value) {
    if (!Array.isArray(value)) return Object.freeze([]);
    return Object.freeze(value.slice(-30).map((entry) => Object.freeze({
      q:safeText(entry?.q, 500),
      a:safeText(entry?.a, 200),
      mine:safeText(entry?.mine, 200),
      at:Number.isFinite(Number(entry?.at)) ? Number(entry.at) : 0,
    })));
  }

  function sanitizeIdList(value, maximum = 200) {
    if (!Array.isArray(value)) return Object.freeze([]);
    return Object.freeze(value.slice(0, maximum)
      .map((item) => safeText(item, 80))
      .filter(Boolean));
  }

  function sanitizeEquipment(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const result = {};
    ['weapon', 'armor', 'head', 'accessory'].forEach((slot) => {
      result[slot] = safeText(source[slot], 80) || null;
    });
    return Object.freeze(result);
  }

  function sanitizeRankMap(value, maximumValue = 99) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const result = {};
    Object.entries(source).slice(0, 200).forEach(([rawId, rawRank]) => {
      const id = safeText(rawId, 80);
      const rank = Math.min(maximumValue, nonNegativeInteger(rawRank));
      if (id && rank > 0) result[id] = rank;
    });
    return Object.freeze(result);
  }

  function summarize(row) {
    const data = row?.data && typeof row.data === 'object' && !Array.isArray(row.data) ? row.data : {};
    const records = data.records && typeof data.records === 'object' && !Array.isArray(data.records) ? data.records : {};
    return Object.freeze({
      userId:safeText(row?.user_id, 36),
      displayName:safeText(row?.display_name, 20),
      updatedAt:safeText(row?.updated_at, 40),
      className:safeText(data.class, 40),
      spec:safeText(data.spec, 40),
      level:Math.max(1, nonNegativeInteger(data.level)),
      exp:nonNegativeInteger(data.exp),
      gold:nonNegativeInteger(data.gold),
      building:nonNegativeInteger(data.building),
      hp:nonNegativeInteger(data.hp),
      maxHp:nonNegativeInteger(data.maxHp),
      skillPoints:nonNegativeInteger(data.skillPoints),
      baseStatsVersion:nonNegativeInteger(data.baseStatsVersion),
      equipment:sanitizeEquipment(data.equipment),
      inventory:sanitizeIdList(data.inventory),
      skills:sanitizeRankMap(data.skills, 5),
      weaponUpgrades:sanitizeRankMap(data.weaponUpgrades, 4),
      activePet:safeText(data.activePet, 80) || null,
      records:Object.freeze({
        answered:nonNegativeInteger(records.answered),
        correct:nonNegativeInteger(records.correct),
        wrongLog:sanitizeWrongLog(records.wrongLog),
      }),
    });
  }

  function validateUserId(userId) {
    if (typeof userId !== 'string' || !UUID.test(userId)) throw error('STUDENT_NOT_FOUND');
    return userId;
  }

  function summarizeSecurityAlert(row) {
    const observed = row?.observed && typeof row.observed === 'object' && !Array.isArray(row.observed)
      ? row.observed : {};
    return Object.freeze({
      id:safeText(row?.id, 36),
      userId:safeText(row?.user_id, 36),
      displayName:safeText(row?.display_name, 20),
      issues:Object.freeze((Array.isArray(row?.issues) ? row.issues : []).map((item) => safeText(item, 60))),
      observed:Object.freeze({
        level:nonNegativeInteger(observed.level),
        exp:nonNegativeInteger(observed.exp),
        gold:nonNegativeInteger(observed.gold),
        building:nonNegativeInteger(observed.building),
        skillPoints:nonNegativeInteger(observed.skillPoints),
        learnedSkillPoints:nonNegativeInteger(observed.learnedSkillPoints),
      }),
      occurrences:Math.max(1, nonNegativeInteger(row?.occurrences)),
      firstSeenAt:safeText(row?.first_seen_at, 40),
      lastSeenAt:safeText(row?.last_seen_at, 40),
    });
  }

  function validateReward(input) {
    const reward = {
      gold:Number(input?.gold),
      building:Number(input?.building),
      exp:Number(input?.exp),
    };
    if (Object.values(reward).some((value) => !Number.isInteger(value) || value < 0 || value > 1000000)
      || reward.gold + reward.building + reward.exp <= 0) {
      throw error('INVALID_REWARD');
    }
    return Object.freeze(reward);
  }

  function create(options) {
    const client = options?.client;
    if (!client?.auth || typeof client.auth.getUser !== 'function'
      || typeof client.from !== 'function' || typeof client?.functions?.invoke !== 'function') {
      throw new TypeError('A complete Supabase client is required.');
    }

    async function requireTeacher() {
      const { data, error:authError } = await client.auth.getUser();
      if (authError) throw mapError(authError, 'FORBIDDEN');
      const user = data?.user;
      if (!user || user.app_metadata?.role !== 'teacher') throw error('FORBIDDEN');
      return Object.freeze({ userId:user.id });
    }

    async function listStudents() {
      await requireTeacher();
      const { data, error:listError } = await client
        .from('player_profiles_v2')
        .select('user_id,display_name,data,updated_at')
        .order('updated_at', { ascending:false });
      if (listError) throw mapError(listError, 'LOAD_FAILED');
      return Object.freeze((Array.isArray(data) ? data : []).map(summarize));
    }

    async function findDisplayName(userId) {
      const { data, error:profileError } = await client
        .from('player_profiles_v2')
        .select('display_name')
        .eq('user_id', userId)
        .maybeSingle();
      if (profileError) throw mapError(profileError, 'GRANT_FAILED');
      if (!data || typeof data.display_name !== 'string') throw error('STUDENT_NOT_FOUND');
      return safeText(data.display_name, 20);
    }

    async function grantReward(userId, input) {
      const targetUserId = validateUserId(userId);
      const reward = validateReward(input);
      const teacher = await requireTeacher();
      const displayName = await findDisplayName(targetUserId);
      const { error:insertError } = await client.from('student_reward_grants_v2').insert({
        user_id:targetUserId,
        gold:reward.gold,
        building:reward.building,
        exp:reward.exp,
        created_by:teacher.userId,
      });
      if (insertError) throw mapError(insertError, 'GRANT_FAILED');
      return Object.freeze({ displayName });
    }

    async function deleteStudent(userId) {
      const targetUserId = validateUserId(userId);
      await requireTeacher();
      const { data, error:deleteError } = await client.functions.invoke('teacher-delete-student', {
        body:{ userId:targetUserId },
      });
      if (deleteError) throw mapError(deleteError, 'DELETE_FAILED');
      if (!data?.ok || typeof data.displayName !== 'string') throw error('DELETE_FAILED');
      return Object.freeze({ displayName:safeText(data.displayName, 20) });
    }

    async function applyStudentCheat(userId, action) {
      const targetUserId = validateUserId(userId);
      await requireTeacher();
      const allowed = new Set(['exp20', 'exp100', 'gold3000', 'building200', 'heal', 'raidAdvance']);
      if (!allowed.has(action)) throw error('CHEAT_FAILED');
      const { data, error:cheatError } = await client.functions.invoke('teacher-apply-cheat', {
        body:{ userId:targetUserId, action },
      });
      if (cheatError) throw mapError(cheatError, 'CHEAT_FAILED');
      if (!data?.ok || !data.snapshot || typeof data.snapshot !== 'object') throw error('CHEAT_FAILED');
      return Object.freeze({
        displayName:safeText(data.displayName, 20),
        action,
        snapshot:Object.freeze({ ...data.snapshot }),
      });
    }

    async function killRaidMonster(userId) {
      const targetUserId = validateUserId(userId);
      await requireTeacher();
      const { data, error:cheatError } = await client.functions.invoke('teacher-apply-cheat', {
        body:{ userId:targetUserId, action:'raidKill' },
      });
      if (cheatError) throw mapError(cheatError, 'CHEAT_FAILED');
      if (data?.code === 'RAID_NOT_IN_BATTLE') throw error('RAID_NOT_IN_BATTLE');
      if (data?.code === 'RAID_PARTY_INCOMPLETE') throw error('RAID_PARTY_INCOMPLETE');
      if (!data?.ok || typeof data.roomId !== 'string' || !Number.isInteger(Number(data.round))) {
        throw error('CHEAT_FAILED');
      }
      return Object.freeze({
        displayName:safeText(data.displayName, 20),
        monsterName:safeText(data.monsterName, 60),
        roomId:safeText(data.roomId, 36),
        round:Number(data.round),
      });
    }

    async function listSecurityAlerts() {
      await requireTeacher();
      const { data, error:listError } = await client
        .from('profile_security_audits_v1')
        .select('id,user_id,display_name,issues,observed,occurrences,first_seen_at,last_seen_at')
        .is('resolved_at', null)
        .order('last_seen_at', { ascending:false })
        .limit(100);
      if (listError) throw mapError(listError, 'AUDIT_FAILED');
      return Object.freeze((Array.isArray(data) ? data : []).map(summarizeSecurityAlert));
    }

    async function resolveSecurityAlert(alertId) {
      const id = validateUserId(alertId);
      await requireTeacher();
      const { error:updateError } = await client
        .from('profile_security_audits_v1')
        .update({ resolved_at:new Date().toISOString() })
        .eq('id', id)
        .is('resolved_at', null);
      if (updateError) throw mapError(updateError, 'AUDIT_FAILED');
      return true;
    }

    return Object.freeze({
      listStudents, grantReward, deleteStudent, applyStudentCheat, killRaidMonster,
      listSecurityAlerts, resolveSecurityAlert,
    });
  }

  global.YuksamAdminDataV2 = Object.freeze({ AdminDataV2Error, create });
})(window);
