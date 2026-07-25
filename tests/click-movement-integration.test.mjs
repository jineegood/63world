import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/click-movement.js'), 'utf8');
const gameSource = fs.readFileSync(path.join(root, 'game.js'), 'utf8');

function createHarness() {
  const window = {};
  vm.runInNewContext(source, { window });
  const listeners = new Map();
  const canvas = {
    width:800,
    height:450,
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    getBoundingClientRect() {
      return { left:0, top:0, width:800, height:450 };
    },
  };
  const player = { x:60, y:60 };
  const state = {
    active:true,
    paused:false,
    combat:false,
    map:'town',
    saved:0,
  };
  const controller = window.YuksamClickMovement.createController({
    canvas,
    isActive:() => state.active,
    isPaused:() => state.paused,
    isInCombat:() => state.combat,
    getMap:() => state.map,
    getPlayer:() => player,
    getCamera:() => ({ x:0, y:0 }),
    getWorld:() => ({ width:800, height:450 }),
    getColliders:() => [],
    canMoveTo:() => true,
    savePosition:() => { state.saved += 1; },
    now:() => 1000,
    radius:20,
    cellSize:20,
  });
  controller.bind();
  return { canvas, controller, listeners, player, state };
}

test('canvas ground click creates a route and advances the player', () => {
  const harness = createHarness();
  harness.listeners.get('pointerdown')({
    button:0,
    clientX:300,
    clientY:60,
  });

  assert.ok(harness.controller.getState()?.path.length);
  const result = harness.controller.update({ dt:16.67, keyboardMoving:false });
  assert.equal(result.moved, true);
  assert.ok(harness.player.x > 60);
  assert.equal(harness.state.saved, 1);
});

test('paused and combat clicks do not create movement', () => {
  const harness = createHarness();
  harness.state.paused = true;
  harness.listeners.get('pointerdown')({ button:0, clientX:300, clientY:60 });
  assert.equal(harness.controller.getState(), null);

  harness.state.paused = false;
  harness.state.combat = true;
  harness.listeners.get('pointerdown')({ button:0, clientX:300, clientY:60 });
  assert.equal(harness.controller.getState(), null);
});

test('keyboard input and map changes cancel an existing route', () => {
  const harness = createHarness();
  harness.listeners.get('pointerdown')({ button:0, clientX:300, clientY:60 });
  assert.ok(harness.controller.getState());

  harness.controller.update({ dt:16.67, keyboardMoving:true });
  assert.equal(harness.controller.getState(), null);

  harness.listeners.get('pointerdown')({ button:0, clientX:300, clientY:60 });
  harness.state.map = 'forest';
  harness.controller.update({ dt:16.67, keyboardMoving:false });
  assert.equal(harness.controller.getState(), null);
});

test('route marker is drawn briefly without creating a DOM overlay', () => {
  const harness = createHarness();
  harness.listeners.get('pointerdown')({ button:0, clientX:300, clientY:60 });
  const calls = [];
  const context = {
    save:() => calls.push('save'),
    restore:() => calls.push('restore'),
    beginPath:() => calls.push('beginPath'),
    arc:(...args) => calls.push(['arc', ...args]),
    stroke:() => calls.push('stroke'),
    set strokeStyle(value) { calls.push(['strokeStyle', value]); },
    set lineWidth(value) { calls.push(['lineWidth', value]); },
  };

  assert.equal(
    harness.controller.drawMarker(context, (x, y) => ({ x:x - 10, y:y - 5 })),
    true,
  );
  assert.ok(calls.some((entry) => Array.isArray(entry) && entry[0] === 'arc'));
});

test('game connects the tested controller to input, update, rendering, and cancellation', () => {
  assert.match(gameSource, /YuksamClickMovement\.createController\(/);
  assert.match(gameSource, /clickMovementControllerV1\.bind\(\)/);
  assert.match(gameSource, /clickMovementControllerV1\.update\(/);
  assert.match(gameSource, /id:'click-move-target-v1'/);
  assert.match(gameSource, /clickMovementControllerV1\.drawMarker\(/);
  assert.match(gameSource, /window\.cancelClickMovementV1/);
  assert.match(gameSource, /clickMovementArrivalLockV1/);
});
