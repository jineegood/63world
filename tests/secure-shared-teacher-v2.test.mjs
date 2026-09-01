import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

function runMode(mode) {
  const script = path.join(root, 'tools/browser-smoke/try_secure_shared_teacher_v2.js');
  const result = spawnSync(process.execPath, [script, root, mode], { encoding:'utf8', timeout:20000 });
  assert.equal(result.status, 0, `${mode}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /RESULT: PASS/);
}

test('secure teacher dashboard uses the separate shared-state service in safe server mode', () => {
  const source = fs.readFileSync(path.join(root, 'src/admin-dashboard.js'), 'utf8');
  const config = fs.readFileSync(path.join(root, 'src/cloud-config.js'), 'utf8');
  assert.match(source, /secureAdminSharedV2\s*=\s*window\.YuksamSharedStateV2\.create/);
  assert.match(source, /await secureAdminSharedV2\.saveWorkbooks/);
  assert.match(source, /await secureAdminSharedV2\.setServerOpen/);
  assert.match(config, /securityV2Enabled\s*:\s*true/);
});

test('teacher manages shared workbooks and classroom state without legacy writes', () => runMode('manage'));
test('teacher workbook save failures are shown safely without changing local state', () => runMode('save-error'));
test('teacher never creates from an offline workbook fallback', () => runMode('offline-create'));
test('restored teacher settings refresh the authoritative closed state before enabling either button', () => runMode('restore-closed'));

test('Seoul lunch schedule opens at 13:00 and closes at 13:55 without removing manual controls', () => {
  const migration = fs.readFileSync(
    path.join(root, 'supabase/migrations/202609010010_lunch_server_schedule_v1.sql'),
    'utf8',
  );
  const dashboard = fs.readFileSync(path.join(root, 'src/admin-dashboard.js'), 'utf8');
  assert.match(migration, /create extension if not exists pg_cron with schema pg_catalog/i);
  assert.match(migration, /'yuksam-classroom-lunch-open-v1'[\s\S]*'0 4 \* \* \*'/i);
  assert.match(migration, /'yuksam-classroom-lunch-close-v1'[\s\S]*'55 4 \* \* \*'/i);
  assert.match(migration, /at time zone 'Asia\/Seoul'[\s\S]*time '13:00'/i);
  assert.match(migration, /at time zone 'Asia\/Seoul'[\s\S]*time '13:55'/i);
  assert.match(dashboard, /onclick="adminSetServerOpen\(true\)"/);
  assert.match(dashboard, /onclick="adminSetServerOpen\(false\)"/);
  assert.match(dashboard, /13:00에 자동으로 열리고 13:55에 자동으로 닫힙니다/);
});
