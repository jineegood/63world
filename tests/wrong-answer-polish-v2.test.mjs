import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

test('wrong answers show the answer in green, deal half damage, then allow the counterattack', () => {
  const game = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
  const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  const review = fs.readFileSync(path.join(root, 'src', 'wrong-answer-review.js'), 'utf8');
  const start = game.indexOf('function calculateWrongActionDamageV2');
  const wrongBranch = game.slice(start, game.indexOf('function applyDamageToMonsterV40', start));

  assert.match(wrongBranch, /calculateWrongActionDamageV2\(\)/);
  assert.match(wrongBranch, /wrongHitDamage/);
  assert.match(wrongBranch, /Number\(active\.multiplier\) === 0/);
  assert.doesNotMatch(wrongBranch, /critRollV25|applyPlayerChillToActionV25|supportEffects/);
  assert.match(wrongBranch, /오답입니다! 정답은 \$\{correctAnswer\} \(오답이라 데미지가 절반만 들어갑니다\)/);
  assert.equal((wrongBranch.match(/type:'answer-wrong'/g) || []).length, 1);
  assert.match(wrongBranch, /tone:'correct-answer'/);
  assert.match(wrongBranch, /duration:2[0-9]{3}/);
  assert.match(wrongBranch, /preserveDuration:true/);
  assert.match(wrongBranch, /monsterCounterAttack/);
  assert.match(style, /\.combat-notice\.correct-answer[^}]*#(?:22c55e|4ade80)/);
  assert.match(game, /YuksamWrongAnswerReview\.reveal/);
  assert.match(game, /data-answer-key=/);
  assert.match(review, /REVIEW_MS = 2000/);
  assert.match(review, /correct-answer-review/);
  assert.match(style, /\.choice-grid button\.correct-answer-review/);
  assert.match(style, /\.answer-row input\.correct-answer-review/);
});
