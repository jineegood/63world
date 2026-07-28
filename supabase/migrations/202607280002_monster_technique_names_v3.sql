-- 몬스터 기술 이름을 카탈로그에 반영한다.
-- 전투 로그에 "포자 뿌리기를 사용했다!" 처럼 기술 이름을 보여주기 위한 것으로,
-- 능력치와 확률은 그대로이고 patterns 안에 name 만 추가된다.

insert into public.game_monster_catalog_v3
  (monster_key, map_name, question_map, monster_type, level, hp_min, hp_max, attack_min, attack_max, exp_reward, gold_reward, elite, boss, patterns)
values
('desert_elite_snake','bossRoom','desert','snake',7,119,128,20,25,18,24,true,false,'[{"chance":0.37,"kind":"poison","turns":3,"name":"맹독니"},{"chance":0.27,"kind":"critical","name":"급소 노리기"},{"chance":0.18,"kind":"heavy","multiplier":1.5,"name":"분노의 일격"},{"chance":0.15,"kind":"selfShield","percent":0.225,"name":"단단해지기"}]'::jsonb),
('desert_snake','desert','desert','snake',7,59,64,10,13,9,12,false,false,'[{"chance":0.25,"kind":"poison","turns":3,"name":"맹독니"},{"chance":0.15,"kind":"critical","name":"급소 노리기"}]'::jsonb),
('desert_stomp','desert','desert','stomp',5,41,44,7,9,6,9,false,false,'[{"chance":0.25,"kind":"heavy","multiplier":1.5,"stunTurns":1,"name":"대지 찍기"},{"chance":0.2,"kind":"selfShield","percent":0.3,"name":"대지 방패"}]'::jsonb),
('final_teacher','finalBossRoom','swamp','teacherBoss',99,999,999,24,30,363,363,true,true,'[{"chance":0.25,"kind":"heavy","multiplier":1.6,"name":"사랑의 매"},{"chance":0.2,"kind":"multi","hits":2,"multiplier":0.72,"name":"숙제 폭탄"},{"chance":0.15,"kind":"chillPlayer","turns":1,"name":"따끔한 꾸중"}]'::jsonb),
('forest_elite_slime','bossRoom','forest','slime',3,36,42,6,10,6,8,true,false,'[{"chance":0.37,"kind":"selfShield","percent":0.35,"name":"점액 방패"},{"chance":0.18,"kind":"heavy","multiplier":1.5,"name":"분노의 일격"},{"chance":0.15,"kind":"selfShield","percent":0.225,"name":"단단해지기"}]'::jsonb),
('forest_mushroom','forest','forest','mushroom',1,9,11,2,4,1,2,false,false,'[{"chance":0.22,"kind":"poison","turns":2,"name":"포자 뿌리기"}]'::jsonb),
('forest_slime','forest','forest','slime',3,20,23,3,5,3,4,false,false,'[{"chance":0.25,"kind":"selfShield","percent":0.35,"name":"점액 방패"}]'::jsonb),
('swamp_elite_zombie','bossRoom','swamp','zombie',11,382,399,29,34,30,40,true,false,'[{"chance":0.37,"kind":"lifesteal","percent":1,"name":"물어뜯기"},{"chance":0.18,"kind":"heavy","multiplier":1.5,"name":"분노의 일격"},{"chance":0.15,"kind":"selfShield","percent":0.225,"name":"단단해지기"}]'::jsonb),
('swamp_tarantula','swamp','swamp','tarantula',9,62,66,11,13,12,15,false,false,'[{"chance":0.3,"kind":"multi","hits":2,"multiplier":0.62,"name":"연속 물기"},{"chance":0.2,"kind":"heavy","multiplier":1.3,"stunTurns":1,"name":"마비 독니"}]'::jsonb),
('swamp_zombie','swamp','swamp','zombie',11,91,95,24,28,16,20,false,false,'[{"chance":0.25,"kind":"lifesteal","percent":1,"name":"물어뜯기"}]'::jsonb)
on conflict (monster_key) do update set
  map_name = excluded.map_name, question_map = excluded.question_map, monster_type = excluded.monster_type,
  level = excluded.level, hp_min = excluded.hp_min, hp_max = excluded.hp_max,
  attack_min = excluded.attack_min, attack_max = excluded.attack_max,
  exp_reward = excluded.exp_reward, gold_reward = excluded.gold_reward,
  elite = excluded.elite, boss = excluded.boss, patterns = excluded.patterns;
