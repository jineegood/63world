# Player Store Boundary Implementation Plan

**Goal:** Extract player-account storage mechanics and route administrator player mutations through the same boundary without changing save format or behavior.

**Constraints:** Preserve corrupt bytes, trimmed keys, normalization, timestamps, sorting, reward behavior, and every existing browser contract. Do not touch workbooks, teacher settings, UI, gameplay, or save migration.

**Status:** Completed and verified on 2026-07-16. See `docs/audits/2026-07-16-player-store-boundary-result.md`.

## Task 1 — Recovery and contract tests

- Create a pre-package ZIP and SHA-256 manifest.
- Add `tests/player-store.test.mjs` with VM tests for keys, statuses, raw preservation, write/remove/list behavior, and failures.
- Add production source assertions that initially fail because direct player storage remains in `game.js` and `admin-dashboard.js`.

## Task 2 — Pure player store

- Create `src/player-store.js` with injected storage/prefix/normalizer dependencies.
- Load it before `game.js` and add it to the baseline syntax gate.
- Pass all pure unit tests before integration.

## Task 3 — Game and administrator integration

- Instantiate one player store after `normalizePlayer` is available.
- Convert existing player storage functions to thin delegates while preserving sorting and `updatedAt` ownership.
- Add `savePlayerRecord(player)` for exact supplied-record persistence.
- Replace the two administrator direct player writes with `savePlayerRecord(p)`.
- Keep teacher and workbook storage untouched.

## Task 4 — Runtime and recovery verification

- Run player-store unit/source tests and existing storage/corruption/admin browser smokes.
- Add the suite and syntax check to `tools/run-baseline.ps1` and `package.json`.
- Run `npm.cmd test` with zero failures.
- Record hashes and update audit/handoff documents.
- Create the post-package ZIP and SHA-256 manifest.
