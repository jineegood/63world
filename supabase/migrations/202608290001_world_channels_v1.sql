begin;

-- Five explicit classroom channels keep the authoritative presence snapshot
-- small without changing the v1/v2 RPC contracts used by an older frontend.
-- Existing rows/messages belong to channel 1 until their client selects one.
alter table public.world_presence_v1
  add column if not exists channel smallint not null default 1;
alter table public.world_chat_v1
  add column if not exists channel smallint not null default 1;

do $constraints$
begin
  if not exists (
    select 1
      from pg_catalog.pg_constraint
     where conname = 'world_presence_v1_channel_safe'
       and conrelid = 'public.world_presence_v1'::regclass
  ) then
    alter table public.world_presence_v1
      add constraint world_presence_v1_channel_safe
      check (channel between 1 and 5);
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_constraint
     where conname = 'world_chat_v1_channel_safe'
       and conrelid = 'public.world_chat_v1'::regclass
  ) then
    alter table public.world_chat_v1
      add constraint world_chat_v1_channel_safe
      check (channel between 1 and 5);
  end if;
end;
$constraints$;

create index if not exists world_presence_v1_active_channel_idx
  on public.world_presence_v1 (channel, last_seen_at desc, user_id);
create index if not exists world_presence_v1_active_map_channel_idx
  on public.world_presence_v1 (map, channel, last_seen_at desc, user_id);
create index if not exists world_chat_v1_channel_recent_idx
  on public.world_chat_v1 (channel, id desc);

-- Keep both augmented tables RPC-only. Adding a column must never become an
-- accidental direct-read boundary for authenticated clients.
alter table public.world_presence_v1 enable row level security;
alter table public.world_presence_v1 force row level security;
alter table public.world_chat_v1 enable row level security;
alter table public.world_chat_v1 force row level security;
revoke all on table public.world_presence_v1 from public, anon, authenticated;
revoke all on table public.world_chat_v1 from public, anon, authenticated;
revoke all on sequence public.world_chat_v1_id_seq from public, anon, authenticated;

-- Every active write, including a legacy v1/v2 heartbeat, passes through this
-- trigger. The transaction-scoped channel lock makes count + admission atomic:
-- simultaneous eighth/ninth entrants cannot both observe the final seat free.
create or replace function public.private_enforce_world_channel_capacity_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_active_others integer := 0;
  v_active_incumbent boolean := false;
begin
  if new.channel not between 1 and 5 then
    raise exception 'invalid world channel'
      using errcode = '22023';
  end if;

  -- Stale backfills do not consume a seat. A later live heartbeat is checked.
  if new.last_seen_at < v_now - interval '8 seconds' then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'yuksam-world-channel-capacity-v1|' || new.channel::text,
      0
    )
  );

  if tg_op = 'UPDATE' then
    v_active_incumbent := old.channel = new.channel
      and old.last_seen_at >= v_now - interval '8 seconds';
  end if;

  select count(*)::integer
    into v_active_others
    from public.world_presence_v1 as presence
   where presence.channel = new.channel
     and presence.user_id <> new.user_id
     and presence.last_seen_at >= v_now - interval '8 seconds';

  if v_active_others >= 8 and not v_active_incumbent then
    raise exception 'world channel % is full', new.channel
      using errcode = 'P0001',
            detail = 'CHANNEL_FULL';
  end if;
  return new;
end;
$$;

revoke all on function public.private_enforce_world_channel_capacity_v1()
  from public, anon, authenticated;

drop trigger if exists enforce_world_channel_capacity_v1
  on public.world_presence_v1;
create trigger enforce_world_channel_capacity_v1
before insert or update of channel, last_seen_at on public.world_presence_v1
for each row execute function public.private_enforce_world_channel_capacity_v1();

-- Realtime Broadcast authorization is intentionally tied to the server-owned,
-- short-lived presence assignment. The helper reveals only a yes/no answer for
-- auth.uid(); the protected presence table remains unreadable to the client.
create or replace function public.can_access_world_motion_channel_v1(p_topic text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_channel smallint;
begin
  if v_user_id is null
    or p_topic is null
    or p_topic !~ '^world-motion-v1:channel-[1-5]$'
  then
    return false;
  end if;

  v_channel := pg_catalog.substring(
    p_topic,
    '^world-motion-v1:channel-([1-5])$'
  )::smallint;

  return exists (
    select 1
      from public.world_presence_v1 as presence
     where presence.user_id = v_user_id
       and presence.channel = v_channel
       and presence.last_seen_at >= clock_timestamp() - interval '8 seconds'
  );
end;
$$;

revoke all on function public.can_access_world_motion_channel_v1(text)
  from public, anon, authenticated;
grant execute on function public.can_access_world_motion_channel_v1(text)
  to authenticated;

drop policy if exists "world motion broadcast receive v1"
  on realtime.messages;
create policy "world motion broadcast receive v1"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and public.can_access_world_motion_channel_v1((select realtime.topic()))
);

drop policy if exists "world motion broadcast send v1"
  on realtime.messages;
create policy "world motion broadcast send v1"
on realtime.messages
for insert
to authenticated
with check (
  realtime.messages.extension = 'broadcast'
  and public.can_access_world_motion_channel_v1((select realtime.topic()))
);

-- v3 keeps v2's sanitization and global-announcement behavior, while binding
-- admission, roster, visual deltas, and chat to one server-checked channel.
create or replace function public.sync_world_presence_v3(p_state jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_display_name text;
  v_map text;
  v_x numeric;
  v_y numeric;
  v_channel smallint;
  v_previous_channel smallint;
  v_active_incumbent boolean := false;
  v_active_requested integer := 0;
  v_now timestamptz;
  v_base jsonb := '{}'::jsonb;
  v_known_visuals jsonb := '{}'::jsonb;
  v_last_chat_id bigint := 0;
  v_chat_id uuid;
  v_chat_text text;
  v_chat_accepted_id uuid;
  v_players jsonb := '[]'::jsonb;
  v_visuals jsonb := '[]'::jsonb;
  v_messages jsonb := '[]'::jsonb;
  v_channel_counts jsonb := '{}'::jsonb;
begin
  if v_user_id is null then
    raise exception 'authenticated student is required'
      using errcode = '42501';
  end if;

  if p_state is null
    or jsonb_typeof(p_state) is distinct from 'object'
    or octet_length(p_state::text) > 8192
  then
    raise exception 'invalid world presence state'
      using errcode = '22023';
  end if;

  if jsonb_typeof(p_state -> 'channel') is distinct from 'number'
    or (p_state ->> 'channel') !~ '^[1-5](?:\.0+)?$'
  then
    raise exception 'invalid world channel'
      using errcode = '22023';
  end if;
  v_channel := (p_state ->> 'channel')::numeric::smallint;

  if jsonb_typeof(p_state -> 'map') is distinct from 'string' then
    raise exception 'invalid world presence map'
      using errcode = '22023';
  end if;
  v_map := p_state ->> 'map';
  if char_length(v_map) not between 1 and 40
    or v_map !~ '^[A-Za-z][A-Za-z0-9_-]{0,39}$'
  then
    raise exception 'invalid world presence map'
      using errcode = '22023';
  end if;

  if jsonb_typeof(p_state -> 'x') is distinct from 'number'
    or jsonb_typeof(p_state -> 'y') is distinct from 'number'
  then
    raise exception 'invalid world presence coordinates'
      using errcode = '22023';
  end if;
  begin
    v_x := round((p_state ->> 'x')::numeric, 2);
    v_y := round((p_state ->> 'y')::numeric, 2);
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'invalid world presence coordinates'
        using errcode = '22023';
  end;
  if v_x not between 0 and 8192 or v_y not between 0 and 8192 then
    raise exception 'invalid world presence coordinates'
      using errcode = '22023';
  end if;

  select profile.display_name
    into v_display_name
    from public.player_profiles_v2 as profile
   where profile.user_id = v_user_id;
  if not found then
    raise exception 'student profile is required'
      using errcode = '42501';
  end if;

  if p_state ? 'knownVisuals' then
    if jsonb_typeof(p_state -> 'knownVisuals') is distinct from 'object' then
      raise exception 'invalid known world visuals'
        using errcode = '22023';
    end if;
    select coalesce(
      jsonb_object_agg(item.key, item.value order by item.key),
      '{}'::jsonb
    )
      into v_known_visuals
      from pg_catalog.jsonb_each(p_state -> 'knownVisuals') as item(key, value)
     where item.key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and jsonb_typeof(item.value) = 'string'
       and (item.value #>> '{}') ~ '^[0-9a-f]{32}$';
  end if;

  if p_state ? 'lastChatId' then
    if jsonb_typeof(p_state -> 'lastChatId') is distinct from 'string'
      or (p_state ->> 'lastChatId') !~ '^[0-9]{1,19}$'
    then
      raise exception 'invalid world chat cursor'
        using errcode = '22023';
    end if;
    begin
      v_last_chat_id := (p_state ->> 'lastChatId')::bigint;
    exception
      when numeric_value_out_of_range then
        raise exception 'invalid world chat cursor'
          using errcode = '22023';
    end;
  end if;

  if p_state ? 'chat' then
    if jsonb_typeof(p_state -> 'chat') is distinct from 'object'
      or jsonb_typeof(p_state -> 'chat' -> 'id') is distinct from 'string'
      or jsonb_typeof(p_state -> 'chat' -> 'text') is distinct from 'string'
    then
      raise exception 'invalid world chat message'
        using errcode = '22023';
    end if;
    begin
      v_chat_id := (p_state -> 'chat' ->> 'id')::uuid;
    exception
      when invalid_text_representation then
        raise exception 'invalid world chat message'
          using errcode = '22023';
    end;
    v_chat_text := btrim(p_state -> 'chat' ->> 'text');
    if char_length(v_chat_text) not between 1 and 120
      or v_chat_text ~ '[[:cntrl:]]'
    then
      raise exception 'invalid world chat message'
        using errcode = '22023';
    end if;
  end if;

  v_now := clock_timestamp();

  -- Serialize every admission decision for this channel. The trigger takes the
  -- same re-entrant transaction lock, covering legacy writes as well as v3.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'yuksam-world-channel-capacity-v1|' || v_channel::text,
      0
    )
  );

  select presence.channel,
         presence.channel = v_channel
           and presence.last_seen_at >= v_now - interval '8 seconds'
    into v_previous_channel, v_active_incumbent
    from public.world_presence_v1 as presence
   where presence.user_id = v_user_id;
  if not found then
    v_previous_channel := null;
    v_active_incumbent := false;
  end if;

  select count(*)::integer
    into v_active_requested
    from public.world_presence_v1 as presence
   where presence.channel = v_channel
     and presence.user_id <> v_user_id
     and presence.last_seen_at >= v_now - interval '8 seconds';

  select jsonb_build_object(
    '1', count(*) filter (where presence.channel = 1),
    '2', count(*) filter (where presence.channel = 2),
    '3', count(*) filter (where presence.channel = 3),
    '4', count(*) filter (where presence.channel = 4),
    '5', count(*) filter (where presence.channel = 5)
  )
    into v_channel_counts
    from public.world_presence_v1 as presence
   where presence.last_seen_at >= v_now - interval '8 seconds';

  if v_active_requested >= 8 and not v_active_incumbent then
    return jsonb_build_object(
      'ok', false,
      'code', 'CHANNEL_FULL',
      'map', v_map,
      'channel', v_channel,
      'previousChannel', v_previous_channel,
      'channelCounts', coalesce(v_channel_counts, '{}'::jsonb),
      'players', '[]'::jsonb,
      'visuals', '[]'::jsonb,
      'messages', '[]'::jsonb,
      'announcements', '[]'::jsonb,
      'acceptedChatId', null
    );
  end if;

  -- Establish the requested channel before delegating state sanitization to
  -- v2/v1. This also means a new row cannot momentarily enter default channel 1.
  insert into public.world_presence_v1 as presence (
    user_id, display_name, map, x, y, state, channel, last_seen_at
  ) values (
    v_user_id, v_display_name, v_map, v_x, v_y, '{}'::jsonb,
    v_channel, v_now
  )
  on conflict (user_id) do update
    set display_name = excluded.display_name,
        map = excluded.map,
        x = excluded.x,
        y = excluded.y,
        channel = excluded.channel,
        last_seen_at = excluded.last_seen_at;

  -- v1 owns the complete visual sanitizer. Chat is removed and inserted below
  -- with its immutable channel, while v2 still supplies global announcements.
  v_base := public.sync_world_presence_v2(p_state - 'chat');
  v_now := clock_timestamp();

  if v_chat_id is not null then
    insert into public.world_chat_v1 (
      user_id, client_message_id, display_name, body, channel, created_at
    )
    select
      v_user_id, v_chat_id, v_display_name, v_chat_text, v_channel, v_now
     where not exists (
       select 1
         from public.world_chat_v1 as recent_message
        where recent_message.user_id = v_user_id
          and recent_message.created_at > v_now - interval '750 milliseconds'
     )
    on conflict (user_id, client_message_id) do nothing
    returning client_message_id into v_chat_accepted_id;

    if v_chat_accepted_id is null then
      select existing.client_message_id
        into v_chat_accepted_id
        from public.world_chat_v1 as existing
       where existing.user_id = v_user_id
         and existing.client_message_id = v_chat_id
       limit 1;
    end if;

    delete from public.world_chat_v1 as old_message
     where old_message.user_id = v_user_id
       and old_message.id not in (
         select recent.id
           from public.world_chat_v1 as recent
          where recent.user_id = v_user_id
          order by recent.id desc
          limit 8
       );
  end if;

  with active as materialized (
    select candidate.user_id,
           candidate.display_name,
           candidate.x,
           candidate.y,
           candidate.state,
           candidate.state - array['facing', 'petSide', 'pvpAvailable', 'moving', 'dance'] as visual_state,
           pg_catalog.md5(
             (candidate.state - array['facing', 'petSide', 'pvpAvailable', 'moving', 'dance'])::text
             || '|' || candidate.display_name
           ) as visual_version
      from public.world_presence_v1 as candidate
     where candidate.map = v_map
       and candidate.channel = v_channel
       and candidate.last_seen_at >= v_now - interval '8 seconds'
  )
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'u', active.user_id,
               'x', active.x,
               'y', active.y,
               'v', active.visual_version,
               'f', active.state -> 'facing',
               'ps', active.state -> 'petSide',
               'mv', active.state -> 'moving',
               'dn', active.state -> 'dance',
               'pv', active.state -> 'pvpAvailable'
             )
             order by active.user_id
           ),
           '[]'::jsonb
         ),
         coalesce(
           jsonb_agg(
             active.visual_state || jsonb_build_object(
               'u', active.user_id,
               'name', active.display_name,
               'v', active.visual_version
             )
             order by active.user_id
           ) filter (
             where coalesce(v_known_visuals ->> active.user_id::text, '')
               <> active.visual_version
           ),
           '[]'::jsonb
         )
    into v_players, v_visuals
    from active;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', recent.id::text,
        'userId', recent.user_id,
        'name', recent.display_name,
        'text', recent.body,
        'at', recent.created_at
      )
      order by recent.id
    ),
    '[]'::jsonb
  )
    into v_messages
    from (
      select message.id,
             message.user_id,
             message.display_name,
             message.body,
             message.created_at
        from public.world_chat_v1 as message
       where message.channel = v_channel
         and message.id > v_last_chat_id
         and (
           v_last_chat_id > 0
           or message.created_at >= v_now - interval '5 minutes'
         )
       order by message.id
       limit 60
    ) as recent;

  select jsonb_build_object(
    '1', count(*) filter (where presence.channel = 1),
    '2', count(*) filter (where presence.channel = 2),
    '3', count(*) filter (where presence.channel = 3),
    '4', count(*) filter (where presence.channel = 4),
    '5', count(*) filter (where presence.channel = 5)
  )
    into v_channel_counts
    from public.world_presence_v1 as presence
   where presence.last_seen_at >= v_now - interval '8 seconds';

  return jsonb_build_object(
    'ok', true,
    'map', v_map,
    'channel', v_channel,
    'previousChannel', v_previous_channel,
    'channelCounts', coalesce(v_channel_counts, '{}'::jsonb),
    'players', coalesce(v_players, '[]'::jsonb),
    'visuals', coalesce(v_visuals, '[]'::jsonb),
    'messages', coalesce(v_messages, '[]'::jsonb),
    'announcements', coalesce(v_base -> 'announcements', '[]'::jsonb),
    'acceptedChatId', v_chat_accepted_id
  );
end;
$$;

revoke all on function public.sync_world_presence_v3(jsonb)
  from public, anon, authenticated;
grant execute on function public.sync_world_presence_v3(jsonb)
  to authenticated;

-- Compatibility is deliberate: older deployed clients can keep calling v2.
-- The capacity trigger still protects their default/existing channel, while
-- the current frontend uses v3 for explicit selection and isolated snapshots.

commit;
