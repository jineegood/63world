-- Observe suspicious student profile saves without blocking gameplay.

create table if not exists public.profile_security_audits_v1 (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null default '',
  issues jsonb not null default '[]'::jsonb,
  observed jsonb not null default '{}'::jsonb,
  fingerprint text not null,
  occurrences integer not null default 1 check (occurrences > 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint profile_security_audits_v1_issues_array
    check (jsonb_typeof(issues) = 'array')
);

create unique index if not exists profile_security_audits_v1_open_fingerprint
  on public.profile_security_audits_v1 (user_id, fingerprint)
  where resolved_at is null;
create index if not exists profile_security_audits_v1_open_recent
  on public.profile_security_audits_v1 (last_seen_at desc)
  where resolved_at is null;

alter table public.profile_security_audits_v1 enable row level security;
alter table public.profile_security_audits_v1 force row level security;
revoke all on table public.profile_security_audits_v1 from anon, authenticated;
grant select, update, delete on table public.profile_security_audits_v1 to authenticated;

drop policy if exists "teachers read profile security audits v1"
  on public.profile_security_audits_v1;
create policy "teachers read profile security audits v1"
  on public.profile_security_audits_v1 for select to authenticated
  using ((select public.is_teacher()));

drop policy if exists "teachers resolve profile security audits v1"
  on public.profile_security_audits_v1;
create policy "teachers resolve profile security audits v1"
  on public.profile_security_audits_v1 for update to authenticated
  using ((select public.is_teacher()))
  with check ((select public.is_teacher()));

drop policy if exists "teachers delete profile security audits v1"
  on public.profile_security_audits_v1;
create policy "teachers delete profile security audits v1"
  on public.profile_security_audits_v1 for delete to authenticated
  using ((select public.is_teacher()));

create or replace function public.audit_student_profile_save_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  issues text[] := array[]::text[];
  new_exp numeric := 0;
  old_exp numeric := 0;
  new_gold numeric := 0;
  old_gold numeric := 0;
  new_building numeric := 0;
  old_building numeric := 0;
  saved_level integer := 1;
  expected_level integer := 1;
  learned_points numeric := 0;
  remaining_points numeric := 0;
  issue_json jsonb;
  issue_fingerprint text;
begin
  -- Trusted teacher/service operations are already authenticated separately.
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'teacher'
    or coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    return new;
  end if;

  if jsonb_typeof(new.data -> 'exp') = 'number' then new_exp := (new.data ->> 'exp')::numeric;
  else issues := array_append(issues, 'INVALID_EXP'); end if;
  if jsonb_typeof(old.data -> 'exp') = 'number' then old_exp := (old.data ->> 'exp')::numeric; end if;

  if jsonb_typeof(new.data -> 'gold') = 'number' then new_gold := (new.data ->> 'gold')::numeric;
  else issues := array_append(issues, 'INVALID_GOLD'); end if;
  if jsonb_typeof(old.data -> 'gold') = 'number' then old_gold := (old.data ->> 'gold')::numeric; end if;

  if jsonb_typeof(new.data -> 'building') = 'number' then new_building := (new.data ->> 'building')::numeric;
  else issues := array_append(issues, 'INVALID_BUILDING'); end if;
  if jsonb_typeof(old.data -> 'building') = 'number' then old_building := (old.data ->> 'building')::numeric; end if;

  if jsonb_typeof(new.data -> 'level') = 'number' then
    saved_level := greatest(1, least(10, trunc((new.data ->> 'level')::numeric)::integer));
  else
    issues := array_append(issues, 'INVALID_LEVEL');
  end if;

  expected_level := case
    when new_exp < 10 then 1 when new_exp < 40 then 2 when new_exp < 80 then 3
    when new_exp < 130 then 4 when new_exp < 200 then 5 when new_exp < 280 then 6
    when new_exp < 370 then 7 when new_exp < 470 then 8 when new_exp < 580 then 9
    else 10 end;

  if new_exp < 0 or new_gold < 0 or new_building < 0 then
    issues := array_append(issues, 'NEGATIVE_RESOURCE');
  end if;
  if saved_level <> expected_level then issues := array_append(issues, 'LEVEL_EXP_MISMATCH'); end if;
  if new_exp - old_exp > 500 then issues := array_append(issues, 'LARGE_EXP_JUMP'); end if;
  if new_gold - old_gold > 5000 then issues := array_append(issues, 'LARGE_GOLD_JUMP'); end if;
  if new_building - old_building > 500 then issues := array_append(issues, 'LARGE_BUILDING_JUMP'); end if;
  if new_exp > 100000 or new_gold > 10000000 or new_building > 1000000 then
    issues := array_append(issues, 'EXTREME_RESOURCE_VALUE');
  end if;

  if jsonb_typeof(new.data -> 'skills') = 'object' then
    select coalesce(sum(
      case when jsonb_typeof(value) = 'number'
        then greatest(0, (value #>> '{}')::numeric) else 0 end
    ), 0)
    into learned_points
    from jsonb_each(new.data -> 'skills');
  end if;
  if jsonb_typeof(new.data -> 'skillPoints') = 'number' then
    remaining_points := greatest(0, (new.data ->> 'skillPoints')::numeric);
  end if;
  if learned_points + remaining_points > greatest(0, (expected_level - 1) * 2) then
    issues := array_append(issues, 'SKILL_BUDGET_EXCEEDED');
  end if;
  if expected_level < 5 and nullif(new.data ->> 'spec', '') is not null then
    issues := array_append(issues, 'SPEC_TOO_EARLY');
  end if;
  if coalesce(new.data ->> 'class', '') not in ('warrior', 'mage', 'priest') then
    issues := array_append(issues, 'INVALID_CLASS');
  end if;
  if jsonb_typeof(new.data -> 'inventory') = 'array'
    and jsonb_array_length(new.data -> 'inventory') > 200 then
    issues := array_append(issues, 'OVERSIZED_INVENTORY');
  end if;

  if cardinality(issues) = 0 then return new; end if;

  select to_jsonb(array_agg(distinct issue order by issue))
    into issue_json
    from unnest(issues) as issue;
  issue_fingerprint := md5(issue_json::text);

  insert into public.profile_security_audits_v1 (
    user_id, display_name, issues, observed, fingerprint
  ) values (
    new.user_id,
    new.display_name,
    issue_json,
    jsonb_build_object(
      'level', saved_level, 'exp', new_exp, 'gold', new_gold,
      'building', new_building, 'skillPoints', remaining_points,
      'learnedSkillPoints', learned_points
    ),
    issue_fingerprint
  )
  on conflict (user_id, fingerprint) where resolved_at is null
  do update set
    occurrences = public.profile_security_audits_v1.occurrences + 1,
    last_seen_at = now(),
    observed = excluded.observed,
    display_name = excluded.display_name;

  return new;
end;
$$;

revoke all on function public.audit_student_profile_save_v1() from public;

drop trigger if exists player_profiles_v2_security_audit_v1
  on public.player_profiles_v2;
create trigger player_profiles_v2_security_audit_v1
after update of data on public.player_profiles_v2
for each row
when (old.data is distinct from new.data)
execute function public.audit_student_profile_save_v1();
