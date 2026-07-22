import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Script, createContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const read = (file) => readFileSync(join(root, file), 'utf8');

function runBrowserModule(file, context) {
  new Script(read(file), { filename: file }).runInContext(context);
}

test('patch data is split into a browser global module loaded before game.js', () => {
  assert.equal(existsSync(join(root, 'src', 'patch-data.js')), true, 'src/patch-data.js should exist');

  const html = read('index.html');
  const gameDataScriptIndex = html.indexOf('<script src="src/game-data.js"></script>');
  const patchDataScriptIndex = html.indexOf('<script src="src/patch-data.js"></script>');
  const gameScriptIndex = html.indexOf('<script src="game.js"></script>');

  assert.ok(gameDataScriptIndex > -1, 'index.html should load src/game-data.js');
  assert.ok(patchDataScriptIndex > gameDataScriptIndex, 'src/patch-data.js should load after game-data');
  assert.ok(gameScriptIndex > patchDataScriptIndex, 'game.js should load after src/patch-data.js');
});

test('patch data module exposes mutable pet and enhancement tables', () => {
  const context = createContext({ window: {}, Math, Date });
  context.globalThis = context.window;

  runBrowserModule('src/patch-data.js', context);

  const data = context.window.YuksamPatchData;
  assert.equal(typeof data, 'object');
  assert.deepEqual(Object.keys(data.PET_DEFS_V27).sort(), ['cat', 'chick', 'dog', 'dragon', 'miniMushroom', 'yuksam']);
  assert.equal(data.PET_DEFS_V27.chick.name, '삐약이');
  assert.equal(data.PET_DEFS_V27.dragon.stats.힘, 5);
  assert.equal(data.PET_DEFS_V27.yuksam.name, '육삼이');
  assert.equal(data.PET_DEFS_V27.yuksam.icon, '🏢');
  assert.equal(data.PET_DEFS_V27.yuksam.legendary, true);
  assert.equal(data.PET_DEFS_V27.yuksam.stats.체력, 8);
  assert.equal(data.PET_DEFS_V27.yuksam.desc, '전설 펫. 눈과 미소를 가진 작은 육삼빌딩이 당신의 곁을 지켜줍니다.');
  assert.equal(data.TIER_INFO_V27.length, 5);
  assert.equal(data.TIER_INFO_V27[4].name, '전설');
  assert.equal(data.TIER_INFO_V27[4].chance, 0.20); // 사용자 지정 강화 확률(80/60/40/20) 반영
  assert.equal(data.WORLD_PATCHES_V17.swamp.key, 'swamp');
  assert.equal(data.WORLD_PATCHES_V21.finalBossRoom.key, 'finalBossRoom');
  assert.equal(data.WORLD_PATCHES_V27.town.petShop.name, '펫 상점');
  assert.equal(data.WORLD_PATCHES_V27.maps.petShopInterior.key, 'petShopInterior');
  assert.equal(data.WORLD_PATCHES_V30.petShopInterior.width, 1180);
  assert.equal(data.WORLD_PATCHES_V35.finalBossRoom.width, 1100);
  assert.equal(data.DUNGEONS_V25.length, 3);
  assert.deepEqual(Array.from(data.DUNGEONS_V25, (d) => d.key), ['forest', 'desert', 'swamp']);

  data.PET_DEFS_V27.testPet = { id: 'testPet' };
  assert.equal(data.PET_DEFS_V27.testPet.id, 'testPet', 'later patches must be able to extend pet definitions');
});

test('game.js consumes split patch data instead of defining pet and tier tables locally', () => {
  const js = read('game.js');

  assert.match(js, /const YuksamPatchData = window\.YuksamPatchData;/);
  assert.match(js, /const PET_DEFS_V27 = YuksamPatchData\.PET_DEFS_V27;/);
  assert.match(js, /const TIER_INFO_V27 = YuksamPatchData\.TIER_INFO_V27;/);
  assert.doesNotMatch(js, /const PET_DEFS_V27 = \{/);
  assert.doesNotMatch(js, /const TIER_INFO_V27 = \[/);
  assert.doesNotMatch(js, /PET_DEFS_V27\.yuksam\s*=/);
  assert.doesNotMatch(js, /PET_DEFS_V27\.yuksam\.(name|icon|desc|legendary)\s*=/);
  assert.doesNotMatch(js, /worldDefs\.swamp\s*=\s*\{/);
  assert.doesNotMatch(js, /worldDefs\.finalBossRoom\s*=\s*\{/);
  assert.doesNotMatch(js, /worldDefs\.petShopInterior\s*=\s*\{/);
  assert.doesNotMatch(js, /worldDefs\.upgradeShopInterior\s*=\s*\{/);
  assert.doesNotMatch(js, /Object\.assign\(worldDefs\.town,\s*\{/);
  assert.doesNotMatch(js, /const DUNGEONS_V25\s*=\s*\[/);
});
