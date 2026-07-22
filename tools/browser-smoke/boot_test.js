const path = require('path');
const run = require(path.join(__dirname, 'harness.js'));
const root = process.argv[2] || path.join(__dirname, '..', '..');

run(root, async ({ window, $, asyncErrors }) => {
  const checks = [
    ['game state exported', !!window.__G],
    ['game data loaded', !!window.YuksamData],
    ['combat rules loaded', !!window.YuksamCombatRules],
    ['combat FX loaded', !!window.YuksamCombatFx],
    ['student login control exists', !!$('studentLoginBtn')],
    ['character creation control exists', !!$('createCharacterBtn')],
    ['game canvas exists', !!$('gameCanvas')],
    ['modal content exists', !!$('modalContent')],
    ['script boot produced no async errors', asyncErrors.length === 0],
  ];
  let failures = 0;
  for (const [name, passed] of checks) {
    console.log(`${passed ? 'PASS' : 'FAIL'}: ${name}`);
    if (!passed) failures += 1;
  }
  console.log(`RESULT: ${failures === 0 ? 'PASS' : 'FAIL'} ${checks.length - failures}/${checks.length}`);
  process.exit(failures === 0 ? 0 : 1);
}).catch((error) => {
  console.log(String(error?.stack || error));
  process.exit(1);
});
