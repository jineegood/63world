import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');

function loadQuestData() {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'src/quest-data.js'), 'utf8'), { window });
  return window.YuksamQuestData;
}

test('skill and costume tutorials are inserted in the intended early quest order', () => {
  const data = loadQuestData();
  assert.equal(data.QUEST_ORDER[data.QUEST_ORDER.indexOf('tut_shop') + 1], 'tut_skill');
  assert.equal(data.QUEST_ORDER[data.QUEST_ORDER.indexOf('slime_hunt') + 1], 'tut_costume');
  assert.equal(data.QUEST_DEFS.tut_skill.actionType, 'learnSkill');
  assert.match(data.QUEST_DEFS.tut_skill.pages.join(' '), /N/);
  assert.match(data.QUEST_DEFS.tut_skill.pages.join(' '), /액티브/);
  assert.match(data.QUEST_DEFS.tut_skill.pages.join(' '), /알림/);
  assert.equal(data.QUEST_DEFS.tut_costume.actionType, 'buyCostume');
  assert.equal(data.QUEST_DEFS.tut_costume.grantOnAccept.gold, 150);
});

test('successful learning and costume buying report tutorial progress', () => {
  const game = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
  const costume = fs.readFileSync(path.join(root, 'src/costume-ui.js'), 'utf8');
  assert.match(game, /recordQuestActionV38\?\.\('learnSkill'\)/);
  assert.match(costume, /recordQuestActionV38\?\.\('buyCostume'\)/);
  assert.match(game, /tut_skill[\s\S]*Object\.values\(game\.player\.skills/);
  assert.match(game, /tut_costume[\s\S]*ownsAllCostumes/);
});
