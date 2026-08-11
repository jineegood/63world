import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const game = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'src/admin-dashboard.js'), 'utf8');
const panel = fs.readFileSync(path.join(root, 'src/cheat-panel.js'), 'utf8');
const data = fs.readFileSync(path.join(root, 'src/admin-data-v2.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

test('resource cheat buttons delegate to the teacher-only server action', () => {
  assert.match(game, /adminApplyCurrentStudentCheatV3\?\.\(['"]exp20['"]\)/);
  assert.match(game, /adminApplyCurrentStudentCheatV3\?\.\(['"]gold3000['"]\)/);
  assert.match(game, /adminApplyCurrentStudentCheatV3\?\.\(['"]raidAdvance['"]\)/);
  assert.match(game, /snapshot\.raidTopGroup/);
  assert.match(data, /['"]raidAdvance['"]/);
  assert.doesNotMatch(game, /testExpBtn['"]\)\.addEventListener\(['"]click['"],\s*\(\)\s*=>\s*\{\s*addExp/);
  assert.match(data, /functions\.invoke\(['"]teacher-apply-cheat['"]/);
});

test('dungeon progress cheat is visible as one ten-floor advance button', () => {
  assert.match(index, /id="testRaidProgressBtn"[^>]*>🏢 던전 \+10층<\/button>/);
  assert.match(dashboard, /raidAdvance:`던전 \$\{Math\.min\(63,/);
});

test('teacher combat detail log is toggleable, collapsible, and shows calculation factors', () => {
  assert.match(index, /id="combatDetailLogBtn"[^>]*>🔎 전투 세분화 로그 OFF<\/button>/);
  assert.match(panel, /function detailFormula\(calc\)/);
  assert.match(panel, /기본 공격 굴림/);
  assert.match(panel, /자리.*slotMultiplier|slotLabel/);
  assert.match(panel, /function healingFormula\(calc\)/);
  assert.match(panel, /보호막 비율/);
  assert.match(panel, /실제 회복/);
  assert.match(panel, /흡혈 난수/);
  assert.match(panel, /data-detail-collapse/);
  assert.match(panel, /data-detail-clear/);
  assert.match(panel, /YuksamCombatDetailLog = Object\.freeze/);
  assert.match(style, /\.combat-detail-overlay/);
  assert.match(dashboard, /YuksamCombatDetailLog\?\.setEnabled\?\.\(false\)/);
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

test('teacher cheat panel can pause and resume the authoritative dungeon room', () => {
  assert.match(index, /id="testRaidPauseBtn"[^>]*>⏸ 던전 일시정지<\/button>/);
  assert.match(panel, /adminToggleCurrentRaidPauseV1/);
  assert.match(dashboard, /secureAdminDataV2\.toggleRaidPause\(identity\.userId\)/);
  assert.match(dashboard, /▶ 던전 다시 시작/);
  assert.match(data, /action:'raidPause'/);
  assert.match(data, /RAID_NOT_ACTIVE/);
});
