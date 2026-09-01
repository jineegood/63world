import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const teacherId = '11111111-1111-4111-8111-111111111111';
const studentId = '22222222-2222-4222-8222-222222222222';
const statusMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/202608280002_teacher_student_status_v1.sql'),
  'utf8',
);

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
      hp:51, maxHp:70, skillPoints:3, baseStatsVersion:2,
      appearance:{ shirt:'#112233', pants:'#223344', hair:'#334455', hairStyle:'wave', skin:'#ffe0bd', accessory:'halo', password:'hidden' },
      costume:{ head:'costume_ninja_mask', armor:'costume_ninja_suit', accessory:'costume_spartan_cape', password:'hidden' },
      equipment:{ weapon:'ironwoodStaff', armor:'navyRobe', head:null, accessory:'moonRing', password:'nested-secret' },
      inventory:['ironwoodStaff', 'navyRobe', 'moonRing'],
      skills:{ mage_basic_element:2, mage_fire_meteor_v24:1, invalid:-3 },
      weaponUpgrades:{ ironwoodStaff:3, impossible:99 }, pets:['pet_slime', 'yuksam', ''], activePet:'pet_slime',
      raidNameplates:['raid_20_steel', 'raid_40_twilight', 'raid_63_summit'],
      password:'must-not-leak', email:'student@example.com', access_token:'token-value',
      records:{ answered:12, correct:9, password:'nested-secret', wrongLog:Array.from({ length:35 }, (_, i) => ({
        q:`문제${i}`, a:`정답${i}`, mine:`오답${i}`, at:i, refresh_token:'hidden',
      })) },
    },
  }];
  const teacher = overrides.teacher || { id:teacherId, app_metadata:{ role:'teacher' } };
  const statusRows = overrides.statusRows || [{
    user_id:studentId,
    is_online:true,
    presence_last_seen_at:'2026-08-29T01:02:03.000Z',
    current_map:'town',
    raid_top_group:4,
    raid_top_floor:40,
  }];
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
    async rpc(name, input) {
      calls.push(['rpc', name, input]);
      if (name === 'teacher_student_status_v1') {
        return { data:statusRows, error:overrides.statusError || null };
      }
      if (name === 'teacher_broadcast_world_announcement_v1') {
        return overrides.announcementResult || {
          data:{ ok:true, id:'77', message:input?.p_message, replayed:false }, error:null,
        };
      }
      return { data:null, error:{ status:404 } };
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
    isOnline:true,
    presenceLastSeenAt:'2026-08-29T01:02:03.000Z',
    currentMap:'town',
    raidTopGroup:4,
    raidTopFloor:40,
    className:'mage', spec:'화염', level:7, exp:1234, gold:44, building:8,
    hp:51, maxHp:70, skillPoints:3, baseStatsVersion:2,
    appearance:{ shirt:'#112233', pants:'#223344', hair:'#334455', hairStyle:'wave', skin:'#ffe0bd', accessory:'halo' },
    costume:{ head:'costume_ninja_mask', armor:'costume_ninja_suit', accessory:'costume_spartan_cape' },
    equipment:{ weapon:'ironwoodStaff', armor:'navyRobe', head:null, accessory:'moonRing' },
    inventory:['ironwoodStaff', 'navyRobe', 'moonRing'],
    skills:{ mage_basic_element:2, mage_fire_meteor_v24:1 },
    weaponUpgrades:{ ironwoodStaff:3, impossible:4 }, pets:['pet_slime', 'yuksam'], activePet:'pet_slime',
    raidNameplates:['raid_20_steel', 'raid_40_twilight', 'raid_63_summit'],
    records:{ answered:12, correct:9, wrongLog:Array.from({ length:30 }, (_, i) => ({
      q:`문제${i + 5}`, a:`정답${i + 5}`, mine:`오답${i + 5}`, at:i + 5,
    })) },
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result[0]), true);
  assert.doesNotMatch(JSON.stringify(result), /password|email|token|must-not-leak|hidden/i);
  assert.deepEqual(calls.filter(([name]) => ['select', 'order'].includes(name)).map(([name]) => name), ['select', 'order']);
  assert.equal(calls.find(([name]) => name === 'select')[1], 'user_id,display_name,data,updated_at');
  assert.deepEqual(calls.find(([name]) => name === 'rpc'), ['rpc', 'teacher_student_status_v1', undefined]);
});

test('student status is sanitized and raid group seven maps to the real 63rd floor', async () => {
  const { service } = setup({ statusRows:[{
    user_id:studentId,
    is_online:false,
    presence_last_seen_at:'2026-08-29T00:00:00.000Z',
    current_map:'dungeon',
    raid_top_group:99,
    raid_top_floor:999,
  }] });
  const [student] = await service.listStudents();
  assert.deepEqual({
    isOnline:student.isOnline,
    presenceLastSeenAt:student.presenceLastSeenAt,
    currentMap:student.currentMap,
    raidTopGroup:student.raidTopGroup,
    raidTopFloor:student.raidTopFloor,
  }, {
    isOnline:false,
    presenceLastSeenAt:'2026-08-29T00:00:00.000Z',
    currentMap:'dungeon',
    raidTopGroup:7,
    raidTopFloor:63,
  });
});

test('teacher status RPC is the only client boundary for world presence and authoritative raid progress', () => {
  assert.match(statusMigration, /create or replace function public\.teacher_student_status_v1\(\)/i);
  assert.match(statusMigration, /security definer/i);
  assert.match(statusMigration, /if auth\.uid\(\) is null or not public\.is_teacher\(\)/i);
  assert.match(statusMigration, /last_seen_at\s*>=\s*v_online_cutoff/i);
  assert.match(statusMigration, /interval '8 seconds'/i);
  assert.match(statusMigration, /left join public\.raid_progress_v1 as raid_progress/i);
  assert.match(statusMigration, /coalesce\(raid_progress\.top_group, 0\)::integer as raid_top_group/i);
  assert.match(statusMigration, /when coalesce\(raid_progress\.top_group, 0\) = 7 then 63/i);
  assert.doesNotMatch(statusMigration, /profile\.data\s*->\s*'raidTopGroup'/i);
  assert.match(statusMigration, /revoke all on table public\.world_presence_v1[\s\S]*from public, anon, authenticated/i);
  assert.doesNotMatch(statusMigration, /grant\s+select\s+on\s+(?:table\s+)?public\.world_presence_v1/i);
  assert.match(statusMigration, /grant execute on function public\.teacher_student_status_v1\(\)[\s\S]*to authenticated/i);
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
    await assert.rejects(service.applyStudentCheat(studentId, 'exp20'), (error) => error.code === 'FORBIDDEN');
    await assert.rejects(
      service.broadcastAnnouncement('수업 종료', '30000000-0000-4000-8000-000000000003'),
      (error) => error.code === 'FORBIDDEN',
    );
  }
});

test('broadcastAnnouncement validates and normalizes one teacher-only global notice RPC', async () => {
  const { calls, service } = setup();
  const requestId = '30000000-0000-4000-8000-000000000003';
  for (const [message, id] of [
    ['', requestId],
    ['가'.repeat(121), requestId],
    ['중단\u0000공지', requestId],
    ['정상 공지', 'not-a-uuid'],
  ]) {
    await assert.rejects(service.broadcastAnnouncement(message, id), (error) => error.code === 'INVALID_ANNOUNCEMENT');
  }

  const result = await service.broadcastAnnouncement('  1분 뒤   서버가 종료됩니다!  ', requestId);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    id:'77', message:'1분 뒤 서버가 종료됩니다!', replayed:false,
  });
  const rpc = calls.find(([, name]) => name === 'teacher_broadcast_world_announcement_v1');
  assert.deepEqual(JSON.parse(JSON.stringify(rpc)), [
    'rpc', 'teacher_broadcast_world_announcement_v1',
    { p_message:'1분 뒤 서버가 종료됩니다!', p_request_id:requestId },
  ]);
});

test('announcement backend errors remain safe and expose rate limiting without raw details', async () => {
  const { service } = setup({
    announcementResult:{ data:null, error:{ message:'teacher announcement rate limited secret' } },
  });
  await assert.rejects(
    service.broadcastAnnouncement('잠시 뒤 종료', '30000000-0000-4000-8000-000000000004'),
    (error) => {
      assert.equal(error.code, 'RATE_LIMITED');
      assert.doesNotMatch(error.message, /secret/i);
      return true;
    },
  );
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

test('applyStudentCheat accepts only fixed actions and delegates to the teacher function', async () => {
  const snapshot = { exp:20, level:2, skillPoints:2, gold:0, building:0, hp:24, maxHp:24 };
  const { calls, service } = setup({
    invokeResult:{ data:{ ok:true, displayName:'별빛', snapshot }, error:null },
  });
  for (const action of ['exp1000', 'gold999999', '', null]) {
    await assert.rejects(service.applyStudentCheat(studentId, action), (error) => error.code === 'CHEAT_FAILED');
  }
  await assert.rejects(service.applyStudentCheat('not-a-uuid', 'exp20'), (error) => error.code === 'STUDENT_NOT_FOUND');

  const result = await service.applyStudentCheat(studentId, 'exp20');
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    displayName:'별빛', action:'exp20', snapshot, newNameplates:[],
  });
  const invoke = calls.find(([name, fn]) => name === 'invoke' && fn === 'teacher-apply-cheat');
  assert.deepEqual(JSON.parse(JSON.stringify(invoke[2])), {
    body:{ userId:studentId, action:'exp20' },
  });

  const raidResult = await service.applyStudentCheat(studentId, 'raidAdvance');
  assert.equal(raidResult.action, 'raidAdvance');
  const raidInvoke = calls.filter(([name, fn]) => name === 'invoke' && fn === 'teacher-apply-cheat').at(-1);
  assert.deepEqual(JSON.parse(JSON.stringify(raidInvoke[2])), {
    body:{ userId:studentId, action:'raidAdvance' },
  });
});

test('raid progress cheat exposes only approved newly unlocked nameplates', async () => {
  const snapshot = {
    raidTopGroup:2,
    raidNameplates:['raid_20_steel'],
    nameplate:{ theme:'default' },
  };
  const { service } = setup({
    invokeResult:{
      data:{
        ok:true,
        displayName:'별빛',
        snapshot,
        newNameplates:['raid_20_steel', 'forged_nameplate'],
      },
      error:null,
    },
  });
  const result = await service.applyStudentCheat(studentId, 'raidAdvance');
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    displayName:'별빛',
    action:'raidAdvance',
    snapshot,
    newNameplates:['raid_20_steel'],
  });
});

test('killRaidMonster delegates one server-authoritative raid kill for the current student', async () => {
  const invokeResult = { data:{
    ok:true,
    displayName:'테스터',
    monsterName:'버섯돌이킹',
    roomId:'33333333-3333-4333-8333-333333333333',
    round:4,
  }, error:null };
  const { calls, service } = setup({ invokeResult });
  const result = await service.killRaidMonster(studentId);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    displayName:'테스터',
    monsterName:'버섯돌이킹',
    roomId:'33333333-3333-4333-8333-333333333333',
    round:4,
  });
  const invoke = calls.find(([name, fn]) => name === 'invoke' && fn === 'teacher-apply-cheat');
  assert.deepEqual(JSON.parse(JSON.stringify(invoke[2])), {
    body:{ userId:studentId, action:'raidKill' },
  });
});

test('killRaidMonster shows safe raid-state errors returned by the server', async () => {
  const { service } = setup({
    invokeResult:{ data:{ ok:false, code:'RAID_NOT_IN_BATTLE' }, error:null },
  });
  await assert.rejects(service.killRaidMonster(studentId), (error) => {
    assert.equal(error.code, 'RAID_NOT_IN_BATTLE');
    assert.match(error.message, /던전 전투/);
    return true;
  });
});

test('toggleRaidPause delegates one server-authoritative pause or resume', async () => {
  const invokeResult = { data:{
    ok:true,
    displayName:'테스트',
    roomId:'33333333-3333-4333-8333-333333333333',
    paused:true,
    resumedPhase:'question',
    remainingSeconds:17,
  }, error:null };
  const { calls, service } = setup({ invokeResult });
  const result = await service.toggleRaidPause(studentId);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    displayName:'테스트',
    roomId:'33333333-3333-4333-8333-333333333333',
    paused:true,
    resumedPhase:'question',
    remainingSeconds:17,
  });
  const invoke = calls.find(([name, fn]) => name === 'invoke' && fn === 'teacher-apply-cheat');
  assert.deepEqual(JSON.parse(JSON.stringify(invoke[2])), {
    body:{ userId:studentId, action:'raidPause' },
  });
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
