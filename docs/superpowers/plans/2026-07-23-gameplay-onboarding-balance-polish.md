# Gameplay Onboarding and Balance Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved early-game UI, balance, healing, reward-presentation, and tutorial-quest improvements without deploying or enabling security v2.

**Architecture:** Add a small pure `YuksamGameplayPolishV2` rules module for deterministic calculations and fixed well definitions. Integrate it at the existing final defeat, monster factory, combat queue, reward, world-render, interaction, skill-learning, and costume-purchase boundaries while keeping the current save schema intact.

**Tech Stack:** Browser JavaScript, Canvas 2D, existing registry/pipeline globals, Node.js test runner, jsdom browser smoke harness

## Global Constraints

- Keep `src/cloud-config.js` `securityV2Enabled: false`.
- Do not execute Supabase SQL, push GitHub, or deploy Vercel.
- Preserve the current player and quest save-object formats.
- Normal Mushroom attack is 80% of current attack, rounded to nearest integer, minimum 1.
- Normal Slime HP is 110% of current HP, rounded to nearest integer.
- Elite monster values do not change.
- Before specialization, death preserves total EXP exactly; existing Gold loss remains.
- Incorrect damaging actions deal half damage per landed hit with `Math.max(1, Math.floor(hit * 0.5))`, then the monster takes its normal turn.
- Incorrect support-only actions provide no benefit.
- The correct answer remains visibly green for at least 2,000 ms after an incorrect answer.
- Reward resources are granted and saved immediately; only announcements are delayed.
- Reward announcement timing is EXP at 0 ms, Gold at 1,000 ms, Building at 2,000 ms when non-zero.
- Existing town healing remains and hunting maps receive exactly two wells each.

---

### Task 1: Add deterministic gameplay-polish rules

**Files:**
- Create: `src/gameplay-polish-v2.js`
- Create: `tests/gameplay-polish-v2.test.mjs`
- Modify: `index.html`
- Modify: `package.json`
- Modify: `tools/run-baseline.ps1`

**Interfaces:**
- Produces: `window.YuksamGameplayPolishV2`
- Produces: `deathExperience({ currentExp, levelStartExp, hasSpecialization })`
- Produces: `tuneNormalMonster(monster)`
- Produces: `wrongHitDamage(originalDamage)`
- Produces: `rewardSteps({ exp, gold, building })`
- Produces: `getHealingWells(mapKey)`

- [ ] **Step 1: Write the failing pure-module tests**

Add tests that load the file with `vm.runInNewContext` and assert:

```js
assert.equal(api.deathExperience({
  currentExp: 145, levelStartExp: 100, hasSpecialization:false,
}), 145);
assert.equal(api.deathExperience({
  currentExp: 145, levelStartExp: 100, hasSpecialization:true,
}), 123);

assert.deepEqual(api.tuneNormalMonster({
  type:'mushroom', attack:5, hp:10, maxHp:10, elite:false,
}), { type:'mushroom', attack:4, hp:10, maxHp:10, elite:false });
assert.deepEqual(api.tuneNormalMonster({
  type:'slime', attack:4, hp:20, maxHp:20, elite:false,
}), { type:'slime', attack:4, hp:22, maxHp:22, elite:false });
assert.equal(api.tuneNormalMonster({
  type:'slime', attack:8, hp:40, maxHp:40, elite:true,
}).maxHp, 40);

assert.equal(api.wrongHitDamage(9), 4);
assert.equal(api.wrongHitDamage(1), 1);
assert.deepEqual(Array.from(api.rewardSteps({ exp:5, gold:4, building:1 }), (step) => ({
  kind:step.kind, amount:step.amount, delayMs:step.delayMs,
})), [
  { kind:'exp', amount:5, delayMs:0 },
  { kind:'gold', amount:4, delayMs:1000 },
  { kind:'building', amount:1, delayMs:2000 },
]);
```

Assert `getHealingWells` returns frozen, distinct arrays with:

```js
forest: [{ id:'forest-entrance', x:560, y:1780 }, { id:'forest-advanced', x:2100, y:1120 }]
desert: [{ id:'desert-entrance', x:620, y:1840 }, { id:'desert-advanced', x:2140, y:1180 }]
swamp:  [{ id:'swamp-entrance', x:680, y:1940 }, { id:'swamp-advanced', x:2400, y:1220 }]
```

- [ ] **Step 2: Register the command and verify RED**

Add `test:gameplay-polish-v2` to `package.json`, add `gameplay-polish-v2` to the PowerShell `ValidateSet`, syntax checks, and test dispatch.

Run:

```powershell
npm.cmd run test:gameplay-polish-v2
```

Expected: FAIL because `src/gameplay-polish-v2.js` does not exist.

- [ ] **Step 3: Implement the pure module**

Implement a frozen browser global with numeric validation and clone-before-change behavior:

```js
(function (global) {
  'use strict';
  const WELLS = Object.freeze({
    forest:Object.freeze([
      Object.freeze({ id:'forest-entrance', x:560, y:1780 }),
      Object.freeze({ id:'forest-advanced', x:2100, y:1120 }),
    ]),
    desert:Object.freeze([
      Object.freeze({ id:'desert-entrance', x:620, y:1840 }),
      Object.freeze({ id:'desert-advanced', x:2140, y:1180 }),
    ]),
    swamp:Object.freeze([
      Object.freeze({ id:'swamp-entrance', x:680, y:1940 }),
      Object.freeze({ id:'swamp-advanced', x:2400, y:1220 }),
    ]),
  });
  const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  function deathExperience({ currentExp, levelStartExp, hasSpecialization }) {
    const current = Math.max(0, number(currentExp));
    const floor = Math.max(0, Math.min(current, number(levelStartExp)));
    if (!hasSpecialization) return current;
    return floor + Math.floor((current - floor) / 2 + 0.5);
  }
  function tuneNormalMonster(monster) {
    const next = { ...monster };
    if (next.elite) return next;
    if (next.type === 'mushroom') next.attack = Math.max(1, Math.round(number(next.attack) * 0.8));
    if (next.type === 'slime') {
      next.maxHp = Math.max(1, Math.round(number(next.maxHp ?? next.hp) * 1.1));
      next.hp = next.maxHp;
    }
    return next;
  }
  const wrongHitDamage = (damage) => number(damage) > 0
    ? Math.max(1, Math.floor(number(damage) * 0.5))
    : 0;
  function rewardSteps(reward = {}) {
    const steps = [{ kind:'exp', amount:Math.max(0, number(reward.exp)), delayMs:0 }];
    if (number(reward.gold) > 0) steps.push({ kind:'gold', amount:number(reward.gold), delayMs:1000 });
    if (number(reward.building) > 0) steps.push({ kind:'building', amount:number(reward.building), delayMs:2000 });
    return Object.freeze(steps.map(Object.freeze));
  }
  const getHealingWells = (mapKey) => WELLS[mapKey] || Object.freeze([]);
  global.YuksamGameplayPolishV2 = Object.freeze({
    deathExperience, tuneNormalMonster, wrongHitDamage, rewardSteps, getHealingWells,
  });
})(window);
```

Load it in `index.html` after `src/patch-data.js` and before `game.js`.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
npm.cmd run test:gameplay-polish-v2
npm.cmd run check:syntax
```

Expected: both exit 0.

- [ ] **Step 5: Commit**

```powershell
git add src/gameplay-polish-v2.js tests/gameplay-polish-v2.test.mjs index.html package.json tools/run-baseline.ps1
git commit -m "feat: add gameplay polish rules"
```

---

### Task 2: Apply login, costume, death, and monster balance changes

**Files:**
- Modify: `index.html`
- Modify: `src/costume-ui.js`
- Modify: `game.js`
- Create: `tests/early-game-polish-v2.test.mjs`
- Create: `tools/browser-smoke/try_early_game_polish_v2.js`
- Modify: `package.json`
- Modify: `tools/run-baseline.ps1`

**Interfaces:**
- Consumes: `YuksamGameplayPolishV2.deathExperience`
- Consumes: `YuksamGameplayPolishV2.tuneNormalMonster`
- Produces browser-observable defeat and monster factory behavior

- [ ] **Step 1: Write failing static and browser tests**

Static assertions:

```js
assert.doesNotMatch(indexHtml, /Classroom MMORPG Demo/i);
assert.match(indexHtml, /Classroom MMORPG</);
assert.match(costumeSource, /class="primary wide"[^>]*>← 상태창으로 돌아가기/);
assert.doesNotMatch(costumeSource, /상태창으로 돌아가기[^]*?#ef4444/);
```

Browser modes must assert:

- a level-4 player with no specialization keeps exact EXP after defeat but still loses current Gold;
- a specialized player loses half of current-level EXP progress;
- death copy says `전문화 전 EXP 보호` only for the protected case;
- every normal Mushroom factory result has the tuned attack;
- every normal Slime, including forest portal guards, has tuned current/max HP;
- elite Slime HP remains the pre-polish value.

- [ ] **Step 2: Register and run the focused command**

Add `test:early-game-polish-v2` and runner dispatch, then run:

```powershell
npm.cmd run test:early-game-polish-v2
```

Expected: FAIL on the current Demo text, red costume style, defeat EXP, and monster values.

- [ ] **Step 3: Make the UI edits**

Use:

```html
<div class="eyebrow">Classroom MMORPG</div>
```

and:

```html
<button class="primary wide" onclick="openCharacterPanel()" style="margin-top:10px">
  ← 상태창으로 돌아가기
</button>
```

- [ ] **Step 4: Route final defeat EXP through the helper**

In `handlePlayerDefeatV24`, replace the inline EXP formula with:

```js
const deathMinExpV50 = minExpForLevel(game.player.level);
const expProtected = !game.player.spec;
game.player.exp = YuksamGameplayPolishV2.deathExperience({
  currentExp:game.player.exp,
  levelStartExp:deathMinExpV50,
  hasSpecialization:Boolean(game.player.spec),
});
```

Render accurate copy:

```js
const expMessage = expProtected
  ? '전문화 전 EXP 보호'
  : '현재 레벨 EXP 진행도 절반 보호';
```

Keep Gold loss, respawn, full heal, and save behavior unchanged.

- [ ] **Step 5: Tune only normal factory results**

Add one local wrapper:

```js
const polishNormalMonsterV2 = (monster) => monster?.elite
  ? monster
  : Object.assign(monster, YuksamGameplayPolishV2.tuneNormalMonster(monster));
```

Apply it after `monsterBase` in `createForestMonstersV17` and to forest `boss_guard` Slimes. Do not apply it in `createEliteBossV17`.

- [ ] **Step 6: Verify**

Run:

```powershell
npm.cmd run test:early-game-polish-v2
npm.cmd run test:combat-flow
npm.cmd run test:safety-net
```

Expected: all exit 0.

- [ ] **Step 7: Commit**

```powershell
git add index.html src/costume-ui.js game.js tests/early-game-polish-v2.test.mjs tools/browser-smoke/try_early_game_polish_v2.js package.json tools/run-baseline.ps1
git commit -m "feat: soften early game balance"
```

---

### Task 3: Add half-damage wrong answers and visible correction

**Files:**
- Modify: `game.js`
- Modify: `style.css`
- Modify: `src/combat-rules.js`
- Modify: `tests/combat-rules.test.mjs`
- Modify: `tests/combat-flow.test.mjs`
- Create: `tests/wrong-answer-feedback-v2.test.mjs`
- Create: `tools/browser-smoke/try_wrong_answer_feedback_v2.js`
- Modify: `package.json`
- Modify: `tools/run-baseline.ps1`

**Interfaces:**
- Consumes: `YuksamGameplayPolishV2.wrongHitDamage`
- Produces: `YuksamCombatRules.buildWrongAnswerHits(hitInfo, fallbackDamage, scaleDamage)`
- Preserves: existing combat event queue and monster counterattack

- [ ] **Step 1: Write failing rule tests**

Specify a pure combat-rule adapter:

```js
const hits = rules.buildWrongAnswerHits([
  { dmg:9, crit:true, label:'첫 타격' },
  { dmg:1, crit:false, label:'추가 타격' },
  { dmg:0, missed:true, label:'빗나감' },
], 10, (damage) => Math.max(1, Math.floor(damage * .5)));
assert.deepEqual(hits, [
  { dmg:4, crit:false, label:'첫 타격' },
  { dmg:1, crit:false, label:'추가 타격' },
]);
```

Also assert a positive fallback creates exactly one reduced hit and zero damage returns an empty list.

- [ ] **Step 2: Write the failing browser scenario**

The browser smoke must:

- start a deterministic combat;
- submit a wrong answer;
- observe a green `.correct-answer-v2` element containing the exact answer;
- record that the correction notice duration is at least 2,000 ms;
- verify the monster loses half damage;
- verify the monster counterattack still occurs;
- verify a damaging skill consumes cooldown;
- verify no healing, shield, buff, chill, stun, or shadow stack is granted on a wrong answer.

- [ ] **Step 3: Run RED**

```powershell
npm.cmd run test:wrong-answer-feedback-v2
npm.cmd run test:combat-rules
```

Expected: FAIL because the adapter and wrong-answer damage flow do not exist.

- [ ] **Step 4: Add the pure hit adapter**

Implement `buildWrongAnswerHits` in `src/combat-rules.js`:

```js
function buildWrongAnswerHits(hitInfo, fallbackDamage, scaleDamage) {
  const scale = typeof scaleDamage === 'function' ? scaleDamage : (value) => value;
  const source = Array.isArray(hitInfo)
    ? hitInfo.filter((hit) => !hit?.missed && Number(hit?.dmg) > 0)
    : [];
  if (source.length) return source.map((hit) => ({
    dmg:scale(hit.dmg),
    crit:false,
    label:String(hit.label || ''),
  }));
  return Number(fallbackDamage) > 0
    ? [{ dmg:scale(fallbackDamage), crit:false, label:'' }]
    : [];
}
```

Export it on `YuksamCombatRules`.

- [ ] **Step 5: Refactor the action calculation for wrong-answer preview**

Change `calculateActionDamageV25` to accept:

```js
function calculateActionDamageV25({ allowBenefits = true } = {}) { ... }
```

When `allowBenefits` is false:

- calculate attack and damaging-skill hits;
- consume a damaging skill's cooldown;
- do not mutate HP, shields, buffs, charge, statuses, or secondary effects;
- do not roll or preserve critical hits;
- return `supportEffects:[]`;
- return zero damage for support-only action types.

Keep the default `allowBenefits:true` path behavior-identical for correct answers.

- [ ] **Step 6: Replace the wrong-answer branch**

In `submitCombatAnswerV25`, after recording the wrong answer:

```js
const preview = calculateActionDamageV25({ allowBenefits:false });
const wrongHits = YuksamCombatRules.buildWrongAnswerHits(
  preview.hitInfo,
  preview.damage,
  YuksamGameplayPolishV2.wrongHitDamage,
);
const correctText = escapeHtml(String(game.currentQuestion.answer));
const wrongEvents = [{
  type:'answer-wrong',
  text:`오답입니다! <span class="correct-answer-v2">정답: ${correctText}</span>`,
  duration:2200,
}];
```

Append one `monster-damage` event per reduced hit through the existing event queue. After resolution:

- if monster HP reaches zero, start the normal defeat sequence;
- otherwise clear the question/action and call `monsterCounterAttack('')`.

Add CSS for `.correct-answer-v2` with a clearly visible green color.

- [ ] **Step 7: Verify**

```powershell
npm.cmd run test:wrong-answer-feedback-v2
npm.cmd run test:combat-rules
npm.cmd run test:combat-flow
npm.cmd run test:combat-fx
```

Expected: all exit 0.

- [ ] **Step 8: Commit**

```powershell
git add game.js src/combat-rules.js style.css tests/combat-rules.test.mjs tests/combat-flow.test.mjs tests/wrong-answer-feedback-v2.test.mjs tools/browser-smoke/try_wrong_answer_feedback_v2.js package.json tools/run-baseline.ps1
git commit -m "feat: soften incorrect combat answers"
```

---

### Task 4: Add hunting-map healing wells and expand teacher interaction

**Files:**
- Modify: `game.js`
- Create: `tests/hunting-healing-wells-v2.test.mjs`
- Create: `tools/browser-smoke/try_hunting_healing_wells_v2.js`
- Modify: `package.json`
- Modify: `tools/run-baseline.ps1`

**Interfaces:**
- Consumes: `YuksamGameplayPolishV2.getHealingWells(mapKey)`
- Produces one shared map-well lookup used by rendering and interaction

- [ ] **Step 1: Write failing static and browser tests**

Assert:

- forest, desert, and swamp each expose exactly two wells;
- each entrance well is within 350 world units of the map spawn;
- each advanced well is before the first stronger-monster X coordinate;
- wells are separated from every monster spawn center by at least 90 units;
- the renderer draws each well label;
- walking within 92 units produces the `healingWell` action;
- walking outside 92 units does not;
- the town teacher candidate is available at distance 100 and unavailable beyond 120;
- the existing healing question restores full HP only for a correct answer.

- [ ] **Step 2: Run RED**

```powershell
npm.cmd run test:hunting-healing-wells-v2
```

Expected: FAIL because hunting-map wells and the expanded teacher radius do not exist.

- [ ] **Step 3: Generalize well lookup and drawing**

Add:

```js
function getCurrentHealingWellsV2() {
  if (game.currentMap === 'town') return worldDefs.town.healingWell
    ? [worldDefs.town.healingWell]
    : [];
  return YuksamGameplayPolishV2.getHealingWells(game.currentMap);
}
```

Refactor the existing well drawing into `drawHealingWellAtV2(well)` and register one world-render layer:

```js
worldRenderPipeline.registerLayer({
  id:'hunting-healing-wells-v2',
  priority:365,
  matches:({ map }) => ['forest','desert','swamp'].includes(map),
  render:() => getCurrentHealingWellsV2().forEach(drawHealingWellAtV2),
});
```

- [ ] **Step 4: Use the same collection for interaction**

Register a higher-priority candidate before the final fallback:

```js
worldInteractionRegistry.registerCandidate({
  id:'hunting-healing-wells-v2',
  priority:365,
  find:() => {
    const well = getCurrentHealingWellsV2()
      .find((entry) => distance(game.player, entry) < 92);
    return well ? { type:'healingWell', label:'E: 치유의 우물 - 문제를 풀고 회복' } : null;
  },
});
```

Reuse the existing `healingWell` action and modal.

- [ ] **Step 5: Expand Myeongjin teacher range**

Change the town NPC candidate threshold from `72` to `110`. Do not change final-boss Myeongjin range.

- [ ] **Step 6: Verify**

```powershell
npm.cmd run test:hunting-healing-wells-v2
npm.cmd run test:world-interaction-registry
npm.cmd run test:world-render-pipeline
npm.cmd run test:safety-net
```

Expected: all exit 0.

- [ ] **Step 7: Commit**

```powershell
git add game.js tests/hunting-healing-wells-v2.test.mjs tools/browser-smoke/try_hunting_healing_wells_v2.js package.json tools/run-baseline.ps1
git commit -m "feat: add hunting ground healing wells"
```

---

### Task 5: Sequence monster and quest reward announcements

**Files:**
- Modify: `game.js`
- Create: `tests/reward-presentation-v2.test.mjs`
- Create: `tools/browser-smoke/try_reward_presentation_v2.js`
- Modify: `package.json`
- Modify: `tools/run-baseline.ps1`

**Interfaces:**
- Consumes: `YuksamGameplayPolishV2.rewardSteps`
- Produces: `presentRewardSequenceV2({ title, exp, gold, building, summary })`
- Preserves immediate calls to `addExp`, `addGold`, `addBuilding`, and `savePlayer`

- [ ] **Step 1: Write failing timer and browser tests**

With injected/captured timers, assert:

```js
[
  ['EXP +5', 0],
  ['Gold +4', 1000],
  ['빌딩 +1', 2000],
]
```

Also assert:

- resources already exist on the player before the first delayed callback;
- zero Building produces no Building announcement;
- the monster's random Building drop is decided once and not rerolled by timers;
- quest claim cannot be called twice;
- chat receives one final summary;
- level-up presentation still occurs.

- [ ] **Step 2: Run RED**

```powershell
npm.cmd run test:reward-presentation-v2
```

Expected: FAIL because the current UI presents all rewards together.

- [ ] **Step 3: Add the presentation helper**

Implement:

```js
function presentRewardSequenceV2({ title, exp, gold, building, summary }) {
  const steps = YuksamGameplayPolishV2.rewardSteps({ exp, gold, building });
  steps.forEach((step) => setTimeout(() => {
    if (step.kind === 'exp') {
      showCinematicMessage(title, step.amount > 0 ? `EXP +${step.amount}` : '레벨 차이로 EXP 없음', 900);
    } else if (step.kind === 'gold') {
      showCinematicMessage('Gold 획득!', `Gold +${step.amount}`, 900);
    } else {
      showCinematicMessage('추가 빌딩 획득!', `빌딩 +${step.amount}`, 900);
    }
  }, step.delayMs));
  if (summary) appendChatMessage('system', '보상', summary);
}
```

Capture primitive values in the input object so later mutations cannot change announcements.

- [ ] **Step 4: Update monster defeat**

In `finishMonsterDefeatV25`:

- calculate Building drop once;
- grant EXP, Gold, and Building immediately;
- save immediately;
- replace the combined cinematic and separate Building toast with `presentRewardSequenceV2`;
- keep quest monster progress and victory audio unchanged.

- [ ] **Step 5: Update quest claim**

Keep `applyQuestRewardV21` synchronous and idempotent. In `claimQuestRewardV21`, replace the combined reward cinematic with `presentRewardSequenceV2` using the already-returned frozen numeric reward values.

Quest reward items may retain their existing independent item toast after the resource sequence starts.

- [ ] **Step 6: Verify**

```powershell
npm.cmd run test:reward-presentation-v2
npm.cmd run test:quest-data
npm.cmd run test:combat-flow
npm.cmd run test:safety-net
```

Expected: all exit 0.

- [ ] **Step 7: Commit**

```powershell
git add game.js tests/reward-presentation-v2.test.mjs tools/browser-smoke/try_reward_presentation_v2.js package.json tools/run-baseline.ps1
git commit -m "feat: sequence reward announcements"
```

---

### Task 6: Add skill and costume tutorial quests

**Files:**
- Modify: `src/quest-data.js`
- Modify: `game.js`
- Modify: `src/costume-ui.js`
- Modify: `tests/quest-data.test.mjs`
- Create: `tests/tutorial-quests-v2.test.mjs`
- Create: `tools/browser-smoke/try_tutorial_quests_v2.js`
- Modify: `package.json`
- Modify: `tools/run-baseline.ps1`

**Interfaces:**
- Consumes: `recordQuestActionV38(kind)`
- Produces action types: `learnSkill`, `buyCostume`
- Produces quest IDs: `tut_skill`, `tut_costume`

- [ ] **Step 1: Write failing quest-data tests**

Assert exact order:

```js
assert.deepEqual(QUEST_ORDER.slice(0, 8), [
  'tut_equip',
  'mushroom_hunt',
  'tut_shop',
  'tut_skill',
  'slime_hunt',
  'tut_costume',
  'tut_accessory',
  'elite_slime_hunt',
]);
```

Assert:

```js
assert.equal(QUEST_DEFS.tut_skill.actionType, 'learnSkill');
assert.match(QUEST_DEFS.tut_skill.pages.join(' '), /N키|스킬포인트|액티브|사용하지 않은/);
assert.equal(QUEST_DEFS.tut_costume.actionType, 'buyCostume');
assert.equal(QUEST_DEFS.tut_costume.grantOnAccept.gold, 150);
```

- [ ] **Step 2: Write failing browser tests**

Cover:

- accepting `tut_skill` after `tut_shop`;
- learning one skill changes the accepted quest to ready;
- a character who already learned a skill becomes ready on acceptance;
- accepting `tut_costume` grants exactly 150 Gold once across reopen/reload;
- a successful costume purchase completes the accepted quest;
- an unaffordable or duplicate purchase does not progress it;
- a character owning every costume becomes ready on acceptance;
- old quest objects without the two IDs continue loading.

- [ ] **Step 3: Run RED**

```powershell
npm.cmd run test:tutorial-quests-v2
npm.cmd run test:quest-data
```

Expected: FAIL because the two definitions and action hooks are absent.

- [ ] **Step 4: Add the quest definitions**

Add `tut_skill` after `tut_shop`:

```js
{
  id:'tut_skill',
  title:'첫 번째 나만의 기술',
  target:1,
  actionType:'learnSkill',
  desc:'N키로 스킬창을 열어 스킬 하나를 배우고 명진쌤에게 보고하기',
  reward:{ exp:8, gold:40, building:0 },
  pages:[
    '이제 스킬포인트를 사용하는 법을 배워보자. N키를 누르면 스킬창이 열린단다.',
    '사용하지 않은 스킬포인트가 있으면 화면에 알림이 떠. 잊지 말고 너에게 맞는 기술을 골라 보렴.',
    '액티브 스킬은 배우고 나면 전투에서 직접 눌러 사용하는 기술이야. 스킬 하나를 배우고 돌아오렴.',
  ],
  done:'좋아! 이제 전투에서 네가 배운 액티브 스킬도 직접 선택할 수 있단다.',
}
```

Add `tut_costume` after `slime_hunt`:

```js
{
  id:'tut_costume',
  title:'나만의 모험가 모습',
  target:1,
  actionType:'buyCostume',
  desc:'옷 상인 상남에게 코스튬 아이템을 하나 구매하고 명진쌤에게 보고하기',
  reward:{ exp:10, gold:35, building:0 },
  grantOnAccept:{ gold:150 },
  pages:[
    '강해지는 것도 좋지만 나다운 모습으로 모험하는 것도 중요하단다.',
    '여기 150골드를 줄게. 빌딩 화폐 상점의 옷 상인 상남에게 가 보렴.',
    '코스튬은 능력치를 바꾸지 않고 겉모습만 바꿔줘. 마음에 드는 것을 하나 사 오렴.',
  ],
  done:'정말 잘 어울리는구나! 상태창의 코스튬 칸에서 언제든 갈아입을 수 있어.',
}
```

- [ ] **Step 5: Add compatibility-aware acceptance checks**

After the existing `grantOnAccept` processing:

```js
if (id === 'tut_skill' && Object.values(game.player.skills || {}).some((rank) => Number(rank) > 0)) {
  q.progress = 1;
  q.status = 'ready';
}
if (id === 'tut_costume') {
  const costumeIds = Object.values(window.COSTUME_DEFS_V55 || {}).map((item) => item.id);
  if (costumeIds.length && costumeIds.every((itemId) => game.player.costumeInventory?.includes(itemId))) {
    q.progress = 1;
    q.status = 'ready';
  }
}
```

The existing `acceptedAt`/status guard must remain authoritative so the 150 Gold grant occurs once.

- [ ] **Step 6: Add action hooks**

After a successful `learnSkillV24` mutation and save:

```js
window.recordQuestActionV38?.('learnSkill');
```

After a successful `buyCostumeV55` Gold deduction, ownership addition, and save:

```js
window.recordQuestActionV38?.('buyCostume');
```

Do not call the hook on invalid, duplicate, or unaffordable purchases.

- [ ] **Step 7: Verify**

```powershell
npm.cmd run test:tutorial-quests-v2
npm.cmd run test:quest-data
npm.cmd run test:safety-net
```

Expected: all exit 0.

- [ ] **Step 8: Commit**

```powershell
git add src/quest-data.js game.js src/costume-ui.js tests/quest-data.test.mjs tests/tutorial-quests-v2.test.mjs tools/browser-smoke/try_tutorial_quests_v2.js package.json tools/run-baseline.ps1
git commit -m "feat: add skill and costume tutorials"
```

---

### Task 7: Full verification and local checkpoint

**Files:**
- Modify: `docs/superpowers/plans/2026-07-23-gameplay-onboarding-balance-polish.md`

- [ ] **Step 1: Run all new focused commands**

```powershell
npm.cmd run test:gameplay-polish-v2
npm.cmd run test:early-game-polish-v2
npm.cmd run test:wrong-answer-feedback-v2
npm.cmd run test:hunting-healing-wells-v2
npm.cmd run test:reward-presentation-v2
npm.cmd run test:tutorial-quests-v2
```

Expected: every command exits 0.

- [ ] **Step 2: Run affected regression suites**

```powershell
npm.cmd run test:combat-rules
npm.cmd run test:combat-flow
npm.cmd run test:world-interaction-registry
npm.cmd run test:world-render-pipeline
npm.cmd run test:quest-data
npm.cmd run test:safety-net
```

Expected: every command exits 0.

- [ ] **Step 3: Run the complete suite**

```powershell
npm.cmd test
```

Expected: exit 0 with zero failed tests.

- [ ] **Step 4: Check formatting, secrets, and deployment boundary**

```powershell
git diff --check
rg -n "^\s*securityV2Enabled\s*:" src/cloud-config.js
git status --short
```

Require the active setting to remain `false`. Inspect the diff for private keys, service-role values, tokens, unexpected generated files, and unrelated edits.

- [ ] **Step 5: Record and commit locally**

Append an execution record with the focused/full test results, then:

```powershell
git add docs/superpowers/plans/2026-07-23-gameplay-onboarding-balance-polish.md
git commit -m "docs: record gameplay polish verification"
```

Do not push, deploy, execute SQL, or enable the security switch.
