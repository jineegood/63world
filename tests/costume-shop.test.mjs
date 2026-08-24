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

test('the paid costume catalog has four added choices per body part', () => {
  const defs = loadCostumeDefs();
  const paid = Object.values(defs).filter((item) => !item.questOnly);
  const countBySlot = Object.fromEntries(['head', 'armor', 'accessory'].map((slot) => [
    slot,
    paid.filter((item) => item.slot === slot).length,
  ]));

  assert.equal(Object.keys(defs).length, 23);
  assert.equal(paid.length, 22);
  assert.deepEqual(countBySlot, { head:7, armor:7, accessory:8 });

  const additions = {
    cs_catBand:['head', 'catEars'],
    cs_violetMagicHat:['head', 'wizardHat'],
    cs_cloudHoodie:['armor', 'cloudHoodie'],
    cs_forestFairyCape:['armor', 'cloak'],
    cs_goldenBell:['accessory', 'bellNecklace'],
    cs_twilightBatWing:['accessory', 'batWing'],
    cs_ninjaMask:['head', 'ninjaMask'],
    cs_spartanHelm:['head', 'spartanHelm'],
    cs_ninjaSuit:['armor', 'ninjaSuit'],
    cs_spartanArmor:['armor', 'spartanArmor'],
    cs_giantFishPack:['accessory', 'giantFishPack'],
    cs_duckFloat:['accessory', 'duckFloat'],
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
});

test('the costume merchant groups paid items by slot and keeps the quest gift hidden', () => {
  const markup = renderShop(loadCostumeDefs());
  const head = markup.indexOf('data-costume-slot="head"');
  const armor = markup.indexOf('data-costume-slot="armor"');
  const accessory = markup.indexOf('data-costume-slot="accessory"');

  assert.ok(head >= 0 && armor > head && accessory > armor);
  assert.equal((markup.match(/class="panel-card costume-shop-card"/g) || []).length, 22);
  assert.match(markup, /data-costume-slot="head"[\s\S]*?<small>7종<\/small>/);
  assert.match(markup, /data-costume-slot="armor"[\s\S]*?<small>7종<\/small>/);
  assert.match(markup, /data-costume-slot="accessory"[\s\S]*?<small>8종<\/small>/);
  assert.doesNotMatch(markup, /새싹 리본|cs_questSproutRibbon/);
  assert.doesNotMatch(markup, /✨/);
});

test('the merchant uses a responsive three-column layout and every new look renders', () => {
  const style = read('style.css');
  const game = read('game.js');

  assert.match(style, /\.costume-shop-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(style, /@media \(max-width:\s*900px\)[\s\S]*?\.costume-shop-grid\s*\{\s*grid-template-columns:\s*repeat\(2,/);
  assert.match(style, /@media \(max-width:\s*620px\)[\s\S]*?\.costume-shop-grid\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  for (const type of [
    'catEars', 'cloudHoodie', 'bellNecklace', 'batWing',
    'ninjaMask', 'spartanHelm', 'ninjaSuit', 'spartanArmor', 'giantFishPack', 'duckFloat',
  ]) {
    assert.match(game, new RegExp(`look\\?\\.type === '${type}'`));
  }
});

test('the character costume inventory is grouped by body part with per-section counts', () => {
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
  assert.match(style, /\.costume-inventory-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,/);
  assert.match(style, /@media \(max-width:\s*620px\)[\s\S]*?\.costume-inventory-grid\s*\{\s*grid-template-columns:\s*repeat\(2,/);
});

test('empty costume body-part groups stay visible and explain what is missing', () => {
  const markup = renderCostumePanel(loadCostumeDefs(), ['cs_ninjaMask']);

  assert.match(markup, /data-costume-inventory-slot="head"[\s\S]*?<small>1개<\/small>/);
  assert.match(markup, /data-costume-inventory-slot="armor"[\s\S]*?<small>0개<\/small>[\s\S]*?보유 중인 옷 코스튬이 없습니다/);
  assert.match(markup, /data-costume-inventory-slot="accessory"[\s\S]*?<small>0개<\/small>[\s\S]*?보유 중인 악세서리 코스튬이 없습니다/);
});

test('the extracted data snapshot includes the expanded costume catalog', () => {
  const defs = loadCostumeDefs();
  const snapshot = JSON.parse(read('data/game-data.snapshot.json'));
  const costumeIds = Object.keys(snapshot.items).filter((id) => snapshot.items[id]?.costume);

  assert.deepEqual(costumeIds.sort(), Object.keys(defs).sort());
});

test('all twelve additions and the two themed sets render through the live player sprite', { timeout:15000 }, () => {
  const script = path.join(root, 'tools', 'browser-smoke', 'try_costume_items.js');
  const result = spawnSync(process.execPath, [script, root], { encoding:'utf8', timeout:12000 });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PASS: all twelve additions and two themed sets render without browser errors/);
});
