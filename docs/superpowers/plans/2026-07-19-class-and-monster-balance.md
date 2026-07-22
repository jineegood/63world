# Class and Monster Balance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the confirmed warrior, mage, priest, elite-monster, and Teacher Boss balance rules without changing the deferred Shadow Focus life-steal effect.

**Architecture:** Static rank schedules and tooltip copy remain in `src/game-data.js`. Runtime rules stay in the living v25 combat functions, with reusable arithmetic extracted to `src/combat-rules.js` where direct unit testing is valuable. Every state mutation remains attached to typed combat events.

**Tech Stack:** Browser JavaScript, Node test runner, jsdom combat smoke harness.

## Global Constraints

- Elite Hardening grants exactly 22.5% of monster maximum HP and remains a no-damage self-only turn.
- Shield Charge base damage is capped at 100 before a universal 150% critical multiplier; only a critical Shield Charge can exceed 100.
- Teacher Boss damage is multiplied by 1.2 before technique multipliers.
- Fire skill critical multipliers are 220/240/260/280/300% at Ember Amplification ranks 1-5; basic attack critical remains 150%.
- Holy specialization basic attacks and damaging skills cannot critically hit.
- Faith Radiance miss partition remains universal 10% plus configured 5/10/15/20/25%.
- Shadow Focus life-steal is deferred and must not be invented.
- Tooltips and specialization descriptions must match runtime values.
- Do not modify the prayer-barrier audio asset itself.

---

### Task 1: Static skill data and specialization copy

**Files:**
- Modify: `tests/game-data.test.mjs`
- Modify: `src/game-data.js`
- Modify: `tests/baseline.test.mjs` or the focused specialization-copy test that owns `openSpecModal`
- Modify: `game.js` only for `SPEC_META_V37` copy

**Interfaces:**
- Produces `mage_fire_ember_v24.critDmgBonus = [0,.20,.40,.60,.80,1]` for Task 3.
- Produces `priest_shadow_void_v24.shadowCritChance = [0,.20,.40,.60,.80,1]` for Task 4.

- [ ] Add assertions for Frost Focus Intelligence +1 while preserving three ranks and 7/21/35% stun; Frost Lance 2.1 multiplier; Mind of Winter five ranks and Intelligence +4.
- [ ] Add assertions for Ember Amplification five ranks, Intelligence +1, and five-rank bonus array.
- [ ] Add assertions for Faith Strike cooldown 5 and healMaxPct .25, Holy Barrier cooldown 6, Holy Judgment cooldown 8.
- [ ] Add assertions for Void Mastery five ranks, Spirit +2, and 20/40/60/80/100% critical array.
- [ ] Assert every corresponding `desc` and `passiveText` contains the exact new values.
- [ ] Add a source contract assertion that the Fire card says `치명타 확률 최대 45% · 스킬 치명타 피해 최대 300%` and the Holy card states it cannot critically hit.
- [ ] Run `npm.cmd run test:game-data` plus the owning UI/source suite and observe failures against old values.
- [ ] Update only the named skill objects and specialization copy.
- [ ] Re-run focused tests and `node --check src/game-data.js` / `node --check game.js`.

### Task 2: Shield Charge cap/critical and Guardian's Oath reset

**Files:**
- Modify: `tests/combat-rules.test.mjs`
- Modify: `src/combat-rules.js`
- Modify: `tools/browser-smoke/try_skills2.js`
- Modify: `tests/combat-flow.test.mjs`
- Modify: `game.js`

**Interfaces:**
- Produce `YuksamCombatRules.shieldChargeDamage(shield, critical)` returning capped base and final damage.

- [ ] Unit-test shield inputs 40, 100, and 500: non-critical outputs 40/100/100; critical outputs 60/150/150.
- [ ] Add a jsdom action test proving the shield is added before damage is derived, a normal charge never exceeds 100, a forced critical may reach 150, and chill remains a downstream modifier.
- [ ] Add a revive test beginning with a nonzero `game.combatShield`, triggering Guardian's Oath, and asserting the revive frame/state has shield zero.
- [ ] Run focused tests and verify failures against the current uncapped/noncritical charge and retained revive shield.
- [ ] Implement the pure helper and call it from the living `calculateActionDamageV25` Shield Charge branch using the normal player critical chance, while preserving the single 10% miss roll.
- [ ] Set `game.combatShield = 0` immediately before restored HP is rendered during Guardian's Oath.
- [ ] Re-run combat-rules, combat-flow, and skills2 serially.

### Task 3: Fire and Holy critical rules

**Files:**
- Modify: `tests/combat-rules.test.mjs`
- Modify: `tools/browser-smoke/try_combat_event_timing.js`
- Modify: `tests/combat-flow.test.mjs`
- Modify: `game.js`

**Interfaces:**
- Consume the Task 1 Ember bonus array.
- Produce critical multipliers used by every player hit calculation.

- [ ] Add table tests for Fire skill critical multipliers 2.2/2.4/2.6/2.8/3.0 and universal/basic critical 1.5.
- [ ] Add runtime tests proving Fire basic attacks remain 150%, each Fire multi-hit rolls independently, and rank-five Fire skill critical hits use 300%.
- [ ] Add runtime tests proving Holy basic attacks, Faith Strike, and Holy Judgment never crit even under a forced low random roll, while Shadow Priest and non-Holy classes retain universal critical behavior.
- [ ] Run the focused tests and verify the old 1.7-2.1 Fire schedule and Holy crit behavior fail.
- [ ] Change Fire skill base critical multiplier to 2.0 before adding Ember percentage points.
- [ ] Make `playerCritChanceV25` return zero for player-originated Holy specialization attacks without changing monster critical chance.
- [ ] Re-run all focused critical tests serially.

### Task 4: Elite Hardening, Void Mastery, and Teacher Boss damage

**Files:**
- Modify: `tests/combat-rules.test.mjs`
- Modify: `tools/browser-smoke/try_combat_event_timing.js`
- Modify: `tests/combat-flow.test.mjs`
- Modify: `game.js`

**Interfaces:**
- Consume Task 1 Void Mastery schedule.
- Preserve the monster technique event schema for the presentation plan.

- [ ] Update the elite Hardening runtime scenario to expect `ceil(maxHp * .225)`, zero damage events, and one monster-shield event.
- [ ] Test Void Mastery ranks 1-5 with boundary rolls and verify rank five always doubles shadow-stack damage.
- [ ] Test Teacher Boss base damage and Heavy/Homework Bomb derived damage against a deterministic base roll, all exactly 20% above the previous value after rounding.
- [ ] Verify Homework Bomb still creates two damage hit plans.
- [ ] Run focused tests and observe failures for old .15 Hardening, three-rank Void Mastery, and unbuffed Teacher damage.
- [ ] Change only the elite Hardening percentage to .225.
- [ ] Apply Teacher Boss ×1.2 immediately after its base `incoming` value is rolled and before technique branching.
- [ ] Keep technique multipliers and miss/critical/defense ordering otherwise unchanged.
- [ ] Re-run combat-flow and direct timing smoke serially.

### Task 5: Balance integration audit

**Files:**
- Inspect: `src/game-data.js`
- Inspect: `src/combat-rules.js`
- Inspect: `game.js`
- Inspect: `tests/*.test.mjs`

- [ ] Search for stale 180% Frost Lance, old cooldowns, three-rank Ember/Void/Mind data, old elite .15 Hardening, and stale Fire/Holy specialization copy.
- [ ] Confirm Shadow Focus remains unchanged and is explicitly absent from new runtime healing logic.
- [ ] Run syntax checks, game-data, combat-rules, combat-flow serially, and the relevant jsdom smokes.
- [ ] Record exact commands, pass/fail totals, and any pre-existing unrelated failure.
