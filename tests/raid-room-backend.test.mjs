import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/202608010002_raid_party_rooms_v1.sql'),
  'utf8',
);
const individualQuestionsMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/202608020001_raid_individual_questions_v1.sql'),
  'utf8',
);
const serviceUrl = pathToFileURL(path.join(root, 'supabase/functions/_shared/raid-room-service.mjs'));
const errorUrl = pathToFileURL(path.join(root, 'supabase/functions/_shared/raid-room-error.mjs'));
const storeUrl = pathToFileURL(path.join(root, 'supabase/functions/_shared/raid-room-store.mjs'));

test('raid migration enforces four-digit rooms, one active room per student, and exactly three seats', () => {
  assert.match(migration, /invite_code\s+text[\s\S]*\^\[0-9\]\{4\}\$/i);
  assert.match(migration, /raid_rooms_v1_active_code_unique[\s\S]*where phase in/i);
  assert.match(migration, /raid_room_members_v1_one_active_room[\s\S]*where active/i);
  assert.match(migration, /join_order smallint[\s\S]*between 1 and 3/i);
  assert.match(migration, /v_member_count\s*>=\s*3[\s\S]*ROOM_FULL/i);
  assert.match(migration, /v_count\s*<>\s*3[\s\S]*PARTY_INCOMPLETE/i);
  assert.match(migration, /count\(distinct slot\)[\s\S]*v_slots\s*<>\s*3/i);
  assert.match(migration, /p_floor_group\s*<>\s*1[\s\S]*INVALID_REQUEST/i);
});

test('raid tables force RLS, expose only participant views, and keep answers and writes private', () => {
  for (const table of [
    'raid_rooms_v1', 'raid_room_members_v1', 'raid_question_secrets_v1',
    'raid_round_inputs_v1', 'raid_events_v1', 'raid_join_attempts_v1',
  ]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
    assert.match(migration, new RegExp(`alter table public\\.${table} force row level security`, 'i'));
    assert.match(migration, new RegExp(`revoke all on table public\\.${table} from anon, authenticated`, 'i'));
  }
  assert.match(migration, /private_is_raid_member_v1[\s\S]*member\.user_id\s*=\s*auth\.uid\(\)[\s\S]*member\.active/i);
  assert.doesNotMatch(migration, /grant select on table public\.raid_question_secrets_v1 to authenticated/i);
  assert.doesNotMatch(migration, /grant select on table public\.raid_round_inputs_v1 to authenticated/i);
  assert.doesNotMatch(migration, /grant\s+(insert|update|delete)[^;]*raid_[a-z_]+_v1[^;]*authenticated/i);
});

test('room, member and public event rows are enabled for realtime updates', () => {
  for (const table of ['raid_rooms_v1', 'raid_room_members_v1', 'raid_events_v1']) {
    assert.match(migration, new RegExp(`alter publication supabase_realtime add table public\\.${table}`, 'i'));
  }
});

test('each raid member has a private answer key and a matching public question', () => {
  assert.match(individualQuestionsMigration, /p_question_public\s*->\s*'byUser'/i);
  assert.match(individualQuestionsMigration, /p_answer_key::jsonb/i);
  assert.match(individualQuestionsMigration, /v_answer_key\s*:=\s*v_answer_keys\s*->>\s*p_user_id::text/i);
  assert.match(individualQuestionsMigration, /v_question_count\s*<>\s*v_member_count/i);
  assert.match(individualQuestionsMigration, /v_answer_count\s*<>\s*v_member_count/i);
});

test('all state mutations are service-only RPCs with database locks and host-authoritative publishing', () => {
  for (const fn of [
    'private_create_raid_room_v1', 'private_join_raid_room_v1',
    'private_set_raid_formation_v1', 'private_set_raid_ready_v1',
    'private_start_raid_room_v1', 'private_begin_raid_round_v1',
    'private_submit_raid_round_v1', 'private_publish_raid_round_v1',
    'private_heartbeat_raid_room_v1', 'private_leave_raid_room_v1',
  ]) {
    assert.match(migration, new RegExp(`create or replace function public\\.${fn}`, 'i'));
    assert.match(migration, new RegExp(`grant execute on function public\\.${fn}[\\s\\S]*to service_role`, 'i'));
  }
  assert.match(migration, /private_publish_raid_round_v1[\s\S]*for update[\s\S]*v_room\.host_id\s*<>\s*p_user_id[\s\S]*HOST_ONLY/i);
  assert.match(migration, /primary key \(room_id, round_no, user_id\)/i);
  assert.match(migration, /unique \(user_id, request_id\)/i);
});

test('service ignores caller combat stats and loads the authenticated profile from storage', async () => {
  const { createRaidRoomService } = await import(serviceUrl.href);
  const calls = [];
  const serverProfile = { name:'서버별빛', attack:7 };
  const service = createRaidRoomService({
    now:() => 1000,
    store:{
      getAuthoritativeProfile:async () => serverProfile,
      createRoom:async (value) => { calls.push(value); return { roomId:'room-1' }; },
      getRoomForUser:async () => ({ id:'room-1', hostId:'a', phase:'lobby', round:0 }),
      listMembers:async () => [],
      listEventsAfter:async () => [],
    },
  });
  await service.handle('a', {
    op:'create', floorGroup:1, profile:{ name:'조작', attack:999999 }, requestId:'req-1',
  });
  assert.equal(calls[0].profile, serverProfile);
  assert.equal(calls[0].profile.attack, 7);
});

test('앞 구간을 깬 사람만 다음 구간의 방을 만들 수 있다', async () => {
  const { createRaidRoomService } = await import(serviceUrl.href);
  const madeRooms = [];
  const withProgress = (cleared) => createRaidRoomService({
    now:() => 1000,
    store:{
      getAuthoritativeProfile:async () => ({ name:'A', raidTopGroup:cleared }),
      createRoom:async (value) => { madeRooms.push(value.floorGroup); return { roomId:'room-1' }; },
      getRoomForUser:async () => ({ id:'room-1', hostId:'a', phase:'lobby', round:0 }),
      listMembers:async () => [],
      listEventsAfter:async () => [],
    },
  });

  // 아직 하나도 못 깼으면 1구간만 만들 수 있다.
  await withProgress(0).handle('a', { op:'create', floorGroup:1, requestId:'r1' });
  await assert.rejects(
    withProgress(0).handle('a', { op:'create', floorGroup:2, requestId:'r2' }),
    (error) => error.code === 'FLOOR_LOCKED',
  );

  // 1구간을 깼으면 2구간까지 열린다. 3구간은 아직이다.
  await withProgress(1).handle('a', { op:'create', floorGroup:2, requestId:'r3' });
  await assert.rejects(
    withProgress(1).handle('a', { op:'create', floorGroup:3, requestId:'r4' }),
    (error) => error.code === 'FLOOR_LOCKED',
  );
  assert.deepEqual(madeRooms, [1, 2]);

  // 없는 구간 번호는 막는다.
  await assert.rejects(
    withProgress(7).handle('a', { op:'create', floorGroup:8, requestId:'r5' }),
    (error) => error.code === 'FLOOR_LOCKED',
  );
  await assert.rejects(
    withProgress(7).handle('a', { op:'create', floorGroup:0, requestId:'r6' }),
    (error) => error.code === 'FLOOR_LOCKED',
  );
});

test('셋 중 한 명이라도 구간을 못 열었으면 출발할 수 없다', async () => {
  const { createRaidRoomService } = await import(serviceUrl.href);
  const started = [];
  const withRoster = (roster) => createRaidRoomService({
    now:() => 1000,
    store:{
      getRoomForUser:async () => ({ id:'room-1', hostId:'a', phase:'lobby', floorGroup:3, round:0 }),
      listMembers:async () => roster,
      listEventsAfter:async () => [],
      startRoom:async (value) => { started.push(value.roomId); },
    },
  });
  const member = (userId, cleared) => ({ userId, profile:{ name:userId, raidTopGroup:cleared } });

  // 셋 다 2구간까지 깼으면 3구간에 들어갈 수 있다.
  await withRoster([member('a', 2), member('b', 2), member('c', 2)])
    .handle('a', { op:'start', roomId:'room-1', requestId:'s1' });
  assert.deepEqual(started, ['room-1']);

  // 한 명이 뒤처져 있으면 막힌다.
  await assert.rejects(
    withRoster([member('a', 2), member('b', 0), member('c', 2)])
      .handle('a', { op:'start', roomId:'room-1', requestId:'s2' }),
    (error) => error.code === 'FLOOR_LOCKED',
  );
  assert.deepEqual(started, ['room-1'], '막혔으면 출발시키지 않는다');
});

test('초대 코드는 숫자 네 자리여야 한다', async () => {
  const { createRaidRoomService } = await import(serviceUrl.href);
  const service = createRaidRoomService({
    store:{ getAuthoritativeProfile:async () => ({ name:'A' }) },
  });
  await assert.rejects(
    service.handle('a', { op:'join', code:'123', requestId:'r2' }),
    (error) => error.code === 'ROOM_NOT_FOUND',
  );
});

test('resume restores the authenticated active room snapshot from sequence zero', async () => {
  const { createRaidRoomService } = await import(serviceUrl.href);
  const calls = [];
  const service = createRaidRoomService({
    store:{
      findActiveRoomForUser:async (userId) => {
        calls.push(['find', userId]);
        return { id:'room-active', phase:'travel' };
      },
      getRoomForUser:async (roomId, userId) => {
        calls.push(['room', roomId, userId]);
        return { id:roomId, hostId:'student-a', phase:'travel', round:2 };
      },
      listMembers:async (roomId) => {
        calls.push(['members', roomId]);
        return [{ userId:'student-a' }, { userId:'b' }, { userId:'c' }];
      },
      listEventsAfter:async (roomId, sequence) => {
        calls.push(['events', roomId, sequence]);
        return [{ sequenceNo:1, event:{ kind:'travel' } }];
      },
    },
  });

  const restored = await service.handle('student-a', { op:'resume' });

  assert.equal(restored.room.id, 'room-active');
  assert.equal(restored.members.length, 3);
  assert.equal(restored.events.length, 1);
  assert.deepEqual(calls.at(-1), ['events', 'room-active', 0]);
});

test('create and join recover the existing active room when storage reports ALREADY_IN_ROOM', async () => {
  const { createRaidRoomService } = await import(serviceUrl.href);
  const attempted = [];
  const alreadyInRoom = Object.assign(new Error('ALREADY_IN_ROOM'), { code:'ALREADY_IN_ROOM' });
  const service = createRaidRoomService({
    store:{
      getAuthoritativeProfile:async () => ({ name:'A', attack:5 }),
      createRoom:async () => { attempted.push('create'); throw alreadyInRoom; },
      joinRoom:async () => { attempted.push('join'); throw alreadyInRoom; },
      findActiveRoomForUser:async () => ({ id:'room-active', phase:'lobby' }),
      getRoomForUser:async () => ({ id:'room-active', hostId:'student-a', phase:'lobby', round:0 }),
      listMembers:async () => [{ userId:'student-a' }],
      listEventsAfter:async () => [],
    },
  });

  const created = await service.handle('student-a', {
    op:'create', floorGroup:1, requestId:'create-retry',
  });
  const joined = await service.handle('student-a', {
    op:'join', code:'1234', requestId:'join-retry',
  });

  assert.equal(created.room.id, 'room-active');
  assert.equal(joined.room.id, 'room-active');
  assert.deepEqual(attempted, ['create', 'join']);
});

test('resume reports ROOM_NOT_FOUND when the authenticated user has no active room', async () => {
  const { createRaidRoomService } = await import(serviceUrl.href);
  const service = createRaidRoomService({
    store:{ findActiveRoomForUser:async () => null },
  });
  await assert.rejects(
    service.handle('student-a', { op:'resume' }),
    (error) => error.code === 'ROOM_NOT_FOUND',
  );
});

test('Supabase store finds only a non-terminal active room for resume', async () => {
  const { createSupabaseRaidRoomStore } = await import(storeUrl.href);
  const queried = [];
  const rows = {
    raid_room_members_v1:{ room_id:'room-active' },
    raid_rooms_v1:{
      id:'room-active', invite_code:'1234', host_id:'student-a', floor_group:1,
      phase:'travel', encounter_index:1, current_floor:3, round_no:2,
      monster_state:{ hp:5 }, question_public:null, version:4, next_sequence:8,
    },
  };
  const client = {
    from(table) {
      const query = {
        select(columns) { queried.push([table, 'select', columns]); return query; },
        eq(column, value) { queried.push([table, 'eq', column, value]); return query; },
        limit(value) { queried.push([table, 'limit', value]); return query; },
        async maybeSingle() { return { data:rows[table] || null, error:null }; },
      };
      return query;
    },
    rpc:async () => ({ data:null, error:null }),
  };
  const store = createSupabaseRaidRoomStore(client);

  const room = await store.findActiveRoomForUser('student-a');

  assert.equal(room.id, 'room-active');
  assert.equal(room.phase, 'travel');
  assert.equal(queried.some((entry) => entry[0] === 'raid_room_members_v1'
    && entry[1] === 'eq' && entry[2] === 'active' && entry[3] === true), true);
});

test('only the host receives private correctness judgements after all submissions', async () => {
  const { createRaidRoomService } = await import(serviceUrl.href);
  const store = {
    getRoomForUser:async (_roomId, userId) => ({
      id:'room-1', hostId:'host', phase:'resolving', round:3, viewer:userId,
    }),
    listMembers:async () => [{ userId:'host' }, { userId:'b' }, { userId:'c' }],
    listEventsAfter:async () => [],
    listRoundJudgements:async () => [
      { userId:'host', actionId:'basic', correct:true },
      { userId:'b', actionId:'double', correct:false },
      { userId:'c', actionId:'heal', correct:true },
    ],
    getRoundAnswerKeys:async () => ({ host:'42', b:'7', c:'9' }),
  };
  const service = createRaidRoomService({ store });
  const host = await service.handle('host', { op:'sync', roomId:'room-1', afterSequence:0 });
  const member = await service.handle('b', { op:'sync', roomId:'room-1', afterSequence:0 });
  assert.equal(host.submissions.length, 3);
  assert.deepEqual(host.answerKeys, { host:'42', b:'7', c:'9' });
  assert.equal('submissions' in member, false);
  assert.equal('answerKeys' in member, false);
});

test('published events strip raw answers and reject an invalid next phase', async () => {
  const { RaidRoomValidation } = await import(serviceUrl.href);
  const safe = RaidRoomValidation.normalizePublishResult({
    nextPhase:'effects',
    events:[{ kind:'answer', correctAnswer:'2', submittedAnswer:'999', requestId:'secret' }],
    memberStates:{ a:{ hp:10, maxHp:10, shield:0 } },
  });
  assert.equal(safe.events[0].correctAnswer, '2');
  assert.equal('submittedAnswer' in safe.events[0], false);
  assert.equal('requestId' in safe.events[0], false);
  assert.throws(
    () => RaidRoomValidation.normalizePublishResult({ nextPhase:'question', events:[] }),
    (error) => error.code === 'INVALID_REQUEST',
  );
});

test('backend error mapping hides raw database details', async () => {
  const { publicRaidRoomErrorCode } = await import(errorUrl.href);
  assert.equal(publicRaidRoomErrorCode({ code:'P0001', message:'ROOM_FULL' }), 'ROOM_FULL');
  assert.equal(publicRaidRoomErrorCode({ code:'PGRST002', message:'schema cache' }), 'TEMPORARY_UNAVAILABLE');
  assert.equal(publicRaidRoomErrorCode({ code:'23505', message:'sensitive row detail' }), 'SERVER_ERROR');
});
