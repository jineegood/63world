# Combat, UI, Data, and Balance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved combat feedback, UI, balance, audio, enabled-workbook, quest, and editable workbook changes on top of the current project.

**Architecture:** Preserve the current browser-only application and its final active patch functions. Move deterministic combat calculations and status metadata into `src/combat-rules.js`, then integrate them at the final active `game.js` call sites. Keep canonical class and tier values in the existing data modules and generate the editable workbook from the resulting current-data snapshot.

**Tech Stack:** Browser JavaScript, Canvas 2D, DOM/CSS, Node `node:test`, jsdom smoke harness, `@oai/artifact-tool` for `.xlsx` generation.

## Global Constraints

- Treat `C:\Users\fiost\Desktop\63world (1)\63world` as the only current source tree.
- Preserve user files and original Excel workbooks; export the updated workbook under `outputs/`.
- A turn question remains identical across basic attack, skill selection, cancellation, and action switching until the answer resolves the turn.
- Combat notices receive 600 milliseconds more viewing time and every meaningful effect receives its own visible notice.
- Enhancement probabilities are 80%, 60%, 40%, and 20%, sourced from `TIER_INFO_V27` for both display and resolution.
- `빛의 섬광` heals every living ally for 50% of that ally's maximum HP and has a four-turn cooldown.
- Specialization bundle audio applies only to that specialization's active skills; dedicated ultimate audio takes precedence.

---

### Task 1: Pure Combat Rules And Regression Tests

**Files:**
- Create: `src/combat-rules.js`
- Create: `tests/combat-rules.test.mjs`
- Modify: `index.html`
- Modify: `tools/run-baseline.ps1`
- Modify: `package.json`

**Interfaces:**
- Produces: `window.YuksamCombatRules` with `scaleMonsterStats`, `executeHpThreshold`, `mageBasicCriticalDamage`, `rollEnhancement`, `healLivingAllies`, `buildStatusBadges`, and `combatNoticeDelay`.
- Consumes: plain numbers, plain monster objects, ally objects with `hp` and `maxHp`, and shared tier chance values.

- [ ] **Step 1: Write failing pure-rule tests**

Add tests for desert `1.20/1.10`, swamp `1.30/1.20`, absolute execute thresholds `3/6/9/12/15`, mage basic critical `Math.ceil(base * 1.8)`, enhancement boundary behavior, living-ally 50% healing with max-HP clamping, required status badge metadata, and `1920 + 600 = 2520` milliseconds.

```js
assert.deepEqual(rules.scaleMonsterStats({ hp: 100, attack: 20 }, 'desert'), { hp: 120, attack: 22 });
assert.equal(rules.executeHpThreshold(5), 15);
assert.equal(rules.mageBasicCriticalDamage(10), 18);
assert.equal(rules.rollEnhancement(0.60, 0.599999), true);
assert.equal(rules.rollEnhancement(0.60, 0.60), false);
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File tools/run-baseline.ps1 combat-rules`

Expected: failure because `src/combat-rules.js` or its exported API does not exist.

- [ ] **Step 3: Implement the minimal pure API**

Use an IIFE matching the existing data modules:

```js
(function initYuksamCombatRules(global) {
  const ZONE_SCALE = { desert:{ hp:1.20, attack:1.10 }, swamp:{ hp:1.30, attack:1.20 } };
  const EXECUTE_HP = [0, 3, 6, 9, 12, 15];
  global.YuksamCombatRules = {
    combatNoticeDelay: (base = 1920) => base + 600,
    executeHpThreshold: rank => EXECUTE_HP[Math.max(0, Math.min(5, Number(rank) || 0))],
    mageBasicCriticalDamage: damage => Math.max(0, Math.ceil(Number(damage || 0) * 1.8)),
    rollEnhancement: (chance, roll) => Number(roll) < Number(chance),
    scaleMonsterStats,
    healLivingAllies,
    buildStatusBadges,
  };
})(window);
```

- [ ] **Step 4: Load the module before `game.js` and wire test scripts**

Add `<script src="src/combat-rules.js"></script>` after patch data and before `game.js`. Add a `combat-rules` case to `tools/run-baseline.ps1`, include it in `all`, and add `test:combat-rules` to `package.json`.

- [ ] **Step 5: Run focused and full tests**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File tools/run-baseline.ps1 combat-rules`

Expected: all combat-rule tests pass.

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File tools/run-baseline.ps1 all`

Expected: all existing and new test groups pass.

---

### Task 2: Canonical Skill, Tier, And Tooltip Data

**Files:**
- Modify: `src/game-data.js`
- Modify: `src/patch-data.js`
- Modify: `tests/game-data.test.mjs`
- Modify: `tests/patch-data.test.mjs`

**Interfaces:**
- Produces: updated `SKILL_DEFS` and unchanged canonical `TIER_INFO_V27` probabilities.
- Consumes: `YuksamCombatRules` thresholds and active-skill-only critical semantics during integration.

- [ ] **Step 1: Add failing data assertions**

Assert:

```js
assert.deepEqual(data.SKILL_DEFS.mage_basic_element.executeHp, [0,3,6,9,12,15]);
assert.equal(data.SKILL_DEFS.priest_basic_smite.active.cooldown, 3);
assert.equal(data.SKILL_DEFS.priest_basic_smite.active.healMaxPct, 0.15);
assert.equal(data.SKILL_DEFS.priest_holy_absorb_v24.name, '빛의 섬광');
assert.equal(data.SKILL_DEFS.priest_holy_absorb_v24.active.type, 'healAllies');
assert.equal(data.SKILL_DEFS.priest_holy_absorb_v24.active.healMaxPct, 0.50);
assert.equal(data.SKILL_DEFS.priest_holy_absorb_v24.active.cooldown, 4);
```

Also assert defense stance and shield charge use `0.25`, and every critical-damage description that affects only skills says `스킬 치명타 피해`.

- [ ] **Step 2: Run data tests and confirm RED**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File tools/run-baseline.ps1 game-data`

Expected: failures on the old percentages, names, cooldowns, or descriptions.

- [ ] **Step 3: Update canonical data**

Replace percent execution with `executeHp:[0,3,6,9,12,15]`; update priest and defensive-warrior active objects and Korean descriptions; retain `TIER_INFO_V27` chances `.80/.60/.40/.20`.

- [ ] **Step 4: Run game-data and patch-data tests**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File tools/run-baseline.ps1 game-data`

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File tools/run-baseline.ps1 patch-data`

Expected: both groups pass.

---

### Task 3: Turn Question Lock And Enabled-Workbook Gate

**Files:**
- Modify: `game.js`
- Create: `tests/combat-flow.test.mjs`
- Modify: `tools/run-baseline.ps1`
- Modify: `package.json`
- Modify: `tools/browser-smoke/try_workbook_toggle.js`
- Modify: `tools/browser-smoke/try_combat.js`

**Interfaces:**
- Produces: `getOrCreateTurnQuestionV42(zoneKey)`, `clearTurnQuestionV42(reason)`, and one enabled-workbook selector used by every combat.
- Consumes: normalized `game.questionWorkbooks`, `game.currentQuestion`, and `game.currentCombatAction`.

- [ ] **Step 1: Write failing static and browser tests**

Tests verify that action selection uses `game.currentQuestion || getQuestionForZone(...)`, cancellation never clears the turn question, changing from attack to skill keeps the same question ID, answer resolution clears it, all-enabled-off blocks the action, and boss zones use the same selector.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File tools/run-baseline.ps1 combat-flow`

Expected: failures showing current action selection replaces `game.currentQuestion` and fallback questions remain available.

- [ ] **Step 3: Implement one turn-question lifecycle**

At the final active combat handlers, set the action independently from the question:

```js
game.currentCombatAction = action;
game.currentQuestion ||= getQuestionForZone(zoneKey);
```

Return a structured unavailable result when no enabled workbook has questions; render `선생님이 활성화한 문제집이 없습니다.` and do not submit or counterattack. Clear the question only after submitted-answer resolution or a terminal combat path.

- [ ] **Step 4: Run focused browser scenarios**

Run: `node tools/browser-smoke/try_workbook_toggle.js`

Run: `node tools/browser-smoke/try_combat.js`

Expected: same-question assertions and no-enabled-workbook gate pass.

---

### Task 4: Ordered Combat Notices And Status Effects

**Files:**
- Modify: `game.js`
- Modify: `style.css`
- Modify: `tests/combat-flow.test.mjs`
- Modify: `tools/browser-smoke/try_combat.js`
- Modify: `tools/browser-smoke/try_skills2.js`

**Interfaces:**
- Produces: `queueCombatNoticesV42(notices, onComplete)` and tooltip-ready status badge markup.
- Consumes: `YuksamCombatRules.combatNoticeDelay`, existing `renderCombatFrame`, animation hooks, and combat speed multiplier.

- [ ] **Step 1: Add failing notice-order tests**

Assert explicit sequences for mushroom poison, slime shield, Stomp Earth Slam plus one-turn stun, priest-caused miss, shield absorption, healing, critical damage, and Guardian Oath revival readiness/consumption.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File tools/run-baseline.ps1 combat-flow`

Expected: failures because effects are still concatenated or skipped.

- [ ] **Step 3: Implement the notice queue**

Represent notices as `{ text, kind, duration, effect }`. Render each sequentially, disable combat choices while resolving, use the configured 2520 ms normal delay, and invoke the existing hit/skill animation callback per notice when supplied.

- [ ] **Step 4: Integrate monster patterns and player effects**

Add `stun:1` to Earth Slam. Separate poison apply/tick, slime shield creation and damage, healing, shields, misses, and revival into ordered notices. Use `신앙의 광채로 인해 공격이 빗나갔다!` when that roll causes the miss. Replace disrespectful teacher damage wording.

- [ ] **Step 5: Render badges from shared metadata**

Emit focusable badges with `data-tooltip` text for poison, stun, shield, weaken, miss chance, and `맹세 준비`. Reuse the existing tooltip module instead of introducing a second tooltip system.

- [ ] **Step 6: Run combat browser tests**

Run: `node tools/browser-smoke/try_combat.js`

Run: `node tools/browser-smoke/try_skills2.js`

Expected: ordered notices, duration, status badges, and named misses pass.

---

### Task 5: Balance Integration And Enhancement Resolution

**Files:**
- Modify: `game.js`
- Modify: `tests/combat-flow.test.mjs`
- Modify: `tools/browser-smoke/try_skills2.js`
- Modify: `tools/browser-smoke/try_items.js`

**Interfaces:**
- Consumes: canonical skill/tier data and all pure functions from `YuksamCombatRules`.
- Produces: final active combat and enhancement behavior.

- [ ] **Step 1: Add failing integration tests**

Cover absolute-HP execute, mage basic critical fixed to 180%, active-skill-only critical bonuses, solo Light Flash through an ally list, Faith Smite values, defense shield values, desert/swamp normal monsters and bosses scaled once, and all enhancement probability boundaries.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File tools/run-baseline.ps1 combat-flow`

- [ ] **Step 3: Integrate class and monster calculations**

Replace execution percent checks with `monster.hp <= executeHpThreshold(rank)`. Route mage basic critical through `mageBasicCriticalDamage`, while active skill criticals retain eligible skill-only bonuses. Route `healAllies` through a living-allies provider that currently returns `[game.player]`. Scale every desert/swamp factory and boss once at construction.

- [ ] **Step 4: Consolidate enhancement display and roll**

Generate rate rows from `window.TIER_INFO_V27.slice(1)` and resolve with:

```js
const success = YuksamCombatRules.rollEnhancement(next.chance, Math.random());
```

Ensure the final shop modal calls the final resolver and remove stale hard-coded `70/50/30/10` copy.

- [ ] **Step 5: Run skill and item browser tests**

Run: `node tools/browser-smoke/try_skills2.js`

Run: `node tools/browser-smoke/try_items.js`

Expected: all requested balance and enhancement assertions pass.

---

### Task 6: HUD, Skill Hint, And Weapon-Tier Visuals

**Files:**
- Modify: `index.html`
- Modify: `style.css`
- Modify: `src/skillpoint-hint.js`
- Modify: `game.js`
- Modify: `tools/browser-smoke/try_ui2.js`
- Modify: `tools/browser-smoke/try_items.js`

**Interfaces:**
- Produces: scoped logout styling, in-window skill hint, and shared tier visual helper.
- Consumes: `TIER_INFO_V27` colors and final character/combat canvas renderers.

- [ ] **Step 1: Add failing DOM and canvas-state tests**

Assert `logoutBtn` has a danger class, no fixed HUD bubble is created, the skill window contains the hint only with points remaining, and tier visual state is supplied to both character and combat weapon renderers.

- [ ] **Step 2: Run UI tests and confirm RED**

Run: `node tools/browser-smoke/try_ui2.js`

- [ ] **Step 3: Implement UI changes**

Add `danger` to the HUD logout button. Change `skillpoint-hint.js` to inject or update an in-flow `.skillpoint-hint-v42` inside `.skill-window-v35`, and remove fixed-position/tail styles. Apply tier outline plus aura at the weapon drawing location in both canvas renderers, using green, blue, purple, and gold from tier data.

- [ ] **Step 4: Verify desktop and narrow viewports**

Run the local game in the existing smoke harness, capture the HUD, skill window, status tooltip, and enhanced weapon at desktop and narrow widths, and confirm no clipping or overlap.

---

### Task 7: Specialization Audio Mapping

**Files:**
- Modify: `src/sfx-map.js`
- Modify: `game.js`
- Create: `tests/sfx-map.test.mjs`
- Modify: `tools/run-baseline.ps1`
- Modify: `package.json`

**Interfaces:**
- Produces: dedicated ultimate map and specialization active-skill bundle map.
- Consumes: current skill ID, class, specialization, and existing SFX settings.

- [ ] **Step 1: Add failing mapping tests**

Assert that frost/fire mage, weapon warrior, holy priest, and shadow priest specialization skills map to the supplied files; common skills map to no specialization bundle; and each supplied ultimate maps to its dedicated file.

- [ ] **Step 2: Run SFX tests and confirm RED**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File tools/run-baseline.ps1 sfx-map`

- [ ] **Step 3: Implement mapping precedence**

Use `ultimate sound -> specialization active-skill bundle -> existing generic SFX`. Keep Guardian Oath on `guardian_oath.mp3`. Route quest completion to `퀘스트 완료될때 소리.mp3`. Respect enabled and volume settings for every file.

- [ ] **Step 4: Run SFX and combat smoke tests**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File tools/run-baseline.ps1 sfx-map`

Run: `node tools/browser-smoke/try_fx.js`

Expected: mappings and playback calls pass without duplicate playback.

---

### Task 8: Quest Sheet Synchronization

**Files:**
- Read: `시트/퀘스트_수정시트.xlsx`
- Modify: `src/quest-data.js`
- Modify: `tests/quest-data.test.mjs`
- Modify: `data/game-data.snapshot.json` through the existing extractor

**Interfaces:**
- Produces: validated `QUEST_DEFS` and `QUEST_ORDER` matching the updated sheet.
- Consumes: quest identifiers, targets, rewards, dialogue, and ordering from the workbook.

- [ ] **Step 1: Import and inspect the quest workbook**

Use `@oai/artifact-tool` to inspect sheet names, used ranges, formulas, and relevant style. Render every sheet before any output workbook edit.

- [ ] **Step 2: Add failing quest-data assertions**

Create exact assertions for every sheet row, including ID uniqueness, target count, rewards, dialogue, and order.

- [ ] **Step 3: Run quest tests and confirm RED**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File tools/run-baseline.ps1 quest-data`

- [ ] **Step 4: Update quest definitions and regenerate snapshot**

Modify only canonical quest data, then run `powershell -NoProfile -ExecutionPolicy Bypass -File tools/run-baseline.ps1 extract-data`.

- [ ] **Step 5: Run quest and current-data tests**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File tools/run-baseline.ps1 quest-data`

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File tools/run-baseline.ps1 current-data`

Expected: code, order, and snapshot match.

---

### Task 9: Current Item, Skill, And Formula Workbook

**Files:**
- Read: `시트/아이템_스킬_수정시트.xlsx`
- Modify: `tools/build-current-workbook.mjs`
- Create: `outputs/combat-ui-data-balance/아이템_스킬_수정시트_인게임현행화.xlsx`

**Interfaces:**
- Consumes: `data/game-data.snapshot.json`, approved balance rules, and the original workbook's style.
- Produces: one current-data workbook with editable calculation sheets.

- [ ] **Step 1: Render and inspect the original workbook**

Inspect all sheet names, used ranges, values, formulas, and computed styles. Render every original sheet and preserve its established visual language.

- [ ] **Step 2: Extend the single workbook builder**

Populate current item and current skill sheets from the regenerated snapshot. Add editable class/specialization calculation sheets with dedicated input cells and formula cells for final attack, basic damage, skill damage, critical chance, mage basic critical fixed at 180%, active-skill critical damage, defense, healing, shields, cooldowns, and execute thresholds.

- [ ] **Step 3: Export to a new output path**

Do not overwrite either source workbook. Export exactly one final `.xlsx` artifact under `outputs/`.

- [ ] **Step 4: Inspect formulas and scan errors**

Use workbook inspection on representative calculation blocks and scan for `#REF!`, `#DIV/0!`, `#VALUE!`, `#NAME?`, and `#N/A`.

- [ ] **Step 5: Render every final sheet and repair visual defects**

Verify headers, input formatting, formulas, wrapped Korean text, widths, row heights, and freeze panes. Re-export after any repair.

---

### Task 10: Full Verification And Handoff

**Files:**
- Verify all modified files and the final workbook.

**Interfaces:**
- Consumes: every deliverable from Tasks 1-9.
- Produces: evidence-backed completion report.

- [ ] **Step 1: Run syntax and full automated tests**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File tools/run-baseline.ps1 all`

Expected: exit code 0 with every test group passing.

- [ ] **Step 2: Run all relevant browser smoke scenarios**

Run the boot, combat, combat keys, skill, item, UI, FX, quest, workbook toggle, and final boss scripts under `tools/browser-smoke/`.

Expected: each exits 0 with no uncaught boot error.

- [ ] **Step 3: Search for stale values and copy**

Search for `70%`, `50%`, `30%`, `10%` in enhancement UI code; percent-based element execution; old Light Strike name; old Faith Smite values; 25% old priest heal; and disrespectful teacher hit copy. Any remaining occurrence must be either unrelated or corrected.

- [ ] **Step 4: Verify requested behavior checklist**

Re-read the approved design and mark every requirement with its test or screenshot evidence. Report any unverified limitation explicitly.

- [ ] **Step 5: Deliver the workbook and concise change summary**

Link the single final `.xlsx` artifact and summarize the implemented game changes and verification counts. Do not claim success without fresh command output from this task.
