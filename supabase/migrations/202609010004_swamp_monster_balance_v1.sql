begin;

-- Integer catalog ranges use nearest-number rounding after the requested
-- percentage change. The browser applies the same multipliers after all
-- existing global and swamp scaling, so every live roll changes relatively.
update public.game_monster_catalog_v3
   set hp_min = 68,
       hp_max = 73,
       attack_min = 14,
       attack_max = 16
 where monster_key = 'swamp_tarantula';

update public.game_monster_catalog_v3
   set attack_min = 28,
       attack_max = 32
 where monster_key = 'swamp_zombie';

update public.game_monster_catalog_v3
   set attack_min = 23,
       attack_max = 27
 where monster_key = 'swamp_elite_zombie';

commit;
