import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

test('monster and quest rewards use the shared one-second presentation sequence', () => {
  const game = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
  const helperStart = game.indexOf('function showRewardSequenceV2');
  const helper = game.slice(helperStart, game.indexOf('function appendChatMessage', helperStart));
  const monster = game.slice(game.indexOf('function finishMonsterDefeatV25'), game.indexOf('function startMonsterDefeatSequenceV25'));

  assert.match(helper, /YuksamGameplayPolishV2\.rewardSteps/);
  assert.match(helper, /setTimeout/);
  assert.match(helper, /delayMs/);
  assert.match(helper, /durationMs/);
  assert.match(helper, /reward-tone-/);
  assert.match(helper, /playSfx\(step\.sfx\)/);
  assert.doesNotMatch(helper, /showCinematicMessage/);
  assert.match(monster, /showRewardSequenceV2/);
  assert.match(monster, /game\.transitionLock = 0/);
  assert.doesNotMatch(monster, /game\.modalState = \{ type:'cinematic', pause:true \}/);
  assert.match(game, /claimQuestRewardV21[\s\S]*showRewardSequenceV2/);
});

test('reward colors distinguish experience, gold, and building currency', () => {
  const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  assert.match(style, /\.reward-sequence-v2\.reward-tone-exp[\s\S]*#c084fc/);
  assert.match(style, /\.reward-sequence-v2\.reward-tone-gold[\s\S]*#facc15/);
  assert.match(style, /\.reward-sequence-v2\.reward-tone-building[\s\S]*#f472b6/);
  assert.match(style, /rewardPopV2 1s/);
});
