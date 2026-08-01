begin;

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.raid_rooms_v1 (
  id uuid primary key default extensions.gen_random_uuid(),
  invite_code text not null check (invite_code ~ '^[0-9]{4}$'),
  host_id uuid not null references auth.users(id) on delete cascade,
  floor_group smallint not null check (floor_group between 1 and 7),
  phase text not null default 'lobby' check (phase in (
    'lobby', 'travel', 'question', 'waiting', 'resolving', 'effects',
    'reconnect', 'cleared', 'wiped', 'cancelled'
  )),
  encounter_index smallint not null default 0 check (encounter_index between 0 and 20),
  current_floor smallint not null default 1 check (current_floor between 1 and 63),
  round_no integer not null default 0 check (round_no >= 0),
  monster_state jsonb not null default '{}'::jsonb check (
    jsonb_typeof(monster_state) = 'object'
    and octet_length(monster_state::text) <= 32768
  ),
  question_public jsonb check (
    question_public is null or (
      jsonb_typeof(question_public) = 'object'
      and octet_length(question_public::text) <= 8192
    )
  ),
  question_deadline timestamptz,
  resolution_started_at timestamptz,
  version bigint not null default 1 check (version >= 1),
  next_sequence bigint not null default 1 check (next_sequence >= 1),
  create_request_id text not null check (char_length(create_request_id) between 1 and 100),
  start_request_id text,
  last_begin_request_id text,
  last_publish_request_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  finished_at timestamptz,
  unique (host_id, create_request_id)
);

create unique index if not exists raid_rooms_v1_active_code_unique
  on public.raid_rooms_v1(invite_code)
  where phase in ('lobby', 'travel', 'question', 'waiting', 'resolving', 'effects', 'reconnect');

create table if not exists public.raid_room_members_v1 (
  room_id uuid not null references public.raid_rooms_v1(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  join_order smallint not null check (join_order between 1 and 3),
  slot text check (slot is null or slot in ('front', 'middle', 'back')),
  ready boolean not null default false,
  profile_snapshot jsonb not null check (
    jsonb_typeof(profile_snapshot) = 'object'
    and octet_length(profile_snapshot::text) <= 32768
  ),
  combat_state jsonb not null default '{}'::jsonb check (
    jsonb_typeof(combat_state) = 'object'
    and octet_length(combat_state::text) <= 32768
  ),
  join_request_id text not null check (char_length(join_request_id) between 1 and 100),
  active boolean not null default true,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (room_id, user_id)
);

create unique index if not exists raid_room_members_v1_one_active_room
  on public.raid_room_members_v1(user_id) where active;
create unique index if not exists raid_room_members_v1_active_join_order
  on public.raid_room_members_v1(room_id, join_order) where active;
create unique index if not exists raid_room_members_v1_active_slot
  on public.raid_room_members_v1(room_id, slot) where active and slot is not null;
create unique index if not exists raid_room_members_v1_join_request
  on public.raid_room_members_v1(user_id, join_request_id);

create table if not exists public.raid_question_secrets_v1 (
  room_id uuid primary key references public.raid_rooms_v1(id) on delete cascade,
  round_no integer not null check (round_no > 0),
  answer_key text not null check (char_length(answer_key) between 1 and 120),
  created_at timestamptz not null default now()
);

create table if not exists public.raid_round_inputs_v1 (
  room_id uuid not null references public.raid_rooms_v1(id) on delete cascade,
  round_no integer not null check (round_no > 0),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id text not null check (char_length(request_id) between 1 and 100),
  action_id text not null default 'basic' check (char_length(action_id) between 1 and 100),
  submitted_answer text not null default '' check (char_length(submitted_answer) <= 120),
  is_correct boolean not null,
  submitted_at timestamptz not null default now(),
  primary key (room_id, round_no, user_id),
  unique (user_id, request_id)
);

create table if not exists public.raid_events_v1 (
  room_id uuid not null references public.raid_rooms_v1(id) on delete cascade,
  sequence_no bigint not null check (sequence_no > 0),
  round_no integer not null check (round_no >= 0),
  event jsonb not null check (
    jsonb_typeof(event) = 'object'
    and octet_length(event::text) <= 8192
  ),
  created_at timestamptz not null default now(),
  primary key (room_id, sequence_no)
);

create table if not exists public.raid_join_attempts_v1 (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id text not null check (char_length(request_id) between 1 and 100),
  attempted_at timestamptz not null default now(),
  unique (user_id, request_id)
);
create index if not exists raid_join_attempts_v1_recent
  on public.raid_join_attempts_v1(user_id, attempted_at desc);

alter table public.raid_rooms_v1 enable row level security;
alter table public.raid_rooms_v1 force row level security;
alter table public.raid_room_members_v1 enable row level security;
alter table public.raid_room_members_v1 force row level security;
alter table public.raid_question_secrets_v1 enable row level security;
alter table public.raid_question_secrets_v1 force row level security;
alter table public.raid_round_inputs_v1 enable row level security;
alter table public.raid_round_inputs_v1 force row level security;
alter table public.raid_events_v1 enable row level security;
alter table public.raid_events_v1 force row level security;
alter table public.raid_join_attempts_v1 enable row level security;
alter table public.raid_join_attempts_v1 force row level security;

revoke all on table public.raid_rooms_v1 from anon, authenticated;
revoke all on table public.raid_room_members_v1 from anon, authenticated;
revoke all on table public.raid_question_secrets_v1 from anon, authenticated;
revoke all on table public.raid_round_inputs_v1 from anon, authenticated;
revoke all on table public.raid_events_v1 from anon, authenticated;
revoke all on table public.raid_join_attempts_v1 from anon, authenticated;

create or replace function public.private_is_raid_member_v1(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.raid_room_members_v1 as member
    where member.room_id = p_room_id
      and member.user_id = auth.uid()
      and member.active
  );
$$;
revoke all on function public.private_is_raid_member_v1(uuid) from public, anon;
grant execute on function public.private_is_raid_member_v1(uuid) to authenticated;

grant select on table public.raid_rooms_v1 to authenticated;
grant select on table public.raid_room_members_v1 to authenticated;
grant select on table public.raid_events_v1 to authenticated;

create policy "raid members read their room v1"
  on public.raid_rooms_v1 for select to authenticated
  using (public.private_is_raid_member_v1(id));
create policy "raid members read their party v1"
  on public.raid_room_members_v1 for select to authenticated
  using (public.private_is_raid_member_v1(room_id));
create policy "raid members read their events v1"
  on public.raid_events_v1 for select to authenticated
  using (public.private_is_raid_member_v1(room_id));

alter table public.raid_rooms_v1 replica identity full;
alter table public.raid_room_members_v1 replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.raid_rooms_v1;
exception when duplicate_object then null;
end
$$;
do $$
begin
  alter publication supabase_realtime add table public.raid_room_members_v1;
exception when duplicate_object then null;
end
$$;
do $$
begin
  alter publication supabase_realtime add table public.raid_events_v1;
exception when duplicate_object then null;
end
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
  if p_user_id is null or p_floor_group <> 1
    or jsonb_typeof(p_profile) is distinct from 'object'
    or octet_length(p_profile::text) > 32768
    or char_length(coalesce(p_request_id, '')) not between 1 and 100
  then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST';
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
     and expires_at > p_joined_at
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
         set last_seen_at = p_joined_at
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

create or replace function public.private_set_raid_formation_v1(
  p_user_id uuid,
  p_room_id uuid,
  p_assignments jsonb,
  p_request_id text,
  p_changed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_room public.raid_rooms_v1%rowtype;
  v_member_count integer;
  v_valid_count integer;
  v_assignment_count integer;
begin
  if p_user_id is null or p_room_id is null
    or jsonb_typeof(p_assignments) is distinct from 'object'
    or char_length(coalesce(p_request_id, '')) not between 1 and 100
  then
    raise exception using errcode = 'P0001', message = 'FORMATION_INVALID';
  end if;
  select count(*) into v_assignment_count from jsonb_object_keys(p_assignments);
  if v_assignment_count <> 3 then
    raise exception using errcode = 'P0001', message = 'FORMATION_INVALID';
  end if;
  select * into v_room from public.raid_rooms_v1 where id = p_room_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND'; end if;
  if v_room.host_id <> p_user_id then raise exception using errcode = 'P0001', message = 'HOST_ONLY'; end if;
  if v_room.phase <> 'lobby' then raise exception using errcode = 'P0001', message = 'ROOM_CLOSED'; end if;

  select count(*) into v_member_count from public.raid_room_members_v1
   where room_id = p_room_id and active;
  select count(*) into v_valid_count
    from public.raid_room_members_v1 as member
   where member.room_id = p_room_id and member.active
     and p_assignments ? member.user_id::text
     and (p_assignments ->> member.user_id::text) in ('front', 'middle', 'back');
  if v_member_count <> 3 or v_valid_count <> 3
    or (select count(distinct value) from jsonb_each_text(p_assignments)) <> 3
  then
    raise exception using errcode = 'P0001', message = 'FORMATION_INVALID';
  end if;

  update public.raid_room_members_v1 set slot = null, ready = false
   where room_id = p_room_id and active;
  update public.raid_room_members_v1 as member
     set slot = p_assignments ->> member.user_id::text
   where member.room_id = p_room_id and member.active;
  update public.raid_rooms_v1
     set version = version + 1, updated_at = p_changed_at
   where id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.private_set_raid_ready_v1(
  p_user_id uuid,
  p_room_id uuid,
  p_ready boolean,
  p_changed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_phase text;
begin
  select phase into v_phase from public.raid_rooms_v1 where id = p_room_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND'; end if;
  if v_phase <> 'lobby' then raise exception using errcode = 'P0001', message = 'ROOM_CLOSED'; end if;
  update public.raid_room_members_v1
     set ready = coalesce(p_ready, false), last_seen_at = p_changed_at
   where room_id = p_room_id and user_id = p_user_id and active;
  if not found then raise exception using errcode = 'P0001', message = 'NOT_MEMBER'; end if;
  update public.raid_rooms_v1 set version = version + 1, updated_at = p_changed_at
   where id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;

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
  update public.raid_rooms_v1 set
    phase = 'travel', start_request_id = p_request_id,
    encounter_index = 0, current_floor = 1, round_no = 0,
    expires_at = p_started_at + interval '2 hours',
    version = version + 1, updated_at = p_started_at
  where id = p_room_id;
  return jsonb_build_object('ok', true, 'recovered', false);
end;
$$;

create or replace function public.private_begin_raid_round_v1(
  p_user_id uuid,
  p_room_id uuid,
  p_question_public jsonb,
  p_answer_key text,
  p_request_id text,
  p_begun_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_room public.raid_rooms_v1%rowtype;
  v_round integer;
begin
  if jsonb_typeof(p_question_public) is distinct from 'object'
    or octet_length(p_question_public::text) > 8192
    or char_length(coalesce(p_answer_key, '')) not between 1 and 120
  then raise exception using errcode = 'P0001', message = 'INVALID_REQUEST'; end if;
  select * into v_room from public.raid_rooms_v1 where id = p_room_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND'; end if;
  if v_room.host_id <> p_user_id then raise exception using errcode = 'P0001', message = 'HOST_ONLY'; end if;
  if v_room.last_begin_request_id = p_request_id then
    return jsonb_build_object('ok', true, 'round', v_room.round_no, 'recovered', true);
  end if;
  if v_room.phase not in ('travel', 'effects') then
    raise exception using errcode = 'P0001', message = 'ROUND_CLOSED';
  end if;
  v_round := v_room.round_no + 1;
  update public.raid_rooms_v1 set
    phase = 'question', round_no = v_round,
    question_public = p_question_public,
    question_deadline = p_begun_at + interval '30 seconds',
    resolution_started_at = null,
    last_begin_request_id = p_request_id,
    version = version + 1, updated_at = p_begun_at
  where id = p_room_id;
  insert into public.raid_question_secrets_v1(room_id, round_no, answer_key, created_at)
  values (p_room_id, v_round, p_answer_key, p_begun_at)
  on conflict (room_id) do update set
    round_no = excluded.round_no, answer_key = excluded.answer_key, created_at = excluded.created_at;
  return jsonb_build_object('ok', true, 'round', v_round, 'recovered', false);
end;
$$;

create or replace function public.private_submit_raid_round_v1(
  p_user_id uuid,
  p_room_id uuid,
  p_round_no integer,
  p_action_id text,
  p_answer text,
  p_request_id text,
  p_submitted_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_room public.raid_rooms_v1%rowtype;
  v_answer_key text;
  v_member_count integer;
  v_input_count integer;
  v_prior public.raid_round_inputs_v1%rowtype;
  v_resolving boolean := false;
begin
  if p_round_no < 1 or char_length(coalesce(p_action_id, '')) not between 1 and 100
    or char_length(coalesce(p_answer, '')) > 120
    or char_length(coalesce(p_request_id, '')) not between 1 and 100
  then raise exception using errcode = 'P0001', message = 'INVALID_REQUEST'; end if;
  select * into v_room from public.raid_rooms_v1 where id = p_room_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND'; end if;
  if not exists (select 1 from public.raid_room_members_v1
    where room_id = p_room_id and user_id = p_user_id and active)
  then raise exception using errcode = 'P0001', message = 'NOT_MEMBER'; end if;
  select * into v_prior from public.raid_round_inputs_v1
   where user_id = p_user_id and request_id = p_request_id;
  if found then
    if v_prior.room_id <> p_room_id or v_prior.round_no <> p_round_no then
      raise exception using errcode = 'P0001', message = 'INVALID_REQUEST';
    end if;
    return jsonb_build_object(
      'waiting', v_room.phase <> 'resolving',
      'allSubmitted', v_room.phase = 'resolving',
      'recovered', true
    );
  end if;
  if v_room.round_no <> p_round_no then raise exception using errcode = 'P0001', message = 'ROUND_CHANGED'; end if;
  if v_room.phase not in ('question', 'waiting') then
    raise exception using errcode = 'P0001', message = 'ROUND_CLOSED';
  end if;
  select answer_key into v_answer_key from public.raid_question_secrets_v1
   where room_id = p_room_id and round_no = p_round_no;
  if not found then raise exception using errcode = 'P0001', message = 'ROUND_CLOSED'; end if;
  insert into public.raid_round_inputs_v1(
    room_id, round_no, user_id, request_id, action_id,
    submitted_answer, is_correct, submitted_at
  ) values (
    p_room_id, p_round_no, p_user_id, p_request_id, p_action_id,
    coalesce(p_answer, ''),
    lower(btrim(coalesce(p_answer, ''))) = lower(btrim(v_answer_key)),
    p_submitted_at
  )
  on conflict (room_id, round_no, user_id) do nothing;
  select count(*) into v_member_count from public.raid_room_members_v1
   where room_id = p_room_id and active;
  select count(*) into v_input_count from public.raid_round_inputs_v1
   where room_id = p_room_id and round_no = p_round_no;
  v_resolving := v_input_count >= v_member_count
    or coalesce(v_room.question_deadline, p_submitted_at) <= p_submitted_at;
  update public.raid_rooms_v1 set
    phase = case when v_resolving then 'resolving' else 'waiting' end,
    resolution_started_at = case when v_resolving then p_submitted_at else null end,
    version = version + 1, updated_at = p_submitted_at
  where id = p_room_id;
  return jsonb_build_object(
    'waiting', not v_resolving,
    'allSubmitted', v_resolving,
    'submittedCount', v_input_count,
    'requiredCount', v_member_count,
    'recovered', false
  );
end;
$$;

create or replace function public.private_publish_raid_round_v1(
  p_user_id uuid,
  p_room_id uuid,
  p_round_no integer,
  p_result jsonb,
  p_request_id text,
  p_published_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_room public.raid_rooms_v1%rowtype;
  v_phase text;
  v_event_count integer;
begin
  if jsonb_typeof(p_result) is distinct from 'object'
    or octet_length(p_result::text) > 98304
    or jsonb_typeof(coalesce(p_result -> 'events', '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_result -> 'events', '[]'::jsonb)) > 100
    or jsonb_typeof(coalesce(p_result -> 'memberStates', '{}'::jsonb)) <> 'object'
  then raise exception using errcode = 'P0001', message = 'INVALID_REQUEST'; end if;
  v_phase := p_result ->> 'nextPhase';
  if v_phase is null or v_phase not in ('effects', 'travel', 'cleared', 'wiped', 'cancelled') then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST';
  end if;
  select * into v_room from public.raid_rooms_v1 where id = p_room_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND'; end if;
  if v_room.host_id <> p_user_id then raise exception using errcode = 'P0001', message = 'HOST_ONLY'; end if;
  if v_room.last_publish_request_id = p_request_id then
    return jsonb_build_object('ok', true, 'recovered', true);
  end if;
  if v_room.round_no <> p_round_no then raise exception using errcode = 'P0001', message = 'ROUND_CHANGED'; end if;
  if v_room.phase <> 'resolving' then raise exception using errcode = 'P0001', message = 'ROUND_CLOSED'; end if;
  if exists (
    select 1 from jsonb_object_keys(p_result -> 'memberStates') as supplied(user_id)
     where not exists (
       select 1 from public.raid_room_members_v1 as member
        where member.room_id = p_room_id and member.active
          and member.user_id::text = supplied.user_id
     )
  ) then raise exception using errcode = 'P0001', message = 'INVALID_REQUEST'; end if;

  update public.raid_room_members_v1 as member set
    combat_state = coalesce(p_result -> 'memberStates' -> member.user_id::text, member.combat_state)
  where member.room_id = p_room_id and member.active;

  insert into public.raid_events_v1(room_id, sequence_no, round_no, event, created_at)
  select p_room_id, v_room.next_sequence + event_row.ordinality - 1,
         p_round_no, event_row.value, p_published_at
    from jsonb_array_elements(coalesce(p_result -> 'events', '[]'::jsonb))
         with ordinality as event_row(value, ordinality);
  get diagnostics v_event_count = row_count;

  update public.raid_rooms_v1 set
    phase = v_phase,
    encounter_index = greatest(0, least(20, coalesce((p_result ->> 'encounterIndex')::integer, encounter_index))),
    current_floor = greatest(1, least(63, coalesce((p_result ->> 'currentFloor')::integer, current_floor))),
    monster_state = coalesce(p_result -> 'monsterState', monster_state),
    question_public = null,
    question_deadline = null,
    resolution_started_at = null,
    next_sequence = next_sequence + v_event_count,
    last_publish_request_id = p_request_id,
    version = version + 1,
    updated_at = p_published_at,
    finished_at = case when v_phase in ('cleared', 'wiped', 'cancelled')
      then p_published_at else finished_at end
  where id = p_room_id;
  delete from public.raid_question_secrets_v1 where room_id = p_room_id;
  return jsonb_build_object('ok', true, 'recovered', false, 'eventCount', v_event_count);
end;
$$;

create or replace function public.private_heartbeat_raid_room_v1(
  p_user_id uuid,
  p_room_id uuid,
  p_seen_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_room public.raid_rooms_v1%rowtype;
begin
  update public.raid_room_members_v1 set last_seen_at = p_seen_at
   where room_id = p_room_id and user_id = p_user_id and active;
  if not found then raise exception using errcode = 'P0001', message = 'NOT_MEMBER'; end if;
  select * into v_room from public.raid_rooms_v1 where id = p_room_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND'; end if;
  if v_room.phase in ('question', 'waiting')
    and v_room.question_deadline is not null
    and v_room.question_deadline <= p_seen_at
  then
    update public.raid_rooms_v1 set
      phase = 'resolving', resolution_started_at = p_seen_at,
      version = version + 1, updated_at = p_seen_at
    where id = p_room_id;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.private_leave_raid_room_v1(
  p_user_id uuid,
  p_room_id uuid,
  p_request_id text,
  p_left_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_room public.raid_rooms_v1%rowtype;
  v_remaining integer;
  v_next_host uuid;
begin
  select * into v_room from public.raid_rooms_v1 where id = p_room_id for update;
  if not found then return jsonb_build_object('ok', true, 'closed', true); end if;
  if not exists (select 1 from public.raid_room_members_v1
    where room_id = p_room_id and user_id = p_user_id and active)
  then return jsonb_build_object('ok', true, 'recovered', true); end if;

  update public.raid_room_members_v1 set
    active = false, ready = false, slot = null, left_at = p_left_at
  where room_id = p_room_id and user_id = p_user_id;
  select count(*) into v_remaining from public.raid_room_members_v1
   where room_id = p_room_id and active;

  if v_room.phase = 'lobby' then
    if v_remaining = 0 then
      update public.raid_rooms_v1 set
        phase = 'cancelled', finished_at = p_left_at,
        version = version + 1, updated_at = p_left_at
      where id = p_room_id;
    elsif v_room.host_id = p_user_id then
      select user_id into v_next_host from public.raid_room_members_v1
       where room_id = p_room_id and active order by join_order limit 1;
      update public.raid_rooms_v1 set
        host_id = v_next_host, version = version + 1, updated_at = p_left_at
      where id = p_room_id;
    else
      update public.raid_rooms_v1 set version = version + 1, updated_at = p_left_at
       where id = p_room_id;
    end if;
  elsif v_room.phase not in ('cleared', 'wiped', 'cancelled') then
    insert into public.raid_events_v1(room_id, sequence_no, round_no, event, created_at)
    values (
      p_room_id, v_room.next_sequence, v_room.round_no,
      jsonb_build_object('kind', 'party-cancelled', 'userId', p_user_id), p_left_at
    );
    update public.raid_rooms_v1 set
      phase = 'cancelled', finished_at = p_left_at,
      next_sequence = next_sequence + 1,
      version = version + 1, updated_at = p_left_at
    where id = p_room_id;
  end if;
  return jsonb_build_object('ok', true, 'remaining', v_remaining);
end;
$$;

revoke all on function public.private_create_raid_room_v1(uuid, smallint, jsonb, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.private_join_raid_room_v1(uuid, text, jsonb, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.private_set_raid_formation_v1(uuid, uuid, jsonb, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.private_set_raid_ready_v1(uuid, uuid, boolean, timestamptz)
  from public, anon, authenticated;
revoke all on function public.private_start_raid_room_v1(uuid, uuid, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.private_begin_raid_round_v1(uuid, uuid, jsonb, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.private_submit_raid_round_v1(uuid, uuid, integer, text, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.private_publish_raid_round_v1(uuid, uuid, integer, jsonb, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.private_heartbeat_raid_room_v1(uuid, uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.private_leave_raid_room_v1(uuid, uuid, text, timestamptz)
  from public, anon, authenticated;

grant execute on function public.private_create_raid_room_v1(uuid, smallint, jsonb, text, timestamptz) to service_role;
grant execute on function public.private_join_raid_room_v1(uuid, text, jsonb, text, timestamptz) to service_role;
grant execute on function public.private_set_raid_formation_v1(uuid, uuid, jsonb, text, timestamptz) to service_role;
grant execute on function public.private_set_raid_ready_v1(uuid, uuid, boolean, timestamptz) to service_role;
grant execute on function public.private_start_raid_room_v1(uuid, uuid, text, timestamptz) to service_role;
grant execute on function public.private_begin_raid_round_v1(uuid, uuid, jsonb, text, text, timestamptz) to service_role;
grant execute on function public.private_submit_raid_round_v1(uuid, uuid, integer, text, text, text, timestamptz) to service_role;
grant execute on function public.private_publish_raid_round_v1(uuid, uuid, integer, jsonb, text, timestamptz) to service_role;
grant execute on function public.private_heartbeat_raid_room_v1(uuid, uuid, timestamptz) to service_role;
grant execute on function public.private_leave_raid_room_v1(uuid, uuid, text, timestamptz) to service_role;

commit;
