begin;

-- Exactly one Edge Function request may resolve a PvP round.
-- This prevents two near-simultaneous answers from applying damage twice.
alter table public.pvp_matches_v1
  add column if not exists resolution_started_at timestamptz;

alter table public.pvp_matches_v1
  drop constraint if exists pvp_matches_v1_phase_check;

alter table public.pvp_matches_v1
  add constraint pvp_matches_v1_phase_check
  check (phase in (
    'question',
    'waiting',
    'resolving',
    'dice',
    'effects',
    'reconnect',
    'finished',
    'cancelled'
  ));

alter table public.pvp_matches_v1
  drop constraint if exists pvp_matches_v1_resume_phase_check;

alter table public.pvp_matches_v1
  add constraint pvp_matches_v1_resume_phase_check
  check (
    resume_phase is null
    or resume_phase in ('question', 'waiting', 'resolving', 'dice', 'effects')
  );

create or replace function public.private_submit_pvp_round_v2(
  p_user_id uuid,
  p_match_id uuid,
  p_round_no integer,
  p_request_id text,
  p_action_id text,
  p_answer text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.pvp_matches_v1%rowtype;
  v_input_count integer;
  v_can_recover boolean;
begin
  if p_user_id is null
    or p_match_id is null
    or p_round_no < 1
    or length(coalesce(p_request_id, '')) not between 1 and 100
    or length(coalesce(p_action_id, '')) not between 1 and 100
    or length(coalesce(p_answer, '')) > 120 then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST';
  end if;

  select *
    into v_match
    from public.pvp_matches_v1
   where id = p_match_id
   for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'MATCH_NOT_FOUND';
  end if;
  if p_user_id not in (v_match.player_a_id, v_match.player_b_id) then
    raise exception using errcode = 'P0001', message = 'NOT_PARTICIPANT';
  end if;
  if v_match.finished_at is not null
    or v_match.phase in ('finished', 'cancelled') then
    raise exception using errcode = 'P0001', message = 'MATCH_CLOSED';
  end if;
  if v_match.phase = 'reconnect' then
    raise exception using errcode = 'P0001', message = 'RECONNECTING';
  end if;
  if p_round_no <> v_match.round_no then
    raise exception using errcode = 'P0001', message = 'ROUND_CHANGED';
  end if;

  v_can_recover := v_match.phase = 'resolving'
    and v_match.resolution_started_at <= now() - interval '15 seconds';
  if v_match.phase = 'resolving' and not v_can_recover then
    return jsonb_build_object(
      'waiting', true,
      'resolver', false,
      'round', v_match.round_no
    );
  end if;
  if v_match.phase not in ('question', 'waiting', 'resolving') then
    raise exception using errcode = 'P0001', message = 'ROUND_CLOSED';
  end if;

  insert into public.pvp_round_inputs_v1(
    match_id,
    round_no,
    user_id,
    request_id,
    action_id,
    submitted_answer,
    submitted_at
  )
  values (
    p_match_id,
    p_round_no,
    p_user_id,
    p_request_id,
    p_action_id,
    p_answer,
    now()
  )
  on conflict (match_id, round_no, user_id) do nothing;

  select count(*)
    into v_input_count
    from public.pvp_round_inputs_v1
   where match_id = p_match_id
     and round_no = p_round_no;

  if v_input_count < 2
    and coalesce(v_match.question_deadline, now() + interval '1 second') > now()
    and not v_can_recover then
    update public.pvp_matches_v1
       set phase = 'waiting',
           updated_at = now()
     where id = p_match_id;
    return jsonb_build_object(
      'waiting', true,
      'resolver', false,
      'round', v_match.round_no
    );
  end if;

  update public.pvp_matches_v1
     set phase = 'resolving',
         resolution_started_at = now(),
         updated_at = now()
   where id = p_match_id;

  return jsonb_build_object(
    'waiting', false,
    'resolver', true,
    'round', v_match.round_no
  );
end;
$$;

revoke all on function public.private_submit_pvp_round_v2(
  uuid, uuid, integer, text, text, text
) from public;
revoke all on function public.private_submit_pvp_round_v2(
  uuid, uuid, integer, text, text, text
) from anon, authenticated;
grant execute on function public.private_submit_pvp_round_v2(
  uuid, uuid, integer, text, text, text
) to service_role;

commit;
