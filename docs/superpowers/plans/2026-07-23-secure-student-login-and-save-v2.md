# Secure Student Login and Save v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the existing name/password student screen to Supabase Auth and per-user v2 saves while keeping the secure path disabled until the live Supabase migration is explicitly authorized.

**Architecture:** Add focused `student-access-v2` and `cloud-sync-v2` browser modules between `game.js` and the already-built Auth foundation. A `securityV2Enabled: false` configuration switch preserves today's deployed behavior; when enabled later, the game never reads or writes the legacy public cloud tables and never places a plaintext credential in player data or local cache.

**Tech Stack:** Browser JavaScript, `@supabase/supabase-js` 2.110.8, Supabase Auth/PostgREST, localStorage cache, Node.js test runner, jsdom browser smoke tests

## Global Constraints

- Do not execute any SQL against live Supabase.
- Do not push to GitHub or deploy to Vercel.
- Keep `securityV2Enabled` set to `false` in `src/cloud-config.js`.
- When v2 is enabled, do not fall back to `players`, `shared_state`, or the legacy plaintext login.
- Do not store `password`, `currentPassword`, `access_token`, `refresh_token`, `anonKey`, or `service_role` inside a player object or v2 local cache.
- Preserve the current v1 path exactly while the flag is false.
- New behavior belongs in `src/` modules; keep `game.js` edits limited to boundary calls.

---

### Task 1: Complete the login-or-create Auth behavior

**Files:**
- Modify: `src/auth-v2.js`
- Modify: `tests/supabase-security-v2.test.mjs`

**Interfaces:**
- Produces: `createAuthService(...).enterStudent(name, password)` returning `{ identity, isNewAccount }`.
- `identity` remains the existing sanitized `{ userId, displayName, role }` shape.

- [ ] **Step 1: Write failing tests for login-first account entry**

Add tests proving that `enterStudent`:

- returns the signed-in identity without calling signup when login succeeds;
- tries signup only after Supabase returns invalid credentials;
- returns `isNewAccount: true` only when signup returns both a user and active session;
- converts “signup says account already exists” into `INVALID_CREDENTIALS`, because it means the original password was wrong;
- reports `OFFLINE` for fetch/network failures without echoing the supplied credential.

- [ ] **Step 2: Run focused tests and verify the new tests fail**

Run: `npm.cmd run test:supabase-security-v2`

Expected: FAIL because `enterStudent` does not exist.

- [ ] **Step 3: Implement the minimal combined flow**

Reuse `signInStudent` and `signUpStudent`. Only attempt signup for `INVALID_CREDENTIALS`; never attempt it for offline, rate-limit, weak-password, or configuration errors. Require a session on successful signup so a mistakenly enabled email-confirmation setting cannot create an unusable character.

- [ ] **Step 4: Run focused tests**

Run: `npm.cmd run test:supabase-security-v2`

Expected: all Auth foundation tests pass.

---

### Task 2: Add authenticated per-user save and safe cache

**Files:**
- Create: `src/cloud-sync-v2.js`
- Create: `tests/cloud-sync-v2.test.mjs`
- Modify: `package.json`
- Modify: `tools/run-baseline.ps1`

**Interfaces:**
- `window.YuksamCloudSyncV2.sanitizePlayerData(player)` returns a detached JSON-safe object without sensitive keys.
- `window.YuksamCloudSyncV2.create({ client, storage, schedule, cancelSchedule })` returns:
  - `loadPlayer(userId): Promise<{ player, source, offline } | null>`
  - `queueSave(userId, player): void`
  - `flush(): Promise<void>`
  - `clearCache(userId): void`
- Cache keys use `ysb_player_v2_<userId>`, never a student name.

- [ ] **Step 1: Write failing sanitizer and cache tests**

Cover nested sensitive-field removal, non-mutation of the input, circular/non-JSON value rejection, user-ID cache isolation, and synchronous safe cache writes from `queueSave`.

- [ ] **Step 2: Write failing remote data tests**

Use a small fake Supabase query builder to prove that:

- loads select only `data,updated_at` from `player_profiles_v2` and filter by the authenticated `user_id`;
- a valid remote row replaces only that user's cache;
- network failure may use only the same user's existing safe cache;
- saves call `update({ data, updated_at }).eq('user_id', userId)` and never send identity fields or secrets;
- a remote authorization/error response does not silently report success.

- [ ] **Step 3: Register the focused test command and verify RED**

Add `test:cloud-sync-v2` and include it in `npm.cmd test`.

Run: `npm.cmd run test:cloud-sync-v2`

Expected: FAIL because `src/cloud-sync-v2.js` does not exist.

- [ ] **Step 4: Implement the minimal module**

Use a one-second trailing save queue with injected scheduling functions for deterministic tests. Cache first, then flush the most recent safe snapshot. Throw short Korean errors for authorization or server failures; use cached data only for genuine network failures.

- [ ] **Step 5: Run focused tests**

Run: `npm.cmd run test:cloud-sync-v2`

Expected: all save/cache tests pass.

---

### Task 3: Add the feature-gated student access controller

**Files:**
- Create: `src/student-access-v2.js`
- Create: `tests/student-access-v2.test.mjs`
- Modify: `package.json`
- Modify: `tools/run-baseline.ps1`

**Interfaces:**
- `window.YuksamStudentAccessV2.create({ config, clientFactory, authApi, cloudApi, storage })` returns:
  - `enabled: boolean`
  - `status: 'off' | 'misconfigured' | 'ready'`
  - `enter(name, password): Promise<{ kind:'existing', identity, player, offline } | { kind:'new', identity }>`
  - `savePlayer(player): void`
  - `flush(): Promise<void>`
  - `signOut(): Promise<void>`
- Supabase project URLs are normalized by removing a trailing `/rest/v1` before `createClient` is called.

- [ ] **Step 1: Write failing feature-switch tests**

Prove that a false/missing flag produces `enabled:false` and constructs no client, while an enabled flag with invalid URL/key produces `status:'misconfigured'` and a Korean configuration error.

- [ ] **Step 2: Write failing entry and save tests**

Prove that an existing account loads its own profile, a new/empty profile returns the creator result, a same-user safe cache supports authenticated offline entry, `savePlayer` requires an identity, and signout flushes then clears the in-memory identity.

- [ ] **Step 3: Register the focused command and verify RED**

Run: `npm.cmd run test:student-access-v2`

Expected: FAIL because the controller does not exist.

- [ ] **Step 4: Implement the controller**

Construct exactly one Supabase client, Auth service, and cloud service when enabled. Keep credentials inside the Auth call only. Do not expose the raw client, session, internal email, or password from the returned controller.

- [ ] **Step 5: Run focused tests**

Run: `npm.cmd run test:student-access-v2`

Expected: all controller tests pass.

---

### Task 4: Connect the current game screen through narrow boundaries

**Files:**
- Modify: `index.html:184-224`
- Modify: `src/cloud-config.js`
- Modify: `src/cloud-sync.js:5-15`
- Modify: `game.js:80-105,239-352,424-454,322-340,3445-3468,4350-4372`
- Modify: `tests/safety-net.test.mjs`
- Create: `tests/secure-student-login-v2.test.mjs`
- Modify: `package.json`
- Modify: `tools/run-baseline.ps1`

**Interfaces:**
- `game.js` consumes only the public `YuksamStudentAccessV2` controller methods from Task 3.
- Legacy `YuksamPlayerStore` remains the only path when `securityV2Enabled !== true`.

- [ ] **Step 1: Write failing script-order and disabled-mode tests**

Assert that config, the local Supabase bundle, Auth, cloud sync v2, and student access v2 load before `game.js`; assert the flag remains false; assert legacy cloud sync exits immediately when the flag is true.

- [ ] **Step 2: Write a failing secure browser flow**

Extend the browser harness with an opt-in cloud-config override and fake Supabase client. Verify:

- existing secure account goes directly to the game;
- new secure account reaches character creation and can enter the game;
- wrong password/offline errors keep the landing screen active with no legacy player record created;
- the resulting `ysb_player_v2_<userId>` cache contains no password or token.

- [ ] **Step 3: Run the new browser test and verify RED**

Run: `npm.cmd run test:secure-student-login-v2`

Expected: FAIL because the game still uses plaintext local login.

- [ ] **Step 4: Move configuration and v2 module scripts before game bootstrap**

Keep `securityV2Enabled: false`. Do not include the old cloud sync twice. Ensure browser tests still replace the real URL/key with isolated test values.

- [ ] **Step 5: Add the game boundary calls**

When secure mode is ready:

- make `handleStudentLogin` async and delegate entry to the controller;
- leave `game.currentPassword` empty;
- omit the `password` field from normalized/new players;
- route `savePlayer` to the secure controller;
- bypass name-keyed legacy lookup during secure character creation;
- disable the login button only while the request is active and show controller errors with the existing toast.

When the flag is false, retain the existing synchronous behavior byte-for-byte where practical.

- [ ] **Step 6: Disable v1 cloud access whenever v2 is enabled**

At the top of `src/cloud-sync.js`, return before any REST setup when `window.YUKSAM_CLOUD.securityV2Enabled === true`.

- [ ] **Step 7: Run focused browser and safety tests**

Run: `npm.cmd run test:secure-student-login-v2`

Run: `npm.cmd run test:safety-net`

Expected: both commands exit 0.

---

### Task 5: Verify and preserve the local-only checkpoint

**Files:**
- Modify: `docs/superpowers/plans/2026-07-23-secure-student-login-and-save-v2.md`

- [ ] **Step 1: Rebuild the pinned client**

Run: `npm.cmd run build:supabase-client`

Expected: `Built vendor\\supabase-client.bundle.js`.

- [ ] **Step 2: Run all focused security tests**

Run: `npm.cmd run test:supabase-security-v2`

Run: `npm.cmd run test:cloud-sync-v2`

Run: `npm.cmd run test:student-access-v2`

Run: `npm.cmd run test:secure-student-login-v2`

Expected: every command exits 0 with no failed tests.

- [ ] **Step 3: Run the complete project suite**

Run: `npm.cmd test`

Expected: exit code 0.

- [ ] **Step 4: Check repository and deployment boundaries**

Run: `git diff --check`, `git status --short`, and `git rev-list --left-right --count origin/main...HEAD`.

Expected: only planned local files changed; the local branch remains ahead of `origin/main`; no push or deployment occurred.

- [ ] **Step 5: Create a local commit only**

Commit message: `feat: connect secure student login and saves`

Do not push the branch.

## Completion Boundary

This plan finishes the locally testable student login and own-character save path, with the production switch still off. Live SQL application, Auth email-confirmation settings, teacher login/reset, leaderboard, authenticated multiplayer, GitHub push, and Vercel deployment remain separate later phases requiring explicit authorization.
