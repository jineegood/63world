const path = require('path');
const run = require(path.join(__dirname, 'harness.js'));
const root = process.argv[2] || path.join(__dirname, '..', '..');

run(root, async ({ window, $, asyncErrors }) => {
  const canvas = $('gameCanvas');
  const ctx = canvas.getContext('2d');
  const appearance = {
    skin:'#f1d2b6', shirt:'#38bdf8', pants:'#1e3a8a', hair:'#3f2d20', hairStyle:'short',
  };
  const cases = [
    ['cs_catBand', { head:'cs_catBand' }],
    ['cs_violetMagicHat', { head:'cs_violetMagicHat' }],
    ['cs_cloudHoodie', { armor:'cs_cloudHoodie' }],
    ['cs_forestFairyCape', { armor:'cs_forestFairyCape' }],
    ['cs_goldenBell', { accessory:'cs_goldenBell' }],
    ['cs_twilightBatWing', { accessory:'cs_twilightBatWing' }],
    ['cs_ninjaMask', { head:'cs_ninjaMask' }],
    ['cs_spartanHelm', { head:'cs_spartanHelm' }],
    ['cs_ninjaSuit', { armor:'cs_ninjaSuit' }],
    ['cs_spartanArmor', { armor:'cs_spartanArmor' }],
    ['cs_giantFishPack', { accessory:'cs_giantFishPack' }],
    ['cs_duckFloat', { accessory:'cs_duckFloat' }],
    ['ninja set', { head:'cs_ninjaMask', armor:'cs_ninjaSuit' }],
    ['Spartan set', { head:'cs_spartanHelm', armor:'cs_spartanArmor' }],
  ];
  const failures = [];

  window.__costumeTestCtx = ctx;
  window.__costumeTestAppearance = appearance;
  for (const [label, costume] of cases) {
    try {
      window.eval(`drawPlayerSprite(
        window.__costumeTestCtx,
        120,
        120,
        window.__costumeTestAppearance,
        'warrior',
        { attack:0, moving:false, equipment:{}, costume:${JSON.stringify(costume)} },
        2,
        null
      )`);
      console.log(`PASS: ${label} renders through the live player sprite`);
    } catch (error) {
      failures.push(`${label}: ${String(error?.message || error)}`);
      console.log(`FAIL: ${failures.at(-1)}`);
    }
  }

  if (!failures.length && !asyncErrors.length) {
    console.log('PASS: all twelve additions and two themed sets render without browser errors');
    process.exit(0);
  }
  console.log(`FAIL: ${[...failures, ...asyncErrors].join(' | ')}`);
  process.exit(1);
}).catch((error) => {
  console.log(String(error?.stack || error));
  process.exit(1);
});
