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
  monster_attack integer not null check (monster_attack between 0 and 100000),
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

create or replace function public.private_require_service_role_v3()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
end;
$$;

create or replace function public.private_build_safe_combat_session_v3(
  p_user_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'combatId', s.combat_id,
    'monsterKey', s.monster_key,
    'playerRevision', s.player_revision,
    'sessionRevision', s.session_revision,
    'turnNumber', s.turn_number,
    'status', s.status,
    'playerHp', s.player_hp,
    'playerMaxHp', s.player_max_hp,
    'playerShield', s.player_shield,
    'monsterHp', s.monster_hp,
    'monsterMaxHp', s.monster_max_hp,
    'monsterAttack', s.monster_attack,
    'monsterShield', s.monster_shield,
    'playerStatuses', s.player_statuses,
    'monsterStatuses', s.monster_statuses,
    'cooldowns', s.cooldowns,
    'question', s.safe_question,
    'expiresAt', s.expires_at
  )
  from public.player_combat_sessions_v3 as s
  where s.user_id = p_user_id
    and s.status = 'active';
$$;

create or replace function public.private_read_combatant_v3(
  p_user_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'className', c.class_name,
    'spec', c.spec,
    'level', c.level,
    'exp', c.exp,
    'gold', c.gold,
    'currentHp', c.current_hp,
    'maxHp', c.max_hp,
    'revision', c.revision,
    'activePet', c.active_pet,
    'inventory', coalesce((
      select jsonb_agg(jsonb_build_object(
        'itemId', i.item_definition_id,
        'equippedSlot', i.equipped_slot,
        'enhancementTier', i.enhancement_tier,
        'inventoryKind', i.inventory_kind
      ) order by i.item_definition_id, i.id)
      from public.player_inventory_v3 as i
      where i.user_id = c.user_id
        and i.inventory_kind = 'gear'
    ), '[]'::jsonb),
    'skills', coalesce((
      select jsonb_object_agg(s.skill_id, s.rank)
      from public.player_skills_v3 as s
      where s.user_id = c.user_id
        and s.rank > 0
    ), '{}'::jsonb),
    'pets', coalesce((
      select jsonb_agg(p.pet_id order by p.pet_id)
      from public.player_pets_v3 as p
      where p.user_id = c.user_id
    ), '[]'::jsonb)
  )
  from public.player_core_v3 as c
  where c.user_id = p_user_id;
$$;

create or replace function public.private_pick_combat_question_v3(
  p_map_name text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_zone text;
  v_question jsonb;
begin
  v_zone := case p_map_name
    when 'forest' then 'silent_forest'
    when 'desert' then 'desert_wasteland'
    when 'swamp' then 'spooky_swamp'
    else null
  end;
  if v_zone is null then
    raise exception using errcode = 'P0001', message = 'NO_QUESTIONS';
  end if;

  select jsonb_build_object(
    'workbookId', wb.value ->> 'id',
    'questionId', q.value ->> 'id',
    'prompt', q.value ->> 'q',
    'choices', case
      when jsonb_typeof(q.value -> 'choices') = 'array' then q.value -> 'choices'
      else '[]'::jsonb
    end,
    'subject', coalesce(q.value ->> 'subject', wb.value ->> 'subject', ''),
    'source', coalesce(q.value ->> 'source', ''),
    'answerKey', q.value ->> 'answer'
  )
  into v_question
  from public.shared_state_v2 as shared
  cross join lateral jsonb_array_elements(coalesce(shared.data -> 'items', '[]'::jsonb)) as wb(value)
  cross join lateral jsonb_array_elements(coalesce(wb.value -> 'questions', '[]'::jsonb)) as q(value)
  where shared.key = 'workbooks'
    and coalesce(wb.value ->> 'enabled', 'true') = 'true'
    and coalesce(q.value ->> 'zone', wb.value ->> 'zone', '') = v_zone
    and char_length(coalesce(wb.value ->> 'id', '')) between 1 and 120
    and char_length(coalesce(q.value ->> 'id', '')) between 1 and 120
    and char_length(coalesce(q.value ->> 'q', '')) between 1 and 1000
    and char_length(coalesce(q.value ->> 'answer', '')) between 1 and 512
  order by pg_catalog.random()
  limit 1;

  if v_question is null then
    raise exception using errcode = 'P0001', message = 'NO_QUESTIONS';
  end if;
  return v_question;
end;
$$;

create or replace function public.private_start_student_combat_v3(
  p_user_id uuid,
  p_monster_key text,
  p_state jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id uuid;
  v_receipt record;
  v_core public.player_core_v3%rowtype;
  v_monster public.game_monster_catalog_v3%rowtype;
  v_existing jsonb;
  v_question jsonb;
  v_safe_question jsonb;
  v_question_token uuid := gen_random_uuid();
  v_response jsonb;
  v_player_hp integer;
  v_player_max_hp integer;
  v_monster_hp integer;
  v_monster_max_hp integer;
  v_monster_attack integer;
begin
  perform public.private_require_service_role_v3();
  if p_user_id is null
    or p_request_id is null
    or p_request_id !~* '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89ab][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
    or jsonb_typeof(p_state) <> 'object'
    or octet_length(p_state::text) > 32768
  then
    raise exception using errcode = '22023', message = 'INVALID_REQUEST';
  end if;
  v_request_id := p_request_id::uuid;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text || ':' || v_request_id::text, 0)
  );

  select r.action_name, r.response_json into v_receipt
  from public.game_action_receipts_v3 as r
  where r.user_id = p_user_id and r.request_id = v_request_id;
  if found then
    if v_receipt.action_name <> 'private_start_student_combat_v3' then
      return jsonb_build_object('ok', false, 'code', 'REQUEST_ID_REUSED');
    end if;
    return v_receipt.response_json;
  end if;

  select c.* into v_core
  from public.player_core_v3 as c
  where c.user_id = p_user_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'PLAYER_NOT_FOUND';
  end if;

  if exists (
    select 1 from public.player_combat_sessions_v3 as s
    where s.user_id = p_user_id and s.expires_at <= now()
  ) then
    delete from public.player_combat_sessions_v3 where user_id = p_user_id;
  end if;
  v_existing := public.private_build_safe_combat_session_v3(p_user_id);
  if v_existing is not null then
    v_response := jsonb_build_object(
      'ok', true,
      'resumed', true,
      'session', v_existing,
      'player', public.private_build_student_snapshot_v3(p_user_id)
    );
    insert into public.game_action_receipts_v3(user_id, request_id, action_name, response_json)
    values (p_user_id, v_request_id, 'private_start_student_combat_v3', v_response);
    return v_response;
  end if;

  select m.* into v_monster
  from public.game_monster_catalog_v3 as m
  where m.monster_key = p_monster_key;
  if not found then
    raise exception using errcode = 'P0001', message = 'UNKNOWN_MONSTER';
  end if;
  if v_core.current_map <> v_monster.map_name then
    raise exception using errcode = 'P0001', message = 'MONSTER_MAP_MISMATCH';
  end if;

  begin
    v_player_hp := (p_state ->> 'playerHp')::integer;
    v_player_max_hp := (p_state ->> 'playerMaxHp')::integer;
    v_monster_hp := (p_state ->> 'monsterHp')::integer;
    v_monster_max_hp := (p_state ->> 'monsterMaxHp')::integer;
    v_monster_attack := (p_state ->> 'monsterAttack')::integer;
  exception when others then
    raise exception using errcode = '22023', message = 'INVALID_COMBAT_STATE';
  end;
  if v_player_max_hp not between 1 and 1000000
    or v_player_hp <> least(v_core.current_hp, v_player_max_hp)
    or v_monster_hp <> v_monster_max_hp
    or v_monster_hp not between v_monster.hp_min and v_monster.hp_max
    or v_monster_attack not between v_monster.attack_min and v_monster.attack_max
  then
    raise exception using errcode = '22023', message = 'INVALID_COMBAT_STATE';
  end if;
  if v_player_max_hp <> v_core.max_hp then
    update public.player_core_v3
    set max_hp = v_player_max_hp,
        current_hp = least(current_hp, v_player_max_hp),
        revision = revision + 1,
        updated_at = now()
    where user_id = p_user_id
    returning * into v_core;
  end if;

  v_question := public.private_pick_combat_question_v3(v_monster.map_name);
  v_safe_question := (v_question - 'answerKey') || jsonb_build_object('questionToken', v_question_token);

  insert into public.player_combat_sessions_v3(
    user_id, monster_key, player_revision, session_revision, turn_number, status,
    player_hp, player_max_hp, player_shield,
    monster_hp, monster_max_hp, monster_attack, monster_shield,
    player_statuses, monster_statuses, cooldowns, safe_question, expires_at
  ) values (
    p_user_id, p_monster_key, v_core.revision, 1, 0, 'active',
    v_player_hp, v_player_max_hp, 0,
    v_monster_hp, v_monster_max_hp, v_monster_attack, 0,
    coalesce(p_state -> 'playerStatuses', '{}'::jsonb),
    coalesce(p_state -> 'monsterStatuses', '{}'::jsonb),
    coalesce(p_state -> 'cooldowns', '{}'::jsonb),
    v_safe_question, now() + interval '30 minutes'
  );
  insert into public.player_combat_question_secrets_v3(
    user_id, question_token, workbook_id, question_id, answer_key
  ) values (
    p_user_id, v_question_token, v_question ->> 'workbookId',
    v_question ->> 'questionId', v_question ->> 'answerKey'
  );

  v_response := jsonb_build_object(
    'ok', true,
    'resumed', false,
    'session', public.private_build_safe_combat_session_v3(p_user_id),
    'player', public.private_build_student_snapshot_v3(p_user_id)
  );
  insert into public.game_action_receipts_v3(user_id, request_id, action_name, response_json)
  values (p_user_id, v_request_id, 'private_start_student_combat_v3', v_response);
  return v_response;
end;
$$;

create or replace function public.private_prepare_student_combat_turn_v3(
  p_user_id uuid,
  p_question_token uuid,
  p_expected_session_revision bigint,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.player_combat_sessions_v3%rowtype;
  v_core public.player_core_v3%rowtype;
  v_secret public.player_combat_question_secrets_v3%rowtype;
  v_request_uuid uuid;
  v_receipt record;
begin
  perform public.private_require_service_role_v3();
  if p_user_id is null or p_question_token is null
    or p_request_id is null
    or p_request_id !~* '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89ab][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
  then
    raise exception using errcode = '22023', message = 'INVALID_REQUEST';
  end if;
  v_request_uuid := p_request_id::uuid;
  select r.action_name, r.response_json into v_receipt
  from public.game_action_receipts_v3 as r
  where r.user_id = p_user_id and r.request_id = v_request_uuid;
  if found then
    if v_receipt.action_name <> 'private_commit_student_combat_turn_v3' then
      return jsonb_build_object('replayed', true, 'response',
        jsonb_build_object('ok', false, 'code', 'REQUEST_ID_REUSED'));
    end if;
    return jsonb_build_object('replayed', true, 'response', v_receipt.response_json);
  end if;

  select s.* into v_session
  from public.player_combat_sessions_v3 as s
  where s.user_id = p_user_id and s.status = 'active'
  for update;
  if not found then raise exception using errcode = 'P0001', message = 'COMBAT_NOT_ACTIVE'; end if;
  if v_session.session_revision <> p_expected_session_revision then
    raise exception using errcode = 'P0001', message = 'SESSION_REVISION_CONFLICT';
  end if;

  select c.* into v_core
  from public.player_core_v3 as c
  where c.user_id = p_user_id
  for update;
  if v_core.revision <> v_session.player_revision then
    raise exception using errcode = 'P0001', message = 'PLAYER_REVISION_CONFLICT';
  end if;

  select q.* into v_secret
  from public.player_combat_question_secrets_v3 as q
  where q.user_id = p_user_id and q.question_token = p_question_token;
  if not found then raise exception using errcode = 'P0001', message = 'QUESTION_TOKEN_MISMATCH'; end if;

  return jsonb_build_object(
    'replayed', false,
    'session', public.private_build_safe_combat_session_v3(p_user_id),
    'answerKey', v_secret.answer_key,
    'questionId', v_secret.question_id,
    'player', public.private_read_combatant_v3(p_user_id)
  );
end;
$$;

create or replace function public.private_commit_student_combat_turn_v3(
  p_user_id uuid,
  p_expected_session_revision bigint,
  p_expected_player_revision bigint,
  p_request_id text,
  p_outcome jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id uuid;
  v_receipt record;
  v_session public.player_combat_sessions_v3%rowtype;
  v_core public.player_core_v3%rowtype;
  v_secret public.player_combat_question_secrets_v3%rowtype;
  v_monster public.game_monster_catalog_v3%rowtype;
  v_state jsonb;
  v_kind text;
  v_correct boolean;
  v_question jsonb;
  v_safe_question jsonb;
  v_question_token uuid;
  v_response jsonb;
  v_new_exp integer;
  v_new_level integer;
  v_new_max_hp integer;
  v_building integer;
  v_gold_loss integer;
  v_level_floor integer;
begin
  perform public.private_require_service_role_v3();
  if p_user_id is null
    or p_request_id is null
    or p_request_id !~* '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89ab][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
    or jsonb_typeof(p_outcome) <> 'object'
    or octet_length(p_outcome::text) > 65536
  then
    raise exception using errcode = '22023', message = 'INVALID_OUTCOME';
  end if;
  v_request_id := p_request_id::uuid;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text || ':' || v_request_id::text, 0)
  );
  select r.action_name, r.response_json into v_receipt
  from public.game_action_receipts_v3 as r
  where r.user_id = p_user_id and r.request_id = v_request_id;
  if found then
    if v_receipt.action_name <> 'private_commit_student_combat_turn_v3' then
      return jsonb_build_object('ok', false, 'code', 'REQUEST_ID_REUSED');
    end if;
    return v_receipt.response_json;
  end if;

  select s.* into v_session
  from public.player_combat_sessions_v3 as s
  where s.user_id = p_user_id and s.status = 'active'
  for update;
  if not found then raise exception using errcode = 'P0001', message = 'COMBAT_NOT_ACTIVE'; end if;
  select c.* into v_core
  from public.player_core_v3 as c
  where c.user_id = p_user_id
  for update;
  if v_session.session_revision <> p_expected_session_revision then
    raise exception using errcode = 'P0001', message = 'SESSION_REVISION_CONFLICT';
  end if;
  if v_core.revision <> p_expected_player_revision
    or v_session.player_revision <> p_expected_player_revision
  then
    raise exception using errcode = 'P0001', message = 'PLAYER_REVISION_CONFLICT';
  end if;
  select q.* into v_secret
  from public.player_combat_question_secrets_v3 as q
  where q.user_id = p_user_id;
  if not found then raise exception using errcode = 'P0001', message = 'QUESTION_MISSING'; end if;
  select m.* into v_monster
  from public.game_monster_catalog_v3 as m
  where m.monster_key = v_session.monster_key;

  v_state := p_outcome -> 'state';
  v_kind := p_outcome ->> 'outcome';
  v_correct := coalesce((p_outcome ->> 'correct')::boolean, false);
  if jsonb_typeof(v_state) <> 'object'
    or v_kind not in ('continue', 'victory', 'defeat')
    or v_state ->> 'monsterKey' <> v_session.monster_key
    or (v_state ->> 'turnNumber')::integer <> v_session.turn_number + case when v_kind = 'victory' then 0 else 1 end
    or (v_state ->> 'playerHp')::integer not between 0 and v_session.player_max_hp
    or (v_state ->> 'monsterHp')::integer not between 0 and v_session.monster_max_hp
    or (v_state ->> 'playerShield')::integer not between 0 and 1000000
    or (v_state ->> 'monsterShield')::integer not between 0 and 1000000
    or jsonb_typeof(coalesce(v_state -> 'playerStatuses', '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(v_state -> 'monsterStatuses', '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(v_state -> 'cooldowns', '{}'::jsonb)) <> 'object'
  then
    raise exception using errcode = '22023', message = 'INVALID_OUTCOME';
  end if;

  insert into public.player_question_stats_v3(user_id, answered, correct)
  values (p_user_id, 1, case when v_correct then 1 else 0 end)
  on conflict (user_id) do update set
    answered = public.player_question_stats_v3.answered + 1,
    correct = public.player_question_stats_v3.correct + case when v_correct then 1 else 0 end,
    updated_at = now();
  if not v_correct then
    insert into public.player_wrong_answers_v3(
      user_id, question_id, prompt, correct_answer, given_answer
    ) values (
      p_user_id, v_secret.question_id,
      left(coalesce(v_session.safe_question ->> 'prompt', '?'), 1000),
      v_secret.answer_key,
      left(coalesce(p_outcome ->> 'submittedAnswer', ''), 512)
    );
    delete from public.player_wrong_answers_v3
    where id in (
      select old.id
      from public.player_wrong_answers_v3 as old
      where old.user_id = p_user_id
      order by old.created_at desc, old.id desc
      offset 30
    );
  end if;

  if v_kind = 'continue' then
    v_question := public.private_pick_combat_question_v3(v_monster.map_name);
    v_question_token := gen_random_uuid();
    v_safe_question := (v_question - 'answerKey') || jsonb_build_object('questionToken', v_question_token);
    update public.player_combat_sessions_v3
    set session_revision = session_revision + 1,
        turn_number = (v_state ->> 'turnNumber')::integer,
        player_hp = (v_state ->> 'playerHp')::integer,
        player_shield = (v_state ->> 'playerShield')::integer,
        monster_hp = (v_state ->> 'monsterHp')::integer,
        monster_shield = (v_state ->> 'monsterShield')::integer,
        player_statuses = coalesce(v_state -> 'playerStatuses', '{}'::jsonb),
        monster_statuses = coalesce(v_state -> 'monsterStatuses', '{}'::jsonb),
        cooldowns = coalesce(v_state -> 'cooldowns', '{}'::jsonb),
        safe_question = v_safe_question,
        updated_at = now(),
        expires_at = now() + interval '30 minutes'
    where user_id = p_user_id;
    update public.player_combat_question_secrets_v3
    set question_token = v_question_token,
        workbook_id = v_question ->> 'workbookId',
        question_id = v_question ->> 'questionId',
        answer_key = v_question ->> 'answerKey',
        created_at = now()
    where user_id = p_user_id;
    v_response := (p_outcome - 'state' - 'submittedAnswer') || jsonb_build_object(
      'ok', true,
      'session', public.private_build_safe_combat_session_v3(p_user_id)
    );
  elsif v_kind = 'victory' then
    if (p_outcome #>> '{rewards,exp}')::integer <> v_monster.exp_reward
      or (p_outcome #>> '{rewards,gold}')::integer <> v_monster.gold_reward
      or (p_outcome #>> '{rewards,building}')::integer not between 0 and 1
      or (v_state ->> 'monsterHp')::integer <> 0
    then
      raise exception using errcode = '22023', message = 'INVALID_REWARD';
    end if;
    v_building := (p_outcome #>> '{rewards,building}')::integer;
    v_new_exp := v_core.exp + v_monster.exp_reward;
    v_new_level := case
      when v_new_exp >= 700 then 10 when v_new_exp >= 580 then 10
      when v_new_exp >= 470 then 9 when v_new_exp >= 370 then 8
      when v_new_exp >= 280 then 7 when v_new_exp >= 200 then 6
      when v_new_exp >= 130 then 5 when v_new_exp >= 80 then 4
      when v_new_exp >= 40 then 3 when v_new_exp >= 10 then 2 else 1 end;
    v_new_level := greatest(v_core.level, least(10, v_new_level));
    v_new_max_hp := v_core.max_hp + (v_new_level - v_core.level) * 2;
    update public.player_core_v3
    set exp = v_new_exp,
        level = v_new_level,
        gold = gold + v_monster.gold_reward,
        building = building + v_building,
        max_hp = v_new_max_hp,
        current_hp = case when v_new_level > level then v_new_max_hp
          else (v_state ->> 'playerHp')::integer end,
        revision = revision + 1,
        updated_at = now()
    where user_id = p_user_id;
    delete from public.player_combat_sessions_v3 where user_id = p_user_id;
    v_response := (p_outcome - 'state' - 'submittedAnswer') || jsonb_build_object(
      'ok', true,
      'player', public.private_build_student_snapshot_v3(p_user_id)
    );
  else
    v_level_floor := case v_core.level
      when 10 then 580 when 9 then 470 when 8 then 370 when 7 then 280
      when 6 then 200 when 5 then 130 when 4 then 80 when 3 then 40
      when 2 then 10 else 0 end;
    v_new_exp := case when v_core.spec is null then v_core.exp
      else v_level_floor + floor((v_core.exp - v_level_floor) / 2.0 + 0.5)::integer end;
    v_gold_loss := floor(v_core.gold / 2.0)::integer;
    update public.player_core_v3
    set exp = greatest(v_level_floor, v_new_exp),
        gold = gold - v_gold_loss,
        current_hp = max_hp,
        current_map = 'town',
        revision = revision + 1,
        updated_at = now()
    where user_id = p_user_id;
    delete from public.player_combat_sessions_v3 where user_id = p_user_id;
    v_response := (p_outcome - 'state' - 'submittedAnswer') || jsonb_build_object(
      'ok', true,
      'death', jsonb_build_object('expAfter', greatest(v_level_floor, v_new_exp), 'goldLost', v_gold_loss),
      'player', public.private_build_student_snapshot_v3(p_user_id)
    );
  end if;

  insert into public.game_action_receipts_v3(user_id, request_id, action_name, response_json)
  values (p_user_id, v_request_id, 'private_commit_student_combat_turn_v3', v_response);
  return v_response;
end;
$$;

create or replace function public.private_surrender_student_combat_v3(
  p_user_id uuid,
  p_expected_session_revision bigint,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id uuid;
  v_receipt record;
  v_session public.player_combat_sessions_v3%rowtype;
  v_response jsonb;
begin
  perform public.private_require_service_role_v3();
  if p_user_id is null
    or p_request_id is null
    or p_request_id !~* '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89ab][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
  then raise exception using errcode = '22023', message = 'INVALID_REQUEST'; end if;
  v_request_id := p_request_id::uuid;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text || ':' || v_request_id::text, 0)
  );
  select r.action_name, r.response_json into v_receipt
  from public.game_action_receipts_v3 as r
  where r.user_id = p_user_id and r.request_id = v_request_id;
  if found then
    if v_receipt.action_name <> 'private_surrender_student_combat_v3' then
      return jsonb_build_object('ok', false, 'code', 'REQUEST_ID_REUSED');
    end if;
    return v_receipt.response_json;
  end if;
  select s.* into v_session
  from public.player_combat_sessions_v3 as s
  where s.user_id = p_user_id and s.status = 'active'
  for update;
  if not found then raise exception using errcode = 'P0001', message = 'COMBAT_NOT_ACTIVE'; end if;
  if v_session.session_revision <> p_expected_session_revision then
    raise exception using errcode = 'P0001', message = 'SESSION_REVISION_CONFLICT';
  end if;
  delete from public.player_combat_sessions_v3 where user_id = p_user_id;
  v_response := jsonb_build_object(
    'ok', true,
    'outcome', 'surrender',
    'rewards', jsonb_build_object('exp', 0, 'gold', 0, 'building', 0)
  );
  insert into public.game_action_receipts_v3(user_id, request_id, action_name, response_json)
  values (p_user_id, v_request_id, 'private_surrender_student_combat_v3', v_response);
  return v_response;
end;
$$;

create or replace function public.private_resume_student_combat_v3(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session jsonb;
begin
  perform public.private_require_service_role_v3();
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'INVALID_REQUEST';
  end if;
  if exists (
    select 1 from public.player_combat_sessions_v3 as s
    where s.user_id = p_user_id and s.expires_at <= now()
  ) then
    delete from public.player_combat_sessions_v3 where user_id = p_user_id;
    return jsonb_build_object('ok', true, 'session', null, 'expired', true);
  end if;
  v_session := public.private_build_safe_combat_session_v3(p_user_id);
  return jsonb_build_object('ok', true, 'session', v_session, 'expired', false);
end;
$$;

revoke all on function public.private_require_service_role_v3()
  from public, anon, authenticated;
revoke all on function public.private_build_safe_combat_session_v3(uuid)
  from public, anon, authenticated;
revoke all on function public.private_read_combatant_v3(uuid)
  from public, anon, authenticated;
revoke all on function public.private_pick_combat_question_v3(text)
  from public, anon, authenticated;
revoke all on function public.private_start_student_combat_v3(uuid, text, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.private_prepare_student_combat_turn_v3(uuid, uuid, bigint, text)
  from public, anon, authenticated;
revoke all on function public.private_commit_student_combat_turn_v3(uuid, bigint, bigint, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.private_surrender_student_combat_v3(uuid, bigint, text)
  from public, anon, authenticated;
revoke all on function public.private_resume_student_combat_v3(uuid)
  from public, anon, authenticated;

grant execute on function public.private_start_student_combat_v3(uuid, text, jsonb, text)
  to service_role;
grant execute on function public.private_prepare_student_combat_turn_v3(uuid, uuid, bigint, text)
  to service_role;
grant execute on function public.private_commit_student_combat_turn_v3(uuid, bigint, bigint, text, jsonb)
  to service_role;
grant execute on function public.private_surrender_student_combat_v3(uuid, bigint, text)
  to service_role;
grant execute on function public.private_resume_student_combat_v3(uuid)
  to service_role;
