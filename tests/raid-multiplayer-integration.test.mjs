import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRaidRoomService } from '../supabase/functions/_shared/raid-room-service.mjs';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const clientSource = readFileSync(join(root, 'src', 'raid-party-client.js'), 'utf8');

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

class FakeRealtimeHub {
  constructor() {
    this.channels = new Set();
  }

  makeClient(userId, service) {
    const hub = this;
    return {
      auth:{
        async getUser() {
          return { data:{ user:{ id:userId } }, error:null };
        },
      },
      functions:{
        async invoke(functionName, { body }) {
          assert.equal(functionName, 'raid-room-v1');
          try {
            const result = await service.handle(userId, clone(body));
            return { data:{ data:clone(result) }, error:null };
          } catch (error) {
            const code = String(error?.code || error?.message || 'SERVER_ERROR');
            return { data:{ error:code }, error:{ message:code } };
          }
        },
      },
      channel(name) {
        const channel = new FakeRealtimeChannel(hub, userId, name);
        hub.channels.add(channel);
        return channel;
      },
      removeChannel(channel) {
        hub.channels.delete(channel);
      },
    };
  }

  broadcast(table, eventType, row) {
    for (const channel of this.channels) channel.deliver(table, eventType, clone(row));
  }
}

class FakeRealtimeChannel {
  constructor(hub, userId, name) {
    this.hub = hub;
    this.userId = userId;
    this.name = name;
    this.handlers = [];
    this.active = false;
  }

  on(kind, filter, callback) {
    assert.equal(kind, 'postgres_changes');
    this.handlers.push({ filter, callback });
    return this;
  }

  subscribe(callback) {
    this.active = true;
    callback?.('SUBSCRIBED');
    return this;
  }

  deliver(table, eventType, row) {
    if (!this.active) return;
    for (const { filter, callback } of this.handlers) {
      if (filter.table !== table) continue;
      if (filter.event !== '*' && filter.event !== eventType) continue;
      const [column, expected] = String(filter.filter || '').split('=eq.');
      if (column && String(row?.[column]) !== String(expected)) continue;
      callback({ eventType, new:eventType === 'DELETE' ? null : row, old:eventType === 'DELETE' ? row : null });
    }
  }
}

class FakeRaidRoomStore {
  constructor(hub, profiles) {
    this.hub = hub;
    this.profiles = new Map(Object.entries(profiles));
    this.rooms = new Map();
    this.members = new Map();
    this.events = new Map();
    this.submissions = new Map();
    this.answerKeys = new Map();
    this.nextRoom = 1;
  }

  roomMembers(roomId) {
    return [...(this.members.get(roomId)?.values() || [])]
      .filter((member) => member.active)
      .sort((a, b) => a.joinOrder - b.joinOrder);
  }

  requireRoom(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) fail('ROOM_NOT_FOUND');
    return room;
  }

  requireMember(roomId, userId) {
    const member = this.members.get(roomId)?.get(userId);
    if (!member?.active) fail('NOT_MEMBER');
    return member;
  }

  requireHost(roomId, userId) {
    const room = this.requireRoom(roomId);
    this.requireMember(roomId, userId);
    if (room.hostId !== userId) fail('HOST_ONLY');
    return room;
  }

  touchRoom(room) {
    room.version += 1;
    room.updatedAt = new Date().toISOString();
    this.hub.broadcast('raid_rooms_v1', 'UPDATE', this.roomDatabaseRow(room));
  }

  roomDatabaseRow(room) {
    return {
      id:room.id,
      invite_code:room.code,
      host_id:room.hostId,
      floor_group:room.floorGroup,
      phase:room.phase,
      encounter_index:room.encounterIndex,
      current_floor:room.currentFloor,
      round_no:room.round,
      monster_state:clone(room.monsterState),
      question_public:clone(room.question),
      question_deadline:room.questionDeadline ? new Date(room.questionDeadline).toISOString() : null,
      version:room.version,
    };
  }

  memberDatabaseRow(member) {
    return {
      room_id:member.roomId,
      user_id:member.userId,
      join_order:member.joinOrder,
      slot:member.slot,
      ready:member.ready,
      profile_snapshot:clone(member.profile),
      combat_state:clone(member.state),
      playback_round:member.playbackRound,
      question_ready_round:member.questionReadyRound,
      active:member.active,
    };
  }

  async getAuthoritativeProfile(userId) {
    return clone(this.profiles.get(userId) || null);
  }

  async createRoom({ userId, floorGroup, profile, createdAt }) {
    const roomId = `raid-room-${this.nextRoom++}`;
    // Leading zero verifies that invite codes stay strings throughout the stack.
    const code = '0427';
    const room = {
      id:roomId,
      code,
      hostId:userId,
      floorGroup,
      phase:'lobby',
      encounterIndex:0,
      currentFloor:1,
      round:0,
      monsterState:{},
      question:null,
      questionDeadline:0,
      version:1,
      nextSequence:1,
      createdAt:new Date(createdAt).toISOString(),
      updatedAt:new Date(createdAt).toISOString(),
      finishedAt:null,
    };
    this.rooms.set(roomId, room);
    this.events.set(roomId, []);
    this.members.set(roomId, new Map());
    const member = this.makeMember(roomId, userId, profile, 1, createdAt);
    this.members.get(roomId).set(userId, member);
    return { roomId };
  }

  makeMember(roomId, userId, profile, joinOrder, now) {
    const maxHp = Math.max(1, Number(profile.maxHp) || 30);
    return {
      roomId,
      userId,
      joinOrder,
      slot:null,
      ready:false,
      profile:clone(profile),
      state:{ hp:maxHp, maxHp, shield:0, cooldowns:{}, statuses:{} },
      playbackRound:0,
      questionReadyRound:0,
      lastSeenAt:now,
      active:true,
    };
  }

  async joinRoom({ userId, code, profile, joinedAt }) {
    const room = [...this.rooms.values()].find((candidate) => candidate.code === code);
    if (!room) fail('ROOM_NOT_FOUND');
    if (room.phase !== 'lobby') fail('ROOM_CLOSED');
    const roomMembers = this.roomMembers(room.id);
    if (roomMembers.some((member) => member.userId === userId)) fail('ALREADY_IN_ROOM');
    if (roomMembers.length >= 3) fail('ROOM_FULL');
    const member = this.makeMember(room.id, userId, profile, roomMembers.length + 1, joinedAt);
    this.members.get(room.id).set(userId, member);
    this.hub.broadcast('raid_room_members_v1', 'INSERT', this.memberDatabaseRow(member));
    this.touchRoom(room);
    return { roomId:room.id };
  }

  async getRoomForUser(roomId, userId) {
    const member = this.members.get(roomId)?.get(userId);
    return member?.active ? clone(this.rooms.get(roomId) || null) : null;
  }

  async listMembers(roomId) {
    return clone(this.roomMembers(roomId));
  }

  async listEventsAfter(roomId, afterSequence) {
    return clone((this.events.get(roomId) || []).filter((event) => event.sequenceNo > afterSequence));
  }

  async listRoundJudgements(roomId, round) {
    return clone([...(this.submissions.get(`${roomId}:${round}`)?.values() || [])]
      .sort((a, b) => a.submittedAt - b.submittedAt)
      .map(({ userId, actionId, correct }) => ({ userId, actionId, correct })));
  }

  async getRoundAnswerKeys(roomId, round) {
    return clone(this.answerKeys.get(`${roomId}:${round}`) || {});
  }

  async setFormation({ roomId, userId, assignments }) {
    const room = this.requireHost(roomId, userId);
    if (room.phase !== 'lobby') fail('ROOM_CLOSED');
    const members = this.roomMembers(roomId);
    const memberIds = members.map((member) => member.userId).sort();
    const assignmentIds = Object.keys(assignments).sort();
    const slots = Object.values(assignments).sort();
    if (members.length !== 3
      || JSON.stringify(memberIds) !== JSON.stringify(assignmentIds)
      || JSON.stringify(slots) !== JSON.stringify(['back', 'front', 'middle'])) {
      fail('FORMATION_INVALID');
    }
    for (const member of members) {
      member.slot = assignments[member.userId];
      member.ready = false;
      this.hub.broadcast('raid_room_members_v1', 'UPDATE', this.memberDatabaseRow(member));
    }
    this.touchRoom(room);
  }

  async setReady({ roomId, userId, ready, changedAt }) {
    const room = this.requireRoom(roomId);
    if (room.phase !== 'lobby') fail('ROOM_CLOSED');
    const member = this.requireMember(roomId, userId);
    if (!member.slot) fail('FORMATION_INVALID');
    member.ready = ready;
    member.lastSeenAt = changedAt;
    this.hub.broadcast('raid_room_members_v1', 'UPDATE', this.memberDatabaseRow(member));
  }

  async startRoom({ roomId, userId, startedAt }) {
    const room = this.requireHost(roomId, userId);
    const members = this.roomMembers(roomId);
    if (members.length !== 3) fail('PARTY_INCOMPLETE');
    if (members.some((member) => !member.slot)) fail('FORMATION_INVALID');
    if (members.some((member) => !member.ready)) fail('NOT_READY');
    room.phase = 'travel';
    room.currentFloor = 1;
    room.startedAt = startedAt;
    this.touchRoom(room);
  }

  async beginRound({ roomId, userId, questionPublic, answerKey, begunAt }) {
    const room = this.requireHost(roomId, userId);
    if (room.phase !== 'travel' && room.phase !== 'effects') fail('ROUND_CLOSED');
    if (room.round > 0 && this.roomMembers(roomId).some((member) => member.playbackRound < room.round)) {
      fail('PLAYBACK_PENDING');
    }
    room.phase = 'question';
    room.round += 1;
    room.question = clone(questionPublic);
    room.questionDeadline = 0;
    this.answerKeys.set(`${roomId}:${room.round}`, JSON.parse(answerKey));
    this.submissions.set(`${roomId}:${room.round}`, new Map());
    this.touchRoom(room);
  }

  async submitRound({ roomId, userId, round, actionId, answer, submittedAt }) {
    const room = this.requireRoom(roomId);
    this.requireMember(roomId, userId);
    if (room.round !== round) fail('ROUND_CHANGED');
    if (room.phase !== 'question' && room.phase !== 'waiting') fail('ROUND_CLOSED');
    if (!room.questionDeadline) fail('QUESTION_PENDING');
    const key = `${roomId}:${round}`;
    const submissions = this.submissions.get(key);
    submissions.set(userId, {
      userId,
      actionId,
      correct:String(answer).trim().toLocaleLowerCase('ko-KR')
        === String(this.answerKeys.get(key)?.[userId] || '').trim().toLocaleLowerCase('ko-KR'),
      submittedAt,
    });
    const received = submissions.size;
    if (received === 3) {
      room.phase = 'resolving';
      this.touchRoom(room);
    } else {
      room.phase = 'waiting';
      this.touchRoom(room);
    }
    return { waiting:received < 3, received, required:3 };
  }

  async publishRound({ roomId, userId, round, result }) {
    const room = this.requireHost(roomId, userId);
    if (room.round !== round) fail('ROUND_CHANGED');
    if (room.phase !== 'resolving') fail('ROUND_CLOSED');
    for (const member of this.roomMembers(roomId)) {
      if (result.memberStates[member.userId]) member.state = clone(result.memberStates[member.userId]);
      this.hub.broadcast('raid_room_members_v1', 'UPDATE', this.memberDatabaseRow(member));
    }
    room.phase = result.nextPhase;
    room.encounterIndex = result.encounterIndex;
    room.currentFloor = result.currentFloor;
    room.monsterState = clone(result.monsterState);
    room.question = null;
    room.questionDeadline = 0;
    const rows = result.events.map((event, index) => ({
      sequenceNo:round * 1000 + index + 1,
      round,
      event:clone(event),
    }));
    this.events.get(roomId).push(...rows);
    this.touchRoom(room);
    for (const row of rows) {
      this.hub.broadcast('raid_events_v1', 'INSERT', {
        room_id:roomId,
        round_no:row.round,
        sequence_no:row.sequenceNo,
        event:clone(row.event),
      });
    }
  }

  async heartbeat({ roomId, userId, seenAt }) {
    this.requireMember(roomId, userId).lastSeenAt = seenAt;
  }

  async ackPlayback({ roomId, userId, round, seenAt }) {
    const room = this.requireRoom(roomId);
    if (round > room.round) fail('ROUND_CHANGED');
    const member = this.requireMember(roomId, userId);
    member.playbackRound = Math.max(member.playbackRound, round);
    member.lastSeenAt = seenAt;
    this.hub.broadcast('raid_room_members_v1', 'UPDATE', this.memberDatabaseRow(member));
  }

  async ackQuestionReady({ roomId, userId, round, readyAt }) {
    const room = this.requireRoom(roomId);
    if (round !== room.round) fail('ROUND_CHANGED');
    if (room.phase !== 'question' && room.phase !== 'waiting') fail('ROUND_CLOSED');
    const member = this.requireMember(roomId, userId);
    member.questionReadyRound = Math.max(member.questionReadyRound, round);
    member.lastSeenAt = readyAt;
    this.hub.broadcast('raid_room_members_v1', 'UPDATE', this.memberDatabaseRow(member));
    const members = this.roomMembers(roomId);
    if (!room.questionDeadline && members.length === 3
      && members.every((candidate) => candidate.questionReadyRound >= round)) {
      room.questionDeadline = readyAt + 30_000;
      this.touchRoom(room);
    }
  }

  async leaveRoom({ roomId, userId }) {
    const member = this.requireMember(roomId, userId);
    member.active = false;
    this.hub.broadcast('raid_room_members_v1', 'DELETE', this.memberDatabaseRow(member));
    return { left:true };
  }
}

function createBrowserRaidClient(hub, service, userId, displayName) {
  const supabase = hub.makeClient(userId, service);
  const context = {
    console,
    crypto:{ randomUUID:() => `${userId}-${Math.random().toString(36).slice(2)}` },
    setTimeout,
    clearTimeout,
  };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(clientSource, context, { filename:'raid-party-client.js' });
  const identity = Object.freeze({ userId, displayName, role:'student' });
  return context.YuksamRaidPartyClient.create({ client:supabase, getIdentity:() => identity });
}

test('three authenticated browser sessions create, join, form, start and resolve one synchronized raid round', async (t) => {
  const hub = new FakeRealtimeHub();
  const profiles = {
    alice:{ userId:'alice', name:'앨리스', className:'warrior', spec:'무기', maxHp:42, attack:10, skills:{ warrior_weapon_breaker:1 } },
    bob:{ userId:'bob', name:'밥', className:'mage', spec:'화염', maxHp:31, attack:12, skills:{ mage_basic_double:1 } },
    cara:{ userId:'cara', name:'카라', className:'priest', spec:'신성', maxHp:36, attack:8, skills:{ priest_basic_heal:1 } },
  };
  const store = new FakeRaidRoomStore(hub, profiles);
  let clock = Date.UTC(2026, 7, 1, 9, 0, 0);
  const service = createRaidRoomService({ store, now:() => ++clock });
  const alice = createBrowserRaidClient(hub, service, 'alice', '앨리스');
  const bob = createBrowserRaidClient(hub, service, 'bob', '밥');
  const cara = createBrowserRaidClient(hub, service, 'cara', '카라');
  t.after(() => { alice.close(); bob.close(); cara.close(); });

  const created = await alice.create({ floorGroup:1, profile:{ attack:999999 } });
  assert.match(created.room.code, /^\d{4}$/);
  assert.equal(created.room.code, '0427', '초대 코드 앞의 0이 숫자 변환으로 사라지면 안 된다');
  assert.equal(created.members.length, 1);
  assert.equal(created.members[0].profile.attack, 10, '클라이언트가 보낸 능력치가 아니라 서버 프로필을 사용한다');
  const roomId = created.room.id;

  const realtime = { alice:[], bob:[], cara:[] };
  alice.subscribe(roomId, (event) => realtime.alice.push(event));

  await assert.rejects(
    alice.start(roomId),
    (error) => error?.code === 'PARTY_INCOMPLETE',
    '혼자서는 시작할 수 없어야 한다',
  );

  const joinedBob = await bob.join({ code:created.room.code, profile:{ attack:999999 } });
  assert.equal(joinedBob.members.length, 2);
  bob.subscribe(roomId, (event) => realtime.bob.push(event));
  await assert.rejects(
    alice.start(roomId),
    (error) => error?.code === 'PARTY_INCOMPLETE',
    '두 명이어도 시작할 수 없어야 한다',
  );

  const joinedCara = await cara.join({ code:created.room.code });
  assert.equal(joinedCara.members.length, 3);
  cara.subscribe(roomId, (event) => realtime.cara.push(event));
  assert.ok(
    realtime.alice.some((event) => event.type === 'member' && event.member?.user_id === 'bob'),
    '먼저 기다리던 방장은 두 번째 참가자를 실시간으로 받아야 한다',
  );
  assert.ok(
    realtime.alice.some((event) => event.type === 'member' && event.member?.user_id === 'cara'),
    '먼저 기다리던 방장은 세 번째 참가자를 실시간으로 받아야 한다',
  );
  assert.ok(
    realtime.bob.some((event) => event.type === 'member' && event.member?.user_id === 'cara'),
    '두 번째 참가자도 세 번째 참가자를 실시간으로 받아야 한다',
  );

  const assignments = { alice:'front', bob:'middle', cara:'back' };
  await alice.setFormation(roomId, assignments);
  await alice.ready(roomId, true);
  await bob.ready(roomId, true);
  await cara.ready(roomId, true);
  const started = await alice.start(roomId);
  assert.equal(started.room.phase, 'travel');
  assert.deepEqual(
    Object.fromEntries(started.members.map((member) => [member.userId, member.slot])),
    assignments,
  );

  const questions = {
    alice:{ id:'q-1', prompt:'6 × 7은?', choices:['40', '41', '42', '43'] },
    bob:{ id:'q-2', prompt:'8 × 8은?', choices:['56', '64', '72', '80'] },
    cara:{ id:'q-3', prompt:'9 × 9은?', choices:['72', '81', '90', '99'] },
  };
  const answers = { alice:'42', bob:'64', cara:'81' };
  const begun = await alice.beginRound(roomId, { byUser:questions }, JSON.stringify(answers));
  assert.equal(begun.room.phase, 'question');
  assert.equal(begun.room.round, 1);
  assert.equal(begun.room.questionDeadline, 0, '세 화면 준비 전에는 제한시간이 시작되면 안 된다');
  assert.deepEqual(begun.room.question, questions.alice);
  assert.equal(JSON.stringify(begun).includes('answerKey'), false, '정답 키는 어떤 응답에도 노출되면 안 된다');

  const [aliceView, bobView, caraView] = await Promise.all([
    alice.sync(roomId), bob.sync(roomId), cara.sync(roomId),
  ]);
  assert.deepEqual(aliceView.room.question, questions.alice);
  assert.deepEqual(bobView.room.question, questions.bob);
  assert.deepEqual(caraView.room.question, questions.cara);

  await assert.rejects(
    alice.submit(roomId, 1, 'warrior_weapon_breaker', '42'),
    (error) => error?.code === 'QUESTION_PENDING',
    '문제를 받은 화면이 하나뿐일 때는 제출로 준비 장벽을 우회할 수 없어야 한다',
  );
  const aliceReady = await alice.ackQuestionReady(roomId, 1);
  const bobReady = await bob.ackQuestionReady(roomId, 1);
  assert.equal(aliceReady.room.questionDeadline, 0);
  assert.equal(bobReady.room.questionDeadline, 0, '두 화면만 준비해도 제한시간은 흐르지 않는다');
  const caraReady = await cara.ackQuestionReady(roomId, 1);
  assert.ok(caraReady.room.questionDeadline > clock, '세 번째 화면 준비 시 공통 제한시간이 시작된다');
  const readyViews = await Promise.all([alice.sync(roomId), bob.sync(roomId), cara.sync(roomId)]);
  assert.equal(new Set(readyViews.map((view) => view.room.questionDeadline)).size, 1,
    '세 독립 클라이언트가 같은 절대 제한시각을 받아야 한다');
  assert.ok(readyViews.every((view) => view.submitted === false));

  const first = await alice.submit(roomId, 1, 'warrior_weapon_breaker', '42');
  const second = await bob.submit(roomId, 1, 'mage_basic_double', '64');
  const third = await cara.submit(roomId, 1, 'priest_basic_heal', '81');
  assert.deepEqual(
    [first.waiting, second.waiting, third.waiting],
    [true, true, false],
    '세 번째 답까지 도착하기 전에는 판정하면 안 된다',
  );

  const resolving = await alice.sync(roomId);
  assert.equal(resolving.room.phase, 'resolving');
  assert.equal(resolving.submissions.length, 3);
  assert.ok(resolving.submissions.every((submission) => submission.correct));
  assert.deepEqual(
    resolving.submissions.map((submission) => submission.actionId).sort(),
    ['mage_basic_double', 'priest_basic_heal', 'warrior_weapon_breaker'],
    '세 명이 고른 각자의 스킬도 서버 판정 입력에 남아야 한다',
  );

  const memberStates = Object.fromEntries(resolving.members.map((member) => [member.userId, {
    ...member.state,
    shield:member.userId === 'alice' ? 1 : 0,
  }]));
  const published = await alice.publishRound(roomId, 1, {
    nextPhase:'effects',
    encounterIndex:1,
    currentFloor:3,
    monsterState:{ id:'guard-bot', hp:57, maxHp:90, statuses:{ stun:1 } },
    memberStates,
    events:[
      { kind:'party-hit', memberId:'alice', label:'더블 어택', damage:14 },
      { kind:'party-heal', memberId:'cara', label:'치유', amount:6, audioId:'priestHeal' },
      { kind:'monster-status', status:'stun', turns:1 },
    ],
  });
  assert.equal(published.room.currentFloor, 3);
  assert.equal(published.room.monsterState.statuses.stun, 1);

  const realtimeEventSets = [realtime.alice, realtime.bob, realtime.cara]
    .map((items) => items.filter((event) => event.type === 'event').map((event) => event.event.kind));
  for (const kinds of realtimeEventSets) {
    assert.deepEqual(kinds, ['party-hit', 'party-heal', 'monster-status']);
  }

  const synchronized = await Promise.all([
    alice.sync(roomId, 999), bob.sync(roomId, 999), cara.sync(roomId, 999),
  ]);
  for (const view of synchronized) {
    assert.equal(view.room.phase, 'effects');
    assert.equal(view.room.currentFloor, 3);
    assert.deepEqual(view.room.monsterState, published.room.monsterState);
    assert.deepEqual(view.events, published.events);
    assert.deepEqual(view.members, published.members);
  }

  await assert.rejects(
    alice.beginRound(roomId, { byUser:questions }, JSON.stringify(answers)),
    (error) => error?.code === 'PLAYBACK_PENDING',
    '한 화면이라도 전투 로그를 덜 봤으면 다음 문제를 열면 안 된다',
  );
  await alice.ackPlayback(roomId, 1);
  await bob.ackPlayback(roomId, 1);
  await assert.rejects(
    alice.beginRound(roomId, { byUser:questions }, JSON.stringify(answers)),
    (error) => error?.code === 'PLAYBACK_PENDING',
    '두 명만 완료해도 아직 기다려야 한다',
  );
  await cara.ackPlayback(roomId, 1);
  const nextRound = await alice.beginRound(roomId, { byUser:questions }, JSON.stringify(answers));
  assert.equal(nextRound.room.round, 2);
  assert.equal(nextRound.room.phase, 'question');
  assert.equal(nextRound.room.questionDeadline, 0);

  await alice.ackQuestionReady(roomId, 2);
  await bob.ackQuestionReady(roomId, 2);
  await cara.ackQuestionReady(roomId, 2);

  /* 최종 보상창에서는 세 명이 연출을 다 본 뒤 한 명부터 확인을 누른다.
     서버는 그 사람만 active 목록에서 빼고 완료된 방은 그대로 둔다. */
  await alice.submit(roomId, 2, 'basic', '42');
  assert.equal((await alice.sync(roomId)).submitted, true,
    '제출한 클라이언트는 동기화 후 입력 화면을 다시 열지 않도록 표시된다');
  assert.equal((await bob.sync(roomId)).submitted, false);
  await bob.submit(roomId, 2, 'basic', '64');
  await cara.submit(roomId, 2, 'basic', '81');
  const finalResolving = await alice.sync(roomId);
  const finalMemberStates = Object.fromEntries(finalResolving.members.map((member) => [
    member.userId,
    member.state,
  ]));
  await alice.publishRound(roomId, 2, {
    nextPhase:'cleared',
    encounterIndex:4,
    currentFloor:10,
    monsterState:{ id:'mushroom-king', hp:0, maxHp:100, statuses:{} },
    memberStates:finalMemberStates,
    events:[{ kind:'monster-defeated', name:'버섯돌이킹' }],
  });
  await alice.ackPlayback(roomId, 2);
  await bob.ackPlayback(roomId, 2);
  await cara.ackPlayback(roomId, 2);
  await alice.leave(roomId);

  const [bobAfterAliceLeft, caraAfterAliceLeft] = await Promise.all([
    bob.sync(roomId), cara.sync(roomId),
  ]);
  for (const view of [bobAfterAliceLeft, caraAfterAliceLeft]) {
    assert.equal(view.room.phase, 'cleared', '한 명이 확인해도 완료된 방이 취소되면 안 된다');
    assert.equal(view.members.length, 2, '확인을 누른 사람은 활성 명단에서 빠진다');
    assert.ok(view.members.every((member) => member.playbackRound >= 2));
  }
});
