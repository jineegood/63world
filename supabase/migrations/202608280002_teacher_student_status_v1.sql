begin;

-- Teachers need a small, read-only view of current student presence and the
-- server-owned raid clear marker.  Keep world_presence_v1 RPC-only: neither
-- teachers nor students receive direct SELECT privileges on the backing table.
create or replace function public.teacher_student_status_v1()
returns table (
  user_id uuid,
  is_online boolean,
  presence_last_seen_at timestamptz,
  current_map text,
  raid_top_group integer,
  raid_top_floor integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_online_cutoff timestamptz := pg_catalog.statement_timestamp() - interval '8 seconds';
begin
  if auth.uid() is null or not public.is_teacher() then
    raise exception 'teacher authorization is required'
      using errcode = '42501';
  end if;

  return query
  select
    profile.user_id,
    coalesce(presence.last_seen_at >= v_online_cutoff, false) as is_online,
    presence.last_seen_at as presence_last_seen_at,
    case
      when presence.last_seen_at >= v_online_cutoff then presence.map
      else null
    end as current_map,
    coalesce(raid_progress.top_group, 0)::integer as raid_top_group,
    case
      when coalesce(raid_progress.top_group, 0) = 7 then 63
      else coalesce(raid_progress.top_group, 0)::integer * 10
    end as raid_top_floor
  from public.player_profiles_v2 as profile
  left join public.world_presence_v1 as presence
    on presence.user_id = profile.user_id
  left join public.raid_progress_v1 as raid_progress
    on raid_progress.user_id = profile.user_id
  order by profile.user_id;
end;
$$;

-- Reassert the table boundary in this migration so a later policy/grant change
-- cannot accidentally turn the status RPC into a direct presence read path.
revoke all on table public.world_presence_v1
  from public, anon, authenticated;

revoke all on function public.teacher_student_status_v1()
  from public, anon, authenticated;
grant execute on function public.teacher_student_status_v1()
  to authenticated;

commit;
