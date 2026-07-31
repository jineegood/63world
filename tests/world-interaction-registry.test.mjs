import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { Script, createContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const modulePath = join(root, 'src', 'world-interaction-registry.js');
const source = existsSync(modulePath) ? readFileSync(modulePath, 'utf8') : '';
const gameSource = readFileSync(join(root, 'game.js'), 'utf8');
const indexSource = readFileSync(join(root, 'index.html'), 'utf8');

function loadFactory() {
  assert.ok(source, 'src/world-interaction-registry.js should exist');
  const context = createContext({ window:{}, Object, Number, String, Set, Error, Symbol });
  new Script(source, { filename:'src/world-interaction-registry.js' }).runInContext(context);
  return context.window.YuksamWorldInteractionRegistry;
}

test('candidate providers use descending priority and stable registration order', () => {
  const factory = loadFactory();
  const events = [];
  const registry = factory.create({ findFallback:() => ({ type:'fallback' }) });
  registry.registerCandidate({ id:'low', priority:10, find:() => { events.push('low'); return { type:'low' }; } });
  registry.registerCandidate({ id:'high-first', priority:20, find:() => { events.push('high-first'); return null; } });
  registry.registerCandidate({ id:'high-second', priority:20, find:() => { events.push('high-second'); return { type:'winner' }; } });

  assert.equal(registry.find({ map:'town' }).type, 'winner');
  assert.deepEqual(events, ['high-first', 'high-second']);
});

test('STOP makes an exclusive provider return null without consulting lower providers or fallback', () => {
  const factory = loadFactory();
  const events = [];
  const registry = factory.create({ findFallback:() => { events.push('fallback'); return { type:'fallback' }; } });
  registry.registerCandidate({ id:'low', priority:1, find:() => { events.push('low'); return { type:'low' }; } });
  registry.registerCandidate({ id:'exclusive', priority:100, find:() => { events.push('exclusive'); return factory.STOP; } });

  assert.equal(registry.find({ map:'finalBossRoom' }), null);
  assert.deepEqual(events, ['exclusive']);
});

test('dispatch resolves once and runs only matching actions until one handles the candidate', () => {
  const factory = loadFactory();
  const events = [];
  let lookups = 0;
  const registry = factory.create({
    findFallback:() => { lookups += 1; return { type:'npc', id:'target' }; },
    beforeDispatch:(candidate) => events.push(`before:${candidate.type}`),
    dispatchFallback:() => events.push('fallback'),
  });
  registry.registerAction({ id:'wrong-type', types:['portal'], priority:100, handle:() => events.push('wrong') });
  registry.registerAction({ id:'observer', types:['npc'], priority:20, handle:() => { events.push('observer'); return false; } });
  registry.registerAction({ id:'owner', types:['npc'], priority:10, handle:(candidate) => { events.push(`owner:${candidate.id}`); return true; } });
  registry.registerAction({ id:'late', types:['npc'], priority:1, handle:() => events.push('late') });

  assert.equal(registry.dispatch({ map:'town' }), true);
  assert.equal(lookups, 1);
  assert.deepEqual(events, ['before:npc', 'observer', 'owner:target']);
});

test('an action returning true may intentionally handle a candidate without side effects', () => {
  const factory = loadFactory();
  let fallbackCalls = 0;
  const registry = factory.create({
    findFallback:() => ({ type:'autoExit' }),
    dispatchFallback:() => { fallbackCalls += 1; },
  });
  registry.registerAction({ id:'no-op-exit', types:['autoExit'], handle:() => true });

  assert.equal(registry.dispatch({}), true);
  assert.equal(fallbackCalls, 0);
});

test('registrations reject duplicate ids and can be unregistered cleanly', () => {
  const factory = loadFactory();
  const registry = factory.create({ findFallback:() => ({ type:'fallback' }) });
  const remove = registry.registerCandidate({ id:'feature', find:() => ({ type:'feature' }) });
  assert.throws(() => registry.registerAction({ id:'feature', types:['feature'], handle:() => true }), /Duplicate world interaction registration/);
  remove();
  assert.doesNotThrow(() => registry.registerAction({ id:'feature', types:['feature'], handle:() => true }));
  assert.equal(registry.find({}).type, 'fallback');
});

test('registry module has no game, DOM, audio, or map-data dependency', () => {
  loadFactory();
  assert.doesNotMatch(source, /\bgame\b|\bdocument\b|\bAudio\b|worldDefs|distance\(/);
});

test('real browser preserves final world candidates and actions', { timeout:30000 }, () => {
  const script = join(root, 'tools', 'browser-smoke', 'try_world_interactions.js');
  const result = spawnSync(process.execPath, [script, root], { encoding:'utf8', timeout:25000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PASS: equipment-shop exit remains available to click arrival and E/);
  assert.match(result.stdout, /PASS: pet-shop door action enters the interior/);
  assert.match(result.stdout, /PASS: pet automatic exit ignores E/);
  assert.match(result.stdout, /PASS: final room blocks lower-map candidate fallback/);
  assert.match(result.stdout, /PASS: final exit returns to its recorded map/);
});

test('production uses one registry boundary without versioned lookup or dispatch wrappers', () => {
  assert.match(indexSource, /src\/input-router\.js[\s\S]*src\/world-interaction-registry\.js[\s\S]*game\.js/);
  assert.equal((gameSource.match(/YuksamWorldInteractionRegistry\.create\(/g) || []).length, 1);
  assert.match(gameSource, /function getNearestInteractable\(\) \{\s*return worldInteractionRegistry\.find\(/);
  assert.match(gameSource, /function interact\(\) \{\s*return worldInteractionRegistry\.dispatch\(/);
  assert.doesNotMatch(gameSource, /getNearestInteractable\s*=\s*function\s+getNearestInteractableV\d+/);
  assert.doesNotMatch(gameSource, /interact\s*=\s*function\s+interactV\d+/);
  assert.doesNotMatch(gameSource, /oldGetNearestInteractableV\d+|oldInteractV\d+/);
});
