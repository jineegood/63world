(function initYuksamCombatFx(global) {
  'use strict';

  const SUPPORT_TYPES = new Set(['shield', 'buff', 'healBuff', 'healAllies']);
  const SHAKE_BY_TIER = [0, 2, 4, 7, 10];
  const activeTimers = new Set();
  const activeNodes = new Set();
  const activeMotions = new Set();
  const activeStages = new Set();
  const pendingResolvers = new Set();
  let cancelGeneration = 0;

  function skillTier(skill) {
    if (skill?.kind === 'ultimate') return 4;
    const line = Number(skill?.line) || 0;
    if (line >= 8) return 3;
    if (line >= 5) return 2;
    return 1;
  }

  function elementFor(skillId, skill) {
    const key = `${skillId || ''} ${skill?.kind || ''} ${skill?.specOnly || ''}`.toLowerCase();
    if (/fire|화염/.test(key)) return 'fire';
    if (/frost|ice|냉기/.test(key)) return 'ice';
    if (/shadow|void|암흑/.test(key)) return 'shadow';
    if (/holy|priest|신성/.test(key) || skill?.classOnly === 'priest') return 'holy';
    return 'arcane';
  }

  function profileBase(skillId, skill) {
    const tier = skillTier(skill);
    return {
      skillId,
      tier,
      target:'monster',
      mode:'impact',
      motion:'strike',
      impact:'area-burst',
      particleCount:4 + tier * 2,
      travelMs:Math.max(180, 360 - tier * 30),
      lingerMs:520 + tier * 30,
      shakePx:SHAKE_BY_TIER[tier],
      shakeMs:150 + tier * 20,
      complementaryUltimate:tier === 4,
    };
  }

  function getSkillFxProfile(skillId, skill) {
    const profile = profileBase(skillId, skill);
    const activeType = skill?.active?.type || '';
    const isSupport = SUPPORT_TYPES.has(activeType);
    const element = elementFor(skillId, skill);

    if (skill?.classOnly === 'warrior') {
      if (activeType === 'shieldBash') {
        return {
          ...profile,
          mode:'impact',
          motion:'shield-charge',
          motionTravelPct:.85,
          travelMs:300,
          actionMs:520,
          impact:'shockwave',
          selfWave:'shield-wave',
        };
      }
      if (activeType === 'shield') {
        return { ...profile, mode:'wave', target:'player', motion:'shield', impact:'shield-wave' };
      }
      if (activeType === 'charge') {
        return { ...profile, mode:'wave', target:'player', motion:'charge-up', impact:'shockwave' };
      }
      return { ...profile, motion:'slash', impact:profile.tier >= 3 ? 'shockwave' : 'slash-impact' };
    }

    if (skill?.classOnly === 'mage') {
      if (isSupport) {
        return { ...profile, mode:'wave', target:'player', motion:'cast', impact:`${element}-wave` };
      }
      return {
        ...profile,
        mode:'projectile',
        motion:'cast',
        impact:`${element}-burst`,
        projectile:`${element}-projectile`,
      };
    }

    if (skill?.classOnly === 'priest') {
      if (isSupport) {
        const impact = activeType === 'shield' ? 'shield-wave' : 'heal-wave';
        return { ...profile, mode:'wave', target:'player', motion:'prayer', impact };
      }
      const selfWave = activeType === 'damageHeal' || skill?.active?.healMaxPct ? 'heal-wave' : null;
      if (skillId === 'priest_holy_judgment_v24') {
        return {
          ...profile,
          mode:'impact',
          motion:'prayer',
          impact:`${element}-burst`,
          ...(selfWave ? { selfWave } : {}),
        };
      }
      return {
        ...profile,
        mode:'projectile',
        motion:'prayer',
        impact:`${element}-burst`,
        projectile:`${element}-projectile`,
        ...(selfWave ? { selfWave } : {}),
      };
    }

    if (isSupport) return { ...profile, mode:'wave', target:'player', motion:'cast', impact:'guard-wave' };
    return profile;
  }

  function getPlayerSupportFxProfile(skillId, skill, supportKind) {
    const profile = getSkillFxProfile(skillId, skill);
    if (supportKind === 'shield') {
      const { projectile, selfWave, motionTravelPct, ...shieldProfile } = profile;
      return {
        ...shieldProfile,
        source:'player',
        target:'player',
        mode:'wave',
        motion:'shield',
        impact:'shield-wave',
      };
    }
    return { ...profile, source:'player', target:'player', mode:'wave' };
  }

  function getBasicAttackFxProfile(klass = 'warrior') {
    const shared = {
      source:'player',
      target:'monster',
      skillId:null,
      tier:1,
      mode:'impact',
      motion:'strike',
      impact:'basic-impact',
      particleCount:6,
      travelMs:160,
      lingerMs:520,
      shakePx:2,
      shakeMs:150,
    };
    if (klass === 'mage') {
      return { ...shared, mode:'projectile', motion:'cast', projectile:'arcane-projectile', impact:'arcane-burst', travelMs:220 };
    }
    if (klass === 'priest') {
      return { ...shared, mode:'projectile', motion:'prayer', projectile:'holy-projectile', impact:'holy-burst', travelMs:220 };
    }
    return { ...shared, motion:'slash', impact:'slash-impact' };
  }

  function monsterTier(monster) {
    if (monster?.type === 'teacherBoss' || monster?.boss) return 4;
    if (monster?.elite) return 3;
    if (monster?.type === 'tarantula' || monster?.type === 'zombie') return 2;
    return 1;
  }

  function monsterTechniqueKind(technique) {
    if (technique && typeof technique === 'object' && (technique.kind || technique.k)) return technique.kind || technique.k;
    const key = String(technique?.name || technique?.n || technique || '').toLowerCase();
    if (/poison|독|포자|맹독/.test(key)) return 'poison';
    if (/shield|방패|단단/.test(key)) return 'selfShield';
    if (/chill|냉기|얼어|꾸중/.test(key)) return 'chillPlayer';
    if (/multi|연속|통제/.test(key)) return 'multi';
    if (/life|흡혈|물어뜯/.test(key)) return 'lifesteal';
    if (/crit|급소/.test(key)) return 'crit';
    if (/heavy|분노|대지|호랑/.test(key)) return 'heavy';
    if (/stun|기절/.test(key)) return 'stun';
    return '';
  }

  function getMonsterFxProfile(monster = {}, technique = null) {
    const type = String(monster.type || 'monster');
    const kind = monsterTechniqueKind(technique);
    const tier = monsterTier(monster);
    const attackStyle = type === 'mushroom' || type === 'teacherBoss'
      ? 'projectile'
      : (type === 'snake' || type === 'tarantula' ? 'claw' : 'charge');
    const profile = {
      source:'monster',
      target:'player',
      monsterType:type,
      technique:technique?.name || technique?.n || technique || null,
      techniqueKind:kind,
      tier,
      attackStyle,
      mode:attackStyle === 'projectile' ? 'projectile' : 'impact',
      motion:attackStyle === 'claw' ? 'claw' : attackStyle,
      impact:attackStyle === 'claw' ? 'claw-impact' : 'monster-impact',
      ...(attackStyle === 'projectile' ? { projectile:'monster-projectile' } : {}),
      particleCount:4 + tier * 3,
      travelMs:Math.max(190, 270 - tier * 20),
      lingerMs:300 + tier * 20,
      actionMs:390 + tier * 30,
      shakePx:SHAKE_BY_TIER[tier] + (tier === 4 ? 3 : 0),
      shakeMs:160 + tier * 25,
    };

    if (kind === 'poison') {
      return { ...profile, mode:'projectile', motion:'venom-cast', impact:'poison-burst', projectile:'poison-projectile', actionMs:430 };
    }
    if (kind === 'selfShield') {
      return { ...profile, target:'monster', mode:'wave', motion:'self-shield', impact:'shield-wave', actionMs:450 };
    }
    if (type === 'stomp' && (kind === 'heavy' || kind === 'stun')) {
      return { ...profile, mode:'impact', motion:'jump-stomp', impact:'ground-shockwave', shakePx:Math.max(6, profile.shakePx + 2), actionMs:540 };
    }
    if (type === 'snake' && kind === 'crit') {
      return { ...profile, mode:'impact', motion:'bite', impact:'bite-impact', shakePx:Math.max(4, profile.shakePx), actionMs:420 };
    }
    if (kind === 'multi') {
      const isBoss = tier === 4;
      return {
        ...profile,
        mode:'impact',
        motion:isBoss ? 'boss-barrage' : 'frenzy-claw',
        impact:isBoss ? 'boss-area-burst' : 'multi-bite-impact',
        particleCount:profile.particleCount + (isBoss ? 8 : 4),
        shakePx:profile.shakePx + (isBoss ? 5 : 1),
        actionMs:isBoss ? 580 : 460,
      };
    }
    if (kind === 'lifesteal') {
      return { ...profile, mode:'impact', motion:'drain-bite', impact:'drain-burst', selfWave:'drain-wave', actionMs:450 };
    }
    if (kind === 'chillPlayer') {
      return { ...profile, mode:'projectile', motion:'boss-cast', impact:'ice-burst', projectile:'ice-projectile', particleCount:profile.particleCount + 6, shakePx:profile.shakePx + 2, actionMs:560 };
    }
    if (kind === 'heavy' || kind === 'stun') {
      const isBoss = tier === 4;
      return {
        ...profile,
        mode:'impact',
        motion:isBoss ? 'boss-slam' : 'heavy-charge',
        impact:isBoss ? 'boss-area-burst' : 'ground-shockwave',
        particleCount:profile.particleCount + (isBoss ? 7 : 3),
        shakePx:profile.shakePx + (isBoss ? 4 : 2),
        actionMs:isBoss ? 580 : (type === 'stomp' ? 540 : 500),
      };
    }
    return profile;
  }

  function getMonsterActionFxProfile(monster = {}, technique = null) {
    const profile = getMonsterFxProfile(monster, technique);
    if (profile.techniqueKind === 'selfShield') return profile;
    const { projectile, selfWave, ...windUpProfile } = profile;
    return { ...windUpProfile, phase:'wind-up', mode:'wind-up' };
  }

  function getMonsterHitFxProfile(monster = {}, technique = null) {
    const profile = getMonsterFxProfile(monster, technique);
    if (profile.techniqueKind === 'selfShield') return null;
    const homeworkBomb = profile.monsterType === 'teacherBoss' && profile.techniqueKind === 'multi';
    return {
      ...profile,
      ...(homeworkBomb ? { mode:'projectile' } : {}),
      phase:'impact',
      suppressMotion:true,
      actionMs:null,
      renderImpactAfterCallback:true,
    };
  }

  function safeToken(value) {
    return String(value || 'generic').replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  }

  function combatElements() {
    const document = global.document;
    if (!document) return null;
    const stage = document.querySelector('.combat-stage');
    const player = stage?.querySelector('.combat-player');
    const monster = stage?.querySelector('.combat-monster');
    if (!stage || !player || !monster) return null;
    return { stage, player, monster };
  }

  function centerInStage(stage, element, fallbackX, fallbackY) {
    const stageRect = stage.getBoundingClientRect?.() || {};
    const rect = element.getBoundingClientRect?.() || {};
    const stageWidth = Number(stageRect.width) || stage.clientWidth || 800;
    const stageHeight = Number(stageRect.height) || stage.clientHeight || 400;
    if (Number(rect.width) || Number(rect.height)) {
      return {
        x:(Number(rect.left) || 0) - (Number(stageRect.left) || 0) + (Number(rect.width) || 0) / 2,
        y:(Number(rect.top) || 0) - (Number(stageRect.top) || 0) + (Number(rect.height) || 0) / 2,
      };
    }
    return { x:stageWidth * fallbackX, y:stageHeight * fallbackY };
  }

  function makeNode(stage, className, x, y) {
    const node = global.document.createElement('div');
    node.className = `combat-fx-node ${className}`;
    node.style.left = `${Math.round(x)}px`;
    node.style.top = `${Math.round(y)}px`;
    node.setAttribute('aria-hidden', 'true');
    stage.appendChild(node);
    activeNodes.add(node);
    return node;
  }

  function removeNode(node) {
    node?.remove();
    activeNodes.delete(node);
  }

  function schedule(callback, delay, generation) {
    const timer = global.setTimeout(() => {
      activeTimers.delete(timer);
      if (generation !== cancelGeneration) return;
      callback();
    }, Math.max(0, delay));
    activeTimers.add(timer);
    return timer;
  }

  function scheduleRemoval(node, delay, generation) {
    schedule(() => removeNode(node), delay, generation);
  }

  function createWave(stage, point, waveType, tier, lifetime, generation, target = 'player') {
    const wave = makeNode(
      stage,
      `combat-fx-wave fx-impact-${safeToken(waveType)} fx-tier-${tier}`,
      point.x,
      point.y,
    );
    wave.dataset.target = target;
    scheduleRemoval(wave, lifetime, generation);
    return wave;
  }

  function createImpact(stage, point, profile, generation) {
    const impact = makeNode(
      stage,
      `combat-fx-impact fx-impact-${safeToken(profile.impact)} fx-tier-${profile.tier}`,
      point.x,
      point.y,
    );
    impact.dataset.impact = profile.impact;
    const count = Math.max(4, Number(profile.particleCount) || 6);
    for (let index = 0; index < count; index += 1) {
      const particle = makeNode(
        stage,
        `combat-fx-particle fx-impact-${safeToken(profile.impact)} fx-tier-${profile.tier}`,
        point.x,
        point.y,
      );
      const angle = (Math.PI * 2 * index) / count;
      const distance = 20 + profile.tier * 9 + (index % 3) * 5;
      particle.style.setProperty('--fx-px', `${Math.round(Math.cos(angle) * distance)}px`);
      particle.style.setProperty('--fx-py', `${Math.round(Math.sin(angle) * distance)}px`);
      particle.style.setProperty('--fx-delay', `${(index % 4) * 12}ms`);
      scheduleRemoval(particle, profile.lingerMs, generation);
    }
    const impactTailMs = profile.complementaryUltimate ? 32 : 0;
    scheduleRemoval(impact, profile.lingerMs + impactTailMs, generation);
    return impact;
  }

  function applyScreenShake(stage, profile, generation) {
    if (!(profile.shakePx > 0)) return;
    stage.classList.add('combat-fx-shaking');
    stage.dataset.fxShakeTier = String(profile.tier);
    stage.style.setProperty('--combat-fx-shake', `${profile.shakePx}px`);
    stage.style.setProperty('--combat-fx-shake-neg', `${-profile.shakePx}px`);
    stage.style.setProperty('--combat-fx-shake-soft-neg', `${-profile.shakePx * .65}px`);
    stage.style.setProperty('--combat-fx-shake-soft', `${profile.shakePx * .45}px`);
    stage.style.setProperty('--combat-fx-shake-ms', `${profile.shakeMs}ms`);
    activeStages.add(stage);
    schedule(() => {
      stage.classList.remove('combat-fx-shaking');
      delete stage.dataset.fxShakeTier;
      stage.style.removeProperty('--combat-fx-shake');
      stage.style.removeProperty('--combat-fx-shake-neg');
      stage.style.removeProperty('--combat-fx-shake-soft-neg');
      stage.style.removeProperty('--combat-fx-shake-soft');
      stage.style.removeProperty('--combat-fx-shake-ms');
      activeStages.delete(stage);
    }, Math.max(profile.shakeMs, profile.lingerMs + 16), generation);
  }

  function normalizeRuntimeProfile(profile) {
    const reducedMotion = !!global.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    let tier = Math.min(4, Math.max(1, Number(profile.tier) || 1));
    let particleCount = Math.max(4, Number(profile.particleCount) || 6);
    let shakePx = Math.max(0, Number(profile.shakePx) || SHAKE_BY_TIER[tier]);
    let suppressMotion = profile.suppressMotion === true;
    let selfWave = profile.selfWave;

    if (profile.complementaryUltimate) {
      const meteorReplay = profile.skillId === 'mage_fire_meteor_v24';
      if (profile.hitStage === 'follow-up' && !meteorReplay) {
        tier = 2;
        particleCount = 4;
        shakePx = 2;
        suppressMotion = true;
        selfWave = null;
      } else {
        tier = 3;
        particleCount = Math.min(10, particleCount);
        shakePx = Math.min(6, shakePx);
      }
    }

    const travelMs = reducedMotion ? 1 : Math.max(0, Number(profile.travelMs) || 0);
    const actionMs = reducedMotion
      ? 1
      : (profile.actionMs == null ? null : Math.max(travelMs, Number(profile.actionMs) || travelMs));
    return {
      ...profile,
      tier,
      particleCount,
      shakePx:reducedMotion ? 0 : shakePx,
      shakeMs:reducedMotion ? 1 : Math.max(1, Number(profile.shakeMs) || 180),
      travelMs,
      lingerMs:reducedMotion ? 20 : Math.max(0, Number(profile.lingerMs) || 0),
      actionMs,
      suppressMotion,
      selfWave,
    };
  }

  function cancelAllCombatFx() {
    cancelGeneration += 1;
    activeTimers.forEach((timer) => global.clearTimeout(timer));
    activeTimers.clear();
    activeNodes.forEach((node) => node.remove());
    activeNodes.clear();
    activeMotions.forEach(({ actor, motionClass, tierClass }) => {
      actor.classList.remove(motionClass, tierClass, 'combat-acting');
      actor.style.removeProperty('--combat-fx-motion-distance');
    });
    activeMotions.clear();
    activeStages.forEach((stage) => {
      stage.classList.remove('combat-fx-shaking');
      delete stage.dataset.fxShakeTier;
      stage.style.removeProperty('--combat-fx-shake');
      stage.style.removeProperty('--combat-fx-shake-neg');
      stage.style.removeProperty('--combat-fx-shake-soft-neg');
      stage.style.removeProperty('--combat-fx-shake-soft');
      stage.style.removeProperty('--combat-fx-shake-ms');
    });
    activeStages.clear();
    [...pendingResolvers].forEach((resolvePending) => resolvePending(false));
  }

  function playActionFx(profile, actorRole, onImpact) {
    const elements = combatElements();
    if (!elements || !profile) return Promise.resolve(false);
    const { stage, player, monster } = elements;
    const generation = cancelGeneration;
    const normalized = normalizeRuntimeProfile(profile);
    const { travelMs, lingerMs, actionMs } = normalized;
    const actor = actorRole === 'monster' ? monster : player;
    const opponent = actorRole === 'monster' ? player : monster;
    const from = centerInStage(stage, actor, actorRole === 'monster' ? 0.8 : 0.2, actorRole === 'monster' ? 0.38 : 0.66);
    const targetElement = normalized.target === 'player' ? player : monster;
    const resolvedTarget = targetElement || opponent;
    const to = centerInStage(stage, resolvedTarget, normalized.target === 'player' ? 0.2 : 0.8, normalized.target === 'player' ? 0.66 : 0.38);
    const motionClass = `combat-fx-motion-${safeToken(normalized.motion)}`;
    const tierClass = `combat-fx-tier-${normalized.tier}`;
    if (!normalized.suppressMotion) {
      const motionTravelPct = Math.max(0, Number(normalized.motionTravelPct) || 0);
      if (motionTravelPct > 0) {
        actor.style.setProperty('--combat-fx-motion-distance', `${Math.round((to.x - from.x) * motionTravelPct)}px`);
      }
      actor.classList.add('combat-acting', motionClass, tierClass);
      activeMotions.add({ actor, motionClass, tierClass });
    }

    if (normalized.mode === 'projectile') {
      const projectile = makeNode(
        stage,
        `combat-fx-projectile fx-${safeToken(normalized.projectile)} fx-tier-${normalized.tier}`,
        from.x,
        from.y,
      );
      projectile.dataset.from = actorRole;
      projectile.dataset.to = actorRole === 'monster' ? 'player' : 'monster';
      projectile.dataset.projectile = normalized.projectile;
      projectile.style.setProperty('--fx-dx', `${Math.round(to.x - from.x)}px`);
      projectile.style.setProperty('--fx-dy', `${Math.round(to.y - from.y)}px`);
      projectile.style.setProperty('--fx-travel-ms', `${travelMs}ms`);
      projectile.classList.add('is-flying');
      scheduleRemoval(projectile, travelMs + 16, generation);
    } else if (normalized.mode === 'wave') {
      createWave(stage, to, normalized.impact, normalized.tier, travelMs + lingerMs, generation, normalized.target);
    } else if (normalized.mode === 'impact') {
      const trail = makeNode(stage, `combat-fx-trail fx-motion-${safeToken(normalized.motion)} fx-tier-${normalized.tier}`, to.x, to.y);
      scheduleRemoval(trail, travelMs + lingerMs, generation);
    }

    return new Promise((resolve) => {
      let settled = false;
      const settle = (value) => {
        if (settled) return;
        settled = true;
        pendingResolvers.delete(settle);
        resolve(value);
      };
      pendingResolvers.add(settle);
      schedule(() => {
        if (generation !== cancelGeneration) {
          settle(false);
          return;
        }
        const renderImpact = () => {
          const impactElements = combatElements();
          const impactStage = impactElements?.stage || stage;
          const impactPlayer = impactElements?.player || player;
          const impactMonster = impactElements?.monster || monster;
          const impactTarget = normalized.target === 'player' ? impactPlayer : impactMonster;
          const impactActor = actorRole === 'monster' ? impactMonster : impactPlayer;
          const impactPoint = centerInStage(
            impactStage,
            impactTarget,
            normalized.target === 'player' ? 0.2 : 0.8,
            normalized.target === 'player' ? 0.66 : 0.38,
          );
          const impactOrigin = centerInStage(
            impactStage,
            impactActor,
            actorRole === 'monster' ? 0.8 : 0.2,
            actorRole === 'monster' ? 0.38 : 0.66,
          );
          if (normalized.phase !== 'wind-up') {
            createImpact(impactStage, impactPoint, normalized, generation);
            applyScreenShake(impactStage, normalized, generation);
            if (normalized.selfWave) createWave(impactStage, impactOrigin, normalized.selfWave, normalized.tier, lingerMs, generation, actorRole);
          }
        };
        if (actorRole === 'player') {
          try { onImpact?.(); } catch {}
        }
        if (!(actorRole === 'monster' && normalized.renderImpactAfterCallback)) renderImpact();
        if (actorRole !== 'player') {
          try { onImpact?.(); } catch {}
        }
        if (actorRole === 'monster' && normalized.renderImpactAfterCallback && generation === cancelGeneration) renderImpact();
        const completionDelay = actionMs == null
          ? (actorRole === 'player' && lingerMs >= 100 ? lingerMs : 0)
          : Math.max(0, actionMs - travelMs);
        const motionCleanupDelay = actionMs == null ? lingerMs : completionDelay;
        schedule(() => {
          actor.classList.remove('combat-acting', motionClass, tierClass);
          actor.style.removeProperty('--combat-fx-motion-distance');
          for (const entry of activeMotions) {
            if (entry.actor === actor && entry.motionClass === motionClass && entry.tierClass === tierClass) activeMotions.delete(entry);
          }
        }, motionCleanupDelay, generation);
        schedule(() => settle(true), completionDelay, generation);
      }, travelMs, generation);
    });
  }

  function playPlayerActionFx(profile, onImpact) {
    return playActionFx(profile, 'player', onImpact);
  }

  function playMonsterActionFx(profile, onImpact) {
    return playActionFx(profile, 'monster', onImpact);
  }

  global.YuksamCombatFx = {
    getSkillFxProfile,
    getPlayerSupportFxProfile,
    getBasicAttackFxProfile,
    getMonsterFxProfile,
    getMonsterActionFxProfile,
    getMonsterHitFxProfile,
    playPlayerActionFx,
    playMonsterActionFx,
    cancelAllCombatFx,
  };
})(window);
