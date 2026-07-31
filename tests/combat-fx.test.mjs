import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Script, createContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
/* 소스는 CRLF로 저장돼 있고 아래 검사들의 슬라이스 정규식은 \n 기준이므로 읽을 때 LF로 맞춘다. */
const read = (file) => readFileSync(join(root, file), 'utf8').replace(/\r\n/g, '\n');
const require = createRequire(import.meta.url);
const { JSDOM } = require(join(root, '.codex_work', 'browser-smoke', 'node_modules', 'jsdom'));

function loadBrowserModule(file, context) {
  new Script(read(file), { filename:file }).runInContext(context);
}

function loadSkillData() {
  let id = 0;
  const context = createContext({
    window:{ crypto:{ randomUUID:() => `combat-fx-${++id}` } },
    Math,
    Date,
  });
  context.globalThis = context.window;
  loadBrowserModule('src/core-utils.js', context);
  loadBrowserModule('src/game-data.js', context);
  const data = context.window.YuksamData;
  Object.assign(data.SKILL_DEFS, data.V18_SKILL_PATCHES);
  Object.entries(data.V23_SKILL_OVERRIDES).forEach(([skillId, patch]) => {
    Object.assign(data.SKILL_DEFS[skillId], patch);
  });
  Object.assign(data.SKILL_DEFS, data.V24_SKILLS);
  return data.SKILL_DEFS;
}

function loadFxContext(window = {}) {
  const context = createContext({ window, document:window.document, setTimeout, clearTimeout, Promise });
  context.globalThis = context.window;
  loadBrowserModule('src/combat-fx.js', context);
  return context.window.YuksamCombatFx;
}

test('combat fx module gives every current active skill a complete tiered profile', () => {
  assert.equal(existsSync(join(root, 'src', 'combat-fx.js')), true, 'src/combat-fx.js should exist');
  const fx = loadFxContext();
  const activeSkills = Object.values(loadSkillData()).filter((skill) => skill.active);
  assert.ok(activeSkills.length >= 20, 'the complete active skill table should be checked');

  for (const skill of activeSkills) {
    const profile = fx.getSkillFxProfile(skill.id, skill);
    assert.ok(profile.motion, `${skill.id} needs a motion`);
    assert.ok(profile.impact, `${skill.id} needs an impact`);
    assert.ok(profile.tier >= 1 && profile.tier <= 4, `${skill.id} needs tier 1-4`);
  }
});

test('normal, intermediate, advanced, and ultimate skills increase from tier 1 to 4', () => {
  const fx = loadFxContext();
  const skills = loadSkillData();
  const ids = [
    'warrior_basic_strike',
    'warrior_weapon_slash',
    'mage_fire_burst_v24',
    'mage_fire_meteor_v24',
  ];
  assert.deepEqual(ids.map((id) => fx.getSkillFxProfile(id, skills[id]).tier), [1, 2, 3, 4]);
  assert.equal(fx.getSkillFxProfile(ids[3], skills[ids[3]]).complementaryUltimate, true);
});

test('basic attacks have a simple complete player FX profile', () => {
  const fx = loadFxContext();
  for (const klass of ['warrior', 'mage', 'priest']) {
    const profile = fx.getBasicAttackFxProfile(klass);
    assert.equal(profile.source, 'player');
    assert.equal(profile.target, 'monster');
    assert.ok(profile.motion, `${klass} basic attack needs motion`);
    assert.ok(profile.impact, `${klass} basic attack needs impact`);
    assert.ok(profile.lingerMs >= 500, `${klass} basic impact must survive its particles`);
  }
});

test('class skill profiles use their requested projectile and warrior impact language', () => {
  const fx = loadFxContext();
  const skills = loadSkillData();
  assert.equal(fx.getSkillFxProfile('mage_fireball_v24', skills.mage_fireball_v24).projectile, 'fire-projectile');
  assert.equal(fx.getSkillFxProfile('mage_frost_lance_v24', skills.mage_frost_lance_v24).projectile, 'ice-projectile');
  assert.equal(fx.getSkillFxProfile('priest_basic_smite', skills.priest_basic_smite).projectile, 'holy-projectile');
  assert.equal(fx.getSkillFxProfile('priest_shadow_seed_v24', skills.priest_shadow_seed_v24).projectile, 'shadow-projectile');
  assert.equal(fx.getSkillFxProfile('warrior_basic_strike', skills.warrior_basic_strike).motion, 'slash');
  assert.deepEqual(
    [
      fx.getSkillFxProfile('warrior_def_wall', skills.warrior_def_wall).motion,
      fx.getSkillFxProfile('warrior_def_wall', skills.warrior_def_wall).impact,
    ],
    ['shield-charge', 'shockwave'],
  );
});

test('Shield Charge exposes a player shield-wave profile for its before-phase support notice', () => {
  const fx = loadFxContext();
  const skill = loadSkillData().warrior_def_wall;
  const profile = fx.getPlayerSupportFxProfile('warrior_def_wall', skill, 'shield');

  assert.deepEqual(
    [profile.source, profile.target, profile.mode, profile.motion, profile.impact],
    ['player', 'player', 'wave', 'shield', 'shield-wave'],
  );
  assert.equal(profile.projectile, undefined);
});

test('warrior charge motions travel by the actor gap and cleanly return to origin', async () => {
  const dom = new JSDOM('<div class="combat-stage"><div class="combat-player"></div><div class="combat-monster"></div></div>');
  const { window } = dom;
  const stage = window.document.querySelector('.combat-stage');
  const player = window.document.querySelector('.combat-player');
  const monster = window.document.querySelector('.combat-monster');
  stage.getBoundingClientRect = () => ({ left:0, top:0, width:800, height:400 });
  player.getBoundingClientRect = () => ({ left:80, top:190, width:160, height:160 });
  monster.getBoundingClientRect = () => ({ left:590, top:80, width:150, height:170 });
  const fx = loadFxContext(window);
  const skills = loadSkillData();
  const shieldCharge = { ...fx.getSkillFxProfile('warrior_def_wall', skills.warrior_def_wall), travelMs:20, actionMs:40, lingerMs:20 };
  const armorBump = { ...fx.getBasicAttackFxProfile('warrior'), motion:'offensive-armor-bump', motionTravelPct:.35, travelMs:20, actionMs:40, lingerMs:20 };

  assert.equal(shieldCharge.motionTravelPct, .85);
  const shieldDone = fx.playPlayerActionFx(shieldCharge);
  assert.equal(player.classList.contains('combat-fx-motion-shield-charge'), true);
  assert.equal(player.style.getPropertyValue('--combat-fx-motion-distance'), '429px');
  await shieldDone;
  assert.equal(player.className, 'combat-player');

  const armorDone = fx.playPlayerActionFx(armorBump);
  assert.equal(player.classList.contains('combat-fx-motion-offensive-armor-bump'), true);
  assert.equal(player.style.getPropertyValue('--combat-fx-motion-distance'), '177px');
  await armorDone;
  assert.equal(player.className, 'combat-player');
  assert.match(read('style.css'), /combatFxShieldCharge[\s\S]*var\(--combat-fx-motion-distance[,)]/);
  assert.match(read('style.css'), /combatFxOffensiveArmorBump[\s\S]*var\(--combat-fx-motion-distance[,)]/);
});

test('projectiles travel from player to monster, create impact particles, and auto-remove', async () => {
  const dom = new JSDOM('<div class="combat-stage"><div class="combat-player"></div><div class="combat-monster"></div></div>', { pretendToBeVisual:true });
  const { window } = dom;
  const stage = window.document.querySelector('.combat-stage');
  const player = window.document.querySelector('.combat-player');
  const monster = window.document.querySelector('.combat-monster');
  stage.getBoundingClientRect = () => ({ left:0, top:0, width:800, height:400, right:800, bottom:400 });
  player.getBoundingClientRect = () => ({ left:80, top:190, width:160, height:160, right:240, bottom:350 });
  monster.getBoundingClientRect = () => ({ left:590, top:80, width:150, height:170, right:740, bottom:250 });
  const fx = loadFxContext(window);
  const skill = loadSkillData().mage_fireball_v24;
  const profile = { ...fx.getSkillFxProfile(skill.id, skill), travelMs:20, lingerMs:20 };

  const impactReady = fx.playPlayerActionFx(profile);
  const projectile = stage.querySelector('.combat-fx-projectile');
  assert.ok(projectile, 'projectile should be created immediately');
  assert.equal(projectile.dataset.from, 'player');
  assert.equal(projectile.dataset.to, 'monster');
  assert.equal(projectile.dataset.projectile, 'fire-projectile');
  assert.notEqual(projectile.style.getPropertyValue('--fx-dx'), '0px');

  await impactReady;
  assert.ok(stage.querySelector('.combat-fx-impact'));
  assert.ok(stage.querySelectorAll('.combat-fx-particle').length >= 4);
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(stage.querySelectorAll('.combat-fx-node').length, 0);
  assert.equal(player.className, 'combat-player');
});

test('heal, buff, and shield profiles pulse around their target and auto-remove', async () => {
  const dom = new JSDOM('<div class="combat-stage"><div class="combat-player"></div><div class="combat-monster"></div></div>');
  const { window } = dom;
  const fx = loadFxContext(window);
  const skills = loadSkillData();
  for (const id of ['priest_holy_absorb_v24', 'mage_basic_barrier', 'priest_holy_barrier_v24']) {
    const profile = { ...fx.getSkillFxProfile(id, skills[id]), travelMs:10, lingerMs:10 };
    const done = fx.playPlayerActionFx(profile);
    const wave = window.document.querySelector('.combat-fx-wave');
    assert.ok(wave, `${id} should create a wave`);
    assert.equal(wave.dataset.target, 'player');
    await done;
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(window.document.querySelectorAll('.combat-fx-node').length, 0);
  }
});

test('hybrid healing and shield-bash profiles add a player-centered support wave', () => {
  const fx = loadFxContext();
  const skills = loadSkillData();
  assert.equal(fx.getSkillFxProfile('priest_holy_judgment_v24', skills.priest_holy_judgment_v24).selfWave, 'heal-wave');
  assert.equal(fx.getSkillFxProfile('priest_basic_smite', skills.priest_basic_smite).selfWave, 'heal-wave');
  assert.equal(fx.getSkillFxProfile('warrior_def_wall', skills.warrior_def_wall).selfWave, 'shield-wave');
});

test('Holy Judgment lands as an impact with prayer motion, holy burst, and self heal wave but no projectile', () => {
  const fx = loadFxContext();
  const skills = loadSkillData();
  const profile = fx.getSkillFxProfile('priest_holy_judgment_v24', skills.priest_holy_judgment_v24);
  assert.equal(profile.mode, 'impact');
  assert.equal(profile.motion, 'prayer');
  assert.equal(profile.impact, 'holy-burst');
  assert.equal(profile.projectile, undefined);
  assert.equal(profile.selfWave, 'heal-wave');
});

test('cancelling combat fx removes nodes and prevents a delayed impact', async () => {
  const dom = new JSDOM('<div class="combat-stage"><div class="combat-player"></div><div class="combat-monster"></div></div>');
  const { window } = dom;
  const fx = loadFxContext(window);
  const skill = loadSkillData().mage_fireball_v24;
  const impacts = [];
  const observer = new window.MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.classList?.contains('combat-fx-impact')) impacts.push(node);
      }
    }
  });
  observer.observe(window.document.body, { childList:true, subtree:true });

  const result = fx.playPlayerActionFx({ ...fx.getSkillFxProfile(skill.id, skill), travelMs:60, lingerMs:520 });
  assert.ok(window.document.querySelector('.combat-fx-projectile'));
  fx.cancelAllCombatFx();
  assert.equal(await result, false);
  await new Promise((resolve) => setTimeout(resolve, 90));
  observer.disconnect();
  assert.equal(impacts.length, 0);
  assert.equal(window.document.querySelectorAll('.combat-fx-node').length, 0);
});

test('impact handlers run once at impact and never after cancellation', async () => {
  const dom = new JSDOM('<div class="combat-stage"><div class="combat-player"></div><div class="combat-monster"></div></div>');
  const { window } = dom;
  const fx = loadFxContext(window);
  const skill = loadSkillData().mage_fireball_v24;
  const profile = { ...fx.getSkillFxProfile(skill.id, skill), travelMs:20, lingerMs:20 };
  let impacts = 0;

  const completed = fx.playPlayerActionFx(profile, () => { impacts += 1; });
  assert.equal(impacts, 0);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(impacts, 1);
  await completed;
  assert.equal(impacts, 1);

  const cancelled = fx.playPlayerActionFx({ ...profile, travelMs:60 }, () => { impacts += 1; });
  fx.cancelAllCombatFx();
  assert.equal(await cancelled, false);
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.equal(impacts, 1);
});

test('player FX promise stays pending until impact particles finish', async () => {
  const dom = new JSDOM('<div class="combat-stage"><div class="combat-player"></div><div class="combat-monster"></div></div>');
  const fx = loadFxContext(dom.window);
  const skill = loadSkillData().mage_fireball_v24;
  const profile = { ...fx.getSkillFxProfile(skill.id, skill), travelMs:10, lingerMs:120 };
  let resolved = false;
  const completed = fx.playPlayerActionFx(profile).then((value) => { resolved = true; return value; });

  await new Promise((resolve) => setTimeout(resolve, 85));
  assert.equal(resolved, false, 'queue must not render over live particles');
  assert.ok(dom.window.document.querySelectorAll('.combat-fx-particle').length >= 4);
  assert.equal(await completed, true);
  assert.equal(dom.window.document.querySelectorAll('.combat-fx-node').length, 0);
});

test('screen shake strength increases by tier and is applied at impact', async () => {
  const fx = loadFxContext();
  const skills = loadSkillData();
  const ids = ['warrior_basic_strike', 'warrior_weapon_slash', 'mage_fire_burst_v24', 'mage_fire_meteor_v24'];
  const strengths = ids.map((id) => fx.getSkillFxProfile(id, skills[id]).shakePx);
  assert.ok(strengths.every((value, index) => index === 0 || value > strengths[index - 1]), strengths.join(','));

  const dom = new JSDOM('<div class="combat-stage"><div class="combat-player"></div><div class="combat-monster"></div></div>');
  const runtimeFx = loadFxContext(dom.window);
  const profile = runtimeFx.getSkillFxProfile('warrior_weapon_slash', skills.warrior_weapon_slash);
  await runtimeFx.playPlayerActionFx({ ...profile, travelMs:1 });
  const stage = dom.window.document.querySelector('.combat-stage');
  assert.equal(stage.classList.contains('combat-fx-shaking'), true);
  assert.equal(stage.dataset.fxShakeTier, '2');
  runtimeFx.cancelAllCombatFx();
});

test('ultimate complement uses one major hit and lightweight follow-up hits', async () => {
  const skills = loadSkillData();
  const dom = new JSDOM('<div class="combat-stage"><div class="combat-player"></div><div class="combat-monster"></div></div>');
  const fx = loadFxContext(dom.window);
  const ultimate = fx.getSkillFxProfile('mage_frost_storm_v24', skills.mage_frost_storm_v24);

  await fx.playPlayerActionFx({ ...ultimate, hitStage:'primary', travelMs:1 });
  assert.equal(dom.window.document.querySelector('.combat-fx-impact')?.classList.contains('fx-tier-3'), true);
  assert.ok(dom.window.document.querySelectorAll('.combat-fx-particle').length <= 10);
  fx.cancelAllCombatFx();

  await fx.playPlayerActionFx({ ...ultimate, hitStage:'follow-up', travelMs:1 });
  assert.equal(dom.window.document.querySelector('.combat-fx-impact')?.classList.contains('fx-tier-2'), true);
  assert.ok(dom.window.document.querySelectorAll('.combat-fx-particle').length <= 4);
  assert.equal(dom.window.document.querySelector('.combat-player').className, 'combat-player');
  fx.cancelAllCombatFx();
});

test('Meteor replays full FX on every follow-up hit instead of suppressing them', async () => {
  const skills = loadSkillData();
  const dom = new JSDOM('<div class="combat-stage"><div class="combat-player"></div><div class="combat-monster"></div></div>');
  const fx = loadFxContext(dom.window);
  const meteor = fx.getSkillFxProfile('mage_fire_meteor_v24', skills.mage_fire_meteor_v24);
  assert.equal(meteor.projectile, 'fire-projectile');

  for (const hitStage of ['primary', 'follow-up']) {
    await fx.playPlayerActionFx({ ...meteor, hitStage, travelMs:1 });
    assert.equal(
      dom.window.document.querySelector('.combat-fx-impact')?.classList.contains('fx-tier-3'),
      true,
      `${hitStage} meteor hit must keep the full ultimate impact`,
    );
    fx.cancelAllCombatFx();
  }
});

test('linger covers CSS impact completion and reduced motion minimizes JavaScript delays', async () => {
  const fx = loadFxContext();
  const skills = loadSkillData();
  for (const id of ['warrior_basic_strike', 'warrior_weapon_slash', 'mage_fire_burst_v24', 'mage_fire_meteor_v24']) {
    assert.ok(fx.getSkillFxProfile(id, skills[id]).lingerMs >= 500, `${id} linger must cover CSS animations`);
  }

  const dom = new JSDOM('<div class="combat-stage"><div class="combat-player"></div><div class="combat-monster"></div></div>');
  dom.window.matchMedia = (query) => ({ matches:query === '(prefers-reduced-motion: reduce)' });
  const reducedFx = loadFxContext(dom.window);
  const profile = reducedFx.getSkillFxProfile('mage_fireball_v24', skills.mage_fireball_v24);
  const started = Date.now();
  await reducedFx.playPlayerActionFx({ ...profile, travelMs:500, lingerMs:700 });
  assert.ok(Date.now() - started < 80, `reduced motion took ${Date.now() - started}ms`);
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(dom.window.document.querySelectorAll('.combat-fx-node').length, 0);
});

test('real combat queue survives synchronous player fx failure and cancels stale fx', { timeout:30000 }, () => {
  const script = join(root, 'tools', 'browser-smoke', 'try_combat_fx_resilience.js');
  const result = spawnSync(process.execPath, [script, root], { encoding:'utf8', timeout:25000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PASS: synchronous FX failure still renders the event/);
  assert.match(result.stdout, /PASS: synchronous FX failure releases the sequence lock/);
  assert.match(result.stdout, /PASS: replacing a queue cancels its pending impact/);
  assert.match(result.stdout, /PASS: cancelled and replayed effects apply damage once/);
  assert.match(result.stdout, /PASS: new queues clear combat impact and cancel its expiry timer/);
  assert.match(result.stdout, /PASS: invalidating and closing combat clear combat impact/);
});

test('browser queue consumes player effects at impact with a safe fallback', () => {
  const html = read('index.html');
  const game = read('game.js');
  const style = read('style.css');
  const runner = read('tools/run-baseline.ps1');
  const pkg = JSON.parse(read('package.json'));
  const fxIndex = html.indexOf('<script src="src/combat-fx.js"></script>');
  const gameIndex = html.indexOf('<script src="game.js"></script>');

  assert.ok(fxIndex > -1 && fxIndex < gameIndex, 'combat-fx must load before game.js');
  const sequence = game.match(/function queueCombatSequence\(events, onComplete\)[\s\S]*?\n  }\n  function queueCombatNoticesV42/)?.[0] || '';
  assert.match(sequence, /const applyNoticeEffect = \(\) => \{[\s\S]*combatEffectHandlerV42\.apply\(notice\.effect\)/);
  assert.match(sequence, /YuksamCombatFx\.playPlayerActionFx\(notice\.fx, \(\) => \{[\s\S]*playerImpactShown = true;[\s\S]*showNotice\(\);/);
  assert.match(sequence, /\.then\(showNotice, showNotice\)/);
  assert.match(sequence, /const renderNotice = \(\) => \{[\s\S]*applyNoticeEffect\(\);/);
  assert.match(sequence, /notice\.fx\.phase === 'impact'[\s\S]*playMonsterActionFx\(notice\.fx, \(\) => \{[\s\S]*showNotice\(\{ deferCompletion:true \}\)[\s\S]*completeNotice\(\)/);
  assert.match(sequence, /combatSequenceControllerV47\.isCurrent\(sequenceToken\)/);
  assert.match(game, /YuksamCombatFx\.cancelAllCombatFx\(\)/);
  assert.match(game, /YuksamCombatFx\.getSkillFxProfile\(activeSkill\.id, activeSkill\)/);
  assert.match(game, /hitStage:index === 0 \? 'primary' : 'follow-up'/);
  assert.match(style, /\.combat-fx-projectile/);
  assert.match(style, /\.combat-fx-impact/);
  assert.match(style, /\.combat-fx-wave/);
  assert.match(runner, /'combat-fx'/);
  assert.match(runner, /tests\/combat-fx\.test\.mjs/);
  assert.equal(pkg.scripts['test:combat-fx'], 'powershell -NoProfile -ExecutionPolicy Bypass -File tools/run-baseline.ps1 combat-fx');
});

test('combat floating numbers provide damage, healing, shield gain, and shield loss variants', () => {
  const game = read('game.js');
  const style = read('style.css');

  assert.match(game, /function showCombatFloatingNumberV49\(target, amount, kind, critical = false\)/);
  assert.match(game, /kind === 'damage' \|\| kind === 'shield-damage' \? `-\$\{value\}` : `\+\$\{value\}`/);
  assert.match(game, /showCombatFloatingNumberV49\('player', actualHeal, 'heal'\)/);
  assert.match(game, /showCombatFloatingNumberV49\('player', actualShield, 'shield'\)/);
  assert.match(game, /showCombatFloatingNumberV49\('monster', actualHeal, 'heal'\)/);
  assert.match(game, /showCombatFloatingNumberV49\('monster', actualShield, 'shield'\)/);
  assert.match(game, /\}, 1200\)/);
  assert.match(style, /\.combat-floating-damage\.heal\s*\{[^}]*color:\s*#(?:86efac|22c55e)/);
  assert.match(style, /\.combat-floating-damage\.shield\s*\{[^}]*color:\s*#(?:d1d5db|9ca3af)/);
  assert.match(style, /\.combat-floating-damage\.shield-damage\s*\{/);
});

test('combat fx module contains no gameplay damage or health mutation', () => {
  const source = read('src/combat-fx.js');
  assert.doesNotMatch(source, /applyDamage|\.hp\s*[+\-]?=|combatShield\s*[+\-]?=|setSkillCooldown/);
});

test('every current monster family receives a complete basic attack profile', () => {
  const fx = loadFxContext();
  const monsters = [
    { type:'mushroom' },
    { type:'slime' },
    { type:'stomp' },
    { type:'snake' },
    { type:'tarantula' },
    { type:'zombie' },
    { type:'teacherBoss' },
  ];

  for (const monster of monsters) {
    const profile = fx.getMonsterFxProfile(monster, null);
    assert.ok(['charge', 'claw', 'projectile'].includes(profile.attackStyle), `${monster.type} needs a basic attack style`);
    assert.ok(profile.motion, `${monster.type} needs a motion`);
    assert.ok(profile.impact, `${monster.type} needs an impact`);
    assert.ok(profile.tier >= 1 && profile.tier <= 4, `${monster.type} needs tier 1-4`);
    assert.equal(profile.source, 'monster');
    assert.equal(profile.target, 'player');
  }
});

test('actual k/n monster patterns use distinct matching effects and stronger elite tiers', () => {
  const fx = loadFxContext();
  const mushroomPoison = fx.getMonsterFxProfile({ type:'mushroom' }, { k:'poison', n:'mushroom poison' });
  const slimeShield = fx.getMonsterFxProfile({ type:'slime' }, { k:'selfShield', n:'slime shield' });
  const stomp = fx.getMonsterFxProfile({ type:'stomp' }, { k:'heavy', n:'stomp ground hit', stun:1 });
  const snakePoison = fx.getMonsterFxProfile({ type:'snake' }, { k:'poison', n:'snake venom' });
  const snakeBite = fx.getMonsterFxProfile({ type:'snake' }, { k:'crit', n:'snake bite' });
  const swampMulti = fx.getMonsterFxProfile({ type:'tarantula' }, { k:'multi', n:'swamp multi bite' });
  const swampDrain = fx.getMonsterFxProfile({ type:'zombie' }, { k:'lifesteal', n:'swamp drain bite' });
  const eliteHeavy = fx.getMonsterFxProfile({ type:'slime', elite:true }, { k:'heavy', n:'elite heavy' });
  const eliteShield = fx.getMonsterFxProfile({ type:'slime', elite:true }, { k:'selfShield', n:'elite shield' });
  const bossHeavy = fx.getMonsterFxProfile({ type:'teacherBoss' }, { k:'heavy', n:'boss heavy' });
  const bossMulti = fx.getMonsterFxProfile({ type:'teacherBoss' }, { k:'multi', n:'boss multi' });
  const bossChill = fx.getMonsterFxProfile({ type:'teacherBoss' }, { k:'chillPlayer', n:'boss chill' });

  assert.equal(mushroomPoison.projectile, 'poison-projectile');
  assert.equal(slimeShield.mode, 'wave');
  assert.equal(slimeShield.target, 'monster');
  assert.equal(slimeShield.motion, 'self-shield');
  assert.equal(slimeShield.impact, 'shield-wave');
  assert.equal(slimeShield.projectile, undefined);
  assert.equal(stomp.motion, 'jump-stomp');
  assert.equal(stomp.impact, 'ground-shockwave');
  assert.equal(snakePoison.projectile, 'poison-projectile');
  assert.equal(snakeBite.motion, 'bite');
  for (const profile of [swampMulti, swampDrain, eliteHeavy, eliteShield, bossHeavy, bossMulti, bossChill]) {
    assert.ok(profile.motion);
    assert.ok(profile.impact);
  }
  assert.ok(swampMulti.tier >= 2);
  assert.ok(eliteHeavy.tier >= 3);
  assert.equal(bossHeavy.tier, 4);
  assert.ok(bossHeavy.particleCount > eliteHeavy.particleCount);
  assert.ok(bossMulti.shakePx >= bossHeavy.shakePx);
  assert.deepEqual(
    [mushroomPoison, slimeShield, stomp, snakePoison, snakeBite, swampMulti, swampDrain, bossChill].map((profile) => profile.techniqueKind),
    ['poison', 'selfShield', 'heavy', 'poison', 'crit', 'multi', 'lifesteal', 'chillPlayer'],
  );
});

test('monster self-shields orbit their owner without launching a projectile', async () => {
  const dom = new JSDOM('<div class="combat-stage"><div class="combat-player"></div><div class="combat-monster"></div></div>');
  const fx = loadFxContext(dom.window);
  const profile = { ...fx.getMonsterFxProfile({ type:'slime', elite:true }, { k:'selfShield', n:'elite shield' }), travelMs:10, lingerMs:30, actionMs:30 };

  const done = fx.playMonsterActionFx(profile);
  const wave = dom.window.document.querySelector('.combat-fx-wave');
  assert.ok(wave, 'self-shield should create a monster-centered wave immediately');
  assert.equal(wave.dataset.target, 'monster');
  assert.equal(dom.window.document.querySelector('.combat-fx-projectile'), null);
  assert.equal(dom.window.document.querySelector('.combat-monster').classList.contains('combat-fx-motion-self-shield'), true);
  await done;
  fx.cancelAllCombatFx();
});

test('monster self-shield uses a stationary defensive pulse motion', async () => {
  const dom = new JSDOM('<div class="combat-stage"><div class="combat-player"></div><div class="combat-monster"></div></div>');
  const fx = loadFxContext(dom.window);
  const result = fx.playMonsterActionFx({
    ...fx.getMonsterFxProfile({ type:'slime' }, { k:'selfShield', n:'slime shield' }),
    travelMs:10,
    lingerMs:20,
    actionMs:30,
  });
  assert.equal(
    dom.window.document.querySelector('.combat-monster')?.classList.contains('combat-fx-motion-self-shield'),
    true,
  );
  await result;
  fx.cancelAllCombatFx();

  const style = read('style.css');
  assert.match(style, /\.combat-monster\.combat-acting\.combat-fx-motion-self-shield\s*\{\s*animation:\s*combatFxMonsterSelfShield/);
  const keyframe = style.match(/@keyframes combatFxMonsterSelfShield\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(keyframe, /scale\(1\.0[3-9]\)/);
  assert.match(keyframe, /brightness\(1\.[1-9]/);
  assert.doesNotMatch(keyframe, /translate/);
});

test('monster projectiles travel to the player, resolve at impact, and auto-remove', async () => {
  const dom = new JSDOM('<div class="combat-stage"><div class="combat-player combat-idle combat-idle-player"></div><div class="combat-monster combat-idle combat-idle-monster"></div></div>', { pretendToBeVisual:true });
  const { window } = dom;
  const stage = window.document.querySelector('.combat-stage');
  const fx = loadFxContext(window);
  const profile = {
    ...fx.getMonsterFxProfile({ type:'mushroom' }, { kind:'poison' }),
    travelMs:20,
    lingerMs:80,
    actionMs:60,
  };

  const impactReady = fx.playMonsterActionFx(profile);
  const projectile = stage.querySelector('.combat-fx-projectile');
  assert.ok(projectile);
  assert.equal(projectile.dataset.from, 'monster');
  assert.equal(projectile.dataset.to, 'player');
  assert.equal(projectile.dataset.projectile, 'poison-projectile');
  assert.equal(window.document.querySelector('.combat-monster').classList.contains('combat-acting'), true);

  await impactReady;
  assert.ok(stage.querySelector('.combat-fx-impact'));
  await new Promise((resolve) => setTimeout(resolve, profile.lingerMs + 20));
  assert.equal(stage.querySelectorAll('.combat-fx-node').length, 0);
  assert.equal(window.document.querySelector('.combat-monster').classList.contains('combat-acting'), false);
});

test('monster wind-up has no projectile and landed-hit FX owns the projectile impact', async () => {
  const dom = new JSDOM('<div class="combat-stage"><div class="combat-player"></div><div class="combat-monster"></div></div>', { pretendToBeVisual:true });
  const fx = loadFxContext(dom.window);
  const monster = { type:'mushroom' };
  const technique = { kind:'poison' };
  const action = {
    ...fx.getMonsterActionFxProfile(monster, technique),
    travelMs:10,
    lingerMs:20,
    actionMs:30,
  };

  assert.equal(action.phase, 'wind-up');
  assert.equal(action.projectile, undefined);
  const actionDone = fx.playMonsterActionFx(action);
  assert.equal(dom.window.document.querySelector('.combat-fx-projectile'), null);
  await actionDone;
  assert.equal(dom.window.document.querySelector('.combat-fx-impact'), null);

  const hit = {
    ...fx.getMonsterHitFxProfile(monster, technique),
    travelMs:10,
    lingerMs:20,
  };
  let callbackSawProjectileOnly = false;
  const hitDone = fx.playMonsterActionFx(hit, () => {
    callbackSawProjectileOnly = !!dom.window.document.querySelector('.combat-fx-projectile')
      && !dom.window.document.querySelector('.combat-fx-impact');
  });
  assert.equal(hit.phase, 'impact');
  assert.equal(hit.suppressMotion, true);
  assert.equal(dom.window.document.querySelectorAll('.combat-fx-projectile').length, 1);
  await hitDone;
  assert.equal(callbackSawProjectileOnly, true);
  assert.ok(dom.window.document.querySelector('.combat-fx-impact'));
  fx.cancelAllCombatFx();
});

test('monster self-shield keeps its monster-centered presentation in the action phase', () => {
  const fx = loadFxContext();
  const monster = { type:'slime', elite:true };
  const technique = { k:'selfShield', n:'elite shield' };
  const action = fx.getMonsterActionFxProfile(monster, technique);
  assert.equal(action.mode, 'wave');
  assert.equal(action.target, 'monster');
  assert.equal(action.projectile, undefined);
  assert.equal(action.phase, undefined);
  assert.equal(fx.getMonsterHitFxProfile(monster, technique), null);
});

test('Teacher Homework Bomb gives every hit a projectile profile', () => {
  const fx = loadFxContext();
  const hit = fx.getMonsterHitFxProfile({ type:'teacherBoss' }, { k:'multi', n:'Homework Bomb' });
  assert.equal(hit.phase, 'impact');
  assert.equal(hit.mode, 'projectile');
  assert.equal(hit.projectile, 'monster-projectile');
  assert.equal(hit.renderImpactAfterCallback, true);
});

test('actual k/n patterns apply their expected monster DOM motion classes', async () => {
  const cases = [
    [{ type:'mushroom' }, { k:'poison', n:'mushroom poison' }, 'venom-cast'],
    [{ type:'slime' }, { k:'selfShield', n:'slime shield' }, 'self-shield'],
    [{ type:'stomp' }, { k:'heavy', n:'stomp ground hit', stun:1 }, 'jump-stomp'],
    [{ type:'snake' }, { k:'poison', n:'snake venom' }, 'venom-cast'],
    [{ type:'snake' }, { k:'crit', n:'snake bite' }, 'bite'],
    [{ type:'tarantula' }, { k:'multi', n:'swamp multi bite' }, 'frenzy-claw'],
    [{ type:'zombie' }, { k:'lifesteal', n:'swamp drain bite' }, 'drain-bite'],
    [{ type:'slime', elite:true }, { k:'heavy', n:'elite heavy' }, 'heavy-charge'],
    [{ type:'slime', elite:true }, { k:'selfShield', n:'elite shield' }, 'self-shield'],
    [{ type:'teacherBoss' }, { k:'heavy', n:'boss heavy' }, 'boss-slam'],
    [{ type:'teacherBoss' }, { k:'multi', n:'boss multi' }, 'boss-barrage'],
    [{ type:'teacherBoss' }, { k:'chillPlayer', n:'boss chill' }, 'boss-cast'],
  ];

  for (const [monsterData, pattern, expectedMotion] of cases) {
    const dom = new JSDOM('<div class="combat-stage"><div class="combat-player"></div><div class="combat-monster"></div></div>');
    const fx = loadFxContext(dom.window);
    const profile = fx.getMonsterFxProfile(monsterData, pattern);
    const result = fx.playMonsterActionFx({ ...profile, travelMs:10, lingerMs:30, actionMs:30 });
    const sprite = dom.window.document.querySelector('.combat-monster');
    assert.equal(profile.motion, expectedMotion, `${monsterData.type}/${pattern.k} profile motion`);
    assert.equal(sprite.classList.contains(`combat-fx-motion-${expectedMotion}`), true, `${monsterData.type}/${pattern.k} DOM motion class`);
    fx.cancelAllCombatFx();
    assert.equal(await result, false);
  }
});

test('monster action promise resolves only after its full acting duration', async () => {
  const dom = new JSDOM('<div class="combat-stage"><div class="combat-player combat-idle combat-idle-player"></div><div class="combat-monster combat-idle combat-idle-monster"></div></div>');
  const fx = loadFxContext(dom.window);
  const monster = dom.window.document.querySelector('.combat-monster');
  const started = Date.now();
  let resolved = false;
  const result = fx.playMonsterActionFx({
    ...fx.getMonsterFxProfile({ type:'slime' }, { k:'selfShield', n:'slime shield' }),
    travelMs:10,
    lingerMs:220,
    actionMs:140,
  }).then((value) => { resolved = true; return value; });

  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.equal(resolved, false, 'log gate must remain pending while monster is acting');
  assert.equal(monster.classList.contains('combat-acting'), true);
  assert.equal(await result, true);
  assert.ok(Date.now() - started >= 120, `resolved after ${Date.now() - started}ms`);
  assert.equal(monster.classList.contains('combat-acting'), false);
  fx.cancelAllCombatFx();
});

test('reduced motion completes monster actions immediately', async () => {
  const dom = new JSDOM('<div class="combat-stage"><div class="combat-player"></div><div class="combat-monster"></div></div>');
  dom.window.matchMedia = (query) => ({ matches:query === '(prefers-reduced-motion: reduce)' });
  const fx = loadFxContext(dom.window);
  const started = Date.now();
  await fx.playMonsterActionFx({
    ...fx.getMonsterFxProfile({ type:'teacherBoss' }, { k:'multi', n:'boss multi' }),
    travelMs:500,
    lingerMs:700,
    actionMs:900,
  });
  assert.ok(Date.now() - started < 80, `reduced monster action took ${Date.now() - started}ms`);
  fx.cancelAllCombatFx();
});

test('cancelling monster fx settles false and removes its acting state', async () => {
  const dom = new JSDOM('<div class="combat-stage"><div class="combat-player combat-idle combat-idle-player"></div><div class="combat-monster combat-idle combat-idle-monster"></div></div>');
  const fx = loadFxContext(dom.window);
  const result = fx.playMonsterActionFx({
    ...fx.getMonsterFxProfile({ type:'mushroom' }, { kind:'poison' }),
    travelMs:80,
  });
  fx.cancelAllCombatFx();
  assert.equal(await result, false);
  assert.equal(dom.window.document.querySelectorAll('.combat-fx-node').length, 0);
  assert.equal(dom.window.document.querySelector('.combat-monster').classList.contains('combat-acting'), false);
});

test('game queue separates monster wind-up from per-hit FX before rendering notices', () => {
  const game = read('game.js');
  const style = read('style.css');
  assert.match(game, /YuksamCombatFx\.getMonsterActionFxProfile\(monster, pattern\)/);
  assert.match(game, /YuksamCombatFx\.getMonsterHitFxProfile\(monster, pattern\)/);
  assert.match(game, /notice\.fx\.phase === 'impact'/);
  assert.match(game, /YuksamCombatFx\.playMonsterActionFx\(notice\.fx, \(\) => \{/);
  assert.match(game, /combat-player combat-idle combat-idle-player/);
  assert.match(game, /combat-monster combat-idle combat-idle-monster/);
  assert.match(style, /\.combat-idle-player/);
  assert.match(style, /\.combat-idle-monster/);
  assert.match(style, /\.combat-acting/);
  assert.match(style, /\.fx-poison-projectile/);
  assert.match(style, /\.fx-slime-projectile/);
  assert.match(style, /\.fx-impact-ground-shockwave/);
});

test('browser smoke follows real monster selection through fx classes and ordered logs', { timeout:30000 }, () => {
  const script = join(root, 'tools', 'browser-smoke', 'try_combat_animation.js');
  const result = spawnSync(process.execPath, [script, root], { encoding:'utf8', timeout:25000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PASS: real attack selected a k\/n poison wind-up profile/);
  assert.match(result.stdout, /PASS: selected action applied motion without launching a projectile/);
  assert.match(result.stdout, /PASS: real monster log waited for the full acting motion/);
  assert.match(result.stdout, /PASS: real damage log followed the monster action log with the landed projectile impact/);
});
