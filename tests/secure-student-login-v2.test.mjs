import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

function runMode(mode) {
  const script = path.join(root, 'tools/browser-smoke/try_secure_student_login_v2.js');
  const result = spawnSync(process.execPath, [script, root, mode], { encoding:'utf8', timeout:20000 });
  assert.equal(result.status, 0, `${mode}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /RESULT: PASS/);
}

test('secure modules load in order before game and the production switch stays on', () => {
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const config = fs.readFileSync(path.join(root, 'src/cloud-config.js'), 'utf8');
  const order = [
    'src/cloud-config.js',
    'vendor/supabase-client.bundle.js',
    'src/auth-v2.js',
    'src/cloud-sync-v2.js',
    'src/student-access-v2.js',
    'game.js',
  ].map((file) => index.indexOf(`src="${file}"`));
  assert.equal(order.every((position) => position >= 0), true);
  assert.equal(order.every((position, indexNumber) => indexNumber === 0 || position > order[indexNumber - 1]), true);
  assert.match(config, /securityV2Enabled\s*:\s*true/);
});

test('legacy cloud sync closes before REST setup whenever secure v2 is enabled', () => {
  const source = fs.readFileSync(path.join(root, 'src/cloud-sync.js'), 'utf8');
  const guard = source.indexOf('securityV2Enabled === true');
  const restSetup = source.indexOf("const base =");
  assert.ok(guard >= 0 && restSetup > guard);
});

test('game routes secure login and saving through the v2 boundary without retaining credentials', () => {
  const source = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
  assert.match(source, /YuksamStudentAccessV2\.create/);
  assert.match(source, /secureStudentAccess\.enter\(name, password\)/);
  assert.match(source, /secureStudentAccess\.savePlayer\(game\.player\)/);
  assert.match(source, /if\s*\(!secureStudentAccess\.enabled\)\s*normalized\.password/);
  assert.match(source, /game\.currentPassword\s*=\s*secureStudentAccess\.enabled\s*\?\s*''\s*:\s*password/);
});

test('secure existing account enters the game and caches no credential', () => runMode('existing'));
test('secure new account reaches creation and saves a credential-free character', () => runMode('new'));
test('secure wrong password stays closed without creating a legacy record', () => runMode('wrong'));
