const path = require('path');
const run = require('./harness');

const root = process.argv[2] || path.join(__dirname, '..', '..');

run(root, async ({ window, sleep, asyncErrors }) => {
  const game = window.__G;
  game.player = window.createNewPlayer('healing-training-smoke');
  game.player.quests.tut_equip = {
    id:'tut_equip',
    status:'completed',
    progress:1,
    target:1,
  };
  game.player.hp = game.player.maxHp;
  const hpBefore = game.player.hp;

  window.acceptCurrentQuest('tut_healing_well');
  const hpDuringImpact = game.player.hp;
  await sleep(720);

  const quest = game.player.quests.tut_healing_well;
  const passed = hpDuringImpact === hpBefore
    && game.player.hp === 1
    && quest?.status === 'accepted'
    && quest?.trainingApplied === true
    && asyncErrors.length === 0;

  console.log(`${passed ? 'PASS' : 'FAIL'}: healing training attack lands after its impact animation`);
  if (!passed) {
    console.log(JSON.stringify({
      hpBefore,
      hpDuringImpact,
      hpAfter:game.player.hp,
      quest,
      asyncErrors,
    }));
  }
  process.exit(passed ? 0 : 1);
}, {
  cloudConfigCode:"window.YUKSAM_CLOUD = { securityV2Enabled: false, url: '', anonKey: '' };",
}).catch((error) => {
  console.log(String(error?.stack || error));
  process.exit(1);
});
