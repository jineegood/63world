/* 소리 크기 기본값을 한 곳에서만 정한다.
   예전에는 game.js 여러 곳과 서버 기본값이 제각각이라, 로그인 화면과 게임 안의 크기가 달라졌다.
   학생이 환경설정에서 직접 바꾸기 전까지는 항상 이 값이 쓰인다. */
(function installAudioDefaults(global) {
  'use strict';

  const BGM_PERCENT = 15; // 배경음 15
  const SFX_PERCENT = 60; // 효과음 60

  function defaultSettings() {
    return {
      bgmVolume:BGM_PERCENT / 100,
      sfxVolume:SFX_PERCENT / 100,
      bgmEnabled:true,
      sfxEnabled:true,
    };
  }

  global.YuksamAudioDefaults = Object.freeze({
    BGM_PERCENT,
    SFX_PERCENT,
    defaultSettings,
  });
})(window);
