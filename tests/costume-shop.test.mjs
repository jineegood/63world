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

test('the paid costume catalog has two new choices per body part', () => {
  const defs = loadCostumeDefs();
  const paid = Object.values(defs).filter((item) => !item.questOnly);
  const countBySlot = Object.fromEntries(['head', 'armor', 'accessory'].map((slot) => [
    slot,
    paid.filter((item) => item.slot === slot).length,
  ]));

  assert.equal(Object.keys(defs).length, 17);
  assert.equal(paid.length, 16);
  assert.deepEqual(countBySlot, { head:5, armor:5, accessory:6 });

  const additions = {
    cs_catBand:['head', 'catEars'],
    cs_violetMagicHat:['head', 'wizardHat'],
    cs_cloudHoodie:['armor', 'cloudHoodie'],
    cs_forestFairyCape:['armor', 'cloak'],
    cs_goldenBell:['accessory', 'bellNecklace'],
    cs_twilightBatWing:['accessory', 'batWing'],
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
  assert.equal((markup.match(/class="panel-card costume-shop-card"/g) || []).length, 16);
  assert.match(markup, /data-costume-slot="head"[\s\S]*?<small>5종<\/small>/);
  assert.match(markup, /data-costume-slot="armor"[\s\S]*?<small>5종<\/small>/);
  assert.match(markup, /data-costume-slot="accessory"[\s\S]*?<small>6종<\/small>/);
  assert.doesNotMatch(markup, /새싹 리본|cs_questSproutRibbon/);
  assert.doesNotMatch(markup, /✨/);
});

test('the merchant uses a responsive three-column layout and every new look renders', () => {
  const style = read('style.css');
  const game = read('game.js');

  assert.match(style, /\.costume-shop-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(style, /@media \(max-width:\s*900px\)[\s\S]*?\.costume-shop-grid\s*\{\s*grid-template-columns:\s*repeat\(2,/);
  assert.match(style, /@media \(max-width:\s*620px\)[\s\S]*?\.costume-shop-grid\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  for (const type of ['catEars', 'cloudHoodie', 'bellNecklace', 'batWing']) {
    assert.match(game, new RegExp(`look\\?\\.type === '${type}'`));
  }
});

test('the extracted data snapshot includes the expanded costume catalog', () => {
  const defs = loadCostumeDefs();
  const snapshot = JSON.parse(read('data/game-data.snapshot.json'));
  const costumeIds = Object.keys(snapshot.items).filter((id) => snapshot.items[id]?.costume);

  assert.deepEqual(costumeIds.sort(), Object.keys(defs).sort());
});

test('all six additions render through the live player sprite', { timeout:15000 }, () => {
  const script = path.join(root, 'tools', 'browser-smoke', 'try_costume_items.js');
  const result = spawnSync(process.execPath, [script, root], { encoding:'utf8', timeout:12000 });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PASS: all six new costumes render without browser errors/);
});
