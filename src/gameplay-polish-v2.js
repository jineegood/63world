(function (global) {
  'use strict';

  const WELLS = Object.freeze({
    forest:Object.freeze([
      Object.freeze({ id:'forest-entrance', x:560, y:1580 }),
      Object.freeze({ id:'forest-advanced', x:2100, y:1120 }),
    ]),
    desert:Object.freeze([
      Object.freeze({ id:'desert-entrance', x:620, y:1640 }),
      Object.freeze({ id:'desert-advanced', x:2140, y:1180 }),
    ]),
    swamp:Object.freeze([
      Object.freeze({ id:'swamp-entrance', x:680, y:1760 }),
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
      // 기존 배포값(원본 공격력의 80%)에서 30% 더 낮춘다. 원본 3~5에
      // 곧바로 0.7을 곱하면 정수 반올림 결과가 기존과 같은 2~4가 된다.
      const currentAttack = Math.max(1, Math.round(number(next.attack) * 0.8));
      next.attack = Math.max(1, Math.round(currentAttack * 0.7));
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

  function rewardSteps(reward = {}, options = {}) {
    const steps = [];
    let nextDelayMs = 0;
    const add = (kind, amount, tone, sfx, durationMs = 1500) => {
      steps.push({
        kind,
        amount,
        delayMs:nextDelayMs,
        durationMs,
        tone,
        sfx,
      });
      nextDelayMs += durationMs;
    };
    add('exp', Math.max(0, number(reward.exp)), 'exp', 'quest');
    if (number(reward.gold) > 0) add('gold', number(reward.gold), 'gold', 'coin');
    if (number(reward.building) > 0) {
      add('building', number(reward.building), 'building', 'open', options.monsterRandomBuilding ? 2000 : 1500);
    }
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
