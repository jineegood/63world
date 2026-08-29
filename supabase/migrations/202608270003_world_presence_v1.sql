begin;

-- One short-lived world state per authenticated student. Rows are overwritten by
-- user_id, so reconnects and map changes cannot append duplicate presence rows.
create table if not exists public.world_presence_v1 (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  map text not null,
  x numeric(9, 2) not null,
  y numeric(9, 2) not null,
  state jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz not null default now(),
  constraint world_presence_v1_display_name_safe
    check (
      char_length(display_name) between 1 and 20
      and display_name !~ '[[:cntrl:]]'
    ),
  constraint world_presence_v1_map_safe
    check (
      char_length(map) between 1 and 40
      and map ~ '^[A-Za-z][A-Za-z0-9_-]{0,39}$'
    ),
  constraint world_presence_v1_coordinates_safe
    check (x between 0 and 8192 and y between 0 and 8192),
  constraint world_presence_v1_state_safe
    check (
      jsonb_typeof(state) = 'object'
      and octet_length(state::text) <= 4096
    )
);

create index if not exists world_presence_v1_active_map_idx
  on public.world_presence_v1 (map, last_seen_at desc, user_id);

alter table public.world_presence_v1 enable row level security;
alter table public.world_presence_v1 force row level security;

-- The table is intentionally RPC-only. No client role receives direct reads or
-- writes; the SECURITY DEFINER function below is the sole public boundary.
revoke all on table public.world_presence_v1 from public, anon, authenticated;

-- Chat is polled through the same authenticated RPC as presence. Keeping only
-- eight messages per student bounds storage without a scheduled cleanup job.
create table if not exists public.world_chat_v1 (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_message_id uuid not null,
  display_name text not null,
  body text not null,
  created_at timestamptz not null default now(),
  constraint world_chat_v1_client_message_unique
    unique (user_id, client_message_id),
  constraint world_chat_v1_display_name_safe
    check (
      char_length(display_name) between 1 and 20
      and display_name !~ '[[:cntrl:]]'
    ),
  constraint world_chat_v1_body_safe
    check (
      char_length(body) between 1 and 120
      and body !~ '[[:cntrl:]]'
    )
);

create index if not exists world_chat_v1_recent_idx
  on public.world_chat_v1 (created_at desc, id desc);

alter table public.world_chat_v1 enable row level security;
alter table public.world_chat_v1 force row level security;
revoke all on table public.world_chat_v1 from public, anon, authenticated;
revoke all on sequence public.world_chat_v1_id_seq from public, anon, authenticated;

create or replace function public.sync_world_presence_v1(p_state jsonb)
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

  v_now := clock_timestamp();

  insert into public.world_presence_v1 as presence (
    user_id,
    display_name,
    map,
    x,
    y,
    state,
    last_seen_at
  ) values (
    v_user_id,
    v_display_name,
    v_map,
    v_x,
    v_y,
    v_safe_state,
    v_now
  )
  on conflict (user_id) do update
    set display_name = excluded.display_name,
        map = excluded.map,
        x = excluded.x,
        y = excluded.y,
        state = excluded.state,
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

revoke all on function public.sync_world_presence_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.sync_world_presence_v1(jsonb)
  to authenticated;

commit;
