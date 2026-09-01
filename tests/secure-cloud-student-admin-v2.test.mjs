import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

test('admin data module loads before the dashboard and secure branches delegate by user id', () => {
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'src/admin-dashboard.js'), 'utf8');
  const modulePosition = index.indexOf('src="src/admin-data-v2.js"');
  const dashboardPosition = index.indexOf('src="src/admin-dashboard.js"');
  assert.ok(modulePosition >= 0 && dashboardPosition > modulePosition);
  assert.match(source, /YuksamAdminDataV2\.create/);
  assert.match(source, /secureAdminDataV2\.listStudents\(\)/);
  assert.match(source, /secureAdminDataV2\.grantReward\(userId/);
  assert.match(source, /secureAdminDataV2\.deleteStudent\(userId\)/);
  assert.match(source, /adminOpenWrongLogV2\(['"]?\$\{[^}]*userId/);
  assert.match(source, /adminOpenStudentDetailV2\(['"]?\$\{[^}]*userId/);
  assert.match(source, /function adminStudentTotalStatsV2\(student\)/);
  assert.match(source, /YuksamRaidNameplatesV1\?\.possessionStats\?\.\(student\)/);
  assert.match(source, /adminOpenStudentEquipmentV2\(['"]?\$\{[^}]*userId/);
  assert.match(source, /adminOpenStudentSkillsV2\(['"]?\$\{[^}]*userId/);
  assert.match(source, /장비창 보기/);
  assert.match(source, /스킬창 보기/);
  assert.match(source, /YuksamAdminStudentPreviewV1/);
  assert.match(source, /관리자용 전체 알림/);
  assert.match(source, /maxlength="120"/);
  assert.match(source, /secureAdminDataV2\.broadcastAnnouncement\(message, requestId\)/);
  assert.match(source, /YuksamWorldAnnouncementsV1\?\.requestId/);
  const game = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
  assert.match(game, /character-window-v33/);
  assert.match(game, /skill-window-v35/);
  assert.match(game, /admin-student-readonly-preview-v1/);
  assert.match(game, /읽기 전용/);
  assert.match(source, /접속 중/);
  assert.match(source, /던전 최고 돌파/);
});

test('secure cloud dashboard renders safe data and completes reward and deletion flows', () => {
  const script = path.join(root, 'tools/browser-smoke/try_secure_cloud_student_admin_v2.js');
  const result = spawnSync(process.execPath, [script, root], { encoding:'utf8', timeout:20000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /RESULT: PASS/);
});
