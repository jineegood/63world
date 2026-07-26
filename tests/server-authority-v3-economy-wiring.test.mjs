import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const game = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
const costume = fs.readFileSync(path.join(root, 'src/costume-ui.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('authority action runner loads before game and the cutover remains disabled', () => {
  assert.ok(
    index.indexOf('src/authority-action-runner-v3.js') < index.indexOf('game.js'),
  );
  assert.match(
    fs.readFileSync(path.join(root, 'src/cloud-config.js'), 'utf8'),
    /serverAuthorityV3Enabled\s*:\s*false/,
  );
});

test('game applies returned snapshots atomically while preserving local position', () => {
  const fn = game.match(
    /function\s+applyAuthoritySnapshotV3[\s\S]*?\n\}/,
  )?.[0] || '';
  assert.match(fn, /const\s+\{\s*x\s*,\s*y\s*\}\s*=\s*game\.player/);
  assert.match(fn, /game\.player\s*=\s*normalizePlayer\s*\(\s*result\.player\s*\)/);
  assert.match(fn, /game\.player\.x\s*=\s*x/);
  assert.match(fn, /game\.player\.y\s*=\s*y/);
  assert.match(fn, /updateHud\s*\(\s*\)/);
});

test('final game handlers route purchases, equipment, enhancement, spec, and skills through v3', () => {
  for (const method of [
    'purchaseItem',
    'equipItem',
    'unequipSlot',
    'enhanceWeapon',
    'chooseSpecialization',
    'learnSkill',
    'summonPet',
    'setActivePet',
  ]) {
    assert.match(game, new RegExp(`authorityActionRunnerV3\\.run\\(\\s*'${method}'`));
  }
  assert.match(game, /serverInventoryInstances[\s\S]*?itemDefinitionId\s*===\s*itemId/);
  assert.match(game, /pendingKey\s*:\s*'economy'/);
  assert.match(game, /pendingKey\s*:\s*'enhancement'/);
  assert.match(game, /pendingKey\s*:\s*'pet'/);
  assert.match(game, /dropItemOnEquip\s*=\s*async[\s\S]*?authorityV3Enabled[\s\S]*?await\s+window\.equipItem\s*\(\s*itemId\s*\)[\s\S]*?return;/);
  assert.match(game, /rollPetV34\s*=\s*async[\s\S]*?run\(\s*'summonPet'/);
  assert.match(game, /equipPetV27\s*=\s*async[\s\S]*?run\(\s*'setActivePet'/);
  assert.match(game, /unequipPetV27\s*=\s*async[\s\S]*?petId\s*:\s*null/);
});

test('costume purchase and equipment use v3 ownership without optimistic currency changes', () => {
  assert.match(costume, /authorityActionRunnerV3/);
  assert.match(costume, /run\(\s*'purchaseItem'\s*,\s*\{\s*itemId:id\s*\}/);
  assert.match(costume, /run\(\s*'equipItem'/);
  assert.match(costume, /run\(\s*'unequipSlot'/);
  const purchase = costume.match(
    /window\.buyCostumeV55\s*=\s*async[\s\S]*?\n\s*\};/,
  )?.[0] || '';
  assert.match(purchase, /if\s*\(\s*authorityV3Enabled\s*\(\s*\)\s*\)/);
  assert.match(purchase, /await\s+authorityActionRunnerV3\.run/);
  assert.match(purchase, /return;/);
});
