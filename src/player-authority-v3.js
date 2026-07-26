(function installPlayerAuthorityV3(global) {
  'use strict';

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const CLASSES = new Set(['warrior', 'mage', 'priest']);
  const MAPS = new Set([
    'town',
    'equipmentShop',
    'buildingShopInterior',
    'petShopInterior',
    'upgradeShopInterior',
    'forest',
    'desert',
    'swamp',
    'bossRoom',
    'finalBossRoom',
  ]);
  const EQUIPMENT_SLOTS = new Set(['weapon', 'head', 'armor', 'accessory']);
  const INVENTORY_KINDS = new Set(['gear', 'costume']);
  const QUEST_STATUSES = new Set(['ready', 'active', 'complete', 'claimed']);
  const ERROR_MESSAGES = Object.freeze({
    UNAUTHORIZED:'로그인이 만료되었습니다. 다시 로그인해 주세요.',
    FORBIDDEN:'학생 캐릭터 기능을 사용할 권한이 없습니다.',
    CHARACTER_NOT_FOUND:'아직 생성된 캐릭터가 없습니다.',
    STUDENT_NOT_FOUND:'학생 계정 정보를 확인할 수 없습니다.',
    INVALID_CLASS:'선택한 직업을 만들 수 없습니다.',
    INVALID_APPEARANCE:'캐릭터 외형 값이 올바르지 않습니다.',
    INVALID_PREFERENCES:'저장할 수 없는 설정 값이 포함되어 있습니다.',
    INVALID_MAP:'이동할 수 없는 장소입니다.',
    INVALID_MAP_TRANSITION:'현재 장소에서는 그곳으로 이동할 수 없습니다.',
    LOCKED_MAP:'아직 입장할 수 없는 장소입니다.',
    LEVEL_REQUIRED:'입장에 필요한 레벨이 부족합니다.',
    REVISION_CONFLICT:'다른 기기에서 변경된 내용을 다시 불러왔습니다.',
    REQUEST_ID_REUSED:'중복 요청을 안전하게 차단했습니다. 다시 시도해 주세요.',
    INVALID_REQUEST:'요청 값이 올바르지 않습니다.',
    RPC_FAILED:'서버와 통신하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    INVALID_ITEM:'존재하지 않는 아이템입니다.',
    ITEM_NOT_PURCHASABLE:'구매할 수 없는 아이템입니다.',
    ALREADY_OWNED:'이미 가지고 있는 아이템입니다.',
    INSUFFICIENT_FUNDS:'재화가 부족합니다.',
    ITEM_NOT_OWNED:'보유하지 않은 아이템입니다.',
    INVALID_SLOT:'장착 칸이 올바르지 않습니다.',
    SLOT_EMPTY:'장착된 아이템이 없습니다.',
    WEAPON_NOT_EQUIPPED:'강화할 무기를 먼저 장착해 주세요.',
    MAX_TIER:'이미 최대 강화 단계입니다.',
    SPECIALIZATION_ALREADY_CHOSEN:'이미 전문화를 선택했습니다.',
    INVALID_SPECIALIZATION:'선택할 수 없는 전문화입니다.',
    INVALID_SKILL:'존재하지 않는 스킬입니다.',
    CLASS_REQUIRED:'현재 직업으로 사용할 수 없습니다.',
    SPECIALIZATION_REQUIRED:'전문화 조건이 맞지 않습니다.',
    SKILL_POINTS_REQUIRED:'스킬 포인트가 부족합니다.',
    MAX_RANK:'이미 최대 단계입니다.',
    PREREQUISITE_REQUIRED:'먼저 배워야 하는 스킬이 있습니다.',
    MALFORMED_SNAPSHOT:'서버의 캐릭터 정보가 올바르지 않습니다.',
  });

  class PlayerAuthorityV3Error extends Error {
    constructor(code, options = {}) {
      super(ERROR_MESSAGES[code] || '캐릭터 정보를 처리하지 못했습니다.');
      this.name = 'PlayerAuthorityV3Error';
      this.code = code;
      if (Number.isInteger(options.revision)) this.revision = options.revision;
      if (options.player) this.player = options.player;
    }
  }

  function failSnapshot() {
    throw new PlayerAuthorityV3Error('MALFORMED_SNAPSHOT');
  }

  function isPlainObject(value) {
    return Boolean(value)
      && typeof value === 'object'
      && !Array.isArray(value)
      && Object.prototype.toString.call(value) === '[object Object]';
  }

  function safeString(value, minimum, maximum) {
    if (typeof value !== 'string') failSnapshot();
    const length = Array.from(value).length;
    if (length < minimum || length > maximum || /[\u0000-\u001f\u007f-\u009f]/.test(value)) {
      failSnapshot();
    }
    return value;
  }

  function safeInteger(value, minimum, maximum = Number.MAX_SAFE_INTEGER) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) failSnapshot();
    return value;
  }

  function safeNullableString(value, maximum) {
    if (value === null || value === undefined || value === '') return null;
    return safeString(value, 1, maximum);
  }

  function clonePlainJson(value, maximumBytes = 8192) {
    if (!isPlainObject(value)) throw new PlayerAuthorityV3Error('INVALID_REQUEST');
    let json;
    try {
      json = JSON.stringify(value);
    } catch {
      throw new PlayerAuthorityV3Error('INVALID_REQUEST');
    }
    if (json.length > maximumBytes) throw new PlayerAuthorityV3Error('INVALID_REQUEST');
    const cloned = JSON.parse(json);
    if (!isPlainObject(cloned)) throw new PlayerAuthorityV3Error('INVALID_REQUEST');
    return cloned;
  }

  function snapshotToLegacyPlayer(snapshot) {
    if (!isPlainObject(snapshot) || !isPlainObject(snapshot.core)
      || !Array.isArray(snapshot.inventory) || !Array.isArray(snapshot.skills)
      || !Array.isArray(snapshot.quests) || !Array.isArray(snapshot.pets)
      || !isPlainObject(snapshot.preferences)) {
      failSnapshot();
    }

    const core = snapshot.core;
    const preferences = snapshot.preferences;
    const revision = safeInteger(snapshot.revision, 1);
    if (safeInteger(core.revision, 1) !== revision) failSnapshot();

    const className = safeString(core.class_name, 1, 20);
    if (!CLASSES.has(className)) failSnapshot();
    const currentMap = safeString(core.current_map, 1, 40);
    if (!MAPS.has(currentMap)) failSnapshot();
    const bossReturnMap = safeNullableString(core.boss_origin_map, 20);
    if (bossReturnMap && !['forest', 'desert', 'swamp'].includes(bossReturnMap)) failSnapshot();
    if (typeof core.final_boss_unlocked !== 'boolean') failSnapshot();
    const pets = snapshot.pets.map((petId) => safeString(petId, 1, 80));
    if (new Set(pets).size !== pets.length) failSnapshot();
    const activePet = safeNullableString(snapshot.active_pet, 80);
    if (activePet && !pets.includes(activePet)) failSnapshot();

    const equipment = { weapon:null, head:null, armor:null, accessory:null };
    const costume = {};
    const inventory = [];
    const costumeInventory = [];
    const inventoryInstances = [];
    const weaponUpgrades = {};
    const seenInstanceIds = new Set();
    for (const row of snapshot.inventory) {
      if (!isPlainObject(row)) failSnapshot();
      const id = safeString(row.id, 1, 80);
      const itemId = safeString(row.item_definition_id, 1, 80);
      if (seenInstanceIds.has(id)) failSnapshot();
      seenInstanceIds.add(id);
      const tier = safeInteger(row.enhancement_tier, 0, 20);
      const inventoryKind = row.inventory_kind === undefined
        ? 'gear'
        : safeString(row.inventory_kind, 1, 20);
      if (!INVENTORY_KINDS.has(inventoryKind)) failSnapshot();
      const slot = safeNullableString(row.equipped_slot, 20);
      if (slot && !EQUIPMENT_SLOTS.has(slot)) failSnapshot();
      const equipped = inventoryKind === 'gear' ? equipment : costume;
      if (slot && equipped[slot]) failSnapshot();
      if (slot) equipped[slot] = itemId;
      if (inventoryKind === 'gear') {
        inventory.push(itemId);
        weaponUpgrades[itemId] = Math.max(weaponUpgrades[itemId] || 0, tier);
      } else {
        if (tier !== 0) failSnapshot();
        costumeInventory.push(itemId);
      }
      inventoryInstances.push({
        id,
        itemDefinitionId:itemId,
        inventoryKind,
        enhancementTier:tier,
        equippedSlot:slot,
      });
    }

    const skills = {};
    for (const row of snapshot.skills) {
      if (!isPlainObject(row)) failSnapshot();
      const skillId = safeString(row.skill_id, 1, 80);
      if (Object.hasOwn(skills, skillId)) failSnapshot();
      skills[skillId] = safeInteger(row.rank, 0, 20);
    }

    const quests = {};
    for (const row of snapshot.quests) {
      if (!isPlainObject(row)) failSnapshot();
      const questId = safeString(row.quest_id, 1, 80);
      const status = safeString(row.status, 1, 20);
      if (Object.hasOwn(quests, questId) || !QUEST_STATUSES.has(status)) failSnapshot();
      quests[questId] = {
        status,
        progress:safeInteger(row.progress, 0),
        acceptedAt:safeNullableString(row.accepted_at, 80),
        completedAt:safeNullableString(row.completed_at, 80),
      };
    }

    const appearance = {
      shirt:safeString(preferences.shirt_color, 1, 32),
      pants:safeString(preferences.pants_color, 1, 32),
      hair:safeString(preferences.hair_color, 1, 32),
      hairStyle:safeString(preferences.hair_style, 1, 32),
      skin:safeString(preferences.skin_color, 1, 32),
      accessory:safeString(preferences.accessory, 1, 32),
    };
    const bgmVolume = safeInteger(preferences.bgm_volume, 0, 100);
    const sfxVolume = safeInteger(preferences.sfx_volume, 0, 100);
    if (typeof preferences.bgm_enabled !== 'boolean'
      || typeof preferences.sfx_enabled !== 'boolean'
      || !isPlainObject(preferences.tutorial_acknowledgements)) {
      failSnapshot();
    }
    const tutorialAcknowledgements = clonePlainJson(preferences.tutorial_acknowledgements);

    const level = safeInteger(core.level, 1, 10);
    const spentSkillPoints = Object.values(skills).reduce((sum, rank) => sum + rank, 0);
    return {
      name:safeString(core.display_name, 1, 20),
      class:className,
      baseStatsVersion:2,
      spec:safeNullableString(core.spec, 40),
      level,
      exp:safeInteger(core.exp, 0),
      gold:safeInteger(core.gold, 0),
      building:safeInteger(core.building, 0),
      hp:safeInteger(core.current_hp, 0),
      maxHp:safeInteger(core.max_hp, 1),
      map:currentMap,
      bossReturnMap,
      finalBossPortalUnlocked:core.final_boss_unlocked,
      appearance,
      costume,
      costumeInventory,
      inventory,
      serverInventoryInstances:inventoryInstances,
      pets,
      activePet,
      equipment,
      weaponUpgrades,
      quests,
      skills,
      skillCooldowns:{},
      combatStatuses:{},
      skillPoints:Math.max(0, (level - 1) * 2 - spentSkillPoints),
      records:{
        answered:0,
        correct:0,
        wrongLog:[],
        pvpWins:safeInteger(core.pvp_wins, 0),
        pvpLosses:safeInteger(core.pvp_losses, 0),
      },
      serverPreferences:{
        appearance:{ ...appearance },
        audio:{
          bgmVolume,
          sfxVolume,
          bgmEnabled:preferences.bgm_enabled,
          sfxEnabled:preferences.sfx_enabled,
        },
        tutorialAcknowledgements,
      },
      serverRevision:revision,
    };
  }

  function requestId(value) {
    if (value === undefined || value === null || value === '') {
      if (!global.crypto?.randomUUID && !globalThis.crypto?.randomUUID) {
        throw new PlayerAuthorityV3Error('INVALID_REQUEST');
      }
      return (global.crypto || globalThis.crypto).randomUUID();
    }
    if (typeof value !== 'string' || !UUID.test(value)) {
      throw new PlayerAuthorityV3Error('INVALID_REQUEST');
    }
    return value;
  }

  function expectedRevision(value) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new PlayerAuthorityV3Error('INVALID_REQUEST');
    }
    return value;
  }

  function create({ client } = {}) {
    if (!client || typeof client.rpc !== 'function') {
      throw new TypeError('player authority v3 requires a Supabase client');
    }

    function resultFromSnapshot(snapshot, outcome) {
      const player = snapshotToLegacyPlayer(snapshot);
      const result = { player, revision:player.serverRevision };
      if (outcome !== undefined) {
        if (!isPlainObject(outcome)) failSnapshot();
        if (typeof outcome.success === 'boolean') {
          result.outcome = Object.freeze({
            success:outcome.success,
            oldTier:safeInteger(outcome.old_tier, 0, 4),
            newTier:safeInteger(outcome.new_tier, 0, 4),
          });
        } else if (typeof outcome.pet_id === 'string') {
          const petId = safeString(outcome.pet_id, 1, 80);
          if (!player.pets.includes(petId) || player.activePet !== petId) failSnapshot();
          result.outcome = Object.freeze({ petId });
        } else {
          failSnapshot();
        }
      }
      return Object.freeze(result);
    }

    async function call(name, args) {
      let result;
      try {
        result = args === undefined
          ? await client.rpc(name)
          : await client.rpc(name, args);
      } catch {
        throw new PlayerAuthorityV3Error('RPC_FAILED');
      }
      if (result?.error) throw new PlayerAuthorityV3Error('RPC_FAILED');
      const data = result?.data;
      if (!isPlainObject(data) || typeof data.ok !== 'boolean' || typeof data.code !== 'string') {
        throw new PlayerAuthorityV3Error('MALFORMED_SNAPSHOT');
      }
      if (!data.ok) {
        let conflictPlayer = null;
        let revision;
        if (data.code === 'REVISION_CONFLICT' && data.snapshot) {
          conflictPlayer = snapshotToLegacyPlayer(data.snapshot);
          revision = conflictPlayer.serverRevision;
        }
        throw new PlayerAuthorityV3Error(
          Object.hasOwn(ERROR_MESSAGES, data.code) ? data.code : 'RPC_FAILED',
          { player:conflictPlayer, revision },
        );
      }
      return resultFromSnapshot(data.snapshot, data.outcome);
    }

    async function createCharacter({ className, appearance, requestId:providedRequestId } = {}) {
      if (!CLASSES.has(className)) throw new PlayerAuthorityV3Error('INVALID_REQUEST');
      const safeAppearance = clonePlainJson(appearance, 2048);
      return call('create_student_character_v3', {
        p_class_name:className,
        p_appearance:safeAppearance,
        p_request_id:requestId(providedRequestId),
      });
    }

    async function loadGame() {
      return call('load_student_game_v3');
    }

    async function savePreferences({
      preferences,
      expectedRevision:providedRevision,
      requestId:providedRequestId,
    } = {}) {
      return call('save_student_preferences_v3', {
        p_preferences:clonePlainJson(preferences),
        p_expected_revision:expectedRevision(providedRevision),
        p_request_id:requestId(providedRequestId),
      });
    }

    async function transitionMap({
      targetMap,
      expectedRevision:providedRevision,
      requestId:providedRequestId,
    } = {}) {
      if (!MAPS.has(targetMap)) throw new PlayerAuthorityV3Error('INVALID_REQUEST');
      return call('transition_student_map_v3', {
        p_target_map:targetMap,
        p_expected_revision:expectedRevision(providedRevision),
        p_request_id:requestId(providedRequestId),
      });
    }

    function actionIdentifier(value, maximum = 80) {
      if (typeof value !== 'string') throw new PlayerAuthorityV3Error('INVALID_REQUEST');
      const length = Array.from(value).length;
      if (length < 1 || length > maximum || /[\u0000-\u001f\u007f-\u009f]/.test(value)) {
        throw new PlayerAuthorityV3Error('INVALID_REQUEST');
      }
      return value;
    }

    async function purchaseItem({ itemId, expectedRevision:revision, requestId:id } = {}) {
      return call('purchase_student_item_v3', {
        p_item_id:actionIdentifier(itemId),
        p_expected_revision:expectedRevision(revision),
        p_request_id:requestId(id),
      });
    }

    async function equipItem({ inventoryId, expectedRevision:revision, requestId:id } = {}) {
      if (typeof inventoryId !== 'string' || !UUID.test(inventoryId)) {
        throw new PlayerAuthorityV3Error('INVALID_REQUEST');
      }
      return call('equip_student_item_v3', {
        p_inventory_id:inventoryId,
        p_expected_revision:expectedRevision(revision),
        p_request_id:requestId(id),
      });
    }

    async function unequipSlot({
      inventoryKind, slot, expectedRevision:revision, requestId:id,
    } = {}) {
      if (!INVENTORY_KINDS.has(inventoryKind) || !EQUIPMENT_SLOTS.has(slot)) {
        throw new PlayerAuthorityV3Error('INVALID_REQUEST');
      }
      return call('unequip_student_slot_v3', {
        p_inventory_kind:inventoryKind,
        p_slot:slot,
        p_expected_revision:expectedRevision(revision),
        p_request_id:requestId(id),
      });
    }

    async function enhanceWeapon({ expectedRevision:revision, requestId:id } = {}) {
      return call('enhance_student_weapon_v3', {
        p_expected_revision:expectedRevision(revision),
        p_request_id:requestId(id),
      });
    }

    async function chooseSpecialization({
      specName, expectedRevision:revision, requestId:id,
    } = {}) {
      return call('choose_student_specialization_v3', {
        p_spec_name:actionIdentifier(specName, 40),
        p_expected_revision:expectedRevision(revision),
        p_request_id:requestId(id),
      });
    }

    async function learnSkill({ skillId, expectedRevision:revision, requestId:id } = {}) {
      return call('learn_student_skill_v3', {
        p_skill_id:actionIdentifier(skillId),
        p_expected_revision:expectedRevision(revision),
        p_request_id:requestId(id),
      });
    }

    async function summonPet({ expectedRevision:revision, requestId:id } = {}) {
      return call('summon_student_pet_v3', {
        p_expected_revision:expectedRevision(revision),
        p_request_id:requestId(id),
      });
    }

    async function setActivePet({
      petId = null, expectedRevision:revision, requestId:id,
    } = {}) {
      if (petId !== null) actionIdentifier(petId);
      return call('set_student_active_pet_v3', {
        p_pet_id:petId,
        p_expected_revision:expectedRevision(revision),
        p_request_id:requestId(id),
      });
    }

    return Object.freeze({
      createCharacter,
      loadGame,
      savePreferences,
      transitionMap,
      purchaseItem,
      equipItem,
      unequipSlot,
      enhanceWeapon,
      chooseSpecialization,
      learnSkill,
      summonPet,
      setActivePet,
    });
  }

  global.YuksamPlayerAuthorityV3 = Object.freeze({
    PlayerAuthorityV3Error,
    snapshotToLegacyPlayer,
    create,
  });
})(window);
