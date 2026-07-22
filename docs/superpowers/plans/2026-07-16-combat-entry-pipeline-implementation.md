# Combat Entry Pipeline Implementation Plan

**Goal:** Replace three combat-entry wrappers with one tested middleware boundary.

**Architecture:** Descending-priority middleware reproduces V25 → V24 → V22 → base, including paused short-circuit placement.

## Task 1: Baseline and RED

- [ ] Capture valid, paused, and invalid entry behavior at 12/12.
- [ ] Create design, plan, pre-change ZIP, and SHA-256.
- [ ] Add pure, browser, and source-boundary tests.
- [ ] Confirm RED before module/integration.

## Task 2: Integration

- [ ] Add and load `src/combat-entry-pipeline.js`.
- [ ] Rename base entry and make `openCombat()` one delegate.
- [ ] Register V22 escape reset, V24 pause/key guard, and V25 sequence/monster preparation.
- [ ] Remove three wrappers and aliases.

## Task 3: Verification and handoff

- [ ] Keep browser behavior at 12/12 and focused tests green.
- [ ] Add syntax/default-gate integration.
- [ ] Run combat-adjacent and full gates.
- [ ] Document results, update handoff, and create post-change ZIP/SHA-256.
