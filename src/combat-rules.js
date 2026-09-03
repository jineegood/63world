(function initYuksamCombatRules(global) {
  const ZONE_SCALE = {
    desert: { hp: 1.20, attack: 1.10 },
    swamp: { hp: 1.30, attack: 1.20 },
  };
  const MONSTER_BASE_SCALE = {
    snake: 1.30,
    stomp: 1.20,
  };
  const COMBAT_EVENT_ORDER = [
    'answer-correct',
    'answer-wrong',
    'player-support-before',
    'player-hit',
    'player-extra-hit',
    'player-support',
    'enemy-status',
    'player-total',
    'monster-action',
    'player-status',
    'player-damage',
    'monster-lifesteal',
    'retaliation',
    'player-dot',
    'player-cleanse',
  ];
  const COMBAT_EFFECT_TYPES = new Set([
    'monster-damage',
    'monster-status',
    'monster-shield',
    'monster-heal',
    'player-status',
    'player-support',
    'player-damage',
    'retaliation',
    'player-dot',
    'monster-dot',
  ]);

  function scaleMonsterStats(monster, zone) {
    const scale = ZONE_SCALE[zone];
    if (!scale || !monster || monster.__zoneScale === zone) return monster;
    const baseScale = MONSTER_BASE_SCALE[monster.type] || 1;
    const scaled = {
      ...monster,
      hp: Math.round(Math.round(Number(monster.hp || 0) * baseScale) * scale.hp),
      attack: Math.round(Math.round(Number(monster.attack || 0) * baseScale) * scale.attack),
    };
    Object.defineProperty(scaled, '__zoneScale', { value: zone, enumerable: false });
    return scaled;
  }

  function mageBasicCriticalDamage(damage) {
    return Math.max(0, Math.ceil(Number(damage || 0) * 1.5));
  }

  function shieldChargeDamage(shield, critical) {
    const baseDamage = Math.min(100, Math.max(0, Math.floor(Number(shield) || 0)));
    return { baseDamage, damage:critical ? Math.ceil(baseDamage * 1.5) : baseDamage };
  }

  function resolveShieldedDamage(damage, shield) {
    const safeDamage = Math.max(0, Math.floor(Number(damage) || 0));
    const safeShield = Math.max(0, Math.floor(Number(shield) || 0));
    const shieldDamage = Math.min(safeDamage, safeShield);
    const hpDamage = Math.max(0, safeDamage - shieldDamage);
    return {
      shieldDamage,
      hpDamage,
      remainingShield:Math.max(0, safeShield - shieldDamage),
      fullyBlocked:safeDamage > 0 && hpDamage === 0,
    };
  }

  function rollEnhancement(chance, roll) {
    return Number(roll) < Number(chance);
  }

  function rollHostileHit(missChance, roll) {
    const chance = Math.max(0, Math.min(1, Number(missChance) || 0));
    return { missed:Number(roll) < chance };
  }

  function combinedMonsterMissChance(skillChance) {
    return Math.min(1, 0.10 + Math.max(0, Number(skillChance) || 0));
  }

  function applyFinalBossDamageNerf(damage, monsterType) {
    const amount = Math.max(0, Number(damage) || 0);
    return monsterType === 'teacherBoss' ? Math.ceil(amount * 0.70) : amount;
  }

  function planLivingAllyHeals(allies, healMaxPct) {
    const healed = [];
    (allies || []).forEach((ally, targetIndex) => {
      if (!ally || Number(ally.hp || 0) <= 0) return;
      const maxHp = Math.max(0, Number(ally.maxHp || 0));
      const oldHp = Math.min(maxHp, Number(ally.hp || 0));
      const nextHp = Math.min(maxHp, oldHp + Math.ceil(maxHp * Number(healMaxPct || 0)));
      healed.push({ targetIndex, amount: nextHp - oldHp });
    });
    return healed;
  }

  function healLivingAllies(allies, healMaxPct) {
    const healed = planLivingAllyHeals(allies, healMaxPct);
    healed.forEach(({ targetIndex, amount }) => {
      const ally = allies?.[targetIndex];
      if (ally) ally.hp = Math.min(Number(ally.maxHp) || 0, Number(ally.hp) + amount);
    });
    return healed;
  }

  function normalizeCombatStatuses(source) {
    const normalized = { ...(source || {}) };
    const chillTurns = Math.max(
      0,
      Number(normalized.chillTurns) || 0,
      Number(normalized.chilledTurns) || 0,
      Number(normalized.weakenTurns) || 0,
    );
    if (chillTurns > 0) normalized.chillTurns = chillTurns;
    delete normalized.chilledTurns;
    delete normalized.weakenTurns;
    return normalized;
  }

  function applyChillToAttack(damages, chillTurns) {
    const source = Array.from(damages || []).map((damage) => Math.max(0, Number(damage) || 0));
    const active = source.some((damage) => damage > 0) && Number(chillTurns) > 0;
    return {
      damages: source.map((damage) => active ? Math.ceil(damage * 0.50) : damage),
      chillTurns: active ? Math.max(0, Number(chillTurns) - 1) : Math.max(0, Number(chillTurns) || 0),
    };
  }

  function buildStatusBadges(status) {
    const source = normalizeCombatStatuses(status);
    const badges = [];
    if (source.poisonTurns > 0) badges.push({ key:'poison', label:`중독 ${source.poisonTurns}`, tooltip:`턴마다 독 피해를 받습니다. 남은 ${source.poisonTurns}턴` });
    if (source.stunTurns > 0) badges.push({ key:'stun', label:`기절 ${source.stunTurns}`, tooltip:`행동할 수 없습니다. 남은 ${source.stunTurns}턴` });
    if (source.chillTurns > 0) badges.push({ key:'chill', label:`냉기 ${source.chillTurns}`, tooltip:'다음 공격 데미지가 50% 감소합니다.' });
    if (source.intBuffTurns > 0) badges.push({ key:'intBuff', label:`환기 ${source.intBuffTurns}`, tooltip:`지능이 30% 증가합니다. 남은 ${source.intBuffTurns}턴` });
    if (source.missChance > 0) badges.push({ key:'missChance', label:`빗나감 ${Math.round(source.missChance * 100)}%`, tooltip:`공격이 ${Math.round(source.missChance * 100)}% 확률로 빗나갑니다.` });
    if (source.guardianOathReady) badges.push({ key:'guardianOath', label:'맹세 준비', tooltip:'쓰러질 때 수호자의 맹세로 한 번 부활합니다.' });
    return badges;
  }

  function selectEnabledQuestion(workbooks, questions, random = Math.random) {
    const enabledIds = new Set((workbooks || [])
      .filter((workbook) => workbook && workbook.enabled !== false)
      .map((workbook) => workbook.id));
    const pool = (questions || []).filter((question) => question && enabledIds.has(question.workbookId));
    if (!pool.length) return null;
    return pool[Math.floor(random() * pool.length)] || pool[0];
  }

  function buildMonsterTechniqueNotices(effect) {
    if (!effect?.name) return [];
    const notices = [`${effect.name}를 사용했다!`];
    if (effect.kind === 'poison') notices.push(`중독에 걸렸다! ${effect.poisonTurns}턴 동안 독 피해를 받습니다.`);
    if (effect.kind === 'selfShield') notices.push(`보호막 ${effect.shield}을 생성했다!`);
    if (effect.kind === 'stun') notices.push(`기절에 걸렸다! 다음 행동을 ${effect.stunTurns}턴 할 수 없습니다.`);
    if (effect.kind === 'chill') notices.push('냉기에 걸렸다! 다음 공격 데미지가 50% 감소합니다.');
    return notices;
  }

  function shortenCombatDelay(delay, reduction = 400) {
    return Math.max(0, (Number(delay) || 0) - Math.max(0, Number(reduction) || 0));
  }

  function deduplicateCombatStatusEvents(events) {
    const merged = [];
    const statusIndexes = new Map();
    (events || []).forEach((event) => {
      const status = String(event?.effect?.status || event?.status || '').trim().toLowerCase();
      if (status !== 'chill') {
        merged.push(event);
        return;
      }
      const target = String(event?.effect?.type || event?.type || '').trim().toLowerCase();
      const key = `${event?.type || ''}:${target}:${status}`;
      const existingIndex = statusIndexes.get(key);
      if (existingIndex == null) {
        statusIndexes.set(key, merged.length);
        merged.push(event);
        return;
      }
      const existing = merged[existingIndex];
      const existingTurns = Math.max(0, Number(existing?.effect?.turns) || 0);
      const nextTurns = Math.max(0, Number(event?.effect?.turns) || 0);
      if (nextTurns > existingTurns) {
        merged[existingIndex] = {
          ...event,
          effect:{ ...(event.effect || {}), turns:nextTurns },
        };
      }
    });
    return merged;
  }

  function normalizeCombatEffect(effect) {
    if (!effect || typeof effect !== 'object') return null;
    const id = String(effect.id || '').trim();
    const type = String(effect.type || '').trim();
    const combatId = String(effect.combatId || '').trim();
    const amount = Math.max(0, Math.floor(Number(effect.amount) || 0));
    if (!id || !COMBAT_EFFECT_TYPES.has(type) || !combatId) return null;

    const normalized = { id, type, combatId };
    if (['monster-damage', 'monster-shield', 'monster-heal', 'player-damage', 'retaliation', 'player-dot', 'monster-dot'].includes(type)) {
      if (amount <= 0) return null;
      normalized.amount = amount;
    }
    if (effect.critical === true) normalized.critical = true;
    if (type === 'monster-damage' && effect.ignoreShield === true) normalized.ignoreShield = true;

    if (type === 'monster-damage' && effect.finalHit === true) {
      normalized.finalHit = true;
      normalized.resolutionId = String(effect.resolutionId || '').trim();
      normalized.executePct = Math.max(0, Math.min(1, Number(effect.executePct) || 0));
      normalized.executeHp = Math.max(0, Math.floor(Number(effect.executeHp) || 0));
    }
    if (type === 'monster-damage' && effect.consumeCharge === true) normalized.consumeCharge = true;
    if (type === 'monster-status' || type === 'player-status') {
      normalized.status = String(effect.status || '').trim();
      normalized.turns = Math.max(0, Math.floor(Number(effect.turns) || 0));
      if (!normalized.status) return null;
      if (type === 'monster-status' && normalized.status === 'shadow') {
        normalized.stacks = Math.max(0, Math.floor(Number(effect.stacks) || 0));
        if (normalized.stacks <= 0) return null;
        normalized.mode = effect.mode === 'add' ? 'add' : 'set';
        if (Number(effect.maxStacks) > 0) normalized.maxStacks = Math.floor(Number(effect.maxStacks));
      } else if (type === 'monster-status') {
        normalized.mode = effect.mode === 'max' ? 'max' : 'set';
      }
      if (effect.damage != null) normalized.damage = Math.max(0, Math.floor(Number(effect.damage) || 0));
    }
    if (type === 'player-support') {
      const kinds = new Set(['shield', 'heal', 'int-buff', 'battle-roar', 'charge', 'consume-charge']);
      normalized.kind = String(effect.kind || '').trim();
      if (!kinds.has(normalized.kind)) return null;
      if (normalized.kind === 'shield' || normalized.kind === 'heal') {
        if (amount <= 0) return null;
        normalized.amount = amount;
      }
      if (normalized.kind === 'int-buff') {
        normalized.turns = Math.max(1, Math.floor(Number(effect.turns) || 1));
        normalized.pct = Math.max(0, Number(effect.pct) || 0);
      }
      if (normalized.kind === 'battle-roar') normalized.turns = Math.max(1, Math.floor(Number(effect.turns) || 1));
    }
    if (type === 'player-damage') {
      normalized.pierceDefense = effect.pierceDefense === true;
      normalized.hitIndex = Math.max(0, Math.floor(Number(effect.hitIndex) || 0));
      if (Number(effect.monsterHeal) > 0) normalized.monsterHeal = Math.max(1, Math.floor(Number(effect.monsterHeal)));
    }
    if (type === 'retaliation') {
      if (Number(effect.heal) > 0) normalized.heal = Math.max(1, Math.floor(Number(effect.heal)));
    }
    if (type === 'player-dot') {
      normalized.status = String(effect.status || '').trim();
      normalized.consumeTurn = effect.consumeTurn === true;
    }
    return normalized;
  }

  function createCombatEffectHandler(handlers = {}) {
    const consumed = new Set();
    return {
      apply(effect) {
        const normalized = normalizeCombatEffect(effect);
        if (!normalized || consumed.has(normalized.id)) return false;
        const handler = handlers[normalized.type];
        if (typeof handler !== 'function') return false;
        consumed.add(normalized.id);
        handler(normalized);
        return true;
      },
    };
  }

  function buildCombatSequence(events) {
    const order = new Map(COMBAT_EVENT_ORDER.map((type, index) => [type, index]));
    return (events || [])
      .filter((event) => event && order.has(event.type) && String(event.text || '').trim())
      .map((event, index) => {
        const normalized = { type:event.type, text:String(event.text) };
        if (event.tone) normalized.tone = String(event.tone);
        if (Number.isFinite(Number(event.duration)) && Number(event.duration) >= 0) normalized.duration = Number(event.duration);
        if (event.fx != null) normalized.fx = event.fx;
        if (event.audioId) normalized.audioId = String(event.audioId);
        if (event.fallbackSfx) normalized.fallbackSfx = String(event.fallbackSfx);
        if (event.ultimateId) normalized.ultimateId = String(event.ultimateId);
        if (event.preserveDuration === true) normalized.preserveDuration = true;
        const effect = normalizeCombatEffect(event.effect);
        if (effect) normalized.effect = effect;
        return { event:normalized, index };
      })
      .sort((a, b) => order.get(a.event.type) - order.get(b.event.type) || a.index - b.index)
      .map((entry) => entry.event);
  }

  global.YuksamCombatRules = {
    combatNoticeDelay: (base = 1920) => base + 600,
    shortenCombatDelay,
    deduplicateCombatStatusEvents,
    scaleMonsterStats,
    mageBasicCriticalDamage,
    shieldChargeDamage,
    resolveShieldedDamage,
    rollEnhancement,
    rollHostileHit,
    combinedMonsterMissChance,
    applyFinalBossDamageNerf,
    healLivingAllies,
    planLivingAllyHeals,
    normalizeCombatStatuses,
    applyChillToAttack,
    buildStatusBadges,
    selectEnabledQuestion,
    buildMonsterTechniqueNotices,
    createCombatEffectHandler,
    buildCombatSequence,
  };
})(window);
