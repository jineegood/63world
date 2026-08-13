# World Render Pipeline Result

## Outcome

The 11 versioned `drawWorld` wrapper assignments and all `oldDrawWorld` aliases were removed. `drawWorld()` now delegates through one `YuksamWorldRenderPipeline` instance with explicit owners and ordered layers.

## Runtime ownership

- Base owner: town, forest, desert, swamp, boss room, equipment shop, and building shop; one player/aura/speech/nameplate stack.
- `upgrade-shop-v33`: upgrade-shop background.
- `shops-v34`: pet-shop background.
- `shop-actors-v34`: one V34 pet/player/nameplate stack for both new interiors.
- `pet-follower-v34`: ordinary-map pet follower after base rendering.
- `final-boss-room-v35`: exclusive final-room renderer.
- `legendary-pet-v35`: final post-layer for the legendary yuksam pet outside the final room.

## Bugs removed

1. The V34 upgrade-shop branch used `typeof drawUpgradeShopInteriorV33` across separate IIFEs. That identifier was not visible, so it called the entire V33 wrapper and then drew the V34 pet/player/nameplate again. The new owner/layer split renders the background and actor stack once.
2. Base rendering now exits before camera/map code when no player exists, avoiding a null-coordinate exception during abnormal boot or teardown frames.

## Tests

- TDD red: 7/7 new tests failed before the module/integration existed.
- Focused pipeline: 8 passed, 0 failed.
- Browser render checks: 22 passed, 0 failed across seven base maps, both new interiors, final room, and null-player safety.
- Navigation registry: 8 passed, 0 failed.
- Interaction registry: 8 passed, 0 failed.
- Baseline boot: 7 passed, 0 failed.
- Safety net: 7 passed, 0 failed.
- Full `npm.cmd test`: **191 passed, 0 failed** in **119.8 seconds**.

## File evidence

- `game.js`: 571,383 bytes; SHA-256 `05A2EC2505FB38E245B49696361A23069355D34E2874F26F4DCD3CC9D167BCC1`.
- `src/world-render-pipeline.js`: 2,091 bytes; SHA-256 `4BE442090828B40810BAE067CADE5A278184A8EDAF6EC25B792587D1329B1601`.
- `tests/world-render-pipeline.test.mjs`: 5,578 bytes; SHA-256 `02C4880A16B4B650D03FA1796B63F830FA54F3D7B785B20547C37203788864E5`.
- Source scan: 0 versioned `drawWorld` assignments; 0 `oldDrawWorld` aliases.

## Recovery

- Pre-change: `backups/2026-07-16-pre-world-render-pipeline.zip`, SHA-256 `349AAB38DD5C6D276641C9B896C31F22E9C75B9636F85F1A63B18EA8AC50FCDA`.
- Post-change: see `backups/2026-07-16-post-world-render-pipeline.sha256.txt`.
