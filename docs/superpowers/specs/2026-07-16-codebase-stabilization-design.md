# 63world Codebase Stabilization Design

**Date:** 2026-07-16  
**Status:** Approved for implementation planning  
**Workspace:** `C:\Users\fiost\Desktop\63world (1)\63world`

## Objective

Reduce regression and data-loss risk while making the game safer to modify. Stabilization preserves current gameplay, balance, UI design, copy, audio assignments, animation timing, data, assets, and classic-script load order. Convenience and design improvements begin only after the stabilization packages pass their gates.

Only development save data currently exists. Storage compatibility remains important, but no production migration or end-user recovery UI is required.

## Current Evidence

- `npm.cmd test` passes 127 tests in the current workspace.
- `game.js` is about 600 KB and 12,072 lines, with active versioned wrapper chains.
- `style.css` is about 123 KB and 2,469 lines, with source-order overrides.
- The `.git` directory is not a usable Git repository, so existing history and working-tree diffs are unavailable.
- Boot-time workbook migration overwrites a present corrupt `ysb_workbooks_v3` value.
- Corrupt player JSON can be interpreted as an absent account and later overwritten.
- Administrator mutators can be invoked without an internal authorization guard.
- `playSfx('critical')` throws `ReferenceError: strongCriticalFeedbackV24 is not defined`.
- Mapped audio reads settings through harness-only `window.__G`, so real-browser mute and volume can be ignored.
- Audio, combat, input, and world behavior still depend on wrapper and listener registration order.

## Strategy

Use risk-ordered, test-first packages. Each package must be independently reviewable, verifiable, and recoverable. The project reaches a modular structure gradually instead of moving the monolith in one rewrite.

Work order:

1. Preserve corrupt workbook bytes during boot.
2. Distinguish corrupt player data from an absent account.
3. Stabilize account keys, storage exception handling, and administrator authorization.
4. Consolidate audio dispatch and fix critical feedback and production settings.
5. Replace global keyboard listener layers with one input router.
6. Separate combat sequence ownership from rules and visual effects.
7. Replace world wrapper chains with registered interaction providers.
8. Consolidate CSS overrides without changing visual design.
9. Remove superseded wrappers and stale test tools after replacement coverage exists.

Each numbered item is a separate implementation package. A package may be split further if its failing tests expose unrelated root causes. Packages must not be combined merely to reduce the number of changes.

## Global Invariants

- Do not change game balance, gameplay rules, display copy, UI design, sound assignments, animation timing, workbook content, runtime assets, or spreadsheets during stabilization.
- Do not change `index.html` script order without a dedicated boot test and separate approval.
- Preserve current storage key names and valid storage formats until the player-store package explicitly defines a compatible migration.
- Never automatically repair, delete, migrate, or overwrite corrupt stored bytes.
- Keep critical visual feedback active even when SFX is muted.
- Control randomness in tests and wait for observable state instead of fixed arbitrary delays.
- Do not rely on source regular expressions alone to prove runtime behavior.
- Use `backups/2026-07-16-handoff-checkpoint-final.zip` as the existing recovery baseline and create a new verified checkpoint before implementation.
- Because Git is unavailable, record the exact file list and SHA-256 hashes for every package until a usable repository is restored.

## Target Boundaries

### Player Store

Own account-key resolution, create, load, save, delete, schema validation, migration, and administrator updates. It depends only on a storage adapter and exposes result objects rather than hiding storage failures.

The player store returns one of these read states:

- `absent`: the key does not exist; first-run creation is allowed.
- `valid`: JSON and schema checks pass; loading and compatible migration are allowed.
- `corrupt`: the key exists but parsing or schema checks fail; all automatic writes and migrations are blocked.

Display-name changes must not silently change the account storage key. Administrator code must use this boundary instead of writing player JSON directly.

### Audio Dispatcher

Own effect-name routing, mapped file playback, synthesized fallback, mute and volume settings, and critical visual callbacks. It receives audio, settings, and visual callbacks as dependencies and does not read combat state or search the DOM directly.

One public dispatch entry point replaces the active `playSfx` wrapper chain. Per-path callbacks preserve existing behavior, including critical visuals while audio is muted.

### Input Router

Own one window-level keyboard listener. Route each event to at most one active mode in this priority order:

1. editable text input
2. blocking modal
3. dialogue
4. combat
5. world

Feature code registers mode handlers instead of adding global listeners. The router owns propagation and repeat-key policy.

### Combat Sequence Controller

Own turn locking, typed event order, state-application timing, cancellation generations, and next-action scheduling. Existing pure calculations stay in `src/combat-rules.js`; visual animation stays in `src/combat-fx.js` or the feedback boundary.

Rules produce typed effects, the controller applies each effect exactly once, and renderer and feedback callbacks observe the matching state. Visual failures must not leave combat permanently locked.

### World Interaction Registry

Own registered map drawing extensions, collider providers, nearby interaction candidates, priority selection, and interaction dispatch. Map features register providers rather than wrapping `drawWorld`, `getCurrentMapColliders`, `getNearestInteractable`, and `interact`.

Convert one map at a time while preserving current interaction priority and draw order.

### UI Style Boundary

Group styles by component and explicit state. Consolidate repeated selectors and late source-order overrides only when rendered output is proven unchanged. CSS cleanup is performed after runtime boundaries because layout regressions are harder to detect with jsdom.

### Composition Root

`game.js` gradually becomes the composition root and remaining legacy runtime. It initializes shared state and wires module APIs. The project stays on classic scripts during stabilization; ES module or bundler migration is a separate future decision.

## Storage Error Handling

Storage writes follow this sequence:

1. Validate the intended in-memory record.
2. Serialize it completely before touching storage.
3. Preserve the prior raw value under a package-defined temporary backup key for important migrations.
4. Write the new value.
5. Read it back and verify parsing and identity fields.
6. Remove the temporary backup only after verification.

Quota, security, serialization, and verification failures return structured errors. The UI must state that memory and persisted state may differ. Automatic boot migrations operate only on `valid` records. `corrupt` values remain byte-for-byte unchanged until explicit development-data reset.

The stabilization phase supplies a diagnostic message and explicit reset path, not a full recovery editor.

## Authorization Boundary

Opening the administrator panel is not sufficient authorization. Every administrator mutator must check an injected authorization predicate before reading or writing protected data. Direct calls to exported globals without authorization return a failure and perform no mutation.

Authorization work is a separate package from storage parsing so failures can be attributed to one boundary.

## Verification Architecture

### Reproduction First

Every defect package starts with a failing test using production-shaped script order and state. The failure must demonstrate the user-visible or storage-visible defect, not only match source text.

The browser harness must support seeding `localStorage` before script evaluation. Corrupt-storage tests compare exact raw bytes before and after boot.

### Unit Tests

Test rules that do not require DOM rendering independently: storage-state classification, serialization failures, audio routing, input priority, combat event order, and world interaction priority.

### Browser Smokes

Cover boot, login, creation, save and reload, administrator mutation, combat entry and resolution, keyboard routing, audio settings, and world interaction. Stub randomness deterministically and poll observable completion conditions.

### Default Gate

Each package must pass:

- its new RED-to-GREEN focused tests;
- all directly related unit and browser-smoke tests;
- `npm.cmd test`, retaining all existing 127 passing checks;
- `tests/audio-manifest.test.mjs` and `tests/weapon-tier.test.mjs` until they are connected to the default runner;
- production script syntax checks for every script in `index.html` load order.

Unreliable legacy smoke tools must be repaired, replaced, or removed with equivalent coverage. They must not remain as undocumented false gates.

### Manual Browser Gate

Before completing runtime, input, combat, world, or CSS packages, inspect the actual browser console and run this flow:

1. login or create a development character;
2. enter the world;
3. open and close primary modals;
4. start and finish combat;
5. receive a reward;
6. save, reload, and confirm persistence.

CSS packages additionally verify supported narrow and wide viewport layouts, clipping, focus, and click targets.

## Package Completion Criteria

A package is complete only when:

- the new test was observed failing for the intended reason before implementation;
- the minimal implementation makes it pass;
- related tests and the complete gate pass;
- no new browser-console error appears;
- frozen behavior remains unchanged;
- exact changed files and their hashes are recorded;
- remaining risks and the next package are documented;
- a verified recovery checkpoint exists.

If three attempted fixes expose different coupled failures, stop that package and revise its architectural boundary before another implementation attempt.

## Phase B

After all stabilization packages and a full manual flow pass, begin a separate design cycle for convenience, UI, balance, content, or gameplay improvements. Phase B may reuse the new boundaries but cannot be silently folded into stabilization work.

## Out of Scope

- Multiplayer, server, database, or authentication-service implementation
- ES module, bundler, framework, or TypeScript migration
- Balance changes or content expansion
- Spreadsheet edits or workbook-data redesign
- Asset replacement or compression
- Visual redesign
- Production-grade corrupt-save recovery tooling

## Immediate Next Step

Write an implementation plan for Package 1 only: preserve exact corrupt workbook bytes across the complete boot script chain. Do not execute the historical partial storage plan because it does not cover the boot-time migration write.
