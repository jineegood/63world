const run = require(require('path').join(__dirname, 'harness.js'));
const root = process.argv[2];

let pass = 0;
let fail = 0;
function ok(name, condition, detail = '') {
  if (condition) pass += 1;
  else fail += 1;
  console.log(condition ? 'PASS:' : 'FAIL:', name, detail);
}

run(root, async ({ window, $, click, sleep, asyncErrors }) => {
  const G = () => window.__G;
  $('loginName').value = '상태시점검증';
  $('loginPassword').value = '1234';
  click('studentLoginBtn');
  await sleep(1300);
  click('createCharacterBtn');
  await sleep(2600);
  try { window.__tutorialDoneV53?.(); } catch {}
  window.enterForest();
  await sleep(1600);

  const monster = G().forestMonsters.find((entry) => entry.alive !== false);
  G().player.x = monster.x;
  G().player.y = monster.y;
  await sleep(900);

  const nativeSetTimeout = window.setTimeout.bind(window);
  const fastSetTimeout = (fn, ms, ...args) => nativeSetTimeout(fn, Math.min(Number(ms) || 0, 12), ...args);
  window.setTimeout = fastSetTimeout;
  G().player.skills = {};
  let projectileCreateCount = 0;
  const projectileObserver = new window.MutationObserver((records) => {
    for (const record of records) {
      projectileCreateCount += [...record.addedNodes]
        .filter((node) => node.classList?.contains('combat-fx-projectile')).length;
    }
  });
  projectileObserver.observe(window.document.body, { childList:true, subtree:true });

  async function waitForIdle(limit = 300) {
    for (let index = 0; index < limit; index += 1) {
      if (!G().combatSequenceActive) return true;
      await sleep(10);
    }
    return false;
  }

  async function waitForCondition(predicate, limit = 300) {
    for (let index = 0; index < limit; index += 1) {
      if (predicate()) return true;
      await sleep(10);
    }
    return false;
  }

  function resetCombatState(type, attack = 8) {
    monster.type = type;
    monster.attack = attack;
    monster.maxHp = Math.max(200, monster.maxHp || 0);
    monster.hp = monster.maxHp;
    monster.shield = 0;
    monster.alive = true;
    monster.dying = false;
    monster.elite = false;
    monster.boss = false;
    monster.shadowStacks = 0;
    monster.stunTurns = 0;
    monster.chillTurns = 0;
    G().player.hp = G().player.maxHp;
    G().combatShield = 0;
    G().playerAilments = {};
    G().currentQuestion = null;
    G().currentCombatAction = null;
  }

  function useRandomSequence(values, fallback = 0.99) {
    const sequence = values.slice();
    window.Math.random = () => sequence.length ? sequence.shift() : fallback;
  }

  function traceState(target) {
    return (event) => target.push({
      type:event.type,
      text:event.text,
      duration:event.duration,
      playerHp:G().player.hp,
      combatShield:G().combatShield,
      monsterHp:monster.hp,
      monsterShield:monster.shield || 0,
      monsterShadowStacks:monster.shadowStacks || 0,
      monsterStunTurns:monster.stunTurns || 0,
      monsterChillTurns:monster.chillTurns || 0,
      poisonTurns:G().playerAilments?.poisonTurns || 0,
      stunTurns:G().playerAilments?.stunTurns || 0,
      playerChillTurns:G().playerChillTurns || 0,
      chargeActive:G().chargeActive === true,
      consumeCharge:event.effect?.consumeCharge === true,
      effectAmount:event.effect?.amount,
      effectHeal:event.effect?.heal,
      critical:event.effect?.critical === true,
      hasHeal:Object.hasOwn(event.effect || {}, 'heal'),
      audioId:event.audioId,
      fx:event.fx ? {
        source:event.fx.source,
        target:event.fx.target,
        phase:event.fx.phase,
        mode:event.fx.mode,
        motion:event.fx.motion,
        impact:event.fx.impact,
        projectile:event.fx.projectile,
      } : null,
      projectileCreateCount,
      projectileCount:window.document.querySelectorAll('.combat-fx-projectile').length,
      impactCount:window.document.querySelectorAll('.combat-fx-impact').length,
      floatingNumbers:[...window.document.querySelectorAll('.combat-floating-damage')].map((number) => ({
        text:number.textContent,
        className:number.className,
      })),
      renderedText:$('modalContent')?.textContent || '',
      at:Date.now(),
    });
  }

  async function observeMonsterProjectileLifecycle({ cancelAtLaunch = false } = {}) {
    resetCombatState('mushroom', 4);
    const hpBefore = G().player.hp;
    const shieldBefore = G().combatShield;
    let flight = null;
    let landing = null;
    const observer = new window.MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!flight && node.classList?.contains('combat-fx-projectile')) {
            flight = {
              hp:G().player.hp,
              shield:G().combatShield,
              text:$('modalContent')?.textContent || '',
              connected:node.isConnected,
            };
          }
          if (!landing && node.classList?.contains('combat-fx-impact')) {
            landing = {
              hp:G().player.hp,
              text:$('modalContent')?.textContent || '',
              connected:node.isConnected,
            };
          }
        }
      }
    });
    observer.observe(window.document.body, { childList:true, subtree:true });
    const originalMonsterFx = window.YuksamCombatFx.playMonsterActionFx;
    window.YuksamCombatFx.playMonsterActionFx = (profile, onImpact) => {
      const result = originalMonsterFx(profile, onImpact);
      if (cancelAtLaunch && profile?.phase === 'impact') window.invalidateCombatSequenceV42();
      return result;
    };
    const trace = [];
    window.onCombatSequenceEventV42 = traceState(trace);
    useRandomSequence([0.1, 0.99]);
    window.monsterCounterAttack('');
    await waitForCondition(() => cancelAtLaunch ? !!flight : !!flight && !!landing);
    await waitForIdle();
    window.YuksamCombatFx.playMonsterActionFx = originalMonsterFx;
    observer.disconnect();
    return { hpBefore, shieldBefore, flight, landing, trace, hpAfter:G().player.hp };
  }

  const observedProjectile = await observeMonsterProjectileLifecycle();
  ok('monster projectile flight preserves the action frame until its landed impact renders damage',
    observedProjectile.flight?.connected === true
      && observedProjectile.flight.hp === observedProjectile.hpBefore
      && observedProjectile.flight.shield === observedProjectile.shieldBefore
      && observedProjectile.landing?.connected === true
      && observedProjectile.landing.hp < observedProjectile.hpBefore
      && /피해를 받았다/.test(observedProjectile.landing.text),
    JSON.stringify(observedProjectile));

  resetCombatState('mushroom', 4);
  const poisonTrace = [];
  window.onCombatSequenceEventV42 = traceState(poisonTrace);
  useRandomSequence([0.1, 0.99]);
  window.monsterCounterAttack('');
  await waitForIdle();
  const poisonAction = poisonTrace.find((event) => event.type === 'monster-action');
  const poisonDamage = poisonTrace.find((event) => event.type === 'player-damage');
  const poisonStatus = poisonTrace.find((event) => event.type === 'player-status');
  ok('projectile monsters wind up on their action and launch at the landed damage notice',
    poisonAction?.fx?.phase === 'wind-up'
      && poisonAction.fx?.projectile === undefined
      && poisonDamage?.fx?.phase === 'impact'
      && poisonDamage.fx?.mode === 'projectile'
      && poisonDamage.fx?.projectile === 'poison-projectile'
      && poisonDamage.projectileCreateCount > poisonAction.projectileCreateCount
      && poisonDamage.impactCount === 1
      && poisonDamage.playerHp === G().player.maxHp - poisonDamage.effectAmount,
    JSON.stringify(poisonTrace));

  resetCombatState('mushroom', 4);
  const missTrace = [];
  window.onCombatSequenceEventV42 = traceState(missTrace);
  useRandomSequence([0.1, 0.01]);
  window.monsterCounterAttack('');
  await waitForIdle();
  const missDamage = missTrace.find((event) => event.type === 'player-damage');
  ok('missed monster hits play miss audio without a damaging projectile impact',
    missDamage?.audioId === 'miss'
      && missDamage.fx === null
      && missDamage.projectileCount === 0
      && missDamage.impactCount === 0,
    JSON.stringify(missTrace));

  resetCombatState('slime', 4);
  const shieldTrace = [];
  window.onCombatSequenceEventV42 = traceState(shieldTrace);
  useRandomSequence([0.1, 0.99]);
  window.monsterCounterAttack('');
  await waitForIdle();
  const shieldAction = shieldTrace.find((event) => event.type === 'monster-action');
  const shieldStatus = shieldTrace.find((event) => event.type === 'player-status');
  ok('monster status and shield wait for their status notices',
    poisonAction?.poisonTurns === 0
      && poisonStatus?.poisonTurns > 0
      && shieldAction?.monsterShield === 0
      && shieldStatus?.monsterShield > 0
      && !shieldTrace.some((event) => event.type === 'player-damage'),
    `poison=${JSON.stringify(poisonTrace)}, shield=${JSON.stringify(shieldTrace)}`);

  resetCombatState('tarantula', 10);
  G().player.hp = 50;
  G().combatShield = 5;
  G().player.skills.priest_basic_prayer = 3;
  G().playerAilments = { poisonTurns:1, poisonDmg:3 };
  monster.shadowStacks = 2;
  const multiTrace = [];
  window.onCombatSequenceEventV42 = traceState(multiTrace);
  useRandomSequence([0.1, 0.99]);
  window.monsterCounterAttack('');
  await waitForIdle();
  const multiAction = multiTrace.find((event) => event.type === 'monster-action');
  const damageEvents = multiTrace.filter((event) => event.type === 'player-damage');
  const retaliation = multiTrace.find((event) => event.type === 'retaliation');
  const dotEvents = multiTrace.filter((event) => event.type === 'player-dot');
  ok('monster multi-hit applies each hit in sequence',
    multiAction?.playerHp === 50
      && multiAction?.combatShield === 5
      && damageEvents.length === 2
      && damageEvents[0].playerHp > damageEvents[1].playerHp
      && damageEvents[0].combatShield === 0
      && retaliation?.playerHp > damageEvents[1].playerHp
      && dotEvents.length === 2
      && dotEvents[0].monsterHp < retaliation.monsterHp
      && dotEvents[1].playerHp < retaliation.playerHp,
    JSON.stringify(multiTrace));
  ok('damage logs render the already-reduced player HP in the same frame',
    damageEvents.length === 2
      && damageEvents.every((event) => event.renderedText.includes(`HP ${event.playerHp}/`)),
    JSON.stringify(damageEvents));

  async function resolveWeaponMasteryCounter({ rank = 5, shield = 0, hp = G().player.maxHp, random }) {
    resetCombatState('slime', 10);
    G().player.class = 'warrior';
    G().player.spec = '무기';
    G().player.skills = { warrior_weapon_mastery:rank };
    G().player.hp = hp;
    G().combatShield = shield;
    const trace = [];
    window.onCombatSequenceEventV42 = traceState(trace);
    useRandomSequence(random);
    window.monsterCounterAttack('');
    await waitForIdle();
    return trace;
  }

  const masteryShieldTrace = await resolveWeaponMasteryCounter({
    shield:100,
    random:[0.99, 0.99, 0.01],
  });
  const masteryShieldDamage = masteryShieldTrace.find((event) => event.type === 'player-damage');
  const masteryShieldRetaliation = masteryShieldTrace.find((event) => event.type === 'retaliation');
  ok('Weapon Mastery reflects the pre-shield critical damage after the enemy damage log',
    masteryShieldDamage?.combatShield === 82
      && masteryShieldRetaliation?.effectAmount === 9
      && masteryShieldRetaliation?.monsterHp === 191
      && masteryShieldTrace.findIndex((event) => event.type === 'monster-action')
        < masteryShieldTrace.findIndex((event) => event.type === 'player-damage')
      && masteryShieldTrace.findIndex((event) => event.type === 'player-damage')
        < masteryShieldTrace.findIndex((event) => event.type === 'retaliation'),
    JSON.stringify(masteryShieldTrace));

  const masteryRankReflections = [];
  for (const [rank, expected] of [[1, 1], [2, 3], [3, 5], [4, 7]]) {
    const trace = await resolveWeaponMasteryCounter({
      rank,
      shield:100,
      random:[0.99, 0.99, 0.01],
    });
    masteryRankReflections.push({
      rank,
      amount:trace.find((event) => event.type === 'retaliation')?.effectAmount,
      expected,
    });
  }
  ok('Weapon Mastery ranks 1 through 4 floor the fractional critical reflection schedule',
    masteryRankReflections.every(({ amount, expected }) => amount === expected),
    JSON.stringify(masteryRankReflections));

  const masteryNoHealTrace = await resolveWeaponMasteryCounter({
    random:[0.99, 0.99, 0.01],
  });
  const masteryNoHealDamage = masteryNoHealTrace.find((event) => event.type === 'player-damage');
  const masteryNoHealRetaliation = masteryNoHealTrace.find((event) => event.type === 'retaliation');
  ok('Weapon Mastery retaliation omits healing without changing player HP or producing NaN',
    masteryNoHealRetaliation?.hasHeal === false
      && masteryNoHealRetaliation?.playerHp === masteryNoHealDamage?.playerHp
      && Number.isFinite(masteryNoHealRetaliation?.playerHp)
      && Number.isFinite(G().player.hp),
    JSON.stringify(masteryNoHealTrace));

  const masteryMissTrace = await resolveWeaponMasteryCounter({ random:[0.99, 0.01] });
  const masteryNormalTrace = await resolveWeaponMasteryCounter({ random:[0.99, 0.99, 0.99] });
  const masteryFatalTrace = await resolveWeaponMasteryCounter({ hp:1, random:[0.99, 0.99, 0.01] });
  ok('Weapon Mastery does not reflect misses, non-critical hits, or fatal critical hits',
    !masteryMissTrace.some((event) => event.type === 'retaliation')
      && !masteryNormalTrace.some((event) => event.type === 'retaliation')
      && masteryFatalTrace.some((event) => event.type === 'player-damage' && event.playerHp === 0)
      && !masteryFatalTrace.some((event) => event.type === 'retaliation'),
    `miss=${JSON.stringify(masteryMissTrace)}, normal=${JSON.stringify(masteryNormalTrace)}, fatal=${JSON.stringify(masteryFatalTrace)}`);

  async function resolvePrayerBarrierCounter({ hp, shield }) {
    resetCombatState('slime', 10);
    G().player.class = 'priest';
    G().player.spec = '신성';
    G().player.skills = { priest_basic_prayer:3, priest_holy_grace_v24:3 };
    G().player.hp = hp;
    G().combatShield = shield;
    const trace = [];
    window.onCombatSequenceEventV42 = traceState(trace);
    useRandomSequence([0.99, 0.99]);
    window.monsterCounterAttack('');
    await waitForIdle();
    return trace;
  }

  const playedPrayerBarrierAudio = [];
  const originalPlayMappedAudio = window.playMappedAudio;
  window.playMappedAudio = (audioId, options) => {
    if (audioId === 'prayerBarrier') playedPrayerBarrierAudio.push(audioId);
    return originalPlayMappedAudio(audioId, options);
  };
  const nearFullPrayerTrace = await resolvePrayerBarrierCounter({
    hp:G().player.maxHp - 1,
    shield:100,
  });
  const injuredPrayerTrace = await resolvePrayerBarrierCounter({
    hp:G().player.maxHp - 10,
    shield:100,
  });
  window.playMappedAudio = originalPlayMappedAudio;
  const nearFullPrayerRetaliation = nearFullPrayerTrace.find((event) => event.type === 'retaliation');
  const injuredPrayerRetaliation = injuredPrayerTrace.find((event) => event.type === 'retaliation');
  ok('Prayer Barrier twice plays its mapped sound and reports actual reflected damage and clamped Holy healing',
    playedPrayerBarrierAudio.length === 2
      && nearFullPrayerRetaliation?.audioId === 'prayerBarrier'
      && injuredPrayerRetaliation?.audioId === 'prayerBarrier'
      && nearFullPrayerRetaliation?.effectAmount === 1
      && nearFullPrayerRetaliation?.effectHeal === 1
      && injuredPrayerRetaliation?.effectAmount === 1
      && injuredPrayerRetaliation?.effectHeal === 3
      && nearFullPrayerRetaliation?.floatingNumbers.some((number) => number.text === '-1' && /monster damage/.test(number.className))
      && nearFullPrayerRetaliation?.floatingNumbers.some((number) => number.text === '+1' && /player heal/.test(number.className))
      && injuredPrayerRetaliation?.floatingNumbers.some((number) => number.text === '-1' && /monster damage/.test(number.className))
      && injuredPrayerRetaliation?.floatingNumbers.some((number) => number.text === '+3' && /player heal/.test(number.className))
      && /반사 피해 1/.test(nearFullPrayerRetaliation?.text || '')
      && /실제 회복 1/.test(nearFullPrayerRetaliation?.text || '')
      && /반사 피해 1/.test(injuredPrayerRetaliation?.text || '')
      && /실제 회복 3/.test(injuredPrayerRetaliation?.text || ''),
    `nearFull=${JSON.stringify(nearFullPrayerTrace)}, injured=${JSON.stringify(injuredPrayerTrace)}, audio=${JSON.stringify(playedPrayerBarrierAudio)}`);

  resetCombatState('slime', 4);
  window.setTimeout = nativeSetTimeout;
  const correctTrace = [];
  window.onCombatSequenceEventV42 = (event) => {
    correctTrace.push({
      type:event.type,
      duration:event.duration,
      at:Date.now(),
      text:$('modalContent')?.textContent || '',
      liveFx:window.document.querySelectorAll('.combat-fx-node').length,
    });
    if (event.type === 'player-hit') {
      nativeSetTimeout(() => window.queueCombatSequence([
        { type:'player-status', text:'correct timing complete', duration:1 },
      ]), 0);
    }
  };
  const oldAnswer = $('combatAnswer');
  if (oldAnswer) oldAnswer.remove();
  const answerInput = window.document.createElement('input');
  answerInput.id = 'combatAnswer';
  answerInput.value = 'right';
  window.document.body.appendChild(answerInput);
  G().currentQuestion = { q:'timing', answer:'right' };
  G().currentCombatAction = 'attack';
  useRandomSequence([0.99, 0.99]);
  window.submitCombatAnswer();
  await waitForIdle(500);
  const correctEvent = correctTrace.find((event) => event.type === 'answer-correct');
  const hitEvent = correctTrace.find((event) => event.type === 'player-hit');
  ok('correct answer remains visible before the basic attack log',
    correctEvent?.duration === 800
      && hitEvent?.duration === 1000
      && hitEvent.at - correctEvent.at >= 750
      && /정답!/.test(correctEvent.text),
    JSON.stringify(correctTrace));
  async function resolveShieldChargePresentation() {
    resetCombatState('slime', 1);
    G().player.class = 'warrior';
    G().player.spec = '?諛⑹뼱';
    G().player.skills = { warrior_def_wall:1 };
    G().player.skillCooldowns = {};
    const trace = [];
    window.onCombatSequenceEventV42 = traceState(trace);
    answerInput.value = 'right';
    G().currentQuestion = { q:'shield charge presentation', answer:'right' };
    G().currentCombatAction = 'active:warrior_def_wall';
    useRandomSequence([.99, .99]);
    window.submitCombatAnswer();
    await waitForIdle(500);
    return trace;
  }

  const shieldChargeTrace = await resolveShieldChargePresentation();
  const shieldChargeSupport = shieldChargeTrace.find((event) => event.type === 'player-support-before');
  const shieldChargeHit = shieldChargeTrace.find((event) => event.type === 'player-hit');
  ok('Shield Charge presents a defensive shield wave before its charge hit',
    shieldChargeTrace.findIndex((event) => event.type === 'answer-correct')
      < shieldChargeTrace.findIndex((event) => event.type === 'player-support-before')
      && shieldChargeTrace.findIndex((event) => event.type === 'player-support-before')
        < shieldChargeTrace.findIndex((event) => event.type === 'player-hit')
      && shieldChargeSupport?.audioId === 'defensiveStance'
      && shieldChargeSupport?.fx?.mode === 'wave'
      && shieldChargeSupport?.fx?.target === 'player'
      && shieldChargeSupport?.fx?.impact === 'shield-wave'
      && shieldChargeSupport.combatShield > 0
      && shieldChargeHit?.audioId === 'shieldCharge'
      && shieldChargeHit?.fx?.motion === 'shield-charge',
    JSON.stringify(shieldChargeTrace));

  resetCombatState('slime', 4);
  monster.elite = true;
  const hardeningTrace = [];
  window.onCombatSequenceEventV42 = traceState(hardeningTrace);
  useRandomSequence([.99, .99, .01]);
  window.monsterCounterAttack('');
  await waitForIdle(500);
  const hardeningAction = hardeningTrace.find((event) => event.type === 'monster-action');
  const hardeningShield = hardeningTrace.find((event) => event.type === 'player-status');
  ok('Elite Hardening presents a monster shield wave without an attack projectile',
    hardeningAction?.audioId == null
      && hardeningShield?.audioId === 'defensiveStance'
      && hardeningAction?.fx?.mode === 'wave'
      && hardeningAction?.fx?.target === 'monster'
      && hardeningAction?.fx?.motion === 'self-shield'
      && hardeningAction?.fx?.impact === 'shield-wave'
      && hardeningAction?.fx?.projectile == null
      && hardeningShield?.monsterShield > 0
      && !hardeningTrace.some((event) => event.type === 'player-damage'),
    JSON.stringify(hardeningTrace));

  async function resolveShieldedPlayerAction(action, skills) {
    resetCombatState('slime', 1);
    G().player.class = 'warrior';
    G().player.skills = { ...skills };
    G().player.skillCooldowns = {};
    monster.shield = 1000;
    const hpBefore = monster.hp;
    const shieldBefore = monster.shield;
    answerInput.value = 'right';
    G().currentQuestion = { q:'shield bypass', answer:'right' };
    G().currentCombatAction = action;
    useRandomSequence([0.99, 0.99, 0.99]);
    window.submitCombatAnswer();
    await waitForIdle(500);
    return { hpBefore, shieldBefore, hpAfter:monster.hp, shieldAfter:monster.shield };
  }

  window.setTimeout = fastSetTimeout;
  const strikeAgainstShield = await resolveShieldedPlayerAction(
    'active:warrior_basic_strike',
    { warrior_basic_strike:1 },
  );
  const normalAttackAgainstShield = await resolveShieldedPlayerAction('attack', {});
  ok('Warrior Basic Strike bypasses shields while a normal attack is absorbed',
    strikeAgainstShield.hpAfter < strikeAgainstShield.hpBefore
      && strikeAgainstShield.shieldAfter === strikeAgainstShield.shieldBefore
      && normalAttackAgainstShield.hpAfter === normalAttackAgainstShield.hpBefore
      && normalAttackAgainstShield.shieldAfter < normalAttackAgainstShield.shieldBefore,
    `strike=${JSON.stringify(strikeAgainstShield)}, normal=${JSON.stringify(normalAttackAgainstShield)}`);

  resetCombatState('slime', 1);
  G().chargeActive = false;
  G().player.class = 'warrior';
  G().player.spec = '무기';
  G().player.skills = { warrior_weapon_judgment:1 };
  G().player.skillCooldowns = {};
  const chargeTrace = [];
  window.onCombatSequenceEventV42 = traceState(chargeTrace);
  answerInput.value = 'right';
  G().currentQuestion = { q:'charge timing', answer:'right' };
  G().currentCombatAction = 'active:warrior_weapon_judgment';
  useRandomSequence([0.99, 0.99]);
  window.submitCombatAnswer();
  await waitForIdle(500);
  const chargeAnswer = chargeTrace.find((event) => event.type === 'answer-correct');
  const chargeNotice = chargeTrace.find((event) => event.text === '최후의 심판! 힘을 모읍니다... 다음 공격이 폭발한다!');
  ok('Final Judgment answer and charge notices use their dedicated timings',
    chargeAnswer?.duration === 800
      && chargeNotice?.duration === 2100
      && chargeNotice?.chargeActive === true
      && G().chargeActive === true,
    JSON.stringify(chargeTrace));

  resetCombatState('slime', 1);
  G().player.skills = { warrior_weapon_breaker:1 };
  const releaseTrace = [];
  window.onCombatSequenceEventV42 = traceState(releaseTrace);
  answerInput.value = 'right';
  G().currentQuestion = { q:'charge release timing', answer:'right' };
  G().currentCombatAction = 'attack';
  useRandomSequence([0.99, 0.99, 0.99, 0.99]);
  window.submitCombatAnswer();
  await waitForIdle(500);
  const releaseAnswer = releaseTrace.find((event) => event.type === 'answer-correct');
  const releaseHits = releaseTrace.filter((event) => event.type === 'player-hit' || event.type === 'player-extra-hit');
  ok('charged multi-hit release times each hit and consumes charge on the first applied damage only',
    releaseAnswer?.duration === 800
      && releaseAnswer?.chargeActive === true
      && releaseHits.length === 2
      && releaseHits.every((event) => event.duration === 1500)
      && releaseHits[0].consumeCharge === true
      && releaseHits[0].chargeActive === false
      && releaseHits[1].consumeCharge === false
      && releaseHits[1].chargeActive === false
      && !releaseTrace.some((event) => /모아둔 힘을 모두 사용했다\./.test(event.text || ''))
      && G().chargeActive === false,
    JSON.stringify(releaseTrace));

  resetCombatState('slime', 1);
  G().chargeActive = true;
  G().player.skills = { warrior_weapon_breaker:1 };
  const missedFirstReleaseTrace = [];
  window.onCombatSequenceEventV42 = traceState(missedFirstReleaseTrace);
  answerInput.value = 'right';
  G().currentQuestion = { q:'missed first charged hit', answer:'right' };
  G().currentCombatAction = 'attack';
  useRandomSequence([0.99, 0.01, 0.99, 0.99]);
  window.submitCombatAnswer();
  await waitForIdle(500);
  const missedFirstReleaseHits = missedFirstReleaseTrace.filter(
    (event) => event.type === 'player-hit' || event.type === 'player-extra-hit',
  );
  ok('charged multi-hit miss preserves charge until the second hit lands',
    missedFirstReleaseHits.length === 2
      && missedFirstReleaseHits.every((event) => event.duration === 1500)
      && missedFirstReleaseHits[0].consumeCharge === false
      && missedFirstReleaseHits[0].chargeActive === true
      && missedFirstReleaseHits[1].consumeCharge === true
      && missedFirstReleaseHits[1].chargeActive === false
      && G().chargeActive === false,
    JSON.stringify(missedFirstReleaseTrace));

  resetCombatState('slime', 4);
  const floatingState = {};
  window.onCombatSequenceEventV42 = (event) => {
    if (event.type !== 'player-hit') return;
    const floating = window.document.querySelector('.combat-floating-damage');
    floatingState.parentIsStage = floating?.parentElement?.classList.contains('combat-stage') || false;
    window.queueCombatSequence([{ type:'player-status', text:'replacement queue', duration:1 }]);
    floatingState.clearedOnReplacement = window.document.querySelectorAll('.combat-floating-damage').length === 0;
  };
  window.queueCombatSequence([{
    type:'player-hit',
    text:'floating damage timing',
    duration:1,
    effect:{ id:'floating-damage-test', type:'monster-damage', combatId:monster.id, amount:1 },
  }]);
  await waitForIdle(500);
  ok('floating damage stays in the combat stage and clears on queue replacement',
    floatingState.parentIsStage === true && floatingState.clearedOnReplacement === true,
    JSON.stringify(floatingState));

  async function observePositiveFloatingNumber(type, effect) {
    let observed = null;
    window.onCombatSequenceEventV42 = (event) => {
      if (event.effect?.id !== effect.id) return;
      const numbers = [...window.document.querySelectorAll('.combat-floating-damage')];
      observed = numbers.at(-1)
        ? { text:numbers.at(-1).textContent, className:numbers.at(-1).className }
        : null;
    };
    window.queueCombatSequence([{ type, text:`${type} feedback`, duration:1, effect }]);
    await waitForIdle(500);
    await sleep(20);
    return observed;
  }

  resetCombatState('slime', 4);
  G().player.hp = G().player.maxHp - 7;
  const playerHealFloating = await observePositiveFloatingNumber('player-support', {
    id:'floating-player-heal', type:'player-support', combatId:monster.id, kind:'heal', amount:30,
  });
  G().combatShield = 3;
  const playerShieldFloating = await observePositiveFloatingNumber('player-support', {
    id:'floating-player-shield', type:'player-support', combatId:monster.id, kind:'shield', amount:5,
  });
  monster.hp = monster.maxHp - 9;
  const monsterHealFloating = await observePositiveFloatingNumber('enemy-status', {
    id:'floating-monster-heal', type:'monster-heal', combatId:monster.id, amount:30,
  });
  monster.shield = 2;
  const monsterShieldFloating = await observePositiveFloatingNumber('enemy-status', {
    id:'floating-monster-shield', type:'monster-shield', combatId:monster.id, amount:5,
  });
  ok('player and monster heal/shield effects use their actual positive deltas',
    G().player.hp === G().player.maxHp
      && G().combatShield === 8
      && monster.hp === monster.maxHp
      && monster.shield === 7
      && playerHealFloating?.text === '+7' && / heal/.test(playerHealFloating.className)
      && playerShieldFloating?.text === '+5' && / shield/.test(playerShieldFloating.className)
      && monsterHealFloating?.text === '+9' && / heal/.test(monsterHealFloating.className)
      && monsterShieldFloating?.text === '+5' && / shield/.test(monsterShieldFloating.className),
    JSON.stringify({ playerHealFloating, playerShieldFloating, monsterHealFloating, monsterShieldFloating }));

  const zeroPlayerHeal = await observePositiveFloatingNumber('player-support', {
    id:'floating-zero-player-heal', type:'player-support', combatId:monster.id, kind:'heal', amount:30,
  });
  const zeroMonsterHeal = await observePositiveFloatingNumber('enemy-status', {
    id:'floating-zero-monster-heal', type:'monster-heal', combatId:monster.id, amount:30,
  });
  ok('clamped healing creates no zero floating number',
    zeroPlayerHeal === null && zeroMonsterHeal === null,
    JSON.stringify({ zeroPlayerHeal, zeroMonsterHeal }));

  resetCombatState('tarantula', 10);
  window.setTimeout = fastSetTimeout;
  G().player.hp = 50;
  const cancelledTrace = [];
  let hpAfterFirstHit = null;
  window.onCombatSequenceEventV42 = (event) => {
    cancelledTrace.push(event.type);
    if (event.type === 'player-damage' && hpAfterFirstHit == null) {
      hpAfterFirstHit = G().player.hp;
      window.setTimeout(() => window.queueCombatSequence([
        { type:'player-status', text:'cancel second hit', duration:1 },
      ]), 0);
    }
  };
  useRandomSequence([0.1, 0.99]);
  window.monsterCounterAttack('');
  await waitForIdle();
  await sleep(40);
  ok('replacing the multi-hit queue cancels the second hit',
    cancelledTrace.filter((type) => type === 'player-damage').length === 1
      && G().player.hp === hpAfterFirstHit,
    `hp=${G().player.hp}, first=${hpAfterFirstHit}, trace=${cancelledTrace.join(' > ')}`);

  async function resolveSkillStatus(className, spec, skillId, skills) {
    resetCombatState('slime', 1);
    G().player.class = className;
    G().player.spec = spec;
    G().player.skills = { ...skills };
    G().player.skillCooldowns = {};
    const trace = [];
    window.onCombatSequenceEventV42 = traceState(trace);
    const input = $('combatAnswer') || window.document.createElement('input');
    input.id = 'combatAnswer';
    if (!input.isConnected) window.document.body.appendChild(input);
    input.value = 'right';
    G().currentQuestion = { q:'skill timing', answer:'right' };
    G().currentCombatAction = `active:${skillId}`;
    useRandomSequence([0.99, 0.99, 0.99]);
    window.submitCombatAnswer();
    await waitForIdle(500);
    return trace;
  }

  const stunTrace = await resolveSkillStatus('warrior', '무기', 'warrior_weapon_slash', { warrior_weapon_slash:1 });
  const chillTrace = await resolveSkillStatus('mage', '냉기', 'mage_frost_lance_v24', { mage_frost_lance_v24:1 });
  const shadowTrace = await resolveSkillStatus('priest', '암흑', 'priest_shadow_seed_v24', { priest_shadow_seed_v24:1 });
  const stunHit = stunTrace.find((event) => event.type === 'player-hit');
  const stunStatus = stunTrace.find((event) => event.type === 'enemy-status');
  const chillHit = chillTrace.find((event) => event.type === 'player-hit');
  const chillStatuses = chillTrace.filter((event) => event.type === 'enemy-status');
  const shadowHit = shadowTrace.find((event) => event.type === 'player-hit');
  const shadowStatuses = shadowTrace.filter((event) => event.type === 'enemy-status');
  ok('player skill monster statuses wait for their enemy status notices',
    stunHit?.monsterStunTurns === 0
      && stunStatus?.monsterStunTurns === 1
      && chillHit?.monsterChillTurns === 0
      && chillStatuses.map((event) => event.monsterChillTurns).join(',') === '2'
      && shadowHit?.monsterShadowStacks === 0
      && shadowStatuses.map((event) => event.monsterShadowStacks).join(',') === '4',
    `stun=${JSON.stringify(stunTrace)}, chill=${JSON.stringify(chillTrace)}, shadow=${JSON.stringify(shadowTrace)}`);

  const meteorTrace = await resolveSkillStatus('mage', '화염', 'mage_fire_meteor_v24', { mage_fire_meteor_v24:1 });
  const meteorHits = meteorTrace.filter((event) => event.type === 'player-hit' || event.type === 'player-extra-hit');
  ok('Meteor replays its animation and meteor audio on every one of its four hits',
    meteorHits.length === 4
      && meteorHits.every((event) => event.audioId === 'meteor')
      && meteorHits.every((event) => event.fx?.mode === 'projectile' && event.fx?.projectile === 'fire-projectile'),
    JSON.stringify(meteorTrace));

  async function resolveCriticalAction({ className, spec, action, skills, random }) {
    resetCombatState('slime', 1);
    G().player.class = className;
    G().player.spec = spec;
    G().player.skills = { ...skills };
    G().player.skillCooldowns = {};
    const trace = [];
    window.onCombatSequenceEventV42 = traceState(trace);
    answerInput.value = 'right';
    G().currentQuestion = { q:'critical rules', answer:'right' };
    G().currentCombatAction = action;
    useRandomSequence(random);
    window.submitCombatAnswer();
    await waitForIdle(500);
    return trace.filter((event) => event.type === 'player-hit' || event.type === 'player-extra-hit');
  }

  const fireBasicNormal = await resolveCriticalAction({
    className:'mage', spec:'화염', action:'attack', skills:{}, random:[0.99, 0.99, 0.99],
  });
  const fireBasicCritical = await resolveCriticalAction({
    className:'mage', spec:'화염', action:'attack', skills:{}, random:[0.99, 0.99, 0.01],
  });
  ok('Fire basic attacks retain the universal 150 percent critical multiplier',
    fireBasicNormal.length === 1
      && fireBasicCritical.length === 1
      && fireBasicCritical[0].critical === true
      && fireBasicCritical[0].effectAmount === Math.ceil(fireBasicNormal[0].effectAmount * 1.5),
    `normal=${JSON.stringify(fireBasicNormal)}, critical=${JSON.stringify(fireBasicCritical)}`);

  const fireBurstHits = await resolveCriticalAction({
    className:'mage', spec:'화염', action:'active:mage_fire_burst_v24', skills:{ mage_fire_burst_v24:1 },
    random:[0.99, 0.99, 0.01, 0.99, 0.99, 0.99, 0.99, 0.99, 0.01],
  });
  ok('Fire multi-hit skills roll each hit critical independently',
    fireBurstHits.length === 3
      && fireBurstHits.map((event) => event.critical).join(',') === 'true,false,true',
    JSON.stringify(fireBurstHits));

  const fireEmberMultiplierTable = [
    { rank:0, multiplier:2.0 },
    { rank:1, multiplier:2.2 },
    { rank:2, multiplier:2.4 },
    { rank:3, multiplier:2.6 },
    { rank:4, multiplier:2.8 },
    { rank:5, multiplier:3.0 },
  ];
  const fireEmberCriticalRows = [];
  for (const { rank, multiplier } of fireEmberMultiplierTable) {
    const skills = { mage_fire_ember_v24:rank, mage_fire_burst_v24:1 };
    const normalHits = await resolveCriticalAction({
      className:'mage', spec:'화염', action:'active:mage_fire_burst_v24', skills,
      random:[0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99],
    });
    const criticalHits = await resolveCriticalAction({
      className:'mage', spec:'화염', action:'active:mage_fire_burst_v24',
      skills,
      random:[0.99, 0.99, 0.01, 0.99, 0.99, 0.01, 0.99, 0.99, 0.01],
    });
    fireEmberCriticalRows.push({ rank, multiplier, normalHits, criticalHits });
  }
  ok('Fire skill critical hits use the Ember rank table from 200 through 300 percent',
    fireEmberCriticalRows.every(({ multiplier, normalHits, criticalHits }) => normalHits.length === 3
      && criticalHits.length === 3
      && criticalHits.every((event, index) => event.critical
        && event.effectAmount === Math.ceil(normalHits[index].effectAmount * multiplier))),
    JSON.stringify(fireEmberCriticalRows));

  const holyBasic = await resolveCriticalAction({
    className:'priest', spec:'신성', action:'attack', skills:{}, random:[0.99, 0.99, 0.01],
  });
  const faithStrike = await resolveCriticalAction({
    className:'priest', spec:'신성', action:'active:priest_basic_smite', skills:{ priest_basic_smite:1 }, random:[0.99, 0.99, 0.01],
  });
  const holyJudgment = await resolveCriticalAction({
    className:'priest', spec:'신성', action:'active:priest_holy_judgment_v24', skills:{ priest_holy_judgment_v24:1 }, random:[0.99, 0.99, 0.01],
  });
  const shadowBasic = await resolveCriticalAction({
    className:'priest', spec:'암흑', action:'attack', skills:{}, random:[0.99, 0.99, 0.01],
  });
  const warriorBasic = await resolveCriticalAction({
    className:'warrior', spec:'무기', action:'attack', skills:{}, random:[0.99, 0.99, 0.01],
  });
  ok('Holy attacks can critically hit again (v51) alongside Shadow and other classes',
    [holyBasic, faithStrike, holyJudgment].every((hits) => hits.length === 1 && hits[0].critical === true)
      && shadowBasic.length === 1 && shadowBasic[0].critical === true
      && warriorBasic.length === 1 && warriorBasic[0].critical === true,
    `holyBasic=${JSON.stringify(holyBasic)}, faithStrike=${JSON.stringify(faithStrike)}, holyJudgment=${JSON.stringify(holyJudgment)}, shadow=${JSON.stringify(shadowBasic)}, warrior=${JSON.stringify(warriorBasic)}`);

  async function resolveVoidMasteryTick(rank, boundaryRoll) {
    resetCombatState('void-training-dummy', 8);
    G().player.class = 'priest';
    G().player.spec = '암흑';
    G().player.skills = { priest_shadow_void_v24:rank };
    monster.shadowStacks = 3;
    const trace = [];
    window.onCombatSequenceEventV42 = traceState(trace);
    useRandomSequence([0.99, 0.99, boundaryRoll]);
    window.monsterCounterAttack('');
    await waitForIdle();
    return trace.find((event) => event.type === 'player-dot');
  }

  const voidBoundaries = [[1, .20], [2, .40], [3, .60], [4, .80], [5, 1]];
  const voidTicks = [];
  for (const [rank, chance] of voidBoundaries) {
    voidTicks.push(await resolveVoidMasteryTick(rank, Math.max(0, chance - .000001)));
    if (chance < 1) voidTicks.push(await resolveVoidMasteryTick(rank, chance));
  }
  ok('Void Mastery ranks one through five apply their boundary critical rolls to shadow ticks',
    voidTicks.every((tick, index) => {
      const isBelowBoundary = index % 2 === 0 || index === voidTicks.length - 1;
      return tick?.effectAmount === (isBelowBoundary ? 6 : 3)
        && tick?.critical === isBelowBoundary;
    }),
    JSON.stringify(voidTicks));

  async function resolveTeacherDamage(random) {
    resetCombatState('teacherBoss', 13);
    // Keep the damage probe alive so a deferred defeat callback cannot race
    // the immediately following Heavy/Homework-Bomb assertions.
    G().player.hp = Math.max(G().player.maxHp, 100);
    G().player.skills = {};
    const trace = [];
    window.onCombatSequenceEventV42 = traceState(trace);
    useRandomSequence(random);
    window.monsterCounterAttack('');
    await waitForIdle();
    return trace.filter((event) => event.type === 'player-damage');
  }

  const teacherBase = await resolveTeacherDamage([.99, .99]);
  const teacherHeavy = await resolveTeacherDamage([.01, .99, .99]);
  const teacherHomework = await resolveTeacherDamage([.99, .01, .99, .99, .99]);
  ok('Teacher base, Heavy, and Homework Bomb damage use the 20 percent pre-technique bonus',
    teacherBase.map((event) => event.effectAmount).join(',') === '16'
      && teacherHeavy.map((event) => event.effectAmount).join(',') === '26'
      && teacherHomework.map((event) => event.effectAmount).join(',') === '12,12',
    JSON.stringify({ teacherBase, teacherHeavy, teacherHomework }));
  ok('Teacher Homework Bomb gives each of its two landed notices its own projectile impact',
    teacherHomework.length === 2
      && teacherHomework.every((event) => event.fx?.phase === 'impact'
        && event.fx?.mode === 'projectile'
        && event.fx?.projectile === 'monster-projectile'
        && event.impactCount === 1)
      && teacherHomework[1].projectileCreateCount === teacherHomework[0].projectileCreateCount + 1,
    JSON.stringify(teacherHomework));

  resetCombatState('teacherBoss', 13);
  G().player.skills = {};
  monster.chillTurns = 1;
  const teacherChillTrace = [];
  window.onCombatSequenceEventV42 = traceState(teacherChillTrace);
  useRandomSequence([.99, .99]);
  window.monsterCounterAttack('');
  await waitForIdle();
  const teacherChillDamage = teacherChillTrace
    .filter((event) => event.type === 'player-damage')
    .map((event) => event.effectAmount);
  ok('Teacher chill halves the already-buffed base damage and consumes one chill turn',
    teacherChillDamage.join(',') === '8'
      && monster.chillTurns === 0,
    JSON.stringify({ teacherChillDamage, chillTurns:monster.chillTurns, teacherChillTrace }));

  async function cancelPendingSkillStatus(cancel) {
    resetCombatState('slime', 1);
    G().player.class = 'warrior';
    G().player.spec = '무기';
    G().player.skills = { warrior_weapon_slash:1 };
    G().player.skillCooldowns = {};
    const trace = [];
    window.onCombatSequenceEventV42 = (event) => {
      trace.push(event.type);
      if (event.type === 'player-hit') cancel();
    };
    const input = $('combatAnswer') || window.document.createElement('input');
    input.id = 'combatAnswer';
    if (!input.isConnected) window.document.body.appendChild(input);
    input.value = 'right';
    G().currentQuestion = { q:'cancel timing', answer:'right' };
    G().currentCombatAction = 'active:warrior_weapon_slash';
    useRandomSequence([0.99, 0.99]);
    window.submitCombatAnswer();
    await waitForIdle(500);
    await sleep(30);
    return trace;
  }

  const replacedSkillTrace = await cancelPendingSkillStatus(() => window.queueCombatSequence([
    { type:'player-status', text:'replacement queue', duration:1 },
  ]));
  ok('replacing a skill queue leaves its pending status unapplied',
    !replacedSkillTrace.includes('enemy-status') && (monster.stunTurns || 0) === 0,
    `stun=${monster.stunTurns || 0}, trace=${replacedSkillTrace.join(' > ')}`);

  const invalidatedSkillTrace = await cancelPendingSkillStatus(() => window.invalidateCombatSequenceV42());
  ok('invalidating a skill queue leaves its pending status unapplied',
    !invalidatedSkillTrace.includes('enemy-status') && (monster.stunTurns || 0) === 0,
    `stun=${monster.stunTurns || 0}, trace=${invalidatedSkillTrace.join(' > ')}`);

  resetCombatState('slime', 10);
  G().player.hp = 1;
  G().player.skills.priest_basic_prayer = 3;
  const fatalTrace = [];
  window.onCombatSequenceEventV42 = traceState(fatalTrace);
  useRandomSequence([0.99, 0.99]);
  window.monsterCounterAttack('');
  await waitForIdle();
  ok('fatal damage queues no unapplied retaliation',
    fatalTrace.some((event) => event.type === 'player-damage' && event.playerHp === 0)
      && !fatalTrace.some((event) => event.type === 'retaliation'),
    JSON.stringify(fatalTrace));

  const cancelledProjectile = await observeMonsterProjectileLifecycle({ cancelAtLaunch:true });
  ok('cancelling a monster projectile before impact leaves damage and its log unapplied',
    cancelledProjectile.flight?.connected === false
      && cancelledProjectile.landing === null
      && cancelledProjectile.hpAfter === cancelledProjectile.hpBefore
      && !cancelledProjectile.trace.some((event) => event.type === 'player-damage'),
    JSON.stringify(cancelledProjectile));

  projectileObserver.disconnect();
  ok('event timing harness has no async errors', asyncErrors.length === 0, asyncErrors.join(' | '));
  console.log(`RESULT: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 && asyncErrors.length === 0 ? 0 : 1);
}).catch((error) => {
  console.log(String(error?.stack || error));
  process.exit(1);
});
