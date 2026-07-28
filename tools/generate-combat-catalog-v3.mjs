import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const moduleOutput = path.join(root, 'supabase/functions/_shared/generated-combat-catalog-v3.mjs');
const sqlOutput = path.join(root, 'supabase/generated/combat-monster-catalog-v3.sql');
const migrationPath = path.join(
  root,
  'supabase/migrations/202607260004_server_authoritative_pve_combat_v3.sql',
);
const context = vm.createContext({ window:{} });

for (const relative of ['src/core-utils.js', 'src/game-data.js', 'src/patch-data.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, relative), 'utf8'), context);
}

const data = context.window.YuksamData;
const patch = context.window.YuksamPatchData;
const statNames = Object.freeze({
  '힘':'strength',
  '지능':'intelligence',
  '정신':'spirit',
  '체력':'vitality',
});
const normalizeStats = (source = {}) => Object.fromEntries(
  Object.entries(source)
    .filter(([key, value]) => statNames[key] && Number.isFinite(Number(value)))
    .map(([key, value]) => [statNames[key], Number(value)])
    .sort(([a], [b]) => a.localeCompare(b)),
);
const sortObject = (source) => Object.fromEntries(
  Object.entries(source).sort(([a], [b]) => a.localeCompare(b)),
);
const clone = (value) => JSON.parse(JSON.stringify(value));

const classes = sortObject(Object.fromEntries(
  Object.entries(data.CLASS_META).map(([key, value]) => [key, {
    primaryStat:key === 'warrior' ? 'strength' : key === 'mage' ? 'intelligence' : 'spirit',
    baseStats:normalizeStats(value.baseStats),
  }]),
));

const starterItems = [
  { id:'training_book', slot:'weapon', stats:{} },
  { id:'training_greatsword', slot:'weapon', stats:{} },
  { id:'training_staff', slot:'weapon', stats:{} },
];
const items = sortObject(Object.fromEntries(
  [...Object.values(data.ITEM_DEFS), ...starterItems].map((item) => [item.id, {
    slot:item.slot,
    stats:normalizeStats(item.stats),
    possessStats:normalizeStats(item.possessStats),
  }]),
));

const ignoredSkillFields = new Set([
  'name', 'icon', 'desc', 'x', 'y', 'passiveText', 'v24',
]);
const normalizeSkillValue = (key, value) => {
  if (key === 'bonuses' || key === 'flatBonuses') return normalizeStats(value);
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return clone(value);
  return value;
};
const skills = sortObject(Object.fromEntries(
  Object.values(data.V24_SKILLS).map((skill) => [skill.id, Object.fromEntries(
    Object.entries(skill)
      .filter(([key, value]) => !ignoredSkillFields.has(key) && value !== undefined)
      .map(([key, value]) => [key, normalizeSkillValue(key, value)]),
  )]),
));

const pets = sortObject(Object.fromEntries(
  Object.values(patch.PET_DEFS_V27).map((pet) => [pet.id, {
    stats:normalizeStats(pet.stats),
  }]),
));

// name은 전투 로그에 그대로 보이는 기술 이름이다 (예전 game.js의 PATTERNS_V40과 같은 이름)
const patterns = Object.freeze({
  mushroom:[{ chance:0.22, kind:'poison', turns:2, name:'포자 뿌리기' }],
  slime:[{ chance:0.25, kind:'selfShield', percent:0.35, name:'점액 방패' }],
  stomp:[
    { chance:0.25, kind:'heavy', multiplier:1.5, stunTurns:1, name:'대지 찍기' },
    { chance:0.20, kind:'selfShield', percent:0.30, name:'대지 방패' },
  ],
  snake:[
    { chance:0.25, kind:'poison', turns:3, name:'맹독니' },
    { chance:0.15, kind:'critical', name:'급소 노리기' },
  ],
  tarantula:[
    { chance:0.30, kind:'multi', hits:2, multiplier:0.62, name:'연속 물기' },
    { chance:0.20, kind:'heavy', multiplier:1.3, stunTurns:1, name:'마비 독니' },
  ],
  zombie:[{ chance:0.25, kind:'lifesteal', percent:1, name:'물어뜯기' }],
  teacherBoss:[
    { chance:0.25, kind:'heavy', multiplier:1.6, name:'사랑의 매' },
    { chance:0.20, kind:'multi', hits:2, multiplier:0.72, name:'숙제 폭탄' },
    { chance:0.15, kind:'chillPlayer', turns:1, name:'따끔한 꾸중' },
  ],
});

const elitePatterns = (type) => [
  ...(patterns[type] || []).map((pattern) => ({
    ...clone(pattern),
    chance:Math.min(0.5, pattern.chance + 0.12),
  })),
  { chance:0.18, kind:'heavy', multiplier:1.5, name:'분노의 일격' },
  { chance:0.15, kind:'selfShield', percent:0.225, name:'단단해지기' },
];
const monster = (map, type, level, hp, attack, exp, gold, extra = {}) => ({
  map,
  questionMap:map,
  type,
  level,
  hp,
  attack,
  reward:{ exp, gold },
  elite:false,
  boss:false,
  patterns:clone(patterns[type] || []),
  ...extra,
});
const monsters = sortObject({
  forest_mushroom:monster('forest', 'mushroom', 1, [9, 11], [2, 4], 1, 2),
  forest_slime:monster('forest', 'slime', 3, [20, 23], [3, 5], 3, 4),
  forest_elite_slime:monster('bossRoom', 'slime', 3, [36, 42], [6, 10], 6, 8, {
    questionMap:'forest', elite:true, patterns:elitePatterns('slime'),
  }),
  desert_stomp:monster('desert', 'stomp', 5, [41, 44], [7, 9], 6, 9),
  desert_snake:monster('desert', 'snake', 7, [59, 64], [10, 13], 9, 12),
  desert_elite_snake:monster('bossRoom', 'snake', 7, [119, 128], [20, 25], 18, 24, {
    questionMap:'desert', elite:true, patterns:elitePatterns('snake'),
  }),
  swamp_tarantula:monster('swamp', 'tarantula', 9, [62, 66], [11, 13], 12, 15),
  swamp_zombie:monster('swamp', 'zombie', 11, [91, 95], [24, 28], 16, 20),
  swamp_elite_zombie:monster('bossRoom', 'zombie', 11, [382, 399], [29, 34], 30, 40, {
    questionMap:'swamp', elite:true, patterns:elitePatterns('zombie'),
  }),
  final_teacher:monster('finalBossRoom', 'teacherBoss', 99, [999, 999], [24, 30], 363, 363, {
    questionMap:'swamp', elite:true, boss:true,
  }),
});

const balance = Object.freeze({
  playerMissChance:0.10,
  monsterMissChance:0.10,
  baseCritChance:0.15,
  basicCritMultiplier:1.5,
  wrongAnswerDamageMultiplier:0.50,
  buildingDropChance:0.10,
  maxWrongLogEntries:30,
  preSpecializationDeathExpLoss:0,
});

const js = [
  '// Generated by tools/generate-combat-catalog-v3.mjs. Do not edit.',
  `export const CLASS_COMBAT_V3 = Object.freeze(${JSON.stringify(classes, null, 2)});`,
  `export const ITEM_COMBAT_V3 = Object.freeze(${JSON.stringify(items, null, 2)});`,
  `export const PET_COMBAT_V3 = Object.freeze(${JSON.stringify(pets, null, 2)});`,
  `export const SKILL_COMBAT_V3 = Object.freeze(${JSON.stringify(skills, null, 2)});`,
  `export const MONSTER_COMBAT_V3 = Object.freeze(${JSON.stringify(monsters, null, 2)});`,
  `export const XP_REQUIREMENTS_V3 = Object.freeze(${JSON.stringify(data.XP_REQUIREMENTS, null, 2)});`,
  `export const COMBAT_BALANCE_V3 = Object.freeze(${JSON.stringify(balance, null, 2)});`,
  '',
].join('\n\n');

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const bool = (value) => value ? 'true' : 'false';
const jsonSql = (value) => `${quote(JSON.stringify(value))}::jsonb`;
const monsterRows = Object.entries(monsters).map(([key, value]) => `(${[
  quote(key),
  quote(value.map),
  quote(value.questionMap),
  quote(value.type),
  value.level,
  value.hp[0],
  value.hp[1],
  value.attack[0],
  value.attack[1],
  value.reward.exp,
  value.reward.gold,
  bool(value.elite),
  bool(value.boss),
  jsonSql(value.patterns),
].join(',')})`);
const sql = [
  '-- Generated by tools/generate-combat-catalog-v3.mjs. Do not edit.',
  `-- monsters: ${monsterRows.length}`,
  '',
  'insert into public.game_monster_catalog_v3',
  '  (monster_key, map_name, question_map, monster_type, level, hp_min, hp_max, attack_min, attack_max, exp_reward, gold_reward, elite, boss, patterns)',
  'values',
  `${monsterRows.join(',\n')}\non conflict (monster_key) do update set`,
  '  map_name = excluded.map_name, question_map = excluded.question_map, monster_type = excluded.monster_type,',
  '  level = excluded.level, hp_min = excluded.hp_min, hp_max = excluded.hp_max,',
  '  attack_min = excluded.attack_min, attack_max = excluded.attack_max,',
  '  exp_reward = excluded.exp_reward, gold_reward = excluded.gold_reward,',
  '  elite = excluded.elite, boss = excluded.boss, patterns = excluded.patterns;',
  '',
].join('\n');

const beginMarker = '-- BEGIN GENERATED COMBAT MONSTER CATALOG V3';
const endMarker = '-- END GENERATED COMBAT MONSTER CATALOG V3';
const renderMigration = (source) => {
  const begin = source.indexOf(beginMarker);
  const end = source.indexOf(endMarker);
  if (begin < 0 || end < begin) throw new Error('combat catalog migration markers are missing');
  const afterEnd = end + endMarker.length;
  return `${source.slice(0, begin + beginMarker.length)}\n${sql.trimEnd()}\n${endMarker}${source.slice(afterEnd)}`;
};
const migrationSource = fs.readFileSync(migrationPath, 'utf8');
const expectedMigration = renderMigration(migrationSource);
const outputs = [[moduleOutput, js], [sqlOutput, sql]];
if (process.argv.includes('--check')) {
  const stale = outputs.some(([file, expected]) => !fs.existsSync(file)
    || fs.readFileSync(file, 'utf8') !== expected)
    || migrationSource !== expectedMigration;
  if (stale) {
    console.error('combat catalog is missing or stale; run node tools/generate-combat-catalog-v3.mjs');
    process.exit(1);
  }
} else {
  for (const [file, source] of outputs) {
    fs.mkdirSync(path.dirname(file), { recursive:true });
    fs.writeFileSync(file, source, 'utf8');
  }
  fs.writeFileSync(migrationPath, expectedMigration, 'utf8');
}
