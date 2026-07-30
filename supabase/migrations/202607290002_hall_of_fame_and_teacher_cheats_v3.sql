-- Live hall of fame and server-owned teacher test rewards.

create or replace function public.list_hall_of_fame_v3()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_entries jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED');
  end if;

  select coalesce(jsonb_agg(entry order by rank_no), '[]'::jsonb)
    into v_entries
  from (
    select row_number() over (
      order by c.exp desc, c.level desc, c.gold desc, c.created_at asc
    ) as rank_no,
    jsonb_build_object(
      'name', c.display_name,
      'className', c.class_name,
      'spec', c.spec,
      'level', c.level,
      'exp', c.exp,
      'gold', c.gold,
      'appearance', jsonb_build_object(
        'shirt', p.shirt_color,
        'pants', p.pants_color,
        'hair', p.hair_color,
        'hairStyle', p.hair_style,
        'skin', p.skin_color,
        'accessory', p.accessory
      ),
      'equipment', coalesce((
        select jsonb_object_agg(i.equipped_slot, i.item_definition_id)
        from public.player_inventory_v3 as i
        where i.user_id = c.user_id
          and i.inventory_kind = 'gear'
          and i.equipped_slot is not null
      ), '{}'::jsonb),
      'costume', coalesce((
        select jsonb_object_agg(i.equipped_slot, i.item_definition_id)
        from public.player_inventory_v3 as i
        where i.user_id = c.user_id
          and i.inventory_kind = 'costume'
          and i.equipped_slot is not null
      ), '{}'::jsonb)
    ) as entry
    from public.player_core_v3 as c
    join public.player_preferences_v3 as p on p.user_id = c.user_id
    order by c.exp desc, c.level desc, c.gold desc, c.created_at asc
    limit 5
  ) as ranked;

  return jsonb_build_object('ok', true, 'entries', v_entries);
end;
$$;
revoke all on function public.list_hall_of_fame_v3() from public, anon;
grant execute on function public.list_hall_of_fame_v3() to authenticated;
create or replace function public.teacher_apply_student_cheat_v3(
  p_user_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_core public.player_core_v3%rowtype;
  v_exp_gain integer := 0;
  v_new_exp integer;
  v_new_level integer;
  v_new_max_hp integer;
begin
  if not public.private_is_teacher_v3() then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  select * into v_core
  from public.player_core_v3
  where user_id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'STUDENT_NOT_FOUND');
  end if;

  if exists (
    select 1 from public.player_combat_sessions_v3
    where user_id = p_user_id and status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'code', 'COMBAT_ACTIVE');
  end if;

  if p_action in ('exp20', 'exp100') then
    v_exp_gain := case p_action when 'exp20' then 20 else 100 end;
    v_new_exp := v_core.exp + v_exp_gain;
    v_new_level := case
      when v_new_exp >= 580 then 10
      when v_new_exp >= 470 then 9
      when v_new_exp >= 370 then 8
      when v_new_exp >= 280 then 7
      when v_new_exp >= 200 then 6
      when v_new_exp >= 130 then 5
      when v_new_exp >= 80 then 4
      when v_new_exp >= 40 then 3
      when v_new_exp >= 10 then 2
      else 1
    end;
    v_new_level := greatest(v_core.level, least(10, v_new_level));
    v_new_max_hp := v_core.max_hp + (v_new_level - v_core.level) * 2;

    update public.player_core_v3
    set exp = v_new_exp,
        level = v_new_level,
        max_hp = v_new_max_hp,
        current_hp = case when v_new_level > v_core.level then v_new_max_hp else current_hp end,
        revision = revision + 1,
        updated_at = now()
    where user_id = p_user_id;
  elsif p_action = 'gold3000' then
    update public.player_core_v3
    set gold = gold + 3000, revision = revision + 1, updated_at = now()
    where user_id = p_user_id;
  elsif p_action = 'building200' then
    update public.player_core_v3
    set building = building + 200, revision = revision + 1, updated_at = now()
    where user_id = p_user_id;
  elsif p_action = 'heal' then
    update public.player_core_v3
    set current_hp = max_hp, revision = revision + 1, updated_at = now()
    where user_id = p_user_id;
  else
    return jsonb_build_object('ok', false, 'code', 'INVALID_ACTION');
  end if;

  return jsonb_build_object(
    'ok', true,
    'snapshot', public.private_build_student_snapshot_v3(p_user_id)
  );
end;
$$;
revoke all on function public.teacher_apply_student_cheat_v3(uuid, text)
  from public, anon;
grant execute on function public.teacher_apply_student_cheat_v3(uuid, text)
  to authenticated;
