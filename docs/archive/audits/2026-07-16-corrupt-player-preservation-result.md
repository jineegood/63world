# Corrupt Player Preservation Result

## Scope

Package 2 only: distinguish absent, valid, and corrupt player storage and prevent active login or character creation from overwriting corrupt raw bytes.

## TDD Evidence

The focused smoke seeded `ysb_player_손상계정='{broken-json'` before production scripts.

RED showed the reproduced defect:

- active login entered the character creator;
- direct activation of `createCharacterBtn` replaced the corrupt bytes with a new player object;
- runtime `game.player` became the new character;
- the focused Node test exited 1 with three intended assertion failures.

GREEN added `readPlayerStorage(name)` with explicit `absent`, `valid`, and `corrupt` results. `loadPlayer(name)` retains its player-or-null compatibility. The final V20 login function and create button both block corrupt storage before navigation or writes.

## Focused Verification

The production-shaped player-corruption smoke uses isolated jsdom storage and verifies:

- corrupt login plus direct creation preserves exact bytes;
- absent accounts still reach creation and save one account;
- valid matching credentials enter the game with stable identity;
- wrong credentials do not enter game or creator and do not write.

Result: `PASS 4/4` with clean output.

The storage smoke verifies absent and valid states plus invalid JSON, JSON null, arrays, strings, numbers, and booleans as corrupt without mutation. Result: `PASS 32/32`.

## Complete Verification

- Production script syntax: 17/17.
- Safety net: 6 passed, 0 failed.
- Previously omitted unit suites: 9 passed, 0 failed.
- `npm.cmd test`: 129 passed, 0 failed in 94.7 seconds.
- Checkpoint: 96 entries, 413,318 bytes, SHA-256 verified.

## Changed Scope

- `game.js` — `A99C6E639E125D8A1ACE627099AC79CDFA4C6CC1192957B13A1A34C24AF25175`
- `tools/browser-smoke/try_player_storage.js` — `1A7959D11073A603F0BF1D812FB223C759B8C4D21CD9550A4900C00B8DF659E0`
- `tools/browser-smoke/try_player_corruption_preservation.js` — `8B292374DBD4556C8E0AAADDA3B0ACD11027F69DECCD93F33D265B50A9C9AF97`
- `tests/safety-net.test.mjs` — `6A8F454BE7E5B060013BF85F5CAE1CB4E2FB99938057A637D4FCF3C267806047`
- `docs/superpowers/plans/2026-07-16-corrupt-player-preservation.md` — `BE8EC359A052ED926A3051E682FDDA7929979D074CCE0D49D7AE1E90ED65AAEA`

Checkpoint comparison found four modified pre-existing files: `game.js`, `try_player_storage.js`, `tests/safety-net.test.mjs`, and the Package 2 plan correction. The focused smoke and this result are new. `game.js` is the only changed production runtime file.

## Recovery

- `backups/2026-07-16-pre-corrupt-player-preservation.zip`
- SHA-256: `7C50FD5247CDD2A3A6099C9473DADD45E254BACEE8BCBCB146625389B6AA66DB`

## Remaining Work

Both reproduced corrupt-storage overwrite paths are now protected. Storage quota/security handling, stable account identity, and administrator authorization remain separate packages. The confirmed critical-audio scope error and production audio-settings boundary also remain unfixed.
