import {
  ITEM_COMBAT_V3,
} from './generated-combat-catalog-v3.mjs';
import { buildCombatant } from './pve-combat-rules-v3.mjs';

const EQUIPMENT_SLOTS = new Set(['weapon', 'head', 'armor', 'accessory']);
const text = (value, maximum = 80) => String(value ?? '').trim().slice(0, maximum);

function appearanceFrom(preferences = {}) {
  return Object.freeze({
    shirt:text(preferences.shirt_color, 32),
    pants:text(preferences.pants_color, 32),
    hair:text(preferences.hair_color, 32),
    hairStyle:text(preferences.hair_style, 32),
    skin:text(preferences.skin_color, 32),
    accessory:text(preferences.accessory, 32),
  });
}

function equippedItems(inventory) {
  const equipment = {};
  const costume = {};
  for (const row of inventory) {
    const itemId = text(row?.item_definition_id);
    const slot = text(row?.equipped_slot, 20);
    if (!itemId || !EQUIPMENT_SLOTS.has(slot)) continue;
    if (row?.inventory_kind === 'costume') {
      if (!costume[slot]) costume[slot] = itemId;
      continue;
    }
    const definition = ITEM_COMBAT_V3[itemId];
    if (row?.inventory_kind === 'gear' && definition?.slot === slot && !equipment[slot]) {
      equipment[slot] = itemId;
    }
  }
  return {
    equipment:Object.freeze(equipment),
    costume:Object.freeze(costume),
  };
}

export function buildPvpSnapshotV3(source = {}) {
  const core = source.core;
  if (!core || typeof core !== 'object') throw new Error('PROFILE_MISSING');
  const inventory = Array.isArray(source.inventory) ? source.inventory : [];
  const skillRows = Array.isArray(source.skills) ? source.skills : [];
  const skills = Object.fromEntries(
    skillRows.map((row) => [text(row?.skill_id), Number(row?.rank) || 0]),
  );
  const combatant = buildCombatant({
    className:core.class_name,
    spec:core.spec,
    level:core.level,
    currentHp:core.current_hp,
    activePet:core.active_pet,
    inventory,
    skills,
  });
  const equipped = equippedItems(inventory);
  return Object.freeze({
    userId:text(core.user_id),
    name:text(core.display_name || '학생', 24),
    level:combatant.level,
    className:combatant.className,
    spec:combatant.spec || '',
    maxHp:combatant.maxHp,
    hp:combatant.maxHp,
    shield:0,
    attack:combatant.attackStat,
    defense:Math.max(0, Math.floor(combatant.stats.vitality / 2)),
    skills:{ ...combatant.skills },
    cooldowns:{},
    statuses:{ stun:0, chill:0, shadow:0 },
    appearance:appearanceFrom(source.preferences),
    ...equipped,
  });
}
