import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const modulePath = path.join(root, 'src/player-authority-v3.js');

function loadApi() {
  assert.ok(fs.existsSync(modulePath), 'player authority v3 browser module must exist');
  const source = fs.readFileSync(modulePath, 'utf8');
  const window = {};
  vm.runInNewContext(source, {
    window,
    crypto: crypto.webcrypto,
    structuredClone,
    Object,
    Array,
    Number,
    String,
    Boolean,
    JSON,
    Error,
    TypeError,
  }, { filename:'src/player-authority-v3.js' });
  return window.YuksamPlayerAuthorityV3;
}

function validSnapshot(overrides = {}) {
  const base = {
    core:{
      display_name:'별빛',
      class_name:'mage',
      spec:null,
      level:3,
      exp:42,
      gold:75,
      building:2,
      current_hp:18,
      max_hp:22,
      current_map:'forest',
      pvp_wins:4,
      pvp_losses:1,
      revision:7,
    },
    inventory:[
      {
        id:'11111111-1111-4111-8111-111111111111',
        item_definition_id:'training_staff',
        enhancement_tier:0,
        equipped_slot:'weapon',
      },
      {
        id:'22222222-2222-4222-8222-222222222222',
        item_definition_id:'noviceHat',
        enhancement_tier:2,
        equipped_slot:null,
      },
    ],
    skills:[{ skill_id:'mage_fireball', rank:2 }],
    quests:[{
      quest_id:'mushroom_hunt',
      status:'active',
      progress:3,
      accepted_at:'2026-07-26T00:00:00Z',
      completed_at:null,
    }],
    pets:['chick'],
    active_pet:'chick',
    preferences:{
      shirt_color:'#123456',
      pants_color:'#234567',
      hair_color:'#345678',
      hair_style:'short',
      skin_color:'#f1d2b6',
      accessory:'none',
      bgm_volume:55,
      sfx_volume:65,
      bgm_enabled:true,
      sfx_enabled:false,
      tutorial_acknowledgements:{ movement:true },
    },
    revision:7,
  };
  return {
    ...base,
    ...overrides,
    core:{ ...base.core, ...(overrides.core || {}) },
    preferences:{ ...base.preferences, ...(overrides.preferences || {}) },
  };
}

function setup(responses) {
  const api = loadApi();
  const calls = [];
  let index = 0;
  const client = {
    async rpc(name, args) {
      calls.push([name, args]);
      const result = responses[Math.min(index, responses.length - 1)];
      index += 1;
      return typeof result === 'function' ? result(name, args) : result;
    },
  };
  return { api, service:api.create({ client }), calls };
}

test('createCharacter sends only class, appearance, and request id then returns a safe game player', async () => {
  const snapshot = validSnapshot();
  const { service, calls } = setup([{ data:{ ok:true, code:'OK', snapshot }, error:null }]);
  const appearance = {
    shirt:'#123456',
    pants:'#234567',
    hair:'#345678',
    hairStyle:'short',
    skin:'#f1d2b6',
    accessory:'none',
  };

  const result = await service.createCharacter({
    className:'mage',
    appearance,
    requestId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  });

  assert.equal(JSON.stringify(calls), JSON.stringify([[
    'create_student_character_v3',
    {
      p_class_name:'mage',
      p_appearance:appearance,
      p_request_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    },
  ]]));
  assert.equal(result.revision, 7);
  assert.equal(result.player.name, '별빛');
  assert.equal(result.player.class, 'mage');
  assert.equal(result.player.gold, 75);
  assert.equal(result.player.equipment.weapon, 'training_staff');
  assert.equal(Object.hasOwn(result.player, 'x'), false);
  assert.equal(Object.hasOwn(result.player, 'y'), false);
});

test('loadGame calls the no-argument RPC and converts inventory, skills, quests, and preferences', async () => {
  const { service, calls } = setup([{
    data:{ ok:true, code:'OK', snapshot:validSnapshot() },
    error:null,
  }]);

  const result = await service.loadGame();

  assert.equal(JSON.stringify(calls), JSON.stringify([['load_student_game_v3', undefined]]));
  assert.equal(JSON.stringify(result.player.inventory), JSON.stringify(['training_staff', 'noviceHat']));
  assert.equal(result.player.weaponUpgrades.noviceHat, 2);
  assert.equal(result.player.skills.mage_fireball, 2);
  assert.equal(result.player.quests.mushroom_hunt.progress, 3);
  assert.equal(result.player.appearance.shirt, '#123456');
  assert.equal(result.player.serverPreferences.audio.sfxEnabled, false);
  assert.equal(result.player.records.pvpWins, 4);
  assert.equal(result.player.records.pvpLosses, 1);
});

test('preference and map mutations generate request ids and send revision-bound payloads', async () => {
  const snapshot = validSnapshot({ core:{ revision:8 }, revision:8 });
  const { service, calls } = setup([
    { data:{ ok:true, code:'OK', snapshot }, error:null },
    { data:{ ok:true, code:'OK', snapshot }, error:null },
  ]);
  const preferences = {
    audio:{ bgmVolume:30, sfxVolume:40, bgmEnabled:true, sfxEnabled:true },
  };

  await service.savePreferences({ preferences, expectedRevision:7 });
  await service.transitionMap({ targetMap:'town', expectedRevision:8 });

  assert.equal(calls[0][0], 'save_student_preferences_v3');
  assert.equal(JSON.stringify(calls[0][1].p_preferences), JSON.stringify(preferences));
  assert.equal(calls[0][1].p_expected_revision, 7);
  assert.match(calls[0][1].p_request_id, /^[0-9a-f-]{36}$/i);
  assert.equal(calls[1][0], 'transition_student_map_v3');
  assert.equal(calls[1][1].p_target_map, 'town');
  assert.equal(calls[1][1].p_expected_revision, 8);
  assert.match(calls[1][1].p_request_id, /^[0-9a-f-]{36}$/i);
  assert.notEqual(calls[0][1].p_request_id, calls[1][1].p_request_id);
});

test('stable server rejections become sanitized authority errors with conflict snapshots', async () => {
  const snapshot = validSnapshot({ core:{ revision:9 }, revision:9 });
  const { service } = setup([{
    data:{ ok:false, code:'REVISION_CONFLICT', snapshot },
    error:null,
  }]);

  await assert.rejects(
    service.transitionMap({
      targetMap:'town',
      expectedRevision:7,
      requestId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    }),
    (error) => error.name === 'PlayerAuthorityV3Error'
      && error.code === 'REVISION_CONFLICT'
      && error.revision === 9
      && error.player?.map === 'forest'
      && !JSON.stringify(error).includes('bbbbbbbb'),
  );
});

test('network errors and malformed snapshots fail closed without leaking backend details', async () => {
  const network = setup([{
    data:null,
    error:{ code:'42501', message:'secret database policy detail' },
  }]).service;
  await assert.rejects(
    network.loadGame(),
    (error) => error.code === 'RPC_FAILED'
      && !error.message.includes('secret')
      && !JSON.stringify(error).includes('42501'),
  );

  const malformed = setup([{
    data:{ ok:true, code:'OK', snapshot:validSnapshot({ core:{ gold:-1 } }) },
    error:null,
  }]).service;
  await assert.rejects(
    malformed.loadGame(),
    (error) => error.code === 'MALFORMED_SNAPSHOT',
  );
});

test('snapshot conversion discards unknown server fields and returns independent mutable values', () => {
  const api = loadApi();
  const source = validSnapshot({
    secret_answer:'must-disappear',
    core:{ internal_note:'must-disappear' },
  });

  const first = api.snapshotToLegacyPlayer(source);
  const second = api.snapshotToLegacyPlayer(source);
  first.inventory.push('local-only');
  first.appearance.shirt = '#ffffff';

  assert.equal(Object.hasOwn(first, 'secret_answer'), false);
  assert.equal(Object.hasOwn(first, 'internal_note'), false);
  assert.equal(second.inventory.includes('local-only'), false);
  assert.equal(second.appearance.shirt, '#123456');
  assert.equal(source.inventory.length, 2);
  assert.equal(source.preferences.shirt_color, '#123456');
});

test('snapshot conversion separates gear and costume slots by authoritative inventory kind', () => {
  const api = loadApi();
  const snapshot = validSnapshot({
    inventory:[
      {
        id:'11111111-1111-4111-8111-111111111111',
        item_definition_id:'training_staff',
        inventory_kind:'gear',
        enhancement_tier:1,
        equipped_slot:'weapon',
      },
      {
        id:'22222222-2222-4222-8222-222222222222',
        item_definition_id:'cs_starryRobe',
        inventory_kind:'costume',
        enhancement_tier:0,
        equipped_slot:'armor',
      },
    ],
  });

  const player = api.snapshotToLegacyPlayer(snapshot);
  assert.equal(JSON.stringify(player.inventory), JSON.stringify(['training_staff']));
  assert.equal(JSON.stringify(player.costumeInventory), JSON.stringify(['cs_starryRobe']));
  assert.equal(JSON.stringify(player.equipment), JSON.stringify({
    weapon:'training_staff', head:null, armor:null, accessory:null,
  }));
  assert.equal(JSON.stringify(player.costume), JSON.stringify({ armor:'cs_starryRobe' }));
  assert.equal(player.serverInventoryInstances[1].inventoryKind, 'costume');
});

test('economy methods send only action identifiers, revisions, and request ids', async () => {
  const snapshot = validSnapshot({ core:{ revision:8 }, revision:8 });
  const ok = { data:{ ok:true, code:'OK', snapshot }, error:null };
  const { service, calls } = setup([ok, ok, ok, ok, ok, ok]);
  const requestIds = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
    '55555555-5555-4555-8555-555555555555',
    '66666666-6666-4666-8666-666666666666',
  ];

  await service.purchaseItem({ itemId:'noviceHat', expectedRevision:7, requestId:requestIds[0] });
  await service.equipItem({ inventoryId:requestIds[1], expectedRevision:8, requestId:requestIds[1] });
  await service.unequipSlot({ inventoryKind:'gear', slot:'head', expectedRevision:8, requestId:requestIds[2] });
  await service.enhanceWeapon({ expectedRevision:8, requestId:requestIds[3] });
  await service.chooseSpecialization({ specName:'냉기', expectedRevision:8, requestId:requestIds[4] });
  await service.learnSkill({ skillId:'mage_frost_focus_v24', expectedRevision:8, requestId:requestIds[5] });

  assert.equal(JSON.stringify(calls), JSON.stringify([
    ['purchase_student_item_v3', { p_item_id:'noviceHat', p_expected_revision:7, p_request_id:requestIds[0] }],
    ['equip_student_item_v3', { p_inventory_id:requestIds[1], p_expected_revision:8, p_request_id:requestIds[1] }],
    ['unequip_student_slot_v3', { p_inventory_kind:'gear', p_slot:'head', p_expected_revision:8, p_request_id:requestIds[2] }],
    ['enhance_student_weapon_v3', { p_expected_revision:8, p_request_id:requestIds[3] }],
    ['choose_student_specialization_v3', { p_spec_name:'냉기', p_expected_revision:8, p_request_id:requestIds[4] }],
    ['learn_student_skill_v3', { p_skill_id:'mage_frost_focus_v24', p_expected_revision:8, p_request_id:requestIds[5] }],
  ]));
});

test('pet summon and active-pet methods accept only server-owned outcomes and identifiers', async () => {
  const summonSnapshot = validSnapshot({
    core:{ revision:8 },
    revision:8,
    pets:['chick', 'yuksam'],
    active_pet:'yuksam',
  });
  const unequipSnapshot = validSnapshot({
    core:{ revision:9 },
    revision:9,
    pets:['chick', 'yuksam'],
    active_pet:null,
  });
  const summonRequest = '88888888-8888-4888-8888-888888888888';
  const equipRequest = '99999999-9999-4999-8999-999999999999';
  const { service, calls } = setup([
    {
      data:{
        ok:true,
        code:'OK',
        snapshot:summonSnapshot,
        outcome:{ pet_id:'yuksam' },
      },
      error:null,
    },
    { data:{ ok:true, code:'OK', snapshot:unequipSnapshot }, error:null },
  ]);

  const summoned = await service.summonPet({
    expectedRevision:7,
    requestId:summonRequest,
  });
  assert.equal(summoned.outcome.petId, 'yuksam');
  assert.equal(summoned.player.activePet, 'yuksam');
  await service.setActivePet({
    petId:null,
    expectedRevision:8,
    requestId:equipRequest,
  });
  assert.equal(JSON.stringify(calls), JSON.stringify([
    ['summon_student_pet_v3', {
      p_expected_revision:7,
      p_request_id:summonRequest,
    }],
    ['set_student_active_pet_v3', {
      p_pet_id:null,
      p_expected_revision:8,
      p_request_id:equipRequest,
    }],
  ]));

  const malformed = setup([{
    data:{
      ok:true,
      code:'OK',
      snapshot:validSnapshot({ pets:['chick'], active_pet:'chick' }),
      outcome:{ pet_id:'yuksam' },
    },
    error:null,
  }]).service;
  await assert.rejects(
    malformed.summonPet({ expectedRevision:7, requestId:summonRequest }),
    (error) => error.code === 'MALFORMED_SNAPSHOT',
  );
});

test('enhancement returns a validated presentation outcome', async () => {
  const snapshot = validSnapshot({ core:{ revision:8 }, revision:8 });
  const { service } = setup([{
    data:{
      ok:true,
      code:'OK',
      snapshot,
      outcome:{ success:false, old_tier:2, new_tier:1 },
    },
    error:null,
  }]);
  const result = await service.enhanceWeapon({
    expectedRevision:7,
    requestId:'77777777-7777-4777-8777-777777777777',
  });
  assert.equal(
    JSON.stringify(result.outcome),
    JSON.stringify({ success:false, oldTier:2, newTier:1 }),
  );
});
