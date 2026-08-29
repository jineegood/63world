begin;

-- Global classroom notices are append-only server facts.  Students receive
-- them through the same bounded presence poll, but cannot read or write the
-- backing table directly.
create table if not exists public.world_announcements_v1 (
  id bigint generated always as identity primary key,
  kind text not null check (
    kind in ('legendary_upgrade', 'legendary_pet', 'raid_clear')
  ),
  source_id uuid not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  subject_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint world_announcements_v1_source_unique unique (kind, source_id),
  constraint world_announcements_v1_subject_safe check (
    subject_id is null or (
      char_length(subject_id) between 1 and 80
      and subject_id ~ '^[A-Za-z][A-Za-z0-9_-]{0,79}$'
    )
  ),
  constraint world_announcements_v1_payload_safe check (
    jsonb_typeof(payload) = 'object'
    and octet_length(payload::text) <= 2048
  )
);

create index if not exists world_announcements_v1_recent_idx
  on public.world_announcements_v1 (id desc);
create index if not exists world_announcements_v1_created_idx
  on public.world_announcements_v1 (created_at desc, id desc);

-- A weapon cannot normally leave legendary tier, so a second legendary notice
-- for the same student and weapon is always a replay or tampered legacy save.
create unique index if not exists world_announcements_v1_legendary_weapon_once
  on public.world_announcements_v1 (actor_user_id, subject_id)
  where kind = 'legendary_upgrade';

alter table public.world_announcements_v1 enable row level security;
alter table public.world_announcements_v1 force row level security;
revoke all on table public.world_announcements_v1 from public, anon, authenticated;
revoke all on sequence public.world_announcements_v1_id_seq from public, anon, authenticated;

-- One durable response per authenticated student request makes a timed-out RPC
-- safe to retry without rolling again or spending Building currency twice.
create table if not exists public.student_special_action_receipts_v1 (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  action_name text not null check (action_name in ('enhance', 'summonPet')),
  response_json jsonb not null check (
    jsonb_typeof(response_json) = 'object'
    and octet_length(response_json::text) <= 16384
  ),
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);

create index if not exists student_special_action_receipts_v1_recent_idx
  on public.student_special_action_receipts_v1 (user_id, action_name, created_at desc);

alter table public.student_special_action_receipts_v1 enable row level security;
alter table public.student_special_action_receipts_v1 force row level security;
revoke all on table public.student_special_action_receipts_v1
  from public, anon, authenticated;

-- Bound every attempt, including invalid-funds and maximum-tier requests. This
-- fixed-size row prevents a script from filling the durable receipt table with
-- fresh UUIDs while still allowing normal 4–5 second UI actions.
create table if not exists public.student_special_action_rate_v1 (
  user_id uuid not null references auth.users(id) on delete cascade,
  action_name text not null check (action_name in ('enhance', 'summonPet')),
  last_attempt_at timestamptz not null,
  primary key (user_id, action_name)
);

alter table public.student_special_action_rate_v1 enable row level security;
alter table public.student_special_action_rate_v1 force row level security;
revoke all on table public.student_special_action_rate_v1
  from public, anon, authenticated;

create or replace function public.private_store_special_action_receipt_v1(
  p_user_id uuid,
  p_request_id uuid,
  p_action_name text,
  p_response jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action_name text;
  v_response jsonb;
begin
  insert into public.student_special_action_receipts_v1 (
    user_id, request_id, action_name, response_json
  ) values (
    p_user_id, p_request_id, p_action_name, p_response
  )
  on conflict (user_id, request_id) do nothing;

  select receipt.action_name, receipt.response_json
    into v_action_name, v_response
    from public.student_special_action_receipts_v1 receipt
   where receipt.user_id = p_user_id
     and receipt.request_id = p_request_id;

  if v_action_name is distinct from p_action_name then
    return jsonb_build_object(
      'ok', false,
      'code', 'REQUEST_ID_REUSED',
      'action', p_action_name
    );
  end if;
  return v_response;
end;
$$;

revoke all on function public.private_store_special_action_receipt_v1(
  uuid, uuid, text, jsonb
) from public, anon, authenticated;

-- Production enhancement and pet summoning use one authenticated, locked
-- transaction.  The caller supplies only an action and idempotency UUID; name,
-- equipped weapon, tier, odds, pet and announcement contents all come from
-- protected server state/catalogues.
drop function if exists public.perform_student_special_action_v1(text, uuid);

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
      when 3 then 0.20
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

-- An independent trigger observes only the authoritative room phase transition.
-- Teacher progress shortcuts never update a real room to cleared and therefore
-- cannot manufacture this notice.
create or replace function public.private_announce_raid_clear_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_party_names jsonb := '[]'::jsonb;
  v_floor integer;
  v_created_at timestamptz;
begin
  if new.phase = 'cleared' and old.phase is distinct from 'cleared' then
    select coalesce(jsonb_agg(profile.display_name order by member.join_order), '[]'::jsonb)
      into v_party_names
      from public.raid_room_members_v1 member
      join public.player_profiles_v2 profile
        on profile.user_id = member.user_id
     where member.room_id = new.id
       and member.active;

    if jsonb_array_length(v_party_names) > 0 then
      v_floor := case
        when new.floor_group = 7 then 63
        else greatest(1, least(6, new.floor_group::integer)) * 10
      end;
      v_created_at := coalesce(new.finished_at, new.updated_at, clock_timestamp());
      insert into public.world_announcements_v1 (
        kind, source_id, actor_user_id, subject_id, payload, created_at
      ) values (
        'raid_clear', new.id, null, null,
        jsonb_build_object(
          'partyNames', v_party_names,
          'floorGroup', new.floor_group,
          'floor', v_floor
        ),
        v_created_at
      )
      on conflict do nothing;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.private_announce_raid_clear_v1()
  from public, anon, authenticated;

drop trigger if exists announce_raid_clear_v1 on public.raid_rooms_v1;
create trigger announce_raid_clear_v1
after update of phase on public.raid_rooms_v1
for each row execute function public.private_announce_raid_clear_v1();

-- Keep the fixed one-RPC-per-student multiplayer budget.  This wrapper reuses
-- the existing compact presence/chat response and adds only an indexed cursor
-- query for rare global notices.
create or replace function public.sync_world_presence_v2(p_state jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base jsonb;
  v_last_announcement_id bigint := 0;
  v_now timestamptz := clock_timestamp();
  v_announcements jsonb := '[]'::jsonb;
begin
  if p_state ? 'lastAnnouncementId' then
    if jsonb_typeof(p_state -> 'lastAnnouncementId') is distinct from 'string'
      or (p_state ->> 'lastAnnouncementId') !~ '^[0-9]{1,19}$'
    then
      raise exception 'invalid world announcement cursor'
        using errcode = '22023';
    end if;
    begin
      v_last_announcement_id := (p_state ->> 'lastAnnouncementId')::bigint;
    exception when numeric_value_out_of_range then
      raise exception 'invalid world announcement cursor'
        using errcode = '22023';
    end;
  end if;

  v_base := public.sync_world_presence_v1(p_state);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', recent.id::text,
    'kind', recent.kind,
    'actorName', recent.payload ->> 'actorName',
    'subjectId', recent.subject_id,
    'partyNames', recent.payload -> 'partyNames',
    'floor', recent.payload -> 'floor',
    'at', recent.created_at
  ) order by recent.id), '[]'::jsonb)
    into v_announcements
    from (
      select announcement.id,
             announcement.kind,
             announcement.subject_id,
             announcement.payload,
             announcement.created_at
        from public.world_announcements_v1 announcement
       where announcement.id > v_last_announcement_id
         and (
           v_last_announcement_id > 0
           or announcement.created_at >= v_now - interval '5 minutes'
         )
       order by announcement.id
       limit 30
    ) recent;

  return coalesce(v_base, '{}'::jsonb) || jsonb_build_object(
    'announcements', coalesce(v_announcements, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.sync_world_presence_v2(jsonb)
  from public, anon, authenticated;
grant execute on function public.sync_world_presence_v2(jsonb)
  to authenticated;

commit;
