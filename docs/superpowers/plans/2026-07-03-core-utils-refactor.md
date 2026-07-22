# Core Utils Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the pure shared utility functions from `game.js` into a small browser global module without changing gameplay behavior.

**Architecture:** Add `src/core-utils.js` as a browser script that attaches `window.YuksamCore`. Load it before `game.js`, then make `game.js` consume the exported helpers. Keep the existing static script model so the local file workflow remains unchanged.

**Tech Stack:** Static HTML/CSS/JavaScript, browser globals, Node.js built-in test runner, existing VM-based data extraction.

---

## File Structure

- Create `src/core-utils.js`: owns `uid`, `randomFrom`, `randomInt`, `clamp`, `distance`, `normalize`, `escapeHtml`, and `fmtDate`.
- Create `tests/core-utils.test.mjs`: verifies the new module contract, script load order, and `game.js` wiring.
- Modify `index.html`: load `src/core-utils.js` before `game.js`.
- Modify `game.js`: import helpers from `window.YuksamCore` and remove the duplicated local helper implementations.
- Modify `tools/extract-game-data.mjs`: execute `src/core-utils.js` before `game.js` in the VM baseline extractor.
- Modify `tools/run-baseline.ps1`: include the new test in `all` mode and add `core-utils` mode.
- Modify `package.json`: add `test:core-utils`.
- Modify `docs/PROJECT_AUDIT.md`: record that the first behavior-preserving split has started.

### Task 1: Add Utility Split Tests

**Files:**
- Create: `tests/core-utils.test.mjs`
- Modify: `package.json`
- Modify: `tools/run-baseline.ps1`

- [x] **Step 1: Write failing tests**

Add tests that assert:

```js
assert.equal(existsSync(join(root, 'src', 'core-utils.js')), true);
assert.ok(indexOfCoreScript > -1);
assert.ok(indexOfGameScript > indexOfCoreScript);
assert.match(gameJs, /const YuksamCore = window\.YuksamCore;/);
assert.doesNotMatch(gameJs, /function clamp\(v, min, max\)/);
```

- [x] **Step 2: Verify RED**

Run: `node --run test:core-utils`

Expected: FAIL because `src/core-utils.js` does not exist and `index.html` still loads only `game.js`.

### Task 2: Extract Core Utilities

**Files:**
- Create: `src/core-utils.js`
- Modify: `index.html`
- Modify: `game.js`

- [x] **Step 1: Create `src/core-utils.js`**

Implement a browser-global module:

```js
(function initYuksamCore(global) {
  function uid() {
    if (global.crypto?.randomUUID) return global.crypto.randomUUID();
    return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function randomFrom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function randomInt(min, max) { return Math.floor(min + Math.random() * (max - min + 1)); }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function normalize(v) { return String(v ?? '').trim().replace(/\s+/g, '').toLowerCase(); }
  function escapeHtml(v) {
    return String(v).replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[ch]));
  }
  function fmtDate(ts) {
    try { return new Date(ts).toLocaleString('ko-KR'); } catch { return '-'; }
  }

  global.YuksamCore = Object.freeze({ uid, randomFrom, randomInt, clamp, distance, normalize, escapeHtml, fmtDate });
})(window);
```

- [x] **Step 2: Wire script order**

In `index.html`, replace:

```html
<script src="game.js"></script>
```

with:

```html
<script src="src/core-utils.js"></script>
<script src="game.js"></script>
```

- [x] **Step 3: Wire `game.js`**

Near the top of `game.js`, add:

```js
const YuksamCore = window.YuksamCore;
if (!YuksamCore) throw new Error('YuksamCore must be loaded before game.js');
const { uid, randomFrom, randomInt, clamp, distance, normalize, escapeHtml, fmtDate } = YuksamCore;
```

Then remove the old local implementations of those functions.

- [x] **Step 4: Verify GREEN**

Run: `node --run test:core-utils`

Expected: PASS with the new module contract.

### Task 3: Keep Existing Baselines Green

**Files:**
- Modify: `tools/extract-game-data.mjs`

- [x] **Step 1: Load core utils in the extractor**

Before executing `game.js`, execute `src/core-utils.js` inside the same VM context.

- [x] **Step 2: Verify syntax and data extraction**

Run: `node --run extract:data`

Expected: `data/game-data.snapshot.json` regenerates from v35 source without changing captured counts.

- [x] **Step 3: Verify all tests**

Run: `node --run test`

Expected: baseline tests, current data tests, and core utility tests pass.

### Task 4: Update Project Notes

**Files:**
- Modify: `docs/PROJECT_AUDIT.md`
- Modify: `docs/superpowers/plans/2026-07-03-core-utils-refactor.md`

- [x] **Step 1: Record the split**

Add a short note that `src/core-utils.js` is the first extracted runtime module and that future splits should follow this script-order plus baseline-test pattern.

- [x] **Step 2: Mark completed checklist items**

Mark completed steps in this plan after verification evidence is available.
