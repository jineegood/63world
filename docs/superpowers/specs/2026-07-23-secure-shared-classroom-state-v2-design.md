# Secure Shared Classroom State v2 Design

## Goal

Make workbooks and the classroom open/closed setting consistent across teacher and student devices without weakening the v2 authentication model. Preserve the current local behavior while `securityV2Enabled` is false and make no live Supabase, GitHub, or Vercel changes.

This phase covers shared workbooks and the server-open classroom setting only. Realtime multiplayer, chat, leaderboard work, live teacher provisioning, and deployment remain separate phases.

## Chosen Approach

Use two narrowly defined rows in the existing `shared_state_v2` table and refresh them with ordinary authenticated reads:

- `classroom_settings`: `{ version:1, serverOpen:boolean }`
- `workbooks`: `{ version:1, items:Workbook[] }`

The classroom setting is safe for anonymous read so the landing page can block a new login before creating or authenticating an account. Workbooks require an authenticated user. Only a trusted teacher may insert, update, or delete either row.

The client refreshes shared state every 15 seconds instead of opening Realtime channels. This is easier to recover, test, and reason about while still updating quickly enough for a classroom. A later Realtime phase can replace polling without changing the stored shape.

## Database Access

Add an additive migration that replaces the broad authenticated read policy on `shared_state_v2` with row-specific policies:

- anon and authenticated users may select only `key = 'classroom_settings'`;
- authenticated users may additionally select `key = 'workbooks'`;
- trusted teachers retain all-row administration through `public.is_teacher()`;
- anon and ordinary students receive no insert, update, or delete policy.

Grant `select` on `shared_state_v2` to anon so the row policy can expose only the classroom setting. The existing teacher table privileges remain. No legacy `shared_state` table is changed.

## Shared-State Browser Module

Create `src/shared-state-v2.js` as the single validation and persistence boundary. `create({ client, storage, schedule, cancelSchedule })` exposes:

- `refreshClassroomSettings(): Promise<{ serverOpen:boolean, source:'remote'|'cache'|'default' }>`
- `refreshWorkbooks(): Promise<{ workbooks:Workbook[], source:'remote'|'cache'|'default' }>`
- `getServerOpen(): boolean`
- `getWorkbooks(): Workbook[]`
- `saveWorkbooks(workbooks): Promise<void>`
- `setServerOpen(open): Promise<void>`
- `startPolling({ onClassroomChange, onWorkbooksChange }): void`
- `stopPolling(): void`

The module accepts only exact shared keys and validates every remote or cached value. It never writes to the legacy keys `ysb_teacher_v1`, `ysb_workbooks_v3`, or `ysb_questions_v2`.

The v2 cache uses two new keys:

- `ysb_shared_v2_classroom_settings`
- `ysb_shared_v2_workbooks`

These caches contain no credentials or student data. Returned objects and arrays are defensive frozen copies so callers cannot silently mutate module state.

## Workbook Validation

Workbook data keeps the current game shape but is bounded before use or upload:

- maximum 50 workbooks;
- maximum 200 questions per workbook;
- IDs and names are non-empty strings with fixed maximum lengths;
- zones are limited to the three existing combat zones;
- `enabled` is boolean;
- prompts, subjects, questions, answers, choices, and source text have fixed maximum lengths;
- each question has an immutable ID, workbook ID, zone, question text, answer, and at most four choices;
- credential-like keys and unknown nested objects are discarded.

Invalid remote data does not overwrite the last valid cache. A teacher save rejects an invalid collection instead of partially writing it.

## Student Flow

The secure student controller constructs the shared-state module with the existing student Supabase client.

Before secure login, the landing flow awaits `refreshClassroomSettings()`. If `serverOpen` is false, it shows the existing closed-classroom message without attempting Auth login or account creation.

After successful authentication and before entering or creating the character, it refreshes authenticated workbooks. `game.js` reads secure workbooks through the student controller while v2 is enabled and continues using the legacy local workbook functions while v2 is disabled.

Polling begins after page boot. A classroom change to closed saves the current authenticated character when possible, signs the student out, clears the active player, and returns to the landing screen. Workbook changes replace only the in-memory validated workbook snapshot used for future questions.

If a network request fails:

- use the last valid v2 cache when present;
- otherwise default `serverOpen` to true to preserve the current local/offline behavior;
- otherwise use the bundled default workbooks;
- never treat an authorization or malformed-data error as an offline fallback.

## Teacher Flow

The secure dashboard constructs a second shared-state module with the separately stored teacher client.

The secure workbooks tab reuses the current workbook layout and editing features, but every mutation awaits `saveWorkbooks` before reporting success. It supports add, bulk add, AI-generated set, enable/disable, question removal, and workbook deletion. Duplicate submissions are disabled until the request finishes.

The secure settings tab shows the current cloud server state and administrator password controls. `setServerOpen` writes only the `classroom_settings` row, refreshes the displayed state, and never touches the legacy teacher password store.

Teacher errors use safe Korean messages and leave the last confirmed UI state unchanged. The dashboard clearly shows loading, offline-cache, save-in-progress, and retry states.

## Error Handling

Stable error codes are `OFFLINE`, `FORBIDDEN`, `INVALID_SHARED_STATE`, `LOAD_FAILED`, and `SAVE_FAILED`. Raw Supabase messages, headers, sessions, and tokens never reach the UI or caches.

Remote writes use `upsert(..., { onConflict:'key' })` with only `{ key, data }`. RLS independently verifies the teacher role. A failed save does not update in-memory state or cache, so the teacher never sees an unsaved change as successful.

## Verification

Automated tests cover:

- row-specific RLS for anonymous classroom reads, authenticated workbook reads, and teacher-only writes;
- strict workbook and classroom validation with bounded payloads;
- new v2 cache isolation and credential exclusion;
- offline cache and bundled-default recovery;
- 15-second polling start/stop without duplicate timers;
- closed classroom blocking Auth before login or signup;
- closing the classroom returning an active student to landing;
- secure teacher workbook creation, editing, toggling, deletion, and server state changes;
- unchanged false-flag legacy behavior;
- all existing student, teacher, storage, combat, and browser tests.

## Deployment Boundary

This phase creates local migration text, browser modules, integrations, and tests only. It does not execute SQL, provision teacher metadata, enable `securityV2Enabled`, push GitHub, deploy Vercel, or change live Supabase policies or data.
