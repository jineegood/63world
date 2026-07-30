import {
  judgeAnswer,
  normalizeSnapshot,
  publicQuestion,
  resolveRound,
  selectQuestion,
} from './pvp-rules.mjs';

const PVP_PRESENCE_GRACE_MS = 90000;
const PVP_NEXT_ROUND_READY_WINDOW_MS = 60000;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function participant(match, userId) {
  return match?.playerAId === userId || match?.playerBId === userId;
}

function safeAfterSequence(value) {
  const number = Number(value);
  if (Number.isNaN(number) || number <= 0) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(number));
}

function requestedAfterSequence(body) {
  if (!Object.prototype.hasOwnProperty.call(body || {}, 'afterSequence')) return null;
  const value = body.afterSequence;
  if (value === null || typeof value === 'boolean') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const number = Number(value);
  if (Number.isNaN(number)) return null;
  return safeAfterSequence(number);
}

function publicMatch(match) {
  if (!match) return null;
  const { answerKey:privateAnswerKey, ...safe } = match;
  void privateAnswerKey;
  return safe;
}

function publicProfile(profile = {}) {
  return {
    name:String(profile.name || '학생').slice(0, 24),
    level:Number(profile.level) || 1,
    className:profile.className || 'warrior',
    spec:profile.spec || '',
    appearance:profile.appearance || {},
    equipment:profile.equipment || {},
    costume:profile.costume || {},
    skills:profile.skills || {},
    maxHp:Number(profile.maxHp) || 100,
    attack:Number(profile.attack) || 1,
    defense:Number(profile.defense) || 0,
  };
}

export function createPvpService({ store, now = Date.now, randomInt }) {
  if (!store || typeof randomInt !== 'function') throw new Error('PvP service dependencies are required');

  async function replayEventsFor(matchId, body) {
    const afterSequence = requestedAfterSequence(body);
    return afterSequence === null
      ? []
      : store.listEventsAfter(matchId, afterSequence);
  }

  async function recoverSubmittedRound(userId, body, match) {
    const requestId = String(body.requestId || '');
    const requestedRound = Number(body.round);
    if (!requestId || !Number.isInteger(requestedRound) || requestedRound < 1) return null;
    const prior = await store.findRoundInputByRequest(userId, requestId);
    if (!prior || prior.matchId !== match.id || Number(prior.round) !== requestedRound) return null;
    const replay = await store.listEventsAfter(match.id, requestedRound * 1000 - 1);
    const events = replay.filter((event) => Number(event.round) === requestedRound);
    if (!events.length) return null;
    if (match.phase === 'cancelled') {
      return { cancelled:true, recovered:true, round:requestedRound, events };
    }
    if (match.finishedAt || match.phase === 'finished') {
      return { finished:true, recovered:true, round:requestedRound, events };
    }
    if (Number(match.round) > requestedRound) {
      return { resolved:true, recovered:true, round:requestedRound, events };
    }
    return null;
  }

  async function invite(userId, body) {
    if (!body.targetUserId || body.targetUserId === userId) fail('INVALID_TARGET');
    const requestedAt = now();
    await store.expirePendingInvitesForUsers(
      [userId, body.targetUserId],
      requestedAt,
    );
    const [challenger, target, challengerMatch, targetMatch] = await Promise.all([
      store.getPresence(userId),
      store.getPresence(body.targetUserId),
      store.findActiveMatchForUser(userId),
      store.findActiveMatchForUser(body.targetUserId),
    ]);
    const online = (presence) => presence
      && now() - Number(presence.lastSeenAt) <= PVP_PRESENCE_GRACE_MS;
    if (!online(challenger) || !online(target)) fail('OFFLINE');
    if (challenger.map !== 'town' || target.map !== 'town') fail('TOWN_ONLY');
    if (challenger.busy || target.busy || challengerMatch || targetMatch) fail('BUSY');
    return store.createInvite({
      challengerId:userId,
      targetId:body.targetUserId,
      requestId:String(body.requestId || ''),
      requestedAt,
      expiresAt:requestedAt + 20000,
    });
  }

  async function submit(userId, body) {
    const match = await store.getMatchForUpdate(body.matchId);
    if (!participant(match, userId)) fail('NOT_PARTICIPANT');
    if (
      match.finishedAt
      || match.phase === 'finished'
      || match.phase === 'cancelled'
      || Number(body.round) !== Number(match.round)
    ) {
      const recovered = await recoverSubmittedRound(userId, body, match);
      if (recovered) return recovered;
    }
    if (match.finishedAt || match.phase === 'finished' || match.phase === 'cancelled') fail('MATCH_CLOSED');
    if (match.phase === 'reconnect') fail('RECONNECTING');
    if (Number(body.round) !== Number(match.round)) fail('ROUND_CHANGED');
    const claim = await store.submitRoundInput({
      matchId:match.id,
      round:Number(match.round),
      userId,
      requestId:String(body.requestId || ''),
      actionId:String(body.actionId || 'basic'),
      answer:String(body.answer ?? ''),
      submittedAt:now(),
    });
    if (!claim || claim.resolver !== true) {
      return { waiting:true, round:Number(match.round) };
    }
    const inputs = await store.listRoundInputs(match.id, match.round);
    if (!match.playerAState || !match.playerBState || !match.answerKey) {
      fail('MATCH_STATE_MISSING');
    }
    const byUser = new Map(inputs.map((input) => [input.userId, input]));
    const inputFor = (id) => byUser.get(id) || { actionId:'basic', answer:'' };
    const aInput = inputFor(match.playerAId);
    const bInput = inputFor(match.playerBId);
    const aCorrect = judgeAnswer({ answer:match.answerKey }, aInput.answer);
    const bCorrect = judgeAnswer({ answer:match.answerKey }, bInput.answer);
    const resolution = resolveRound({
      match:{ id:match.id, round:match.round },
      a:{
        player:match.playerAState,
        actionId:aInput.actionId,
        correct:aCorrect,
      },
      b:{
        player:match.playerBState,
        actionId:bInput.actionId,
        correct:bCorrect,
      },
      randomInt,
    });
    const resolvedEvents = resolution.events.map((event) => (
      event.kind === 'action'
        ? { ...event, correctAnswer:match.answerKey }
        : event
    ));
    const publicEvents = [{
      id:`${match.id}:${match.round}:dice`,
      kind:'dice',
      rolls:resolution.initiative.rolls,
      first:resolution.initiative.first,
    }, ...resolvedEvents];
    await store.appendEvents(match.id, match.round, publicEvents);
    if (resolution.winner) {
      const winnerId = resolution.winner === 'a' ? match.playerAId : match.playerBId;
      const loserId = resolution.winner === 'a' ? match.playerBId : match.playerAId;
      await store.finishMatchOnce(match.id, winnerId, loserId, 'defeat');
      return { finished:true, round:Number(match.round), events:publicEvents };
    }
    const question = selectQuestion(await store.readEnabledWorkbooks(), randomInt);
    if (!question) {
      await store.cancelMatch(match.id, 'no_questions');
      return { cancelled:true, round:Number(match.round), events:publicEvents };
    }
    await store.updateMatch(match.id, {
      phase:'question',
      round:Number(match.round) + 1,
      playerAState:resolution.state.a,
      playerBState:resolution.state.b,
      question:publicQuestion(question),
      answerKey:question.answer,
      deadline:now() + PVP_NEXT_ROUND_READY_WINDOW_MS,
      timerStartedRound:Number(match.round),
    });
    return { resolved:true, round:Number(match.round), events:publicEvents };
  }

  async function surrender(userId, body) {
    const match = await store.getMatchForUpdate(body.matchId);
    if (!participant(match, userId)) fail('NOT_PARTICIPANT');
    if (match.finishedAt || match.phase === 'finished' || match.phase === 'cancelled') {
      return { finished:false, alreadyClosed:true };
    }
    const winnerId = match.playerAId === userId ? match.playerBId : match.playerAId;
    return { finished:await store.finishMatchOnce(match.id, winnerId, userId, 'surrender') };
  }

  async function handle(userId, body = {}) {
    if (!userId) fail('UNAUTHENTICATED');
    switch (body.op) {
      case 'presence':
      {
        const authoritative = await store.getAuthoritativeProfile(userId);
        if (!authoritative) fail('PROFILE_MISSING');
        const checkedAt = now();
        const [activeMatch, pendingInvite] = await Promise.all([
          store.findActiveMatchForUser(userId),
          store.getPendingInviteForTarget(userId, checkedAt),
        ]);
        const presence = await store.upsertPresence(userId, {
          map:String(authoritative.map || ''),
          busy:authoritative.map !== 'town' || !!activeMatch,
          publicProfile:publicProfile(authoritative),
          lastSeenAt:checkedAt,
        });
        return {
          ...(presence || { ok:true }),
          activeMatch:publicMatch(activeMatch),
          pendingInvite:pendingInvite || null,
        };
      }
      case 'profile':
        return store.getPublicProfile(body.userId);
      case 'invite':
        return invite(userId, body);
      case 'respond':
        return store.respondToInvite(userId, body, now(), randomInt, {
          normalizeSnapshot,
          selectQuestion,
          publicQuestion,
        });
      case 'ready':
      {
        const match = await store.getMatchForUpdate(body.matchId);
        if (!participant(match, userId)) fail('NOT_PARTICIPANT');
        if (match.finishedAt || ['finished', 'cancelled'].includes(match.phase)) fail('MATCH_CLOSED');
        if (Number(body.round) !== Number(match.round)) fail('ROUND_CHANGED');
        return store.markRoundReady(userId, match.id, Number(match.round), now());
      }
      case 'submit':
        return submit(userId, body);
      case 'sync': {
        const match = await store.getMatchForUser(body.matchId, userId);
        if (!match) fail('NOT_PARTICIPANT');
        const replayEvents = await replayEventsFor(match.id, body);
        return { ...publicMatch(match), replayEvents };
      }
      case 'heartbeat':
      {
        const heartbeat = await store.heartbeat(userId, body.matchId, now());
        if (!body.matchId) return heartbeat;
        const match = await store.getMatchForUpdate(body.matchId);
        if (participant(match, userId)
          && ['question', 'waiting'].includes(match.phase)
          && now() >= Number(match.deadline || 0)) {
          const timeoutResult = await submit(userId, {
            matchId:match.id,
            round:match.round,
            actionId:'basic',
            answer:'',
            requestId:`timeout-${match.id}-${match.round}-${userId}`,
          });
          if (!timeoutResult?.waiting) return timeoutResult;
          const replayEvents = await replayEventsFor(match.id, body);
          return {
            ...(heartbeat || { ok:true }),
            ...timeoutResult,
            match:publicMatch(match),
            replayEvents,
          };
        }
        if (participant(match, userId)) {
          const replayEvents = await replayEventsFor(match.id, body);
          return {
            ...(heartbeat || { ok:true }),
            match:publicMatch(match),
            replayEvents,
          };
        }
        return heartbeat;
      }
      case 'surrender':
        return surrender(userId, body);
      case 'cleanup':
        return store.cleanupStale(now());
      default:
        fail('INVALID_OPERATION');
    }
  }

  return Object.freeze({ handle });
}
