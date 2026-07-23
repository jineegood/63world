# Secure Cloud Student Administration v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe cloud-backed teacher student dashboard with progress, wrong-answer history, queued rewards, and complete student account deletion without enabling or deploying v2.

**Architecture:** A focused browser module reads sanitized profile summaries and appends reward grants through teacher RLS. Students claim queued rewards atomically during secure profile load, while a narrow teacher-only Edge Function deletes the Auth user and relies on database cascades for related data. The secure dashboard delegates to these boundaries and the false-flag legacy dashboard remains unchanged.

**Tech Stack:** Browser JavaScript, Supabase JavaScript 2.110.8, PostgreSQL/RLS/PLpgSQL, Supabase Edge Functions/Deno, Node.js test runner, jsdom browser smoke tests

## Global Constraints

- Keep `securityV2Enabled: false`; do not execute SQL or deploy Edge Functions.
- Do not push GitHub or deploy Vercel.
- Never expose `SUPABASE_SERVICE_ROLE_KEY`, session tokens, teacher email, or student credentials in dashboard data or local storage.
- Authorize teachers only from `user.app_metadata.role === 'teacher'`.
- Use immutable `user_id` values for reward and deletion targets; never mutate by display name.
- Keep reward grants durable until the student claims them on the next secure login or reload.
- Preserve the complete legacy admin path while `securityV2Enabled !== true`.

---

### Task 1: Build the secure admin data browser boundary test-first

**Files:**
- Create: `src/admin-data-v2.js`
- Create: `tests/admin-data-v2.test.mjs`
- Modify: `package.json`
- Modify: `tools/run-baseline.ps1`

**Interfaces:**
- `window.YuksamAdminDataV2.create({ client })` returns:
  - `listStudents(): Promise<StudentAdminSummary[]>`
  - `grantReward(userId, { gold, building, exp }): Promise<{ displayName:string }>`
  - `deleteStudent(userId): Promise<{ displayName:string }>`
- `StudentAdminSummary` contains only `userId`, `displayName`, `updatedAt`, `className`, `spec`, `level`, `exp`, `gold`, `building`, and sanitized `records`.

- [ ] **Step 1: Write failing list and sanitization tests**

Cover teacher verification through `auth.getUser()`, ordered `player_profiles_v2` selection, numeric normalization, a maximum of 30 wrong-log records, immutable results, and recursive removal of `password`, email, access-token, refresh-token, and secret-like fields.

- [ ] **Step 2: Write failing mutation tests**

Cover UUID target validation, integer reward bounds `0..1000000`, at least one positive reward, exact insert into `student_reward_grants_v2` with `created_by` set to the verified teacher ID, exact `teacher-delete-student` invocation, and safe error codes without raw backend messages.

- [ ] **Step 3: Register the focused runner and verify RED**

Run: `npm.cmd run test:admin-data-v2`

Expected: FAIL because `src/admin-data-v2.js` does not exist.

- [ ] **Step 4: Implement the minimal module**

Keep the Supabase client and raw rows private. Query only `user_id,display_name,data,updated_at`; never persist list results. Re-check the trusted teacher role before every mutation and map failures to `OFFLINE`, `FORBIDDEN`, `STUDENT_NOT_FOUND`, `INVALID_REWARD`, `RATE_LIMITED`, `LOAD_FAILED`, `GRANT_FAILED`, or `DELETE_FAILED`.

- [ ] **Step 5: Verify GREEN**

Run: `npm.cmd run test:admin-data-v2`

Expected: all browser data-boundary tests pass.

---

### Task 2: Add the additive reward queue and atomic student claim

**Files:**
- Create: `supabase/migrations/202607230002_student_reward_grants_v2.sql`
- Create: `tests/student-reward-grants-v2.test.mjs`
- Modify: `src/cloud-sync-v2.js`
- Modify: `tests/cloud-sync-v2.test.mjs`
- Modify: `package.json`
- Modify: `tools/run-baseline.ps1`

**Interfaces:**
- Table: `public.student_reward_grants_v2(id, user_id, gold, building, exp, created_by, created_at, claimed_at)`
- RPC: `public.claim_student_rewards_v2() returns jsonb`
- `cloud-sync-v2.loadPlayer(userId)` invokes `claim_student_rewards_v2` before selecting the authenticated profile.

- [ ] **Step 1: Write failing SQL security-contract tests**

Assert additive table creation, Auth foreign keys with cascades, integer bounds, at-least-one-positive check, forced RLS, teacher-only select/insert policies using `public.is_teacher()`, no student table policy, and no anon grants.

- [ ] **Step 2: Write failing atomic-claim tests**

Assert the RPC accepts no target argument, derives the target from `auth.uid()`, locks the student's profile and unclaimed grants, atomically marks grants claimed, updates only `data.gold`, `data.building`, and `data.exp`, returns JSON data, uses a locked search path, and grants execution only to `authenticated`.

- [ ] **Step 3: Extend the cloud-sync unit test and verify RED**

Require `loadPlayer` to call `client.rpc('claim_student_rewards_v2')` before the profile select, use returned JSON when rewards were applied, fall back to the normal select when the RPC returns null, and surface claim errors without using stale cache for authorization or database failures.

Run: `npm.cmd run test:student-reward-grants-v2`

Run: `npm.cmd run test:cloud-sync-v2`

Expected: FAIL because the migration and claim call do not exist.

- [ ] **Step 4: Implement the migration and claim integration**

Use one SQL transaction inside the PL/pgSQL function. Lock the authenticated profile, update and return all matching unclaimed grants through a CTE, sum them, apply the three totals with nested `jsonb_set`, and return the resulting profile JSON. Any exception rolls back both profile and grant changes.

- [ ] **Step 5: Verify GREEN**

Run both focused commands again and expect exit code 0.

---

### Task 3: Add complete student account deletion

**Files:**
- Create: `supabase/functions/teacher-delete-student/index.ts`
- Create: `supabase/functions/teacher-delete-student/deno.json`
- Create: `tests/teacher-delete-function.test.mjs`
- Modify: `supabase/config.toml`
- Modify: `package.json`
- Modify: `tools/run-baseline.ps1`

**Interfaces:**
- Accept POST JSON `{ userId:string }`.
- Return `{ ok:true, displayName:string }` only.

- [ ] **Step 1: Write failing static security-contract tests**

Assert pinned Supabase 2.110.8 import, POST-only behavior, bearer verification with `auth.getUser()`, trusted `app_metadata.role`, UUID validation, exact profile lookup by `user_id`, `auth.admin.deleteUser(userId)`, server secrets only through `Deno.env.get`, JWT verification in `supabase/config.toml`, no credential response, and no request/token logging.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm.cmd run test:teacher-delete-function`

Expected: FAIL because the function does not exist.

- [ ] **Step 3: Implement the minimal Edge Function**

Reuse the response and caller-verification structure of `teacher-reset-password` without sharing mutable state. Look up the profile before deletion, delete exactly one Auth user through the service client, and return only the saved display name.

- [ ] **Step 4: Keep deployment disabled and verify GREEN**

Do not run a Supabase deployment command. Run the focused test and expect exit code 0.

---

### Task 4: Connect the cloud student dashboard behind the switch

**Files:**
- Modify: `index.html`
- Modify: `src/admin-dashboard.js`
- Create: `tests/secure-cloud-student-admin-v2.test.mjs`
- Create: `tools/browser-smoke/try_secure_cloud_student_admin_v2.js`
- Modify: `package.json`
- Modify: `tools/run-baseline.ps1`

**Interfaces:**
- Load `src/admin-data-v2.js` before `src/admin-dashboard.js`.
- Secure UI delegates list, grant, and delete operations only to `secureAdminDataV2`.
- Secure action globals use user IDs: `adminOpenGrantModalV2`, `adminGrantRewardV2`, `adminOpenWrongLogV2`, `adminConfirmDeleteStudentV2`, and `adminDeleteStudentV2`.

- [ ] **Step 1: Write failing static boundary tests**

Assert script order, use of the separate teacher client, v2 delegation, immutable user-ID action targets, and absence of legacy storage calls in secure branches.

- [ ] **Step 2: Write failing browser flows**

Verify loading and retry states, sorted cloud student rows, safe progress rendering, wrong-log escaping, successful queued reward with cleared inputs and next-login copy, duplicate-click blocking, confirmed full deletion, list refresh, no credentials in DOM/localStorage, and unchanged student-role denial.

- [ ] **Step 3: Run and verify RED**

Run: `npm.cmd run test:secure-cloud-student-admin-v2`

Expected: FAIL because secure mode still shows only the reset form.

- [ ] **Step 4: Construct and render the secure data boundary**

Create `secureAdminDataV2` from the same separately stored teacher client used by `secureAdminAuthV2`. Keep summaries in memory only, render explicit loading/empty/error states, and retry with a fresh list request.

- [ ] **Step 5: Connect safe actions**

Render reward, wrong-answer, reset-password, and delete controls for each immutable user ID. Disable submission during mutations, refresh after success, keep confirmation before deletion, and state that queued rewards arrive at next login or reload.

- [ ] **Step 6: Preserve false-flag legacy behavior**

When secure mode is false, keep the existing local student table, reward behavior, wrong logs, account deletion, password column, workbooks, and server settings unchanged.

- [ ] **Step 7: Verify focused and regression tests**

Run: `npm.cmd run test:secure-cloud-student-admin-v2`

Run: `npm.cmd run test:secure-teacher-auth-v2`

Run: `npm.cmd run test:secure-student-login-v2`

Run: `npm.cmd run test:safety-net`

Expected: every command exits 0.

---

### Task 5: Verify and create a local checkpoint

**Files:**
- Modify: `docs/superpowers/plans/2026-07-23-secure-cloud-student-administration-v2.md`

- [ ] **Step 1: Run all focused v2 security commands**

Run the student Auth, cloud sync, secure login, teacher Auth, password reset, admin data, reward queue, deletion, and secure dashboard commands. Every command must exit 0.

- [ ] **Step 2: Run the complete suite**

Run: `npm.cmd test`

Expected: exit code 0 with no failed tests.

- [ ] **Step 3: Verify deployment boundaries**

Run `git diff --check`, `git status --short`, `git rev-list --left-right --count origin/main...HEAD`, and confirm `src/cloud-config.js` still contains `securityV2Enabled: false`. Scan changed browser files for service-role keys and credentials.

- [ ] **Step 4: Record execution and commit locally**

Append the verification result to this plan and commit with:

```text
feat: add secure cloud student administration
```

Do not push.

## Completion Boundary

This phase ends with local, disabled cloud student administration code. Shared workbooks, server-open state, live teacher provisioning, SQL execution, Edge Function deployment, security-switch activation, GitHub push, and Vercel deployment remain later explicit phases.

## Execution Record (2026-07-23)

- Built the sanitized cloud student list, queued reward, atomic claim, wrong-log, password-reset, and complete account-deletion paths test-first.
- All focused v2 security, teacher, student, and browser regression commands passed.
- Full `npm.cmd test` passed locally with exit code 0.
- `securityV2Enabled` remains false. No SQL, Edge Function deployment, GitHub push, Vercel deployment, teacher provisioning, or live configuration change was performed.
