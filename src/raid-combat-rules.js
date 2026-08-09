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
      /* 던전 몬스터의 실명 패턴: 앞으로 이 횟수만큼 공격이 절반 확률로 빗나간다. */
      blindHits:Math.max(0, integer(value.blindHits ?? value.blind)),
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
      /* 일반 사냥터가 힘/지능/정신 원값을 공격 굴림에 쓰므로, 서버 프로필의
         primaryStat이 있으면 절반으로 가공된 옛 attack 값보다 우선한다. */
      attack:Math.max(1, number(member.primaryStat ?? member.attack, 1)),
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
      /* 아래 셋은 던전 몬스터의 패턴 효과가 남긴 자국이다.
         강화 남은 턴 / 반격 자세 / 다음 턴에 예고해 둔 기술 이름. */
      empowerTurns:Math.max(0, integer(monster.empowerTurns)),
      counterMode:monster.counterMode === 'all' ? 'all' : (monster.counterMode === 'single' ? 'single' : null),
      chargedPlanName:monster.chargedPlanName ? String(monster.chargedPlanName) : null,
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
    monster.empowerTurns = 0;
    monster.counterMode = null;
    monster.chargedPlanName = null;
    monster.stunSourceName = null;
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

  function rollAttackPower(member, rng) {
    const stat = Math.max(1, number(member.attack, 1));
    let minimumBonus = -stat * 0.20;
    let maximumBonus = stat * 0.20;
    if (member.buffs?.battleRoarTurns > 0) {
      minimumBonus = stat * 0.05;
      maximumBonus = stat * 0.15;
    }
    let power = stat / 2 + minimumBonus + roll(rng) * (maximumBonus - minimumBonus);
    let maximumPower = stat / 2 + maximumBonus;
    if (member.klass === 'mage' && member.buffs?.intBuffTurns > 0) {
      const multiplier = 1 + number(member.buffs.intBuffPct, 0.30);
      power *= multiplier;
      maximumPower *= multiplier;
    }
    return {
      power:Math.max(1, Math.round(power)),
      maximumPower:Math.max(1, Math.round(maximumPower)),
    };
  }

  function getAttackPower(member, rng) {
    return rollAttackPower(member, rng).power;
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
      /* 쓰러진 사람은 현재 몬스터 전투에서 턴 자체가 진행되지 않는다. */
      if (!member || member.hp <= 0) return;
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
    const reasonName = String(extra.reasonName || '');
    if (status === 'stun' && reasonName) monster.stunSourceName = reasonName;
    events.push(eventBase(member, action, {
      kind:'monster-status', status, turns:monster[key],
      sourceName:reasonName || null,
      audioId:status === 'stun' ? 'stunned' : null,
      text:status === 'stun'
        ? `${reasonName ? `${member.name}의 ${reasonName} 특성! ` : ''}${monster.name}이(가) ${monster[key]}턴간 기절했습니다!`
        : `${monster.name}이(가) 냉기 상태가 되었습니다!`,
    }));
  }

  /* ---------- 던전 몬스터 패턴 효과 ----------

     시트의 「패턴 N」한 칸이 몬스터의 한 턴이다. 그 칸에 적힌 효과를
     여기서 실제 상태로 바꿔 준다. 화면과 서버가 같은 결과를 쓰도록
     전부 이 순수 함수 안에서만 계산한다. */

  const DEFAULT_EFFECT = Object.freeze({
    ALL_ATTACK_MULTIPLIER:0.5,
    POISON_TURNS:2, STUN_TURNS:1, CHILL_TURNS:1, DRAIN_RATIO:1,
    EMPOWER_MULTIPLIER:1.5, COUNTER_RATIO:1, COUNTER_CHANCE:0.5, CHARGE_MULTIPLIER:2,
  });

  function effectTable(raidRules) {
    const source = raidRules?.PATTERN_EFFECT;
    return source && typeof source === 'object' ? { ...DEFAULT_EFFECT, ...source } : DEFAULT_EFFECT;
  }

  /* 실명 한 번을 써 버린다. 무조건 빗나가면 너무 강해서, 절반의 확률로만
     빗나가게 한다. 굴림 결과와 상관없이 남은 횟수는 한 칸 줄어든다. */
  const BLIND_MISS_CHANCE = 0.5;

  function consumeBlind(member, rng) {
    if (!member?.statuses || !(member.statuses.blindHits > 0)) return false;
    member.statuses.blindHits -= 1;
    return roll(rng) < BLIND_MISS_CHANCE;
  }

  /* 패턴 한 칸을 계산에 쓸 모양으로 다듬는다.
     raid-rules의 normalizeAttackPlan과 같은 규칙을 쓰되, 이 모듈만 따로
     불러 쓰는 서버에서도 돌아가도록 여기에도 한 벌 둔다. */
  function normalizePlan(source, fallbackKind = 'single', fallbackHits = 1) {
    if (source === null || source === undefined) {
      return normalizePlan({ kind:fallbackKind, hits:fallbackHits });
    }
    const src = typeof source === 'object' ? source : { kind:source };
    const kind = src.kind === 'all' ? 'all' : (src.kind === 'none' ? 'none' : 'single');
    const targets = ['front', 'middle', 'back', 'random'];
    return {
      name:String(src.name || (kind === 'all' ? '전체 공격' : '공격')),
      kind,
      hits:Math.max(1, Math.min(4, integer(src.hits, fallbackHits) || 1)),
      target:targets.includes(src.target) ? src.target : null,
      poison:Math.max(0, integer(src.poison)),
      stun:src.stun === true,
      chill:src.chill === true,
      drain:src.drain === true,
      shieldPct:Math.max(0, number(src.shieldPct)),
      healPct:Math.max(0, number(src.healPct)),
      counter:src.counter === 'all' ? 'all' : (src.counter === 'single' ? 'single' : null),
      blind:Math.max(0, integer(src.blind)),
      empower:Math.max(0, integer(src.empower)),
      chargeNext:src.chargeNext ? String(src.chargeNext) : null,
    };
  }

  function findPlanByName(monster, name) {
    const pattern = Array.isArray(monster?.pattern) ? monster.pattern : [];
    const found = pattern.find((entry) => entry && typeof entry === 'object' && entry.name === name);
    return found ? normalizePlan(found) : null;
  }

  /* 이번 턴에 실제로 쓸 기술. 지난 턴에 예고해 둔 게 있으면 그게 우선이고
     피해가 두 배가 된다. */
  function planForMonsterTurn(monster, requestedPlan, effect) {
    const base = normalizePlan(requestedPlan);
    const reserved = monster.chargedPlanName ? findPlanByName(monster, monster.chargedPlanName) : null;
    monster.chargedPlanName = null;
    if (!reserved) return { plan:base, chargeMultiplier:1, charged:false };
    return { plan:reserved, chargeMultiplier:Math.max(1, number(effect.CHARGE_MULTIPLIER, 2)), charged:true };
  }

  /* 자리를 노리는 패턴이면 그 자리 사람을, 아니면 원래 규칙대로 고른다. */
  function pickPlanTarget(living, plan, raidRules, rng) {
    if (!living.length) return null;
    if (plan.target === 'random') return living[Math.floor(roll(rng) * living.length)] || living[0];
    if (plan.target) {
      const found = living.find((member) => member.slot === plan.target);
      if (found) return found;
    }
    return pickTarget(living, raidRules) || living[0];
  }

  /* 한 대 맞은 사람에게 그 기술이 남기는 상태이상을 건다. */
  function applyPlanStatuses(member, monster, plan, effect, events) {
    if (member.hp <= 0) return;
    if (plan.poison > 0) {
      member.statuses.poisonDamage = Math.max(0, integer(member.statuses.poisonDamage)) + plan.poison;
      member.statuses.poisonTurns = Math.max(
        member.statuses.poisonTurns,
        Math.max(1, integer(effect.POISON_TURNS, 2)),
      );
      events.push({
        kind:'member-status', status:'poison', memberId:member.id, memberName:member.name,
        targetMemberId:member.id, amount:plan.poison, turns:member.statuses.poisonTurns,
        text:`${member.name}이(가) 중독되었습니다! 매 턴 ${member.statuses.poisonDamage}의 피해`,
      });
    }
    if (plan.stun) {
      member.statuses.stunTurns = Math.max(member.statuses.stunTurns, Math.max(1, integer(effect.STUN_TURNS, 1)));
      events.push({
        kind:'member-status', status:'stun', memberId:member.id, memberName:member.name,
        targetMemberId:member.id, turns:member.statuses.stunTurns, audioId:'stunned',
        text:`${member.name}이(가) 기절했습니다!`,
      });
    }
    if (plan.chill) {
      member.statuses.chillTurns = Math.max(member.statuses.chillTurns, Math.max(1, integer(effect.CHILL_TURNS, 1)));
      events.push({
        kind:'member-status', status:'chill', memberId:member.id, memberName:member.name,
        targetMemberId:member.id, turns:member.statuses.chillTurns,
        text:`${member.name}이(가) 얼어붙었습니다! 다음 공격 피해가 절반이 됩니다.`,
      });
    }
  }

  /* 몬스터 턴이 시작될 때 파티가 받는 독 피해. */
  function tickMemberPoison(members, events) {
    members.forEach((member) => {
      if (member.hp <= 0 || !(member.statuses.poisonTurns > 0)) return;
      const amount = Math.max(1, integer(member.statuses.poisonDamage, 1));
      const applied = applyDamageToMember(member, amount);
      member.statuses.poisonTurns -= 1;
      if (member.statuses.poisonTurns <= 0) member.statuses.poisonDamage = 0;
      events.push({
        kind:'member-dot', status:'poison', memberId:member.id, memberName:member.name,
        targetMemberId:member.id, turns:member.statuses.poisonTurns, ...applied,
        text:`${member.name}이(가) 독으로 ${applied.totalDamage}의 피해를 받았습니다.`,
      });
      if (member.hp <= 0) {
        events.push({
          kind:'member-down', memberId:member.id, targetMemberId:member.id,
          memberName:member.name, memberHp:0, text:`${member.name}이(가) 쓰러졌습니다!`,
        });
      }
    });
  }

  /* 반격 자세인 몬스터를 때렸을 때 되돌아오는 피해.
     세기는 그 몬스터의 '전체 공격' 한 대와 같다(집중 배율 없음). */
  function resolveCounter({ attacker, members, monster, monsterAttack, raidRules, effect, events, rng }) {
    if (!monster.counterMode || monster.hp <= 0) return;
    const ratio = Math.max(0, number(effect.COUNTER_RATIO, 1));
    if (!(ratio > 0)) return;
    /* 맞을 때마다 무조건 되받아치면 너무 강해서 절반의 확률로만 반격한다. */
    if (roll(rng) >= Math.max(0, Math.min(1, number(effect.COUNTER_CHANCE, 0.5)))) return;
    const victims = monster.counterMode === 'all'
      ? members.filter((member) => member.hp > 0)
      : [attacker].filter((member) => member && member.hp > 0);
    victims.forEach((member) => {
      let incoming = Math.max(1, Math.round(
        Math.max(0, number(monsterAttack))
        * number(raidRules?.MONSTER_DAMAGE_MULTIPLIER, 1)
        * damageMultiplierForSlot(member.slot, raidRules)
        * incomingMultiplier(member)
        * ratio,
      ));
      const applied = applyDamageToMember(member, incoming);
      events.push({
        kind:'monster-counter', memberId:member.id, memberName:member.name,
        slot:member.slot, missed:false, critical:false, ...applied, audioId:'enemyAttack',
        text:`${monster.name}의 반격! ${member.name}이(가) ${applied.totalDamage}의 피해를 받았습니다.`,
      });
      if (member.hp <= 0) {
        events.push({
          kind:'member-down', memberId:member.id, targetMemberId:member.id,
          memberName:member.name, memberHp:0, text:`${member.name}이(가) 쓰러졌습니다!`,
        });
      }
    });
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
      if (consumeBlind(member, rng)) {
        events.push(eventBase(member, action, {
          kind:'party-hit', correct:false, hitIndex, missed:true, blinded:true, critical:false,
          damage:0, hpDamage:0, shieldDamage:0, audioId:'miss',
          text:`앞이 보이지 않습니다! ${member.name}의 공격이 빗나갔습니다!`,
        }));
        continue;
      }
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
      if (active.type === 'shieldBash') {
        const cappedShield = Math.min(100, Math.max(0, integer(member.shield)));
        hitPlans.push({ raw:cappedShield, label:active.name || action.name || '공격', hitIndex, canCrit:true });
      } else if (isSkill && damagingActive) {
        const multiplier = hitCount > 1 ? number(active.hitMult, 1) : number(active.multiplier, 1);
        /* multiplier 0인 적대 기술은 사냥터처럼 공격력 난수를 굴리지 않는다. */
        hitPlans.push(multiplier === 0
          ? { raw:0, label:active.name || action.name || '공격', hitIndex, canCrit:false }
          : { attackMultiplier:multiplier, label:active.name || action.name || '공격', hitIndex, canCrit:true });
      } else {
        hitPlans.push({ attackMultiplier:1, label:active.name || action.name || '공격', hitIndex, canCrit:true });
      }
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
          attackMultiplier:rate,
          label:'더블 어택', hitIndex:hitPlans.length, canCrit:true, doubleAttack:true,
        });
      }
    }

    const hasDamagePlan = hitPlans.some((hit) => number(hit.raw) > 0 || number(hit.attackMultiplier) > 0);
    const chargePending = member.chargeActive && hasDamagePlan;
    const chargeMultiplier = number(defs.warrior_weapon_judgment?.active?.chargeMult, 2.8);
    const chillPending = member.statuses.chillTurns > 0 && hasDamagePlan;

    let landedAction = false;
    let totalHpDamage = 0;
    let totalDamage = 0;
    for (const hit of hitPlans) {
      if (monster.hp <= 0) break;
      let raw = number(hit.raw);
      let maximumRaw = 0;
      if (number(hit.attackMultiplier) > 0) {
        const attackRoll = rollAttackPower(member, rng);
        raw = attackRoll.power * number(hit.attackMultiplier);
        maximumRaw = attackRoll.maximumPower * number(hit.attackMultiplier);
      }
      /* 던전 몬스터의 실명 패턴이 걸려 있으면 굴림 없이 그냥 빗나간다. */
      const blinded = consumeBlind(member, rng);
      const missed = blinded || roll(rng) < BASE_MISS_CHANCE;
      if (missed) {
        events.push(eventBase(member, action, {
          kind:'party-hit', correct:true, hitIndex:hit.hitIndex, label:hit.label,
          missed:true, blinded, critical:false, damage:0, hpDamage:0, shieldDamage:0,
          audioId:'miss',
          text:blinded
            ? `앞이 보이지 않습니다! ${member.name}의 ${hit.label}이(가) 빗나갔습니다!`
            : `${member.name}의 ${hit.label}이(가) 빗나갔습니다!`,
        }));
        continue;
      }
      landedAction = true;
      const critical = hit.canCrit && roll(rng) < playerCritChance(member, defs);
      let amount = raw > 0 ? Math.max(1, Math.ceil(raw)) : 0;
      if (critical) {
        amount = Math.max(1, Math.ceil(amount * playerCritMultiplier(member, isSkill, defs)));
        /* 사냥터 v50 규칙: 낮은 공격력 난수에서 나온 치명타도 같은 행동의
           최대 일반 피해보다 작아지지 않는다. */
        if (maximumRaw > raw) amount = Math.max(amount, Math.ceil(maximumRaw));
      }
      /* 사냥터와 동일하게 치명타 보정 뒤 차지, 그 뒤 냉기를 적용한다. */
      if (amount > 0 && chargePending) amount = Math.max(1, Math.ceil(amount * chargeMultiplier));
      if (amount > 0 && chillPending) amount = Math.ceil(amount * 0.5);
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
          addMonsterStatus(monster, member, action, 'stun', 1, events, { reasonName:'냉기 집중' });
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

  function effectiveSlotFor(member, living, raidRules) {
    return typeof raidRules?.effectiveSlot === 'function'
      ? raidRules.effectiveSlot(living, member)
      : member?.slot;
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

  function resolveMonsterTurn({ members, monster, plan:requestedPlan, attackKind, monsterHitCount = 1, monsterAttack, rng, defs, raidRules, events }) {
    const effect = effectTable(raidRules);
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

    /* 지난 턴에 잡은 반격 자세는 여기까지다(파티 턴 동안만 유효). */
    monster.counterMode = null;
    /* 몬스터가 움직이기 전에 파티가 독 피해를 받는다. */
    tickMemberPoison(members, events);

    if (monster.stunTurns > 0) {
      events.push({
        kind:'monster-skip', status:'stun', turns:monster.stunTurns,
        audioId:'stunned', text:`${monster.name}이(가) 기절해 공격하지 못했습니다!`,
      });
      monster.stunTurns = Math.max(0, monster.stunTurns - 1);
      if (monster.stunTurns <= 0) monster.stunSourceName = null;
      resolveShadowTicks(monster, members, rng, defs, events);
      return;
    }

    /* 지난 턴에 예고해 둔 기술이 있으면 그것을 두 배 피해로 쓴다. */
    const { plan, chargeMultiplier, charged } = planForMonsterTurn(
      monster,
      requestedPlan ?? { kind:attackKind, hits:monsterHitCount },
      effect,
    );
    if (charged) {
      events.push({
        kind:'monster-charge-release', planName:plan.name, audioId:'enemyAttack',
        text:`${monster.name}이(가) 예고한 ${plan.name}을(를) 두 배의 힘으로 사용합니다!`,
      });
    }

    const living = () => members
      .filter((member) => member.hp > 0)
      .sort((a, b) => (ATTACK_ORDER[a?.slot] ?? 1) - (ATTACK_ORDER[b?.slot] ?? 1));
    const empowered = monster.empowerTurns > 0;
    const empowerMultiplier = empowered ? Math.max(1, number(effect.EMPOWER_MULTIPLIER, 1.5)) : 1;
    let chillConsumed = false;
    let drained = 0;
    /* 이번 몬스터 행동이 시작될 때의 생존 대형을 고정한다. 한 공격 도중
       쓰러졌다고 같은 폭발 안에서 즉시 자리를 또 바꾸지는 않고, 다음 행동부터 당긴다. */
    const turnLiving = living();
    const effectiveSlots = new Map(turnLiving.map((member) => [
      String(member.id), effectiveSlotFor(member, turnLiving, raidRules),
    ]));

    if (plan.kind !== 'none') {
      const targets = plan.kind === 'all'
        ? turnLiving
        : [pickPlanTarget(turnLiving.map((member) => ({
          ...member, slot:effectiveSlots.get(String(member.id)) || member.slot,
        })), plan, raidRules, rng)].map((picked) => (
          picked ? turnLiving.find((member) => String(member.id) === String(picked.id)) : null
        )).filter(Boolean);
      if (!targets.length) return;
      const hitCount = plan.hits;
      events.push({
        kind:'monster-windup', all:plan.kind === 'all', hitCount,
        planName:plan.name, empowered, audioId:'enemyAttack',
        text:plan.kind === 'all'
          ? `${monster.name}의 ${plan.name}! ${hitCount > 1 ? `${hitCount}연속 ` : ''}전체 공격을 준비합니다!`
          : `${monster.name}의 ${plan.name}! ${targets[0]?.name || ''}을(를) 노립니다!`,
      });

    /* 연속 공격은 한 사람을 연달아 때린 뒤 다음 사람으로 넘어간다.
       앞·앞·가운데·가운데·뒤·뒤 순서로 로그가 나와야 누가 몇 대 맞았는지 읽힌다.
       (예전에는 앞·가운데·뒤를 한 바퀴씩 돌아 순서가 섞여 보였다.) */
    const waveTargets = plan.kind === 'all' ? turnLiving : targets;
    waveTargets.forEach((member) => {
    for (let hitIndex = 0; hitIndex < hitCount; hitIndex += 1) {
      if (member.hp <= 0) break;
      /* 전체 공격은 셋을 한꺼번에 때리므로 한 사람이 받는 몫을 낮춘다.
         단일 공격은 별도 추가 배율 없이 자리 배율만 적용한다. */
      const focus = plan.kind === 'all'
        ? Math.max(0, number(effect.ALL_ATTACK_MULTIPLIER, 0.5))
        : number(raidRules?.SINGLE_TARGET_BONUS, 1);
      let incoming = Math.max(1, Math.round(
        Math.max(0, number(monsterAttack))
        * number(raidRules?.MONSTER_DAMAGE_MULTIPLIER, 1)
        * damageMultiplierForSlot(effectiveSlots.get(String(member.id)) || member.slot, raidRules)
        * focus
        * empowerMultiplier
        * chargeMultiplier
        * incomingMultiplier(member),
      ));
      const thickArmorRank = skillRank(member, 'warrior_thick_armor');
      const thickArmorReduction = [0, 0.05, 0.10][thickArmorRank] || 0;
      if (thickArmorReduction > 0) incoming = Math.max(1, Math.ceil(incoming * (1 - thickArmorReduction)));
      if (monster.chillTurns > 0) {
        incoming = Math.max(1, Math.ceil(incoming * 0.5));
        chillConsumed = true;
      }
      const faithRank = skillRank(member, 'priest_basic_life');
      const faithBonus = number(defs.priest_basic_life?.monsterMissChance?.[faithRank]);
      const missed = roll(rng) < monsterMissChanceFor(member, defs);
      if (missed) {
        events.push({
          kind:'monster-hit', memberId:member.id, memberName:member.name,
          hitIndex, hitCount,
          missed:true, critical:false, damage:0, hpDamage:0, shieldDamage:0,
          missReason:faithBonus > 0 ? 'priest_basic_life' : null,
          audioId:'miss', text:faithBonus > 0
            ? `${member.name}의 신앙의 광채로 인해 ${monster.name}의 공격이 빗나갔습니다!`
            : `${monster.name}의 공격이 ${member.name}에게 빗나갔습니다!`,
        });
        continue;   // 빗나가도 남은 타수는 이어서 굴린다
      }
      const criticalChance = member.klass === 'warrior' && member.spec === '방어' ? 0.10 : BASE_CRIT_CHANCE;
      const critical = roll(rng) < criticalChance;
      if (critical) incoming = Math.max(1, Math.ceil(incoming * 1.8));
      const applied = applyDamageToMember(member, incoming);
      const hitEvent = {
        kind:'monster-hit', memberId:member.id, memberName:member.name,
        hitIndex, hitCount,
        slot:effectiveSlots.get(String(member.id)) || member.slot, missed:false, critical, ...applied,
        audioId:critical ? 'critical' : 'enemyAttack',
        text:`${critical ? '치명타! ' : ''}${member.name}이(가) ${applied.totalDamage}의 피해를 받았습니다.`,
      };
      events.push(hitEvent);

      /* 시트에 적힌 이 기술의 부가 효과(독·기절·냉기·흡혈)를 여기서 건다. */
      applyPlanStatuses(member, monster, plan, effect, events);
      /* 화면은 전투 로그를 한 줄씩 재생하므로 라운드 마지막 스냅샷만 보면
         상태 배지가 너무 늦게 나타난다. 피격 이벤트에 그 순간의 상태를 함께
         실어, 피해 숫자가 뜨는 바로 그때 체력창 배지도 갱신하게 한다. */
      hitEvent.memberStatuses = { ...(member.statuses || {}) };
      if (plan.drain) drained += Math.round(applied.totalDamage * Math.max(0, number(effect.DRAIN_RATIO, 1)));

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

      const revived = applyRevive(member, defs, events);
      if (member.hp <= 0 && !revived) {
        events.push({
          kind:'member-down', memberId:member.id, targetMemberId:member.id,
          memberName:member.name, memberHp:0,
          text:`${member.name}이(가) 쓰러졌습니다!`,
        });
      }
    }
    });
    } /* ← 공격하는 턴 끝 */

    if (chillConsumed) monster.chillTurns = Math.max(0, monster.chillTurns - 1);

    /* 흡혈: 이번 턴에 준 피해만큼 몬스터가 회복한다. */
    if (drained > 0) {
      const before = monster.hp;
      monster.hp = Math.min(monster.maxHp, monster.hp + drained);
      const healed = monster.hp - before;
      if (healed > 0) {
        events.push({
          kind:'monster-heal', status:'drain', amount:healed, monsterHp:monster.hp,
          text:`${monster.name}이(가) 빼앗은 생명력으로 ${healed} 회복했습니다!`,
        });
      }
    }

    /* 강화는 이번 턴을 쓰고 한 칸 줄어든다. */
    if (monster.empowerTurns > 0) monster.empowerTurns -= 1;

    /* 공격이 아닌 부분(보호막·회복·강화·실명·반격 자세·예고)을 처리한다. */
    if (plan.shieldPct > 0) {
      const amount = Math.max(1, Math.ceil(monster.maxHp * plan.shieldPct));
      monster.shield = Math.max(0, integer(monster.shield)) + amount;
      events.push({
        kind:'monster-shield', planName:plan.name, amount, shield:monster.shield,
        /* Keep dungeon monster shields in sync with the hunting shield cue.
           An explicit audio id also prevents the UI fallback from playing twice. */
        audioId:'defensiveStance',
        text:`${monster.name}의 ${plan.name}! 보호막 ${amount}을(를) 만들었습니다.`,
      });
    }
    if (plan.healPct > 0) {
      const before = monster.hp;
      monster.hp = Math.min(monster.maxHp, monster.hp + Math.max(1, Math.ceil(monster.maxHp * plan.healPct)));
      const healed = monster.hp - before;
      events.push({
        kind:'monster-heal', planName:plan.name, amount:healed, monsterHp:monster.hp,
        text:healed > 0
          ? `${monster.name}의 ${plan.name}! HP ${healed}을(를) 회복했습니다.`
          : `${monster.name}이(가) ${plan.name}을(를) 썼지만 이미 온전합니다.`,
      });
    }
    if (plan.empower > 0) {
      monster.empowerTurns = Math.max(monster.empowerTurns, plan.empower);
      events.push({
        kind:'monster-buff', status:'empower', planName:plan.name, turns:monster.empowerTurns,
        text:`${monster.name}의 ${plan.name}! ${monster.empowerTurns}턴 동안 공격이 강해집니다.`,
      });
    }
    if (plan.blind > 0) {
      members.forEach((member) => {
        if (member.hp <= 0) return;
        member.statuses.blindHits = Math.max(member.statuses.blindHits, plan.blind);
      });
      events.push({
        kind:'monster-blind', status:'blind', planName:plan.name, hits:plan.blind,
        text:`${monster.name}의 ${plan.name}! 파티의 다음 공격 ${plan.blind}회가 빗나갑니다.`,
      });
    }
    if (plan.counter) {
      monster.counterMode = plan.counter;
      events.push({
        kind:'monster-counter-stance', status:'counter', planName:plan.name, mode:plan.counter,
        text:plan.counter === 'all'
          ? `${monster.name}의 ${plan.name}! 다음에 맞을 때마다 50% 확률로 파티 전체에 반격합니다.`
          : `${monster.name}의 ${plan.name}! 다음에 때린 사람에게 50% 확률로 반격합니다.`,
      });
    }
    if (plan.chargeNext && findPlanByName(monster, plan.chargeNext)) {
      monster.chargedPlanName = plan.chargeNext;
      events.push({
        kind:'monster-charge', status:'charge', planName:plan.name, nextName:plan.chargeNext,
        text:`${monster.name}이(가) 힘을 모읍니다. 다음 턴은 ${plan.chargeNext}!`,
      });
    }

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

  function resolveRound({ members, monster, submissions = {}, plan:monsterPlan = null, attackKind = 'single', monsterHitCount = 1, monsterAttack, rng, defs:defsOverride, raidRules } = {}) {
    const defs = skillDefs(defsOverride);
    const party = Array.isArray(members) ? members : [];
    const target = monster;
    if (!target) return { events:[], monsterDown:true, partyWiped:party.every((member) => member.hp <= 0) };
    const events = [];
    const effect = effectTable(raidRules);
    const ordered = [...party].sort((a, b) => (ATTACK_ORDER[a?.slot] ?? 1) - (ATTACK_ORDER[b?.slot] ?? 1));

    for (const member of ordered) {
      if (target.hp <= 0) break;
      const beforeDurability = target.hp + Math.max(0, integer(target.shield));
      resolveMemberAction({
        member,
        members:party,
        monster:target,
        submission:submissions[member.id],
        rng,
        defs,
        events,
      });
      /* 반격 자세인 몬스터를 실제로 때렸으면 그 자리에서 되받아친다. */
      const landed = (target.hp + Math.max(0, integer(target.shield))) < beforeDurability;
      if (landed && target.hp > 0) {
        resolveCounter({
          attacker:member, members:party, monster:target,
          monsterAttack:monsterAttack ?? target.attack,
          raidRules, effect, events, rng,
        });
      }
    }

    if (target.hp <= 0) {
      events.push({ kind:'monster-down', text:`${target.name}을(를) 쓰러뜨렸습니다!` });
      return { events, monsterDown:true, partyWiped:false };
    }

    resolveMonsterTurn({
      members:party,
      monster:target,
      plan:monsterPlan,
      attackKind,
      monsterHitCount,
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
    normalizePlan,
    findPlanByName,
    resolveRound,
  });
})(typeof window !== 'undefined' ? window : globalThis);
