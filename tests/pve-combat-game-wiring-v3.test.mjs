import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const game = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const patch = game.match(
  /\/\* Server-authoritative PvE combat v3 browser wiring\.[\s\S]*?wireAuthoritativePveCombatV3\(\);/,
)?.[0] || '';

test('secure PvE client loads before game and is created lazily from the authenticated client', () => {
  assert.ok(index.indexOf('src/pve-combat-client-v3.js') >= 0);
  assert.ok(index.indexOf('src/pve-combat-client-v3.js') < index.indexOf('game.js'));
  assert.match(game, /const\s+YuksamPveCombatClientV3\s*=\s*window\.YuksamPveCombatClientV3/);
  assert.match(patch, /secureStudentAccess\.getClient\(\)/);
  assert.match(patch, /YuksamPveCombatClientV3\.create\(\{\s*client/);
});

test('authority combat short-circuits the legacy entry behind the enabled cutover flag', () => {
  assert.match(patch, /combatEntryPipeline\.register\(\{/);
  assert.match(patch, /secureStudentAccess\.authorityV3Enabled/);
  assert.match(patch, /if\s*\(!secureStudentAccess\.authorityV3Enabled\)\s*return\s+next\(\)/);
  assert.match(patch, /priority:\s*1000/);
  assert.match(
    fs.readFileSync(path.join(root, 'src/cloud-config.js'), 'utf8'),
    /serverAuthorityV3Enabled\s*:\s*true/,
  );
});

test('ordinary hunting monsters map to bounded server catalog identifiers', () => {
  for (const pair of [
    ['forest', 'mushroom', 'forest_mushroom'],
    ['forest', 'slime', 'forest_slime'],
    ['desert', 'stomp', 'desert_stomp'],
    ['desert', 'snake', 'desert_snake'],
    ['swamp', 'tarantula', 'swamp_tarantula'],
    ['swamp', 'zombie', 'swamp_zombie'],
  ]) {
    assert.match(patch, new RegExp(`${pair[0]}:${pair[1]}'\\s*:\\s*'${pair[2]}'`));
  }
  for (const key of [
    'forest_elite_slime',
    'desert_elite_snake',
    'swamp_elite_zombie',
    'final_teacher',
  ]) {
    assert.match(patch, new RegExp(`'${key}'`));
  }
  assert.match(patch, /monster\?\.type\s*===\s*'teacherBoss'[\s\S]*?final_teacher/);
  assert.match(patch, /ELITE_MONSTER_KEYS_V3\[\s*game\.bossReturnMap\s*\|\|\s*game\.player\?\.bossReturnMap\s*\]/);
});

test('authoritative turns send only action and answer identifiers and never calculate browser damage', () => {
  assert.match(patch, /\.submitTurn\(\s*session\.question\.questionToken/);
  assert.match(patch, /actionId/);
  assert.doesNotMatch(patch, /calculateActionDamage|calculateWrongActionDamage|resolveWrongAnswer/);
  assert.doesNotMatch(patch, /normalize\([^)]*answer|given\s*!==\s*answer/);
  assert.doesNotMatch(patch, /\b(?:addExp|addGold|addBuilding)\s*\(/);
});

test('server snapshots drive hp, rewards, resume, defeat, and surrender presentation', () => {
  assert.match(patch, /snapshotToLegacyPlayer\(response\.player\)/);
  assert.match(patch, /session\.playerHp/);
  assert.match(patch, /session\.monsterHp/);
  assert.match(patch, /showRewardSequenceV2\(/);
  assert.match(patch, /\.resume\(\)/);
  assert.match(patch, /\.surrender\(session\.sessionRevision\)/);
  assert.match(patch, /response\.outcome\s*===\s*'defeat'/);
  assert.doesNotMatch(patch, /startMonsterDefeatSequence|handlePlayerDefeat\(/);
  assert.match(patch, /game\.finalBossPortalUnlocked\s*=\s*Boolean\(game\.player\.finalBossPortalUnlocked\)/);
});

test('surrender and expired resume apply the authoritative hp snapshot before closing', () => {
  assert.match(
    patch,
    /const\s+response\s*=\s*await\s+getClient\(\)\.surrender\([^)]*\);\s*applyServerPlayer\(response\)/,
  );
  assert.match(
    patch,
    /const\s+response\s*=\s*await\s+client\.resume\(\);\s*applyServerPlayer\(response\);\s*if\s*\(!response\?\.session\)\s*return/,
  );
});

test('answer keys never enter authoritative browser state', () => {
  assert.doesNotMatch(patch, /\.answer\s*=/);
  assert.doesNotMatch(patch, /answerKey|answer_key/);
  assert.match(patch, /response\.correctAnswer/);
});
