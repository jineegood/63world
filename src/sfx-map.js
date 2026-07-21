/* Skill audio lookup backed by the central manifest. */
(function skillSoundMapV42() {
  'use strict';

  const manifest = window.YuksamAudioManifest || { assets:{}, skillSounds:{} };
  const ULTIMATE_IDS = ['warrior_weapon_judgment', 'warrior_def_bastion', 'mage_frost_storm_v24', 'mage_fire_meteor_v24', 'priest_holy_judgment_v24', 'priest_shadow_judgment_v24'];
  const skillAudioId = (skillId) => manifest.skillSounds?.[skillId] || null;
  const toSrc = (audioId) => window.getAudioAsset?.(audioId)?.src || null;
  const ULTIMATE_SOUNDS = Object.freeze(Object.fromEntries(ULTIMATE_IDS.map((id) => [id, toSrc(skillAudioId(id))])));
  const SKILL_SOUNDS = Object.freeze(Object.fromEntries(Object.entries(manifest.skillSounds || {}).map(([id, audioId]) => [id, toSrc(audioId)])));
  const SPECIALIZATION_SOUNDS = Object.freeze({});

  function getSkillSoundV42(skillId, skill) {
    return toSrc(skillAudioId(skillId));
  }

  function playFileV42(src) {
    if (!src) return false;
    try {
      const audio = new Audio(src);
      const settings = window.getYuksamAudioSettings?.();
      if (settings && settings.sfxEnabled === false) return true;
      audio.volume = Math.min(1, Math.max(0, Number(settings?.sfxVolume ?? 1)));
      audio.play().catch(function () {});
      return true;
    } catch (error) {
      return false;
    }
  }

  window.ULTIMATE_SOUNDS = ULTIMATE_SOUNDS;
  window.SKILL_SOUNDS_V42 = SKILL_SOUNDS;
  window.SPECIALIZATION_SOUNDS_V42 = SPECIALIZATION_SOUNDS;
  window.getSkillSoundV42 = getSkillSoundV42;
  window.playSkillSfxV42 = function (skillId, skill) {
    const audioId = skillAudioId(skillId);
    if (window.playMappedAudio) return window.playMappedAudio(audioId);
    return playFileV42(getSkillSoundV42(skillId, skill));
  };
  window.playQuestCompletionSoundV42 = () => window.playMappedAudio
    ? window.playMappedAudio(manifest.eventSounds?.questComplete)
    : playFileV42(toSrc(manifest.eventSounds?.questComplete));

  const originalUltimateFx = window.playUltimateFxV41;
  window.playUltimateFxV41 = function (skillId) {
    if (typeof originalUltimateFx === 'function') return originalUltimateFx(skillId);
  };

  const originalGuardianReviveFx = window.playGuardianReviveFxV41;
  window.playGuardianReviveFxV41 = function () {
    const audioId = skillAudioId('warrior_def_bastion');
    if (window.playMappedAudio) window.playMappedAudio(audioId);
    else playFileV42(toSrc(audioId));
    if (typeof originalGuardianReviveFx === 'function') return originalGuardianReviveFx();
  };
})();
