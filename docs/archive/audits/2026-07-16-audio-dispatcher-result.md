# Audio Dispatcher Consolidation Result

## Outcome

The seven order-dependent `playSfx` wrappers were replaced by one injected dispatcher without changing sound assignments, oscillator values, combat timing, visual layers, or balance. The confirmed `strongCriticalFeedbackV24 is not defined` runtime failure is resolved.

The production SFX settings boundary is now explicit: mapped audio reads `window.getYuksamAudioSettings?.()` installed by `game.js`, not the jsdom-only `window.__G` object.

## Verification

- Focused audio/combat/refactor suites: 67 passed, 0 failed in 43.8 seconds.
- Full `npm.cmd test`: 145 passed, 0 failed in 96.8 seconds.
- Real script-chain smoke verifies both critical visual layers while muted and one mapped call when enabled.
- The default runner syntax-checks `src/audio-dispatcher.js` and always runs its five tests.

## Runtime file hashes

- `game.js` — `9CF4C95B80D7E00FB02CE09F4D44B05A2B2F7813377BF57E60D9B574C98E2E14`
- `index.html` — `33685FA21A8F327E986CEBF0B9F7F2E086F4AE7DC9FC6C6EB205444C1D8E90CE`
- `src/audio-dispatcher.js` — `AF96254D53763DF0BC77605579C4A202F3B5EA063804FF91B461FE2AECE64082`
- `src/audio-manifest.js` — `75C93462581058CE92E808168BDFE560BAC606CF73016BCDFEC9E84C8710CD24`
- `src/sfx-map.js` — `C66D2E57B7FB45E9277784A3B6755ABEDC1027E196A5FEFAA960158FAD795F41`

## Supporting changes

- Added `tests/audio-dispatcher.test.mjs` and `tools/browser-smoke/try_audio_dispatcher.js`.
- Updated stale V25 source-shape assertions to protect the dispatcher behavior boundary.
- Added script-order, single-dispatcher, and explicit critical-adapter health assertions.
- Added `test:audio-dispatcher` and default-gate integration.

## Remaining risk

The audio path is structurally closed, but `game.js` still contains large order-dependent wrapper chains in combat, input, world interaction, rendering, HUD, and stat calculation. The next isolated package is the combat sequence controller boundary.

## Recovery

- `backups/2026-07-16-post-audio-dispatcher.zip`
- 107 entries, 426,191 bytes
- SHA-256 `B8EC10428BD6211FA6735C053F8872876CDDE41AEB54A1A0107E3AA6D3F5A404`
