import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { Script, createContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const modulePath = join(root, 'src', 'audio-volume-pipeline.js');
const source = existsSync(modulePath) ? readFileSync(modulePath, 'utf8') : '';
const gameSource = readFileSync(join(root, 'game.js'), 'utf8');
const indexSource = readFileSync(join(root, 'index.html'), 'utf8');

function loadFactory() {
  assert.ok(source, 'src/audio-volume-pipeline.js should exist');
  const context = createContext({ window:{}, Object, Number, String, Set, Error });
  new Script(source, { filename:'src/audio-volume-pipeline.js' }).runInContext(context);
  return context.window.YuksamAudioVolumePipeline;
}

test('base updates once before after hooks run by ascending priority', () => {
  const events = [];
  const pipeline = loadFactory().create({ update:(context) => { events.push(`base:${context.value}`); return 'updated'; } });
  pipeline.register({ id:'late', priority:30, after:() => events.push('late') });
  pipeline.register({ id:'early', priority:10, after:() => events.push('early') });
  assert.equal(pipeline.update({ value:'volume' }), 'updated');
  assert.deepEqual(events, ['base:volume', 'early', 'late']);
});

test('equal priorities are stable and registrations are snapshotted per update', () => {
  const events = [];
  let addedRegistered = false;
  const pipeline = loadFactory().create({ update:() => events.push('base') });
  pipeline.register({ id:'first', priority:5, after:() => {
    events.push('first');
    if (!addedRegistered) {
      addedRegistered = true;
      pipeline.register({ id:'added', priority:5, after:() => events.push('added') });
    }
  } });
  pipeline.register({ id:'second', priority:5, after:() => events.push('second') });
  pipeline.update({});
  assert.deepEqual(events, ['base', 'first', 'second']);
  pipeline.update({});
  assert.deepEqual(events.slice(3), ['base', 'first', 'second', 'added']);
});

test('duplicate ids reject and unregister removes a hook', () => {
  const events = [];
  const pipeline = loadFactory().create({ update:() => events.push('base') });
  const remove = pipeline.register({ id:'feature', after:() => events.push('old') });
  assert.throws(() => pipeline.register({ id:'feature', after:() => {} }), /Duplicate audio volume registration/);
  remove();
  pipeline.register({ id:'feature', after:() => events.push('new') });
  pipeline.update({});
  assert.deepEqual(events, ['base', 'new']);
});

test('invalid registrations, base errors, and hook errors surface', () => {
  const pipeline = loadFactory().create();
  assert.throws(() => pipeline.register({ id:'empty' }), /handler is required/i);
  assert.throws(() => pipeline.register({ after:() => {} }), /id is required/i);
  pipeline.register({ id:'boom', after:() => { throw new Error('volume hook failed'); } });
  assert.throws(() => pipeline.update({}), /volume hook failed/);
  const baseFailure = loadFactory().create({ update:() => { throw new Error('base failed'); } });
  assert.throws(() => baseFailure.update({}), /base failed/);
});

test('pipeline is independent from game, DOM, Audio, settings, and asset rules', () => {
  loadFactory();
  assert.doesNotMatch(source, /\bgame\b|\bdocument\b|\bnew\s+Audio\b|window\.Audio|bgmVolume|sfxVolume|getAudioAsset|initAudio/);
});

test('real browser preserves lazy initialization and volume policy', { timeout:30000 }, () => {
  const script = join(root, 'tools', 'browser-smoke', 'try_audio_volume.js');
  const result = spawnSync(process.execPath, [script, root], { encoding:'utf8', timeout:25000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PASS: volume update does not lazily create the door file/);
  assert.match(result.stdout, /PASS: V33 replaces upgrade success and failure exactly once/);
  assert.match(result.stdout, /PASS: file volumes clamp while the WebAudio target preserves its raw policy/);
  assert.match(result.stdout, /RESULT: PASS 12 \/ FAIL 0/);
});

test('production uses one audio-volume boundary without versioned wrappers', () => {
  assert.match(indexSource, /src\/audio-volume-pipeline\.js[\s\S]*game\.js/);
  assert.equal((gameSource.match(/YuksamAudioVolumePipeline\.create\(/g) || []).length, 1);
  assert.match(gameSource, /function updateAudioVolumes\(\) \{\s*return audioVolumePipeline\.update\(/);
  assert.doesNotMatch(gameSource, /updateAudioVolumes\s*=\s*function\s+updateAudioVolumesV\d+/);
  assert.doesNotMatch(gameSource, /oldUpdateAudioVolumesV\d*/);
  for (const id of ['audio-volume-v20', 'audio-volume-v21', 'audio-volume-v22', 'audio-volume-v25', 'audio-volume-v28', 'audio-volume-v33']) {
    assert.match(gameSource, new RegExp(`id:\\s*['"]${id}['"]`));
  }
});
