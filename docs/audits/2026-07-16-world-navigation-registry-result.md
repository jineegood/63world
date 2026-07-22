# World Navigation Registry Result — 2026-07-16

## Outcome

Collider lookup, movement permission, and automatic map transitions now cross one explicit navigation registry. Seven collider wrappers, six automatic-transition wrappers, and one movement wrapper were removed from the active patch chain.

## Preserved behavior

- Town retains 19 unique collision shapes: base buildings/NPC/trees, healing well, pet shop, and upgrade shop.
- Two historical duplicate town building rectangles were removed; boolean movement results are unchanged.
- Forest, desert, and swamp retain 26, 20, and 28 colliders respectively.
- Pet and upgrade interiors retain their final V34 five- and four-shape lists.
- Boss and final rooms retain empty collider lists; the boss ellipse still constrains movement.
- Player collision radius remains 30.
- All automatic transition thresholds remain strict `< 42`.
- Pet/upgrade entries and exits retain V33 behavior; equipment/building exits retain V23 return positions and door feedback.
- Missing player, active transition lock, and final-boss room remain exclusive no-op states.

## Architecture

- `src/world-navigation-registry.js` owns stable priority, duplicate-ID rejection, collider ownership including empty arrays, transition one-shot dispatch, and unregister callbacks.
- `getBaseMapColliders()` retains base geometry and deterministic outdoor scatter rules.
- `getCurrentMapColliders()` and `checkAutoTransitions()` are single delegates.
- `canPlayerMoveTo()` now performs only the boss ellipse check and one resolved collider-list check.
- Map state, coordinates, SFX, HUD, save, and transition side effects remain in `game.js`.

## Test evidence

- Pre-refactor real-browser behavior capture: 30 passed, 0 failed.
- Initial TDD suite: 1/8 passed; module and production boundary tests failed as expected.
- Focused navigation suite after integration: 8/8 passed.
- Cross-boundary interaction/input/storage/safety suites: 28/28 passed.
- Final `npm.cmd test`: **183 passed, 0 failed** in 114.7 seconds.

## Verified artifacts

- `game.js`: 581,162 bytes, 11,671 lines, SHA-256 `4B09D2330C7129666F59DB3AA6F089DADEEDD60DF8F9DB2DF1154CAE9528C81E`.
- `index.html`: SHA-256 `32D02A4F6BBB4B5F906E4686E7C20226C04F3A2439660963C04EF9FB4302F05C`.
- `src/world-navigation-registry.js`: SHA-256 `583341A95F609A1163547179EED8B7E3D09C55F75AC28CB06AF7F7C2570C7900`.
- `tools/run-baseline.ps1`: SHA-256 `275B1C0175AAB863C27A4CC0E5ACD102536F26C0A0CB52528C0A92979C4BD21F`.
- `package.json`: SHA-256 `FB52F8FC74DBC680D712C03E8FD6231F442925BFCA7640243E29D00E5B6BDFD3`.

## Recovery

- Before: `backups/2026-07-16-pre-world-navigation-registry.zip`, 462,295 bytes, SHA-256 `891CC242A7B3A222C6B83864298DF8EC5FD49F831F16D9E9BF2A5C3EDD42749E`.
- After: `backups/2026-07-16-post-world-navigation-registry.zip`, 466,973 bytes, SHA-256 `890F63D817991ADEA5AF10E66B0DA071B1CA0044972A03C34B8C2408EEF4987F`.

## Next package

`drawWorld` still has 11 active wrappers (V17, V21, V26, V27, V29–V35). Capture render-call order per map first, then replace the chain with explicit map render ownership and ordered overlay layers. Do not combine this with geometry or gameplay changes.
