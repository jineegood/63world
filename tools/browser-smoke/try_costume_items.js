const path = require('path');
const run = require(path.join(__dirname, 'harness.js'));
const root = process.argv[2] || path.join(__dirname, '..', '..');

run(root, async ({ window, $, asyncErrors }) => {
  const canvas = $('gameCanvas');
  const ctx = canvas.getContext('2d');
  const appearance = {
    skin:'#f1d2b6', shirt:'#38bdf8', pants:'#1e3a8a', hair:'#3f2d20', hairStyle:'short',
  };
  const items = [
    ['cs_catBand', 'head'],
    ['cs_violetMagicHat', 'head'],
    ['cs_cloudHoodie', 'armor'],
    ['cs_forestFairyCape', 'armor'],
    ['cs_goldenBell', 'accessory'],
    ['cs_twilightBatWing', 'accessory'],
  ];
  const failures = [];

  window.__costumeTestCtx = ctx;
  window.__costumeTestAppearance = appearance;
  for (const [id, slot] of items) {
    try {
      window.eval(`drawPlayerSprite(
        window.__costumeTestCtx,
        120,
        120,
        window.__costumeTestAppearance,
        'warrior',
        { attack:0, moving:false, equipment:{}, costume:{ ${JSON.stringify(slot)}:${JSON.stringify(id)} } },
        2,
        null
      )`);
      console.log(`PASS: ${id} renders through the live player sprite`);
    } catch (error) {
      failures.push(`${id}: ${String(error?.message || error)}`);
      console.log(`FAIL: ${failures.at(-1)}`);
    }
  }

  if (!failures.length && !asyncErrors.length) {
    console.log('PASS: all six new costumes render without browser errors');
    process.exit(0);
  }
  console.log(`FAIL: ${[...failures, ...asyncErrors].join(' | ')}`);
  process.exit(1);
}).catch((error) => {
  console.log(String(error?.stack || error));
  process.exit(1);
});
