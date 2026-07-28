import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function loadApi() {
  const window = {};
  vm.runInNewContext(read('src/audio-defaults.js'), { window }, { filename:'src/audio-defaults.js' });
  return window.YuksamAudioDefaults;
}

test('the agreed default levels are background 15 and effects 60', () => {
  const api = loadApi();
  assert.equal(api.BGM_PERCENT, 15);
  assert.equal(api.SFX_PERCENT, 60);
  const settings = api.defaultSettings();
  assert.equal(settings.bgmVolume, 0.15);
  assert.equal(settings.sfxVolume, 0.6);
  assert.equal(settings.bgmEnabled, true);
  assert.equal(settings.sfxEnabled, true);
});
test('each call hands back a fresh object so one player cannot change another default', () => {
  const api = loadApi();
  const first = api.defaultSettings();
  first.bgmVolume = 0.99;
  assert.equal(api.defaultSettings().bgmVolume, 0.15);
});

test('the game takes its levels from the shared default, never its own numbers', () => {
  const game = read('game.js');
  assert.match(game, /settings: window\.YuksamAudioDefaults\.defaultSettings\(\)/);
  assert.match(game, /Object\.assign\(game\.settings, window\.YuksamAudioDefaults\.defaultSettings\(\)\)/);
  // 예전 패치들이 남긴 제각각의 값이 다시 살아나면 안 된다
  assert.doesNotMatch(game, /settings\.bgmVolume\s*=\s*0\.(10|21)\b/);
  assert.doesNotMatch(game, /settings\.sfxVolume\s*=\s*(1\.0|0\.94)\b/);

  const html = read('index.html');
  const defaultsIndex = html.indexOf('<script src="src/audio-defaults.js"></script>');
  const gameIndex = html.indexOf('<script src="game.js"></script>');
  assert.ok(defaultsIndex > 0, '기본값 모듈이 index.html에 없습니다');
  assert.ok(defaultsIndex < gameIndex, '기본값 모듈은 game.js보다 먼저 로드되어야 합니다');
});
