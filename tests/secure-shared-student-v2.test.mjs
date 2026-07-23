import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

function runMode(mode) {
  const script = path.join(root, 'tools/browser-smoke/try_secure_shared_student_v2.js');
  const result = spawnSync(process.execPath, [script, root, mode], { encoding:'utf8', timeout:20000 });
  assert.equal(result.status, 0, `${mode}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /RESULT: PASS/);
}

test('shared module loads before student access and secure workbook routing stays behind the false switch', () => {
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const config = fs.readFileSync(path.join(root, 'src/cloud-config.js'), 'utf8');
  const shared = index.indexOf('src="src/shared-state-v2.js"');
  const student = index.indexOf('src="src/student-access-v2.js"');
  assert.ok(shared >= 0 && student > shared);
  assert.match(config, /securityV2Enabled\s*:\s*false/);
});

test('closed classroom blocks before any student Auth request', () => runMode('closed'));
test('open classroom supplies cloud workbooks to the game', () => runMode('workbooks'));
test('polling a later classroom close saves, signs out, and returns to landing', () => runMode('later-close'));
