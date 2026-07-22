# Critical Motion and Damage Number Origin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the unchanged legacy critical visuals and start floating damage numbers at the affected character's visual center.

**Architecture:** Keep mapped critical audio separate from the legacy visual functions. The V25 critical branch explicitly invokes the existing V23 and V24 visual functions, while the floating-number renderer derives its origin from the actor rectangle center relative to the combat stage.

**Tech Stack:** Browser JavaScript, CSS, Node test runner, jsdom browser-smoke harness.

## Global Constraints

- Preserve both existing V23 and V24 critical visual layers without redesigning them.
- Play the mapped critical audio once.
- Keep the floating number's existing diagonal direction and 1.2-second duration.
- Do not change combat math, timing, or unrelated FX.
- This directory is not a Git repository, so commit steps are omitted.

---

### Task 1: Restore Legacy Critical Motion

**Files:**
- Modify: `tests/combat-flow.test.mjs`
- Modify: `game.js`

**Interfaces:**
- Consumes: `triggerCriticalFlashV23(source)`, `strongCriticalFeedbackV24(source)`, `playSfxV25(name)`
- Produces: V25 critical playback that triggers both legacy visuals and one mapped audio playback.

- [ ] Add a source regression assertion that the V25 `critical` branch calls both `triggerCriticalFlashV23(source)` and `strongCriticalFeedbackV24(source)` before `playMappedAudio('critical', ...)`.
- [ ] Run `node --test tests/combat-flow.test.mjs --test-name-pattern="critical feedback"` and confirm the new assertion fails because the visual calls are absent.
- [ ] In the V25 critical branch, derive the existing source value from `game.combatImpact?.target`, call both existing visual functions, and leave mapped audio handling unchanged.
- [ ] Re-run the focused test and confirm it passes without adding any new animation implementation.

### Task 2: Center Floating Damage Origins

**Files:**
- Modify: `tests/combat-flow.test.mjs`
- Modify: `game.js`
- Test: `tools/browser-smoke/try_combat_event_timing.js`

**Interfaces:**
- Consumes: `showCombatFloatingDamageV45(target, amount, critical)` and actor/stage `DOMRect` values.
- Produces: `left = rect.left - stageRect.left + rect.width * .5` and `top = rect.top - stageRect.top + rect.height * .5`.

- [ ] Add source regression assertions for the center-based `left` and `top` calculations and rejection of the old outer-edge offsets.
- [ ] Run the focused source test and confirm it fails on the current edge-based coordinates.
- [ ] Replace only the two coordinate assignments in `showCombatFloatingDamageV45`; preserve CSS direction, duration, font, and colors.
- [ ] Run `node --test tests/combat-flow.test.mjs` and `node tools/browser-smoke/try_combat_event_timing.js` and confirm both pass.

### Task 3: Full Verification

**Files:**
- Verify: `game.js`
- Verify: `style.css`

- [ ] Run `node --check game.js` and confirm exit code 0.
- [ ] Run `npm.cmd test` and confirm every baseline group passes.
- [ ] Confirm the final diff contains no changes to critical chance, critical multiplier, combat log duration, or existing V23/V24 CSS keyframes.
