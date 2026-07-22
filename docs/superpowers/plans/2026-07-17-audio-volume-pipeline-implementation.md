# Audio Volume Pipeline Implementation Plan

> **For agentic workers:** Execute inline in the authoritative workspace. Do not use Git reset or checkout; use ZIP/SHA-256 checkpoints.

**Goal:** Replace six nested audio-volume wrappers with one tested ordered boundary while preserving every current audio object and volume rule.

**Architecture:** A pure browser-global module owns deterministic after-hook ordering. `game.js` retains the base updater and every game/Audio-specific initializer.

**Tech Stack:** Browser JavaScript, Node test runner, jsdom browser-smoke harness, PowerShell baseline runner.

## Global Constraints

- Preserve V20/V21/V22/V25/V28/V33 order exactly.
- Do not modify `resumeAudio`, `getDesiredAudioFile`, playback, mappings, or settings persistence.
- Do not add dependencies.
- Use `apply_patch` for text edits and ZIP/SHA-256 for recovery.

---

### Task 1: Freeze current runtime behavior

**Files:**
- Create: `tools/browser-smoke/try_audio_volume.js`
- Create: `tests/audio-volume-pipeline.test.mjs`

**Interfaces:**
- Consumes: current `updateAudioVolumes()` and browser audio state.
- Produces: deterministic runtime assertions and the desired pipeline API.

- [ ] Install a gain spy and controlled audio state in the browser harness.
- [ ] Assert BGM initialization/volumes, SFX initialization/volumes, V33 replacement markers, door non-creation, idempotency, disabled states, and clamping.
- [ ] Write pure ordering and validation tests plus the production-boundary test.
- [ ] Run `node --test tests/audio-volume-pipeline.test.mjs`; require the browser capture to pass and missing-module/boundary assertions to fail.

### Task 2: Implement the volume boundary

**Files:**
- Create: `src/audio-volume-pipeline.js`
- Modify: `index.html`
- Modify: `game.js`

**Interfaces:**
- Consumes: `create({ update(context) })` and registrations shaped as `{ id, priority, after(context) }`.
- Produces: `audioVolumePipeline.update({ settings, audio })` through one public `updateAudioVolumes()` delegate.

- [ ] Implement ascending stable after-hook execution with snapshot semantics, duplicate-ID validation, and unregister support.
- [ ] Load the module before `game.js`.
- [ ] Rename the base updater and add the single delegate.
- [ ] Convert V20/V21/V22/V25/V28/V33 wrapper bodies to registrations at priorities 200/210/220/250/280/330.
- [ ] Run syntax and focused tests until all assertions pass.

### Task 3: Integrate, verify, and recover

**Files:**
- Modify: `package.json`
- Modify: `tools/run-baseline.ps1`
- Create: `docs/audits/2026-07-17-audio-volume-pipeline-result.md`
- Modify: `docs/HANDOFF-2026-07-16.md`
- Create: `backups/2026-07-17-pre-audio-volume-pipeline.zip`
- Create: `backups/2026-07-17-post-audio-volume-pipeline.zip`

**Interfaces:**
- Produces: `npm.cmd run test:audio-volume-pipeline` and inclusion in the default gate.

- [ ] Add module syntax and focused tests to the baseline runner and package scripts.
- [ ] Run audio-volume, audio-manifest, audio-dispatcher, SFX-map, combat-flow, and safety-net suites.
- [ ] Run the complete default gate and require zero failures.
- [ ] Record hashes, remaining versioned assignments, recovery points, and the next isolated candidate.
- [ ] Verify the post ZIP hash, manifest, and required archive entries.
