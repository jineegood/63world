import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(
  path.join(root, 'supabase/functions/teacher-apply-cheat/index.ts'),
  'utf8',
);
const config = fs.readFileSync(path.join(root, 'supabase/config.toml'), 'utf8');
const raidKillMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/202608090005_teacher_raid_kill_v1.sql'),
  'utf8',
);

test('teacher cheat function verifies the caller and trusts app_metadata only', () => {
  assert.match(source, /Authorization/);
  assert.match(source, /auth\.getUser\(\)/);
  assert.match(source, /app_metadata\?\.role\s*!==\s*['"]teacher['"]/);
  assert.doesNotMatch(source, /user_metadata\?\.role/);
});

test('teacher cheat function accepts a narrow action list and one UUID target', () => {
  assert.match(source, /const UUID\s*=/);
  assert.match(source, /exp20/);
  assert.match(source, /exp100/);
  assert.match(source, /gold3000/);
  assert.match(source, /building200/);
  assert.match(source, /heal/);
  assert.match(source, /raidKill/);
  assert.match(source, /\.eq\(['"]user_id['"], userId\)/);
});

test('dungeon instant kill is teacher-only and becomes one authoritative server round', () => {
  assert.match(source, /private_teacher_kill_raid_monster_v1/);
  assert.match(raidKillMigration, /teacher_kill_round/);
  assert.match(raidKillMigration, /phase\s*=\s*'resolving'/);
  assert.match(raidKillMigration, /raid_round_inputs_v1/);
  assert.match(raidKillMigration, /is_correct/);
  assert.match(raidKillMigration, /revoke all[\s\S]*?from public, anon, authenticated/i);
  assert.match(raidKillMigration, /grant execute[\s\S]*?to service_role/i);
});

test('teacher cheat function keeps service credentials server-side', () => {
  assert.match(source, /Deno\.env\.get\(['"]SUPABASE_SERVICE_ROLE_KEY['"]\)/);
  assert.doesNotMatch(source, /console\.(?:log|error)/);
  assert.match(config, /\[functions\.teacher-apply-cheat\][\s\S]*?verify_jwt\s*=\s*true/);
});
