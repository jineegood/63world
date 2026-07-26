# Server-Authoritative PvP v3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing friendly PvP use only v3 server-owned character data and record each result exactly once in v3.

**Architecture:** Keep the existing `pvp-match-v1` endpoint, Realtime tables, browser client, and battle UI. Add a focused v3 snapshot adapter, make the Supabase store read v3 rows, and add an additive migration that serializes round submission and updates v3 win/loss counters atomically.

**Tech Stack:** Browser JavaScript, Node test runner, Supabase Edge Functions, PostgreSQL migrations, Supabase Realtime

## Global Constraints

- Preserve the approved same-question, 20-second, server d30, tie-reroll, first-strike-KO, half-effect wrong-answer flow.
- PvP must never change world HP, EXP, gold, building, inventory, pets, or quests.
- The browser must never choose combat stats, correctness, dice, damage, or win/loss values.
- Keep movement, presence broadcasting, and chat unchanged.
- Do not push GitHub, deploy Vercel, apply Supabase migrations, or deploy Edge Functions.
- Keep `src/cloud-config.js` with `serverAuthorityV3Enabled:false`.
- Work inline in the current tidy project folder as previously chosen by the user.

---

### Task 1: Canonical v3 PvP Snapshot

**Files:**
- Create: `supabase/functions/_shared/pvp-snapshot-v3.mjs`
- Create: `tests/pvp-snapshot-v3.test.mjs`

**Interfaces:**
- Consumes: `buildCombatant(source)` from `pve-combat-rules-v3.mjs`.
- Produces: `buildPvpSnapshotV3({ core, inventory, skills, preferences })`.

- [ ] **Step 1: Write failing snapshot tests**

Test that the adapter derives HP, attack, defense, learned skills, equipment, costume, and public appearance from v3 rows. Include forged legacy `attack`, `defense`, `maxHp`, and `skills` properties and assert that they do not affect the result.

```js
const snapshot = buildPvpSnapshotV3({
  core:{ user_id:'a', display_name:'A', class_name:'warrior', level:4,
    current_hp:1, spec:'무기', active_pet:null },
  inventory:[{ item_definition_id:'ironSword', inventory_kind:'gear',
    equipped_slot:'weapon', enhancement_tier:1 }],
  skills:[{ skill_id:'warrior_basic_strike', rank:1 }],
  preferences:{ shirt_color:'#fff', pants_color:'#000', hair_color:'#333',
    hair_style:'short', skin_color:'#ffd5b5', accessory:'none' },
  attack:999999,
});
assert.equal(snapshot.attack < 999999, true);
assert.equal(snapshot.hp, snapshot.maxHp);
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/pvp-snapshot-v3.test.mjs`

Expected: FAIL because `pvp-snapshot-v3.mjs` does not exist.

- [ ] **Step 3: Implement the focused adapter**

Use `buildCombatant()` as the only stat source. Set temporary PvP HP to computed maximum HP, attack to its canonical primary attack stat, and defense to a bounded value derived from canonical vitality. Convert v3 skill rows to the existing PvP skill map and expose only the equipped item IDs and safe appearance fields needed by the portrait renderer.

- [ ] **Step 4: Run the test and verify GREEN**

Run: `node --test tests/pvp-snapshot-v3.test.mjs tests/pve-combat-rules-v3.test.mjs tests/pvp-rules.test.mjs`

- [ ] **Step 5: Commit**

```powershell
git add -- supabase/functions/_shared/pvp-snapshot-v3.mjs tests/pvp-snapshot-v3.test.mjs
git commit -m "feat: derive pvp fighters from v3 state"
```

### Task 2: Atomic PvP Round and v3 Result Migration

**Files:**
- Create: `supabase/migrations/202607260006_server_authoritative_pvp_v3.sql`
- Create: `tests/server-authority-v3-pvp-policy.test.mjs`

**Interfaces:**
- Produces: service-role-only `private_submit_pvp_round_v3(uuid, integer, text, text, text) -> jsonb`.
- Replaces: `finish_pvp_match_v1(uuid, uuid, uuid, text) -> boolean` with an idempotent v3-aware body.

- [ ] **Step 1: Write failing SQL policy tests**

Assert that the additive migration:

- locks the current match before accepting a submission;
- derives the submitting user from the Edge Function argument and validates participation;
- inserts one input per player and round;
- lets only one request change a ready round to `resolving`;
- grants the private submission function only to `service_role`;
- locks both v3 core rows before incrementing `pvp_wins`, `pvp_losses`, and `revision`;
- updates legacy `pvp_records_v1` for public-profile compatibility;
- leaves EXP, gold, building, HP, inventory, pets, and quests untouched;
- keeps finish idempotent when `finished_at` is already set.

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/server-authority-v3-pvp-policy.test.mjs`

Expected: FAIL because migration `202607260006_server_authoritative_pvp_v3.sql` does not exist.

- [ ] **Step 3: Add the migration**

Add `resolving` to the match phase constraint and a nullable resolution lease timestamp. Implement a security-definer submission function that locks the match, validates the round and participant, inserts the first submission only, counts both inputs, claims resolution once when both inputs exist or the deadline passed, and returns `{waiting, resolver, round}`.

Replace `finish_pvp_match_v1` so its existing match-row lock protects both the v3 and compatibility-record updates. If either participant lacks a v3 core row, raise `PROFILE_MISSING` and do not finish the match.

- [ ] **Step 4: Run the test and verify GREEN**

Run: `node --test tests/server-authority-v3-pvp-policy.test.mjs tests/pvp-policy-v1.test.mjs`

- [ ] **Step 5: Commit**

```powershell
git add -- supabase/migrations/202607260006_server_authoritative_pvp_v3.sql tests/server-authority-v3-pvp-policy.test.mjs
git commit -m "feat: serialize authoritative pvp results"
```

### Task 3: v3 Supabase Store

**Files:**
- Modify: `supabase/functions/_shared/pvp-store.mjs`
- Create: `tests/pvp-store-v3.test.mjs`

**Interfaces:**
- Consumes: `buildPvpSnapshotV3`.
- Produces: existing store interface with v3-backed `getAuthoritativeProfile`, `getPublicProfile`, and new `submitRoundInput`.

- [ ] **Step 1: Write failing store tests**

Use a small fake Supabase query client to prove:

- profile reads target `player_core_v3`, `player_inventory_v3`, `player_skills_v3`, and `player_preferences_v3`;
- no query reads `player_profiles_v2`;
- public wins and losses come from v3 core;
- submission uses only `private_submit_pvp_round_v3`;
- profile data sent in presence cannot override the v3 snapshot.

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/pvp-store-v3.test.mjs`

Expected: FAIL because the current store still reads `player_profiles_v2`.

- [ ] **Step 3: Replace the legacy profile reader**

Read the four v3 sources with the service-role client and pass them to `buildPvpSnapshotV3`. Read profile records from `player_core_v3`. Replace direct round-input upsert with the private RPC, and keep private answer lookup, participant-only sync, Realtime events, and reconnect behavior unchanged.

- [ ] **Step 4: Run the test and verify GREEN**

Run: `node --test tests/pvp-store-v3.test.mjs tests/pvp-reconnect-v1.test.mjs`

- [ ] **Step 5: Commit**

```powershell
git add -- supabase/functions/_shared/pvp-store.mjs tests/pvp-store-v3.test.mjs
git commit -m "feat: connect pvp store to v3 players"
```

### Task 4: Service Uses the Atomic Submission Claim

**Files:**
- Modify: `supabase/functions/_shared/pvp-service.mjs`
- Modify: `tests/pvp-function-v1.test.mjs`

**Interfaces:**
- Consumes: `store.submitRoundInput(input) -> { waiting, resolver, round }`.
- Preserves: all existing endpoint operations and public response shapes.

- [ ] **Step 1: Add failing service tests**

Add cases proving that:

- a non-resolver submission returns only waiting state;
- the one resolver performs dice and combat calculation;
- a duplicate submission during `resolving` does not publish events twice;
- caller-provided combat stats, `correct`, dice, damage, wins, and losses are ignored;
- expired rounds can still be claimed through heartbeat;
- finalization still sends only match ID and server-derived participant IDs.

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/pvp-function-v1.test.mjs`

Expected: FAIL because the service calls the older insert/list sequence before claiming resolution.

- [ ] **Step 3: Use the atomic claim**

Call `submitRoundInput` first. Return waiting unless the database marks this request as resolver. Only the resolver reads the two stored inputs, privately grades them, rolls dice, computes events, and advances or finishes the match. Treat the `resolving` phase as closed to ordinary duplicate submissions while allowing server recovery after an expired lease.

- [ ] **Step 4: Run the test and verify GREEN**

Run: `node --test tests/pvp-function-v1.test.mjs tests/pvp-rules.test.mjs`

- [ ] **Step 5: Commit**

```powershell
git add -- supabase/functions/_shared/pvp-service.mjs tests/pvp-function-v1.test.mjs
git commit -m "fix: resolve each pvp round once"
```

### Task 5: Test Wiring and Cutover Checklist

**Files:**
- Modify: `tools/run-baseline.ps1`
- Modify: `package.json`
- Modify: `docs/server-authority-v3-cutover-checklist.md`

**Interfaces:**
- Produces: `npm run test:server-authority-v3-pvp`.

- [ ] **Step 1: Write a failing wiring assertion**

Extend the policy test to require the new test mode and package script, then run it before adding the entries.

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/server-authority-v3-pvp-policy.test.mjs`

- [ ] **Step 3: Add the focused test mode**

Register `server-authority-v3-pvp` in `run-baseline.ps1`, run the snapshot, policy, store, function, rules, client, profile, battle, and reconnect tests in that mode, and add the package script.

Mark Phase 5 locally complete in the cutover checklist. Keep all deployment and real-device checks unchecked and document that PostgreSQL/Supabase runtime validation still requires user approval.

- [ ] **Step 4: Run focused verification**

Run:

```powershell
npm.cmd run test:server-authority-v3-pvp
npm.cmd run check:syntax
```

- [ ] **Step 5: Commit**

```powershell
git add -- tools/run-baseline.ps1 package.json docs/server-authority-v3-cutover-checklist.md tests/server-authority-v3-pvp-policy.test.mjs
git commit -m "test: verify authoritative pvp cutover"
```

### Task 6: Full Security and Regression Verification

**Files:**
- Verify only unless a failing test exposes a scoped defect.

**Interfaces:**
- Confirms the complete local deliverable.

- [ ] **Step 1: Run the complete suite**

Run: `npm.cmd test`

Expected: exit code 0.

- [ ] **Step 2: Run repository checks**

```powershell
git diff --check
git status --short
rg -n "serverAuthorityV3Enabled" src/cloud-config.js
rg -n "player_profiles_v2|body\\.(attack|defense|maxHp|correct|damage|wins|losses)" supabase/functions/_shared/pvp-*.mjs
```

Expected: clean whitespace, the switch remains `false`, the PvP store has no legacy profile read, and the service does not trust forbidden combat/result fields.

- [ ] **Step 3: Review the diff against the approved spec**

Confirm every approved PvP behavior remains intact, movement/chat files are unchanged, and no deployment command or external write occurred.

- [ ] **Step 4: Keep the branch local**

Do not push or deploy. Report the local commits and the remaining real Supabase/browser checks in plain Korean.
