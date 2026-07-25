function rowMatch(row) {
  if (!row) return null;
  return {
    id:row.id, playerAId:row.player_a_id, playerBId:row.player_b_id,
    phase:row.phase, round:row.round_no, playerAState:row.player_a_state,
    playerBState:row.player_b_state, question:row.question_public,
    deadline:row.question_deadline ? new Date(row.question_deadline).getTime() : 0,
    reconnectDeadline:row.reconnect_deadline ? new Date(row.reconnect_deadline).getTime() : 0,
    finishedAt:row.finished_at, winnerId:row.winner_id, loserId:row.loser_id,
  };
}

function check(result) {
  if (result.error) throw result.error;
  return result.data;
}

export function createSupabasePvpStore(client) {
  async function getMatch(id) {
    const row = check(await client.from('pvp_matches_v1').select('*').eq('id', id).maybeSingle());
    if (!row) return null;
    const secret = check(await client.from('pvp_match_secrets_v1').select('answer_key').eq('match_id', id).maybeSingle());
    return { ...rowMatch(row), answerKey:secret?.answer_key };
  }
  return {
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
    async createInvite(value) {
      return check(await client.from('pvp_invites_v1').insert({
        challenger_id:value.challengerId, target_id:value.targetId, request_id:value.requestId,
        expires_at:new Date(value.expiresAt).toISOString(),
      }).select('*').single());
    },
    getMatchForUpdate:getMatch,
    async getMatchForUser(id, userId) {
      const match = await getMatch(id);
      return match && (match.playerAId === userId || match.playerBId === userId) ? match : null;
    },
    async insertRoundInputOnce(value) {
      const result = await client.from('pvp_round_inputs_v1').upsert({
        match_id:value.matchId, round_no:value.round, user_id:value.userId,
        request_id:value.requestId, action_id:value.actionId,
        submitted_answer:value.answer, submitted_at:new Date(value.submittedAt).toISOString(),
      }, { onConflict:'match_id,round_no,user_id', ignoreDuplicates:true });
      check(result); return true;
    },
    async listRoundInputs(matchId, round) {
      return (check(await client.from('pvp_round_inputs_v1').select('*').eq('match_id', matchId).eq('round_no', round)) || [])
        .map((row) => ({ userId:row.user_id, actionId:row.action_id, answer:row.submitted_answer }));
    },
    async updateMatch(id, patch) {
      const row = {};
      if (patch.phase) row.phase = patch.phase;
      if (patch.round) row.round_no = patch.round;
      if (patch.playerAState) row.player_a_state = patch.playerAState;
      if (patch.playerBState) row.player_b_state = patch.playerBState;
      if (patch.question) row.question_public = patch.question;
      if (patch.deadline) row.question_deadline = new Date(patch.deadline).toISOString();
      row.updated_at = new Date().toISOString();
      check(await client.from('pvp_matches_v1').update(row).eq('id', id));
      if (patch.answerKey) check(await client.from('pvp_match_secrets_v1').upsert({ match_id:id, answer_key:patch.answerKey }));
    },
    async appendEvents(matchId, round, events) {
      if (!events.length) return;
      check(await client.from('pvp_match_events_v1').insert(events.map((event, index) => ({
        match_id:matchId, round_no:round, sequence_no:round * 1000 + index, event,
      }))));
    },
    async readEnabledWorkbooks() {
      const row = check(await client.from('shared_state_v2').select('data').eq('key', 'workbooks').maybeSingle());
      return row?.data?.items || [];
    },
    async finishMatchOnce(id, winner, loser, reason) {
      return check(await client.rpc('finish_pvp_match_v1', { _match_id:id, _winner_id:winner, _loser_id:loser, _reason:reason }));
    },
    async cancelMatch(id, reason) {
      check(await client.from('pvp_matches_v1').update({ phase:'cancelled', finish_reason:reason, finished_at:new Date().toISOString() }).eq('id', id).is('finished_at', null));
      return true;
    },
    async heartbeat(userId) {
      check(await client.from('pvp_presence_v1').update({ last_seen_at:new Date().toISOString() }).eq('user_id', userId));
      return { ok:true };
    },
    async cleanupStale(now) {
      check(await client.from('pvp_invites_v1').update({ status:'expired' }).eq('status', 'pending').lt('expires_at', new Date(now).toISOString()));
      return { ok:true };
    },
    async respondToInvite(userId, body, now, randomInt, helpers) {
      const invite = check(await client.from('pvp_invites_v1').select('*').eq('id', body.inviteId).maybeSingle());
      if (!invite || invite.target_id !== userId) throw Object.assign(new Error(), { code:'NOT_INVITED' });
      if (invite.status !== 'pending' || new Date(invite.expires_at).getTime() <= now) throw Object.assign(new Error(), { code:'INVITE_CLOSED' });
      if (body.accept !== true) {
        check(await client.from('pvp_invites_v1').update({ status:'declined', responded_at:new Date(now).toISOString() }).eq('id', invite.id).eq('status', 'pending'));
        return { accepted:false };
      }
      const presenceRows = check(await client.from('pvp_presence_v1').select('*').in('user_id', [invite.challenger_id, invite.target_id]));
      if (presenceRows.length !== 2 || presenceRows.some((row) => row.map !== 'town' || row.busy)) throw Object.assign(new Error(), { code:'TOWN_ONLY' });
      const profiles = new Map(presenceRows.map((row) => [row.user_id, row.public_profile || {}]));
      const a = helpers.normalizeSnapshot({ ...profiles.get(invite.challenger_id), userId:invite.challenger_id });
      const b = helpers.normalizeSnapshot({ ...profiles.get(invite.target_id), userId:invite.target_id });
      a.hp = a.maxHp; a.shield = 0; b.hp = b.maxHp; b.shield = 0;
      const workbookRow = check(await client.from('shared_state_v2').select('data').eq('key', 'workbooks').maybeSingle());
      const question = helpers.selectQuestion(workbookRow?.data?.items || [], randomInt);
      if (!question) throw Object.assign(new Error(), { code:'NO_QUESTIONS' });
      const match = check(await client.from('pvp_matches_v1').insert({
        invite_id:invite.id, player_a_id:invite.challenger_id, player_b_id:invite.target_id,
        player_a_state:a, player_b_state:b, question_public:helpers.publicQuestion(question),
        question_deadline:new Date(now + 20000).toISOString(),
      }).select('*').single());
      check(await client.from('pvp_match_secrets_v1').insert({ match_id:match.id, answer_key:question.answer }));
      check(await client.from('pvp_invites_v1').update({ status:'accepted', responded_at:new Date(now).toISOString() }).eq('id', invite.id));
      check(await client.from('pvp_presence_v1').update({ busy:true }).in('user_id', [invite.challenger_id, invite.target_id]));
      return { accepted:true, match:rowMatch(match) };
    },
  };
}
