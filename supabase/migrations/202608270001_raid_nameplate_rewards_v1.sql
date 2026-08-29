begin;

-- Nameplate ownership is derived from the existing first-clear receipt table.
-- Teacher progress shortcuts never create receipts, so they cannot grant these
-- cosmetics.  The fixed order also keeps profile JSON stable across saves.
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
      select distinct claim.floor_group,
             case claim.floor_group
               when 2 then 'raid_20_steel'
               when 4 then 'raid_40_twilight'
               when 7 then 'raid_63_summit'
             end as theme
        from public.raid_reward_claims_v1 claim
       where claim.user_id = p_user_id
         and claim.floor_group in (2, 4, 7)
    ) reward;
$$;

-- raidNameplates is server-owned.  nameplate.theme is player-selectable, but
-- only default or a theme proven by a durable first-clear receipt is accepted.
-- The existing raid resource/version protections remain intact.
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
  v_owned_nameplates jsonb := '[]'::jsonb;
  v_incoming_theme text := 'default';
  v_old_theme text := 'default';
  v_has_incoming_theme boolean := false;
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

  v_owned_nameplates := public.private_raid_nameplates_for_user_v1(new.user_id);
  new.data := jsonb_set(
    (new.data - 'raid_nameplates') - 'raidNameplates',
    '{raidNameplates}',
    coalesce(v_owned_nameplates, '[]'::jsonb),
    true
  );

  v_has_incoming_theme := jsonb_typeof(new.data -> 'nameplate') = 'object'
    and (new.data -> 'nameplate') ? 'theme';
  if v_has_incoming_theme then
    v_incoming_theme := coalesce(nullif(new.data #>> '{nameplate,theme}', ''), 'default');
  elsif tg_op = 'UPDATE' then
    v_incoming_theme := coalesce(nullif(old.data #>> '{nameplate,theme}', ''), 'default');
  end if;
  v_old_theme := case when tg_op = 'UPDATE'
    then coalesce(nullif(old.data #>> '{nameplate,theme}', ''), 'default')
    else 'default'
  end;

  if v_incoming_theme <> 'default' and not (v_owned_nameplates ? v_incoming_theme) then
    v_incoming_theme := case
      when v_old_theme <> 'default' and v_owned_nameplates ? v_old_theme then v_old_theme
      else 'default'
    end;
  end if;
  new.data := jsonb_set(
    new.data,
    '{nameplate}',
    jsonb_build_object('theme', v_incoming_theme),
    true
  );
  return new;
end;
$$;

-- Backfill every genuine past 20/40/63-floor clear.  Reusing the guard keeps
-- the same derivation and also removes any client-invented ownership list.
update public.player_profiles_v2 profile
   set data = coalesce(profile.data, '{}'::jsonb)
 where exists (
   select 1
     from public.raid_reward_claims_v1 claim
    where claim.user_id = profile.user_id
      and claim.floor_group in (2, 4, 7)
 )
    or coalesce(profile.data, '{}'::jsonb) ? 'raidNameplates'
    or coalesce(profile.data, '{}'::jsonb) ? 'raid_nameplates'
    or coalesce(profile.data, '{}'::jsonb) ? 'nameplate';

revoke all on function public.private_raid_nameplates_for_user_v1(uuid)
  from public, anon, authenticated;
revoke all on function public.private_guard_raid_progress_profile_v1()
  from public, anon, authenticated;

commit;
