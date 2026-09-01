begin;

-- Global notices remain append-only server facts. Elite victories and level 10
-- transitions are derived from the protected v3 player/combat tables; browser-
-- writable profile JSON is never accepted as evidence for either announcement.
alter table public.world_announcements_v1
  drop constraint if exists world_announcements_v1_kind_check;
alter table public.world_announcements_v1
  add constraint world_announcements_v1_kind_check
  check (kind in (
    'legendary_upgrade', 'legendary_pet', 'raid_clear', 'teacher_notice',
    'elite_defeat', 'level_ten'
  ));

-- A rollback, retry, or later level reset must never announce level 10 twice.
create unique index if not exists world_announcements_v1_level_ten_once
  on public.world_announcements_v1 (actor_user_id)
  where kind = 'level_ten';

create or replace function public.private_announce_core_milestones_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_combat_id uuid;
  v_monster_key text;
  v_now timestamptz := clock_timestamp();
begin
  if old.level < 10 and new.level = 10 then
    insert into public.world_announcements_v1 (
      kind, source_id, actor_user_id, subject_id, payload, created_at
    ) values (
      'level_ten', new.user_id, new.user_id, null,
      jsonb_build_object('actorName', new.display_name, 'level', 10),
      v_now
    )
    on conflict do nothing;
  end if;

  if new.gold <= old.gold then
    return new;
  end if;

  -- During a trusted PvE victory, player_core_v3 is updated before the active
  -- combat row is deleted. The combat UUID and immutable catalog reward make
  -- the announcement both authoritative and naturally idempotent.
  select combat.combat_id, monster.monster_key
    into v_combat_id, v_monster_key
    from public.player_combat_sessions_v3 combat
    join public.game_monster_catalog_v3 monster
      on monster.monster_key = combat.monster_key
   where combat.user_id = new.user_id
     and combat.status = 'active'
     and monster.elite
     and not monster.boss
     and monster.monster_key in (
       'forest_elite_slime',
       'desert_elite_snake',
       'swamp_elite_zombie'
     )
     and new.gold - old.gold = monster.gold_reward
   limit 1;

  if not found then
    return new;
  end if;

  insert into public.world_announcements_v1 (
    kind, source_id, actor_user_id, subject_id, payload, created_at
  ) values (
    'elite_defeat', v_combat_id, new.user_id, v_monster_key,
    jsonb_build_object(
      'actorName', new.display_name,
      'subjectId', v_monster_key
    ),
    v_now
  )
  on conflict (kind, source_id) do nothing;
  return new;
end;
$$;

revoke all on function public.private_announce_core_milestones_v1()
  from public, anon, authenticated;

-- Remove the superseded profile-based variant if a preview environment ever
-- received it before this final migration was applied.
drop trigger if exists announce_profile_milestones_v1
  on public.player_profiles_v2;
drop function if exists public.private_announce_profile_milestones_v1();

drop trigger if exists announce_core_milestones_v1
  on public.player_core_v3;
create trigger announce_core_milestones_v1
after update of level, gold on public.player_core_v3
for each row execute function public.private_announce_core_milestones_v1();

commit;
