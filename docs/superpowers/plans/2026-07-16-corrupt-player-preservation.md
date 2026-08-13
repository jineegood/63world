# Corrupt Player Preservation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Distinguish absent, valid, and corrupt player storage so login and character creation cannot overwrite exact corrupt player bytes.

**Architecture:** Add one production storage classifier beside playerKey and loadPlayer. Keep loadPlayer returning a player or null for existing consumers, while the active login flow and character-creation write path inspect the explicit classifier before deciding that an account is absent.

**Tech Stack:** Browser JavaScript, jsdom, Node test runner, PowerShell baseline runner.

## Global Constraints

- Preserve exact corrupt raw bytes; do not repair, delete, migrate, back up, or rewrite them automatically.
- Preserve the public loadPlayer(name) return contract for valid and absent records.
- Treat invalid JSON, null, arrays, and primitive JSON values as corrupt player records.
- Treat a parsed non-array object as a legacy-compatible valid record and normalize it through normalizePlayer.
- Keep valid login, first-run creation, password checks, storage keys, UI layout, gameplay, balance, audio, assets, spreadsheets, and script order unchanged.
- Block both normal UI navigation into character creation and direct/programmatic activation of the create button when the selected account is corrupt.
- Observe RED before production changes and run the complete verification gate after GREEN.
- Git is unavailable; use a checkpoint archive, SHA-256 manifest, and changed-file evidence.

---

### Task 1: Write and Review the Production-Shaped RED Test

**Files:**
- Create: tools/browser-smoke/try_player_corruption_preservation.js
- Modify: tests/safety-net.test.mjs

**Interfaces:**
- Consumes: harness beforeLoad, final active student login listener, createCharacterBtn, playerKey(name)
- Produces: a focused smoke proving exact corrupt bytes survive login and a direct create-button attempt

- [ ] **Step 1: Seed corrupt player bytes before scripts**

Use the existing harness beforeLoad hook to write the exact raw value {broken-json under ysb_player_손상계정 before the production script chain.

- [ ] **Step 2: Exercise the real active login**

Set loginName to 손상계정 and loginPassword to any non-empty value, click studentLoginBtn, then wait until the old 1.7 second creation transition would have completed.

Require:

- creator screen is not active;
- game.player remains null;
- exact raw bytes are unchanged;
- no async error occurred.

- [ ] **Step 3: Exercise the direct creation boundary**

Dispatch a click to createCharacterBtn after the blocked login attempt. Require exact raw bytes to remain unchanged and game.player to remain null.

- [ ] **Step 4: Connect the smoke**

Add:

~~~js
test('corrupt player storage cannot enter or overwrite character creation', () => {
  const output = runSmoke('try_player_corruption_preservation.js');
  assert.match(output, /RESULT: PASS/);
});
~~~

- [ ] **Step 5: Observe RED**

Run:

~~~powershell
node --test --test-name-pattern "corrupt player storage cannot enter or overwrite character creation" tests/safety-net.test.mjs
~~~

Expected: FAIL because active login treats corrupt as absent and direct creation replaces the raw value.

### Task 2: Add Explicit Player Storage Classification

**Files:**
- Modify: game.js beside playerKey and loadPlayer
- Modify: tools/browser-smoke/try_player_storage.js

**Interfaces:**
- Produces: readPlayerStorage(name) returning { status:'absent'|'valid'|'corrupt', player:Object|null, raw:string|null }
- Consumes: readPlayerStorage(name) from loadPlayer, active login, and createCharacterBtn
- Preserves: loadPlayer(name): normalized player or null

- [ ] **Step 1: Add the classifier**

~~~js
function readPlayerStorage(name) {
  const raw = localStorage.getItem(playerKey(name));
  if (raw === null) return { status: 'absent', player: null, raw: null };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { status: 'valid', player: normalizePlayer(parsed), raw };
    }
  } catch {}
  return { status: 'corrupt', player: null, raw };
}
~~~

- [ ] **Step 2: Preserve loadPlayer compatibility**

~~~js
function loadPlayer(name) {
  const stored = readPlayerStorage(name);
  return stored.status === 'valid' ? stored.player : null;
}
~~~

- [ ] **Step 3: Cover classifier states in the storage smoke**

Require absent, valid, invalid JSON, JSON null, JSON array, string, number, and boolean values to return their intended status. Require every corrupt raw value to remain byte-for-byte unchanged.

- [ ] **Step 4: Verify classifier tests**

Run try_player_storage.js.

Expected: all previous 24 assertions plus the new state assertions pass.

### Task 3: Block Corrupt Login and Creation Writes

**Files:**
- Modify: game.js in final handleStudentLoginV20
- Modify: game.js in createCharacterBtn listener

**Interfaces:**
- Consumes: readPlayerStorage(game.currentName)
- Produces: no navigation and no write for corrupt accounts
- Preserves: valid login and absent-account creation flow

- [ ] **Step 1: Guard active login**

After name and password validation, read the explicit storage state. For corrupt state:

- keep game.player null;
- display a clear storage-corruption toast and cinematic error;
- return before the creation overlay and timeouts are scheduled.

For valid state, use stored.player for the existing password and start-game path. For absent state, retain the existing creator transition.

- [ ] **Step 2: Guard the create button**

Before createNewPlayer:

~~~js
const stored = readPlayerStorage(game.currentName);
if (stored.status === 'corrupt') {
  game.player = null;
  toast('저장 데이터가 손상되어 캐릭터를 만들 수 없습니다.');
  return;
}
~~~

Do not block absent creation or alter valid-account behavior outside this corrupt guard.

- [ ] **Step 3: Observe GREEN**

Run the focused test.

Expected: login stays out of creator, direct creation performs no write, and exact bytes remain unchanged.

- [ ] **Step 4: Verify valid and absent flows**

Extend the focused smoke with isolated jsdom cases proving:

- absent account reaches creator and can create one saved player;
- valid account with matching password enters the game and retains its account identity and password after the existing login save path;
- valid account with wrong password does not enter creator and does not rewrite the record.

### Task 4: Verify and Record Package 2

**Files:**
- Modify: docs/archive/handoffs/HANDOFF-2026-07-16.md
- Create: docs/archive/audits/2026-07-16-corrupt-player-preservation-result.md
- Create: backups/2026-07-16-pre-corrupt-player-preservation.zip
- Create: backups/2026-07-16-pre-corrupt-player-preservation.sha256.txt

**Interfaces:**
- Consumes: complete Package 2
- Produces: recovery artifact, RED-GREEN evidence, fresh test results, hashes, and next-package handoff

- [ ] **Step 1: Create and verify the pre-implementation checkpoint**

Archive the same scoped paths as Package 1 and verify its SHA-256 before runtime changes.

- [ ] **Step 2: Run syntax and focused tests**

Run syntax checks for all 17 production scripts plus the harness and new smoke, then run the new smoke and try_player_storage.js.

- [ ] **Step 3: Run automated gates**

~~~powershell
node --test tests/safety-net.test.mjs
node --test tests/audio-manifest.test.mjs tests/weapon-tier.test.mjs
npm.cmd test
~~~

Expected: zero failures and one additional connected safety-net test.

- [ ] **Step 4: Compare checkpoint scope**

Require game.js to be the only changed production runtime file. Record every changed or new file SHA-256 and verify index.html, style.css, src, data, assets, and spreadsheets are unchanged.

- [ ] **Step 5: Update handoff**

Mark both corrupt-storage packages complete. Keep storage exception handling, stable account identity, administrator authorization, audio, combat, input, world, CSS, and gameplay as separate subsequent packages.
