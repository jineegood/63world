import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const game = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
const marker = 'function installAuthoritativeQuestFlowV3';
const start = game.indexOf(marker);
const patch = game.slice(start, game.indexOf('/* Server-authoritative economy', start));

test('quest UI waits for server acceptance, claims, and gifts behind the cutover flag', () => {
  assert.ok(patch.length > 1000);
  assert.match(patch, /secureStudentAccess\.authorityV3Enabled/);
  assert.match(patch, /secureStudentAccess\.acceptQuest/);
  assert.match(patch, /secureStudentAccess\.claimQuest/);
  assert.match(patch, /secureStudentAccess\.receiveQuestGift/);
  assert.match(patch, /applyAuthoritySnapshotV3/);
  assert.match(patch, /showRewardSequenceV2/);
});

test('authority mode never increments local quest progress from browser events', () => {
  assert.match(patch, /recordQuestActionV38[\s\S]*if\s*\(enabled\(\)\)\s*return/);
  assert.match(patch, /incrementQuestProgressByMonster[\s\S]*if\s*\(enabled\(\)\)\s*return/);
  assert.match(patch, /recordHealingQuestSuccessV3[\s\S]*if\s*\(enabled\(\)\)\s*return false/);
});

test('healing well uses the private server question and applies only its graded snapshot', () => {
  assert.match(patch, /startHealing\s*\(\s*game\.player\.serverRevision\s*\)/);
  assert.match(patch, /submitHealing\s*\(/);
  assert.match(patch, /questionToken/);
  assert.match(patch, /applyAuthoritySnapshotV3/);
  assert.doesNotMatch(patch, /q\.answer/);
});
