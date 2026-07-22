# Total Stats Pipeline Implementation Plan

**Goal:** Replace three total-stat wrappers with one deterministic calculation pipeline.

**Architecture:** Newest preparation before one base calculation; historical modifiers afterward in explicit ascending order.

**Status:** Completed and verified on 2026-07-16. See `docs/audits/2026-07-16-total-stats-pipeline-result.md`.

## Task 1: Baseline and RED

- [x] Capture current valid-player behavior at 13/13.
- [x] Add the legacy first-call regression and confirm it fails.
- [x] Create design, plan, pre-change ZIP, and SHA-256.
- [x] Add pure/source tests and confirm RED.

## Task 2: Integration

- [x] Add and load `src/total-stats-pipeline.js`.
- [x] Rename the base calculator and make `computeTotalStats()` one delegate.
- [x] Register cumulative V19 and V23 specialization modifiers.
- [x] Register V27 preparation plus pet/enhancement modifier.
- [x] Remove three wrappers and aliases.

## Task 3: Verification and handoff

- [x] Reach 14/14 browser checks and focused GREEN.
- [x] Add syntax/default-gate integration.
- [x] Run stat-adjacent focused suites and full test gate.
- [x] Document results, update handoff, and create post-change ZIP/SHA-256.
