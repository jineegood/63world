import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

test('monster and quest rewards use the shared one-second presentation sequence', () => {
  const game = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
  const helperStart = game.indexOf('function showRewardSequenceV2');
  const helper = game.slice(helperStart, game.indexOf('function finishMonsterDefeatV25', helperStart));
  const monster = game.slice(game.indexOf('function finishMonsterDefeatV25'), game.indexOf('function startMonsterDefeatSequenceV25'));

  assert.match(helper, /YuksamGameplayPolishV2\.rewardSteps/);
  assert.match(helper, /setTimeout/);
  assert.match(helper, /delayMs/);
  assert.match(monster, /showRewardSequenceV2/);
  assert.match(game, /claimQuestRewardV21[\s\S]*showRewardSequenceV2/);
});
