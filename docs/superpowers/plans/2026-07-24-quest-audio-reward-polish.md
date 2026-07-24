# Quest Audio Reward Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve early quest clarity, NPC storytelling, combat music, and reward readability while preserving existing saves and combat behavior.

**Architecture:** Keep quest, costume, audio, and reward policy in their existing focused modules. Add one pure `quest-tutorial-polish-v3.js` module for tutorial state transitions and NPC intro decisions, then connect it through small late-bound calls from `game.js`.

**Tech Stack:** Browser JavaScript, Node.js test runner, HTML, MP3 assets

## Global Constraints

- Preserve the user-supplied `assets/1. 전투씬 음악_[cut_83sec].mp3`.
- Do not restore the deleted WAV.
- New behavior must live in focused `src/` modules; `game.js` receives only minimal adapters.
- Existing saves past `mushroom_hunt` must not be forced backward to the new healing tutorial.
- Quest gifts and training effects must be idempotent.
- Boss-map music priority and return-to-region music behavior must remain unchanged.
- General costume purchases must not complete the quest-only costume tutorial.

---

### Task 1: Quest number highlighting and narrative consistency

**Files:**
- Modify: `src/quest-text.js`
- Modify: `src/quest-data.js`
- Modify: `tests/quest-text.test.mjs`
- Modify: `tests/quest-data.test.mjs`
- Modify: `tests/tutorial-quests-polish-v2.test.mjs`

**Interfaces:**
- Consumes: Plain Korean quest strings and mutable `QUEST_DEFS`/`QUEST_ORDER`.
- Produces: Safe HTML from `YuksamQuestText.emphasize(text)` and a 17-quest consistent data set.

- [ ] **Step 1: Add failing highlight and quest-consistency tests**

Add assertions equivalent to:

```js
const html = loadApi().emphasize('버섯돌이 4마리, 아이템 1회, 150골드, 빌딩 화폐 5개');
assert.match(html, /quest-keyword-green">4마리<\/strong>/);
assert.match(html, /quest-keyword-green">1회<\/strong>/);
assert.match(html, /quest-keyword-green">150골드<\/strong>/);
assert.match(html, /quest-keyword-green">5개<\/strong>/);
assert.doesNotMatch(html, /<strong[^>]*><strong/);
```

Update quest-data expectations to require:

```js
assert.equal(order.length, 17);
assert.equal(order[order.indexOf('tut_equip') + 1], 'tut_healing_well');
assert.equal(quests.tut_healing_well.actionType, 'healWell');
assert.deepEqual(quests.tut_healing_well.reward, { exp:3, gold:20, building:0 });
assert.equal(quests.slime_hunt.target, 3);
assert.doesNotMatch(quests.slime_hunt.done, /보스/);
assert.doesNotMatch(quests.swamp_king_hunt.done, /명진쌤 보스|졌/);
assert.equal(quests.tut_costume.actionType, 'receiveCostume');
assert.equal(quests.tut_costume.grantOnAccept, undefined);
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```powershell
node --test tests/quest-text.test.mjs tests/quest-data.test.mjs tests/tutorial-quests-polish-v2.test.mjs
```

Expected: FAIL because quantity highlighting, `tut_healing_well`, corrected targets, and quest-only costume semantics do not exist.

- [ ] **Step 3: Implement safe quantity highlighting**

In `src/quest-text.js`, tokenize approved words and quantity expressions before rendering. Quantity matches use:

```js
const quantityPattern = /\d+(?:마리|회|개|골드|빌딩|층|레벨)/g;
```

Merge quantity tokens with approved term tokens by source offset, prefer the longest non-overlapping token, and render each selected token exactly once:

```js
`<strong class="quest-keyword-${tone}">${escapeHtml(token.text)}</strong>`
```

All unmatched source text must still pass through `escapeHtml`.

- [ ] **Step 4: Add and repair quest data**

Add `tut_healing_well` after `tut_equip`:

```js
{
  id:'tut_healing_well',
  title:'다치면 쉬어가기',
  target:1,
  actionType:'healWell',
  desc:'치유의 우물에서 문제를 맞혀 HP를 1회 회복하고 명진쌤에게 보고하기',
  reward:{ exp:3, gold:20, building:0 },
  pages:[
    '모험에서는 공격하는 법만큼 다쳤을 때 쉬는 법도 중요하단다.',
    '놀라지 마렴. 회복 훈련을 위해 선생님이 안전한 공격을 한 번 보여줄게.',
    '체력이 떨어지면 마을의 치유의 우물에서 문제를 풀어 회복할 수 있어. 우물빛으로 몸을 회복하고 돌아오렴.'
  ],
  done:'잘했어! 앞으로 싸우다 힘들면 무리하지 말고 치유의 우물로 돌아오렴.'
}
```

Also:

- Set `slime_hunt.target` to `3`.
- Replace its completion text with normal-slime wording.
- Replace `swamp_king_hunt.done` with elite-zombie victory and newly opened mysterious-door wording.
- Change `tut_costume.actionType` to `receiveCostume`.
- Remove `tut_costume.grantOnAccept`.
- Rewrite costume description/pages from purchasing with 150 gold to receiving Sangnam's gift.

- [ ] **Step 5: Run the focused tests and verify pass**

Run:

```powershell
node --test tests/quest-text.test.mjs tests/quest-data.test.mjs tests/tutorial-quests-polish-v2.test.mjs
```

Expected: PASS with zero failures.

- [ ] **Step 6: Commit quest data and text**

```powershell
git add -- src/quest-text.js src/quest-data.js tests/quest-text.test.mjs tests/quest-data.test.mjs tests/tutorial-quests-polish-v2.test.mjs
git commit -m "feat: clarify early quest text and progression"
```

### Task 2: Reward timing and edited combat MP3

**Files:**
- Modify: `src/gameplay-polish-v2.js`
- Modify: `src/audio-manifest.js`
- Modify: `game.js`
- Rename: `assets/1. 전투씬 음악_[cut_83sec].mp3` → `assets/1. 전투씬 음악.mp3`
- Delete already removed file from Git: `assets/1. 전투씬 음악.wav`
- Modify: `tests/gameplay-polish-v2.test.mjs`
- Modify: `tests/audio-manifest.test.mjs`
- Modify: `tests/reward-presentation-v2.test.mjs`

**Interfaces:**
- Consumes: `rewardSteps(reward, options)` with `options.monsterRandomBuilding`.
- Produces: Frozen reward steps with cumulative delays and explicit durations; `battleBgm` points to the edited MP3.

- [ ] **Step 1: Write failing reward and audio tests**

Require:

```js
api.rewardSteps({ exp:5, gold:4, building:1 })
// delays: 0, 1500, 3000; durations: 1500, 1500, 1500

api.rewardSteps(
  { exp:5, gold:4, building:1 },
  { monsterRandomBuilding:true }
)
// delays: 0, 1500, 3000; durations: 1500, 1500, 2000
```

Require:

```js
assert.equal(manifest.assets.battleBgm.src, 'assets/1. 전투씬 음악.mp3');
assert.equal(existsSync(resolve(root, 'assets/1. 전투씬 음악.wav')), false);
```

Require the monster reward call to pass `{ monsterRandomBuilding:buildingGain > 0 }` while the quest call uses default options.

- [ ] **Step 2: Run focused tests and verify failure**

```powershell
node --test tests/gameplay-polish-v2.test.mjs tests/audio-manifest.test.mjs tests/reward-presentation-v2.test.mjs
```

Expected: FAIL on 1,000ms timing, the WAV manifest path, and the missing monster context.

- [ ] **Step 3: Implement cumulative 1.5-second reward steps**

Change the API to:

```js
function rewardSteps(reward = {}, options = {}) {
  const steps = [];
  let nextDelayMs = 0;
  const add = (kind, amount, tone, sfx, durationMs = 1500) => {
    steps.push({ kind, amount, delayMs:nextDelayMs, durationMs, tone, sfx });
    nextDelayMs += durationMs;
  };
  add('exp', Math.max(0, number(reward.exp)), 'exp', 'quest');
  if (number(reward.gold) > 0) add('gold', number(reward.gold), 'gold', 'coin');
  if (number(reward.building) > 0) {
    add('building', number(reward.building), 'building', 'open',
      options.monsterRandomBuilding ? 2000 : 1500);
  }
  return Object.freeze(steps.map(Object.freeze));
}
```

Update `showRewardSequenceV2(title, prefix, reward, options = {})` to forward `options`.
Pass the monster context only from `finishMonsterDefeatV25`.

- [ ] **Step 4: Rename the supplied audio and update the manifest**

After verifying both absolute source and destination paths are within `assets` and the destination does not exist, run:

```powershell
Move-Item -LiteralPath '.\assets\1. 전투씬 음악_[cut_83sec].mp3' -Destination '.\assets\1. 전투씬 음악.mp3'
```

Set:

```js
battleBgm: { src:'assets/1. 전투씬 음악.mp3', volume:1, channel:'bgm' }
```

- [ ] **Step 5: Run focused tests and verify pass**

```powershell
node --test tests/gameplay-polish-v2.test.mjs tests/audio-manifest.test.mjs tests/reward-presentation-v2.test.mjs
```

Expected: PASS with zero failures.

- [ ] **Step 6: Commit reward and audio changes**

```powershell
git add -- game.js src/gameplay-polish-v2.js src/audio-manifest.js tests/gameplay-polish-v2.test.mjs tests/audio-manifest.test.mjs tests/reward-presentation-v2.test.mjs assets
git commit -m "feat: extend reward timing and update battle music"
```

### Task 3: Pure tutorial state module

**Files:**
- Create: `src/quest-tutorial-polish-v3.js`
- Modify: `index.html`
- Modify: `tests/tutorial-quests-polish-v2.test.mjs`

**Interfaces:**
- Produces global `YuksamQuestTutorialPolishV3`.
- Methods:
  - `migrateHealingQuest(quests): boolean`
  - `applyTrainingAccept({ questId, player, questState }): { applied:boolean, hp:number|null }`
  - `recordHealingSuccess(questState, target): boolean`
  - `getNpcIntro(kind, questState): { questId:string, text:string, gift:boolean } | null`
  - `markNpcIntroSeen(questState): boolean`
  - `grantQuestCostume({ player, questState, itemId }): { granted:boolean, ready:boolean }`

- [ ] **Step 1: Add failing pure-module tests**

Test all of the following:

```js
assert.equal(api.applyTrainingAccept({
  questId:'tut_healing_well',
  player:{ hp:30 },
  questState:{ status:'accepted' }
}).hp, 1);
```

- A second call does not reapply the hit.
- `recordHealingSuccess` marks an accepted quest ready even when player HP is already full.
- `migrateHealingQuest` completes the missing new quest when any later quest exists.
- NPC intro exists only for accepted, unfinished, unseen quests.
- `costume` maps to the gift line; `pet` maps to `null`.
- Granting `cs_questSproutRibbon` adds one ID, marks the quest ready, and stays idempotent.

- [ ] **Step 2: Run test and verify failure**

```powershell
node --test tests/tutorial-quests-polish-v2.test.mjs
```

Expected: FAIL because `src/quest-tutorial-polish-v3.js` and its API do not exist.

- [ ] **Step 3: Implement the pure module**

Implement the six methods exactly as listed under Interfaces. Use no DOM, audio, timers, `game`, or storage globals inside the module. Freeze the published API and returned intro models.

Migration must create:

```js
quests.tut_healing_well = {
  id:'tut_healing_well',
  status:'completed',
  progress:1,
  target:1,
  migrated:true
};
```

only when the healing quest is missing and at least one quest after it in `QUEST_ORDER` already exists.

- [ ] **Step 4: Load the module after `game.js`**

Add:

```html
<script src="src/quest-tutorial-polish-v3.js"></script>
```

immediately after `<script src="game.js"></script>`. Runtime callers in `game.js` must use late `window.YuksamQuestTutorialPolishV3` lookups.

- [ ] **Step 5: Run module tests and verify pass**

```powershell
node --test tests/tutorial-quests-polish-v2.test.mjs
```

Expected: PASS with zero failures.

- [ ] **Step 6: Commit the module**

```powershell
git add -- src/quest-tutorial-polish-v3.js index.html tests/tutorial-quests-polish-v2.test.mjs
git commit -m "feat: add quest tutorial state module"
```

### Task 4: Training hit, healing completion, NPC intros, and costume gift

**Files:**
- Modify: `game.js`
- Modify: `src/costume-data.js`
- Modify: `src/costume-ui.js`
- Modify: `tests/tutorial-quests-polish-v2.test.mjs`
- Modify: `tests/world-healing-polish-v2.test.mjs`

**Interfaces:**
- Consumes: `YuksamQuestTutorialPolishV3` pure methods from Task 3.
- Produces: Late-bound game adapters and the quest-only `cs_questSproutRibbon`.

- [ ] **Step 1: Add failing integration contract tests**

Require:

- `acceptCurrentQuest` calls `applyTrainingAccept`.
- A successful training hit plays `enemyAttack`, applies the existing screen-shake class, saves, and reports HP 1.
- Successful healing calls `recordHealingSuccess`; failed healing does not.
- Current quest lookup invokes `migrateHealingQuest`.
- Shop actions consult a quest-intro adapter for weapon, armor, accessory, costume, and enhancement; pet remains unchanged.
- `COSTUME_DEFS_V55.cs_questSproutRibbon.questOnly === true`.
- Costume shop cards filter out `questOnly`.
- General costume buying still records `buyCostume`, which no longer matches `tut_costume`.

- [ ] **Step 2: Run focused tests and verify failure**

```powershell
node --test tests/tutorial-quests-polish-v2.test.mjs tests/world-healing-polish-v2.test.mjs
```

Expected: FAIL because adapters, the quest gift, and new healing completion hook are absent.

- [ ] **Step 3: Add the quest-only costume**

Add:

```js
cs_questSproutRibbon: {
  id:'cs_questSproutRibbon',
  name:'새싹 리본',
  slot:'accessory',
  classOnly:null,
  price:0,
  costume:true,
  questOnly:true,
  desc:'상남이 회복 훈련을 마친 모험가에게 건넨 초록빛 새싹 리본.',
  look:{ type:'butterflyRibbon', color:'#4ade80' },
}
```

Add a matching icon entry in `costume-ui.js` and change shop enumeration to:

```js
Object.values(defs()).filter((item) => !item.questOnly)
```

- [ ] **Step 4: Add minimal late-bound game adapters**

Add adapters that:

- Run `migrateHealingQuest(game.player.quests)` before choosing the current quest and save only when migration changed state.
- After accepting `tut_healing_well`, call `applyTrainingAccept`, then play `enemyAttack`, add/remove the existing shake class, save, update HUD, and show the approved training message.
- On correct well answer, call `recordHealingSuccess(getQuestState('tut_healing_well'), 1)` before save/update.
- Do nothing to quest state on a wrong well answer.

- [ ] **Step 5: Add one-time NPC intro routing**

Create global adapters:

```js
window.openQuestNpcIntroV3(kind, continuation)
window.continueQuestNpcIntroV3(kind)
window.receiveQuestCostumeV3()
```

They must:

- Read the mapped active quest state.
- Ask the pure module for an intro.
- Open the approved dialogue once.
- Store `npcIntroSeen` only after the player continues.
- Call the original shop continuation afterward.
- For costume, give `cs_questSproutRibbon`, mark `receiveCostume` ready, save, update, and never give a duplicate.

Wire these entry points:

- `weaponShop` and `armorShop`
- `buildingShopNpc`
- `costumeShopNpc`
- `upgradeNpc`

Do not alter `petOrbNpc`.

- [ ] **Step 6: Remove obsolete costume auto-completion**

Delete the `ownsAllCostumes` special block from `acceptQuestV21`. The quest is completed only by the Sangnam gift path.

- [ ] **Step 7: Run focused integration tests**

```powershell
node --test tests/tutorial-quests-polish-v2.test.mjs tests/world-healing-polish-v2.test.mjs
```

Expected: PASS with zero failures.

- [ ] **Step 8: Commit tutorial integration**

```powershell
git add -- game.js src/costume-data.js src/costume-ui.js tests/tutorial-quests-polish-v2.test.mjs tests/world-healing-polish-v2.test.mjs
git commit -m "feat: add healing and npc quest tutorials"
```

### Task 5: Final quest audit and full verification

**Files:**
- Modify if required by audit: `src/quest-data.js`
- Modify: `tests/quest-data.test.mjs`
- Create: `docs/superpowers/plans/2026-07-24-quest-audio-reward-polish.md`

**Interfaces:**
- Consumes: Completed changes from Tasks 1–4.
- Produces: A verified quest set with no target or normal/elite narrative contradictions.

- [ ] **Step 1: Add automated consistency assertions**

For every quest:

- `target` is a positive integer.
- `pages` and `done` are non-empty.
- Every ordinary hunt (`targetTypes` without `eliteOnly`) has no completion phrase claiming a boss was defeated.
- Every elite hunt has `target === 1`.
- The explicit early hunt quantities are mushroom 4, slime 3, stomp 4, snake 4, tarantula 4, zombie 4.

- [ ] **Step 2: Run all directly affected tests**

```powershell
node --test tests/quest-text.test.mjs tests/quest-data.test.mjs tests/tutorial-quests-polish-v2.test.mjs tests/world-healing-polish-v2.test.mjs tests/gameplay-polish-v2.test.mjs tests/reward-presentation-v2.test.mjs tests/audio-manifest.test.mjs
```

Expected: PASS with zero failures.

- [ ] **Step 3: Run JavaScript syntax checks**

```powershell
node --check game.js
node --check src/quest-text.js
node --check src/quest-data.js
node --check src/quest-tutorial-polish-v3.js
node --check src/costume-data.js
node --check src/costume-ui.js
node --check src/gameplay-polish-v2.js
node --check src/audio-manifest.js
```

Expected: Every command exits 0.

- [ ] **Step 4: Run the complete project suite**

```powershell
npm.cmd test
```

Expected: Exit code 0 with zero failed tests.

- [ ] **Step 5: Commit final audit and plan**

```powershell
git add -- src/quest-data.js tests/quest-data.test.mjs docs/superpowers/plans/2026-07-24-quest-audio-reward-polish.md
git commit -m "test: audit quest narrative consistency"
```

- [ ] **Step 6: Confirm repository state**

```powershell
git status --short
git log -6 --oneline
```

Expected: No uncommitted implementation changes remain.
