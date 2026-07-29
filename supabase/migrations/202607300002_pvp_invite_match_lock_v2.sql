begin;

-- Creating reciprocal invitations at the same moment must not leave two pending
-- rows for the same students. The advisory locks use the two ids in a stable
-- order, so every create/accept operation for either student is serialized.
create or replace function public.private_create_pvp_invite_v2(
  p_challenger_id uuid,
  p_target_id uuid,
  p_request_id text,
  p_requested_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_invite public.pvp_invites_v1%rowtype;
  v_presence_count integer;
  v_all_online boolean;
  v_all_in_town boolean;
  v_any_busy boolean;
  v_first_user text;
  v_second_user text;
begin
  if p_challenger_id is null
    or p_target_id is null
    or p_challenger_id = p_target_id
  then
    raise exception using errcode = 'P0001', message = 'INVALID_TARGET';
  end if;
  if nullif(btrim(coalesce(p_request_id, '')), '') is null then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST';
  end if;

  v_first_user := least(p_challenger_id::text, p_target_id::text);
  v_second_user := greatest(p_challenger_id::text, p_target_id::text);
  perform pg_advisory_xact_lock(hashtextextended('pvp-user:' || v_first_user, 0));
  perform pg_advisory_xact_lock(hashtextextended('pvp-user:' || v_second_user, 0));

  update public.pvp_invites_v1
     set status = 'expired'
   where status = 'pending'
     and expires_at <= p_requested_at
     and (
       challenger_id in (p_challenger_id, p_target_id)
       or target_id in (p_challenger_id, p_target_id)
     );

  select *
    into v_invite
    from public.pvp_invites_v1
   where challenger_id = p_challenger_id
     and request_id = p_request_id
   limit 1
   for update;
  if found then
    if v_invite.target_id <> p_target_id then
      raise exception using errcode = 'P0001', message = 'INVALID_REQUEST';
    end if;
    return to_jsonb(v_invite);
  end if;

  if exists (
    select 1
      from public.pvp_invites_v1
     where status = 'pending'
       and (
         challenger_id in (p_challenger_id, p_target_id)
         or target_id in (p_challenger_id, p_target_id)
       )
  ) then
    raise exception using errcode = 'P0001', message = 'BUSY';
  end if;

  if exists (
    select 1
      from public.pvp_matches_v1
     where finished_at is null
       and phase <> 'cancelled'
       and (
         player_a_id in (p_challenger_id, p_target_id)
         or player_b_id in (p_challenger_id, p_target_id)
       )
  ) then
    raise exception using errcode = 'P0001', message = 'BUSY';
  end if;

  perform 1
    from public.pvp_presence_v1
   where user_id in (p_challenger_id, p_target_id)
   for update;
  select
    count(*)::integer,
    coalesce(bool_and(last_seen_at >= p_requested_at - interval '15 seconds'), false),
    coalesce(bool_and(map = 'town'), false),
    coalesce(bool_or(busy), true)
    into v_presence_count, v_all_online, v_all_in_town, v_any_busy
    from public.pvp_presence_v1
   where user_id in (p_challenger_id, p_target_id);
  if v_presence_count <> 2 or not v_all_online then
    raise exception using errcode = 'P0001', message = 'OFFLINE';
  end if;
  if not v_all_in_town then
    raise exception using errcode = 'P0001', message = 'TOWN_ONLY';
  end if;
  if v_any_busy then
    raise exception using errcode = 'P0001', message = 'BUSY';
  end if;

  insert into public.pvp_invites_v1 (
    challenger_id,
    target_id,
    request_id,
    created_at,
    expires_at
  )
  values (
    p_challenger_id,
    p_target_id,
    p_request_id,
    p_requested_at,
    p_requested_at + interval '20 seconds'
  )
  returning * into v_invite;

  return to_jsonb(v_invite);
end;
$$;

-- Match creation, the public question, and its private answer are committed in
-- one transaction. A repeated accept returns the existing match and never
-- rewrites its question, which keeps question_public and answer_key paired.
create or replace function public.private_accept_pvp_invite_v2(
  p_user_id uuid,
  p_invite_id uuid,
  p_accepted_at timestamptz,
  p_player_a_state jsonb,
  p_player_b_state jsonb,
  p_question_public jsonb,
  p_answer_key text,
  p_question_deadline timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_invite public.pvp_invites_v1%rowtype;
  v_match public.pvp_matches_v1%rowtype;
  v_existing_answer text;
  v_presence_count integer;
  v_all_online boolean;
  v_all_in_town boolean;
  v_any_busy boolean;
  v_first_user text;
  v_second_user text;
  v_created boolean := false;
begin
  select *
    into v_invite
    from public.pvp_invites_v1
   where id = p_invite_id;
  if not found or v_invite.target_id <> p_user_id then
    raise exception using errcode = 'P0001', message = 'NOT_INVITED';
  end if;

  v_first_user := least(v_invite.challenger_id::text, v_invite.target_id::text);
  v_second_user := greatest(v_invite.challenger_id::text, v_invite.target_id::text);
  perform pg_advisory_xact_lock(hashtextextended('pvp-user:' || v_first_user, 0));
  perform pg_advisory_xact_lock(hashtextextended('pvp-user:' || v_second_user, 0));

  -- Re-read under a row lock after the participant locks. This order avoids a
  -- deadlock with invite creation, which also locks participants before rows.
  select *
    into v_invite
    from public.pvp_invites_v1
   where id = p_invite_id
   for update;
  if not found or v_invite.target_id <> p_user_id then
    raise exception using errcode = 'P0001', message = 'NOT_INVITED';
  end if;
  if v_invite.status = 'accepted' and v_invite.match_id is not null then
    return jsonb_build_object('match_id', v_invite.match_id, 'created', false);
  end if;
  if v_invite.status <> 'pending' or v_invite.expires_at <= p_accepted_at then
    raise exception using errcode = 'P0001', message = 'INVITE_CLOSED';
  end if;

  select *
    into v_match
    from public.pvp_matches_v1
   where invite_id = v_invite.id
   limit 1
   for update;

  if exists (
    select 1
      from public.pvp_matches_v1
     where finished_at is null
       and phase <> 'cancelled'
       and (v_match.id is null or id <> v_match.id)
       and (
         player_a_id in (v_invite.challenger_id, v_invite.target_id)
         or player_b_id in (v_invite.challenger_id, v_invite.target_id)
       )
  ) then
    raise exception using errcode = 'P0001', message = 'BUSY';
  end if;

  perform 1
    from public.pvp_presence_v1
   where user_id in (v_invite.challenger_id, v_invite.target_id)
   for update;
  select
    count(*)::integer,
    coalesce(bool_and(last_seen_at >= p_accepted_at - interval '15 seconds'), false),
    coalesce(bool_and(map = 'town'), false),
    coalesce(bool_or(busy), true)
    into v_presence_count, v_all_online, v_all_in_town, v_any_busy
    from public.pvp_presence_v1
   where user_id in (v_invite.challenger_id, v_invite.target_id);
  if v_presence_count <> 2 or not v_all_online then
    raise exception using errcode = 'P0001', message = 'OFFLINE';
  end if;
  if not v_all_in_town then
    raise exception using errcode = 'P0001', message = 'TOWN_ONLY';
  end if;
  if v_match.id is null and v_any_busy then
    raise exception using errcode = 'P0001', message = 'BUSY';
  end if;

  if v_match.id is null then
    if p_player_a_state is null
      or p_player_b_state is null
      or p_question_public is null
      or nullif(coalesce(p_answer_key, ''), '') is null
      or p_question_deadline <= p_accepted_at
    then
      raise exception using errcode = 'P0001', message = 'MATCH_STATE_MISSING';
    end if;
    insert into public.pvp_matches_v1 (
      invite_id,
      player_a_id,
      player_b_id,
      player_a_state,
      player_b_state,
      question_public,
      question_deadline,
      phase,
      updated_at
    )
    values (
      v_invite.id,
      v_invite.challenger_id,
      v_invite.target_id,
      p_player_a_state,
      p_player_b_state,
      p_question_public,
      p_question_deadline,
      'question',
      p_accepted_at
    )
    returning * into v_match;
    insert into public.pvp_match_secrets_v1 (match_id, answer_key)
      values (v_match.id, p_answer_key);
    v_created := true;
  else
    select answer_key
      into v_existing_answer
      from public.pvp_match_secrets_v1
     where match_id = v_match.id
     for update;
    if not found then
      if p_player_a_state is null
        or p_player_b_state is null
        or p_question_public is null
        or nullif(coalesce(p_answer_key, ''), '') is null
        or p_question_deadline <= p_accepted_at
      then
        raise exception using errcode = 'P0001', message = 'MATCH_STATE_MISSING';
      end if;
      update public.pvp_matches_v1
         set player_a_state = p_player_a_state,
             player_b_state = p_player_b_state,
             question_public = p_question_public,
             question_deadline = p_question_deadline,
             phase = 'question',
             updated_at = p_accepted_at
       where id = v_match.id;
      insert into public.pvp_match_secrets_v1 (match_id, answer_key)
        values (v_match.id, p_answer_key);
    end if;
  end if;

  update public.pvp_invites_v1
     set status = 'accepted',
         match_id = v_match.id,
         responded_at = p_accepted_at
   where id = v_invite.id;
  update public.pvp_presence_v1
     set busy = true
   where user_id in (v_invite.challenger_id, v_invite.target_id);

  return jsonb_build_object('match_id', v_match.id, 'created', v_created);
end;
$$;

revoke all on function public.private_create_pvp_invite_v2(
  uuid, uuid, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.private_accept_pvp_invite_v2(
  uuid, uuid, timestamptz, jsonb, jsonb, jsonb, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.private_create_pvp_invite_v2(
  uuid, uuid, text, timestamptz
) to service_role;
grant execute on function public.private_accept_pvp_invite_v2(
  uuid, uuid, timestamptz, jsonb, jsonb, jsonb, text, timestamptz
) to service_role;

commit;
