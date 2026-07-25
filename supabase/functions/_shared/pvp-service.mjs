import {
  judgeAnswer,
  normalizeSnapshot,
  publicQuestion,
  resolveRound,
  selectQuestion,
} from './pvp-rules.mjs';

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function participant(match, userId) {
  return match?.playerAId === userId || match?.playerBId === userId;
}

export function createPvpService({ store, now = Date.now, randomInt }) {
  if (!store || typeof randomInt !== 'function') throw new Error('PvP service dependencies are required');

  async function invite(userId, body) {
    if (!body.targetUserId || body.targetUserId === userId) fail('INVALID_TARGET');
    const [challenger, target, challengerMatch, targetMatch] = await Promise.all([
      store.getPresence(userId),
      store.getPresence(body.targetUserId),
      store.findActiveMatchForUser(userId),
      store.findActiveMatchForUser(body.targetUserId),
    ]);
    const online = (presence) => presence && now() - Number(presence.lastSeenAt) <= 15000;
    if (!online(challenger) || !online(target)) fail('OFFLINE');
    if (challenger.map !== 'town' || target.map !== 'town') fail('TOWN_ONLY');
    if (challenger.busy || target.busy || challengerMatch || targetMatch) fail('BUSY');
    return store.createInvite({
      challengerId:userId,
      targetId:body.targetUserId,
      requestId:String(body.requestId || ''),
      expiresAt:now() + 20000,
    });
  }

  async function submit(userId, body) {
    const match = await store.getMatchForUpdate(body.matchId);
    if (!participant(match, userId)) fail('NOT_PARTICIPANT');
    if (match.finishedAt || match.phase === 'finished' || match.phase === 'cancelled') fail('MATCH_CLOSED');
    if (Number(body.round) !== Number(match.round)) fail('ROUND_CHANGED');
    await store.insertRoundInputOnce({
      matchId:match.id,
      round:Number(match.round),
      userId,
      requestId:String(body.requestId || ''),
      actionId:String(body.actionId || 'basic'),
      answer:String(body.answer ?? ''),
      submittedAt:now(),
    });
    const inputs = await store.listRoundInputs(match.id, match.round);
    if (inputs.length < 2 && now() < Number(match.deadline)) {
      await store.updateMatch(match.id, { phase:'waiting' });
      return { waiting:true, round:Number(match.round) };
    }
    if (!match.playerAState || !match.playerBState || !match.answerKey) {
      fail('MATCH_STATE_MISSING');
    }
    const byUser = new Map(inputs.map((input) => [input.userId, input]));
    const inputFor = (id) => byUser.get(id) || { actionId:'basic', answer:'' };
    const aInput = inputFor(match.playerAId);
    const bInput = inputFor(match.playerBId);
    const resolution = resolveRound({
      match:{ id:match.id, round:match.round },
      a:{
        player:match.playerAState,
        actionId:aInput.actionId,
        correct:judgeAnswer({ answer:match.answerKey }, aInput.answer),
      },
      b:{
        player:match.playerBState,
        actionId:bInput.actionId,
        correct:judgeAnswer({ answer:match.answerKey }, bInput.answer),
      },
      randomInt,
    });
    await store.appendEvents(match.id, match.round, resolution.events);
    if (resolution.winner) {
      const winnerId = resolution.winner === 'a' ? match.playerAId : match.playerBId;
      const loserId = resolution.winner === 'a' ? match.playerBId : match.playerAId;
      await store.finishMatchOnce(match.id, winnerId, loserId, 'defeat');
      return { finished:true };
    }
    const question = selectQuestion(await store.readEnabledWorkbooks(), randomInt);
    if (!question) {
      await store.cancelMatch(match.id, 'no_questions');
      return { cancelled:true };
    }
    await store.updateMatch(match.id, {
      phase:'question',
      round:Number(match.round) + 1,
      playerAState:resolution.state.a,
      playerBState:resolution.state.b,
      question:publicQuestion(question),
      answerKey:question.answer,
      deadline:now() + 20000,
    });
    return { resolved:true, events:resolution.events };
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
        return store.upsertPresence(userId, {
          map:String(body.map || ''),
          busy:body.busy === true,
          publicProfile:body.publicProfile || {},
          lastSeenAt:now(),
        });
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
      case 'submit':
        return submit(userId, body);
      case 'sync': {
        const match = await store.getMatchForUser(body.matchId, userId);
        if (!match) fail('NOT_PARTICIPANT');
        return match;
      }
      case 'heartbeat':
        return store.heartbeat(userId, body.matchId, now());
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
