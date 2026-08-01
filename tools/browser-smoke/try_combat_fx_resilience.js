const run = require(require('path').join(__dirname, 'harness.js'));
const root = process.argv[2];

let pass = 0;
let fail = 0;
function ok(name, condition, detail = '') {
  if (condition) {
    pass += 1;
    console.log(`PASS: ${name}${detail ? ` | ${detail}` : ''}`);
  } else {
    fail += 1;
    console.log(`FAIL: ${name}${detail ? ` | ${detail}` : ''}`);
  }
}

run(root, async ({ window, $, click, sleep, asyncErrors }) => {
  const G = () => window.__G;
  $('loginName').value = 'FX복원검증';
  $('loginPassword').value = '1234';
  click('studentLoginBtn'); await sleep(1300);
  click('createCharacterBtn'); await sleep(2600);
  window.enterForest(); await sleep(1600);
  const monster = G().forestMonsters.find((entry) => entry.alive !== false);
  G().player.x = monster.x;
  G().player.y = monster.y;
  await sleep(900);

  const nativeSetTimeout = window.setTimeout.bind(window);
  window.setTimeout = (fn, ms, ...args) => nativeSetTimeout(fn, Math.min(Number(ms) || 0, 20), ...args);
  const trace = [];
  window.onCombatSequenceEventV42 = (event) => trace.push(event.type);

  const originalPlay = window.YuksamCombatFx.playPlayerActionFx;
  let completed = false;
  window.YuksamCombatFx.playPlayerActionFx = () => { throw new Error('injected synchronous FX failure'); };
  window.queueCombatSequence([
    { type:'player-hit', text:'동기 실패 후에도 표시', duration:1, fx:{ source:'player', motion:'slash' } },
  ], () => { completed = true; });
  await sleep(80);
  ok('synchronous FX failure still renders the event', trace.includes('player-hit') && /동기 실패/.test($('modalContent').textContent));
  ok('synchronous FX failure releases the sequence lock', completed && G().combatSequenceActive === false);

  window.YuksamCombatFx.playPlayerActionFx = originalPlay;
  let staleImpacts = 0;
  const observer = new window.MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.classList?.contains('combat-fx-impact')) staleImpacts += 1;
      }
    }
  });
  observer.observe(window.document.body, { childList:true, subtree:true });
  window.queueCombatSequence([
    { type:'player-hit', text:'취소될 FX', duration:1, fx:{ source:'player', motion:'cast', mode:'projectile', projectile:'fire-projectile', impact:'fire-burst', tier:3, travelMs:200, lingerMs:600 } },
  ]);
  window.queueCombatSequence([{ type:'player-status', text:'새 큐', duration:1 }], () => {});
  await sleep(100);
  observer.disconnect();
  ok('replacing a queue cancels its pending impact', staleImpacts === 0, `impacts=${staleImpacts}`);

  const hpBeforeEffect = monster.hp;
  const damageEffectEvent = {
    type:'player-hit',
    text:'effect damage',
    duration:1,
    effect:{ id:'resilience-damage-1', type:'monster-damage', combatId:monster.id, amount:5 },
    fx:{ source:'player', motion:'cast', mode:'projectile', projectile:'fire-projectile', impact:'fire-burst', tier:2, travelMs:200, lingerMs:20 },
  };
  window.queueCombatSequence([damageEffectEvent]);
  window.queueCombatSequence([{ type:'player-status', text:'cancel damage', duration:1 }]);
  await sleep(50);
  window.queueCombatSequence([damageEffectEvent]);
  await sleep(80);
  window.queueCombatSequence([damageEffectEvent]);
  await sleep(80);
  ok('cancelled and replayed effects apply damage once', hpBeforeEffect - monster.hp === 5, `damage=${hpBeforeEffect - monster.hp}`);

  const applyImpact = async (id) => {
    window.queueCombatSequence([{
      type:'player-hit',
      text:'impact setup',
      duration:1,
      effect:{ id, type:'monster-damage', combatId:monster.id, amount:1 },
    }]);
    await sleep(5);
  };
  await applyImpact('impact-new-queue');
  const queuedImpact = G().combatImpact;
  window.queueCombatSequence([{ type:'player-status', text:'clear impact queue', duration:1 }]);
  await sleep(30);
  ok('new queues clear combat impact and cancel its expiry timer',
    !!queuedImpact && G().combatImpact === null,
    `before=${JSON.stringify(queuedImpact)}, after=${JSON.stringify(G().combatImpact)}`);

  await applyImpact('impact-invalidate');
  const invalidatingImpact = G().combatImpact;
  window.invalidateCombatSequenceV42();
  const invalidatedImpact = G().combatImpact;
  await applyImpact('impact-close');
  const closingImpact = G().combatImpact;
  G().modalState = { type:'combat', pause:true };
  window.closeModal();
  ok('invalidating and closing combat clear combat impact',
    !!invalidatingImpact && invalidatedImpact === null && !!closingImpact && G().combatImpact === null,
    `beforeInvalidate=${JSON.stringify(invalidatingImpact)}, invalidated=${JSON.stringify(invalidatedImpact)}, beforeClose=${JSON.stringify(closingImpact)}, closed=${JSON.stringify(G().combatImpact)}`);
  ok('resilience harness has no async errors', asyncErrors.length === 0, asyncErrors.join(' | '));

  console.log(`RESULT: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 && asyncErrors.length === 0 ? 0 : 1);
}).catch((error) => {
  console.log(String(error && error.stack || error));
  process.exit(1);
});
