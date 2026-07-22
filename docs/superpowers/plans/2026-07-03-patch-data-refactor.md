# Patch Data Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move late patch data for pets and weapon enhancement tiers out of `game.js` into `src/patch-data.js` while preserving behavior.

**Architecture:** Keep browser globals. Load `src/patch-data.js` after `src/game-data.js` and before `game.js`. `game.js` consumes mutable data through `window.YuksamPatchData` because later patch blocks still edit pet definitions.

**Tech Stack:** Static HTML/CSS/JavaScript, browser globals, Node.js built-in test runner, existing VM-based data extraction.

---

## File Structure

- Create `src/patch-data.js`: owns `PET_DEFS_V27` and `TIER_INFO_V27`.
- Create `tests/patch-data.test.mjs`: verifies script order, exported data shape, and `game.js` wiring.
- Modify `index.html`: load `src/patch-data.js` between `src/game-data.js` and `game.js`.
- Modify `game.js`: read pet/enhancement data from `window.YuksamPatchData`.
- Modify `tools/extract-game-data.mjs`: execute `src/patch-data.js` before `game.js`.
- Modify `tools/run-baseline.ps1`: include the new test in `all` mode and add `patch-data` mode.
- Modify `package.json`: add `test:patch-data`.
- Modify `docs/PROJECT_AUDIT.md` and `docs/VIBE_CODING_GUIDE.md`: record the new file.

### Task 1: Add Patch Data Tests

**Files:**
- Create: `tests/patch-data.test.mjs`
- Modify: `package.json`
- Modify: `tools/run-baseline.ps1`

- [x] **Step 1: Write failing tests**

Verify that `src/patch-data.js` exists, loads before `game.js`, exposes pet/tier tables, and `game.js` no longer declares the tables directly.

- [x] **Step 2: Verify RED**

Run: `node --run test:patch-data`

Expected: FAIL because `src/patch-data.js` does not exist yet.

### Task 2: Extract Pet And Enhancement Data

**Files:**
- Create: `src/patch-data.js`
- Modify: `index.html`
- Modify: `game.js`
- Modify: `tools/extract-game-data.mjs`

- [x] **Step 1: Create `src/patch-data.js`**

Move `PET_DEFS_V27` and `TIER_INFO_V27` into `window.YuksamPatchData`.

- [x] **Step 2: Wire script order**

Load scripts in this order:

```html
<script src="src/core-utils.js"></script>
<script src="src/game-data.js"></script>
<script src="src/patch-data.js"></script>
<script src="game.js"></script>
```

- [x] **Step 3: Wire `game.js`**

Inside the v27 patch, read:

```js
const YuksamPatchData = window.YuksamPatchData;
const PET_DEFS_V27 = YuksamPatchData.PET_DEFS_V27;
const TIER_INFO_V27 = YuksamPatchData.TIER_INFO_V27;
```

- [x] **Step 4: Verify GREEN**

Run: `node --run test:patch-data`

Expected: PASS.

### Task 3: Verify Existing Behavior

**Files:**
- Modify: `docs/superpowers/plans/2026-07-03-patch-data-refactor.md`

- [x] **Step 1: Regenerate snapshot**

Run: `node --run extract:data`

Expected: snapshot still captures pets and tiers.

- [x] **Step 2: Run full tests**

Run: `node --run test`

Expected: all tests pass.

- [x] **Step 3: Mark completed checklist items**

Mark this plan complete after verification.
