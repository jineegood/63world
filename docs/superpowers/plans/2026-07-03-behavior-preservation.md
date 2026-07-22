# Behavior Preservation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a documented baseline and repeatable verification checks before any behavior-changing refactor.

**Architecture:** Keep the current runtime files untouched for this phase. Add documentation and Node built-in tests that verify syntax, key HTML contracts, referenced assets, and the existing patch chain.

**Tech Stack:** Static HTML/CSS/JavaScript, Node.js built-in test runner, no npm dependencies.

---

## File Structure

- Create `docs/PROJECT_AUDIT.md`: Korean project audit, risks, online architecture direction, and recommended refactor order.
- Create `package.json`: local script entry points for syntax and baseline checks.
- Create `tests/baseline.test.mjs`: Node built-in tests for current static invariants.
- Do not modify `game.js`, `index.html`, or `style.css` in this phase.

### Task 1: Add Project Audit

**Files:**
- Create: `docs/PROJECT_AUDIT.md`

- [x] **Step 1: Write the audit document**

Document the current structure, verified behavior, risk areas, online architecture direction, and next refactor candidates.

- [x] **Step 2: Keep runtime files unchanged**

Run a file listing and confirm the only runtime files remain `index.html`, `style.css`, and `game.js`.

### Task 2: Add Baseline Test Harness

**Files:**
- Create: `package.json`
- Create: `tests/baseline.test.mjs`
- Create: `tools/run-baseline.ps1`

- [x] **Step 1: Verify RED state**

Run: `node --run test`

Expected: failure because `package.json` does not exist yet.

- [x] **Step 2: Add package scripts**

`package.json` scripts:

```json
{
  "scripts": {
    "check:syntax": "powershell -NoProfile -ExecutionPolicy Bypass -File tools/run-baseline.ps1 check",
    "test:baseline": "powershell -NoProfile -ExecutionPolicy Bypass -File tools/run-baseline.ps1 baseline",
    "test": "powershell -NoProfile -ExecutionPolicy Bypass -File tools/run-baseline.ps1 all"
  }
}
```

- [x] **Step 3: Add baseline tests**

The tests verify:

- required files exist,
- `index.html` keeps the core game DOM contracts,
- referenced assets exist,
- the known v17-v35 patch chain is present,
- core data/function markers still exist in `game.js`.

- [x] **Step 3a: Add a local Node resolver**

`tools/run-baseline.ps1` resolves either a system `node` executable or the Codex bundled Node executable under the user profile, then runs the requested check.

- [x] **Step 4: Verify GREEN state**

Run: `node --run test`

Expected: syntax check passes and all baseline tests pass.

### Task 3: Report Next Safe Refactor

**Files:**
- No runtime file changes.

- [x] **Step 1: Summarize verification evidence**

Report exact commands and results.

- [x] **Step 2: Recommend the next behavior-preserving refactor**

Recommend extracting a data snapshot before changing runtime imports.

### Task 4: Extract Current Data Snapshot and Rebuild Master Workbook

**Files:**
- Create: `data/game-data.snapshot.json`
- Create: `tests/current-data.test.mjs`
- Create: `tools/extract-game-data.mjs`
- Create: `tools/build-current-workbook.mjs`
- Modify: `package.json`
- Modify: `tools/run-baseline.ps1`
- Replace: `시트/육삼빌딩의_세계_게임데이터_마스터_v25.xlsx` with `시트/육삼빌딩의_세계_게임데이터_마스터_v35.xlsx`

- [x] **Step 1: Write failing current data tests**

Run: `node --run test:current-data`

Expected before implementation: FAIL because `data/game-data.snapshot.json` and the v35 workbook do not exist, and the old v25 workbook still exists.

- [x] **Step 2: Generate current data snapshot**

Run: `node --run extract:data`

Expected: `data/game-data.snapshot.json` contains v35 source metadata, classes, levels, items, skills, worlds, quests, workbooks, questions, pets, tiers, and monster samples.

- [x] **Step 3: Build current workbook**

Run: `node --run build:workbook`

Expected: `시트/육삼빌딩의_세계_게임데이터_마스터_v35.xlsx` exists and the old v25 workbook is removed.

- [x] **Step 4: Verify all tests**

Run: `node --run test`

Expected: baseline tests and current-data tests pass.
