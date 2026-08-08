-- Keep all three raid screens on the same encounter boundary.
-- Background Chrome tabs may throttle animation timers.  Each participant therefore
-- acknowledges the round only after its local playback has finished; the clients do
-- not start the next question or corridor until all three acknowledgements are stored.

alter table public.raid_room_members_v1
  add column if not exists playback_round integer not null default 0
  check (playback_round >= 0);

create or replace function public.private_ack_raid_playback_v1(
  p_user_id uuid,
  p_room_id uuid,
  p_round_no integer,
  p_seen_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_room public.raid_rooms_v1%rowtype;
  v_updated integer;
begin
  if p_round_no < 0 then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST';
  end if;

  select * into v_room
    from public.raid_rooms_v1
   where id = p_room_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND';
  end if;
  if p_round_no > v_room.round_no then
    raise exception using errcode = 'P0001', message = 'ROUND_CHANGED';
  end if;

  update public.raid_room_members_v1
     set playback_round = greatest(playback_round, p_round_no),
         last_seen_at = greatest(last_seen_at, p_seen_at)
   where room_id = p_room_id
     and user_id = p_user_id
     and active;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception using errcode = 'P0001', message = 'NOT_MEMBER';
  end if;

  return jsonb_build_object('ok', true, 'round', p_round_no);
end;
$$;

revoke all on function public.private_ack_raid_playback_v1(uuid, uuid, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.private_ack_raid_playback_v1(uuid, uuid, integer, timestamptz)
  to service_role;

-- Even a duplicated or stale host request may not open the next question early.
create or replace function public.private_enforce_raid_playback_barrier_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.phase = 'question'
    and old.phase in ('travel', 'effects')
    and old.round_no > 0
    and exists (
      select 1
        from public.raid_room_members_v1 member
       where member.room_id = old.id
         and member.active
         and member.playback_round < old.round_no
    )
  then
    raise exception using errcode = 'P0001', message = 'PLAYBACK_PENDING';
  end if;
  return new;
end;
$$;

drop trigger if exists raid_playback_barrier_v1 on public.raid_rooms_v1;
create trigger raid_playback_barrier_v1
before update of phase on public.raid_rooms_v1
for each row execute function public.private_enforce_raid_playback_barrier_v1();

revoke all on function public.private_enforce_raid_playback_barrier_v1()
  from public, anon, authenticated;
