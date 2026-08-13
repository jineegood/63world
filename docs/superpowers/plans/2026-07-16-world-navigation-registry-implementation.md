# World Navigation Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace collider, movement, and automatic-transition wrapper chains with one tested navigation registry without changing final V35 behavior.

**Architecture:** A pure browser-global registry orders collider providers and transition handlers. `game.js` keeps geometry, map state, collision math, and transition effects, while public navigation functions delegate through one registry instance.

**Tech Stack:** Classic browser JavaScript, Node test runner, `node:vm`, jsdom browser-smoke harness, PowerShell baseline runner.

**Status:** Completed and verified on 2026-07-16. See `docs/audits/2026-07-16-world-navigation-registry-result.md`.

## Global Constraints

- Preserve every final collider coordinate, shape, radius, and strict `< 42` transition threshold.
- Preserve boss-room ellipse movement, transition locks, door SFX, spawn points, HUD/audio/save updates, and final-room exclusivity.
- Remove only duplicate town collider entries whose boolean collision behavior is identical.
- Do not modify `drawWorld`, drawing helpers, map data, interactions, balance, UI, audio routing, or save format.
- Use ZIP/SHA-256 checkpoints because this directory is not a usable Git repository.

---

### Task 1: Pure Navigation Registry

**Files:**
- Create: `tests/world-navigation-registry.test.mjs`
- Create: `src/world-navigation-registry.js`

**Interfaces:**
- Produces: `window.YuksamWorldNavigationRegistry.create(options)`
- Produces registry methods: `registerCollider`, `registerTransition`, `getColliders`, `runTransition`

- [ ] Write VM tests for descending priority, stable ties, empty-array ownership, fallback, one handled transition, duplicate IDs, and unregister callbacks.
- [ ] Run `node --test tests/world-navigation-registry.test.mjs` and confirm RED because the module is absent.
- [ ] Implement the minimal dependency-free registry and validate entry IDs/functions.
- [ ] Run the unit tests and confirm GREEN.

### Task 2: Runtime Behavior Capture

**Files:**
- Create: `tools/browser-smoke/try_world_navigation.js`
- Modify: `tests/world-navigation-registry.test.mjs`

**Interfaces:**
- Consumes: real lexical `getCurrentMapColliders`, `canPlayerMoveTo`, and `checkAutoTransitions`
- Produces: deterministic smoke output ending in `RESULT: PASS`

- [ ] Capture normalized collider signatures/counts for town, swamp, pet interior, upgrade interior, boss room, and final room against the existing wrapper chain.
- [ ] Probe movement at each current obstacle and boundary using exact world coordinates.
- [ ] Probe town entries, four interior exits, lock suppression, strict radius, and final-room no-op with transition side effects instrumented.
- [ ] Run the browser smoke against the wrapper chain and confirm the behavior baseline passes.
- [ ] Add source-boundary assertions requiring the new module/delegates and forbidding versioned navigation wrappers; confirm RED.

### Task 3: Base Collider Integration

**Files:**
- Modify: `index.html`
- Modify: `game.js`

**Interfaces:**
- Consumes: navigation registry factory
- Produces: `getBaseMapColliders`, `worldNavigationRegistry`, public delegates

- [ ] Load `src/world-navigation-registry.js` before `game.js` and require its global.
- [ ] Rename the base collider function and fold final swamp and healing-well support into it.
- [ ] Instantiate one registry with base collider/transition fallbacks.
- [ ] Make `getCurrentMapColliders()` a single registry delegate.
- [ ] Register final town/pet/upgrade collider lists and remove V17/V19/V30/V31/V32/V33/V34 collider wrappers.
- [ ] Reduce `canPlayerMoveTo()` to the boss ellipse plus one collider-list test and remove its V34 wrapper.
- [ ] Run unit, browser collider, boot, and input tests.

### Task 4: Transition Integration

**Files:**
- Modify: `game.js`

**Interfaces:**
- Consumes: `worldNavigationRegistry.registerTransition`
- Produces: one current shop/final-room transition handler and base fallback

- [ ] Rename the base transition function to `runBaseAutoTransition()`.
- [ ] Register a final handler that checks player/lock once, owns finalBossRoom, routes V33 pet/upgrade rules, and routes V23 equipment/building exit rules.
- [ ] Make `checkAutoTransitions()` a single registry delegate.
- [ ] Remove V20/V23/V27/V32/V33/V34 transition wrapper assignments while retaining the latest called side-effect functions.
- [ ] Run transition smoke, world interaction, storage, and input tests.

### Task 5: Gate, Documentation, and Recovery

**Files:**
- Modify: `tools/run-baseline.ps1`
- Modify: `package.json`
- Create: `docs/audits/2026-07-16-world-navigation-registry-result.md`
- Modify: `docs/archive/handoffs/HANDOFF-2026-07-16.md`

**Interfaces:**
- Produces: `npm.cmd run test:world-navigation-registry`

- [ ] Add module syntax checking, a dedicated runner mode, and the suite to the default gate.
- [ ] Run focused suites and `npm.cmd test` with zero failures.
- [ ] Record exact hashes, line counts, and behavior evidence.
- [ ] Create the post-package ZIP and SHA-256 manifest.
- [ ] Update the handoff so `drawWorld` layer composition is the next package.
