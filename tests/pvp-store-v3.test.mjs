import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const storeUrl = pathToFileURL(
  path.join(root, 'supabase/functions/_shared/pvp-store.mjs'),
);

function fakeClient() {
  const reads = [];
  const rpcCalls = [];
  const rows = {
    player_core_v3:{
      user_id:'00000000-0000-4000-8000-000000000001',
      display_name:'v3학생',
      class_name:'warrior',
      spec:'무기',
      level:4,
      current_hp:2,
      current_map:'town',
      active_pet:null,
      pvp_wins:7,
      pvp_losses:3,
    },
    player_preferences_v3:{
      shirt_color:'#fff',
      pants_color:'#000',
      hair_color:'#333',
      hair_style:'short',
      skin_color:'#ffd5b5',
      accessory:'none',
    },
    player_inventory_v3:[
      {
        item_definition_id:'ironSword',
        inventory_kind:'gear',
        equipped_slot:'weapon',
        enhancement_tier:1,
      },
    ],
    player_skills_v3:[
      { skill_id:'warrior_basic_strike', rank:1 },
    ],
    pvp_presence_v1:{
      user_id:'00000000-0000-4000-8000-000000000001',
      map:'town',
      busy:false,
      public_profile:{ name:'v3학생' },
      last_seen_at:'2026-07-26T00:00:00.000Z',
    },
  };

  function result(table, single) {
    const value = rows[table] ?? (single ? null : []);
    return { data:value, error:null };
  }

  function from(table) {
    reads.push(table);
    const query = {
      select() { return query; },
      eq() { return query; },
      in() { return query; },
      is() { return query; },
      neq() { return query; },
      or() { return query; },
      limit() { return query; },
      maybeSingle:async () => result(table, true),
      single:async () => result(table, true),
      then(resolve, reject) {
        return Promise.resolve(result(table, false)).then(resolve, reject);
      },
    };
    return query;
  }

  return {
    client:{
      from,
      async rpc(name, args) {
        rpcCalls.push({ name, args });
        return {
          data:name === 'private_submit_pvp_round_v3'
            ? { waiting:false, resolver:true, round:2 }
            : true,
          error:null,
        };
      },
    },
    reads,
    rpcCalls,
  };
}

test('PvP store builds profiles only from v3 server rows', async () => {
  const { createSupabasePvpStore } = await import(storeUrl.href);
  const { client, reads } = fakeClient();
  const store = createSupabasePvpStore(client);

  const profile = await store.getAuthoritativeProfile(
    '00000000-0000-4000-8000-000000000001',
  );

  assert.equal(reads.includes('player_profiles_v2'), false);
  assert.deepEqual(
    new Set(reads),
    new Set([
      'player_core_v3',
      'player_inventory_v3',
      'player_skills_v3',
      'player_preferences_v3',
    ]),
  );
  assert.equal(profile.name, 'v3학생');
  assert.equal(profile.map, 'town');
  assert.equal(profile.attack, 17);
  assert.equal(profile.maxHp, 37);
  assert.deepEqual(profile.skills, { warrior_basic_strike:1 });
  assert.equal(profile.wins, 7);
  assert.equal(profile.losses, 3);
});

test('public PvP profile uses v3 win and loss counters', async () => {
  const { createSupabasePvpStore } = await import(storeUrl.href);
  const { client, reads } = fakeClient();
  const store = createSupabasePvpStore(client);

  const profile = await store.getPublicProfile(
    '00000000-0000-4000-8000-000000000001',
  );

  assert.equal(profile.wins, 7);
  assert.equal(profile.losses, 3);
  assert.equal(reads.includes('pvp_records_v1'), false);
});

test('round input crosses only the locked v3 submission RPC', async () => {
  const { createSupabasePvpStore } = await import(storeUrl.href);
  const { client, rpcCalls } = fakeClient();
  const store = createSupabasePvpStore(client);

  const result = await store.submitRoundInput({
    matchId:'00000000-0000-4000-8000-000000000010',
    round:2,
    userId:'00000000-0000-4000-8000-000000000001',
    requestId:'00000000-0000-4000-8000-000000000020',
    actionId:'warrior_basic_strike',
    answer:'5',
  });

  assert.deepEqual(result, { waiting:false, resolver:true, round:2 });
  assert.deepEqual(rpcCalls, [{
    name:'private_submit_pvp_round_v3',
    args:{
      p_user_id:'00000000-0000-4000-8000-000000000001',
      p_match_id:'00000000-0000-4000-8000-000000000010',
      p_round_no:2,
      p_request_id:'00000000-0000-4000-8000-000000000020',
      p_action_id:'warrior_basic_strike',
      p_answer:'5',
    },
  }]);
});
