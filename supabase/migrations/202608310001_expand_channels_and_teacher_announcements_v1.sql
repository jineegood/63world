begin;

-- Ten channels keep each classroom roster small while preserving the existing
-- eight-student admission cap and all older channel 1-5 clients.
alter table public.world_presence_v1
  drop constraint if exists world_presence_v1_channel_safe;
alter table public.world_presence_v1
  add constraint world_presence_v1_channel_safe
  check (channel between 1 and 10);

alter table public.world_chat_v1
  drop constraint if exists world_chat_v1_channel_safe;
alter table public.world_chat_v1
  add constraint world_chat_v1_channel_safe
  check (channel between 1 and 10);

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
  if new.channel not between 1 and 10 then
    raise exception 'invalid world channel'
      using errcode = '22023';
  end if;
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
      using errcode = 'P0001', detail = 'CHANNEL_FULL';
  end if;
  return new;
end;
$$;

revoke all on function public.private_enforce_world_channel_capacity_v1()
  from public, anon, authenticated;

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
    or p_topic !~ '^world-motion-v1:channel-(?:[1-9]|10)$'
  then
    return false;
  end if;
  v_channel := pg_catalog.substring(
    p_topic,
    '^world-motion-v1:channel-([1-9]|10)$'
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

-- Preserve the already-audited v3 implementation and expand only its channel
-- validation and two bounded occupancy objects. The migration fails closed if
-- the expected deployed definition is not present.
do $expand_sync_v3$
declare
  v_definition text;
  v_channel_pattern text := '''^[1-5](?:\.0+)?$''';
  v_channel_replacement text := '''^(?:[1-9]|10)(?:\.0+)?$''';
  v_count_needle text := '''5'', count(*) filter (where presence.channel = 5)';
  v_count_replacement text := '''5'', count(*) filter (where presence.channel = 5),
    ''6'', count(*) filter (where presence.channel = 6),
    ''7'', count(*) filter (where presence.channel = 7),
    ''8'', count(*) filter (where presence.channel = 8),
    ''9'', count(*) filter (where presence.channel = 9),
    ''10'', count(*) filter (where presence.channel = 10)';
  v_count_occurrences integer;
begin
  select pg_catalog.pg_get_functiondef('public.sync_world_presence_v3(jsonb)'::regprocedure)
    into v_definition;
  if pg_catalog.strpos(v_definition, v_channel_pattern) = 0 then
    raise exception 'unexpected sync_world_presence_v3 channel validator';
  end if;
  v_count_occurrences := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_count_needle, ''))
  ) / pg_catalog.length(v_count_needle);
  if v_count_occurrences <> 2 then
    raise exception 'unexpected sync_world_presence_v3 channel counter count: %', v_count_occurrences;
  end if;
  v_definition := pg_catalog.replace(v_definition, v_channel_pattern, v_channel_replacement);
  v_definition := pg_catalog.replace(v_definition, v_count_needle, v_count_replacement);
  execute v_definition;
end;
$expand_sync_v3$;

revoke all on function public.sync_world_presence_v3(jsonb)
  from public, anon, authenticated;
grant execute on function public.sync_world_presence_v3(jsonb)
  to authenticated;

-- Teacher notices use the same locked global feed as legendary and raid facts.
alter table public.world_announcements_v1
  drop constraint if exists world_announcements_v1_kind_check;
alter table public.world_announcements_v1
  add constraint world_announcements_v1_kind_check
  check (kind in ('legendary_upgrade', 'legendary_pet', 'raid_clear', 'teacher_notice'));

create or replace function public.teacher_broadcast_world_announcement_v1(
  p_message text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_message text := pg_catalog.btrim(coalesce(p_message, ''));
  v_existing public.world_announcements_v1%rowtype;
  v_inserted public.world_announcements_v1%rowtype;
  v_last_created_at timestamptz;
begin
  if v_user_id is null or not public.is_teacher() then
    raise exception 'teacher authorization required'
      using errcode = '42501';
  end if;
  if p_request_id is null
    or char_length(v_message) not between 1 and 120
    or v_message ~ '[[:cntrl:]]'
  then
    raise exception 'invalid teacher announcement'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'yuksam-teacher-announcement-v1|' || v_user_id::text,
      0
    )
  );

  select announcement.*
    into v_existing
    from public.world_announcements_v1 as announcement
   where announcement.kind = 'teacher_notice'
     and announcement.source_id = p_request_id;
  if found then
    if v_existing.actor_user_id is distinct from v_user_id
      or coalesce(v_existing.payload ->> 'message', '') <> v_message
    then
      raise exception 'announcement request id was already used'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'ok', true,
      'id', v_existing.id::text,
      'message', v_message,
      'replayed', true
    );
  end if;

  select announcement.created_at
    into v_last_created_at
    from public.world_announcements_v1 as announcement
   where announcement.kind = 'teacher_notice'
     and announcement.actor_user_id = v_user_id
   order by announcement.id desc
   limit 1;
  if v_last_created_at > clock_timestamp() - interval '2 seconds' then
    raise exception 'teacher announcement rate limited'
      using errcode = 'P0001', detail = 'RATE_LIMITED';
  end if;

  insert into public.world_announcements_v1 (
    kind, source_id, actor_user_id, subject_id, payload
  ) values (
    'teacher_notice', p_request_id, v_user_id, null,
    jsonb_build_object('message', v_message)
  )
  returning * into v_inserted;

  return jsonb_build_object(
    'ok', true,
    'id', v_inserted.id::text,
    'message', v_message,
    'replayed', false
  );
end;
$$;

revoke all on function public.teacher_broadcast_world_announcement_v1(text, uuid)
  from public, anon, authenticated;
grant execute on function public.teacher_broadcast_world_announcement_v1(text, uuid)
  to authenticated;

-- Add the teacher message to the existing bounded global-announcement cursor.
create or replace function public.sync_world_presence_v2(p_state jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base jsonb;
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

  v_base := public.sync_world_presence_v1(p_state);

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

  return coalesce(v_base, '{}'::jsonb) || jsonb_build_object(
    'announcements', coalesce(v_announcements, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.sync_world_presence_v2(jsonb)
  from public, anon, authenticated;
grant execute on function public.sync_world_presence_v2(jsonb)
  to authenticated;

commit;
