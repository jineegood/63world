import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');

function loadQuestData() {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'src/quest-data.js'), 'utf8'), { window });
  return window.YuksamQuestData;
}

function loadTutorialApi() {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'src/quest-tutorial-polish-v3.js'), 'utf8'), { window });
  return window.YuksamQuestTutorialPolishV3;
}

test('skill and costume tutorials are inserted in the intended early quest order', () => {
  const data = loadQuestData();
  assert.equal(data.QUEST_ORDER[data.QUEST_ORDER.indexOf('tut_equip') + 1], 'tut_healing_well');
  assert.equal(data.QUEST_ORDER[data.QUEST_ORDER.indexOf('tut_shop') + 1], 'tut_skill');
  assert.equal(data.QUEST_ORDER[data.QUEST_ORDER.indexOf('slime_hunt') + 1], 'tut_costume');
  assert.equal(data.QUEST_DEFS.tut_skill.actionType, 'learnSkill');
  assert.match(data.QUEST_DEFS.tut_skill.pages.join(' '), /N/);
  assert.match(data.QUEST_DEFS.tut_skill.pages.join(' '), /액티브/);
  assert.match(data.QUEST_DEFS.tut_skill.pages.join(' '), /알림/);
  assert.equal(data.QUEST_DEFS.tut_healing_well.actionType, 'healWell');
  assert.deepEqual(JSON.parse(JSON.stringify(data.QUEST_DEFS.tut_healing_well.reward)), { exp:3, gold:20, building:0 });
  assert.equal(data.QUEST_DEFS.tut_costume.actionType, 'receiveCostume');
  assert.equal(data.QUEST_DEFS.tut_costume.grantOnAccept, undefined);
});

test('successful learning remains wired while ordinary costume buying is not the gift action', () => {
  const game = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
  const costume = fs.readFileSync(path.join(root, 'src/costume-ui.js'), 'utf8');
  assert.match(game, /recordQuestActionV38\?\.\('learnSkill'\)/);
  assert.match(costume, /recordQuestActionV38\?\.\('buyCostume'\)/);
  assert.match(game, /tut_skill[\s\S]*Object\.values\(game\.player\.skills/);
});

test('healing-well training attack is safe and can recover a stale accepted tutorial', () => {
  const api = loadTutorialApi();
  const player = { hp:37 };
  const quest = { status:'accepted', progress:0, target:1 };
  assert.deepEqual(
    JSON.parse(JSON.stringify(api.applyTrainingAccept({ questId:'tut_healing_well', player, questState:quest }))),
    { applied:true, hp:1 }
  );
  assert.equal(player.hp, 1);
  assert.equal(quest.trainingApplied, true);
  assert.equal(api.applyTrainingAccept({ questId:'tut_healing_well', player, questState:quest }).applied, false);
  player.hp = 37;
  assert.equal(api.applyTrainingAccept({ questId:'tut_healing_well', player, questState:quest }).applied, true);
  assert.equal(player.hp, 1);
});

test('a correct healing-well answer completes the tutorial even when hp was already full', () => {
  const api = loadTutorialApi();
  const quest = { status:'accepted', progress:0, target:1 };
  assert.equal(api.recordHealingSuccess(quest), true);
  assert.equal(quest.progress, 1);
  assert.equal(quest.status, 'ready');
});

test('existing players past the mushroom quest receive a completed healing tutorial migration', () => {
  const api = loadTutorialApi();
  const quests = { mushroom_hunt:{ status:'completed', progress:4, target:4 } };
  assert.equal(api.migrateHealingQuest(quests), true);
  assert.equal(quests.tut_healing_well.status, 'completed');
  assert.equal(api.migrateHealingQuest(quests), false);
});

test('accept building supplies are granted exactly once and leave a saved quest marker', () => {
  const api = loadTutorialApi();
  const player = { building:4 };
  const quest = { status:'accepted', progress:0, target:1 };

  assert.deepEqual(
    JSON.parse(JSON.stringify(api.grantAcceptBuildingSupply({ player, questState:quest, amount:3 }))),
    { granted:true, amount:3 },
  );
  assert.equal(player.building, 7);
  assert.equal(quest.acceptBuildingGrantVersion, api.ACCEPT_BUILDING_GRANT_VERSION);
  assert.equal(api.grantAcceptBuildingSupply({ player, questState:quest, amount:3 }).granted, false);
  assert.equal(player.building, 7, 'repeated calls must not duplicate the accept reward');
});

test('legacy accepted action quests receive the missed 3 plus 10 buildings once', () => {
  const api = loadTutorialApi();
  const player = {
    building:2,
    quests:{
      tut_enhance:{ status:'accepted', progress:0, target:1 },
      tut_pet:{ status:'ready', progress:1, target:1 },
      elite_snake_hunt:{ status:'completed', progress:1, target:1 },
    },
  };

  const first = api.reconcileActionQuestSupplies(player);
  assert.equal(first.changed, true);
  assert.equal(first.total, 13);
  assert.deepEqual(
    JSON.parse(JSON.stringify(first.grants)),
    [{ questId:'tut_enhance', amount:3 }, { questId:'tut_pet', amount:10 }],
  );
  assert.equal(player.building, 15);
  assert.equal(player.quests.tut_enhance.acceptBuildingGrantVersion, 1);
  assert.equal(player.quests.tut_pet.acceptBuildingGrantVersion, 1);

  const second = api.reconcileActionQuestSupplies(player);
  assert.equal(second.changed, false);
  assert.equal(second.total, 0);
  assert.equal(player.building, 15, 'login reconciliation must be idempotent');
});

test('completed action quests are not retroactively paid after their reward was already claimed', () => {
  const api = loadTutorialApi();
  const player = {
    building:9,
    quests:{
      tut_enhance:{ status:'completed', progress:1, target:1 },
      tut_pet:{ status:'completed', progress:1, target:1 },
    },
  };
  const result = api.reconcileActionQuestSupplies(player);
  assert.equal(result.changed, false);
  assert.equal(result.total, 0);
  assert.equal(player.building, 9);
});

test('quest npc introductions exclude the pet orb and costume introduction grants a gift', () => {
  const api = loadTutorialApi();
  const costumeQuest = { status:'accepted', progress:0, target:1 };
  const intro = api.getNpcIntro('costume', costumeQuest);
  assert.equal(intro.gift, true);
  assert.match(intro.text, /이번만 특별히 공짜로 주마/);
  assert.equal(api.getNpcIntro('pet', { status:'accepted', progress:0, target:1 }), null);
  costumeQuest.npcIntroSeen = true;
  assert.equal(api.getNpcIntro('costume', costumeQuest), null);
});

test('the quest costume is granted once and readies the quest', () => {
  const api = loadTutorialApi();
  const player = { costumeInventory:[] };
  const quest = { status:'accepted', progress:0, target:1 };
  assert.equal(api.grantQuestCostume({ player, questState:quest, itemId:'cs_questSproutRibbon' }).granted, true);
  assert.deepEqual(player.costumeInventory, ['cs_questSproutRibbon']);
  assert.equal(quest.status, 'ready');
  assert.equal(api.grantQuestCostume({ player, questState:quest, itemId:'cs_questSproutRibbon' }).granted, false);
  assert.deepEqual(player.costumeInventory, ['cs_questSproutRibbon']);
});

test('the quest-only costume is hidden from the paid shop and game hooks tutorial interactions', () => {
  const costumeData = fs.readFileSync(path.join(root, 'src/costume-data.js'), 'utf8');
  const costumeUi = fs.readFileSync(path.join(root, 'src/costume-ui.js'), 'utf8');
  const game = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
  assert.match(costumeData, /cs_questSproutRibbon[\s\S]*questOnly:\s*true/);
  assert.match(costumeUi, /Object\.values\(defs\(\)\)\.filter\(\(item\)\s*=>\s*!item\.questOnly\)/);
  assert.match(game, /applyTrainingAccept/);
  assert.match(game, /recordHealingSuccess/);
  assert.match(game, /grantQuestCostume/);
  assert.match(game, /grantAcceptBuildingSupply/);
  assert.match(game, /reconcileActionQuestSupplies/);
  assert.match(game, /openQuestNpcIntroV3/);
  assert.doesNotMatch(game, /ownsAllCostumes\(game\.player\.costumeInventory/);
});

test('the full healing tutorial attack reaches HP 1 after its impact animation', { timeout:10000 }, () => {
  const script = path.join(root, 'tools', 'browser-smoke', 'try_healing_training_quest.js');
  const result = spawnSync(process.execPath, [script, root], { encoding:'utf8', timeout:8000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PASS: healing training attack lands after its impact animation/);
});
