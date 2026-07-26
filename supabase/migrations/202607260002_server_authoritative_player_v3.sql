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
