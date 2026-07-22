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
  $('loginName').value = 'hud-smoke';
  $('loginPassword').value = '1234';
  click('studentLoginBtn'); await sleep(1200);
  click('createCharacterBtn'); await sleep(2600);
  $('game').classList.remove('active');

  const G = window.__G;
  window.eval(`
    window.__hudTrace = { audio:0, quest:0 };
    const __hudOriginalAudio = syncAudioFileBgm;
    const __hudOriginalQuest = updateQuestTracker;
    syncAudioFileBgm = function(...args) { window.__hudTrace.audio += 1; return __hudOriginalAudio(...args); };
    updateQuestTracker = function(...args) { window.__hudTrace.quest += 1; return __hudOriginalQuest(...args); };
  `);

  G.currentMap = 'town';
  Object.assign(G.player, {
    class:'warrior', level:6, exp:23, hp:37, gold:321, building:9, spec:null,
    skills:{ legacy_skill:99 }, pets:null, activePet:'missing-pet', weaponUpgrades:null, equipment:null,
  });
  window.__hudTrace = { audio:0, quest:0 };
  let firstError = null;
  try { window.eval('updateHud()'); } catch (error) { firstError = error; }
  check('HUD update completes for partially legacy player data', !firstError, firstError && String(firstError));
  check('latest player fields are normalized before HUD rendering', Array.isArray(G.player.pets) && G.player.activePet === null && G.player.weaponUpgrades && G.player.equipment?.weapon);
  check('skill points are synchronized before HUD rendering', G.player.skillPoints === 10 && Object.keys(G.player.skills).length === 0, `points=${G.player.skillPoints}`);
  check('HUD text reflects the final player state', $('hudLevel').textContent === '6' && $('hudHp').textContent === String(G.player.hp) && $('hudGold').textContent === '321' && $('hudBuilding').textContent === '9');
  check('HUD bars use clamped percentages', /^\d+%$/.test($('hudHpFill').style.width) && /^\d+%$/.test($('hudExpFill').style.width), `hp=${$('hudHpFill').style.width}, exp=${$('hudExpFill').style.width}`);
  check('level six without specialization enables selection', $('chooseSpecBtn').disabled === false && $('chooseSpecBtn').textContent === '전문화');
  check('zone, audio, and quest updates run once', $('zoneBadge').textContent === window.YuksamData.worldDefs.town.label && window.__hudTrace.audio === 1 && window.__hudTrace.quest === 1,
    JSON.stringify(window.__hudTrace));

  G.player.spec = '방어';
  window.eval('updateHud()');
  check('chosen specialization disables the selection button', $('chooseSpecBtn').disabled === true && $('chooseSpecBtn').textContent === '전문화 완료');
  check('HUD settings button is unique after repeated updates', window.document.querySelectorAll('#hudSettingsBtnV23').length === 1);

  const savedPlayer = G.player;
  G.player = null;
  window.__hudTrace = { audio:0, quest:0 };
  let nullError = null;
  try { window.eval('updateHud()'); } catch (error) { nullError = error; }
  G.player = savedPlayer;
  check('HUD update tolerates a missing player', !nullError && window.__hudTrace.audio === 0 && window.__hudTrace.quest === 0, nullError && String(nullError));

  check('HUD smoke has no async errors', asyncErrors.length === 0, asyncErrors.join(' | '));
  console.log(`RESULT: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 && asyncErrors.length === 0 ? 0 : 1);
}).catch((error) => {
  console.log(String(error?.stack || error));
  process.exit(1);
});
