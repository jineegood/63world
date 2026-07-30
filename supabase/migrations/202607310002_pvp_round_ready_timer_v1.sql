begin;

alter table public.pvp_matches_v1
  add column if not exists player_a_ready_round integer not null default 0,
  add column if not exists player_b_ready_round integer not null default 0,
  add column if not exists timer_started_round integer not null default 1;

create or replace function public.private_mark_pvp_round_ready_v1(
  p_user_id uuid,
  p_match_id uuid,
  p_round_no integer,
  p_ready_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_match public.pvp_matches_v1%rowtype;
  v_started boolean := false;
begin
  if p_user_id is null or p_match_id is null or p_round_no < 2 then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST';
  end if;

  select *
    into v_match
    from public.pvp_matches_v1
   where id = p_match_id
   for update;

  if not found
    or p_user_id not in (v_match.player_a_id, v_match.player_b_id)
  then
    raise exception using errcode = 'P0001', message = 'NOT_PARTICIPANT';
  end if;
  if v_match.finished_at is not null
    or v_match.phase in ('finished', 'cancelled')
  then
    raise exception using errcode = 'P0001', message = 'MATCH_CLOSED';
  end if;
  if v_match.round_no <> p_round_no then
    raise exception using errcode = 'P0001', message = 'ROUND_CHANGED';
  end if;

  if p_user_id = v_match.player_a_id then
    update public.pvp_matches_v1
       set player_a_ready_round = greatest(player_a_ready_round, p_round_no),
           updated_at = p_ready_at
     where id = p_match_id;
  else
    update public.pvp_matches_v1
       set player_b_ready_round = greatest(player_b_ready_round, p_round_no),
           updated_at = p_ready_at
     where id = p_match_id;
  end if;

  select *
    into v_match
    from public.pvp_matches_v1
   where id = p_match_id
   for update;

  if v_match.player_a_ready_round >= p_round_no
    and v_match.player_b_ready_round >= p_round_no
    and v_match.timer_started_round < p_round_no
  then
    update public.pvp_matches_v1
       set timer_started_round = p_round_no,
           question_deadline = p_ready_at + interval '30 seconds',
           updated_at = p_ready_at
     where id = p_match_id;
    v_started := true;
  end if;

  return jsonb_build_object(
    'ready', true,
    'started', v_started
  );
end;
$$;

revoke all on function public.private_mark_pvp_round_ready_v1(
  uuid, uuid, integer, timestamptz
) from public, anon, authenticated;
grant execute on function public.private_mark_pvp_round_ready_v1(
  uuid, uuid, integer, timestamptz
) to service_role;

commit;
