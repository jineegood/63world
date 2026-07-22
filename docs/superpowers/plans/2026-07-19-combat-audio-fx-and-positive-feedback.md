# Combat Audio, FX, and Positive Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Synchronize combat projectiles, multi-hit FX/audio, defensive presentation, Prayer Barrier feedback, and global heal/shield floating numbers with their exact combat logs.

**Architecture:** Typed combat notices own their audio, FX, and state changes. `src/combat-fx.js` exposes profiles that can separate actor wind-up from projectile/impact playback. The living v25 effect handler calculates actual state deltas and emits colored floating numbers from those deltas.

**Tech Stack:** Browser JavaScript/CSS, typed combat events, Node/jsdom FX and timing tests.

## Global Constraints

- Shield Charge plays Defense Stance sound and shield FX on its pre-hit shield notice, then Shield Charge sound and charge FX on its hit notice.
- Monster projectiles appear on damage notices, not attack-announcement notices.
- Elite Hardening has no projectile, uses a monster-centered shield animation, and plays Defense Stance audio.
- Meteor repeats animation and Meteor audio on all four hit notices.
- Homework Bomb repeats its projectile on both damage notices.
- Holy Judgment has no projectile.
- Prayer Barrier plays the actual `assets/8. 기도의 방벽 소리.mp3` every proc and shows/logs actual reflect/heal values.
- Combat healing uses green `+amount`; shield creation uses gray `+amount`; zero healing shows nothing.

---

### Task 1: Positive floating-number primitive and effect wiring

**Files:**
- Modify: `tests/combat-fx.test.mjs`
- Modify: `tools/browser-smoke/try_combat_frame.js`
- Modify: `tools/browser-smoke/try_combat_event_timing.js`
- Modify: `style.css`
- Modify: `game.js`

**Interfaces:**
- Produce `showCombatFloatingNumberV49(target, amount, kind, critical)` where `kind` is `damage`, `heal`, or `shield`.

- [ ] Add CSS/source tests for red damage, green heal, and gray shield variants centered on the actor and removed after 1200ms.
- [ ] Add jsdom tests for player heal, player shield, monster heal, and monster shield effect handlers using actual applied deltas.
- [ ] Assert clamped/zero healing uses the actual delta and creates no zero popup.
- [ ] Run focused tests and observe failures because the current helper supports damage only.
- [ ] Generalize the existing floating-damage helper without changing its placement or damage styling.
- [ ] In each effect handler, capture before/after HP or shield and queue matching positive feedback at the notice render boundary.
- [ ] Re-run FX/frame/timing suites serially.

### Task 2: Prayer Barrier complete feedback

**Files:**
- Modify: `tests/audio-manifest.test.mjs`
- Modify: `tests/sfx-map.test.mjs`
- Modify: `tools/browser-smoke/try_combat_event_timing.js`
- Modify: `src/audio-manifest.js`
- Modify: `game.js`

**Interfaces:**
- Consume Task 1 floating-number helper.

- [ ] Test that `prayerBarrier.src` equals the existing spaced path `assets/8. 기도의 방벽 소리.mp3` and baseline asset discovery succeeds.
- [ ] Add a runtime retaliation test that triggers two separate procs and observes Prayer Barrier audio on both.
- [ ] Assert each proc shows monster red `-reflect`, player green `+actualHeal`, and a log containing both reflected and actually restored values.
- [ ] Include a near-full-HP case so planned heal exceeds missing HP and the log/popup use the clamped amount.
- [ ] Run tests and observe the old filename, missing retaliation feedback, and damage-only log failures.
- [ ] Correct the manifest path; compute projected actual heal before building retaliation text/effect; queue damage/heal floating feedback in the retaliation handler.
- [ ] Preserve Holy healing-mastery scaling.
- [ ] Re-run audio, baseline asset, combat-flow, and timing smoke tests.

### Task 3: Shield Charge and defensive presentation

**Files:**
- Modify: `tests/combat-fx.test.mjs`
- Modify: `tools/browser-smoke/try_combat_event_timing.js`
- Modify: `src/combat-fx.js`
- Modify: `game.js`

**Interfaces:**
- Produce a player shield-wave profile usable on `player-support-before`.
- Produce a monster self-shield profile with `mode:'wave'`, monster target, shield orbit/wave, and no projectile.

- [ ] Test Shield Charge event order: answer, shield support notice with `defensiveStance` audio and shield wave, then hit notice with `shieldCharge` audio and charge impact.
- [ ] Test Elite Hardening action/status presentation has no projectile, has a monster-centered shield animation, and plays `defensiveStance` rather than `enemyAttack`.
- [ ] Run focused tests and verify old single-sound charge and slime projectile Hardening fail.
- [ ] Attach active-skill FX/audio metadata to the before-phase Shield Charge support event, not only zero-damage support actions.
- [ ] Add a dedicated `selfShield` monster profile and use it on Hardening's shield-applying notice.
- [ ] Keep ordinary monster self-shields compatible with the same defensive profile.
- [ ] Re-run FX and timing tests.

### Task 4: Monster projectile timing and Homework Bomb repetition

**Files:**
- Modify: `tests/combat-fx.test.mjs`
- Modify: `tools/browser-smoke/try_combat_event_timing.js`
- Modify: `src/combat-fx.js`
- Modify: `game.js`

**Interfaces:**
- Produce split monster FX metadata: wind-up motion for `monster-action`, projectile/impact for each landed `player-damage`.

- [ ] Test a projectile monster's action event contains wind-up only and creates no projectile.
- [ ] Test the following player-damage notice creates one projectile whose impact coincides with damage application/log display.
- [ ] Test a miss has miss audio and no damaging impact.
- [ ] Test Teacher Homework Bomb creates one projectile on each of its two damage notices.
- [ ] Run focused tests and observe the current action-bound projectile failure.
- [ ] Split the profile or add explicit `phase` helpers without duplicating complete profiles in `game.js`.
- [ ] Attach per-hit monster FX to hit plans and keep melee/claw/charge timing coherent.
- [ ] Re-run combat-fx and event-timing smoke serially.

### Task 5: Player multi-hit replay and Holy Judgment projectile removal

**Files:**
- Modify: `tests/combat-fx.test.mjs`
- Modify: `tools/browser-smoke/try_combat_event_timing.js`
- Modify: `src/combat-fx.js`
- Modify: `game.js`

**Interfaces:**
- Consume existing `hitIndex`/`hitStage` per-hit metadata.

- [ ] Test Meteor's four hit events each carry the Meteor FX and audio ID and produce four animation/audio invocations.
- [ ] Assert other multi-hit skills retain intentional per-hit behavior and misses use miss audio.
- [ ] Test Holy Judgment's profile has no projectile while keeping prayer motion, holy impact, damage, and heal wave.
- [ ] Run focused tests and observe Meteor follow-ups lack audio/full FX and Holy Judgment remains projectile mode.
- [ ] Disable complementary-ultimate follow-up suppression specifically for Meteor and attach its audio to every landed Meteor hit.
- [ ] Add a Holy Judgment profile override using impact mode with prayer motion and holy burst/self heal wave.
- [ ] Re-run FX, SFX, and timing tests.

### Task 6: Presentation integration audit

**Files:**
- Inspect: `src/audio-manifest.js`
- Inspect: `src/combat-fx.js`
- Inspect: `game.js`
- Inspect: `style.css`

- [ ] Search for the old Prayer Barrier filename and projectile-bearing selfShield/Holy Judgment profiles.
- [ ] Run all syntax checks and focused audio/FX/combat suites.
- [ ] Run direct jsdom combat/FX smokes serially.
- [ ] Run `npm.cmd test` once and record exact totals.
