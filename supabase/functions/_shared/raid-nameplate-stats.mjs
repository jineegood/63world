const VITALITY_BY_NAMEPLATE = Object.freeze({
  raid_20_steel:2,
  raid_40_twilight:3,
  raid_63_summit:4,
});

export const RAID_NAMEPLATE_IDS = Object.freeze(Object.keys(VITALITY_BY_NAMEPLATE));

export function safeRaidNameplateIds(value) {
  const requested = new Set(Array.isArray(value) ? value.map((id) => String(id || '')) : []);
  return RAID_NAMEPLATE_IDS.filter((id) => requested.has(id));
}

export function raidNameplatePossessionStats(value) {
  const vitality = safeRaidNameplateIds(value)
    .reduce((sum, id) => sum + VITALITY_BY_NAMEPLATE[id], 0);
  return Object.freeze({ 체력:vitality });
}
