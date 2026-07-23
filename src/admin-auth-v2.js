(function (global) {
  'use strict';

  class AdminAuthV2Error extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'AdminAuthV2Error';
      this.code = code;
    }
  }

  const SAFE_MESSAGES = Object.freeze({
    INVALID_EMAIL:'관리자 이메일을 확인해 주세요.',
    INVALID_PASSWORD:'비밀번호는 6자 이상 72자 이하로 입력해 주세요.',
    INVALID_CREDENTIALS:'이메일 또는 비밀번호가 맞지 않아요.',
    FORBIDDEN:'관리자 권한이 있는 계정만 사용할 수 있어요.',
    OFFLINE:'인터넷 연결을 확인한 뒤 다시 시도해 주세요.',
    STUDENT_NOT_FOUND:'해당 이름의 학생 계정을 찾지 못했어요.',
    RATE_LIMITED:'요청이 너무 많아요. 잠시 후 다시 시도해 주세요.',
    AUTH_FAILED:'관리자 로그인 처리 중 문제가 생겼어요.',
    SESSION_FAILED:'관리자 로그인 상태를 확인하지 못했어요.',
    SIGNOUT_FAILED:'로그아웃 처리 중 문제가 생겼어요.',
    PASSWORD_CHANGE_FAILED:'관리자 비밀번호를 바꾸지 못했어요.',
    RESET_FAILED:'학생 비밀번호를 바꾸지 못했어요.',
  });

  function safeError(code) {
    return new AdminAuthV2Error(code, SAFE_MESSAGES[code] || SAFE_MESSAGES.AUTH_FAILED);
  }

  function validateEmail(email) {
    if (typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email.trim())) {
      throw safeError('INVALID_EMAIL');
    }
    return email.trim();
  }

  function validatePassword(password) {
    if (typeof password !== 'string' || password.length < 6 || password.length > 72) {
      throw safeError('INVALID_PASSWORD');
    }
  }

  function isTeacher(user) {
    return user?.app_metadata?.role === 'teacher';
  }

  function identityFrom(user) {
    if (!user || typeof user.id !== 'string' || !isTeacher(user)) return null;
    return Object.freeze({
      userId:user.id,
      email:typeof user.email === 'string' ? user.email : '',
      role:'teacher',
    });
  }

  function statusOf(error) {
    return Number(error?.status || error?.context?.status || 0);
  }

  function sourceText(error) {
    return `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  }

  function mapError(error, fallbackCode) {
    const status = statusOf(error);
    const source = sourceText(error);
    if (source.includes('failed to fetch') || source.includes('network request') || source.includes('networkerror')) {
      return safeError('OFFLINE');
    }
    if (status === 401 || source.includes('invalid_credentials') || source.includes('invalid login credentials')) {
      return safeError('INVALID_CREDENTIALS');
    }
    if (status === 403 || source.includes('forbidden')) return safeError('FORBIDDEN');
    if (status === 404 || source.includes('student_not_found')) return safeError('STUDENT_NOT_FOUND');
    if (status === 429 || source.includes('rate_limit')) return safeError('RATE_LIMITED');
    return safeError(fallbackCode);
  }

  function isMissingSession(error) {
    const source = sourceText(error);
    return source.includes('session_not_found') || source.includes('auth session missing');
  }

  function create(options) {
    const client = options?.client;
    const normalizeStudentName = options?.normalizeStudentName;
    if (!client?.auth
      || typeof client.auth.signInWithPassword !== 'function'
      || typeof client.auth.getUser !== 'function'
      || typeof client.auth.signOut !== 'function'
      || typeof client.auth.updateUser !== 'function'
      || typeof client?.functions?.invoke !== 'function'
      || typeof normalizeStudentName !== 'function') {
      throw new TypeError('A complete Supabase client and name normalizer are required.');
    }

    async function signIn(email, password) {
      const cleanEmail = validateEmail(email);
      validatePassword(password);
      const { data, error } = await client.auth.signInWithPassword({ email:cleanEmail, password });
      if (error) throw mapError(error, 'AUTH_FAILED');
      const identity = identityFrom(data?.user);
      if (!identity) {
        try { await client.auth.signOut(); } catch (_) { /* Best-effort removal of an unauthorized session. */ }
        throw safeError('FORBIDDEN');
      }
      return identity;
    }

    async function restore() {
      const { data, error } = await client.auth.getUser();
      if (error) {
        if (isMissingSession(error)) return null;
        throw mapError(error, 'SESSION_FAILED');
      }
      if (!data?.user) return null;
      const identity = identityFrom(data.user);
      if (!identity) {
        try { await client.auth.signOut(); } catch (_) { /* Best-effort removal of an unauthorized session. */ }
        throw safeError('FORBIDDEN');
      }
      return identity;
    }

    async function requireTeacher() {
      const identity = await restore();
      if (!identity) throw safeError('FORBIDDEN');
      return identity;
    }

    async function signOut() {
      const { error } = await client.auth.signOut();
      if (error) throw mapError(error, 'SIGNOUT_FAILED');
    }

    async function changeOwnPassword(newPassword) {
      validatePassword(newPassword);
      await requireTeacher();
      const { error } = await client.auth.updateUser({ password:newPassword });
      if (error) throw mapError(error, 'PASSWORD_CHANGE_FAILED');
    }

    async function resetStudentPassword(studentName, newPassword) {
      const normalizedName = normalizeStudentName(studentName);
      validatePassword(newPassword);
      await requireTeacher();
      const { data, error } = await client.functions.invoke('teacher-reset-password', {
        body:{ normalizedName, newPassword },
      });
      if (error) throw mapError(error, 'RESET_FAILED');
      if (!data?.ok || typeof data.displayName !== 'string') throw safeError('RESET_FAILED');
      return Object.freeze({ displayName:data.displayName });
    }

    return Object.freeze({ signIn, restore, signOut, changeOwnPassword, resetStudentPassword });
  }

  global.YuksamAdminAuthV2 = Object.freeze({ AdminAuthV2Error, create });
})(window);
