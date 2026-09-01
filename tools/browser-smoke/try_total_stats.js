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
  $('loginName').value = 'stats-smoke';
  $('loginPassword').value = '1234';
  click('studentLoginBtn'); await sleep(1200);
  click('createCharacterBtn'); await sleep(2600);
  $('game').classList.remove('active');
  const G = window.__G;
  const p = G.player;
  const originalBaseVersion = p.baseStatsVersion;

  function defaultWeapon(klass) {
    return window.eval(`defaultWeaponIdForClass(${JSON.stringify(klass)})`);
  }
  function prepare(klass, spec = null) {
    Object.assign(p, {
      class:klass, spec, baseStatsVersion:originalBaseVersion,
      equipment:{ weapon:defaultWeapon(klass) }, inventory:[], skills:{},
      pets:[], activePet:null, weaponUpgrades:{}, raidNameplates:[], nameplate:{ theme:'default' }, maxHp:100, hp:100,
    });
  }
  function stats() { return window.eval('computeTotalStats()'); }
  function deltaFor(klass, spec) {
    prepare(klass, null);
    const base = stats();
    p.spec = spec;
    const total = stats();
    return Object.fromEntries(['힘','지능','정신','체력'].map((key) => [key, (total[key] || 0) - (base[key] || 0)]));
  }

  const expectedSpecs = [
    ['warrior','방어',{ 힘:0, 지능:0, 정신:0, 체력:9 }],
    ['warrior','무기',{ 힘:5, 지능:0, 정신:0, 체력:3 }],
    ['mage','냉기',{ 힘:0, 지능:3, 정신:0, 체력:3 }],
    ['mage','화염',{ 힘:0, 지능:6, 정신:0, 체력:0 }],
    ['priest','신성',{ 힘:0, 지능:0, 정신:5, 체력:3 }],
    ['priest','암흑',{ 힘:0, 지능:0, 정신:6, 체력:0 }],
  ];
  for (const [klass, spec, expected] of expectedSpecs) {
    const actual = deltaFor(klass, spec);
    check(`${klass} ${spec} keeps cumulative specialization bonuses`, JSON.stringify(actual) === JSON.stringify(expected), JSON.stringify(actual));
  }

  prepare('warrior');
  const plain = stats();
  p.inventory = ['starPendant'];
  const possessed = stats();
  check('unequipped accessory possession bonus applies once', possessed.지능 === plain.지능 + 1);
  p.inventory.push('cloverBadge');
  p.equipment.accessory = 'cloverBadge';
  const equipped = stats();
  check('equipped accessory replaces its possession bonus with full stats', equipped.힘 === possessed.힘 + 3 && equipped.체력 === possessed.체력 + 1 && equipped.지능 === possessed.지능);

  prepare('warrior');
  const noNameplates = stats();
  p.raidNameplates = ['raid_63_summit', 'raid_20_steel', 'raid_40_twilight'];
  p.nameplate = { theme:'default' };
  const ownedNameplates = stats();
  check('all milestone nameplates grant cumulative possession vitality without being equipped', ownedNameplates.체력 === noNameplates.체력 + 9);

  prepare('warrior');
  const noPet = stats();
  p.activePet = 'dragon';
  const withPet = stats();
  check('active pet stats apply once', withPet.힘 === noPet.힘 + 5);

  prepare('warrior');
  const weaponId = p.equipment.weapon;
  const unenhanced = stats();
  p.weaponUpgrades[weaponId] = 2;
  const enhanced = stats();
  const weapon = window.eval(`getItemDefinition(${JSON.stringify(weaponId)}, 'warrior')`);
  const enhancementOk = Object.entries(weapon.stats || {}).every(([key, value]) => enhanced[key] === unenhanced[key] + Math.max(1, Math.ceil(Number(value || 0) * 2 * .45)));
  check('weapon enhancement bonus follows tier formula once', enhancementOk, JSON.stringify({ unenhanced, enhanced, weapon:weapon.stats }));

  prepare('warrior');
  const fullHealthStrength = stats().힘;
  p.skills = { warrior_frenzy:2 };
  p.maxHp = 100; p.hp = 50;
  const frenzy = stats();
  check('frenzy scales final strength from lost health', frenzy.힘 === Math.round(fullHealthStrength * 1.15), `base=${fullHealthStrength}, frenzy=${frenzy.힘}`);

  const first = stats();
  const second = stats();
  check('valid stat calculation is repeatable', JSON.stringify(first) === JSON.stringify(second));

  prepare('warrior');
  p.equipment = null;
  p.weaponUpgrades = null;
  const legacyFirst = stats();
  const legacySecond = stats();
  check('legacy player fields produce stable stats on the first call', JSON.stringify(legacyFirst) === JSON.stringify(legacySecond),
    JSON.stringify({ first:legacyFirst, second:legacySecond }));
  check('stat smoke has no async errors', asyncErrors.length === 0, asyncErrors.join(' | '));
  console.log(`RESULT: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 && asyncErrors.length === 0 ? 0 : 1);
}).catch((error) => {
  console.log(String(error?.stack || error));
  process.exit(1);
});
