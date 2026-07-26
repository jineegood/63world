# Server-Authoritative PvE Combat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make ordinary monster combat, question grading, health changes, and
rewards server-authoritative without adding server traffic for movement,
animations, or multiplayer presence.

**Architecture:** A deterministic generated catalog feeds a pure Edge-compatible
JavaScript combat engine. A JWT-verifying Edge Function coordinates narrow
service-only PostgreSQL functions that own question secrets, revisions,
idempotency, combat sessions, and final player mutations. Browser code consumes
only safe questions and semantic presentation events behind the disabled v3
cutover flag.

**Tech Stack:** Browser JavaScript, Node.js/Deno-compatible ES modules,
Supabase Edge Functions, PostgreSQL migrations and RPCs, Node test runner.

## Global constraints

- Keep `serverAuthorityV3Enabled: false`.
- Do not apply production migrations, deploy Edge Functions, push GitHub, or
  deploy Vercel.
- Never trust client answers-as-correctness, answer keys, user IDs, stats,
  health, damage, rolls, rewards, cooldowns, levels, or balances.
- Never place workbook answers in browser-readable tables, realtime payloads,
  normal logs, audit details, or safe Edge responses.
- Add no Edge calls for movement, animation frames, presence, or chat.
- Preserve current flag-off behavior throughout implementation.

---

### Task 1: Generate the authoritative combat catalog

**Files:**
- Create: `tools/generate-combat-catalog-v3.mjs`
- Create: `supabase/functions/_shared/generated-combat-catalog-v3.mjs`
- Create: `supabase/generated/combat-monster-catalog-v3.sql`
- Create: `tests/combat-catalog-v3.test.mjs`
- Modify: `package.json`
- Modify: `tools/run-baseline.ps1`

**Interfaces:**
- Produces sorted, frozen class, item-combat, pet, skill, monster, experience,
  and death-rule data.
- Supports `node tools/generate-combat-catalog-v3.mjs --check`.

- [ ] Write a failing test that checks deterministic generated outputs and
  representative balance rules including mushroom nerf, slime health buff,
  10% base miss, wrong-answer half damage, and level thresholds.
- [ ] Run `npm.cmd run test:combat-catalog-v3` and confirm it fails because the
  generator and outputs are absent.
- [ ] Implement the generator by loading current data modules in a bounded VM,
  extracting only combat-security fields, and defining explicit canonical
  encounter rows for final effective monster variants.
- [ ] Generate both outputs, run the focused test and `git diff --check`.
- [ ] Commit with `feat: generate authoritative combat catalog`.

### Task 2: Add private combat schema and question privacy

**Files:**
- Create: `supabase/migrations/202607260004_server_authoritative_pve_combat_v3.sql`
- Create: `tests/server-authority-v3-combat-policy.test.mjs`
- Modify: `package.json`
- Modify: `tools/run-baseline.ps1`

**Interfaces:**
- Creates `game_monster_catalog_v3`,
  `player_combat_sessions_v3`,
  `player_combat_question_secrets_v3`,
  `player_question_stats_v3`, and `player_wrong_answers_v3`.
- Removes authenticated student access to the `workbooks` shared-state row
  while preserving teacher administration and classroom-settings access.

- [ ] Write failing migration contract tests for constraints, RLS, no browser
  table grants, teacher workbook access, student workbook denial, one active
  session per player, bounded text/JSON, and question-secret cleanup.
- [ ] Run the focused policy test and confirm failure.
- [ ] Add the additive migration, seed the generated monster catalog, enable
  and force RLS, revoke public access, and add teacher-only workbook policy.
- [ ] Add bounded foreign keys, status checks, timestamps, indexes, and cascade
  deletion for reset/delete compatibility.
- [ ] Run focused tests and commit with
  `feat: add private authoritative combat schema`.

### Task 3: Build the deterministic pure combat engine

**Files:**
- Create: `supabase/functions/_shared/pve-combat-rules-v3.mjs`
- Create: `tests/pve-combat-rules-v3.test.mjs`
- Modify: `package.json`
- Modify: `tools/run-baseline.ps1`

**Interfaces:**
- Exports `buildCombatant`, `startEncounter`, `resolveTurn`,
  `resolveSurrender`, and `sanitizeCombatResponse`.
- Receives an injected bounded integer random source.

- [ ] Write failing table-driven tests for stat derivation, enhancement, pets,
  correct/wrong grading, base miss, critical, multi-hit, healing, shields,
  cooldowns, status duration, monster response, victory, defeat, death-loss
  protection, surrender, and canonical rewards.
- [ ] Add negative tests for unknown actions, unlearned skills, impossible
  state, malformed answers, invalid random values, and oversized events.
- [ ] Run the focused suite and confirm failure.
- [ ] Implement the smallest pure rules engine that matches the final effective
  PvE rules and emits only allow-listed semantic events.
- [ ] Run the focused suite and commit with
  `feat: add authoritative pve combat engine`.

### Task 4: Add service-only transactional combat functions

**Files:**
- Modify: `supabase/migrations/202607260004_server_authoritative_pve_combat_v3.sql`
- Modify: `tests/server-authority-v3-combat-policy.test.mjs`

**Interfaces:**
- Creates `private_start_student_combat_v3`.
- Creates `private_prepare_student_combat_turn_v3`.
- Creates `private_commit_student_combat_turn_v3`.
- Creates `private_surrender_student_combat_v3`.
- Creates `private_resume_student_combat_v3`.

- [ ] Add failing contract tests for service-role-only execution, trusted user
  parameter use, map/encounter validation, server stat derivation, enabled
  workbook selection, private answer storage, row locks, expected revisions,
  action-scoped receipts, outcome bounds, atomic terminal rewards, level-up,
  10% building roll, death handling, and cleanup.
- [ ] Confirm no authenticated/anon execute grants and no direct table
  mutation grants.
- [ ] Implement the private functions with fixed search paths, explicit row
  locks, stable errors, request validation, and one player revision increment
  per terminal player update.
- [ ] Run both combat policy and Phase 1/2 authority suites.
- [ ] Commit with `feat: add transactional pve combat store`.

### Task 5: Add the trusted Edge combat service

**Files:**
- Create: `supabase/functions/_shared/pve-combat-service-v3.mjs`
- Create: `supabase/functions/_shared/pve-combat-store-v3.mjs`
- Create: `supabase/functions/student-combat-v3/index.ts`
- Create: `tests/pve-combat-service-v3.test.mjs`
- Create: `tests/pve-combat-function-v3.test.mjs`
- Modify: `package.json`
- Modify: `tools/run-baseline.ps1`

**Interfaces:**
- Accepts only `start`, `submit_turn`, `surrender`, and `resume`.
- Returns safe session state, events, safe question, and an authoritative player
  snapshot only when changed.

- [ ] Write failing mock-store tests for JWT-derived identity, exact store
  calls, answer grading on the server, deterministic engine injection,
  idempotent response, concurrency conflict, reconnect, surrender, and
  sanitized error mapping.
- [ ] Add source-level entrypoint tests for CORS allow-list behavior, bearer
  authentication, body-size/type limits, service client separation, and
  absence of answer keys in responses/logs.
- [ ] Implement the store adapter, service coordinator, and thin Deno
  entrypoint without accepting a client user ID.
- [ ] Run focused service/function tests and existing PvP function tests.
- [ ] Commit with `feat: add trusted pve combat edge service`.

### Task 6: Add the safe browser combat adapter

**Files:**
- Create: `src/pve-combat-client-v3.js`
- Create: `tests/pve-combat-client-v3.test.mjs`
- Modify: `index.html`
- Modify: `package.json`
- Modify: `tools/run-baseline.ps1`

**Interfaces:**
- Exposes `start`, `submitTurn`, `surrender`, and `resume`.
- Accepts only monster/action/answer identifiers plus combat revision and
  optional request ID.

- [ ] Write failing tests for exact request envelopes, generated request IDs,
  pending-action deduplication, response allow-list validation, answer-key leak
  rejection, stable errors, timeout/network retry safety, and no service key.
- [ ] Confirm the suite fails before implementation.
- [ ] Implement a session-token Edge adapter that validates every safe response
  field and freezes returned projections.
- [ ] Load it before the final game integration and run browser/client suites.
- [ ] Commit with `feat: add safe pve combat browser client`.

### Task 7: Route enabled combat through server results

**Files:**
- Modify: `game.js`
- Modify: `src/student-access-v2.js`
- Create: `tests/server-authority-v3-combat-wiring.test.mjs`
- Modify: `tests/student-access-v2.test.mjs`
- Modify: `package.json`
- Modify: `tools/run-baseline.ps1`

**Interfaces:**
- Adds a safe combat projection helper and semantic-event presentation queue.
- Keeps all existing global handler names and flag-off behavior.

- [ ] Write executable failing tests proving the enabled entry, answer,
  surrender, victory, defeat, and reconnect paths do not grade answers or
  mutate protected state locally before an awaited response.
- [ ] Add tests proving enabled student login skips workbook download and
  disabled login retains the legacy refresh.
- [ ] Add the v3 branches at final effective handlers, disable duplicate input
  while pending, apply safe projections, and map semantic events to existing
  animation/audio/reward presentation.
- [ ] Route combat-relevant map transitions through the existing authoritative
  player-state update while leaving realtime positions unchanged.
- [ ] Run combat flow, reward presentation, wrong-answer, audio, student access,
  server-authority wiring, and browser smoke suites.
- [ ] Commit with `feat: wire pve combat behind authority cutover`.

### Task 8: Security and regression verification

**Files:**
- Modify: `docs/server-authority-v3-cutover-checklist.md`
- Modify: `tests/server-authority-v3-combat-policy.test.mjs`
- Modify: `tests/pve-combat-service-v3.test.mjs`

**Interfaces:**
- Produces deployment evidence and an atomic maintenance-window rollout order;
  does not activate or deploy v3.

- [ ] Add negative tests for forged correctness, answer-key reads, other-user
  IDs, invented stats/damage/rewards, stale revisions, cross-action request ID
  reuse, repeated victory, invalid monster/map, unknown skills, oversized
  answers, malformed outcomes, and direct workbook reads.
- [ ] Run all Phase 3 focused suites and syntax checks.
- [ ] Run the complete baseline and require zero failures.
- [ ] Run `git diff --check`, secret-value scans, service-key/client-bundle
  scans, direct mutation grant scans, and inspect `git status --short`.
- [ ] Update the Korean cutover checklist with deploy order, live SQL smoke
  tests, answer-privacy verification, invocation monitoring, and rollback.
- [ ] Commit with `test: verify authoritative pve combat foundation`.

## Phase 3 exit criteria

- A student browser cannot read workbook answers in the enabled design.
- A browser cannot choose correctness, rolls, damage, health, combat stats,
  rewards, question statistics, or terminal outcomes.
- Concurrent or repeated requests cannot apply a turn or reward twice.
- Existing animations, sounds, wrong-answer reveal, and staged rewards are
  driven only by sanitized server events.
- Movement and multiplayer presence produce no new Edge invocations.
- All focused and full regression tests pass.
- The live cutover remains off and no external deployment occurs.
