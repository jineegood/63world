import { buildAuthoritativePvpProfile } from './pvp-profile.mjs';

function rowMatch(row) {
  if (!row) return null;
  return {
    id:row.id, playerAId:row.player_a_id, playerBId:row.player_b_id,
    phase:row.phase, round:row.round_no, playerAState:row.player_a_state,
    playerBState:row.player_b_state, question:row.question_public,
    deadline:row.question_deadline ? new Date(row.question_deadline).getTime() : 0,
    reconnectDeadline:row.reconnect_deadline ? new Date(row.reconnect_deadline).getTime() : 0,
    disconnectedUserId:row.disconnected_user_id || null,
    resumePhase:row.resume_phase || null,
    pausedQuestionMs:Number(row.paused_question_ms) || 0,
    finishedAt:row.finished_at, winnerId:row.winner_id, loserId:row.loser_id,
  };
}

function publicStoredMatch(match) {
  if (!match) return null;
  const { answerKey:privateAnswerKey, ...safe } = match;
  void privateAnswerKey;
  return safe;
}

function check(result) {
  if (result.error) throw result.error;
  return result.data;
}

function workbookItems(value) {
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.items) ? value.items : [];
}

function safeSequenceNo(value) {
  const number = Number(value);
  if (Number.isNaN(number) || number <= 0) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(number));
}

function publicEventRow(row) {
  const sequenceNo = Number(row?.sequence_no);
  const round = Number(row?.round_no);
  if (!Number.isSafeInteger(sequenceNo) || sequenceNo < 0) return null;
  if (!Number.isSafeInteger(round) || round < 1) return null;
  if (!row?.event || typeof row.event !== 'object' || Array.isArray(row.event)) return null;
  const event = { ...row.event };
  for (const privateKey of [
    'answerKey', 'answer_key', 'submittedAnswer', 'submitted_answer',
    'playerAState', 'playerBState', 'requestId',
  ]) delete event[privateKey];
  if (event.kind !== 'action') delete event.correctAnswer;
  return { ...event, round, sequenceNo };
}

const DISCONNECT_DETECT_MS = 10000;
const RECONNECT_GRACE_MS = 30000;

export function decideDisconnectV1(match, lastSeen, now) {
  if (!match || match.finishedAt || ['finished', 'cancelled'].includes(match.phase)) return null;
  const staleA = now - Number(lastSeen?.a || 0) > DISCONNECT_DETECT_MS;
  const staleB = now - Number(lastSeen?.b || 0) > DISCONNECT_DETECT_MS;

  if (match.phase !== 'reconnect') {
    if (!staleA && !staleB) return null;
    return {
      type:'reconnect',
      disconnectedUserId:staleA !== staleB ? (staleA ? match.playerAId : match.playerBId) : null,
      reconnectDeadline:now + RECONNECT_GRACE_MS,
      resumePhase:match.phase,
      pausedQuestionMs:Math.max(0, Number(match.deadline || 0) - now),
    };
  }

  if (!staleA && !staleB) {
    const phase = match.resumePhase || 'question';
    return {
      type:'resume',
      phase,
      deadline:phase === 'question' || phase === 'waiting'
        ? now + Math.max(1000, Number(match.pausedQuestionMs) || 20000)
        : Number(match.deadline) || now,
    };
  }
  if (now < Number(match.reconnectDeadline || 0)) return null;
  if (staleA && staleB) return { type:'cancel', reason:'both_disconnected' };
  return staleA
    ? { type:'finish', winnerId:match.playerBId, loserId:match.playerAId, reason:'disconnect' }
    : { type:'finish', winnerId:match.playerAId, loserId:match.playerBId, reason:'disconnect' };
}

export function createSupabasePvpStore(client) {
  async function findInviteByRequest(challengerId, requestId) {
    return check(await client.from('pvp_invites_v1').select('*')
      .eq('challenger_id', challengerId)
      .eq('request_id', requestId)
      .maybeSingle());
  }
  async function getAuthoritativeProfile(id) {
    const row = check(await client.from('player_profiles_v2')
      .select('display_name,data').eq('user_id', id).maybeSingle());
    if (!row) return null;
    return buildAuthoritativePvpProfile({
      userId:id,
      displayName:row.display_name,
      data:row.data,
    });
  }
  async function getMatch(id) {
    const row = check(await client.from('pvp_matches_v1').select('*').eq('id', id).maybeSingle());
    if (!row) return null;
    const secret = check(await client.from('pvp_match_secrets_v1').select('answer_key').eq('match_id', id).maybeSingle());
    return { ...rowMatch(row), answerKey:secret?.answer_key };
  }
  async function setPlayersAvailable(match) {
    if (!match) return;
    check(await client.from('pvp_presence_v1').update({ busy:false })
      .in('user_id', [match.playerAId, match.playerBId]));
  }
  async function cancelMatch(id, reason) {
    const match = await getMatch(id);
    check(await client.from('pvp_matches_v1').update({
      phase:'cancelled',
      finish_reason:reason,
      finished_at:new Date().toISOString(),
      updated_at:new Date().toISOString(),
    }).eq('id', id).is('finished_at', null));
    await setPlayersAvailable(match);
    return true;
  }
  async function reconcileMatch(id, now) {
    const match = await getMatch(id);
    if (!match || match.finishedAt || ['finished', 'cancelled'].includes(match.phase)) return { ok:true };
    const rows = check(await client.from('pvp_presence_v1').select('user_id,last_seen_at')
      .in('user_id', [match.playerAId, match.playerBId])) || [];
    const seen = new Map(rows.map((row) => [row.user_id, new Date(row.last_seen_at).getTime()]));
    const decision = decideDisconnectV1(match, {
      a:seen.get(match.playerAId) || 0,
      b:seen.get(match.playerBId) || 0,
    }, now);
    if (!decision) return { ok:true };

    if (decision.type === 'reconnect') {
      check(await client.from('pvp_matches_v1').update({
        phase:'reconnect',
        disconnected_user_id:decision.disconnectedUserId,
        reconnect_deadline:new Date(decision.reconnectDeadline).toISOString(),
        resume_phase:decision.resumePhase,
        paused_question_ms:decision.pausedQuestionMs,
        updated_at:new Date(now).toISOString(),
      }).eq('id', id).is('finished_at', null));
    } else if (decision.type === 'resume') {
      check(await client.from('pvp_matches_v1').update({
        phase:decision.phase,
        question_deadline:new Date(decision.deadline).toISOString(),
        disconnected_user_id:null,
        reconnect_deadline:null,
        resume_phase:null,
        paused_question_ms:null,
        updated_at:new Date(now).toISOString(),
      }).eq('id', id).is('finished_at', null));
    } else if (decision.type === 'finish') {
      await check(await client.rpc('finish_pvp_match_v1', {
        _match_id:id,
        _winner_id:decision.winnerId,
        _loser_id:decision.loserId,
        _reason:decision.reason,
      }));
      await setPlayersAvailable(match);
    } else if (decision.type === 'cancel') {
      await cancelMatch(id, decision.reason);
    }
    return { ok:true, decision:decision.type };
  }
  return {
    getAuthoritativeProfile,
    async getPresence(id) {
      const row = check(await client.from('pvp_presence_v1').select('*').eq('user_id', id).maybeSingle());
      return row && { userId:row.user_id, map:row.map, busy:row.busy, publicProfile:row.public_profile, lastSeenAt:new Date(row.last_seen_at).getTime() };
    },
    async upsertPresence(id, value) {
      check(await client.from('pvp_presence_v1').upsert({
        user_id:id, map:value.map, busy:value.busy, public_profile:value.publicProfile,
        last_seen_at:new Date(value.lastSeenAt).toISOString(),
      }));
      return { ok:true };
    },
    async getPublicProfile(id) {
      const [presence, record] = await Promise.all([
        this.getPresence(id),
        client.from('pvp_records_v1').select('wins,losses').eq('user_id', id).maybeSingle().then(check),
      ]);
      return presence ? { ...presence.publicProfile, userId:id, pvpAvailable:presence.map === 'town' && !presence.busy, wins:record?.wins || 0, losses:record?.losses || 0 } : null;
    },
    async findActiveMatchForUser(id) {
      const row = check(await client.from('pvp_matches_v1').select('*').or(`player_a_id.eq.${id},player_b_id.eq.${id}`).is('finished_at', null).neq('phase', 'cancelled').limit(1).maybeSingle());
      return rowMatch(row);
    },
    async expirePendingInvitesForUsers(rawUserIds, now) {
      const userIds = [...new Set((Array.isArray(rawUserIds) ? rawUserIds : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean))];
      if (!userIds.length) return { ok:true };
      const expiresAt = new Date(now).toISOString();
      check(await client.from('pvp_invites_v1').update({ status:'expired' })
        .eq('status', 'pending')
        .lte('expires_at', expiresAt)
        .in('challenger_id', userIds));
      check(await client.from('pvp_invites_v1').update({ status:'expired' })
        .eq('status', 'pending')
        .lte('expires_at', expiresAt)
        .in('target_id', userIds));
      return { ok:true };
    },
    async getPendingInviteForTarget(userId, now) {
      return check(await client.from('pvp_invites_v1').select('*')
        .eq('target_id', userId)
        .eq('status', 'pending')
        .gt('expires_at', new Date(now).toISOString())
        .order('created_at', { ascending:false })
        .limit(1)
        .maybeSingle());
    },
    async createInvite(value) {
      const existing = await findInviteByRequest(value.challengerId, value.requestId);
      if (existing) {
        if (existing.target_id !== value.targetId) {
          throw Object.assign(new Error(), { code:'INVALID_REQUEST' });
        }
        return existing;
      }
      try {
        return check(await client.rpc('private_create_pvp_invite_v2', {
          p_challenger_id:value.challengerId,
          p_target_id:value.targetId,
          p_request_id:value.requestId,
          p_requested_at:new Date(value.requestedAt).toISOString(),
        }));
      } catch (error) {
        const recovered = await findInviteByRequest(value.challengerId, value.requestId);
        if (recovered?.target_id === value.targetId) return recovered;
        if (String(error?.code || '') === '23505') {
          throw Object.assign(new Error(), { code:'BUSY' });
        }
        throw error;
      }
    },
    getMatchForUpdate:getMatch,
    async getMatchForUser(id, userId) {
      const match = await getMatch(id);
      return match && (match.playerAId === userId || match.playerBId === userId) ? match : null;
    },
    async submitRoundInput(value) {
      return check(await client.rpc('private_submit_pvp_round_v2', {
        p_user_id:value.userId,
        p_match_id:value.matchId,
        p_round_no:value.round,
        p_request_id:value.requestId,
        p_action_id:value.actionId,
        p_answer:value.answer,
      }));
    },
    async listRoundInputs(matchId, round) {
      return (check(await client.from('pvp_round_inputs_v1').select('*').eq('match_id', matchId).eq('round_no', round)) || [])
        .map((row) => ({ userId:row.user_id, actionId:row.action_id, answer:row.submitted_answer }));
    },
    async findRoundInputByRequest(userId, requestId) {
      const row = check(await client.from('pvp_round_inputs_v1').select('match_id,round_no,user_id,request_id')
        .eq('user_id', userId)
        .eq('request_id', requestId)
        .maybeSingle());
      return row && {
        matchId:row.match_id,
        round:Number(row.round_no),
        userId:row.user_id,
        requestId:row.request_id,
      };
    },
    async updateMatch(id, patch) {
      const row = {};
      if (patch.phase) row.phase = patch.phase;
      if (patch.round) row.round_no = patch.round;
      if (patch.playerAState) row.player_a_state = patch.playerAState;
      if (patch.playerBState) row.player_b_state = patch.playerBState;
      if (patch.question) row.question_public = patch.question;
      if (patch.deadline) row.question_deadline = new Date(patch.deadline).toISOString();
      if (patch.phase) {
        row.resolution_started_at = patch.phase === 'resolving'
          ? new Date().toISOString()
          : null;
      }
      row.updated_at = new Date().toISOString();
      check(await client.from('pvp_matches_v1').update(row).eq('id', id));
      if (patch.answerKey) check(await client.from('pvp_match_secrets_v1').upsert({ match_id:id, answer_key:patch.answerKey }));
    },
    async appendEvents(matchId, round, events) {
      if (!events.length) return;
      check(await client.from('pvp_match_events_v1').upsert(events.map((event, index) => ({
        match_id:matchId, round_no:round, sequence_no:round * 1000 + index, event,
      })), {
        onConflict:'match_id,sequence_no',
        ignoreDuplicates:true,
      }));
    },
    async listEventsAfter(matchId, afterSequence) {
      const rows = check(await client.from('pvp_match_events_v1')
        .select('round_no,sequence_no,event')
        .eq('match_id', matchId)
        .gt('sequence_no', safeSequenceNo(afterSequence))
        .order('sequence_no', { ascending:true })
        .limit(500)) || [];
      return rows.map(publicEventRow).filter(Boolean);
    },
    async readEnabledWorkbooks() {
      const row = check(await client.from('shared_state_v2').select('data').eq('key', 'workbooks').maybeSingle());
      return workbookItems(row?.data);
    },
    async finishMatchOnce(id, winner, loser, reason) {
      const match = await getMatch(id);
      const finished = check(await client.rpc('finish_pvp_match_v1', { _match_id:id, _winner_id:winner, _loser_id:loser, _reason:reason }));
      if (finished) await setPlayersAvailable(match);
      return finished;
    },
    cancelMatch,
    async heartbeat(userId, matchId, now) {
      check(await client.from('pvp_presence_v1').update({ last_seen_at:new Date(now).toISOString() }).eq('user_id', userId));
      if (!matchId) return { ok:true };
      const match = await getMatch(matchId);
      if (!match || (match.playerAId !== userId && match.playerBId !== userId)) return { ok:true };
      return reconcileMatch(matchId, now);
    },
    async cleanupStale(now) {
      check(await client.from('pvp_invites_v1').update({ status:'expired' }).eq('status', 'pending').lt('expires_at', new Date(now).toISOString()));
      const matches = check(await client.from('pvp_matches_v1').select('id')
        .is('finished_at', null).neq('phase', 'cancelled')) || [];
      for (const match of matches) await reconcileMatch(match.id, now);
      return { ok:true };
    },
    async respondToInvite(userId, body, now, randomInt, helpers) {
      const invite = check(await client.from('pvp_invites_v1').select('*').eq('id', body.inviteId).maybeSingle());
      if (!invite || invite.target_id !== userId) throw Object.assign(new Error(), { code:'NOT_INVITED' });
      if (invite.status === 'accepted' && body.accept === true && invite.match_id) {
        const acceptedMatch = await getMatch(invite.match_id);
        if (!acceptedMatch) throw Object.assign(new Error(), { code:'MATCH_NOT_FOUND' });
        return { accepted:true, match:publicStoredMatch(acceptedMatch), recovered:true };
      }
      if (invite.status === 'declined' && body.accept !== true) {
        return { accepted:false, recovered:true };
      }
      if (invite.status !== 'pending' || new Date(invite.expires_at).getTime() <= now) {
        throw Object.assign(new Error(), { code:'INVITE_CLOSED' });
      }
      if (body.accept !== true) {
        check(await client.from('pvp_invites_v1').update({ status:'declined', responded_at:new Date(now).toISOString() }).eq('id', invite.id).eq('status', 'pending'));
        return { accepted:false };
      }
      const [aProfile, bProfile] = await Promise.all([
        getAuthoritativeProfile(invite.challenger_id),
        getAuthoritativeProfile(invite.target_id),
      ]);
      if (!aProfile || !bProfile) throw Object.assign(new Error(), { code:'PROFILE_MISSING' });
      const a = helpers.normalizeSnapshot({ ...aProfile, userId:invite.challenger_id });
      const b = helpers.normalizeSnapshot({ ...bProfile, userId:invite.target_id });
      a.hp = a.maxHp; a.shield = 0; b.hp = b.maxHp; b.shield = 0;
      const workbookRow = check(await client.from('shared_state_v2').select('data').eq('key', 'workbooks').maybeSingle());
      const question = helpers.selectQuestion(workbookItems(workbookRow?.data), randomInt);
      if (!question) throw Object.assign(new Error(), { code:'NO_QUESTIONS' });
      const accepted = check(await client.rpc('private_accept_pvp_invite_v2', {
        p_user_id:userId,
        p_invite_id:invite.id,
        p_accepted_at:new Date(now).toISOString(),
        p_player_a_state:a,
        p_player_b_state:b,
        p_question_public:helpers.publicQuestion(question),
        p_answer_key:question.answer,
        p_question_deadline:new Date(now + 20000).toISOString(),
      }));
      const match = accepted?.match_id ? await getMatch(accepted.match_id) : null;
      if (!match) throw Object.assign(new Error(), { code:'MATCH_NOT_FOUND' });
      return {
        accepted:true,
        match:publicStoredMatch(match),
        recovered:accepted.created !== true,
      };
    },
  };
}
