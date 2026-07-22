const run = require(require('path').join(__dirname, 'harness.js'));
const root = process.argv[2];

run(root, async ({ window, $, click, sleep, asyncErrors }) => {
  let pass = 0;
  let fail = 0;
  const check = (condition, label, detail = '') => {
    if (condition) pass += 1;
    else fail += 1;
    console.log(`${condition ? 'PASS' : 'FAIL'}: ${label}${detail ? ` | ${detail}` : ''}`);
  };

  $('loginName').value = '전투애니검증';
  $('loginPassword').value = '1234';
  click('studentLoginBtn');
  await sleep(1300);
  click('createCharacterBtn');
  await sleep(2500);
  window.enterForest();
  await sleep(1600);

  const game = window.__G;
  const monster = game.forestMonsters.find((entry) => entry.alive !== false && !entry.dead);
  game.player.x = monster.x;
  game.player.y = monster.y;
  await sleep(700);

  const fx = window.YuksamCombatFx;
  const stage = window.document.querySelector('.combat-stage');
  const playerSprite = stage?.querySelector('.combat-player');
  const monsterSprite = stage?.querySelector('.combat-monster');
  check(!!stage, 'combat stage rendered');
  check(playerSprite?.classList.contains('combat-idle-player'), 'player idle class rendered');
  check(monsterSprite?.classList.contains('combat-idle-monster'), 'monster idle class rendered');

  const cases = [
    [{ type:'mushroom' }, null],
    [{ type:'mushroom' }, { k:'poison', n:'mushroom poison' }],
    [{ type:'slime' }, { k:'selfShield', n:'slime shield' }],
    [{ type:'stomp' }, { k:'heavy', n:'stomp ground hit', stun:1 }],
    [{ type:'snake' }, { k:'poison', n:'snake venom' }],
    [{ type:'snake' }, { k:'crit', n:'snake bite' }],
    [{ type:'tarantula' }, { k:'multi', n:'swamp multi bite' }],
    [{ type:'zombie' }, { k:'lifesteal', n:'swamp drain bite' }],
    [{ type:'slime', elite:true }, { k:'heavy', n:'elite heavy' }],
    [{ type:'slime', elite:true }, { k:'selfShield', n:'elite shield' }],
    [{ type:'teacherBoss' }, { k:'heavy', n:'boss heavy' }],
    [{ type:'teacherBoss' }, { k:'multi', n:'boss multi' }],
    [{ type:'teacherBoss' }, { k:'chillPlayer', n:'boss chill' }],
  ];
  const profiles = cases.map(([entry, technique]) => fx.getMonsterFxProfile(entry, technique));
  check(profiles.every((profile) => profile.motion && profile.impact && profile.source === 'monster'), 'all monster profiles are complete', `count=${profiles.length}`);
  check(profiles.at(-1).tier === 4 && profiles.at(-1).shakePx > profiles[8].shakePx, 'boss profiles have stronger visual intensity');

  let projectileAdded = false;
  const observer = new window.MutationObserver((records) => {
    projectileAdded ||= records.some((record) => [...record.addedNodes].some((node) => node.classList?.contains('combat-fx-projectile')));
  });
  observer.observe(stage, { childList:true });
  const projectileProfile = { ...profiles[1], travelMs:35, lingerMs:80, actionMs:60 };
  const projectileDone = fx.playMonsterActionFx(projectileProfile);
  check(!!stage.querySelector('.fx-poison-projectile'), 'poison projectile created');
  check(monsterSprite.classList.contains('combat-acting'), 'monster action overrides idle motion');
  await projectileDone;
  check(!!stage.querySelector('.fx-impact-poison-burst'), 'poison impact created at hit');
  await sleep(55);
  observer.disconnect();
  check(projectileAdded && !stage.querySelector('.combat-fx-node'), 'projectile and impact nodes auto-remove');
  check(!monsterSprite.classList.contains('combat-acting'), 'monster acting class clears after hit');

  monster.type = 'mushroom';
  monster.name = 'animation integration mushroom';
  monster.elite = false;
  monster.attack = 1;
  game.player.hp = game.player.maxHp;
  game.playerAilments = {};
  game.combatShield = 0;
  const selectedEvents = [];
  let actionLogRendered = false;
  let damageFollowedAction = false;
  let damageLogRendered = false;
  let damageFxAtLanding = null;
  window.onCombatSequenceEventV42 = (event) => {
    event.duration = 35;
    if (event.type === 'player-damage') {
      damageFollowedAction = actionLogRendered;
      damageFxAtLanding = {
        fx:event.fx,
        projectile:!!window.document.querySelector('.fx-poison-projectile'),
        impact:!!window.document.querySelector('.fx-impact-poison-burst'),
      };
      window.setTimeout(() => {
        damageLogRendered ||= $('modalContent').textContent.includes(event.text);
      }, 0);
    }
    selectedEvents.push(event);
  };
  const nativeRandom = window.Math.random;
  const combatRolls = [0, .99];
  window.Math.random = () => combatRolls.length ? combatRolls.shift() : .99;
  const actionStarted = Date.now();
  window.monsterCounterAttack('');
  await sleep(20);
  const selectedAction = selectedEvents.find((event) => event.type === 'monster-action');
  const activeMonsterSprite = window.document.querySelector('.combat-monster');
  check(
    selectedAction?.fx?.techniqueKind === 'poison'
      && selectedAction.fx.phase === 'wind-up'
      && selectedAction.fx.projectile === undefined,
    'real attack selected a k/n poison wind-up profile',
  );
  check(
    activeMonsterSprite?.classList.contains('combat-fx-motion-venom-cast') && !window.document.querySelector('.fx-poison-projectile'),
    'selected action applied motion without launching a projectile',
  );
  check(!$('modalContent').textContent.includes(selectedAction?.text || 'missing'), 'real monster log is hidden while acting');

  while (activeMonsterSprite?.classList.contains('combat-acting') && Date.now() - actionStarted < 1000) await sleep(20);
  const actionElapsed = Date.now() - actionStarted;
  check(
    actionElapsed >= 360 && !activeMonsterSprite?.classList.contains('combat-acting') && $('modalContent').textContent.includes(selectedAction?.text || 'missing'),
    'real monster log waited for the full acting motion',
    `elapsed=${actionElapsed}`,
  );
  actionLogRendered = $('modalContent').textContent.includes(selectedAction?.text || 'missing');
  while (!selectedEvents.some((event) => event.type === 'player-damage') && Date.now() - actionStarted < 1400) await sleep(20);
  const damageEvent = selectedEvents.find((event) => event.type === 'player-damage');
  while (!damageLogRendered && Date.now() - actionStarted < 1500) await sleep(5);
  check(
    damageFollowedAction && !!damageEvent && damageLogRendered
      && damageFxAtLanding?.fx?.phase === 'impact'
      && damageFxAtLanding.fx?.projectile === 'poison-projectile',
    'real damage log followed the monster action log with the landed projectile impact',
  );
  window.Math.random = nativeRandom;

  await sleep(80);
  check(asyncErrors.length === 0, 'async errors are zero', asyncErrors.slice(0, 3).join(' || '));
  console.log(`RESULT: PASS ${pass} / FAIL ${fail} / ASYNC ${asyncErrors.length}`);
  process.exit(fail === 0 && asyncErrors.length === 0 ? 0 : 1);
}).catch((error) => {
  console.log('HARNESS FAIL:', String(error?.stack || error).split('\n').slice(0, 5).join(' / '));
  process.exit(1);
});
