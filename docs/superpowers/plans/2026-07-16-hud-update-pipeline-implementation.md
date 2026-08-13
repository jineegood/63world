# HUD Update Pipeline Implementation Plan

**Goal:** Replace five versioned `updateHud` wrappers with one tested lifecycle pipeline without changing visible HUD behavior.

**Architecture:** Pure before/core/after orchestration; game-specific adapters stay inside their existing IIFEs.

**Tech Stack:** Classic browser JavaScript, Node test runner, `node:vm`, jsdom browser smoke, PowerShell baseline runner.

**Status:** Completed and verified on 2026-07-16. See `docs/archive/audits/2026-07-16-hud-update-pipeline-result.md`.

## Task 1: Baseline and failing tests

- [x] Capture the current browser behavior at 11/11.
- [x] Create pre-change ZIP and SHA-256.
- [x] Add pure pipeline and production-boundary tests.
- [x] Confirm RED before the module/integration exists.

## Task 2: Pipeline integration

- [x] Add `src/hud-update-pipeline.js` before `game.js`.
- [x] Rename the base body to `renderBaseHud()` and make `updateHud()` one delegate.
- [x] Register V22 display, V23 migration/settings, V24 skill-point, V25 test-button, and V27 player-field adapters.
- [x] Remove five wrappers and aliases.

## Task 3: Gates and handoff

- [x] Keep the browser capture at 11/11 and make focused tests green.
- [x] Add syntax and default-gate integration.
- [x] Run relevant focused suites and full `npm.cmd test`.
- [x] Record result, update handoff, and create post-change ZIP/SHA-256.
