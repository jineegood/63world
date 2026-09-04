begin;

-- Fix the v4 -> v3 -> v2 -> v1 double write and unintended channel-1 INSERT
-- trigger lock. The audited visual sanitizer and legacy snapshot/chat contract
-- live in one private core; channel-aware callers only request the write.
-- No table policies, channel bounds/capacity, v4 auto-distribution, realtime
-- access checks, renderer, movement, or frame timing are changed.
-- Lock order for one RPC: optional v4 auto-admission -> user -> target channel.

create or replace function public.private_sync_world_presence_core_v1(
  p_state jsonb,
  p_channel smallint,
  p_include_snapshot boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_display_name text;
  v_map text;
  v_channel smallint;
  v_x numeric;
  v_y numeric;
  v_now timestamptz;
  v_equipment jsonb := '{}'::jsonb;
  v_appearance jsonb := '{}'::jsonb;
  v_costume jsonb := '{}'::jsonb;
  v_nameplate jsonb := jsonb_build_object('theme', 'default');
  v_safe_state jsonb;
  v_chat_id uuid;
  v_chat_text text;
  v_chat_accepted_id uuid;
  v_known_visuals jsonb := '{}'::jsonb;
  v_last_chat_id bigint := 0;
  v_players jsonb := '[]'::jsonb;
  v_visuals jsonb := '[]'::jsonb;
  v_messages jsonb := '[]'::jsonb;
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

  -- Never trust the caller's name. Student profile identity is protected by the
  -- existing profile trigger and is the canonical display name for this row.
  select profile.display_name
    into v_display_name
    from public.player_profiles_v2 as profile
   where profile.user_id = v_user_id;
  if not found then
    raise exception 'student profile is required'
      using errcode = '42501';
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

  -- Keep only bounded visual equipment slots. Caller-provided userId, name,
  -- timestamps, and any unknown keys are deliberately discarded.
  select coalesce(
    jsonb_object_agg(item.key, item.value order by item.key),
    '{}'::jsonb
  )
    into v_equipment
    from pg_catalog.jsonb_each(
      case
        when jsonb_typeof(p_state -> 'equipment') = 'object'
          then p_state -> 'equipment'
        else '{}'::jsonb
      end
    ) as item(key, value)
   where item.key in ('weapon', 'head', 'armor', 'accessory')
     and jsonb_typeof(item.value) = 'string'
     and char_length(item.value #>> '{}') between 1 and 80
     and (item.value #>> '{}') !~ '[[:cntrl:]]';

  select coalesce(
    jsonb_object_agg(item.key, item.value order by item.key),
    '{}'::jsonb
  )
    into v_appearance
    from pg_catalog.jsonb_each(
      case
        when jsonb_typeof(p_state -> 'appearance') = 'object'
          then p_state -> 'appearance'
        else '{}'::jsonb
      end
    ) as item(key, value)
   where item.key in ('shirt', 'pants', 'hair', 'hairStyle', 'skin', 'accessory')
     and jsonb_typeof(item.value) = 'string'
     and char_length(item.value #>> '{}') between 1 and 64
     and (item.value #>> '{}') !~ '[[:cntrl:]]';

  select coalesce(
    jsonb_object_agg(item.key, item.value order by item.key),
    '{}'::jsonb
  )
    into v_costume
    from pg_catalog.jsonb_each(
      case
        when jsonb_typeof(p_state -> 'costume') = 'object'
          then p_state -> 'costume'
        else '{}'::jsonb
      end
    ) as item(key, value)
   where item.key in ('head', 'armor', 'accessory')
     and jsonb_typeof(item.value) = 'string'
     and char_length(item.value #>> '{}') between 1 and 80
     and (item.value #>> '{}') !~ '[[:cntrl:]]';

  if jsonb_typeof(p_state -> 'nameplate') = 'object'
    and jsonb_typeof(p_state -> 'nameplate' -> 'theme') = 'string'
    and char_length(p_state -> 'nameplate' ->> 'theme') between 1 and 40
    and (p_state -> 'nameplate' ->> 'theme') ~ '^[a-z0-9][a-z0-9_-]{0,39}$'
  then
    v_nameplate := jsonb_build_object(
      'theme',
      p_state -> 'nameplate' ->> 'theme'
    );
  end if;

  v_safe_state := jsonb_strip_nulls(jsonb_build_object(
    'type', 'pos',
    'level', case
      when jsonb_typeof(p_state -> 'level') = 'number' then
        least(10::numeric, greatest(1::numeric, (p_state ->> 'level')::numeric))::integer
      else 1
    end,
    'class', case
      when p_state ->> 'class' in ('warrior', 'mage', 'priest')
        then p_state ->> 'class'
      else null
    end,
    'spec', case
      when jsonb_typeof(p_state -> 'spec') = 'string'
        and char_length(p_state ->> 'spec') between 1 and 16
        and (p_state ->> 'spec') !~ '[[:cntrl:]]'
        then p_state ->> 'spec'
      else null
    end,
    'equipment', v_equipment,
    'appearance', v_appearance,
    'costume', v_costume,
    'nameplate', v_nameplate,
    'activePet', case
      when jsonb_typeof(p_state -> 'activePet') = 'string'
        and char_length(p_state ->> 'activePet') between 1 and 80
        and (p_state ->> 'activePet') ~ '^[A-Za-z][A-Za-z0-9_-]{0,79}$'
        then p_state ->> 'activePet'
      else null
    end,
    'petSide', case
      when p_state ->> 'petSide' in ('left', 'right')
        then p_state ->> 'petSide'
      else 'left'
    end,
    'weaponTier', case
      when jsonb_typeof(p_state -> 'weaponTier') = 'number' then
        least(4::numeric, greatest(0::numeric, (p_state ->> 'weaponTier')::numeric))::integer
      else 0
    end,
    'facing', jsonb_build_object(
      'x', case
        when jsonb_typeof(p_state -> 'facing') = 'object'
          and jsonb_typeof(p_state -> 'facing' -> 'x') = 'number'
          then round(least(1::numeric, greatest(-1::numeric,
            (p_state -> 'facing' ->> 'x')::numeric)), 3)
        else 0
      end,
      'y', case
        when jsonb_typeof(p_state -> 'facing') = 'object'
          and jsonb_typeof(p_state -> 'facing' -> 'y') = 'number'
          then round(least(1::numeric, greatest(-1::numeric,
            (p_state -> 'facing' ->> 'y')::numeric)), 3)
        else 1
      end
    ),
    'pvpAvailable', case
      when jsonb_typeof(p_state -> 'pvpAvailable') = 'boolean'
        then (p_state ->> 'pvpAvailable')::boolean
      else false
    end,
    'moving', case
      when jsonb_typeof(p_state -> 'moving') = 'boolean'
        then (p_state ->> 'moving')::boolean
      else false
    end,
    'dance', case
      when jsonb_typeof(p_state -> 'dance') = 'boolean'
        then (p_state ->> 'dance')::boolean
      else false
    end
  ));

  if octet_length(v_safe_state::text) > 4096 then
    raise exception 'sanitized world presence state is too large'
      using errcode = '22023';
  end if;

  -- Serialize this student's channel read and write before taking a channel
  -- lock. A legacy heartbeat cannot race a simultaneous explicit channel move.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'yuksam-world-presence-user-v1|' || v_user_id::text,
      0
    )
  );

  v_channel := p_channel;
  if v_channel is null then
    select presence.channel
      into v_channel
      from public.world_presence_v1 as presence
     where presence.user_id = v_user_id;
    v_channel := coalesce(v_channel, 1);
  end if;
  if v_channel not between 1 and 10 then
    raise exception 'invalid world channel'
      using errcode = '22023';
  end if;

  -- Always supply the actual channel on INSERT: BEFORE INSERT triggers also
  -- run on ON CONFLICT, even when the row already exists on another channel.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'yuksam-world-channel-capacity-v1|' || v_channel::text,
      0
    )
  );
  v_now := clock_timestamp();

  insert into public.world_presence_v1 as presence (
    user_id,
    display_name,
    map,
    x,
    y,
    state,
    channel,
    last_seen_at
  ) values (
    v_user_id,
    v_display_name,
    v_map,
    v_x,
    v_y,
    v_safe_state,
    v_channel,
    v_now
  )
  on conflict (user_id) do update
    set display_name = excluded.display_name,
        map = excluded.map,
        x = excluded.x,
        y = excluded.y,
        state = excluded.state,
        channel = excluded.channel,
        last_seen_at = excluded.last_seen_at;

  if v_chat_id is not null then
    insert into public.world_chat_v1 (
      user_id,
      client_message_id,
      display_name,
      body,
      created_at
    )
    select
      v_user_id,
      v_chat_id,
      v_display_name,
      v_chat_text,
      v_now
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

  -- v3 builds its channel-scoped snapshot and handles channel chat itself.
  -- This argument is private and is never read from caller-supplied JSON.
  if not p_include_snapshot then
    return '{}'::jsonb;
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
             where coalesce(v_known_visuals ->> active.user_id::text, '') <> active.visual_version
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
       where message.id > v_last_chat_id
         and (
           v_last_chat_id > 0
           or message.created_at >= v_now - interval '5 minutes'
         )
       order by message.id
       limit 60
    ) as recent;

  return jsonb_build_object(
    'map', v_map,
    'players', coalesce(v_players, '[]'::jsonb),
    'visuals', coalesce(v_visuals, '[]'::jsonb),
    'messages', coalesce(v_messages, '[]'::jsonb),
    'acceptedChatId', v_chat_accepted_id
  );
end;
$$;

revoke all on function public.private_sync_world_presence_core_v1(jsonb, smallint, boolean)
  from public, anon, authenticated;

-- One unchanged global announcement projection/cursor, shared by v2 and v3.
create or replace function public.private_list_world_announcements_v1(p_state jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last_announcement_id bigint := 0;
  v_now timestamptz := clock_timestamp();
  v_announcements jsonb := '[]'::jsonb;
begin
  if p_state ? 'lastAnnouncementId' then
    if jsonb_typeof(p_state -> 'lastAnnouncementId') is distinct from 'string'
      or (p_state ->> 'lastAnnouncementId') !~ '^[0-9]{1,19}$'
    then
      raise exception 'invalid world announcement cursor'
        using errcode = '22023';
    end if;
    begin
      v_last_announcement_id := (p_state ->> 'lastAnnouncementId')::bigint;
    exception when numeric_value_out_of_range then
      raise exception 'invalid world announcement cursor'
        using errcode = '22023';
    end;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', recent.id::text,
    'kind', recent.kind,
    'actorName', recent.payload ->> 'actorName',
    'subjectId', recent.subject_id,
    'partyNames', recent.payload -> 'partyNames',
    'floor', recent.payload -> 'floor',
    'message', recent.payload ->> 'message',
    'at', recent.created_at
  ) order by recent.id), '[]'::jsonb)
    into v_announcements
    from (
      select announcement.id,
             announcement.kind,
             announcement.subject_id,
             announcement.payload,
             announcement.created_at
        from public.world_announcements_v1 announcement
       where announcement.id > v_last_announcement_id
         and (
           v_last_announcement_id > 0
           or announcement.created_at >= v_now - interval '5 minutes'
         )
       order by announcement.id
       limit 30
    ) recent;

  return coalesce(v_announcements, '[]'::jsonb);
end;
$$;

revoke all on function public.private_list_world_announcements_v1(jsonb)
  from public, anon, authenticated;

create or replace function public.sync_world_presence_v1(p_state jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Legacy callers keep global snapshots/chat and their existing assignment.
  -- No JSON key can select a channel or suppress the authoritative write.
  return public.private_sync_world_presence_core_v1(p_state, null, true);
end;
$$;

create or replace function public.sync_world_presence_v2(p_state jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base jsonb;
  v_announcements jsonb;
begin
  -- Preserve cursor validation before the legacy presence write.
  v_announcements := public.private_list_world_announcements_v1(p_state);
  v_base := public.sync_world_presence_v1(p_state);
  return coalesce(v_base, '{}'::jsonb) || jsonb_build_object(
    'announcements', coalesce(v_announcements, '[]'::jsonb)
  );
end;
$$;

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
  v_announcements jsonb := '[]'::jsonb;
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
    or (p_state ->> 'channel') !~ '^(?:[1-9]|10)(?:\.0+)?$'
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

  -- Shared with legacy v1/v2: user assignment is stable until this transaction
  -- finishes. Always acquire the user lock before the requested channel lock.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'yuksam-world-presence-user-v1|' || v_user_id::text,
      0
    )
  );

  -- Serialize every admission decision for this channel. The trigger takes the
  -- same re-entrant transaction lock, covering legacy writes as well as v3.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'yuksam-world-channel-capacity-v1|' || v_channel::text,
      0
    )
  );

  -- Waiting must not leave the eight-second active window anchored in the past.
  v_now := clock_timestamp();

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

  if v_active_requested >= 8 and not v_active_incumbent then
    -- A successful sync only needs the fresh, post-write counters below.
    select jsonb_build_object(
      '1', count(*) filter (where presence.channel = 1),
      '2', count(*) filter (where presence.channel = 2),
      '3', count(*) filter (where presence.channel = 3),
      '4', count(*) filter (where presence.channel = 4),
      '5', count(*) filter (where presence.channel = 5),
      '6', count(*) filter (where presence.channel = 6),
      '7', count(*) filter (where presence.channel = 7),
      '8', count(*) filter (where presence.channel = 8),
      '9', count(*) filter (where presence.channel = 9),
      '10', count(*) filter (where presence.channel = 10)
    )
      into v_channel_counts
      from public.world_presence_v1 as presence
     where presence.last_seen_at >= v_now - interval '8 seconds';

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

  -- Read the same validated global announcement feed as v2, then perform
  -- exactly one sanitized presence upsert. The private core skips the legacy
  -- global roster/chat reads that this channel-scoped response would discard.
  v_announcements := public.private_list_world_announcements_v1(p_state);
  perform public.private_sync_world_presence_core_v1(
    p_state - 'chat', v_channel, false
  );
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
    '5', count(*) filter (where presence.channel = 5),
    '6', count(*) filter (where presence.channel = 6),
    '7', count(*) filter (where presence.channel = 7),
    '8', count(*) filter (where presence.channel = 8),
    '9', count(*) filter (where presence.channel = 9),
    '10', count(*) filter (where presence.channel = 10)
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
    'announcements', coalesce(v_announcements, '[]'::jsonb),
    'acceptedChatId', v_chat_accepted_id
  );
end;
$$;

revoke all on function public.sync_world_presence_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.sync_world_presence_v1(jsonb)
  to authenticated;

revoke all on function public.sync_world_presence_v2(jsonb)
  from public, anon, authenticated;
grant execute on function public.sync_world_presence_v2(jsonb)
  to authenticated;

revoke all on function public.sync_world_presence_v3(jsonb)
  from public, anon, authenticated;
grant execute on function public.sync_world_presence_v3(jsonb)
  to authenticated;

commit;
