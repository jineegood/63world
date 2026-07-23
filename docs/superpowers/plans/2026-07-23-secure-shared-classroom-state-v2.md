# Secure Shared Classroom State v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect safe cloud workbooks and classroom open/closed state to students and teachers without enabling or deploying v2.

**Architecture:** A focused shared-state module validates two fixed `shared_state_v2` rows, maintains isolated credential-free caches, and polls every 15 seconds. The secure student controller uses it to block closed-classroom login and supply workbooks; the separate teacher client uses it for awaited workbook and classroom-setting writes. Legacy local behavior remains untouched behind the false switch.

**Tech Stack:** Browser JavaScript, Supabase JavaScript 2.110.8, PostgreSQL/RLS, Node.js test runner, jsdom browser smoke tests

## Global Constraints

- Keep `securityV2Enabled: false`; do not execute SQL or change live Supabase data.
- Do not push GitHub or deploy Vercel.
- Expose anonymous read only for `shared_state_v2.key = 'classroom_settings'`.
- Require authentication to read `workbooks`; allow writes only through the trusted teacher RLS policy.
- Poll at exactly 15000 milliseconds with at most one active timer.
- Never write v2 state to `ysb_teacher_v1`, `ysb_workbooks_v3`, or `ysb_questions_v2`.
- Preserve the complete false-flag legacy workbook and server-setting paths.

---

### Task 1: Add row-specific shared-state RLS

**Files:**
- Create: `supabase/migrations/202607230003_shared_classroom_state_v2.sql`
- Create: `tests/shared-state-policy-v2.test.mjs`
- Modify: `package.json`
- Modify: `tools/run-baseline.ps1`

**Interfaces:**
- Shared keys: `classroom_settings` and `workbooks`.
- Anon select: `classroom_settings` only.
- Authenticated select: both fixed keys.
- Teacher administration: existing `public.is_teacher()` all-row policy.

- [ ] Write static tests for exact row policies, grants, absence of anon/student writes, and no legacy-table changes.
- [ ] Run `npm.cmd run test:shared-state-policy-v2` and verify failure because the migration is absent.
- [ ] Implement the additive policy migration, dropping the old broad authenticated read policy before creating the two narrow read policies.
- [ ] Re-run the focused test and expect exit code 0.

---

### Task 2: Build the shared-state browser module test-first

**Files:**
- Create: `src/shared-state-v2.js`
- Create: `tests/shared-state-v2.test.mjs`
- Modify: `package.json`
- Modify: `tools/run-baseline.ps1`

**Interfaces:**
- `window.YuksamSharedStateV2.create({ client, storage, schedule, cancelSchedule, defaultWorkbooks })`
- Methods: `refreshClassroomSettings`, `refreshWorkbooks`, `getServerOpen`, `getWorkbooks`, `saveWorkbooks`, `setServerOpen`, `startPolling`, `stopPolling`.

- [ ] Write failing tests for exact-key queries, frozen defensive results, strict workbook bounds, credential removal, safe cache keys, offline/default fallback, authorization failure handling, teacher upserts, and safe errors.
- [ ] Write failing timer tests proving one 15000 ms poller, change callbacks, and stop cancellation.
- [ ] Run `npm.cmd run test:shared-state-v2` and verify RED.
- [ ] Implement the minimal module with private state and validate-before-commit writes.
- [ ] Re-run the focused test and expect all tests to pass.

---

### Task 3: Connect closed-classroom checks and cloud workbooks to students

**Files:**
- Modify: `index.html`
- Modify: `src/student-access-v2.js`
- Modify: `game.js`
- Modify: `tests/student-access-v2.test.mjs`
- Create: `tests/secure-shared-student-v2.test.mjs`
- Create: `tools/browser-smoke/try_secure_shared_student_v2.js`
- Modify: `package.json`
- Modify: `tools/run-baseline.ps1`

**Interfaces:**
- `student-access-v2` constructs the shared module from the existing student client.
- Added controller methods: `refreshClassroomSettings`, `isServerOpen`, `getWorkbooks`, `startSharedPolling`, `stopSharedPolling`.
- `enter(name,password)` checks classroom state before Auth and refreshes workbooks after Auth.

- [ ] Write failing unit tests proving a closed classroom causes `SERVER_CLOSED` before `enterStudent`, open login refreshes workbooks, and offline/default behavior is explicit.
- [ ] Write failing browser tests proving closed login attempts no Auth call, cloud workbooks feed question selection, and a later close saves/signs out/returns to landing.
- [ ] Run the focused student command and verify RED.
- [ ] Load `shared-state-v2.js` before `student-access-v2.js`, compose it into the controller, and route secure `getWorkbooks` through its frozen snapshot.
- [ ] Start polling once at boot and make the close callback use the existing safe save/signout/landing flow.
- [ ] Preserve all false-flag local workbook and `isServerOpen` behavior.
- [ ] Run student-access, secure student login, shared student, and safety-net tests; expect exit code 0.

---

### Task 4: Connect secure teacher workbooks and classroom settings

**Files:**
- Modify: `src/admin-dashboard.js`
- Create: `tests/secure-shared-teacher-v2.test.mjs`
- Create: `tools/browser-smoke/try_secure_shared_teacher_v2.js`
- Modify: `package.json`
- Modify: `tools/run-baseline.ps1`

**Interfaces:**
- `secureAdminSharedV2` uses the existing separately stored teacher client.
- Secure workbook and server-setting mutations await `saveWorkbooks` or `setServerOpen`.
- Legacy mutation functions keep their current behavior when secure mode is false.

- [ ] Write failing static and browser tests for secure workbook load, add, bulk add, enable/disable, question delete, workbook delete, server close/open, duplicate blocking, safe errors, and no legacy-key changes.
- [ ] Run `npm.cmd run test:secure-shared-teacher-v2` and verify RED.
- [ ] Add secure workbooks and settings tabs with loading, cached/offline, saving, and retry states.
- [ ] Route every secure workbook mutation through cloned validated arrays and await the cloud save before updating UI state.
- [ ] Route secure server open/close through the shared module and retain administrator password change/logout controls.
- [ ] Run secure shared teacher, cloud student admin, teacher Auth, secure student, and safety-net tests; expect exit code 0.

---

### Task 5: Verify and create a local checkpoint

**Files:**
- Modify: `docs/superpowers/plans/2026-07-23-secure-shared-classroom-state-v2.md`

- [ ] Run every v2 security, student, teacher, shared-state, and browser test.
- [ ] Run `npm.cmd test` and require exit code 0.
- [ ] Run `git diff --check`, inspect changed files for credentials, and confirm `securityV2Enabled: false`.
- [ ] Record results here and commit locally with `feat: add secure shared classroom state`.
- [ ] Do not push or deploy.

## Completion Boundary

This phase ends with local, disabled shared workbook and classroom-setting code. Realtime multiplayer/chat, leaderboard completion, live SQL execution, teacher provisioning, Edge Function deployment, security-switch activation, GitHub push, and Vercel deployment remain later explicit phases.

## Execution Record — 2026-07-23

- Added row-specific anonymous/authenticated read policies for the two fixed shared-state rows.
- Added the validated shared-state module, isolated v2 caches, and one 15-second poller.
- Connected closed-classroom checks, cloud workbooks, later-close save/signout, and safe local bootstrap preparation.
- Connected the separate teacher client to workbook and classroom-setting management.
- Added duplicate-question blocking and safe workbook-save error handling.
- Verified with `npm.cmd test` (exit code 0). The production security switch remains `false`.
- Kept all work local: no SQL execution, GitHub push, Vercel deployment, or live service change.
