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
const hallAndNameplateMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/202608270004_hall_of_fame_and_teacher_nameplates_v1.sql'),
  'utf8',
);
const raidPauseMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/202608110001_teacher_raid_pause_v1.sql'),
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
  assert.match(source, /raidAdvance/);
  assert.match(source, /raidPause/);
  assert.match(source, /\.eq\(['"]user_id['"], userId\)/);
});

test('dungeon pause is server-only and preserves the remaining question time', () => {
  assert.match(source, /private_teacher_toggle_raid_pause_v1/);
  assert.match(raidPauseMigration, /phase = 'paused'/);
  assert.match(raidPauseMigration, /teacher_paused_remaining_ms/);
  assert.match(raidPauseMigration, /question_deadline = case[\s\S]*?milliseconds/i);
  assert.match(raidPauseMigration, /version = version \+ 1/g);
  assert.match(raidPauseMigration, /revoke all[\s\S]*?from public, anon, authenticated/i);
  assert.match(raidPauseMigration, /grant execute[\s\S]*?to service_role/i);
});

test('dungeon progress cheat advances progress and grants only milestone cosmetics', () => {
  assert.match(source, /private_teacher_advance_raid_progress_v1/);
  assert.match(hallAndNameplateMigration, /top_group = least\(7, public\.raid_progress_v1\.top_group \+ 1\)/i);
  assert.match(hallAndNameplateMigration, /create table if not exists public\.raid_nameplate_grants_v1/i);
  assert.match(hallAndNameplateMigration, /values \(2::smallint\), \(4::smallint\), \(7::smallint\)/i);
  assert.match(hallAndNameplateMigration, /on conflict \(user_id, floor_group\) do nothing/i);
  assert.match(hallAndNameplateMigration, /'raidNameplates'[\s\S]*'nameplate'[\s\S]*'newNameplates'/i);
  assert.doesNotMatch(
    hallAndNameplateMigration.match(/create or replace function public\.private_teacher_advance_raid_progress_v1[\s\S]*?\$\$;/i)?.[0] || '',
    /raid_reward_claims_v1|raidRewardVersion|v_reward_exp|exp_reward|gold_reward|building_reward/i,
  );
  assert.match(hallAndNameplateMigration, /revoke all on table public\.raid_nameplate_grants_v1[\s\S]*public, anon, authenticated/i);
  assert.match(hallAndNameplateMigration, /grant select, insert on table public\.raid_nameplate_grants_v1[\s\S]*to service_role/i);
  assert.match(hallAndNameplateMigration, /revoke all[\s\S]*private_teacher_advance_raid_progress_v1[\s\S]*authenticated/i);
  assert.match(hallAndNameplateMigration, /grant execute[\s\S]*private_teacher_advance_raid_progress_v1[\s\S]*service_role/i);
  assert.match(source, /const RAID_NAMEPLATES = new Set/);
  assert.match(source, /snapshot:\{ raidTopGroup, raidNameplates, nameplate:\{ theme:nameplateTheme \} \}/);
  assert.match(source, /newNameplates/);
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
