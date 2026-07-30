-- Keep PvE skill cooldowns between monsters, and let students choose either
-- specialization skill on the same unlock row.

alter table public.player_core_v3
  add column if not exists combat_cooldowns jsonb not null default '{}'::jsonb
  check (jsonb_typeof(combat_cooldowns) = 'object');
create or replace function public.private_read_combatant_v3(
  p_user_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'className', c.class_name,
    'spec', c.spec,
    'level', c.level,
    'exp', c.exp,
    'gold', c.gold,
    'currentHp', c.current_hp,
    'maxHp', c.max_hp,
    'revision', c.revision,
    'activePet', c.active_pet,
    'combatCooldowns', c.combat_cooldowns,
    'inventory', coalesce((
      select jsonb_agg(jsonb_build_object(
        'itemId', i.item_definition_id,
        'equippedSlot', i.equipped_slot,
        'enhancementTier', i.enhancement_tier,
        'inventoryKind', i.inventory_kind
      ) order by i.item_definition_id, i.id)
      from public.player_inventory_v3 as i
      where i.user_id = c.user_id
        and i.inventory_kind = 'gear'
    ), '[]'::jsonb),
    'skills', coalesce((
      select jsonb_object_agg(s.skill_id, s.rank)
      from public.player_skills_v3 as s
      where s.user_id = c.user_id
        and s.rank > 0
    ), '{}'::jsonb),
    'pets', coalesce((
      select jsonb_agg(p.pet_id order by p.pet_id)
      from public.player_pets_v3 as p
      where p.user_id = c.user_id
    ), '[]'::jsonb)
  )
  from public.player_core_v3 as c
  where c.user_id = p_user_id;
$$;
create or replace function public.private_sync_combat_cooldowns_v3()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.player_core_v3
  set combat_cooldowns = coalesce(new.cooldowns, '{}'::jsonb)
  where user_id = new.user_id;
  return new;
end;
$$;
drop trigger if exists player_combat_cooldowns_sync_v3
  on public.player_combat_sessions_v3;
create trigger player_combat_cooldowns_sync_v3
after insert or update of cooldowns on public.player_combat_sessions_v3
for each row execute function public.private_sync_combat_cooldowns_v3();
create or replace function public.private_store_combat_cooldowns_v3(
  p_user_id uuid,
  p_cooldowns jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clean jsonb;
begin
  perform public.private_require_service_role_v3();
  if p_user_id is null or jsonb_typeof(p_cooldowns) <> 'object'
    or octet_length(p_cooldowns::text) > 8192 then
    raise exception using errcode = '22023', message = 'INVALID_COOLDOWNS';
  end if;

  select coalesce(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
  into v_clean
  from jsonb_each_text(p_cooldowns) as entry(key, value)
  join public.player_skills_v3 as learned
    on learned.user_id = p_user_id
   and learned.skill_id = entry.key
   and learned.rank > 0
  where entry.value ~ '^[0-9]{1,2}$'
    and entry.value::integer between 1 and 99;

  update public.player_core_v3
  set combat_cooldowns = v_clean
  where user_id = p_user_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'PLAYER_NOT_FOUND';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.private_store_combat_cooldowns_v3(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.private_store_combat_cooldowns_v3(uuid, jsonb)
  to service_role;
update public.game_skill_catalog_v3 as target
set prerequisites = jsonb_build_object(
  'all', '[]'::jsonb,
  'ranks', '{}'::jsonb,
  'any', case
    when target.unlock_level = 5 then '[]'::jsonb
    when target.unlock_level = 7 then coalesce((
      select jsonb_agg(source.skill_id order by source.skill_id)
      from public.game_skill_catalog_v3 as source
      where source.class_name = target.class_name
        and source.spec_name = target.spec_name
        and source.unlock_level = 5
    ), '[]'::jsonb)
    else coalesce((
      select jsonb_agg(source.skill_id order by source.skill_id)
      from public.game_skill_catalog_v3 as source
      where source.class_name = target.class_name
        and source.spec_name = target.spec_name
        and source.unlock_level = 7
    ), '[]'::jsonb)
  end,
  'total', null
)
where target.spec_name is not null
  and target.unlock_level in (5, 7, 9);
