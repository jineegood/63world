# Combat Feedback, Audio, Multiplayer, and UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add consistent hit feedback, shield damage feedback, combat music, readable reward and quest notices, usable healing-well collision, reliable realtime URL handling, and fix movement after monster defeat.

**Architecture:** Extend the existing typed combat-effect and audio-manifest boundaries instead of patching individual skills. Put deterministic calculations and formatting in small browser-global modules, then connect them to `game.js`, multiplayer, rendering, and focused browser-smoke tests.

**Tech Stack:** Browser JavaScript, Canvas/DOM/CSS, HTML Audio, Supabase Realtime WebSocket, Node test runner, jsdom browser-smoke harness, PowerShell test runner.

## Global Constraints

- General hits shake only the struck actor; critical hits additionally keep the full-screen shake.
- Player hostile-hit miss chance remains exactly 10% per hit.
- Boss-room and final-boss-room music never switches to normal combat music.
- Reward resources are granted and saved immediately; only presentation is delayed.
- Do not push GitHub, deploy Vercel, execute Supabase SQL, or enable `securityV2Enabled`.
- Preserve the supplied audio files without transcoding or modifying their contents.
- Work in the existing `local-latest-20260723` branch and current checkout.

---

### Task 1: Deterministic Combat Feedback Rules

**Files:**
- Modify: `src/combat-rules.js`
- Modify: `tests/combat-rules.test.mjs`
- Modify: `tools/run-baseline.ps1`

**Interfaces:**
- Produces: `resolveShieldedDamage({ damage, shield, hp, pierce }) -> { shieldAfter, hpAfter, shieldDamage, hpDamage, fullyBlocked }`
- Consumes: numeric damage, shield, HP, and defense-piercing flag from typed combat effects.

- [ ] **Step 1: Write failing rule tests**

Add cases proving:

```js
assert.deepEqual(resolve({ damage:12, shield:20, hp:50 }), {
  shieldAfter:8, hpAfter:50, shieldDamage:12, hpDamage:0, fullyBlocked:true,
});
assert.deepEqual(resolve({ damage:12, shield:5, hp:50 }), {
  shieldAfter:0, hpAfter:43, shieldDamage:5, hpDamage:7, fullyBlocked:false,
});
assert.deepEqual(resolve({ damage:12, shield:20, hp:50, pierce:true }), {
  shieldAfter:20, hpAfter:38, shieldDamage:0, hpDamage:12, fullyBlocked:false,
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm.cmd run test:combat-rules`

Expected: FAIL because `resolveShieldedDamage` is not exported.

- [ ] **Step 3: Implement the pure resolver**

Normalize all numeric input to non-negative integers, consume shield before HP unless `pierce === true`, and derive `fullyBlocked` only when positive damage is entirely absorbed.

- [ ] **Step 4: Run the test and verify GREEN**

Run: `npm.cmd run test:combat-rules`

Expected: all combat-rule tests pass.

- [ ] **Step 5: Commit**

```powershell
git add -- src/combat-rules.js tests/combat-rules.test.mjs
git commit -m "feat: add shield damage feedback rules"
```

### Task 2: Actor Shake, Shield Numbers, and Full-Block Sound

**Files:**
- Modify: `src/audio-manifest.js`
- Modify: `game.js`
- Modify: `style.css`
- Create: `tests/combat-impact-polish-v2.test.mjs`
- Create: `tools/browser-smoke/try_combat_impact_polish_v2.js`
- Modify: `package.json`
- Modify: `tools/run-baseline.ps1`
- Add unchanged asset: `assets/3. 보호막으로만 다 데미지 막혔을때 소리.mp3`

**Interfaces:**
- Consumes: `YuksamCombatRules.resolveShieldedDamage`
- Produces: audio ID `shieldFullBlock`, DOM kind `shield-damage`, and actor CSS class `actor-hit-shake`.

- [ ] **Step 1: Write a failing browser-smoke test**

The smoke must execute real typed effects and assert:

```js
// Full absorption
assert.equal(player.hp, hpBefore);
assert.equal(playerShield, shieldBefore - hit);
assert.deepEqual(floatingKinds, ['shield-damage']);
assert.equal(audioIds.at(-1), 'shieldFullBlock');
assert.equal(shakenActor, 'player');

// Partial absorption
assert.deepEqual(floatingKinds, ['shield-damage', 'damage']);
assert.notEqual(audioIds.at(-1), 'shieldFullBlock');

// Monster HP hit
assert.equal(shakenActor, 'monster');
```

- [ ] **Step 2: Run and verify RED**

Run: `npm.cmd run test:combat-impact-polish-v2`

Expected: FAIL because shield loss feedback and full-block audio are absent.

- [ ] **Step 3: Register the supplied audio**

Add:

```js
shieldFullBlock: {
  src:'assets/3. 보호막으로만 다 데미지 막혔을때 소리.mp3',
  volume:1,
  channel:'sfx',
},
```

- [ ] **Step 4: Connect typed effects to feedback**

Use the pure resolver for player and monster damage. Queue shield loss as `shield-damage`, HP loss as `damage`, shake the struck actor whenever either value is positive, and play `shieldFullBlock` only when `fullyBlocked`.

- [ ] **Step 5: Add visual styles**

Add a short actor-local horizontal shake animation and a gray-blue shield-damage number style. Do not reuse the full-screen critical class for normal hits.

- [ ] **Step 6: Run and verify GREEN**

Run:

```powershell
npm.cmd run test:combat-impact-polish-v2
npm.cmd run test:combat-flow
```

Expected: both commands pass.

- [ ] **Step 7: Commit**

```powershell
git add -- src/audio-manifest.js game.js style.css tests/combat-impact-polish-v2.test.mjs tools/browser-smoke/try_combat_impact_polish_v2.js package.json tools/run-baseline.ps1 "assets/3. 보호막으로만 다 데미지 막혔을때 소리.mp3"
git commit -m "feat: add shield and hit impact feedback"
```

### Task 3: Combat Music State

**Files:**
- Modify: `src/audio-manifest.js`
- Modify: `game.js`
- Create: `tests/combat-music-v2.test.mjs`
- Create: `tools/browser-smoke/try_combat_music_v2.js`
- Modify: `package.json`
- Modify: `tools/run-baseline.ps1`
- Add unchanged asset: `assets/1. 전투씬 음악.wav`

**Interfaces:**
- Produces: audio ID `battleBgm`
- Consumes: `game.currentMap`, `game.currentCombatMonsterId`, and existing reusable audio objects.

- [ ] **Step 1: Write failing music-selection tests**

Cover:

```js
forest + no combat => forestBgm
forest + combat => battleBgm
bossRoom + combat => bossBgm
finalBossRoom + combat => bossBgm
forest + combat ended => forestBgm
```

The browser smoke must also assert that the previously selected area track is paused during combat and resumes after combat.

- [ ] **Step 2: Run and verify RED**

Run: `npm.cmd run test:combat-music-v2`

Expected: FAIL because `battleBgm` and combat-aware selection do not exist.

- [ ] **Step 3: Register and initialize the combat track**

Register the WAV in the manifest and create one reusable looping `Audio` object during audio initialization.

- [ ] **Step 4: Centralize desired-track selection**

Normalize all map file choices through the final `getDesiredAudioFile()` path. Give boss maps priority over combat state, then normal combat, then map music.

- [ ] **Step 5: Synchronize every combat exit**

Call the existing BGM synchronization boundary after combat entry, defeat completion, escape, player defeat, and forced modal closure. Keep playback position when pausing and resuming area music.

- [ ] **Step 6: Run and verify GREEN**

Run:

```powershell
npm.cmd run test:combat-music-v2
npm.cmd run test:audio-manifest
npm.cmd run test:combat-flow
```

Expected: all pass.

- [ ] **Step 7: Commit**

```powershell
git add -- src/audio-manifest.js game.js tests/combat-music-v2.test.mjs tools/browser-smoke/try_combat_music_v2.js package.json tools/run-baseline.ps1 "assets/1. 전투씬 음악.wav"
git commit -m "feat: add normal battle music"
```

### Task 4: Reward Timing, Colors, Sounds, and Movement Unlock

**Files:**
- Modify: `src/gameplay-polish-v2.js`
- Modify: `game.js`
- Modify: `style.css`
- Modify: `tests/gameplay-polish-v2.test.mjs`
- Modify: `tests/reward-presentation-v2.test.mjs`
- Create: `tools/browser-smoke/try_reward_movement_v2.js`
- Modify: `package.json`
- Modify: `tools/run-baseline.ps1`

**Interfaces:**
- Produces: reward steps with `kind`, `amount`, `delayMs`, `durationMs`, and `tone`.
- Consumes: monster or quest reward values and existing short synth SFX.

- [ ] **Step 1: Write failing timing and movement tests**

Require exact step data:

```js
[
  { kind:'exp', delayMs:0, durationMs:1000, tone:'exp' },
  { kind:'gold', delayMs:1000, durationMs:1000, tone:'gold' },
  { kind:'building', delayMs:2000, durationMs:1000, tone:'building' },
]
```

The browser smoke must finish a monster defeat, advance timers, then assert:

```js
assert.equal(game.modalState.pause, false);
assert.equal(game.transitionLock, 0);
assert.equal(canMoveWithW, true);
assert.deepEqual(rewardTones, ['exp', 'gold', 'building']);
assert.equal(rewardSoundCount, rewardTones.length);
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
npm.cmd run test:gameplay-polish-v2
npm.cmd run test:reward-presentation-v2
```

Expected: FAIL because duration/tone and explicit movement unlock are missing.

- [ ] **Step 3: Extend the reward plan**

Return immutable steps with exact one-second spacing and tone names. Omit only absent optional resources.

- [ ] **Step 4: Render and sound each step**

Apply one CSS tone class per step: purple EXP, yellow Gold, pink Building. Play one short reward cue at each step start.

- [ ] **Step 5: Fix the root movement state**

Remove ownership of `cinematic/pause` from the independent reward overlay. At final monster defeat completion, clear the combat ID, close the combat modal, set `modalState` to unpaused when no real modal replaced it, clear `transitionLock`, and clear stale movement keys without blocking new keydown events.

- [ ] **Step 6: Run and verify GREEN**

Run:

```powershell
npm.cmd run test:gameplay-polish-v2
npm.cmd run test:reward-presentation-v2
npm.cmd run test:combat-flow
npm.cmd run test:safety-net
```

Expected: all pass.

- [ ] **Step 7: Commit**

```powershell
git add -- src/gameplay-polish-v2.js game.js style.css tests/gameplay-polish-v2.test.mjs tests/reward-presentation-v2.test.mjs tools/browser-smoke/try_reward_movement_v2.js package.json tools/run-baseline.ps1
git commit -m "fix: restore movement after reward sequence"
```

### Task 5: Healing-Well Placement and Collision

**Files:**
- Modify: `src/gameplay-polish-v2.js`
- Modify: `game.js`
- Modify: `tests/gameplay-polish-v2.test.mjs`
- Modify: `tests/world-healing-polish-v2.test.mjs`

**Interfaces:**
- Produces: each well as `{ id, x, y, collisionRadius }`
- Consumes: world-navigation collider registry and world-interaction registry.

- [ ] **Step 1: Write failing placement and collider tests**

Assert that each hunting map has two wells, each has a collision radius from 38 through 44, the entrance well is outside the direct spawn-to-portal center line, and runtime colliders contain both wells.

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
npm.cmd run test:gameplay-polish-v2
npm.cmd run test:world-healing-polish-v2
```

Expected: FAIL because well collision metadata and navigation registration are absent.

- [ ] **Step 3: Move entrance wells off the path**

Use upper-side coordinates verified against each map’s spawn, portal, and main path. Preserve one advanced-area well per map.

- [ ] **Step 4: Register colliders**

Add a high-priority hunting-well collider provider that returns existing map colliders plus two well circles. Keep interaction range at 92 so the player can activate the well without colliding with it.

- [ ] **Step 5: Run and verify GREEN**

Run:

```powershell
npm.cmd run test:gameplay-polish-v2
npm.cmd run test:world-healing-polish-v2
npm.cmd run test:world-navigation-registry
```

Expected: all pass.

- [ ] **Step 6: Commit**

```powershell
git add -- src/gameplay-polish-v2.js game.js tests/gameplay-polish-v2.test.mjs tests/world-healing-polish-v2.test.mjs
git commit -m "fix: move and solidify hunting wells"
```

### Task 6: Multiplayer URL Normalization and Two-Session Flow

**Files:**
- Modify: `src/multiplayer.js`
- Create: `tests/multiplayer-v53.test.mjs`
- Create: `tools/browser-smoke/try_multiplayer_v53.js`
- Modify: `package.json`
- Modify: `tools/run-baseline.ps1`

**Interfaces:**
- Produces: `normalizeRealtimeBaseUrl(url) -> project base URL`
- Consumes: existing public Supabase URL and anon/publishable key.

- [ ] **Step 1: Write failing URL tests**

Require:

```js
normalize('https://p.supabase.co') === 'https://p.supabase.co'
normalize('https://p.supabase.co/') === 'https://p.supabase.co'
normalize('https://p.supabase.co/rest/v1') === 'https://p.supabase.co'
normalize('https://p.supabase.co/rest/v1/') === 'https://p.supabase.co'
```

The two-session smoke must create two independent windows, join the same mocked Realtime topic, broadcast positions and chat, and assert each remote map contains the other player.

- [ ] **Step 2: Run and verify RED**

Run: `npm.cmd run test:multiplayer-v53`

Expected: FAIL because the current WebSocket URL retains `/rest/v1/`.

- [ ] **Step 3: Normalize and build the WebSocket URL**

Strip query/hash/trailing slash and `/rest/v1`, then build exactly:

```text
wss://PROJECT.supabase.co/realtime/v1/websocket?apikey=...&vsn=1.0.0
```

- [ ] **Step 4: Preserve reconnect and filtering behavior**

Keep automatic reconnect, stale-player eviction, different-name filtering, map filtering, position updates, and chat bubbles unchanged.

- [ ] **Step 5: Run and verify GREEN**

Run:

```powershell
npm.cmd run test:multiplayer-v53
npm.cmd run test:safety-net
```

Expected: all pass.

- [ ] **Step 6: Commit**

```powershell
git add -- src/multiplayer.js tests/multiplayer-v53.test.mjs tools/browser-smoke/try_multiplayer_v53.js package.json tools/run-baseline.ps1
git commit -m "fix: normalize realtime multiplayer URL"
```

### Task 7: Safe Quest Keyword Emphasis

**Files:**
- Create: `src/quest-text.js`
- Modify: `index.html`
- Modify: `game.js`
- Modify: `style.css`
- Create: `tests/quest-text.test.mjs`
- Modify: `package.json`
- Modify: `tools/run-baseline.ps1`

**Interfaces:**
- Produces: `YuksamQuestText.render(text, context?) -> safe HTML`
- Consumes: trusted quest definitions only; escapes all raw text before highlighting.

- [ ] **Step 1: Write failing renderer tests**

Assert:

```js
render('<img src=x onerror=alert(1)>') // contains escaped text and no img element
render('N키를 눌러 스킬을 배우세요')   // yellow bold N키 and action
render('150골드를 보상으로 획득')      // green bold resource/reward phrase
render('버섯돌이 4마리를 처치')        // yellow bold monster and objective
```

- [ ] **Step 2: Run and verify RED**

Run: `npm.cmd run test:quest-text`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement escape-first highlighting**

Escape `& < > " '` before applying only fixed, game-owned token rules. Return spans with `quest-keyword objective` or `quest-keyword reward`; never accept raw HTML.

- [ ] **Step 4: Load and connect the module**

Load it after quest data and before `game.js`. Use it for quest descriptions, dialogue pages, done messages, and quest tracker text. Keep chat and administrator content on plain escaping.

- [ ] **Step 5: Add accessible colors**

Use bold yellow and green with sufficient contrast and preserve readable text when color is unavailable.

- [ ] **Step 6: Run and verify GREEN**

Run:

```powershell
npm.cmd run test:quest-text
npm.cmd run test:quest-data
npm.cmd run test:baseline
```

Expected: all pass.

- [ ] **Step 7: Commit**

```powershell
git add -- src/quest-text.js index.html game.js style.css tests/quest-text.test.mjs package.json tools/run-baseline.ps1
git commit -m "feat: emphasize quest objectives and rewards"
```

### Task 8: Final Verification and Local Handoff

**Files:**
- Verify: all changed production, test, and audio files

**Interfaces:**
- Consumes: all preceding task outputs.
- Produces: verified local branch only; no remote mutation.

- [ ] **Step 1: Run focused regression tests**

```powershell
npm.cmd run test:combat-impact-polish-v2
npm.cmd run test:combat-music-v2
npm.cmd run test:reward-presentation-v2
npm.cmd run test:world-healing-polish-v2
npm.cmd run test:multiplayer-v53
npm.cmd run test:quest-text
```

Expected: all pass.

- [ ] **Step 2: Run the full suite**

Run: `npm.cmd test`

Expected: exit code 0 and zero failed tests.

- [ ] **Step 3: Inspect repository safety**

```powershell
git diff --check
git status --short
rg -n "securityV2Enabled:\\s*true" src/cloud-config.js
```

Expected: no whitespace errors, only intentional files, and no production security-v2 enablement.

- [ ] **Step 4: Review requirements line by line**

Confirm actor-only shake, shield numbers and sound, combat BGM rules, reward colors/timing/sound, movement unlock, well collision/placement, unchanged 10% miss rule, realtime URL normalization, and safe quest emphasis.

- [ ] **Step 5: Keep the branch local**

Do not push or deploy. Report the current branch, final commit, tests passed, and explain that public Vercel multiplayer changes require a later deployment.
