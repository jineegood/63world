const path = require('path');
const run = require(path.join(__dirname, 'harness.js'));
const root = process.argv[2] || path.join(__dirname, '..', '..');
const mode = process.argv[3] || 'protected-death';

run(root, async ({ window, asyncErrors }) => {
  const checks = [];
  const check = (name, passed) => {
    checks.push([name, Boolean(passed)]);
    console.log(`${passed ? 'PASS' : 'FAIL'}: ${name}`);
  };

  if (mode === 'monsters') {
    window.Math.random = () => 0;
    const monsters = window.createForestMonsters();
    const mushrooms = monsters.filter((monster) => monster.type === 'mushroom');
    const slimes = monsters.filter((monster) => monster.type === 'slime');
    const elite = window.createEliteBoss('forest');
    check('normal mushrooms use the polish rule', mushrooms.length > 0 && mushrooms.every((monster) => monster.__gameplayPolishV2 === true));
    check('normal slimes use the polish rule', slimes.length > 0 && slimes.every((monster) => monster.__gameplayPolishV2 === true));
    check('elite slime is excluded from the polish rule', elite.__gameplayPolishV2 !== true);
  } else {
    const specialized = mode === 'specialized-death';
    window.__G.player = window.normalizePlayer({
      name:'Tester', class:'warrior', level:4, exp:100, gold:100,
      spec:specialized ? '무기' : null, hp:20, maxHp:20, map:'forest',
    });
    window.handlePlayerDefeat();
    check('death still loses half the gold', window.__G.player.gold === 50);
    check('death experience follows specialization rule', window.__G.player.exp === (specialized ? 90 : 100));
    const text = window.document.querySelector('.death-sub')?.textContent || '';
    check('death message matches experience rule', specialized
      ? text.includes('현재 레벨 EXP 진행도 절반 보호')
      : text.includes('전문화 전 EXP 보호'));
  }

  check('flow produced no async errors', asyncErrors.length === 0);
  const failures = checks.filter(([, passed]) => !passed).length;
  console.log(`RESULT: ${failures === 0 ? 'PASS' : 'FAIL'} ${checks.length - failures}/${checks.length}`);
  process.exit(failures === 0 ? 0 : 1);
}).catch((error) => {
  console.log(String(error?.stack || error));
  process.exit(1);
});
