# Per-Hit Miss and Combat Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add independent per-hit misses and align Double Attack audio, floating damage presentation, and Block Training shield timing with their visible logs.

**Architecture:** Put deterministic hit-roll helpers in `src/combat-rules.js`, calculate each hit result once in `game.js`, and serialize that result into the existing combat event queue. Keep all state mutations inside typed queue effects so visual logs, sound, and gameplay state remain synchronized.

**Tech Stack:** Browser JavaScript, DOM/CSS animation, Node test runner, jsdom browser-smoke harness.

## Global Constraints

- Every hostile player and monster hit independently misses with 10% probability.
- Holy Priest monster miss chance adds to the universal 10% chance and is capped at 100%.
- Support skills never miss.
- A missed hit deals no damage, cannot critically hit, and triggers no hit-dependent effect.
- The queue reuses a stored hit result and never rerolls.

---

### Task 1: Per-Hit Miss Rules

**Files:**
- Modify: `src/combat-rules.js`
- Test: `tests/combat-rules.test.mjs`

**Interfaces:**
- Produces: `rollHostileHit(missChance, roll): { missed:boolean }`
- Produces: `combinedMonsterMissChance(skillChance): number`

- [ ] Add failing tests proving rolls below `0.10` miss, rolls at `0.10` hit, and priest bonus adds to `0.10` with a `1.0` cap.
- [ ] Run `node --test tests/combat-rules.test.mjs` and confirm the new tests fail because the helpers do not exist.
- [ ] Implement the two pure helpers and export them from `YuksamCombatRules`.
- [ ] Rerun the focused test and confirm it passes.

### Task 2: Player and Monster Event Integration

**Files:**
- Modify: `game.js`
- Test: `tests/combat-flow.test.mjs`
- Modify: `tools/browser-smoke/try_combat_event_timing.js`

**Interfaces:**
- Consumes: `rollHostileHit` and `combinedMonsterMissChance` from Task 1.
- Produces: hit records shaped as `{ dmg, crit, missed, label }` and queued miss notices with `audioId:'miss'`.

- [ ] Add failing source and browser-smoke assertions for mixed hit/miss multi-hit actions, no damage from missed hits, and additive monster miss chance.
- [ ] Run the focused combat-flow test and verify the new assertions fail for missing behavior.
- [ ] Roll once inside each player `rollHit`, store `missed`, force `dmg:0` and `crit:false`, and build a visible miss event instead of a damage effect.
- [ ] Roll each monster hit independently before queue construction; preserve faith-specific text when its bonus portion caused the miss.
- [ ] Ensure hit-dependent chill, stun, shadow, healing, and total-damage calculations use only successful hits.
- [ ] Rerun focused combat-flow and browser-smoke tests.

### Task 3: Double Attack Audio

**Files:**
- Modify: `game.js`
- Test: `tests/combat-flow.test.mjs`

**Interfaces:**
- Consumes: class basic audio IDs from `YuksamAudioManifest.classBasicSounds`.

- [ ] Add a failing assertion that a successful `더블 어택` follow-up event carries the class basic audio ID and a missed follow-up carries `miss`.
- [ ] Run the focused test and verify failure.
- [ ] Attach the class basic audio ID to the successful second hit and `miss` to missed hit events without changing the first-hit audio.
- [ ] Rerun the focused test and verify one sound per displayed hit.

### Task 4: Floating Damage Motion and Typography

**Files:**
- Modify: `game.js`
- Modify: `style.css`
- Test: `tests/combat-flow.test.mjs`

**Interfaces:**
- Produces target classes that select opposite diagonal travel directions.

- [ ] Add failing assertions for a 1.2-second lifetime, upper-side placement, opposite diagonal transforms, bold font, dark stroke, and shadow.
- [ ] Run the focused test and verify failure.
- [ ] Position numbers beside the actor's upper body, add target-specific start offsets, and extend cleanup to approximately 1200ms.
- [ ] Update keyframes and font styling so player and monster numbers travel outward diagonally and remain readable.
- [ ] Rerun focused tests.

### Task 5: Block Training Timing

**Files:**
- Modify: `game.js`
- Modify: `tools/browser-smoke/try_combat_event_timing.js`
- Test: `tests/combat-flow.test.mjs`

**Interfaces:**
- Consumes: existing typed `player-status` shield effect.

- [ ] Add a failing browser-smoke assertion that shield is zero before the Block Training notice and positive on the emitted notice snapshot itself.
- [ ] Run the focused timing test and verify the one-message delay.
- [ ] Reorder notice handling so the typed shield effect is applied before the event snapshot is emitted while keeping render and mutation in the same `showNotice` pass.
- [ ] Rerun the timing smoke and confirm the shield appears on the correct message.

### Task 6: Full Verification

**Files:**
- Test: all affected runtime files.

- [ ] Run `node --check game.js`.
- [ ] Run `node --test tests/combat-rules.test.mjs tests/combat-flow.test.mjs tests/sfx-map.test.mjs`.
- [ ] Run `npm.cmd test` and require zero failures.
- [ ] Reload `http://127.0.0.1:4173/index.html` and require no browser console warnings or errors.

## Repository Note

The workspace currently has an invalid or empty `.git` directory, so commit steps are intentionally omitted until the repository metadata is repaired.
