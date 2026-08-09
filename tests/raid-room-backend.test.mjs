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
const playbackBarrierMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/202608090001_raid_playback_barrier_v1.sql'),
  'utf8',
);
const progressAuthorityMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/202608090002_raid_progress_authority_v1.sql'),
  'utf8',
);
const firstClearRewardMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/202608090003_raid_first_clear_rewards_v1.sql'),
  'utf8',
);
const questionReadyBarrierMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/202608090004_raid_question_ready_barrier_v1.sql'),
  'utf8',
);
const raidBalanceMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/202608090006_raid_balance_and_teacher_progress_v1.sql'),
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

test('세 화면의 전투 연출이 모두 끝나야 서버가 다음 문제를 연다', () => {
  assert.match(playbackBarrierMigration, /add column if not exists playback_round integer not null default 0/i);
  assert.match(playbackBarrierMigration, /private_ack_raid_playback_v1[\s\S]*greatest\(playback_round, p_round_no\)/i);
  assert.match(playbackBarrierMigration, /member\.playback_round < old\.round_no/i);
  assert.match(playbackBarrierMigration, /raise exception[\s\S]*PLAYBACK_PENDING/i);
  assert.match(playbackBarrierMigration, /create trigger raid_playback_barrier_v1/i);
});

test('세 화면이 새 문제를 받은 뒤에만 공통 30초 제한시간을 시작한다', () => {
  assert.match(questionReadyBarrierMigration,
    /add column if not exists question_ready_round integer not null default 0/i);
  assert.match(questionReadyBarrierMigration,
    /private_begin_raid_round_v1[\s\S]*question_deadline\s*=\s*null/i);
  assert.match(questionReadyBarrierMigration,
    /private_ack_raid_question_ready_v1[\s\S]*greatest\(question_ready_round, p_round_no\)/i);
  assert.match(questionReadyBarrierMigration,
    /v_ready_count = v_member_count[\s\S]*p_ready_at \+ interval '30 seconds'/i);
  assert.match(questionReadyBarrierMigration,
    /question_deadline is null[\s\S]*QUESTION_PENDING/i,
    '세 명 준비 전에는 우회 제출도 서버가 거절해야 한다');
  assert.match(questionReadyBarrierMigration,
    /grant execute on function public\.private_ack_raid_question_ready_v1[\s\S]*service_role/i);
});

test('던전 클리어 해금은 서버가 저장하고 과거 완료 방도 자동 복구한다', () => {
  assert.match(progressAuthorityMigration, /create table if not exists public\.raid_progress_v1/i);
  assert.match(progressAuthorityMigration, /room\.phase = 'cleared'[\s\S]*group by member\.user_id/i);
  assert.match(progressAuthorityMigration, /private_record_raid_clear_v1[\s\S]*new\.phase = 'cleared'/i);
  assert.match(progressAuthorityMigration, /top_group = greatest\(public\.raid_progress_v1\.top_group, excluded\.top_group\)/i);
  assert.match(progressAuthorityMigration, /private_guard_raid_progress_profile_v1/i);
  assert.match(progressAuthorityMigration, /revoke all on table public\.raid_progress_v1 from public, anon, authenticated/i);
});

test('던전 보상은 캐릭터·구간별 최초 한 번만 서버가 원자 지급한다', () => {
  assert.match(firstClearRewardMigration, /create table if not exists public\.raid_reward_claims_v1/i);
  assert.match(firstClearRewardMigration, /primary key \(user_id, floor_group\)/i);
  assert.match(firstClearRewardMigration, /on conflict \(user_id, floor_group\) do nothing/i);
  assert.match(firstClearRewardMigration, /member\.room_id = new\.id and member\.active/i);
  assert.match(raidBalanceMigration, /when 1 then 20 when 2 then 20[\s\S]*when 7 then 50/i, 'EXP는 새 낮은 값이다');
  assert.match(raidBalanceMigration, /when 1 then 90[\s\S]*when 7 then 400/i, 'Gold는 그대로다');
  assert.match(raidBalanceMigration, /when 1 then 10[\s\S]*when 7 then 40/i, '빌딩은 그대로다');
  assert.match(firstClearRewardMigration, /v_level_gain \* 2/i);
  assert.match(firstClearRewardMigration, /fully_healed = \(v_level_gain > 0\)/i);
  assert.match(firstClearRewardMigration, /update public\.player_profiles_v2[\s\S]*set data = v_profile_data/i);
  assert.match(firstClearRewardMigration, /legacy_assumed_paid[\s\S]*first_legacy_clear/i);
  assert.match(firstClearRewardMigration, /member\.left_at is null or member\.left_at >= room\.finished_at/i);
  assert.match(firstClearRewardMigration, /update public\.player_profiles_v2 profile[\s\S]*raidRewardVersion[\s\S]*count\(\*\)[\s\S]*raid_reward_claims_v1/i);
  assert.match(firstClearRewardMigration, /private_guard_raid_progress_profile_v1[\s\S]*v_incoming_reward_version < v_reward_version/i);
  for (const key of ['exp', 'gold', 'building', 'level', 'skillPoints', 'hp', 'maxHp']) {
    assert.match(firstClearRewardMigration, new RegExp(`'${key}'`));
  }
  assert.match(firstClearRewardMigration, /v_profile_data[\s\S]*raidRewardVersion[\s\S]*v_reward_version/i);
  assert.match(firstClearRewardMigration, /revoke all on table public\.raid_reward_claims_v1 from public, anon, authenticated/i);
});

test('서버 sync는 방 version이 바뀌면 파티원과 이벤트를 다시 읽는다', async () => {
  const { createRaidRoomService } = await import(serviceUrl.href);
  let roomReads = 0;
  let memberReads = 0;
  let eventReads = 0;
  const rooms = [
    { id:'room-1', hostId:'a', phase:'effects', round:1, version:1, nextSequence:2 },
    { id:'room-1', hostId:'a', phase:'effects', round:1, version:2, nextSequence:5 },
    { id:'room-1', hostId:'a', phase:'effects', round:1, version:2, nextSequence:5 },
  ];
  const service = createRaidRoomService({
    store:{
      getRoomForUser:async () => structuredClone(rooms[Math.min(roomReads++, rooms.length - 1)]),
      listMembers:async () => {
        memberReads += 1;
        return [{ userId:'a', state:{ hp:roomReads >= 2 ? 7 : 10 } }];
      },
      listEventsAfter:async () => {
        eventReads += 1;
        return roomReads >= 2 ? [{ sequenceNo:4, round:1, event:{ monsterHp:7 } }] : [];
      },
    },
  });

  const result = await service.handle('a', { op:'sync', roomId:'room-1', afterSequence:0 });
  assert.equal(result.room.version, 2);
  assert.equal(result.members[0].state.hp, 7);
  assert.equal(result.events[0].sequenceNo, 4);
  assert.equal(memberReads, 2);
  assert.equal(eventReads, 2);
});

test('클리어 sync는 로그인한 학생 자신의 서버 보상 결과를 붙인다', async () => {
  const { createRaidRoomService } = await import(serviceUrl.href);
  const completion = {
    roomId:'room-1', floorGroup:1, awarded:true, firstClear:true,
    reward:{ exp:20, gold:90, building:10 }, levelGain:1, fullyHealed:true,
    player:{ exp:20, level:2, skillPoints:2, gold:110, building:10, hp:24, maxHp:24, raidRewardVersion:1, fullyHealed:true },
  };
  const room = {
    id:'room-1', hostId:'a', floorGroup:1, phase:'cleared', round:4,
    version:9, nextSequence:20,
  };
  const service = createRaidRoomService({
    store:{
      getRoomForUser:async () => structuredClone(room),
      listMembers:async () => [{ userId:'a' }, { userId:'b' }, { userId:'c' }],
      listEventsAfter:async () => [],
      getRaidCompletion:async (roomId, userId, floorGroup) => {
        assert.deepEqual([roomId, userId, floorGroup], ['room-1', 'b', 1]);
        return structuredClone(completion);
      },
    },
  });

  const result = await service.handle('b', { op:'sync', roomId:'room-1', afterSequence:19 });
  assert.deepEqual(result.completion, completion);
});

test('전투 연출 완료 번호는 인증된 자기 자리만 서버에 기록한다', async () => {
  const { createRaidRoomService } = await import(serviceUrl.href);
  const acknowledgements = [];
  const stableRoom = { id:'room-1', hostId:'a', phase:'effects', round:3, version:4, nextSequence:9 };
  const service = createRaidRoomService({
    now:() => 12345,
    store:{
      ackPlayback:async (value) => acknowledgements.push(value),
      getRoomForUser:async () => structuredClone(stableRoom),
      listMembers:async () => [{ userId:'b', playbackRound:3 }],
      listEventsAfter:async () => [],
    },
  });
  await service.handle('b', { op:'ackPlayback', roomId:'room-1', round:3, afterSequence:8 });
  assert.deepEqual(acknowledgements, [{ roomId:'room-1', userId:'b', round:3, seenAt:12345 }]);
});

test('문제 준비 완료 번호도 인증된 자기 자리만 서버에 기록한다', async () => {
  const { createRaidRoomService } = await import(serviceUrl.href);
  const acknowledgements = [];
  const stableRoom = {
    id:'room-1', hostId:'a', phase:'question', round:4, version:5, nextSequence:9,
  };
  const service = createRaidRoomService({
    now:() => 23456,
    store:{
      ackQuestionReady:async (value) => acknowledgements.push(value),
      getRoomForUser:async () => structuredClone(stableRoom),
      listMembers:async () => [{ userId:'b', questionReadyRound:4 }],
      listEventsAfter:async () => [],
      listRoundJudgements:async () => [],
    },
  });
  await service.handle('b', { op:'ackQuestionReady', roomId:'room-1', round:4, afterSequence:8 });
  assert.deepEqual(acknowledgements, [{ roomId:'room-1', userId:'b', round:4, readyAt:23456 }]);
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
  const member = (userId, cleared, spec) => ({ userId, profile:{ name:userId, raidTopGroup:cleared, spec } });

  // 셋 다 2구간까지 깼으면 3구간에 들어갈 수 있다.
  await withRoster([member('a', 2, '무기'), member('b', 2, '화염'), member('c', 2, '신성')])
    .handle('a', { op:'start', roomId:'room-1', requestId:'s1' });
  assert.deepEqual(started, ['room-1']);

  // 한 명이 뒤처져 있으면 막힌다.
  await assert.rejects(
    withRoster([member('a', 2, '무기'), member('b', 0, '화염'), member('c', 2, '신성')])
      .handle('a', { op:'start', roomId:'room-1', requestId:'s2' }),
    (error) => error.code === 'FLOOR_LOCKED',
  );
  assert.deepEqual(started, ['room-1'], '막혔으면 출발시키지 않는다');
});

test('서버는 같은 전문화 세 명의 직접 출발 요청도 거부한다', async () => {
  const { createRaidRoomService } = await import(serviceUrl.href);
  const started = [];
  const makeService = (specs) => createRaidRoomService({
    now:() => 1000,
    store:{
      getRoomForUser:async () => ({ id:'room-1', hostId:'a', phase:'lobby', floorGroup:1, round:0 }),
      listMembers:async () => specs.map((spec, index) => ({
        userId:String.fromCharCode(97 + index),
        profile:{ name:String.fromCharCode(65 + index), raidTopGroup:0, spec },
      })),
      listEventsAfter:async () => [],
      startRoom:async (value) => { started.push(value.roomId); },
    },
  });

  await assert.rejects(
    makeService(['무기', '무기', '무기']).handle('a', { op:'start', roomId:'room-1', requestId:'same-spec' }),
    (error) => error.code === 'PARTY_COMPOSITION_INVALID',
  );
  await assert.rejects(
    makeService(['신성', '신성', '']).handle('a', { op:'start', roomId:'room-1', requestId:'blank-spec' }),
    (error) => error.code === 'PARTY_COMPOSITION_INVALID',
    '빈 전문화로 제한을 피할 수 없어야 한다',
  );
  assert.deepEqual(started, []);

  await makeService(['무기', '무기', '신성'])
    .handle('a', { op:'start', roomId:'room-1', requestId:'mixed-spec' });
  assert.deepEqual(started, ['room-1'], '두 명이 같아도 한 명이 다르면 출발할 수 있다');
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
  assert.equal(
    calls.some((entry) => JSON.stringify(entry) === JSON.stringify(['events', 'room-active', 0])),
    true,
    '일관성 재확인을 하더라도 이벤트는 sequence 0부터 읽어야 한다',
  );
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

test('Supabase store uses server-owned raid progress instead of editable player JSON', async () => {
  const { createSupabaseRaidRoomStore } = await import(storeUrl.href);
  const rows = {
    player_profiles_v2:{
      display_name:'앨리스',
      data:{
        name:'앨리스', class:'warrior', exp:0,
        inventory:['training_greatsword'],
        equipment:{ weapon:'training_greatsword' },
        raidTopGroup:7,
      },
    },
    raid_progress_v1:{ top_group:1 },
  };
  const client = {
    from(table) {
      const query = {
        select() { return query; },
        eq() { return query; },
        async maybeSingle() { return { data:rows[table] || null, error:null }; },
      };
      return query;
    },
    rpc:async () => ({ data:null, error:null }),
  };
  const store = createSupabaseRaidRoomStore(client);
  const profile = await store.getAuthoritativeProfile('student-a');
  assert.equal(profile.raidTopGroup, 1);
});

test('완료 응답은 최초 클리어만 보상을 표시하고 반복 클리어도 canonical player를 준다', async () => {
  const { RaidRoomStoreRows } = await import(storeUrl.href);
  const claim = {
    source_room_id:'first-room', exp_reward:20, gold_reward:90, building_reward:10,
    level_gain:2, fully_healed:true, legacy_assumed_paid:false,
  };
  const player = {
    exp:45, gold:110, building:10, level:3, skillPoints:4,
    hp:30, maxHp:30, raidRewardVersion:1,
  };

  const first = RaidRoomStoreRows.raidCompletion(
    claim, player, { top_group:1 }, 'first-room', 1,
  );
  assert.equal(first.awarded, true);
  assert.deepEqual(first.reward, { exp:20, gold:90, building:10 });
  assert.equal(first.levelGain, 2);
  assert.equal(first.player.fullyHealed, true);
  assert.equal(first.player.raidTopGroup, 1);
  assert.equal(first.player.raidRewardVersion, 1);

  const repeat = RaidRoomStoreRows.raidCompletion(
    claim, { ...player, gold:123 }, { top_group:1 }, 'repeat-room', 1,
  );
  assert.equal(repeat.awarded, false);
  assert.deepEqual(repeat.reward, { exp:0, gold:0, building:0 });
  assert.equal(repeat.levelGain, 0);
  assert.equal(repeat.player.gold, 123, '반복 클리어도 현재 서버 값을 돌려준다');
  assert.equal(repeat.player.fullyHealed, false);
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

test('문제 발급이 막히면 이유마다 다른 코드를 돌려준다', async () => {
  const { RaidRoomValidation } = await import(serviceUrl.href);
  const q = (prompt) => ({ id:'q', prompt, choices:['1','2'] });

  // 문제 꾸러미 자체가 없거나 모양이 틀린 경우
  assert.throws(
    () => RaidRoomValidation.normalizeQuestionPublic(null),
    (error) => error.code === 'QUESTION_INVALID',
  );
  // 문제 글이 비어 있는 경우 — 선생님이 문제집을 고쳐야 한다
  assert.throws(
    () => RaidRoomValidation.normalizeQuestionPublic({ byUser:{ a:q(''), b:q('B'), c:q('C') } }),
    (error) => error.code === 'QUESTION_INVALID',
  );
  // 셋 몫이 채워지지 않은 경우
  assert.throws(
    () => RaidRoomValidation.normalizeQuestionPublic({ byUser:{ a:q('A'), b:q('B') } }),
    (error) => error.code === 'QUESTION_COUNT',
  );
  // 멀쩡하면 셋 몫이 그대로 나온다
  const ok = RaidRoomValidation.normalizeQuestionPublic({ byUser:{ a:q('A'), b:q('B'), c:q('C') } });
  assert.deepEqual(Object.keys(ok.byUser), ['a', 'b', 'c']);
  assert.equal(ok.byUser.a.prompt, 'A');
});

test('새 이유 코드들도 학생에게 보여 줄 수 있는 공개 코드다', async () => {
  const { publicRaidRoomErrorCode } = await import(errorUrl.href);
  for (const code of [
    'QUESTION_INVALID', 'ANSWER_INVALID', 'QUESTION_COUNT', 'ANSWER_COUNT',
    'MEMBER_MISMATCH', 'PLAYBACK_PENDING',
  ]) {
    assert.equal(publicRaidRoomErrorCode({ code:'P0001', message:code }), code, code);
  }
});

test('마이그레이션은 PostgreSQL 18 전용 함수를 쓰지 않는다', () => {
  /* 실제 사고: private_begin_raid_round_v1 이 jsonb_object_length() 를 썼는데
     이 함수는 PostgreSQL 18에서 추가되었고 운영 서버는 17.6이다.
     호출할 때마다 없는 함수 오류가 나고 exception when others 가 그것을 삼켜
     매 라운드 INVALID_REQUEST 로 되돌아왔다 — 던전이 한 라운드도 못 굴렀다.
     다시는 이런 함수가 들어오지 않도록 살아 있는 정의를 검사한다. */
  const PG18_ONLY = ['jsonb_object_length', 'json_object_length'];
  const dir = path.join(root, 'supabase/migrations');
  const live = new Map();   // 함수 이름 -> 마지막(살아 있는) 정의
  for (const file of fs.readdirSync(dir).sort()) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const pattern = /create or replace function\s+public\.(\w+)([\s\S]*?)\n\$\$;/gi;
    for (const match of sql.matchAll(pattern)) {
      live.set(match[1], { file, body:match[2] });
    }
  }
  for (const [name, entry] of live) {
    for (const banned of PG18_ONLY) {
      assert.ok(
        !entry.body.includes(banned + '('),
        `${name} (${entry.file}) 가 PostgreSQL 18 전용 ${banned}() 를 쓴다`,
      );
    }
  }
  // 대체 함수가 실제로 있어야 한다.
  assert.ok(live.has('private_jsonb_object_size_v1'), '17에서도 도는 개수 세기 함수가 있어야 한다');
  assert.match(live.get('private_begin_raid_round_v1').body, /private_jsonb_object_size_v1/);
});
