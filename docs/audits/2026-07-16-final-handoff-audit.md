# 2026-07-16 Final Handoff Audit

## Scope

Read-only review of runtime source, script order, combat/FX/audio, storage/admin/data, UI/CSS/input/world, tests, browser-smoke tools, assets, generated outputs, and recovery artifacts. Documentation and the final checkpoint are the only intended writes in this handoff phase.

## Verification Snapshot

- Default runner: 127 passed, 0 failed (`npm.cmd test`, 90.6 seconds).
- Omitted unit tests: 9 passed, 0 failed (`audio-manifest` and `weapon-tier`).
- Runtime assets: 42/42 referenced; one duplicate-content pair.
- Production runtime difference from the 2026-07-15 manifest: `game.js` only.
- Repository status: `.git` directory exists but is not a valid Git repository.

## Risk Register

### S1 — Reproduced Data-Loss Defects

1. Boot-time workbook migration overwrites corrupt `ysb_workbooks_v3` bytes. `getWorkbooks()` returns defaults without writing, but `ensureSwampWorkbook()` saves them during script evaluation (`game.js:253-260`, `4264-4284`). The current smoke seeds corruption too late.
2. Corrupt player JSON is returned as `null`; login may treat it as an absent account and later overwrite the same key (`game.js:323-326`, `5253-5272`, `3102-3105`).

### S1 — Static Data-Safety Exposures

1. Administrator mutators lack internal authorization guards and include direct delete/write operations (`src/admin-dashboard.js:214-405`).
2. Storage writes are non-atomic and do not handle quota/security exceptions. Account keys can be recomputed from mutable payload names.

### S2 — Confirmed Runtime and High Regression Risks

1. `playSfx('critical')` throws `strongCriticalFeedbackV24 is not defined` because V25 crosses V23/V24 IIFE lexical boundaries (`game.js:6007`, `6239`, `6849-6856`).
2. Combat sequencing, feedback, state mutation, and scheduling remain coupled inside the monolith.
3. Multiple global keyboard listeners and world interaction wrappers depend on registration order.

### S3 — Degraded Settings and Test Reliability

1. Mapped audio reads settings through harness-only `window.__G`; real-browser mute/volume can be ignored (`src/audio-manifest.js:66-81`, `src/sfx-map.js:21-24`).
2. Two unit suites and twelve browser smokes are not in the default gate.
3. `try_feedback21.js`, `try_skills2.js`, and `try_skill.js` are not trustworthy gates.
4. jsdom stubs canvas and audio, so passing browser smokes do not verify layout pixels, clipping, decoding, or audible output.
5. Current data snapshot checks minimum shape/version, not source equivalence or freshness.

### S4 — Maintainability

1. `game.js` remains a 600 KB patch-history monolith with repeated assignments for audio, combat, HUD, world drawing, collision, and interaction.
2. `style.css` is 123 KB with generations of source-order overrides.
3. Classic-script load order is a hidden dependency boundary.
4. The workbook generator contains obsolete asset names.

## Confirmed Retained Fixes

- Pet fields survive normalization and administrator reward round trips.
- Direct invalid workbook reads are non-destructive.
- Final-boss and combat-key safety smokes are deterministic.
- Portable boot, storage, final-boss, and keyboard smokes are in the default test runner.

The direct workbook fix does not protect the boot-time migration path and is therefore only partial.

## Recommended Work Sequence

1. S1b boot-time corrupt-workbook preservation.
2. S1c corrupt-player absent/corrupt distinction.
3. Stable account key and storage exception handling.
4. Administrator mutator authorization guards.
5. Audio dispatcher plus production settings boundary.
6. Combat sequence controller.
7. Input router.
8. World interaction registry.
9. Player-store/admin consolidation.

Each item must be a separate TDD package with complete baseline and browser-smoke verification. Behavior, balance, logs, audio assignments, visual timing, data, assets, and spreadsheets are frozen unless explicitly approved.

## Recovery

Use `backups/2026-07-16-handoff-checkpoint-final.zip` and its SHA-256 manifest as the current handoff checkpoint. The earlier ZIPs remain historical baselines and must not be restored over the current workspace wholesale.
