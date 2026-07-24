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

  function applyTrainingAccept({ questId, player, questState } = {}) {
    if (questId !== 'tut_healing_well' || !player || !questState
      || questState.status !== 'accepted' || questState.trainingApplied) {
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
    applyTrainingAccept,
    recordHealingSuccess,
    migrateHealingQuest,
    getNpcIntro,
    markNpcIntroSeen,
    grantQuestCostume,
  });
})(window);
