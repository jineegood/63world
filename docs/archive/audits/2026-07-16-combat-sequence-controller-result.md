# Combat Sequence Controller Result

## Outcome

Combat queue lifecycle is now owned by `src/combat-sequence-controller.js`. The controller centralizes generation tokens, active state, timer cancellation, combat-identity validation, transient reset, queue completion, invalidation, and post-sequence defeat/revive delays.

Event sorting, damage/status mutation, rendering, FX, audio, notice timing, balance, data, and save behavior remain in their original owners.

## Regression found during extraction

The first integration captured the browser timer function during controller creation. Existing browser smokes replace `window.setTimeout` after boot to accelerate deterministic combat, so captured timers caused sequence timeouts. The controller now dynamically resolves `window.setTimeout`/`window.clearTimeout` at scheduling time.

The audit also found two defeat/revive delays that intentionally run after the active queue becomes inactive but must remain bound to the same generation and monster. They are represented explicitly by `controller.defer()` and are cancelled by queue replacement or invalidation.

## Verification

- Controller unit/structure tests: 7 passed, 0 failed.
- Focused combat controller/rules/flow/FX bundle: 94 passed, 0 failed in 43.8 seconds.
- Full `npm.cmd test`: **152 passed, 0 failed** in 96.9 seconds.
- Existing browser smokes passed unchanged for escape re-entry, poison-last ordering, per-event state timing, multi-hit cancellation, skill-status cancellation, FX failure fallback, Guardian Oath revival, and final boss flow.

## Runtime hashes

- `game.js` — `D376DBCC7BF4AFA9E1F6C7D6302C2045804B46903062102414773CA5EC533DE1`
- `index.html` — `5B21DFCA457A3220A007F91ABB3080A1A22D02C842EADCBD30373B68F0A5E0B1`
- `src/combat-sequence-controller.js` — `7B055FCFD7115DDDC320005484DFFD14CB9E2DEF0D0C7D936B4473C1750DBCA4`
- `tools/run-baseline.ps1` — `EF7AF976DC976A6A917BF4AB7FDBCBC4E8AEE425678FA4B5E45D7D17BE7F1DAB`
- `package.json` — `81C9CB870FAC0709DA8CCD5A3A273E8C10D8AD73D6AB41BED60904445CD2B135`

## Recovery

- Before package: `backups/2026-07-16-pre-combat-sequence-controller.zip`
- Before SHA-256: `D3E25334454AD71122A09D665D955F056D3D252526C8904624C4A767992D7084`
- Final: `backups/2026-07-16-post-combat-sequence-controller.zip`
- 112 entries, 433,090 bytes
- Final SHA-256: `0B9B319983003FA5059133203EA40D1AB7D26B887A18E7929083EF2731E179CE`
