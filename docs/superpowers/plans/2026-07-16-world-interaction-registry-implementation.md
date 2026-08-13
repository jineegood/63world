# World Interaction Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace versioned world interaction lookup and dispatch wrappers with one priority registry while preserving the final V35 runtime behavior.

**Architecture:** A pure browser-global registry orders injected candidate providers and type-specific action handlers. `game.js` keeps map state, distance calculations, modal functions, and base behavior; patch IIFEs register their current final capabilities instead of wrapping shared functions.

**Tech Stack:** Classic browser JavaScript, Node test runner, `node:vm`, jsdom browser-smoke harness, PowerShell baseline runner.

**Status:** Completed and verified on 2026-07-16. All task checklists below are retained as the execution record; completion evidence is in `docs/archive/audits/2026-07-16-world-interaction-registry-result.md`.

## Global Constraints

- Preserve every final candidate type, label, distance threshold, map priority, modal function, and intentional no-op.
- Preserve automatic exits and do not add E-driven exits where V22/V27 intentionally suppress them.
- Do not change `drawWorld`, colliders, automatic transition logic, nearby-monster lookup, map data, balance, UI, audio, or save data.
- Keep `getNearestInteractable()` and `interact()` as the public lexical entry points.
- Use failing tests before production changes.
- The directory is not a usable Git repository; use ZIP/SHA-256 checkpoints instead of commits.

---

### Task 1: Pure Registry Contract

**Files:**
- Create: `tests/world-interaction-registry.test.mjs`
- Create: `src/world-interaction-registry.js`

**Interfaces:**
- Produces: `window.YuksamWorldInteractionRegistry.create(options)` and `.STOP`
- Registry methods: `registerCandidate(entry)`, `registerAction(entry)`, `find(context)`, `dispatch(context)`

- [ ] Write VM tests proving descending priority, stable ties, STOP, matching action types, intentional handled no-op, duplicate-ID rejection, unregister, and one lookup per dispatch.
- [ ] Run `node --test tests/world-interaction-registry.test.mjs` and verify RED because the module is absent.
- [ ] Implement the minimal DOM-free registry with sorted entries and unregister callbacks.
- [ ] Run the unit suite and verify GREEN.

### Task 2: Runtime Behavior Capture

**Files:**
- Create: `tools/browser-smoke/try_world_interactions.js`
- Modify: `tests/world-interaction-registry.test.mjs`

**Interfaces:**
- Consumes: the real `index.html` script chain and lexical `getNearestInteractable()`/`interact()` entry points
- Produces: a smoke ending with `RESULT: PASS`

- [ ] Add candidate checks for town pet/upgrade doors and healing well; equipment-shop exit suppression and weapon NPC; pet/upgrade exit and NPC candidates; boss-room final portal; final-room exit, teacher, and exclusive empty space.
- [ ] Add dispatch checks for healing, pet, upgrade, final teacher, and pet/upgrade exit no-op behavior.
- [ ] Run the smoke against the existing wrapper chain and record its passing behavior baseline.
- [ ] Add source-boundary assertions requiring the new module/script and forbidding versioned lookup/dispatch wrapper assignments; verify these assertions RED.

### Task 3: Base Registry Integration

**Files:**
- Modify: `index.html`
- Modify: `game.js`

**Interfaces:**
- Consumes: registry factory from Task 1
- Produces: `worldInteractionRegistry`, `findBaseWorldInteractable`, `dispatchBaseWorldInteraction`, public delegates

- [ ] Load `src/world-interaction-registry.js` after `src/input-router.js` and before `game.js`.
- [ ] Require the global at game bootstrap.
- [ ] Rename the base lookup/dispatch implementations and create one registry instance with tooltip cleanup as `beforeDispatch`.
- [ ] Restore public delegates that call `registry.find()` and `registry.dispatch()`.
- [ ] Fold final base swamp support and V22 base `shopExit` suppression into `findBaseWorldInteractable()`.
- [ ] Run registry, boot, and input-router tests.

### Task 4: Candidate Provider Migration

**Files:**
- Modify: `game.js` V19, V34, V35 interaction sections

**Interfaces:**
- Consumes: `worldInteractionRegistry.registerCandidate`
- Produces: `healing-well`, `v34-world-candidates`, `v35-final-room` providers

- [ ] Register V19 healing well at priority 190 and remove its lookup wrapper.
- [ ] Register V34 final portal/town/pet candidates at priority 340.
- [ ] Include final V33 upgrade interior rules in the V34 provider or a priority-330 provider using the final 108-pixel threshold and label.
- [ ] Register V35 final-room provider at priority 350 and return `STOP` when no V35 candidate exists on that map.
- [ ] Remove all obsolete versioned lookup wrapper assignments from V17 through V35.
- [ ] Run the candidate browser smoke and source-boundary tests.

### Task 5: Action Migration

**Files:**
- Modify: `game.js` V19, V27, V33, V34, V35 interaction sections

**Interfaces:**
- Consumes: `worldInteractionRegistry.registerAction`
- Produces: final type-specific handlers with explicit priorities

- [ ] Register healing-well action at priority 190.
- [ ] Register pet/upgrade exit types as handled no-ops at priority 270.
- [ ] Register V33 upgrade NPC at priority 330.
- [ ] Register V34 pet orb and final portal at priority 340.
- [ ] Register V35 final exit and teacher at priority 350.
- [ ] Remove all obsolete versioned `interact` wrapper assignments and old aliases.
- [ ] Run action smoke, input-router, combat-key, and final-boss tests.

### Task 6: Default Gate and Recovery

**Files:**
- Modify: `tools/run-baseline.ps1`
- Modify: `package.json`
- Create: `docs/archive/audits/2026-07-16-world-interaction-registry-result.md`
- Modify: `docs/archive/handoffs/HANDOFF-2026-07-16.md`

**Interfaces:**
- Produces: `npm.cmd run test:world-interaction-registry` and default-gate coverage

- [ ] Add the module syntax check, runner mode, test suite, and package script.
- [ ] Run focused registry/runtime tests and `npm.cmd test` with zero failures.
- [ ] Record exact runtime hashes and the verified pass count.
- [ ] Create a final ZIP checkpoint and SHA-256 manifest.
- [ ] Update the handoff so the next package is drawing/collider audit or player-store boundary, based on remaining risk.
