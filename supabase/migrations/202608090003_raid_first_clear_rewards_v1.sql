begin;

-- One durable receipt per character and floor group.  Clients cannot create,
-- change, or read other students' receipts; the raid service reads them with
-- the service role and returns only the authenticated student's completion.
create table if not exists public.raid_reward_claims_v1 (
  user_id uuid not null references auth.users(id) on delete cascade,
  floor_group smallint not null check (floor_group between 1 and 7),
  source_room_id uuid not null,
  exp_reward integer not null check (exp_reward between 0 and 1000000),
  gold_reward integer not null check (gold_reward between 0 and 1000000),
  building_reward integer not null check (building_reward between 0 and 1000000),
  level_gain smallint not null default 0 check (level_gain between 0 and 9),
  fully_healed boolean not null default false,
  legacy_assumed_paid boolean not null default false,
  earned_at timestamptz not null,
  applied_at timestamptz not null,
  primary key (user_id, floor_group)
);

create index if not exists raid_reward_claims_v1_room_idx
  on public.raid_reward_claims_v1(source_room_id);

alter table public.raid_reward_claims_v1 enable row level security;
alter table public.raid_reward_claims_v1 force row level security;
revoke all on table public.raid_reward_claims_v1 from public, anon, authenticated;
grant select, insert, update on table public.raid_reward_claims_v1 to service_role;

-- Profile JSON is still the live character store.  Treat malformed or tampered
-- resource fields as zero instead of allowing one bad profile to abort a clear
-- for all three party members.
create or replace function public.private_raid_profile_int_v1(
  p_data jsonb,
  p_key text,
  p_max bigint default 2147483647
)
returns bigint
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_value numeric;
begin
  if jsonb_typeof(coalesce(p_data, '{}'::jsonb) -> p_key) is distinct from 'number' then
    return 0;
  end if;
  begin
    v_value := trunc((p_data ->> p_key)::numeric);
  exception when others then
    return 0;
  end;
  return least(greatest(coalesce(p_max, 0), 0)::numeric, greatest(v_value, 0))::bigint;
end;
$$;

create or replace function public.private_raid_level_for_exp_v1(p_exp bigint)
returns smallint
language sql
immutable
set search_path = pg_catalog, public
as $$
  select (case
    when coalesce(p_exp, 0) >= 580 then 10
    when coalesce(p_exp, 0) >= 470 then 9
    when coalesce(p_exp, 0) >= 370 then 8
    when coalesce(p_exp, 0) >= 280 then 7
    when coalesce(p_exp, 0) >= 200 then 6
    when coalesce(p_exp, 0) >= 130 then 5
    when coalesce(p_exp, 0) >= 80 then 4
    when coalesce(p_exp, 0) >= 40 then 3
    when coalesce(p_exp, 0) >= 10 then 2
    else 1
  end)::smallint;
$$;

-- Close the deployment boundary: every clear committed before this lock is a
-- legacy clear below; every later clear runs the replacement trigger below.
lock table public.raid_rooms_v1 in share row exclusive mode;

-- Old clients already added their rewards locally.  There is no trustworthy
-- receipt that says which of those saves reached the server, so historical
-- clears are recorded as paid without adding resources again.  A lobby member
-- who left before the clear is excluded by comparing left_at with finished_at.
with first_legacy_clear as (
  select distinct on (member.user_id, room.floor_group)
         member.user_id,
         room.floor_group,
         room.id as source_room_id,
         room.finished_at as earned_at
    from public.raid_rooms_v1 room
    join public.raid_room_members_v1 member on member.room_id = room.id
   where room.phase = 'cleared'
     and room.finished_at is not null
     and (member.left_at is null or member.left_at >= room.finished_at)
   order by member.user_id, room.floor_group, room.finished_at, room.id
)
insert into public.raid_reward_claims_v1(
  user_id, floor_group, source_room_id,
  exp_reward, gold_reward, building_reward,
  level_gain, fully_healed, legacy_assumed_paid,
  earned_at, applied_at
)
select legacy.user_id,
       legacy.floor_group,
       legacy.source_room_id,
       case legacy.floor_group
         when 1 then 40 when 2 then 60 when 3 then 85 when 4 then 115
         when 5 then 150 when 6 then 200 when 7 then 300
       end,
       case legacy.floor_group
         when 1 then 90 when 2 then 120 when 3 then 150 when 4 then 190
         when 5 then 230 when 6 then 280 when 7 then 400
       end,
       case legacy.floor_group
         when 1 then 10 when 2 then 13 when 3 then 16 when 4 then 20
         when 5 then 24 when 6 then 29 when 7 then 40
       end,
       0, false, true,
       legacy.earned_at, legacy.earned_at
  from first_legacy_clear legacy
on conflict (user_id, floor_group) do nothing;

-- raidRewardVersion is a server-owned monotonic receipt marker.  Backfill it
-- from the durable claim rows (including legacy assumed-paid claims) so a
-- profile save that was already in flight before this migration cannot later
-- erase a reward that the server has committed.
update public.player_profiles_v2 profile
   set data = jsonb_set(
     coalesce(profile.data, '{}'::jsonb) - 'raid_reward_version',
     '{raidRewardVersion}',
     to_jsonb(least(7, (
       select count(*)
         from public.raid_reward_claims_v1 claim
        where claim.user_id = profile.user_id
     ))::integer),
     true
   );

-- The existing guard already owns raidTopGroup.  It now also owns the reward
-- receipt marker and protects canonical resources from an older client save.
-- A current server reward update carries the freshly incremented marker, so it
-- is allowed through; a stale browser payload carries a lower (or no) marker.
create or replace function public.private_guard_raid_progress_profile_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_top_group integer := 0;
  v_reward_version integer := 0;
  v_incoming_reward_version integer := 0;
  v_resource_key text;
begin
  select progress.top_group into v_top_group
    from public.raid_progress_v1 progress
   where progress.user_id = new.user_id;
  v_top_group := coalesce(v_top_group, 0);

  select least(7, count(*))::integer into v_reward_version
    from public.raid_reward_claims_v1 claim
   where claim.user_id = new.user_id;
  v_reward_version := coalesce(v_reward_version, 0);
  v_incoming_reward_version := public.private_raid_profile_int_v1(
    coalesce(new.data, '{}'::jsonb),
    'raidRewardVersion',
    7
  )::integer;

  if tg_op = 'UPDATE' and v_incoming_reward_version < v_reward_version then
    foreach v_resource_key in array array[
      'exp', 'gold', 'building', 'level', 'skillPoints', 'hp', 'maxHp'
    ]
    loop
      if coalesce(old.data, '{}'::jsonb) ? v_resource_key then
        new.data := jsonb_set(
          coalesce(new.data, '{}'::jsonb),
          array[v_resource_key],
          old.data -> v_resource_key,
          true
        );
      else
        new.data := coalesce(new.data, '{}'::jsonb) - v_resource_key;
      end if;
    end loop;
  end if;

  new.data := jsonb_set(
    (coalesce(new.data, '{}'::jsonb) - 'raid_top_group') - 'raid_reward_version',
    '{raidTopGroup}',
    to_jsonb(v_top_group),
    true
  );
  new.data := jsonb_set(
    new.data,
    '{raidRewardVersion}',
    to_jsonb(v_reward_version),
    true
  );
  return new;
end;
$$;

-- Replace the existing unlock trigger function so unlock and first-clear reward
-- are committed in the same transaction as the room's transition to cleared.
create or replace function public.private_record_raid_clear_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member record;
  v_inserted boolean;
  v_profile_data jsonb;
  v_old_exp bigint;
  v_new_exp bigint;
  v_old_level smallint;
  v_new_level smallint;
  v_level_gain smallint;
  v_gold bigint;
  v_building bigint;
  v_skill_points bigint;
  v_hp bigint;
  v_old_max_hp bigint;
  v_new_max_hp bigint;
  v_reward_exp integer;
  v_reward_gold integer;
  v_reward_building integer;
  v_reward_version smallint;
  v_applied_at timestamptz;
begin
  if new.phase = 'cleared' and old.phase is distinct from 'cleared' then
    v_applied_at := coalesce(new.finished_at, new.updated_at, now());
    v_reward_exp := case new.floor_group
      when 1 then 40 when 2 then 60 when 3 then 85 when 4 then 115
      when 5 then 150 when 6 then 200 when 7 then 300
    end;
    v_reward_gold := case new.floor_group
      when 1 then 90 when 2 then 120 when 3 then 150 when 4 then 190
      when 5 then 230 when 6 then 280 when 7 then 400
    end;
    v_reward_building := case new.floor_group
      when 1 then 10 when 2 then 13 when 3 then 16 when 4 then 20
      when 5 then 24 when 6 then 29 when 7 then 40
    end;

    -- Only the three members still in the running room earn progress/rewards.
    insert into public.raid_progress_v1(user_id, top_group, updated_at)
    select member.user_id,
           greatest(0, least(7, new.floor_group::integer))::smallint,
           v_applied_at
      from public.raid_room_members_v1 member
     where member.room_id = new.id and member.active
    on conflict (user_id) do update
    set top_group = greatest(public.raid_progress_v1.top_group, excluded.top_group),
        updated_at = greatest(public.raid_progress_v1.updated_at, excluded.updated_at);

    update public.player_profiles_v2 profile
       set data = jsonb_set(
         coalesce(profile.data, '{}'::jsonb),
         '{raidTopGroup}',
         to_jsonb(progress.top_group::integer),
         true
       )
      from public.raid_progress_v1 progress
     where progress.user_id = profile.user_id
       and exists (
         select 1 from public.raid_room_members_v1 member
          where member.room_id = new.id
            and member.user_id = profile.user_id
            and member.active
       );

    -- The user/group primary key is the idempotency barrier across repeated
    -- clears, publish retries, reconnects, and multiple browser callbacks.
    for v_member in
      select member.user_id
        from public.raid_room_members_v1 member
       where member.room_id = new.id and member.active
       order by member.user_id
    loop
      v_inserted := false;
      insert into public.raid_reward_claims_v1(
        user_id, floor_group, source_room_id,
        exp_reward, gold_reward, building_reward,
        level_gain, fully_healed, legacy_assumed_paid,
        earned_at, applied_at
      ) values (
        v_member.user_id, new.floor_group, new.id,
        v_reward_exp, v_reward_gold, v_reward_building,
        0, false, false,
        v_applied_at, v_applied_at
      )
      on conflict (user_id, floor_group) do nothing
      returning true into v_inserted;

      if coalesce(v_inserted, false) then
        select coalesce(profile.data, '{}'::jsonb)
          into v_profile_data
          from public.player_profiles_v2 profile
         where profile.user_id = v_member.user_id
         for update;
        if not found then
          raise exception using errcode = 'P0001', message = 'PROFILE_MISSING';
        end if;

        -- Count after locking the profile.  Concurrent clears for the same
        -- character serialize on that row, making this the newest committed
        -- claim count plus the claim inserted by this transaction.
        select least(7, count(*))::smallint into v_reward_version
          from public.raid_reward_claims_v1 claim
         where claim.user_id = v_member.user_id;

        v_old_exp := public.private_raid_profile_int_v1(v_profile_data, 'exp');
        v_new_exp := least(2147483647::bigint, v_old_exp + v_reward_exp);
        v_old_level := public.private_raid_level_for_exp_v1(v_old_exp);
        v_new_level := public.private_raid_level_for_exp_v1(v_new_exp);
        v_level_gain := greatest(0, v_new_level - v_old_level)::smallint;
        v_gold := least(
          2147483647::bigint,
          public.private_raid_profile_int_v1(v_profile_data, 'gold') + v_reward_gold
        );
        v_building := least(
          2147483647::bigint,
          public.private_raid_profile_int_v1(v_profile_data, 'building') + v_reward_building
        );
        v_skill_points := least(
          2147483647::bigint,
          public.private_raid_profile_int_v1(v_profile_data, 'skillPoints') + v_level_gain * 2
        );
        v_old_max_hp := greatest(1, public.private_raid_profile_int_v1(v_profile_data, 'maxHp', 100000));
        v_new_max_hp := least(100000::bigint, v_old_max_hp + v_level_gain * 2);
        v_hp := case when v_level_gain > 0 then v_new_max_hp else least(
          v_new_max_hp,
          public.private_raid_profile_int_v1(v_profile_data, 'hp', 100000)
        ) end;

        v_profile_data := jsonb_set(v_profile_data, '{exp}', to_jsonb(v_new_exp), true);
        v_profile_data := jsonb_set(v_profile_data, '{gold}', to_jsonb(v_gold), true);
        v_profile_data := jsonb_set(v_profile_data, '{building}', to_jsonb(v_building), true);
        v_profile_data := jsonb_set(v_profile_data, '{level}', to_jsonb(v_new_level::integer), true);
        v_profile_data := jsonb_set(v_profile_data, '{skillPoints}', to_jsonb(v_skill_points), true);
        v_profile_data := jsonb_set(v_profile_data, '{maxHp}', to_jsonb(v_new_max_hp), true);
        v_profile_data := jsonb_set(v_profile_data, '{hp}', to_jsonb(v_hp), true);
        v_profile_data := jsonb_set(
          v_profile_data,
          '{raidRewardVersion}',
          to_jsonb(coalesce(v_reward_version, 0)::integer),
          true
        );
        v_profile_data := jsonb_set(
          v_profile_data,
          '{updatedAt}',
          to_jsonb(floor(extract(epoch from v_applied_at) * 1000)::bigint),
          true
        );

        update public.player_profiles_v2 profile
           set data = v_profile_data,
               updated_at = v_applied_at
         where profile.user_id = v_member.user_id;

        update public.raid_reward_claims_v1 claim
           set level_gain = v_level_gain,
               fully_healed = (v_level_gain > 0),
               applied_at = v_applied_at
         where claim.user_id = v_member.user_id
           and claim.floor_group = new.floor_group;
      end if;
    end loop;
  end if;
  return new;
end;
$$;

revoke all on function public.private_raid_profile_int_v1(jsonb, text, bigint)
  from public, anon, authenticated;
revoke all on function public.private_raid_level_for_exp_v1(bigint)
  from public, anon, authenticated;
revoke all on function public.private_guard_raid_progress_profile_v1()
  from public, anon, authenticated;
revoke all on function public.private_record_raid_clear_v1()
  from public, anon, authenticated;

commit;
