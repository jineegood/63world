# Click-to-Move Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let players use 왼쪽 클릭 on walkable world ground to move there automatically without crossing existing colliders, while preserving keyboard control and all current transitions.

**Architecture:** Add a pure grid path planner and path follower in a focused browser-global module. `game.js` supplies current map bounds, the existing collider registry, player position, and cancellation events; the new module knows nothing about DOM, game state, portals, or storage.

**Tech Stack:** Browser JavaScript, Canvas 2D, A* grid search, Node.js test runner

## Global Constraints

- Left click moves only while the game screen is active, no modal pauses the game, and no combat is active.
- UI, modal, button, chat, input, and non-canvas clicks never become movement.
- Existing WASD or arrow input cancels automatic movement immediately.
- Combat, modal open, map transition, logout, and a replacement click cancel the current route.
- Use the existing `worldNavigationRegistry` collider result; never duplicate map obstacle data.
- Do not automatically activate doors, portals, or cross map boundaries.
- Render a short blue destination marker.

---

### Task 1: Pure A* Path Planner

**Files:**
- Create: `src/click-movement.js`
- Create: `tests/click-movement.test.mjs`
- Modify: `index.html`
- Modify: `tools/run-baseline.ps1`
- Modify: `package.json`

**Interfaces:**
- Produces:
  - `YuksamClickMovement.planPath({ start, target, bounds, colliders, radius, cellSize }): Point[]`
  - `YuksamClickMovement.advance({ position, path, speed }): { position, path, moving, direction }`
  - `YuksamClickMovement.isWalkable(point, context): boolean`
- `Point` is `{ x:number, y:number }`.
- `bounds` is `{ width:number, height:number }`.
- `radius` is one finite positive number and defaults to `30`.

- [ ] **Step 1: Write failing path and follower tests**

Create `tests/click-movement.test.mjs` and load the module with `vm.runInNewContext`. Cover:

```js
test('planner reaches open ground and avoids circle and rect colliders', () => {
  const api = loadApi();
  const path = api.planPath({
    start:{ x:60, y:60 },
    target:{ x:340, y:60 },
    bounds:{ width:400, height:240 },
    radius:30,
    cellSize:20,
    colliders:[
      { type:'rect', x:200, y:60, w:80, h:80 },
      { type:'circle', x:280, y:150, r:25 },
    ],
  });
  assert.ok(path.length > 2);
  assert.ok(Math.hypot(path.at(-1).x - 340, path.at(-1).y - 60) <= 30);
  for (const point of path) {
    assert.equal(api.isWalkable(point, {
      bounds:{ width:400, height:240 },
      radius:30,
      colliders:[{ type:'rect', x:200, y:60, w:80, h:80 }, { type:'circle', x:280, y:150, r:25 }],
    }), true);
  }
});
```

Also assert that a blocked target is moved to the nearest reachable cell, an enclosed target returns `[]`, output coordinates remain inside bounds, diagonal corner cutting is rejected, path smoothing never crosses a collider, and `advance` stops exactly at the final waypoint without overshoot.

- [ ] **Step 2: Run the focused test and verify failure**

```powershell
node --test tests/click-movement.test.mjs
```

Expected: FAIL because `src/click-movement.js` does not exist.

- [ ] **Step 3: Implement collision expansion and grid search**

Implement `isWalkable` by expanding each collider with the player radius:

```js
function hits(point, collider, radius) {
  if (collider.type === 'circle') {
    return Math.hypot(point.x - collider.x, point.y - collider.y) < radius + Number(collider.r || 0);
  }
  if (collider.type === 'rect') {
    const left = collider.x - collider.w / 2;
    const right = collider.x + collider.w / 2;
    const top = collider.y - collider.h / 2;
    const bottom = collider.y + collider.h / 2;
    const nearestX = Math.max(left, Math.min(right, point.x));
    const nearestY = Math.max(top, Math.min(bottom, point.y));
    return Math.hypot(point.x - nearestX, point.y - nearestY) < radius;
  }
  return false;
}
```

Use an eight-neighbor A* grid. Reject a diagonal step when either adjacent cardinal cell is blocked. Limit the search to `25,000` visited nodes and return `[]` on exhaustion. Search outward from a blocked target for the nearest walkable grid cell before A*.

- [ ] **Step 4: Implement collision-safe path smoothing and movement**

Use samples no farther apart than `radius / 2` to verify a straight segment:

```js
function segmentWalkable(a, b, context) {
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  const count = Math.max(1, Math.ceil(distance / Math.max(4, context.radius / 2)));
  for (let index = 0; index <= count; index += 1) {
    const ratio = index / count;
    if (!isWalkable({
      x:a.x + (b.x - a.x) * ratio,
      y:a.y + (b.y - a.y) * ratio,
    }, context)) return false;
  }
  return true;
}
```

`advance` consumes waypoints while the available `speed` remains, returns a new frozen position/path result, and reports the last non-zero normalized direction.

- [ ] **Step 5: Load the module and register its tests**

Load `<script src="src/click-movement.js"></script>` after `src/world-navigation-registry.js` and before `game.js`.

Add syntax checking and the `click-movement` mode to `tools/run-baseline.ps1`; add:

```json
"test:click-movement": "powershell -NoProfile -ExecutionPolicy Bypass -File tools/run-baseline.ps1 click-movement"
```

- [ ] **Step 6: Run focused tests and commit**

```powershell
npm.cmd run test:click-movement
npm.cmd run test:baseline
git add -- src/click-movement.js tests/click-movement.test.mjs index.html tools/run-baseline.ps1 package.json
git commit -m "feat: add collision-aware click path planning"
```

Expected: Test commands exit `0`.

### Task 2: Game Input, Following, Cancellation, and Marker

**Files:**
- Modify: `game.js`
- Create: `tests/click-movement-integration.test.mjs`
- Modify: `tools/run-baseline.ps1`
- Modify: `package.json`

**Interfaces:**
- Consumes: `YuksamClickMovement.planPath` and `YuksamClickMovement.advance`.
- Produces:
  - `window.cancelClickMovementV1(): void`
  - `game.clickMovement = { map, path, target, markerUntil } | null`

- [ ] **Step 1: Write failing source-contract and browser integration tests**

Create `tests/click-movement-integration.test.mjs`. Assert that production:

```js
assert.match(gameSource, /gameCanvas.*addEventListener\('pointerdown'/s);
assert.match(gameSource, /event\.button\s*!==\s*0/);
assert.match(gameSource, /game\.camera\.x/);
assert.match(gameSource, /getCurrentMapColliders\(\)/);
assert.match(gameSource, /YuksamClickMovement\.planPath/);
assert.match(gameSource, /cancelClickMovementV1/);
assert.match(gameSource, /YuksamClickMovement\.advance/);
assert.match(gameSource, /click-move-target-v1/);
```

Use the existing jsdom browser harness to click canvas ground, run one update tick, and verify position changes. Then dispatch `keydown` with `w` and verify the route becomes `null`. Open a paused modal and verify a later canvas click does not create a route.

- [ ] **Step 2: Run integration tests and verify failure**

```powershell
node --test tests/click-movement-integration.test.mjs
```

Expected: FAIL because the game has no pointer route or marker.

- [ ] **Step 3: Add the canvas pointer adapter**

In the existing binding section of `game.js`:

```js
  game.canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !game.player || !screens.game.classList.contains('active')) return;
    if (isPaused() || game.currentCombatMonsterId) return;
    const rect = game.canvas.getBoundingClientRect();
    const scaleX = game.canvas.width / rect.width;
    const scaleY = game.canvas.height / rect.height;
    const target = {
      x:(event.clientX - rect.left) * scaleX + game.camera.x,
      y:(event.clientY - rect.top) * scaleY + game.camera.y,
    };
    const world = worldDefs[game.currentMap];
    const path = YuksamClickMovement.planPath({
      start:{ x:game.player.x, y:game.player.y },
      target,
      bounds:{ width:world.width, height:world.height },
      colliders:getCurrentMapColliders(),
      radius:30,
      cellSize:32,
    });
    game.clickMovement = path.length
      ? { map:game.currentMap, path, target:path.at(-1), markerUntil:Date.now() + 850 }
      : null;
  });
```

Clicks outside the canvas never reach this handler, which keeps modal and chat clicks isolated.

- [ ] **Step 4: Follow the path through the canonical update loop**

Before keyboard deltas are applied in `update(dt)`, cancel when any movement key is active. When no key is active and a route exists on the current map, call:

```js
const moved = YuksamClickMovement.advance({
  position:{ x:game.player.x, y:game.player.y },
  path:game.clickMovement.path,
  speed:3.2 * Math.min(dt / 16.67, 2),
});
```

Before accepting `moved.position`, validate both axes through `canPlayerMoveTo`, update `lastMove`, `isMoving`, route, and throttled position saving. If runtime collision validation fails, cancel instead of forcing the point.

Expose:

```js
window.cancelClickMovementV1 = function cancelClickMovementV1() {
  game.clickMovement = null;
};
```

Call it from `openModal`, `openCombat`, map-changing functions, logout, and any keyboard movement branch.

- [ ] **Step 5: Draw the destination marker**

At the end of each world render, while `markerUntil > Date.now()` and the route map matches:

```js
const marker = worldToScreen(game.clickMovement.target.x, game.clickMovement.target.y);
ctx.save();
ctx.strokeStyle = 'rgba(96,165,250,.95)';
ctx.lineWidth = 4;
ctx.beginPath();
ctx.arc(marker.x, marker.y, 13, 0, Math.PI * 2);
ctx.stroke();
ctx.restore();
```

Add a `click-move-target-v1` source marker comment so the contract test can locate the render block. Do not create a DOM overlay that can intercept pointer input.

- [ ] **Step 6: Register, run, and commit**

Add the `click-movement-integration` runner mode and package script, then run:

```powershell
npm.cmd run test:click-movement
npm.cmd run test:click-movement-integration
npm.cmd run test:world-navigation-registry
npm.cmd run test:safety-net
git add -- game.js tests/click-movement-integration.test.mjs tools/run-baseline.ps1 package.json
git commit -m "feat: connect click movement to the world"
```

Expected: Every command exits `0`.
