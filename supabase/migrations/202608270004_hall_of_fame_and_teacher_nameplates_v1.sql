begin;

-- Teacher progress shortcuts may unlock cosmetic milestone nameplates, but
-- they must never consume the real first-clear reward receipt. Keeping these
-- grants separate lets a later genuine clear still award EXP and currency.
create table if not exists public.raid_nameplate_grants_v1 (
  user_id uuid not null references auth.users(id) on delete cascade,
  floor_group smallint not null check (floor_group in (2, 4, 7)),
  source text not null default 'teacher_cheat'
    check (source = 'teacher_cheat'),
  granted_at timestamptz not null default now(),
  primary key (user_id, floor_group)
);

alter table public.raid_nameplate_grants_v1 enable row level security;
alter table public.raid_nameplate_grants_v1 force row level security;
revoke all on table public.raid_nameplate_grants_v1
  from public, anon, authenticated;
grant select, insert on table public.raid_nameplate_grants_v1
  to service_role;

-- A cosmetic is owned after either a genuine first clear or an explicit
-- teacher test grant. The fixed order keeps stored player JSON deterministic.
create or replace function public.private_raid_nameplates_for_user_v1(
  p_user_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_agg(reward.theme order by reward.floor_group), '[]'::jsonb)
    from (
      select earned.floor_group,
             case earned.floor_group
               when 2 then 'raid_20_steel'
               when 4 then 'raid_40_twilight'
               when 7 then 'raid_63_summit'
             end as theme
        from (
          select claim.floor_group
            from public.raid_reward_claims_v1 claim
           where claim.user_id = p_user_id
             and claim.floor_group in (2, 4, 7)
          union
          select grant_row.floor_group
            from public.raid_nameplate_grants_v1 grant_row
           where grant_row.user_id = p_user_id
        ) earned
    ) reward;
$$;

-- Each click still advances only one ten-floor group. Once a milestone is
-- reached, all missing cosmetic grants at or below it are added idempotently.
create or replace function public.private_teacher_advance_raid_progress_v1(
  p_target_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_top_group smallint;
  v_now timestamptz := now();
  v_owned_nameplates jsonb := '[]'::jsonb;
  v_nameplate jsonb := jsonb_build_object('theme', 'default');
  v_new_nameplates jsonb := '[]'::jsonb;
begin
  insert into public.raid_progress_v1(user_id, top_group, updated_at)
  values (p_target_user_id, 1, v_now)
  on conflict (user_id) do update
  set top_group = least(7, public.raid_progress_v1.top_group + 1)::smallint,
      updated_at = excluded.updated_at
  returning top_group into v_top_group;

  with inserted as (
    insert into public.raid_nameplate_grants_v1(
      user_id, floor_group, source, granted_at
    )
    select p_target_user_id, milestone.floor_group, 'teacher_cheat', v_now
      from (values (2::smallint), (4::smallint), (7::smallint))
        as milestone(floor_group)
     where milestone.floor_group <= v_top_group
    on conflict (user_id, floor_group) do nothing
    returning floor_group
  )
  select coalesce(
    jsonb_agg(
      case inserted.floor_group
        when 2 then 'raid_20_steel'
        when 4 then 'raid_40_twilight'
        when 7 then 'raid_63_summit'
      end
      order by inserted.floor_group
    ),
    '[]'::jsonb
  )
    into v_new_nameplates
    from inserted;

  -- The existing profile guard derives raidNameplates from the two trusted
  -- grant sources while preserving the player's currently equipped theme.
  update public.player_profiles_v2 profile
     set data = jsonb_set(
       coalesce(profile.data, '{}'::jsonb),
       '{raidTopGroup}',
       to_jsonb(v_top_group::integer),
       true
     ),
     updated_at = v_now
   where profile.user_id = p_target_user_id
   returning coalesce(profile.data -> 'raidNameplates', '[]'::jsonb),
             coalesce(profile.data -> 'nameplate', jsonb_build_object('theme', 'default'))
        into v_owned_nameplates, v_nameplate;
  if not found then
    raise exception using errcode = 'P0001', message = 'STUDENT_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'ok', true,
    'raidTopGroup', v_top_group,
    'raidNameplates', coalesce(v_owned_nameplates, '[]'::jsonb),
    'nameplate', coalesce(v_nameplate, jsonb_build_object('theme', 'default')),
    'newNameplates', coalesce(v_new_nameplates, '[]'::jsonb)
  );
end;
$$;

-- One authenticated endpoint supplies either the overall ranking or one
-- class ranking. It exposes only visual/public character fields.
create or replace function public.load_hall_of_fame_v3(
  p_class text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_class text := nullif(btrim(coalesce(p_class, '')), '');
  v_result jsonb := '[]'::jsonb;
begin
  if v_class is not null and v_class not in ('warrior', 'mage', 'priest') then
    raise exception 'invalid hall of fame class'
      using errcode = '22023';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'name', ranked.display_name,
        'class', ranked.data ->> 'class',
        'spec', ranked.data ->> 'spec',
        'level', ranked.level,
        'exp', ranked.exp,
        'gold', public.private_raid_profile_int_v1(ranked.data, 'gold'),
        'appearance', coalesce(ranked.data -> 'appearance', '{}'::jsonb),
        'equipment', coalesce(ranked.data -> 'equipment', '{}'::jsonb),
        'costume', coalesce(ranked.data -> 'costume', '{}'::jsonb),
        'weaponUpgrades', coalesce(ranked.data -> 'weaponUpgrades', '{}'::jsonb),
        'activePet', ranked.data ->> 'activePet',
        'nameplate', jsonb_build_object(
          'theme', coalesce(nullif(ranked.data #>> '{nameplate,theme}', ''), 'default')
        )
      )
      order by ranked.exp desc, ranked.level desc, ranked.updated_at asc
    ),
    '[]'::jsonb
  )
    into v_result
    from (
      select profile.display_name,
             profile.data,
             profile.updated_at,
             public.private_raid_profile_int_v1(profile.data, 'exp') as exp,
             greatest(1, public.private_raid_profile_int_v1(profile.data, 'level', 100))::integer as level
        from public.player_profiles_v2 profile
       where profile.data <> '{}'::jsonb
         and profile.data ->> 'class' in ('warrior', 'mage', 'priest')
         and (v_class is null or profile.data ->> 'class' = v_class)
       order by exp desc, level desc, profile.updated_at asc
       limit 5
    ) ranked;

  return coalesce(v_result, '[]'::jsonb);
end;
$$;

revoke all on function public.private_raid_nameplates_for_user_v1(uuid)
  from public, anon, authenticated;
revoke all on function public.private_teacher_advance_raid_progress_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.private_teacher_advance_raid_progress_v1(uuid)
  to service_role;
revoke all on function public.load_hall_of_fame_v3(text)
  from public, anon;
grant execute on function public.load_hall_of_fame_v3(text)
  to authenticated;

commit;
