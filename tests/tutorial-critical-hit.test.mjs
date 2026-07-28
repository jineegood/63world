import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const game = fs.readFileSync(path.join(root, 'game.js'), 'utf8');

test('healing-well training shows the teacher critical hit before applying HP 1', () => {
  const accept = game.slice(game.indexOf('window.acceptCurrentQuest = async function acceptCurrentQuestAuthorityV3'));
  const body = accept.slice(0, accept.indexOf('\n  const legacyClaimQuestReward'));
  const healing = body.slice(body.indexOf('if (isHealingTraining)'));

  assert.match(healing, /playSfx\('enemyAttack'\)/);
  assert.match(healing, /playSfx\('critical'\)/);
  assert.match(healing, /치명타!/);
  assert.match(healing, /await new Promise\(\(resolve\) => setTimeout\(resolve,/);
  assert.ok(
    healing.indexOf("playSfx('critical')") < healing.indexOf('applyAuthoritySnapshotV3(result)'),
    '서버 HP 1 상태가 치명타 연출보다 먼저 보여서는 안 됩니다',
  );
});
