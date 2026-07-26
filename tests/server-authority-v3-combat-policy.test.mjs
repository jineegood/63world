import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const migrationPath = path.join(
  root,
  'supabase/migrations/202607260004_server_authoritative_pve_combat_v3.sql',
);

function migration() {
  assert.ok(fs.existsSync(migrationPath), 'authoritative PvE combat migration must exist');
  return fs.readFileSync(migrationPath, 'utf8');
}

const PRIVATE_TABLES = [
  'game_monster_catalog_v3',
  'player_combat_sessions_v3',
  'player_combat_question_secrets_v3',
  'player_question_stats_v3',
  'player_wrong_answers_v3',
];

test('combat migration creates bounded normalized private state', () => {
  const sql = migration();
  for (const table of PRIVATE_TABLES) {
    assert.match(sql, new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?public\\.${table}\\b`, 'i'));
    assert.match(sql, new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, 'i'));
    assert.match(sql, new RegExp(`alter\\s+table\\s+public\\.${table}\\s+force\\s+row\\s+level\\s+security`, 'i'));
    assert.match(sql, new RegExp(`revoke\\s+all\\s+on\\s+table\\s+public\\.${table}\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`, 'i'));
  }

  assert.match(sql, /player_combat_sessions_v3[\s\S]*?user_id\s+uuid\s+primary\s+key/i);
  assert.match(sql, /status\s+text\s+not\s+null[\s\S]*?in\s*\(\s*'active'\s*,\s*'resolved'\s*\)/i);
  assert.match(sql, /session_revision\s+bigint\s+not\s+null[\s\S]*?session_revision\s*>=\s*1/i);
  assert.match(sql, /turn_number\s+integer\s+not\s+null[\s\S]*?between\s+0\s+and\s+10000/i);
  assert.match(sql, /octet_length\s*\(\s*safe_question::text\s*\)\s*<=\s*16384/i);
  assert.match(sql, /octet_length\s*\(\s*player_statuses::text\s*\)\s*<=\s*8192/i);
  assert.match(sql, /octet_length\s*\(\s*cooldowns::text\s*\)\s*<=\s*8192/i);
  assert.match(sql, /player_combat_question_secrets_v3[\s\S]*?references\s+public\.player_combat_sessions_v3\(user_id\)\s+on\s+delete\s+cascade/i);
  assert.match(sql, /answer_key\s+text\s+not\s+null[\s\S]*?char_length\(answer_key\)\s+between\s+1\s+and\s+512/i);
  assert.match(sql, /unique\s*\(\s*question_token\s*\)/i);
  assert.match(sql, /player_wrong_answers_v3[\s\S]*?char_length\(given_answer\)\s+between\s+0\s+and\s+512/i);
});

test('combat and answer tables expose no browser policies or grants', () => {
  const sql = migration();
  for (const table of PRIVATE_TABLES) {
    assert.doesNotMatch(
      sql,
      new RegExp(`grant\\s+(?:select|insert|update|delete|all)[^;]*public\\.${table}[^;]*(?:anon|authenticated)`, 'i'),
      `${table} must not be browser-readable or writable`,
    );
    assert.doesNotMatch(
      sql,
      new RegExp(`create\\s+policy[^;]+on\\s+public\\.${table}[^;]+to\\s+(?:anon|authenticated)`, 'is'),
      `${table} must not have browser policies`,
    );
  }
});

test('student workbook answers are revoked while teacher administration remains', () => {
  const sql = migration();
  assert.match(sql, /drop\s+policy\s+if\s+exists\s+"authenticated users read fixed shared state v2"\s+on\s+public\.shared_state_v2/i);
  assert.match(
    sql,
    /create\s+policy\s+"authenticated users read classroom settings v3"[\s\S]*?for\s+select\s+to\s+authenticated[\s\S]*?using\s*\(\s*key\s*=\s*'classroom_settings'\s*\)/i,
  );
  assert.doesNotMatch(
    sql,
    /for\s+select\s+to\s+authenticated[\s\S]{0,180}?key\s+in\s*\([^)]*'workbooks'/i,
  );
  assert.match(
    sql,
    /create\s+policy\s+"teachers administer shared state for combat v3"[\s\S]*?for\s+all\s+to\s+authenticated[\s\S]*?is_teacher\s*\(\s*\)/i,
  );
});

test('canonical monster catalog seed is embedded and generator-owned', () => {
  const sql = migration();
  assert.match(sql, /-- BEGIN GENERATED COMBAT MONSTER CATALOG V3/);
  assert.match(sql, /-- monsters: 6\b/);
  assert.match(sql, /\('forest_mushroom','forest','mushroom',1,9,11,2,4,1,2,false,false,/);
  assert.match(sql, /-- END GENERATED COMBAT MONSTER CATALOG V3/);
});

test('reset and deletion cascade through every player combat table', () => {
  const sql = migration();
  for (const table of [
    'player_combat_sessions_v3',
    'player_question_stats_v3',
    'player_wrong_answers_v3',
  ]) {
    assert.match(
      sql,
      new RegExp(`${table}[\\s\\S]*?references\\s+public\\.player_core_v3\\(user_id\\)\\s+on\\s+delete\\s+cascade`, 'i'),
    );
  }
  assert.match(sql, /create\s+index\s+if\s+not\s+exists\s+player_wrong_answers_v3_user_created_idx/i);
  assert.match(sql, /create\s+index\s+if\s+not\s+exists\s+player_combat_sessions_v3_expires_idx/i);
});
