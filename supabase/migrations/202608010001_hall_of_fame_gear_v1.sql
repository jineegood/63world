-- 명예의 전당에 무기 강화 등급과 장착 펫을 함께 내려 준다.
-- 기존 함수는 name/class/spec/level/exp/gold/appearance/equipment/costume 만 돌려줘서
-- 강화한 무기의 색(등급)과 펫이 화면에 나타나지 않았다.
create or replace function public.load_hall_of_fame_v2()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'name', ranked.data ->> 'name',
        'class', ranked.data ->> 'class',
        'spec', ranked.data ->> 'spec',
        'level', coalesce((ranked.data ->> 'level')::integer, 1),
        'exp', coalesce((ranked.data ->> 'exp')::bigint, 0),
        'gold', coalesce((ranked.data ->> 'gold')::bigint, 0),
        'appearance', coalesce(ranked.data -> 'appearance', '{}'::jsonb),
        'equipment', coalesce(ranked.data -> 'equipment', '{}'::jsonb),
        'costume', coalesce(ranked.data -> 'costume', '{}'::jsonb),
        -- 아래 두 줄이 이번에 추가된 부분이다.
        'weaponUpgrades', coalesce(ranked.data -> 'weaponUpgrades', '{}'::jsonb),
        'activePet', ranked.data ->> 'activePet'
      )
      order by ranked.exp desc, ranked.level desc, ranked.updated_at asc
    ),
    '[]'::jsonb
  )
  from (
    select
      profile.data,
      profile.updated_at,
      coalesce((profile.data ->> 'exp')::bigint, 0) as exp,
      coalesce((profile.data ->> 'level')::integer, 1) as level
    from public.player_profiles_v2 as profile
    order by exp desc, level desc, profile.updated_at asc
    limit 5
  ) as ranked;
$$;

revoke all on function public.load_hall_of_fame_v2() from public;
grant execute on function public.load_hall_of_fame_v2() to authenticated;
