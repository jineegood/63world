begin;

-- Dungeon ranking progress is intentionally separate from raid_progress_v1.
-- Only a real room reaching a terminal battle phase can write this ledger, so
-- a teacher shortcut that merely unlocks the next ten-floor group is not a
-- ranking result.
create table if not exists public.raid_best_progress_v1 (
  user_id uuid primary key references auth.users(id) on delete cascade,
  floor_group smallint not null check (floor_group between 1 and 7),
  reached_floor smallint not null check (reached_floor between 1 and 63),
  encounter_index smallint not null check (encounter_index between 0 and 4),
  cleared boolean not null default false,
  source_room_id uuid references public.raid_rooms_v1(id) on delete set null,
  achieved_at timestamptz not null default now(),
  check (
    (floor_group between 1 and 6
      and reached_floor between ((floor_group - 1) * 10 + 1) and (floor_group * 10))
    or (floor_group = 7 and reached_floor between 61 and 63)
  )
);

create index if not exists raid_best_progress_v1_ranking
  on public.raid_best_progress_v1(
    floor_group desc,
    reached_floor desc,
    encounter_index desc,
    cleared desc,
    achieved_at asc,
    user_id asc
  );

alter table public.raid_best_progress_v1 enable row level security;
alter table public.raid_best_progress_v1 force row level security;
revoke all on table public.raid_best_progress_v1
  from public, anon, authenticated;
grant select, insert, update, delete on table public.raid_best_progress_v1
  to service_role;

create or replace function public.private_record_raid_best_progress_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_floor_start smallint;
  v_floor_end smallint;
  v_reached_floor smallint;
  v_achieved_at timestamptz;
begin
  if new.phase in ('cleared', 'wiped')
    and old.phase is distinct from new.phase
    and old.phase not in ('cleared', 'wiped') then
    v_floor_start := (((new.floor_group::integer - 1) * 10) + 1)::smallint;
    v_floor_end := least(63, new.floor_group::integer * 10)::smallint;
    v_reached_floor := greatest(
      v_floor_start::integer,
      least(v_floor_end::integer, new.current_floor::integer)
    )::smallint;
    v_achieved_at := coalesce(new.finished_at, new.updated_at, clock_timestamp());

    insert into public.raid_best_progress_v1(
      user_id,
      floor_group,
      reached_floor,
      encounter_index,
      cleared,
      source_room_id,
      achieved_at
    )
    select member.user_id,
           new.floor_group,
           v_reached_floor,
           least(4, new.encounter_index)::smallint,
           new.phase = 'cleared',
           new.id,
           v_achieved_at
      from public.raid_room_members_v1 member
     where member.room_id = new.id
       and member.active
    on conflict (user_id) do update
    set floor_group = excluded.floor_group,
        reached_floor = excluded.reached_floor,
        encounter_index = excluded.encounter_index,
        cleared = excluded.cleared,
        source_room_id = excluded.source_room_id,
        achieved_at = excluded.achieved_at
    where (
      excluded.floor_group,
      excluded.reached_floor,
      excluded.encounter_index,
      excluded.cleared
    ) > (
      public.raid_best_progress_v1.floor_group,
      public.raid_best_progress_v1.reached_floor,
      public.raid_best_progress_v1.encounter_index,
      public.raid_best_progress_v1.cleared
    );
  end if;
  return new;
end;
$$;

drop trigger if exists record_raid_best_progress_v1 on public.raid_rooms_v1;
create trigger record_raid_best_progress_v1
after update of phase on public.raid_rooms_v1
for each row execute function public.private_record_raid_best_progress_v1();

-- Keep terminal transitions and the historical scan in one consistent view.
-- Re-running the migration is safe because both writes keep only the greater
-- lexicographic progress tuple.
lock table public.raid_rooms_v1 in share row exclusive mode;
lock table public.raid_best_progress_v1 in share row exclusive mode;

with historical_progress as (
  select member.user_id,
         room.id as source_room_id,
         room.floor_group,
         greatest(
           ((room.floor_group::integer - 1) * 10) + 1,
           least(
             least(63, room.floor_group::integer * 10),
             room.current_floor::integer
           )
         )::smallint as reached_floor,
         least(4, room.encounter_index)::smallint as encounter_index,
         room.phase = 'cleared' as cleared,
         coalesce(room.finished_at, room.updated_at, room.created_at) as achieved_at
    from public.raid_rooms_v1 room
    join public.raid_room_members_v1 member on member.room_id = room.id
   where room.phase in ('cleared', 'wiped')
     and (
       member.active
       or member.left_at is null
       or member.left_at >= coalesce(room.finished_at, room.updated_at, room.created_at)
     )
), best_historical_progress as (
  select distinct on (progress.user_id)
         progress.user_id,
         progress.floor_group,
         progress.reached_floor,
         progress.encounter_index,
         progress.cleared,
         progress.source_room_id,
         progress.achieved_at
    from historical_progress progress
   order by progress.user_id,
            progress.floor_group desc,
            progress.reached_floor desc,
            progress.encounter_index desc,
            progress.cleared desc,
            progress.achieved_at asc
)
insert into public.raid_best_progress_v1(
  user_id,
  floor_group,
  reached_floor,
  encounter_index,
  cleared,
  source_room_id,
  achieved_at
)
select progress.user_id,
       progress.floor_group,
       progress.reached_floor,
       progress.encounter_index,
       progress.cleared,
       progress.source_room_id,
       progress.achieved_at
  from best_historical_progress progress
on conflict (user_id) do update
set floor_group = excluded.floor_group,
    reached_floor = excluded.reached_floor,
    encounter_index = excluded.encounter_index,
    cleared = excluded.cleared,
    source_room_id = excluded.source_room_id,
    achieved_at = excluded.achieved_at
where (
  excluded.floor_group,
  excluded.reached_floor,
  excluded.encounter_index,
  excluded.cleared
) > (
  public.raid_best_progress_v1.floor_group,
  public.raid_best_progress_v1.reached_floor,
  public.raid_best_progress_v1.encounter_index,
  public.raid_best_progress_v1.cleared
);

-- One authenticated endpoint serves all six hall tabs. Every branch returns
-- the same public visual snapshot so raid/PvP winners render exactly like the
-- existing EXP rankings.
create or replace function public.load_hall_of_fame_v4(
  p_scope text default 'all'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_scope text := lower(btrim(coalesce(p_scope, 'all')));
  v_result jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication is required'
      using errcode = '42501';
  end if;
  if v_scope not in ('all', 'warrior', 'mage', 'priest', 'raid', 'pvp') then
    raise exception 'invalid hall of fame scope'
      using errcode = '22023';
  end if;

  if v_scope in ('all', 'warrior', 'mage', 'priest') then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'name', ranked.display_name,
          'class', ranked.data ->> 'class',
          'spec', ranked.data ->> 'spec',
          'level', ranked.level,
          'exp', ranked.exp,
          'gold', public.private_raid_profile_int_v1(ranked.data, 'gold'),
          'appearance', coalesce(ranked.data -> 'appearance', '{}'::jsonb),
          'equipment', coalesce(ranked.data -> 'equipment', '{}'::jsonb),
          'costume', coalesce(ranked.data -> 'costume', '{}'::jsonb),
          'weaponUpgrades', coalesce(ranked.data -> 'weaponUpgrades', '{}'::jsonb),
          'activePet', ranked.data ->> 'activePet',
          'nameplate', jsonb_build_object(
            'theme', coalesce(nullif(ranked.data #>> '{nameplate,theme}', ''), 'default')
          )
        )
        order by ranked.exp desc, ranked.level desc, ranked.updated_at asc, ranked.user_id
      ),
      '[]'::jsonb
    )
      into v_result
      from (
        select profile.user_id,
               profile.display_name,
               profile.data,
               profile.updated_at,
               public.private_raid_profile_int_v1(profile.data, 'exp') as exp,
               greatest(
                 1,
                 public.private_raid_profile_int_v1(profile.data, 'level', 100)
               )::integer as level
          from public.player_profiles_v2 profile
         where profile.data <> '{}'::jsonb
           and profile.data ->> 'class' in ('warrior', 'mage', 'priest')
           and (v_scope = 'all' or profile.data ->> 'class' = v_scope)
         order by exp desc, level desc, profile.updated_at asc, profile.user_id
         limit 5
      ) ranked;
  elsif v_scope = 'raid' then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'name', ranked.display_name,
          'class', ranked.data ->> 'class',
          'spec', ranked.data ->> 'spec',
          'level', ranked.level,
          'exp', ranked.exp,
          'gold', public.private_raid_profile_int_v1(ranked.data, 'gold'),
          'appearance', coalesce(ranked.data -> 'appearance', '{}'::jsonb),
          'equipment', coalesce(ranked.data -> 'equipment', '{}'::jsonb),
          'costume', coalesce(ranked.data -> 'costume', '{}'::jsonb),
          'weaponUpgrades', coalesce(ranked.data -> 'weaponUpgrades', '{}'::jsonb),
          'activePet', ranked.data ->> 'activePet',
          'nameplate', jsonb_build_object(
            'theme', coalesce(nullif(ranked.data #>> '{nameplate,theme}', ''), 'default')
          ),
          'floorGroup', ranked.floor_group,
          'reachedFloor', ranked.reached_floor,
          'encounterIndex', ranked.encounter_index,
          'cleared', ranked.cleared
        )
        order by ranked.floor_group desc,
                 ranked.reached_floor desc,
                 ranked.encounter_index desc,
                 ranked.cleared desc,
                 ranked.achieved_at asc,
                 ranked.user_id
      ),
      '[]'::jsonb
    )
      into v_result
      from (
        select profile.user_id,
               profile.display_name,
               profile.data,
               progress.floor_group,
               progress.reached_floor,
               progress.encounter_index,
               progress.cleared,
               progress.achieved_at,
               public.private_raid_profile_int_v1(profile.data, 'exp') as exp,
               greatest(
                 1,
                 public.private_raid_profile_int_v1(profile.data, 'level', 100)
               )::integer as level
          from public.raid_best_progress_v1 progress
          join public.player_profiles_v2 profile on profile.user_id = progress.user_id
         where profile.data <> '{}'::jsonb
           and profile.data ->> 'class' in ('warrior', 'mage', 'priest')
         order by progress.floor_group desc,
                  progress.reached_floor desc,
                  progress.encounter_index desc,
                  progress.cleared desc,
                  progress.achieved_at asc,
                  profile.user_id
         limit 5
      ) ranked;
  else
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'name', ranked.display_name,
          'class', ranked.data ->> 'class',
          'spec', ranked.data ->> 'spec',
          'level', ranked.level,
          'exp', ranked.exp,
          'gold', public.private_raid_profile_int_v1(ranked.data, 'gold'),
          'appearance', coalesce(ranked.data -> 'appearance', '{}'::jsonb),
          'equipment', coalesce(ranked.data -> 'equipment', '{}'::jsonb),
          'costume', coalesce(ranked.data -> 'costume', '{}'::jsonb),
          'weaponUpgrades', coalesce(ranked.data -> 'weaponUpgrades', '{}'::jsonb),
          'activePet', ranked.data ->> 'activePet',
          'nameplate', jsonb_build_object(
            'theme', coalesce(nullif(ranked.data #>> '{nameplate,theme}', ''), 'default')
          ),
          'wins', ranked.wins,
          'losses', ranked.losses
        )
        order by ranked.wins desc, ranked.losses asc, ranked.updated_at asc, ranked.user_id
      ),
      '[]'::jsonb
    )
      into v_result
      from (
        select profile.user_id,
               profile.display_name,
               profile.data,
               record.wins,
               record.losses,
               record.updated_at,
               public.private_raid_profile_int_v1(profile.data, 'exp') as exp,
               greatest(
                 1,
                 public.private_raid_profile_int_v1(profile.data, 'level', 100)
               )::integer as level
          from public.pvp_records_v1 record
          join public.player_profiles_v2 profile on profile.user_id = record.user_id
         where record.wins + record.losses > 0
           and profile.data <> '{}'::jsonb
           and profile.data ->> 'class' in ('warrior', 'mage', 'priest')
         order by record.wins desc, record.losses asc, record.updated_at asc, profile.user_id
         limit 5
      ) ranked;
  end if;

  return coalesce(v_result, '[]'::jsonb);
end;
$$;

revoke all on function public.private_record_raid_best_progress_v1()
  from public, anon, authenticated;
revoke all on function public.load_hall_of_fame_v4(text)
  from public, anon;
grant execute on function public.load_hall_of_fame_v4(text)
  to authenticated;

commit;
