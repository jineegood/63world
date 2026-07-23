import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');

function loadApi() {
  const file = path.join(root, 'src/admin-auth-v2.js');
  assert.ok(fs.existsSync(file), 'src/admin-auth-v2.js must exist');
  const window = {};
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { window }, { filename:'src/admin-auth-v2.js' });
  return window.YuksamAdminAuthV2;
}

function setup(overrides = {}) {
  const calls = [];
  const teacher = { id:'teacher-1', email:'teacher@example.com', app_metadata:{ role:'teacher' } };
  const client = {
    auth:{
      async signInWithPassword(input) { calls.push(['signIn', input]); return { data:{ user:teacher }, error:null }; },
      async getUser() { calls.push(['getUser']); return { data:{ user:teacher }, error:null }; },
      async signOut() { calls.push(['signOut']); return { error:null }; },
      async updateUser(input) { calls.push(['updateUser', input]); return { data:{ user:teacher }, error:null }; },
      ...overrides.auth,
    },
    functions:{
      async invoke(name, input) { calls.push(['invoke', name, input]); return { data:{ ok:true, displayName:'별빛' }, error:null }; },
      ...overrides.functions,
    },
  };
  const normalizeStudentName = (value) => String(value).normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ko-KR');
  return { calls, client, teacher, service:loadApi().create({ client, normalizeStudentName }) };
}

test('teacher sign-in returns only a sanitized trusted identity', async () => {
  const { service } = setup();
  const result = await service.signIn('teacher@example.com', 'teacher-secret');
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    userId:'teacher-1', email:'teacher@example.com', role:'teacher',
  });
  assert.equal(JSON.stringify(result).includes('teacher-secret'), false);
  assert.equal('session' in result, false);
});

test('student role and user_metadata teacher claims are rejected and signed out', async () => {
  for (const user of [
    { id:'student-1', email:'s@example.com', app_metadata:{ role:'student' } },
    { id:'student-2', email:'s2@example.com', user_metadata:{ role:'teacher' } },
  ]) {
    const calls = [];
    const { service } = setup({ auth:{
      async signInWithPassword() { return { data:{ user }, error:null }; },
      async signOut() { calls.push('signOut'); return { error:null }; },
    } });
    await assert.rejects(service.signIn('s@example.com', 'student-secret'), (error) => error.code === 'FORBIDDEN');
    assert.deepEqual(calls, ['signOut']);
  }
});

test('restore verifies the current user with getUser and logout uses Auth', async () => {
  const { calls, service } = setup();
  const identity = await service.restore();
  assert.equal(identity.role, 'teacher');
  await service.signOut();
  assert.deepEqual(calls.map(([name]) => name), ['getUser', 'signOut']);
});

test('missing session restores as null while raw credential errors stay hidden', async () => {
  const { service } = setup({ auth:{
    async getUser() { return { data:{ user:null }, error:{ code:'session_not_found', message:'JWT secret-token-value' } }; },
    async signInWithPassword() { return { data:null, error:{ code:'invalid_credentials', message:'invalid login credentials secret-password' } }; },
  } });
  assert.equal(await service.restore(), null);
  await assert.rejects(service.signIn('teacher@example.com', 'secret-password'), (error) => {
    assert.equal(error.code, 'INVALID_CREDENTIALS');
    assert.equal(error.message.includes('secret-password'), false);
    assert.equal(error.message.includes('secret-token-value'), false);
    return true;
  });
});

test('network errors map to a safe Korean offline error', async () => {
  const { service } = setup({ auth:{
    async signInWithPassword() { return { data:null, error:new Error('Failed to fetch https://secret-host') }; },
  } });
  await assert.rejects(service.signIn('teacher@example.com', 'teacher-secret'), (error) => {
    assert.equal(error.code, 'OFFLINE');
    assert.match(error.message, /인터넷|연결/);
    assert.equal(error.message.includes('secret-host'), false);
    return true;
  });
});

test('own password change validates length, rechecks role, and calls updateUser', async () => {
  const { calls, service } = setup();
  await assert.rejects(service.changeOwnPassword('12345'), (error) => error.code === 'INVALID_PASSWORD');
  await assert.rejects(service.changeOwnPassword('x'.repeat(73)), (error) => error.code === 'INVALID_PASSWORD');
  await service.changeOwnPassword('new-teacher-password');
  assert.deepEqual(calls.map(([name]) => name), ['getUser', 'updateUser']);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1][1])), { password:'new-teacher-password' });
});

test('student reset normalizes the exact name and returns no credential', async () => {
  const { calls, service } = setup();
  const result = await service.resetStudentPassword('  별빛  ', 'new-student-password');
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { displayName:'별빛' });
  assert.deepEqual(calls.map(([name]) => name), ['getUser', 'invoke']);
  assert.equal(calls[1][1], 'teacher-reset-password');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1][2])), {
    body:{ normalizedName:'별빛', newPassword:'new-student-password' },
  });
  assert.equal(JSON.stringify(result).includes('new-student-password'), false);
});

test('reset maps forbidden, missing, rate-limit, offline, and generic failures safely', async () => {
  const cases = [
    [{ status:403, message:'secret forbidden detail' }, 'FORBIDDEN'],
    [{ status:404, message:'student secret record' }, 'STUDENT_NOT_FOUND'],
    [{ status:429, message:'rate limit secret' }, 'RATE_LIMITED'],
    [new Error('Failed to fetch secret endpoint'), 'OFFLINE'],
    [{ status:500, message:'database password secret' }, 'RESET_FAILED'],
  ];
  for (const [sourceError, expectedCode] of cases) {
    const { service } = setup({ functions:{
      async invoke() { return { data:null, error:sourceError }; },
    } });
    await assert.rejects(service.resetStudentPassword('별빛', 'new-student-password'), (error) => {
      assert.equal(error.code, expectedCode);
      assert.equal(error.message.includes('secret'), false);
      assert.equal(error.message.includes('password'), false);
      return true;
    });
  }
});
