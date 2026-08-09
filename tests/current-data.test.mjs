import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const snapshotPath = join(root, 'data', 'game-data.snapshot.json');
const oldWorkbookPath = join(root, '시트', '육삼빌딩의_세계_게임데이터_마스터_v25.xlsx');
const currentWorkbookPath = join(root, '시트', '육삼빌딩의_세계_게임데이터_마스터_v35.xlsx');

function readSnapshot() {
  assert.equal(existsSync(snapshotPath), true, 'data/game-data.snapshot.json should exist');
  return JSON.parse(readFileSync(snapshotPath, 'utf8'));
}

test('current game data snapshot exists and identifies v35 source', () => {
  const snapshot = readSnapshot();

  assert.equal(snapshot.meta.sourceFile, 'game.js');
  assert.equal(snapshot.meta.detectedVersion, 'v35');
  assert.match(snapshot.meta.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('current game data snapshot captures core gameplay data', () => {
  const snapshot = readSnapshot();

  assert.deepEqual(Object.keys(snapshot.classes).sort(), ['mage', 'priest', 'warrior']);
  assert.equal(Object.keys(snapshot.levels.xpRequirements).length, 10);
  assert.ok(Object.keys(snapshot.items).length >= 10, 'expected item definitions including later patch items');
  assert.ok(Object.keys(snapshot.skills).length >= 20, 'expected expanded v24/v35 skill definitions');
  assert.ok(Object.keys(snapshot.worlds).includes('swamp'), 'swamp map should be present');
  assert.ok(Object.keys(snapshot.worlds).includes('finalBossRoom'), 'final boss room should be present');
  assert.ok(Object.keys(snapshot.quests).length >= 5, 'quest chain should be present');
});

test('current game data snapshot captures online-planning support data', () => {
  const snapshot = readSnapshot();

  assert.ok(Object.keys(snapshot.pets).length >= 5, 'pet definitions should be present');
  assert.ok(Object.keys(snapshot.tiers).length >= 5, 'enhancement tier definitions should be present');
  assert.ok(snapshot.workbooks.length >= 2, 'default workbooks should be present');
  assert.ok(snapshot.questions.length >= 8, 'default questions should be present');
});

test('all specialization ultimate skills unlock at level 10', () => {
  const snapshot = readSnapshot();
  const ultimates = Object.values(snapshot.skills).filter((skill) => skill?.kind === 'ultimate' && skill?.specOnly);
  assert.equal(ultimates.length, 6);
  assert.deepEqual([...new Set(ultimates.map((skill) => skill.unlockLevel))], [10]);
});

test('old master workbook is removed and current master workbook exists', () => {
  assert.equal(existsSync(oldWorkbookPath), false, 'old v25 workbook should be removed');
  assert.equal(existsSync(currentWorkbookPath), true, 'new v35 workbook should exist');

  const magic = readFileSync(currentWorkbookPath).subarray(0, 4).toString('binary');
  assert.equal(magic, 'PK\u0003\u0004', 'xlsx should be a ZIP/OpenXML file');
});
