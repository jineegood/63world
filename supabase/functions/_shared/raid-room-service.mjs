import { failRaidRoom } from './raid-room-error.mjs';

const MAX_TEXT = 120;
const MAX_QUESTION = 500;
const MAX_RESULT_BYTES = 96 * 1024;
const ALLOWED_PUBLISH_PHASES = new Set(['effects', 'travel', 'cleared', 'wiped', 'cancelled']);

/* 63빌딩 던전 구간(1~7). 앞 구간을 깨야 다음 구간이 열린다. */
const FIRST_FLOOR_GROUP = 1;
const LAST_FLOOR_GROUP = 7;

/* 이 사람이 지금 들어갈 수 있는 가장 높은 구간. 1구간은 언제나 열려 있다. */
function unlockedFloorGroup(profile) {
  const cleared = Math.max(0, Math.min(
    LAST_FLOOR_GROUP,
    Math.trunc(Number(profile?.raidTopGroup) || 0),
  ));
  return Math.min(LAST_FLOOR_GROUP, cleared + 1);
}

function text(value, maximum = MAX_TEXT) {
  return String(value ?? '').trim().slice(0, maximum);
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/* 방 참가 때 저장한 profile은 서버가 만든 값이다. 출발 직전에 이 값을 다시
   읽어 같은 전문화 세 명이나 빈 전문화가 섞인 편법을 서버에서도 막는다. */
function hasDiversePartySpecializations(roster) {
  if (!Array.isArray(roster) || roster.length !== 3) return false;
  const specs = roster.map((member) => text(member?.profile?.spec, 12)).filter(Boolean);
  return specs.length === 3 && new Set(specs).size >= 2;
}

function byteLength(value) {
  return new TextEncoder().encode(String(value || '')).byteLength;
}

function requestId(value) {
  const result = text(value, 100);
  if (!result) failRaidRoom('INVALID_REQUEST');
  return result;
}

function roomId(value) {
  const result = text(value, 100);
  if (!result) failRaidRoom('INVALID_REQUEST');
  return result;
}

function afterSequence(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(number));
}

function normalizeQuestionPublic(raw) {
  const source = object(raw);
  if (!source) failRaidRoom('QUESTION_INVALID');
  const byUser = object(source.byUser);
  if (byUser) {
    const normalized = {};
    for (const [rawUserId, rawQuestion] of Object.entries(byUser).slice(0, 3)) {
      const userId = text(rawUserId, 100);
      if (userId) normalized[userId] = normalizeQuestionPublic(rawQuestion);
    }
    /* 셋 몫이 정확히 채워져야 한다. 학생 id가 겹치거나 비어 있으면 여기서 걸린다. */
    if (Object.keys(normalized).length !== 3) failRaidRoom('QUESTION_COUNT');
    return { byUser:normalized };
  }
  const prompt = text(source.prompt || source.q || source.question, MAX_QUESTION);
  if (!prompt) failRaidRoom('QUESTION_INVALID');
  const choices = Array.isArray(source.choices)
    ? source.choices.slice(0, 8).map((choice) => text(choice)).filter(Boolean)
    : [];
  return {
    id:text(source.id || 'raid-question', 100),
    prompt,
    choices,
  };
}

function sanitizeEvent(raw) {
  const source = object(raw);
  if (!source) return null;
  const event = { ...source };
  for (const key of [
    'answerKey', 'answer_key', 'submittedAnswer', 'submitted_answer',
    'requestId', 'request_id',
  ]) delete event[key];
  const serialized = JSON.stringify(event);
  if (byteLength(serialized) > 8192) failRaidRoom('INVALID_REQUEST');
  return event;
}

function cleanTurnMap(raw, maximum = 100000) {
  const source = object(raw) || {};
  const result = {};
  for (const [rawKey, rawValue] of Object.entries(source).slice(0, 100)) {
    const key = text(rawKey, 100);
    const value = Math.max(0, Math.min(maximum, Math.trunc(Number(rawValue) || 0)));
    if (key && value > 0) result[key] = value;
  }
  return result;
}

function sanitizeMemberState(raw) {
  const source = object(raw);
  if (!source) return null;
  const maxHp = Math.max(1, Math.min(100000, Math.trunc(Number(source.maxHp) || 1)));
  const hp = Math.max(0, Math.min(maxHp, Math.trunc(Number(source.hp) || 0)));
  const shield = Math.max(0, Math.min(maxHp * 3, Math.trunc(Number(source.shield) || 0)));
  return {
    hp,
    maxHp,
    shield,
    cooldowns:cleanTurnMap(source.cooldowns),
    statuses:cleanTurnMap(source.statuses),
    buffs:{
      intBuffTurns:Math.max(0, Math.min(100, Math.trunc(Number(source.buffs?.intBuffTurns) || 0))),
      intBuffPct:Math.max(0, Math.min(10, Number(source.buffs?.intBuffPct) || 0)),
      battleRoarTurns:Math.max(0, Math.min(100, Math.trunc(Number(source.buffs?.battleRoarTurns) || 0))),
    },
    chargeActive:source.chargeActive === true,
    bastionUsed:source.bastionUsed === true,
  };
}

function normalizePublishResult(raw) {
  const source = object(raw);
  if (!source || byteLength(JSON.stringify(source)) > MAX_RESULT_BYTES) failRaidRoom('INVALID_REQUEST');
  const nextPhase = text(source.nextPhase || source.phase, 20);
  if (!ALLOWED_PUBLISH_PHASES.has(nextPhase)) failRaidRoom('INVALID_REQUEST');
  const memberStates = {};
  for (const [id, state] of Object.entries(object(source.memberStates) || {})) {
    const safeId = text(id, 100);
    const safeState = sanitizeMemberState(state);
    if (safeId && safeState) memberStates[safeId] = safeState;
  }
  const events = (Array.isArray(source.events) ? source.events : [])
    .slice(0, 100)
    .map(sanitizeEvent)
    .filter(Boolean);
  return {
    nextPhase,
    encounterIndex:Math.max(0, Math.min(20, Math.trunc(Number(source.encounterIndex) || 0))),
    currentFloor:Math.max(1, Math.min(63, Math.trunc(Number(source.currentFloor) || 1))),
    monsterState:object(source.monsterState) || {},
    memberStates,
    events,
  };
}

export function createRaidRoomService({ store, now = Date.now } = {}) {
  if (!store) throw new TypeError('Raid room store is required.');

  async function authoritativeProfile(userId) {
    const profile = await store.getAuthoritativeProfile(userId);
    if (!profile) failRaidRoom('PROFILE_MISSING');
    return profile;
  }

  async function sync(userId, rawRoomId, rawAfterSequence = 0) {
    const id = roomId(rawRoomId);
    let room = await store.getRoomForUser(id, userId);
    if (!room) failRaidRoom('NOT_MEMBER');
    let members = [];
    let events = [];
    let stableSnapshot = false;
    /* publish는 방·파티원·이벤트를 한 트랜잭션에서 바꾼다. 하지만 이 함수가
       그 사이를 여러 조회로 읽으면 '옛 방 + 새 체력'이 한 응답에 섞일 수 있다.
       방 version/nextSequence를 앞뒤로 확인해 같은 시점의 묶음만 반환한다. */
    for (let attempt = 0; attempt < 4; attempt += 1) {
      [members, events] = await Promise.all([
        store.listMembers(id),
        store.listEventsAfter(id, afterSequence(rawAfterSequence)),
      ]);
      const confirmed = await store.getRoomForUser(id, userId);
      if (!confirmed) failRaidRoom('NOT_MEMBER');
      stableSnapshot = (Number(confirmed.version) || 0) === (Number(room.version) || 0)
        && (Number(confirmed.nextSequence) || 0) === (Number(room.nextSequence) || 0);
      room = confirmed;
      if (stableSnapshot) break;
    }
    if (!stableSnapshot) {
      failRaidRoom('TEMPORARY_UNAVAILABLE');
    }
    const privateQuestion = object(room.question?.byUser)?.[String(userId)] || room.question;
    const result = { room:{ ...room, question:privateQuestion || null }, members, events };
    let roundJudgements = null;
    if (['question', 'waiting', 'resolving'].includes(room.phase)
      && typeof store.listRoundJudgements === 'function') {
      roundJudgements = await store.listRoundJudgements(id, room.round);
      result.submitted = roundJudgements.some((entry) => String(entry.userId) === String(userId));
    }
    /* A cleared room and its first-clear reward receipt are committed together.
       Return only this authenticated member's canonical resource totals so every
       client can SET its UI state instead of adding an untrusted local reward. */
    if (room.phase === 'cleared' && typeof store.getRaidCompletion === 'function') {
      result.completion = await store.getRaidCompletion(id, userId, room.floorGroup);
    }
    if (room.hostId === userId && room.phase === 'resolving') {
      const submitted = roundJudgements || await store.listRoundJudgements(id, room.round);
      const byUser = new Map(submitted.map((entry) => [String(entry.userId), entry]));
      result.submissions = members.map((member) => byUser.get(String(member.userId)) || ({
        userId:member.userId,
        actionId:'basic',
        correct:false,
        timedOut:true,
      }));
      result.answerKeys = typeof store.getRoundAnswerKeys === 'function'
        ? await store.getRoundAnswerKeys(id, room.round)
        : {};
    }
    return result;
  }

  async function resume(userId) {
    const room = await store.findActiveRoomForUser(userId);
    if (!room?.id) failRaidRoom('ROOM_NOT_FOUND');
    return sync(userId, room.id, 0);
  }

  async function recoverActiveRoom(userId, operation) {
    try {
      return await operation();
    } catch (error) {
      const code = String(error?.code || error?.message || '');
      if (!code.includes('ALREADY_IN_ROOM')) throw error;
      return resume(userId);
    }
  }

  async function handle(userId, body = {}) {
    if (!userId) failRaidRoom('UNAUTHENTICATED');
    const op = text(body.op, 24);
    switch (op) {
      case 'create': {
        const floorGroup = Math.trunc(Number(body.floorGroup) || 0);
        if (floorGroup < FIRST_FLOOR_GROUP || floorGroup > LAST_FLOOR_GROUP) failRaidRoom('FLOOR_LOCKED');
        const profile = await authoritativeProfile(userId);
        /* 앞 구간을 깬 사람만 다음 구간의 방을 만들 수 있다.
           1구간은 언제나 열려 있다. (참가자 셋 전부 확인은 start에서 한다.) */
        if (floorGroup > unlockedFloorGroup(profile)) failRaidRoom('FLOOR_LOCKED');
        return recoverActiveRoom(userId, async () => {
          const created = await store.createRoom({
            userId,
            floorGroup,
            profile,
            requestId:requestId(body.requestId),
            createdAt:now(),
          });
          return sync(userId, created.roomId || created.id, 0);
        });
      }
      case 'join': {
        const code = text(body.code, 4);
        if (!/^\d{4}$/.test(code)) failRaidRoom('ROOM_NOT_FOUND');
        const profile = await authoritativeProfile(userId);
        return recoverActiveRoom(userId, async () => {
          const joined = await store.joinRoom({
            userId,
            code,
            profile,
            requestId:requestId(body.requestId),
            joinedAt:now(),
          });
          return sync(userId, joined.roomId || joined.id, 0);
        });
      }
      case 'resume':
        return resume(userId);
      case 'sync':
        return sync(userId, body.roomId, body.afterSequence);
      case 'setFormation': {
        const id = roomId(body.roomId);
        const assignments = object(body.assignments);
        if (!assignments || Object.keys(assignments).length !== 3) failRaidRoom('FORMATION_INVALID');
        await store.setFormation({
          roomId:id,
          userId,
          assignments,
          requestId:requestId(body.requestId),
          changedAt:now(),
        });
        return sync(userId, id, 0);
      }
      case 'ready': {
        const id = roomId(body.roomId);
        await store.setReady({ roomId:id, userId, ready:body.ready === true, changedAt:now() });
        return sync(userId, id, 0);
      }
      case 'start': {
        const id = roomId(body.roomId);
        /* 출발 직전에 셋 모두 이 구간을 열었는지 확인한다.
           방을 만든 사람만 열려 있고 나머지가 아직이면 들어갈 수 없다. */
        const room = await store.getRoomForUser(id, userId);
        if (!room) failRaidRoom('NOT_MEMBER');
        const roster = await store.listMembers(id);
        if (roster.length === 3 && !hasDiversePartySpecializations(roster)) {
          failRaidRoom('PARTY_COMPOSITION_INVALID');
        }
        const targetGroup = Math.max(FIRST_FLOOR_GROUP, Math.trunc(Number(room.floorGroup) || 1));
        if (roster.some((member) => targetGroup > unlockedFloorGroup(member?.profile))) {
          failRaidRoom('FLOOR_LOCKED');
        }
        await store.startRoom({
          roomId:id,
          userId,
          requestId:requestId(body.requestId),
          startedAt:now(),
        });
        return sync(userId, id, 0);
      }
      case 'beginRound': {
        const id = roomId(body.roomId);
        const answerKey = text(body.answerKey, 2048);
        if (!answerKey) failRaidRoom('ANSWER_INVALID');
        await store.beginRound({
          roomId:id,
          userId,
          questionPublic:normalizeQuestionPublic(body.questionPublic),
          answerKey,
          requestId:requestId(body.requestId),
          begunAt:now(),
        });
        return sync(userId, id, 0);
      }
      case 'submit': {
        const id = roomId(body.roomId);
        const round = Math.trunc(Number(body.round) || 0);
        if (round < 1) failRaidRoom('INVALID_REQUEST');
        const result = await store.submitRound({
          roomId:id,
          userId,
          round,
          actionId:text(body.actionId || 'basic', 100) || 'basic',
          answer:text(body.answer),
          requestId:requestId(body.requestId),
          submittedAt:now(),
        });
        return { ...result, round };
      }
      case 'publishRound': {
        const id = roomId(body.roomId);
        const round = Math.trunc(Number(body.round) || 0);
        if (round < 1) failRaidRoom('INVALID_REQUEST');
        await store.publishRound({
          roomId:id,
          userId,
          round,
          result:normalizePublishResult(body.result),
          requestId:requestId(body.requestId),
          publishedAt:now(),
        });
        return sync(userId, id, 0);
      }
      case 'ackPlayback': {
        const id = roomId(body.roomId);
        const round = Math.trunc(Number(body.round) || 0);
        if (round < 0) failRaidRoom('INVALID_REQUEST');
        await store.ackPlayback({
          roomId:id,
          userId,
          round,
          seenAt:now(),
        });
        return sync(userId, id, body.afterSequence);
      }
      case 'ackQuestionReady': {
        const id = roomId(body.roomId);
        const round = Math.trunc(Number(body.round) || 0);
        if (round < 1) failRaidRoom('INVALID_REQUEST');
        await store.ackQuestionReady({
          roomId:id,
          userId,
          round,
          readyAt:now(),
        });
        return sync(userId, id, body.afterSequence);
      }
      case 'heartbeat': {
        const id = roomId(body.roomId);
        await store.heartbeat({ roomId:id, userId, seenAt:now() });
        return sync(userId, id, body.afterSequence);
      }
      case 'leave': {
        const id = roomId(body.roomId);
        return store.leaveRoom({
          roomId:id,
          userId,
          requestId:requestId(body.requestId),
          leftAt:now(),
        });
      }
      default:
        failRaidRoom('INVALID_REQUEST');
    }
  }

  return Object.freeze({ handle, sync, resume });
}

export const RaidRoomValidation = Object.freeze({
  normalizeQuestionPublic,
  normalizePublishResult,
  afterSequence,
});
