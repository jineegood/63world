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
  $('loginName').value = '전투순서검증';
  $('loginPassword').value = '1234';
  click('studentLoginBtn'); await sleep(1300);
  click('createCharacterBtn'); await sleep(2600);
  window.enterForest(); await sleep(1600);
  const monster = G().forestMonsters.find((entry) => entry.alive !== false);
  G().player.x = monster.x;
  G().player.y = monster.y;
  await sleep(900);

  const nativeSetTimeout = window.setTimeout.bind(window);
  window.setTimeout = (fn, ms, ...args) => nativeSetTimeout(fn, Math.min(Number(ms) || 0, 12), ...args);
  window.Math.random = () => 0.99;
  monster.attack = 7;
  monster.level = 1;
  monster.elite = false;
  window.ensurePlayerHp();
  G().player.hp = G().player.maxHp;
  G().combatShield = 0;

  const trace = [];
  window.onCombatSequenceEventV42 = (event) => {
    trace.push({ type:event.type, text:event.text, effect:event.effect ? { ...event.effect } : null, fx:event.fx ? { ...event.fx } : null, audioId:event.audioId || null });
    if (event.type === 'answer-wrong') window.escapeCombat();
  };

  function submitWrong() {
    const old = $('combatAnswer');
    if (old) old.remove();
    const input = window.document.createElement('input');
    input.id = 'combatAnswer';
    input.value = 'wrong';
    window.document.body.appendChild(input);
    G().currentQuestion = { q:'sequence test', answer:'right' };
    G().currentCombatAction = 'attack';
    window.submitCombatAnswer();
  }

  async function waitForSequence() {
    for (let index = 0; index < 200; index += 1) {
      if (!G().combatSequenceActive && G().currentQuestion === null) return;
      await sleep(10);
    }
  }

  const firstHp = G().player.hp;
  submitWrong();
  await waitForSequence();
  const damageEvents = trace.filter((event) => event.type === 'player-damage');
  const loggedDamage = Number(damageEvents[0]?.text.match(/\d+/)?.[0] || 0);
  const actualDamage = firstHp - G().player.hp;
  ok(
    'wrong answer and its correction share the first event',
    trace[0]?.type === 'answer-wrong'
      && trace[0]?.text === '오답입니다! 정답은 right (오답이라 데미지가 절반만 들어갑니다)',
    JSON.stringify(trace)
  );
  ok('a wrong answer still damages the monster before its counterattack', trace.findIndex((event) => event.type === 'player-hit') > 0 && trace.findIndex((event) => event.type === 'player-hit') < trace.findIndex((event) => event.type === 'monster-action'), JSON.stringify(trace));
  ok('escape during an active sequence does not add damage', damageEvents.length === 1 && actualDamage === loggedDamage && G().escapeFailedThisCombat !== true && G().escapeResolving !== true, `damageEvents=${damageEvents.length}, actual=${actualDamage}, logged=${loggedDamage}, trace=${JSON.stringify(trace)}`);
  const windAction = trace.find((e) => e.type === 'monster-action');
  const landedDamage = trace.find((e) => e.type === 'player-damage' && e.effect);
  ok('projectile monsters wind up on their action and launch at the landed damage notice',
    windAction?.fx?.phase === 'wind-up' && windAction.fx.mode === 'wind-up' && !windAction.fx.projectile
      && landedDamage?.fx?.phase === 'impact' && landedDamage.fx.mode === 'projectile' && !!landedDamage.fx.projectile,
    JSON.stringify({ actionFx:windAction?.fx || null, damageFx:landedDamage?.fx || null }));

  trace.length = 0;
  window.ensurePlayerHp();
  G().player.hp = G().player.maxHp;
  G().playerAilments = { poisonTurns:1, poisonDmg:3 };
  submitWrong();
  await waitForSequence();
  const types = trace.map((event) => event.type);
  ok('poison is the final event', types.at(-1) === 'player-dot' && /중독/.test(trace.at(-1)?.text || ''), JSON.stringify(trace));
  ok('monster action precedes status damage and poison', types.indexOf('monster-action') > 0 && types.indexOf('player-damage') > types.indexOf('monster-action') && types.indexOf('player-dot') > types.indexOf('player-damage'), types.join(' > '));

  trace.length = 0;
  G().playerAilments = {};
  G().player.hp = G().player.maxHp;
  G().combatShield = 0;
  monster.type = 'slime';
  monster.name = '엘리트 슬라임';
  monster.elite = true;
  monster.attack = 7;
  monster.maxHp = 100;
  monster.hp = 100;
  monster.shield = 0;
  const hardeningRolls = [0.99, 0.99, 0.01];
  window.Math.random = () => hardeningRolls.shift() ?? 0.99;
  window.monsterCounterAttack('');
  await waitForSequence();
  const hardeningTechnique = trace.find((event) => event.type === 'monster-action' && /단단해지기/.test(event.text));
  const hardeningShield = trace.find((event) => event.type === 'player-status' && /보호막 23/.test(event.text));
  const hostileEvents = trace.filter((event) => event.type === 'player-damage' || /빗나갔다/.test(event.text));
  ok(
    'elite Hardening emits only its technique and shield events',
    !!hardeningTechnique
      && hardeningShield?.effect?.type === 'monster-shield'
      && hardeningShield.effect.amount === 23
      && monster.shield === 23
      && hostileEvents.length === 0,
    JSON.stringify({ trace, monsterShield:monster.shield }),
  );
  trace.length = 0;
  G().playerAilments = {};
  G().player.hp = G().player.maxHp;
  G().combatShield = 0;
  monster.type = 'mushroom';
  monster.name = '버섯돌이';
  monster.elite = false;
  monster.shield = 0;
  window.Math.random = () => 0.05;
  window.monsterCounterAttack('');
  await waitForSequence();
  const missEvent = trace.find((e) => /빗나갔다/.test(e.text || ''));
  const damagingImpact = trace.find((e) => e.type === 'player-damage' && e.effect);
  ok('missed monster hits play miss audio without a damaging projectile impact',
    !!missEvent && missEvent.audioId === 'miss' && !missEvent.fx && !missEvent.effect && !damagingImpact,
    JSON.stringify(trace));
  ok('async flow has no errors', asyncErrors.length === 0, asyncErrors.join(' | '));

  console.log(`RESULT: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 && asyncErrors.length === 0 ? 0 : 1);
}).catch((error) => {
  console.log(String(error && error.stack || error));
  process.exit(1);
});
