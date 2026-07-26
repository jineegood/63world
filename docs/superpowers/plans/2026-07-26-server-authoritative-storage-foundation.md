# Server-Authoritative Storage Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan.

**Goal:** Add the version 3 server-owned player storage foundation so students can create and load a character, save harmless preferences, and request allowed map changes without being able to edit growth data directly.

**Architecture:** Supabase Postgres tables and `security definer` RPC functions own authoritative player state. A small browser adapter converts RPC snapshots into the existing `game.player` shape. The new path is protected by `serverAuthorityV3Enabled` and remains disabled until the later economy, combat, quest, and PvP phases are complete, so the live game never enters a half-secured state.

**Tech Stack:** PostgreSQL/Supabase RLS and RPC, browser JavaScript, Node.js built-in test runner, PowerShell baseline runner.

## Global Constraints

- Do not push to GitHub, deploy to Vercel, or apply migrations to the production Supabase project without the user's explicit approval.
- Do not migrate values from `player_profiles_v2.data`; test characters will be reset at the final cutover.
- Never accept a student-supplied `user_id`. Every student RPC derives identity from `auth.uid()`.
- Students may `SELECT` their own v3 rows but may not directly `INSERT`, `UPDATE`, or `DELETE` authoritative rows.
- Every mutation RPC uses a client-generated UUID `request_id`; repeating a request returns the saved response without applying it twice.
- Every `security definer` function sets `search_path = ''` and fully qualifies tables and functions.
- Do not enable `serverAuthorityV3Enabled` during this phase. The flag is enabled only after phases 2–5 have moved all persistent gameplay changes to RPCs.
- Write each test first, run it and confirm failure, implement the smallest change, rerun the focused test, then commit.

## Task 1: Create the v3 authoritative schema and RLS boundary

**Files:**

- Create: `supabase/migrations/202607260002_server_authoritative_player_v3.sql`
- Create: `tests/server-authority-v3-policy.test.mjs`
- Modify: `tools/run-baseline.ps1`
- Modify: `package.json`

- [ ] Add a failing policy test that loads the migration as text and verifies all seven tables exist:
  `player_core_v3`, `player_inventory_v3`, `player_skills_v3`,
  `player_quests_v3`, `player_preferences_v3`,
  `game_action_receipts_v3`, and `security_events_v3`.
- [ ] In the same test, require RLS on every table; own-row `SELECT` policies on the five player-state tables; no authenticated direct mutation grants on the four authoritative state tables; and no student policy on receipts or security events.
- [ ] Require `player_core_v3` checks for `class_name in ('warrior','mage','priest')`, level `1..10`, nonnegative currencies and experience, positive HP, a nonempty display name, and a nonnegative revision.
- [ ] Require inventory uniqueness so one inventory instance cannot occupy two rows and one equipped slot cannot contain two equipped items for the same user.
- [ ] Require preference bounds: appearance fields are strings with limited length, volumes are integers `0..100`, boolean sound flags, and tutorial acknowledgement is JSON constrained to an object under 8 KB.
- [ ] Require receipts to have primary key `(user_id, request_id)`, response JSON, action name, and creation time; require security events to store user, event type, sanitized details, and creation time.
- [ ] Add `server-authority-v3` to the runner `ValidateSet`, syntax/check section, focused test section, and `package.json` as `test:server-authority-v3`.
- [ ] Run `npm run test:server-authority-v3` and confirm it fails because the migration is absent.
- [ ] Create the migration with the seven tables, foreign keys to `auth.users`, constraints, indexes for `user_id`/timestamps, RLS policies, and explicit grant/revoke statements.
- [ ] Add helper functions inside the migration:
  `private_is_teacher_v3()` using the existing trusted `auth.jwt().app_metadata.role`
  rule from `public.is_teacher()`,
  `private_log_security_event_v3(event_type, details)`,
  and `private_read_receipt_v3(request_id, action_name)`.
  Revoke all three from `public`, `anon`, and `authenticated`.
- [ ] Run `npm run test:server-authority-v3`; expect all schema/RLS assertions to pass.
- [ ] Commit: `git add supabase/migrations/202607260002_server_authoritative_player_v3.sql tests/server-authority-v3-policy.test.mjs tools/run-baseline.ps1 package.json && git commit -m "feat: add authoritative player v3 schema"`

## Task 2: Implement character creation and snapshot loading RPCs

**Files:**

- Modify: `supabase/migrations/202607260002_server_authoritative_player_v3.sql`
- Modify: `tests/server-authority-v3-policy.test.mjs`

- [ ] Add failing source-contract tests for `create_student_character_v3(p_class_name text, p_appearance jsonb, p_request_id uuid)` and `load_student_game_v3()`.
- [ ] Require both functions to use `auth.uid()`, reject unauthenticated or teacher accounts, avoid a user-id parameter, set an empty search path, and be executable only by `authenticated`.
- [ ] Require the create RPC to accept only the three known classes and an appearance object containing only `shirt`, `pants`, `hair`, `hairStyle`, `skin`, and `accessory`, with every value a bounded string.
- [ ] Require server-owned defaults: level 1, exp 0, gold 20, building 0, full class-derived HP, map `town`, revision 1, and exactly one equipped starter weapon:
  `training_greatsword`, `training_staff`, or `training_book`.
- [ ] Require display name to come from the authenticated user's existing
  `player_profiles_v2.display_name`, not from the request, and require an
  existing character to be returned unchanged.
- [ ] Require character creation to lock the account/core row, write core, starter inventory, empty skills/quests, and preferences in one transaction, then store the response in `game_action_receipts_v3`.
- [ ] Require `load_student_game_v3()` to return one JSON object with `core`, `inventory`, `skills`, `quests`, `preferences`, and top-level `revision`, ordered deterministically by item/skill/quest ID.
- [ ] Run the focused test and confirm the new assertions fail.
- [ ] Implement both RPCs and a private snapshot helper `private_build_student_snapshot_v3(user_id)` that is not granted to browser roles.
- [ ] Sanitize errors: expected validation failures return stable codes/messages, while internal SQL details are not copied into response JSON or security-event details.
- [ ] Run `npm run test:server-authority-v3`; expect all tests to pass.
- [ ] Commit: `git add supabase/migrations/202607260002_server_authoritative_player_v3.sql tests/server-authority-v3-policy.test.mjs && git commit -m "feat: add authoritative character create and load rpcs"`

## Task 3: Implement preferences, map transitions, and replay protection

**Files:**

- Modify: `supabase/migrations/202607260002_server_authoritative_player_v3.sql`
- Modify: `tests/server-authority-v3-policy.test.mjs`

- [ ] Add failing tests for `save_student_preferences_v3(p_preferences jsonb, p_expected_revision bigint, p_request_id uuid)` and `transition_student_map_v3(p_target_map text, p_expected_revision bigint, p_request_id uuid)`.
- [ ] Require both RPCs to lock `player_core_v3`, compare `p_expected_revision`, return a stable `REVISION_CONFLICT` response with the current snapshot, increment revision exactly once on success, and return the stored receipt on duplicate `request_id`.
- [ ] Require preference input to reject unknown keys and all authoritative names including `level`, `exp`, `gold`, `building`, `hp`, `map`, `inventory`, `equipment`, `skills`, `quests`, `records`, and PvP wins/losses.
- [ ] Require the map RPC to use a server-side adjacency list for:
  `town`, `equipmentShop`, `buildingShopInterior`, `petShopInterior`,
  `upgradeShopInterior`, `forest`, `desert`, `swamp`, `bossRoom`, and
  `finalBossRoom`.
  Town is a permitted return destination from any non-combat map; boss-room and final-boss unlock checks are reserved for phase 3 and therefore reject entry in phase 1.
- [ ] Require invalid preference keys, invalid map names, illegal edges, revision conflicts, malformed UUIDs, and repeated rejected calls to record a bounded security event; ordinary successful actions must not be logged.
- [ ] Require receipts older than seven days and security events older than thirty days to be removable by teacher-only cleanup RPC `cleanup_server_authority_v3()`.
- [ ] Run the focused test and confirm failure.
- [ ] Implement the two RPCs, the fixed adjacency validation, stable JSON envelopes (`ok`, `code`, `snapshot`), receipt storage, revision handling, and cleanup RPC.
- [ ] Run `npm run test:server-authority-v3`; expect all tests to pass.
- [ ] Commit: `git add supabase/migrations/202607260002_server_authoritative_player_v3.sql tests/server-authority-v3-policy.test.mjs && git commit -m "feat: add safe preference and map transition rpcs"`

## Task 4: Add the browser authority adapter

**Files:**

- Create: `src/player-authority-v3.js`
- Create: `tests/player-authority-v3.test.mjs`
- Modify: `index.html`
- Modify: `tools/run-baseline.ps1`
- Modify: `package.json`

- [ ] Add failing unit tests that load the browser module in a VM with a mocked Supabase client and verify these methods:
  `createCharacter({ className, appearance, requestId })`,
  `loadGame()`,
  `savePreferences({ preferences, expectedRevision, requestId })`,
  and `transitionMap({ targetMap, expectedRevision, requestId })`.
- [ ] Test that the adapter sends only the documented RPC arguments, generates a UUID when `requestId` is omitted, maps stable server codes into `PlayerAuthorityV3Error`, and never falls back to `player_profiles_v2`.
- [ ] Test `snapshotToLegacyPlayer(snapshot)` produces the current UI shape:
  `name`, `class`, `spec`, `level`, `exp`, `gold`, `building`, `hp`,
  `maxHp`, `map`, `appearance`, inventory IDs, equipment slots,
  skills object, quests object, empty transient combat state, and `serverRevision`.
- [ ] Test that the returned player and nested collections are fresh values, unknown server fields are discarded, coordinates are set only to the local map spawn later by `game.js`, and malformed snapshots fail closed.
- [ ] Add `player-authority-v3` to the baseline runner and `package.json`; add syntax checking for the new module.
- [ ] Run `npm run test:player-authority-v3`; confirm failure because the module does not exist.
- [ ] Implement `window.YuksamPlayerAuthorityV3.create({ client })` and the pure snapshot converter.
- [ ] Load `src/player-authority-v3.js` in `index.html` after the Supabase client and before `student-access-v2.js`.
- [ ] Run `npm run test:player-authority-v3`; expect all tests to pass.
- [ ] Commit: `git add src/player-authority-v3.js tests/player-authority-v3.test.mjs index.html tools/run-baseline.ps1 package.json && git commit -m "feat: add player authority v3 browser adapter"`

## Task 5: Integrate the v3 path behind a disabled cutover flag

**Files:**

- Modify: `src/cloud-config.js`
- Modify: `src/student-access-v2.js`
- Modify: `game.js`
- Modify: `tests/student-access-v2.test.mjs`
- Create: `tests/server-authority-v3-game-wiring.test.mjs`
- Modify: `tools/run-baseline.ps1`
- Modify: `package.json`

- [ ] Add failing student-access tests for dependency injection of `authorityApi` and `config.serverAuthorityV3Enabled`.
- [ ] Require legacy behavior to remain byte-for-byte in effect when the flag is false: existing v2 load/save/cache continues and no v3 RPC is called.
- [ ] Require flag-on behavior to load through `authority.loadGame()`, return `kind:'new'` only for the stable `CHARACTER_NOT_FOUND` code, expose async `createCharacter`, `savePreferences`, and `transitionMap`, and reject authoritative `savePlayer` calls instead of writing v2 JSON.
- [ ] Add a failing game-wiring test that requires the character-create click handler to await server creation when v3 is active, disable the button during the request, normalize the returned snapshot, and start only after success.
- [ ] Require login to use the adapter snapshot; require v3 load to restore the server map while selecting client-only spawn coordinates from `worldDefs`; require network/revision errors to leave the player unchanged and show a readable message.
- [ ] Require `savePlayer()` in flag-on mode to extract only appearance, audio, UI, and tutorial preferences. It must never send currencies, HP, map, inventory, equipment, skills, quests, records, or PvP values.
- [ ] Require map-changing UI to remain on the legacy route while the flag is false. Add `requestServerMapTransitionV3(targetMap)` for later phases, but do not wire the flag on in this phase.
- [ ] Add `serverAuthorityV3Enabled: false` to `src/cloud-config.js`, add the new wiring test to the runner and package scripts, and run both focused test suites to confirm failure.
- [ ] Extend `student-access-v2.js` with the flag-aware v3 controller while preserving its public v2 API.
- [ ] Update `game.js` with the async create/load helpers, preference projection, server revision storage, and local spawn restoration.
- [ ] Run:
  `npm run test:student-access-v2`,
  `npm run test:player-authority-v3`,
  and `npm run test:server-authority-v3-game-wiring`.
  Expect all tests to pass with the flag still false.
- [ ] Commit: `git add src/cloud-config.js src/student-access-v2.js game.js tests/student-access-v2.test.mjs tests/server-authority-v3-game-wiring.test.mjs tools/run-baseline.ps1 package.json && git commit -m "feat: wire authoritative storage behind cutover flag"`

## Task 6: Add teacher reset and security-event inspection

**Files:**

- Create: `supabase/functions/teacher-reset-player-v3/index.ts`
- Modify: `supabase/config.toml`
- Modify: `src/admin-data-v2.js`
- Create: `tests/teacher-reset-player-v3.test.mjs`
- Modify: `tests/admin-data-v2.test.mjs`
- Modify: `tools/run-baseline.ps1`
- Modify: `package.json`

- [ ] Add failing function tests requiring teacher JWT verification through the
  existing trusted `app_metadata.role === 'teacher'` rule, a UUID-only
  `userId` body, and service-role invocation of one transactional database RPC
  that deletes the user's six player-owned v3 table groups.
- [ ] Add failing admin-data tests for:
  `resetPlayerV3(userId)` calling only `teacher-reset-player-v3`,
  and `listSecurityEventsV3({ limit })` returning sanitized newest-first summaries with a maximum limit of 100.
- [ ] Require students and user-metadata-only teacher claims to be rejected, following the existing v2 admin-auth pattern.
- [ ] Add a service-role-only SQL RPC
  `reset_student_character_v3(p_user_id uuid, p_teacher_user_id uuid)` to the
  migration. It deletes preferences, quests, skills, inventory, receipts, and
  core state, retains the auth account, and writes one reset security event
  naming the verified teacher. Revoke it from `public`, `anon`, and
  `authenticated`; grant it only to `service_role`.
- [ ] Implement the Edge Function as a thin wrapper that first authenticates the
  caller with the anon client, verifies trusted teacher `app_metadata`, and
  then invokes the reset RPC with the service-role client; never put the
  service-role key in browser code.
- [ ] Add the function to `supabase/config.toml`, extend `admin-data-v2.js`, and register focused tests in the runner/package scripts.
- [ ] Run `npm run test:teacher-reset-player-v3` and `npm run test:admin-data-v2`; expect all tests to pass.
- [ ] Commit: `git add supabase/migrations/202607260002_server_authoritative_player_v3.sql supabase/functions/teacher-reset-player-v3/index.ts supabase/config.toml src/admin-data-v2.js tests/teacher-reset-player-v3.test.mjs tests/admin-data-v2.test.mjs tools/run-baseline.ps1 package.json && git commit -m "feat: add teacher controls for player v3"`

## Task 7: Prove the foundation is safe without activating it

**Files:**

- Create: `docs/server-authority-v3-cutover-checklist.md`
- Modify: `tests/secure-cloud-student-admin-v2.test.mjs`
- Modify: `tests/safety-net.test.mjs`

- [ ] Add a regression assertion that production configuration still contains `serverAuthorityV3Enabled: false`.
- [ ] Add source assertions that authenticated students have no direct authoritative mutation grants and browser code contains no service-role secret.
- [ ] Add a regression assertion that the v2 route remains available while the flag is false, because phases 2–5 are not complete yet.
- [ ] Write the cutover checklist with exact future prerequisites: economy/equipment/skills RPCs, combat/question RPCs, quest RPCs, PvP v3 snapshot integration, test-account reset, production migration approval, 28-user quota simulation, and explicit flag activation.
- [ ] Document rollback as “turn the flag off before any student session begins”; do not describe copying v3 authoritative values back into the writable v2 blob.
- [ ] Run focused security tests:
  `npm run test:server-authority-v3`,
  `npm run test:player-authority-v3`,
  `npm run test:student-access-v2`,
  `npm run test:server-authority-v3-game-wiring`,
  `npm run test:teacher-reset-player-v3`,
  `npm run test:admin-data-v2`,
  and `npm run test:secure-cloud-student-admin-v2`.
- [ ] Run `npm run check:syntax`.
- [ ] Run the full suite with `powershell -NoProfile -ExecutionPolicy Bypass -File tools/run-baseline.ps1 all`; record any pre-existing failures separately and fix every regression introduced by this phase.
- [ ] Inspect `git diff --check` and `git status --short`; confirm no secrets, generated archives, or unrelated user files are staged.
- [ ] Commit: `git add docs/server-authority-v3-cutover-checklist.md tests/secure-cloud-student-admin-v2.test.mjs tests/safety-net.test.mjs && git commit -m "test: verify authoritative storage foundation"`

## Phase 1 Exit Criteria

- The v3 schema and all four student RPCs exist and are covered by focused tests.
- Direct student writes to core, inventory, skills, and quests are impossible through grants/RLS.
- Character creation and loading use server-owned defaults and authenticated identity.
- Preference and map requests are bounded, revision-checked, and replay-safe.
- Teacher reset and security-event inspection require the existing teacher role.
- The browser adapter is wired and tested, but `serverAuthorityV3Enabled` remains false.
- Existing gameplay remains usable through v2 until phases 2–5 are complete.
- Nothing has been pushed, deployed, or applied to production.
