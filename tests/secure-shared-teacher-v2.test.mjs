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

test('secure teacher dashboard uses the separate shared-state service in production', () => {
  const source = fs.readFileSync(path.join(root, 'src/admin-dashboard.js'), 'utf8');
  const config = fs.readFileSync(path.join(root, 'src/cloud-config.js'), 'utf8');
  assert.match(source, /secureAdminSharedV2\s*=\s*window\.YuksamSharedStateV2\.create/);
  assert.match(source, /await secureAdminSharedV2\.saveWorkbooks/);
  assert.match(source, /await secureAdminSharedV2\.setServerOpen/);
  assert.match(config, /securityV2Enabled\s*:\s*true/);
});

test('teacher manages shared workbooks and classroom state without legacy writes', () => runMode('manage'));
test('teacher workbook save failures are shown safely without changing local state', () => runMode('save-error'));
