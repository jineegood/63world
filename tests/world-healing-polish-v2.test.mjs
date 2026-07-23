import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

test('hunting-map wells are drawn and usable while Myeongjin has a wider talk range', () => {
  const game = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
  assert.match(game, /distance\(p, town\.npc\) < 110/);
  assert.match(game, /YuksamGameplayPolishV2\.getHealingWells\(game\.currentMap\)/);
  assert.match(game, /id:'hunting-healing-wells-v2'/);
  assert.match(game, /type:'huntingHealingWellV2'/);
  assert.match(game, /openHealingWellModal/);
});
