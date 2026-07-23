import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

function runMode(mode) {
  const script = path.join(root, 'tools/browser-smoke/try_early_game_polish_v2.js');
  const result = spawnSync(process.execPath, [script, root, mode], { encoding:'utf8', timeout:20000 });
  assert.equal(result.status, 0, `${mode}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /RESULT: PASS/);
}

test('login removes Demo and costume return uses the blue primary style', () => {
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const costume = fs.readFileSync(path.join(root, 'src/costume-ui.js'), 'utf8');
  assert.doesNotMatch(index, /Classroom MMORPG Demo/i);
  assert.match(index, /Classroom MMORPG</);
  assert.match(costume, /class="primary wide"[^>]*onclick="openCharacterPanel\(\)"[^>]*>← 상태창으로 돌아가기/);
  assert.doesNotMatch(costume, /상태창으로 돌아가기[^]*?#ef4444/);
});

test('pre-specialization defeat protects experience', () => runMode('protected-death'));
test('post-specialization defeat keeps the existing half-progress loss', () => runMode('specialized-death'));
test('normal mushroom and slime balance changes leave the elite slime unchanged', () => runMode('monsters'));
