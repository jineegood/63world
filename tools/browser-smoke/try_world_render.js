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
  $('loginName').value = 'render-smoke';
  $('loginPassword').value = '1234';
  click('studentLoginBtn'); await sleep(1200);
  click('createCharacterBtn'); await sleep(2600);

  const G = window.__G;
  const worlds = window.YuksamData.worldDefs;
  $('game').classList.remove('active');
  window.eval(`
    window.__renderTrace = { player:0, nameplate:0, aura:0, speech:0 };
    const __renderOriginalPlayer = drawPlayerSprite;
    const __renderOriginalNameplate = drawPlayerNameplate;
    const __renderOriginalAura = drawLevelUpAura;
    const __renderOriginalSpeech = drawPlayerSpeechBubble;
    drawPlayerSprite = function(...args) { window.__renderTrace.player += 1; return __renderOriginalPlayer(...args); };
    drawPlayerNameplate = function(...args) { window.__renderTrace.nameplate += 1; return __renderOriginalNameplate(...args); };
    drawLevelUpAura = function(...args) { window.__renderTrace.aura += 1; return __renderOriginalAura(...args); };
    drawPlayerSpeechBubble = function(...args) { window.__renderTrace.speech += 1; return __renderOriginalSpeech(...args); };
  `);

  function drawMap(map) {
    const spawn = worlds[map]?.playerSpawn || { x:400, y:400 };
    G.currentMap = map;
    G.player.map = map;
    G.player.x = spawn.x;
    G.player.y = spawn.y;
    G.player.activePet = null;
    window.__renderTrace = { player:0, nameplate:0, aura:0, speech:0 };
    let error = null;
    try { window.eval('drawWorld()'); } catch (caught) { error = caught; }
    return { ...window.__renderTrace, error };
  }

  for (const map of ['town', 'forest', 'desert', 'swamp', 'bossRoom', 'equipmentShop', 'buildingShopInterior']) {
    const trace = drawMap(map);
    check(`${map} renders without error`, !trace.error, trace.error && String(trace.error));
    check(`${map} renders one player stack`, trace.player === 1 && trace.nameplate === 1 && trace.aura === 2 && trace.speech === 1,
      JSON.stringify(trace));
  }

  for (const map of ['petShopInterior', 'upgradeShopInterior']) {
    const trace = drawMap(map);
    check(`${map} renders without error`, !trace.error, trace.error && String(trace.error));
    check(`${map} renders shop actors once`, trace.player === 1 && trace.nameplate === 1 && trace.aura === 1 && trace.speech === 0,
      JSON.stringify(trace));
  }

  const finalTrace = drawMap('finalBossRoom');
  check('finalBossRoom renders without error', !finalTrace.error, finalTrace.error && String(finalTrace.error));
  check('finalBossRoom owns one player stack', finalTrace.player === 1 && finalTrace.nameplate === 1 && finalTrace.aura === 1 && finalTrace.speech === 0,
    JSON.stringify(finalTrace));

  const savedPlayer = G.player;
  G.currentMap = 'town';
  G.player = null;
  let nullError = null;
  try { window.eval('drawWorld()'); } catch (caught) { nullError = caught; }
  G.player = savedPlayer;
  check('base renderer tolerates a missing player', !nullError, nullError && String(nullError));

  check('world render smoke has no async errors', asyncErrors.length === 0, asyncErrors.join(' | '));
  console.log(`RESULT: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 && asyncErrors.length === 0 ? 0 : 1);
}).catch((error) => {
  console.log(String(error?.stack || error));
  process.exit(1);
});
