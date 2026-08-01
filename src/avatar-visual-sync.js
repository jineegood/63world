(function installYuksamAvatarVisualSync(global) {
  'use strict';

  if (global.YuksamAvatarVisualSync) return;

  const CLASS_INTENSITY = Object.freeze({ warrior:0.8, mage:0.6, priest:0.6 });
  const FALLBACK_TIERS = Object.freeze([
    { name:'일반', cls:'tier-0', color:'#cbd5e1' },
    { name:'고급', cls:'tier-1', color:'#22c55e' },
    { name:'희귀', cls:'tier-2', color:'#3b82f6' },
    { name:'영웅', cls:'tier-3', color:'#a855f7' },
    { name:'전설', cls:'tier-4', color:'#fbbf24' },
  ]);

  function normalizeTier(value) {
    const number = Number(value);
    return Math.max(0, Math.min(4, Math.trunc(Number.isFinite(number) ? number : 0)));
  }

  function weaponTierStyleFor(member, tierDefinitions = null) {
    const equipment = member?.equipment && typeof member.equipment === 'object'
      ? member.equipment
      : {};
    const weaponId = equipment.weapon || null;
    const upgrades = member?.weaponUpgrades && typeof member.weaponUpgrades === 'object'
      ? member.weaponUpgrades
      : {};
    const tier = normalizeTier(
      member?.weaponTier ?? (weaponId ? upgrades[weaponId] : 0),
    );
    const definitions = tierDefinitions
      || global.TIER_INFO_V27
      || global.YuksamPatchData?.TIER_INFO_V27
      || FALLBACK_TIERS;
    const info = definitions[tier] || definitions[0] || FALLBACK_TIERS[tier];
    const klass = member?.klass || member?.className || member?.class || 'warrior';
    return {
      weaponId,
      tier,
      name:info?.name || FALLBACK_TIERS[tier].name,
      color:info?.color || FALLBACK_TIERS[tier].color,
      className:tier > 0 ? (info?.cls || `tier-${tier}`) : '',
      intensity:CLASS_INTENSITY[klass] || 0.8,
    };
  }

  function spriteStateFor(member, overrides = {}) {
    return {
      ...overrides,
      equipment:{ ...(member?.equipment || {}) },
      costume:{ ...(member?.costume || {}) },
      // Explicit style prevents drawPlayerSprite from accidentally borrowing the
      // current browser player's upgrade tier when two players use the same weapon.
      weaponTierStyle:weaponTierStyleFor(member),
    };
  }

  function petSideFromFacing(currentSide, facing) {
    const horizontal = Number(facing?.x) || 0;
    if (Math.abs(horizontal) > 0.1) return horizontal > 0 ? 'left' : 'right';
    return currentSide === 'right' ? 'right' : 'left';
  }

  function petWorldPosition({ ownerX = 0, ownerY = 0, side = 'left', moving = false,
    dancing = false, bob = 0, now = Date.now() } = {}) {
    const safeNow = Number(now) || 0;
    return {
      x:Number(ownerX) + (side === 'right' ? 54 : -54)
        + (dancing ? Math.sin(safeNow / 90) * 4 : 0),
      y:Number(ownerY) + 8 - (moving
        ? Math.abs(Math.sin(safeNow / 120 + Number(bob || 0))) * 11
        : Math.sin(safeNow / 340 + Number(bob || 0)) * 2.5),
    };
  }

  global.YuksamAvatarVisualSync = Object.freeze({
    normalizeTier,
    weaponTierStyleFor,
    spriteStateFor,
    petSideFromFacing,
    petWorldPosition,
  });
})(typeof window !== 'undefined' ? window : globalThis);
