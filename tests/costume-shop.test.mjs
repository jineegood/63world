import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function loadCostumeDefs() {
  const window = { YuksamData:{ ITEM_DEFS:{} } };
  vm.runInNewContext(read('src/costume-data.js'), { window });
  return window.COSTUME_DEFS_V55;
}

function renderShop(defs) {
  let markup = '';
  const window = {
    __G:{ player:{ gold:9999, costume:{}, costumeInventory:[] } },
    COSTUME_DEFS_V55:defs,
    escapeHtml:(value) => String(value),
    openModal:(html) => { markup = html; },
  };
  const context = {
    window,
    document:{ getElementById:() => null, querySelector:() => null },
    setInterval:() => 0,
    setTimeout:() => 0,
  };
  vm.runInNewContext(read('src/costume-ui.js'), context);
  window.openCostumeShopV55();
  return markup;
}

function renderCostumePanel(defs, costumeInventory, costume = {}) {
  let markup = '';
  const window = {
    __G:{
      player:{
        class:'warrior', appearance:{}, equipment:{}, costume,
        costumeInventory:[...costumeInventory],
      },
    },
    COSTUME_DEFS_V55:defs,
    escapeHtml:(value) => String(value),
    openModal:(html) => { markup = html; },
  };
  const context = {
    window,
    document:{ getElementById:() => null, querySelector:() => null },
    setInterval:() => 0,
    setTimeout:() => 0,
  };
  vm.runInNewContext(read('src/costume-ui.js'), context);
  window.openCostumePanelV55();
  return markup;
}

test('the expanded costume catalog has two new choices per body part', () => {
  const defs = loadCostumeDefs();
  const paid = Object.values(defs).filter((item) => !item.questOnly);
  const countBySlot = Object.fromEntries(['head', 'armor', 'accessory'].map((slot) => [
    slot,
    paid.filter((item) => item.slot === slot).length,
  ]));

  assert.equal(Object.keys(defs).length, 29);
  assert.equal(paid.length, 28);
  assert.deepEqual(countBySlot, { head:9, armor:9, accessory:10 });

  const additions = {
    cs_catBand:['head', 'catEars'],
    cs_violetMagicHat:['head', 'arcaneMoonHat'],
    cs_cloudHoodie:['armor', 'cloudHoodie'],
    cs_forestFairyCape:['armor', 'forestLeafMantle'],
    cs_goldenBell:['accessory', 'bellNecklace'],
    cs_twilightBatWing:['accessory', 'batWing'],
    cs_ninjaMask:['head', 'ninjaMask'],
    cs_spartanHelm:['head', 'spartanHelm'],
    cs_ninjaSuit:['armor', 'ninjaSuit'],
    cs_spartanArmor:['armor', 'spartanArmor'],
    cs_giantFishPack:['accessory', 'giantFishPack'],
    cs_duckFloat:['accessory', 'duckFloat'],
    cs_sharkHood:['head', 'sharkHood'],
    cs_blackDragonHelm:['head', 'blackDragonHelm'],
    cs_sharkSuit:['armor', 'sharkSuit'],
    cs_blackDragonArmor:['armor', 'blackDragonArmor'],
    cs_sharkBuddy:['accessory', 'sharkBuddy'],
    cs_blackDragonShield:['accessory', 'blackDragonAegis'],
  };
  for (const [id, [slot, lookType]] of Object.entries(additions)) {
    const item = defs[id];
    assert.equal(item.id, id);
    assert.equal(item.slot, slot);
    assert.equal(item.look.type, lookType);
    assert.equal(item.costume, true);
    assert.equal(item.classOnly, null);
    assert.ok(item.price > 0);
    assert.equal('stats' in item, false);
  }
  assert.notEqual(defs.cs_violetMagicHat.look.type, 'wizardHat');
  assert.notEqual(defs.cs_forestFairyCape.look.type, 'cloak');
});

test('every paid costume is exactly half price while the quest gift stays free', () => {
  const defs = loadCostumeDefs();
  const expectedPrices = {
    cs_bunnyBand:60,
    cs_catBand:100,
    cs_flowerCrown:130,
    cs_sharkHood:115,
    cs_starCrown:155,
    cs_violetMagicHat:175,
    cs_ninjaMask:200,
    cs_spartanHelm:230,
    cs_blackDragonHelm:255,
    cs_sailorCape:75,
    cs_cloudHoodie:115,
    cs_starryRobe:105,
    cs_sharkSuit:135,
    cs_peachDress:135,
    cs_forestFairyCape:150,
    cs_ninjaSuit:170,
    cs_spartanArmor:210,
    cs_blackDragonArmor:265,
    cs_ribbon:50,
    cs_goldenBell:110,
    cs_giantFishPack:130,
    cs_duckFloat:110,
    cs_sharkBuddy:125,
    cs_angelWing:125,
    cs_strangeWing:145,
    cs_rainbowAura:165,
    cs_twilightBatWing:180,
    cs_blackDragonShield:240,
  };
  const paidPrices = Object.fromEntries(
    Object.values(defs)
      .filter((item) => !item.questOnly)
      .map((item) => [item.id, item.price]),
  );

  assert.deepEqual(paidPrices, expectedPrices);
  assert.equal(Object.keys(paidPrices).length, 28);
  assert.equal(defs.cs_questSproutRibbon.price, 0);
});

test('the costume merchant groups paid items by slot and keeps the quest gift hidden', () => {
  const markup = renderShop(loadCostumeDefs());
  const head = markup.indexOf('data-costume-slot="head"');
  const armor = markup.indexOf('data-costume-slot="armor"');
  const accessory = markup.indexOf('data-costume-slot="accessory"');

  assert.ok(head >= 0 && armor > head && accessory > armor);
  assert.equal((markup.match(/class="panel-card costume-shop-card"/g) || []).length, 28);
  assert.match(markup, /data-costume-slot="head"[\s\S]*?<small>9종<\/small>/);
  assert.match(markup, /data-costume-slot="armor"[\s\S]*?<small>9종<\/small>/);
  assert.match(markup, /data-costume-slot="accessory"[\s\S]*?<small>10종<\/small>/);
  assert.doesNotMatch(markup, /새싹 리본|cs_questSproutRibbon/);
  assert.doesNotMatch(markup, /✨/);
});

test('the merchant uses three vertical body-part lanes and every new look renders', () => {
  const style = read('style.css');
  const game = read('game.js');

  assert.match(style, /\.costume-shop-sections\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(style, /\.costume-shop-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(style, /@media \(max-width:\s*900px\)[\s\S]*?\.costume-shop-sections\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(250px,/);
  for (const type of [
    'catEars', 'arcaneMoonHat', 'cloudHoodie', 'forestLeafMantle', 'bellNecklace', 'batWing',
    'ninjaMask', 'spartanHelm', 'ninjaSuit', 'spartanArmor', 'giantFishPack', 'duckFloat',
    'sharkHood', 'blackDragonHelm', 'sharkSuit', 'blackDragonArmor', 'sharkBuddy', 'blackDragonAegis',
  ]) {
    assert.match(game, new RegExp(`look\\?\\.type === '${type}'`));
  }
});

test('the character costume inventory uses three independently scrollable vertical lanes', () => {
  const markup = renderCostumePanel(loadCostumeDefs(), [
    'cs_ninjaMask', 'cs_spartanHelm',
    'cs_ninjaSuit', 'cs_spartanArmor',
    'cs_giantFishPack', 'cs_duckFloat',
  ], { head:'cs_ninjaMask' });
  const head = markup.indexOf('data-costume-inventory-slot="head"');
  const armor = markup.indexOf('data-costume-inventory-slot="armor"');
  const accessory = markup.indexOf('data-costume-inventory-slot="accessory"');
  const style = read('style.css');

  assert.ok(head >= 0 && armor > head && accessory > armor);
  assert.match(markup, /data-costume-inventory-slot="head"[\s\S]*?<small>2개<\/small>[\s\S]*?그림자 닌자 복면[\s\S]*?스파르타 투구/);
  assert.match(markup, /data-costume-inventory-slot="armor"[\s\S]*?<small>2개<\/small>[\s\S]*?그림자 닌자복[\s\S]*?스파르타 전투갑옷/);
  assert.match(markup, /data-costume-inventory-slot="accessory"[\s\S]*?<small>2개<\/small>[\s\S]*?대왕 생선 등짐[\s\S]*?고무 오리 튜브/);
  assert.match(markup, /onclick="unequipCostumeV55\('head'\)">해제<\/button>/);
  assert.equal((markup.match(/tabindex="0" aria-label="[^\"]+ 코스튬 목록"/g) || []).length, 3);
  assert.match(style, /\.costume-inventory-card-v55\s*\{[\s\S]*?height:\s*clamp\(/);
  assert.match(style, /\.costume-inventory-sections\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,/);
  assert.match(style, /\.costume-inventory-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)[\s\S]*?max-height:\s*100%[\s\S]*?overflow-y:\s*auto[\s\S]*?overscroll-behavior:\s*contain/);
  assert.match(style, /@media \(min-width:\s*1240px\)[\s\S]*?\.costume-panel-layout-v55\s*\{[\s\S]*?minmax\(500px,[\s\S]*?minmax\(600px,/);
  assert.match(style, /@media \(max-width:\s*1100px\)[\s\S]*?\.costume-panel-layout-v55\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  const ui = read('src/costume-ui.js');
  assert.match(ui, /rememberInventoryScrollV55\(\)/);
  assert.match(ui, /restoreInventoryScrollV55\(\)/);
});

test('empty costume body-part groups stay visible and explain what is missing', () => {
  const markup = renderCostumePanel(loadCostumeDefs(), ['cs_ninjaMask']);

  assert.match(markup, /data-costume-inventory-slot="head"[\s\S]*?<small>1개<\/small>/);
  assert.match(markup, /data-costume-inventory-slot="armor"[\s\S]*?<small>0개<\/small>[\s\S]*?보유 중인 옷 코스튬이 없습니다/);
  assert.match(markup, /data-costume-inventory-slot="accessory"[\s\S]*?<small>0개<\/small>[\s\S]*?보유 중인 악세서리 코스튬이 없습니다/);
});

test('the costume closet includes the independently equipped raid nameplate collection', () => {
  const ui = read('src/costume-ui.js');
  const nameplates = read('src/raid-nameplates.js');
  const style = read('style.css');
  const index = read('index.html');

  assert.match(ui, /renderRaidNameplatePickerV1/);
  assert.match(ui, /\$\{nameplatePicker\}/);
  assert.match(nameplates, /강철 승강기 이름표/);
  assert.match(nameplates, /황혼의 창 이름표/);
  assert.match(nameplates, /육삼 정상 이름표/);
  assert.match(nameplates, /파티 던전 \$\{entry\.floorLabel\} 최초 돌파 시 획득/);
  assert.match(style, /\.raid-nameplate-grid-v1\s*\{[^}]*grid-template-columns:\s*repeat\(3,/);
  assert.match(style, /\.raid-nameplate-preview-v1\.raid-nameplate-steel-20[\s\S]*?#fb923c/);
  assert.match(index, /<script src="src\/raid-nameplates\.js"><\/script>[\s\S]*?<script src="src\/raid-run-ui\.js"><\/script>/);
});

test('the extracted data snapshot includes the expanded costume catalog', () => {
  const defs = loadCostumeDefs();
  const snapshot = JSON.parse(read('data/game-data.snapshot.json'));
  const costumeIds = Object.keys(snapshot.items).filter((id) => snapshot.items[id]?.costume);

  assert.deepEqual(costumeIds.sort(), Object.keys(defs).sort());
  for (const [id, item] of Object.entries(defs)) {
    assert.equal(snapshot.items[id]?.price, item.price, `${id} snapshot price`);
  }
});

test('all eighteen additions and four themed sets render through the live player sprite', { timeout:25000 }, () => {
  const script = path.join(root, 'tools', 'browser-smoke', 'try_costume_items.js');
  const result = spawnSync(process.execPath, [script, root], { encoding:'utf8', timeout:20000 });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PASS: all eighteen additions and four themed sets render without browser errors/);
});
