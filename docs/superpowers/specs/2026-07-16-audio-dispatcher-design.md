# Audio Dispatcher Consolidation Design

## Goal

Replace the seven layered `playSfx` wrappers with one testable dispatcher while preserving every current sound, fallback, timing, volume, and critical-hit visual.

This package is a behavior-preserving structural change. It does not add audio, change asset assignments, rebalance combat, alter combat logs, or move unrelated feedback such as floating damage numbers.

## Current Problem

`game.js` defines the base synthesized `playSfx` implementation and then reassigns it in V17, V20, V22, V23, V24, V25, and V28 patches. Each wrapper owns only part of the final behavior:

- V17: synthesized critical fallback
- V20 and V22: door synthesis and door-file override
- V23 and V24: two existing critical visual layers
- V25: mapped critical file, visual preservation, and player-hit fallback
- V28: upgrade charge, success, and failure files

The chain is order-dependent. A wrapper that returns early can bypass older sound or visual behavior, as happened when the critical sound mapping was added.

There is also a confirmed scope failure in the current critical path. V23 and V24 define their visual functions inside separate IIFEs, while V25 calls those names from another IIFE. A direct runtime call to `playSfx('critical')` currently throws `ReferenceError: strongCriticalFeedbackV24 is not defined`.

## Chosen Architecture

Add `src/audio-dispatcher.js`, loaded before `game.js`. It publishes a small browser-global factory, `window.YuksamAudioDispatcher.create(options)`.

The factory receives behavior callbacks from `game.js` and returns one `play(name)` function. The dispatcher owns only routing and fallback decisions. It does not own game state, Web Audio synthesis details, DOM animation details, or asset inventory.

`game.js` keeps the public `playSfx(name)` entry point so all existing callers remain unchanged. Once the required helpers are available, `game.js` creates one dispatcher and makes `playSfx` delegate to it. The seven versioned `playSfx` assignments are removed.

`game.js` also keeps one private audio-adapter object. V20 and V22 provide their door callbacks through that object, V23 and V24 register their local visual callbacks, and V28 provides its upgrade callback before installing the dispatcher. This preserves each IIFE boundary without relying on leaked local function names.

## Dependency Boundary

The dispatcher may receive these capabilities through `options`:

- `playSynth(name)` for the existing synthesized sound table
- `playMapped(audioId, fallback)` for manifest-backed files
- `playDoor()` for the current reusable door audio object and its existing fallback
- `playUpgrade(name)` for the existing upgrade audio objects
- `playCriticalVisuals(source)` for both V23 and V24 visual layers
- `getCriticalSource()` based on the current combat-impact target
- `playPlayerHitFallback()` for the doubled synthesized player-hit sound

The module must not access `game`, `document`, `Audio`, or combat state directly. This keeps routing testable without booting the game.

SFX enablement, volume, `resumeAudio()`, and file-object reuse remain inside the injected callbacks that already own those details. The dispatcher must not add a global enabled check because the current critical visuals still run while SFX is disabled, and the current door and upgrade paths have their own disabled-state behavior.

## Preserved Routing

| Input | Required behavior |
|---|---|
| `critical` | Run both existing critical visual layers once, play mapped critical audio once, and use the current player-hit fallback only when mapped playback cannot handle it. |
| `door` | Attempt the current door file path and retain its existing synthesized/open fallback behavior. |
| `upgradeCharge` | Attempt the current charge file path and preserve the current fallback chain. |
| `upgradeSuccess` | Attempt the current success file path and preserve the current fallback chain. |
| `upgradeFail` | Attempt the current failure file path and preserve the current fallback chain. |
| Existing synthesized names | Preserve the exact oscillator frequencies, delays, waveforms, gains, and early returns currently used by the base `playSfx`. |
| Unknown name | Remain a no-op. |
| SFX disabled | Do not create audible sound. Preserve critical visuals and the existing per-path handling performed by the injected callbacks. |

The public function name and all current `playSfx(...)` call sites stay unchanged.

## Initialization

`src/audio-dispatcher.js` is inserted in `index.html` after `src/audio-manifest.js` and before `game.js`.

The dispatcher factory is available when `game.js` starts. Installation happens only after the callbacks needed by the final behavior are defined. No audio is expected before the page finishes executing its script chain; boot and browser-smoke coverage will protect this assumption.

If the dispatcher factory is unavailable, initialization must fail visibly during tests instead of silently installing a partial sound path.

## Error and Fallback Rules

- A mapped file must never be played twice for one `playSfx` call.
- A fallback must run at most once.
- Promise rejection from `Audio.play()` follows the existing manifest fallback behavior.
- Synchronous file construction or playback errors follow the existing fallback behavior.
- Critical visuals occur at the matching `critical` log event even if HP damage is absorbed by a shield.
- Critical playback must not throw when invoked from the final dispatcher; registered V23 and V24 callbacks retain their original IIFE closures.
- An error in one optional file path must not prevent the synthesized fallback.
- No dispatcher branch may call `playSfx` recursively.

## Testing Strategy

Development follows test-first red/green steps.

1. Add focused unit tests for the desired dispatcher API and observe failure because the module does not exist.
2. Cover synthesized delegation, unknown names, critical visual count, mapped critical count, single fallback, door routing, and all three upgrade routes.
3. Add source-boundary tests requiring one public `playSfx` implementation and forbidding versioned `playSfxV17` through `playSfxV28` assignments.
4. Preserve the existing combat-flow assertions for critical timing, shield absorption, class basics, skill sounds, quest sounds, and doubled player-hit fallback. Replace assertions tied specifically to the V25 wrapper with behavior or final-boundary assertions.
5. Run focused audio and combat tests, relevant browser smokes, then the complete baseline.

## Acceptance Criteria

- There is exactly one active `playSfx` entry point and no versioned `playSfx` wrapper chain.
- Every existing `playSfx` call site remains valid.
- Critical V23 and V24 visuals each run once at the existing log timing.
- Direct `playSfx('critical')` execution produces both visual layers without a scope error, including when SFX is disabled.
- Critical, door, and upgrade files play no more than once per request and retain their fallbacks.
- Existing synthesized sounds retain their current tone parameters and volume behavior.
- No combat balance, logs, animation timing, assets, save data, spreadsheet, or unrelated UI changes.
- Focused tests and the complete baseline pass.

## Out of Scope

- Moving floating damage, combat motion, or screen effects into a new feedback module
- Changing BGM synchronization or BGM selection
- Reassigning or renaming asset files
- Changing skill sound mappings
- Refactoring combat sequencing, input routing, persistence, or administrator features
- Removing unrelated versioned patches

## Rollback

Use the latest `backups/2026-07-16-handoff-checkpoint-final.zip` or restore only files touched by the future audio package. Do not restore the 2026-07-15 pre-audit archive over the current workspace because that would remove retained storage-safety changes.
