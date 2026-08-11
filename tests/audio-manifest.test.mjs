import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Script, createContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const manifestPath = join(root, 'src', 'audio-manifest.js');
const context = createContext({
  window: { __G: { settings: { sfxEnabled: true, sfxVolume: 0.4, bgmEnabled: true, bgmVolume: 0.2 } } },
  Audio: class { play() { return Promise.resolve(); } },
  console,
});
context.globalThis = context.window;
if (existsSync(manifestPath)) {
  new Script(readFileSync(manifestPath, 'utf8'), { filename: 'src/audio-manifest.js' }).runInContext(context);
}

const manifest = context.window.YuksamAudioManifest;

test('central manifest inventories only existing numbered Korean audio files', () => {
  assert.ok(manifest, 'src/audio-manifest.js must publish YuksamAudioManifest');
  for (const [id, entry] of Object.entries(manifest?.assets || {})) {
    assert.ok(existsSync(resolve(root, entry.src)), `${id} points to missing ${entry.src}`);
  }
  assert.equal(manifest?.assets.critical.src, 'assets/3. 치명타 소리.mp3');
  assert.equal(manifest?.assets.townBgm.src, 'assets/1. 마을 음악.mp3');
  assert.equal(manifest?.assets.battleBgm.src, 'assets/1. 전투씬 음악.mp3');
  assert.equal(manifest?.assets.pvpVictory.src, 'assets/2. pvp승리음악.mp3');
  assert.equal(existsSync(resolve(root, 'assets/1. 전투씬 음악.wav')), false);
  assert.equal(manifest?.assets.guardianOath.src, 'assets/5. 수호자의 맹세 소리 .mp3');
  assert.equal(manifest?.assets.meteor.src, 'assets/7. 메테오 소리 .mp3');
  assert.equal(manifest?.assets.prayerBarrier.src, 'assets/8. 기도의 방벽 소리.mp3');
});

test('manifest exposes stable event and skill mappings for every supplied combat sound', () => {
  assert.equal(context.window.getAudioAsset?.('enemyAttack')?.src, 'assets/3. 적 공격 소리.mp3');
  assert.equal(manifest?.eventSounds.miss, 'miss');
  assert.equal(manifest?.classBasicSounds.warrior, 'warriorBasic');
  assert.equal(manifest?.classBasicSounds.mage, 'mageBasic');
  assert.equal(manifest?.classBasicSounds.priest, 'priestBasic');
  assert.equal(manifest?.skillSounds.mage_basic_bolt, 'magicBolt');
  assert.equal(manifest?.skillSounds.mage_basic_barrier, 'ventilation');
  assert.equal(manifest?.skillSounds.priest_basic_prayer, 'prayerBarrier');
  assert.equal(manifest?.skillSounds.priest_holy_absorb_v24, 'holyShared');
  assert.equal(manifest?.skillSounds.priest_holy_barrier_v24, 'holyShared');
  assert.equal(manifest?.skillSounds.warrior_def_armor, 'offensiveArmor');
  assert.equal(manifest?.skillSounds.warrior_charge, 'shieldCharge');
  assert.equal(manifest?.skillSounds.warrior_defense_stance, 'defensiveStance');
  assert.equal(manifest?.skillSounds.warrior_weapon_judgment, 'finalJudgment');
  assert.equal(manifest?.skillSounds.mage_fire_meteor_v24, 'meteor');
  assert.equal(manifest?.skillSounds.priest_shadow_judgment_v24, 'shadowJudgment');
});

test('every learnable active skill has an assigned combat sound', () => {
  const skillContext = createContext({
    window:{ YuksamCore:{ uid:() => 'test-id' } },
    console,
  });
  skillContext.globalThis = skillContext.window;
  new Script(readFileSync(join(root, 'src', 'game-data.js'), 'utf8'), {
    filename:'src/game-data.js',
  }).runInContext(skillContext);
  const data = skillContext.window.YuksamData;
  Object.assign(data.SKILL_DEFS, data.V24_SKILLS || {});
  const activeSkills = Object.values(data.SKILL_DEFS).filter((skill) => skill?.active);
  const missing = activeSkills.filter((skill) => !manifest?.skillSounds?.[skill.id]);
  assert.deepEqual(Array.from(missing, (skill) => skill.id), []);
});

test('mapped playback keeps configured file sound volumes within the SFX setting', () => {
  assert.equal(typeof context.window.playMappedAudio, 'function');
  assert.equal(context.window.playMappedAudio?.('critical'), true);
});

test('missing optional mapped audio invokes its synthesized fallback once', () => {
  let fallbackCalls = 0;
  const handled = context.window.playMappedAudio?.('optionalMissing', { onFallback:() => { fallbackCalls += 1; } });
  assert.equal(handled, true);
  assert.equal(fallbackCalls, 1);
});

test('synchronous Audio construction failure invokes fallback once and stays handled', () => {
  let fallbackCalls = 0;
  const brokenContext = createContext({
    window: { __G: { settings: { sfxEnabled: true, sfxVolume: 1 } } },
    Audio: class { constructor() { throw new Error('audio unavailable'); } },
    console,
  });
  brokenContext.globalThis = brokenContext.window;
  new Script(readFileSync(manifestPath, 'utf8'), { filename: 'src/audio-manifest.js' }).runInContext(brokenContext);
  const handled = brokenContext.window.playMappedAudio('critical', { onFallback:() => { fallbackCalls += 1; } });
  assert.equal(handled, true);
  assert.equal(fallbackCalls, 1);
});
