import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const migrationPath = path.join(root, 'supabase/migrations/202607250001_student_pvp_v1.sql');
const hardeningPath = path.join(root, 'supabase/migrations/202607260001_pvp_runtime_hardening_v1.sql');
const roundLockPath = path.join(root, 'supabase/migrations/202607290005_pvp_round_resolution_lock_v2.sql');
const finishCompatibilityPath = path.join(root, 'supabase/migrations/202607300001_pvp_v2_finish_compatibility.sql');

test('PvP storage forces RLS and keeps authoritative tables client read-only', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  for (const table of [
    'pvp_records_v1',
    'pvp_presence_v1',
    'pvp_invites_v1',
    'pvp_matches_v1',
    'pvp_round_inputs_v1',
    'pvp_match_events_v1',
  ]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
    assert.match(sql, new RegExp(`alter table public\\.${table} force row level security`, 'i'));
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from anon, authenticated`, 'i'));
  }
  assert.doesNotMatch(sql, /grant\s+(?:insert|update|delete)[^;]*pvp_records_v1[^;]*authenticated/i);
  assert.doesNotMatch(sql, /grant\s+(?:insert|update|delete)[^;]*pvp_matches_v1[^;]*authenticated/i);
  assert.match(sql, /unique\s*\(\s*match_id\s*,\s*round_no\s*,\s*user_id\s*\)/i);
  assert.match(sql, /unique\s*\(\s*match_id\s*,\s*sequence_no\s*\)/i);
});

test('participants can read only their invitations, matches, and events', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(sql, /auth\.uid\(\)\s*=\s*challenger_id[\s\S]*auth\.uid\(\)\s*=\s*target_id/i);
  assert.match(sql, /auth\.uid\(\)\s*=\s*player_a_id[\s\S]*auth\.uid\(\)\s*=\s*player_b_id/i);
  assert.match(sql, /pvp_match_events_v1[\s\S]*exists\s*\([\s\S]*pvp_matches_v1/i);
  assert.match(sql, /grant select on table public\.pvp_records_v1 to authenticated/i);
});

test('match finishing is service-only, locked, and records one terminal result', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(sql, /create or replace function public\.finish_pvp_match_v1/i);
  assert.match(sql, /security definer[\s\S]*set search_path = ''/i);
  assert.match(sql, /for update/i);
  assert.match(sql, /finished_at is null/i);
  assert.match(sql, /on conflict\s*\(\s*user_id\s*\)\s*do update/i);
  assert.match(sql, /revoke all on function public\.finish_pvp_match_v1[\s\S]*from public/i);
  assert.match(sql, /grant execute on function public\.finish_pvp_match_v1[\s\S]*to service_role/i);
});

test('an additive migration upgrades existing PvP databases and enables realtime tables', () => {
  const sql = fs.readFileSync(hardeningPath, 'utf8');
  assert.match(sql, /alter table public\.pvp_invites_v1[\s\S]*add column if not exists match_id/i);
  assert.match(sql, /alter table public\.pvp_matches_v1[\s\S]*add column if not exists resume_phase/i);
  assert.match(sql, /alter table public\.pvp_matches_v1[\s\S]*add column if not exists paused_question_ms/i);
  for (const table of ['pvp_invites_v1', 'pvp_matches_v1', 'pvp_match_events_v1']) {
    assert.match(sql, new RegExp(`alter publication supabase_realtime add table public\\.${table}`, 'i'));
  }
});

test('round submission uses one service-only database lock and can recover a stalled resolver', () => {
  const sql = fs.readFileSync(roundLockPath, 'utf8');
  assert.match(sql, /add column if not exists resolution_started_at/i);
  assert.match(sql, /create or replace function public\.private_submit_pvp_round_v2/i);
  assert.match(sql, /from public\.pvp_matches_v1[\s\S]*for update/i);
  assert.match(sql, /phase = 'resolving'[\s\S]*interval '15 seconds'/i);
  assert.match(sql, /on conflict\s*\(\s*match_id\s*,\s*round_no\s*,\s*user_id\s*\)\s*do nothing/i);
  assert.match(sql, /grant execute on function public\.private_submit_pvp_round_v2[\s\S]*to service_role/i);
  assert.match(sql, /from anon, authenticated/i);
});

test('recovery PvP finishes against v2 records without depending on retired v3 profiles', () => {
  const sql = fs.readFileSync(finishCompatibilityPath, 'utf8');
  assert.match(sql, /create or replace function public\.finish_pvp_match_v1/i);
  assert.match(sql, /from public\.pvp_matches_v1[\s\S]*for update/i);
  assert.match(sql, /insert into public\.pvp_records_v1/i);
  assert.doesNotMatch(sql, /player_core_v3/i);
  assert.match(sql, /grant execute on function public\.finish_pvp_match_v1[\s\S]*to service_role/i);
});
