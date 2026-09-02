begin;

-- A raid is stale only when neither the room nor any active member has done
-- anything for thirty minutes.  created_at/expires_at cannot express this:
-- a healthy thirty-minute run may be much older than its creation time.
create index if not exists raid_rooms_v1_open_updated_at_idx
  on public.raid_rooms_v1(updated_at)
  where phase in (
    'lobby', 'travel', 'question', 'waiting', 'resolving', 'effects',
    'reconnect', 'paused'
  );

create index if not exists raid_room_members_v1_active_activity_idx
  on public.raid_room_members_v1(room_id, last_seen_at desc)
  where active;

create or replace function public.private_expire_idle_raid_rooms_v1(
  p_checked_at timestamptz,
  p_room_id uuid default null,
  p_user_id uuid default null,
  p_invite_code text default null,
  p_all boolean default false
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_checked_at timestamptz := coalesce(p_checked_at, clock_timestamp());
  v_cutoff timestamptz;
  v_expired_ids uuid[] := array[]::uuid[];
begin
  if not coalesce(p_all, false)
    and p_room_id is null
    and p_user_id is null
    and nullif(p_invite_code, '') is null
  then
    return 0;
  end if;

  v_cutoff := v_checked_at - interval '30 minutes';

  with expired as (
    update public.raid_rooms_v1 as room
       set phase = 'cancelled',
           question_public = null,
           question_deadline = null,
           resolution_started_at = null,
           finished_at = coalesce(room.finished_at, v_checked_at),
           expires_at = least(room.expires_at, v_checked_at),
           version = room.version + 1,
           updated_at = v_checked_at
     where room.phase in (
       'lobby', 'travel', 'question', 'waiting', 'resolving', 'effects',
       'reconnect', 'paused'
     )
       and room.updated_at <= v_cutoff
       and not exists (
         select 1
           from public.raid_room_members_v1 as active_member
          where active_member.room_id = room.id
            and active_member.active
            and active_member.last_seen_at > v_cutoff
       )
       and (
         coalesce(p_all, false)
         or (
           p_room_id is not null
           and room.id = p_room_id
           and (
             p_user_id is null
             or exists (
               select 1
                 from public.raid_room_members_v1 as scoped_member
                where scoped_member.room_id = room.id
                  and scoped_member.user_id = p_user_id
                  and scoped_member.active
             )
           )
         )
         or (nullif(p_invite_code, '') is not null and room.invite_code = p_invite_code)
         or (
           p_user_id is not null
           and exists (
             select 1
               from public.raid_room_members_v1 as scoped_member
              where scoped_member.room_id = room.id
                and scoped_member.user_id = p_user_id
                and scoped_member.active
           )
         )
       )
    returning room.id
  )
  select coalesce(array_agg(expired.id), array[]::uuid[])
    into v_expired_ids
    from expired;

  if cardinality(v_expired_ids) > 0 then
    update public.raid_room_members_v1
       set active = false,
           ready = false,
           slot = null,
           left_at = coalesce(left_at, v_checked_at)
     where active
       and room_id = any(v_expired_ids);

    delete from public.raid_question_secrets_v1
     where room_id = any(v_expired_ids);
  end if;

  return cardinality(v_expired_ids);
end;
$$;

revoke all on function public.private_expire_idle_raid_rooms_v1(
  timestamptz, uuid, uuid, text, boolean
) from public, anon, authenticated;
grant execute on function public.private_expire_idle_raid_rooms_v1(
  timestamptz, uuid, uuid, text, boolean
) to service_role;

-- Creating a room is also the low-frequency global garbage-collection point.
-- Unlike the old implementation, it never closes an active lobby merely
-- because thirty minutes passed since the lobby was created.
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

  if p_floor_group > public.private_raid_unlocked_group_v1(p_profile) then
    raise exception using errcode = 'P0001', message = 'FLOOR_LOCKED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('raid-user:' || p_user_id::text, 0));
  perform public.private_expire_idle_raid_rooms_v1(
    p_created_at, null, p_user_id, null, true
  );

  -- A terminal room must never be a resume target or block this user from a
  -- fresh room.  Other members stay active long enough to read their result.
  update public.raid_room_members_v1 as member
     set active = false,
         ready = false,
         slot = null,
         left_at = coalesce(member.left_at, p_created_at)
    from public.raid_rooms_v1 as room
   where member.room_id = room.id
     and member.user_id = p_user_id
     and member.active
     and room.phase in ('cleared', 'wiped', 'cancelled');

  select * into v_room
    from public.raid_rooms_v1
   where host_id = p_user_id and create_request_id = p_request_id
   limit 1;
  if found then
    if v_room.phase in ('cleared', 'wiped', 'cancelled') then
      return jsonb_build_object('error', 'ROOM_CLOSED');
    end if;
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

create or replace function public.private_join_raid_room_v1(
  p_user_id uuid,
  p_invite_code text,
  p_profile jsonb,
  p_request_id text,
  p_joined_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_room public.raid_rooms_v1%rowtype;
  v_existing public.raid_room_members_v1%rowtype;
  v_member_count integer;
  v_join_order integer;
  v_attempt_count integer;
begin
  if p_user_id is null or p_invite_code !~ '^[0-9]{4}$'
    or jsonb_typeof(p_profile) is distinct from 'object'
    or octet_length(p_profile::text) > 32768
    or char_length(coalesce(p_request_id, '')) not between 1 and 100
  then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('raid-user:' || p_user_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('raid-code:' || p_invite_code, 0));
  perform public.private_expire_idle_raid_rooms_v1(
    p_joined_at, null, p_user_id, p_invite_code, false
  );

  update public.raid_room_members_v1 as member
     set active = false,
         ready = false,
         slot = null,
         left_at = coalesce(member.left_at, p_joined_at)
    from public.raid_rooms_v1 as room
   where member.room_id = room.id
     and member.user_id = p_user_id
     and member.active
     and room.phase in ('cleared', 'wiped', 'cancelled');

  delete from public.raid_join_attempts_v1
   where attempted_at < p_joined_at - interval '10 minutes';
  insert into public.raid_join_attempts_v1(user_id, request_id, attempted_at)
  values (p_user_id, p_request_id, p_joined_at)
  on conflict (user_id, request_id) do nothing;
  select count(*) into v_attempt_count
    from public.raid_join_attempts_v1
   where user_id = p_user_id
     and attempted_at >= p_joined_at - interval '1 minute';
  if v_attempt_count > 10 then
    return jsonb_build_object('error', 'JOIN_RATE_LIMIT');
  end if;

  select * into v_room
    from public.raid_rooms_v1
   where invite_code = p_invite_code
     and phase = 'lobby'
   limit 1
   for update;
  if not found then
    return jsonb_build_object('error', 'ROOM_NOT_FOUND');
  end if;

  select * into v_existing
    from public.raid_room_members_v1
   where user_id = p_user_id and active
   limit 1
   for update;
  if found then
    if v_existing.room_id = v_room.id then
      update public.raid_room_members_v1
         set last_seen_at = greatest(last_seen_at, p_joined_at)
       where room_id = v_room.id and user_id = p_user_id;
      return jsonb_build_object('room_id', v_room.id, 'recovered', true);
    end if;
    raise exception using errcode = 'P0001', message = 'ALREADY_IN_ROOM';
  end if;

  select count(*) into v_member_count
    from public.raid_room_members_v1
   where room_id = v_room.id and active;
  if v_member_count >= 3 then
    raise exception using errcode = 'P0001', message = 'ROOM_FULL';
  end if;
  select candidate into v_join_order
    from generate_series(1, 3) as candidate
   where not exists (
     select 1 from public.raid_room_members_v1
      where room_id = v_room.id and active and join_order = candidate
   )
   order by candidate
   limit 1;

  insert into public.raid_room_members_v1(
    room_id, user_id, join_order, profile_snapshot, combat_state,
    join_request_id, active, joined_at, last_seen_at, left_at
  ) values (
    v_room.id, p_user_id, v_join_order, p_profile,
    jsonb_build_object(
      'hp', greatest(1, coalesce((p_profile ->> 'maxHp')::integer, 1)),
      'maxHp', greatest(1, coalesce((p_profile ->> 'maxHp')::integer, 1)),
      'shield', 0, 'cooldowns', '{}'::jsonb, 'statuses', '{}'::jsonb
    ),
    p_request_id, true, p_joined_at, p_joined_at, null
  )
  on conflict (room_id, user_id) do update set
    join_order = excluded.join_order,
    profile_snapshot = excluded.profile_snapshot,
    combat_state = excluded.combat_state,
    join_request_id = excluded.join_request_id,
    active = true,
    ready = false,
    slot = null,
    joined_at = excluded.joined_at,
    last_seen_at = excluded.last_seen_at,
    left_at = null;

  update public.raid_rooms_v1
     set version = version + 1, updated_at = p_joined_at
   where id = v_room.id;
  return jsonb_build_object('room_id', v_room.id, 'recovered', false);
end;
$$;

revoke all on function public.private_create_raid_room_v1(
  uuid, smallint, jsonb, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.private_join_raid_room_v1(
  uuid, text, jsonb, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.private_create_raid_room_v1(
  uuid, smallint, jsonb, text, timestamptz
) to service_role;
grant execute on function public.private_join_raid_room_v1(
  uuid, text, jsonb, text, timestamptz
) to service_role;

-- Clean legacy day-old rooms immediately when this migration is applied.
select public.private_expire_idle_raid_rooms_v1(
  clock_timestamp(), null, null, null, true
);

commit;
