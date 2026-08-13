# Audio Volume Pipeline Result

## Outcome

Six versioned `updateAudioVolumes` wrappers and their aliases were removed. Audio volume updates now use one base updater followed by an explicit ordered pipeline.

## Preserved behavior

1. The base updater changes the WebAudio BGM target plus town/forest/desert file volumes.
2. V20 lazily initializes and updates swamp BGM.
3. V21 lazily initializes and updates boss BGM.
4. V22 updates an existing door file but does not create one.
5. V25 lazily initializes and updates critical SFX.
6. V28 lazily initializes charge/success/failure upgrade SFX.
7. V33 lazily initializes pet summon SFX, replaces success/failure objects once, and marks the replacement.

Repeated updates reuse the initialized objects. BGM and SFX disable states, file clamping, and the raw WebAudio BGM target policy are unchanged.

## Verification

- Pre-change browser behavior capture: 12 passed, 0 failed.
- Expected RED: browser capture passed while 6 missing-module/boundary tests failed.
- Focused audio-volume pipeline: 7 passed, 0 failed.
- Audio manifest: 5 passed, 0 failed.
- Audio dispatcher: 5 passed, 0 failed.
- SFX map: 4 passed, 0 failed.
- Combat flow: 43 passed, 0 failed.
- Safety net: 7 passed, 0 failed.
- Full default gate: **227 passed, 0 failed** in **156.4 seconds**.

## File evidence

- `game.js`: 571,910 bytes; SHA-256 `4108821BAA45DC95AE11BF16F810BE04CE4BAA675B968AB76363F703E55D95C7`.
- `src/audio-volume-pipeline.js`: 1,380 bytes; SHA-256 `FAB688BD49B6AF212A3EED13386C3F6B30128B172E2D985483C34C3322AFD8A2`.
- `tests/audio-volume-pipeline.test.mjs`: 5,052 bytes; SHA-256 `B5D2E6784180AB62A35B6CD6640365D01AB2471413B294458F2B4AA58130B0DB`.
- Remaining versioned function assignments: 115.
- Source scan: 0 `updateAudioVolumesV*` assignments and 0 `oldUpdateAudioVolumesV*` aliases.

## Recovery

- Pre-change: `backups/2026-07-17-pre-audio-volume-pipeline.zip`, SHA-256 `B01E3E438C747CD1ED2D0FC0E3CBC94343B943F6DBCBFB857B1A2713F056D72D`.
- Post-change: see `backups/2026-07-17-post-audio-volume-pipeline.sha256.txt`.
