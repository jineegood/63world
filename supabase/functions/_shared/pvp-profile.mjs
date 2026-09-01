import { PVP_PROFILE_CATALOG, PVP_SKILLS } from './pvp-catalog.mjs';
import { raidNameplatePossessionStats } from './raid-nameplate-stats.mjs';

const VALID_SPECS = Object.freeze({
  warrior:new Set(['방어', '무기']),
  mage:new Set(['냉기', '화염']),
  priest:new Set(['신성', '암흑']),
});
const STAT_KEYS = Object.freeze(['힘', '지능', '정신', '체력', '방어']);
const EQUIPMENT_SLOTS = Object.freeze(['weapon', 'head', 'armor', 'accessory']);

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function boundedText(value, maximum = 48) {
  return String(value ?? '').trim().slice(0, maximum);
}

function addStats(total, values, multiplier = 1) {
  const source = record(values);
  for (const key of STAT_KEYS) {
    const amount = Number(source[key]);
    if (!Number.isFinite(amount)) continue;
    total[key] = (Number(total[key]) || 0) + amount * multiplier;
  }
}

function levelFromSavedData(data) {
  const exp = Math.max(0, Number(data.exp) || 0);
  const highestThresholdLevel = Math.max(
    1,
    ...Object.keys(PVP_PROFILE_CATALOG.xpRequirements || {}).map((value) => Number(value) || 0),
  );
  const maximumLevel = highestThresholdLevel + 1;
  let level = 1;
  for (const [rawLevel, requirement] of Object.entries(PVP_PROFILE_CATALOG.xpRequirements || {})) {
    if (exp >= Number(requirement)) level = Math.max(level, Number(rawLevel) + 1);
  }
  if (!Object.hasOwn(data, 'exp')) {
    level = Math.max(1, Math.min(maximumLevel, Math.trunc(Number(data.level) || 1)));
  }
  return Math.max(1, Math.min(maximumLevel, Math.trunc(level)));
}

function normalizeSpec(className, value) {
  const candidate = value === '분노' ? '무기' : boundedText(value, 12);
  return VALID_SPECS[className]?.has(candidate) ? candidate : '';
}

function skillUnlockLevel(skill) {
  const line = Math.max(1, Math.trunc(Number(skill?.line) || 1));
  return line <= 4 ? 1 : line <= 6 ? 5 : line <= 8 ? 7 : 9;
}

function sanitizeSkills(rawSkills, className, spec, level) {
  const source = record(rawSkills);
  const candidates = Object.entries(PVP_SKILLS)
    .map(([id, skill]) => ({
      id,
      skill,
      rank:Math.max(0, Math.trunc(Number(source[id]) || 0)),
    }))
    .filter(({ skill, rank }) => (
      rank > 0
      && (!skill.classOnly || skill.classOnly === className)
      && (!skill.specOnly || skill.specOnly === spec)
      && level >= skillUnlockLevel(skill)
    ))
    .sort((left, right) => (
      Number(left.skill.line || 1) - Number(right.skill.line || 1)
      || left.id.localeCompare(right.id)
    ));
  let remainingPoints = Math.max(0, (level - 1) * 2);
  const skills = {};
  for (const { id, skill, rank } of candidates) {
    if (remainingPoints <= 0) break;
    const accepted = Math.min(
      remainingPoints,
      Math.max(1, Math.trunc(Number(skill.maxPoints) || 1)),
      rank,
    );
    if (accepted > 0) {
      skills[id] = accepted;
      remainingPoints -= accepted;
    }
  }
  return skills;
}

function sanitizeInventory(rawInventory) {
  const result = [];
  const seen = new Set();
  for (const rawId of Array.isArray(rawInventory) ? rawInventory.slice(0, 200) : []) {
    const id = boundedText(rawId, 80);
    if (!id || seen.has(id) || !PVP_PROFILE_CATALOG.items[id]) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function sanitizeEquipment(data, className, level, inventory) {
  const source = record(data.equipment);
  const owned = new Set(inventory);
  const equipment = {};
  for (const slot of EQUIPMENT_SLOTS) {
    const id = boundedText(source[slot], 80);
    const item = PVP_PROFILE_CATALOG.items[id];
    equipment[slot] = item
      && item.slot === slot
      && (!item.classOnly || item.classOnly === className)
      && level >= Math.max(1, Number(item.levelReq) || 1)
      && owned.has(id)
      ? id
      : null;
  }
  if (!equipment.weapon) {
    equipment.weapon = PVP_PROFILE_CATALOG.classes[className].defaultWeapon;
  }
  return equipment;
}

function specializationStats(total, className, spec) {
  if (className === 'warrior' && spec === '방어') addStats(total, { 체력:9 });
  else if (className === 'warrior' && spec === '무기') addStats(total, { 힘:5, 체력:3 });
  else if (className === 'mage' && spec === '냉기') addStats(total, { 지능:3, 체력:3 });
  else if (className === 'mage' && spec === '화염') addStats(total, { 지능:6 });
  else if (className === 'priest' && spec === '신성') addStats(total, { 정신:5, 체력:3 });
  else if (className === 'priest' && spec === '암흑') addStats(total, { 정신:6 });
}

export function buildAuthoritativePvpProfile({ userId, displayName, data:rawData } = {}) {
  const data = record(rawData);
  const className = PVP_PROFILE_CATALOG.classes[data.class] ? data.class : '';
  if (!className || !boundedText(data.name || displayName, 24)) return null;
  const level = levelFromSavedData(data);
  const spec = normalizeSpec(className, data.spec);
  const inventory = sanitizeInventory(data.inventory);
  const equipment = sanitizeEquipment(data, className, level, inventory);
  const skills = sanitizeSkills(data.skills, className, spec, level);
  const classInfo = PVP_PROFILE_CATALOG.classes[className];
  const total = { ...classInfo.baseStats };
  if (Number(data.baseStatsVersion) < 2) total.체력 = classInfo.legacyVitality;

  for (const itemId of Object.values(equipment)) {
    if (itemId) addStats(total, PVP_PROFILE_CATALOG.items[itemId]?.stats);
  }
  const equipped = new Set(Object.values(equipment).filter(Boolean));
  for (const itemId of inventory) {
    const item = PVP_PROFILE_CATALOG.items[itemId];
    if (item?.slot === 'accessory' && !equipped.has(itemId)) {
      addStats(total, item.possessStats);
    }
  }
  for (const [skillId, rank] of Object.entries(skills)) {
    const skill = PVP_SKILLS[skillId];
    addStats(total, skill?.bonuses, rank);
    if (skill?.flatBonuses) addStats(total, skill.flatBonuses);
  }
  specializationStats(total, className, spec);
  addStats(total, raidNameplatePossessionStats(data.raidNameplates ?? data.raid_nameplates));

  const ownedPets = new Set((Array.isArray(data.pets) ? data.pets : [])
    .slice(0, 100).map((id) => boundedText(id, 80)));
  const activePet = ownedPets.has(data.activePet) && PVP_PROFILE_CATALOG.pets[data.activePet]
    ? data.activePet
    : '';
  if (activePet) addStats(total, PVP_PROFILE_CATALOG.pets[activePet].stats);

  const weapon = PVP_PROFILE_CATALOG.items[equipment.weapon];
  const rawTier = Number(record(data.weaponUpgrades)[equipment.weapon]);
  const weaponTier = Math.max(0, Math.min(4, Math.trunc(Number.isFinite(rawTier) ? rawTier : 0)));
  if (weapon?.stats && weaponTier > 0) {
    for (const key of STAT_KEYS) {
      const base = Number(weapon.stats[key]);
      if (!(base > 0)) continue;
      total[key] = (Number(total[key]) || 0) + Math.max(1, Math.ceil(base * weaponTier * 0.45));
    }
  }

  const primaryStat = className === 'mage' ? total.지능 : className === 'priest' ? total.정신 : total.힘;
  const vitality = Math.max(1, Number(total.체력) || 1);
  const maxHp = Math.max(1, Math.round(8 + vitality * 3 + level * 2));
  return {
    userId:boundedText(userId, 80),
    name:boundedText(data.name || displayName || '학생', 24),
    level,
    className,
    spec,
    appearance:record(data.appearance),
    equipment,
    costume:record(data.costume),
    skills,
    maxHp,
    hp:maxHp,
    shield:0,
    primaryStat:Math.max(1, Math.round(Number(primaryStat) || 1)),
    attack:Math.max(1, Math.round((Number(primaryStat) || 1) / 2)),
    defense:Math.max(0, Math.round(Number(total.방어) || 0)),
    activePet,
    weaponTier,
    /* 63빌딩 던전에서 깬 구간 중 가장 높은 번호(0~7).
       앞 구간을 깬 사람만 다음 구간에 들어갈 수 있는지 서버가 판단하는 데 쓴다. */
    raidTopGroup:Math.max(0, Math.min(7, Math.trunc(Number(data.raidTopGroup) || 0))),
    map:boundedText(data.map || 'town', 40) || 'town',
  };
}
