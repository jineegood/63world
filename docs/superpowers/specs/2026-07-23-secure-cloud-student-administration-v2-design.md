# Secure Cloud Student Administration v2 Design

## Goal

Give an authenticated teacher a safe cloud-backed student dashboard with student progress, wrong-answer history, reward grants, and complete account deletion. Keep the production security switch disabled and make no live Supabase, GitHub, or Vercel changes.

This phase does not include shared workbooks, server-open state, cheats, or other classroom settings. Those remain a separate follow-up phase.

## Chosen Approach

Use three narrow boundaries instead of letting the dashboard rewrite whole player records:

1. The teacher browser client reads `player_profiles_v2` through the existing teacher RLS policy.
2. Reward grants are written to a new append-only queue and claimed atomically by the student at the next secure profile load.
3. Complete account deletion goes through a teacher-only Edge Function because deleting the Supabase Auth user requires a server-only service-role key.

This is safer than direct browser updates. A teacher reward cannot be lost when an online student later saves an older character snapshot, and account deletion removes the Auth account instead of leaving an unusable login behind.

## Browser Module

Create `src/admin-data-v2.js` as the only secure dashboard data boundary. It receives the already separate teacher Supabase client and exposes:

- `listStudents(): Promise<StudentAdminSummary[]>`
- `grantReward(userId, reward): Promise<{ displayName:string }>`
- `deleteStudent(userId): Promise<{ displayName:string }>`

`StudentAdminSummary` contains only:

- `userId`, `displayName`, and `updatedAt`
- `className`, `spec`, `level`, `exp`, `gold`, and `building`
- `records.answered`, `records.correct`, and at most the latest 30 wrong-answer entries

The module validates all returned values and strips credential-like fields recursively. It never returns the full Supabase row, session, email, password, or token. It keeps no persistent admin copy in `localStorage`.

`grantReward` accepts non-negative integers for `gold`, `building`, and `exp`, requires at least one positive value, verifies the teacher session through `auth.getUser()`, and inserts one row into `student_reward_grants_v2`. `deleteStudent` verifies the teacher session and invokes `teacher-delete-student` with only the target `userId`.

## Reward Queue and Student Claim

Add an additive migration creating `student_reward_grants_v2`:

- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `gold`, `building`, and `exp` as bounded non-negative integers
- `created_by uuid not null references auth.users(id)`
- `created_at timestamptz not null default now()`
- `claimed_at timestamptz null`
- a check requiring at least one positive reward value

RLS allows trusted teachers to select and insert grants. Students receive no direct table access.

Add `claim_student_rewards_v2()` as a security-definer PostgreSQL function. It uses `auth.uid()`, locks that student's unclaimed grants and profile, sums the reward amounts, updates only `data.gold`, `data.building`, and `data.exp`, marks the grants claimed, and returns the updated profile data. It never accepts a target user ID, so a student cannot claim another student's rewards.

`src/cloud-sync-v2.js` calls this function before its normal profile select. A reward granted while a student is already playing remains safely queued and appears on that student's next login or reload; the teacher UI states this clearly.

## Complete Account Deletion

Add the undeployed `teacher-delete-student` Edge Function. It:

1. accepts POST JSON `{ userId }` only;
2. verifies the caller bearer token with `auth.getUser()`;
3. authorizes only `user.app_metadata.role === 'teacher'`;
4. loads the exact profile to obtain a safe display name;
5. calls `auth.admin.deleteUser(userId)` with a service-role client created only from `Deno.env` secrets;
6. returns only `{ ok:true, displayName }`.

The Auth deletion cascades to the profile, leaderboard entry, and queued rewards. The function never returns or logs credentials, tokens, email addresses, request bodies, or the service-role value.

## Secure Dashboard UI

When `securityV2Enabled === true`, the students tab loads cloud summaries asynchronously and shows:

- student name, class, level, accuracy, gold, building materials, and last save time;
- reward, wrong-answer history, and account-delete actions;
- loading, empty, offline, and retry states;
- a note that rewards arrive on the student's next login or reload.

Reward and delete actions use immutable `userId` values rather than names. Destructive deletion retains a confirmation step. Buttons are disabled while a request is running so duplicate grants or deletions are not submitted accidentally.

The legacy local dashboard remains unchanged while the security switch is false. Secure mode never calls `getAllPlayers`, `loadPlayer`, `savePlayerRecord`, or `deletePlayer` for cloud administration and never displays the legacy password column.

## Error Handling

Browser errors map to short Korean messages and stable codes: `OFFLINE`, `FORBIDDEN`, `STUDENT_NOT_FOUND`, `INVALID_REWARD`, `RATE_LIMITED`, `LOAD_FAILED`, `GRANT_FAILED`, and `DELETE_FAILED`. Raw Supabase messages and request data never reach the UI.

A failed reward insert changes nothing. A failed claim leaves the grant unclaimed for a later retry. A failed account deletion leaves the account intact and refreshes no dashboard state.

## Verification

Automated tests cover:

- sanitized cloud student summaries with no passwords, emails, or tokens;
- trusted teacher-role verification before every mutation;
- reward validation and exact append-only inserts;
- atomic claim SQL contracts and cross-user denial;
- complete Auth deletion through a server-only Edge Function;
- secure browser list, wrong-log, reward, delete, retry, and error flows;
- unchanged legacy behavior with the switch false;
- existing secure student login/save behavior and the complete project suite.

## Deployment Boundary

This phase creates local code, migration text, Edge Function source, and tests only. It does not run SQL, create a teacher account, assign app metadata, deploy an Edge Function, enable `securityV2Enabled`, push GitHub, or deploy Vercel.
