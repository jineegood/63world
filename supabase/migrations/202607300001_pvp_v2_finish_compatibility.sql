begin;

-- The recovery client stores characters in player_profiles_v2.
-- PvP records therefore remain independent from the retired growth authority.
create or replace function public.finish_pvp_match_v1(
  _match_id uuid,
  _winner_id uuid,
  _loser_id uuid,
  _reason text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_match public.pvp_matches_v1%rowtype;
begin
  select *
    into locked_match
    from public.pvp_matches_v1
   where id = _match_id
     and finished_at is null
   for update;

  if not found then
    return false;
  end if;
  if _winner_id not in (locked_match.player_a_id, locked_match.player_b_id)
    or _loser_id not in (locked_match.player_a_id, locked_match.player_b_id)
    or _winner_id = _loser_id then
    raise exception using errcode = 'P0001', message = 'INVALID_PVP_RESULT';
  end if;

  update public.pvp_matches_v1
     set phase = 'finished',
         winner_id = _winner_id,
         loser_id = _loser_id,
         finish_reason = left(coalesce(_reason, 'defeat'), 40),
         resolution_started_at = null,
         finished_at = now(),
         updated_at = now()
   where id = _match_id
     and finished_at is null;

  insert into public.pvp_records_v1 (user_id, wins, losses, updated_at)
  values (_winner_id, 1, 0, now())
  on conflict (user_id) do update
    set wins = public.pvp_records_v1.wins + 1,
        updated_at = now();

  insert into public.pvp_records_v1 (user_id, wins, losses, updated_at)
  values (_loser_id, 0, 1, now())
  on conflict (user_id) do update
    set losses = public.pvp_records_v1.losses + 1,
        updated_at = now();

  update public.pvp_presence_v1
     set busy = false
   where user_id in (_winner_id, _loser_id);

  return true;
end;
$$;

revoke all on function public.finish_pvp_match_v1(
  uuid, uuid, uuid, text
) from public;
revoke all on function public.finish_pvp_match_v1(
  uuid, uuid, uuid, text
) from anon, authenticated;
grant execute on function public.finish_pvp_match_v1(
  uuid, uuid, uuid, text
) to service_role;

commit;
