# Combat Frame Pipeline Result

## Outcome

Five versioned `renderCombatFrame` wrappers and their aliases were removed. Combat frames now use one base renderer followed by an explicit, ordered post-render pipeline.

## Preserved final behavior

1. The base renderer creates the combat modal, status badges, HP bars, sprites, and caller content once.
2. V20 still searches for the historical `.combat-scene`; current markup has no such element, so it remains a no-op.
3. V23 applies its older numeric highlighting.
4. V25 intentionally replaces the same heading with player/enemy/generic V25 number classes.
5. V26 temporarily adds map and teacher background classes.
6. V27 removes those temporary classes and leaves `combat-layout-rollback-v27`.

The missing-target edge case is also unchanged: the base renderer returns early, while outer post-hooks can still rewrite an already-open combat heading without replacing the frame.

## Verification

- Pre-change browser behavior capture: 11 passed, 0 failed.
- Expected RED: browser capture passed while 6 missing-module/boundary tests failed.
- Focused combat-frame pipeline: 7 passed, 0 failed.
- Combat entry pipeline: 8 passed, 0 failed.
- Combat flow: 43 passed, 0 failed.
- Combat FX: 26 passed, 0 failed.
- Safety net: 7 passed, 0 failed.
- Full default gate: **220 passed, 0 failed** in **150.2 seconds**.

## File evidence

- `game.js`: 571,928 bytes; SHA-256 `23656DD265542B4D0D7CA7700F78E5D8D6EA349E5C12220B7367DEE032C24ABF`.
- `src/combat-frame-pipeline.js`: 1,380 bytes; SHA-256 `934A81B489BF757209ECE8DD88E11DC3859A0DCBB1A91793DE7E5CD406379547`.
- `tests/combat-frame-pipeline.test.mjs`: 5,053 bytes; SHA-256 `FB11B907D7974011F40E89BF31B6FB28A1C3774CCF5E81C21DE3B4AFBFA30DF1`.
- Remaining versioned function assignments: 121.
- Source scan: 0 `renderCombatFrameV*` assignments and 0 `oldRenderCombatFrameV*` aliases.

## Recovery

- Pre-change: `backups/2026-07-16-pre-combat-frame-pipeline.zip`, SHA-256 `ECF680DD7C710BD02768BD1D56E0B0540FEE239B8A62F2604976A596C1AC7FFE`.
- Post-change: see `backups/2026-07-16-post-combat-frame-pipeline.sha256.txt`.
