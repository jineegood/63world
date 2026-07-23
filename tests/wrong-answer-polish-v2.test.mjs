import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

test('wrong answers show the answer in green, deal half damage, then allow the counterattack', () => {
  const game = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
  const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  const start = game.indexOf('function resolveWrongAnswerV2');
  const wrongBranch = game.slice(start, game.indexOf('window.submitCombatAnswer', start));

  assert.match(wrongBranch, /calculateActionDamageV25\(\)/);
  assert.match(wrongBranch, /wrongHitDamage/);
  assert.match(wrongBranch, /정답은 \$\{correctAnswer\}/);
  assert.match(wrongBranch, /tone:'correct-answer'/);
  assert.match(wrongBranch, /duration:2[0-9]{3}/);
  assert.match(wrongBranch, /monsterCounterAttack/);
  assert.match(style, /\.combat-notice\.correct-answer[^}]*#(?:22c55e|4ade80)/);
});
