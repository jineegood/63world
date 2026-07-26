-- 63world server-authoritative player foundation.
-- This migration is additive. The v2 JSON profile remains available until the
-- later gameplay phases are complete and the v3 cutover flag is enabled.

create extension if not exists pgcrypto;

create table if not exists public.player_core_v3 (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null
    check (char_length(display_name) between 1 and 20)
    check (display_name !~ '[[:cntrl:]]'),
  class_name text not null
    check (class_name in ('warrior', 'mage', 'priest')),
  spec text,
  level integer not null default 1
    check (level between 1 and 10),
  exp integer not null default 0
    check (exp >= 0),
  gold integer not null default 20
    check (gold >= 0),
  building integer not null default 0
    check (building >= 0),
  current_hp integer not null
    check (current_hp >= 0),
  max_hp integer not null
    check (max_hp >= 1)
    check (current_hp <= max_hp),
  current_map text not null default 'town'
    check (current_map in (
      'town',
      'equipmentShop',
      'buildingShopInterior',
      'petShopInterior',
      'upgradeShopInterior',
      'forest',
      'desert',
      'swamp',
      'bossRoom',
      'finalBossRoom'
    )),
  pvp_wins integer not null default 0 check (pvp_wins >= 0),
  pvp_losses integer not null default 0 check (pvp_losses >= 0),
  revision bigint not null default 1
    check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.player_inventory_v3 (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.player_core_v3(user_id) on delete cascade,
  item_definition_id text not null
    check (char_length(item_definition_id) between 1 and 80)
    check (item_definition_id !~ '[[:cntrl:]]'),
  enhancement_tier integer not null default 0
    check (enhancement_tier between 0 and 20),
  equipped_slot text
    check (equipped_slot is null or equipped_slot in ('weapon', 'head', 'armor', 'accessory')),
  grant_source text not null default 'server'
    check (char_length(grant_source) between 1 and 80)
    check (grant_source !~ '[[:cntrl:]]'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, equipped_slot)
);

create index if not exists player_inventory_v3_user_id_idx
  on public.player_inventory_v3(user_id);

create table if not exists public.player_skills_v3 (
  user_id uuid not null references public.player_core_v3(user_id) on delete cascade,
  skill_id text not null
    check (char_length(skill_id) between 1 and 80)
    check (skill_id !~ '[[:cntrl:]]'),
  rank integer not null default 0 check (rank between 0 and 20),
  updated_at timestamptz not null default now(),
  primary key (user_id, skill_id)
);

create table if not exists public.player_quests_v3 (
  user_id uuid not null references public.player_core_v3(user_id) on delete cascade,
  quest_id text not null
    check (char_length(quest_id) between 1 and 80)
    check (quest_id !~ '[[:cntrl:]]'),
  status text not null
    check (status in ('ready', 'active', 'complete', 'claimed')),
  progress integer not null default 0 check (progress >= 0),
  accepted_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, quest_id)
);

create table if not exists public.player_preferences_v3 (
  user_id uuid primary key references public.player_core_v3(user_id) on delete cascade,
  shirt_color text not null default '#38bdf8'
    check (char_length(shirt_color) between 1 and 32),
  pants_color text not null default '#334155'
    check (char_length(pants_color) between 1 and 32),
  hair_color text not null default '#3f2d20'
    check (char_length(hair_color) between 1 and 32),
  hair_style text not null default 'short'
    check (char_length(hair_style) between 1 and 32),
  skin_color text not null default '#f1d2b6'
    check (char_length(skin_color) between 1 and 32),
  accessory text not null default 'none'
    check (char_length(accessory) between 1 and 32),
  bgm_volume integer not null default 55
    check (bgm_volume between 0 and 100),
  sfx_volume integer not null default 65
    check (sfx_volume between 0 and 100),
  bgm_enabled boolean not null default true,
  sfx_enabled boolean not null default true,
  tutorial_acknowledgements jsonb not null default '{}'::jsonb
    check (jsonb_typeof(tutorial_acknowledgements) = 'object')
    check (octet_length(tutorial_acknowledgements::text) <= 8192),
  updated_at timestamptz not null default now()
);

create table if not exists public.game_action_receipts_v3 (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  action_name text not null
    check (char_length(action_name) between 1 and 80),
  response_json jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);

create index if not exists game_action_receipts_v3_created_at_idx
  on public.game_action_receipts_v3(created_at);

create table if not exists public.security_events_v3 (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null
    check (char_length(event_type) between 1 and 80),
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object')
    check (octet_length(details::text) <= 4096),
  created_at timestamptz not null default now()
);

create index if not exists security_events_v3_created_at_idx
  on public.security_events_v3(created_at desc);

create index if not exists security_events_v3_user_id_idx
  on public.security_events_v3(user_id);

alter table public.player_core_v3 enable row level security;
alter table public.player_core_v3 force row level security;
alter table public.player_inventory_v3 enable row level security;
alter table public.player_inventory_v3 force row level security;
alter table public.player_skills_v3 enable row level security;
alter table public.player_skills_v3 force row level security;
alter table public.player_quests_v3 enable row level security;
alter table public.player_quests_v3 force row level security;
alter table public.player_preferences_v3 enable row level security;
alter table public.player_preferences_v3 force row level security;
alter table public.game_action_receipts_v3 enable row level security;
alter table public.game_action_receipts_v3 force row level security;
alter table public.security_events_v3 enable row level security;
alter table public.security_events_v3 force row level security;

drop policy if exists "students read own core v3" on public.player_core_v3;
create policy "students read own core v3"
on public.player_core_v3
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "students read own inventory v3" on public.player_inventory_v3;
create policy "students read own inventory v3"
on public.player_inventory_v3
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "students read own skills v3" on public.player_skills_v3;
create policy "students read own skills v3"
on public.player_skills_v3
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "students read own quests v3" on public.player_quests_v3;
create policy "students read own quests v3"
on public.player_quests_v3
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "students read own preferences v3" on public.player_preferences_v3;
create policy "students read own preferences v3"
on public.player_preferences_v3
for select
to authenticated
using (user_id = (select auth.uid()));

revoke all on table public.player_core_v3 from public, anon, authenticated;
revoke all on table public.player_inventory_v3 from public, anon, authenticated;
revoke all on table public.player_skills_v3 from public, anon, authenticated;
revoke all on table public.player_quests_v3 from public, anon, authenticated;
revoke all on table public.player_preferences_v3 from public, anon, authenticated;
revoke all on table public.game_action_receipts_v3 from public, anon, authenticated;
revoke all on table public.security_events_v3 from public, anon, authenticated;

grant select on table public.player_core_v3 to authenticated;
grant select on table public.player_inventory_v3 to authenticated;
grant select on table public.player_skills_v3 to authenticated;
grant select on table public.player_quests_v3 to authenticated;
grant select on table public.player_preferences_v3 to authenticated;

create or replace function public.private_is_teacher_v3()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select auth.jwt() -> 'app_metadata' ->> 'role') = 'teacher',
    false
  );
$$;

create or replace function public.private_log_security_event_v3(
  p_event_type text,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.security_events_v3(user_id, event_type, details)
  values (
    auth.uid(),
    left(coalesce(nullif(btrim(p_event_type), ''), 'unknown'), 80),
    case
      when jsonb_typeof(coalesce(p_details, '{}'::jsonb)) = 'object'
        and octet_length(coalesce(p_details, '{}'::jsonb)::text) <= 4096
      then coalesce(p_details, '{}'::jsonb)
      else '{}'::jsonb
    end
  );
end;
$$;

create or replace function public.private_read_receipt_v3(
  p_request_id uuid,
  p_action_name text
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
  -- Serialize every action sharing this user/request pair. The transaction
  -- lock closes the race where two different RPCs both mutate before either
  -- receipt is visible.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(auth.uid()::text || ':' || p_request_id::text, 0)
  );

  select r.action_name, r.response_json
  into v_action_name, v_response
  from public.game_action_receipts_v3 as r
  where r.user_id = auth.uid()
    and r.request_id = p_request_id;

  if v_action_name is null then
    return null;
  end if;
  if v_action_name is distinct from p_action_name then
    perform public.private_log_security_event_v3(
      'request_id_reused',
      jsonb_build_object('original_action', v_action_name, 'requested_action', p_action_name)
    );
    return jsonb_build_object('ok', false, 'code', 'REQUEST_ID_REUSED');
  end if;
  return v_response;
end;
$$;

revoke all on function public.private_is_teacher_v3() from public, anon, authenticated;
revoke all on function public.private_log_security_event_v3(text, jsonb) from public, anon, authenticated;
revoke all on function public.private_read_receipt_v3(uuid, text) from public, anon, authenticated;

create or replace function public.private_build_student_snapshot_v3(
  p_user_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'core', jsonb_build_object(
      'display_name', c.display_name,
      'class_name', c.class_name,
      'spec', c.spec,
      'level', c.level,
      'exp', c.exp,
      'gold', c.gold,
      'building', c.building,
      'current_hp', c.current_hp,
      'max_hp', c.max_hp,
      'current_map', c.current_map,
      'pvp_wins', c.pvp_wins,
      'pvp_losses', c.pvp_losses,
      'revision', c.revision
    ),
    'inventory', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'item_definition_id', i.item_definition_id,
        'enhancement_tier', i.enhancement_tier,
        'equipped_slot', i.equipped_slot
      ) order by i.item_definition_id, i.id)
      from public.player_inventory_v3 as i
      where i.user_id = c.user_id
    ), '[]'::jsonb),
    'skills', coalesce((
      select jsonb_agg(jsonb_build_object(
        'skill_id', s.skill_id,
        'rank', s.rank
      ) order by s.skill_id)
      from public.player_skills_v3 as s
      where s.user_id = c.user_id
    ), '[]'::jsonb),
    'quests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'quest_id', q.quest_id,
        'status', q.status,
        'progress', q.progress,
        'accepted_at', q.accepted_at,
        'completed_at', q.completed_at
      ) order by q.quest_id)
      from public.player_quests_v3 as q
      where q.user_id = c.user_id
    ), '[]'::jsonb),
    'preferences', jsonb_build_object(
      'shirt_color', p.shirt_color,
      'pants_color', p.pants_color,
      'hair_color', p.hair_color,
      'hair_style', p.hair_style,
      'skin_color', p.skin_color,
      'accessory', p.accessory,
      'bgm_volume', p.bgm_volume,
      'sfx_volume', p.sfx_volume,
      'bgm_enabled', p.bgm_enabled,
      'sfx_enabled', p.sfx_enabled,
      'tutorial_acknowledgements', p.tutorial_acknowledgements
    ),
    'revision', c.revision
  )
  from public.player_core_v3 as c
  join public.player_preferences_v3 as p on p.user_id = c.user_id
  where c.user_id = p_user_id;
$$;

revoke all on function public.private_build_student_snapshot_v3(uuid)
  from public, anon, authenticated;

create or replace function public.create_student_character_v3(
  p_class_name text,
  p_appearance jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_display_name text;
  v_existing integer;
  v_receipt jsonb;
  v_snapshot jsonb;
  v_response jsonb;
  v_starter_item text;
  v_max_hp integer;
  v_request_id uuid;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED');
  end if;
  if public.private_is_teacher_v3() then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if p_request_id is null or p_request_id !~* '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89ab][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then
    perform public.private_log_security_event_v3('invalid_request_id', '{}'::jsonb);
    return jsonb_build_object('ok', false, 'code', 'INVALID_REQUEST');
  end if;
  v_request_id := p_request_id::uuid;

  v_receipt := public.private_read_receipt_v3(
    v_request_id,
    'create_student_character_v3'
  );
  if v_receipt is not null then
    return v_receipt;
  end if;

  select p.display_name
  into v_display_name
  from public.player_profiles_v2 as p
  where p.user_id = v_user_id
  for update;

  if v_display_name is null then
    perform public.private_log_security_event_v3(
      'create_character_without_student_profile',
      '{}'::jsonb
    );
    return jsonb_build_object('ok', false, 'code', 'STUDENT_NOT_FOUND');
  end if;

  select 1
  into v_existing
  from public.player_core_v3 as c
  where c.user_id = v_user_id
  for update;

  if v_existing = 1 then
    v_snapshot := public.private_build_student_snapshot_v3(v_user_id);
    v_response := jsonb_build_object('ok', true, 'code', 'OK', 'snapshot', v_snapshot);
    insert into public.game_action_receipts_v3(user_id, request_id, action_name, response_json)
    values (v_user_id, v_request_id, 'create_student_character_v3', v_response)
    on conflict (user_id, request_id) do nothing;
    return v_response;
  end if;

  if p_class_name is null
    or p_class_name not in ('warrior', 'mage', 'priest')
  then
    perform public.private_log_security_event_v3(
      'invalid_character_class',
      jsonb_build_object('class_length', char_length(coalesce(p_class_name, '')))
    );
    return jsonb_build_object('ok', false, 'code', 'INVALID_CLASS');
  end if;

  if jsonb_typeof(p_appearance) is distinct from 'object'
    or exists (
      select 1
      from jsonb_object_keys(
        case
          when jsonb_typeof(p_appearance) = 'object' then p_appearance
          else '{}'::jsonb
        end
      ) as appearance_key
      where appearance_key not in (
        'shirt', 'pants', 'hair', 'hairStyle', 'skin', 'accessory'
      )
    )
    or exists (
      select 1
      from unnest(array['shirt', 'pants', 'hair', 'hairStyle', 'skin', 'accessory']) as required_key
      where jsonb_typeof(p_appearance -> required_key) is distinct from 'string'
        or char_length(p_appearance ->> required_key) not between 1 and 32
        or (p_appearance ->> required_key) ~ '[[:cntrl:]]'
    )
  then
    perform public.private_log_security_event_v3(
      'invalid_character_appearance',
      '{}'::jsonb
    );
    return jsonb_build_object('ok', false, 'code', 'INVALID_APPEARANCE');
  end if;

  v_starter_item := case p_class_name
    when 'warrior' then 'training_greatsword'
    when 'mage' then 'training_staff'
    else 'training_book'
  end;
  v_max_hp := case p_class_name when 'warrior' then 22 else 16 end;

  insert into public.player_core_v3(
    user_id,
    display_name,
    class_name,
    spec,
    level,
    exp,
    gold,
    building,
    current_hp,
    max_hp,
    current_map,
    revision
  )
  values (
    v_user_id,
    v_display_name,
    p_class_name,
    null,
    1,
    0,
    20,
    0,
    v_max_hp,
    v_max_hp,
    'town',
    1
  )
  on conflict (user_id) do nothing;

  insert into public.player_inventory_v3(
    user_id,
    item_definition_id,
    enhancement_tier,
    equipped_slot,
    grant_source
  )
  values (v_user_id, v_starter_item, 0, 'weapon', 'character_creation');

  insert into public.player_preferences_v3(
    user_id,
    shirt_color,
    pants_color,
    hair_color,
    hair_style,
    skin_color,
    accessory
  )
  values (
    v_user_id,
    p_appearance ->> 'shirt',
    p_appearance ->> 'pants',
    p_appearance ->> 'hair',
    p_appearance ->> 'hairStyle',
    p_appearance ->> 'skin',
    p_appearance ->> 'accessory'
  );

  v_snapshot := public.private_build_student_snapshot_v3(v_user_id);
  v_response := jsonb_build_object('ok', true, 'code', 'OK', 'snapshot', v_snapshot);

  insert into public.game_action_receipts_v3(user_id, request_id, action_name, response_json)
  values (v_user_id, v_request_id, 'create_student_character_v3', v_response);

  return v_response;
end;
$$;

create or replace function public.load_student_game_v3()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_snapshot jsonb;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED');
  end if;
  if public.private_is_teacher_v3() then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  v_snapshot := public.private_build_student_snapshot_v3(v_user_id);
  if v_snapshot is null then
    return jsonb_build_object('ok', false, 'code', 'CHARACTER_NOT_FOUND');
  end if;

  return jsonb_build_object('ok', true, 'code', 'OK', 'snapshot', v_snapshot);
end;
$$;

revoke all on function public.create_student_character_v3(text, jsonb, text)
  from public, anon;
revoke all on function public.load_student_game_v3()
  from public, anon;
grant execute on function public.create_student_character_v3(text, jsonb, text)
  to authenticated;
grant execute on function public.load_student_game_v3()
  to authenticated;

create or replace function public.private_store_receipt_v3(
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
  v_user_id uuid := auth.uid();
  v_action_name text;
  v_response jsonb;
begin
  insert into public.game_action_receipts_v3(
    user_id,
    request_id,
    action_name,
    response_json
  )
  values (v_user_id, p_request_id, p_action_name, p_response)
  on conflict (user_id, request_id) do nothing;

  select r.action_name, r.response_json
  into v_action_name, v_response
  from public.game_action_receipts_v3 as r
  where r.user_id = v_user_id
    and r.request_id = p_request_id;

  if v_action_name is distinct from p_action_name then
    return jsonb_build_object('ok', false, 'code', 'REQUEST_ID_REUSED');
  end if;
  return v_response;
end;
$$;

revoke all on function public.private_store_receipt_v3(uuid, text, jsonb)
  from public, anon, authenticated;

create or replace function public.save_student_preferences_v3(
  p_preferences jsonb,
  p_expected_revision bigint,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_receipt jsonb;
  v_response jsonb;
  v_current_revision bigint;
  v_appearance jsonb;
  v_audio jsonb;
  v_tutorial jsonb;
  v_request_id uuid;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED');
  end if;
  if public.private_is_teacher_v3() then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if p_request_id is null or p_request_id !~* '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89ab][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then
    perform public.private_log_security_event_v3('invalid_request_id', '{}'::jsonb);
    return jsonb_build_object('ok', false, 'code', 'INVALID_REQUEST');
  end if;
  v_request_id := p_request_id::uuid;

  v_receipt := public.private_read_receipt_v3(
    v_request_id,
    'save_student_preferences_v3'
  );
  if v_receipt is not null then
    return v_receipt;
  end if;

  select c.revision
  into v_current_revision
  from public.player_core_v3 as c
  where c.user_id = v_user_id
  for update;

  if v_current_revision is null then
    v_response := jsonb_build_object('ok', false, 'code', 'CHARACTER_NOT_FOUND');
    return public.private_store_receipt_v3(
      v_request_id,
      'save_student_preferences_v3',
      v_response
    );
  end if;

  if p_expected_revision is distinct from v_current_revision then
    perform public.private_log_security_event_v3(
      'preference_revision_conflict',
      jsonb_build_object('current_revision', v_current_revision)
    );
    v_response := jsonb_build_object(
      'ok', false,
      'code', 'REVISION_CONFLICT',
      'snapshot', public.private_build_student_snapshot_v3(v_user_id)
    );
    return public.private_store_receipt_v3(
      v_request_id,
      'save_student_preferences_v3',
      v_response
    );
  end if;

  -- Explicitly name authoritative fields so audits show that they are rejected.
  if jsonb_typeof(p_preferences) is distinct from 'object'
    or exists (
      select 1
      from jsonb_object_keys(
        case when jsonb_typeof(p_preferences) = 'object'
          then p_preferences else '{}'::jsonb end
      ) as pref_key
      where pref_key in (
        'level', 'exp', 'gold', 'building', 'hp', 'map', 'inventory',
        'equipment', 'skills', 'quests', 'records', 'pvp_wins', 'pvp_losses'
      )
    )
    or exists (
      select 1
      from jsonb_object_keys(
        case when jsonb_typeof(p_preferences) = 'object'
          then p_preferences else '{}'::jsonb end
      ) as pref_key
      where pref_key not in ('appearance', 'audio', 'tutorialAcknowledgements')
    )
  then
    perform public.private_log_security_event_v3(
      'invalid_preference_fields',
      '{}'::jsonb
    );
    v_response := jsonb_build_object('ok', false, 'code', 'INVALID_PREFERENCES');
    return public.private_store_receipt_v3(
      v_request_id,
      'save_student_preferences_v3',
      v_response
    );
  end if;

  v_appearance := p_preferences -> 'appearance';
  v_audio := p_preferences -> 'audio';
  v_tutorial := p_preferences -> 'tutorialAcknowledgements';

  if v_appearance is not null and (
    jsonb_typeof(v_appearance) is distinct from 'object'
    or exists (
      select 1
      from jsonb_object_keys(
        case when jsonb_typeof(v_appearance) = 'object'
          then v_appearance else '{}'::jsonb end
      ) as appearance_key
      where appearance_key not in (
        'shirt', 'pants', 'hair', 'hairStyle', 'skin', 'accessory'
      )
    )
    or exists (
      select 1
      from jsonb_object_keys(
        case when jsonb_typeof(v_appearance) = 'object'
          then v_appearance else '{}'::jsonb end
      ) as appearance_key
      where jsonb_typeof(v_appearance -> appearance_key) is distinct from 'string'
        or char_length(v_appearance ->> appearance_key) not between 1 and 32
        or (v_appearance ->> appearance_key) ~ '[[:cntrl:]]'
    )
  ) then
    perform public.private_log_security_event_v3('invalid_preference_appearance', '{}'::jsonb);
    v_response := jsonb_build_object('ok', false, 'code', 'INVALID_PREFERENCES');
    return public.private_store_receipt_v3(
      v_request_id,
      'save_student_preferences_v3',
      v_response
    );
  end if;

  if v_audio is not null and (
    jsonb_typeof(v_audio) is distinct from 'object'
    or exists (
      select 1
      from jsonb_object_keys(
        case when jsonb_typeof(v_audio) = 'object'
          then v_audio else '{}'::jsonb end
      ) as audio_key
      where audio_key not in ('bgmVolume', 'sfxVolume', 'bgmEnabled', 'sfxEnabled')
    )
    or (
      v_audio ? 'bgmVolume'
      and (
        jsonb_typeof(v_audio -> 'bgmVolume') <> 'number'
        or (v_audio ->> 'bgmVolume')::numeric not between 0 and 100
        or trunc((v_audio ->> 'bgmVolume')::numeric) <> (v_audio ->> 'bgmVolume')::numeric
      )
    )
    or (
      v_audio ? 'sfxVolume'
      and (
        jsonb_typeof(v_audio -> 'sfxVolume') <> 'number'
        or (v_audio ->> 'sfxVolume')::numeric not between 0 and 100
        or trunc((v_audio ->> 'sfxVolume')::numeric) <> (v_audio ->> 'sfxVolume')::numeric
      )
    )
    or (
      v_audio ? 'bgmEnabled'
      and jsonb_typeof(v_audio -> 'bgmEnabled') <> 'boolean'
    )
    or (
      v_audio ? 'sfxEnabled'
      and jsonb_typeof(v_audio -> 'sfxEnabled') <> 'boolean'
    )
  ) then
    perform public.private_log_security_event_v3('invalid_preference_audio', '{}'::jsonb);
    v_response := jsonb_build_object('ok', false, 'code', 'INVALID_PREFERENCES');
    return public.private_store_receipt_v3(
      v_request_id,
      'save_student_preferences_v3',
      v_response
    );
  end if;

  if v_tutorial is not null and (
    jsonb_typeof(v_tutorial) is distinct from 'object'
    or octet_length(v_tutorial::text) > 8192
  ) then
    perform public.private_log_security_event_v3('invalid_preference_tutorial', '{}'::jsonb);
    v_response := jsonb_build_object('ok', false, 'code', 'INVALID_PREFERENCES');
    return public.private_store_receipt_v3(
      v_request_id,
      'save_student_preferences_v3',
      v_response
    );
  end if;

  update public.player_preferences_v3
  set
    shirt_color = case when v_appearance ? 'shirt' then v_appearance ->> 'shirt' else shirt_color end,
    pants_color = case when v_appearance ? 'pants' then v_appearance ->> 'pants' else pants_color end,
    hair_color = case when v_appearance ? 'hair' then v_appearance ->> 'hair' else hair_color end,
    hair_style = case when v_appearance ? 'hairStyle' then v_appearance ->> 'hairStyle' else hair_style end,
    skin_color = case when v_appearance ? 'skin' then v_appearance ->> 'skin' else skin_color end,
    accessory = case when v_appearance ? 'accessory' then v_appearance ->> 'accessory' else accessory end,
    bgm_volume = case when v_audio ? 'bgmVolume' then (v_audio ->> 'bgmVolume')::integer else bgm_volume end,
    sfx_volume = case when v_audio ? 'sfxVolume' then (v_audio ->> 'sfxVolume')::integer else sfx_volume end,
    bgm_enabled = case when v_audio ? 'bgmEnabled' then (v_audio ->> 'bgmEnabled')::boolean else bgm_enabled end,
    sfx_enabled = case when v_audio ? 'sfxEnabled' then (v_audio ->> 'sfxEnabled')::boolean else sfx_enabled end,
    tutorial_acknowledgements = coalesce(v_tutorial, tutorial_acknowledgements),
    updated_at = now()
  where user_id = v_user_id;

  update public.player_core_v3
  set revision = revision + 1, updated_at = now()
  where user_id = v_user_id;

  v_response := jsonb_build_object(
    'ok', true,
    'code', 'OK',
    'snapshot', public.private_build_student_snapshot_v3(v_user_id)
  );
  return public.private_store_receipt_v3(
    v_request_id,
    'save_student_preferences_v3',
    v_response
  );
end;
$$;

create or replace function public.transition_student_map_v3(
  p_target_map text,
  p_expected_revision bigint,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_receipt jsonb;
  v_response jsonb;
  v_current_map text;
  v_level integer;
  v_current_revision bigint;
  v_allowed boolean := false;
  v_request_id uuid;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED');
  end if;
  if public.private_is_teacher_v3() then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if p_request_id is null or p_request_id !~* '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89ab][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then
    perform public.private_log_security_event_v3('invalid_request_id', '{}'::jsonb);
    return jsonb_build_object('ok', false, 'code', 'INVALID_REQUEST');
  end if;
  v_request_id := p_request_id::uuid;

  v_receipt := public.private_read_receipt_v3(
    v_request_id,
    'transition_student_map_v3'
  );
  if v_receipt is not null then
    return v_receipt;
  end if;

  select c.current_map, c.level, c.revision
  into v_current_map, v_level, v_current_revision
  from public.player_core_v3 as c
  where c.user_id = v_user_id
  for update;

  if v_current_revision is null then
    v_response := jsonb_build_object('ok', false, 'code', 'CHARACTER_NOT_FOUND');
    return public.private_store_receipt_v3(
      v_request_id,
      'transition_student_map_v3',
      v_response
    );
  end if;

  if p_expected_revision is distinct from v_current_revision then
    perform public.private_log_security_event_v3(
      'map_revision_conflict',
      jsonb_build_object('current_revision', v_current_revision)
    );
    v_response := jsonb_build_object(
      'ok', false,
      'code', 'REVISION_CONFLICT',
      'snapshot', public.private_build_student_snapshot_v3(v_user_id)
    );
    return public.private_store_receipt_v3(
      v_request_id,
      'transition_student_map_v3',
      v_response
    );
  end if;

  if p_target_map is null or p_target_map not in (
    'town',
    'equipmentShop',
    'buildingShopInterior',
    'petShopInterior',
    'upgradeShopInterior',
    'forest',
    'desert',
    'swamp',
    'bossRoom',
    'finalBossRoom'
  ) then
    perform public.private_log_security_event_v3('invalid_map_name', '{}'::jsonb);
    v_response := jsonb_build_object('ok', false, 'code', 'INVALID_MAP');
    return public.private_store_receipt_v3(
      v_request_id,
      'transition_student_map_v3',
      v_response
    );
  end if;

  if p_target_map in ('bossRoom', 'finalBossRoom') then
    perform public.private_log_security_event_v3(
      'locked_map_entry',
      jsonb_build_object('target_map', p_target_map)
    );
    v_response := jsonb_build_object('ok', false, 'code', 'LOCKED_MAP');
    return public.private_store_receipt_v3(
      v_request_id,
      'transition_student_map_v3',
      v_response
    );
  end if;

  if p_target_map = 'desert' and v_level < 4 then
    perform public.private_log_security_event_v3(
      'map_level_gate',
      jsonb_build_object('target_map', 'desert', 'required_level', 4)
    );
    v_response := jsonb_build_object('ok', false, 'code', 'LEVEL_REQUIRED');
    return public.private_store_receipt_v3(
      v_request_id,
      'transition_student_map_v3',
      v_response
    );
  end if;

  if p_target_map = 'swamp' and v_level < 7 then
    perform public.private_log_security_event_v3(
      'map_level_gate',
      jsonb_build_object('target_map', 'swamp', 'required_level', 7)
    );
    v_response := jsonb_build_object('ok', false, 'code', 'LEVEL_REQUIRED');
    return public.private_store_receipt_v3(
      v_request_id,
      'transition_student_map_v3',
      v_response
    );
  end if;

  v_allowed := (
    v_current_map = 'town'
    and p_target_map in (
      'equipmentShop',
      'buildingShopInterior',
      'petShopInterior',
      'upgradeShopInterior',
      'forest',
      'desert',
      'swamp'
    )
  ) or (
    v_current_map <> 'town'
    and v_current_map not in ('bossRoom', 'finalBossRoom')
    and p_target_map = 'town'
  );

  if not v_allowed then
    perform public.private_log_security_event_v3(
      'invalid_map_transition',
      jsonb_build_object('from_map', v_current_map, 'target_map', p_target_map)
    );
    v_response := jsonb_build_object('ok', false, 'code', 'INVALID_MAP_TRANSITION');
    return public.private_store_receipt_v3(
      v_request_id,
      'transition_student_map_v3',
      v_response
    );
  end if;

  update public.player_core_v3
  set
    current_map = p_target_map,
    revision = revision + 1,
    updated_at = now()
  where user_id = v_user_id;

  v_response := jsonb_build_object(
    'ok', true,
    'code', 'OK',
    'snapshot', public.private_build_student_snapshot_v3(v_user_id)
  );
  return public.private_store_receipt_v3(
    v_request_id,
    'transition_student_map_v3',
    v_response
  );
end;
$$;

create or replace function public.cleanup_server_authority_v3()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipts_deleted integer;
  v_events_deleted integer;
begin
  if not public.private_is_teacher_v3() then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  delete from public.game_action_receipts_v3
  where created_at < now() - interval '7 days';
  get diagnostics v_receipts_deleted = row_count;

  delete from public.security_events_v3
  where created_at < now() - interval '30 days';
  get diagnostics v_events_deleted = row_count;

  return jsonb_build_object(
    'ok', true,
    'receipts_deleted', v_receipts_deleted,
    'events_deleted', v_events_deleted
  );
end;
$$;

revoke all on function public.save_student_preferences_v3(jsonb, bigint, text)
  from public, anon;
revoke all on function public.transition_student_map_v3(text, bigint, text)
  from public, anon;
revoke all on function public.cleanup_server_authority_v3()
  from public, anon;
grant execute on function public.save_student_preferences_v3(jsonb, bigint, text)
  to authenticated;
grant execute on function public.transition_student_map_v3(text, bigint, text)
  to authenticated;
grant execute on function public.cleanup_server_authority_v3()
  to authenticated;

create or replace function public.list_security_events_v3(
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(100, greatest(1, coalesce(p_limit, 50)));
  v_events jsonb;
begin
  if not public.private_is_teacher_v3() then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  select coalesce(jsonb_agg(event_row order by event_row.created_at desc), '[]'::jsonb)
  into v_events
  from (
    select
      e.id,
      e.user_id,
      e.event_type,
      e.details,
      e.created_at
    from public.security_events_v3 as e
    order by e.created_at desc
    limit v_limit
  ) as event_row;

  return jsonb_build_object('ok', true, 'events', v_events);
end;
$$;

create or replace function public.reset_student_character_v3(
  p_user_id uuid,
  p_teacher_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display_name text;
begin
  if p_user_id is null or p_teacher_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_REQUEST');
  end if;

  if not exists (
    select 1
    from auth.users as teacher_user
    where teacher_user.id = p_teacher_user_id
      and teacher_user.raw_app_meta_data ->> 'role' = 'teacher'
  ) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  select p.display_name
  into v_display_name
  from public.player_profiles_v2 as p
  where p.user_id = p_user_id
  for update;

  if v_display_name is null then
    return jsonb_build_object('ok', false, 'code', 'STUDENT_NOT_FOUND');
  end if;

  delete from public.game_action_receipts_v3
  where user_id = p_user_id;

  delete from public.player_core_v3
  where user_id = p_user_id;

  insert into public.security_events_v3(user_id, event_type, details)
  values (
    p_user_id,
    'teacher_reset_character',
    jsonb_build_object('teacher_user_id', p_teacher_user_id)
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'OK',
    'display_name', v_display_name
  );
end;
$$;

revoke all on function public.list_security_events_v3(integer)
  from public, anon;
grant execute on function public.list_security_events_v3(integer)
  to authenticated;

revoke all on function public.reset_student_character_v3(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.reset_student_character_v3(uuid, uuid)
  to service_role;
