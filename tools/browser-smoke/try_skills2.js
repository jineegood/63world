// 시트개편 검증: 다중랭크 / 더블어택 / 기절 / 다단히트 / 부활 / 회복효율 / 원소보호막
const run = require(require('path').join(__dirname, 'harness.js'));
const root = process.argv[2];
run(root, async ({ window, $, sleep, click, asyncErrors }) => {
  const G = () => window.__G;
  let pass = 0, fail = 0;
  const ok = (cond, label, extra = '') => { if (cond) { pass++; console.log('PASS:', label, extra); } else { fail++; console.log('!!! FAIL:', label, extra); } };

  $('loginName').value = '스킬검증'; $('loginPassword').value = '1234';
  click('studentLoginBtn'); await sleep(1200);
  click('createCharacterBtn'); await sleep(2200);
  const g = G();
  ok(!!g.player, '캐릭터 생성', g.player && g.player.name);

  // 랜덤 고정: 0.5 → 변수 데미지 결정적, 치명타/미스 미발동
  window.Math.random = () => 0.5;
  const nativeSetTimeout = window.setTimeout.bind(window);
  window.setTimeout = (fn, ms, ...args) => nativeSetTimeout(fn, Math.min(Number(ms) || 0, 20), ...args);
  const sequenceTrace = [];
  const sequenceEvents = [];
  window.onCombatSequenceEventV42 = (event) => { sequenceTrace.push(event.type); sequenceEvents.push(event); };
  const eventCount = (type) => sequenceTrace.filter((entry) => entry === type).length;
  const waitFor = async (predicate, timeout = 2500) => {
    const started = Date.now();
    while (!predicate() && Date.now() - started < timeout) await sleep(10);
    return predicate();
  };

  const mkMonster = (opts = {}) => ({
    id: 'sc_' + (Math.floor(Math.random() * 1e9) + Date.now()),
    type: 'slime', name: '허수아비', level: 1,
    maxHp: opts.maxHp || 100000, hp: opts.hp != null ? opts.hp : (opts.maxHp || 100000),
    attack: opts.attack || 10, alive: true, dying: false, x: 0, y: 0, r: 20,
  });
  const setup = (cls, spec, skills, mopts = {}) => {
    window.invalidateCombatSequenceV42?.();
    sequenceTrace.length = 0;
    sequenceEvents.length = 0;
    g.player.class = cls; g.player.spec = spec;
    g.player.skills = Object.assign({}, skills);
    g.player.skillCooldowns = {};
    g.modalState = { type: null, pause: false };
    g.transitionLock = 0;
    const m = mkMonster(mopts);
    g.forestMonsters = [m];
    window.openCombat(m);
    if (g.currentCombatMonsterId !== m.id) { g.currentCombatMonsterId = m.id; }
    g.player.hp = g.player.maxHp;
    return m;
  };
  const attack = (action) => {
    g.currentCombatAction = action;
    g.currentQuestion = { q: '1', answer: '1' };
    let inp = $('combatAnswer');
    if (!inp) { inp = window.document.createElement('input'); inp.id = 'combatAnswer'; $('modalContent').appendChild(inp); }
    inp.value = '1';
    window.submitCombatAnswer();
  };

  // (a) 다중 랭크
  g.player.class = 'warrior'; g.player.spec = null; g.player.skills = {}; g.player.level = 10;
  /* 스킬 포인트는 명진쌤의 스킬 퀘스트(tut_skill)를 받은 뒤에만 쓸 수 있다.
     여기서 보려는 것은 "퀘스트를 마친 학생이 랭크를 올릴 때" 규칙이므로 퀘스트를 완료 상태로 둔다. */
  g.player.quests = g.player.quests || {};
  g.player.quests.tut_skill = { id:'tut_skill', status:'done', progress:1, target:1, acceptedAt:Date.now() };
  window.updateHud();
  const baseHp = window.computeTotalStats().체력;
  const learn = (id) => window.learnSkill(id);
  learn('warrior_basic_body'); const r1 = window.getSkillRank('warrior_basic_body'); const h1 = window.computeTotalStats().체력;
  learn('warrior_basic_body'); const r2 = window.getSkillRank('warrior_basic_body'); const h2 = window.computeTotalStats().체력;
  learn('warrior_basic_body'); const r3 = window.getSkillRank('warrior_basic_body'); const h3 = window.computeTotalStats().체력;
  learn('warrior_basic_body'); const r4 = window.getSkillRank('warrior_basic_body');
  ok(r1 === 1 && r2 === 2 && r3 === 3, '(a) 3회까지 랭크 증가', r1 + '/' + r2 + '/' + r3);
  ok(r4 === 3, '(a) 4회째 최대랭크 차단', 'rank=' + r4);
  ok(h1 - baseHp === 2 && h2 - baseHp === 4 && h3 - baseHp === 6, '(a) 체력 보너스 2→4→6', (h1 - baseHp) + '/' + (h2 - baseHp) + '/' + (h3 - baseHp));

  // (b) 더블 어택
  let m = setup('warrior', '무기', {}, { maxHp: 100000 });
  let hp0 = m.hp; attack('attack');
  await waitFor(() => eventCount('player-hit') >= 1);
  const dmgSingle = hp0 - m.hp;
  m = setup('warrior', '무기', { warrior_weapon_breaker: 1 }, { maxHp: 100000 });
  hp0 = m.hp; attack('attack');
  await waitFor(() => eventCount('player-hit') >= 1);
  const dmgMid = hp0 - m.hp;
  await waitFor(() => eventCount('player-extra-hit') >= 1);
  const dmgDouble = hp0 - m.hp;
  ok(dmgDouble > dmgSingle, '(b) 더블어택 2타 합산 > 단타', '단타 ' + dmgSingle + ' / 더블 ' + dmgDouble);
  ok(dmgMid > 0 && dmgMid < dmgDouble, '(b2) 순차 적용(중간 1타만 차감)', dmgMid + ' → ' + dmgDouble);

  // (c) 기절
  m = setup('warrior', '무기', { warrior_weapon_slash: 1 }, { maxHp: 100000, attack: 30 });
  attack('active:warrior_weapon_slash');
  const stunBeforeStatus = m.stunTurns || 0;
  await waitFor(() => eventCount('enemy-status') >= 1 && (m.stunTurns || 0) >= 1);
  const stunSet = m.stunTurns;
  const hpBeforeCounter = g.player.hp;
  await waitFor(() => !g.combatSequenceActive);
  const skippedNoDamage = g.player.hp === hpBeforeCounter;
  ok(stunBeforeStatus === 0 && stunSet >= 1, '(c) stun status event timing', 'before=' + stunBeforeStatus + ', stunTurns=' + stunSet);
  ok(stunSet >= 1, '(c) 파쇄 일격이 기절 부여', 'stunTurns=' + stunSet);
  ok(skippedNoDamage && m.stunTurns === 0, '(c) 기절 턴 반격 스킵(무피해)', 'hp ' + hpBeforeCounter + '->' + g.player.hp);

  // (d) 다단히트 (순차 연출 대기 후 측정)
  m = setup('mage', '화염', { mage_fireball_v24: 1 }, { maxHp: 100000 });
  hp0 = m.hp; attack('active:mage_fireball_v24');
  await waitFor(() => eventCount('player-hit') >= 1);
  const fbMid = hp0 - m.hp;
  await waitFor(() => eventCount('player-extra-hit') >= 1);
  const dmgFb = hp0 - m.hp;
  ok(fbMid > 0 && dmgFb > fbMid, '(d) 대화염구 순차 2타(단계 적용)', fbMid + ' → ' + dmgFb);

  // (e) 부활
  m = setup('warrior', '방어', { warrior_def_bastion: 1 }, { maxHp: 100000, attack: 999999 });
  g.player.hp = 5;
  window.monsterCounterAttack('');
  await waitFor(() => eventCount('player-damage') >= 1);
  await waitFor(() => g.player.hp > 0 && !g.combatSequenceActive);
  const revivedHp = g.player.hp;
  ok(revivedHp > 0 && g.bastionUsed === true, '(e) 수호자의 맹세 부활', 'hp=' + revivedHp + ', used=' + g.bastionUsed);
  g.player.hp = 5;
  sequenceTrace.length = 0;
  window.monsterCounterAttack('');
  await waitFor(() => eventCount('player-damage') >= 1);
  ok(g.player.hp <= 0, '(e) 전투당 1회 제한(두번째 사망)', 'hp=' + g.player.hp);
  m = setup('warrior', '방어', {}, { maxHp: 100000, attack: 999999 });
  g.player.hp = 5;
  window.monsterCounterAttack('');
  await waitFor(() => eventCount('player-damage') >= 1);
  ok(g.player.hp <= 0, '(e) 미보유 시 기존 패배', 'hp=' + g.player.hp);

  // (f) 회복효율
  const measureHeal = async (graceRank) => {
    const skills = { priest_basic_smite: 1 };
    if (graceRank > 0) skills.priest_holy_grace_v24 = graceRank;
    setup('priest', '신성', skills, { maxHp: 100000 });
    // 사제 실제 maxHp가 작아 %회복이 즉시 상한에 걸리므로, 측정 동안 재계산을 잠시 막아 보정치를 관측한다.
    const savedEnsure = window.ensurePlayerHp;
    window.ensurePlayerHp = function () {};
    g.player.maxHp = 100000; g.player.hp = 10;
    attack('active:priest_basic_smite');
    await waitFor(() => eventCount('player-support') >= 1);
    const delta = g.player.hp - 10;
    window.ensurePlayerHp = savedEnsure;
    return delta;
  };
  const heal0 = await measureHeal(0), heal1 = await measureHeal(1), heal2 = await measureHeal(2);
  ok(heal1 > heal0 && heal2 > heal1, '(f) 치유 숙련 랭크별 회복 증가', heal0 + '/' + heal1 + '/' + heal2);

  // (g) 원소 보호막: 적의 공격을 전부 맞은 뒤 살아서 HP 20% 이하일 때만 전투당 1회
  m = setup('mage', '화염', { mage_basic_element: 1 }, { maxHp: 100000, attack: 10 });
  g.player.maxHp = 100; g.player.hp = 25; g.combatShield = 0;
  window.monsterCounterAttack('');
  await waitFor(() => g.elementalBarrierUsed === true && !g.combatSequenceActive);
  ok(g.player.hp > 0 && g.player.hp / g.player.maxHp <= 0.20,
    '(g) 원소 보호막은 적 공격이 끝난 뒤 생존 HP 20% 이하에서 발동', 'hp=' + g.player.hp + '/' + g.player.maxHp);
  ok(g.combatShield === Math.ceil(g.player.maxHp * 0.10),
    '(g2) 1랭크는 최대 HP의 10% 보호막', 'shield=' + g.combatShield + ', maxHp=' + g.player.maxHp);
  const supportCountAfterFirst = eventCount('player-support');
  window.monsterCounterAttack('');
  await waitFor(() => !g.combatSequenceActive);
  ok(eventCount('player-support') === supportCountAfterFirst, '(g3) 전투당 1회 제한');

  m = setup('mage', '화염', { mage_basic_element: 5 }, { maxHp: 100000, attack: 10 });
  g.player.maxHp = 100; g.player.hp = 5; g.combatShield = 0;
  window.monsterCounterAttack('');
  await waitFor(() => g.player.hp <= 0);
  ok(g.combatShield === 0 && g.elementalBarrierUsed === false,
    '(g4) 죽는 피해에는 원소 보호막 미발동', 'shield=' + g.combatShield + ', used=' + g.elementalBarrierUsed);

  // (h) 방패 돌진: 새 보호막을 먼저 더한 뒤 100으로 제한하고, 치명타/냉기는 그 다음에 적용한다.
  const shieldChargeDamage = async (startingShield, randomValues, chillTurns) => {
    m = setup('warrior', '방어', { warrior_def_wall: 1 }, { maxHp: 100000 });
    g.player.maxHp = 1000; g.player.hp = 1;
    g.combatShield = startingShield;
    g.playerChillTurns = chillTurns;
    const randomQueue = randomValues.slice();
    window.Math.random = () => randomQueue.length ? randomQueue.shift() : 0.99;
    hp0 = m.hp;
    attack('active:warrior_def_wall');
    await waitFor(() => eventCount('player-hit') >= 1);
    window.Math.random = () => 0.5;
    return {
      damage: hp0 - m.hp,
      shield:g.combatShield,
      chill:g.playerChillTurns,
      monsterHp:m.hp,
      playerHit:sequenceEvents.find((event) => event.type === 'player-hit'),
    };
  };
  const normalShieldCharge = await shieldChargeDamage(40, [0.5, 0.5], 0);
  ok(normalShieldCharge.shield === 240 && normalShieldCharge.damage === 100, 'Shield Charge adds its shield before deriving capped normal damage', 'shield=' + normalShieldCharge.shield + ', damage=' + normalShieldCharge.damage);
  const cappedShieldCharge = await shieldChargeDamage(500, [0.5, 0.5], 0);
  ok(cappedShieldCharge.damage === 100, 'Shield Charge caps a large shield at 100 normal damage', 'damage=' + cappedShieldCharge.damage);
  const criticalShieldCharge = await shieldChargeDamage(500, [0.5, 0], 0);
  ok(criticalShieldCharge.damage === 150, 'Shield Charge can critically hit for the capped 150 damage', 'damage=' + criticalShieldCharge.damage);
  const chilledShieldCharge = await shieldChargeDamage(40, [0.5, 0.5], 1);
  ok(chilledShieldCharge.damage === 50 && chilledShieldCharge.chill === 0, 'Shield Charge chill remains a downstream half-damage modifier', 'damage=' + chilledShieldCharge.damage + ', chill=' + chilledShieldCharge.chill);
  const missedShieldCharge = await shieldChargeDamage(40, [0.01], 0);
  const missedShieldChargeEvent = missedShieldCharge.playerHit;
  ok(
    missedShieldCharge.damage === 0
      && missedShieldCharge.monsterHp === 100000
      && missedShieldCharge.shield === 240
      && missedShieldChargeEvent?.audioId === 'miss'
      && !missedShieldChargeEvent.effect
      && /빗나갔다/.test(missedShieldChargeEvent.text),
    'Shield Charge miss deals no damage but keeps its before-phase shield and miss event path',
    'damage=' + missedShieldCharge.damage + ', shield=' + missedShieldCharge.shield + ', event=' + JSON.stringify(missedShieldChargeEvent && { audioId:missedShieldChargeEvent.audioId, effect:missedShieldChargeEvent.effect, text:missedShieldChargeEvent.text }),
  );

  m = setup('warrior', '방어', { warrior_def_bastion: 1 }, { maxHp: 100000, attack: 999999 });
  g.bastionUsed = false;
  g.combatShield = 77;
  g.player.hp = 5;
  window.Math.random = () => 0.99;
  window.monsterCounterAttack('');
  await waitFor(() => g.player.hp > 5 && g.bastionUsed === true);
  const reviveFrameHasNoShield = g.combatShield === 0 && /🛡/.test($('modalContent').textContent) === false;
  ok(reviveFrameHasNoShield, 'Guardian Oath revival frame clears the existing combat shield', 'shield=' + g.combatShield);
  window.Math.random = () => 0.5;

  console.log('');
  ok(asyncErrors.length === 0, '비동기 오류 없음', JSON.stringify(asyncErrors.slice(0, 3)));
  console.log('\n결과: PASS ' + pass + ' / FAIL ' + fail);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.log('!!! 하네스 실패:', String(e && e.stack || e).split('\n').slice(0, 4).join(' / ')); process.exit(1); });
