import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const generator = path.join(root, 'tools/generate-combat-catalog-v3.mjs');
const moduleOutput = path.join(root, 'supabase/functions/_shared/generated-combat-catalog-v3.mjs');
const sqlOutput = path.join(root, 'supabase/generated/combat-monster-catalog-v3.sql');

test('combat catalog generator is deterministic and current', () => {
  const result = spawnSync(process.execPath, [generator, '--check'], {
    cwd:root,
    encoding:'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(fs.existsSync(moduleOutput));
  assert.ok(fs.existsSync(sqlOutput));
});

test('combat catalog pins current security-relevant balance rules', async () => {
  const version = `${Date.now()}-${Math.random()}`;
  const catalog = await import(`${new URL(`../supabase/functions/_shared/generated-combat-catalog-v3.mjs`, import.meta.url)}?v=${version}`);

  assert.deepEqual(Object.keys(catalog.CLASS_COMBAT_V3).sort(), ['mage', 'priest', 'warrior']);
  assert.equal(Object.keys(catalog.SKILL_COMBAT_V3).length, 42);
  assert.equal(Object.keys(catalog.PET_COMBAT_V3).length, 6);
  assert.ok(Object.keys(catalog.ITEM_COMBAT_V3).length >= 40);
  assert.ok(Object.keys(catalog.MONSTER_COMBAT_V3).length >= 6);

  assert.deepEqual(catalog.CLASS_COMBAT_V3.warrior.baseStats, {
    strength:8, intelligence:2, spirit:3, vitality:4,
  });
  assert.equal(catalog.PET_COMBAT_V3.yuksam.stats.vitality, 8);
  assert.equal(catalog.SKILL_COMBAT_V3.warrior_basic_strike.active.multiplier, 1.8);
  assert.equal(catalog.SKILL_COMBAT_V3.priest_basic_smite.active.healMaxPct, 0.25);
  assert.deepEqual(catalog.XP_REQUIREMENTS_V3, {
    1:10, 2:40, 3:80, 4:130, 5:200, 6:280, 7:370, 8:470, 9:580, 10:700,
  });
  assert.deepEqual(catalog.COMBAT_BALANCE_V3, {
    playerMissChance:0.10,
    monsterMissChance:0.10,
    baseCritChance:0.15,
    basicCritMultiplier:1.5,
    wrongAnswerDamageMultiplier:0.50,
    buildingDropChance:0.10,
    maxWrongLogEntries:30,
    preSpecializationDeathExpLoss:0,
  });

  const mushroom = catalog.MONSTER_COMBAT_V3.forest_mushroom;
  assert.equal(mushroom.map, 'forest');
  assert.deepEqual(mushroom.hp, [9, 11]);
  assert.deepEqual(mushroom.attack, [2, 4], 'the level-1 mushroom keeps its effective 20% attack nerf');
  assert.deepEqual(mushroom.reward, { exp:1, gold:2 });

  const slime = catalog.MONSTER_COMBAT_V3.forest_slime;
  assert.deepEqual(slime.hp, [20, 23], 'the slime keeps its effective 10% health buff');
  assert.deepEqual(slime.reward, { exp:3, gold:4 });
  assert.equal(slime.patterns[0].kind, 'selfShield');
});

test('monster SQL contains the same canonical encounter rows', () => {
  const sql = fs.readFileSync(sqlOutput, 'utf8');
  assert.match(sql, /-- monsters: \d+\b/);
  assert.match(sql, /\('forest_mushroom','forest','mushroom',1,9,11,2,4,1,2,false,false,/);
  assert.match(sql, /\('forest_slime','forest','slime',3,20,23,3,5,3,4,false,false,/);
  assert.match(sql, /on conflict \(monster_key\) do update set/i);
});
