# World Interaction Registry Result — 2026-07-16

## Outcome

World interaction lookup and E-key dispatch now cross one explicit registry boundary. The final game behavior is preserved while 11 versioned lookup wrappers and 12 versioned action wrappers (23 total) are removed from the active patch chain.

## New boundary

- `src/world-interaction-registry.js` owns stable priority ordering, exclusive-map `STOP`, duplicate registration rejection, candidate resolution, and one-shot action dispatch.
- `game.js` owns game state and map-specific effects through `findBaseWorldInteractable()`, `dispatchBaseWorldInteraction(candidate)`, and one final V35 registration block.
- `getNearestInteractable()` and `interact()` are now single-line public delegates.
- `beforeDispatch` keeps tooltip cleanup exactly once per interaction attempt.

## Preserved behavior matrix

- Town: pet door, upgrade door, healing well, and all base candidates retain their order and thresholds.
- Equipment/building shops: automatic exits remain suppressed as E-key candidates.
- Pet/upgrade interiors: exit hints remain visible; E on those exits remains an intentional no-op.
- Boss room: final portal remains available.
- Final boss room: exit and teacher retain priority; empty room space is exclusive and cannot leak lower-map candidates.
- Actions: healing, pet modal, upgrade modal, base weapon shop, final portal, final exit, and teacher dialogue were exercised through the real browser script chain.

## Test evidence

- `node --test tests/baseline.test.mjs`: 7 passed, 0 failed.
- `npm.cmd run test:world-interaction-registry`: 8 passed, 0 failed.
- `node --test tests/refactor-health.test.mjs`: 10 passed, 0 failed after updating the structural assertion to the registry boundary.
- `npm.cmd test`: 167 passed, 0 failed in 107.2 seconds.

The first full run exposed one stale structural assertion expecting `return openPetShopModalV34()`. Runtime smoke already proved the new `window.openPetShopModalV34()` registry action. The assertion was updated without removing its checks for the current V34 target or forbidden legacy aliases, then the entire gate was rerun successfully.

## Verified artifacts

- `game.js`: 588,981 bytes, 11,855 lines, SHA-256 `D89F39E72C598C70FC84C847DBB44D9B393317E5E8DB4B1BC8984B23C34DB6FB`.
- `index.html`: SHA-256 `361F7E0CFD568E84712138BD6063938435908C97C6FC61EA99EBC07BB07392E6`.
- `src/world-interaction-registry.js`: SHA-256 `F09E8564FD6114DA81647C1CE7D6559E552844371C17E9E6104F9F826FBBBBE6`.
- `tools/run-baseline.ps1`: SHA-256 `E16BCE880B82A876C03CF0D636CCFB5546CE78EE184397571BFAAD504B3F1AB5`.
- `package.json`: SHA-256 `0F211B54FD220070E4875BEC16F27E79D4AE6C60EA6892185B11479234BEF0A1`.

## Scope intentionally deferred

`drawWorld`, collider selection, automatic transitions, map data, balance, UI, audio, and save formats were not changed. The next safe package is a stable player-store/admin storage boundary; drawing/collider consolidation should remain a later isolated package.

## Recovery

- Before: `backups/2026-07-16-pre-world-interaction-registry.zip`, SHA-256 `C787D837E7BB51DCDB585D447418F604487D7B9A15AD2F7E8FAE8E977ADE8C1F`.
- After: `backups/2026-07-16-post-world-interaction-registry.zip`, 125 entries / 449,790 bytes, SHA-256 `396EE24D6F54D9F5D620A1ACE5174D8E13E0376D8FD64BAC31217B2F33D8C5F3`.
