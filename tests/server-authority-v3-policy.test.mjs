import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const migrationPath = path.join(
  root,
  'supabase/migrations/202607260002_server_authoritative_player_v3.sql',
);
const economyMigrationPath = path.join(
  root,
  'supabase/migrations/202607260003_server_authoritative_economy_v3.sql',
);

function migration() {
  assert.ok(fs.existsSync(migrationPath), 'server-authoritative v3 migration must exist');
  return fs.readFileSync(migrationPath, 'utf8');
}

function economyMigration() {
  assert.ok(fs.existsSync(economyMigrationPath), 'authoritative economy migration must exist');
  return fs.readFileSync(economyMigrationPath, 'utf8');
}

const PLAYER_TABLES = [
  'player_core_v3',
  'player_inventory_v3',
  'player_skills_v3',
  'player_quests_v3',
  'player_preferences_v3',
];

const SERVER_ONLY_TABLES = [
  'game_action_receipts_v3',
  'security_events_v3',
];

test('v3 creates normalized player state with database-enforced value bounds', () => {
  const sql = migration();
  for (const table of [...PLAYER_TABLES, ...SERVER_ONLY_TABLES]) {
    assert.match(
      sql,
      new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?public\\.${table}\\b`, 'i'),
      `${table} must be created`,
    );
  }

  assert.match(sql, /class_name\s+text\s+not\s+null[\s\S]*?in\s*\(\s*'warrior'\s*,\s*'mage'\s*,\s*'priest'\s*\)/i);
  assert.match(sql, /level\s+integer\s+not\s+null[\s\S]*?between\s+1\s+and\s+10/i);
  assert.match(sql, /exp\s+integer\s+not\s+null[\s\S]*?exp\s*>=\s*0/i);
  assert.match(sql, /gold\s+integer\s+not\s+null[\s\S]*?gold\s*>=\s*0/i);
  assert.match(sql, /building\s+integer\s+not\s+null[\s\S]*?building\s*>=\s*0/i);
  assert.match(sql, /current_hp\s+integer\s+not\s+null[\s\S]*?current_hp\s*>=\s*0/i);
  assert.match(sql, /revision\s+bigint\s+not\s+null[\s\S]*?revision\s*>=\s*1/i);
  assert.match(sql, /primary\s+key\s*\(\s*user_id\s*,\s*request_id\s*\)/i);
  assert.match(sql, /unique\s*\(\s*user_id\s*,\s*equipped_slot\s*\)/i);
});

test('students can read only their rows and cannot directly mutate authoritative state', () => {
  const sql = migration();

  for (const table of [...PLAYER_TABLES, ...SERVER_ONLY_TABLES]) {
    assert.match(
      sql,
      new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, 'i'),
    );
    assert.match(
      sql,
      new RegExp(`alter\\s+table\\s+public\\.${table}\\s+force\\s+row\\s+level\\s+security`, 'i'),
    );
  }

  for (const table of PLAYER_TABLES) {
    assert.match(
      sql,
      new RegExp(`create\\s+policy[^;]+on\\s+public\\.${table}[^;]+for\\s+select[^;]+auth\\.uid\\(\\)`, 'is'),
      `${table} must have an own-row SELECT policy`,
    );
    assert.match(
      sql,
      new RegExp(`grant\\s+select\\s+on\\s+table\\s+public\\.${table}\\s+to\\s+authenticated`, 'i'),
    );
  }

  for (const table of ['player_core_v3', 'player_inventory_v3', 'player_skills_v3', 'player_quests_v3']) {
    assert.doesNotMatch(
      sql,
      new RegExp(`grant\\s+(?:insert|update|delete|all)[^;]*public\\.${table}[^;]*authenticated`, 'i'),
      `${table} must never be directly student-writable`,
    );
  }

  for (const table of SERVER_ONLY_TABLES) {
    assert.doesNotMatch(
      sql,
      new RegExp(`create\\s+policy[^;]+on\\s+public\\.${table}[^;]+to\\s+authenticated`, 'is'),
      `${table} must not expose rows to students`,
    );
  }
});

test('preference storage has a narrow harmless shape instead of a free-form player blob', () => {
  const sql = migration();
  const table = sql.match(
    /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.player_preferences_v3\s*\(([\s\S]*?)\n\);/i,
  )?.[1] || '';

  assert.ok(table, 'player_preferences_v3 definition must be readable');
  for (const column of [
    'shirt_color',
    'pants_color',
    'hair_color',
    'hair_style',
    'skin_color',
    'accessory',
    'bgm_volume',
    'sfx_volume',
    'bgm_enabled',
    'sfx_enabled',
    'tutorial_acknowledgements',
  ]) {
    assert.match(table, new RegExp(`\\b${column}\\b`, 'i'));
  }
  assert.match(table, /bgm_volume[\s\S]*?between\s+0\s+and\s+100/i);
  assert.match(table, /sfx_volume[\s\S]*?between\s+0\s+and\s+100/i);
  assert.match(table, /octet_length\s*\(\s*tutorial_acknowledgements::text\s*\)\s*<=\s*8192/i);
  assert.doesNotMatch(table, /\b(?:level|exp|gold|building|inventory|equipment|skills|quests|pvp_wins|pvp_losses)\b/i);
});

test('private helpers are unavailable to browser roles and trust only app metadata for teachers', () => {
  const sql = migration();
  assert.match(sql, /auth\.jwt\(\)\s*->\s*'app_metadata'\s*->>\s*'role'/i);
  assert.doesNotMatch(sql, /auth\.jwt\(\)\s*->\s*'user_metadata'[^;]*role/i);

  for (const helper of [
    'private_is_teacher_v3',
    'private_log_security_event_v3',
    'private_read_receipt_v3',
  ]) {
    assert.match(sql, new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${helper}\\b`, 'i'));
    assert.match(
      sql,
      new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${helper}\\([^;]*from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`, 'i'),
    );
  }
});

test('character creation derives identity and starter values entirely on the server', () => {
  const sql = migration();
  const signature = /create\s+or\s+replace\s+function\s+public\.create_student_character_v3\s*\(\s*p_class_name\s+text\s*,\s*p_appearance\s+jsonb\s*,\s*p_request_id\s+text\s*\)/i;
  assert.match(sql, signature);
  assert.doesNotMatch(sql, /create_student_character_v3\s*\([^)]*\buser_id\b/i);

  const body = sql.match(
    /create\s+or\s+replace\s+function\s+public\.create_student_character_v3[\s\S]*?as\s+\$\$([\s\S]*?)\$\$;/i,
  )?.[1] || '';
  assert.match(body, /auth\.uid\(\)/i);
  assert.match(body, /from\s+public\.player_profiles_v2[\s\S]*?display_name[\s\S]*?for\s+update/i);
  assert.match(body, /p_class_name\s+is\s+null\s+or\s+p_class_name\s+not\s+in\s*\(\s*'warrior'\s*,\s*'mage'\s*,\s*'priest'\s*\)/i);
  assert.match(body, /jsonb_object_keys\s*\([\s\S]*?p_appearance[\s\S]*?\)/i);
  assert.match(body, /insert\s+into\s+public\.player_core_v3/i);
  assert.match(body, /values[\s\S]*?\b1\b[\s\S]*?\b0\b[\s\S]*?\b20\b[\s\S]*?\b0\b/i);
  for (const item of ['training_greatsword', 'training_staff', 'training_book']) {
    assert.match(body, new RegExp(item));
  }
  assert.match(body, /insert\s+into\s+public\.player_inventory_v3/i);
  assert.match(body, /insert\s+into\s+public\.game_action_receipts_v3/i);
});

test('character creation is idempotent and does not replace an existing character', () => {
  const sql = migration();
  const body = sql.match(
    /create\s+or\s+replace\s+function\s+public\.create_student_character_v3[\s\S]*?as\s+\$\$([\s\S]*?)\$\$;/i,
  )?.[1] || '';
  assert.match(body, /private_read_receipt_v3\s*\(\s*v_request_id\s*,\s*'create_student_character_v3'\s*\)/i);
  assert.match(body, /select[\s\S]+from\s+public\.player_core_v3[\s\S]+for\s+update/i);
  assert.match(body, /private_build_student_snapshot_v3\s*\(\s*v_user_id\s*\)/i);
  assert.match(body, /on\s+conflict\s*\(\s*user_id\s*\)\s+do\s+nothing/i);
});

test('snapshot loading returns only the authenticated student normalized state', () => {
  const sql = migration();
  assert.match(sql, /create\s+or\s+replace\s+function\s+public\.load_student_game_v3\s*\(\s*\)/i);
  assert.doesNotMatch(sql, /load_student_game_v3\s*\([^)]*\buser_id\b/i);

  const helper = sql.match(
    /create\s+or\s+replace\s+function\s+public\.private_build_student_snapshot_v3[\s\S]*?as\s+\$\$([\s\S]*?)\$\$;/i,
  )?.[1] || '';
  for (const key of ['core', 'inventory', 'skills', 'quests', 'preferences', 'revision']) {
    assert.match(helper, new RegExp(`'${key}'\\s*,`, 'i'));
  }
  assert.match(helper, /order\s+by\s+i\.item_definition_id\s*,\s*i\.id/i);
  assert.match(helper, /order\s+by\s+s\.skill_id/i);
  assert.match(helper, /order\s+by\s+q\.quest_id/i);

  const loadBody = sql.match(
    /create\s+or\s+replace\s+function\s+public\.load_student_game_v3[\s\S]*?as\s+\$\$([\s\S]*?)\$\$;/i,
  )?.[1] || '';
  assert.match(loadBody, /v_user_id(?:\s+uuid)?\s*:=\s*auth\.uid\(\)/i);
  assert.match(loadBody, /private_build_student_snapshot_v3\s*\(\s*v_user_id\s*\)/i);
  assert.doesNotMatch(loadBody, /player_profiles_v2\.data/i);
});

test('student character RPCs are security definer functions with a locked search path', () => {
  const sql = migration();
  for (const fn of [
    'create_student_character_v3',
    'load_student_game_v3',
    'private_build_student_snapshot_v3',
  ]) {
    const definition = sql.match(
      new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}[\\s\\S]*?\\$\\$;`, 'i'),
    )?.[0] || '';
    assert.match(definition, /security\s+definer/i);
    assert.match(definition, /set\s+search_path\s*=\s*''/i);
  }
  assert.match(sql, /grant\s+execute\s+on\s+function\s+public\.create_student_character_v3\(text,\s*jsonb,\s*text\)\s+to\s+authenticated/i);
  assert.match(sql, /grant\s+execute\s+on\s+function\s+public\.load_student_game_v3\(\)\s+to\s+authenticated/i);
  assert.match(sql, /revoke\s+all\s+on\s+function\s+public\.private_build_student_snapshot_v3\(uuid\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i);
});

test('preference RPC rejects authoritative fields and uses revision plus request replay protection', () => {
  const sql = migration();
  assert.match(
    sql,
    /create\s+or\s+replace\s+function\s+public\.save_student_preferences_v3\s*\(\s*p_preferences\s+jsonb\s*,\s*p_expected_revision\s+bigint\s*,\s*p_request_id\s+text\s*\)/i,
  );
  const body = sql.match(
    /create\s+or\s+replace\s+function\s+public\.save_student_preferences_v3[\s\S]*?as\s+\$\$([\s\S]*?)\$\$;/i,
  )?.[1] || '';

  assert.match(body, /private_read_receipt_v3\s*\(\s*v_request_id\s*,\s*'save_student_preferences_v3'\s*\)/i);
  assert.match(body, /from\s+public\.player_core_v3[\s\S]*?for\s+update/i);
  assert.match(body, /p_expected_revision\s+is\s+distinct\s+from\s+v_current_revision/i);
  assert.match(body, /REVISION_CONFLICT/);
  assert.match(body, /update\s+public\.player_preferences_v3/i);
  assert.match(body, /revision\s*=\s*revision\s*\+\s*1/i);
  assert.match(body, /private_store_receipt_v3\s*\(/i);
  for (const forbidden of [
    'level',
    'exp',
    'gold',
    'building',
    'hp',
    'map',
    'inventory',
    'equipment',
    'skills',
    'quests',
    'records',
    'pvp_wins',
    'pvp_losses',
  ]) {
    assert.match(body, new RegExp(`'${forbidden}'`, 'i'));
  }
});

test('map RPC enforces server-owned map names, edges, and level gates', () => {
  const sql = migration();
  assert.match(
    sql,
    /create\s+or\s+replace\s+function\s+public\.transition_student_map_v3\s*\(\s*p_target_map\s+text\s*,\s*p_expected_revision\s+bigint\s*,\s*p_request_id\s+text\s*\)/i,
  );
  const body = sql.match(
    /create\s+or\s+replace\s+function\s+public\.transition_student_map_v3[\s\S]*?as\s+\$\$([\s\S]*?)\$\$;/i,
  )?.[1] || '';

  for (const map of [
    'town',
    'equipmentShop',
    'buildingShopInterior',
    'petShopInterior',
    'upgradeShopInterior',
    'forest',
    'desert',
    'swamp',
    'bossRoom',
    'finalBossRoom',
  ]) {
    assert.match(body, new RegExp(`'${map}'`));
  }
  assert.match(body, /p_target_map\s*=\s*'desert'[\s\S]*?v_level\s*<\s*4/i);
  assert.match(body, /p_target_map\s*=\s*'swamp'[\s\S]*?v_level\s*<\s*7/i);
  assert.match(body, /p_target_map\s+in\s*\(\s*'bossRoom'\s*,\s*'finalBossRoom'\s*\)[\s\S]*?LOCKED_MAP/i);
  assert.match(body, /p_expected_revision\s+is\s+distinct\s+from\s+v_current_revision/i);
  assert.match(body, /update\s+public\.player_core_v3[\s\S]*?current_map\s*=\s*p_target_map[\s\S]*?revision\s*=\s*revision\s*\+\s*1/i);
});

test('rejected mutations create bounded audit events while successful calls return snapshots', () => {
  const sql = migration();
  for (const fn of ['save_student_preferences_v3', 'transition_student_map_v3']) {
    const body = sql.match(
      new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}[\\s\\S]*?as\\s+\\$\\$([\\s\\S]*?)\\$\\$;`, 'i'),
    )?.[1] || '';
    assert.match(body, /private_log_security_event_v3/i);
    assert.match(body, /private_build_student_snapshot_v3/i);
    assert.match(body, /'ok'\s*,\s*true[\s\S]*?'snapshot'/i);
  }
  assert.match(sql, /create\s+or\s+replace\s+function\s+public\.cleanup_server_authority_v3\s*\(\s*\)/i);
  assert.match(sql, /created_at\s*<\s*now\(\)\s*-\s*interval\s*'7 days'/i);
  assert.match(sql, /created_at\s*<\s*now\(\)\s*-\s*interval\s*'30 days'/i);
  assert.match(sql, /if\s+not\s+public\.private_is_teacher_v3\(\)/i);
});

test('new mutation RPCs are callable only by authenticated users', () => {
  const sql = migration();
  for (const signature of [
    'save_student_preferences_v3\\(jsonb,\\s*bigint,\\s*text\\)',
    'transition_student_map_v3\\(text,\\s*bigint,\\s*text\\)',
  ]) {
    assert.match(
      sql,
      new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${signature}\\s+from\\s+public\\s*,\\s*anon`, 'i'),
    );
    assert.match(
      sql,
      new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${signature}\\s+to\\s+authenticated`, 'i'),
    );
  }
});

test('request ids are validated inside RPCs and serialized across different actions', () => {
  const sql = migration();
  const helper = sql.match(
    /create\s+or\s+replace\s+function\s+public\.private_read_receipt_v3[\s\S]*?as\s+\$\$([\s\S]*?)\$\$;/i,
  )?.[1] || '';
  assert.match(helper, /pg_advisory_xact_lock/i);
  assert.match(helper, /action_name\s+is\s+distinct\s+from\s+p_action_name/i);
  assert.match(helper, /REQUEST_ID_REUSED/i);

  for (const fn of [
    'create_student_character_v3',
    'save_student_preferences_v3',
    'transition_student_map_v3',
  ]) {
    const body = sql.match(
      new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}[\\s\\S]*?as\\s+\\$\\$([\\s\\S]*?)\\$\\$;`, 'i'),
    )?.[1] || '';
    assert.match(body, /p_request_id[\s\S]*?\^\[0-9a-fA-F\]/i);
    assert.match(body, /invalid_request_id/i);
    assert.match(body, /v_request_id\s*:=\s*p_request_id::uuid/i);
  }
});

test('economy catalogs are immutable to students and seeded from generated SQL', () => {
  const sql = economyMigration();
  for (const table of [
    'game_item_catalog_v3',
    'game_skill_catalog_v3',
    'game_specialization_catalog_v3',
  ]) {
    assert.match(sql, new RegExp(`create\\s+table[^;]*public\\.${table}`, 'i'));
    assert.match(sql, new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, 'i'));
    assert.doesNotMatch(
      sql,
      new RegExp(`grant\\s+(?:insert|update|delete|all)[^;]*public\\.${table}[^;]*authenticated`, 'i'),
    );
  }
  assert.match(sql, /Generated by tools\/generate-authority-catalog-v3\.mjs/);
  assert.match(sql, /-- total-items: 51\b/);
  assert.match(sql, /-- skills: 42\b/);
});

test('inventory separates gear and costume ownership and equipped slots', () => {
  const sql = economyMigration();
  assert.match(
    sql,
    /add\s+column\s+inventory_kind\s+text\s+not\s+null\s+default\s+'gear'[\s\S]*?in\s*\(\s*'gear'\s*,\s*'costume'\s*\)/i,
  );
  assert.match(sql, /drop\s+constraint\s+if\s+exists\s+player_inventory_v3_user_id_equipped_slot_key/i);
  assert.match(
    sql,
    /unique\s+index[\s\S]*?\(\s*user_id\s*,\s*inventory_kind\s*,\s*equipped_slot\s*\)[\s\S]*?where\s+equipped_slot\s+is\s+not\s+null/i,
  );
  assert.match(
    sql,
    /unique\s+index[\s\S]*?\(\s*user_id\s*,\s*inventory_kind\s*,\s*item_definition_id\s*\)/i,
  );
  assert.match(sql, /'inventory_kind'\s*,\s*i\.inventory_kind/i);
});
