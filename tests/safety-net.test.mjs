import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

function runSmoke(file, timeout = 45000) {
  const script = join(root, 'tools', 'browser-smoke', file);
  const result = spawnSync(process.execPath, [script, root], { encoding:'utf8', timeout });
  assert.equal(result.status, 0, `${file}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

test('player storage and administrator rewards preserve one stable account record', () => {
  const output = runSmoke('try_player_storage.js');
  assert.match(output, /RESULT: PASS/);
});

test('portable boot smoke loads the complete index script chain', () => {
  const output = runSmoke('boot_test.js');
  assert.match(output, /RESULT: PASS/);
});

test('boot preserves exact corrupt workbook storage bytes', () => {
  const output = runSmoke('try_workbook_boot_preservation.js');
  assert.match(output, /RESULT: PASS/);
});

test('corrupt player storage cannot enter or overwrite character creation', () => {
  const output = runSmoke('try_player_corruption_preservation.js');
  assert.match(output, /RESULT: PASS/);
});

test('administrator globals require teacher authentication before mutation', () => {
  const output = runSmoke('try_admin_authorization.js');
  assert.match(output, /RESULT: PASS/);
});

test('final boss smoke deterministically applies a correct player attack', () => {
  const output = runSmoke('try_final_boss.js');
  assert.match(output, /FAIL 0/);
});

test('combat keyboard routing handles one active mode and one E-key click', () => {
  const output = runSmoke('try_combat_keys.js');
  assert.match(output, /PASS 14 \/ FAIL 0/);
});
