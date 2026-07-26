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
  assert.match(sql, /monster_attack\s+integer\s+not\s+null[\s\S]*?between\s+0\s+and\s+100000/i);
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

test('combat store functions are callable only by the trusted service role', () => {
  const sql = migration();
  const functions = [
    ['private_start_student_combat_v3', 'uuid, text, bigint, jsonb, text'],
    ['private_prepare_student_combat_turn_v3', 'uuid, uuid, bigint, text'],
    ['private_commit_student_combat_turn_v3', 'uuid, bigint, bigint, text, jsonb'],
    ['private_surrender_student_combat_v3', 'uuid, bigint, text'],
    ['private_resume_student_combat_v3', 'uuid'],
  ];
  assert.match(sql, /auth\.jwt\(\)\s*->>\s*'role'[\s\S]{0,80}?'service_role'/i);
  for (const [name, signature] of functions) {
    const definition = sql.match(
      new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}[\\s\\S]*?\\$\\$;`, 'i'),
    )?.[0] || '';
    assert.match(definition, /security\s+definer/i, `${name} must be security definer`);
    assert.match(definition, /set\s+search_path\s*=\s*''/i, `${name} must lock its search path`);
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

test('combat start validates map and catalog, owns the question secret, and is idempotent', () => {
  const sql = migration();
  const body = sql.match(
    /create\s+or\s+replace\s+function\s+public\.private_start_student_combat_v3[\s\S]*?as\s+\$\$([\s\S]*?)\$\$;/i,
  )?.[1] || '';
  assert.match(body, /private_require_service_role_v3\s*\(\s*\)/i);
  assert.match(body, /pg_advisory_xact_lock/i);
  assert.match(body, /game_action_receipts_v3[\s\S]*?action_name/i);
  assert.match(body, /from\s+public\.player_core_v3[\s\S]*?for\s+update/i);
  assert.match(body, /from\s+public\.game_monster_catalog_v3/i);
  assert.match(body, /current_map[\s\S]*?map_name/i);
  assert.match(body, /private_pick_combat_question_v3/i);
  assert.match(sql, /shared_state_v2[\s\S]*?key\s*=\s*'workbooks'/i);
  assert.match(sql, /jsonb_array_elements/i);
  assert.match(body, /insert\s+into\s+public\.player_combat_question_secrets_v3/i);
  assert.match(body, /answer_key/i);
  assert.match(body, /private_build_safe_combat_session_v3/i);
  assert.doesNotMatch(body, /jsonb_build_object\([^;]{0,500}'answer(?:_key|Key)'/i);
});

test('turn prepare and commit bind question, player, and session revisions', () => {
  const sql = migration();
  const prepare = sql.match(
    /create\s+or\s+replace\s+function\s+public\.private_prepare_student_combat_turn_v3[\s\S]*?as\s+\$\$([\s\S]*?)\$\$;/i,
  )?.[1] || '';
  assert.match(prepare, /p_question_token/i);
  assert.match(prepare, /p_expected_session_revision/i);
  assert.match(prepare, /player_combat_question_secrets_v3/i);
  assert.match(prepare, /private_read_combatant_v3/i);
  assert.match(sql, /private_read_combatant_v3[\s\S]*?player_skills_v3/i);
  assert.match(sql, /private_read_combatant_v3[\s\S]*?player_inventory_v3/i);
  assert.match(sql, /private_read_combatant_v3[\s\S]*?player_pets_v3/i);
  assert.match(prepare, /for\s+update/i);
  assert.match(prepare, /PLAYER_REVISION_CONFLICT|SESSION_REVISION_CONFLICT/i);

  const commit = sql.match(
    /create\s+or\s+replace\s+function\s+public\.private_commit_student_combat_turn_v3[\s\S]*?as\s+\$\$([\s\S]*?)\$\$;/i,
  )?.[1] || '';
  assert.match(commit, /octet_length\s*\(\s*p_outcome::text\s*\)\s*>\s*65536/i);
  assert.match(commit, /p_expected_player_revision/i);
  assert.match(commit, /p_expected_session_revision/i);
  assert.match(commit, /for\s+update/i);
  assert.match(commit, /game_action_receipts_v3/i);
  assert.match(commit, /player_question_stats_v3/i);
  assert.match(commit, /player_wrong_answers_v3/i);
  assert.match(commit, /delete\s+from\s+public\.player_wrong_answers_v3[\s\S]*?offset\s+30/i);
  assert.match(commit, /game_monster_catalog_v3[\s\S]*?exp_reward[\s\S]*?gold_reward/i);
  assert.match(
    commit,
    /v_kind\s*=\s*'victory'[\s\S]*?v_session\.turn_number[\s\S]*?v_session\.turn_number\s*\+\s*1/i,
    'victory must allow either an immediate hit or the server-owned end-of-round damage tick',
  );
  assert.match(commit, /revision\s*=\s*revision\s*\+\s*1/i);
  assert.match(commit, /delete\s+from\s+public\.player_combat_sessions_v3/i);
});

test('resume is safe and surrender cannot award a victory', () => {
  const sql = migration();
  const resume = sql.match(
    /create\s+or\s+replace\s+function\s+public\.private_resume_student_combat_v3[\s\S]*?as\s+\$\$([\s\S]*?)\$\$;/i,
  )?.[1] || '';
  assert.match(resume, /private_build_safe_combat_session_v3/i);
  assert.doesNotMatch(resume, /answer_key/i);

  const surrender = sql.match(
    /create\s+or\s+replace\s+function\s+public\.private_surrender_student_combat_v3[\s\S]*?as\s+\$\$([\s\S]*?)\$\$;/i,
  )?.[1] || '';
  assert.match(surrender, /pg_advisory_xact_lock/i);
  assert.match(surrender, /session_revision/i);
  assert.match(surrender, /update\s+public\.player_core_v3[\s\S]*?current_hp\s*=\s*least\(\s*current_hp\s*,\s*v_session\.player_hp\s*\)/i);
  assert.match(surrender, /private_build_student_snapshot_v3/i);
  assert.match(surrender, /delete\s+from\s+public\.player_combat_sessions_v3/i);
  assert.doesNotMatch(surrender, /(?:gold|building|exp)\s*=\s*(?:gold|building|exp)\s*\+/i);
});

test('expired combat persists the last server-owned hp before deleting the session', () => {
  const sql = migration();
  const resume = sql.match(
    /create\s+or\s+replace\s+function\s+public\.private_resume_student_combat_v3[\s\S]*?as\s+\$\$([\s\S]*?)\$\$;/i,
  )?.[1] || '';
  assert.match(resume, /for\s+update/i);
  assert.match(resume, /update\s+public\.player_core_v3[\s\S]*?current_hp\s*=\s*least\(\s*current_hp\s*,\s*v_session\.player_hp\s*\)/i);
  assert.match(resume, /private_build_student_snapshot_v3/i);
});

test('combat start rejects stale projections and incompatible active monsters', () => {
  const sql = migration();
  const start = sql.match(
    /create\s+or\s+replace\s+function\s+public\.private_start_student_combat_v3[\s\S]*?as\s+\$\$([\s\S]*?)\$\$;/i,
  )?.[1] || '';
  assert.match(start, /p_expected_player_revision/i);
  assert.match(start, /v_core\.revision\s*<>\s*p_expected_player_revision/i);
  assert.match(start, /v_session\.monster_key\s*<>\s*p_monster_key[\s\S]*?COMBAT_ALREADY_ACTIVE/i);
});
