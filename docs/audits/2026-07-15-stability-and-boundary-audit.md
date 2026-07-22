# 2026-07-15 Stability and Feature-Boundary Audit

## Executive Summary

The current build passes its configured test baseline, but the code structure has reached a point where passing tests do not provide enough protection against regressions. `game.js` is 12,069 lines and approximately 600 KB. It contains 189 versioned function assignments and repeatedly wraps central functions such as `playSfx`, `renderCombatFrame`, `openCombat`, world drawing, collision lookup, and interaction handling.

The recently restored critical animation is a concrete example of the main risk: a later `playSfx` wrapper handled the new sound and returned before older visual wrappers ran. The safest next step is not a broad refactor. First add deterministic tests around save data, administrator edits, input routing, and final-boss combat. Then consolidate one boundary at a time, starting with audio/combat feedback and combat sequencing.

No production runtime, gameplay data, spreadsheet, or asset was modified during this audit.

## Recovery Checkpoint

- Archive: `backups/2026-07-15-pre-audit-checkpoint.zip`
- Archive entries: 64
- Archive SHA-256: `0F531BD7846791E4FF15AF7D0AA412274237BA8AA4483796AB128A0489491FDE`
- Hash manifest: `backups/2026-07-15-pre-audit-checkpoint.sha256.txt`
- Included: runtime source, `src`, tests, browser-smoke tools, package metadata, and planning spreadsheets.
- Excluded: large replaceable assets and generated outputs.

## Baseline Results

`npm.cmd test` completed successfully with 123 passing tests and no failures.

The baseline includes six browser-smoke programs through the combat suites:

- combat sequence
- combat event timing
- weapon tiers
- Guardian Oath/FX path
- combat FX resilience
- combat animation

Additional unlinked smoke checks were run manually:

| Flow | Result |
|---|---:|
| General UI | 22 passed |
| Items | 12 passed |
| Quests | 13 passed |
| Workbook enable/disable | 8 passed |
| Server gate | passed |
| Final boss | intermittently 6/6 and 6/7 |
| Legacy boot test | failed before boot |

The final-boss smoke failure is not yet evidence of a boss gameplay bug. `tools/browser-smoke/try_final_boss.js:41-46` expects every basic attack to lower HP, but the game now has a universal 10% miss chance and this script does not control randomness. It therefore reports legitimate misses as failures. Its fixed waits also make it vulnerable to future animation timing changes.

The legacy `boot_test.js` directly requires `jsdom` instead of using the portable harness dependency path, so it cannot currently run in the standard workspace environment.

## Structural Evidence

### Central File Size

| File | Lines | Approximate size |
|---|---:|---:|
| `game.js` | 12,069 | 600 KB |
| `style.css` | n/a | 123 KB |
| `src/game-data.js` | 352 | 47 KB |
| `src/combat-fx.js` | 524 | 21 KB |
| `src/admin-dashboard.js` | 420 | 20 KB |
| `src/combat-rules.js` | 302 | 13 KB |

`game.js` contains 434 named function declarations, 125 function-assignment names, 189 versioned function assignments, and 18 explicit patch section markers.

### Most Reassigned Responsibilities

| Function | Assignment count | Risk |
|---|---:|---|
| `interact` | 12 | Later map patches can bypass earlier interactions. |
| `drawWorld` | 11 | Draw order and map-specific additions depend on wrapper order. |
| `getNearestInteractable` | 11 | Interaction priority can change when a wrapper returns early. |
| `getCurrentMapColliders` | 7 | Collision lists accumulate through chained wrappers. |
| `playSfx` | 7 | Sound branches can bypass older visual side effects. |
| `renderCombatFrame` | 5 | Rendering wrappers can replace DOM needed by later feedback. |
| `updateHud` | 5 | UI additions depend on every older wrapper still being called. |
| `openCombat` | 3 | Combat initialization state is distributed across versions. |
| `computeTotalStats` | 3 | Balance rules can be applied more than once or skipped. |

Important examples are visible at `game.js:4802`, `5216`, `5699`, `6018`, `6253`, `6846`, and `8657` for audio, and `game.js:5318`, `5997`, `6926`, `7932`, and `8132` for combat rendering.

### Input Routing

`game.js` registers window-level keydown handlers at lines 3133, 5541, 5724, 5903, 6901, 7959, and 11162. `src/combat-keys.js` adds another handler. Many handlers are context-gated or use propagation control, so this is not a confirmed duplicate-action bug, but behavior depends on listener registration order and `stopImmediatePropagation`. This is a high-risk source of modal, dialogue, map, and combat key conflicts.

### Global Script Coupling

`index.html` loads data, combat rules, FX, and audio manifests before `game.js`, then loads admin, input, tooltip, map, banner, ultimate, sound-map, skill-point, and cheat modules after it. These later modules consume and mutate globals published by `game.js`. A load-order change can therefore break functionality without a module import error.

## Coverage Gaps

### Data Safety

`playerKey`, `savePlayer`, and `loadPlayer` are implemented at `game.js:229-327`. The administrator dashboard also writes player records directly at `src/admin-dashboard.js:262` and `316`. No test currently references `savePlayer`, `loadPlayer`, `playerKey`, or player `localStorage` behavior.

This is the highest-impact untested area because a regression could affect character persistence even while all 123 configured tests pass.

### Administrator Workflows

There is no automated coverage for administrator login, player edits, character display-name changes, workbook activation, or persistence across reload. Workbook filtering has pure-rule coverage, but the actual dashboard storage path does not.

### Runtime Smoke Drift

There are 22 JavaScript files in `tools/browser-smoke`, but only six are connected to `npm.cmd test`. The remaining scripts can silently become stale, as shown by `boot_test.js` and the nondeterministic final-boss check.

### Source Assertions Versus User Behavior

Many combat-flow tests correctly protect source wiring, but source regular expressions cannot prove that an animation is visible, that a button works once, or that a saved character reloads correctly. High-value paths need jsdom or real-browser assertions in addition to source checks.

## Risk Register

### S1: Data Loss or Progress Loss

No S1 bug was reproduced during this audit.

**S1 exposure:** player saving and administrator record edits have no automated round-trip tests. Do not refactor storage or administrator code until those tests exist.

### S2: Incorrect Gameplay or Blocked Flow

1. **Wrapper-chain bypass risk:** already caused the critical animation regression. The same pattern exists in combat rendering, HUD updates, combat entry, stats, and world interaction.
2. **Combat timing ownership is split:** state mutation, log rendering, FX, sound, and follow-up scheduling meet inside `game.js:6430-7870`. Small timing changes can detach visible feedback from state.
3. **Input listener order risk:** eight global keydown layers can compete across map, dialogue, modal, and combat contexts.
4. **Final-boss verification is nondeterministic:** legitimate misses are counted as failures, so a real boss regression could be hidden among false alarms.

### S3: Degraded Feedback or Test Reliability

1. `boot_test.js` cannot resolve the workspace jsdom dependency.
2. Sixteen browser-smoke scripts are not part of the baseline command.
3. Audio behavior is split across `audio-manifest.js`, `sfx-map.js`, seven `playSfx` wrappers, and direct `Audio` objects.
4. Tooltip handling exists in both late `game.js` patches and `src/ui-tooltip.js`, increasing overlap risk.

### S4: Maintainability and Polish

1. Patch sections preserve history inside the active runtime instead of one final implementation per responsibility.
2. Several tests intentionally assert that the patch chain remains present, which protects the current structure but makes gradual removal require careful test replacement.
3. Large source and stylesheet files slow review and make unrelated side effects difficult to notice.

## Recommended Module Boundaries

These are target boundaries, not instructions for one large rewrite.

### 1. Player Store

Owns player keys, create/load/save/delete, schema migration, and atomic administrator updates. It should expose explicit functions instead of allowing the dashboard to write player JSON directly.

Dependencies: storage adapter only. No DOM or combat dependency.

### 2. Input Router

Owns one global keyboard listener and delegates by current mode: world, dialogue, modal, combat, or typing. Feature modules register mode handlers instead of adding window listeners.

Dependencies: modal state and current screen state.

### 3. Audio and Combat Feedback

Owns mapped sound playback, critical feedback, floating numbers, impact classes, and cleanup. One critical API must trigger existing visuals and one sound without depending on wrapper order.

Dependencies: audio manifest, settings, and combat DOM references. No damage calculation.

### 4. Combat Sequence Controller

Owns event queues, cancellation generations, effect application order, render timing, and resolution events. Pure calculations remain in `combat-rules.js`; visual animation remains in `combat-fx.js` or the feedback module.

Dependencies: combat rules, a small state adapter, renderer callback, and feedback callback.

### 5. World Interaction Controller

Owns map drawing extension registration, collision providers, nearest-interactable selection, and interaction dispatch. Map-specific features register data instead of wrapping four central functions repeatedly.

Dependencies: world state, map definitions, and renderer primitives.

## Recommended Work Order

### Stage 1: Safety Net Only

Do not refactor production code yet.

1. Add player-store round-trip tests covering create, save, reload, delete, and corrupted JSON.
2. Add administrator tests proving an edited display name does not change the login/storage key unless explicitly requested.
3. Make final-boss smoke deterministic by controlling miss and critical rolls and waiting on queue completion instead of a fixed 500 ms.
4. Repair `boot_test.js` to use the shared portable harness.
5. Add a test that each keyboard event is handled by only one active mode.

### Stage 2: Audio/Feedback Consolidation

This is the smallest extraction with a proven regression history. Replace the seven-layer audio wrapper chain with one dispatcher while preserving every current sound and V23/V24 critical visual. Verify in a runtime smoke before removing old wrappers.

### Stage 3: Combat Sequence Extraction

Move the current queue and effect timing as one behavior-preserving unit. Do not rebalance or redesign logs during extraction. Run combat sequence, event timing, FX, shield, status, miss, and multi-hit tests after each step.

### Stage 4: Input Router

Consolidate global key listeners after mode-specific behavior tests exist. This reduces dialogue/combat/map conflicts before world code is touched.

### Stage 5: World Interaction Registry

Replace `drawWorld`, collider, nearest-interactable, and `interact` wrapper chains with registered map providers one map at a time.

### Stage 6: Player Store and Admin Extraction

After storage tests are stable, move persistence behind one API and make the administrator dashboard consume it. Treat this as a separate high-caution change because it touches real character data.

## Immediate Next Package

The first implementation package should contain tests and test-infrastructure fixes only:

- player save/load round-trip regression tests
- administrator edit persistence tests
- deterministic final-boss smoke
- portable boot smoke
- input routing collision test

After that package passes, review the results before changing runtime architecture.
