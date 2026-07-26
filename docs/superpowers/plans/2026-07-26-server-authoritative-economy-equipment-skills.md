# Server-Authoritative Economy, Equipment, and Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every non-combat currency, ownership, equipment, enhancement, specialization, and skill mutation server-authoritative.

**Architecture:** Generated immutable catalog rows give PostgreSQL the same security-relevant item and skill rules as the browser. Narrow revision-bound RPCs mutate normalized v3 rows transactionally, while a browser adapter and disabled-flag routing preserve the current live game until final cutover.

**Tech Stack:** Browser JavaScript, Node.js catalog generator/tests, PostgreSQL/Supabase migrations and RPCs, Node test runner.

## Global Constraints

- Keep `serverAuthorityV3Enabled: false`.
- Do not apply production Supabase migrations, push GitHub, or deploy Vercel.
- Never trust client prices, ownership, currency balances, level, class, specialization, ranks, success rolls, or user IDs.
- Reuse Phase 1 request receipts, request-ID validation, revision conflicts, snapshots, and audit logging.
- Do not add network calls for movement or cosmetic-only local animation.

---

### Task 1: Generate the authoritative catalog

**Files:**
- Create: `tools/generate-authority-catalog-v3.mjs`
- Create: `supabase/generated/authority-catalog-v3.sql`
- Create: `tests/authority-catalog-v3.test.mjs`
- Modify: `package.json`
- Modify: `tools/run-baseline.ps1`

**Interfaces:**
- Consumes: `window.YuksamData.ITEM_DEFS`, `window.YuksamData.V24_SKILLS`, `window.COSTUME_DEFS_V55`.
- Produces: repeatable SQL rows for `game_item_catalog_v3`, `game_skill_catalog_v3`, and `game_specialization_catalog_v3`.

- [ ] Write a failing test that runs the generator in check mode, asserts 40 base item rows, 11 costume rows (51 total), 42 skill rows, and representative price/class/prerequisite values.
- [ ] Run `npm.cmd run test:authority-catalog-v3` and verify it fails because the generator is absent.
- [ ] Implement a VM-based generator that loads `core-utils.js`, `game-data.js`, and `costume-data.js`, normalizes only security fields, sorts IDs, safely SQL-quotes JSON, and supports `--check`.
- [ ] Generate `supabase/generated/authority-catalog-v3.sql`; rerun the focused test and `git diff --check`.
- [ ] Commit with `feat: generate authoritative game catalogs`.

### Task 2: Add catalog schema and inventory-kind boundaries

**Files:**
- Create: `supabase/migrations/202607260003_server_authoritative_economy_v3.sql`
- Modify: `tests/server-authority-v3-policy.test.mjs`

**Interfaces:**
- Produces read-only catalog tables and `inventory_kind text check (inventory_kind in ('gear','costume'))`.
- Preserves the Phase 1 snapshot contract while adding `inventory_kind` to inventory rows.

- [ ] Add failing migration tests for catalog RLS/grants, inventory-kind constraints, per-kind equipped-slot uniqueness, and inclusion of generated seed SQL.
- [ ] Run `npm.cmd run test:server-authority-v3` and verify the new assertions fail.
- [ ] Create the additive migration, remove the old slot uniqueness constraint by its known name, add kind-aware unique indexes, seed catalogs, and deny authenticated mutations.
- [ ] Extend the Phase 1 snapshot builder using `create or replace` so each inventory row returns `inventory_kind`.
- [ ] Run focused tests and commit with `feat: add authoritative economy catalogs`.

### Task 3: Implement purchase and equipment RPCs

**Files:**
- Modify: `supabase/migrations/202607260003_server_authoritative_economy_v3.sql`
- Create: `tests/server-authority-v3-economy-policy.test.mjs`

**Interfaces:**
- Produces `purchase_student_item_v3(item_id text, expected_revision bigint, request_id text)`.
- Produces `equip_student_item_v3(inventory_id uuid, expected_revision bigint, request_id text)`.
- Produces `unequip_student_slot_v3(inventory_kind text, slot text, expected_revision bigint, request_id text)`.

- [ ] Write failing contract tests for auth identity, request locking, revision checks, server catalog lookup, quest-only rejection, class/level/currency checks, owned-instance equips, and single-transaction snapshot responses.
- [ ] Run the focused test and confirm failure.
- [ ] Implement the three locked-search-path RPCs using `private_read_receipt_v3`, row locks, bounded audit events, one revision increment, and `private_store_receipt_v3`.
- [ ] Verify authenticated-only execute grants and absence of direct mutation grants.
- [ ] Run both v3 policy suites and commit with `feat: add authoritative purchase and equipment actions`.

### Task 4: Implement enhancement, specialization, and skill RPCs

**Files:**
- Modify: `supabase/migrations/202607260003_server_authoritative_economy_v3.sql`
- Modify: `tests/server-authority-v3-economy-policy.test.mjs`

**Interfaces:**
- Produces `enhance_student_weapon_v3(expected_revision bigint, request_id text)`.
- Produces `choose_student_specialization_v3(spec_name text, expected_revision bigint, request_id text)`.
- Produces `learn_student_skill_v3(skill_id text, expected_revision bigint, request_id text)`.

- [ ] Add failing tests for exact cost 3, tier bounds and chances, server-only roll, once-only specialization, class-specific specs, derived skill points, unlock levels, rank limits, and prerequisite JSON checks.
- [ ] Run the focused test and confirm the new failures.
- [ ] Implement enhancement with a locked equipped instance and server `random()` outcome returned separately from the snapshot.
- [ ] Implement specialization and skill learning using catalog rows and server-derived spent/available points.
- [ ] Run focused tests and commit with `feat: add authoritative enhancement and skills`.

### Task 5: Extend the browser authority adapter

**Files:**
- Modify: `src/player-authority-v3.js`
- Modify: `tests/player-authority-v3.test.mjs`

**Interfaces:**
- Produces `purchaseItem`, `equipItem`, `unequipSlot`, `enhanceWeapon`, `chooseSpecialization`, and `learnSkill`.
- Each accepts only action identifiers plus `expectedRevision` and optional `requestId`, returning `{ player, revision, outcome? }`.

- [ ] Add failing tests for exact RPC payloads, request generation, snapshot conversion with inventory kinds, outcome validation, conflicts, and sanitized errors.
- [ ] Run the adapter suite and confirm failure.
- [ ] Implement the six bounded methods using the existing envelope and snapshot helpers.
- [ ] Run the adapter and student-access suites; commit with `feat: add authoritative economy browser adapter`.

### Task 6: Route flag-on game actions without optimistic mutation

**Files:**
- Modify: `game.js`
- Modify: `src/costume-ui.js`
- Create: `tests/server-authority-v3-economy-wiring.test.mjs`
- Modify: `tools/run-baseline.ps1`
- Modify: `package.json`

**Interfaces:**
- Produces one `applyAuthoritySnapshotV3(result)` projection helper.
- Existing global UI functions keep their names and legacy flag-off behavior.

- [ ] Add executable failing tests proving flag-on purchase, equip, unequip, enhance, specialization, costume, and skill handlers do not alter currency/ownership before an awaited response.
- [ ] Run the wiring suite and confirm failure.
- [ ] Add async v3 branches at the final effective handlers, apply returned snapshots atomically, preserve notifications/animations, prevent duplicate enhancement requests, and handle revision conflicts.
- [ ] Verify flag-off handler tests and current browser smoke tests remain unchanged.
- [ ] Run focused suites and commit with `feat: wire authoritative economy actions behind cutover`.

### Task 7: Security and regression verification

**Files:**
- Modify: `docs/server-authority-v3-cutover-checklist.md`
- Modify: `tests/server-authority-v3-economy-policy.test.mjs`

**Interfaces:**
- Produces deployment checklist evidence; does not activate or deploy v3.

- [ ] Add negative tests for other-user IDs, client-supplied prices/balances/outcomes, replay across action names, malformed IDs, duplicate ownership, and invalid catalog values.
- [ ] Run all Phase 2 focused suites and `powershell -NoProfile -ExecutionPolicy Bypass -File tools/run-baseline.ps1 check`.
- [ ] Run `powershell -NoProfile -ExecutionPolicy Bypass -File tools/run-baseline.ps1 all` and require zero failures.
- [ ] Run `git diff --check`, secret-name scans, direct mutation grant scans, and inspect `git status --short`.
- [ ] Record that live PostgreSQL execution and production rollout remain pending explicit approval; commit with `test: verify authoritative economy foundation`.

## Phase 2 Exit Criteria

- Browser clients cannot choose prices, currency results, ownership, equipment, enhancement results, specialization, or skill ranks in the v3 path.
- Replays and revision conflicts cannot duplicate spending or ownership.
- Flag-on executable tests cover every Phase 2 action; flag-off regressions remain green.
- The cutover switch remains off and no external deployment has occurred.
