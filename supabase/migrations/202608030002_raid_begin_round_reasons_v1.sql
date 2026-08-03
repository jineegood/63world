-- 문제 발급이 막힐 때 "왜" 막혔는지 알 수 있게 한다.
--
-- 지금까지는 아래 여섯 가지가 전부 INVALID_REQUEST 하나로 뭉뚱그려져
-- 화면에는 "던전 요청이 올바르지 않습니다"만 떴다. 원인을 좁힐 수가 없어
-- 검사마다 다른 코드를 돌려주도록 바꾼다. 판정 규칙 자체는 그대로다.
--
--   QUESTION_INVALID  : 문제 꾸러미 모양이 잘못됨
--   ANSWER_INVALID    : 정답 꾸러미 모양이 잘못됨
--   PARTY_INCOMPLETE  : 방에 살아 있는 참가자가 3명이 아님
--   QUESTION_COUNT    : 문제 개수가 참가자 수와 다름
--   ANSWER_COUNT      : 정답 개수가 참가자 수와 다름
--   MEMBER_MISMATCH   : 특정 참가자 몫의 문제/정답이 없음

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
  v_missing integer;
begin
  if jsonb_typeof(p_question_public) is distinct from 'object'
    or jsonb_typeof(p_question_public -> 'byUser') is distinct from 'object'
    or octet_length(p_question_public::text) > 8192
  then raise exception using errcode = 'P0001', message = 'QUESTION_INVALID'; end if;

  if char_length(coalesce(p_answer_key, '')) not between 1 and 2048 then
    raise exception using errcode = 'P0001', message = 'ANSWER_INVALID';
  end if;

  begin
    v_answer_count := jsonb_object_length(p_answer_key::jsonb);
  exception when others then
    raise exception using errcode = 'P0001', message = 'ANSWER_INVALID';
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
       or not ((p_answer_key::jsonb) ? member.user_id::text)
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
