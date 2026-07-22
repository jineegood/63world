# Audio Volume Pipeline Design

## Scope

Replace the six versioned `updateAudioVolumes` wrappers (V20, V21, V22, V25, V28, and V33) with one explicit post-update pipeline. Preserve current lazy initialization, object identity, volume clamping, and execution order. Do not modify `resumeAudio`, `getDesiredAudioFile`, audio playback, asset mappings, settings values, or save data.

## Existing order and observable behavior

1. The base update changes the WebAudio BGM gain and town/forest/desert file volumes when `bgmGain` exists.
2. V20 initializes the swamp BGM and applies the BGM file volume.
3. V21 initializes the boss BGM and applies the BGM file volume.
4. V22 changes the door SFX volume only when `doorFile` already exists; it does not create the file.
5. V25 initializes the critical SFX and applies the SFX volume.
6. V28 initializes charge/success/failure upgrade SFX files and applies the SFX volume.
7. V33 initializes the pet summon SFX, replaces V28 success/failure objects once using V33 markers, and reapplies their SFX volume.

Repeated updates reuse initialized objects. Disabled BGM/SFX settings set their respective volumes to zero. File volumes are clamped to 0..1; the existing WebAudio gain target remains the raw configured BGM value.

## Selected architecture

Create `src/audio-volume-pipeline.js` with a browser-global, runtime-independent factory:

```js
const pipeline = YuksamAudioVolumePipeline.create({ update });
const unregister = pipeline.register({ id, priority, after });
const result = pipeline.update(context);
```

`update(context)` calls the base updater exactly once, then executes `after(context)` hooks by ascending priority and stable registration order. Duplicate IDs and entries without an ID or handler are rejected. Base and hook errors remain visible.

`game.js` registers existing patch bodies at priorities 200, 210, 220, 250, 280, and 330. All game state, `Audio`, and asset dependencies remain in `game.js`.

## Alternatives rejected

- Directly merging all audio files into the base function obscures V33 replacement ownership and makes later audio patches harder to isolate.
- Combining volume, resume, and desired-BGM selection creates a broad audio lifecycle refactor with substantially higher regression risk.

## Testing

- Pure tests cover order, stable ties, unregister, duplicate IDs, return values, snapshots, and surfaced errors.
- A real jsdom browser capture supplies a deterministic gain spy and checks lazy creation, V33 replacement markers, door non-creation, idempotent object reuse, BGM/SFX enable states, clamping, and async errors.
- A production boundary test requires one pipeline instance and rejects versioned `updateAudioVolumes` assignments and aliases.
- Focused audio manifest/dispatcher/SFX, safety-net, and the complete default gate protect integration.

## Recovery

Create pre- and post-package ZIP files with SHA-256 manifests. This workspace is not a usable Git repository, so reset, checkout, and commit operations are not allowed.
