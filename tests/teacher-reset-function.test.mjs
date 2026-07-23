import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const functionFile = path.join(root, 'supabase/functions/teacher-reset-password/index.ts');
const denoFile = path.join(root, 'supabase/functions/teacher-reset-password/deno.json');
const configFile = path.join(root, 'supabase/config.toml');

function source() {
  assert.ok(fs.existsSync(functionFile), 'teacher reset Edge Function must exist');
  return fs.readFileSync(functionFile, 'utf8');
}

test('function pins Supabase, allows POST only, and verifies the caller token', () => {
  const code = source();
  assert.match(code, /npm:@supabase\/supabase-js@2\.110\.8/);
  assert.match(code, /req\.method\s*!==\s*['"]POST['"]/);
  assert.match(code, /req\.headers\.get\(['"]Authorization['"]\)/);
  assert.match(code, /auth\.getUser\(\)/);
});

test('teacher authorization trusts app_metadata only', () => {
  const code = source();
  assert.match(code, /app_metadata\?\.role\s*!==\s*['"]teacher['"]/);
  assert.doesNotMatch(code, /user_metadata\?\.role/);
});

test('password and exact student target are validated before a single Auth update', () => {
  const code = source();
  assert.match(code, /newPassword\.length\s*<\s*6/);
  assert.match(code, /newPassword\.length\s*>\s*72/);
  assert.match(code, /from\(['"]player_profiles_v2['"]\)/);
  assert.match(code, /\.eq\(['"]normalized_name['"],\s*normalizedName\)/);
  assert.match(code, /\.maybeSingle\(\)/);
  assert.match(code, /auth\.admin\.updateUserById\(profile\.user_id/);
  assert.doesNotMatch(code, /auth\.admin\.listUsers/);
});

test('server secrets come only from Deno environment and never reach the response or logs', () => {
  const code = source();
  assert.match(code, /Deno\.env\.get\(['"]SUPABASE_SERVICE_ROLE_KEY['"]\)/);
  assert.doesNotMatch(code, /SUPABASE_SERVICE_ROLE_KEY\s*=\s*['"][^'"]+['"]/);
  assert.doesNotMatch(code, /console\.(?:log|info|debug|warn|error)/);
  assert.doesNotMatch(code, /JSON\.stringify\([^)]*newPassword/);
  assert.match(code, /displayName\s*:\s*profile\.display_name/);
  assert.match(code, /Cache-Control['"]?\s*:\s*['"]no-store['"]/);
});

test('function configuration keeps platform JWT verification enabled', () => {
  assert.ok(fs.existsSync(denoFile), 'Deno config must exist');
  assert.ok(fs.existsSync(configFile), 'Supabase config must exist');
  const config = fs.readFileSync(configFile, 'utf8');
  assert.match(config, /\[functions\.teacher-reset-password\]/);
  assert.match(config, /verify_jwt\s*=\s*true/);
});
