import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Script, createContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const source = readFileSync(join(root, 'src', 'combat-sequence-controller.js'), 'utf8');
const gameSource = readFileSync(join(root, 'game.js'), 'utf8');
const indexSource = readFileSync(join(root, 'index.html'), 'utf8');

function createHarness() {
  const context = createContext({ window:{} });
  new Script(source, { filename:'src/combat-sequence-controller.js' }).runInContext(context);
  const states = [];
  const tasks = new Map();
  const cleared = new Set();
  let combatId = 'monster-1';
  let resets = 0;
  let serial = 0;
  const controller = context.window.YuksamCombatSequenceController.create({
    readCombatId:() => combatId,
    writeState:(state) => states.push({ generation:state.generation, active:state.active }),
    resetTransient:() => { resets += 1; },
    setTimer:(callback, delay) => {
      const id = ++serial;
      tasks.set(id, { callback, delay });
      return id;
    },
    clearTimer:(id) => { cleared.add(id); },
  });
  return {
    controller,
    states,
    tasks,
    cleared,
    get resets() { return resets; },
    setCombatId(value) { combatId = value; },
  };
}

test('begin activates one generation and finish only closes its current token', () => {
  const harness = createHarness();
  const first = harness.controller.begin();

  assert.deepEqual({ ...first }, { generation:1, combatId:'monster-1' });
  assert.equal(harness.controller.isActive(), true);
  assert.deepEqual(harness.states, [{ generation:1, active:true }]);
  assert.equal(harness.resets, 1);
  assert.equal(harness.controller.finish(first), true);
  assert.equal(harness.controller.isActive(), false);
  assert.deepEqual(harness.states.at(-1), { generation:1, active:false });
});

test('replacing a queue clears its timers and rejects callbacks and finish from the stale token', () => {
  const harness = createHarness();
  const events = [];
  const first = harness.controller.begin();
  const timer = harness.controller.schedule(first, () => events.push('stale'), 25);
  const firstTask = harness.tasks.get(timer);
  const second = harness.controller.begin();

  assert.equal(harness.cleared.has(timer), true);
  firstTask.callback();
  assert.deepEqual(events, []);
  assert.equal(harness.controller.finish(first), false);
  assert.equal(harness.controller.isActive(), true);
  assert.equal(harness.controller.finish(second), true);
  assert.equal(harness.resets, 2);
});

test('changed combat identity makes scheduled work stale', () => {
  const harness = createHarness();
  const events = [];
  const token = harness.controller.begin();
  const timer = harness.controller.schedule(token, () => events.push('wrong combat'), 10);

  harness.setCombatId('monster-2');
  harness.tasks.get(timer).callback();
  assert.deepEqual(events, []);
  assert.equal(harness.controller.isCurrent(token), false);
  assert.equal(harness.controller.finish(token), false);
});

test('deferred post-sequence work survives finish but not replacement', () => {
  const harness = createHarness();
  const events = [];
  const token = harness.controller.begin();
  harness.controller.finish(token);
  const timer = harness.controller.defer(() => events.push('defeat'), 12);
  const task = harness.tasks.get(timer);

  task.callback();
  assert.deepEqual(events, ['defeat']);

  const replacement = harness.controller.defer(() => events.push('stale'), 12);
  const staleTask = harness.tasks.get(replacement);
  harness.controller.begin();
  staleTask.callback();
  assert.deepEqual(events, ['defeat']);
});

test('invalidate cancels pending work, resets transients, and advances to an inactive generation', () => {
  const harness = createHarness();
  const events = [];
  const token = harness.controller.begin();
  const timer = harness.controller.schedule(token, () => events.push('late'), 10);
  const task = harness.tasks.get(timer);

  harness.controller.invalidate();
  task.callback();
  assert.deepEqual(events, []);
  assert.equal(harness.cleared.has(timer), true);
  assert.equal(harness.resets, 2);
  assert.equal(harness.controller.isActive(), false);
  assert.deepEqual(harness.states.at(-1), { generation:2, active:false });
});

test('controller is independent from gameplay, DOM, and combat rendering implementations', () => {
  assert.doesNotMatch(source, /\bgame\b|\bdocument\b|renderCombat|playSfx|Audio/);
});

test('production loads and instantiates one controller instead of owning queue timers', () => {
  assert.match(indexSource, /src\/combat-rules\.js[\s\S]*src\/combat-sequence-controller\.js[\s\S]*game\.js/);
  assert.equal((gameSource.match(/YuksamCombatSequenceController\.create\(/g) || []).length, 1);
  assert.match(gameSource, /combatSequenceControllerV47\.begin\(\)/);
  assert.match(gameSource, /combatSequenceControllerV47\.schedule\(sequenceToken, showNext, duration\)/);
  assert.match(gameSource, /combatSequenceControllerV47\.invalidate\(\)/);
  assert.doesNotMatch(gameSource, /combatSequenceTimersV43|scheduleCombatSequenceV43/);
});
