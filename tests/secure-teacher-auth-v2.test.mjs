import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

function runMode(mode) {
  const script = path.join(root, 'tools/browser-smoke/try_secure_teacher_auth_v2.js');
  const result = spawnSync(process.execPath, [script, root, mode], { encoding:'utf8', timeout:20000 });
  assert.equal(result.status, 0, `${mode}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /RESULT: PASS/);
}

test('admin Auth module loads before the dashboard and production stays disabled', () => {
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const config = fs.readFileSync(path.join(root, 'src/cloud-config.js'), 'utf8');
  const authPosition = index.indexOf('src="src/admin-auth-v2.js"');
  const dashboardPosition = index.indexOf('src="src/admin-dashboard.js"');
  assert.ok(authPosition >= 0 && dashboardPosition > authPosition);
  assert.match(config, /securityV2Enabled\s*:\s*false/);
});

test('secure dashboard uses a separately stored teacher client and delegates password changes', () => {
  const source = fs.readFileSync(path.join(root, 'src/admin-dashboard.js'), 'utf8');
  assert.match(source, /securityV2Enabled\s*===\s*true/);
  assert.match(source, /storageKey\s*:\s*['"]ysb_teacher_auth_v2['"]/);
  assert.match(source, /YuksamAdminAuthV2\.create/);
  assert.match(source, /secureAdminAuthV2\.resetStudentPassword/);
  assert.match(source, /secureAdminAuthV2\.changeOwnPassword/);
  assert.match(source, /secureAdminAuthV2\.signOut/);
});

test('secure teacher account can reset student and own passwords without local credential storage', () => runMode('teacher'));
test('student account cannot enter the secure teacher dashboard', () => runMode('student'));
