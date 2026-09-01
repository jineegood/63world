-- Lower only the authoritative epic-to-legendary enhancement roll.
-- The client deliberately keeps displaying the established 20% 안내 value.
-- Replacing the whole RPC preserves its locking, receipts, resource spend,
-- pet summon behavior, and legendary announcement transaction.

begin;

create or replace function public.perform_world_special_action_v1(
  p_action text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_display_name text;
  v_data jsonb;
  v_response jsonb;
  v_existing_action text;
  v_existing_response jsonb;
  v_now timestamptz;
  v_last_action_at timestamptz;
  v_building bigint := 0;
  v_numeric numeric;
  v_weapon_id text;
  v_weapon_upgrades jsonb := '{}'::jsonb;
  v_old_tier integer := 0;
  v_new_tier integer := 0;
  v_chance numeric := 0;
  v_success boolean := false;
  v_total_weight integer := 0;
  v_roll double precision := 0;
  v_pet_id text;
  v_pets jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    return jsonb_build_object(
      'ok', false, 'code', 'UNAUTHORIZED', 'action', p_action
    );
  end if;
  if public.is_teacher() then
    return jsonb_build_object(
      'ok', false, 'code', 'FORBIDDEN', 'action', p_action
    );
  end if;
  if p_action is null or p_action not in ('enhance', 'summonPet')
    or p_request_id is null
  then
    return jsonb_build_object(
      'ok', false, 'code', 'INVALID_REQUEST', 'action', p_action
    );
  end if;

  select receipt.action_name, receipt.response_json
    into v_existing_action, v_existing_response
    from public.student_special_action_receipts_v1 receipt
   where receipt.user_id = v_user_id
     and receipt.request_id = p_request_id;
  if found then
    if v_existing_action is distinct from p_action then
      return jsonb_build_object(
        'ok', false,
        'code', 'REQUEST_ID_REUSED',
        'action', p_action
      );
    end if;
    return v_existing_response;
  end if;

  select profile.display_name, coalesce(profile.data, '{}'::jsonb)
    into v_display_name, v_data
    from public.player_profiles_v2 profile
   where profile.user_id = v_user_id
   for update;
  if not found then
    v_response := jsonb_build_object(
      'ok', false, 'code', 'CHARACTER_NOT_FOUND', 'action', p_action
    );
    return public.private_store_special_action_receipt_v1(
      v_user_id, p_request_id, p_action, v_response
    );
  end if;

  -- Two simultaneous retries can both miss the optimistic receipt lookup.
  -- The profile row lock serializes them; re-reading here is what prevents the
  -- waiter from spending and rolling a second time after the winner commits.
  select receipt.action_name, receipt.response_json
    into v_existing_action, v_existing_response
    from public.student_special_action_receipts_v1 receipt
   where receipt.user_id = v_user_id
     and receipt.request_id = p_request_id;
  if found then
    if v_existing_action is distinct from p_action then
      return jsonb_build_object(
        'ok', false,
        'code', 'REQUEST_ID_REUSED',
        'action', p_action
      );
    end if;
    return v_existing_response;
  end if;

  v_now := clock_timestamp();

  -- Conditional UPSERT is both a per-user lock and a fixed-size throttle. A
  -- rejected attempt is intentionally not stored as a receipt: no state was
  -- changed, and repeated throwaway UUIDs therefore cannot grow the table.
  insert into public.student_special_action_rate_v1(
    user_id, action_name, last_attempt_at
  ) values (
    v_user_id, p_action, v_now
  )
  on conflict (user_id, action_name) do update
    set last_attempt_at = excluded.last_attempt_at
    where public.student_special_action_rate_v1.last_attempt_at
      <= excluded.last_attempt_at - interval '2 seconds'
  returning last_attempt_at into v_last_action_at;
  if not found then
    return jsonb_build_object(
      'ok', false, 'code', 'RATE_LIMITED', 'action', p_action
    );
  end if;

  if jsonb_typeof(v_data -> 'building') = 'number' then
    begin
      v_numeric := trunc((v_data ->> 'building')::numeric);
      v_building := least(2147483647::numeric, greatest(0::numeric, v_numeric))::bigint;
    exception when invalid_text_representation or numeric_value_out_of_range then
      v_building := 0;
    end;
  end if;

  if p_action = 'enhance' then
    v_weapon_id := nullif(v_data #>> '{equipment,weapon}', '');
    if v_weapon_id is null
      or char_length(v_weapon_id) not between 1 and 80
      or not exists (
        select 1
          from public.game_item_catalog_v3 item
         where item.item_id = v_weapon_id
           and item.inventory_kind = 'gear'
           and item.slot = 'weapon'
      )
      or jsonb_typeof(v_data -> 'inventory') is distinct from 'array'
      or not ((v_data -> 'inventory') ? v_weapon_id)
    then
      v_response := jsonb_build_object(
        'ok', false, 'code', 'WEAPON_NOT_EQUIPPED', 'action', p_action
      );
      return public.private_store_special_action_receipt_v1(
        v_user_id, p_request_id, p_action, v_response
      );
    end if;

    v_weapon_upgrades := case
      when jsonb_typeof(v_data -> 'weaponUpgrades') = 'object'
        then v_data -> 'weaponUpgrades'
      else '{}'::jsonb
    end;
    if jsonb_typeof(v_weapon_upgrades -> v_weapon_id) = 'number' then
      begin
        v_old_tier := least(4, greatest(0,
          trunc((v_weapon_upgrades ->> v_weapon_id)::numeric)::integer
        ));
      exception when invalid_text_representation or numeric_value_out_of_range then
        v_old_tier := 0;
      end;
    end if;

    if v_old_tier >= 4 then
      v_response := jsonb_build_object(
        'ok', false, 'code', 'MAX_TIER', 'action', p_action
      );
      return public.private_store_special_action_receipt_v1(
        v_user_id, p_request_id, p_action, v_response
      );
    end if;
    if v_building < 3 then
      v_response := jsonb_build_object(
        'ok', false, 'code', 'INSUFFICIENT_FUNDS', 'action', p_action
      );
      return public.private_store_special_action_receipt_v1(
        v_user_id, p_request_id, p_action, v_response
      );
    end if;

    v_chance := case v_old_tier
      when 0 then 0.80
      when 1 then 0.60
      when 2 then 0.40
      when 3 then 0.15
      else 0
    end;
    v_success := pg_catalog.random() < v_chance;
    v_new_tier := case
      when v_success then v_old_tier + 1
      else greatest(0, v_old_tier - 1)
    end;
    v_building := v_building - 3;
    v_weapon_upgrades := jsonb_set(
      v_weapon_upgrades,
      array[v_weapon_id],
      to_jsonb(v_new_tier),
      true
    );
    v_data := jsonb_set(v_data, '{weaponUpgrades}', v_weapon_upgrades, true);
    v_data := jsonb_set(v_data, '{building}', to_jsonb(v_building), true);
    v_data := jsonb_set(
      v_data,
      '{updatedAt}',
      to_jsonb(floor(extract(epoch from v_now) * 1000)::bigint),
      true
    );

    update public.player_profiles_v2 profile
       set data = v_data,
           updated_at = v_now
     where profile.user_id = v_user_id;

    if v_success and v_new_tier = 4 then
      insert into public.world_announcements_v1 (
        kind, source_id, actor_user_id, subject_id, payload, created_at
      ) values (
        'legendary_upgrade', p_request_id, v_user_id, v_weapon_id,
        jsonb_build_object(
          'actorName', v_display_name,
          'subjectId', v_weapon_id
        ),
        v_now
      )
      on conflict do nothing;
    end if;

    v_response := jsonb_build_object(
      'ok', true,
      'code', 'OK',
      'action', p_action,
      'outcome', jsonb_build_object(
        'success', v_success,
        'weaponId', v_weapon_id,
        'oldTier', v_old_tier,
        'newTier', v_new_tier
      ),
      'state', jsonb_build_object(
        'building', v_building,
        'weaponUpgrades', v_weapon_upgrades
      )
    );
  else
    if v_building < 10 then
      v_response := jsonb_build_object(
        'ok', false, 'code', 'INSUFFICIENT_FUNDS', 'action', p_action
      );
      return public.private_store_special_action_receipt_v1(
        v_user_id, p_request_id, p_action, v_response
      );
    end if;

    select sum(pet.summon_weight)::integer
      into v_total_weight
      from public.game_pet_catalog_v3 pet;
    if coalesce(v_total_weight, 0) <= 0 then
      v_response := jsonb_build_object(
        'ok', false, 'code', 'INVALID_PET', 'action', p_action
      );
      return public.private_store_special_action_receipt_v1(
        v_user_id, p_request_id, p_action, v_response
      );
    end if;

    v_roll := pg_catalog.random() * v_total_weight;
    select weighted.pet_id
      into v_pet_id
      from (
        select pet.pet_id,
               sum(pet.summon_weight) over (order by pet.pet_id) as cumulative_weight
          from public.game_pet_catalog_v3 pet
      ) weighted
     where weighted.cumulative_weight > v_roll
     order by weighted.cumulative_weight
     limit 1;
    if v_pet_id is null then
      v_response := jsonb_build_object(
        'ok', false, 'code', 'INVALID_PET', 'action', p_action
      );
      return public.private_store_special_action_receipt_v1(
        v_user_id, p_request_id, p_action, v_response
      );
    end if;

    select coalesce(jsonb_agg(pet.pet_id order by pet.pet_id), '[]'::jsonb)
      into v_pets
      from public.game_pet_catalog_v3 pet
     where (
       jsonb_typeof(v_data -> 'pets') = 'array'
       and (v_data -> 'pets') ? pet.pet_id
     ) or pet.pet_id = v_pet_id;

    v_building := v_building - 10;
    v_data := jsonb_set(v_data, '{building}', to_jsonb(v_building), true);
    v_data := jsonb_set(v_data, '{pets}', v_pets, true);
    v_data := jsonb_set(v_data, '{activePet}', to_jsonb(v_pet_id), true);
    v_data := jsonb_set(
      v_data,
      '{updatedAt}',
      to_jsonb(floor(extract(epoch from v_now) * 1000)::bigint),
      true
    );

    update public.player_profiles_v2 profile
       set data = v_data,
           updated_at = v_now
     where profile.user_id = v_user_id;

    if v_pet_id = 'yuksam' then
      insert into public.world_announcements_v1 (
        kind, source_id, actor_user_id, subject_id, payload, created_at
      ) values (
        'legendary_pet', p_request_id, v_user_id, v_pet_id,
        jsonb_build_object(
          'actorName', v_display_name,
          'subjectId', v_pet_id
        ),
        v_now
      )
      on conflict do nothing;
    end if;

    v_response := jsonb_build_object(
      'ok', true,
      'code', 'OK',
      'action', p_action,
      'outcome', jsonb_build_object('petId', v_pet_id),
      'state', jsonb_build_object(
        'building', v_building,
        'pets', v_pets,
        'activePet', v_pet_id
      )
    );
  end if;

  return public.private_store_special_action_receipt_v1(
    v_user_id, p_request_id, p_action, v_response
  );
end;
$$;

revoke all on function public.perform_world_special_action_v1(text, uuid)
  from public, anon, authenticated;
grant execute on function public.perform_world_special_action_v1(text, uuid)
  to authenticated;

commit;

