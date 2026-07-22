import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { Script, createContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const modulePath = join(root, 'src', 'world-render-pipeline.js');
const source = existsSync(modulePath) ? readFileSync(modulePath, 'utf8') : '';
const gameSource = readFileSync(join(root, 'game.js'), 'utf8');
const indexSource = readFileSync(join(root, 'index.html'), 'utf8');

function loadFactory() {
  assert.ok(source, 'src/world-render-pipeline.js should exist');
  const context = createContext({ window:{}, Object, Number, String, Set, Error });
  new Script(source, { filename:'src/world-render-pipeline.js' }).runInContext(context);
  return context.window.YuksamWorldRenderPipeline;
}

test('highest-priority matching owner renders once and skips fallback', () => {
  const events = [];
  const pipeline = loadFactory().create({ fallback:() => events.push('fallback') });
  pipeline.registerOwner({ id:'low', priority:1, owns:() => true, render:() => events.push('low') });
  pipeline.registerOwner({ id:'high-decline', priority:20, owns:() => false, render:() => events.push('wrong') });
  pipeline.registerOwner({ id:'high', priority:10, owns:({ map }) => map === 'shop', render:() => events.push('high') });
  pipeline.render({ map:'shop' });
  assert.deepEqual(events, ['high']);
});

test('owner ties are stable and fallback handles an unowned context', () => {
  const events = [];
  const pipeline = loadFactory().create({ fallback:({ map }) => events.push(`fallback:${map}`) });
  pipeline.registerOwner({ id:'first', priority:5, owns:() => true, render:() => events.push('first') });
  pipeline.registerOwner({ id:'second', priority:5, owns:() => true, render:() => events.push('second') });
  pipeline.render({ map:'town' });
  assert.deepEqual(events, ['first']);

  const empty = loadFactory().create({ fallback:({ map }) => events.push(`fallback:${map}`) });
  empty.render({ map:'forest' });
  assert.equal(events.at(-1), 'fallback:forest');
});

test('matching layers run after the owner in ascending priority and stable order', () => {
  const events = [];
  const pipeline = loadFactory().create({ fallback:() => events.push('base') });
  pipeline.registerLayer({ id:'late-first', priority:20, when:() => true, render:() => events.push('late-first') });
  pipeline.registerLayer({ id:'early', priority:5, when:({ enabled }) => enabled, render:() => events.push('early') });
  pipeline.registerLayer({ id:'late-second', priority:20, when:() => true, render:() => events.push('late-second') });
  pipeline.registerLayer({ id:'skip', priority:1, when:() => false, render:() => events.push('skip') });
  pipeline.render({ enabled:true });
  assert.deepEqual(events, ['base', 'early', 'late-first', 'late-second']);
});

test('duplicate ids reject and unregister frees the id', () => {
  const pipeline = loadFactory().create();
  const remove = pipeline.registerOwner({ id:'feature', owns:() => true, render:() => {} });
  assert.throws(() => pipeline.registerLayer({ id:'feature', render:() => {} }), /Duplicate world render registration/);
  remove();
  assert.doesNotThrow(() => pipeline.registerLayer({ id:'feature', render:() => {} }));
});

test('invalid registrations and render exceptions surface', () => {
  const pipeline = loadFactory().create();
  assert.throws(() => pipeline.registerOwner({ id:'owner', render:() => {} }), /owner predicate/i);
  assert.throws(() => pipeline.registerLayer({ id:'layer' }), /layer renderer/i);
  pipeline.registerLayer({ id:'boom', render:() => { throw new Error('render failed'); } });
  assert.throws(() => pipeline.render({}), /render failed/);
});

test('pipeline module is independent from game, DOM, canvas, map data, and audio', () => {
  loadFactory();
  assert.doesNotMatch(source, /\bgame\b|\bdocument\b|worldDefs|getContext|playSfx|\bAudio\b/);
});

test('real browser renders every world owner with one player stack', { timeout:30000 }, () => {
  const script = join(root, 'tools', 'browser-smoke', 'try_world_render.js');
  const result = spawnSync(process.execPath, [script, root], { encoding:'utf8', timeout:25000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PASS: swamp renders one player stack/);
  assert.match(result.stdout, /PASS: upgradeShopInterior renders shop actors once/);
  assert.match(result.stdout, /PASS: finalBossRoom owns one player stack/);
  assert.match(result.stdout, /PASS: base renderer tolerates a missing player/);
  assert.match(result.stdout, /RESULT: PASS 22 \/ FAIL 0/);
});

test('production uses one render boundary without versioned drawWorld wrappers', () => {
  assert.match(indexSource, /src\/world-render-pipeline\.js[\s\S]*game\.js/);
  assert.equal((gameSource.match(/YuksamWorldRenderPipeline\.create\(/g) || []).length, 1);
  assert.match(gameSource, /function drawWorld\(\) \{\s*return worldRenderPipeline\.render\(/);
  assert.doesNotMatch(gameSource, /drawWorld\s*=\s*function\s+drawWorldV\d+/);
  assert.doesNotMatch(gameSource, /oldDrawWorldV\d+/);
  assert.match(gameSource, /id:\s*['"]shops-v34['"]/);
  assert.match(gameSource, /id:\s*['"]final-boss-room-v35['"]/);
  assert.match(gameSource, /id:\s*['"]pet-follower-v34['"]/);
  assert.match(gameSource, /id:\s*['"]legendary-pet-v35['"]/);
});
