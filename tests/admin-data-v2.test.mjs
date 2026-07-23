import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const teacherId = '11111111-1111-4111-8111-111111111111';
const studentId = '22222222-2222-4222-8222-222222222222';

function loadApi() {
  const file = path.join(root, 'src/admin-data-v2.js');
  assert.ok(fs.existsSync(file), 'src/admin-data-v2.js must exist');
  const window = {};
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { window }, { filename:'src/admin-data-v2.js' });
  return window.YuksamAdminDataV2;
}

function setup(overrides = {}) {
  const calls = [];
  const rows = overrides.rows || [{
    user_id:studentId,
    display_name:'별빛',
    updated_at:'2026-07-23T01:02:03.000Z',
    data:{
      class:'mage', spec:'화염', level:7, exp:1234, gold:44, building:8,
      password:'must-not-leak', email:'student@example.com', access_token:'token-value',
      records:{ answered:12, correct:9, password:'nested-secret', wrongLog:Array.from({ length:35 }, (_, i) => ({
        q:`문제${i}`, a:`정답${i}`, mine:`오답${i}`, at:i, refresh_token:'hidden',
      })) },
    },
  }];
  const teacher = overrides.teacher || { id:teacherId, app_metadata:{ role:'teacher' } };
  const client = {
    auth:{
      async getUser() { calls.push(['getUser']); return { data:{ user:teacher }, error:null }; },
      ...overrides.auth,
    },
    from(table) {
      calls.push(['from', table]);
      if (table === 'player_profiles_v2') {
        return {
          select(columns) {
            calls.push(['select', columns]);
            return {
              async order(column, options) { calls.push(['order', column, options]); return { data:rows, error:null }; },
              eq(column, value) {
                calls.push(['eq', column, value]);
                return { async maybeSingle() {
                  const row = rows.find((item) => item.user_id === value);
                  return { data:row ? { display_name:row.display_name } : null, error:null };
                } };
              },
            };
          },
        };
      }
      if (table === 'student_reward_grants_v2') {
        return { async insert(payload) { calls.push(['insert', payload]); return { data:null, error:overrides.insertError || null }; } };
      }
      throw new Error(`unexpected table ${table}`);
    },
    functions:{
      async invoke(name, input) {
        calls.push(['invoke', name, input]);
        return overrides.invokeResult || { data:{ ok:true, displayName:'별빛' }, error:null };
      },
    },
  };
  return { calls, service:loadApi().create({ client }) };
}

test('listStudents returns only frozen sanitized summaries ordered by the backend', async () => {
  const { calls, service } = setup();
  const result = await service.listStudents();
  assert.equal(result.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(result[0])), {
    userId:studentId,
    displayName:'별빛',
    updatedAt:'2026-07-23T01:02:03.000Z',
    className:'mage', spec:'화염', level:7, exp:1234, gold:44, building:8,
    records:{ answered:12, correct:9, wrongLog:Array.from({ length:30 }, (_, i) => ({
      q:`문제${i + 5}`, a:`정답${i + 5}`, mine:`오답${i + 5}`, at:i + 5,
    })) },
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result[0]), true);
  assert.doesNotMatch(JSON.stringify(result), /password|email|token|must-not-leak|hidden/i);
  assert.deepEqual(calls.filter(([name]) => ['select', 'order'].includes(name)).map(([name]) => name), ['select', 'order']);
  assert.equal(calls.find(([name]) => name === 'select')[1], 'user_id,display_name,data,updated_at');
});

test('student or user_metadata teacher claims cannot list or mutate', async () => {
  for (const teacher of [
    { id:studentId, app_metadata:{ role:'student' } },
    { id:studentId, user_metadata:{ role:'teacher' } },
  ]) {
    const { service } = setup({ teacher });
    await assert.rejects(service.listStudents(), (error) => error.code === 'FORBIDDEN');
    await assert.rejects(service.grantReward(studentId, { gold:1, building:0, exp:0 }), (error) => error.code === 'FORBIDDEN');
    await assert.rejects(service.deleteStudent(studentId), (error) => error.code === 'FORBIDDEN');
  }
});

test('grantReward validates bounds and inserts one exact append-only grant', async () => {
  const { calls, service } = setup();
  for (const reward of [
    { gold:0, building:0, exp:0 },
    { gold:-1, building:0, exp:0 },
    { gold:1.5, building:0, exp:0 },
    { gold:1000001, building:0, exp:0 },
  ]) await assert.rejects(service.grantReward(studentId, reward), (error) => error.code === 'INVALID_REWARD');
  await assert.rejects(service.grantReward('not-a-uuid', { gold:1, building:0, exp:0 }), (error) => error.code === 'STUDENT_NOT_FOUND');

  const result = await service.grantReward(studentId, { gold:10, building:2, exp:30 });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { displayName:'별빛' });
  const insert = calls.find(([name]) => name === 'insert');
  assert.deepEqual(JSON.parse(JSON.stringify(insert[1])), {
    user_id:studentId, gold:10, building:2, exp:30, created_by:teacherId,
  });
});

test('deleteStudent invokes the exact server function with only an immutable user id', async () => {
  const { calls, service } = setup();
  const result = await service.deleteStudent(studentId);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { displayName:'별빛' });
  const invoke = calls.find(([name]) => name === 'invoke');
  assert.equal(invoke[1], 'teacher-delete-student');
  assert.deepEqual(JSON.parse(JSON.stringify(invoke[2])), { body:{ userId:studentId } });
});

test('backend failures map to safe errors without leaking raw details', async () => {
  const { service:grantService } = setup({ insertError:{ status:429, message:'secret database password' } });
  await assert.rejects(grantService.grantReward(studentId, { gold:1, building:0, exp:0 }), (error) => {
    assert.equal(error.code, 'RATE_LIMITED');
    assert.doesNotMatch(error.message, /secret|database|password/i);
    return true;
  });
  const { service:deleteService } = setup({ invokeResult:{ data:null, error:new Error('Failed to fetch secret-host') } });
  await assert.rejects(deleteService.deleteStudent(studentId), (error) => {
    assert.equal(error.code, 'OFFLINE');
    assert.doesNotMatch(error.message, /secret-host/i);
    return true;
  });
});
