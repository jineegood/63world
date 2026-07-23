import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const migrationFile = path.join(root, 'supabase/migrations/202607230002_student_reward_grants_v2.sql');

function sql() {
  assert.ok(fs.existsSync(migrationFile), 'reward grant migration must exist');
  return fs.readFileSync(migrationFile, 'utf8');
}

test('migration creates an additive bounded reward queue with Auth cascades', () => {
  const source = sql();
  assert.match(source, /create table if not exists public\.student_reward_grants_v2/i);
  assert.match(source, /user_id uuid not null references auth\.users\(id\) on delete cascade/i);
  assert.match(source, /created_by uuid not null references auth\.users\(id\)/i);
  for (const field of ['gold', 'building', 'exp']) {
    assert.match(source, new RegExp(`${field} integer not null default 0 check \\(\\s*${field} between 0 and 1000000`, 'i'));
  }
  assert.match(source, /check\s*\(\s*gold\s*>\s*0\s+or\s+building\s*>\s*0\s+or\s+exp\s*>\s*0\s*\)/i);
  assert.match(source, /claimed_at timestamptz/i);
});

test('reward queue is forced RLS with teacher-only table access', () => {
  const source = sql();
  assert.match(source, /alter table public\.student_reward_grants_v2 enable row level security/i);
  assert.match(source, /alter table public\.student_reward_grants_v2 force row level security/i);
  assert.match(source, /revoke all on table public\.student_reward_grants_v2 from anon, authenticated/i);
  assert.match(source, /grant select, insert on table public\.student_reward_grants_v2 to authenticated/i);
  assert.match(source, /for select to authenticated[\s\S]*public\.is_teacher\(\)/i);
  assert.match(source, /for insert to authenticated[\s\S]*public\.is_teacher\(\)[\s\S]*created_by\s*=\s*\(select auth\.uid\(\)\)/i);
  assert.doesNotMatch(source, /create policy\s+"[^"]*students?[^"]*"[\s\S]{0,200}student_reward_grants_v2/i);
});

test('claim RPC targets auth.uid only and atomically claims locked rewards', () => {
  const source = sql();
  assert.match(source, /function public\.claim_student_rewards_v2\(\)/i);
  assert.doesNotMatch(source, /claim_student_rewards_v2\s*\([^)]*user/i);
  assert.match(source, /target_user_id\s+uuid\s*:=\s*auth\.uid\(\)/i);
  assert.match(source, /from public\.player_profiles_v2[\s\S]*for update/i);
  assert.match(source, /where user_id\s*=\s*target_user_id[\s\S]*claimed_at is null[\s\S]*for update/i);
  assert.match(source, /update public\.student_reward_grants_v2[\s\S]*set claimed_at\s*=\s*now\(\)/i);
  assert.match(source, /jsonb_set[\s\S]*'gold'[\s\S]*jsonb_set[\s\S]*'building'[\s\S]*jsonb_set[\s\S]*'exp'/i);
  assert.match(source, /returns jsonb/i);
});

test('claim RPC has a locked search path and authenticated-only execution', () => {
  const source = sql();
  assert.match(source, /security definer[\s\S]*set search_path\s*=\s*''/i);
  assert.match(source, /revoke all on function public\.claim_student_rewards_v2\(\) from public/i);
  assert.match(source, /grant execute on function public\.claim_student_rewards_v2\(\) to authenticated/i);
});
