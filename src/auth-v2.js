(function (global) {
  'use strict';

  const INTERNAL_EMAIL_DOMAIN = '63world.invalid';
  const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

  class AuthV2Error extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'AuthV2Error';
      this.code = code;
    }
  }

  function normalizeDisplayName(value) {
    if (typeof value !== 'string') {
      throw new AuthV2Error('INVALID_NAME', '이름을 입력해 주세요.');
    }
    const unicodeName = value.normalize('NFKC');
    if (CONTROL_CHARACTERS.test(unicodeName)) {
      throw new AuthV2Error('INVALID_NAME', '이름에 사용할 수 없는 문자가 있어요.');
    }
    const displayName = unicodeName.trim().replace(/\s+/g, ' ');
    const length = Array.from(displayName).length;
    if (length < 1) {
      throw new AuthV2Error('INVALID_NAME', '이름을 입력해 주세요.');
    }
    if (length > 20) {
      throw new AuthV2Error('INVALID_NAME', '이름은 20자 이하로 입력해 주세요.');
    }
    return displayName;
  }

  function normalizeStudentName(value) {
    return normalizeDisplayName(value).toLocaleLowerCase('ko-KR');
  }

  function validatePassword(password) {
    if (typeof password !== 'string' || password.length < 6) {
      throw new AuthV2Error('INVALID_PASSWORD', '비밀번호는 6자 이상으로 입력해 주세요.');
    }
    if (password.length > 72) {
      throw new AuthV2Error('INVALID_PASSWORD', '비밀번호는 72자 이하로 입력해 주세요.');
    }
  }

  async function createInternalEmail(name) {
    const normalizedName = normalizeStudentName(name);
    const bytes = new TextEncoder().encode(normalizedName);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    const hex = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `student-${hex}@${INTERNAL_EMAIL_DOMAIN}`;
  }

  function getRole(user) {
    return user?.app_metadata?.role === 'teacher' ? 'teacher' : 'student';
  }

  function sanitizeUser(user) {
    if (!user || typeof user.id !== 'string') return null;
    const role = getRole(user);
    const displayName = typeof user.user_metadata?.display_name === 'string'
      ? normalizeDisplayName(user.user_metadata.display_name)
      : '';
    return Object.freeze({
      userId:user.id,
      displayName,
      role,
    });
  }

  function mapAuthError(error, fallbackCode = 'AUTH_FAILED') {
    const sourceCode = String(error?.code || '').toLowerCase();
    const sourceMessage = String(error?.message || '').toLowerCase();
    if (sourceCode.includes('network')
      || sourceMessage.includes('failed to fetch')
      || sourceMessage.includes('network request')) {
      return new AuthV2Error('OFFLINE', '인터넷 연결을 확인한 뒤 다시 시도해 주세요.');
    }
    if (sourceCode.includes('already') || sourceMessage.includes('already registered')) {
      return new AuthV2Error('ACCOUNT_EXISTS', '이미 사용 중인 이름이에요. 다른 이름을 선택해 주세요.');
    }
    if (sourceCode.includes('invalid_credentials') || sourceMessage.includes('invalid login credentials')) {
      return new AuthV2Error('INVALID_CREDENTIALS', '이름 또는 비밀번호가 맞지 않아요.');
    }
    if (sourceCode.includes('email_not_confirmed') || sourceMessage.includes('not confirmed')) {
      return new AuthV2Error(
        'EMAIL_NOT_CONFIRMED',
        '계정 확인 설정 때문에 로그인이 막혔어요. 선생님께 알려주세요. (확인 메일 요구 설정)',
      );
    }
    if (sourceCode.includes('rate_limit')
      || sourceMessage.includes('rate limit')
      || sourceMessage.includes('security purposes')) {
      return new AuthV2Error('RATE_LIMITED', '접속 요청이 너무 많아요. 1분쯤 기다렸다가 다시 시도해 주세요.');
    }
    if (sourceCode.includes('signup_disabled') || sourceMessage.includes('signups not allowed')) {
      return new AuthV2Error('SIGNUP_DISABLED', '새 캐릭터 만들기가 잠겨 있어요. 선생님께 알려주세요.');
    }
    if (sourceCode.startsWith('p0')
      || sourceCode.includes('unexpected_failure')
      || sourceMessage.includes('database error')) {
      return new AuthV2Error('SERVER_SETUP_FAILED', '서버 설정에 문제가 있어요. 선생님께 알려주세요. (서버 저장 단계 실패)');
    }
    if (sourceCode.includes('weak_password') || sourceMessage.includes('password')) {
      return new AuthV2Error('INVALID_PASSWORD', '더 안전한 비밀번호를 사용해 주세요.');
    }
    return new AuthV2Error(
      fallbackCode,
      `로그인 처리 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요. (오류: ${sourceCode || sourceMessage || 'unknown'})`,
    );
  }

  function createAuthService(options) {
    const client = options?.client;
    if (!client?.auth
      || typeof client.auth.signUp !== 'function'
      || typeof client.auth.signInWithPassword !== 'function'
      || typeof client.auth.getSession !== 'function'
      || typeof client.auth.signOut !== 'function') {
      throw new TypeError('A Supabase client with auth methods is required.');
    }

    async function signUpStudentResult(name, password) {
      const displayName = normalizeDisplayName(name);
      const normalizedName = normalizeStudentName(displayName);
      validatePassword(password);
      const email = await createInternalEmail(normalizedName);
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options:{
          data:{
            display_name:displayName,
            normalized_name:normalizedName,
          },
        },
      });
      if (error) throw mapAuthError(error, 'SIGNUP_FAILED');
      const safeUser = sanitizeUser(data?.user);
      if (!safeUser) throw new AuthV2Error('SIGNUP_FAILED', '계정을 만들지 못했어요. 잠시 후 다시 시도해 주세요.');
      return { identity:safeUser, hasSession:Boolean(data?.session) };
    }

    async function signUpStudent(name, password) {
      return (await signUpStudentResult(name, password)).identity;
    }

    async function signInStudent(name, password) {
      const normalizedName = normalizeStudentName(name);
      validatePassword(password);
      const email = await createInternalEmail(normalizedName);
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw mapAuthError(error, 'SIGNIN_FAILED');
      const safeUser = sanitizeUser(data?.user);
      if (!safeUser) throw new AuthV2Error('SIGNIN_FAILED', '로그인 정보를 확인하지 못했어요.');
      return safeUser;
    }

    async function restoreSession() {
      const { data, error } = await client.auth.getSession();
      if (error) throw mapAuthError(error, 'SESSION_FAILED');
      if (!data?.session) return null;
      return sanitizeUser(data.session.user);
    }

    async function signOut() {
      const { error } = await client.auth.signOut();
      if (error) throw mapAuthError(error, 'SIGNOUT_FAILED');
    }

    async function enterStudent(name, password) {
      try {
        const identity = await signInStudent(name, password);
        return Object.freeze({ identity, isNewAccount:false });
      } catch (error) {
        if (error?.code !== 'INVALID_CREDENTIALS') throw error;
      }

      try {
        const signup = await signUpStudentResult(name, password);
        if (!signup.hasSession) {
          throw new AuthV2Error(
            'AUTH_SETUP_REQUIRED',
            'Supabase에서 이메일 확인을 꺼야 새 계정으로 바로 로그인할 수 있어요.',
          );
        }
        return Object.freeze({ identity:signup.identity, isNewAccount:true });
      } catch (error) {
        if (error?.code === 'ACCOUNT_EXISTS') {
          throw new AuthV2Error('INVALID_CREDENTIALS', '이름 또는 비밀번호가 맞지 않아요.');
        }
        throw error;
      }
    }

    return Object.freeze({
      signUpStudent,
      signInStudent,
      enterStudent,
      restoreSession,
      signOut,
      getRole,
    });
  }

  global.YuksamAuthV2 = Object.freeze({
    AuthV2Error,
    normalizeStudentName,
    createInternalEmail,
    createAuthService,
  });
})(window);
