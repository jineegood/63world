import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const migrationPath = join(
  root,
  'supabase',
  'migrations',
  '202607280003_authoritative_combat_escape_v3.sql',
);

function migration() {
  assert.equal(existsSync(migrationPath), true, 'escape migration must exist');
  return readFileSync(migrationPath, 'utf8');
}

function functionBody(sql, name) {
  return sql.match(
    new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}[\\s\\S]*?as\\s+\\$\\$([\\s\\S]*?)\\$\\$;`, 'i'),
  )?.[1] || '';
}

test('escape migration stores the one-failure lock in the private combat session', () => {
  const sql = migration();
  assert.match(
    sql,
    /alter\s+table\s+public\.player_combat_sessions_v3[\s\S]*?add\s+column\s+if\s+not\s+exists\s+escape_failed\s+boolean\s+not\s+null\s+default\s+false/i,
  );
  assert.match(
    sql,
    /private_build_safe_combat_session_v3[\s\S]*?'escapeFailed'\s*,\s*s\.escape_failed/i,
  );
  assert.doesNotMatch(sql, /grant\s+(?:select|insert|update|delete|all)[^;]*player_combat_sessions_v3[^;]*authenticated/i);
});

test('escape prepare binds the authenticated owner, revision, and idempotency receipt', () => {
  const sql = migration();
  const body = functionBody(sql, 'private_prepare_student_combat_escape_v3');

  assert.match(body, /private_require_service_role_v3\s*\(\s*\)/i);
  assert.match(body, /p_user_id/i);
  assert.match(body, /p_expected_session_revision/i);
  assert.match(body, /p_request_id/i);
  assert.match(body, /game_action_receipts_v3/i);
  assert.match(body, /where\s+s\.user_id\s*=\s*p_user_id[\s\S]*?for\s+update/i);
  assert.match(body, /SESSION_REVISION_CONFLICT/i);
  assert.match(body, /PLAYER_REVISION_CONFLICT/i);
  assert.match(body, /private_read_combatant_v3/i);
});

test('escape commit rechecks both revisions and accepts only bounded server outcomes', () => {
  const sql = migration();
  const body = functionBody(sql, 'private_commit_student_combat_escape_v3');

  assert.match(body, /p_expected_session_revision/i);
  assert.match(body, /p_expected_player_revision/i);
  assert.match(body, /for\s+update/i);
  assert.match(body, /v_session\.session_revision\s*<>\s*p_expected_session_revision/i);
  assert.match(body, /v_core\.revision\s*<>\s*p_expected_player_revision/i);
  assert.match(body, /v_kind\s+not\s+in\s*\(\s*'continue'\s*,\s*'escaped'\s*,\s*'victory'\s*,\s*'defeat'\s*\)/i);
  assert.match(body, /escape_failed\s*=\s*true/i);
  assert.match(body, /delete\s+from\s+public\.player_combat_sessions_v3/i);
  assert.match(body, /game_action_receipts_v3/i);
  assert.doesNotMatch(body, /player_question_stats_v3|player_wrong_answers_v3/i);
});

test('escape RPCs are callable only by the trusted service role', () => {
  const sql = migration();
  const functions = [
    ['private_prepare_student_combat_escape_v3', 'uuid, bigint, text'],
    ['private_commit_student_combat_escape_v3', 'uuid, bigint, bigint, text, jsonb'],
  ];
  for (const [name, signature] of functions) {
    const definition = sql.match(
      new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}[\\s\\S]*?\\$\\$;`, 'i'),
    )?.[0] || '';
    assert.match(definition, /security\s+definer/i);
    assert.match(definition, /set\s+search_path\s*=\s*''/i);
    assert.match(
      sql,
      new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${name}\\(${signature}\\)\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`, 'i'),
    );
    assert.match(
      sql,
      new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\(${signature}\\)\\s+to\\s+service_role`, 'i'),
    );
  }
});
