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
  $('loginName').value = 'navigation-smoke';
  $('loginPassword').value = '1234';
  click('studentLoginBtn'); await sleep(1200);
  click('createCharacterBtn'); await sleep(2600);

  const G = window.__G;
  const worlds = window.YuksamData.worldDefs;
  function setMap(map, point) {
    G.currentMap = map;
    G.player.map = map;
    G.player.x = point.x;
    G.player.y = point.y;
    G.transitionLock = 0;
  }
  function colliders(map) {
    setMap(map, worlds[map]?.playerSpawn || { x:50, y:50 });
    return window.eval('getCurrentMapColliders()');
  }
  function signature(collider) {
    return collider.type === 'circle'
      ? `c:${collider.x}:${collider.y}:${collider.r}`
      : `r:${collider.x}:${collider.y}:${collider.w}:${collider.h}`;
  }
  function uniqueSignatures(map) {
    return [...new Set(colliders(map).map(signature))].sort();
  }
  function canMove(map, point) {
    setMap(map, point);
    return window.eval(`canPlayerMoveTo(${point.x}, ${point.y})`);
  }
  function transition(map, point, lock = 0) {
    setMap(map, point);
    G.transitionLock = lock;
    window.eval('checkAutoTransitions()');
    return { map:G.currentMap, x:G.player.x, y:G.player.y };
  }

  const townUnique = uniqueSignatures('town');
  check('town keeps nineteen unique collision shapes', townUnique.length === 19, `unique=${townUnique.length}, raw=${colliders('town').length}`);
  check('town includes healing well collider', townUnique.includes(signature({ type:'circle', x:worlds.town.healingWell.x, y:worlds.town.healingWell.y, r:44 })));
  check('town includes final pet building collider', townUnique.includes(signature({ type:'rect', x:worlds.town.petShop.x, y:worlds.town.petShop.y + 18, w:worlds.town.petShop.w * .9, h:worlds.town.petShop.h * .82 })));
  check('town includes final upgrade building collider', townUnique.includes(signature({ type:'rect', x:worlds.town.upgradeShop.x, y:worlds.town.upgradeShop.y + 18, w:worlds.town.upgradeShop.w * .9, h:worlds.town.upgradeShop.h * .82 })));
  check('forest keeps twenty-six colliders', colliders('forest').length === 26);
  check('desert keeps twenty colliders', colliders('desert').length === 20);
  check('swamp keeps twenty-eight colliders', colliders('swamp').length === 28);
  check('pet interior keeps final five colliders', colliders('petShopInterior').length === 5);
  check('upgrade interior keeps final four colliders', colliders('upgradeShopInterior').length === 4);
  check('boss room keeps an empty collider list', colliders('bossRoom').length === 0);
  check('final room keeps an empty collider list', colliders('finalBossRoom').length === 0);

  check('town pet building blocks movement', canMove('town', { x:worlds.town.petShop.x, y:worlds.town.petShop.y }) === false);
  check('town open ground allows movement', canMove('town', { x:1100, y:1100 }) === true);
  check('boss center allows movement', canMove('bossRoom', { x:G.width / 2, y:G.height / 2 + 45 }) === true);
  check('boss ellipse rejects outside movement', canMove('bossRoom', { x:G.width / 2 + 331, y:G.height / 2 + 45 }) === false);
  check('pet orb blocks movement', canMove('petShopInterior', { x:worlds.petShopInterior.orb.x, y:worlds.petShopInterior.orb.y - 20 }) === false);
  check('pet spawn remains walkable', canMove('petShopInterior', worlds.petShopInterior.playerSpawn) === true);
  check('upgrade blacksmith blocks movement', canMove('upgradeShopInterior', worlds.upgradeShopInterior.blacksmith) === false);

  check('town pet door enters pet interior', transition('town', { x:worlds.town.petShop.doorX, y:worlds.town.petShop.doorY }).map === 'petShopInterior');
  check('town upgrade door enters upgrade interior', transition('town', { x:worlds.town.upgradeShop.doorX, y:worlds.town.upgradeShop.doorY }).map === 'upgradeShopInterior');
  check('town equipment door enters equipment shop', transition('town', { x:worlds.town.shop.doorX, y:worlds.town.shop.doorY }).map === 'equipmentShop');
  check('town building door enters building shop', transition('town', { x:worlds.town.buildingShop.doorX, y:worlds.town.buildingShop.doorY }).map === 'buildingShopInterior');

  const petExit = transition('petShopInterior', worlds.petShopInterior.exit);
  check('pet exit returns beside its town door', petExit.map === 'town' && petExit.x === worlds.town.petShop.doorX && petExit.y === worlds.town.petShop.doorY + 115,
    `map=${petExit.map}, x=${petExit.x}, y=${petExit.y}`);
  const upgradeExit = transition('upgradeShopInterior', worlds.upgradeShopInterior.exit);
  check('upgrade exit returns beside its town door', upgradeExit.map === 'town' && upgradeExit.x === worlds.town.upgradeShop.doorX && upgradeExit.y === worlds.town.upgradeShop.doorY + 115,
    `map=${upgradeExit.map}, x=${upgradeExit.x}, y=${upgradeExit.y}`);
  const equipmentExit = transition('equipmentShop', worlds.equipmentShop.exit);
  check('equipment exit returns beside its town door', equipmentExit.map === 'town' && equipmentExit.x === worlds.town.shop.doorX && equipmentExit.y === worlds.town.shop.doorY + 115,
    `map=${equipmentExit.map}, x=${equipmentExit.x}, y=${equipmentExit.y}`);
  const buildingExit = transition('buildingShopInterior', worlds.buildingShopInterior.exit);
  check('building exit returns beside its town door', buildingExit.map === 'town' && buildingExit.x === worlds.town.buildingShop.doorX && buildingExit.y === worlds.town.buildingShop.doorY + 115,
    `map=${buildingExit.map}, x=${buildingExit.x}, y=${buildingExit.y}`);

  check('strict forty-two radius does not transition at boundary',
    transition('petShopInterior', { x:worlds.petShopInterior.exit.x + 42, y:worlds.petShopInterior.exit.y }).map === 'petShopInterior');
  check('active transition lock suppresses a door',
    transition('town', { x:worlds.town.petShop.doorX, y:worlds.town.petShop.doorY }, Date.now() + 10000).map === 'town');
  check('final room suppresses all automatic transitions', transition('finalBossRoom', worlds.finalBossRoom.exit).map === 'finalBossRoom');

  check('world navigation smoke has no async errors', asyncErrors.length === 0, asyncErrors.join(' | '));
  console.log(`RESULT: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 && asyncErrors.length === 0 ? 0 : 1);
}).catch((error) => {
  console.log(String(error?.stack || error));
  process.exit(1);
});
