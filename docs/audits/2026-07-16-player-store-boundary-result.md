# Player Store Boundary Result — 2026-07-16

## Outcome

All player-account storage mechanics now cross one injected, pure boundary. Gameplay saves and both authenticated administrator reward paths use the same key and serialization implementation without changing the save format.

## Changes

- Added `src/player-store.js` with `key`, `read`, `load`, `list`, `write`, and `remove` operations.
- Preserved trimmed `ysb_player_` keys and exact supplied JSON payloads.
- Preserved explicit absent/valid/corrupt classification and byte-for-byte corrupt data retention.
- Kept normalization on reads, existing UI sorting, and gameplay-owned `updatedAt` behavior.
- Converted `game.js` storage functions to thin compatibility delegates.
- Replaced two administrator `localStorage.setItem(playerKey(...))` writes with `savePlayerRecord(p)`.
- Left teacher settings and workbook migration untouched because their validation and fallback contracts differ.

## Test evidence

- Initial TDD run: 0/8 passed because the module and integration did not exist.
- Pure/source boundary after implementation: 8/8 passed.
- Existing real-browser safety net: 7/7 passed, including save/reload, administrator rewards, corrupt player bytes, boot, final boss, and input routing.
- Baseline contract: 7/7 passed.
- `npm.cmd test`: **175 passed, 0 failed** in 109.2 seconds.

## Verified artifacts

- `game.js`: 588,513 bytes, 11,844 lines, SHA-256 `CEB33A29CD7584947515265E1ACBBCFEA287C2059A75784E4450C4B384622C36`.
- `index.html`: SHA-256 `483DE944F934798F6E32622896E5D84E512412B4FC15CBAE845B24AC4838A16B`.
- `src/player-store.js`: SHA-256 `3E1478122D796BF34F633F8BA1A65C4DA9AA15C369CEA857980B03EE1614D303`.
- `src/admin-dashboard.js`: SHA-256 `F381616E0F5C412D90C3995D70B883088CAC644695F48CDB535E3547677A322A`.
- `tools/run-baseline.ps1`: SHA-256 `F66B40B8C284DDECC1E4D2CA8F5053A7BCA1D0FDDB99E59F76071BE529EB3FCB`.
- `package.json`: SHA-256 `6C99ECA47EB3C24BA5053509466CDF53D1E57ABBE87EFD879FC9E33637306596`.

## Recovery

- Before: `backups/2026-07-16-pre-player-store-boundary.zip`, 452,885 bytes, SHA-256 `A42607347F0728CA33DB1B190D15762E04C3C62A6C28068AAFDAE33AC805084C`.
- After: `backups/2026-07-16-post-player-store-boundary.zip`, 457,161 bytes, SHA-256 `066D0B4861AB0E41EECFCB534A25EB4975F83103340B864B5373CF3F9B10F058`.
