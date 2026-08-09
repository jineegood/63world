begin;

alter table public.raid_rooms_v1
  add column if not exists teacher_kill_round integer not null default 0
  check (teacher_kill_round >= 0);

create or replace function public.private_teacher_kill_raid_monster_v1(
  p_target_user_id uuid,
  p_killed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_room public.raid_rooms_v1%rowtype;
  v_member record;
  v_member_count integer;
begin
  select room.* into v_room
    from public.raid_rooms_v1 room
    join public.raid_room_members_v1 member on member.room_id = room.id
   where member.user_id = p_target_user_id
     and member.active
     and room.phase in ('question', 'waiting')
   order by member.last_seen_at desc
   limit 1
   for update of room;

  if not found then
    raise exception using errcode = 'P0001', message = 'RAID_NOT_IN_BATTLE';
  end if;
  if v_room.round_no < 1 then
    raise exception using errcode = 'P0001', message = 'RAID_NOT_IN_BATTLE';
  end if;

  select count(*) into v_member_count
    from public.raid_room_members_v1
   where room_id = v_room.id and active;
  if v_member_count <> 3 then
    raise exception using errcode = 'P0001', message = 'RAID_PARTY_INCOMPLETE';
  end if;

  for v_member in
    select user_id from public.raid_room_members_v1
     where room_id = v_room.id and active
     order by join_order
  loop
    insert into public.raid_round_inputs_v1(
      room_id, round_no, user_id, request_id, action_id,
      submitted_answer, is_correct, submitted_at
    ) values (
      v_room.id,
      v_room.round_no,
      v_member.user_id,
      'teacher-' || md5(v_room.id::text || ':' || v_room.round_no::text || ':' || v_member.user_id::text),
      'basic',
      '',
      true,
      coalesce(p_killed_at, now())
    )
    on conflict (room_id, round_no, user_id) do update set
      action_id = 'basic',
      submitted_answer = '',
      is_correct = true,
      submitted_at = excluded.submitted_at;
  end loop;

  update public.raid_rooms_v1 set
    phase = 'resolving',
    resolution_started_at = coalesce(p_killed_at, now()),
    question_deadline = null,
    teacher_kill_round = v_room.round_no,
    version = version + 1,
    updated_at = coalesce(p_killed_at, now())
  where id = v_room.id;

  return jsonb_build_object(
    'ok', true,
    'roomId', v_room.id,
    'round', v_room.round_no,
    'monsterName', coalesce(v_room.monster_state ->> 'name', '던전 몬스터')
  );
end;
$$;

revoke all on function public.private_teacher_kill_raid_monster_v1(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.private_teacher_kill_raid_monster_v1(uuid, timestamptz)
  to service_role;

commit;
