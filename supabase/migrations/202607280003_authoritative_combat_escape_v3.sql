-- Server-authoritative PvE escape.
-- One failed attempt locks escape for that combat and the trusted Edge
-- function owns both the escape roll and the monster counterattack.

alter table public.player_combat_sessions_v3
  add column if not exists escape_failed boolean not null default false;

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
    'escapeFailed', s.escape_failed,
    'question', s.safe_question,
    'expiresAt', s.expires_at
  )
  from public.player_combat_sessions_v3 as s
  where s.user_id = p_user_id
    and s.status = 'active';
$$;

create or replace function public.private_prepare_student_combat_escape_v3(
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
  v_core public.player_core_v3%rowtype;
begin
  perform public.private_require_service_role_v3();
  if p_user_id is null
    or p_expected_session_revision is null
    or p_expected_session_revision < 1
    or p_request_id is null
    or p_request_id !~* '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89ab][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
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
    if v_receipt.action_name <> 'private_commit_student_combat_escape_v3' then
      return jsonb_build_object(
        'replayed', true,
        'response', jsonb_build_object('ok', false, 'code', 'REQUEST_ID_REUSED')
      );
    end if;
    return jsonb_build_object('replayed', true, 'response', v_receipt.response_json);
  end if;

  select s.* into v_session
  from public.player_combat_sessions_v3 as s
  where s.user_id = p_user_id and s.status = 'active'
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'COMBAT_NOT_ACTIVE';
  end if;
  if v_session.session_revision <> p_expected_session_revision then
    raise exception using errcode = 'P0001', message = 'SESSION_REVISION_CONFLICT';
  end if;
  if v_session.escape_failed then
    raise exception using errcode = 'P0001', message = 'ESCAPE_ALREADY_FAILED';
  end if;

  select c.* into v_core
  from public.player_core_v3 as c
  where c.user_id = p_user_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'PLAYER_NOT_FOUND';
  end if;
  if v_core.revision <> v_session.player_revision then
    raise exception using errcode = 'P0001', message = 'PLAYER_REVISION_CONFLICT';
  end if;

  return jsonb_build_object(
    'replayed', false,
    'session', public.private_build_safe_combat_session_v3(p_user_id),
    'player', public.private_read_combatant_v3(p_user_id)
  );
end;
$$;

create or replace function public.private_commit_student_combat_escape_v3(
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
  v_monster public.game_monster_catalog_v3%rowtype;
  v_state jsonb;
  v_kind text;
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
    or p_expected_session_revision is null
    or p_expected_session_revision < 1
    or p_expected_player_revision is null
    or p_expected_player_revision < 1
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
    if v_receipt.action_name <> 'private_commit_student_combat_escape_v3' then
      return jsonb_build_object('ok', false, 'code', 'REQUEST_ID_REUSED');
    end if;
    return v_receipt.response_json;
  end if;

  select s.* into v_session
  from public.player_combat_sessions_v3 as s
  where s.user_id = p_user_id and s.status = 'active'
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'COMBAT_NOT_ACTIVE';
  end if;
  select c.* into v_core
  from public.player_core_v3 as c
  where c.user_id = p_user_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'PLAYER_NOT_FOUND';
  end if;
  if v_session.session_revision <> p_expected_session_revision then
    raise exception using errcode = 'P0001', message = 'SESSION_REVISION_CONFLICT';
  end if;
  if v_core.revision <> p_expected_player_revision
    or v_session.player_revision <> p_expected_player_revision
  then
    raise exception using errcode = 'P0001', message = 'PLAYER_REVISION_CONFLICT';
  end if;
  if v_session.escape_failed then
    raise exception using errcode = 'P0001', message = 'ESCAPE_ALREADY_FAILED';
  end if;

  select m.* into v_monster
  from public.game_monster_catalog_v3 as m
  where m.monster_key = v_session.monster_key;
  if not found then
    raise exception using errcode = 'P0001', message = 'UNKNOWN_MONSTER';
  end if;
  if v_monster.boss then
    raise exception using errcode = 'P0001', message = 'ESCAPE_NOT_ALLOWED';
  end if;

  v_state := p_outcome -> 'state';
  v_kind := p_outcome ->> 'outcome';
  if jsonb_typeof(v_state) <> 'object'
    or v_kind not in ('continue', 'escaped', 'victory', 'defeat')
    or v_state ->> 'monsterKey' <> v_session.monster_key
    or (v_state ->> 'playerHp')::integer not between 0 and v_session.player_max_hp
    or (v_state ->> 'monsterHp')::integer not between 0 and v_session.monster_max_hp
    or (v_state ->> 'playerShield')::integer not between 0 and 1000000
    or (v_state ->> 'monsterShield')::integer not between 0 and 1000000
    or jsonb_typeof(coalesce(v_state -> 'playerStatuses', '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(v_state -> 'monsterStatuses', '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(v_state -> 'cooldowns', '{}'::jsonb)) <> 'object'
    or jsonb_typeof(p_outcome -> 'escape') <> 'object'
    or (
      v_kind = 'escaped'
      and (
        coalesce((p_outcome #>> '{escape,success}')::boolean, false) is not true
        or v_state ->> 'status' <> 'resolved'
        or (v_state ->> 'turnNumber')::integer <> v_session.turn_number
      )
    )
    or (
      v_kind <> 'escaped'
      and (
        coalesce((p_outcome #>> '{escape,success}')::boolean, true) is not false
        or coalesce((p_outcome #>> '{escape,locked}')::boolean, false) is not true
        or coalesce((v_state ->> 'escapeFailed')::boolean, false) is not true
        or (v_state ->> 'turnNumber')::integer <> v_session.turn_number + 1
      )
    )
    or (v_kind = 'continue' and v_state ->> 'status' <> 'active')
    or (v_kind in ('victory', 'defeat') and v_state ->> 'status' <> 'resolved')
    or (v_kind = 'victory' and (v_state ->> 'monsterHp')::integer <> 0)
    or (v_kind = 'defeat' and (v_state ->> 'playerHp')::integer <> 0)
  then
    raise exception using errcode = '22023', message = 'INVALID_OUTCOME';
  end if;

  if v_kind = 'continue' then
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
        escape_failed = true,
        updated_at = now(),
        expires_at = now() + interval '30 minutes'
    where user_id = p_user_id;
    v_response := (p_outcome - 'state') || jsonb_build_object(
      'ok', true,
      'session', public.private_build_safe_combat_session_v3(p_user_id)
    );

  elsif v_kind = 'escaped' then
    update public.player_core_v3
    set current_hp = least(current_hp, (v_state ->> 'playerHp')::integer),
        revision = revision + 1,
        updated_at = now()
    where user_id = p_user_id;
    delete from public.player_combat_sessions_v3 where user_id = p_user_id;
    v_response := (p_outcome - 'state') || jsonb_build_object(
      'ok', true,
      'player', public.private_build_student_snapshot_v3(p_user_id)
    );

  elsif v_kind = 'victory' then
    if (p_outcome #>> '{rewards,exp}')::integer <> v_monster.exp_reward
      or (p_outcome #>> '{rewards,gold}')::integer <> v_monster.gold_reward
      or (p_outcome #>> '{rewards,building}')::integer not between 0 and 1
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
        final_boss_unlocked = case
          when v_session.monster_key = 'swamp_elite_zombie' then true
          else final_boss_unlocked
        end,
        revision = revision + 1,
        updated_at = now()
    where user_id = p_user_id;
    perform public.private_progress_student_quest_v3(
      p_user_id, 'monster', v_session.monster_key
    );
    delete from public.player_combat_sessions_v3 where user_id = p_user_id;
    v_response := (p_outcome - 'state') || jsonb_build_object(
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
        boss_origin_map = null,
        final_boss_unlocked = false,
        revision = revision + 1,
        updated_at = now()
    where user_id = p_user_id;
    delete from public.player_combat_sessions_v3 where user_id = p_user_id;
    v_response := (p_outcome - 'state') || jsonb_build_object(
      'ok', true,
      'death', jsonb_build_object(
        'expAfter', greatest(v_level_floor, v_new_exp),
        'goldLost', v_gold_loss
      ),
      'player', public.private_build_student_snapshot_v3(p_user_id)
    );
  end if;

  insert into public.game_action_receipts_v3(user_id, request_id, action_name, response_json)
  values (
    p_user_id,
    v_request_id,
    'private_commit_student_combat_escape_v3',
    v_response
  );
  return v_response;
end;
$$;

revoke all on function public.private_prepare_student_combat_escape_v3(uuid, bigint, text)
  from public, anon, authenticated;
revoke all on function public.private_commit_student_combat_escape_v3(uuid, bigint, bigint, text, jsonb)
  from public, anon, authenticated;

grant execute on function public.private_prepare_student_combat_escape_v3(uuid, bigint, text)
  to service_role;
grant execute on function public.private_commit_student_combat_escape_v3(uuid, bigint, bigint, text, jsonb)
  to service_role;
