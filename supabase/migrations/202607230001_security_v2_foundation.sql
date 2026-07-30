-- 63world secure Supabase foundation.
-- This migration is additive: the legacy players/shared_state tables are untouched.

create extension if not exists pgcrypto with schema extensions;
create table if not exists public.player_profiles_v2 (
  user_id uuid primary key references auth.users(id) on delete cascade,
  normalized_name text not null unique,
  display_name text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint player_profiles_v2_normalized_name_length
    check (char_length(normalized_name) between 1 and 20),
  constraint player_profiles_v2_display_name_length
    check (char_length(display_name) between 1 and 20),
  constraint player_profiles_v2_name_is_canonical
    check (
      normalized_name = lower(normalized_name)
      and normalized_name = regexp_replace(btrim(normalized_name), E'\\s+', ' ', 'g')
      and normalized_name !~ '[[:cntrl:]]'
      and display_name !~ '[[:cntrl:]]'
    )
);
create table if not exists public.leaderboard_entries_v2 (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  score integer not null default 0 check (score >= 0),
  level integer not null default 1 check (level >= 1),
  appearance jsonb not null default '{}'::jsonb,
  equipment jsonb not null default '{}'::jsonb,
  costume jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint leaderboard_entries_v2_display_name_length
    check (char_length(display_name) between 1 and 20),
  constraint leaderboard_entries_v2_display_name_safe
    check (display_name !~ '[[:cntrl:]]')
);
create table if not exists public.shared_state_v2 (
  key text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint shared_state_v2_key_length check (char_length(key) between 1 and 80),
  constraint shared_state_v2_key_format check (key ~ '^[a-z0-9][a-z0-9._-]*$')
);
create index if not exists leaderboard_entries_v2_score_idx
  on public.leaderboard_entries_v2 (score desc, updated_at asc);
create or replace function public.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select auth.jwt() -> 'app_metadata' ->> 'role') = 'teacher',
    false
  );
$$;
revoke all on function public.is_teacher() from public;
grant execute on function public.is_teacher() to authenticated;
create or replace function public.set_updated_at_v2()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
revoke all on function public.set_updated_at_v2() from public;
create or replace function public.protect_profile_identity_v2()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not public.is_teacher() and (
    new.user_id is distinct from old.user_id
    or new.normalized_name is distinct from old.normalized_name
    or new.display_name is distinct from old.display_name
  ) then
    raise exception 'student profile identity cannot be changed';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_profile_identity_v2() from public;
drop trigger if exists player_profiles_v2_protect_identity on public.player_profiles_v2;
create trigger player_profiles_v2_protect_identity
before update on public.player_profiles_v2
for each row execute function public.protect_profile_identity_v2();
drop trigger if exists player_profiles_v2_set_updated_at on public.player_profiles_v2;
create trigger player_profiles_v2_set_updated_at
before update on public.player_profiles_v2
for each row execute function public.set_updated_at_v2();
drop trigger if exists leaderboard_entries_v2_set_updated_at on public.leaderboard_entries_v2;
create trigger leaderboard_entries_v2_set_updated_at
before update on public.leaderboard_entries_v2
for each row execute function public.set_updated_at_v2();
drop trigger if exists shared_state_v2_set_updated_at on public.shared_state_v2;
create trigger shared_state_v2_set_updated_at
before update on public.shared_state_v2
for each row execute function public.set_updated_at_v2();
create or replace function public.handle_new_v2_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text;
  display_name text;
  expected_email text;
begin
  -- Teacher accounts are provisioned separately and do not receive student profiles.
  if coalesce(new.raw_app_meta_data ->> 'role', '') = 'teacher' then
    return new;
  end if;

  normalized_name := lower(
    regexp_replace(btrim(new.raw_user_meta_data ->> 'normalized_name'), E'\\s+', ' ', 'g')
  );
  display_name := regexp_replace(
    btrim(new.raw_user_meta_data ->> 'display_name'), E'\\s+', ' ', 'g'
  );

  if normalized_name is null
    or char_length(normalized_name) not between 1 and 20
    or normalized_name ~ '[[:cntrl:]]'
    or display_name is null
    or char_length(display_name) not between 1 and 20
    or display_name ~ '[[:cntrl:]]'
  then
    raise exception 'invalid student profile metadata';
  end if;

  expected_email := 'student-'
    || encode(extensions.digest(normalized_name, 'sha256'), 'hex')
    || '@63world.invalid';

  if lower(coalesce(new.email, '')) <> expected_email then
    raise exception 'student login identifier does not match profile name';
  end if;

  insert into public.player_profiles_v2 (user_id, normalized_name, display_name, data)
  values (new.id, normalized_name, display_name, '{}'::jsonb);

  return new;
end;
$$;
revoke all on function public.handle_new_v2_user() from public;
drop trigger if exists on_auth_user_created_v2 on auth.users;
create trigger on_auth_user_created_v2
after insert on auth.users
for each row execute function public.handle_new_v2_user();
alter table public.player_profiles_v2 enable row level security;
alter table public.player_profiles_v2 force row level security;
alter table public.leaderboard_entries_v2 enable row level security;
alter table public.leaderboard_entries_v2 force row level security;
alter table public.shared_state_v2 enable row level security;
alter table public.shared_state_v2 force row level security;
revoke all on table public.player_profiles_v2 from anon, authenticated;
revoke all on table public.leaderboard_entries_v2 from anon, authenticated;
revoke all on table public.shared_state_v2 from anon, authenticated;
grant select, insert, update, delete on table public.player_profiles_v2 to authenticated;
grant select, insert, update, delete on table public.leaderboard_entries_v2 to authenticated;
grant select, insert, update, delete on table public.shared_state_v2 to authenticated;
drop policy if exists "students read own profile v2" on public.player_profiles_v2;
create policy "students read own profile v2"
on public.player_profiles_v2 for select to authenticated
using (user_id = (select auth.uid()));
drop policy if exists "students insert own profile v2" on public.player_profiles_v2;
create policy "students insert own profile v2"
on public.player_profiles_v2 for insert to authenticated
with check (user_id = (select auth.uid()));
drop policy if exists "students update own profile v2" on public.player_profiles_v2;
create policy "students update own profile v2"
on public.player_profiles_v2 for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));
drop policy if exists "teachers administer profiles v2" on public.player_profiles_v2;
create policy "teachers administer profiles v2"
on public.player_profiles_v2 for all to authenticated
using ((select public.is_teacher()))
with check ((select public.is_teacher()));
drop policy if exists "authenticated users read leaderboard v2" on public.leaderboard_entries_v2;
create policy "authenticated users read leaderboard v2"
on public.leaderboard_entries_v2 for select to authenticated
using ((select auth.uid()) is not null);
drop policy if exists "students insert own leaderboard v2" on public.leaderboard_entries_v2;
create policy "students insert own leaderboard v2"
on public.leaderboard_entries_v2 for insert to authenticated
with check (user_id = (select auth.uid()));
drop policy if exists "students update own leaderboard v2" on public.leaderboard_entries_v2;
create policy "students update own leaderboard v2"
on public.leaderboard_entries_v2 for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));
drop policy if exists "teachers administer leaderboard v2" on public.leaderboard_entries_v2;
create policy "teachers administer leaderboard v2"
on public.leaderboard_entries_v2 for all to authenticated
using ((select public.is_teacher()))
with check ((select public.is_teacher()));
drop policy if exists "authenticated users read shared state v2" on public.shared_state_v2;
create policy "authenticated users read shared state v2"
on public.shared_state_v2 for select to authenticated
using ((select auth.uid()) is not null);
drop policy if exists "teachers administer shared state v2" on public.shared_state_v2;
create policy "teachers administer shared state v2"
on public.shared_state_v2 for all to authenticated
using ((select public.is_teacher()))
with check ((select public.is_teacher()));
