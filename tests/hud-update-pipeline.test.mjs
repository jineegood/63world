import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { Script, createContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const modulePath = join(root, 'src', 'hud-update-pipeline.js');
const source = existsSync(modulePath) ? readFileSync(modulePath, 'utf8') : '';
const gameSource = readFileSync(join(root, 'game.js'), 'utf8');
const indexSource = readFileSync(join(root, 'index.html'), 'utf8');

function loadFactory() {
  assert.ok(source, 'src/hud-update-pipeline.js should exist');
  const context = createContext({ window:{}, Object, Number, String, Set, Error });
  new Script(source, { filename:'src/hud-update-pipeline.js' }).runInContext(context);
  return context.window.YuksamHudUpdatePipeline;
}

test('before hooks descend, core runs once, and after hooks ascend', () => {
  const events = [];
  const pipeline = loadFactory().create({ render:(context) => events.push(`core:${context.id}`) });
  pipeline.register({ id:'low', priority:10, before:() => events.push('before-low'), after:() => events.push('after-low') });
  pipeline.register({ id:'high', priority:30, before:() => events.push('before-high'), after:() => events.push('after-high') });
  pipeline.register({ id:'middle', priority:20, before:() => events.push('before-middle'), after:() => events.push('after-middle') });
  pipeline.update({ id:'hud' });
  assert.deepEqual(events, ['before-high', 'before-middle', 'before-low', 'core:hud', 'after-low', 'after-middle', 'after-high']);
});

test('equal priorities preserve registration order in both phases', () => {
  const events = [];
  const pipeline = loadFactory().create({ render:() => events.push('core') });
  pipeline.register({ id:'first', priority:5, before:() => events.push('before-first'), after:() => events.push('after-first') });
  pipeline.register({ id:'second', priority:5, before:() => events.push('before-second'), after:() => events.push('after-second') });
  pipeline.update({});
  assert.deepEqual(events, ['before-first', 'before-second', 'core', 'after-first', 'after-second']);
});

test('duplicate ids reject and unregister removes both phases', () => {
  const events = [];
  const pipeline = loadFactory().create({ render:() => events.push('core') });
  const remove = pipeline.register({ id:'feature', before:() => events.push('before'), after:() => events.push('after') });
  assert.throws(() => pipeline.register({ id:'feature', before:() => {} }), /Duplicate HUD update registration/);
  remove();
  assert.doesNotThrow(() => pipeline.register({ id:'feature', before:() => events.push('new') }));
  pipeline.update({});
  assert.deepEqual(events, ['new', 'core']);
});

test('invalid entries and hook exceptions surface', () => {
  const pipeline = loadFactory().create();
  assert.throws(() => pipeline.register({ id:'empty' }), /before or after hook/i);
  assert.throws(() => pipeline.register({ before:() => {} }), /id is required/i);
  pipeline.register({ id:'boom', before:() => { throw new Error('hud failed'); } });
  assert.throws(() => pipeline.update({}), /hud failed/);
});

test('pipeline module is independent from game, DOM, HUD, audio, and quest rules', () => {
  loadFactory();
  assert.doesNotMatch(source, /\bgame\b|\bdocument\b|hudLevel|syncAudio|updateQuest|skillPoints/);
});

test('real browser preserves final HUD behavior', { timeout:30000 }, () => {
  const script = join(root, 'tools', 'browser-smoke', 'try_hud_update.js');
  const result = spawnSync(process.execPath, [script, root], { encoding:'utf8', timeout:25000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PASS: latest player fields are normalized before HUD rendering/);
  assert.match(result.stdout, /PASS: skill points are synchronized before HUD rendering/);
  assert.match(result.stdout, /PASS: zone, audio, and quest updates run once/);
  assert.match(result.stdout, /RESULT: PASS 11 \/ FAIL 0/);
});

test('production uses one HUD update boundary without versioned wrappers', () => {
  assert.match(indexSource, /src\/hud-update-pipeline\.js[\s\S]*game\.js/);
  assert.equal((gameSource.match(/YuksamHudUpdatePipeline\.create\(/g) || []).length, 1);
  assert.match(gameSource, /function updateHud\(\) \{\s*return hudUpdatePipeline\.update\(/);
  assert.doesNotMatch(gameSource, /updateHud\s*=\s*function\s+updateHudV\d+/);
  assert.doesNotMatch(gameSource, /oldUpdateHudV\d+/);
  for (const id of ['hud-display-v22', 'hud-settings-v23', 'hud-skill-points-v24', 'hud-test-buttons-v25', 'hud-player-fields-v27']) {
    assert.match(gameSource, new RegExp(`id:\\s*['"]${id}['"]`));
  }
});
