import { PVP_SKILLS } from './pvp-catalog.mjs';

const LIMITS = Object.freeze({
  level:[1, 100],
  maxHp:[1, 100000],
  primaryStat:[1, 20000],
  attack:[1, 10000],
  defense:[0, 10000],
});
const CLASS_SPECS = Object.freeze({
  warrior:new Set(['방어', '무기']),
  mage:new Set(['냉기', '화염']),
  priest:new Set(['신성', '암흑']),
});
export const PVP_DAMAGE_MULTIPLIER = 0.5;
export const PVP_BASE_MISS_CHANCE = 0.10;
export const PVP_BASE_CRIT_CHANCE = 0.15;
const RANDOM_SCALE = 1000000;

function clamp(value, [minimum, maximum]) {
  const number = Number(value);
  return Math.max(minimum, Math.min(maximum, Number.isFinite(number) ? number : minimum));
}

function boundedText(value, maximum = 48) {
  return String(value ?? '').trim().slice(0, maximum);
}

function cleanNumberMap(raw, maximum = 99) {
  const result = {};
  if (!raw || typeof raw !== 'object') return result;
  for (const [key, value] of Object.entries(raw)) {
    const number = Math.trunc(Number(value));
    if (PVP_SKILLS[key] && Number.isFinite(number) && number > 0) {
      result[key] = Math.min(maximum, number);
    }
  }
  return result;
}

export function normalizeSnapshot(raw = {}) {
  const className = CLASS_SPECS[raw.className] ? raw.className : 'warrior';
  const maxHp = Math.trunc(clamp(raw.maxHp, LIMITS.maxHp));
  const skills = cleanNumberMap(raw.skills, 5);
  for (const id of Object.keys(skills)) {
    skills[id] = Math.min(skills[id], Math.max(1, Number(PVP_SKILLS[id].maxPoints) || 1));
  }
  return {
    userId:boundedText(raw.userId, 80),
    name:boundedText(raw.name || '학생', 24),
    level:Math.trunc(clamp(raw.level, LIMITS.level)),
    className,
    spec:CLASS_SPECS[className].has(raw.spec) ? raw.spec : '',
    maxHp,
    hp:Math.trunc(Math.max(0, Math.min(maxHp, Number(raw.hp) || 0))),
    shield:Math.trunc(Math.max(0, Math.min(maxHp * 3, Number(raw.shield) || 0))),
    /* 일반 사냥은 가공된 attack 값이 아니라 힘/지능/정신 원값으로
       매 타격 공격력을 굴린다. 예전 PVP 상태에는 primaryStat이 없으므로
       그 경우에만 기존 attack의 두 배를 안전한 호환값으로 사용한다. */
    primaryStat:Math.trunc(clamp(raw.primaryStat ?? (Number(raw.attack) || 1) * 2, LIMITS.primaryStat)),
    attack:Math.trunc(clamp(raw.attack, LIMITS.attack)),
    defense:Math.trunc(clamp(raw.defense, LIMITS.defense)),
    appearance:raw.appearance && typeof raw.appearance === 'object' && !Array.isArray(raw.appearance)
      ? { ...raw.appearance }
      : {},
    equipment:raw.equipment && typeof raw.equipment === 'object' && !Array.isArray(raw.equipment)
      ? { ...raw.equipment }
      : {},
    costume:raw.costume && typeof raw.costume === 'object' && !Array.isArray(raw.costume)
      ? { ...raw.costume }
      : {},
    skills,
    cooldowns:cleanNumberMap(raw.cooldowns),
    buffs:raw.buffs && typeof raw.buffs === 'object' ? {
      intBuffTurns:Math.max(0, Math.trunc(Number(raw.buffs.intBuffTurns) || 0)),
      intBuffPct:Math.max(0, Math.min(2, Number(raw.buffs.intBuffPct) || 0.30)),
      battleRoarTurns:Math.max(0, Math.trunc(Number(raw.buffs.battleRoarTurns) || 0)),
    } : { intBuffTurns:0, intBuffPct:0.30, battleRoarTurns:0 },
    chargeActive:raw.chargeActive === true,
    bastionUsed:raw.bastionUsed === true,
    elementalBarrierUsed:raw.elementalBarrierUsed === true,
    statuses:raw.statuses && typeof raw.statuses === 'object' ? {
      stun:Math.max(0, Math.trunc(Number(raw.statuses.stun) || 0)),
      chill:Math.max(0, Math.trunc(Number(raw.statuses.chill) || 0)),
      shadow:Math.max(0, Math.trunc(Number(raw.statuses.shadow) || 0)),
    } : {},
  };
}

export function selectQuestion(workbooks, randomInt) {
  const questions = (Array.isArray(workbooks) ? workbooks : [])
    .filter((workbook) => workbook?.enabled === true)
    .flatMap((workbook) => Array.isArray(workbook.questions) ? workbook.questions : [])
    .filter((question) => boundedText(question?.q || question?.prompt || question?.question, 500));
  if (!questions.length) return null;
  const index = randomInt(0, questions.length - 1);
  const selected = questions[Math.max(0, Math.min(questions.length - 1, index))];
  return Object.freeze({
    id:boundedText(selected.id || `question-${index}`, 100),
    prompt:boundedText(selected.q || selected.prompt || selected.question, 500),
    choices:Array.isArray(selected.choices) ? selected.choices.slice(0, 8).map((choice) => boundedText(choice, 120)) : [],
    answer:boundedText(selected.answer, 120),
  });
}

export function publicQuestion(question) {
  if (!question) return null;
  return {
    id:question.id,
    prompt:question.prompt,
    choices:[...(question.choices || [])],
  };
}

export function judgeAnswer(question, submittedAnswer) {
  return boundedText(submittedAnswer, 120).toLocaleLowerCase('ko-KR')
    === boundedText(question?.answer, 120).toLocaleLowerCase('ko-KR');
}

export function rollInitiative(randomInt) {
  const rolls = [];
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const roll = { a:randomInt(1, 30), b:randomInt(1, 30) };
    rolls.push(roll);
    if (roll.a !== roll.b) return { rolls, first:roll.a > roll.b ? 'a' : 'b' };
  }
  return { rolls, first:'a' };
}

function actionFor(player, actionId) {
  if (!actionId || actionId === 'basic') return { id:'basic', active:{ type:'damage', multiplier:1 } };
  const skill = PVP_SKILLS[actionId];
  if (
    !skill || !skill.active || !player.skills[actionId]
    || (skill.classOnly && skill.classOnly !== player.className)
    || (skill.specOnly && skill.specOnly !== player.spec)
    || Number(player.cooldowns[actionId] || 0) > 0
  ) return { id:'basic', active:{ type:'damage', multiplier:1 } };
  return skill;
}

function skillRank(player, skillId) {
  return Math.max(0, Math.trunc(Number(player?.skills?.[skillId]) || 0));
}

function rankedValue(skillId, key, rank) {
  return Number(PVP_SKILLS[skillId]?.[key]?.[rank] || 0);
}

function unitRoll(randomInt) {
  return randomInt(0, RANDOM_SCALE - 1) / RANDOM_SCALE;
}

/* 일반 사냥 getPlayerAttackPowerV25와 같은 공식이다. primaryStat은
   힘/지능/정신 원값이며, 다단히트에서도 이 함수를 타격마다 다시 부른다. */
function rollAttackPower(source, randomInt) {
  const stat = Math.max(1, Number(source.primaryStat) || Math.max(1, Number(source.attack) || 1) * 2);
  let minimumBonus = -stat * 0.20;
  let maximumBonus = stat * 0.20;
  if (source.buffs?.battleRoarTurns > 0) {
    minimumBonus = stat * 0.05;
    maximumBonus = stat * 0.15;
  }
  const roll = unitRoll(randomInt);
  let power = stat / 2 + minimumBonus + roll * (maximumBonus - minimumBonus);
  let maximumPower = stat / 2 + maximumBonus;
  if (source.className === 'mage' && source.buffs?.intBuffTurns > 0) {
    const multiplier = 1 + Math.max(0, Number(source.buffs.intBuffPct) || 0.30);
    power *= multiplier;
    maximumPower *= multiplier;
  }
  return {
    power:Math.max(1, Math.round(power)),
    maximumPower:Math.max(1, Math.round(maximumPower)),
  };
}

function targetMissChance(target) {
  const faithRank = target.className === 'priest' ? skillRank(target, 'priest_basic_life') : 0;
  return Math.min(1, PVP_BASE_MISS_CHANCE
    + rankedValue('priest_basic_life', 'monsterMissChance', faithRank));
}

function sourceCritChance(source) {
  const fireRank = source.className === 'mage' && source.spec === '화염'
    ? skillRank(source, 'mage_fire_focus_v24')
    : 0;
  return Math.min(1, PVP_BASE_CRIT_CHANCE
    + rankedValue('mage_fire_focus_v24', 'critChanceBonus', fireRank));
}

function sourceCritMultiplier(source, isSkill) {
  const fireSkill = isSkill && source.className === 'mage' && source.spec === '화염';
  if (!fireSkill) return 1.5;
  const emberRank = skillRank(source, 'mage_fire_ember_v24');
  return 2 + rankedValue('mage_fire_ember_v24', 'critDmgBonus', emberRank);
}

function healBoost(source, amount) {
  if (!(amount > 0)) return 0;
  const graceRank = source.className === 'priest' ? skillRank(source, 'priest_holy_grace_v24') : 0;
  const bonus = rankedValue('priest_holy_grace_v24', 'healBoost', graceRank);
  return Math.max(1, Math.round(amount * (1 + bonus)));
}

/* PVP 고유 규칙은 일반 사냥 계산이 끝난 최종 공격 피해에만 50%를
   적용한다. 보호막과 회복량에는 이 배율을 적용하지 않는다. */
function pvpDamageAmount(rawDamage, target) {
  const afterDefense = Math.max(1, Math.ceil(Number(rawDamage) || 0) - Math.max(0, Number(target.defense) || 0));
  return Math.max(1, Math.round(afterDefense * PVP_DAMAGE_MULTIPLIER));
}

function applyDamage(sourceKey, targetKey, state, amount, active, events, metadata = {}) {
  const target = state[targetKey];
  const bypass = active.ignoreShield === true;
  const absorbed = bypass ? 0 : Math.min(target.shield, amount);
  target.shield -= absorbed;
  const hpDamage = Math.min(target.hp, amount - absorbed);
  target.hp -= hpDamage;
  events.push({
    kind:'damage',
    source:sourceKey,
    target:targetKey,
    amount:hpDamage + absorbed,
    requestedAmount:amount,
    absorbed,
    hpDamage,
    missed:false,
    critical:metadata.critical === true,
    hitIndex:Math.max(0, Math.trunc(Number(metadata.hitIndex) || 0)),
    label:boundedText(metadata.label, 40),
    skillId:boundedText(metadata.skillId, 80),
  });
}

function addMissEvent(sourceKey, targetKey, events, metadata = {}) {
  events.push({
    kind:'damage', source:sourceKey, target:targetKey,
    amount:0, requestedAmount:0, absorbed:0, hpDamage:0,
    missed:true, critical:false,
    hitIndex:Math.max(0, Math.trunc(Number(metadata.hitIndex) || 0)),
    label:boundedText(metadata.label, 40),
    skillId:boundedText(metadata.skillId, 80),
  });
}

function applyHeal(sourceKey, targetKey, state, requested, events, metadata = {}) {
  const target = state[targetKey];
  if (!target || target.hp <= 0) return 0;
  const amount = Math.min(Math.max(0, target.maxHp - target.hp), Math.max(0, Math.trunc(requested)));
  target.hp += amount;
  if (amount > 0) {
    events.push({
      kind:'heal', source:sourceKey, target:targetKey, amount,
      skillId:boundedText(metadata.skillId, 80),
      passive:metadata.passive === true,
    });
  }
  return amount;
}

function applyStatus(sourceKey, targetKey, state, status, amount, events, metadata = {}) {
  const target = state[targetKey];
  if (!target || target.hp <= 0) return;
  if (status === 'shadow') {
    const added = Math.max(1, Math.trunc(Number(amount) || 1));
    target.statuses.shadow = Math.min(99, Math.max(0, Number(target.statuses.shadow) || 0) + added);
    events.push({
      kind:'status', source:sourceKey, target:targetKey, status:'shadow',
      turns:target.statuses.shadow, amount:added, mode:'add',
      skillId:boundedText(metadata.skillId, 80),
    });
    return;
  }
  const turns = Math.max(1, Math.trunc(Number(amount) || 1));
  target.statuses[status] = Math.max(Math.max(0, Number(target.statuses[status]) || 0), turns);
  events.push({
    kind:'status', source:sourceKey, target:targetKey, status,
    turns:target.statuses[status], amount:turns, mode:'max',
    skillId:boundedText(metadata.skillId, 80),
  });
}

function applyBlockTraining(ownerKey, state, events) {
  const owner = state[ownerKey];
  if (owner.className !== 'warrior') return;
  const rank = Math.max(0, Math.trunc(Number(owner.skills.warrior_basic_guard) || 0));
  const rates = PVP_SKILLS.warrior_basic_guard?.guardShieldPct || [];
  const rate = Number(rates[rank] || 0);
  if (!(owner.hp > 0) || !(rank > 0) || !(rate > 0)) return;
  const amount = Math.max(1, Math.floor(owner.hp * rate));
  owner.shield += amount;
  events.push({
    kind:'shield',
    source:ownerKey,
    target:ownerKey,
    skillId:'warrior_basic_guard',
    passive:true,
    amount,
  });
}

function applyElementalBarrierAfterDamage(ownerKey, state, hpBefore, events) {
  const owner = state[ownerKey];
  const rank = Math.max(0, Math.trunc(Number(owner.skills.mage_basic_element) || 0));
  const skill = PVP_SKILLS.mage_basic_element || {};
  const triggerHpPct = Number(skill.triggerHpPct || 0);
  const shieldPct = Number(skill.emergencyShieldPct?.[rank] || 0);
  if (
    owner.elementalBarrierUsed
    || owner.className !== 'mage'
    || !(rank > 0)
    || !(shieldPct > 0)
    || !(owner.hp > 0)
    || !(owner.hp < hpBefore)
    || !(owner.hp / Math.max(1, owner.maxHp) <= triggerHpPct)
  ) return;
  owner.elementalBarrierUsed = true;
  const amount = Math.max(1, Math.ceil(owner.maxHp * shieldPct));
  owner.shield += amount;
  events.push({
    kind:'shield', source:ownerKey, target:ownerKey,
    skillId:'mage_basic_element', passive:true, amount,
  });
}

function applyAction(sourceKey, targetKey, entry, state, events, randomInt) {
  const source = state[sourceKey];
  const target = state[targetKey];
  if (source.hp <= 0) return;
  if (source.statuses.stun > 0) {
    /* 선공에게 이번 라운드 기절을 맞은 후공은 즉시 한 행동을 잃는다.
       후공이 선공에게 건 기절은 다음 라운드 선공 행동 때 소비된다. */
    source.statuses.stun = Math.max(0, source.statuses.stun - 1);
    return;
  }
  const skill = actionFor(source, entry.actionId);
  const active = skill.active;
  const isSkill = skill.id !== 'basic';
  const correct = entry.correct === true;
  const damagingType = ['damage', 'damageHeal', 'shadowDot'].includes(active.type);

  /* 일반 사냥의 오답 규칙: 기본 공격과 피해 액티브만 타격별 공격력
     난수를 굴리고 절반 피해를 준다. 빗나감·치명타·회복·상태이상·
     기본 공격 추가타는 없고, 지원 액티브는 쿨타임조차 쓰지 않는다. */
  if (!correct) {
    if (isSkill && !damagingType) return;
    const hitCount = Math.max(1, Math.trunc(Number(active.hits) || 1));
    const multiplier = hitCount > 1 ? Number(active.hitMult) || 1 : Number(active.multiplier) || 1;
    if (isSkill && multiplier === 0 && hitCount === 1) return;
    if (isSkill) {
      source.cooldowns[skill.id] = Math.max(0, Number(active.cooldown) || 0);
      events.push({ kind:'cooldown', source:sourceKey, target:sourceKey, skillId:skill.id, amount:source.cooldowns[skill.id] });
    }
    for (let hitIndex = 0; hitIndex < hitCount && target.hp > 0; hitIndex += 1) {
      const attackRoll = rollAttackPower(source, randomInt);
      const normalDamage = Math.max(1, Math.ceil(attackRoll.power * multiplier));
      const huntingWrongDamage = Math.max(1, Math.floor(normalDamage * 0.5));
      const amount = pvpDamageAmount(huntingWrongDamage, target);
      applyDamage(sourceKey, targetKey, state, amount, active, events, {
        critical:false, hitIndex, label:active.name || skill.name || '공격', skillId:skill.id,
      });
    }
    return;
  }

  if (isSkill) {
    source.cooldowns[skill.id] = Math.max(0, Number(active.cooldown) || 0);
    events.push({ kind:'cooldown', source:sourceKey, target:sourceKey, skillId:skill.id, amount:source.cooldowns[skill.id] });
  }

  if (active.type === 'shield') {
    const shield = Math.max(1, Math.ceil(source.maxHp * Number(active.shieldPct || 0)));
    source.shield += shield;
    events.push({ kind:'shield', source:sourceKey, target:sourceKey, skillId:skill.id, amount:shield });
    return;
  }

  if (active.type === 'buff') {
    source.buffs.intBuffTurns = Math.max(source.buffs.intBuffTurns, Math.max(1, Math.trunc(Number(active.buffTurns) || 3)));
    source.buffs.intBuffPct = Math.max(source.buffs.intBuffPct, Math.max(0, Number(active.buffPct) || 0.30));
    const requested = healBoost(source, Math.max(1, Math.ceil(source.maxHp * Number(active.healMaxPct || 0))));
    applyHeal(sourceKey, sourceKey, state, requested, events, { skillId:skill.id });
    return;
  }

  if (active.type === 'healAllies') {
    /* 1:1 PVP에서는 생존 아군이 자신 한 명뿐이다. 일반 사냥과 같이
       치유 숙련 추가 배율 없이 대상 최대 HP 비례량을 회복한다. */
    const requested = Math.max(1, Math.ceil(source.maxHp * Number(active.healMaxPct || 0)));
    applyHeal(sourceKey, sourceKey, state, requested, events, { skillId:skill.id });
    return;
  }

  if (active.type === 'charge') {
    source.chargeActive = true;
    return;
  }

  if (active.type === 'shieldBash') {
    const shield = Math.max(1, Math.ceil(source.maxHp * Number(active.shieldPct || 0)));
    source.shield += shield;
    events.push({ kind:'shield', source:sourceKey, target:sourceKey, skillId:skill.id, amount:shield });
  }

  const hitPlans = [];
  const attackDamagingType = damagingType || active.type === 'shieldBash' || skill.id === 'basic';
  const hitCount = attackDamagingType ? Math.max(1, Math.trunc(Number(active.hits) || 1)) : 1;
  for (let hitIndex = 0; hitIndex < hitCount; hitIndex += 1) {
    if (active.type === 'shieldBash') {
      hitPlans.push({ raw:Math.min(100, Math.max(0, Math.trunc(source.shield))), canCrit:true, hitIndex, label:active.name || skill.name });
    } else if (isSkill && attackDamagingType) {
      const multiplier = hitCount > 1 ? Number(active.hitMult) || 1 : Number(active.multiplier) || 1;
      hitPlans.push(multiplier === 0
        ? { raw:0, canCrit:false, hitIndex, label:active.name || skill.name }
        : { attackMultiplier:multiplier, canCrit:true, hitIndex, label:active.name || skill.name });
    } else {
      hitPlans.push({ attackMultiplier:1, canCrit:true, hitIndex, label:'공격' });
    }
  }

  /* 일반 공격 전용 추가타도 사냥과 같은 독립 적중 판정을 사용한다. */
  if (!isSkill) {
    const armorRank = source.className === 'warrior' ? skillRank(source, 'warrior_def_armor') : 0;
    const armorRate = rankedValue('warrior_def_armor', 'armorBonusPct', armorRank);
    if (armorRank > 0 && armorRate > 0) {
      hitPlans.push({
        raw:Math.max(1, Math.ceil(source.maxHp * armorRate)), canCrit:false,
        hitIndex:hitPlans.length, label:'공세 갑옷', bonus:true,
      });
    }
    const doubleRank = source.className === 'warrior' ? skillRank(source, 'warrior_weapon_breaker') : 0;
    const doubleRate = rankedValue('warrior_weapon_breaker', 'doubleAttackPct', doubleRank);
    if (doubleRank > 0 && doubleRate > 0) {
      hitPlans.push({
        attackMultiplier:doubleRate, canCrit:true,
        hitIndex:hitPlans.length, label:'더블 어택', doubleAttack:true,
      });
    }
  }

  const hasDamagePlan = hitPlans.some((hit) => Number(hit.raw) > 0 || Number(hit.attackMultiplier) > 0);
  const chargePending = source.chargeActive && hasDamagePlan;
  const chargeMultiplier = Number(PVP_SKILLS.warrior_weapon_judgment?.active?.chargeMult || 2.8);
  const chillPending = source.statuses.chill > 0 && hasDamagePlan;
  let landedAction = false;
  let totalDamage = 0;

  for (const hit of hitPlans) {
    if (target.hp <= 0) break;
    let raw = Math.max(0, Number(hit.raw) || 0);
    let maximumRaw = 0;
    if (Number(hit.attackMultiplier) > 0) {
      const attackRoll = rollAttackPower(source, randomInt);
      raw = attackRoll.power * Number(hit.attackMultiplier);
      maximumRaw = attackRoll.maximumPower * Number(hit.attackMultiplier);
    }

    const missed = unitRoll(randomInt) < targetMissChance(target);
    if (missed) {
      addMissEvent(sourceKey, targetKey, events, {
        hitIndex:hit.hitIndex, label:hit.label, skillId:skill.id,
      });
      continue;
    }

    landedAction = true;
    const critical = hit.canCrit && unitRoll(randomInt) < sourceCritChance(source);
    const criticalMultiplier = critical ? sourceCritMultiplier(source, isSkill) : 1;
    let huntingDamage = raw > 0 ? Math.max(1, Math.ceil(raw)) : 0;
    if (critical) {
      huntingDamage = Math.max(1, Math.ceil(huntingDamage * criticalMultiplier));
      if (maximumRaw > raw) huntingDamage = Math.max(huntingDamage, Math.ceil(maximumRaw));
    }
    if (huntingDamage > 0 && chargePending) huntingDamage = Math.max(1, Math.ceil(huntingDamage * chargeMultiplier));
    if (huntingDamage > 0 && chillPending) huntingDamage = Math.ceil(huntingDamage * 0.5);

    if (huntingDamage <= 0) continue;
    const amount = pvpDamageAmount(huntingDamage, target);
    const beforeCount = events.length;
    applyDamage(sourceKey, targetKey, state, amount, active, events, {
      critical, hitIndex:hit.hitIndex, label:hit.label, skillId:skill.id,
    });
    const damageEvent = events[beforeCount];
    totalDamage += Math.max(0, Number(damageEvent?.amount) || 0);
  }

  /* 차지와 냉기는 한 타라도 적중해 실제 피해 행동이 성립했을 때만 소모한다. */
  if (landedAction && chargePending) source.chargeActive = false;
  if (landedAction && chillPending && totalDamage > 0) source.statuses.chill = Math.max(0, source.statuses.chill - 1);

  if (isSkill && landedAction) {
    if (active.type === 'shadowDot' && Number(active.stacks) > 0) {
      applyStatus(sourceKey, targetKey, state, 'shadow', active.stacks, events, { skillId:skill.id });
    }
    if (Number(active.stun) > 0) {
      applyStatus(sourceKey, targetKey, state, 'stun', active.stun, events, { skillId:skill.id });
    }
    const chillTurns = Math.max(
      0,
      Number(active.chillTurns) || 0,
      Number(active.weakenTurns) || 0,
      active.forceChill === true && source.className === 'mage' && source.spec === '냉기' ? 2 : 0,
    );
    if (chillTurns > 0) {
      applyStatus(sourceKey, targetKey, state, 'chill', chillTurns, events, { skillId:skill.id });
    }
    if (totalDamage > 0 && damagingType) {
      const frostRank = source.className === 'mage' && source.spec === '냉기'
        ? skillRank(source, 'mage_frost_focus_v24')
        : 0;
      const frostChance = rankedValue('mage_frost_focus_v24', 'activeStunChance', frostRank);
      if (frostRank > 0 && unitRoll(randomInt) < frostChance) {
        applyStatus(sourceKey, targetKey, state, 'stun', 1, events, {
          skillId:'mage_frost_focus_v24',
        });
      }
    }
  }

  if (totalDamage > 0 && source.className === 'mage' && source.spec === '냉기' && active.forceChill !== true) {
    if (unitRoll(randomInt) < 0.20) {
      applyStatus(sourceKey, targetKey, state, 'chill', 2, events, { skillId:skill.id });
    }
  }
  if (totalDamage > 0 && source.className === 'priest' && source.spec === '암흑') {
    const shadowSkill = isSkill && String(skill.id).startsWith('priest_shadow_');
    if (!shadowSkill) applyStatus(sourceKey, targetKey, state, 'shadow', 1, events, { skillId:skill.id });
  }

  if (isSkill && totalDamage > 0) {
    let requested = 0;
    const healRate = active.type === 'damageHeal' ? Number(active.healRate || 0) : 0;
    const healMaxPct = Number(active.healMaxPct || 0);
    if (healRate > 0) requested += Math.max(1, Math.ceil(totalDamage * healRate));
    if (healMaxPct > 0) requested += Math.max(1, Math.ceil(source.maxHp * healMaxPct));
    if (requested > 0) {
      applyHeal(sourceKey, sourceKey, state, healBoost(source, requested), events, { skillId:skill.id });
    }
  }
}

function tickState(player) {
  for (const key of Object.keys(player.cooldowns)) player.cooldowns[key] = Math.max(0, player.cooldowns[key] - 1);
  if (player.buffs.intBuffTurns > 0) player.buffs.intBuffTurns -= 1;
  if (player.buffs.battleRoarTurns > 0) player.buffs.battleRoarTurns -= 1;
}

export function resolveRound({ match, a, b, randomInt }) {
  const state = { a:normalizeSnapshot(a.player), b:normalizeSnapshot(b.player) };
  const initiative = rollInitiative(randomInt);
  const events = [];
  const order = initiative.first === 'a' ? [['a', 'b', a], ['b', 'a', b]] : [['b', 'a', b], ['a', 'b', a]];
  for (const [sourceKey, targetKey, entry] of order) {
    if (state[sourceKey].hp <= 0 || state[targetKey].hp <= 0) break;
    events.push({
      kind:'action',
      source:sourceKey,
      target:targetKey,
      actionId:actionFor(state[sourceKey], entry.actionId).id,
      correct:entry.correct === true,
      prevented:state[sourceKey].statuses.stun > 0 ? 'stun' : null,
    });
    const targetHpBefore = state[targetKey].hp;
    applyAction(sourceKey, targetKey, entry, state, events, randomInt);
    applyElementalBarrierAfterDamage(targetKey, state, targetHpBefore, events);
    /* 일반 사냥과 같은 순서: 막기 훈련은 상대에게 맞기 직전 갑자기
       생기는 방어 보너스가 아니라, 자신의 행동을 마친 뒤 다음 반격을
       대비해 만드는 보호막이다. 전투가 끝났다면 불필요하게 생성하지 않는다. */
    if (state[sourceKey].hp > 0 && state[targetKey].hp > 0) {
      applyBlockTraining(sourceKey, state, events);
    }
  }
  tickState(state.a);
  tickState(state.b);
  const matchId = boundedText(match?.id || 'match', 100);
  const round = Math.max(1, Math.trunc(Number(match?.round) || 1));
  return {
    state,
    initiative,
    events:events.map((event, index) => Object.freeze({ ...event, id:`${matchId}:${round}:${index}` })),
    winner:state.a.hp <= 0 ? 'b' : state.b.hp <= 0 ? 'a' : null,
  };
}
