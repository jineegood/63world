begin;

alter table public.raid_rooms_v1
  add column if not exists teacher_paused_phase text,
  add column if not exists teacher_paused_remaining_ms integer,
  add column if not exists teacher_paused_at timestamptz;

alter table public.raid_rooms_v1
  drop constraint if exists raid_rooms_v1_phase_check;
alter table public.raid_rooms_v1
  add constraint raid_rooms_v1_phase_check check (phase in (
    'lobby', 'travel', 'question', 'waiting', 'resolving', 'effects',
    'reconnect', 'paused', 'cleared', 'wiped', 'cancelled'
  ));

alter table public.raid_rooms_v1
  drop constraint if exists raid_rooms_v1_teacher_paused_phase_check;
alter table public.raid_rooms_v1
  add constraint raid_rooms_v1_teacher_paused_phase_check check (
    teacher_paused_phase is null or teacher_paused_phase in (
      'travel', 'question', 'waiting', 'resolving', 'effects', 'reconnect'
    )
  );

alter table public.raid_rooms_v1
  drop constraint if exists raid_rooms_v1_teacher_paused_remaining_ms_check;
alter table public.raid_rooms_v1
  add constraint raid_rooms_v1_teacher_paused_remaining_ms_check check (
    teacher_paused_remaining_ms is null or teacher_paused_remaining_ms >= 0
  );

drop index if exists public.raid_rooms_v1_active_code_unique;
create unique index raid_rooms_v1_active_code_unique
  on public.raid_rooms_v1(invite_code)
  where phase in (
    'lobby', 'travel', 'question', 'waiting', 'resolving', 'effects',
    'reconnect', 'paused'
  );

create or replace function public.private_teacher_toggle_raid_pause_v1(
  p_target_user_id uuid,
  p_changed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_room public.raid_rooms_v1%rowtype;
  v_now timestamptz := coalesce(p_changed_at, now());
  v_restore_phase text;
  v_remaining_ms integer;
begin
  select room.* into v_room
    from public.raid_rooms_v1 room
    join public.raid_room_members_v1 member on member.room_id = room.id
   where member.user_id = p_target_user_id
     and member.active
     and room.phase in (
       'travel', 'question', 'waiting', 'resolving', 'effects', 'reconnect', 'paused'
     )
   order by member.last_seen_at desc
   limit 1
   for update of room;

  if not found then
    raise exception using errcode = 'P0001', message = 'RAID_NOT_ACTIVE';
  end if;

  if v_room.phase = 'paused' then
    v_restore_phase := coalesce(v_room.teacher_paused_phase, 'travel');
    v_remaining_ms := greatest(0, coalesce(v_room.teacher_paused_remaining_ms, 0));

    update public.raid_rooms_v1 set
      phase = v_restore_phase,
      question_deadline = case
        when v_restore_phase in ('question', 'waiting')
          then v_now + (v_remaining_ms::text || ' milliseconds')::interval
        else null
      end,
      teacher_paused_phase = null,
      teacher_paused_remaining_ms = null,
      teacher_paused_at = null,
      version = version + 1,
      updated_at = v_now
    where id = v_room.id;

    return jsonb_build_object(
      'ok', true,
      'roomId', v_room.id,
      'paused', false,
      'resumedPhase', v_restore_phase,
      'remainingSeconds', ceil(v_remaining_ms / 1000.0)
    );
  end if;

  v_remaining_ms := case
    when v_room.phase in ('question', 'waiting') and v_room.question_deadline is not null
      then greatest(0, floor(extract(epoch from (v_room.question_deadline - v_now)) * 1000)::integer)
    else null
  end;

  update public.raid_rooms_v1 set
    phase = 'paused',
    question_deadline = null,
    teacher_paused_phase = v_room.phase,
    teacher_paused_remaining_ms = v_remaining_ms,
    teacher_paused_at = v_now,
    version = version + 1,
    updated_at = v_now
  where id = v_room.id;

  return jsonb_build_object(
    'ok', true,
    'roomId', v_room.id,
    'paused', true,
    'resumedPhase', v_room.phase,
    'remainingSeconds', case when v_remaining_ms is null then null else ceil(v_remaining_ms / 1000.0) end
  );
end;
$$;

revoke all on function public.private_teacher_toggle_raid_pause_v1(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.private_teacher_toggle_raid_pause_v1(uuid, timestamptz)
  to service_role;

commit;
