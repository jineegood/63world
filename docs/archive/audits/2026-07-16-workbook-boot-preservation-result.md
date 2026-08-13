# Workbook Boot Preservation Result

## Scope

Package 1 only: preserve exact present corrupt or non-array workbook storage bytes across the complete production boot script chain. No gameplay, balance, UI, audio, combat, input, asset, spreadsheet, storage-key, or script-order changes were authorized.

## TDD Evidence

The new browser smoke seeded `ysb_workbooks_v3='{broken-json'` through a harness `beforeLoad` hook before evaluating the scripts listed in `index.html`.

RED result:

- The focused Node test exited 1.
- The stored value became generated default and swamp-workbook JSON.
- The check `boot preserves exact corrupt workbook bytes` failed for the intended overwrite.

GREEN implementation:

- `readWorkbookStorage()` classifies the key as `absent`, `valid`, or `corrupt`.
- `getWorkbooks()` preserves its array-returning interface and returns normalized defaults without writing for corrupt input.
- `ensureSwampWorkbook()` returns before automatic writes for corrupt input.
- Valid and absent behavior remains on the existing path.

## Focused Verification

`try_workbook_boot_preservation.js` runs every case in a fresh jsdom instance using production script order:

- invalid JSON is byte-for-byte unchanged through boot;
- non-array JSON is byte-for-byte unchanged through boot;
- absent storage initializes defaults with one swamp workbook;
- valid storage missing a swamp workbook receives exactly one;
- valid storage already containing a swamp workbook is not rewritten or duplicated.

Result: `PASS 5/5`.

The existing player-storage smoke retained all direct-read and migration behavior: `PASS 24/24`.

## Complete Verification

- Production script syntax: 17/17 scripts from `index.html` passed.
- Safety net: 5 passed, 0 failed.
- Previously omitted unit suites: 9 passed, 0 failed.
- `npm.cmd test`: 128 passed, 0 failed in 89.4 seconds.
- Checkpoint ZIP: 93 entries, 406,808 bytes.
- Checkpoint SHA-256 verification: exact match.

## Changed Scope

Production runtime:

- `game.js` — SHA-256 `4B88B1CD94DDE1273C92D226881A3F78F1B448EFBC0348215DDF8D38D44AA50A`

Test infrastructure and coverage:

- `tools/browser-smoke/harness.js` — `180DD25ACECB84E338FC5BE220641A1E3180D930B07F8352643DDCD74E1B61AF`
- `tools/browser-smoke/try_workbook_boot_preservation.js` — `4DE1837267C8EFD82EA443998072CAA69FC81F44DA982DC73F8DA0E1EA3E4ECB`
- `tests/safety-net.test.mjs` — `5096B32551C3E127778D356820450AE2B170A179B8779BD76005FCC4A6FFCC0B`

Package documentation:

- `docs/superpowers/specs/2026-07-16-codebase-stabilization-design.md` — `A26F17A0D555C02D7CE6B9656AEA4B750BC193B05723502FB46CE940BA19CD2A`
- `docs/superpowers/plans/2026-07-16-workbook-boot-preservation.md` — `5652D000A5B9DBB36473DCD08B87D9D95CA31FEC22D4937FD146F29866DB67D6`

Checkpoint comparison found exactly three modified files that existed before implementation: `game.js`, `tools/browser-smoke/harness.js`, and `tests/safety-net.test.mjs`. The focused smoke is new. No other checkpointed runtime, source module, test, tool, or document changed during implementation.

## Recovery

- `backups/2026-07-16-pre-workbook-boot-preservation.zip`
- SHA-256: `24149ED226700154052A465EF44FA13D590920119953BC041E2D17BCC93302F1`

## Remaining S1

Corrupt player JSON is still returned as `null` and can be treated as an absent account. The next package must distinguish absent from corrupt player storage and prevent character creation from overwriting corrupt raw bytes. Administrator authorization, audio, combat, input, world, CSS, and gameplay remain separate packages.
