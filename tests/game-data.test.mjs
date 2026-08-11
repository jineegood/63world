import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Script, createContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const read = (file) => readFileSync(join(root, file), 'utf8');

function runBrowserModule(file, context) {
  new Script(read(file), { filename: file }).runInContext(context);
}

test('game data is split into a browser global module loaded before game.js', () => {
  assert.equal(existsSync(join(root, 'src', 'game-data.js')), true, 'src/game-data.js should exist');

  const html = read('index.html');
  const coreScriptIndex = html.indexOf('<script src="src/core-utils.js"></script>');
  const dataScriptIndex = html.indexOf('<script src="src/game-data.js"></script>');
  const gameScriptIndex = html.indexOf('<script src="game.js"></script>');

  assert.ok(coreScriptIndex > -1, 'index.html should load src/core-utils.js');
  assert.ok(dataScriptIndex > coreScriptIndex, 'src/game-data.js should load after core-utils');
  assert.ok(gameScriptIndex > dataScriptIndex, 'game.js should load after src/game-data.js');
});

test('game data module exposes mutable gameplay tables', () => {
  let uuidCounter = 0;
  const context = createContext({
    window: {
      crypto: {
        randomUUID: () => {
          uuidCounter += 1;
          return `data-id-${uuidCounter}`;
        },
      },
    },
    Math,
    Date,
  });
  context.globalThis = context.window;

  runBrowserModule('src/core-utils.js', context);
  runBrowserModule('src/game-data.js', context);

  const data = context.window.YuksamData;
  assert.equal(typeof data, 'object');
  assert.deepEqual(Object.keys(data.CLASS_META).sort(), ['mage', 'priest', 'warrior']);
  assert.equal(data.CLASS_META.warrior.baseStats.체력, 4);
  assert.equal(data.CLASS_META.mage.baseStats.체력, 2);
  assert.equal(data.CLASS_META.priest.baseStats.체력, 2);
  assert.equal(data.resolvePlayerBaseStats('warrior', null).체력, 8, 'unversioned saves keep the legacy warrior vitality');
  assert.equal(data.resolvePlayerBaseStats('mage', null).체력, 5, 'unversioned saves keep the legacy mage vitality');
  assert.equal(data.resolvePlayerBaseStats('priest', null).체력, 5, 'unversioned saves keep the legacy priest vitality');
  assert.equal(data.resolvePlayerBaseStats('warrior', 2).체력, 4, 'new warrior characters use the reduced vitality');
  assert.equal(data.resolvePlayerBaseStats('mage', 2).체력, 2, 'new mage characters use the reduced vitality');
  assert.equal(data.XP_REQUIREMENTS[10], 700);
  assert.equal(data.PLAYER_WORLD_SCALE, 1.26);
  assert.equal(data.NPC_WORLD_SCALE, 1.26);
  assert.equal(data.STORAGE.playerPrefix, 'ysb_player_');
  assert.equal(data.ITEM_DEFS.starCape.id, 'starCape');
  assert.equal(data.ITEM_DEFS.oakStaff.classOnly, 'mage');
  assert.equal(data.ITEM_DEFS.mithrilStaff.levelReq, 9);
  assert.equal(data.ITEM_DEFS.prayerBook.classOnly, 'priest');
  assert.equal(data.ITEM_DEFS.dawnTome.stats.정신, 10); // 사용자 시트 밸런스 반영
  assert.equal(data.BUILDING_ITEM_DEFS.sixthWing.buildingPrice, 5); // 사용자 시트 밸런스 반영
  assert.equal(data.SKILL_DEFS.warrior_toughness.classOnly, 'warrior');
  assert.equal(data.SKILL_LINES.length, 10);
  assert.equal(data.V24_SKILLS.warrior_basic_body.v24, true);
  // 시트 개편: 최후의 심판이 처형형에서 차지형(다음 공격 x2.8)으로 변경됨
  assert.equal(data.V24_SKILLS.warrior_weapon_judgment.active.chargeMult, 2.8);
  assert.equal(data.V24_SKILLS.warrior_basic_body.maxPoints, 3); // 다중 랭크 시스템
  assert.equal(data.V24_SKILLS.warrior_def_armor.flatBonuses.체력, 3); // 랭크 무관 1회 체력
  assert.equal(data.V24_SKILLS.mage_fireball_v24.active.hits, 2); // 다단히트
  assert.equal(data.V24_SKILLS.mage_fire_meteor_v24.specOnly, '화염');
  assert.equal(data.V24_SKILLS.priest_shadow_judgment_v24.active.stacks, 6);
  assert.equal(data.V24_LINES.length, 39);
  assert.deepEqual(Array.from(data.V24_LINES[0]), ['warrior_basic_body', 'warrior_basic_blade']);
  assert.deepEqual(Array.from(data.V24_LINES.at(-1)), ['priest_shadow_void_v24', 'priest_shadow_judgment_v24']);
  assert.equal(data.V18_SKILL_PATCHES.warrior_final_judgment.active.executePct, 0.2);
  assert.equal(data.V18_SKILL_PATCHES.mage_arcane_comet.active.multiplier, 2.8);
  assert.equal(data.V18_SKILL_PATCHES.priest_final_grace.kind, 'ultimate');
  assert.equal(data.V18_SKILL_LINES.length, 26);
  assert.deepEqual(Array.from(data.V18_SKILL_LINES[0]), ['warrior_frenzy', 'warrior_final_judgment']);
  assert.equal(data.V23_SKILL_OVERRIDES.warrior_charge.active.multiplier, 1.7);
  assert.equal(data.V23_SKILL_OVERRIDES.mage_ice_lance.active.forceChill, true);
  assert.equal(data.V23_SKILL_OVERRIDES.priest_shadow_bolt.active.stacks, 2);
  assert.equal(data.defaultQuestions.length, 8);
  assert.equal(data.defaultQuestions[0].id, 'data-id-1');
  assert.equal(data.defaultWorkbooks.length, 2);
  assert.equal(data.appearancePools.hairStyle.includes('ponytail'), true);
  assert.equal(data.worldDefs.town.label, '63마을');

  data.worldDefs.testMutable = { key: 'testMutable' };
  assert.equal(data.worldDefs.testMutable.key, 'testMutable', 'patch blocks must be able to extend worldDefs');
});

test('game.js consumes split data instead of defining the moved tables locally', () => {
  const js = read('game.js');

  assert.match(js, /const YuksamData = window\.YuksamData;/);
  assert.match(js, /const \{\s*CLASS_META,\s*resolvePlayerBaseStats,\s*XP_REQUIREMENTS,\s*PLAYER_WORLD_SCALE,\s*NPC_WORLD_SCALE,\s*STORAGE,\s*ITEM_DEFS,\s*BUILDING_ITEM_DEFS,\s*SKILL_DEFS,\s*SKILL_LINES,\s*defaultQuestions,\s*defaultWorkbooks,\s*appearancePools,\s*worldDefs,\s*\} = YuksamData;/s);
  assert.doesNotMatch(js, /const CLASS_META = \{/);
  assert.doesNotMatch(js, /const XP_REQUIREMENTS = \{/);
  assert.doesNotMatch(js, /const ITEM_DEFS = \{/);
  assert.doesNotMatch(js, /const BUILDING_ITEM_DEFS = \{/);
  assert.doesNotMatch(js, /Object\.assign\(ITEM_DEFS,\s*\{\s*oakStaff/s);
  assert.doesNotMatch(js, /const SKILL_DEFS = \{/);
  assert.doesNotMatch(js, /Object\.assign\(SKILL_DEFS,\s*\{\s*warrior_final_judgment/s);
  assert.doesNotMatch(js, /Object\.assign\(SKILL_DEFS,\s*\{\s*warrior_defense_stance/s);
  assert.doesNotMatch(js, /SKILL_LINES\.push\(\s*\['warrior_frenzy', 'warrior_final_judgment'\]/s);
  assert.doesNotMatch(js, /const V24_SKILLS = \{/);
  assert.doesNotMatch(js, /const V24_LINES = \[/);
  assert.doesNotMatch(js, /const worldDefs = \{/);
});

test('balance skill data exposes the approved v43 static values and matching copy', () => {
  const context = createContext({ window: { crypto: { randomUUID: () => 'skill-test-id' } }, Math, Date });
  context.globalThis = context.window;
  runBrowserModule('src/core-utils.js', context);
  runBrowserModule('src/game-data.js', context);
  const skills = context.window.YuksamData.V24_SKILLS;

  assert.equal(skills.mage_frost_focus_v24.maxPoints, 5);
  assert.equal(skills.mage_frost_focus_v24.bonuses.지능, 1);
  assert.deepEqual(Array.from(skills.mage_frost_focus_v24.activeStunChance), [0, 0.07, 0.14, 0.21, 0.28, 0.35]);
  assert.match(skills.mage_frost_focus_v24.desc, /지능 \+1/);
  assert.match(skills.mage_frost_focus_v24.desc, /7,14,21,28,35%/);
  assert.doesNotMatch(skills.mage_frost_focus_v24.desc, /냉기 2중첩/);
  assert.doesNotMatch(skills.mage_frost_focus_v24.passiveText, /냉기 2중첩/);
  assert.match(skills.mage_frost_focus_v24.passiveText, /지능 \+1/);
  assert.match(skills.mage_frost_focus_v24.passiveText, /7\/14\/21\/28\/35%/);

  assert.equal(skills.mage_fire_focus_v24.maxPoints, 5);
  assert.equal(skills.mage_fire_focus_v24.bonuses.지능, 1);
  assert.deepEqual(Array.from(skills.mage_fire_focus_v24.critChanceBonus), [0, 0.06, 0.12, 0.18, 0.24, 0.30]);
  assert.match(skills.mage_fire_focus_v24.desc, /6,12,18,24,30%/);

  assert.equal(skills.mage_frost_lance_v24.active.multiplier, 2.1);
  assert.match(skills.mage_frost_lance_v24.desc, /210%/);
  assert.equal(skills.mage_frost_mind_v24.maxPoints, 5);
  assert.equal(skills.mage_frost_mind_v24.bonuses.지능, 4);
  assert.match(skills.mage_frost_mind_v24.desc, /지능 \+4/);
  assert.match(skills.mage_frost_mind_v24.passiveText, /지능 \+4/);

  assert.equal(skills.mage_fire_ember_v24.maxPoints, 5);
  assert.equal(skills.mage_fire_ember_v24.bonuses.지능, 2);
  assert.deepEqual(Array.from(skills.mage_fire_ember_v24.critDmgBonus), [0, 0.2, 0.4, 0.6, 0.8, 1]);
  assert.match(skills.mage_fire_ember_v24.desc, /지능 \+2/);
  assert.match(skills.mage_fire_ember_v24.desc, /20,40,60,80,100%/);
  assert.match(skills.mage_fire_ember_v24.passiveText, /지능 \+2/);
  assert.match(skills.mage_fire_ember_v24.passiveText, /20\/40\/60\/80\/100%/);

  assert.equal(skills.priest_holy_grace_v24.maxPoints, 5);
  assert.equal(skills.priest_holy_grace_v24.bonuses.정신, 1);
  assert.deepEqual(Array.from(skills.priest_holy_grace_v24.healBoost), [0, 0.3, 0.6, 0.9, 1.2, 1.5]);
  assert.match(skills.priest_holy_grace_v24.desc, /30,60,90,120,150%/);

  assert.equal(skills.warrior_basic_guard.maxPoints, 5);
  assert.deepEqual(Array.from(skills.warrior_basic_guard.guardShieldPct), [0, 0.02, 0.04, 0.06, 0.08, 0.10]);
  assert.match(skills.warrior_basic_guard.desc, /2,4,6,8,10%/);

  assert.equal(skills.priest_basic_smite.active.cooldown, 5);
  assert.equal(skills.priest_basic_smite.active.healMaxPct, 0.25);
  assert.match(skills.priest_basic_smite.desc, /25%/);
  assert.match(skills.priest_basic_smite.desc, /쿨타임 5턴/);
  assert.equal(skills.priest_holy_barrier_v24.active.cooldown, 6);
  assert.match(skills.priest_holy_barrier_v24.desc, /쿨타임 6턴/);
  assert.equal(skills.priest_holy_judgment_v24.active.cooldown, 8);
  assert.match(skills.priest_holy_judgment_v24.desc, /쿨타임 8턴/);

  assert.equal(skills.priest_shadow_void_v24.maxPoints, 5);
  assert.equal(skills.priest_shadow_void_v24.bonuses.정신, 2);
  assert.deepEqual(Array.from(skills.priest_shadow_void_v24.shadowCritChance), [0, 0.2, 0.4, 0.6, 0.8, 1]);
  assert.match(skills.priest_shadow_void_v24.desc, /정신 \+2/);
  assert.match(skills.priest_shadow_void_v24.desc, /20,40,60,80,100%/);
  assert.match(skills.priest_shadow_void_v24.passiveText, /정신 \+2/);
  assert.match(skills.priest_shadow_void_v24.passiveText, /20\/40\/60\/80\/100%/);
});

test('current class skill data matches the approved v42 balance rules', () => {
  const context = createContext({ window: { crypto: { randomUUID: () => 'skill-test-id' } }, Math, Date });
  context.globalThis = context.window;
  runBrowserModule('src/core-utils.js', context);
  runBrowserModule('src/game-data.js', context);

  const skills = context.window.YuksamData.V24_SKILLS;
  assert.equal(skills.mage_basic_element.name, '원소 보호막');
  assert.equal(skills.mage_basic_element.icon, '🛡️');
  assert.notEqual(skills.mage_basic_element.icon, skills.mage_basic_barrier.icon);
  assert.equal(skills.mage_basic_element.triggerHpPct, 0.20);
  assert.deepEqual(Array.from(skills.mage_basic_element.emergencyShieldPct), [0, 0.10, 0.15, 0.20, 0.25, 0.30]);
  assert.equal('executeHp' in skills.mage_basic_element, false);
  assert.match(skills.mage_basic_element.desc, /공격이 모두 끝난 뒤 살아 있고 체력이 20% 이하/);

  assert.equal(skills.priest_basic_smite.active.cooldown, 5);
  assert.equal(skills.priest_basic_smite.active.healMaxPct, 0.25);
  assert.equal(skills.priest_holy_absorb_v24.name, '빛의 섬광');
  assert.equal(skills.priest_holy_absorb_v24.active.name, '빛의 섬광');
  assert.equal(skills.priest_holy_absorb_v24.active.type, 'healAllies');
  assert.equal(skills.priest_holy_absorb_v24.active.healMaxPct, 0.5);
  assert.equal(skills.priest_holy_absorb_v24.active.cooldown, 5);

  assert.equal(skills.warrior_def_stance.active.shieldPct, 0.20);
  assert.equal(skills.warrior_def_stance.active.cooldown, 6);
  assert.match(skills.warrior_def_stance.desc, /현재 체력과 관계없이 최대 체력/);
  assert.match(skills.warrior_def_stance.desc, /쿨타임 6턴/);
  assert.equal(skills.warrior_def_wall.icon, '🛡️');
  assert.equal(skills.warrior_def_wall.active.shieldPct, 0.20);
  assert.equal(skills.warrior_def_wall.active.cooldown, 7);
  assert.match(skills.warrior_def_wall.desc, /현재 체력과 관계없이 최대 체력/);
  assert.match(skills.warrior_def_wall.desc, /쿨타임 7턴/);
  assert.equal(skills.warrior_basic_strike.active.multiplier, 1.8);
  assert.equal(skills.warrior_basic_strike.active.ignoreShield, true);
  assert.match(skills.warrior_basic_strike.desc, /보호막을 무시/);

  assert.equal(skills.warrior_weapon_mastery.maxPoints, 5);
  assert.equal(skills.warrior_weapon_mastery.bonuses.힘, 1);
  assert.deepEqual(Array.from(skills.warrior_weapon_mastery.reflectPct), [0, 0.1, 0.2, 0.3, 0.4, 0.5]);
  assert.match(skills.warrior_weapon_mastery.desc, /힘 \+1/);
  assert.match(skills.warrior_weapon_mastery.desc, /10,20,30,40,50%/);
  assert.match(skills.warrior_weapon_mastery.passiveText, /힘 \+1/);
  assert.match(skills.warrior_weapon_mastery.passiveText, /10\/20\/30\/40\/50% 반사/);

  assert.equal(skills.warrior_weapon_slash.active.multiplier, 1.8);
  assert.equal(skills.warrior_weapon_slash.active.stun, 1);
  assert.equal(skills.warrior_weapon_slash.active.cooldown, 5);
  assert.match(skills.warrior_weapon_slash.desc, /180%/);
  assert.match(skills.warrior_weapon_slash.desc, /상대를 1턴간 기절시킨다/);
  assert.match(skills.warrior_weapon_slash.desc, /쿨타임 5턴/);

  assert.equal(skills.warrior_weapon_rage.maxPoints, 3);
  assert.equal(skills.warrior_weapon_rage.bonuses.힘, 3);
  assert.equal('체력' in skills.warrior_weapon_rage.bonuses, false);
  assert.match(skills.warrior_weapon_rage.desc, /힘 \+3/);
  assert.doesNotMatch(skills.warrior_weapon_rage.desc, /체력/);
  assert.match(skills.warrior_weapon_rage.passiveText, /힘 \+3/);
  assert.doesNotMatch(skills.warrior_weapon_rage.passiveText, /체력/);

  assert.equal(skills.warrior_def_resist.maxPoints, 5);
  assert.equal(skills.warrior_def_resist.bonuses.체력, 1);
  assert.deepEqual(Array.from(skills.warrior_def_resist.cleanseChance), [0, 0.2, 0.4, 0.6, 0.8, 1]);
  assert.match(skills.warrior_def_resist.desc, /체력 \+1/);
  assert.match(skills.warrior_def_resist.desc, /20,40,60,80,100%/);
  assert.match(skills.warrior_def_resist.passiveText, /체력 \+1/);
  assert.match(skills.warrior_def_resist.passiveText, /20\/40\/60\/80\/100% 상태이상 해제/);
  assert.equal(skills.mage_frost_armor_v24.active.cooldown, 6);
  assert.equal(skills.mage_frost_armor_v24.active.shieldPct, 0.70);
  assert.match(skills.mage_frost_armor_v24.desc, /최대 체력의 70%/);
  assert.match(skills.mage_frost_armor_v24.desc, /쿨타임 6턴/);
  assert.match(skills.mage_fire_ember_v24.desc, /스킬 치명타 데미지/);
  assert.match(skills.mage_fire_ember_v24.passiveText, /스킬 치명타 피해/);
});
