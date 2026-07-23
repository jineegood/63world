(function (global) {
  'use strict';

  const WELLS = Object.freeze({
    forest:Object.freeze([
      Object.freeze({ id:'forest-entrance', x:560, y:1780 }),
      Object.freeze({ id:'forest-advanced', x:2100, y:1120 }),
    ]),
    desert:Object.freeze([
      Object.freeze({ id:'desert-entrance', x:620, y:1840 }),
      Object.freeze({ id:'desert-advanced', x:2140, y:1180 }),
    ]),
    swamp:Object.freeze([
      Object.freeze({ id:'swamp-entrance', x:680, y:1940 }),
      Object.freeze({ id:'swamp-advanced', x:2400, y:1220 }),
    ]),
  });

  const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

  function deathExperience({ currentExp, levelStartExp, hasSpecialization } = {}) {
    const current = Math.max(0, number(currentExp));
    const floor = Math.max(0, Math.min(current, number(levelStartExp)));
    if (!hasSpecialization) return current;
    return floor + Math.floor((current - floor) / 2 + 0.5);
  }

  function tuneNormalMonster(monster) {
    const next = { ...monster };
    if (next.elite) return next;
    if (next.type === 'mushroom') {
      next.attack = Math.max(1, Math.round(number(next.attack) * 0.8));
    }
    if (next.type === 'slime') {
      next.maxHp = Math.max(1, Math.round(number(next.maxHp ?? next.hp) * 1.1));
      next.hp = next.maxHp;
    }
    return next;
  }

  function wrongHitDamage(damage) {
    const original = number(damage);
    return original > 0 ? Math.max(1, Math.floor(original * 0.5)) : 0;
  }

  function ownsAllCostumes(ownedIds = [], availableIds = []) {
    const owned = new Set(Array.isArray(ownedIds) ? ownedIds : []);
    return Array.isArray(availableIds) && availableIds.length > 0
      && availableIds.every((id) => owned.has(id));
  }

  function rewardSteps(reward = {}) {
    const steps = [];
    const add = (kind, amount, tone, sfx) => steps.push({
      kind,
      amount,
      delayMs:steps.length * 1000,
      durationMs:1000,
      tone,
      sfx,
    });
    add('exp', Math.max(0, number(reward.exp)), 'exp', 'quest');
    if (number(reward.gold) > 0) add('gold', number(reward.gold), 'gold', 'coin');
    if (number(reward.building) > 0) add('building', number(reward.building), 'building', 'open');
    return Object.freeze(steps.map(Object.freeze));
  }

  function getHealingWells(mapKey) {
    return WELLS[mapKey] || Object.freeze([]);
  }

  global.YuksamGameplayPolishV2 = Object.freeze({
    deathExperience,
    tuneNormalMonster,
    wrongHitDamage,
    ownsAllCostumes,
    rewardSteps,
    getHealingWells,
  });
})(window);
