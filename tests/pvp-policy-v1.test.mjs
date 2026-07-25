import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const migrationPath = path.join(root, 'supabase/migrations/202607250001_student_pvp_v1.sql');

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
