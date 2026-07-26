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
language sql
stable
security definer
set search_path = ''
as $$
  select r.response_json
  from public.game_action_receipts_v3 as r
  where r.user_id = auth.uid()
    and r.request_id = p_request_id
    and r.action_name = p_action_name;
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
  v_existing integer;
  v_receipt jsonb;
  v_snapshot jsonb;
  v_response jsonb;
  v_starter_item text;
  v_max_hp integer;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED');
  end if;
  if public.private_is_teacher_v3() then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if p_request_id is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_REQUEST');
  end if;

  v_receipt := public.private_read_receipt_v3(
    p_request_id,
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
    values (v_user_id, p_request_id, 'create_student_character_v3', v_response)
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
  values (v_user_id, p_request_id, 'create_student_character_v3', v_response);

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

revoke all on function public.create_student_character_v3(text, jsonb, uuid)
  from public, anon;
revoke all on function public.load_student_game_v3()
  from public, anon;
grant execute on function public.create_student_character_v3(text, jsonb, uuid)
  to authenticated;
grant execute on function public.load_student_game_v3()
  to authenticated;
