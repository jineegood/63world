begin;

-- Upgrade databases where the initial PvP migration was already applied.
alter table public.pvp_invites_v1
  add column if not exists match_id uuid;

alter table public.pvp_matches_v1
  add column if not exists resume_phase text,
  add column if not exists paused_question_ms integer;

do $$
begin
  alter table public.pvp_matches_v1
    add constraint pvp_matches_v1_resume_phase_check
    check (resume_phase is null or resume_phase in ('question', 'waiting', 'dice', 'effects'));
exception when duplicate_object then null;
end
$$;

do $$
begin
  alter table public.pvp_matches_v1
    add constraint pvp_matches_v1_paused_question_ms_check
    check (paused_question_ms is null or paused_question_ms >= 0);
exception when duplicate_object then null;
end
$$;

-- Supabase Realtime does not automatically publish newly-created tables.
do $$
begin
  alter publication supabase_realtime add table public.pvp_invites_v1;
exception when duplicate_object then null;
end
$$;

do $$
begin
  alter publication supabase_realtime add table public.pvp_matches_v1;
exception when duplicate_object then null;
end
$$;

do $$
begin
  alter publication supabase_realtime add table public.pvp_match_events_v1;
exception when duplicate_object then null;
end
$$;

commit;
