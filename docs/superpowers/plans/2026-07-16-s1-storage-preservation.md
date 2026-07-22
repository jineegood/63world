# S1 Storage Preservation Implementation Plan

> **Status correction (2026-07-16): HISTORICAL PARTIAL PLAN — DO NOT RE-RUN ITS UNCHECKED TASKS.** The pet/direct-read work is already applied. Its tests seed corrupt workbook data after script boot and miss `ensureSwampWorkbook()` overwriting it during initialization. Create a new plan from `docs/HANDOFF-2026-07-16.md` instead.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve pet data through every player normalization path and prevent corrupt workbook JSON from being overwritten by a read.

**Architecture:** Keep both fixes at their existing normalization boundaries in `game.js`. Extend the real browser storage smoke so the tests cover the actual script order, localStorage, and administrator reward path.

**Tech Stack:** Browser JavaScript, jsdom smoke harness, Node test runner, PowerShell baseline runner.

## Global Constraints

- Do not change gameplay, balance, audio, combat, UI, assets, spreadsheets, storage keys, or administrator behavior beyond preserving existing pet fields.
- A present corrupt or non-array workbook value must remain byte-for-byte unchanged after `getWorkbooks()`.
- An absent workbook value must retain the existing legacy migration and default initialization behavior.
- Use a failing test before each production change and observe the expected failure.
- This directory is not a usable Git repository, so commits are omitted.

---

### Task 1: Preserve Player Pet Fields

**Files:**
- Modify: `tools/browser-smoke/try_player_storage.js`
- Modify: `game.js:328-387`

**Interfaces:**
- Consumes: existing `normalizePlayer(p)`, `loadPlayer(name)`, `savePlayer()`, and `window.adminGrantReward(name)`
- Produces: normalized player records with `pets:Array` and `activePet:string|null`

- [ ] Add smoke assertions that seed a saved player with `pets:['owl']` and `activePet:'owl'`, then require both fields after `loadPlayer()`, after `savePlayer()`, and after administrator reward persistence.
- [ ] Run `node tools/browser-smoke/try_player_storage.js` and verify failure because the fields disappear.
- [ ] Add `pets:Array.isArray(p.pets) ? p.pets : []` and `activePet:typeof p.activePet === 'string' ? p.activePet : null` to `normalizePlayer()`.
- [ ] Re-run the smoke and verify every pet preservation assertion passes.

### Task 2: Make Corrupt Workbook Reads Non-Destructive

**Files:**
- Modify: `tools/browser-smoke/try_player_storage.js`
- Modify: `game.js:253-283`

**Interfaces:**
- Consumes: existing `getWorkbooks()` and `STORAGE.workbooks`
- Produces: normalized workbook arrays without mutating a present invalid storage value

- [ ] Add smoke assertions that store the exact string `'{broken-json'`, call `getWorkbooks()`, require a usable non-empty returned array, and require the stored string to remain exactly unchanged. Also verify that removing the key still initializes and persists defaults.
- [ ] Run `node tools/browser-smoke/try_player_storage.js` and verify failure because the corrupt string is overwritten.
- [ ] Change `getWorkbooks()` so a present invalid/non-array value returns `defaultWorkbooks.map(normalizeWorkbook)` immediately without `setItem`; retain the existing migration and persisted initialization only when the current key is absent.
- [ ] Re-run the smoke and verify corrupt data remains unchanged and first-run initialization still persists.

### Task 3: Package Verification

**Files:**
- No production changes

**Interfaces:**
- Consumes: the two completed fixes
- Produces: verification evidence and changed-file scope

- [ ] Run `node --check game.js`.
- [ ] Run `node --test tests/safety-net.test.mjs`.
- [ ] Run `npm.cmd test` and record the exact pass count.
- [ ] Compare runtime paths and hashes against the audit manifest; confirm the only production runtime change is `game.js` and that no data, assets, spreadsheets, styles, audio, combat rules, or administrator files changed.
- [ ] Stop before starting the audio dispatcher package and report the result.
