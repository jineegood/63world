import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { Script, createContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const modulePath = join(root, 'src', 'combat-entry-pipeline.js');
const source = existsSync(modulePath) ? readFileSync(modulePath, 'utf8') : '';
const gameSource = readFileSync(join(root, 'game.js'), 'utf8');
const indexSource = readFileSync(join(root, 'index.html'), 'utf8');

function loadFactory() {
  assert.ok(source, 'src/combat-entry-pipeline.js should exist');
  const context = createContext({ window:{}, Object, Number, String, Set, Error });
  new Script(source, { filename:'src/combat-entry-pipeline.js' }).runInContext(context);
  return context.window.YuksamCombatEntryPipeline;
}

test('middleware runs by descending priority around one base entry', () => {
  const events = [];
  const pipeline = loadFactory().create({ enter:(context) => { events.push(`base:${context.id}`); return 'opened'; } });
  pipeline.register({ id:'old', priority:10, handle:(context, next) => { events.push('old-before'); const result = next(); events.push('old-after'); return result; } });
  pipeline.register({ id:'new', priority:30, handle:(context, next) => { events.push('new-before'); const result = next(); events.push('new-after'); return result; } });
  assert.equal(pipeline.open({ id:'combat' }), 'opened');
  assert.deepEqual(events, ['new-before', 'old-before', 'base:combat', 'old-after', 'new-after']);
});

test('equal priorities are stable and a handler can short-circuit', () => {
  const events = [];
  const pipeline = loadFactory().create({ enter:() => events.push('base') });
  pipeline.register({ id:'first', priority:5, handle:(context, next) => { events.push('first'); return next(); } });
  pipeline.register({ id:'stop', priority:5, handle:() => { events.push('stop'); return 'paused'; } });
  pipeline.register({ id:'third', priority:5, handle:(context, next) => { events.push('third'); return next(); } });
  assert.equal(pipeline.open({}), 'paused');
  assert.deepEqual(events, ['first', 'stop']);
});

test('next can only be called once per middleware invocation', () => {
  const pipeline = loadFactory().create({ enter:() => 'base' });
  pipeline.register({ id:'twice', handle:(context, next) => { next(); return next(); } });
  assert.throws(() => pipeline.open({}), /next.*once/i);
});

test('duplicate ids reject and unregister removes a handler', () => {
  const events = [];
  const pipeline = loadFactory().create({ enter:() => events.push('base') });
  const remove = pipeline.register({ id:'feature', handle:(context, next) => { events.push('old'); return next(); } });
  assert.throws(() => pipeline.register({ id:'feature', handle:() => {} }), /Duplicate combat entry registration/);
  remove();
  pipeline.register({ id:'feature', handle:(context, next) => { events.push('new'); return next(); } });
  pipeline.open({});
  assert.deepEqual(events, ['new', 'base']);
});

test('invalid registrations and handler exceptions surface', () => {
  const pipeline = loadFactory().create();
  assert.throws(() => pipeline.register({ id:'empty' }), /handler is required/i);
  assert.throws(() => pipeline.register({ handle:() => {} }), /id is required/i);
  pipeline.register({ id:'boom', handle:() => { throw new Error('entry failed'); } });
  assert.throws(() => pipeline.open({}), /entry failed/);
});

test('pipeline is independent from game, DOM, monster, modal, audio, and combat rules', () => {
  loadFactory();
  assert.doesNotMatch(source, /\bgame\b|\bdocument\b|monster|modalState|playSfx|YuksamCombatRules/);
});

test('real browser preserves valid, paused, and invalid combat entry behavior', { timeout:30000 }, () => {
  const script = join(root, 'tools', 'browser-smoke', 'try_combat_entry.js');
  const result = spawnSync(process.execPath, [script, root], { encoding:'utf8', timeout:25000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PASS: valid entry invalidates the previous combat generation once/);
  assert.match(result.stdout, /PASS: paused entry short-circuits before keys, escape, identity, and modal changes/);
  assert.match(result.stdout, /PASS: dead monster is rejected without opening combat/);
  assert.match(result.stdout, /RESULT: PASS 12 \/ FAIL 0/);
});

test('production uses one combat-entry boundary without versioned wrappers', () => {
  assert.match(indexSource, /src\/combat-entry-pipeline\.js[\s\S]*game\.js/);
  assert.equal((gameSource.match(/YuksamCombatEntryPipeline\.create\(/g) || []).length, 1);
  assert.match(
    gameSource,
    /function openCombat\(monster\) \{\s*window\.cancelClickMovementV1\?\.\(\);\s*return combatEntryPipeline\.open\(/,
  );
  assert.doesNotMatch(gameSource, /openCombat\s*=\s*function\s+openCombatV\d+/);
  assert.doesNotMatch(gameSource, /oldOpenCombatV\d+/);
  for (const id of ['combat-entry-v22', 'combat-entry-v24', 'combat-entry-v25']) {
    assert.match(gameSource, new RegExp(`id:\\s*['"]${id}['"]`));
  }
});
