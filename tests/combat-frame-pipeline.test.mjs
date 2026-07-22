import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { Script, createContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const modulePath = join(root, 'src', 'combat-frame-pipeline.js');
const source = existsSync(modulePath) ? readFileSync(modulePath, 'utf8') : '';
const gameSource = readFileSync(join(root, 'game.js'), 'utf8');
const indexSource = readFileSync(join(root, 'index.html'), 'utf8');

function loadFactory() {
  assert.ok(source, 'src/combat-frame-pipeline.js should exist');
  const context = createContext({ window:{}, Object, Number, String, Set, Error });
  new Script(source, { filename:'src/combat-frame-pipeline.js' }).runInContext(context);
  return context.window.YuksamCombatFramePipeline;
}

test('base renders once before after hooks run by ascending priority', () => {
  const events = [];
  const pipeline = loadFactory().create({ render:(context) => { events.push(`base:${context.message}`); return 'rendered'; } });
  pipeline.register({ id:'late', priority:30, after:() => events.push('late') });
  pipeline.register({ id:'early', priority:10, after:() => events.push('early') });
  assert.equal(pipeline.render({ message:'frame' }), 'rendered');
  assert.deepEqual(events, ['base:frame', 'early', 'late']);
});

test('equal priorities are stable and registrations are snapshotted per render', () => {
  const events = [];
  let addedRegistered = false;
  const pipeline = loadFactory().create({ render:() => events.push('base') });
  pipeline.register({ id:'first', priority:5, after:() => {
    events.push('first');
    if (!addedRegistered) {
      addedRegistered = true;
      pipeline.register({ id:'added', priority:5, after:() => events.push('added') });
    }
  } });
  pipeline.register({ id:'second', priority:5, after:() => events.push('second') });
  pipeline.render({});
  assert.deepEqual(events, ['base', 'first', 'second']);
  pipeline.render({});
  assert.deepEqual(events.slice(3), ['base', 'first', 'second', 'added']);
});

test('duplicate ids reject and unregister removes a hook', () => {
  const events = [];
  const pipeline = loadFactory().create({ render:() => events.push('base') });
  const remove = pipeline.register({ id:'feature', after:() => events.push('old') });
  assert.throws(() => pipeline.register({ id:'feature', after:() => {} }), /Duplicate combat frame registration/);
  remove();
  pipeline.register({ id:'feature', after:() => events.push('new') });
  pipeline.render({});
  assert.deepEqual(events, ['base', 'new']);
});

test('invalid registrations, base errors, and hook errors surface', () => {
  const pipeline = loadFactory().create();
  assert.throws(() => pipeline.register({ id:'empty' }), /handler is required/i);
  assert.throws(() => pipeline.register({ after:() => {} }), /id is required/i);
  pipeline.register({ id:'boom', after:() => { throw new Error('frame hook failed'); } });
  assert.throws(() => pipeline.render({}), /frame hook failed/);
  const baseFailure = loadFactory().create({ render:() => { throw new Error('base failed'); } });
  assert.throws(() => baseFailure.render({}), /base failed/);
});

test('pipeline is independent from game, DOM, modal, audio, and rendering rules', () => {
  loadFactory();
  assert.doesNotMatch(source, /\bgame\b|\bdocument\b|modalState|playSfx|currentCombatMonster|drawCombatCanvases/);
});

test('real browser preserves final combat frame DOM and missing-target behavior', { timeout:30000 }, () => {
  const script = join(root, 'tools', 'browser-smoke', 'try_combat_frame.js');
  const result = spawnSync(process.execPath, [script, root], { encoding:'utf8', timeout:25000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PASS: message text is preserved while markup is escaped/);
  assert.match(result.stdout, /PASS: V27 removes every temporary V26 background class/);
  assert.match(result.stdout, /PASS: missing target keeps legacy outer-hook rewrite without replacing the frame/);
  assert.match(result.stdout, /RESULT: PASS 12 \/ FAIL 0/);
});

test('production uses one combat-frame boundary without versioned wrappers', () => {
  assert.match(indexSource, /src\/combat-frame-pipeline\.js[\s\S]*game\.js/);
  assert.equal((gameSource.match(/YuksamCombatFramePipeline\.create\(/g) || []).length, 1);
  assert.match(gameSource, /function renderCombatFrame\(message, contentHtml = ''\) \{\s*return combatFramePipeline\.render\(/);
  assert.doesNotMatch(gameSource, /renderCombatFrame\s*=\s*function\s+renderCombatFrameV\d+/);
  assert.doesNotMatch(gameSource, /oldRenderCombatFrameV\d+/);
  for (const id of ['combat-frame-v20', 'combat-frame-v23', 'combat-frame-v25', 'combat-frame-v26', 'combat-frame-v27']) {
    assert.match(gameSource, new RegExp(`id:\\s*['"]${id}['"]`));
  }
});
