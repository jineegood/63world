import { failRaidRoom } from './raid-room-error.mjs';

const MAX_TEXT = 120;
const MAX_QUESTION = 500;
const MAX_RESULT_BYTES = 96 * 1024;
const ALLOWED_PUBLISH_PHASES = new Set(['effects', 'travel', 'cleared', 'wiped', 'cancelled']);

function text(value, maximum = MAX_TEXT) {
  return String(value ?? '').trim().slice(0, maximum);
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
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
  if (!source) failRaidRoom('INVALID_REQUEST');
  const prompt = text(source.prompt || source.q || source.question, MAX_QUESTION);
  if (!prompt) failRaidRoom('INVALID_REQUEST');
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
    const room = await store.getRoomForUser(id, userId);
    if (!room) failRaidRoom('NOT_MEMBER');
    const [members, events] = await Promise.all([
      store.listMembers(id),
      store.listEventsAfter(id, afterSequence(rawAfterSequence)),
    ]);
    const result = { room, members, events };
    if (room.hostId === userId && room.phase === 'resolving') {
      const submitted = await store.listRoundJudgements(id, room.round);
      const byUser = new Map(submitted.map((entry) => [String(entry.userId), entry]));
      result.submissions = members.map((member) => byUser.get(String(member.userId)) || ({
        userId:member.userId,
        actionId:'basic',
        correct:false,
        timedOut:true,
      }));
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
        if (floorGroup !== 1) failRaidRoom('FLOOR_LOCKED');
        const profile = await authoritativeProfile(userId);
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
        const answerKey = text(body.answerKey);
        if (!answerKey) failRaidRoom('INVALID_REQUEST');
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
