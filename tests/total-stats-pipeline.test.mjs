import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { Script, createContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const modulePath = join(root, 'src', 'total-stats-pipeline.js');
const source = existsSync(modulePath) ? readFileSync(modulePath, 'utf8') : '';
const gameSource = readFileSync(join(root, 'game.js'), 'utf8');
const indexSource = readFileSync(join(root, 'index.html'), 'utf8');

function loadFactory() {
  assert.ok(source, 'src/total-stats-pipeline.js should exist');
  const context = createContext({ window:{}, Object, Number, String, Set, Error });
  new Script(source, { filename:'src/total-stats-pipeline.js' }).runInContext(context);
  return context.window.YuksamTotalStatsPipeline;
}

test('prepare descends, base calculates once, and modifiers ascend', () => {
  const events = [];
  const pipeline = loadFactory().create({ calculate:(context) => { events.push(`base:${context.id}`); return { value:1 }; } });
  pipeline.register({ id:'old', priority:10, prepare:() => events.push('prepare-old'), apply:(total) => { events.push('apply-old'); total.value += 2; } });
  pipeline.register({ id:'new', priority:30, prepare:() => events.push('prepare-new'), apply:(total) => { events.push('apply-new'); total.value *= 3; } });
  const total = pipeline.compute({ id:'stats' });
  assert.deepEqual(events, ['prepare-new', 'prepare-old', 'base:stats', 'apply-old', 'apply-new']);
  assert.equal(total.value, 9);
});

test('equal priorities preserve registration order in both phases', () => {
  const events = [];
  const pipeline = loadFactory().create({ calculate:() => ({}) });
  pipeline.register({ id:'first', priority:5, prepare:() => events.push('prepare-first'), apply:() => events.push('apply-first') });
  pipeline.register({ id:'second', priority:5, prepare:() => events.push('prepare-second'), apply:() => events.push('apply-second') });
  pipeline.compute({});
  assert.deepEqual(events, ['prepare-first', 'prepare-second', 'apply-first', 'apply-second']);
});

test('duplicate ids reject and unregister removes both stages', () => {
  const events = [];
  const pipeline = loadFactory().create({ calculate:() => ({}) });
  const remove = pipeline.register({ id:'feature', prepare:() => events.push('old'), apply:() => events.push('old-apply') });
  assert.throws(() => pipeline.register({ id:'feature', apply:() => {} }), /Duplicate total stats registration/);
  remove();
  pipeline.register({ id:'feature', apply:() => events.push('new') });
  pipeline.compute({});
  assert.deepEqual(events, ['new']);
});

test('invalid registration, base result, and hook errors surface', () => {
  const pipeline = loadFactory().create({ calculate:() => null });
  assert.throws(() => pipeline.register({ id:'empty' }), /prepare or apply hook/i);
  assert.throws(() => pipeline.register({ apply:() => {} }), /id is required/i);
  assert.throws(() => pipeline.compute({}), /stats object/i);
  const broken = loadFactory().create({ calculate:() => ({}) });
  broken.register({ id:'boom', apply:() => { throw new Error('stats failed'); } });
  assert.throws(() => broken.compute({}), /stats failed/);
});

test('pipeline is independent from game, DOM, stat names, item, skill, and pet data', () => {
  loadFactory();
  assert.doesNotMatch(source, /\bgame\b|\bdocument\b|체력|ITEM_DEFS|SKILL_DEFS|PET_DEFS|weaponUpgrades/);
});

test('real browser preserves bonuses and fixes legacy first-call consistency', { timeout:30000 }, () => {
  const script = join(root, 'tools', 'browser-smoke', 'try_total_stats.js');
  const result = spawnSync(process.execPath, [script, root], { encoding:'utf8', timeout:25000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PASS: warrior 방어 keeps cumulative specialization bonuses/);
  assert.match(result.stdout, /PASS: weapon enhancement bonus follows tier formula once/);
  assert.match(result.stdout, /PASS: legacy player fields produce stable stats on the first call/);
  assert.match(result.stdout, /RESULT: PASS 15 \/ FAIL 0/);
});

test('production uses one total-stats boundary without versioned wrappers', () => {
  assert.match(indexSource, /src\/total-stats-pipeline\.js[\s\S]*game\.js/);
  assert.equal((gameSource.match(/YuksamTotalStatsPipeline\.create\(/g) || []).length, 1);
  assert.match(gameSource, /function computeTotalStats\(\) \{\s*return totalStatsPipeline\.compute\(/);
  assert.doesNotMatch(gameSource, /computeTotalStats\s*=\s*function\s+computeTotalStatsV\d+/);
  assert.doesNotMatch(gameSource, /oldComputeTotalStatsV\d+/);
  for (const id of ['stats-specialization-v19', 'stats-specialization-v23', 'stats-pet-enhancement-v27']) {
    assert.match(gameSource, new RegExp(`id:\\s*['"]${id}['"]`));
  }
});
