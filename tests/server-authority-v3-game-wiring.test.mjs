import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const game = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
const config = fs.readFileSync(path.join(root, 'src/cloud-config.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('v3 cutover remains disabled while incomplete gameplay phases still use v2', () => {
  assert.match(config, /serverAuthorityV3Enabled\s*:\s*false/);
});

test('game injects the authority adapter and does not send full players in v3 mode', () => {
  assert.match(game, /authorityApi\s*:\s*window\.YuksamPlayerAuthorityV3/);
  assert.match(game, /secureStudentAccess\.authorityV3Enabled/);
  assert.match(game, /projectPlayerPreferencesV3\s*\(/);
  const projector = game.match(
    /function\s+projectPlayerPreferencesV3[\s\S]*?\n\}/,
  )?.[0] || '';
  assert.match(projector, /appearance/);
  assert.match(projector, /audio/);
  assert.match(projector, /tutorialAcknowledgements/);
  assert.doesNotMatch(projector, /\b(?:level|exp|gold|building|inventory|equipment|skills|quests|records)\b/);
});

test('server character creation is awaited before entering the game', () => {
  assert.match(game, /createCharacterBtn'\)\.addEventListener\('click',\s*async\s*\(\)\s*=>/);
  assert.match(game, /await\s+secureStudentAccess\.createCharacter\s*\(/);
  assert.match(game, /createCharacterBtn[\s\S]*?disabled\s*=\s*true/);
  assert.match(game, /game\.player\s*=\s*normalizePlayer\s*\(\s*created\.player\s*\)/);
});

test('v3 map adapter exists but ordinary map handlers stay untouched until cutover', () => {
  assert.match(game, /async\s+function\s+requestServerMapTransitionV3\s*\(\s*targetMap\s*\)/);
  assert.match(game, /secureStudentAccess\.transitionMap\s*\(/);
  assert.match(config, /serverAuthorityV3Enabled\s*:\s*false/);
});

test('authority browser script loads before student access and game code', () => {
  const authority = index.indexOf('src/player-authority-v3.js');
  const student = index.indexOf('src/student-access-v2.js');
  const gameScript = index.indexOf('game.js');
  assert.ok(authority >= 0 && authority < student && student < gameScript);
});
