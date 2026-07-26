import {
  CLASS_COMBAT_V3,
  ITEM_COMBAT_V3,
  PET_COMBAT_V3,
  SKILL_COMBAT_V3,
  MONSTER_COMBAT_V3,
  XP_REQUIREMENTS_V3,
  COMBAT_BALANCE_V3,
} from './generated-combat-catalog-v3.mjs';

const STAT_KEYS = Object.freeze(['intelligence', 'spirit', 'strength', 'vitality']);
const EVENT_TYPES = new Set([
  'answer-correct',
  'answer-wrong',
  'monster-damage',
  'monster-dot',
  'monster-action',
  'monster-miss',
  'monster-status',
  'monster-shield',
  'player-action',
  'player-damage',
  'player-dot',
  'player-heal',
  'player-miss',
  'player-shield',
  'player-status',
  'rewards',
  'surrender',
]);
const FORBIDDEN_RESPONSE_KEYS = new Set([
  'answerKey',
  'answer_key',
  'correct_answer',
  'serviceRoleKey',
  'service_role_key',
]);
const clone = (value) => JSON.parse(JSON.stringify(value));
const finiteInteger = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
};
const boundedRank = (value) => Math.max(0, Math.min(20, finiteInteger(value)));
const addStats = (target, source, multiplier = 1) => {
  for (const key of STAT_KEYS) {
    const amount = Number(source?.[key]) || 0;
    if (amount) target[key] += amount * multiplier;
  }
};
const normalizedAnswer = (value) => String(value ?? '')
  .normalize('NFKC')
  .trim()
  .replace(/\s+/g, '')
  .toLowerCase();
const checkedRandom = (random) => {
  if (typeof random !== 'function') throw new Error('INVALID_RANDOM');
  const value = Number(random());
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('INVALID_RANDOM');
  return value;
};
const randomInteger = (min, max, random) => min + Math.floor(checkedRandom(random) * (max - min + 1));
const safeStateInteger = (value, max = 1000000) => {
  const number = finiteInteger(value, -1);
  if (number < 0 || number > max) throw new Error('INVALID_COMBAT_STATE');
  return number;
};
const tickCooldowns = (source) => Object.fromEntries(
  Object.entries(source || {})
    .map(([key, value]) => [key, Math.max(0, finiteInteger(value) - 1)])
    .filter(([, value]) => value > 0),
);
const pushEvent = (events, event) => {
  if (!EVENT_TYPES.has(event?.type) || events.length >= 64) throw new Error('INVALID_COMBAT_EVENT');
  events.push(event);
};

export function buildCombatant(source = {}) {
  const className = String(source.className || '');
  const classRule = CLASS_COMBAT_V3[className];
  if (!classRule) throw new Error('INVALID_CLASS');
  const level = finiteInteger(source.level, 1);
  if (level < 1 || level > 10) throw new Error('INVALID_LEVEL');

  const stats = Object.fromEntries(STAT_KEYS.map((key) => [key, 0]));
  addStats(stats, classRule.baseStats);
  const inventory = Array.isArray(source.inventory) ? source.inventory : [];
  const equippedIds = new Set();

  for (const row of inventory) {
    const itemId = String(row?.itemId || row?.item_definition_id || '');
    const slot = row?.equippedSlot ?? row?.equipped_slot ?? null;
    const item = ITEM_COMBAT_V3[itemId];
    if (!item || !slot || item.slot !== slot) continue;
    equippedIds.add(itemId);
    addStats(stats, item.stats);
    if (slot === 'weapon') {
      const tier = Math.max(0, Math.min(4, finiteInteger(row?.enhancementTier ?? row?.enhancement_tier)));
      for (const key of STAT_KEYS) {
        const base = Number(item.stats?.[key]) || 0;
        if (tier > 0 && base > 0) stats[key] += Math.max(1, Math.ceil(base * tier * 0.45));
      }
    }
  }

  for (const row of inventory) {
    const itemId = String(row?.itemId || row?.item_definition_id || '');
    const item = ITEM_COMBAT_V3[itemId];
    if (!item || item.slot !== 'accessory' || equippedIds.has(itemId)) continue;
    addStats(stats, item.possessStats);
  }

  const skills = {};
  for (const [skillId, rawRank] of Object.entries(source.skills || {})) {
    const skill = SKILL_COMBAT_V3[skillId];
    const rank = boundedRank(rawRank);
    if (!skill || skill.classOnly !== className || rank <= 0) continue;
    skills[skillId] = rank;
    addStats(stats, skill.bonuses, rank);
    addStats(stats, skill.flatBonuses, 1);
  }

  const activePet = source.activePet ? String(source.activePet) : null;
  if (activePet && PET_COMBAT_V3[activePet]) addStats(stats, PET_COMBAT_V3[activePet].stats);
  for (const key of STAT_KEYS) stats[key] = Math.max(0, finiteInteger(stats[key]));

  const maxHp = 8 + stats.vitality * 3 + level * 2;
  const hp = Math.max(0, Math.min(maxHp, finiteInteger(source.currentHp ?? source.current_hp, maxHp)));
  const primaryStat = classRule.primaryStat;
  return Object.freeze({
    className,
    spec:source.spec ? String(source.spec) : null,
    level,
    exp:Math.max(0, finiteInteger(source.exp)),
    stats:Object.freeze(stats),
    maxHp,
    hp,
    attackStat:Math.max(1, stats[primaryStat]),
    skills:Object.freeze(skills),
    activePet,
  });
}

export function startEncounter({ player, monsterKey, random = Math.random } = {}) {
  if (!player || !CLASS_COMBAT_V3[player.className]) throw new Error('INVALID_PLAYER');
  const monster = MONSTER_COMBAT_V3[String(monsterKey || '')];
  if (!monster) throw new Error('UNKNOWN_MONSTER');
  const monsterHp = randomInteger(monster.hp[0], monster.hp[1], random);
  const monsterAttack = randomInteger(monster.attack[0], monster.attack[1], random);
  return Object.freeze({
    monsterKey:String(monsterKey),
    playerHp:Math.max(0, Math.min(player.maxHp, finiteInteger(player.hp))),
    playerMaxHp:player.maxHp,
    playerShield:0,
    monsterHp,
    monsterMaxHp:monsterHp,
    monsterShield:0,
    monsterAttack,
    playerStatuses:{},
    monsterStatuses:{},
    cooldowns:{},
    turnNumber:0,
    status:'active',
    monsterPatterns:clone(monster.patterns),
  });
}

function validateState(source, player) {
  if (!source || source.status !== 'active') throw new Error('COMBAT_NOT_ACTIVE');
  const state = clone(source);
  state.playerHp = safeStateInteger(state.playerHp);
  state.playerMaxHp = safeStateInteger(state.playerMaxHp);
  state.playerShield = safeStateInteger(state.playerShield);
  state.monsterHp = safeStateInteger(state.monsterHp);
  state.monsterMaxHp = safeStateInteger(state.monsterMaxHp);
  state.monsterShield = safeStateInteger(state.monsterShield);
  state.monsterAttack = safeStateInteger(state.monsterAttack, 100000);
  state.turnNumber = safeStateInteger(state.turnNumber, 10000);
  if (state.playerMaxHp !== player.maxHp
    || state.playerHp > state.playerMaxHp
    || state.monsterHp > state.monsterMaxHp
    || !MONSTER_COMBAT_V3[state.monsterKey]) {
    throw new Error('INVALID_COMBAT_STATE');
  }
  state.playerStatuses = state.playerStatuses && typeof state.playerStatuses === 'object'
    ? state.playerStatuses : {};
  state.monsterStatuses = state.monsterStatuses && typeof state.monsterStatuses === 'object'
    ? state.monsterStatuses : {};
  state.cooldowns = state.cooldowns && typeof state.cooldowns === 'object' ? state.cooldowns : {};
  state.monsterPatterns = Array.isArray(state.monsterPatterns) ? state.monsterPatterns : [];
  return state;
}

function rollAttackPower(player, state, random) {
  const stat = Math.max(1, Number(player.attackStat) || 1);
  let minimum = -stat * 0.20;
  let maximum = stat * 0.20;
  if (state.playerStatuses?.battleRoarTurns > 0) {
    minimum = stat * 0.05;
    maximum = stat * 0.15;
  }
  let power = stat / 2 + minimum + checkedRandom(random) * (maximum - minimum);
  if (player.className === 'mage' && state.playerStatuses?.intBuffTurns > 0) {
    power *= 1 + (Number(state.playerStatuses.intBuffPct) || 0.30);
  }
  return Math.max(1, Math.round(power));
}

function playerCritChance(player) {
  let chance = COMBAT_BALANCE_V3.baseCritChance;
  const rank = player.skills.mage_fire_focus_v24 || 0;
  const bonuses = SKILL_COMBAT_V3.mage_fire_focus_v24?.critChanceBonus || [];
  if (player.className === 'mage' && player.spec === '화염' && rank > 0) chance += Number(bonuses[rank]) || 0;
  return Math.min(1, chance);
}

function playerCritMultiplier(player, isSkill) {
  if (!(isSkill && player.className === 'mage' && player.spec === '화염')) {
    return COMBAT_BALANCE_V3.basicCritMultiplier;
  }
  const rank = player.skills.mage_fire_ember_v24 || 0;
  const bonuses = SKILL_COMBAT_V3.mage_fire_ember_v24?.critDmgBonus || [];
  return 2 + (Number(bonuses[rank]) || 0);
}

function skillScheduleValue(player, skillId, field) {
  const rank = boundedRank(player.skills?.[skillId]);
  const schedule = SKILL_COMBAT_V3[skillId]?.[field] || [];
  return rank > 0 ? Number(schedule[rank]) || 0 : 0;
}

function boostedHeal(player, amount) {
  const boost = skillScheduleValue(player, 'priest_holy_grace_v24', 'healBoost');
  return Math.max(0, Math.ceil(Math.max(0, Number(amount) || 0) * (1 + boost)));
}

function applyMonsterDamage(state, damage, ignoreShield) {
  const amount = Math.max(0, finiteInteger(damage));
  const shieldDamage = ignoreShield ? 0 : Math.min(state.monsterShield, amount);
  state.monsterShield -= shieldDamage;
  const hpDamage = Math.max(0, amount - shieldDamage);
  state.monsterHp = Math.max(0, state.monsterHp - hpDamage);
  return { amount, shieldDamage, hpDamage };
}

function applyPlayerDamage(state, damage) {
  const amount = Math.max(0, finiteInteger(damage));
  const shieldDamage = Math.min(state.playerShield, amount);
  state.playerShield -= shieldDamage;
  const hpDamage = Math.max(0, amount - shieldDamage);
  state.playerHp = Math.max(0, state.playerHp - hpDamage);
  return { amount, shieldDamage, hpDamage };
}

function resolveDamageHit({ player, state, raw, isSkill, wrong, random }) {
  if (wrong) {
    return {
      damage:Math.max(1, Math.floor(Math.max(1, Math.ceil(raw))
        * COMBAT_BALANCE_V3.wrongAnswerDamageMultiplier)),
      missed:false,
      critical:false,
    };
  }
  if (checkedRandom(random) < COMBAT_BALANCE_V3.playerMissChance) {
    return { damage:0, missed:true, critical:false };
  }
  let damage = Math.max(1, Math.ceil(raw));
  const critical = checkedRandom(random) < playerCritChance(player);
  if (critical) damage = Math.max(1, Math.ceil(damage * playerCritMultiplier(player, isSkill)));
  return { damage, missed:false, critical };
}

function performPlayerAction({ player, state, actionId, wrong, random, events }) {
  const activeId = String(actionId).startsWith('active:') ? String(actionId).slice(7) : null;
  const skill = activeId ? SKILL_COMBAT_V3[activeId] : null;
  if (activeId && !(player.skills[activeId] > 0)) throw new Error('ACTION_NOT_LEARNED');
  if (activeId && (!skill?.active || skill.classOnly !== player.className)) throw new Error('INVALID_ACTION');
  if (activeId && finiteInteger(state.cooldowns[activeId]) > 0) throw new Error('ACTION_ON_COOLDOWN');
  if (!activeId && actionId !== 'basic') throw new Error('INVALID_ACTION');

  const active = skill?.active || null;
  const damaging = !active || ['damage', 'damageHeal', 'shadowDot', 'shieldBash'].includes(active.type);
  if (wrong && !damaging) return;

  if (!wrong && active?.type === 'shield') {
    const amount = Math.max(1, Math.ceil(state.playerMaxHp * (Number(active.shieldPct) || 0.4)));
    state.playerShield = Math.min(1000000, state.playerShield + amount);
    state.cooldowns[activeId] = finiteInteger(active.cooldown, 3);
    pushEvent(events, { type:'player-shield', amount });
    return;
  }
  if (!wrong && active?.type === 'buff') {
    state.playerStatuses.intBuffTurns = finiteInteger(active.buffTurns, 3);
    state.playerStatuses.intBuffPct = Number(active.buffPct) || 0.30;
    const heal = boostedHeal(
      player,
      Math.max(0, Math.ceil(state.playerMaxHp * (Number(active.healMaxPct) || 0))),
    );
    const actual = Math.min(heal, state.playerMaxHp - state.playerHp);
    state.playerHp += actual;
    state.cooldowns[activeId] = finiteInteger(active.cooldown, 3);
    pushEvent(events, { type:'player-action', action:'buff' });
    if (actual > 0) pushEvent(events, { type:'player-heal', amount:actual });
    return;
  }
  if (!wrong && active?.type === 'healAllies') {
    const heal = Math.max(1, boostedHeal(
      player,
      Math.ceil(state.playerMaxHp * (Number(active.healMaxPct) || 0.5)),
    ));
    const actual = Math.min(heal, state.playerMaxHp - state.playerHp);
    state.playerHp += actual;
    state.cooldowns[activeId] = finiteInteger(active.cooldown, 3);
    pushEvent(events, { type:'player-heal', amount:actual });
    return;
  }
  if (!wrong && active?.type === 'charge') {
    state.playerStatuses.chargeMultiplier = Number(active.chargeMult) || 1;
    state.cooldowns[activeId] = finiteInteger(active.cooldown, 3);
    pushEvent(events, { type:'player-action', action:'charge' });
    return;
  }

  if (activeId) state.cooldowns[activeId] = finiteInteger(active.cooldown, 3);
  if (!wrong && active?.type === 'shieldBash') {
    const amount = Math.max(1, Math.ceil(state.playerMaxHp * (Number(active.shieldPct) || 0.1)));
    state.playerShield = Math.min(1000000, state.playerShield + amount);
    pushEvent(events, { type:'player-shield', amount });
  }

  const hitCount = Math.max(1, finiteInteger(active?.hits, 1));
  const multiplier = active
    ? hitCount > 1 ? Number(active.hitMult) || 1 : Number(active.multiplier) || 0
    : 1;
  const rawHits = Array.from({ length:hitCount }, () => (
    active?.type === 'shieldBash'
      ? Math.min(100, state.playerShield)
      : rollAttackPower(player, state, random) * multiplier
  ));
  if (!wrong && !active) {
    const armorPct = skillScheduleValue(player, 'warrior_def_armor', 'armorBonusPct');
    if (armorPct > 0) rawHits.push(Math.max(1, Math.ceil(state.playerMaxHp * armorPct)));
    const doublePct = skillScheduleValue(player, 'warrior_weapon_breaker', 'doubleAttackPct');
    if (doublePct > 0) rawHits.push(rollAttackPower(player, state, random) * doublePct);
  }
  const chargeMultiplier = Number(state.playerStatuses.chargeMultiplier) || 1;
  if (chargeMultiplier > 1) delete state.playerStatuses.chargeMultiplier;
  let landed = false;
  for (let index = 0; index < rawHits.length && state.monsterHp > 0; index += 1) {
    let raw = rawHits[index];
    if (chargeMultiplier > 1 && raw > 0) raw *= chargeMultiplier;
    if (raw <= 0) continue;
    const hit = resolveDamageHit({ player, state, raw, isSkill:!!active, wrong, random });
    if (hit.missed) {
      pushEvent(events, { type:'player-miss', hit:index });
      continue;
    }
    landed = true;
    const applied = applyMonsterDamage(state, hit.damage, active?.ignoreShield === true);
    pushEvent(events, {
      type:'monster-damage',
      amount:applied.amount,
      hpDamage:applied.hpDamage,
      shieldDamage:applied.shieldDamage,
      critical:hit.critical,
      hit:index,
    });
  }

  if (!wrong && active && landed && state.monsterHp > 0) {
    const frostChance = skillScheduleValue(player, 'mage_frost_focus_v24', 'activeStunChance');
    if (frostChance > 0 && checkedRandom(random) < frostChance) {
      state.monsterStatuses.stunTurns = Math.max(1, finiteInteger(state.monsterStatuses.stunTurns));
      pushEvent(events, { type:'monster-status', status:'stun', turns:state.monsterStatuses.stunTurns });
    }
    const executeThreshold = finiteInteger(
      SKILL_COMBAT_V3.mage_basic_element?.executeHp?.[
        boundedRank(player.skills.mage_basic_element)
      ],
    );
    if (executeThreshold > 0 && state.monsterHp <= executeThreshold) {
      const applied = applyMonsterDamage(state, state.monsterHp, true);
      pushEvent(events, {
        type:'monster-damage',
        amount:applied.amount,
        hpDamage:applied.hpDamage,
        shieldDamage:0,
        execute:true,
      });
    }
  }

  if (!wrong && active) {
    if (active.forceChill || Number(active.chillTurns) > 0) {
      state.monsterStatuses.chillTurns = Math.max(
        finiteInteger(state.monsterStatuses.chillTurns),
        finiteInteger(active.chillTurns, 1),
      );
      pushEvent(events, { type:'monster-status', status:'chill', turns:state.monsterStatuses.chillTurns });
    }
    if (Number(active.stun) > 0) {
      state.monsterStatuses.stunTurns = Math.max(finiteInteger(state.monsterStatuses.stunTurns), finiteInteger(active.stun));
      pushEvent(events, { type:'monster-status', status:'stun', turns:state.monsterStatuses.stunTurns });
    }
    if (active.type === 'shadowDot' && Number(active.stacks) > 0) {
      state.monsterStatuses.shadowStacks = Math.min(
        100,
        finiteInteger(state.monsterStatuses.shadowStacks) + finiteInteger(active.stacks),
      );
      pushEvent(events, { type:'monster-status', status:'shadow', stacks:state.monsterStatuses.shadowStacks });
    }
  }

  if (!wrong && active && state.monsterHp > 0) {
    let heal = 0;
    if (active.type === 'damageHeal') {
      const dealt = events.filter((event) => event.type === 'monster-damage')
        .reduce((sum, event) => sum + event.hpDamage, 0);
      heal += Math.ceil(dealt * (Number(active.healRate) || 0.5));
    }
    if (Number(active.healMaxPct) > 0) heal += Math.ceil(state.playerMaxHp * Number(active.healMaxPct));
    const actual = Math.min(boostedHeal(player, heal), state.playerMaxHp - state.playerHp);
    if (actual > 0) {
      state.playerHp += actual;
      pushEvent(events, { type:'player-heal', amount:actual });
    }
  }
}

function chooseMonsterPattern(state, random) {
  for (const pattern of state.monsterPatterns) {
    if (checkedRandom(random) < Math.max(0, Math.min(1, Number(pattern.chance) || 0))) return pattern;
  }
  return null;
}

function performMonsterAction({ player, state, random, events }) {
  const guardPct = skillScheduleValue(player, 'warrior_basic_guard', 'guardShieldPct');
  if (guardPct > 0 && state.playerHp > 0) {
    const amount = Math.max(0, Math.floor(state.playerHp * guardPct));
    if (amount > 0) {
      state.playerShield = Math.min(1000000, state.playerShield + amount);
      pushEvent(events, { type:'player-shield', amount, source:'guard-training' });
    }
  }
  if (finiteInteger(state.monsterStatuses.stunTurns) > 0) {
    state.monsterStatuses.stunTurns -= 1;
    pushEvent(events, { type:'monster-status', status:'stun', turns:state.monsterStatuses.stunTurns });
    return;
  }
  const pattern = chooseMonsterPattern(state, random);
  if (pattern?.kind === 'selfShield') {
    const amount = Math.max(1, Math.ceil(state.monsterMaxHp * (Number(pattern.percent) || 0)));
    state.monsterShield = Math.min(1000000, state.monsterShield + amount);
    pushEvent(events, { type:'monster-shield', amount });
    return;
  }

  let hitCount = pattern?.kind === 'multi' ? Math.max(1, finiteInteger(pattern.hits, 2)) : 1;
  let multiplier = pattern?.kind === 'heavy' || pattern?.kind === 'multi'
    ? Number(pattern.multiplier) || 1
    : 1;
  const faithMiss = skillScheduleValue(player, 'priest_basic_life', 'monsterMissChance');
  const monsterMissChance = Math.min(1, COMBAT_BALANCE_V3.monsterMissChance + faithMiss);
  const chilled = finiteInteger(state.monsterStatuses.chillTurns) > 0;
  for (let index = 0; index < hitCount && state.playerHp > 0; index += 1) {
    if (checkedRandom(random) < monsterMissChance) {
      pushEvent(events, { type:'monster-miss', hit:index });
      continue;
    }
    let damage = Math.max(1, Math.ceil(state.monsterAttack * multiplier));
    const critical = pattern?.kind === 'critical'
      || checkedRandom(random) < (player.spec === '방어' ? 0.10 : 0.15);
    if (critical) damage = Math.max(1, Math.ceil(damage * 1.8));
    if (chilled) {
      damage = Math.max(1, Math.ceil(damage * 0.5));
    }
    const applied = applyPlayerDamage(state, damage);
    pushEvent(events, {
      type:'player-damage',
      amount:applied.amount,
      hpDamage:applied.hpDamage,
      shieldDamage:applied.shieldDamage,
      critical,
      hit:index,
    });
    if (state.playerHp > 0 && index === 0) {
      const prayerPct = skillScheduleValue(player, 'priest_basic_prayer', 'reflectPct');
      const masteryPct = critical
        ? skillScheduleValue(player, 'warrior_weapon_mastery', 'reflectPct')
        : 0;
      const prayerDamage = Math.max(0, Math.floor(damage * prayerPct));
      const masteryDamage = Math.max(0, Math.floor(damage * masteryPct));
      const reflected = prayerDamage + masteryDamage;
      if (reflected > 0 && state.monsterHp > 0) {
        const reflectedHit = applyMonsterDamage(state, reflected, false);
        pushEvent(events, {
          type:'monster-damage',
          amount:reflectedHit.amount,
          hpDamage:reflectedHit.hpDamage,
          shieldDamage:reflectedHit.shieldDamage,
          reflected:true,
        });
      }
      if (prayerDamage > 0) {
        const actualHeal = Math.min(
          boostedHeal(player, prayerDamage),
          state.playerMaxHp - state.playerHp,
        );
        if (actualHeal > 0) {
          state.playerHp += actualHeal;
          pushEvent(events, { type:'player-heal', amount:actualHeal, source:'prayer-barrier' });
        }
      }
    }
    if (pattern?.kind === 'lifesteal' && applied.hpDamage > 0) {
      state.monsterHp = Math.min(
        state.monsterMaxHp,
        state.monsterHp + Math.ceil(applied.hpDamage * (Number(pattern.percent) || 1)),
      );
    }
  }
  if (chilled) state.monsterStatuses.chillTurns -= 1;
  if (pattern?.kind === 'poison' && state.playerHp > 0) {
    state.playerStatuses.poisonTurns = finiteInteger(pattern.turns, 2);
    state.playerStatuses.poisonDamage = Math.max(1, Math.ceil(state.monsterAttack * 0.3));
    pushEvent(events, {
      type:'player-status',
      status:'poison',
      turns:state.playerStatuses.poisonTurns,
      damage:state.playerStatuses.poisonDamage,
    });
  }
  if (finiteInteger(pattern?.stunTurns) > 0 && state.playerHp > 0) {
    state.playerStatuses.stunTurns = finiteInteger(pattern.stunTurns);
    pushEvent(events, { type:'player-status', status:'stun', turns:state.playerStatuses.stunTurns });
  }

  if (state.playerHp <= 0
    && player.skills.warrior_def_bastion > 0
    && !state.playerStatuses.guardianOathUsed) {
    const rule = SKILL_COMBAT_V3.warrior_def_bastion;
    state.playerStatuses.guardianOathUsed = true;
    state.playerShield = 0;
    state.playerHp = Math.max(1, Math.ceil(state.playerMaxHp * (Number(rule.reviveHealPct) || 1)));
    state.cooldowns.warrior_def_bastion = finiteInteger(rule.reviveCooldown, 11);
    pushEvent(events, {
      type:'player-heal',
      amount:state.playerHp,
      source:'guardian-oath',
    });
    pushEvent(events, { type:'player-status', status:'guardian-oath', used:true });
  }
}

function performRoundDamageOverTime({ player, state, random, events }) {
  const shadowStacks = finiteInteger(state.monsterStatuses.shadowStacks);
  if (shadowStacks > 0 && state.monsterHp > 0) {
    const shadowCritChance = skillScheduleValue(
      player,
      'priest_shadow_void_v24',
      'shadowCritChance',
    );
    const critical = shadowCritChance > 0 && checkedRandom(random) < shadowCritChance;
    const damage = critical ? shadowStacks * 2 : shadowStacks;
    const applied = applyMonsterDamage(state, damage, false);
    pushEvent(events, {
      type:'monster-dot',
      status:'shadow',
      amount:applied.amount,
      hpDamage:applied.hpDamage,
      shieldDamage:applied.shieldDamage,
      stacks:shadowStacks,
      critical,
    });
    const lifestealChance = skillScheduleValue(
      player,
      'priest_shadow_focus_v24',
      'shadowLifestealChance',
    );
    if (applied.hpDamage > 0 && lifestealChance > 0 && checkedRandom(random) < lifestealChance) {
      const actualHeal = Math.min(
        boostedHeal(player, applied.hpDamage),
        state.playerMaxHp - state.playerHp,
      );
      if (actualHeal > 0) {
        state.playerHp += actualHeal;
        pushEvent(events, { type:'player-heal', amount:actualHeal, source:'shadow-focus' });
      }
    }
  }

  const poisonTurns = finiteInteger(state.playerStatuses.poisonTurns);
  if (poisonTurns > 0 && state.playerHp > 0) {
    const amount = Math.max(1, finiteInteger(state.playerStatuses.poisonDamage, 1));
    state.playerHp = Math.max(0, state.playerHp - amount);
    state.playerStatuses.poisonTurns = poisonTurns - 1;
    if (state.playerStatuses.poisonTurns <= 0) {
      delete state.playerStatuses.poisonTurns;
      delete state.playerStatuses.poisonDamage;
    }
    pushEvent(events, {
      type:'player-dot',
      status:'poison',
      amount,
      turns:Math.max(0, poisonTurns - 1),
    });
  }

  const hasAilment = finiteInteger(state.playerStatuses.poisonTurns) > 0
    || finiteInteger(state.playerStatuses.stunTurns) > 0;
  const cleanseChance = skillScheduleValue(player, 'warrior_def_resist', 'cleanseChance');
  if (hasAilment && cleanseChance > 0 && checkedRandom(random) < cleanseChance) {
    delete state.playerStatuses.poisonTurns;
    delete state.playerStatuses.poisonDamage;
    delete state.playerStatuses.stunTurns;
    pushEvent(events, { type:'player-status', status:'cleanse' });
  }
}

function deathExperience(player) {
  if (!player.spec) return player.exp;
  const floor = Number(XP_REQUIREMENTS_V3[player.level - 1]) || 0;
  return floor + Math.floor((Math.max(floor, player.exp) - floor) / 2 + 0.5);
}

export function resolveTurn({
  state:sourceState,
  player,
  actionId,
  answer,
  answerKey,
  random = Math.random,
} = {}) {
  if (String(answer ?? '').length > 512 || String(answerKey ?? '').length < 1
    || String(answerKey ?? '').length > 512) throw new Error('INVALID_ANSWER');
  const state = validateState(sourceState, player);
  const correct = normalizedAnswer(answer) === normalizedAnswer(answerKey);
  const events = [];
  pushEvent(events, correct
    ? { type:'answer-correct' }
    : { type:'answer-wrong', minimumDurationMs:2000 });

  performPlayerAction({
    player,
    state,
    actionId:String(actionId || ''),
    wrong:!correct,
    random,
    events,
  });

  const monsterRule = MONSTER_COMBAT_V3[state.monsterKey];
  if (state.monsterHp <= 0) {
    state.status = 'resolved';
    const rewards = {
      exp:monsterRule.reward.exp,
      gold:monsterRule.reward.gold,
      building:checkedRandom(random) < COMBAT_BALANCE_V3.buildingDropChance ? 1 : 0,
    };
    pushEvent(events, { type:'rewards', ...rewards });
    return sanitizeCombatResponse({
      state,
      correct,
      outcome:'victory',
      rewards,
      events,
      ...(!correct ? { correctAnswer:String(answerKey) } : {}),
    });
  }

  let enemyRounds = 0;
  const takeEnemyRound = () => {
    pushEvent(events, { type:'monster-action' });
    performMonsterAction({ player, state, random, events });
    performRoundDamageOverTime({ player, state, random, events });
    state.cooldowns = tickCooldowns(state.cooldowns);
    if (finiteInteger(state.playerStatuses.intBuffTurns) > 0) {
      state.playerStatuses.intBuffTurns -= 1;
    }
    enemyRounds += 1;
  };
  takeEnemyRound();
  while (state.playerHp > 0
    && state.monsterHp > 0
    && finiteInteger(state.playerStatuses.stunTurns) > 0
    && enemyRounds < 4) {
    state.playerStatuses.stunTurns -= 1;
    pushEvent(events, {
      type:'player-status',
      status:'stun-skipped-action',
      turns:state.playerStatuses.stunTurns,
    });
    takeEnemyRound();
  }
  state.turnNumber += 1;

  if (state.playerHp <= 0) {
    state.status = 'resolved';
    return sanitizeCombatResponse({
      state,
      correct,
      outcome:'defeat',
      rewards:{ exp:0, gold:0, building:0 },
      death:{ expAfter:deathExperience(player) },
      events,
      ...(!correct ? { correctAnswer:String(answerKey) } : {}),
    });
  }
  if (state.monsterHp <= 0) {
    state.status = 'resolved';
    const rewards = {
      exp:monsterRule.reward.exp,
      gold:monsterRule.reward.gold,
      building:checkedRandom(random) < COMBAT_BALANCE_V3.buildingDropChance ? 1 : 0,
    };
    pushEvent(events, { type:'rewards', ...rewards });
    return sanitizeCombatResponse({
      state,
      correct,
      outcome:'victory',
      rewards,
      events,
      ...(!correct ? { correctAnswer:String(answerKey) } : {}),
    });
  }
  return sanitizeCombatResponse({
    state,
    correct,
    outcome:'continue',
    events,
    ...(!correct ? { correctAnswer:String(answerKey) } : {}),
  });
}

export function resolveSurrender(sourceState) {
  if (!sourceState || sourceState.status !== 'active') throw new Error('COMBAT_NOT_ACTIVE');
  const state = clone(sourceState);
  state.status = 'resolved';
  return sanitizeCombatResponse({
    state,
    outcome:'surrender',
    rewards:{ exp:0, gold:0, building:0 },
    events:[{ type:'surrender' }],
  });
}

export function sanitizeCombatResponse(source) {
  const visit = (value) => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== 'object') return value;
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_RESPONSE_KEYS.has(key)) throw new Error('UNSAFE_RESPONSE_FIELD');
      result[key] = visit(entry);
    }
    return result;
  };
  const safe = visit(source);
  if (Array.isArray(safe.events)) {
    if (safe.events.length > 64 || safe.events.some((event) => !EVENT_TYPES.has(event?.type))) {
      throw new Error('INVALID_COMBAT_EVENT');
    }
  }
  if (JSON.stringify(safe).length > 65536) throw new Error('COMBAT_RESPONSE_TOO_LARGE');
  return safe;
}
