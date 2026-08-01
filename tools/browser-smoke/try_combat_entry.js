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
  $('loginName').value = 'entry-smoke';
  $('loginPassword').value = '1234';
  click('studentLoginBtn'); await sleep(1200);
  click('createCharacterBtn'); await sleep(2600);
  $('game').classList.remove('active');
  const G = window.__G;

  function monster(id, alive = true) {
    return {
      id, name:'진입 테스트 버섯', type:'mushroom', level:2, alive,
      hp:20, maxHp:20, shield:9, chasing:false, stunTurns:4, chillTurns:3,
      dying:true, deathStartedAt:123, shadowStacks:5, escapeFailedThisCombat:true,
      combatFinished:true, x:500, y:500, r:28, ignorePlayerUntil:0,
    };
  }
  function resetSurface() {
    $('modal').classList.add('hidden');
    $('modalContent').innerHTML = '';
    G.modalState = { type:null, pause:false };
    G.currentCombatMonsterId = null;
    G.currentQuestion = { stale:true };
    G.currentCombatAction = 'stale-action';
    G.combatShield = 77;
    G.combatHpDisplay = null;
  }

  resetSurface();
  const valid = monster('entry-valid');
  G.forestMonsters = [valid];
  G.keys = { w:true, space:true };
  G.escapeFailedThisCombat = true;
  G.escapeResolving = true;
  G.player.combatStatuses = { chillTurns:2, poisonTurns:1 };
  G.playerAilments = { poisonTurns:9 };
  const validGeneration = Number(G.combatSequenceGeneration) || 0;
  window.openCombat(valid);
  check('valid entry invalidates the previous combat generation once', G.combatSequenceGeneration === validGeneration + 1, `before=${validGeneration}, after=${G.combatSequenceGeneration}`);
  check('valid entry clears movement and escape state', Object.keys(G.keys).length === 0 && G.escapeFailedThisCombat === false && G.escapeResolving === false);
  check('valid entry clears respawn residue before base initialization', valid.dying === false && valid.deathStartedAt === 0 && valid.shadowStacks === 0 && valid.combatFinished === false);
  check('valid entry owns combat identity and resets action state', G.currentCombatMonsterId === valid.id && G.currentQuestion === null && G.currentCombatAction === null && G.combatShield === 0);
  check('valid entry normalizes player and monster combat status', G.playerChillTurns === 2 && !('chillTurns' in G.player.combatStatuses) && valid.shield === 0 && valid.stunTurns === 0 && valid.chillTurns === 0);
  check('valid entry initializes HP display and combat modal', G.combatHpDisplay?.player >= 0 && G.combatHpDisplay?.monster === 100 && G.modalState.type === 'combat' && G.modalState.pause === true && !$('modal').classList.contains('hidden'));

  resetSurface();
  const paused = monster('entry-paused');
  G.forestMonsters = [paused];
  G.modalState = { type:'settings', pause:true };
  G.keys = { w:true };
  G.escapeFailedThisCombat = true;
  G.escapeResolving = true;
  const pausedGeneration = Number(G.combatSequenceGeneration) || 0;
  window.openCombat(paused);
  check('paused entry still invalidates prior sequence and cleans monster residue', G.combatSequenceGeneration === pausedGeneration + 1 && paused.dying === false && paused.shadowStacks === 0);
  check('paused entry short-circuits before keys, escape, identity, and modal changes', G.keys.w === true && G.escapeFailedThisCombat === true && G.escapeResolving === true && G.currentCombatMonsterId === null && G.modalState.type === 'settings');

  resetSurface();
  const dead = monster('entry-dead', false);
  G.forestMonsters = [dead];
  G.keys = { w:true };
  G.escapeFailedThisCombat = true;
  G.escapeResolving = true;
  const deadGeneration = Number(G.combatSequenceGeneration) || 0;
  window.openCombat(dead);
  check('invalid entry still invalidates the prior sequence', G.combatSequenceGeneration === deadGeneration + 1);
  check('invalid unpaused entry clears keys and escape state before base rejection', Object.keys(G.keys).length === 0 && G.escapeFailedThisCombat === false && G.escapeResolving === false);
  check('dead monster is rejected without opening combat', G.currentCombatMonsterId === null && G.modalState.type === null && $('modal').classList.contains('hidden'));

  await sleep(80);
  check('combat entry smoke has no async errors', asyncErrors.length === 0, asyncErrors.join(' | '));
  console.log(`RESULT: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 && asyncErrors.length === 0 ? 0 : 1);
}).catch((error) => {
  console.log(String(error?.stack || error));
  process.exit(1);
});
