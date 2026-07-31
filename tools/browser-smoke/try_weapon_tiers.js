const path = require('path');
const run = require(path.join(__dirname, 'harness.js'));
const root = process.argv[2] || path.join(__dirname, '..', '..');

run(root, async ({ window, $, click, sleep, asyncErrors }) => {
  const G = () => window.__G;
  let pass = 0;
  let fail = 0;
  const check = (condition, name, detail = '') => {
    if (condition) pass += 1; else fail += 1;
    console.log(condition ? 'PASS:' : 'FAIL:', name, detail);
  };

  $('loginName').value = 'weapon-tier-smoke';
  $('loginPassword').value = '1';
  click('studentLoginBtn');
  await sleep(1300);
  click('createCharacterBtn');
  await sleep(2600);

  const player = G().player;
  const expectedTiers = [
    { color:'#cbd5e1', className:'' },
    { color:'#22c55e', className:'tier-1' },
    { color:'#3b82f6', className:'tier-2' },
    { color:'#a855f7', className:'tier-3' },
    { color:'#f59e0b', className:'tier-4' },
  ];
  const canonicalTiers = window.YuksamPatchData?.TIER_INFO_V27 || [];
  const weaponIds = Object.values(window.YuksamData?.ITEM_DEFS || {})
    .filter((item) => item?.slot === 'weapon')
    .map((item) => item.id);
  const uiWeaponId = weaponIds.includes('blueSword') ? 'blueSword' : weaponIds[0];
  let stylesCorrect = typeof window.getEquippedWeaponTierStyle === 'function'
    && weaponIds.length >= 2;

  player.weaponUpgrades ||= {};
  for (const weaponId of weaponIds) {
    player.equipment.weapon = weaponId;
    for (let tier = 0; tier < expectedTiers.length; tier += 1) {
      player.weaponUpgrades[weaponId] = tier;
      const style = window.getEquippedWeaponTierStyle(player);
      const expected = expectedTiers[tier];
      stylesCorrect &&= style.weaponId === weaponId
        && style.tier === tier
        && style.name === canonicalTiers[tier]?.name
        && style.color.toLowerCase() === expected.color
        && style.className === expected.className;
    }
  }
  check(stylesCorrect, 'every weapon id shares the canonical enhanced tier styles', `weapons=${weaponIds.length}`);

  player.equipment.weapon = uiWeaponId;
  player.weaponUpgrades[uiWeaponId] = 3;
  window.openCharacterPanel();
  await sleep(80);
  const equipmentSlot = window.document.querySelector('.slot-weapon-v7');
  check(equipmentSlot?.classList.contains('tier-3')
    && equipmentSlot.style.getPropertyValue('--weapon-tier-color') === expectedTiers[3].color,
  'equipment slot uses shared epic tier class and color');
  window.openUpgradeShopModalV33();
  const upgradePreview = window.document.querySelector('.upgrade-weapon-v27');
  check(upgradePreview?.classList.contains('tier-3')
    && upgradePreview.style.getPropertyValue('--weapon-tier-color') === expectedTiers[3].color,
  'upgrade preview uses shared epic tier class and color');

  const makeCanvasTracker = () => {
    const initial = {
      shadowColor:'#102030', shadowBlur:0, strokeStyle:'#405060', lineWidth:1, filter:'none',
    };
    const state = { ...initial };
    const stack = [];
    const writes = [];
    const strokes = [];
    const gradients = [];
    const ctx = new Proxy({}, {
      get(target, prop) {
        if (prop === 'canvas') return { width: 1280, height: 720 };
        if (prop === 'save') return () => stack.push({ ...state });
        if (prop === 'restore') return () => Object.assign(state, stack.pop() || {});
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => {
          const gradient = { type: prop, colors: [], addColorStop(offset, color) { this.colors.push([offset, color]); } };
          gradients.push(gradient);
          return gradient;
        };
        if (prop === 'stroke' || prop === 'strokeRect') return () => strokes.push({ ...state, method: prop });
        if (prop === 'measureText') return () => ({ width: 10 });
        if (typeof prop === 'string' && Object.hasOwn(state, prop)) return state[prop];
        return () => {};
      },
      set(target, prop, value) {
        if (typeof prop === 'string') {
          state[prop] = value;
          if (['shadowColor', 'strokeStyle', 'filter'].includes(prop)) writes.push([prop, value]);
        }
        return true;
      },
    });
    return { ctx, initial, state, stack, writes, strokes, gradients };
  };
  const worldCanvas = makeCanvasTracker();
  const combatCanvas = makeCanvasTracker();
  const drawState = { attack:0, moving:false, equipment:player.equipment };
  const hasTierOutlineStroke = (tracker, color) => tracker.strokes.some((stroke) => String(stroke.strokeStyle).toLowerCase() === color
    && String(stroke.shadowColor).toLowerCase() === color);
  const hasTierAura = (tracker, color) => tracker.gradients.some((gradient) => gradient.type === 'createRadialGradient'
    && gradient.colors.some(([, gradientColor]) => String(gradientColor).toLowerCase() === color));
  const originalWorldContext = G().ctx;
  const combatHost = $('modalContent');
  const renderedAllTierStyles = expectedTiers.every((expected, tier) => {
    player.weaponUpgrades[uiWeaponId] = tier;
    worldCanvas.strokes.length = 0;
    worldCanvas.gradients.length = 0;
    combatCanvas.strokes.length = 0;
    combatCanvas.gradients.length = 0;
    G().ctx = worldCanvas.ctx;
    window.drawWorld();
    combatHost.innerHTML = '<canvas id="combatPlayerCanvas" width="230" height="190"></canvas><canvas id="combatMonsterCanvas" width="230" height="190"></canvas>';
    $('combatPlayerCanvas').getContext = () => combatCanvas.ctx;
    $('combatMonsterCanvas').getContext = () => combatCanvas.ctx;
    G().modalState = { type:'combat' };
    window.drawCombatCanvases();
    const auraMatchesTier = tier === 0
      ? !hasTierAura(worldCanvas, expected.color) && !hasTierAura(combatCanvas, expected.color)
      : hasTierAura(worldCanvas, expected.color) && hasTierAura(combatCanvas, expected.color);
    const outlineMatchesTier = tier === 0
      ? !hasTierOutlineStroke(worldCanvas, expected.color) && !hasTierOutlineStroke(combatCanvas, expected.color)
      : hasTierOutlineStroke(worldCanvas, expected.color) && hasTierOutlineStroke(combatCanvas, expected.color);
    return outlineMatchesTier
      && auraMatchesTier;
  });
  G().ctx = originalWorldContext;
  check(renderedAllTierStyles,
    'tier zero has no enhancement effect while enhanced tiers add outline and aura');
  const auraStateRestored = [worldCanvas, combatCanvas].every((tracker) => tracker.stack.length === 0);
  check(auraStateRestored, 'weapon aura canvas state is restored after drawing');

  /* 치트는 이제 교사 서버 인증(requireTeacherCheatAccessV3)을 통과해야만 동작한다.
     여기서 검사하려는 것은 "인증을 통과한 교사가 썼을 때 즉시 강화가 제대로 되는가"이므로
     인증 자체는 통과한 것으로 두고 강화 동작만 본다.
     (인증을 반드시 거치는지는 tests/combat-flow.test.mjs가 소스에서 따로 확인한다.) */
  window.requireTeacherCheatAccessV3 = async () => true;

  player.weaponUpgrades[uiWeaponId] = 0;
  const buildingBefore = player.building;
  const questHookBefore = window.recordQuestActionV38;
  let questCalls = 0;
  window.recordQuestActionV38 = () => { questCalls += 1; };
  const playerStorageKey = `ysb_player_${player.name}`;
  const savedTiers = [];
  let characterRefreshes = true;
  let upgradeRefreshes = true;

  window.openCharacterPanel();
  await sleep(20);
  click('cheatUpgradeWeaponBtn');
  await sleep(20);
  characterRefreshes &&= player.weaponUpgrades[uiWeaponId] === 1
    && window.document.querySelector('.slot-weapon-v7')?.classList.contains('tier-1');
  savedTiers.push(JSON.parse(window.localStorage.getItem(playerStorageKey))?.weaponUpgrades?.[uiWeaponId]);

  window.openUpgradeShopModalV33();
  for (let expectedTier = 2; expectedTier <= 4; expectedTier += 1) {
    click('cheatUpgradeWeaponBtn');
    await sleep(20);
    upgradeRefreshes &&= player.weaponUpgrades[uiWeaponId] === expectedTier
      && window.document.querySelector('.upgrade-weapon-v27')?.classList.contains(`tier-${expectedTier}`);
    savedTiers.push(JSON.parse(window.localStorage.getItem(playerStorageKey))?.weaponUpgrades?.[uiWeaponId]);
  }
  check(characterRefreshes && upgradeRefreshes
    && savedTiers.join(',') === '1,2,3,4'
    && player.building === buildingBefore
    && questCalls === 0,
  'instant cheat advances one tier per click without cost or quest progress');
  check(window.getEquippedWeaponTierStyle(player).tier === 4,
    'instant cheat refreshes the visible tier state');
  const savedPlayer = JSON.parse(window.localStorage.getItem(playerStorageKey));
  const reloadedPlayer = window.normalizePlayer(savedPlayer);
  check(window.getEquippedWeaponTierStyle(reloadedPlayer).tier === 4,
    'saved weapon tier survives player normalization');

  player.weaponUpgrades[uiWeaponId] = 0;
  combatCanvas.strokes.length = 0;
  combatCanvas.gradients.length = 0;
  G().modalState = { type:'combat' };
  combatHost.innerHTML = '<canvas id="combatPlayerCanvas" width="230" height="190"></canvas><canvas id="combatMonsterCanvas" width="230" height="190"></canvas>';
  $('combatPlayerCanvas').getContext = () => combatCanvas.ctx;
  $('combatMonsterCanvas').getContext = () => combatCanvas.ctx;
  const combatCheatApplied = await window.cheatUpgradeEquippedWeapon();
  check(combatCheatApplied === true && hasTierOutlineStroke(combatCanvas, expectedTiers[1].color)
    && hasTierAura(combatCanvas, expectedTiers[1].color),
  'instant cheat redraws the active combat canvas with the next tier');

  player.weaponUpgrades[uiWeaponId] = 4;
  click('cheatUpgradeWeaponBtn');
  await sleep(20);
  check(player.weaponUpgrades[uiWeaponId] === 4 && $('toast').textContent.length > 0,
    'legendary tier cap is preserved and explained after consecutive upgrades');
  window.recordQuestActionV38 = questHookBefore;

  player.equipment.weapon = null;
  click('cheatUpgradeWeaponBtn');
  await sleep(20);
  check($('toast').textContent.length > 0, 'instant cheat requires an equipped weapon');

  check(asyncErrors.length === 0, 'no asynchronous browser errors', asyncErrors.slice(0, 3).join(' | '));
  console.log(`summary: PASS=${pass} FAIL=${fail}`);
  process.exit(fail === 0 && asyncErrors.length === 0 ? 0 : 1);
}).catch((error) => {
  console.log('scenario failed:', String(error?.stack || error).split('\n').slice(0, 4).join(' / '));
  process.exit(1);
});
