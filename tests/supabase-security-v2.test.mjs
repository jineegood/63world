import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const migrationPath = path.join(root, 'supabase/migrations/202607230001_security_v2_foundation.sql');
const authPath = path.join(root, 'src/auth-v2.js');
const bundlePath = path.join(root, 'vendor/supabase-client.bundle.js');

function readIfPresent(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function loadAuthApi() {
  const source = readIfPresent(authPath);
  assert.ok(source, 'src/auth-v2.js must exist');
  const window = {};
  vm.runInNewContext(source, {
    window,
    crypto: crypto.webcrypto,
    TextEncoder,
    DOMException,
  }, { filename:'src/auth-v2.js' });
  return window.YuksamAuthV2;
}

function createFakeClient(overrides = {}) {
  const calls = [];
  const user = {
    id:'student-uuid',
    email:'student-internal@63world.invalid',
    app_metadata:{ role:'student' },
    user_metadata:{ display_name:'별빛', normalized_name:'별빛' },
  };
  const auth = {
    async signUp(payload) {
      calls.push(['signUp', payload]);
      return { data:{ user, session:{ access_token:'must-not-leak', refresh_token:'must-not-leak' } }, error:null };
    },
    async signInWithPassword(payload) {
      calls.push(['signInWithPassword', payload]);
      return { data:{ user, session:{ access_token:'must-not-leak', refresh_token:'must-not-leak' } }, error:null };
    },
    async getSession() {
      calls.push(['getSession']);
      return { data:{ session:{ user, access_token:'must-not-leak', refresh_token:'must-not-leak' } }, error:null };
    },
    async signOut() {
      calls.push(['signOut']);
      return { error:null };
    },
    ...overrides,
  };
  return { client:{ auth }, calls, user };
}

test('v2 migration creates only additive password-free tables', () => {
  const sql = readIfPresent(migrationPath);
  assert.ok(sql, 'security v2 migration must exist');
  for (const table of ['player_profiles_v2', 'leaderboard_entries_v2', 'shared_state_v2']) {
    assert.match(sql, new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?public\\.${table}`, 'i'));
  }
  assert.doesNotMatch(sql, /\b(?:password|passwd|passphrase)\b\s+(?:text|varchar|jsonb?)/i);
  assert.doesNotMatch(sql, /\b(?:drop|alter)\s+table\s+public\.(?:players|shared_state)\b/i);
});

test('v2 migration forces RLS and contains no open policies', () => {
  const sql = readIfPresent(migrationPath);
  for (const table of ['player_profiles_v2', 'leaderboard_entries_v2', 'shared_state_v2']) {
    assert.match(sql, new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, 'i'));
    assert.match(sql, new RegExp(`alter\\s+table\\s+public\\.${table}\\s+force\\s+row\\s+level\\s+security`, 'i'));
  }
  assert.doesNotMatch(sql, /(?:using|with\s+check)\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(sql, /\bto\s+(?:anon|public)\b/i);
});

test('v2 policies scope student writes to auth.uid and teacher access to trusted app metadata', () => {
  const sql = readIfPresent(migrationPath);
  assert.match(sql, /user_id\s*=\s*\(\s*select\s+auth\.uid\(\)\s*\)/i);
  assert.match(sql, /auth\.jwt\(\)\s*->\s*'app_metadata'\s*->>\s*'role'/i);
  assert.doesNotMatch(sql, /auth\.jwt\(\)\s*->\s*'user_metadata'[^;]*role/i);
  assert.match(sql, /create\s+policy[^;]+teacher[^;]+public\.is_teacher\(\)/is);
});

test('signup trigger verifies that the internal email matches the normalized name hash', () => {
  const sql = readIfPresent(migrationPath);
  assert.match(sql, /digest\s*\(\s*normalized_name\s*,\s*'sha256'\s*\)/i);
  assert.match(sql, /@63world\.invalid/i);
  assert.match(sql, /create\s+trigger[^;]+on\s+auth\.users/is);
});

test('student profile identity fields are immutable after signup', () => {
  const sql = readIfPresent(migrationPath);
  assert.match(sql, /create\s+or\s+replace\s+function\s+public\.protect_profile_identity_v2\(\)/i);
  assert.match(sql, /new\.user_id\s+is\s+distinct\s+from\s+old\.user_id/i);
  assert.match(sql, /new\.normalized_name\s+is\s+distinct\s+from\s+old\.normalized_name/i);
  assert.match(sql, /new\.display_name\s+is\s+distinct\s+from\s+old\.display_name/i);
  assert.match(sql, /if\s+not\s+public\.is_teacher\(\)/i);
  assert.match(sql, /before\s+update\s+on\s+public\.player_profiles_v2/is);
});

test('teacher policies have table privileges while students receive no delete policy', () => {
  const sql = readIfPresent(migrationPath);
  for (const table of ['player_profiles_v2', 'leaderboard_entries_v2', 'shared_state_v2']) {
    assert.match(
      sql,
      new RegExp(`grant\\s+select\\s*,\\s*insert\\s*,\\s*update\\s*,\\s*delete\\s+on\\s+table\\s+public\\.${table}\\s+to\\s+authenticated`, 'i'),
    );
  }
  assert.doesNotMatch(sql, /create\s+policy\s+"students[^"\n]*delete/i);
});

test('student names normalize consistently and reject unsafe input', () => {
  const api = loadAuthApi();
  assert.equal(api.normalizeStudentName('  Ａlice   별  '), 'alice 별');
  assert.equal(api.normalizeStudentName('홍길동'), '홍길동');
  assert.throws(() => api.normalizeStudentName('   '), /이름/);
  assert.throws(() => api.normalizeStudentName('a'.repeat(21)), /20/);
  assert.throws(() => api.normalizeStudentName('학생\u0000'), /이름/);
});

test('internal email is a deterministic SHA-256 identifier without the raw name', async () => {
  const api = loadAuthApi();
  const normalized = 'alice 별';
  const expectedHash = crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
  const first = await api.createInternalEmail('  Ａlice   별  ');
  const second = await api.createInternalEmail('alice 별');
  assert.equal(first, `student-${expectedHash}@63world.invalid`);
  assert.equal(second, first);
  assert.doesNotMatch(first, /alice|별/i);
});

test('student signup sends only safe metadata and returns no password or tokens', async () => {
  const api = loadAuthApi();
  const fake = createFakeClient();
  const service = api.createAuthService({ client:fake.client });
  const result = await service.signUpStudent('  별빛  ', 'secret-123');
  const [, payload] = fake.calls[0];
  assert.equal(fake.calls[0][0], 'signUp');
  assert.match(payload.email, /^student-[a-f0-9]{64}@63world\.invalid$/);
  assert.equal(payload.password, 'secret-123');
  assert.equal(JSON.stringify(payload.options.data), JSON.stringify({ display_name:'별빛', normalized_name:'별빛' }));
  assert.equal(JSON.stringify(result), JSON.stringify({ userId:'student-uuid', displayName:'별빛', role:'student' }));
  assert.doesNotMatch(JSON.stringify(result), /secret-123|access_token|refresh_token|must-not-leak/i);
});

test('student login, session restore, logout, and role checks are sanitized', async () => {
  const api = loadAuthApi();
  const fake = createFakeClient();
  const service = api.createAuthService({ client:fake.client });
  const signedIn = await service.signInStudent('별빛', 'secret-123');
  const restored = await service.restoreSession();
  await service.signOut();
  assert.equal(JSON.stringify(signedIn), JSON.stringify({ userId:'student-uuid', displayName:'별빛', role:'student' }));
  assert.equal(JSON.stringify(restored), JSON.stringify(signedIn));
  assert.equal(service.getRole({ app_metadata:{ role:'teacher' }, user_metadata:{ role:'student' } }), 'teacher');
  assert.equal(service.getRole({ app_metadata:{}, user_metadata:{ role:'teacher' } }), 'student');
  assert.deepEqual(fake.calls.map(([name]) => name), ['signInWithPassword', 'getSession', 'signOut']);
});

test('auth errors are Korean-safe and never echo credentials', async () => {
  const api = loadAuthApi();
  const password = 'do-not-echo-987';
  const fake = createFakeClient({
    async signUp() {
      return { data:{ user:null, session:null }, error:{ message:`User already registered ${password}`, code:'user_already_exists' } };
    },
  });
  const service = api.createAuthService({ client:fake.client });
  await assert.rejects(
    service.signUpStudent('별빛', password),
    (error) => error.code === 'ACCOUNT_EXISTS' && /이미/.test(error.message) && !error.message.includes(password),
  );
});

test('missing session restores as null', async () => {
  const api = loadAuthApi();
  const fake = createFakeClient({
    async getSession() { return { data:{ session:null }, error:null }; },
  });
  const service = api.createAuthService({ client:fake.client });
  assert.equal(await service.restoreSession(), null);
});

test('enterStudent signs in an existing account without attempting signup', async () => {
  const api = loadAuthApi();
  const fake = createFakeClient();
  const service = api.createAuthService({ client:fake.client });
  const result = await service.enterStudent('별빛', 'secret-123');
  assert.equal(JSON.stringify(result), JSON.stringify({
    identity:{ userId:'student-uuid', displayName:'별빛', role:'student' },
    isNewAccount:false,
  }));
  assert.deepEqual(fake.calls.map(([name]) => name), ['signInWithPassword']);
});

test('enterStudent creates an account only after invalid login credentials', async () => {
  const api = loadAuthApi();
  const fake = createFakeClient({
    async signInWithPassword(payload) {
      fake.calls.push(['signInWithPassword', payload]);
      return { data:{ user:null, session:null }, error:{ code:'invalid_credentials', message:'Invalid login credentials' } };
    },
  });
  const service = api.createAuthService({ client:fake.client });
  const result = await service.enterStudent('별빛', 'secret-123');
  assert.equal(result.isNewAccount, true);
  assert.deepEqual(fake.calls.map(([name]) => name), ['signInWithPassword', 'signUp']);
});

test('enterStudent treats an existing signup identity as a wrong password', async () => {
  const api = loadAuthApi();
  const fake = createFakeClient({
    async signInWithPassword() {
      return { data:{ user:null, session:null }, error:{ code:'invalid_credentials', message:'Invalid login credentials' } };
    },
    async signUp() {
      return { data:{ user:null, session:null }, error:{ code:'user_already_exists', message:'User already registered' } };
    },
  });
  const service = api.createAuthService({ client:fake.client });
  await assert.rejects(
    service.enterStudent('별빛', 'wrong-123'),
    (error) => error.code === 'INVALID_CREDENTIALS' && /비밀번호/.test(error.message),
  );
});

test('enterStudent rejects signup when email confirmation prevents an active session', async () => {
  const api = loadAuthApi();
  const fake = createFakeClient({
    async signInWithPassword() {
      return { data:{ user:null, session:null }, error:{ code:'invalid_credentials', message:'Invalid login credentials' } };
    },
    async signUp() {
      return { data:{ user:fake.user, session:null }, error:null };
    },
  });
  const service = api.createAuthService({ client:fake.client });
  await assert.rejects(
    service.enterStudent('별빛', 'secret-123'),
    (error) => error.code === 'AUTH_SETUP_REQUIRED' && /이메일 확인/.test(error.message),
  );
});

test('network failures map to an offline error without echoing credentials', async () => {
  const api = loadAuthApi();
  const password = 'network-secret-123';
  const fake = createFakeClient({
    async signInWithPassword() {
      return { data:{ user:null, session:null }, error:{ message:`Failed to fetch ${password}` } };
    },
  });
  const service = api.createAuthService({ client:fake.client });
  await assert.rejects(
    service.enterStudent('별빛', password),
    (error) => error.code === 'OFFLINE' && /인터넷/.test(error.message) && !error.message.includes(password),
  );
});

test('local Supabase bundle exposes one client factory without project secrets or CDN imports', () => {
  const bundle = readIfPresent(bundlePath);
  const cloudConfig = readIfPresent(path.join(root, 'src/cloud-config.js'));
  const configuredSecrets = [...cloudConfig.matchAll(/(?:url|anonKey)\s*:\s*['"]([^'"]+)['"]/g)]
    .map((match) => match[1])
    .filter((value) => value.length >= 20);
  assert.ok(bundle, 'local Supabase browser bundle must exist');
  assert.match(bundle, /YuksamSupabaseClient/);
  assert.match(bundle, /createClient/);
  assert.doesNotMatch(bundle, /YUKSAM_CLOUD|https?:\/\/cdn/i);
  for (const secret of configuredSecrets) assert.equal(bundle.includes(secret), false);
});
