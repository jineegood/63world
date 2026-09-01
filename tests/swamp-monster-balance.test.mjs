import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const game = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/202609010004_swamp_monster_balance_v1.sql'),
  'utf8',
);

test('browser applies requested swamp balance after all existing scaling', () => {
  assert.match(game, /type === 'tarantula'[\s\S]{0,120}hp:1\.10, attack:1\.25/);
  assert.match(game, /type === 'zombie'[\s\S]{0,100}attack:1\.15/);
  assert.match(game, /mapKey === 'swamp'\) applyMonsterBalanceV60\(boss, \{ attack:0\.80 \}\)/);
  assert.match(game, /applyNormalSwampBalanceV60\(applyZoneScaleV42\(monster, 'swamp'\)\)/);
  assert.match(game, /mapKey === 'swamp'\) applyNormalSwampBalanceV60\(guard\)/);
});

test('server combat catalog stores the rounded percentage-adjusted ranges', () => {
  assert.match(migration, /hp_min\s*=\s*68[\s\S]*?hp_max\s*=\s*73[\s\S]*?attack_min\s*=\s*14[\s\S]*?attack_max\s*=\s*16[\s\S]*?monster_key\s*=\s*'swamp_tarantula'/i);
  assert.match(migration, /attack_min\s*=\s*28[\s\S]*?attack_max\s*=\s*32[\s\S]*?monster_key\s*=\s*'swamp_zombie'/i);
  assert.match(migration, /attack_min\s*=\s*23[\s\S]*?attack_max\s*=\s*27[\s\S]*?monster_key\s*=\s*'swamp_elite_zombie'/i);
});

test('real browser produces the final post-scaling swamp values', { timeout:30000 }, () => {
  const script = path.join(root, 'tools/browser-smoke/try_swamp_monster_balance.js');
  const result = spawnSync(process.execPath, [script, root], { encoding:'utf8', timeout:25000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /RESULT: PASS 5 \/ FAIL 0/);
});
