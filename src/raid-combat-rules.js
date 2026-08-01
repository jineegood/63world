/* =========================================================
   raid-combat-rules.js — 63빌딩 3인 던전 전투 계산

   화면과 네트워크를 건드리지 않는 순수 계산 모듈이다. 스킬 수치는
   YuksamData.SKILL_DEFS를 그대로 읽어 일반 사냥터와 한 곳에서 관리한다.
   ========================================================= */
(function initYuksamRaidCombatRules(global) {
  'use strict';

  const BASIC_ACTION = 'basic';
  const ATTACK_ORDER = Object.freeze({ front:0, middle:1, back:2 });
  const BASE_MISS_CHANCE = 0.10;
  const BASE_CRIT_CHANCE = 0.15;
  const BASE_CRIT_MULTIPLIER = 1.5;
  const FIRE_SKILL_CRIT_MULTIPLIER = 2.0;
  const MAX_SHADOW_STACKS = 20;

  const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const integer = (value, fallback = 0) => Math.trunc(number(value, fallback));
  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, number(value, minimum)));
  const roll = (rng) => typeof rng === 'function' ? clamp(rng(), 0, 1) : Math.random();

  function copyNumberMap(source) {
    const result = {};
    if (!source || typeof source !== 'object' || Array.isArray(source)) return result;
    Object.entries(source).forEach(([key, value]) => {
      const safe = Math.max(0, integer(value));
      if (safe > 0) result[String(key)] = safe;
    });
    return result;
  }

  function skillDefs(override) {
    return override || global.YuksamData?.SKILL_DEFS || {};
  }

  function skillRank(member, skillId) {
    return Math.max(0, integer(member?.skills?.[skillId]));
  }

  function normalizeStatuses(source) {
    const value = source && typeof source === 'object' ? source : {};
    return {
      stunTurns:Math.max(0, integer(value.stunTurns ?? value.stun)),
      chillTurns:Math.max(0, integer(value.chillTurns ?? value.chill ?? value.weakenTurns)),
      poisonTurns:Math.max(0, integer(value.poisonTurns ?? value.poison)),
      poisonDamage:Math.max(0, integer(value.poisonDamage ?? value.poisonDmg)),
    };
  }

  function normalizeBuffs(source) {
    const value = source && typeof source === 'object' ? source : {};
    return {
      intBuffTurns:Math.max(0, integer(value.intBuffTurns)),
      intBuffPct:Math.max(0, number(value.intBuffPct, 0.30)),
      battleRoarTurns:Math.max(0, integer(value.battleRoarTurns ?? value.battleRoar)),
    };
  }

  function normalizeMember(member = {}) {
    const maxHp = Math.max(1, integer(member.maxHp, 1));
    const hp = Math.max(0, Math.min(maxHp, integer(member.hp ?? maxHp, maxHp)));
    return {
      ...member,
      id:String(member.id || ''),
      name:String(member.name || '동료'),
      klass:member.klass || member.className || member.class || 'warrior',
      spec:member.spec === '분노' ? '무기' : (member.spec || ''),
      maxHp,
      hp,
      attack:Math.max(1, number(member.attack, 1)),
      skills:copyNumberMap(member.skills),
      cooldowns:copyNumberMap(member.cooldowns || member.skillCooldowns),
      shield:Math.max(0, integer(member.shield)),
      statuses:normalizeStatuses(member.statuses || member.ailments),
      buffs:normalizeBuffs(member.buffs || member.combatBuffs),
      chargeActive:member.chargeActive === true,
      bastionUsed:member.bastionUsed === true,
    };
  }

  function normalizeMonster(monster = {}) {
    const maxHp = Math.max(1, integer(monster.maxHp ?? monster.hp, 1));
    const sourceMap = monster.shadowBySource && typeof monster.shadowBySource === 'object'
      ? monster.shadowBySource
      : {};
    return {
      ...monster,
      maxHp,
      hp:Math.max(0, Math.min(maxHp, integer(monster.hp ?? maxHp, maxHp))),
      shield:Math.max(0, integer(monster.shield)),
      stunTurns:Math.max(0, integer(monster.stunTurns ?? monster.stun)),
      chillTurns:Math.max(0, integer(monster.chillTurns ?? monster.chill ?? monster.weakenTurns)),
      shadowBySource:copyNumberMap(sourceMap),
      pattern:Array.isArray(monster.pattern) ? [...monster.pattern] : monster.pattern,
    };
  }

  function resetMemberForEncounter(member) {
    member.shield = 0;
    member.statuses = normalizeStatuses();
    member.buffs = normalizeBuffs();
    member.chargeActive = false;
    member.bastionUsed = false;
    return member;
  }

  function resetMonsterForEncounter(monster) {
    monster.shield = 0;
    monster.stunTurns = 0;
    monster.chillTurns = 0;
    monster.shadowBySource = {};
    return monster;
  }

  function normalizeSubmission(value) {
    if (typeof value === 'boolean') return { correct:value, actionId:BASIC_ACTION };
    const entry = value && typeof value === 'object' ? value : {};
    return {
      correct:entry.correct === true,
      actionId:String(entry.actionId || entry.action || BASIC_ACTION),
    };
  }

  function actionFor(member, requestedActionId, defsOverride) {
    const defs = skillDefs(defsOverride);
    const actionId = String(requestedActionId || BASIC_ACTION).replace(/^active:/, '');
    if (!actionId || actionId === BASIC_ACTION || actionId === 'attack') {
      return { id:BASIC_ACTION, name:'공격', classOnly:member.klass, active:{ type:'damage', multiplier:1 } };
    }
    const skill = defs[actionId];
    if (!skill?.active
      || skillRank(member, actionId) <= 0
      || (skill.classOnly && skill.classOnly !== member.klass)
      || (skill.specOnly && skill.specOnly !== member.spec)
      || number(member.cooldowns?.[actionId]) > 0) {
      return { id:BASIC_ACTION, name:'공격', classOnly:member.klass, active:{ type:'damage', multiplier:1 } };
    }
    return skill;
  }

  function audioIdForAction(actionId, klass) {
    const manifest = global.YuksamAudioManifest;
    if (actionId && actionId !== BASIC_ACTION) return manifest?.skillSounds?.[actionId] || null;
    return manifest?.classBasicSounds?.[klass] || null;
  }

  function eventBase(member, action, extra = {}) {
    const actionId = action?.id || BASIC_ACTION;
    return {
      memberId:member.id,
      memberName:member.name,
      actionId,
      skillId:actionId === BASIC_ACTION ? null : actionId,
      ...extra,
    };
  }

  function getAttackPower(member, rng) {
    const stat = Math.max(1, number(member.attack, 1));
    let minimumBonus = -stat * 0.20;
    let maximumBonus = stat * 0.20;
    if (member.buffs?.battleRoarTurns > 0) {
      minimumBonus = stat * 0.05;
      maximumBonus = stat * 0.15;
    }
    let power = stat / 2 + minimumBonus + roll(rng) * (maximumBonus - minimumBonus);
    if (member.klass === 'mage' && member.buffs?.intBuffTurns > 0) {
      power *= 1 + number(member.buffs.intBuffPct, 0.30);
    }
    return Math.max(1, Math.round(power));
  }

  function playerCritChance(member, defsOverride) {
    const defs = skillDefs(defsOverride);
    let chance = BASE_CRIT_CHANCE;
    if (member.klass === 'mage' && member.spec === '화염') {
      const rank = skillRank(member, 'mage_fire_focus_v24');
      chance += number(defs.mage_fire_focus_v24?.critChanceBonus?.[rank]);
    }
    return Math.min(1, chance);
  }

  function playerCritMultiplier(member, isSkill, defsOverride) {
    const defs = skillDefs(defsOverride);
    const fireSkill = isSkill && member.klass === 'mage' && member.spec === '화염';
    let multiplier = fireSkill ? FIRE_SKILL_CRIT_MULTIPLIER : BASE_CRIT_MULTIPLIER;
    if (fireSkill) {
      const rank = skillRank(member, 'mage_fire_ember_v24');
      multiplier += number(defs.mage_fire_ember_v24?.critDmgBonus?.[rank]);
    }
    return multiplier;
  }

  function healBoost(member, amount, defsOverride) {
    if (!(amount > 0)) return 0;
    const defs = skillDefs(defsOverride);
    const rank = skillRank(member, 'priest_holy_grace_v24');
    const bonus = number(defs.priest_holy_grace_v24?.healBoost?.[rank]);
    return Math.max(1, Math.round(amount * (1 + bonus)));
  }

  function healMember(member, requested) {
    const amount = Math.min(Math.max(0, member.maxHp - member.hp), Math.max(0, integer(requested)));
    member.hp += amount;
    return amount;
  }

  function addShield(member, requested) {
    const amount = Math.max(1, integer(requested, 1));
    member.shield = Math.max(0, integer(member.shield)) + amount;
    return amount;
  }

  function applyDamageToMonster(monster, requested, ignoreShield = false) {
    const amount = Math.max(0, integer(requested));
    const shieldDamage = ignoreShield ? 0 : Math.min(monster.shield, amount);
    monster.shield -= shieldDamage;
    const hpDamage = Math.min(monster.hp, Math.max(0, amount - shieldDamage));
    monster.hp -= hpDamage;
    return {
      requestedDamage:amount,
      shieldDamage,
      hpDamage,
      damage:hpDamage,
      totalDamage:shieldDamage + hpDamage,
      remainingShield:monster.shield,
      monsterHp:monster.hp,
    };
  }

  function applyDamageToMember(member, requested) {
    const amount = Math.max(0, integer(requested));
    const shieldDamage = Math.min(member.shield, amount);
    member.shield -= shieldDamage;
    const hpDamage = Math.min(member.hp, Math.max(0, amount - shieldDamage));
    member.hp -= hpDamage;
    return {
      requestedDamage:amount,
      shieldDamage,
      hpDamage,
      damage:hpDamage,
      totalDamage:shieldDamage + hpDamage,
      remainingShield:member.shield,
      memberHp:member.hp,
    };
  }

  function tickCooldowns(members) {
    (members || []).forEach((member) => {
      Object.keys(member.cooldowns || {}).forEach((id) => {
        member.cooldowns[id] = Math.max(0, integer(member.cooldowns[id]) - 1);
      });
      if (member.buffs?.intBuffTurns > 0) member.buffs.intBuffTurns -= 1;
      if (member.buffs?.battleRoarTurns > 0) member.buffs.battleRoarTurns -= 1;
    });
  }

  function addMonsterStatus(monster, member, action, status, amount, events, extra = {}) {
    const turns = Math.max(1, integer(amount, 1));
    if (status === 'shadow') {
      const before = Math.max(0, integer(monster.shadowBySource[member.id]));
      const totalBefore = Object.values(monster.shadowBySource || {})
        .reduce((sum, value) => sum + Math.max(0, integer(value)), 0);
      const requested = Math.max(1, integer(extra.stacks ?? amount, 1));
      const added = Math.min(requested, Math.max(0, MAX_SHADOW_STACKS - totalBefore));
      monster.shadowBySource[member.id] = before + added;
      events.push(eventBase(member, action, {
        kind:'monster-status', status:'shadow', stacks:added,
        memberStacks:monster.shadowBySource[member.id],
        totalStacks:totalBefore + added,
        audioId:global.YuksamAudioManifest?.assets?.shadowStackGain ? 'shadowStackGain' : null,
        text:added > 0
          ? `${member.name}의 암흑 중첩 ${totalBefore + added}회`
          : `암흑 중첩은 최대 ${MAX_SHADOW_STACKS}회입니다.`,
      }));
      return;
    }
    const key = status === 'stun' ? 'stunTurns' : 'chillTurns';
    monster[key] = Math.max(integer(monster[key]), turns);
    events.push(eventBase(member, action, {
      kind:'monster-status', status, turns:monster[key],
      audioId:status === 'stun' ? 'stunned' : null,
      text:status === 'stun'
        ? `${monster.name}이(가) ${monster[key]}턴간 기절했습니다!`
        : `${monster.name}이(가) 냉기 상태가 되었습니다!`,
    }));
  }

  function resolveWrongAction({ member, monster, action, rng, defs, events }) {
    const active = action.active || {};
    const damaging = action.id === BASIC_ACTION || ['damage', 'damageHeal', 'shadowDot'].includes(active.type);
    if (!damaging) {
      events.push(eventBase(member, action, {
        kind:'party-action', correct:false, damage:0,
        text:`${member.name}은(는) 오답이라 ${active.name || action.name || '스킬'} 효과를 내지 못했습니다.`,
      }));
      return;
    }
    const hitCount = Math.max(1, integer(active.hits, 1));
    const multiplier = hitCount > 1 ? number(active.hitMult, 1) : number(active.multiplier, 1);
    if (action.id !== BASIC_ACTION && multiplier === 0 && hitCount === 1) return;
    if (action.id !== BASIC_ACTION) member.cooldowns[action.id] = Math.max(0, integer(active.cooldown));
    for (let hitIndex = 0; hitIndex < hitCount && monster.hp > 0; hitIndex += 1) {
      const raw = Math.max(1, Math.ceil(getAttackPower(member, rng) * multiplier));
      const damage = Math.max(1, Math.floor(raw * 0.5));
      const applied = applyDamageToMonster(monster, damage, active.ignoreShield === true);
      events.push(eventBase(member, action, {
        kind:'party-hit', correct:false, hitIndex, missed:false, critical:false,
        ...applied,
        audioId:hitIndex === 0 ? audioIdForAction(action.id, member.klass) : null,
        text:`${member.name}의 오답 공격! ${applied.totalDamage}의 피해를 주었습니다.`,
      }));
    }
  }

  function resolveCorrectAction({ member, members, monster, action, rng, defs, events }) {
    const active = action.active || {};
    const isSkill = action.id !== BASIC_ACTION;
    const actionAudioId = audioIdForAction(action.id, member.klass);

    if (isSkill) member.cooldowns[action.id] = Math.max(0, integer(active.cooldown));

    if (active.type === 'shield') {
      const amount = addShield(member, Math.ceil(member.maxHp * number(active.shieldPct, 0.4)));
      events.push(eventBase(member, action, {
        kind:'party-shield', amount, shield:member.shield, audioId:actionAudioId,
        text:`${member.name}이(가) ${active.name}로 보호막 ${amount}을 얻었습니다.`,
      }));
      return;
    }

    if (active.type === 'buff') {
      member.buffs.intBuffTurns = Math.max(member.buffs.intBuffTurns, Math.max(1, integer(active.buffTurns, 3)));
      member.buffs.intBuffPct = Math.max(member.buffs.intBuffPct, number(active.buffPct, 0.3));
      const requested = healBoost(member, Math.max(1, Math.ceil(member.maxHp * number(active.healMaxPct))), defs);
      const amount = healMember(member, requested);
      events.push(eventBase(member, action, {
        kind:'party-buff', status:'intBuff', turns:member.buffs.intBuffTurns,
        heal:amount, memberHp:member.hp, audioId:actionAudioId,
        text:`${member.name}이(가) ${active.name}을(를) 사용했습니다. 지능 상승 ${member.buffs.intBuffTurns}턴${amount > 0 ? `, HP ${amount} 회복` : ''}.`,
      }));
      return;
    }

    if (active.type === 'charge') {
      member.chargeActive = true;
      events.push(eventBase(member, action, {
        kind:'party-charge', status:'charge', audioId:actionAudioId,
        text:`${member.name}이(가) ${active.name}으로 힘을 모읍니다. 다음 공격이 강해집니다!`,
      }));
      return;
    }

    if (active.type === 'healBuff') {
      const lost = Math.max(0, member.maxHp - member.hp);
      const requested = healBoost(member, Math.max(1, Math.ceil(lost * number(active.healLostPct, 0.2))), defs);
      const amount = healMember(member, requested);
      member.buffs.battleRoarTurns = Math.max(member.buffs.battleRoarTurns, 2);
      events.push(eventBase(member, action, {
        kind:'party-heal', healerId:member.id, actorMemberId:member.id,
        targetMemberId:member.id, amount, memberHp:member.hp,
        status:'battleRoar', turns:member.buffs.battleRoarTurns, audioId:actionAudioId,
        text:`${member.name}이(가) ${active.name}으로 HP ${amount}을 회복했습니다.`,
      }));
      return;
    }

    if (active.type === 'healAllies') {
      const living = members.filter((target) => target.hp > 0);
      let healSoundPlayed = false;
      living.forEach((target) => {
        const requested = Math.max(1, Math.ceil(target.maxHp * number(active.healMaxPct, 0.5)));
        const amount = healMember(target, requested);
        if (amount <= 0) return;
        events.push(eventBase(member, action, {
          kind:'party-heal', memberId:target.id, memberName:target.name,
          healerId:member.id, actorMemberId:member.id,
          targetMemberId:target.id, amount, memberHp:target.hp,
          audioId:healSoundPlayed ? null : actionAudioId,
          text:`${member.name}의 ${active.name}! ${target.name}의 HP가 ${amount} 회복되었습니다.`,
        }));
        healSoundPlayed = true;
      });
      return;
    }

    let beforeShield = null;
    if (active.type === 'shieldBash') {
      const amount = addShield(member, Math.ceil(member.maxHp * number(active.shieldPct, 0.6)));
      beforeShield = { amount, shield:member.shield };
      events.push(eventBase(member, action, {
        kind:'party-shield', amount, shield:member.shield, audioId:actionAudioId,
        text:`${member.name}이(가) ${active.name}으로 보호막 ${amount}을 생성했습니다!`,
      }));
    }

    const hitPlans = [];
    const damagingActive = ['damage', 'damageHeal', 'shadowDot', 'shieldBash'].includes(active.type);
    const hitCount = damagingActive ? Math.max(1, integer(active.hits, 1)) : 1;
    for (let hitIndex = 0; hitIndex < hitCount; hitIndex += 1) {
      let raw;
      if (active.type === 'shieldBash') {
        const cappedShield = Math.min(100, Math.max(0, integer(member.shield)));
        raw = cappedShield;
      } else if (isSkill && damagingActive) {
        const multiplier = hitCount > 1 ? number(active.hitMult, 1) : number(active.multiplier, 1);
        raw = getAttackPower(member, rng) * multiplier;
      } else {
        raw = getAttackPower(member, rng);
      }
      hitPlans.push({ raw, label:active.name || action.name || '공격', hitIndex, canCrit:true });
    }

    if (!isSkill) {
      const armorRank = skillRank(member, 'warrior_def_armor');
      if (armorRank > 0) {
        const rate = number(defs.warrior_def_armor?.armorBonusPct?.[armorRank]);
        hitPlans.push({
          raw:Math.max(1, Math.ceil(member.maxHp * rate)),
          label:'공세 갑옷', hitIndex:hitPlans.length, canCrit:false, bonus:true,
        });
      }
      const doubleRank = skillRank(member, 'warrior_weapon_breaker');
      if (doubleRank > 0) {
        const rate = number(defs.warrior_weapon_breaker?.doubleAttackPct?.[doubleRank]);
        hitPlans.push({
          raw:getAttackPower(member, rng) * rate,
          label:'더블 어택', hitIndex:hitPlans.length, canCrit:true, doubleAttack:true,
        });
      }
    }

    const chargePending = member.chargeActive && hitPlans.some((hit) => hit.raw > 0);
    if (chargePending) {
      const multiplier = number(defs.warrior_weapon_judgment?.active?.chargeMult, 2.8);
      hitPlans.forEach((hit) => { if (hit.raw > 0) hit.raw *= multiplier; });
    }

    const chillPending = member.statuses.chillTurns > 0 && hitPlans.some((hit) => hit.raw > 0);
    if (chillPending) {
      hitPlans.forEach((hit) => { hit.raw = Math.ceil(Math.max(0, hit.raw) * 0.5); });
    }

    let landedAction = false;
    let totalHpDamage = 0;
    let totalDamage = 0;
    for (const hit of hitPlans) {
      if (monster.hp <= 0) break;
      const missed = roll(rng) < BASE_MISS_CHANCE;
      if (missed) {
        events.push(eventBase(member, action, {
          kind:'party-hit', correct:true, hitIndex:hit.hitIndex, label:hit.label,
          missed:true, critical:false, damage:0, hpDamage:0, shieldDamage:0,
          audioId:'miss', text:`${member.name}의 ${hit.label}이(가) 빗나갔습니다!`,
        }));
        continue;
      }
      landedAction = true;
      const critical = hit.canCrit && roll(rng) < playerCritChance(member, defs);
      let amount = hit.raw > 0 ? Math.max(1, Math.ceil(hit.raw)) : 0;
      if (critical) amount = Math.max(1, Math.ceil(amount * playerCritMultiplier(member, isSkill, defs)));
      const applied = applyDamageToMonster(monster, amount, active.ignoreShield === true);
      totalHpDamage += applied.hpDamage;
      totalDamage += applied.totalDamage;
      const hitAudioId = hit.doubleAttack
        ? audioIdForAction(BASIC_ACTION, member.klass)
        : (hit.hitIndex === 0 ? actionAudioId : null);
      events.push(eventBase(member, action, {
        kind:'party-hit', correct:true, hitIndex:hit.hitIndex, label:hit.label,
        missed:false, critical, chargeReleased:chargePending, ...applied, audioId:hitAudioId,
        text:`${critical ? '치명타! ' : ''}${member.name}의 ${hit.label}! ${applied.totalDamage}의 피해를 주었습니다.`,
      }));
    }

    /* 사냥터와 마찬가지로 차지와 플레이어 냉기는 실제로 한 번이라도
       적중했을 때만 소모된다. 모든 타격이 빗나가면 다음 문제까지 유지한다. */
    if (landedAction && chargePending) member.chargeActive = false;
    if (landedAction && chillPending) member.statuses.chillTurns = Math.max(0, member.statuses.chillTurns - 1);

    /* 원소 폭발과 옛 스킬 트리의 처형도 마지막 유효 타격 뒤에 판정한다. */
    if (totalDamage > 0 && monster.hp > 0) {
      const elementalRank = skillRank(member, 'mage_basic_element');
      const elementalThreshold = Math.max(0, integer(defs.mage_basic_element?.executeHp?.[elementalRank]));
      const executePct = isSkill ? Math.max(0, number(active.executePct)) : 0;
      const percentageExecute = executePct > 0 && monster.hp / monster.maxHp <= executePct;
      const elementalExecute = elementalThreshold > 0 && monster.hp <= elementalThreshold;
      if (percentageExecute || elementalExecute) {
        const remainingHp = monster.hp;
        monster.hp = 0;
        events.push(eventBase(member, action, {
          kind:'monster-execute', amount:remainingHp, hpDamage:remainingHp,
          monsterHp:0, audioId:'execution',
          text:elementalExecute
            ? `${member.name}의 원소 폭발! 남은 생명력 ${remainingHp}을 불태워 처형했습니다!`
            : `${member.name}의 처형 효과가 발동했습니다!`,
        }));
      }
    }

    if (isSkill && landedAction) {
      if (active.type === 'shadowDot' && number(active.stacks) > 0) {
        addMonsterStatus(monster, member, action, 'shadow', active.stacks, events, { stacks:active.stacks });
      }
      if (number(active.stun) > 0) addMonsterStatus(monster, member, action, 'stun', active.stun, events);
      const chillTurns = Math.max(integer(active.chillTurns), integer(active.weakenTurns));
      if (chillTurns > 0) addMonsterStatus(monster, member, action, 'chill', chillTurns, events);

      if (totalDamage > 0 && ['damage', 'damageHeal', 'shadowDot'].includes(active.type)) {
        const frostRank = skillRank(member, 'mage_frost_focus_v24');
        const chance = number(defs.mage_frost_focus_v24?.activeStunChance?.[frostRank]);
        if (frostRank > 0 && roll(rng) < chance) {
          addMonsterStatus(monster, member, action, 'stun', 1, events);
        }
      }
    }

    if (totalDamage > 0 && member.klass === 'mage' && member.spec === '냉기') {
      const force = active.forceChill === true;
      if (force || roll(rng) < 0.20) addMonsterStatus(monster, member, action, 'chill', 2, events);
    }
    if (totalDamage > 0 && member.klass === 'priest' && member.spec === '암흑') {
      const shadowSkill = isSkill && (action.kind === 'shadow' || String(action.id).startsWith('priest_shadow_'));
      if (!shadowSkill) addMonsterStatus(monster, member, action, 'shadow', 1, events, { stacks:1 });
    }

    if (isSkill && totalDamage > 0) {
      let requestedHeal = 0;
      if (active.type === 'damageHeal') requestedHeal += Math.max(1, Math.ceil(totalDamage * number(active.healRate, 0.5)));
      if (number(active.healMaxPct) > 0) requestedHeal += Math.max(1, Math.ceil(member.maxHp * number(active.healMaxPct)));
      if (requestedHeal > 0) {
        const amount = healMember(member, healBoost(member, requestedHeal, defs));
        events.push(eventBase(member, action, {
          kind:'party-heal', healerId:member.id, actorMemberId:member.id,
          targetMemberId:member.id, amount, memberHp:member.hp,
          text:`${member.name}의 HP가 ${amount} 회복되었습니다.`,
        }));
      }
    }

    if (number(active.bonusShieldPct) > 0) {
      const amount = addShield(member, Math.ceil(member.maxHp * number(active.bonusShieldPct)));
      events.push(eventBase(member, action, {
        kind:'party-shield', amount, shield:member.shield,
        text:`${member.name}이(가) 보호막 ${amount}을 얻었습니다.`,
      }));
    }

    return { totalHpDamage, totalDamage, landedAction, beforeShield };
  }

  function resolveMemberAction({ member, members, monster, submission, rng, defs, events }) {
    if (!member || member.hp <= 0 || monster.hp <= 0) return;
    const entry = normalizeSubmission(submission);
    const action = actionFor(member, entry.actionId, defs);
    if (member.statuses.stunTurns > 0) {
      member.statuses.stunTurns -= 1;
      events.push(eventBase(member, action, {
        kind:'party-skip', status:'stun', correct:entry.correct,
        text:`${member.name}은(는) 기절해서 행동할 수 없습니다!`,
      }));
      return;
    }
    events.push(eventBase(member, action, {
      kind:'party-action', correct:entry.correct,
      text:`${member.name}이(가) ${action.active?.name || action.name || '공격'}을(를) 준비합니다.`,
    }));
    if (!entry.correct) {
      resolveWrongAction({ member, monster, action, rng, defs, events });
      return;
    }
    resolveCorrectAction({ member, members, monster, action, rng, defs, events });
  }

  function applyBlockTraining(member, defs, events) {
    if (member.hp <= 0 || member.klass !== 'warrior') return;
    const rank = skillRank(member, 'warrior_basic_guard');
    const rate = number(defs.warrior_basic_guard?.guardShieldPct?.[rank]);
    if (!(rank > 0) || !(rate > 0)) return;
    const amount = addShield(member, Math.max(1, Math.floor(member.hp * rate)));
    events.push({
      kind:'party-shield', memberId:member.id, targetMemberId:member.id,
      memberName:member.name, actionId:'warrior_basic_guard', skillId:'warrior_basic_guard',
      passive:true, amount, shield:member.shield, audioId:'blockShield',
      text:`${member.name}의 막기 훈련! 보호막 ${amount} 생성!`,
    });
  }

  function incomingMultiplier(member) {
    if (member.klass === 'warrior' && member.spec === '방어') return 0.72;
    if (member.klass === 'priest' && member.spec === '신성') return 0.90;
    return 1;
  }

  function damageMultiplierForSlot(slot, raidRules) {
    return typeof raidRules?.damageMultiplier === 'function' ? raidRules.damageMultiplier(slot) : 1;
  }

  function pickTarget(members, raidRules) {
    if (typeof raidRules?.pickTarget === 'function') return raidRules.pickTarget(members);
    return members.find((member) => member.hp > 0) || null;
  }

  function monsterMissChanceFor(member, defs) {
    const rank = skillRank(member, 'priest_basic_life');
    const bonus = number(defs.priest_basic_life?.monsterMissChance?.[rank]);
    return Math.min(1, BASE_MISS_CHANCE + bonus);
  }

  function applyRevive(member, defs, events) {
    if (member.hp > 0 || member.bastionUsed || skillRank(member, 'warrior_def_bastion') <= 0) return false;
    member.bastionUsed = true;
    member.shield = 0;
    const pct = number(defs.warrior_def_bastion?.reviveHealPct, 1);
    member.hp = Math.max(1, Math.round(member.maxHp * pct));
    events.push({
      kind:'member-revive', memberId:member.id, targetMemberId:member.id,
      memberName:member.name, actionId:'warrior_def_bastion', skillId:'warrior_def_bastion',
      amount:member.hp, memberHp:member.hp, audioId:'guardianOath',
      text:`${member.name}의 수호자의 맹세! 다시 일어섰습니다!`,
    });
    return true;
  }

  function resolveShadowTicks(monster, members, rng, defs, events) {
    Object.entries(monster.shadowBySource || {}).forEach(([memberId, rawStacks]) => {
      if (monster.hp <= 0) return;
      const source = members.find((member) => member.id === memberId);
      const stacks = Math.max(0, integer(rawStacks));
      if (!source || stacks <= 0) return;
      let amount = stacks;
      let critical = false;
      const critRank = skillRank(source, 'priest_shadow_void_v24');
      const critChance = number(defs.priest_shadow_void_v24?.shadowCritChance?.[critRank]);
      if (critRank > 0 && roll(rng) < critChance) {
        amount = Math.max(1, Math.ceil(amount * 2));
        critical = true;
      }
      const applied = applyDamageToMonster(monster, amount, false);
      let heal = 0;
      const lifeRank = skillRank(source, 'priest_shadow_focus_v24');
      const lifeChance = number(defs.priest_shadow_focus_v24?.shadowLifestealChance?.[lifeRank]);
      if (lifeRank > 0 && roll(rng) < lifeChance) {
        heal = healMember(source, healBoost(source, applied.hpDamage, defs));
      }
      events.push({
        kind:'monster-dot', memberId:source.id, memberName:source.name,
        actionId:'shadow-dot', skillId:null, status:'shadow', stacks,
        critical, heal, targetMemberId:heal > 0 ? source.id : null,
        ...applied, audioId:'shadowStackHit',
        text:`${critical ? '암흑 치명타! ' : ''}${source.name}의 암흑 중첩(${stacks})이 ${applied.totalDamage}의 피해를 주었습니다.${heal > 0 ? ` HP ${heal} 회복!` : ''}`,
      });
    });
  }

  function resolveMonsterTurn({ members, monster, attackKind, monsterAttack, rng, defs, raidRules, events }) {
    /* 예전 스킬 트리 캐릭터도 복구본에서 그대로 작동하도록 턴 회복을 유지한다. */
    members.forEach((member) => {
      if (member.hp <= 0) return;
      const regenRank = skillRank(member, 'warrior_regeneration');
      const regenRate = [0, 0.015, 0.03][regenRank] || 0;
      if (!(regenRate > 0)) return;
      const amount = healMember(member, Math.max(1, Math.floor(member.maxHp * regenRate)));
      if (amount > 0) events.push({
        kind:'party-heal', memberId:member.id, memberName:member.name,
        healerId:member.id, actorMemberId:member.id, targetMemberId:member.id,
        actionId:'warrior_regeneration', skillId:'warrior_regeneration', passive:true,
        amount, memberHp:member.hp, text:`${member.name}의 재생력 강화! HP ${amount} 회복!`,
      });
    });
    members.forEach((member) => applyBlockTraining(member, defs, events));

    if (monster.stunTurns > 0) {
      events.push({
        kind:'monster-skip', status:'stun', turns:monster.stunTurns,
        audioId:'stunned', text:`${monster.name}이(가) 기절해 공격하지 못했습니다!`,
      });
      monster.stunTurns = Math.max(0, monster.stunTurns - 1);
      resolveShadowTicks(monster, members, rng, defs, events);
      return;
    }

    const living = members.filter((member) => member.hp > 0);
    const targets = attackKind === 'all' ? living : [pickTarget(living, raidRules)].filter(Boolean);
    if (!targets.length) return;
    events.push({
      kind:'monster-windup', all:attackKind === 'all', audioId:'enemyAttack',
      text:attackKind === 'all' ? `${monster.name}이(가) 전체 공격을 준비합니다!` : `${monster.name}의 공격!`,
    });

    let chillConsumed = false;
    targets.forEach((member) => {
      if (member.hp <= 0) return;
      const focus = attackKind === 'all' ? 1 : number(raidRules?.SINGLE_TARGET_BONUS, 1.35);
      let incoming = Math.max(1, Math.round(
        Math.max(0, number(monsterAttack))
        * damageMultiplierForSlot(member.slot, raidRules)
        * focus
        * incomingMultiplier(member),
      ));
      const thickArmorRank = skillRank(member, 'warrior_thick_armor');
      const thickArmorReduction = [0, 0.05, 0.10][thickArmorRank] || 0;
      if (thickArmorReduction > 0) incoming = Math.max(1, Math.ceil(incoming * (1 - thickArmorReduction)));
      if (monster.chillTurns > 0) {
        incoming = Math.max(1, Math.ceil(incoming * 0.5));
        chillConsumed = true;
      }
      const missed = roll(rng) < monsterMissChanceFor(member, defs);
      if (missed) {
        events.push({
          kind:'monster-hit', memberId:member.id, memberName:member.name,
          missed:true, critical:false, damage:0, hpDamage:0, shieldDamage:0,
          audioId:'miss', text:`${monster.name}의 공격이 ${member.name}에게 빗나갔습니다!`,
        });
        return;
      }
      const criticalChance = member.klass === 'warrior' && member.spec === '방어' ? 0.10 : BASE_CRIT_CHANCE;
      const critical = roll(rng) < criticalChance;
      if (critical) incoming = Math.max(1, Math.ceil(incoming * 1.8));
      const applied = applyDamageToMember(member, incoming);
      events.push({
        kind:'monster-hit', memberId:member.id, memberName:member.name,
        slot:member.slot, missed:false, critical, ...applied,
        audioId:critical ? 'critical' : 'enemyAttack',
        text:`${critical ? '치명타! ' : ''}${member.name}이(가) ${applied.totalDamage}의 피해를 받았습니다.`,
      });

      if (member.hp > 0) {
        const prayerRank = skillRank(member, 'priest_basic_prayer');
        const prayerRate = number(defs.priest_basic_prayer?.reflectPct?.[prayerRank]);
        const prayerDamage = prayerRank > 0 ? Math.floor(incoming * prayerRate) : 0;
        if (prayerDamage > 0 && monster.hp > 0) {
          const reflected = applyDamageToMonster(monster, prayerDamage, false);
          const heal = healMember(member, healBoost(member, prayerDamage, defs));
          events.push({
            kind:'party-retaliation', memberId:member.id, memberName:member.name,
            actionId:'priest_basic_prayer', skillId:'priest_basic_prayer',
            amount:reflected.totalDamage, heal, targetMemberId:member.id,
            ...reflected, memberHp:member.hp, audioId:'prayerBarrier',
            text:`${member.name}의 기도의 방벽! 반사 피해 ${reflected.totalDamage}, HP ${heal} 회복!`,
          });
        }
        const masteryRank = skillRank(member, 'warrior_weapon_mastery');
        const masteryRate = number(defs.warrior_weapon_mastery?.reflectPct?.[masteryRank]);
        const masteryDamage = critical && masteryRank > 0 ? Math.floor(incoming * masteryRate) : 0;
        if (masteryDamage > 0 && monster.hp > 0) {
          const reflected = applyDamageToMonster(monster, masteryDamage, false);
          events.push({
            kind:'party-retaliation', memberId:member.id, memberName:member.name,
            actionId:'warrior_weapon_mastery', skillId:'warrior_weapon_mastery',
            amount:reflected.totalDamage, heal:0, ...reflected, audioId:'prayerBarrier',
            text:`${member.name}의 무기 숙련! 반사 피해 ${reflected.totalDamage}!`,
          });
        }
      }

      applyRevive(member, defs, events);
    });
    if (chillConsumed) monster.chillTurns = Math.max(0, monster.chillTurns - 1);

    resolveShadowTicks(monster, members, rng, defs, events);

    members.forEach((member) => {
      if (member.hp <= 0) return;
      const resistRank = skillRank(member, 'warrior_def_resist');
      const chance = number(defs.warrior_def_resist?.cleanseChance?.[resistRank]);
      const hasAilment = member.statuses.stunTurns > 0 || member.statuses.poisonTurns > 0;
      if (resistRank > 0 && hasAilment && roll(rng) < chance) {
        member.statuses.stunTurns = 0;
        member.statuses.poisonTurns = 0;
        member.statuses.poisonDamage = 0;
        events.push({
          kind:'party-cleanse', memberId:member.id, memberName:member.name,
          actionId:'warrior_def_resist', skillId:'warrior_def_resist', status:'cleanse',
          text:`${member.name}이(가) 불굴의 의지로 상태 이상에서 벗어났습니다!`,
        });
      }
    });
  }

  function resolveRound({ members, monster, submissions = {}, attackKind = 'single', monsterAttack, rng, defs:defsOverride, raidRules } = {}) {
    const defs = skillDefs(defsOverride);
    const party = Array.isArray(members) ? members : [];
    const target = monster;
    if (!target) return { events:[], monsterDown:true, partyWiped:party.every((member) => member.hp <= 0) };
    const events = [];
    const ordered = [...party].sort((a, b) => (ATTACK_ORDER[a?.slot] ?? 1) - (ATTACK_ORDER[b?.slot] ?? 1));

    for (const member of ordered) {
      if (target.hp <= 0) break;
      resolveMemberAction({
        member,
        members:party,
        monster:target,
        submission:submissions[member.id],
        rng,
        defs,
        events,
      });
    }

    if (target.hp <= 0) {
      events.push({ kind:'monster-down', text:`${target.name}을(를) 쓰러뜨렸습니다!` });
      return { events, monsterDown:true, partyWiped:false };
    }

    resolveMonsterTurn({
      members:party,
      monster:target,
      attackKind,
      monsterAttack:monsterAttack ?? target.attack,
      rng,
      defs,
      raidRules,
      events,
    });
    tickCooldowns(party);
    const partyWiped = party.every((member) => member.hp <= 0);
    return { events, monsterDown:target.hp <= 0, partyWiped };
  }

  global.YuksamRaidCombatRules = Object.freeze({
    BASIC_ACTION,
    BASE_MISS_CHANCE,
    BASE_CRIT_CHANCE,
    normalizeMember,
    normalizeMonster,
    resetMemberForEncounter,
    resetMonsterForEncounter,
    normalizeSubmission,
    actionFor,
    getAttackPower,
    applyDamageToMonster,
    applyDamageToMember,
    tickCooldowns,
    resolveRound,
  });
})(typeof window !== 'undefined' ? window : globalThis);
