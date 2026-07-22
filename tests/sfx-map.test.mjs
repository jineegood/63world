import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Script, createContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const manifestPath = join(root, 'src', 'audio-manifest.js');
const source = readFileSync(join(root, 'src', 'sfx-map.js'), 'utf8');
const played = [];
let ultimateVisualCalls = 0;
let guardianVisualCalls = 0;
const context = createContext({
  window:{
    playUltimateFxV41() { ultimateVisualCalls += 1; },
    playGuardianReviveFxV41() { guardianVisualCalls += 1; },
    __G:{ settings:{ sfxEnabled:true, sfxVolume:.6 } },
  },
  Audio:class { constructor(src) { this.src = src; played.push(src); } play() { return Promise.resolve(); } },
  console,
});
context.globalThis = context.window;
if (existsSync(manifestPath)) new Script(readFileSync(manifestPath, 'utf8'), { filename:'src/audio-manifest.js' }).runInContext(context);
new Script(source, { filename:'src/sfx-map.js' }).runInContext(context);

const getSound = context.window.getSkillSoundV42;

test('all named active and ultimate skills resolve through the central manifest', () => {
  assert.ok(context.window.YuksamAudioManifest, 'audio manifest must load before sfx-map');
  assert.equal(getSound('warrior_weapon_judgment', { kind:'ultimate', active:{} }), 'assets/4. 최후의 심판 소리.mp3');
  assert.equal(getSound('warrior_def_wall', { active:{} }), 'assets/5. 방패 돌진 소리.mp3');
  assert.equal(getSound('mage_frost_storm_v24', { kind:'ultimate', active:{} }), 'assets/6. 빙하폭풍 소리.mp3');
  assert.equal(getSound('mage_fire_meteor_v24', { kind:'ultimate', active:{} }), 'assets/7. 메테오 소리 .mp3');
  assert.equal(getSound('priest_holy_judgment_v24', { kind:'ultimate', active:{} }), 'assets/8. 은총의 심판 소리.mp3');
  assert.equal(getSound('priest_shadow_judgment_v24', { kind:'ultimate', active:{} }), 'assets/9. 암흑 심판 소리.mp3');
});

test('base, shared, and event-only audio use the supplied asset IDs', () => {
  assert.equal(getSound('mage_basic_bolt', { active:{} }), 'assets/6. 마력탄 소리.mp3');
  assert.equal(getSound('mage_basic_barrier', { active:{} }), 'assets/6. 환기 소리.mp3');
  assert.equal(getSound('priest_basic_prayer', { active:{} }), 'assets/8. 기도의 방벽 소리.mp3');
  assert.equal(getSound('priest_holy_absorb_v24', { active:{} }), 'assets/8. 빛의 섬광, 신성 보호막 소리.mp3');
  assert.equal(getSound('priest_holy_barrier_v24', { active:{} }), 'assets/8. 빛의 섬광, 신성 보호막 소리.mp3');
  assert.equal(getSound('warrior_def_armor', { active:{} }), 'assets/5. 공세 갑옷 소리.mp3');
  assert.equal(context.window.playQuestCompletionSoundV42(), true);
  assert.equal(played.at(-1), 'assets/2. 퀘스트 완료될때 소리.mp3');
  assert.equal(context.window.getAudioAsset('execution')?.src, 'assets/6. 처형 소리.mp3');
  assert.equal(context.window.YuksamAudioManifest.eventSounds.execution, 'execution');
});

test('ultimate skill audio plays once through the skill map while the ultimate hook stays visual-only', () => {
  const before = played.length;
  assert.equal(context.window.playSkillSfxV42('mage_fire_meteor_v24', { kind:'ultimate' }), true);
  assert.equal(played.length, before + 1);
  context.window.playUltimateFxV41('mage_fire_meteor_v24');
  assert.equal(played.length, before + 1, 'ultimate visual hook must not replay the same audio');
  assert.equal(ultimateVisualCalls, 1);
});

test('Guardian Oath passive revive keeps its dedicated sound and visual once', () => {
  const before = played.length;
  context.window.playGuardianReviveFxV41();
  assert.equal(played.length, before + 1);
  assert.equal(played.at(-1), 'assets/5. 수호자의 맹세 소리 .mp3');
  assert.equal(guardianVisualCalls, 1);
});
