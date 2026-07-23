-- Durable teacher rewards claimed atomically by the authenticated student.

create table if not exists public.student_reward_grants_v2 (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  gold integer not null default 0 check (gold between 0 and 1000000),
  building integer not null default 0 check (building between 0 and 1000000),
  exp integer not null default 0 check (exp between 0 and 1000000),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  claimed_at timestamptz null,
  constraint student_reward_grants_v2_positive check (gold > 0 or building > 0 or exp > 0)
);

create index if not exists student_reward_grants_v2_unclaimed_idx
  on public.student_reward_grants_v2 (user_id, created_at)
  where claimed_at is null;

alter table public.student_reward_grants_v2 enable row level security;
alter table public.student_reward_grants_v2 force row level security;

revoke all on table public.student_reward_grants_v2 from anon, authenticated;
grant select, insert on table public.student_reward_grants_v2 to authenticated;

drop policy if exists "teachers select reward grants v2" on public.student_reward_grants_v2;
create policy "teachers select reward grants v2"
on public.student_reward_grants_v2 for select to authenticated
using ((select public.is_teacher()));

drop policy if exists "teachers insert reward grants v2" on public.student_reward_grants_v2;
create policy "teachers insert reward grants v2"
on public.student_reward_grants_v2 for insert to authenticated
with check (
  (select public.is_teacher())
  and created_by = (select auth.uid())
);

create or replace function public.claim_student_rewards_v2()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user_id uuid := auth.uid();
  profile_data jsonb;
  total_gold bigint := 0;
  total_building bigint := 0;
  total_exp bigint := 0;
begin
  if target_user_id is null then
    raise exception 'authentication required';
  end if;

  select data
  into profile_data
  from public.player_profiles_v2
  where user_id = target_user_id
  for update;

  if profile_data is null then
    return null;
  end if;

  with locked_grants as (
    select id
    from public.student_reward_grants_v2
    where user_id = target_user_id
      and claimed_at is null
    order by created_at, id
    for update
  ), claimed as (
    update public.student_reward_grants_v2
    set claimed_at = now()
    where id in (select id from locked_grants)
    returning gold, building, exp
  )
  select
    coalesce(sum(gold), 0),
    coalesce(sum(building), 0),
    coalesce(sum(exp), 0)
  into total_gold, total_building, total_exp
  from claimed;

  if total_gold > 0 or total_building > 0 or total_exp > 0 then
    profile_data := jsonb_set(
      profile_data,
      '{gold}',
      to_jsonb(coalesce((profile_data ->> 'gold')::bigint, 0) + total_gold),
      true
    );
    profile_data := jsonb_set(
      profile_data,
      '{building}',
      to_jsonb(coalesce((profile_data ->> 'building')::bigint, 0) + total_building),
      true
    );
    profile_data := jsonb_set(
      profile_data,
      '{exp}',
      to_jsonb(coalesce((profile_data ->> 'exp')::bigint, 0) + total_exp),
      true
    );

    update public.player_profiles_v2
    set data = profile_data
    where user_id = target_user_id;
  end if;

  return profile_data;
end;
$$;

revoke all on function public.claim_student_rewards_v2() from public;
grant execute on function public.claim_student_rewards_v2() to authenticated;
