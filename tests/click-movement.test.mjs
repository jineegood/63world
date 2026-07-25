import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const modulePath = path.join(root, 'src/click-movement.js');

function loadApi() {
  const source = fs.readFileSync(modulePath, 'utf8');
  const window = {};
  vm.runInNewContext(source, { window });
  return window.YuksamClickMovement;
}

const bounds = { width:400, height:240 };
const obstacleContext = {
  bounds,
  radius:20,
  colliders:[
    { type:'rect', x:200, y:60, w:80, h:80 },
    { type:'circle', x:280, y:150, r:25 },
  ],
};

test('planner reaches open ground without putting a waypoint inside a collider', () => {
  const api = loadApi();
  const path = api.planPath({
    start:{ x:40, y:40 },
    target:{ x:360, y:40 },
    ...obstacleContext,
    cellSize:20,
  });

  assert.ok(path.length > 1);
  assert.ok(Math.hypot(path.at(-1).x - 360, path.at(-1).y - 40) <= 20);
  for (const point of path) assert.equal(api.isWalkable(point, obstacleContext), true);
});

test('planner moves a blocked destination to a nearby reachable point', () => {
  const api = loadApi();
  const context = {
    bounds,
    radius:15,
    colliders:[{ type:'circle', x:260, y:120, r:35 }],
  };
  const path = api.planPath({
    start:{ x:40, y:120 },
    target:{ x:260, y:120 },
    ...context,
    cellSize:20,
  });

  assert.ok(path.length);
  assert.equal(api.isWalkable(path.at(-1), context), true);
  assert.ok(Math.hypot(path.at(-1).x - 260, path.at(-1).y - 120) <= 80);
});

test('planner returns no route when the start is sealed away from the target', () => {
  const api = loadApi();
  const path = api.planPath({
    start:{ x:60, y:60 },
    target:{ x:340, y:180 },
    bounds,
    radius:10,
    cellSize:20,
    colliders:[
      { type:'rect', x:60, y:20, w:120, h:20 },
      { type:'rect', x:60, y:100, w:120, h:20 },
      { type:'rect', x:20, y:60, w:20, h:100 },
      { type:'rect', x:100, y:60, w:20, h:100 },
    ],
  });
  assert.equal(path.length, 0);
});

test('planner keeps output inside bounds and rejects diagonal corner cutting', () => {
  const api = loadApi();
  const context = {
    bounds:{ width:160, height:160 },
    radius:10,
    colliders:[
      { type:'rect', x:70, y:40, w:20, h:60 },
      { type:'rect', x:40, y:70, w:60, h:20 },
    ],
  };
  const path = api.planPath({
    start:{ x:40, y:40 },
    target:{ x:150, y:150 },
    ...context,
    cellSize:20,
  });

  assert.equal(path.length, 0);
  for (const point of path) {
    assert.ok(point.x >= 10 && point.x <= 150);
    assert.ok(point.y >= 10 && point.y <= 150);
  }
});

test('path smoothing never draws a straight segment through a collider', () => {
  const api = loadApi();
  const context = {
    bounds:{ width:360, height:240 },
    radius:15,
    colliders:[{ type:'rect', x:180, y:120, w:80, h:100 }],
  };
  const path = api.planPath({
    start:{ x:40, y:120 },
    target:{ x:320, y:120 },
    ...context,
    cellSize:20,
  });

  assert.ok(path.length >= 2);
  let previous = { x:40, y:120 };
  for (const point of path) {
    const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
    const samples = Math.max(1, Math.ceil(distance / 5));
    for (let index = 0; index <= samples; index += 1) {
      const ratio = index / samples;
      assert.equal(api.isWalkable({
        x:previous.x + (point.x - previous.x) * ratio,
        y:previous.y + (point.y - previous.y) * ratio,
      }, context), true);
    }
    previous = point;
  }
});

test('advance stops exactly at the last waypoint without mutating its inputs', () => {
  const api = loadApi();
  const position = { x:0, y:0 };
  const path = [{ x:3, y:0 }, { x:6, y:0 }];
  const result = api.advance({ position, path, speed:10 });

  assert.deepEqual({ ...result.position }, { x:6, y:0 });
  assert.equal(result.path.length, 0);
  assert.equal(result.moving, false);
  assert.deepEqual({ ...result.direction }, { x:1, y:0 });
  assert.deepEqual(position, { x:0, y:0 });
  assert.deepEqual(path, [{ x:3, y:0 }, { x:6, y:0 }]);
});
