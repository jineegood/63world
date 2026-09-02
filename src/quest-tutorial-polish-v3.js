(function questTutorialPolishV3(global) {
  'use strict';

  const NPC_INTROS = Object.freeze({
    weapon:Object.freeze({
      questId:'tut_shop',
      text:'명진쌤의 소개로 왔구나! 모험에 필요한 무기를 골라 보렴.',
      gift:false,
    }),
    armor:Object.freeze({
      questId:'tut_shop',
      text:'명진쌤의 소개로 왔구나! 몸을 지켜 줄 방어구를 살펴보렴.',
      gift:false,
    }),
    accessory:Object.freeze({
      questId:'tut_accessory',
      text:'명진쌤이 보내셨구나! 액세서리가 어떤 힘을 주는지 알려 줄게.',
      gift:false,
    }),
    costume:Object.freeze({
      questId:'tut_costume',
      text:'아! 명진쌤의 부탁을 받고 왔구나. 이 아이템을 이번만 특별히 공짜로 주마!',
      gift:true,
    }),
    enhance:Object.freeze({
      questId:'tut_enhance',
      text:'명진쌤에게 이야기 들었어. 장비 강화 방법을 차근차근 알려 줄게.',
      gift:false,
    }),
  });

  const ACCEPT_BUILDING_GRANT_VERSION = 1;
  const ACTION_QUEST_BUILDING_SUPPLIES = Object.freeze({
    tut_enhance:3,
    tut_pet:10,
  });

  function grantAcceptBuildingSupply({ player, questState, amount } = {}) {
    const safeAmount = Math.max(0, Math.trunc(Number(amount) || 0));
    const appliedVersion = Math.max(0, Math.trunc(Number(questState?.acceptBuildingGrantVersion) || 0));
    if (!player || !questState || safeAmount <= 0 || appliedVersion >= ACCEPT_BUILDING_GRANT_VERSION) {
      return Object.freeze({ granted:false, amount:0 });
    }
    player.building = Math.max(0, Math.trunc(Number(player.building) || 0)) + safeAmount;
    questState.acceptBuildingGrantVersion = ACCEPT_BUILDING_GRANT_VERSION;
    return Object.freeze({ granted:true, amount:safeAmount });
  }

  function reconcileActionQuestSupplies(player) {
    if (!player || !player.quests || typeof player.quests !== 'object') {
      return Object.freeze({ changed:false, total:0, grants:Object.freeze([]) });
    }
    const grants = [];
    for (const [questId, amount] of Object.entries(ACTION_QUEST_BUILDING_SUPPLIES)) {
      const questState = player.quests[questId];
      if (!questState || !['accepted', 'ready'].includes(questState.status)) continue;
      const result = grantAcceptBuildingSupply({ player, questState, amount });
      if (result.granted) grants.push(Object.freeze({ questId, amount:result.amount }));
    }
    const total = grants.reduce((sum, grant) => sum + grant.amount, 0);
    return Object.freeze({ changed:total > 0, total, grants:Object.freeze(grants) });
  }

  function applyTrainingAccept({ questId, player, questState } = {}) {
    if (questId !== 'tut_healing_well' || !player || !questState
      || questState.status !== 'accepted'
      || (questState.trainingApplied && Number(player.hp) <= 1)) {
      return Object.freeze({ applied:false, hp:null });
    }
    questState.trainingApplied = true;
    player.hp = 1;
    return Object.freeze({ applied:true, hp:1 });
  }

  function recordHealingSuccess(questState, target = 1) {
    if (!questState || questState.status !== 'accepted') return false;
    questState.target = Math.max(1, Number(questState.target || target));
    questState.progress = questState.target;
    questState.status = 'ready';
    return true;
  }

  function migrateHealingQuest(quests) {
    if (!quests || quests.tut_healing_well) return false;
    const laterQuestIds = [
      'mushroom_hunt', 'tut_shop', 'tut_skill', 'slime_hunt',
      'tut_costume', 'tut_accessory', 'tut_enhance',
    ];
    if (!laterQuestIds.some((id) => quests[id])) return false;
    quests.tut_healing_well = {
      status:'completed',
      progress:1,
      target:1,
      migrated:true,
    };
    return true;
  }

  function getNpcIntro(kind, questState) {
    const intro = NPC_INTROS[kind];
    if (!intro || !questState || questState.status !== 'accepted'
      || Number(questState.progress || 0) >= Number(questState.target || 1)
      || questState.npcIntroSeen) return null;
    return intro;
  }

  function markNpcIntroSeen(questState) {
    if (!questState || questState.npcIntroSeen) return false;
    questState.npcIntroSeen = true;
    return true;
  }

  function grantQuestCostume({ player, questState, itemId } = {}) {
    if (!player || !questState || !itemId) return Object.freeze({ granted:false });
    if (!Array.isArray(player.costumeInventory)) player.costumeInventory = [];
    const granted = !player.costumeInventory.includes(itemId);
    if (granted) player.costumeInventory.push(itemId);
    questState.npcIntroSeen = true;
    if (questState.status === 'accepted') {
      questState.target = Math.max(1, Number(questState.target || 1));
      questState.progress = questState.target;
      questState.status = 'ready';
    }
    return Object.freeze({ granted });
  }

  global.YuksamQuestTutorialPolishV3 = Object.freeze({
    ACCEPT_BUILDING_GRANT_VERSION,
    ACTION_QUEST_BUILDING_SUPPLIES,
    grantAcceptBuildingSupply,
    reconcileActionQuestSupplies,
    applyTrainingAccept,
    recordHealingSuccess,
    migrateHealingQuest,
    getNpcIntro,
    markNpcIntroSeen,
    grantQuestCostume,
  });
})(window);
