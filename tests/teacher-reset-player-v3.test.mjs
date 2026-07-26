import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const functionFile = path.join(root, 'supabase/functions/teacher-reset-player-v3/index.ts');
const denoFile = path.join(root, 'supabase/functions/teacher-reset-player-v3/deno.json');
const configFile = path.join(root, 'supabase/config.toml');
const migrationFile = path.join(
  root,
  'supabase/migrations/202607260002_server_authoritative_player_v3.sql',
);

function source() {
  assert.ok(fs.existsSync(functionFile), 'teacher reset player v3 Edge Function must exist');
  return fs.readFileSync(functionFile, 'utf8');
}

test('reset endpoint accepts POST only and verifies the bearer user', () => {
  const code = source();
  assert.match(code, /npm:@supabase\/supabase-js@2\.110\.8/);
  assert.match(code, /req\.method\s*!==\s*['"]POST['"]/);
  assert.match(code, /req\.headers\.get\(['"]Authorization['"]\)/);
  assert.match(code, /callerClient\.auth\.getUser\(\)/);
});

test('only trusted teacher app metadata can reset one UUID student', () => {
  const code = source();
  assert.match(code, /app_metadata\?\.role\s*!==\s*['"]teacher['"]/);
  assert.doesNotMatch(code, /user_metadata\?\.role/);
  assert.match(code, /UUID\.test\(userId\)/);
  assert.match(code, /callerData\.user\.id/);
});

test('service role invokes one transactional RPC without exposing its secret', () => {
  const code = source();
  assert.match(code, /Deno\.env\.get\(['"]SUPABASE_SERVICE_ROLE_KEY['"]\)/);
  assert.match(code, /serviceClient\.rpc\(['"]reset_student_character_v3['"]/);
  assert.match(code, /p_user_id\s*:\s*userId/);
  assert.match(code, /p_teacher_user_id\s*:\s*callerData\.user\.id/);
  assert.doesNotMatch(code, /auth\.admin\.(?:deleteUser|updateUserById)/);
  assert.doesNotMatch(code, /console\.(?:log|info|debug|warn|error)/);
});

test('database reset RPC is service-only and preserves the Auth account', () => {
  const sql = fs.readFileSync(migrationFile, 'utf8');
  const body = sql.match(
    /create\s+or\s+replace\s+function\s+public\.reset_student_character_v3[\s\S]*?as\s+\$\$([\s\S]*?)\$\$;/i,
  )?.[1] || '';
  assert.match(body, /from\s+auth\.users[\s\S]*?raw_app_meta_data[\s\S]*?'teacher'/i);
  assert.match(body, /delete\s+from\s+public\.game_action_receipts_v3/i);
  assert.match(body, /delete\s+from\s+public\.player_core_v3/i);
  assert.match(body, /insert\s+into\s+public\.security_events_v3/i);
  assert.doesNotMatch(body, /delete\s+from\s+auth\.users/i);
  assert.match(
    sql,
    /revoke\s+all\s+on\s+function\s+public\.reset_student_character_v3\(uuid,\s*uuid\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i,
  );
  assert.match(
    sql,
    /grant\s+execute\s+on\s+function\s+public\.reset_student_character_v3\(uuid,\s*uuid\)\s+to\s+service_role/i,
  );
});

test('function files exist and platform JWT verification stays enabled', () => {
  assert.ok(fs.existsSync(denoFile), 'Deno config must exist');
  const config = fs.readFileSync(configFile, 'utf8');
  assert.match(config, /\[functions\.teacher-reset-player-v3\]/);
  assert.match(config, /verify_jwt\s*=\s*true/);
});
