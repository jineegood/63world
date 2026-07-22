# HUD Update Pipeline Result

## Outcome

Five versioned `updateHud` wrapper assignments and all matching `oldUpdateHud` aliases were removed. `updateHud()` now delegates through one before/core/after pipeline.

## Explicit lifecycle

1. `hud-player-fields-v27` normalizes pet, enhancement, and equipment fields.
2. `hud-skill-points-v24` removes obsolete skills, clamps ranks, and derives remaining points.
3. `hud-settings-v23` runs the legacy specialization migration.
4. `renderBaseHud()` updates DOM values/bars, specialization control, zone, audio, and quest tracker once.
5. `hud-display-v22` applies display-name normalization.
6. `hud-settings-v23` ensures one in-game settings button.
7. `hud-test-buttons-v25` ensures unique heal/cooldown development controls.

## Audit correction

The first inventory pattern found four HUD wrappers but missed `updateHudV25Buttons` because it assumed the function name ended immediately after the version number. The source-boundary test exposed it. The corrected inventory includes version suffixes: 137 assignments before this package and 132 after removing five HUD wrappers.

## Verification

- Pre-refactor browser capture: 11 passed, 0 failed.
- TDD red: pure/boundary tests failed while the browser baseline passed.
- Focused pipeline: 7 passed, 0 failed.
- Browser behavior after integration: 11 passed, 0 failed.
- Baseline: 7 passed, 0 failed.
- Player store: 8 passed, 0 failed.
- Refactor health: 10 passed, 0 failed.
- Full `npm.cmd test`: **198 passed, 0 failed** in **127.5 seconds**.

## File evidence

- `game.js`: 571,564 bytes; SHA-256 `2FB21D0B6167EF3BA809E7A0C3D88E7151117CEF8F070F094147333EFF98AF44`.
- `src/hud-update-pipeline.js`: 1,767 bytes; SHA-256 `CD58C24CC990CDA9AADC1DDE73F4A904B4938678C0C6F8A12FA710C68D2A3A18`.
- `tests/hud-update-pipeline.test.mjs`: 4,868 bytes; SHA-256 `5BE760D28854BA634989D6595238D2838F2C00973AAADF8175813EB5B002DF7C`.
- Source scan: 0 `updateHudV*` assignments and 0 `oldUpdateHudV*` aliases.

## Recovery

- Pre-change: `backups/2026-07-16-pre-hud-update-pipeline.zip`, SHA-256 `441C0E36602DA31743B34F4F3EF958433AF1A59755946EBD97A2E15FD3498E34`.
- Post-change: see `backups/2026-07-16-post-hud-update-pipeline.sha256.txt`.
