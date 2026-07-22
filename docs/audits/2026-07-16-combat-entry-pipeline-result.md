# Combat Entry Pipeline Result

## Outcome

Three versioned `openCombat` wrappers and their aliases were removed. Combat entry now crosses one explicit middleware boundary before the base initialization.

## Preserved execution order

1. V25 invalidates the previous combat sequence and clears residue on a living positive-HP target.
2. V24 stops entry while paused; otherwise it clears held key state.
3. V22 resets escape failure and escape-resolution state.
4. The base entry validates the target and initializes ailments, statuses, identity, action, shield, buffs, HP display, sound, and the combat menu.

This intentionally preserves the legacy paused-entry behavior: sequence invalidation and target cleanup still occur before the pause short-circuit, while key, escape, identity, and modal state remain untouched.

## Verification

- Pre-change browser behavior capture: 12 passed, 0 failed.
- Expected RED: browser capture passed while 7 missing-module/boundary tests failed.
- Focused combat-entry pipeline: 8 passed, 0 failed.
- Combat sequence controller: 7 passed, 0 failed.
- Combat flow: 43 passed, 0 failed.
- Safety net: 7 passed, 0 failed.
- Full default gate: **213 passed, 0 failed** in **150.5 seconds**.

## File evidence

- `game.js`: 571,967 bytes; SHA-256 `F67693220D66E6A8FE1DA6D1E66E7F91C37840AF833DB5D9B57785C8566B91F5`.
- `src/combat-entry-pipeline.js`: 1,630 bytes; SHA-256 `53385C97831EADE00855172CFD9CB4BE612285F396523A5CE45C14514CC421AC`.
- `tests/combat-entry-pipeline.test.mjs`: 5,218 bytes; SHA-256 `D6DF220D14D618261B2FE9AD09422928972141648F8C103EA864800563C99772`.
- Remaining versioned function assignments: 126.
- Source scan: 0 `openCombatV*` assignments and 0 `oldOpenCombatV*` aliases.

## Recovery

- Pre-change: `backups/2026-07-16-pre-combat-entry-pipeline.zip`, SHA-256 `D931B9B1A9220AA32C8706F8A84F47FF5567FB111171D15D822B2522B1C6FBF2`.
- Post-change: see `backups/2026-07-16-post-combat-entry-pipeline.sha256.txt`.
