import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const generator = path.join(root, 'tools/generate-quest-catalog-v3.mjs');
const moduleOutput = path.join(root, 'supabase/functions/_shared/generated-quest-catalog-v3.mjs');
const sqlOutput = path.join(root, 'supabase/generated/quest-catalog-v3.sql');
const migration = path.join(root, 'supabase/migrations/202607260005_server_authoritative_quests_v3.sql');

test('quest catalog generator is deterministic and current', () => {
  const result = spawnSync(process.execPath, [generator, '--check'], {
    cwd:root,
    encoding:'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(fs.existsSync(moduleOutput));
  assert.ok(fs.existsSync(sqlOutput));
});

test('quest catalog preserves all ordered goals and rewards', async () => {
  const version = `${Date.now()}-${Math.random()}`;
  const { QUEST_CATALOG_V3:quests, QUEST_ORDER_V3:order } = await import(
    `${new URL('../supabase/functions/_shared/generated-quest-catalog-v3.mjs', import.meta.url)}?v=${version}`
  );

  assert.equal(order.length, 17);
  assert.equal(order[0], 'tut_equip');
  assert.equal(order.at(-1), 'swamp_king_hunt');
  assert.deepEqual(quests.tut_equip.grantOnAccept, {
    building:0, gold:0, item:'whiteCloak',
  });
  assert.deepEqual(quests.tut_accessory.grantOnAccept, {
    building:5, gold:0, item:null,
  });
  assert.deepEqual(quests.elite_slime_hunt.reward, {
    building:9, exp:18, gold:75, item:'honorCrown',
  });
  assert.deepEqual(quests.elite_snake_hunt.reward, {
    building:15, exp:34, gold:110, item:'starCape',
  });
  assert.deepEqual(quests.mushroom_hunt.event, {
    kind:'monster', target:'forest_mushroom',
  });
  assert.deepEqual(quests.swamp_king_hunt.event, {
    kind:'monster', target:'swamp_elite_zombie',
  });
  assert.deepEqual(quests.tut_healing_well.event, {
    kind:'healing', target:'well',
  });
  assert.deepEqual(quests.tut_costume.event, {
    kind:'questGift', target:'cs_questSproutRibbon',
  });
});

test('quest SQL contains immutable sequence, goals, grants, and rewards', () => {
  const sql = fs.readFileSync(sqlOutput, 'utf8');
  assert.match(sql, /-- quests: 17\b/);
  assert.match(sql, /\('tut_equip',1,'action','equip',1,5,35,0,null,0,0,'whiteCloak'\)/);
  assert.match(sql, /\('tut_healing_well',2,'healing','well',1,3,20,0,null,0,0,null\)/);
  assert.match(sql, /\('mushroom_hunt',3,'monster','forest_mushroom',4,5,40,3,null,0,0,null\)/);
  assert.match(sql, /\('tut_costume',7,'questGift','cs_questSproutRibbon',1,10,35,3,null,0,0,null\)/);
  assert.match(sql, /\('elite_snake_hunt',14,'monster','desert_elite_snake',1,34,110,15,'starCape',0,0,null\)/);
  assert.match(sql, /on conflict \(quest_id\) do update set/i);
});

test('quest migration embeds the exact generated catalog', () => {
  const sql = fs.readFileSync(sqlOutput, 'utf8').trim();
  const migrationSql = fs.readFileSync(migration, 'utf8');
  const embedded = migrationSql.match(
    /-- BEGIN GENERATED QUEST CATALOG V3\r?\n([\s\S]*?)\r?\n-- END GENERATED QUEST CATALOG V3/
  )?.[1]?.trim();
  assert.equal(embedded, sql);
});
