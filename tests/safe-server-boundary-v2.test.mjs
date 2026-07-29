import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

test('safe server mode keeps PvE combat local while enabling account, shared state, and PvP', () => {
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const game = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
  const config = fs.readFileSync(path.join(root, 'src/cloud-config.js'), 'utf8');

  assert.match(config, /securityV2Enabled\s*:\s*true/);
  for (const required of [
    'src/auth-v2.js',
    'src/cloud-sync-v2.js',
    'src/shared-state-v2.js',
    'src/student-access-v2.js',
    'src/pvp-client.js',
    'src/pvp-battle.js',
    'src/pvp-ui.js',
  ]) {
    assert.match(index, new RegExp(`src=["']${required.replaceAll('.', '\\.')}["']`));
  }

  for (const forbidden of [
    'player-authority-v3',
    'progression-authority-v3',
    'combat-client-v3',
    'student-combat-v3',
  ]) {
    assert.equal(index.includes(forbidden), false);
    assert.equal(game.includes(forbidden), false);
  }
  assert.doesNotMatch(game, /authorityApi\s*:/);
  assert.match(game, /secureStudentAccess\.savePlayer\(game\.player\)/);
  assert.match(game, /YuksamPvpClient\.create/);
});
