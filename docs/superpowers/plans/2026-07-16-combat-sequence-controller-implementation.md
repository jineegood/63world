# Combat Sequence Controller Implementation Plan

**Goal:** Extract combat queue lifecycle from `game.js` without changing typed events, timing, rendering, FX, audio, state mutation, or combat outcomes.

## Task 1: Deterministic controller contract

- Create `tests/combat-sequence-controller.test.mjs` with a VM loader and fake timers.
- RED tests: begin writes active state; replacement clears prior timers; stale callbacks and stale finish are ignored; changed combat ID invalidates the token; invalidate resets and advances generation.
- Create `src/combat-sequence-controller.js` as a DOM-free IIFE exposing `create(options)`.

## Task 2: Production integration

- Add the script after `src/combat-rules.js` and before `game.js`.
- Require `window.YuksamCombatSequenceController` at game bootstrap.
- Instantiate once in the active combat patch with existing transient cleanup callbacks.
- Replace local timer set/generation lifecycle with `begin`, `isCurrent`, `schedule`, `finish`, `invalidate`, and `isActive`.
- Retain `game.combatSequenceGeneration` and `game.combatSequenceActive` via the injected state writer.

## Task 3: Structural and runtime regression protection

- Assert script order, one controller instantiation, and absence of the old timer set/scheduler helper.
- Run controller, combat-flow, combat-rules, and combat-FX suites.
- Run existing sequence and event-timing browser smokes unchanged.

## Task 4: Default gate and recovery

- Add `combat-sequence-controller` mode and package script.
- Syntax-check the new production module and include its suite in `all`.
- Run `npm.cmd test` and require zero failures.
- Write the result audit, update `docs/HANDOFF-2026-07-16.md`, and create a post-package ZIP plus SHA-256 manifest.
