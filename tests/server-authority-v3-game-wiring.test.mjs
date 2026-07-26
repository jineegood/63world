import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const game = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
const config = fs.readFileSync(path.join(root, 'src/cloud-config.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const normalizerSource = (
  game.match(
    /function\s+normalizePlayer\s*\([\s\S]*?\n\}\n\nfunction\s+applyAuthoritySnapshotV3/,
  )?.[0] || ''
).replace(/\n\nfunction\s+applyAuthoritySnapshotV3$/, '');

test('v3 cutover is enabled after every gameplay phase is server-authoritative', () => {
  assert.match(config, /serverAuthorityV3Enabled\s*:\s*true/);
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

test('v3 map adapter gates ordinary hunting transitions before local map state changes', () => {
  assert.match(game, /async\s+function\s+requestServerMapTransitionV3\s*\(\s*targetMap\s*\)/);
  assert.match(game, /secureStudentAccess\.transitionMap\s*\(/);
  assert.match(game, /async\s+function\s+confirmServerMapTransitionV3\s*\(\s*targetMap\s*\)/);
  for (const target of ['forest', 'desert', 'swamp', 'town', 'bossRoom']) {
    assert.match(
      game,
      new RegExp(`await\\s+confirmServerMapTransitionV3\\('${target}'\\)[\\s\\S]{0,500}?game\\.currentMap\\s*=\\s*'${target}'`),
    );
  }
  assert.match(game, /await\s+confirmServerMapTransitionV3\('finalBossRoom'\)[\s\S]{0,120}?setupFinalBossRoomV35\(\)/);
  assert.match(game, /function\s+setupFinalBossRoomV35\(\)[\s\S]{0,120}?game\.currentMap\s*=\s*'finalBossRoom'/);
  assert.match(config, /serverAuthorityV3Enabled\s*:\s*true/);
});

test('authority browser script loads before student access and game code', () => {
  const authority = index.indexOf('src/player-authority-v3.js');
  const student = index.indexOf('src/student-access-v2.js');
  const gameScript = index.indexOf('game.js');
  assert.ok(authority >= 0 && authority < student && student < gameScript);
});

test('authority normalization preserves revision, preferences, records, and zero hp', () => {
  assert.match(normalizerSource, /const\s+authorityV3\s*=/);
  assert.match(normalizerSource, /serverRevision\s*:\s*Number\(p\.serverRevision\)/);
  assert.match(normalizerSource, /serverPreferences\s*:/);
  assert.match(normalizerSource, /serverInventoryInstances\s*:/);
  assert.match(normalizerSource, /pvpWins\s*:\s*Number\(r\.pvpWins\)/);
  assert.match(normalizerSource, /if\s*\(!authorityV3\)\s*\{[\s\S]*?computeLevelFromExp/);
  assert.match(normalizerSource, /if\s*\(!authorityV3[\s\S]*?normalized\.hp\s*=\s*normalized\.maxHp/);
});

test('flag-on normalization executes without rewriting authoritative values', () => {
  const normalizePlayer = Function(
    'secureStudentAccess',
    'CLASS_META',
    'YuksamCombatRules',
    'worldDefs',
    'computeLevelFromExp',
    'maxHpForPlayer',
    'defaultWeaponIdForClass',
    `${normalizerSource}; return normalizePlayer;`,
  )(
    { enabled:true, authorityV3Enabled:true },
    { warrior:{} },
    { normalizeCombatStatuses:(value) => value },
    { town:{ playerSpawn:{ x:123, y:456 } } },
    () => 99,
    () => 999,
    () => 'synthetic_weapon',
  );
  const preferences = {
    appearance:{ shirt:'#111' },
    audio:{ bgmVolume:35, sfxVolume:45, bgmEnabled:true, sfxEnabled:false },
    tutorialAcknowledgements:{ pvpTutorialSeen:true },
  };
  const normalized = normalizePlayer({
    name:'Student',
    class:'warrior',
    level:4,
    exp:0,
    hp:0,
    maxHp:22,
    inventory:['server_weapon'],
    equipment:{ weapon:'server_weapon' },
    records:{ pvpWins:7, pvpLosses:3 },
    bossReturnMap:'swamp',
    finalBossPortalUnlocked:true,
    serverInventoryInstances:[{ id:'instance-1', itemDefinitionId:'server_weapon' }],
    serverPreferences:preferences,
    serverRevision:12,
  });

  assert.equal(normalized.level, 4);
  assert.equal(normalized.hp, 0);
  assert.equal(normalized.maxHp, 22);
  assert.equal(normalized.serverRevision, 12);
  assert.equal(normalized.bossReturnMap, 'swamp');
  assert.equal(normalized.finalBossPortalUnlocked, true);
  assert.deepEqual(normalized.serverPreferences, preferences);
  assert.deepEqual(normalized.serverInventoryInstances, [
    { id:'instance-1', itemDefinitionId:'server_weapon' },
  ]);
  assert.deepEqual(normalized.inventory, ['server_weapon']);
  assert.deepEqual(normalized.records, {
    answered:0,
    correct:0,
    wrongLog:[],
    pvpWins:7,
    pvpLosses:3,
  });
});
