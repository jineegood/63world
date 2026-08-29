import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const read = (file) => readFileSync(join(root, file), 'utf8');

test('game.js has no duplicated top-level function declarations', () => {
  const js = read('game.js');
  const names = [...js.matchAll(/^function\s+([A-Za-z0-9_$]+)\s*\(/gm)].map((match) => match[1]);
  const duplicates = [...new Set(names.filter((name, index) => names.indexOf(name) !== index))].sort();

  assert.deepEqual(duplicates, []);
});

test('elite monster drawing support stays in the active monster sprite function', () => {
  const js = read('game.js');
  const matches = [...js.matchAll(/^function\s+drawMonsterSprite\s*\([^)]*\)\s*\{/gm)];
  assert.equal(matches.length, 1);

  const start = matches[0].index;
  const nextFunction = js.indexOf('\nfunction ', start + 1);
  const body = js.slice(start, nextFunction === -1 ? js.length : nextFunction);

  assert.match(body, /monster\.elite/);
  assert.match(body, /eliteScale/);
});

test('unversioned browser handlers are not assigned repeatedly', () => {
  const js = read('game.js');
  const unequipAssignments = [...js.matchAll(/^window\.unequipSlot\s*=\s*function\s+unequipSlot/gm)];

  assert.equal(unequipAssignments.length, 1);
});

test('equipment eligibility checks level requirements as well as class', () => {
  const js = read('game.js');
  const match = js.match(/^function\s+canEquip\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/m);

  assert.ok(match, 'canEquip should exist');
  assert.match(match[1], /levelReq/);
  assert.match(match[1], /player\.level/);
});

test('v35 skill window styles are absorbed into the main stylesheet', () => {
  const js = read('game.js');
  const css = read('style.css');

  assert.match(css, /\.skill-window-v35/);
  assert.doesNotMatch(js, /style\.id\s*=\s*['"]yuksam-v35-style['"]/);
});

test('latest pet summon flow does not keep legacy roll aliases', () => {
  const js = read('game.js');

  assert.match(js, /onclick="rollPetV34\(\)"/);
  assert.match(js, /window\.rollPetV34\s*=\s*(?:async\s+)?function\s+rollPetV35/);
  assert.doesNotMatch(js, /window\.rollPetV33\s*=\s*window\.rollPetV34/);
  assert.doesNotMatch(js, /window\.rollPetV31\s*=\s*window\.rollPetV34/);
  assert.doesNotMatch(js, /window\.rollPetV31\s*=\s*window\.rollPetV33/);
});

test('latest upgrade shop flow does not keep legacy upgrade aliases', () => {
  const js = read('game.js');

  assert.match(js, /onclick="upgradeCurrentWeaponV33\(\)"/);
  assert.match(js, /window\.openUpgradeShopModalV33\s*=\s*openUpgradeShopModalV33/);
  assert.match(js, /window\.upgradeCurrentWeaponV33\s*=\s*(?:async\s+)?function\s+upgradeCurrentWeaponV33/);
  assert.doesNotMatch(js, /window\.openUpgradeShopModalV28\s*=\s*openUpgradeShopModalV33/);
  assert.doesNotMatch(js, /window\.openUpgradeShopModalV27\s*=\s*openUpgradeShopModalV33/);
  assert.doesNotMatch(js, /window\.openUpgradeShopModalV27\s*=\s*openUpgradeShopModalV28/);
  assert.doesNotMatch(js, /window\.upgradeCurrentWeaponV28\s*=\s*window\.upgradeCurrentWeaponV33/);
  assert.doesNotMatch(js, /window\.upgradeCurrentWeaponV27\s*=\s*window\.upgradeCurrentWeaponV33/);
  assert.doesNotMatch(js, /window\.upgradeCurrentWeaponV27\s*=\s*window\.upgradeCurrentWeaponV28/);
});

test('latest pet shop modal flow does not keep legacy modal aliases', () => {
  const js = read('game.js');

  assert.match(js, /window\.openPetShopModalV34\s*=\s*openPetShopModalV34/);
  assert.match(js, /nearest\.type\s*===\s*'petOrbNpc'[\s\S]{0,120}window\.openPetShopModalV34\(\)/);
  assert.doesNotMatch(js, /window\.openPetShopModalV33\s*=\s*openPetShopModalV34/);
  assert.doesNotMatch(js, /window\.openPetShopModalV31\s*=\s*openPetShopModalV34/);
  assert.doesNotMatch(js, /window\.openPetShopModalV27\s*=\s*openPetShopModalV34/);
  assert.doesNotMatch(js, /window\.openPetShopModalV31\s*=\s*openPetShopModalV33/);
  assert.doesNotMatch(js, /window\.openPetShopModalV27\s*=\s*openPetShopModalV33/);
  assert.doesNotMatch(js, /window\.openPetShopModalV27\s*=\s*openPetShopModalV31/);
});

test('audio dispatcher loads after the manifest and before game bootstrap', () => {
  const html = read('index.html');
  const manifest = html.indexOf('src/audio-manifest.js');
  const dispatcher = html.indexOf('src/audio-dispatcher.js');
  const game = html.indexOf('game.js');

  assert.ok(manifest >= 0, 'audio manifest script should be loaded');
  assert.ok(dispatcher > manifest, 'audio dispatcher should load after the manifest');
  assert.ok(game > dispatcher, 'game bootstrap should load after the dispatcher');
});

test('audio routing has one dispatcher boundary and explicit critical visual adapters', () => {
  const js = read('game.js');
  const dispatcherInstalls = [...js.matchAll(/YuksamAudioDispatcher\.create\(/g)];

  assert.equal(dispatcherInstalls.length, 1);
  assert.match(js, /audioAdapters\.criticalVisuals\.push\(triggerCriticalFlashV23\)/);
  assert.match(js, /audioAdapters\.criticalVisuals\.push\(strongCriticalFeedbackV24\)/);
  assert.doesNotMatch(js, /playSfx\s*=\s*function\s+playSfxV(?:17|20|22|23|24|25|28)/);
});

test('world decoration viewport helper keeps its conservative padded boundary inclusive', () => {
  const js = read('game.js');
  const match = js.match(/^function isWorldPointVisible\([^)]*\) \{[\s\S]*?^\}/m);
  assert.ok(match, 'isWorldPointVisible should remain a small top-level helper');

  const viewport = { camera:{ x:100, y:200 }, width:1280, height:720 };
  const isVisible = Function('game', `${match[0]}; return isWorldPointVisible;`)(viewport);

  assert.equal(isVisible(20, 500, 80), true, 'left padded edge stays visible');
  assert.equal(isVisible(19.99, 500, 80), false, 'point beyond left padding is culled');
  assert.equal(isVisible(1460, 500, 80), true, 'right padded edge stays visible');
  assert.equal(isVisible(1460.01, 500, 80), false, 'point beyond right padding is culled');
  assert.equal(isVisible(500, 120, 80), true, 'top padded edge stays visible');
  assert.equal(isVisible(500, 1000, 80), true, 'bottom padded edge stays visible');
  assert.equal(isVisible(99, 500, -40), false, 'negative padding is clamped to zero');
});

test('large static world decoration loops cull before invoking their canvas renderers', () => {
  const js = read('game.js');

  assert.match(js, /isWorldPointVisible\(x, y, 80\)\) drawTreeWorld\(x, y, s\)/);
  assert.match(js, /p && isWorldPointVisible\(p\.x, p\.y, 80\)\) drawTreeWorld/);
  assert.match(js, /p && isWorldPointVisible\(p\.x, p\.y, 80\)\) drawCactusWorld/);
  assert.match(js, /p && isWorldPointVisible\(p\.x, p\.y, 80\)\) drawDeadTreeWorld/);
  assert.match(js, /if \(!isWorldPointVisible\(2680, 780, 500\)\) return;/);
  assert.equal(
    [...js.matchAll(/if \(!isWorldPointVisible\(x, y, rx \+ 8\)\) return;/g)].length,
    2,
    'town and swamp pond gradients should both be culled by their full radius',
  );

  const lampCalls = [];
  const flowerCalls = [];
  const source = js.match(/^function drawTownLampsAndFlowers\(\) \{[\s\S]*?^\}/m)?.[0];
  assert.ok(source, 'town decoration loop should be extractable');
  const render = Function(
    'isWorldPointVisible',
    'drawLampWorld',
    'drawFlowerClusterWorld',
    `${source}; return drawTownLampsAndFlowers;`,
  )(
    () => false,
    (...args) => lampCalls.push(args),
    (...args) => flowerCalls.push(args),
  );
  render();
  assert.equal(lampCalls.length, 0);
  assert.equal(flowerCalls.length, 0);
});
