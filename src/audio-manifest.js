/* Central inventory for every numbered audio file shipped with the game. */
(function audioManifest() {
  'use strict';

  const assets = Object.freeze({
    loginBgm: { src:'assets/1. 로그인화면 음악.mp3', volume:1, channel:'bgm' },
    townBgm: { src:'assets/1. 마을 음악.mp3', volume:1, channel:'bgm' },
    forestBgm: { src:'assets/1. 숲 음악.mp3', volume:1, channel:'bgm' },
    desertBgm: { src:'assets/1. 사막 음악.mp3', volume:1, channel:'bgm' },
    swampBgm: { src:'assets/1. 늪 음악.mp3', volume:1, channel:'bgm' },
    bossBgm: { src:'assets/1. 보스전 음악.mp3', volume:1, channel:'bgm' },
    battleBgm: { src:'assets/1. 전투씬 음악.mp3', volume:1, channel:'bgm' },
    dungeonBgm: { src:'assets/1. 던전 음악.mp3', volume:1, channel:'bgm' },
    dungeonEncounter: { src:'assets/2. 던전 조우 시 효과음.mp3', volume:1, channel:'sfx' },
    upgradeCharge: { src:'assets/2. 강화 음악.mp3', volume:1, channel:'sfx' },
    upgradeSuccess: { src:'assets/2. 강화 성공.mp3', volume:1, channel:'sfx' },
    upgradeFail: { src:'assets/2. 강화 실패.mp3', volume:1, channel:'sfx' },
    pvpVictory: { src:'assets/2. pvp승리음악.mp3', volume:1, channel:'sfx' },
    door: { src:'assets/2. 문여는 소리.mp3', volume:1, channel:'sfx' },
    questCompleteMusic: { src:'assets/2. 퀘스트 완료 음악.mp3', volume:1, channel:'sfx' },
    questComplete: { src:'assets/2. 퀘스트 완료될때 소리.mp3', volume:1, channel:'sfx' },
    petDraw: { src:'assets/2. 펫 뽑기 음악.mp3', volume:1, channel:'sfx' },
    miss: { src:'assets/3. 빗나감 소리.mp3', volume:1, channel:'sfx' },
    enemyAttack: { src:'assets/3. 적 공격 소리.mp3', volume:1, channel:'sfx' },
    critical: { src:'assets/3. 치명타 소리.mp3', volume:1, channel:'sfx' },
    shieldBlock: { src:'assets/3. 보호막으로만 다 데미지 막혔을때 소리.mp3', volume:1, channel:'sfx' },
    stunned: { src:'assets/3. 기절 소리.mp3', volume:1, channel:'sfx' },
    warriorBasic: { src:'assets/4. 전사 기본공격.mp3', volume:1, channel:'sfx' },
    warriorBasicStrike: { src:'assets/4. 전사의일격 소리.mp3', volume:1, channel:'sfx' },
    finalJudgment: { src:'assets/4. 최후의 심판 소리.mp3', volume:1, channel:'sfx' },
    shatteringStrike: { src:'assets/4. 파쇄일격 소리.mp3', volume:1, channel:'sfx' },
    defensiveStance: { src:'assets/5. 방어 태세 소리.mp3', volume:1, channel:'sfx' },
    offensiveArmor: { src:'assets/5. 공세 갑옷 소리.mp3', volume:1, channel:'sfx' },
    shieldCharge: { src:'assets/5. 방패 돌진 소리.mp3', volume:1, channel:'sfx' },
    guardianOath: { src:'assets/5. 수호자의 맹세 소리 .mp3', volume:1, channel:'sfx' },
    mageBasic: { src:'assets/6. 마법사 기본공격.mp3', volume:1, channel:'sfx' },
    execution: { src:'assets/6. 처형 소리.mp3', volume:1, channel:'sfx' },
    magicBolt: { src:'assets/6. 마력탄 소리.mp3', volume:1, channel:'sfx' },
    ventilation: { src:'assets/6. 환기 소리.mp3', volume:1, channel:'sfx' },
    frostArmor: { src:'assets/6. 서리 갑옷 소리.mp3', volume:1, channel:'sfx' },
    frostStorm: { src:'assets/6. 빙하폭풍 소리.mp3', volume:1, channel:'sfx' },
    frostLance: { src:'assets/6. 빙결 창 소리.mp3', volume:1, channel:'sfx' },
    fireball: { src:'assets/7. 대화염구 소리.mp3', volume:1, channel:'sfx' },
    meteor: { src:'assets/7. 메테오 소리 .mp3', volume:1, channel:'sfx' },
    fireBurst: { src:'assets/7. 폭열 소리.mp3', volume:1, channel:'sfx' },
    priestBasic: { src:'assets/8. 사제 기본공격.mp3', volume:1, channel:'sfx' },
    faithStrike: { src:'assets/8. 신앙의 일격 소리.mp3', volume:1, channel:'sfx' },
    holyShared: { src:'assets/8. 빛의 섬광, 신성 보호막 소리.mp3', volume:1, channel:'sfx' },
    holyJudgment: { src:'assets/8. 은총의 심판 소리.mp3', volume:1, channel:'sfx' },
    prayerBarrier: { src:'assets/8. 기도의 방벽 소리.mp3', volume:1, channel:'sfx' },
    shadowSeed: { src:'assets/9. 암흑의 씨앗 소리.mp3', volume:1, channel:'sfx' },
    shadowMark: { src:'assets/9. 암흑 낙인 소리.mp3', volume:1, channel:'sfx' },
    shadowJudgment: { src:'assets/9. 암흑 심판 소리.mp3', volume:1, channel:'sfx' },
    blockShield: { src:'assets/4. 보호막 소리.mp3', volume:1, channel:'sfx' },
    shadowStackGain: { src:'assets/9. 암흑중첩 쌓이는 소리.mp3', volume:1, channel:'sfx' },
    shadowStackHit: { src:'assets/9. 암흑중첩 데미지 소리.mp3', volume:1, channel:'sfx' },
  });

  const eventSounds = Object.freeze({
    door:'door', questComplete:'questComplete', petDraw:'petDraw', miss:'miss', enemyAttack:'enemyAttack', critical:'critical', shieldBlock:'shieldBlock', execution:'execution',
    upgradeCharge:'upgradeCharge', upgradeSuccess:'upgradeSuccess', upgradeFail:'upgradeFail',
  });
  const classBasicSounds = Object.freeze({ warrior:'warriorBasic', mage:'mageBasic', priest:'priestBasic' });
  const skillSounds = Object.freeze({
    warrior_basic_strike:'warriorBasicStrike', warrior_def_stance:'defensiveStance', warrior_def_armor:'offensiveArmor',
    warrior_def_wall:'shieldCharge', warrior_def_bastion:'guardianOath', warrior_weapon_slash:'shatteringStrike', warrior_weapon_judgment:'finalJudgment',
    mage_basic_bolt:'magicBolt', mage_basic_barrier:'ventilation', mage_frost_lance_v24:'frostLance', mage_frost_armor_v24:'frostArmor',
    mage_frost_storm_v24:'frostStorm', mage_fireball_v24:'fireball', mage_fire_burst_v24:'fireBurst', mage_fire_meteor_v24:'meteor',
    priest_basic_smite:'faithStrike', priest_basic_prayer:'prayerBarrier', priest_holy_absorb_v24:'holyShared',
    priest_holy_barrier_v24:'holyShared', priest_holy_judgment_v24:'holyJudgment', priest_shadow_seed_v24:'shadowSeed',
    priest_shadow_mark_v24:'shadowMark', priest_shadow_judgment_v24:'shadowJudgment',
  });

  const clamp01 = (value) => Math.min(1, Math.max(0, Number(value) || 0));
  const getAudioAsset = (id) => assets[id] || null;
  const getSettings = () => window.getYuksamAudioSettings?.() || null;
  function playMappedAudio(id, options) {
    const asset = getAudioAsset(id);
    const settings = getSettings();
    const opts = options || {};
    const channel = opts.channel || asset?.channel || 'sfx';
    const enabled = channel === 'bgm' ? settings?.bgmEnabled : settings?.sfxEnabled;
    if (enabled === false) return true;
    if (!asset?.src || typeof Audio !== 'function') {
      opts.onFallback?.();
      return typeof opts.onFallback === 'function';
    }
    try {
      const audio = new Audio(asset.src);
      const settingVolume = channel === 'bgm' ? settings?.bgmVolume : settings?.sfxVolume;
      audio.volume = clamp01((settingVolume ?? 1) * asset.volume * (opts.volume ?? 1));
      const playResult = audio.play();
      if (playResult?.catch) playResult.catch(() => opts.onFallback?.());
      return true;
    } catch (error) {
      opts.onFallback?.();
      return typeof opts.onFallback === 'function';
    }
  }

  window.YuksamAudioManifest = Object.freeze({ assets, eventSounds, classBasicSounds, skillSounds, synth:{ playerHit:'hit' } });
  window.getAudioAsset = getAudioAsset;
  window.playMappedAudio = playMappedAudio;
})();
