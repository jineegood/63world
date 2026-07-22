import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

function loadDispatcher() {
  const source = readFileSync(join(root, 'src', 'audio-dispatcher.js'), 'utf8');
  const context = { window:{} };
  vm.runInNewContext(source, context);
  return { dispatcher:context.window.YuksamAudioDispatcher, source };
}

test('dispatcher routes ordinary, door, and upgrade sounds once', () => {
  const { dispatcher } = loadDispatcher();
  const events = [];
  const play = dispatcher.create({
    playSynth:(name) => events.push(['synth', name]),
    playDoor:() => events.push(['door']),
    playUpgrade:(name) => { events.push(['upgrade', name]); return name !== 'upgradeFail'; },
  });
  play('coin'); play('door'); play('upgradeSuccess'); play('upgradeFail');
  assert.deepEqual(events, [
    ['synth','coin'], ['door'], ['upgrade','upgradeSuccess'], ['upgrade','upgradeFail'], ['synth','upgradeFail'],
  ]);
});

test('critical visuals, mapped audio, and fallback are single-shot', () => {
  const { dispatcher } = loadDispatcher();
  const events = [];
  let mappedFallback;
  const play = dispatcher.create({
    playMapped:(id, fallback) => { events.push(['mapped', id]); mappedFallback = fallback; return true; },
    playCriticalVisuals:(source) => events.push(['visuals', source]),
    getCriticalSource:() => 'enemy',
    playPlayerHitFallback:() => events.push(['fallback']),
  });
  play('critical'); mappedFallback(); mappedFallback();
  assert.deepEqual(events, [['visuals','enemy'], ['mapped','critical'], ['fallback']]);
});

test('dispatcher has no runtime, DOM, or audio implementation dependency', () => {
  const { source } = loadDispatcher();
  assert.doesNotMatch(source, /\bgame\b|\bdocument\b|\bAudio\b|\bplayTone\b/);
});

test('production mapped audio reads explicit settings boundary', () => {
  const source = `${readFileSync(join(root, 'src', 'audio-manifest.js'), 'utf8')}\n${readFileSync(join(root, 'src', 'sfx-map.js'), 'utf8')}`;
  assert.doesNotMatch(source, /window\.__G/);
  assert.match(source, /getYuksamAudioSettings/);
});

test('real script chain preserves both critical visuals without scope errors', () => {
  const script = join(root, 'tools', 'browser-smoke', 'try_audio_dispatcher.js');
  const result = spawnSync(process.execPath, [script, root], { encoding:'utf8', timeout:45000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /RESULT: PASS/);
});
