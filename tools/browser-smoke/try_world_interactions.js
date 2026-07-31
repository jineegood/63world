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
  $('loginName').value = '상호작용검증';
  $('loginPassword').value = '1234';
  click('studentLoginBtn'); await sleep(1200);
  click('createCharacterBtn'); await sleep(2600);

  const G = window.__G;
  const worlds = window.YuksamData.worldDefs;
  function candidate(map, point) {
    G.currentMap = map;
    G.player.map = map;
    G.player.x = point.x;
    G.player.y = point.y;
    return window.eval('getNearestInteractable()');
  }
  function expectType(name, map, point, type) {
    const found = candidate(map, point);
    check(name, found?.type === type, `expected=${type}, actual=${found?.type || 'null'}`);
    return found;
  }

  expectType('town pet-shop door uses final candidate', 'town', { x:worlds.town.petShop.doorX, y:worlds.town.petShop.doorY }, 'petShopDoor');
  expectType('town upgrade door uses final candidate', 'town', { x:worlds.town.upgradeShop.doorX, y:worlds.town.upgradeShop.doorY }, 'upgradeShopDoor');
  expectType('town healing well remains interactive', 'town', worlds.town.healingWell, 'healingWell');
  const equipmentExit = candidate('equipmentShop', worlds.equipmentShop.exit);
  check('equipment-shop exit remains available to click arrival and E', equipmentExit?.type === 'equipmentShopExit', `actual=${equipmentExit?.type || 'null'}`);
  expectType('equipment weapon NPC remains interactive', 'equipmentShop', worlds.equipmentShop.genie, 'weaponShop');
  expectType('pet interior exit remains an informational candidate', 'petShopInterior', worlds.petShopInterior.exit, 'petShopExit');
  expectType('pet orb uses final candidate', 'petShopInterior', worlds.petShopInterior.orb, 'petOrbNpc');
  expectType('upgrade interior exit remains an informational candidate', 'upgradeShopInterior', worlds.upgradeShopInterior.exit, 'upgradeShopExit');
  expectType('upgrade NPC uses final candidate', 'upgradeShopInterior', worlds.upgradeShopInterior.blacksmith, 'upgradeNpc');

  G.finalBossPortalUnlocked = true;
  G.bossReturnMap = 'swamp';
  expectType('boss room final portal wins', 'bossRoom', { x:910, y:500 }, 'finalBossPortal');
  expectType('final room exit uses V35 identity', 'finalBossRoom', worlds.finalBossRoom.exit, 'finalBossExitV35');
  expectType('final teacher uses V35 identity', 'finalBossRoom', worlds.finalBossRoom.teacher, 'finalTeacherNpcV35');
  const finalEmpty = candidate('finalBossRoom', { x:50, y:50 });
  check('final room blocks lower-map candidate fallback', finalEmpty === null, `actual=${finalEmpty?.type || 'null'}`);

  candidate('town', worlds.town.healingWell);
  window.eval('interact()');
  check('healing action opens the healing modal', G.modalState.type === 'healingWell', `type=${G.modalState.type}`);
  window.eval('closeModal()');

  G.transitionLock = 0;
  candidate('town', { x:worlds.town.petShop.doorX, y:worlds.town.petShop.doorY });
  window.eval('interact()');
  check('pet-shop door action enters the interior', G.currentMap === 'petShopInterior', `map=${G.currentMap}`);

  candidate('petShopInterior', worlds.petShopInterior.orb);
  window.eval('interact()');
  check('pet action opens the latest pet modal', G.modalState.type === 'petShop', `type=${G.modalState.type}`);
  window.eval('closeModal()');

  candidate('upgradeShopInterior', worlds.upgradeShopInterior.blacksmith);
  window.eval('interact()');
  check('upgrade action opens the latest upgrade modal', G.modalState.type === 'upgradeShop', `type=${G.modalState.type}`);
  window.eval('closeModal()');

  candidate('equipmentShop', worlds.equipmentShop.genie);
  window.eval('interact()');
  check('base weapon action still reaches its shop modal', G.modalState.type === 'shop', `type=${G.modalState.type}`);
  window.eval('closeModal()');

  candidate('petShopInterior', worlds.petShopInterior.exit);
  window.eval('interact()');
  check('pet automatic exit ignores E', G.currentMap === 'petShopInterior' && G.modalState.type === null, `map=${G.currentMap}, modal=${G.modalState.type}`);

  candidate('finalBossRoom', worlds.finalBossRoom.teacher);
  window.eval('interact()');
  check('final teacher opens the latest dialogue', G.modalState.type === 'dialogue', `type=${G.modalState.type}`);
  window.eval('closeModal()');

  G.finalBossReturn = { map:'bossRoom', x:760, y:540 };
  candidate('finalBossRoom', worlds.finalBossRoom.exit);
  window.eval('interact()');
  check('final exit returns to its recorded map', G.currentMap === 'bossRoom', `map=${G.currentMap}`);

  check('world interaction smoke has no async errors', asyncErrors.length === 0, asyncErrors.join(' | '));
  console.log(`RESULT: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 && asyncErrors.length === 0 ? 0 : 1);
}).catch((error) => {
  console.log(String(error?.stack || error));
  process.exit(1);
});
