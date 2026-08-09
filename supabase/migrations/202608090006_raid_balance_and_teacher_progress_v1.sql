begin;

-- 2026-08-09 balance pass: keep Gold/Building as-is, but lower EXP so a
-- first clear does not push classroom characters through levels too quickly.
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
      when 1 then 20 when 2 then 20 when 3 then 30 when 4 then 30
      when 5 then 40 when 6 then 40 when 7 then 50
    end;
    v_reward_gold := case new.floor_group
      when 1 then 90 when 2 then 120 when 3 then 150 when 4 then 190
      when 5 then 230 when 6 then 280 when 7 then 400
    end;
    v_reward_building := case new.floor_group
      when 1 then 10 when 2 then 13 when 3 then 16 when 4 then 20
      when 5 then 24 when 6 then 29 when 7 then 40
    end;

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

revoke all on function public.private_record_raid_clear_v1()
  from public, anon, authenticated;

-- Teacher-only progress cheat. Each call marks one more 10-floor group clear,
-- without adding a reward claim or granting any currency/EXP.
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
begin
  insert into public.raid_progress_v1(user_id, top_group, updated_at)
  values (p_target_user_id, 1, v_now)
  on conflict (user_id) do update
  set top_group = least(7, public.raid_progress_v1.top_group + 1)::smallint,
      updated_at = excluded.updated_at
  returning top_group into v_top_group;

  update public.player_profiles_v2 profile
     set data = jsonb_set(
       coalesce(profile.data, '{}'::jsonb),
       '{raidTopGroup}',
       to_jsonb(v_top_group::integer),
       true
     ),
     updated_at = v_now
   where profile.user_id = p_target_user_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'STUDENT_NOT_FOUND';
  end if;

  return jsonb_build_object('ok', true, 'raidTopGroup', v_top_group);
end;
$$;

revoke all on function public.private_teacher_advance_raid_progress_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.private_teacher_advance_raid_progress_v1(uuid)
  to service_role;

commit;
