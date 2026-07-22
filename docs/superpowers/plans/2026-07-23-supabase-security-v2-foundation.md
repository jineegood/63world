# Supabase Security v2 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and locally verify the secure Supabase v2 foundation without changing the currently deployed app or the existing v1 tables.

**Architecture:** Add an unapplied, additive Supabase migration for authenticated per-user rows and teacher-only administration. Add a browser-compatible authentication module that converts a student name into a deterministic internal login identifier and delegates password storage to Supabase Auth. Keep this foundation disconnected from the live login UI until the later cutover phase.

**Tech Stack:** PostgreSQL/Supabase RLS, Supabase Auth, `@supabase/supabase-js` 2.110.8, browser JavaScript, Node.js test runner

## Global Constraints

- Do not push to GitHub or deploy to Vercel.
- Do not execute the migration against the live Supabase project in this phase.
- Do not modify or delete the existing `players` and `shared_state` tables or policies.
- Do not wire v2 into the current login screen yet.
- Never store a plaintext password in a player object, localStorage payload, database row, log, or error.
- Treat `app_metadata.role = 'teacher'` as the only teacher authorization source.

---

### Task 1: Add static security tests first

**Files:**
- Create: `tests/supabase-security-v2.test.mjs`
- Modify: `package.json`
- Modify: `tools/run-baseline.ps1`

**Interfaces:**
- Consumes migration SQL and browser module source as text.
- Produces a repeatable `npm.cmd run test:supabase-security-v2` gate.

- [x] **Step 1: Write failing migration-policy tests**

Assert that the future migration:

- creates `player_profiles_v2`, `leaderboard_entries_v2`, and `shared_state_v2`;
- enables and forces RLS on all three tables;
- scopes student profile reads and writes to `auth.uid()`;
- uses trusted `app_metadata.role` for teacher access;
- does not contain open `using (true)` or `with check (true)` policies;
- does not add a password column.

- [x] **Step 2: Write failing auth-module tests**

Test name normalization, deterministic SHA-256 internal email generation, signup/login behavior through an injected fake Supabase client, duplicate-name handling, session restoration, logout, and password redaction.

- [x] **Step 3: Register the focused test command**

Add `test:supabase-security-v2` to `package.json` and the PowerShell runner's accepted modes and `all` path.

- [x] **Step 4: Run the new test and confirm it fails for missing implementation**

Run: `npm.cmd run test:supabase-security-v2`

Expected: FAIL because the migration and auth module do not exist yet.

---

### Task 2: Add the unapplied v2 schema and RLS migration

**Files:**
- Create: `supabase/migrations/202607230001_security_v2_foundation.sql`
- Test: `tests/supabase-security-v2.test.mjs`

**Interfaces:**
- `public.is_teacher()` returns whether the authenticated JWT has trusted teacher app metadata.
- `public.handle_new_v2_user()` copies safe signup metadata into `player_profiles_v2`.
- Tables expose only the rows allowed by RLS.

- [x] **Step 1: Create additive tables and constraints**

Create the three v2 tables, safe defaults, indexes, timestamp update trigger, and a signup trigger. Student names must be normalized and unique; no table may contain a password column.

- [x] **Step 2: Add locked-down RLS policies**

Students may read/update their own profile, insert only their own row, read the leaderboard, write only their own leaderboard entry, and read shared state. Teachers may administer all three v2 tables. Anonymous users receive no policies.

- [x] **Step 3: Harden helper functions**

Use fixed `search_path`, explicit security mode, and restricted execute grants. Read teacher status only from `auth.jwt() -> 'app_metadata'`.

- [x] **Step 4: Run focused tests**

Run: `npm.cmd run test:supabase-security-v2`

Expected: migration checks pass; auth-module checks still fail.

---

### Task 3: Implement the browser authentication core

**Files:**
- Create: `src/auth-v2.js`
- Test: `tests/supabase-security-v2.test.mjs`

**Interfaces:**
- `window.YuksamAuthV2.normalizeStudentName(name)`
- `window.YuksamAuthV2.createInternalEmail(name)`
- `window.YuksamAuthV2.createAuthService({ client })`
- Service methods: `signUpStudent`, `signInStudent`, `restoreSession`, `signOut`, `getRole`

- [x] **Step 1: Implement strict name normalization and validation**

Trim, normalize Unicode to NFKC, collapse whitespace, enforce 1-20 visible characters, and reject control characters.

- [x] **Step 2: Generate the internal login email**

Use Web Crypto SHA-256 over the normalized name and return `student-<hex>@63world.invalid`. Never include the raw name in the internal email.

- [x] **Step 3: Implement signup and login through dependency injection**

Pass the internal email and password directly to Supabase Auth. Signup metadata contains only `display_name` and `normalized_name`. Map common Supabase errors to short Korean messages without echoing credentials.

- [x] **Step 4: Implement session and role helpers**

Restore the Supabase session, sign out, and recognize teachers only from `user.app_metadata.role`.

- [x] **Step 5: Remove sensitive fields from returned profile data**

Return only user/session/profile identifiers needed by the app. Ensure password and token fields cannot be copied into game-save payloads by the module.

- [x] **Step 6: Run focused tests**

Run: `npm.cmd run test:supabase-security-v2`

Expected: all focused tests pass.

---

### Task 4: Pin the official client and verify the project

**Files:**
- Modify: `package.json`
- Create/Modify: `package-lock.json`
- Modify: `.gitignore`
- Create: `tools/build-supabase-client.mjs`
- Generate: `vendor/supabase-client.bundle.js`
- Test: `tests/supabase-security-v2.test.mjs`

**Interfaces:**
- `window.YuksamSupabaseClient.createClient(url, anonKey)` uses the pinned official client bundled into this repository.

- [x] **Step 1: Install exact versions**

Install exact `@supabase/supabase-js@2.110.8` and `esbuild@0.28.1`. Do not use floating version ranges.

- [x] **Step 2: Add the local browser bundle build**

Create a small entry file/build script and generate a non-minified local bundle with a source banner. Add the build command to `package.json`.

- [x] **Step 3: Verify the bundle exposes only the intended factory**

Add a static test that confirms the bundle exists and exposes `YuksamSupabaseClient.createClient`, without embedding the project URL, anon key, service-role key, or a CDN import.

- [x] **Step 4: Run focused and full tests**

Run: `npm.cmd run test:supabase-security-v2`

Expected: all focused tests pass.

Run: `npm.cmd test`

Expected: exit code 0.

- [x] **Step 5: Inspect repository state**

Run: `git status --short` and `git diff --check`

Expected: only the planned local foundation files are changed; no deployment or remote push occurred.

## Completion Boundary

This plan ends with a tested local security foundation. Connecting the current game login, cloud save, teacher dashboard, leaderboard, and multiplayer to v2 requires separate implementation plans and a later live Supabase migration. None of those cutover steps are authorized by this plan.
