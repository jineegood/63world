import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const migrationPath = path.join(
  root,
  'supabase/migrations/202607260002_server_authoritative_player_v3.sql',
);

function migration() {
  assert.ok(fs.existsSync(migrationPath), 'server-authoritative v3 migration must exist');
  return fs.readFileSync(migrationPath, 'utf8');
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
