# Stability and Feature-Boundary Audit Design

## Goal

Create a recoverable checkpoint of the current game and produce a read-only audit that identifies bug risks, duplicated patch chains, weak test coverage, and safe module boundaries without changing production behavior.

## Scope

- Do not modify `game.js`, `style.css`, `index.html`, gameplay data, assets, or spreadsheets.
- Create a timestamped checkpoint archive containing source, tests, tools, package metadata, and planning spreadsheets.
- Record SHA-256 hashes for the main runtime files and the checkpoint archive.
- Run the existing full test suite as the current behavioral baseline.
- Inventory top-level function declarations and versioned function reassignments in `game.js`.
- Map current responsibilities across `game.js`, `src/*.js`, tests, and browser-smoke tools.
- Rank discovered risks as S1 through S4 and recommend an implementation order.
- Produce documentation only; bug fixes and refactors require separate approval.

## Deliverables

- `backups/2026-07-15-pre-audit-checkpoint.zip`
- `backups/2026-07-15-pre-audit-checkpoint.sha256.txt`
- `docs/archive/audits/2026-07-15-stability-and-boundary-audit.md`

## Verification

- Confirm the checkpoint archive exists and can be listed.
- Confirm recorded hashes match freshly computed hashes.
- Confirm `npm.cmd test` completes successfully or record every failure in the report.
- Confirm production runtime files have unchanged hashes before and after the audit.
