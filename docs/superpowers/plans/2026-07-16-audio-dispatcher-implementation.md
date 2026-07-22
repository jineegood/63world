# Audio Dispatcher Consolidation Implementation Plan

> **Status (2026-07-16): AMENDED FOR EXECUTION.** The package also replaces harness-only `window.__G` settings reads with `window.getYuksamAudioSettings()`, installed by `game.js`, and connects dispatcher tests to the 140-test default gate.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the seven order-dependent `playSfx` wrappers with one dispatcher and repair the confirmed critical-visual scope error without changing audible or visible behavior.

**Architecture:** A new browser-global dispatcher routes sound names through injected callbacks and never reads game state or the DOM. `game.js` retains synthesis and file-object ownership in one private adapter object; V23 and V24 register their existing local visual functions as callbacks, and all existing `playSfx(...)` callers keep the same public entry point.

**Tech Stack:** Browser JavaScript, Node.js test runner, `node:vm`, jsdom browser-smoke harness, PowerShell baseline runner.

## Global Constraints

- Preserve every current sound assignment, oscillator value, delay, volume, fallback, and combat-log timing.
- Preserve both V23 and V24 critical visual layers and run each exactly once per `critical` request.
- Critical visuals continue while SFX is disabled; no audible fallback is added in that state.
- Do not change BGM, skill mappings, combat balance, combat sequencing, floating damage, save data, spreadsheets, assets, or unrelated patch chains.
- Use tests before each production change and observe the expected failure.
- This directory is not a Git repository, so commit steps are intentionally omitted.
- `audio-manifest.js` and `sfx-map.js` must obtain settings only through `window.getYuksamAudioSettings?.()`; production code must not depend on harness-only `window.__G`.
- Add `audio-dispatcher` as a baseline runner mode and package script so dispatcher tests run under `npm.cmd test`.

---

### Task 1: Pure Audio Dispatcher

**Files:**
- Create: `tests/audio-dispatcher.test.mjs`
- Create: `src/audio-dispatcher.js`

**Interfaces:**
- Consumes: callback object passed to `window.YuksamAudioDispatcher.create(options)`
- Produces: `create(options) -> play(name)`
- Callback signatures: `playSynth(name)`, `playMapped(audioId, fallback) -> boolean`, `playDoor()`, `playUpgrade(name) -> boolean`, `playCriticalVisuals(source)`, `getCriticalSource() -> 'player'|'enemy'`, `playPlayerHitFallback()`

- [ ] **Step 1: Write the failing dispatcher tests**

Create a VM loader in `tests/audio-dispatcher.test.mjs` and add focused tests using event arrays and counters. The critical test must use this shape so synchronous failure and asynchronous mapped fallback both remain single-shot:

```js
const events = [];
let mappedFallback;
const play = dispatcher.create({
  playSynth:(name) => events.push(['synth', name]),
  playMapped:(id, fallback) => { events.push(['mapped', id]); mappedFallback = fallback; return true; },
  playCriticalVisuals:(source) => events.push(['visuals', source]),
  getCriticalSource:() => 'enemy',
  playPlayerHitFallback:() => events.push(['fallback']),
});

play('critical');
mappedFallback();
mappedFallback();
assert.deepEqual(events, [
  ['visuals', 'enemy'],
  ['mapped', 'critical'],
  ['fallback'],
]);
```

Add separate assertions that:

- ordinary and unknown names delegate once to `playSynth(name)`;
- `door` calls only `playDoor()`;
- `upgradeCharge`, `upgradeSuccess`, and `upgradeFail` call `playUpgrade(name)`;
- an upgrade callback returning `false` falls through once to `playSynth(name)`;
- a missing or false mapped handler triggers the critical fallback once;
- the dispatcher source contains no `game`, `document`, `Audio`, or `playTone` access.

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
node --test tests/audio-dispatcher.test.mjs
```

Expected: FAIL because `src/audio-dispatcher.js` does not exist or does not publish `YuksamAudioDispatcher.create`.

- [ ] **Step 3: Implement the minimal dispatcher**

Create `src/audio-dispatcher.js` as an IIFE. Use a once-only fallback and explicit special routes; delegate every other name to the existing synthesized path:

```js
(function audioDispatcherModule() {
  'use strict';

  const UPGRADE_NAMES = new Set(['upgradeCharge', 'upgradeSuccess', 'upgradeFail']);
  const once = (fn) => {
    let called = false;
    return () => {
      if (called) return;
      called = true;
      fn?.();
    };
  };

  function create(options) {
    const deps = options || {};
    return function play(name) {
      if (name === 'critical') {
        const fallback = once(deps.playPlayerHitFallback);
        deps.playCriticalVisuals?.(deps.getCriticalSource?.() || 'player');
        const handled = deps.playMapped?.('critical', fallback);
        if (!handled) fallback();
        return;
      }
      if (name === 'door') {
        deps.playDoor?.();
        return;
      }
      if (UPGRADE_NAMES.has(name)) {
        if (!deps.playUpgrade?.(name)) deps.playSynth?.(name);
        return;
      }
      deps.playSynth?.(name);
    };
  }

  window.YuksamAudioDispatcher = Object.freeze({ create });
})();
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run `node --test tests/audio-dispatcher.test.mjs`.

Expected: all dispatcher unit tests PASS with zero failures.

---

### Task 2: Runtime Regression Test for the Critical Scope Failure

**Files:**
- Create: `tools/browser-smoke/try_audio_dispatcher.js`
- Modify: `tests/audio-dispatcher.test.mjs`

**Interfaces:**
- Consumes: the real `index.html` script chain through `tools/browser-smoke/harness.js`
- Produces: a smoke process ending with `RESULT: PASS` and exit code `0`

- [ ] **Step 1: Add a failing browser smoke before changing `game.js`**

Use the shared harness and execute the lexical public entry point with `window.eval("playSfx('critical')")`. The smoke must:

```js
window.__G.settings.sfxEnabled = false;
let syncError = null;
try { window.eval("playSfx('critical')"); }
catch (error) { syncError = String(error?.message || error); }
await sleep(40);
check('critical call has no scope error', !syncError, syncError || '');
check('V23 critical flash exists', !!window.document.querySelector('.critical-flash-v23'));
check('V24 critical flash exists', !!window.document.querySelector('.critical-flash-v24'));
```

Then enable SFX, replace `window.playMappedAudio` with a counter that returns `true`, invoke `critical` once, and require one mapped call. Install deterministic reusable file objects and exercise every file route:

```js
let mappedCalls = 0;
window.__G.settings.sfxEnabled = true;
window.playMappedAudio = (id) => { if (id === 'critical') mappedCalls += 1; return true; };
window.eval("playSfx('critical')");
check('critical mapped audio runs once', mappedCalls === 1, mappedCalls);

const counts = { door:0, upgradeCharge:0, upgradeSuccess:0, upgradeFail:0 };
const fakeFile = (name) => ({
  volume:1,
  currentTime:0,
  pause(){},
  play(){ counts[name] += 1; return Promise.resolve(); },
});
window.__G.audio.doorFile = fakeFile('door');
window.__G.audio.upgradeChargeFile = fakeFile('upgradeCharge');
window.__G.audio.upgradeSuccessFile = fakeFile('upgradeSuccess');
window.__G.audio.upgradeFailFile = fakeFile('upgradeFail');
for (const name of Object.keys(counts)) window.eval(`playSfx('${name}')`);
check('door and upgrade files run once each', Object.values(counts).every((count) => count === 1), JSON.stringify(counts));
```

Finish by asserting `asyncErrors.length === 0`, print `RESULT: PASS`, and call `process.exit` so game timers cannot hold the smoke open.

Spawn the smoke from a final test in `tests/audio-dispatcher.test.mjs` and include complete stdout/stderr in assertion failures.

- [ ] **Step 2: Run the smoke test and verify RED for the reproduced bug**

Run `node --test tests/audio-dispatcher.test.mjs`.

Expected: unit tests PASS, browser smoke FAILS with `strongCriticalFeedbackV24 is not defined`. This is the automated form of the manually reproduced root cause.

---

### Task 3: Wire the Dispatcher and Remove the Wrapper Chain

**Files:**
- Modify: `index.html:184-186`
- Modify: `game.js:677-700, 4800-4805, 5214-5226, 5698-5713, 6003-6021, 6235-6259, 6841-6856, 8640-8668`
- Modify: `tests/combat-flow.test.mjs:275-282, 312-318`
- Modify: `tests/refactor-health.test.mjs`

**Interfaces:**
- Consumes: `window.YuksamAudioDispatcher.create(options)` from Task 1
- Produces: one final lexical `playSfx(name)` delegate and a private `audioAdapters` object in `game.js`

- [ ] **Step 1: Add source-boundary assertions and verify RED**

Add assertions requiring:

```js
assert.match(indexSource, /src\/audio-manifest\.js[\s\S]*src\/audio-dispatcher\.js[\s\S]*game\.js/);
assert.doesNotMatch(gameSource, /playSfx\s*=\s*function playSfxV(?:17|20|22|23|24|25|28)/);
assert.equal((gameSource.match(/YuksamAudioDispatcher\.create\(/g) || []).length, 1);
assert.match(gameSource, /audioAdapters\.criticalVisuals\.push\(triggerCriticalFlashV23\)/);
assert.match(gameSource, /audioAdapters\.criticalVisuals\.push\(strongCriticalFeedbackV24\)/);
```

Update the V25-specific critical source test in `tests/combat-flow.test.mjs` to assert final behavior wiring instead: two registered visual callbacks, mapped ID `critical`, `playPlayerHitSfx` fallback, and no direct cross-IIFE call from a V25 wrapper.

Run:

```powershell
node --test tests/refactor-health.test.mjs tests/combat-flow.test.mjs
```

Expected: FAIL because the dispatcher script and final wiring are not present and the versioned wrappers still exist.

- [ ] **Step 2: Register the new script in load order**

Insert this exact script between the manifest and game runtime:

```html
<script src="src/audio-manifest.js"></script>
<script src="src/audio-dispatcher.js"></script>
<script src="game.js"></script>
```

- [ ] **Step 3: Split synthesis from routing and add the private adapters**

Rename the original `function playSfx(name)` to `function playSynthSfx(name)` without changing its body. Immediately after it, define:

```js
const audioAdapters = {
  doorSynth:null,
  door:null,
  upgrade:null,
  criticalVisuals:[],
};
let playSfx = playSynthSfx;
```

All existing call sites continue to call `playSfx(...)`.

- [ ] **Step 4: Replace each versioned wrapper with a capability registration**

- Remove V17's dead synthesized critical wrapper; V25 already bypasses it in the current final behavior.
- In V20, assign the existing three-tone door body to `audioAdapters.doorSynth` and set `audioAdapters.door` to that callback.
- In V22, replace the `playSfxV22` wrapper with this adapter, preserving both the asynchronous `open` fallback and the no-file synthesized door fallback:

```js
audioAdapters.door = function playDoorFileV22() {
  try {
    resumeAudio();
    if (game.audio.doorFile) {
      game.audio.doorFile.pause();
      game.audio.doorFile.currentTime = 0;
      game.audio.doorFile.volume = game.settings.sfxEnabled ? Math.min(1, Math.max(0, game.settings.sfxVolume)) : 0;
      game.audio.doorFile.play().catch(() => playSynthSfx('open'));
      return;
    }
  } catch {}
  audioAdapters.doorSynth?.();
};
```
- After defining `triggerCriticalFlashV23`, push it once into `audioAdapters.criticalVisuals` and remove `playSfxV23`.
- After defining `strongCriticalFeedbackV24`, push it once into `audioAdapters.criticalVisuals` and remove `playSfxV24`.
- Remove `playSfxV25`; retain `ensureCriticalAudioV25`, volume synchronization, and both visual function bodies unchanged.
- In V28, replace `playSfxV28` with an `audioAdapters.upgrade(name)` switch that calls `playUpgradeFileV28` with the matching existing reusable file and returns its boolean.

- [ ] **Step 5: Install one final dispatcher after the V28 adapter is ready**

Use dynamic adapters so their owning patch scopes remain intact:

```js
playSfx = window.YuksamAudioDispatcher.create({
  playSynth:playSynthSfx,
  playMapped:(audioId, fallback) => window.playMappedAudio?.(audioId, { onFallback:fallback }) || false,
  playDoor:() => audioAdapters.door?.(),
  playUpgrade:(name) => audioAdapters.upgrade?.(name) || false,
  playCriticalVisuals:(source) => audioAdapters.criticalVisuals.forEach((handler) => handler(source)),
  getCriticalSource:() => game.combatImpact?.target === 'player' ? 'enemy' : 'player',
  playPlayerHitFallback:playPlayerHitSfx,
});
```

Throw a clear initialization error if `window.YuksamAudioDispatcher?.create` is missing. Do not add a dispatcher-level SFX-enabled check.

- [ ] **Step 6: Run the focused source, unit, and runtime tests and verify GREEN**

Run:

```powershell
node --check src/audio-dispatcher.js
node --check game.js
node --test tests/audio-dispatcher.test.mjs tests/refactor-health.test.mjs tests/combat-flow.test.mjs
```

Expected: all focused tests PASS; runtime critical invocation creates both flash layers with no `ReferenceError`; mapped critical, door, and each upgrade route execute once.

---

### Task 4: Baseline Integration and Final Verification

**Files:**
- Modify: `tools/run-baseline.ps1`
- Modify: `package.json`

**Interfaces:**
- Consumes: `tests/audio-dispatcher.test.mjs`
- Produces: `npm.cmd run test:audio-dispatcher` and inclusion in `npm.cmd test`

- [ ] **Step 1: Connect the new suite**

Add `audio-dispatcher` to the PowerShell `ValidateSet`, syntax-check `src/audio-dispatcher.js` in `check`, and run the new test file for `all` or `audio-dispatcher`:

```powershell
if ($Mode -eq 'all' -or $Mode -eq 'audio-dispatcher') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/audio-dispatcher.test.mjs')
}
```

Add to `package.json`:

```json
"test:audio-dispatcher": "powershell -NoProfile -ExecutionPolicy Bypass -File tools/run-baseline.ps1 audio-dispatcher"
```

- [ ] **Step 2: Run repeated focused verification**

Run `npm.cmd run test:audio-dispatcher` three times.

Expected: every run exits `0`; the critical runtime smoke consistently reports both visual layers and one mapped call.

- [ ] **Step 3: Run the complete baseline**

Run `npm.cmd test`.

Expected: all prior 127 tests plus the new dispatcher tests pass with zero failures.

- [ ] **Step 4: Verify the requested scope**

Run syntax checks and inspect changed paths. Confirm that production edits are limited to:

- `index.html`
- `game.js`
- `src/audio-dispatcher.js`

Confirm no changes to gameplay data, combat rules, combat FX, styles, assets, saves, spreadsheets, quests, or administrator code. Record the new hashes of the three changed runtime files and verify every other runtime hash still matches the 2026-07-15 audit manifest.

- [ ] **Step 5: Report the verified result**

Report the exact full-test pass count, repeated smoke result, confirmed critical scope-error resolution, changed production files, and any remaining risk. Stop before beginning combat-sequence, input-router, storage, or world-interaction refactors.
