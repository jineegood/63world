-- Open the classroom automatically for lunch in Seoul (13:00-13:55).
--
-- Manual teacher changes keep using the existing classroom_settings row. A
-- manual choice therefore takes effect immediately and remains in effect until
-- the next scheduled boundary, where the daily timetable takes control again.

create extension if not exists pg_cron with schema pg_catalog;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

-- A redeploy must replace, rather than duplicate, either named job.
do $migration$
declare
  v_job record;
begin
  for v_job in
    select jobid
    from cron.job
    where jobname in (
      'yuksam-classroom-lunch-open-v1',
      'yuksam-classroom-lunch-close-v1'
    )
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;
end;
$migration$;

-- Make the state correct as soon as this migration lands, even if it is
-- deployed in the middle of the lunch window. Asia/Seoul has no DST.
insert into public.shared_state_v2 (key, data)
values (
  'classroom_settings',
  jsonb_build_object(
    'version', 1,
    'serverOpen',
    (current_timestamp at time zone 'Asia/Seoul')::time >= time '13:00'
      and (current_timestamp at time zone 'Asia/Seoul')::time < time '13:55'
  )
)
on conflict (key) do update
set data = jsonb_set(
  jsonb_set(
    case
      when jsonb_typeof(public.shared_state_v2.data) = 'object'
        then public.shared_state_v2.data
      else '{}'::jsonb
    end,
    '{version}',
    '1'::jsonb,
    true
  ),
  '{serverOpen}',
  to_jsonb(
    (current_timestamp at time zone 'Asia/Seoul')::time >= time '13:00'
      and (current_timestamp at time zone 'Asia/Seoul')::time < time '13:55'
  ),
  true
);

-- pg_cron schedules use UTC. Seoul 13:00 and 13:55 are UTC 04:00 and 04:55.
select cron.schedule(
  'yuksam-classroom-lunch-open-v1',
  '0 4 * * *',
  $command$
    insert into public.shared_state_v2 (key, data)
    values ('classroom_settings', '{"version":1,"serverOpen":true}'::jsonb)
    on conflict (key) do update
    set data = jsonb_set(
      jsonb_set(
        case
          when jsonb_typeof(public.shared_state_v2.data) = 'object'
            then public.shared_state_v2.data
          else '{}'::jsonb
        end,
        '{version}',
        '1'::jsonb,
        true
      ),
      '{serverOpen}',
      'true'::jsonb,
      true
    );
  $command$
);

select cron.schedule(
  'yuksam-classroom-lunch-close-v1',
  '55 4 * * *',
  $command$
    insert into public.shared_state_v2 (key, data)
    values ('classroom_settings', '{"version":1,"serverOpen":false}'::jsonb)
    on conflict (key) do update
    set data = jsonb_set(
      jsonb_set(
        case
          when jsonb_typeof(public.shared_state_v2.data) = 'object'
            then public.shared_state_v2.data
          else '{}'::jsonb
        end,
        '{version}',
        '1'::jsonb,
        true
      ),
      '{serverOpen}',
      'false'::jsonb,
      true
    );
  $command$
);
