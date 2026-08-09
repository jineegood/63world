import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { Script, createContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const modulePath = join(root, 'src', 'world-navigation-registry.js');
const source = existsSync(modulePath) ? readFileSync(modulePath, 'utf8') : '';
const gameSource = readFileSync(join(root, 'game.js'), 'utf8');
const indexSource = readFileSync(join(root, 'index.html'), 'utf8');

function loadFactory() {
  assert.ok(source, 'src/world-navigation-registry.js should exist');
  const context = createContext({ window:{}, Object, Number, String, Set, Error, Array });
  new Script(source, { filename:'src/world-navigation-registry.js' }).runInContext(context);
  return context.window.YuksamWorldNavigationRegistry;
}

test('collider providers use descending priority and stable registration order', () => {
  const events = [];
  const registry = loadFactory().create({ colliderFallback:() => ['fallback'] });
  registry.registerCollider({ id:'low', priority:1, resolve:() => { events.push('low'); return ['low']; } });
  registry.registerCollider({ id:'high-first', priority:10, resolve:() => { events.push('high-first'); return null; } });
  registry.registerCollider({ id:'high-second', priority:10, resolve:() => { events.push('high-second'); return ['winner']; } });

  assert.equal(registry.getColliders({ map:'town' })[0], 'winner');
  assert.deepEqual(events, ['high-first', 'high-second']);
});

test('an empty collider list owns a map and prevents lower providers and fallback', () => {
  const events = [];
  const registry = loadFactory().create({ colliderFallback:() => { events.push('fallback'); return ['fallback']; } });
  registry.registerCollider({ id:'low', priority:1, resolve:() => { events.push('low'); return ['low']; } });
  registry.registerCollider({ id:'exclusive-empty', priority:20, resolve:() => { events.push('exclusive'); return []; } });

  assert.equal(registry.getColliders({ map:'finalBossRoom' }).length, 0);
  assert.deepEqual(events, ['exclusive']);
});

test('collider lookup falls back when providers decline the context', () => {
  const registry = loadFactory().create({ colliderFallback:(context) => [{ type:'fallback', map:context.map }] });
  registry.registerCollider({ id:'decline', resolve:() => undefined });
  const result = registry.getColliders({ map:'forest' });
  assert.equal(result[0].type, 'fallback');
  assert.equal(result[0].map, 'forest');
});

test('transition handlers run once by priority and stop after true', () => {
  const events = [];
  const registry = loadFactory().create({ transitionFallback:() => { events.push('fallback'); return true; } });
  registry.registerTransition({ id:'late', priority:1, handle:() => { events.push('late'); return true; } });
  registry.registerTransition({ id:'observer', priority:10, handle:() => { events.push('observer'); return false; } });
  registry.registerTransition({ id:'owner', priority:5, handle:(context) => { events.push(`owner:${context.map}`); return true; } });

  assert.equal(registry.runTransition({ map:'town' }), true);
  assert.deepEqual(events, ['observer', 'owner:town']);
});

test('registrations reject duplicate ids and unregister cleanly', () => {
  const registry = loadFactory().create({ colliderFallback:() => ['fallback'] });
  const remove = registry.registerCollider({ id:'feature', resolve:() => ['feature'] });
  assert.throws(() => registry.registerTransition({ id:'feature', handle:() => true }), /Duplicate world navigation registration/);
  remove();
  assert.doesNotThrow(() => registry.registerTransition({ id:'feature', handle:() => true }));
  assert.equal(registry.getColliders({})[0], 'fallback');
});

test('registry module is independent from game, DOM, map data, distance, and audio', () => {
  loadFactory();
  assert.doesNotMatch(source, /\bgame\b|\bdocument\b|worldDefs|distance\(|playSfx|\bAudio\b/);
});

test('position guard leaves ordinary walkable movement untouched', () => {
  const player = { x:80, y:90 };
  let writes = 0;
  let collisionChecks = 0;
  const guard = loadFactory().createPositionGuard({
    getMap:() => 'town',
    getPosition:() => player,
    getBounds:() => ({ width:500, height:400, minX:30, minY:40, maxX:470, maxY:360 }),
    isWalkable:() => { collisionChecks += 1; return true; },
    setPosition:() => { writes += 1; },
  });

  const result = guard.reconcile();
  assert.equal(result.recovered, false);
  assert.equal(result.reason, 'safe');
  assert.equal(writes, 0);
  assert.equal(player.x, 80);
  assert.equal(player.y, 90);
  assert.equal(collisionChecks, 1);

  const sameFrameResult = guard.reconcile();
  assert.equal(sameFrameResult.recovered, false);
  assert.equal(writes, 0);
  assert.equal(collisionChecks, 1);
});

test('position guard moves a player embedded in a structure to nearby open ground', () => {
  const player = { x:120, y:120 };
  const blocked = (x, y) => x >= 80 && x <= 160 && y >= 80 && y <= 160;
  const recoveries = [];
  const guard = loadFactory().createPositionGuard({
    getMap:() => 'town',
    getPosition:() => player,
    getBounds:() => ({ width:500, height:400, minX:30, minY:40, maxX:470, maxY:360 }),
    isWalkable:(x, y) => !blocked(x, y),
    setPosition:(position) => Object.assign(player, position),
    onRecover:(event) => recoveries.push(event),
    step:8,
    nearbyRadius:96,
  });

  const result = guard.reconcile({ source:'keyboard' });
  assert.equal(result.recovered, true);
  assert.equal(result.reason, 'nearest');
  assert.equal(blocked(player.x, player.y), false);
  assert.ok(Math.hypot(player.x - 120, player.y - 120) <= 96);
  assert.equal(recoveries.length, 1);
  assert.equal(recoveries[0].source, 'keyboard');
});

test('position guard falls back to the last safe point when a deep teleport is blocked', () => {
  const player = { x:50, y:60 };
  const guard = loadFactory().createPositionGuard({
    getMap:() => 'town',
    getPosition:() => player,
    getBounds:() => ({ width:600, height:500, minX:30, minY:40, maxX:570, maxY:460 }),
    isWalkable:(x, y) => !(x >= 100 && x <= 500 && y >= 100 && y <= 400),
    setPosition:(position) => Object.assign(player, position),
    step:8,
    nearbyRadius:48,
  });

  guard.reconcile();
  player.x = 300;
  player.y = 250;
  const result = guard.reconcile({ source:'portal' });
  assert.equal(result.recovered, true);
  assert.equal(result.reason, 'last-safe');
  assert.equal(player.x, 50);
  assert.equal(player.y, 60);
});

test('position guard uses the current map spawn when a saved coordinate is invalid', () => {
  const player = { x:Number.NaN, y:Number.POSITIVE_INFINITY };
  const guard = loadFactory().createPositionGuard({
    getMap:() => 'forest',
    getPosition:() => player,
    getBounds:() => ({ width:800, height:600, minX:30, minY:40, maxX:770, maxY:560 }),
    isWalkable:() => true,
    getFallback:() => ({ x:90, y:520 }),
    setPosition:(position) => Object.assign(player, position),
  });

  const result = guard.reconcile({ source:'load' });
  assert.equal(result.recovered, true);
  assert.equal(result.reason, 'fallback');
  assert.equal(player.x, 90);
  assert.equal(player.y, 520);
});

test('game runs the position guard before keyboard and click movement and on character load', () => {
  assert.match(gameSource, /YuksamWorldNavigationRegistry\.createPositionGuard\(/);
  assert.match(gameSource, /function updateV17\(dt\) \{[\s\S]{0,240}reconcileWorldPlayerPositionV1\('update'\);[\s\S]{0,700}clickMovementControllerV1\.update\(/);
  assert.match(gameSource, /reconcileWorldPlayerPositionV1\('start-game'\);\s*resetForestMonsters/);
  assert.match(gameSource, /window\.cancelClickMovementV1\?\.\(\{ clearArrivalLock:true \}\)/);
});

test('real browser preserves collider, movement, and transition behavior', { timeout:30000 }, () => {
  const script = join(root, 'tools', 'browser-smoke', 'try_world_navigation.js');
  const result = spawnSync(process.execPath, [script, root], { encoding:'utf8', timeout:25000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  // 63빌딩 던전이 빌딩 본체와 원로 명진 충돌을 더해 19개 → 21개가 되었다.
  assert.match(result.stdout, /PASS: town keeps twenty-one unique collision shapes/);
  assert.match(result.stdout, /PASS: town includes 63 tower collider/);
  assert.match(result.stdout, /PASS: town includes raid elder collider/);
  assert.match(result.stdout, /PASS: boss ellipse rejects outside movement/);
  assert.match(result.stdout, /PASS: equipment exit returns beside its town door/);
  assert.match(result.stdout, /PASS: final room suppresses all automatic transitions/);
  // 63빌딩 던전 충돌 검사 2개가 늘어 30개 → 32개가 되었다.
  assert.match(result.stdout, /RESULT: PASS 37 \/ FAIL 0/);
});

test('production uses one navigation boundary without versioned wrappers', () => {
  assert.match(indexSource, /src\/world-navigation-registry\.js[\s\S]*game\.js/);
  assert.equal((gameSource.match(/YuksamWorldNavigationRegistry\.create\(/g) || []).length, 1);
  assert.match(gameSource, /function getCurrentMapColliders\(\) \{\s*return worldNavigationRegistry\.getColliders\(/);
  assert.match(gameSource, /function checkAutoTransitions\(\) \{\s*worldNavigationRegistry\.runTransition\(/);
  assert.doesNotMatch(gameSource, /getCurrentMapColliders\s*=\s*function\s+getCurrentMapCollidersV\d+/);
  assert.doesNotMatch(gameSource, /checkAutoTransitions\s*=\s*function\s+checkAutoTransitionsV\d+/);
  assert.doesNotMatch(gameSource, /canPlayerMoveTo\s*=\s*function\s+canPlayerMoveToV\d+/);
  assert.doesNotMatch(gameSource, /oldGetCurrentMapCollidersV?\d*|oldCheckAutoTransitionsV\d+|oldCanPlayerMoveToV\d+/);
});
