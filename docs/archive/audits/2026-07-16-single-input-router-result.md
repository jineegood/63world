# Single Input Router Result

## Outcome

Eight order-dependent global keyboard listeners were migrated to one explicit `YuksamInputRouter`. Production now installs exactly one capture `keydown` listener and one capture `keyup` listener. Existing context handlers register with stable priorities and retain their original actions and `preventDefault`/propagation behavior.

The local chat-input Enter listener remains local by design.

## Preserved context order

- Tooltip Escape observes first and falls through.
- World map owns its navigation and enter keys.
- Dialogue and boss confirmation own E in their modal types.
- Combat owns Escape and blocks generic close.
- V26-owned modal choices precede core and generic modal handlers.
- Core world controls precede generic modal navigation.
- Generic modal E retains its 300 ms open grace period.
- Keyup releases movement even after the active context changes.

## Verification

- Router unit/structure/browser suite: 5 passed, 0 failed.
- Focused input/combat/safety bundle: 55 passed, 0 failed in 43.7 seconds.
- Existing combat keyboard smoke: 14 passed, 0 failed.
- Boot smoke: 9 passed, 0 failed.
- Full `npm.cmd test`: **157 passed, 0 failed** in 98.2 seconds.

The new real-browser smoke verifies one-owner world-map E, one combat Escape attempt, one generic-modal E click, typing isolation, and movement release across a modal transition.

## Runtime hashes

- `game.js` — `B60F171D1F7CFAFFC5FE98F3261B1CF1E4406A7303BBE5A031E4A3E287BCFDB4`
- `index.html` — `0E2FCCD1040BF04979F3C51F65FE2E7228025A76E5D37AB9C06A5B6C7AD519E9`
- `src/input-router.js` — `0B4E00DE29DB309B82EE1A41114209C074D70D556AF9EEBB36EA83BFD222E4AB`
- `src/combat-keys.js` — `719595E8E743DC7F1D4B97759F7C265E1E1D27EDE2F3FA05EFD9EAF266867104`
- `tools/run-baseline.ps1` — `F795D11D5BBAD2EB5E3C0329C9A977EFFBCAB7CD3F44493A754378FF9766EDBD`
- `package.json` — `5CAE4A1666DACDF7205392FC0B79B69C9742BF2D8D846A3D6330B8B8120FC974`

## Recovery

- Before: `backups/2026-07-16-pre-single-input-router.zip`
- Before SHA-256: `118039D0DC00808C7AA253F484D33E7C3B73792AE273612BC73E28BFE5A09FCF`
- Final: `backups/2026-07-16-post-single-input-router.zip`
- 119 entries, 441,853 bytes
- Final SHA-256: `BECD5512BEDC4437FC5286DB0D72B1C68B4DD9AD7F63BF12773C8DF179C97484`
