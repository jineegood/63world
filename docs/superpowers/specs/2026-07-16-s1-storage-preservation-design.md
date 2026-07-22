# S1 Storage Preservation Design

> **Status correction (2026-07-16): HISTORICAL PARTIAL EVIDENCE — DO NOT EXECUTE AS A CURRENT SPEC.** Direct `getWorkbooks()` reads preserve corrupt bytes, but the boot-time `ensureSwampWorkbook()` migration later overwrites them. See `docs/HANDOFF-2026-07-16.md` and create a new dedicated plan from its “First Task” requirements.

## Goal

Prevent two reproduced data-loss paths without changing gameplay behavior: player normalization must preserve `pets` and `activePet`, and reading corrupt workbook JSON must not overwrite the stored bytes.

## Scope

- Preserve a valid player `pets` array and `activePet` string through load, save, listing, and administrator reward updates.
- Normalize an invalid or absent `pets` value to `[]` and an invalid or absent `activePet` value to `null`.
- When the current workbook key contains invalid JSON or a parsed non-array value, return normalized defaults for the current call without writing to that key.
- Keep the existing first-run and legacy-question migration behavior when the current workbook key is absent.

## Data Flow

`normalizePlayer()` remains the single normalization boundary. It copies the two pet fields into the normalized record, so every existing consumer—including the administrator dashboard—receives and writes a complete player record.

`getWorkbooks()` distinguishes an absent current value from an invalid current value. An absent value may still run the existing migration/default initialization and persist it. An invalid present value returns normalized defaults in memory and leaves the original storage entry untouched.

## Error Handling

This package adds no backup keys and performs no automatic repair. Corrupt workbook bytes remain available for later manual or dedicated recovery. Storage quota handling, corrupt player recovery, and administrator authorization remain separate packages.

## Testing

Extend the existing real-load-order storage smoke. First prove both failures: pet fields disappear through normalization/admin reward, and corrupt workbook text is overwritten. Then make the minimum runtime changes and verify pet round trips, administrator preservation, corrupt workbook non-mutation, first-run initialization, the safety-net suite, and the full baseline.

## Out of Scope

No changes to balance, audio, combat, UI, assets, spreadsheets, administrator permissions, storage keys, or save schema versions.
