# Secure Teacher Auth and Password Reset v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the secure-mode teacher password gate with a Supabase teacher account and add a server-authorized student password reset path, without enabling or deploying v2.

**Architecture:** A browser `admin-auth-v2` module uses a separately keyed Supabase Auth client so teacher login cannot replace a student's session. A Supabase Edge Function independently verifies the caller's trusted `app_metadata.role`, looks up the student by normalized name, and performs the Auth password change with a server-only service-role secret. The existing `6363` flow remains only while `securityV2Enabled` is false.

**Tech Stack:** Browser JavaScript, `@supabase/supabase-js` 2.110.8, Supabase Auth, Supabase Edge Functions/Deno, Node.js test runner, jsdom browser smoke tests

## Global Constraints

- Keep `securityV2Enabled: false`; do not execute SQL or deploy an Edge Function.
- Do not push GitHub or deploy Vercel.
- Never place `SUPABASE_SERVICE_ROLE_KEY` or its value in browser code, GitHub-facing configuration, or Vercel public variables.
- Authorize teachers only from `user.app_metadata.role === 'teacher'`; never trust `user_metadata.role`.
- Give the teacher client the distinct Auth storage key `ysb_teacher_auth_v2`.
- In secure mode, never display student passwords or the legacy `6363` hint.
- Until secure admin data/shared-state modules exist, do not present legacy local student/workbook/server controls as if they manage v2 cloud data.

---

### Task 1: Build the teacher Auth browser module test-first

**Files:**
- Create: `src/admin-auth-v2.js`
- Create: `tests/admin-auth-v2.test.mjs`
- Modify: `package.json`
- Modify: `tools/run-baseline.ps1`

**Interfaces:**
- `window.YuksamAdminAuthV2.create({ client, normalizeStudentName })` returns:
  - `signIn(email, password): Promise<{ userId, email, role:'teacher' }>`
  - `restore(): Promise<identity | null>`
  - `signOut(): Promise<void>`
  - `changeOwnPassword(newPassword): Promise<void>`
  - `resetStudentPassword(studentName, newPassword): Promise<{ displayName:string }>`

- [ ] **Step 1: Write failing authentication and role tests**

Cover successful teacher login, rejection and immediate signout of a student-role account, trusted `app_metadata` only, verified session restoration through `auth.getUser()`, logout, safe Korean error mapping, and credential redaction.

- [ ] **Step 2: Write failing password-operation tests**

Cover 6-72 character validation, `auth.updateUser({ password })` for the teacher's own password, normalized student name sent to `functions.invoke('teacher-reset-password')`, and no password/token in returned values or errors.

- [ ] **Step 3: Register and run the focused test**

Run: `npm.cmd run test:admin-auth-v2`

Expected: FAIL because `src/admin-auth-v2.js` does not exist.

- [ ] **Step 4: Implement the minimal module**

Keep the raw client and session private. Re-check the teacher role before each password-changing operation. Convert function `403`, missing-student, rate-limit, offline, and generic failures into distinct safe error codes.

- [ ] **Step 5: Run the focused test**

Expected: every admin Auth unit test passes.

---

### Task 2: Add the undeployed teacher reset Edge Function

**Files:**
- Create: `supabase/functions/teacher-reset-password/index.ts`
- Create: `supabase/functions/teacher-reset-password/deno.json`
- Create: `supabase/config.toml`
- Create: `tests/teacher-reset-function.test.mjs`
- Modify: `package.json`
- Modify: `tools/run-baseline.ps1`

**Interfaces:**
- Accepts POST JSON `{ normalizedName:string, newPassword:string }` with the caller's bearer token.
- Returns `{ ok:true, displayName:string }` only; never returns credentials, user email, session tokens, or the service-role key.

- [ ] **Step 1: Write failing static security-contract tests**

Assert pinned Supabase imports, POST-only handling, bearer-token verification with `auth.getUser`, role check from `app_metadata`, 6-72 password validation, lookup in `player_profiles_v2`, `auth.admin.updateUserById`, and server secrets read only through `Deno.env.get`.

- [ ] **Step 2: Assert dangerous patterns are absent**

Reject hard-coded secret values, `user_metadata.role` authorization, logging request bodies/passwords/tokens, wildcard student updates, and any response containing the new password.

- [ ] **Step 3: Register and run the focused test**

Run: `npm.cmd run test:teacher-reset-function`

Expected: FAIL because the Edge Function files do not exist.

- [ ] **Step 4: Implement the Edge Function**

Create an anon client carrying the request Authorization header to verify the caller, then a separate service client from `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`. Query exactly one profile by `normalized_name`, update exactly that Auth `user_id`, and return minimal JSON with no-store headers.

- [ ] **Step 5: Keep deployment disabled**

Document the function in `supabase/config.toml` with JWT verification enabled. Do not run `supabase functions deploy`.

- [ ] **Step 6: Run the focused test**

Expected: all Edge Function security-contract tests pass.

---

### Task 3: Connect secure teacher login and reset UI behind the existing switch

**Files:**
- Modify: `index.html`
- Modify: `src/admin-dashboard.js`
- Create: `tests/secure-teacher-auth-v2.test.mjs`
- Create: `tools/browser-smoke/try_secure_teacher_auth_v2.js`
- Modify: `package.json`
- Modify: `tools/run-baseline.ps1`

**Interfaces:**
- Secure `admin-dashboard.js` constructs a distinct client with `{ auth:{ storageKey:'ysb_teacher_auth_v2', persistSession:true } }`.
- Secure globals: `adminTeacherLogin`, `adminTeacherLogout`, `adminResetStudentPassword`, and `adminSaveTeacherSettings` delegate only to `YuksamAdminAuthV2`.

- [ ] **Step 1: Write failing static UI-boundary tests**

Assert `admin-auth-v2.js` loads before `admin-dashboard.js`; secure client storage is distinct; secure HTML has teacher email/password and student reset fields; secure-mode tables and copy contain no password column or `6363`; legacy behavior remains conditional on the false flag.

- [ ] **Step 2: Write failing secure browser flows**

With harness overrides and a fake teacher client, verify teacher-role login opens the safe dashboard, student-role login stays closed, reset invokes the named Edge Function with normalized name, own password change uses Auth, secrets never enter localStorage, and logout closes authorization.

- [ ] **Step 3: Run the browser test and verify RED**

Run: `npm.cmd run test:secure-teacher-auth-v2`

Expected: FAIL because the dashboard still uses `6363` and localStorage authentication.

- [ ] **Step 4: Load and construct the secure admin module**

Add `src/admin-auth-v2.js` to the script chain. In the dashboard, construct it only when the flag is true and configuration is valid. Do not reuse or expose the student controller's client.

- [ ] **Step 5: Replace secure-mode login and settings UI**

Make secure login asynchronous with email/password inputs and a busy button. In secure mode, show only student password reset, teacher own-password change, logout, and an explicit note that cloud student/workbook/server administration arrives in the following phase. Hide every legacy password value and local management action.

- [ ] **Step 6: Preserve the legacy false-flag path**

Keep the current local `teacherStore`, `6363`, workbooks, rewards, and server switch behavior unchanged when `securityV2Enabled !== true`, so today's un-deployed app and baseline tests continue to work.

- [ ] **Step 7: Run focused and safety tests**

Run: `npm.cmd run test:secure-teacher-auth-v2`

Run: `npm.cmd run test:safety-net`

Expected: both commands exit 0.

---

### Task 4: Verify and create a local checkpoint

**Files:**
- Modify: `docs/superpowers/plans/2026-07-23-secure-teacher-auth-and-password-reset-v2.md`

- [ ] **Step 1: Run every focused security test**

Run the existing student security commands plus `test:admin-auth-v2`, `test:teacher-reset-function`, and `test:secure-teacher-auth-v2`.

- [ ] **Step 2: Run the complete suite**

Run: `npm.cmd test`

Expected: exit code 0.

- [ ] **Step 3: Verify boundaries**

Run: `git diff --check`, `git status --short`, and `git rev-list --left-right --count origin/main...HEAD`. Confirm `securityV2Enabled` remains false and no remote/deployment command ran.

- [ ] **Step 4: Create a local commit only**

Commit message: `feat: secure teacher login and password reset`

Do not push.

## Completion Boundary

This phase produces the local teacher identity and password-reset security path only. Live teacher account creation, app metadata assignment, Edge Function deployment, v2 student-list/reward/workbook/shared-state administration, GitHub push, and Vercel deployment remain later explicit phases.

## Execution Record (2026-07-23)

- Tasks 1-3 implemented test-first behind the disabled security switch.
- Focused teacher Auth, Edge Function contract, secure teacher browser flow, secure student regression, and legacy safety tests passed.
- Full `npm.cmd test` passed locally with exit code 0.
- No SQL execution, Edge Function deployment, GitHub push, Vercel deployment, or live configuration change was performed.
