begin;

-- New logins use one server-selected channel. Automatic admissions are
-- serialized as one decision so simultaneous classroom logins fill channel 1
-- to three, then channel 2 to three, and so on. Only after every available
-- channel reaches three may an automatic entrant become the fourth (and so
-- on). Explicit settings changes still use the requested channel and the
-- existing hard capacity of eight.
create or replace function public.sync_world_presence_v4(p_state jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_channel_mode text;
  v_selected_channel smallint;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'authenticated student is required'
      using errcode = '42501';
  end if;

  if p_state is null
    or jsonb_typeof(p_state) is distinct from 'object'
    or octet_length(p_state::text) > 8192
    or jsonb_typeof(p_state -> 'channelMode') is distinct from 'string'
  then
    raise exception 'invalid world presence state'
      using errcode = '22023';
  end if;

  v_channel_mode := p_state ->> 'channelMode';
  if v_channel_mode not in ('auto', 'manual') then
    raise exception 'invalid world channel mode'
      using errcode = '22023';
  end if;

  if v_channel_mode = 'manual' then
    -- v3 remains the single validator, sanitizer, hard-cap enforcer, roster
    -- reader, and chat writer for an explicit channel choice.
    return public.sync_world_presence_v3(p_state - 'channelMode');
  end if;

  -- Hold this lock through the delegated v3 admission/write. Concurrent auto
  -- callers therefore observe every earlier assignment before choosing.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('yuksam-world-auto-admission-v1', 0)
  );

  select candidate.channel::smallint
    into v_selected_channel
    from pg_catalog.generate_series(1, 10) as candidate(channel)
    cross join lateral (
      select count(*)::integer as occupancy
        from public.world_presence_v1 as presence
       where presence.channel = candidate.channel
         and presence.user_id <> v_user_id
         and presence.last_seen_at >= clock_timestamp() - interval '8 seconds'
    ) as active
   where active.occupancy < 8
   order by
     (active.occupancy >= 3),
     case when active.occupancy >= 3 then active.occupancy else 0 end,
     candidate.channel
   limit 1;

  if v_selected_channel is null then
    -- Let v3 return its established CHANNEL_FULL response shape and fresh
    -- occupancy counters. This branch is only reachable when all ten channels
    -- already contain eight other active students.
    v_selected_channel := 1;
  end if;

  v_result := public.sync_world_presence_v3(
    (p_state - 'channelMode' - 'channel')
      || jsonb_build_object('channel', v_selected_channel)
  );
  return v_result;
end;
$$;

revoke all on function public.sync_world_presence_v4(jsonb)
  from public, anon, authenticated;
grant execute on function public.sync_world_presence_v4(jsonb)
  to authenticated;

commit;
