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

    return Object.freeze({ listStudents, grantReward, deleteStudent });
  }

  global.YuksamAdminDataV2 = Object.freeze({ AdminDataV2Error, create });
})(window);
