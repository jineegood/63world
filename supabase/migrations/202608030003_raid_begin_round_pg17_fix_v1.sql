-- 문제 발급이 항상 실패하던 진짜 원인을 고친다.
--
-- private_begin_raid_round_v1 이 jsonb_object_length() 를 쓰는데,
-- 이 함수는 PostgreSQL 18에서 추가되었고 이 프로젝트는 17.6이다.
-- 그래서 호출할 때마다 "function does not exist" 가 나고,
-- 그것을 exception when others 가 삼켜서 매번 INVALID_REQUEST(현재는
-- ANSWER_INVALID)로 되돌려 주고 있었다.
-- 즉 문제집·정답과는 아무 상관이 없었고, 던전은 처음부터 한 라운드도
-- 시작할 수 없는 상태였다.
--
-- 17에서도 되는 방식으로 개수를 센다:
--   select count(*) from jsonb_object_keys(...)
--
-- 개수를 세는 규칙 자체는 그대로 두고 계산 방법만 바꾼다.

-- 어떤 버전에서도 도는 jsonb 객체 키 개수 세기.
create or replace function public.private_jsonb_object_size_v1(p_value jsonb)
returns integer
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case
    when jsonb_typeof(p_value) is distinct from 'object' then -1
    else (select count(*)::integer from jsonb_object_keys(p_value))
  end;
$$;

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
  v_answers jsonb;
  v_missing integer;
begin
  if jsonb_typeof(p_question_public) is distinct from 'object'
    or jsonb_typeof(p_question_public -> 'byUser') is distinct from 'object'
    or octet_length(p_question_public::text) > 8192
  then raise exception using errcode = 'P0001', message = 'QUESTION_INVALID'; end if;

  if char_length(coalesce(p_answer_key, '')) not between 1 and 2048 then
    raise exception using errcode = 'P0001', message = 'ANSWER_INVALID';
  end if;

  -- 정답 꾸러미가 올바른 JSON 객체인지 확인한다.
  begin
    v_answers := p_answer_key::jsonb;
  exception when others then
    raise exception using errcode = 'P0001', message = 'ANSWER_INVALID';
  end;
  if jsonb_typeof(v_answers) is distinct from 'object' then
    raise exception using errcode = 'P0001', message = 'ANSWER_INVALID';
  end if;

  v_answer_count := public.private_jsonb_object_size_v1(v_answers);
  v_question_count := public.private_jsonb_object_size_v1(p_question_public -> 'byUser');

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

  if v_member_count <> 3 then
    raise exception using errcode = 'P0001', message = 'PARTY_INCOMPLETE';
  end if;
  if v_question_count <> v_member_count then
    raise exception using errcode = 'P0001', message = 'QUESTION_COUNT';
  end if;
  if v_answer_count <> v_member_count then
    raise exception using errcode = 'P0001', message = 'ANSWER_COUNT';
  end if;

  select count(*) into v_missing
    from public.raid_room_members_v1 member
   where member.room_id = p_room_id and member.active
     and (
       not ((p_question_public -> 'byUser') ? member.user_id::text)
       or not (v_answers ? member.user_id::text)
     );
  if v_missing > 0 then
    raise exception using errcode = 'P0001', message = 'MEMBER_MISMATCH';
  end if;

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

grant execute on function public.private_jsonb_object_size_v1(jsonb) to service_role;
grant execute on function public.private_begin_raid_round_v1(uuid, uuid, jsonb, text, text, timestamptz) to service_role;
