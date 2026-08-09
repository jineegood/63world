-- Keep raid floor unlocks as server-owned progress.
-- The JSON player save is still mirrored for the existing UI, but students cannot
-- raise or erase the authoritative value through a normal profile save.

create table if not exists public.raid_progress_v1 (
  user_id uuid primary key references auth.users(id) on delete cascade,
  top_group smallint not null default 0 check (top_group between 0 and 7),
  updated_at timestamptz not null default now()
);

alter table public.raid_progress_v1 enable row level security;
alter table public.raid_progress_v1 force row level security;
revoke all on table public.raid_progress_v1 from public, anon, authenticated;
grant select, insert, update on table public.raid_progress_v1 to service_role;

-- Recover every historical clear still present in the room ledger.
insert into public.raid_progress_v1(user_id, top_group, updated_at)
select member.user_id,
       greatest(0, least(7, max(room.floor_group)::integer))::smallint,
       coalesce(max(room.finished_at), now())
  from public.raid_rooms_v1 room
  join public.raid_room_members_v1 member on member.room_id = room.id
 where room.phase = 'cleared'
 group by member.user_id
on conflict (user_id) do update
set top_group = greatest(public.raid_progress_v1.top_group, excluded.top_group),
    updated_at = greatest(public.raid_progress_v1.updated_at, excluded.updated_at);

-- Mirror the recovered value into the player JSON so the floor selection screen
-- can show the unlock immediately after login.
update public.player_profiles_v2 profile
   set data = jsonb_set(
     coalesce(profile.data, '{}'::jsonb),
     '{raidTopGroup}',
     to_jsonb(progress.top_group::integer),
     true
   )
  from public.raid_progress_v1 progress
 where progress.user_id = profile.user_id;

create or replace function public.private_guard_raid_progress_profile_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_top_group integer := 0;
begin
  select progress.top_group into v_top_group
    from public.raid_progress_v1 progress
   where progress.user_id = new.user_id;
  v_top_group := coalesce(v_top_group, 0);
  new.data := jsonb_set(
    coalesce(new.data, '{}'::jsonb) - 'raid_top_group',
    '{raidTopGroup}',
    to_jsonb(v_top_group),
    true
  );
  return new;
end;
$$;

drop trigger if exists guard_raid_progress_profile_v1 on public.player_profiles_v2;
create trigger guard_raid_progress_profile_v1
before insert or update of data on public.player_profiles_v2
for each row execute function public.private_guard_raid_progress_profile_v1();

create or replace function public.private_record_raid_clear_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.phase = 'cleared' and old.phase is distinct from 'cleared' then
    insert into public.raid_progress_v1(user_id, top_group, updated_at)
    select member.user_id,
           greatest(0, least(7, new.floor_group::integer))::smallint,
           coalesce(new.finished_at, new.updated_at, now())
      from public.raid_room_members_v1 member
     where member.room_id = new.id
    on conflict (user_id) do update
    set top_group = greatest(public.raid_progress_v1.top_group, excluded.top_group),
        updated_at = greatest(public.raid_progress_v1.updated_at, excluded.updated_at);

    update public.player_profiles_v2 profile
       set data = jsonb_set(
         coalesce(profile.data, '{}'::jsonb),
         '{raidTopGroup}',
         to_jsonb(progress.top_group::integer),
         true
       )
      from public.raid_progress_v1 progress
     where progress.user_id = profile.user_id
       and exists (
         select 1 from public.raid_room_members_v1 member
          where member.room_id = new.id and member.user_id = profile.user_id
       );
  end if;
  return new;
end;
$$;

drop trigger if exists record_raid_clear_v1 on public.raid_rooms_v1;
create trigger record_raid_clear_v1
after update of phase on public.raid_rooms_v1
for each row execute function public.private_record_raid_clear_v1();

revoke all on function public.private_guard_raid_progress_profile_v1()
  from public, anon, authenticated;
revoke all on function public.private_record_raid_clear_v1()
  from public, anon, authenticated;
