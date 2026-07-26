import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const moduleUrl = pathToFileURL(
  path.join(root, 'supabase/functions/_shared/pvp-snapshot-v3.mjs'),
);

function rows(overrides = {}) {
  return {
    core:{
      user_id:'00000000-0000-4000-8000-000000000001',
      display_name:'안전학생',
      class_name:'warrior',
      spec:'무기',
      level:4,
      current_hp:1,
      active_pet:null,
    },
    inventory:[
      {
        item_definition_id:'ironSword',
        inventory_kind:'gear',
        equipped_slot:'weapon',
        enhancement_tier:1,
      },
      {
        item_definition_id:'questApron',
        inventory_kind:'costume',
        equipped_slot:'armor',
        enhancement_tier:0,
      },
    ],
    skills:[
      { skill_id:'warrior_basic_strike', rank:1 },
      { skill_id:'hacked_skill', rank:20 },
    ],
    preferences:{
      shirt_color:'#ffffff',
      pants_color:'#000000',
      hair_color:'#333333',
      hair_style:'short',
      skin_color:'#ffd5b5',
      accessory:'none',
    },
    ...overrides,
  };
}

test('v3 PvP snapshot derives combat values from canonical rows and starts at full temporary HP', async () => {
  const { buildPvpSnapshotV3 } = await import(moduleUrl.href);
  const snapshot = buildPvpSnapshotV3({
    ...rows(),
    attack:999999,
    defense:999999,
    maxHp:999999,
    callerProfile:{ skills:{ hacked_skill:20 } },
  });

  assert.equal(snapshot.userId, '00000000-0000-4000-8000-000000000001');
  assert.equal(snapshot.name, '안전학생');
  assert.equal(snapshot.maxHp, 37);
  assert.equal(snapshot.hp, 37);
  assert.equal(snapshot.attack, 17);
  assert.equal(snapshot.defense, 3);
  assert.deepEqual(snapshot.skills, { warrior_basic_strike:1 });
  assert.deepEqual(snapshot.cooldowns, {});
  assert.deepEqual(snapshot.statuses, { stun:0, chill:0, shadow:0 });
});

test('v3 PvP snapshot exposes only equipped portrait items and safe appearance fields', async () => {
  const { buildPvpSnapshotV3 } = await import(moduleUrl.href);
  const snapshot = buildPvpSnapshotV3(rows({
    inventory:[
      ...rows().inventory,
      {
        item_definition_id:'ironHelmet',
        inventory_kind:'gear',
        equipped_slot:null,
        enhancement_tier:0,
      },
      {
        item_definition_id:'forgedUnknownItem',
        inventory_kind:'gear',
        equipped_slot:'head',
        enhancement_tier:4,
      },
    ],
    preferences:{
      ...rows().preferences,
      password:'do-not-copy',
      tutorial_acknowledgements:{ pvpTutorialSeen:true },
    },
  }));

  assert.deepEqual(snapshot.equipment, { weapon:'ironSword' });
  assert.deepEqual(snapshot.costume, { armor:'questApron' });
  assert.deepEqual(snapshot.appearance, {
    shirt:'#ffffff',
    pants:'#000000',
    hair:'#333333',
    hairStyle:'short',
    skin:'#ffd5b5',
    accessory:'none',
  });
  assert.equal('password' in snapshot.appearance, false);
  assert.equal('tutorial_acknowledgements' in snapshot.appearance, false);
});

test('v3 PvP snapshot rejects a missing canonical core row', async () => {
  const { buildPvpSnapshotV3 } = await import(moduleUrl.href);
  assert.throws(
    () => buildPvpSnapshotV3(rows({ core:null })),
    /PROFILE_MISSING/,
  );
});
