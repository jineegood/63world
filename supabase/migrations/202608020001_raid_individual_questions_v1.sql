begin;

alter table public.raid_question_secrets_v1
  drop constraint if exists raid_question_secrets_v1_answer_key_check;

alter table public.raid_question_secrets_v1
  add constraint raid_question_secrets_v1_answer_key_check
  check (char_length(answer_key) between 1 and 2048);

create or replace function public.private_begin_raid_round_v1(
  p_user_id uuid,
  p_room_id uuid,
  p_question_public jsonb,
  p_answer_key text,
  p_request_id text,
  p_begun_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_room public.raid_rooms_v1%rowtype;
  v_round integer;
  v_member_count integer;
  v_question_count integer;
  v_answer_count integer;
begin
  if jsonb_typeof(p_question_public) is distinct from 'object'
    or jsonb_typeof(p_question_public -> 'byUser') is distinct from 'object'
    or octet_length(p_question_public::text) > 8192
    or char_length(coalesce(p_answer_key, '')) not between 1 and 2048
  then raise exception using errcode = 'P0001', message = 'INVALID_REQUEST'; end if;

  begin
    v_answer_count := jsonb_object_length(p_answer_key::jsonb);
  exception when others then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST';
  end;
  v_question_count := jsonb_object_length(p_question_public -> 'byUser');

  select * into v_room from public.raid_rooms_v1 where id = p_room_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND'; end if;
  if v_room.host_id <> p_user_id then raise exception using errcode = 'P0001', message = 'HOST_ONLY'; end if;
  if v_room.last_begin_request_id = p_request_id then
    return jsonb_build_object('ok', true, 'round', v_room.round_no, 'recovered', true);
  end if;
  if v_room.phase not in ('travel', 'effects') then
    raise exception using errcode = 'P0001', message = 'ROUND_CLOSED';
  end if;

  select count(*) into v_member_count
    from public.raid_room_members_v1
   where room_id = p_room_id and active;
  if v_member_count <> 3 or v_question_count <> v_member_count or v_answer_count <> v_member_count
    or exists (
      select 1 from public.raid_room_members_v1 member
       where member.room_id = p_room_id and member.active
         and (
           not ((p_question_public -> 'byUser') ? member.user_id::text)
           or not ((p_answer_key::jsonb) ? member.user_id::text)
         )
    )
  then raise exception using errcode = 'P0001', message = 'INVALID_REQUEST'; end if;

  v_round := v_room.round_no + 1;
  update public.raid_rooms_v1 set
    phase = 'question', round_no = v_round,
    question_public = p_question_public,
    question_deadline = p_begun_at + interval '30 seconds',
    resolution_started_at = null,
    last_begin_request_id = p_request_id,
    version = version + 1, updated_at = p_begun_at
  where id = p_room_id;
  insert into public.raid_question_secrets_v1(room_id, round_no, answer_key, created_at)
  values (p_room_id, v_round, p_answer_key, p_begun_at)
  on conflict (room_id) do update set
    round_no = excluded.round_no, answer_key = excluded.answer_key, created_at = excluded.created_at;
  return jsonb_build_object('ok', true, 'round', v_round, 'recovered', false);
end;
$$;

create or replace function public.private_submit_raid_round_v1(
  p_user_id uuid,
  p_room_id uuid,
  p_round_no integer,
  p_action_id text,
  p_answer text,
  p_request_id text,
  p_submitted_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_room public.raid_rooms_v1%rowtype;
  v_answer_keys jsonb;
  v_answer_key text;
  v_member_count integer;
  v_input_count integer;
  v_prior public.raid_round_inputs_v1%rowtype;
  v_resolving boolean := false;
begin
  if p_round_no < 1 or char_length(coalesce(p_action_id, '')) not between 1 and 100
    or char_length(coalesce(p_answer, '')) > 120
    or char_length(coalesce(p_request_id, '')) not between 1 and 100
  then raise exception using errcode = 'P0001', message = 'INVALID_REQUEST'; end if;
  select * into v_room from public.raid_rooms_v1 where id = p_room_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND'; end if;
  if not exists (select 1 from public.raid_room_members_v1
    where room_id = p_room_id and user_id = p_user_id and active)
  then raise exception using errcode = 'P0001', message = 'NOT_MEMBER'; end if;
  select * into v_prior from public.raid_round_inputs_v1
   where user_id = p_user_id and request_id = p_request_id;
  if found then
    if v_prior.room_id <> p_room_id or v_prior.round_no <> p_round_no then
      raise exception using errcode = 'P0001', message = 'INVALID_REQUEST';
    end if;
    return jsonb_build_object('waiting', v_room.phase <> 'resolving', 'allSubmitted', v_room.phase = 'resolving', 'recovered', true);
  end if;
  if v_room.round_no <> p_round_no then raise exception using errcode = 'P0001', message = 'ROUND_CHANGED'; end if;
  if v_room.phase not in ('question', 'waiting') then raise exception using errcode = 'P0001', message = 'ROUND_CLOSED'; end if;

  select answer_key::jsonb into v_answer_keys from public.raid_question_secrets_v1
   where room_id = p_room_id and round_no = p_round_no;
  if not found then raise exception using errcode = 'P0001', message = 'ROUND_CLOSED'; end if;
  v_answer_key := v_answer_keys ->> p_user_id::text;
  if v_answer_key is null then raise exception using errcode = 'P0001', message = 'ROUND_CLOSED'; end if;

  insert into public.raid_round_inputs_v1(
    room_id, round_no, user_id, request_id, action_id, submitted_answer, is_correct, submitted_at
  ) values (
    p_room_id, p_round_no, p_user_id, p_request_id, p_action_id,
    coalesce(p_answer, ''), lower(btrim(coalesce(p_answer, ''))) = lower(btrim(v_answer_key)), p_submitted_at
  ) on conflict (room_id, round_no, user_id) do nothing;

  select count(*) into v_member_count from public.raid_room_members_v1 where room_id = p_room_id and active;
  select count(*) into v_input_count from public.raid_round_inputs_v1 where room_id = p_room_id and round_no = p_round_no;
  v_resolving := v_input_count >= v_member_count or coalesce(v_room.question_deadline, p_submitted_at) <= p_submitted_at;
  update public.raid_rooms_v1 set
    phase = case when v_resolving then 'resolving' else 'waiting' end,
    resolution_started_at = case when v_resolving then p_submitted_at else null end,
    version = version + 1, updated_at = p_submitted_at
  where id = p_room_id;
  return jsonb_build_object(
    'waiting', not v_resolving, 'allSubmitted', v_resolving,
    'submittedCount', v_input_count, 'requiredCount', v_member_count, 'recovered', false
  );
end;
$$;

revoke all on function public.private_begin_raid_round_v1(uuid,uuid,jsonb,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.private_submit_raid_round_v1(uuid,uuid,integer,text,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.private_begin_raid_round_v1(uuid,uuid,jsonb,text,text,timestamptz) to service_role;
grant execute on function public.private_submit_raid_round_v1(uuid,uuid,integer,text,text,text,timestamptz) to service_role;

commit;
