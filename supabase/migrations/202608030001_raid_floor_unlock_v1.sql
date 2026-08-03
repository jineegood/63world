-- 63빌딩 던전 구간 해금
--
-- 지금까지는 1구간(1–10층)만 만들 수 있었다(p_floor_group <> 1).
-- 이제 앞 구간을 깬 사람만 다음 구간을 열 수 있게 바꾼다.
--
-- 판단 기준은 각자의 프로필 스냅샷에 담긴 raidTopGroup(깬 구간 중 최고 번호)이다.
--   raidTopGroup 0 -> 1구간까지, 1 -> 2구간까지 …
-- 1구간은 언제나 열려 있다.
--
-- 출발(start)에서는 방에 있는 셋 모두를 확인한다.
-- 한 명이라도 못 열었으면 FLOOR_LOCKED로 막는다.

-- 프로필 스냅샷에서 "들어갈 수 있는 최고 구간"을 읽는다.
create or replace function public.private_raid_unlocked_group_v1(p_profile jsonb)
returns integer
language sql
immutable
set search_path = pg_catalog, public
as $$
  select least(7, greatest(0, least(7, coalesce(
    nullif(p_profile ->> 'raidTopGroup', '')::integer, 0
  ))) + 1);
$$;

create or replace function public.private_create_raid_room_v1(
  p_user_id uuid,
  p_floor_group smallint,
  p_profile jsonb,
  p_request_id text,
  p_created_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_room public.raid_rooms_v1%rowtype;
  v_code text;
  v_try integer;
begin
  if p_user_id is null or p_floor_group not between 1 and 7
    or jsonb_typeof(p_profile) is distinct from 'object'
    or octet_length(p_profile::text) > 32768
    or char_length(coalesce(p_request_id, '')) not between 1 and 100
  then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST';
  end if;

  -- 앞 구간을 깨야 다음 구간의 방을 만들 수 있다.
  if p_floor_group > public.private_raid_unlocked_group_v1(p_profile) then
    raise exception using errcode = 'P0001', message = 'FLOOR_LOCKED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('raid-user:' || p_user_id::text, 0));

  update public.raid_rooms_v1
     set phase = 'cancelled', finished_at = p_created_at, updated_at = p_created_at
   where phase = 'lobby' and expires_at <= p_created_at;
  update public.raid_room_members_v1 as member
     set active = false, left_at = coalesce(member.left_at, p_created_at)
    from public.raid_rooms_v1 as room
   where member.room_id = room.id and member.active
     and room.phase in ('cleared', 'wiped', 'cancelled');

  select * into v_room
    from public.raid_rooms_v1
   where host_id = p_user_id and create_request_id = p_request_id
   limit 1;
  if found then
    return jsonb_build_object('room_id', v_room.id, 'recovered', true);
  end if;

  if exists (
    select 1 from public.raid_room_members_v1
     where user_id = p_user_id and active
  ) then
    raise exception using errcode = 'P0001', message = 'ALREADY_IN_ROOM';
  end if;

  for v_try in 1..40 loop
    v_code := (1000 + (
      (get_byte(extensions.gen_random_bytes(2), 0) * 256
       + get_byte(extensions.gen_random_bytes(2), 1)) % 9000
    ))::text;
    begin
      insert into public.raid_rooms_v1(
        invite_code, host_id, floor_group, current_floor,
        create_request_id, created_at, updated_at, expires_at
      ) values (
        v_code, p_user_id, p_floor_group, 1,
        p_request_id, p_created_at, p_created_at, p_created_at + interval '30 minutes'
      ) returning * into v_room;
      exit;
    exception when unique_violation then
      v_room := null;
    end;
  end loop;
  if v_room.id is null then
    raise exception using errcode = 'P0001', message = 'TEMPORARY_UNAVAILABLE';
  end if;

  insert into public.raid_room_members_v1(
    room_id, user_id, join_order, profile_snapshot, combat_state,
    join_request_id, joined_at, last_seen_at
  ) values (
    v_room.id, p_user_id, 1, p_profile,
    jsonb_build_object(
      'hp', greatest(1, coalesce((p_profile ->> 'maxHp')::integer, 1)),
      'maxHp', greatest(1, coalesce((p_profile ->> 'maxHp')::integer, 1)),
      'shield', 0, 'cooldowns', '{}'::jsonb, 'statuses', '{}'::jsonb
    ),
    p_request_id, p_created_at, p_created_at
  );

  return jsonb_build_object('room_id', v_room.id, 'recovered', false);
end;
$$;

-- 출발할 때 셋 모두 이 구간을 열었는지 확인한다.
create or replace function public.private_start_raid_room_v1(
  p_user_id uuid,
  p_room_id uuid,
  p_request_id text,
  p_started_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_room public.raid_rooms_v1%rowtype;
  v_count integer;
  v_ready integer;
  v_slots integer;
  v_locked integer;
  v_start_floor integer;
begin
  select * into v_room from public.raid_rooms_v1 where id = p_room_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND'; end if;
  if v_room.host_id <> p_user_id then raise exception using errcode = 'P0001', message = 'HOST_ONLY'; end if;
  if v_room.start_request_id = p_request_id and v_room.phase <> 'lobby' then
    return jsonb_build_object('ok', true, 'recovered', true);
  end if;
  if v_room.phase <> 'lobby' then raise exception using errcode = 'P0001', message = 'ROOM_CLOSED'; end if;

  select count(*), count(*) filter (where ready), count(distinct slot)
    into v_count, v_ready, v_slots
    from public.raid_room_members_v1
   where room_id = p_room_id and active;
  if v_count <> 3 then raise exception using errcode = 'P0001', message = 'PARTY_INCOMPLETE'; end if;
  if v_slots <> 3 then raise exception using errcode = 'P0001', message = 'FORMATION_INVALID'; end if;
  if v_ready <> 3 then raise exception using errcode = 'P0001', message = 'NOT_READY'; end if;

  select count(*) into v_locked
    from public.raid_room_members_v1
   where room_id = p_room_id and active
     and v_room.floor_group > public.private_raid_unlocked_group_v1(profile_snapshot);
  if v_locked > 0 then raise exception using errcode = 'P0001', message = 'FLOOR_LOCKED'; end if;

  -- 구간마다 시작 층이 다르다. 1구간은 1층, 2구간은 11층 …
  v_start_floor := greatest(1, least(63, (v_room.floor_group - 1) * 10 + 1));

  update public.raid_rooms_v1 set
    phase = 'travel', start_request_id = p_request_id,
    encounter_index = 0, current_floor = v_start_floor, round_no = 0,
    expires_at = p_started_at + interval '2 hours',
    version = version + 1, updated_at = p_started_at
  where id = p_room_id;
  return jsonb_build_object('ok', true, 'recovered', false);
end;
$$;
