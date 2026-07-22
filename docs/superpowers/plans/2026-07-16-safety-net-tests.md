# Safety-Net Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic automated coverage for player persistence, administrator rewards, boot, final-boss combat, and keyboard routing without changing gameplay behavior.

**Architecture:** Reuse the shared jsdom browser harness so tests exercise the actual script load order and localStorage implementation. Connect focused smoke programs through one Node test file and the existing PowerShell baseline runner.

**Tech Stack:** Node test runner, jsdom shared harness, PowerShell baseline runner.

## Global Constraints

- Do not modify production runtime or balance data in this package.
- Make random combat deterministic inside tests only.
- Wait on observable combat state instead of fixed log timing where possible.
- Preserve the existing login/storage key when administrator rewards update a player.
- This directory is not a Git repository, so commits are omitted.

---

### Task 1: Player Persistence and Administrator Reward Smoke

**Files:**
- Create: `tools/browser-smoke/try_player_storage.js`
- Create: `tests/safety-net.test.mjs`

- [ ] Add a smoke that creates, saves, reloads, lists, and deletes one player and returns `null` for corrupted JSON.
- [ ] Verify administrator reward persistence changes gold/building/EXP without creating a second player key or changing the stored name.
- [ ] Add a Node test that spawns the smoke and fails with its complete output.

### Task 2: Repair Deterministic Boot and Final-Boss Smokes

**Files:**
- Modify: `tools/browser-smoke/boot_test.js`
- Modify: `tools/browser-smoke/try_final_boss.js`
- Modify: `tests/safety-net.test.mjs`

- [ ] Replace the boot script's hard-coded path and direct jsdom import with `harness.js`.
- [ ] Assert all index scripts load, required controls exist, and no asynchronous errors occur.
- [ ] Set final-boss combat randomness to a non-miss value after combat opens.
- [ ] Poll until the player hit is applied or the combat queue finishes, then assert boss HP decreased.
- [ ] Spawn both smokes from the safety-net test.

### Task 3: Connect Existing Keyboard Routing Smoke

**Files:**
- Modify: `tests/safety-net.test.mjs`

- [ ] Spawn `try_combat_keys.js` and require its existing 14 routing checks to pass.
- [ ] Preserve its exact-one-click assertion for the combat `E` key.

### Task 4: Baseline Integration and Verification

**Files:**
- Modify: `tools/run-baseline.ps1`
- Modify: `package.json`

- [ ] Add a `safety-net` runner mode and include it in `all`.
- [ ] Add `npm.cmd run test:safety-net`.
- [ ] Run the safety-net test repeatedly to confirm final-boss determinism.
- [ ] Run `npm.cmd test` and confirm all existing and new tests pass.
- [ ] Recompute production runtime hashes and confirm this test-only package changed none of them.
