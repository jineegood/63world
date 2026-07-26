-- Phase 3: private server-authoritative ordinary PvE combat state.
-- Apply only in the same maintenance window as the compatible Edge and web
-- deployments because students lose direct workbook-answer reads here.

create table if not exists public.game_monster_catalog_v3 (
  monster_key text primary key
    check (char_length(monster_key) between 1 and 80)
    check (monster_key ~ '^[a-z0-9][a-z0-9_]*$'),
  map_name text not null
    check (map_name in ('forest', 'desert', 'swamp', 'bossRoom', 'finalBossRoom')),
  monster_type text not null
    check (char_length(monster_type) between 1 and 40)
    check (monster_type ~ '^[A-Za-z][A-Za-z0-9_]*$'),
  level integer not null check (level between 1 and 99),
  hp_min integer not null check (hp_min between 1 and 1000000),
  hp_max integer not null check (hp_max between hp_min and 1000000),
  attack_min integer not null check (attack_min between 0 and 100000),
  attack_max integer not null check (attack_max between attack_min and 100000),
  exp_reward integer not null check (exp_reward between 0 and 100000),
  gold_reward integer not null check (gold_reward between 0 and 100000),
  elite boolean not null default false,
  boss boolean not null default false,
  patterns jsonb not null default '[]'::jsonb
    check (jsonb_typeof(patterns) = 'array')
    check (octet_length(patterns::text) <= 8192)
);

create table if not exists public.player_combat_sessions_v3 (
  user_id uuid primary key
    references public.player_core_v3(user_id) on delete cascade,
  combat_id uuid not null default gen_random_uuid() unique,
  monster_key text not null
    references public.game_monster_catalog_v3(monster_key),
  player_revision bigint not null check (player_revision >= 1),
  session_revision bigint not null default 1 check (session_revision >= 1),
  turn_number integer not null default 0 check (turn_number between 0 and 10000),
  status text not null default 'active'
    check (status in ('active', 'resolved')),
  player_hp integer not null check (player_hp between 0 and 1000000),
  player_max_hp integer not null check (player_max_hp between 1 and 1000000),
  player_shield integer not null default 0 check (player_shield between 0 and 1000000),
  monster_hp integer not null check (monster_hp between 0 and 1000000),
  monster_max_hp integer not null check (monster_max_hp between 1 and 1000000),
  monster_shield integer not null default 0 check (monster_shield between 0 and 1000000),
  player_statuses jsonb not null default '{}'::jsonb
    check (jsonb_typeof(player_statuses) = 'object')
    check (octet_length(player_statuses::text) <= 8192),
  monster_statuses jsonb not null default '{}'::jsonb
    check (jsonb_typeof(monster_statuses) = 'object')
    check (octet_length(monster_statuses::text) <= 8192),
  cooldowns jsonb not null default '{}'::jsonb
    check (jsonb_typeof(cooldowns) = 'object')
    check (octet_length(cooldowns::text) <= 8192),
  safe_question jsonb not null
    check (jsonb_typeof(safe_question) = 'object')
    check (octet_length(safe_question::text) <= 16384),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  check (player_hp <= player_max_hp),
  check (monster_hp <= monster_max_hp)
);

create index if not exists player_combat_sessions_v3_expires_idx
  on public.player_combat_sessions_v3(expires_at);

create table if not exists public.player_combat_question_secrets_v3 (
  user_id uuid primary key
    references public.player_combat_sessions_v3(user_id) on delete cascade,
  question_token uuid not null default gen_random_uuid(),
  workbook_id text not null check (char_length(workbook_id) between 1 and 120),
  question_id text not null check (char_length(question_id) between 1 and 120),
  answer_key text not null check (char_length(answer_key) between 1 and 512),
  created_at timestamptz not null default now(),
  unique (question_token)
);

create table if not exists public.player_question_stats_v3 (
  user_id uuid primary key
    references public.player_core_v3(user_id) on delete cascade,
  answered integer not null default 0 check (answered between 0 and 100000000),
  correct integer not null default 0 check (correct between 0 and answered),
  updated_at timestamptz not null default now()
);

create table if not exists public.player_wrong_answers_v3 (
  id bigint generated always as identity primary key,
  user_id uuid not null
    references public.player_core_v3(user_id) on delete cascade,
  question_id text not null check (char_length(question_id) between 1 and 120),
  prompt text not null check (char_length(prompt) between 1 and 1000),
  correct_answer text not null check (char_length(correct_answer) between 1 and 512),
  given_answer text not null check (char_length(given_answer) between 0 and 512),
  created_at timestamptz not null default now()
);

create index if not exists player_wrong_answers_v3_user_created_idx
  on public.player_wrong_answers_v3(user_id, created_at desc, id desc);

alter table public.game_monster_catalog_v3 enable row level security;
alter table public.game_monster_catalog_v3 force row level security;
alter table public.player_combat_sessions_v3 enable row level security;
alter table public.player_combat_sessions_v3 force row level security;
alter table public.player_combat_question_secrets_v3 enable row level security;
alter table public.player_combat_question_secrets_v3 force row level security;
alter table public.player_question_stats_v3 enable row level security;
alter table public.player_question_stats_v3 force row level security;
alter table public.player_wrong_answers_v3 enable row level security;
alter table public.player_wrong_answers_v3 force row level security;

revoke all on table public.game_monster_catalog_v3 from public, anon, authenticated;
revoke all on table public.player_combat_sessions_v3 from public, anon, authenticated;
revoke all on table public.player_combat_question_secrets_v3 from public, anon, authenticated;
revoke all on table public.player_question_stats_v3 from public, anon, authenticated;
revoke all on table public.player_wrong_answers_v3 from public, anon, authenticated;

-- Remove the student policy that exposed full workbook rows and answer keys.
drop policy if exists "authenticated users read fixed shared state v2"
  on public.shared_state_v2;
drop policy if exists "authenticated users read classroom settings v3"
  on public.shared_state_v2;
create policy "authenticated users read classroom settings v3"
on public.shared_state_v2
for select
to authenticated
using (key = 'classroom_settings');

drop policy if exists "teachers administer shared state v2"
  on public.shared_state_v2;
drop policy if exists "teachers administer shared state for combat v3"
  on public.shared_state_v2;
create policy "teachers administer shared state for combat v3"
on public.shared_state_v2
for all
to authenticated
using ((select public.is_teacher()))
with check ((select public.is_teacher()));

-- BEGIN GENERATED COMBAT MONSTER CATALOG V3
-- Generated by tools/generate-combat-catalog-v3.mjs. Do not edit.
-- monsters: 6

insert into public.game_monster_catalog_v3
  (monster_key, map_name, monster_type, level, hp_min, hp_max, attack_min, attack_max, exp_reward, gold_reward, elite, boss, patterns)
values
('desert_snake','desert','snake',7,59,64,10,13,9,12,false,false,'[{"chance":0.25,"kind":"poison","turns":3},{"chance":0.15,"kind":"critical"}]'::jsonb),
('desert_stomp','desert','stomp',5,41,44,7,9,6,9,false,false,'[{"chance":0.25,"kind":"heavy","multiplier":1.5,"stunTurns":1},{"chance":0.2,"kind":"selfShield","percent":0.3}]'::jsonb),
('forest_mushroom','forest','mushroom',1,9,11,2,4,1,2,false,false,'[{"chance":0.22,"kind":"poison","turns":2}]'::jsonb),
('forest_slime','forest','slime',3,20,23,3,5,3,4,false,false,'[{"chance":0.25,"kind":"selfShield","percent":0.35}]'::jsonb),
('swamp_tarantula','swamp','tarantula',9,62,66,11,13,12,15,false,false,'[{"chance":0.3,"kind":"multi","hits":2,"multiplier":0.62},{"chance":0.2,"kind":"heavy","multiplier":1.3,"stunTurns":1}]'::jsonb),
('swamp_zombie','swamp','zombie',11,91,95,24,28,16,20,false,false,'[{"chance":0.25,"kind":"lifesteal","percent":1}]'::jsonb)
on conflict (monster_key) do update set
  map_name = excluded.map_name, monster_type = excluded.monster_type,
  level = excluded.level, hp_min = excluded.hp_min, hp_max = excluded.hp_max,
  attack_min = excluded.attack_min, attack_max = excluded.attack_max,
  exp_reward = excluded.exp_reward, gold_reward = excluded.gold_reward,
  elite = excluded.elite, boss = excluded.boss, patterns = excluded.patterns;
-- END GENERATED COMBAT MONSTER CATALOG V3
