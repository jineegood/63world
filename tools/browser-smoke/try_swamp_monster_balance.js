const run = require(require('path').join(__dirname, 'harness.js'));
const root = process.argv[2];

let pass = 0;
let fail = 0;
function check(name, condition, detail = '') {
  if (condition) {
    pass += 1;
    console.log(`PASS: ${name}${detail ? ` | ${detail}` : ''}`);
  } else {
    fail += 1;
    console.log(`FAIL: ${name}${detail ? ` | ${detail}` : ''}`);
  }
}

run(root, async ({ window, $, click, sleep, asyncErrors }) => {
  $('loginName').value = 'swamp-balance-smoke';
  $('loginPassword').value = '1234';
  click('studentLoginBtn'); await sleep(1200);
  click('createCharacterBtn'); await sleep(2600);
  $('game').classList.remove('active');

  const originalRandom = window.Math.random;
  const sample = (randomValue) => {
    window.Math.random = () => randomValue;
    const normal = window.createSwampMonsters();
    return {
      tarantula:normal.find((monster) => monster.type === 'tarantula'),
      zombie:normal.find((monster) => monster.type === 'zombie'),
      elite:window.eval("createEliteBoss('swamp')"),
    };
  };
  const minimum = sample(0);
  const maximum = sample(0.999999);
  window.Math.random = originalRandom;

  check('tarantula final HP is ten percent higher after existing scaling',
    minimum.tarantula.maxHp === 83 && maximum.tarantula.maxHp === 89,
    JSON.stringify([minimum.tarantula.maxHp, maximum.tarantula.maxHp]));
  check('tarantula final attack is twenty-five percent higher after existing scaling',
    minimum.tarantula.attack === 18 && maximum.tarantula.attack === 23,
    JSON.stringify([minimum.tarantula.attack, maximum.tarantula.attack]));
  check('normal zombie final attack is fifteen percent higher after existing scaling',
    minimum.zombie.attack === 36 && maximum.zombie.attack === 41,
    JSON.stringify([minimum.zombie.attack, maximum.zombie.attack]));
  check('elite zombie final attack is twenty percent lower after existing scaling',
    minimum.elite.attack === 30 && maximum.elite.attack === 35,
    JSON.stringify([minimum.elite.attack, maximum.elite.attack]));
  check('swamp balance smoke has no async errors', asyncErrors.length === 0, asyncErrors.join(' | '));

  console.log(`RESULT: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 && asyncErrors.length === 0 ? 0 : 1);
}).catch((error) => {
  console.log(String(error?.stack || error));
  process.exit(1);
});
