begin;
create table if not exists public.pvp_records_v1 (
  user_id uuid primary key references auth.users(id) on delete cascade,
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  updated_at timestamptz not null default now()
);
create table if not exists public.pvp_presence_v1 (
  user_id uuid primary key references auth.users(id) on delete cascade,
  map text not null default 'town',
  busy boolean not null default false,
  public_profile jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz not null default now()
);
create table if not exists public.pvp_invites_v1 (
  id uuid primary key default extensions.gen_random_uuid(),
  challenger_id uuid not null references auth.users(id) on delete cascade,
  target_id uuid not null references auth.users(id) on delete cascade,
  request_id text not null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '20 seconds'),
  responded_at timestamptz,
  match_id uuid,
  check (challenger_id <> target_id),
  check (expires_at > created_at and expires_at <= created_at + interval '20 seconds'),
  unique (challenger_id, request_id)
);
create table if not exists public.pvp_matches_v1 (
  id uuid primary key default extensions.gen_random_uuid(),
  invite_id uuid unique references public.pvp_invites_v1(id) on delete set null,
  player_a_id uuid not null references auth.users(id) on delete cascade,
  player_b_id uuid not null references auth.users(id) on delete cascade,
  phase text not null default 'question'
    check (phase in ('question', 'waiting', 'dice', 'effects', 'reconnect', 'finished', 'cancelled')),
  round_no integer not null default 1 check (round_no > 0),
  player_a_state jsonb not null,
  player_b_state jsonb not null,
  question_public jsonb,
  question_deadline timestamptz,
  reconnect_deadline timestamptz,
  disconnected_user_id uuid references auth.users(id) on delete set null,
  resume_phase text check (resume_phase in ('question', 'waiting', 'dice', 'effects')),
  paused_question_ms integer check (paused_question_ms is null or paused_question_ms >= 0),
  winner_id uuid references auth.users(id) on delete set null,
  loser_id uuid references auth.users(id) on delete set null,
  finish_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  check (player_a_id <> player_b_id)
);
-- Correct answers never live in a participant-readable row.
create table if not exists public.pvp_match_secrets_v1 (
  match_id uuid primary key references public.pvp_matches_v1(id) on delete cascade,
  answer_key text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.pvp_round_inputs_v1 (
  id uuid primary key default extensions.gen_random_uuid(),
  match_id uuid not null references public.pvp_matches_v1(id) on delete cascade,
  round_no integer not null check (round_no > 0),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id text not null,
  action_id text not null default 'basic',
  submitted_answer text,
  submitted_at timestamptz not null default now(),
  unique (match_id, round_no, user_id),
  unique (user_id, request_id)
);
create table if not exists public.pvp_match_events_v1 (
  id uuid primary key default extensions.gen_random_uuid(),
  match_id uuid not null references public.pvp_matches_v1(id) on delete cascade,
  sequence_no bigint not null,
  round_no integer not null check (round_no > 0),
  event jsonb not null,
  created_at timestamptz not null default now(),
  unique (match_id, sequence_no)
);
create unique index if not exists pvp_one_pending_invite_per_challenger_v1
  on public.pvp_invites_v1 (challenger_id) where status = 'pending';
create unique index if not exists pvp_one_pending_invite_per_target_v1
  on public.pvp_invites_v1 (target_id) where status = 'pending';
create unique index if not exists pvp_one_live_match_per_player_a_v1
  on public.pvp_matches_v1 (player_a_id) where finished_at is null and phase <> 'cancelled';
create unique index if not exists pvp_one_live_match_per_player_b_v1
  on public.pvp_matches_v1 (player_b_id) where finished_at is null and phase <> 'cancelled';
alter table public.pvp_records_v1 enable row level security;
alter table public.pvp_records_v1 force row level security;
alter table public.pvp_presence_v1 enable row level security;
alter table public.pvp_presence_v1 force row level security;
alter table public.pvp_invites_v1 enable row level security;
alter table public.pvp_invites_v1 force row level security;
alter table public.pvp_matches_v1 enable row level security;
alter table public.pvp_matches_v1 force row level security;
alter table public.pvp_match_secrets_v1 enable row level security;
alter table public.pvp_match_secrets_v1 force row level security;
alter table public.pvp_round_inputs_v1 enable row level security;
alter table public.pvp_round_inputs_v1 force row level security;
alter table public.pvp_match_events_v1 enable row level security;
alter table public.pvp_match_events_v1 force row level security;
revoke all on table public.pvp_records_v1 from anon, authenticated;
revoke all on table public.pvp_presence_v1 from anon, authenticated;
revoke all on table public.pvp_invites_v1 from anon, authenticated;
revoke all on table public.pvp_matches_v1 from anon, authenticated;
revoke all on table public.pvp_match_secrets_v1 from anon, authenticated;
revoke all on table public.pvp_round_inputs_v1 from anon, authenticated;
revoke all on table public.pvp_match_events_v1 from anon, authenticated;
grant select on table public.pvp_records_v1 to authenticated;
grant select on table public.pvp_invites_v1 to authenticated;
grant select on table public.pvp_matches_v1 to authenticated;
grant select on table public.pvp_match_events_v1 to authenticated;
create policy "authenticated students read pvp records"
  on public.pvp_records_v1 for select to authenticated
  using (true);
create policy "invite participants read their invitations"
  on public.pvp_invites_v1 for select to authenticated
  using (auth.uid() = challenger_id or auth.uid() = target_id);
create policy "match participants read their matches"
  on public.pvp_matches_v1 for select to authenticated
  using (auth.uid() = player_a_id or auth.uid() = player_b_id);
create policy "match participants read public events"
  on public.pvp_match_events_v1 for select to authenticated
  using (
    exists (
      select 1
      from public.pvp_matches_v1 as match
      where match.id = pvp_match_events_v1.match_id
        and (auth.uid() = match.player_a_id or auth.uid() = match.player_b_id)
    )
  );
create or replace function public.finish_pvp_match_v1(
  _match_id uuid,
  _winner_id uuid,
  _loser_id uuid,
  _reason text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_match public.pvp_matches_v1%rowtype;
begin
  select *
    into locked_match
    from public.pvp_matches_v1
   where id = _match_id
     and finished_at is null
   for update;

  if not found then
    return false;
  end if;
  if _winner_id not in (locked_match.player_a_id, locked_match.player_b_id)
     or _loser_id not in (locked_match.player_a_id, locked_match.player_b_id)
     or _winner_id = _loser_id then
    raise exception 'invalid pvp result';
  end if;

  update public.pvp_matches_v1
     set phase = 'finished',
         winner_id = _winner_id,
         loser_id = _loser_id,
         finish_reason = left(coalesce(_reason, 'defeat'), 40),
         finished_at = now(),
         updated_at = now()
   where id = _match_id
     and finished_at is null;

  insert into public.pvp_records_v1 (user_id, wins, losses, updated_at)
  values (_winner_id, 1, 0, now())
  on conflict (user_id) do update
    set wins = public.pvp_records_v1.wins + 1,
        updated_at = now();

  insert into public.pvp_records_v1 (user_id, wins, losses, updated_at)
  values (_loser_id, 0, 1, now())
  on conflict (user_id) do update
    set losses = public.pvp_records_v1.losses + 1,
        updated_at = now();

  update public.pvp_presence_v1
     set busy = false
   where user_id in (_winner_id, _loser_id);

  return true;
end;
$$;
revoke all on function public.finish_pvp_match_v1(uuid, uuid, uuid, text) from public;
revoke all on function public.finish_pvp_match_v1(uuid, uuid, uuid, text) from anon, authenticated;
grant execute on function public.finish_pvp_match_v1(uuid, uuid, uuid, text) to service_role;
commit;
