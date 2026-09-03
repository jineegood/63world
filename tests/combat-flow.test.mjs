import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync as readFileRaw } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { Script, createContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
/* 소스 파일은 CRLF(\r\n)로 저장돼 있는데, 아래 검사들이 함수 덩어리를 잘라낼 때 쓰는
   정규식은 \n 기준이다. 읽는 시점에 줄바꿈을 LF로 맞춰야 슬라이스가 빈 문자열이 되지 않는다.
   (빈 문자열이 되면 assert.match는 실패하고 assert.doesNotMatch는 가짜로 통과한다.) */
const readFileSync = (path, options) => readFileRaw(path, options).replace(/\r\n/g, '\n');
const gameSource = readFileSync(join(root, 'game.js'), 'utf8');
const harnessSource = readFileSync(join(root, 'tools', 'browser-smoke', 'harness.js'), 'utf8');
const htmlSource = readFileSync(join(root, 'index.html'), 'utf8');
const styleSource = readFileSync(join(root, 'style.css'), 'utf8');
const skillHintSource = readFileSync(join(root, 'src', 'skillpoint-hint.js'), 'utf8');
const cheatPanelSource = readFileSync(join(root, 'src', 'cheat-panel.js'), 'utf8');
const patchDataSource = readFileSync(join(root, 'src', 'patch-data.js'), 'utf8');
const audioManifestSource = readFileSync(join(root, 'src', 'audio-manifest.js'), 'utf8');
const combatRulesSource = readFileSync(join(root, 'src', 'combat-rules.js'), 'utf8');
const combatRulesContext = createContext({ window: {} });
new Script(combatRulesSource, { filename: 'src/combat-rules.js' }).runInContext(combatRulesContext);
const combatRules = combatRulesContext.window.YuksamCombatRules;

test('elite zombie attack uses sixty percent of its previous doubled roll', () => {
  const createEliteBoss = gameSource.match(/createEliteBoss = function createEliteBossV17[\s\S]*?\n  };/)?.[0] || '';
  assert.match(createEliteBoss, /attack:\s*Math\.ceil\(randomInt\(20, 23\) \* 2 \* \.60\)/);
});

test('elite Hardening grants a 22.5-percent shield without changing other self shields', () => {
  const counterAttack = gameSource.match(/monsterCounterAttack = function monsterCounterAttackV25[\s\S]*?\n  };\n  window\.submitCombatAnswer/)?.[0] || '';
  assert.match(counterAttack, /\{ c: \.15, k: 'selfShield', pct: \.225, n: '단단해지기' \}/);
  assert.match(counterAttack, /slime:\s*\[\{ c:\.25, k:'selfShield', pct:\.35, n:'점액 방패' \}\]/);
  assert.match(counterAttack, /\{ c:\.20, k:'selfShield', pct:\.30, n:'대지 방패' \}/);
});

test('combat events follow the canonical turn order and omit missing stages', () => {
  const sequence = combatRules.buildCombatSequence([
    { type:'player-dot', text:'지속 피해' },
    { type:'player-damage', text:'피해' },
    { type:'answer-correct', text:'정답!' },
    { type:'retaliation', text:'반격' },
    { type:'enemy-status', text:'냉기' },
    { type:'player-hit', text:'기본 타격' },
    { type:'monster-action', text:'몬스터 공격' },
    { type:'player-extra-hit', text:'추가 타격' },
    { type:'player-status', text:'중독' },
    { type:'player-total', text:'총피해' },
  ]);
  assert.deepEqual(Array.from(sequence, event => event.type), [
    'answer-correct', 'player-hit', 'player-extra-hit', 'enemy-status', 'player-total',
    'monster-action', 'player-status', 'player-damage', 'retaliation', 'player-dot',
  ]);

  const wrongSequence = combatRules.buildCombatSequence([
    null,
    { type:'player-damage', text:'피해' },
    { type:'answer-wrong', text:'오답입니다.' },
    { type:'monster-action', text:'몬스터 공격' },
  ]);
  assert.deepEqual(Array.from(wrongSequence, event => event.type), [
    'answer-wrong', 'monster-action', 'player-damage',
  ]);
});

test('combat events preserve optional fx metadata for later animation tasks', () => {
  const fx = { motion:'slash', impact:'light', tier:2 };
  const [event] = combatRules.buildCombatSequence([
    { type:'player-hit', text:'12 피해', tone:'player-action', duration:2100, fx, preserveDuration:true },
  ]);
  assert.deepEqual({ ...event, fx:{ ...event.fx } }, {
    type:'player-hit', text:'12 피해', tone:'player-action', duration:2100, fx, preserveDuration:true,
  });
});

test('combat effects are serializable and every supported state change is consumed at most once', () => {
  const monsterDamage = { id:'turn-1-hit-1', type:'monster-damage', combatId:'monster-1', amount:7 };
  const playerDamage = { id:'turn-1-counter-1', type:'player-damage', combatId:'monster-1', amount:5, pierceDefense:false, hitIndex:0 };
  const events = combatRules.buildCombatSequence([
    { type:'player-hit', text:'7 damage', effect:monsterDamage },
    { type:'player-damage', text:'5 damage', effect:playerDamage },
  ]);
  assert.deepEqual({ ...events[0].effect }, monsterDamage);
  assert.deepEqual({ ...events[1].effect }, playerDamage);
  assert.equal(typeof events[0].effect.apply, 'undefined');

  let appliedMonsterDamage = 0;
  let appliedPlayerDamage = 0;
  const handler = combatRules.createCombatEffectHandler({
    'monster-damage': (metadata) => { appliedMonsterDamage += metadata.amount; },
    'player-damage': (metadata) => { appliedPlayerDamage += metadata.amount; },
  });
  assert.equal(handler.apply(events[0].effect), true);
  assert.equal(handler.apply(events[0].effect), false);
  assert.equal(handler.apply(events[1].effect), true);
  assert.equal(handler.apply(events[1].effect), false);
  assert.equal(appliedMonsterDamage, 7);
  assert.equal(appliedPlayerDamage, 5);
});

test('monster status effects retain one-shot merge metadata', () => {
  const [event] = combatRules.buildCombatSequence([{
    type:'enemy-status',
    text:'shadow stacks',
    effect:{ id:'turn-1-status-1', type:'monster-status', combatId:'monster-1', status:'shadow', stacks:2, mode:'add', maxStacks:20 },
  }]);

  assert.deepEqual({ ...event.effect }, {
    id:'turn-1-status-1', type:'monster-status', combatId:'monster-1', status:'shadow', turns:0, stacks:2, mode:'add', maxStacks:20,
  });
});

test('active combat flow uses typed sequence events without deprecated messages', () => {
  assert.match(gameSource, /function queueCombatSequence\(events, onComplete\)/);
  assert.match(gameSource, /type:\s*'answer-correct'/);
  assert.match(gameSource, /type:\s*'answer-wrong'/);
  assert.doesNotMatch(gameSource, /적이 충격을 받았습니다|피해를 받지 않았다!/);
  assert.match(styleSource, /\.combat-notice\.enemy-action[\s\S]*#fca5a5/);
  assert.match(styleSource, /\.combat-log\.enemy-action[\s\S]*#fca5a5/);
});

test('active async combat flow prevents escape reentry and emits poison last', { timeout:30000 }, () => {
  const script = join(root, 'tools', 'browser-smoke', 'try_combat_sequence.js');
  const result = spawnSync(process.execPath, [script, root], { encoding:'utf8', timeout:25000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PASS: projectile monsters wind up on their action and launch at the landed damage notice/);
  assert.match(result.stdout, /PASS: missed monster hits play miss audio without a damaging projectile impact/);
  assert.match(result.stdout, /PASS: wrong answer and its correction share the first event/);
  assert.match(result.stdout, /PASS: escape during an active sequence does not add damage/);
  assert.match(result.stdout, /PASS: poison is the final event/);
  assert.match(result.stdout, /PASS: elite Hardening emits only its technique and shield events/);
});

test('jsdom combat state changes occur on their matching queued events', { timeout:40000 }, () => {
  const script = join(root, 'tools', 'browser-smoke', 'try_combat_event_timing.js');
  const result = spawnSync(process.execPath, [script, root], { encoding:'utf8', timeout:35000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PASS: monster status and shield wait for their status notices/);
  assert.match(result.stdout, /PASS: monster multi-hit applies each hit in sequence/);
  assert.match(result.stdout, /PASS: Weapon Mastery reflects the pre-shield critical damage after the enemy damage log/);
  assert.match(result.stdout, /PASS: Weapon Mastery ranks 1 through 4 floor the fractional critical reflection schedule/);
  assert.match(result.stdout, /PASS: Weapon Mastery retaliation omits healing without changing player HP or producing NaN/);
  assert.match(result.stdout, /PASS: Weapon Mastery does not reflect misses, non-critical hits, or fatal critical hits/);
  assert.match(result.stdout, /PASS: fatal damage queues no unapplied retaliation/);
  assert.match(result.stdout, /PASS: correct answer remains visible before the basic attack log/);
  assert.match(result.stdout, /PASS: Shield Charge presents a defensive shield wave before its charge hit/);
  assert.match(result.stdout, /PASS: Elite Hardening presents a monster shield wave without an attack projectile/);
  assert.match(result.stdout, /PASS: Warrior Basic Strike bypasses shields while a normal attack is absorbed/);
  assert.match(result.stdout, /PASS: Final Judgment answer and charge notices use their dedicated timings/);
  assert.match(result.stdout, /PASS: charged multi-hit release times each hit and consumes charge on the first applied damage only/);
  assert.match(result.stdout, /PASS: charged multi-hit miss preserves charge until the second hit lands/);
  assert.match(result.stdout, /PASS: floating damage stays in the combat stage and clears on queue replacement/);
  assert.match(result.stdout, /PASS: replacing the multi-hit queue cancels the second hit/);
  assert.match(result.stdout, /PASS: player skill monster statuses wait for their enemy status notices/);
  assert.match(result.stdout, /PASS: replacing a skill queue leaves its pending status unapplied/);
  assert.match(result.stdout, /PASS: invalidating a skill queue leaves its pending status unapplied/);
  assert.match(result.stdout, /PASS: Fire basic attacks retain the universal 150 percent critical multiplier/);
  assert.match(result.stdout, /PASS: Fire multi-hit skills roll each hit critical independently/);
  assert.match(result.stdout, /PASS: Fire skill critical hits use the Ember rank table from 200 through 300 percent/);
  assert.match(result.stdout, /PASS: Holy attacks can critically hit again \(v51\) alongside Shadow and other classes/);
  assert.match(result.stdout, /PASS: Void Mastery ranks one through five apply their boundary critical rolls to shadow ticks/);
  assert.match(result.stdout, /PASS: Teacher base, Heavy, and Homework Bomb damage keep their bonus then take the final 30 percent nerf/);
  assert.match(result.stdout, /PASS: Teacher Homework Bomb gives each of its two landed notices its own projectile impact/);
  assert.match(result.stdout, /PASS: Teacher chill halves the already-buffed base damage before the final 30 percent nerf and consumes one chill turn/);
});

test('jsdom Shield Charge uses its new shield before capped critical damage and Guardian Oath clears it on revive', { timeout:40000 }, () => {
  const script = join(root, 'tools', 'browser-smoke', 'try_skills2.js');
  const result = spawnSync(process.execPath, [script, root], { encoding:'utf8', timeout:35000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PASS: Shield Charge adds its shield before deriving capped normal damage/);
  assert.match(result.stdout, /PASS: Shield Charge caps a large shield at 100 normal damage/);
  assert.match(result.stdout, /PASS: Shield Charge can critically hit for the capped 150 damage/);
  assert.match(result.stdout, /PASS: Shield Charge chill remains a downstream half-damage modifier/);
  assert.match(result.stdout, /PASS: Shield Charge miss deals no damage but keeps its before-phase shield and miss event path/);
  assert.match(result.stdout, /PASS: Guardian Oath revival frame clears the existing combat shield/);
});

test('combat action changes reuse the locked turn question', () => {
  const attackHandler = gameSource.match(/window\.chooseCombatAction = function chooseCombatAction[\s\S]*?\n};/)?.[0] || '';
  const skillHandler = gameSource.match(/window\.chooseActiveSkill = function chooseActiveSkill[\s\S]*?\n};/)?.[0] || '';
  assert.match(attackHandler, /game\.currentQuestion \|\|= getQuestionForZone/);
  assert.match(skillHandler, /game\.currentQuestion \|\|= getQuestionForZone/);
  assert.doesNotMatch(attackHandler, /game\.currentQuestion = getQuestionForZone/);
  assert.doesNotMatch(skillHandler, /game\.currentQuestion = getQuestionForZone/);
});

test('question selection has no emergency default fallback', () => {
  const selector = gameSource.match(/function getQuestionForZone\(zoneKey\)[\s\S]*?\n}/)?.[0] || '';
  assert.match(selector, /selectEnabledQuestion/);
  assert.doesNotMatch(selector, /긴급기본|1 \+ 1/);
});

test('combat question UI explains when no workbook is enabled', () => {
  assert.match(gameSource, /선생님이 활성화한 문제집이 없습니다\./);
});

test('browser smoke harness resolves jsdom from the portable workspace dependency folder', () => {
  assert.doesNotMatch(harnessSource, /\/tmp\/node_modules\/jsdom/);
  assert.match(harnessSource, /\.codex_work[\s\S]*browser-smoke[\s\S]*node_modules[\s\S]*jsdom/);
});

test('combat effects use the sequential notice queue and extended delay', () => {
  assert.match(gameSource, /function queueCombatNoticesV42/);
  assert.match(gameSource, /YuksamCombatRules\.combatNoticeDelay\(1920\)/);
  assert.match(gameSource, /중독으로 독이 몸을 갉아먹습니다!/);
  assert.match(gameSource, /playerAilments\.stunTurns/);
  assert.match(gameSource, /신앙의 광채로 인해 공격이 빗나갔다!/);
});

test('combat status badges are tooltip-ready and include Guardian Oath readiness', () => {
  assert.match(gameSource, /YuksamCombatRules\.buildStatusBadges/);
  assert.match(gameSource, /guardianOathReady/);
  assert.match(gameSource, /data-tooltip=/);
  assert.match(gameSource, /맹세 준비/);
});

test('V25 chill is consumed by damaging player actions and covers both monster multi-hit values', () => {
  const counterAttack = gameSource.match(/monsterCounterAttack = function monsterCounterAttackV25[\s\S]*?\n  };\n  window\.submitCombatAnswer/)?.[0] || '';
  const actionDamage = gameSource.match(/function calculateActionDamageV25\(\)[\s\S]*?\n  }\n  function applyShadowDotAfterEnemyAttackV25/)?.[0] || '';
  assert.doesNotMatch(counterAttack, /playerChillTurns > 0\) game\.playerChillTurns -= 1/);
  assert.match(actionDamage, /applyPlayerChillToActionV25/);
  assert.match(counterAttack, /applyChillToAttack\(\[incoming, extraHit\]/);
});

test('Warrior Basic Strike bypasses monster shields through every player damage stage', () => {
  const actionDamage = gameSource.match(/function calculateActionDamageV25\(\)[\s\S]*?\n  }\n  function applyShadowDotAfterEnemyAttackV25/)?.[0] || '';
  const submitAnswer = gameSource.match(/window\.submitCombatAnswer = function submitCombatAnswer[\s\S]*?\n  };/)?.[0] || '';
  const effectHandlers = gameSource.match(/const combatEffectHandlerV42 = YuksamCombatRules\.createCombatEffectHandler\(\{[\s\S]*?\n  }\);/)?.[0] || '';
  const monsterDamageEffects = submitAnswer.match(/type\s*:\s*'monster-damage'/g) || [];
  const shieldBypassMetadata = submitAnswer.match(/ignoreShield\s*:\s*result\.ignoreShield\s*===\s*true/g) || [];

  assert.match(actionDamage, /ignoreShield\s*:\s*active\?\.ignoreShield\s*===\s*true/);
  assert.ok(monsterDamageEffects.length > 0, 'player action flow should emit monster-damage effects');
  assert.equal(shieldBypassMetadata.length, monsterDamageEffects.length,
    'every player-created monster-damage effect should carry the action shield-bypass flag');
  assert.match(gameSource, /function applyDamageToMonsterV40\(monster,\s*dmg,\s*\{\s*ignoreShield\s*=\s*false\s*\}\s*=\s*\{\}\)/);
  assert.match(effectHandlers, /applyDamageToMonsterV40\(monster,\s*effect\.amount,\s*\{\s*ignoreShield\s*:\s*effect\.ignoreShield\s*===\s*true\s*\}\)/);
});

test('final combat integration uses approved balance helpers', () => {
  assert.match(gameSource, /YuksamCombatRules\.mageBasicCriticalDamage/);
  assert.match(gameSource, /active\.type === 'healAllies'/);
  assert.match(gameSource, /YuksamCombatRules\.planLivingAllyHeals/);
  assert.match(gameSource, /game\.player\.hp\s*\/\s*Math\.max\(1, game\.player\.maxHp\)\s*<=\s*triggerHpPct/);
  assert.match(gameSource, /game\.elementalBarrierUsed\s*=\s*true/);
  assert.doesNotMatch(gameSource, /executeHpThreshold\(getSkillRank\('mage_basic_element'\)\)/);
  assert.match(gameSource, /YuksamCombatRules\.scaleMonsterStats/);
  assert.match(gameSource, /YuksamCombatRules\.rollEnhancement\(next\.successChance, Math\.random\(\)\)/);
});

test('enhancement display rate stays separate from the actual success rate', () => {
  const rateHelper = gameSource.match(/function upgradeRatesHtmlV33\(\)[\s\S]*?\n  }/)?.[0] || '';
  assert.match(rateHelper, /TIER_INFO_V27/);
  assert.match(rateHelper, /tier\.chance/);
  assert.doesNotMatch(rateHelper, /tier\.successChance/);
  assert.doesNotMatch(rateHelper, /70%|50%|30%|10%/);
  assert.match(patchDataSource, /chance:\.80, successChance:\.80/);
  assert.match(patchDataSource, /chance:\.60, successChance:\.60/);
  assert.match(patchDataSource, /chance:\.40, successChance:\.40/);
  assert.match(patchDataSource, /chance:\.20, successChance:\.15/);
});

test('HUD logout and in-window skill point hint use the approved layout', () => {
  assert.match(htmlSource, /id="logoutBtn" class="[^"]*danger/);
  assert.match(styleSource, /#logoutBtn/);
  assert.match(gameSource, /skillpoint-hint-v42/);
  assert.doesNotMatch(skillHintSource, /positionBubble|document\.body\.appendChild\(bubble\)/);
});

test('all equipped weapon render paths use the shared tier style', () => {
  assert.match(gameSource, /function getEquippedWeaponTierStyle\(player\)/);
  assert.match(gameSource, /window\.getEquippedWeaponTierStyle = getEquippedWeaponTierStyle/);
  assert.match(gameSource, /drawHumanoid[\s\S]*getEquippedWeaponTierStyle/);
  assert.match(gameSource, /function openCharacterPanelV33[\s\S]*getEquippedWeaponTierStyle/);
  assert.match(gameSource, /function openUpgradeShopModalV33[\s\S]*getEquippedWeaponTierStyle/);
  assert.match(gameSource, /shadowColor = weaponTierStyle\.color/);
  assert.match(gameSource, /strokeStyle = weaponTierStyle\.color/);
  assert.match(gameSource, /weaponTierStyle\.tier > 0/);
});

/* 치트는 교사 서버 인증(requireTeacherCheatAccessV3)을 거치도록 바뀌면서 async 함수가 되었다.
   즉시 강화라는 성격(무작위·비용·퀘스트 진행 없음)은 그대로 지켜야 하고,
   교사 인증을 먼저 통과해야 한다는 점이 새로 지켜야 할 규칙이다. */
test('instant weapon upgrade cheat is wired without the normal enhancement resolver', () => {
  assert.match(gameSource, /window\.cheatUpgradeEquippedWeapon\s*=\s*async function/);
  assert.match(cheatPanelSource, /cheatUpgradeWeaponBtn/);
  assert.match(cheatPanelSource, /cheatUpgradeEquippedWeapon/);
  assert.match(htmlSource, /id="cheatUpgradeWeaponBtn"/);
  const cheatResolver = gameSource.match(/window\.cheatUpgradeEquippedWeapon\s*=\s*async function[\s\S]*?\n};/)?.[0] || '';
  assert.match(cheatResolver, /if \(!\(await window\.requireTeacherCheatAccessV3\?\.\(\)\)\) return false;/);
  assert.notEqual(cheatResolver, '');
  assert.doesNotMatch(cheatResolver, /Math\.random|rollEnhancement|recordQuestAction|building\s*[-+]=/);
  const normalizer = gameSource.match(/function normalizePlayer\(p\)[\s\S]*?\n}/)?.[0] || '';
  assert.match(normalizer, /weaponUpgrades:\s*p\.weaponUpgrades/);
});

test('weapon tier visuals and instant upgrade pass the focused browser smoke', { timeout:30000 }, () => {
  const script = join(root, 'tools', 'browser-smoke', 'try_weapon_tiers.js');
  const result = spawnSync(process.execPath, [script, root], { encoding:'utf8', timeout:25000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PASS: every weapon id shares the canonical enhanced tier styles/);
  assert.match(result.stdout, /PASS: tier zero has no enhancement effect while enhanced tiers add outline and aura/);
  assert.match(result.stdout, /PASS: weapon aura canvas state is restored after drawing/);
  assert.match(result.stdout, /PASS: instant cheat advances one tier per click without cost or quest progress/);
  assert.match(result.stdout, /PASS: instant cheat redraws the active combat canvas with the next tier/);
  assert.match(result.stdout, /PASS: legendary tier cap is preserved and explained after consecutive upgrades/);
});

test('FX browser smoke completes its guardian revive path', { timeout:40000 }, () => {
  const script = join(root, 'tools', 'browser-smoke', 'try_fx.js');
  const result = spawnSync(process.execPath, [script, root], { encoding:'utf8', timeout:35000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PASS: 수호자의 맹세 부활 발동\(bastionUsed\)/);
  assert.match(result.stdout, /PASS: 수호자의 맹세 오디오가 한 번 생성됨/);
});

test('narrow equipment layout keeps tiered weapon slots inside the modal', () => {
  assert.match(styleSource, /@media \(max-width: 760px\)[\s\S]*\.character-panel-v33\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(styleSource, /@media \(max-width: 760px\)[\s\S]*\.character-window-v33 \.paper-slot\s*\{[^}]*width:\s*min\(/);
});

test('quest rewards use the supplied completion audio with generic fallback', () => {
  assert.match(gameSource, /playQuestCompletionSoundV42/);
});

test('BGM synchronization selects and starts the desired file only once', () => {
  const syncV21 = gameSource.match(/syncAudioFileBgm = function syncAudioFileBgmV21\(\) \{[\s\S]*?\n  };/)?.[0] || '';
  assert.doesNotMatch(syncV21, /oldSyncAudioFileBgmV21\(\)/);
  assert.match(syncV21, /const desired = getDesiredAudioFile\(\)/);
  assert.equal((syncV21.match(/file\.play\(\)/g) || []).length, 1);
});

/* 제작자 방향(복구본): 일반 몬스터 전투는 전투 BGM으로 갈아타지 않고 그 맵의 음악을 그대로 유지한다.
   전투 BGM(battleFile)은 이제 PVP 전용이고, 보스방만 보스 음악을 쓴다.
   누가 실수로 예전처럼 "일반 전투 → 전투 BGM"을 되살리면 이 검사가 잡아낸다. */
test('normal combat keeps the map BGM while boss rooms use boss BGM and battle BGM is PvP-only', () => {
  const desiredV21 = gameSource.match(/getDesiredAudioFile = function getDesiredAudioFileV21\(\) \{[\s\S]*?\n  };/)?.[0] || '';
  const syncV21 = gameSource.match(/syncAudioFileBgm = function syncAudioFileBgmV21\(\) \{[\s\S]*?\n  };/)?.[0] || '';
  const enterCombat = gameSource.match(/function enterBaseCombat\(monster\) \{[\s\S]*?\n}/)?.[0] || '';
  const finishDefeat = gameSource.match(/function finishMonsterDefeatV25\([\s\S]*?\n  }/)?.[0] || '';
  assert.notEqual(desiredV21, '');
  assert.match(audioManifestSource, /battleBgm:\s*\{\s*src:'assets\/1\. 전투씬 음악\.mp3'/);
  // 전투 BGM은 오직 PVP가 진행 중일 때만 고른다.
  assert.match(desiredV21, /getActivePvpMatchV1[\s\S]*?game\.audio\.battleFile/);
  // 일반 전투 중이라는 이유로 음악을 바꾸지 않는다.
  assert.doesNotMatch(desiredV21, /game\.currentCombatMonsterId/);
  // 보스방은 보스 음악을 유지한다.
  assert.match(desiredV21, /game\.currentMap === 'bossRoom'[\s\S]*?game\.audio\.bossFile/);
  assert.match(syncV21, /game\.audio\.battleFile/);
  // 전투 진입·종료 시 음악 상태를 다시 맞춰 준다(맵 음악이 계속 이어지도록).
  assert.match(enterCombat, /game\.currentCombatMonsterId = monster\.id;[\s\S]*?syncAudioFileBgm\(\)/);
  assert.match(finishDefeat, /game\.currentCombatMonsterId = null;[\s\S]*?syncAudioFileBgm\(\)/);
});

test('Offensive Armor sound is queued once with its extra-hit impact, not its calculation', () => {
  const submitAnswer = gameSource.match(/window\.submitCombatAnswer = function submitCombatAnswer[\s\S]*?\n  };/)?.[0] || '';
  const armorEffect = submitAnswer.match(/effect:\{[\s\S]*?\n          },\n          fx:\{/)?.[0] || '';
  assert.doesNotMatch(armorEffect, /audioId:'offensiveArmor'/);
  assert.equal((submitAnswer.match(/audioId:'offensiveArmor'/g) || []).length, 1);
  assert.match(submitAnswer, /motion:hit\.label === '공세 갑옷' \? 'offensive-armor-bump'/);
  assert.match(submitAnswer, /hit\.label === '공세 갑옷' \? \{ audioId:'offensiveArmor', fallbackSfx:'hit' \}/);
});

test('critical feedback uses the manifest file once and synthesizes only when it cannot play', () => {
  assert.match(gameSource, /audioAdapters\.criticalVisuals\.push\(triggerCriticalFlashV23\)/);
  assert.match(gameSource, /audioAdapters\.criticalVisuals\.push\(strongCriticalFeedbackV24\)/);
  assert.match(gameSource, /activePlaySfx = window\.YuksamAudioDispatcher\.create\(\{/);
  assert.match(gameSource, /playMapped:\(audioId, fallback\) => window\.playMappedAudio\?\.\(audioId, \{ onFallback:fallback \}\) \|\| false/);
  assert.match(gameSource, /playPlayerHitFallback:playPlayerHitSfx/);
  assert.doesNotMatch(gameSource, /playSfxV25/);
});

test('critical feedback is emitted even when a monster shield absorbs all HP damage', () => {
  const monsterDamage = gameSource.match(/'monster-damage': \(effect\) => \{[\s\S]*?\n    },\n    'monster-status'/)?.[0] || '';
  assert.match(monsterDamage, /if \(effect\.critical\) playSfx\('critical'\)/);
  assert.doesNotMatch(monsterDamage, /effect\.critical && actualDamage > 0/);
  assert.match(monsterDamage, /if \(actualDamage > 0\) showCombatFloatingNumberV49\('monster', actualDamage, 'damage', effect\.critical\)/);
});

test('shield loss has its own negative number and full absorption sound', () => {
  const monsterDamage = gameSource.match(/'monster-damage': \(effect\) => \{[\s\S]*?\n    },\n    'monster-status'/)?.[0] || '';
  const playerDamage = gameSource.match(/'player-damage': \(effect\) => \{[\s\S]*?\n    },\n    'retaliation'/)?.[0] || '';
  assert.match(gameSource, /\['damage', 'heal', 'shield', 'shield-damage'\]/);
  assert.match(gameSource, /kind === 'damage' \|\| kind === 'shield-damage'/);
  assert.match(monsterDamage, /showCombatFloatingNumberV49\('monster', shieldDamage, 'shield-damage'\)/);
  assert.match(playerDamage, /showCombatFloatingNumberV49\('player', shieldDamage, 'shield-damage'\)/);
  assert.match(monsterDamage, /if \(fullyBlocked\) playSfx\('shieldBlock'\)/);
  assert.match(playerDamage, /if \(fullyBlocked\) playSfx\('shieldBlock'\)/);
  assert.match(audioManifestSource, /shieldBlock:\s*\{\s*src:'assets\/3\. 보호막으로만 다 데미지 막혔을때 소리\.mp3'/);
});

test('every damaging combat effect shakes the struck actor only', () => {
  const handlers = gameSource.match(/const combatEffectHandlerV42 = YuksamCombatRules\.createCombatEffectHandler\(\{[\s\S]*?\n  }\);/)?.[0] || '';
  const retaliation = handlers.match(/'retaliation': \(effect\) => \{[\s\S]*?\n    },/)?.[0] || '';
  assert.match(retaliation, /setCombatImpactV44\('monster'/);
  assert.doesNotMatch(retaliation, /querySelectorAll\('\.combat-sprite/);
});

test('active skill sound and ultimate visuals are queued with the skill notice', () => {
  const submitAnswer = gameSource.match(/window\.submitCombatAnswer = function submitCombatAnswer[\s\S]*?\n  };/)?.[0] || '';
  assert.doesNotMatch(submitAnswer, /playSkillSfxV42\?\.\(activeSkill\.id/);
  assert.doesNotMatch(submitAnswer, /if \(activeSkill\?\.kind === 'ultimate'\) window\.playUltimateFxV41/);
  assert.match(submitAnswer, /actionAudioId/);
  assert.match(submitAnswer, /ultimateId/);
});

test('support skill state changes are deferred into queued combat effects', () => {
  const actionDamage = gameSource.match(/function calculateActionDamageV25\(\)[\s\S]*?\n  }\n  function takePendingPlayerPoisonV42/)?.[0] || '';
  const effectHandlers = gameSource.match(/const combatEffectHandlerV42 = YuksamCombatRules\.createCombatEffectHandler\(\{[\s\S]*?\n  }\);/)?.[0] || '';
  assert.match(actionDamage, /supportEffects/);
  assert.doesNotMatch(actionDamage, /game\.player\.hp = Math\.min/);
  assert.doesNotMatch(actionDamage, /game\.combatShield = Math\.max/);
  assert.match(effectHandlers, /'player-support'/);
  assert.match(gameSource, /type:'player-support'/);
  assert.doesNotMatch(actionDamage, /window\.playUltimateFxV41/);
  assert.doesNotMatch(actionDamage, /game\.chargeActive = false/);
});

test('Final Judgment uses dedicated queue timings and no charge-consumption support message', () => {
  const actionDamage = gameSource.match(/function calculateActionDamageV25\(\)[\s\S]*?\n  }\n  function takePendingPlayerPoisonV42/)?.[0] || '';
  const submitAnswer = gameSource.match(/window\.submitCombatAnswer = function submitCombatAnswer[\s\S]*?\n  };/)?.[0] || '';
  const effectHandlers = gameSource.match(/const combatEffectHandlerV42 = YuksamCombatRules\.createCombatEffectHandler\(\{[\s\S]*?\n  }\);/)?.[0] || '';
  assert.match(gameSource, /const CORRECT_ANSWER_NOTICE_DELAY_V48 = 800;/);
  assert.match(gameSource, /const CHARGE_NOTICE_DELAY_V48 = 1500;/);
  assert.match(gameSource, /const CHARGE_RELEASE_HIT_NOTICE_DELAY_V48 = 1500;/);
  assert.match(actionDamage, /support\('charge',[\s\S]*?CHARGE_NOTICE_DELAY_V48/);
  assert.doesNotMatch(actionDamage, /consume-charge|모아둔 힘을 모두 사용했다\./);
  assert.match(submitAnswer, /duration:CORRECT_ANSWER_NOTICE_DELAY_V48/);
  assert.match(submitAnswer, /result\.chargeRelease \? CHARGE_RELEASE_HIT_NOTICE_DELAY_V48 : skillLogDelay/);
  assert.match(submitAnswer, /consumeCharge:true/);
  assert.match(effectHandlers, /effect\.consumeCharge[\s\S]*?game\.chargeActive = false/);
});

test('only the synthesized player-hit path doubles the original hit gain and clamps it', () => {
  const coreSfx = gameSource.match(/function playSynthSfx\(name\) \{[\s\S]*?\n}\n\nconst audioAdapters/ )?.[0] || '';
  const playerDamage = gameSource.match(/'player-damage': \(effect\) => \{[\s\S]*?\n    },\n    'retaliation'/)?.[0] || '';
  assert.match(gameSource, /function playPlayerHitSfx\(\) \{[\s\S]*?\.40[\s\S]*?\.20/);
  assert.match(coreSfx, /name === 'hit'\) \{ playTone\(180, \.10, 'sawtooth', \.20\); setTimeout\(\(\) => playTone\(92, \.09, 'square', \.10\)/);
  assert.match(gameSource, /const v = Math\.min\(1, Math\.max\(0, volume \*/);
  assert.match(playerDamage, /if \(effect\.critical\) playSfx\('critical'\)/);
});

test('quest completion uses its manifest sound while quest acceptance keeps the synthesized cue', () => {
  const reward = gameSource.match(/window\.claimQuestReward = function claimQuestRewardV21\(id\) \{[\s\S]*?\n  };/)?.[0] || '';
  /* 치유의 우물 퀘스트가 들어오면서 acceptCurrentQuestV21이 여러 줄로 길어졌다.
     예전처럼 첫 줄만 잘라보면 안 되고 함수 전체를 봐야 한다. */
  const accept = gameSource.match(/window\.acceptCurrentQuest = function acceptCurrentQuestV21\(id\) \{[\s\S]*?\n  };/)?.[0] || '';
  assert.notEqual(accept, '');
  assert.match(reward, /playQuestCompletionSoundV42/);
  assert.match(reward, /playSfx\('quest'\)/);
  assert.match(accept, /playSfx\('quest'\)/);
  assert.doesNotMatch(accept, /playQuestCompletionSoundV42/);
});

test('legacy direct counterattacks use the doubled player-hit sound after wrong answers and player stuns', () => {
  const legacyCounter = gameSource.match(/function monsterCounterAttack\(messagePrefix = ''\) \{[\s\S]*?\n}\n\nfunction openCharacterPanel/)?.[0] || '';
  const submitAnswer = gameSource.match(/window\.submitCombatAnswer = function submitCombatAnswer[\s\S]*?\n  };/)?.[0] || '';
  const wrongAnswer = gameSource.match(/function resolveWrongAnswerV2[\s\S]*?\n  }/)?.[0] || '';
  const v25Counter = gameSource.match(/monsterCounterAttack = function monsterCounterAttackV25[\s\S]*?\n  };\n  window\.submitCombatAnswer/)?.[0] || '';
  assert.match(legacyCounter, /playPlayerHitSfx\(\)/);
  assert.doesNotMatch(legacyCounter, /playSfx\('hit'\)/);
  /* 오답이면 곧바로 반격하지 않는다. 정답을 초록색으로 2초 보여 준 뒤(YuksamWrongAnswerReview.reveal)
     그 사이 전투가 바뀌지 않았는지 다시 확인하고(fresh) 반격을 재생한다. */
  assert.match(submitAnswer, /game\.wrongAnswerReviewing = true;/);
  assert.match(submitAnswer, /const fresh = currentCombatMonster\(\);[\s\S]*?fresh\.id !== monster\.id/);
  assert.match(submitAnswer, /YuksamWrongAnswerReview\.reveal\(\{[\s\S]*?onComplete:\(\) => \{[\s\S]*?resolveWrongAnswerV2\(fresh\);/);
  assert.match(wrongAnswer, /type:'answer-wrong'[\s\S]*?monsterCounterAttack\(''\)/);
  assert.match(v25Counter, /playerAilments\?\.stunTurns > 0[\s\S]*?monsterCounterAttack\(''\)/);
});

test('combat feedback is timed per hit and preserves only explicit healing', () => {
  assert.match(gameSource, /YuksamCombatRules\.shortenCombatDelay\(YuksamCombatRules\.combatNoticeDelay\(1920\)\)/);
  assert.match(gameSource, /hitInfo\.filter\(\(hit\) => hit\.dmg > 0\)\.length > 1/);
  assert.doesNotMatch(gameSource, /전투 효과가 적용되었습니다\./);
  assert.match(gameSource, /상대는 강력한 냉기에 의해 얼어붙어 기절했다!/);
  assert.doesNotMatch(gameSource, /Math\.ceil\(damage \* 0\.35\)/);
  const actionDamage = gameSource.match(/function calculateActionDamageV25\(\)[\s\S]*?\n  }\n  function takePendingPlayerPoisonV42/)?.[0] || '';
  assert.doesNotMatch(actionDamage, /playSfx\('critical'\)/);
  assert.match(actionDamage, /active\.type === 'damageHeal'/);
  assert.match(gameSource, /function showCombatFloatingNumberV49\(/);
  assert.match(gameSource, /showCombatFloatingNumberV49\('monster', actualDamage, 'damage', effect\.critical\)/);
  assert.doesNotMatch(gameSource, /document\.body\.appendChild\(number\)/);
  assert.match(gameSource, /stage\.appendChild\(number\)/);
  assert.equal((gameSource.match(/combatResolutionEventsV42\.clear\(\)/g) || []).length, 1);
  assert.match(gameSource, /resetTransient:\(\) => \{[\s\S]*combatResolutionEventsV42\.clear\(\)/);
});

test('player hostile hits store one independent ten-percent miss result per hit', () => {
  const actionDamage = gameSource.match(/function calculateActionDamageV25\(\)[\s\S]*?\n  }\n  function takePendingPlayerPoisonV42/)?.[0] || '';
  const submitAnswer = gameSource.match(/window\.submitCombatAnswer = function submitCombatAnswer[\s\S]*?\n  };/)?.[0] || '';
  const finishAction = gameSource.match(/function finishPlayerActionV39\([\s\S]*?\n  };/)?.[0] || '';
  assert.match(actionDamage, /rollHostileHit\(0\.10, Math\.random\(\)\)/);
  assert.match(actionDamage, /missed:\s*true/);
  assert.match(actionDamage, /crit:\s*false/);
  assert.match(submitAnswer, /hit\.missed/);
  assert.match(submitAnswer, /const hitAudioId = hit\.missed[\s\S]*?\? 'miss'/);
  assert.match(finishAction, /landedAction/);
});

test('monster multi-hit attacks roll misses per hit and retain the priest bonus', () => {
  const counterAttack = gameSource.match(/monsterCounterAttack = function monsterCounterAttackV25[\s\S]*?\n  };\n  window\.submitCombatAnswer/)?.[0] || '';
  assert.match(counterAttack, /combinedMonsterMissChance/);
  assert.match(counterAttack, /plannedAmounts\.map/);
  assert.match(counterAttack, /missedByFaith/);
  assert.match(counterAttack, /audioId:'miss'/);
});

test('Double Attack follow-up uses the class basic sound or miss sound at its own log', () => {
  const submitAnswer = gameSource.match(/window\.submitCombatAnswer = function submitCombatAnswer[\s\S]*?\n  };/)?.[0] || '';
  const finishAction = gameSource.match(/function finishPlayerActionV39\([\s\S]*?\n  };/)?.[0] || '';
  assert.match(submitAnswer, /hit\.label === '더블 어택'/);
  assert.match(submitAnswer, /classBasicSounds/);
  assert.match(submitAnswer, /const hitAudioId = hit\.missed[\s\S]*?\? 'miss'/);
  assert.match(finishAction, /hitInfo\.filter\(\(hit\) => hit\.dmg > 0\)\.length > 1/);
});

test('floating damage uses the same red palette for both combat targets', () => {
  assert.match(styleSource, /\.combat-floating-damage\.player\s*\{[^}]*color:\s*#fca5a5;[^}]*\}/);
  assert.match(styleSource, /\.combat-floating-damage\.monster\s*\{[^}]*color:\s*#fca5a5;[^}]*\}/);
});

test('floating damage travels outward diagonally with stronger text for 1.2 seconds', () => {
  assert.match(gameSource, /}, 1200\);/);
  assert.match(styleSource, /animation:\s*combatFloatingDamage\s+1\.2s/);
  assert.match(styleSource, /font-family:[^;]*Arial Black/);
  assert.match(styleSource, /-webkit-text-stroke:/);
  assert.match(styleSource, /\.combat-floating-damage\.player\s*\{[^}]*--float-x:/s);
  assert.match(styleSource, /\.combat-floating-damage\.monster\s*\{[^}]*--float-x:/s);
  assert.match(styleSource, /translate\(calc\(-50% \+ var\(--float-x\)\), calc\(-50% - 110px\)\)/);
});

test('floating combat numbers begin at the visual center of their actor', () => {
  const floatingNumber = gameSource.match(/function showCombatFloatingNumberV49\([\s\S]*?\n  }/)?.[0] || '';
  assert.match(floatingNumber, /rect\.left - stageRect\.left \+ rect\.width \* \.5/);
  assert.match(floatingNumber, /rect\.top - stageRect\.top \+ rect\.height \* \.5/);
  assert.doesNotMatch(floatingNumber, /rect\.left - stageRect\.left - 8/);
  assert.doesNotMatch(floatingNumber, /rect\.right - stageRect\.left \+ 8/);
});

test('combat notice effects apply before the matching frame is rendered', () => {
  const renderNotice = gameSource.match(/const renderNotice = \(\) => \{[\s\S]*?\n      };/)?.[0] || '';
  assert.ok(renderNotice.indexOf('applyNoticeEffect();') < renderNotice.indexOf('renderCombatFrame('));
  assert.ok(renderNotice.indexOf('flushCombatEffectFeedbackV46') > renderNotice.indexOf('renderCombatFrame('));
});

test('warrior feedback queues Block Training before the counterattack and tags its extra hit motion', () => {
  const counterAttack = gameSource.match(/monsterCounterAttack = function monsterCounterAttackV25[\s\S]*?\r?\n  };\r?\n  window\.submitCombatAnswer/)?.[0] || '';
  const submitAnswer = gameSource.match(/window\.submitCombatAnswer = function submitCombatAnswer[\s\S]*?\r?\n  };\r?\n\r?\n  \/\//)?.[0] || '';
  assert.match(counterAttack, /guardGain = Math\.max\(1, Math\.floor\(game\.player\.hp \* guardShieldPct\)\)/);
  assert.match(counterAttack, /text:`막기 훈련으로 보호막 \$\{guardGain\}을 생성했다!`/);
  assert.match(counterAttack, /effect:makeCounterEffect\('player-status', \{ status:'shield', damage:guardGain \}\)/);
  assert.match(counterAttack, /if \(blockTrainingNotice\) monsterEvents\.push\(blockTrainingNotice\);[\s\S]*type:'monster-action'/);
  assert.match(submitAnswer, /motion:hit\.label === '공세 갑옷' \? 'offensive-armor-bump' : activeFxProfile\.motion/);
});

test('approved critical balance, charge tooltip, execution sound, and player log delay are wired', () => {
  const criticalRules = gameSource.match(/function playerCritChanceV25\(\)[\s\S]*?\n  function incomingMultV25/)?.[0] || '';
  assert.match(gameSource, /const PLAYER_ATTACK_NOTICE_DELAY_V46 = COMBAT_CUSTOM_NOTICE_DELAY_V43 \+ 400/);
  assert.match(gameSource, /data-tooltip="다음 공격이 강해집니다\."/);
  assert.match(gameSource, /audioId:'execution'/);
  assert.match(criticalRules, /let m = isFireSkill \? 2\.0 : 1\.5/);
  assert.match(criticalRules, /isSkillHit[\s\S]*?currentSpecV25\(\) === '화염'/);
  assert.match(criticalRules, /critChanceBonus/);
  assert.match(criticalRules, /critDmgBonus/);
});

test('Fire critical calculation consumes the Ember schedule and Holy attacks can crit again', () => {
  const criticalRules = gameSource.match(/function playerCritChanceV25\(\)[\s\S]*?\n  function incomingMultV25/)?.[0] || '';

  assert.doesNotMatch(criticalRules, /currentSpecV25\(\) === '신성'[\s\S]*?return 0/);
  assert.match(criticalRules, /let m = isFireSkill \? 2\.0 : 1\.5/);
  assert.match(criticalRules, /m \+= \(SKILL_DEFS\.mage_fire_ember_v24\?\.critDmgBonus \|\| \[\]\)\[eRank\] \|\| 0/);
});

test('legacy Holy Priest basic hits do not restore maximum HP', () => {
  const legacySpecHit = gameSource.match(/function applySpecAfterSuccessfulHit\(monster, dealtDamage\)[\s\S]*?\n  }/)?.[0] || '';
  const actionDamage = gameSource.match(/function calculateActionDamageV25\(\)[\s\S]*?\n  }\n  function takePendingPlayerPoisonV42/)?.[0] || '';
  assert.doesNotMatch(legacySpecHit, /maxHp[^;]*\*\s*0\.06/);
  assert.doesNotMatch(legacySpecHit, /game\.player\.hp\s*=\s*Math\.min/);
  assert.match(actionDamage, /active\.type === 'damageHeal'/);
});
