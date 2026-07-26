import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const migrationPath = path.join(
  root,
  'supabase/migrations/202607260006_server_authoritative_pvp_v3.sql',
);

function sql() {
  return fs.readFileSync(migrationPath, 'utf8');
}

function functionBody(source, name) {
  const pattern = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\b[\\s\\S]*?\\$\\$;`,
    'i',
  );
  return source.match(pattern)?.[0] || '';
}

test('authoritative PvP migration serializes one resolver for each round', () => {
  const source = sql();
  const submit = functionBody(source, 'private_submit_pvp_round_v3');

  assert.match(source, /add\s+column\s+if\s+not\s+exists\s+resolution_started_at\s+timestamptz/i);
  assert.match(source, /phase\s+in\s*\([^)]*'resolving'/i);
  assert.match(submit, /from\s+public\.pvp_matches_v1[\s\S]*for\s+update/i);
  assert.match(submit, /p_user_id\s+not\s+in\s*\(\s*v_match\.player_a_id\s*,\s*v_match\.player_b_id\s*\)/i);
  assert.match(submit, /p_round_no\s*<>\s*v_match\.round_no/i);
  assert.match(submit, /insert\s+into\s+public\.pvp_round_inputs_v1/i);
  assert.match(submit, /on\s+conflict\s*\(\s*match_id\s*,\s*round_no\s*,\s*user_id\s*\)\s+do\s+nothing/i);
  assert.match(submit, /count\(\*\)[\s\S]*pvp_round_inputs_v1/i);
  assert.match(submit, /set\s+phase\s*=\s*'resolving'/i);
  assert.match(submit, /jsonb_build_object\([\s\S]*'resolver'[\s\S]*true/i);
});

test('round submission and finishing remain service-role-only', () => {
  const source = sql();
  assert.match(
    source,
    /revoke\s+all\s+on\s+function\s+public\.private_submit_pvp_round_v3[\s\S]*from\s+public/i,
  );
  assert.match(
    source,
    /revoke\s+all\s+on\s+function\s+public\.private_submit_pvp_round_v3[\s\S]*from\s+anon\s*,\s*authenticated/i,
  );
  assert.match(
    source,
    /grant\s+execute\s+on\s+function\s+public\.private_submit_pvp_round_v3[\s\S]*to\s+service_role/i,
  );
  assert.doesNotMatch(
    source,
    /grant\s+execute\s+on\s+function\s+public\.(?:private_submit_pvp_round_v3|finish_pvp_match_v1)[\s\S]*to\s+authenticated/i,
  );
});

test('finishing locks the match and updates each v3 record exactly once', () => {
  const finish = functionBody(sql(), 'finish_pvp_match_v1');

  assert.match(finish, /where\s+id\s*=\s*_match_id[\s\S]*finished_at\s+is\s+null[\s\S]*for\s+update/i);
  assert.match(finish, /if\s+not\s+found\s+then[\s\S]*return\s+false/i);
  assert.match(finish, /from\s+public\.player_core_v3[\s\S]*for\s+update/i);
  assert.match(
    finish,
    /update\s+public\.player_core_v3[\s\S]*pvp_wins\s*=\s*pvp_wins\s*\+\s*1[\s\S]*revision\s*=\s*revision\s*\+\s*1[\s\S]*where\s+user_id\s*=\s*_winner_id/i,
  );
  assert.match(
    finish,
    /update\s+public\.player_core_v3[\s\S]*pvp_losses\s*=\s*pvp_losses\s*\+\s*1[\s\S]*revision\s*=\s*revision\s*\+\s*1[\s\S]*where\s+user_id\s*=\s*_loser_id/i,
  );
  assert.match(finish, /insert\s+into\s+public\.pvp_records_v1/i);
  assert.match(finish, /update\s+public\.pvp_presence_v1[\s\S]*busy\s*=\s*false/i);

  for (const forbidden of ['exp', 'gold', 'building', 'current_hp', 'max_hp']) {
    assert.doesNotMatch(finish, new RegExp(`\\b${forbidden}\\s*=`, 'i'));
  }
  for (const forbiddenTable of [
    'player_inventory_v3',
    'player_pets_v3',
    'player_quests_v3',
  ]) {
    assert.doesNotMatch(finish, new RegExp(`(?:insert\\s+into|update|delete\\s+from)\\s+public\\.${forbiddenTable}`, 'i'));
  }
});

test('authoritative PvP migration is additive and transactional', () => {
  const source = sql();
  assert.match(source, /^\s*begin\s*;/i);
  assert.match(source, /commit\s*;\s*$/i);
  assert.doesNotMatch(source, /\bdrop\s+table\b/i);
  assert.doesNotMatch(source, /\btruncate\b/i);
});
