begin;

-- Heartbeat must take the same row-lock order as publish, question-ready,
-- submit, ready and leave: room first, then that room's member row(s).
-- Updating a member first lets heartbeat hold the row that publish/ACK needs
-- while waiting for their room lock (the production 40P01 cycle).
-- No combat, reward, question-barrier or idle-TTL rules change here.
create or replace function public.private_heartbeat_raid_room_v1(
  p_user_id uuid,
  p_room_id uuid,
  p_seen_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_room public.raid_rooms_v1%rowtype;
begin
  -- Keep the existing NOT_MEMBER-first error for absent/inactive membership,
  -- including a nonexistent room, without taking a member row lock.
  if not exists (
    select 1 from public.raid_room_members_v1
     where room_id = p_room_id and user_id = p_user_id and active
  ) then
    raise exception using errcode = 'P0001', message = 'NOT_MEMBER';
  end if;

  select * into v_room from public.raid_rooms_v1 where id = p_room_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND'; end if;

  -- Recheck active membership in the write: it may have changed while the
  -- room lock was awaited. An unsuccessful heartbeat must not resolve a room.
  update public.raid_room_members_v1 set last_seen_at = p_seen_at
   where room_id = p_room_id and user_id = p_user_id and active;
  if not found then raise exception using errcode = 'P0001', message = 'NOT_MEMBER'; end if;
  if v_room.phase in ('question', 'waiting')
    and v_room.question_deadline is not null
    and v_room.question_deadline <= p_seen_at
  then
    update public.raid_rooms_v1 set
      phase = 'resolving', resolution_started_at = p_seen_at,
      version = version + 1, updated_at = p_seen_at
    where id = p_room_id;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.private_heartbeat_raid_room_v1(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.private_heartbeat_raid_room_v1(uuid, uuid, timestamptz)
  to service_role;

commit;
