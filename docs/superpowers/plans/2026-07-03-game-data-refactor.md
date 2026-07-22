# Game Data Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the first gameplay data tables out of `game.js` into `src/game-data.js` while preserving the current local file workflow and gameplay behavior.

**Architecture:** Keep browser globals for now. Load `src/core-utils.js`, then `src/game-data.js`, then `game.js`. `src/game-data.js` exposes mutable data objects through `window.YuksamData` because later patch blocks still extend and edit those objects.

**Tech Stack:** Static HTML/CSS/JavaScript, browser globals, Node.js built-in test runner, existing VM-based data extraction.

---

## File Structure

- Create `src/game-data.js`: owns the first data tables currently at the top of `game.js`.
- Create `tests/game-data.test.mjs`: verifies script order, exported data shape, and `game.js` wiring.
- Modify `index.html`: load `src/game-data.js` between `src/core-utils.js` and `game.js`.
- Modify `game.js`: read data tables from `window.YuksamData` and remove the duplicated local table declarations.
- Modify `tools/extract-game-data.mjs`: execute `src/game-data.js` before `game.js` in the VM extractor.
- Modify `tools/run-baseline.ps1`: include the new test in `all` mode and add `game-data` mode.
- Modify `package.json`: add `test:game-data`.
- Create `docs/VIBE_CODING_GUIDE.md`: simple Korean guide for future bug fixes and updates.
- Modify `docs/PROJECT_AUDIT.md`: record that game data has started moving into `src/`.

### Task 1: Add Data Split Tests

**Files:**
- Create: `tests/game-data.test.mjs`
- Modify: `package.json`
- Modify: `tools/run-baseline.ps1`

- [x] **Step 1: Write failing tests**

Add tests that assert:

```js
assert.equal(existsSync(join(root, 'src', 'game-data.js')), true);
assert.ok(coreScriptIndex > -1);
assert.ok(dataScriptIndex > coreScriptIndex);
assert.ok(gameScriptIndex > dataScriptIndex);
assert.match(gameJs, /const YuksamData = window\.YuksamData;/);
assert.doesNotMatch(gameJs, /const CLASS_META = \{/);
```

- [x] **Step 2: Verify RED**

Run: `node --run test:game-data`

Expected: FAIL because `src/game-data.js` does not exist and `game.js` still owns those data declarations.

### Task 2: Extract Initial Game Data Tables

**Files:**
- Create: `src/game-data.js`
- Modify: `index.html`
- Modify: `game.js`

- [x] **Step 1: Create `src/game-data.js`**

Move these top-level data tables from `game.js` into a browser-global module:

```js
CLASS_META
XP_REQUIREMENTS
PLAYER_WORLD_SCALE
NPC_WORLD_SCALE
STORAGE
ITEM_DEFS
BUILDING_ITEM_DEFS
SKILL_DEFS
SKILL_LINES
defaultQuestions
defaultWorkbooks
appearancePools
worldDefs
```

The module must expose them as:

```js
global.YuksamData = {
  CLASS_META,
  XP_REQUIREMENTS,
  PLAYER_WORLD_SCALE,
  NPC_WORLD_SCALE,
  STORAGE,
  ITEM_DEFS,
  BUILDING_ITEM_DEFS,
  SKILL_DEFS,
  SKILL_LINES,
  defaultQuestions,
  defaultWorkbooks,
  appearancePools,
  worldDefs,
};
```

- [x] **Step 2: Wire script order**

In `index.html`, load files in this order:

```html
<script src="src/core-utils.js"></script>
<script src="src/game-data.js"></script>
<script src="game.js"></script>
```

- [x] **Step 3: Wire `game.js`**

Near the top of `game.js`, add:

```js
const YuksamData = window.YuksamData;
if (!YuksamData) throw new Error('YuksamData must be loaded before game.js');
const {
  CLASS_META,
  XP_REQUIREMENTS,
  PLAYER_WORLD_SCALE,
  NPC_WORLD_SCALE,
  STORAGE,
  ITEM_DEFS,
  BUILDING_ITEM_DEFS,
  SKILL_DEFS,
  SKILL_LINES,
  defaultQuestions,
  defaultWorkbooks,
  appearancePools,
  worldDefs,
} = YuksamData;
```

Then remove the duplicated local declarations from `game.js`.

- [x] **Step 4: Verify GREEN**

Run: `node --run test:game-data`

Expected: PASS with the new data module contract.

### Task 3: Keep Existing Baselines Green

**Files:**
- Modify: `tools/extract-game-data.mjs`

- [x] **Step 1: Load game data in the extractor**

After `src/core-utils.js` and before `game.js`, execute `src/game-data.js` inside the same VM context.

- [x] **Step 2: Verify data extraction**

Run: `node --run extract:data`

Expected: `data/game-data.snapshot.json` regenerates from v35 source without losing classes, worlds, items, skills, pets, tiers, questions, or workbooks.

- [x] **Step 3: Verify all tests**

Run: `node --run test`

Expected: baseline, core utility, game data, and current-data tests pass.

### Task 4: Add Non-Developer Update Guide

**Files:**
- Create: `docs/VIBE_CODING_GUIDE.md`

- [x] **Step 1: Write the guide**

Create a concise Korean guide explaining:

- which files are safe to touch first,
- what to avoid touching casually,
- what command to run after each change,
- how to describe future bug reports to Codex.

- [x] **Step 2: Update the project audit**

Record `src/game-data.js` and `docs/VIBE_CODING_GUIDE.md` in `docs/PROJECT_AUDIT.md`.

### Task 5: Mark Plan Complete

**Files:**
- Modify: `docs/superpowers/plans/2026-07-03-game-data-refactor.md`

- [x] **Step 1: Mark completed checklist items**

After verification evidence is available, mark each completed step with `[x]`.
