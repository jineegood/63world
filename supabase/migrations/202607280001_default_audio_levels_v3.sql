-- 소리 크기 기본값을 배경음 15 / 효과음 60 으로 맞춘다.
-- 예전 기본값(55 / 65) 때문에 로그인 화면과 게임 안의 크기가 달라지는 문제가 있었다.
-- 학생이 환경설정에서 직접 바꾼 값은 건드리지 않는다.

alter table public.player_preferences_v3
  alter column bgm_volume set default 15;

alter table public.player_preferences_v3
  alter column sfx_volume set default 60;

-- 아직 예전 기본값 그대로인 학생만 새 기본값으로 옮긴다.
-- 두 값이 모두 예전 기본값과 같을 때만 바꾸므로, 한 번이라도 조절한 학생은 그대로 유지된다.
update public.player_preferences_v3
set bgm_volume = 15,
    sfx_volume = 60
where bgm_volume = 55
  and sfx_volume = 65;
