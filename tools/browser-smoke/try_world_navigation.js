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
  $('loginName').value = 'nav-smoke';
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

  setMap('town', worlds.town.playerSpawn);
  const frameCacheProbe = window.eval(`(() => {
    const originalBuilder = getBaseMapColliders;
    let colliderBuilds = 0;
    getBaseMapColliders = function(...args) {
      colliderBuilds += 1;
      return originalBuilder(...args);
    };
    try {
      beginWorldColliderFrameV1();
      const first = getCurrentMapColliders();
      const second = getCurrentMapColliders();
      endWorldColliderFrameV1();
      getCurrentMapColliders();
      return { colliderBuilds, reusedWithinFrame:first === second };
    } finally {
      endWorldColliderFrameV1();
      getBaseMapColliders = originalBuilder;
    }
  })()`);
  check('one frame reuses one collider array and releases it afterward',
    frameCacheProbe.colliderBuilds === 2 && frameCacheProbe.reusedWithinFrame === true,
    JSON.stringify(frameCacheProbe));

  // 기존 19개 + 63빌딩 던전에서 더한 2개(빌딩 본체, 원로 명진) = 21개
  const townUnique = uniqueSignatures('town');
  check('town keeps twenty-one unique collision shapes', townUnique.length === 21, `unique=${townUnique.length}, raw=${colliders('town').length}`);
  check('town includes healing well collider', townUnique.includes(signature({ type:'circle', x:worlds.town.healingWell.x, y:worlds.town.healingWell.y, r:44 })));
  const raid = window.YuksamRaidDungeon;
  check('town includes 63 tower collider',
    townUnique.includes(signature({ type:'rect', x:raid.TOWER.x, y:raid.TOWER.y - 16, w:raid.TOWER.w * .92, h:raid.TOWER.h * .80 })));
  check('town includes raid elder collider',
    townUnique.includes(signature({ type:'circle', x:raid.ELDER.x, y:raid.ELDER.y, r:32 })));
  check('town includes final pet building collider', townUnique.includes(signature({ type:'rect', x:worlds.town.petShop.x, y:worlds.town.petShop.y + 18, w:worlds.town.petShop.w * .9, h:worlds.town.petShop.h * .82 })));
  check('town includes final upgrade building collider', townUnique.includes(signature({ type:'rect', x:worlds.town.upgradeShop.x, y:worlds.town.upgradeShop.y + 18, w:worlds.town.upgradeShop.w * .9, h:worlds.town.upgradeShop.h * .82 })));
  check('forest keeps twenty-eight colliders including two healing wells', colliders('forest').length === 28);
  check('desert keeps twenty-two colliders including two healing wells', colliders('desert').length === 22);
  check('swamp keeps thirty colliders including two healing wells', colliders('swamp').length === 30);
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

  const safeBeforeGuard = { x:1100, y:1100 };
  setMap('town', safeBeforeGuard);
  const safeGuardResult = window.eval("reconcileWorldPlayerPositionV1('browser-safe-check')");
  check('position guard leaves ordinary open ground untouched',
    safeGuardResult.recovered === false && G.player.x === safeBeforeGuard.x && G.player.y === safeBeforeGuard.y);

  setMap('town', { x:raid.TOWER.x, y:raid.TOWER.y - 16 });
  const blockedGuardResult = window.eval("reconcileWorldPlayerPositionV1('browser-blocked-check')");
  check('position guard frees a player embedded in the 63 tower',
    blockedGuardResult.recovered === true && window.eval(`canPlayerMoveTo(${G.player.x}, ${G.player.y})`) === true,
    `reason=${blockedGuardResult.reason}, x=${G.player.x}, y=${G.player.y}`);

  G.player.x = Number.NaN;
  G.player.y = Number.POSITIVE_INFINITY;
  const invalidGuardResult = window.eval("reconcileWorldPlayerPositionV1('browser-invalid-check')");
  check('position guard repairs invalid saved coordinates',
    invalidGuardResult.recovered === true && Number.isFinite(G.player.x) && Number.isFinite(G.player.y));

  const guardedDoors = [
    { door:worlds.town.shop, expected:'equipmentShop' },
    { door:worlds.town.buildingShop, expected:'buildingShopInterior' },
    { door:worlds.town.petShop, expected:'petShopInterior' },
    { door:worlds.town.upgradeShop, expected:'upgradeShopInterior' },
  ];
  const guardedDoorFailures = [];
  guardedDoors.forEach(({ door, expected }) => {
    const approach = { x:door.doorX, y:door.doorY + 30 };
    setMap('town', approach);
    const guardResult = window.eval("reconcileWorldPlayerPositionV1('browser-door-check')");
    const remained = G.player.x === approach.x && G.player.y === approach.y;
    window.eval('checkAutoTransitions()');
    if (guardResult.recovered || !remained || G.currentMap !== expected) {
      guardedDoorFailures.push(`${expected}:${guardResult.reason}:${G.currentMap}`);
    }
  });
  check('position guard does not bounce reachable automatic door approaches',
    guardedDoorFailures.length === 0, guardedDoorFailures.join(', '));

  const forestReturnPortal = window.eval("ensureStagePortals('forest').returnPortal");
  const portalPoints = [worlds.town.portal, { x:forestReturnPortal.x + 90, y:forestReturnPortal.y }];
  const portalFailures = [];
  portalPoints.forEach((portal, index) => {
    const map = index === 0 ? 'town' : 'forest';
    setMap(map, portal);
    const guardResult = window.eval("reconcileWorldPlayerPositionV1('browser-portal-check')");
    if (guardResult.recovered || G.player.x !== portal.x || G.player.y !== portal.y) {
      portalFailures.push(`${map}:${guardResult.reason}`);
    }
  });
  check('position guard leaves walkable portal positions in place',
    portalFailures.length === 0, portalFailures.join(', '));

  const blacksmithDoor = worlds.town.upgradeShop;
  setMap('town', { x:blacksmithDoor.doorX, y:blacksmithDoor.doorY + 180 });
  const blacksmithClickPlan = window.YuksamClickMovement.planPath({
    start:{ x:G.player.x, y:G.player.y },
    target:{ x:blacksmithDoor.doorX, y:blacksmithDoor.doorY },
    bounds:{ width:worlds.town.width, height:worlds.town.height },
    colliders:window.eval('getCurrentMapColliders()'),
    radius:30,
    cellSize:32,
  });
  const blacksmithArrival = blacksmithClickPlan.at(-1);
  check('blacksmith door click finds a reachable interaction point',
    blacksmithClickPlan.length > 0
      && Math.hypot(blacksmithArrival.x - blacksmithDoor.doorX, blacksmithArrival.y - blacksmithDoor.doorY) < 100,
    JSON.stringify(blacksmithArrival || null));
  if (blacksmithArrival) {
    G.player.x = blacksmithArrival.x;
    G.player.y = blacksmithArrival.y;
  }
  window.eval('interact()');
  check('blacksmith click-arrival interaction enters the interior', G.currentMap === 'upgradeShopInterior', G.currentMap);

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
