import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const game = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'src/admin-dashboard.js'), 'utf8');
const panel = fs.readFileSync(path.join(root, 'src/cheat-panel.js'), 'utf8');
const data = fs.readFileSync(path.join(root, 'src/admin-data-v2.js'), 'utf8');

test('resource cheat buttons delegate to the teacher-only server action', () => {
  assert.match(game, /adminApplyCurrentStudentCheatV3\?\.\(['"]exp20['"]\)/);
  assert.match(game, /adminApplyCurrentStudentCheatV3\?\.\(['"]gold3000['"]\)/);
  assert.doesNotMatch(game, /testExpBtn['"]\)\.addEventListener\(['"]click['"],\s*\(\)\s*=>\s*\{\s*addExp/);
  assert.match(data, /functions\.invoke\(['"]teacher-apply-cheat['"]/);
});

test('cheat menu starts hidden and requires a restored teacher session', () => {
  assert.match(dashboard, /window\.__cheatEnabledV54\s*=\s*false/);
  assert.match(dashboard, /secureAdminAuthV2\.requireTeacher\(\)/);
  assert.match(dashboard, /setTeacherCheatUiV3\(false\)/);
  assert.match(panel, /await hasTeacherAccess\(\)/);
});

test('server cheat snapshot is applied to the active player', () => {
  assert.match(game, /window\.applyAuthoritySnapshotFromServerV3/);
  assert.match(dashboard, /applyAuthoritySnapshotFromServerV3\?\.\(result\.snapshot\)/);
});

test('the existing monster kill button routes dungeon combat through the teacher server', () => {
  assert.match(panel, /YuksamRaidRunUi\?\.isRunning\?\.\(\)/);
  assert.match(panel, /adminKillCurrentRaidMonsterV1/);
  assert.match(dashboard, /secureAdminDataV2\.killRaidMonster\(identity\.userId\)/);
  assert.match(data, /action:['"]raidKill['"]/);
});
