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
    teacherPaused:row.phase === 'paused',
    teacherPausedPhase:row.teacher_paused_phase || null,
    teacherPausedRemainingMs:row.teacher_paused_remaining_ms == null
      ? null
      : Math.max(0, Number(row.teacher_paused_remaining_ms) || 0),
    teacherPausedAt:row.teacher_paused_at ? new Date(row.teacher_paused_at).getTime() : 0,
    encounterIndex:Number(row.encounter_index) || 0,
    currentFloor:Number(row.current_floor) || 1,
    round:Number(row.round_no) || 0,
    teacherKillRound:Math.max(0, Number(row.teacher_kill_round) || 0),
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
    questionReadyRound:Math.max(0, Number(row.question_ready_round) || 0),
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

function safeInteger(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isFinite(number)) return minimum;
  return Math.max(minimum, Math.min(maximum, Math.trunc(number)));
}

const RAID_NAMEPLATE_REWARDS = Object.freeze({
  2:Object.freeze({
    id:'raid_20_steel', floorGroup:2, floorLabel:'20층',
    questTitle:'[파티] 함께 오른 스무 층', name:'강철 승강기 이름표',
  }),
  4:Object.freeze({
    id:'raid_40_twilight', floorGroup:4, floorLabel:'40층',
    questTitle:'[파티] 빌딩의 허리를 넘어서', name:'황혼의 창 이름표',
  }),
  7:Object.freeze({
    id:'raid_63_summit', floorGroup:7, floorLabel:'63층',
    questTitle:'[파티] 육삼의 정상', name:'육삼 정상 이름표',
  }),
});
const RAID_NAMEPLATE_IDS = Object.freeze(Object.values(RAID_NAMEPLATE_REWARDS).map((entry) => entry.id));

function safeRaidNameplates(value) {
  const requested = new Set(Array.isArray(value) ? value.map((item) => String(item || '')) : []);
  return RAID_NAMEPLATE_IDS.filter((id) => requested.has(id));
}

function raidCompletion(claim, profileData, progress, roomId, floorGroup) {
  const data = profileData && typeof profileData === 'object' && !Array.isArray(profileData)
    ? profileData
    : {};
  const currentRoomAward = !!claim
    && claim.legacy_assumed_paid !== true
    && String(claim.source_room_id || '') === String(roomId || '');
  const reward = currentRoomAward ? {
    exp:safeInteger(claim.exp_reward),
    gold:safeInteger(claim.gold_reward),
    building:safeInteger(claim.building_reward),
  } : { exp:0, gold:0, building:0 };
  const safeFloorGroup = safeInteger(floorGroup, 1, 7);
  const ownedNameplates = safeRaidNameplates(data.raidNameplates ?? data.raid_nameplates);
  const requestedTheme = String(data.nameplate?.theme || 'default');
  const equippedTheme = requestedTheme === 'default' || ownedNameplates.includes(requestedTheme)
    ? requestedTheme
    : 'default';
  const nameplateReward = currentRoomAward ? RAID_NAMEPLATE_REWARDS[safeFloorGroup] || null : null;
  return {
    roomId:String(roomId || ''),
    floorGroup:safeFloorGroup,
    awarded:currentRoomAward,
    firstClear:currentRoomAward,
    reward,
    nameplateReward:nameplateReward ? { ...nameplateReward } : null,
    levelGain:currentRoomAward ? safeInteger(claim.level_gain, 0, 9) : 0,
    fullyHealed:currentRoomAward && claim.fully_healed === true,
    player:{
      exp:safeInteger(data.exp),
      gold:safeInteger(data.gold),
      building:safeInteger(data.building),
      level:safeInteger(data.level, 1, 10),
      skillPoints:safeInteger(data.skillPoints),
      hp:safeInteger(data.hp),
      maxHp:safeInteger(data.maxHp, 1, 100000),
      raidTopGroup:safeInteger(progress?.top_group, 0, 7),
      raidRewardVersion:safeInteger(data.raidRewardVersion, 0, 7),
      raidNameplates:ownedNameplates,
      nameplate:{ theme:equippedTheme },
      fullyHealed:currentRoomAward && claim.fully_healed === true,
    },
  };
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

    async getRaidCompletion(roomId, userId, floorGroup) {
      const safeFloorGroup = safeInteger(floorGroup, 1, 7);
      const [claimResult, profileResult, progressResult] = await Promise.all([
        client.from('raid_reward_claims_v1')
          .select('source_room_id,exp_reward,gold_reward,building_reward,level_gain,fully_healed,legacy_assumed_paid')
          .eq('user_id', userId).eq('floor_group', safeFloorGroup).maybeSingle(),
        client.from('player_profiles_v2')
          .select('data').eq('user_id', userId).maybeSingle(),
        client.from('raid_progress_v1')
          .select('top_group').eq('user_id', userId).maybeSingle(),
      ]);
      const claim = check(claimResult);
      const profile = check(profileResult);
      const progress = check(progressResult);
      if (!profile) return null;
      return raidCompletion(claim, profile.data, progress, roomId, safeFloorGroup);
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

    ackQuestionReady:value => rpc('private_ack_raid_question_ready_v1', {
      p_user_id:value.userId,
      p_room_id:value.roomId,
      p_round_no:value.round,
      p_ready_at:new Date(value.readyAt).toISOString(),
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

export const RaidRoomStoreRows = Object.freeze({ roomRow, memberRow, eventRow, raidCompletion });
