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
        'costume', coalesce(ranked.data -> 'costume', '{}'::jsonb)
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
    where profile.data <> '{}'::jsonb
      and nullif(profile.data ->> 'name', '') is not null
    order by exp desc, level desc, profile.updated_at asc
    limit 5
  ) as ranked;
$$;
revoke all on function public.load_hall_of_fame_v2() from public;
grant execute on function public.load_hall_of_fame_v2() to authenticated;
