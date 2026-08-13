# World Render Pipeline Implementation Plan

**Goal:** Replace 11 versioned world-render wrappers with one tested owner/layer pipeline without changing final V35 behavior.

**Architecture:** A dependency-free registry selects one map owner and then runs ordered post-render layers. Canvas behavior remains in `game.js`; only composition ownership moves.

**Tech Stack:** Classic browser JavaScript, Node test runner, `node:vm`, jsdom browser smoke, PowerShell baseline runner.

**Status:** Completed and verified on 2026-07-16. See `docs/archive/audits/2026-07-16-world-render-pipeline-result.md`.

## Constraints

- Preserve the final V35 render order for base maps, both shop interiors, and the final boss room.
- Preserve V34 follower and V35 legendary pet behavior.
- Do not change navigation, interactions, world data, visuals, audio, balance, or saves.
- Use ZIP/SHA-256 recovery points because the workspace is not a usable Git repository.

### Task 1: Capture and pure pipeline

- [x] Create the pre-change ZIP and SHA-256 manifest.
- [x] Add failing unit/source-boundary tests for owner selection, layer order, and wrapper removal.
- [x] Confirm the focused suite is red.
- [x] Implement `src/world-render-pipeline.js` and make its pure tests green.

### Task 2: Production integration

- [x] Load the pipeline before `game.js` and create one registry instance.
- [x] Fold swamp and null-player handling into the base renderer.
- [x] Convert V33/V34 shops and ordinary pet composition into explicit registrations.
- [x] Convert V35 final-room and legendary-pet composition into explicit registrations.
- [x] Remove all 11 historical `drawWorld` wrappers and aliases.

### Task 3: Runtime and regression verification

- [x] Add a real-browser render smoke for representative maps and null-player safety.
- [x] Add the focused suite and syntax check to `tools/run-baseline.ps1` and `package.json`.
- [x] Run focused world, boot, safety-net, and full default gates.

### Task 4: Handoff and recovery

- [x] Record exact results in an audit document.
- [x] Update the Claude-ready handoff with the new boundary and next development target.
- [x] Create the post-change ZIP and SHA-256 manifest.
