-- Common skills are freely learnable in any order.
-- Class, level, available points, and maximum-rank checks remain server-owned.

update public.game_skill_catalog_v3
set prerequisites = '{"all":[],"ranks":{},"any":[],"total":null}'::jsonb
where spec_name is null;
