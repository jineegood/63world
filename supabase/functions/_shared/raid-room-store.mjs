import { buildAuthoritativePvpProfile } from './pvp-profile.mjs';

function check(result) {
  if (result?.error) throw result.error;
  const data = result?.data;
  if (data && typeof data.error === 'string') {
    const error = new Error(data.error);
    error.code = data.error;
    throw error;
  }
  return data;
}

function roomRow(row) {
  if (!row) return null;
  return {
    id:row.id,
    code:row.invite_code,
    hostId:row.host_id,
    floorGroup:Number(row.floor_group) || 1,
    phase:row.phase,
    encounterIndex:Number(row.encounter_index) || 0,
    currentFloor:Number(row.current_floor) || 1,
    round:Number(row.round_no) || 0,
    monsterState:row.monster_state || {},
    question:row.question_public || null,
    questionDeadline:row.question_deadline ? new Date(row.question_deadline).getTime() : 0,
    version:Number(row.version) || 1,
    nextSequence:Number(row.next_sequence) || 1,
    createdAt:row.created_at,
    updatedAt:row.updated_at,
    finishedAt:row.finished_at || null,
  };
}

function memberRow(row) {
  if (!row) return null;
  return {
    roomId:row.room_id,
    userId:row.user_id,
    joinOrder:Number(row.join_order) || 1,
    slot:row.slot || null,
    ready:row.ready === true,
    profile:row.profile_snapshot || {},
    state:row.combat_state || {},
    playbackRound:Math.max(0, Number(row.playback_round) || 0),
    lastSeenAt:row.last_seen_at ? new Date(row.last_seen_at).getTime() : 0,
    active:row.active === true,
  };
}

function eventRow(row) {
  const sequenceNo = Number(row?.sequence_no);
  if (!Number.isSafeInteger(sequenceNo) || sequenceNo < 1) return null;
  if (!row?.event || typeof row.event !== 'object' || Array.isArray(row.event)) return null;
  const event = { ...row.event };
  for (const key of ['answerKey', 'answer_key', 'submittedAnswer', 'submitted_answer', 'requestId']) {
    delete event[key];
  }
  return {
    sequenceNo,
    round:Number(row.round_no) || 0,
    event,
  };
}

function rpcArgs(value) {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined));
}

export function createSupabaseRaidRoomStore(client) {
  if (!client?.from || !client?.rpc) throw new TypeError('A Supabase service client is required.');

  async function getRoom(id) {
    return roomRow(check(await client.from('raid_rooms_v1').select('*').eq('id', id).maybeSingle()));
  }

  async function rpc(name, args) {
    return check(await client.rpc(name, rpcArgs(args)));
  }

  return Object.freeze({
    async getAuthoritativeProfile(userId) {
      const [profileResult, progressResult] = await Promise.all([
        client.from('player_profiles_v2')
          .select('display_name,data').eq('user_id', userId).maybeSingle(),
        client.from('raid_progress_v1')
          .select('top_group').eq('user_id', userId).maybeSingle(),
      ]);
      const row = check(profileResult);
      const progress = check(progressResult);
      if (!row) return null;
      const profile = buildAuthoritativePvpProfile({
        userId,
        displayName:row.display_name,
        data:row.data,
      });
      if (!profile) return null;
      return {
        ...profile,
        raidTopGroup:Math.max(0, Math.min(7, Math.trunc(Number(progress?.top_group) || 0))),
      };
    },

    async createRoom(value) {
      const created = await rpc('private_create_raid_room_v1', {
        p_user_id:value.userId,
        p_floor_group:value.floorGroup,
        p_profile:value.profile,
        p_request_id:value.requestId,
        p_created_at:new Date(value.createdAt).toISOString(),
      });
      return { roomId:created.room_id || created.id, recovered:created.recovered === true };
    },

    async joinRoom(value) {
      const joined = await rpc('private_join_raid_room_v1', {
        p_user_id:value.userId,
        p_invite_code:value.code,
        p_profile:value.profile,
        p_request_id:value.requestId,
        p_joined_at:new Date(value.joinedAt).toISOString(),
      });
      return { roomId:joined.room_id || joined.id, recovered:joined.recovered === true };
    },

    async getRoomForUser(id, userId) {
      const member = check(await client.from('raid_room_members_v1')
        .select('room_id').eq('room_id', id).eq('user_id', userId).eq('active', true).maybeSingle());
      return member ? getRoom(id) : null;
    },

    async findActiveRoomForUser(userId) {
      const member = check(await client.from('raid_room_members_v1')
        .select('room_id').eq('user_id', userId).eq('active', true).limit(1).maybeSingle());
      if (!member?.room_id) return null;
      const room = await getRoom(member.room_id);
      return room && !['cleared', 'wiped', 'cancelled'].includes(room.phase) ? room : null;
    },

    async listMembers(id) {
      const rows = check(await client.from('raid_room_members_v1').select('*')
        .eq('room_id', id).eq('active', true).order('join_order', { ascending:true })) || [];
      return rows.map(memberRow).filter(Boolean);
    },

    async listEventsAfter(id, afterSequence) {
      const rows = check(await client.from('raid_events_v1')
        .select('round_no,sequence_no,event')
        .eq('room_id', id)
        .gt('sequence_no', afterSequence)
        .order('sequence_no', { ascending:true })
        .limit(500)) || [];
      return rows.map(eventRow).filter(Boolean);
    },

    async listRoundJudgements(id, round) {
      const rows = check(await client.from('raid_round_inputs_v1')
        .select('user_id,action_id,is_correct,submitted_at')
        .eq('room_id', id).eq('round_no', round)
        .order('submitted_at', { ascending:true })) || [];
      return rows.map((row) => ({
        userId:row.user_id,
        actionId:row.action_id,
        correct:row.is_correct === true,
      }));
    },

    async getRoundAnswerKeys(id, round) {
      const row = check(await client.from('raid_question_secrets_v1')
        .select('answer_key').eq('room_id', id).eq('round_no', round).maybeSingle());
      if (!row?.answer_key) return {};
      try {
        const parsed = JSON.parse(row.answer_key);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch {
        return { default:String(row.answer_key) };
      }
    },

    setFormation:value => rpc('private_set_raid_formation_v1', {
      p_user_id:value.userId,
      p_room_id:value.roomId,
      p_assignments:value.assignments,
      p_request_id:value.requestId,
      p_changed_at:new Date(value.changedAt).toISOString(),
    }),

    setReady:value => rpc('private_set_raid_ready_v1', {
      p_user_id:value.userId,
      p_room_id:value.roomId,
      p_ready:value.ready,
      p_changed_at:new Date(value.changedAt).toISOString(),
    }),

    startRoom:value => rpc('private_start_raid_room_v1', {
      p_user_id:value.userId,
      p_room_id:value.roomId,
      p_request_id:value.requestId,
      p_started_at:new Date(value.startedAt).toISOString(),
    }),

    beginRound:value => rpc('private_begin_raid_round_v1', {
      p_user_id:value.userId,
      p_room_id:value.roomId,
      p_question_public:value.questionPublic,
      p_answer_key:value.answerKey,
      p_request_id:value.requestId,
      p_begun_at:new Date(value.begunAt).toISOString(),
    }),

    submitRound:value => rpc('private_submit_raid_round_v1', {
      p_user_id:value.userId,
      p_room_id:value.roomId,
      p_round_no:value.round,
      p_action_id:value.actionId,
      p_answer:value.answer,
      p_request_id:value.requestId,
      p_submitted_at:new Date(value.submittedAt).toISOString(),
    }),

    publishRound:value => rpc('private_publish_raid_round_v1', {
      p_user_id:value.userId,
      p_room_id:value.roomId,
      p_round_no:value.round,
      p_result:value.result,
      p_request_id:value.requestId,
      p_published_at:new Date(value.publishedAt).toISOString(),
    }),

    ackPlayback:value => rpc('private_ack_raid_playback_v1', {
      p_user_id:value.userId,
      p_room_id:value.roomId,
      p_round_no:value.round,
      p_seen_at:new Date(value.seenAt).toISOString(),
    }),

    heartbeat:value => rpc('private_heartbeat_raid_room_v1', {
      p_user_id:value.userId,
      p_room_id:value.roomId,
      p_seen_at:new Date(value.seenAt).toISOString(),
    }),

    leaveRoom:value => rpc('private_leave_raid_room_v1', {
      p_user_id:value.userId,
      p_room_id:value.roomId,
      p_request_id:value.requestId,
      p_left_at:new Date(value.leftAt).toISOString(),
    }),
  });
}

export const RaidRoomStoreRows = Object.freeze({ roomRow, memberRow, eventRow });
