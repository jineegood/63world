import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const functionFile = path.join(root, 'supabase/functions/teacher-delete-student/index.ts');
const denoFile = path.join(root, 'supabase/functions/teacher-delete-student/deno.json');
const configFile = path.join(root, 'supabase/config.toml');

function source() {
  assert.ok(fs.existsSync(functionFile), 'teacher delete Edge Function must exist');
  return fs.readFileSync(functionFile, 'utf8');
}

test('function pins Supabase, accepts POST only, and verifies the bearer caller', () => {
  const code = source();
  assert.match(code, /npm:@supabase\/supabase-js@2\.110\.8/);
  assert.match(code, /req\.method\s*!==\s*['"]POST['"]/);
  assert.match(code, /req\.headers\.get\(['"]Authorization['"]\)/);
  assert.match(code, /auth\.getUser\(\)/);
});

test('authorization trusts app_metadata and validates one UUID target', () => {
  const code = source();
  assert.match(code, /app_metadata\?\.role\s*!==\s*['"]teacher['"]/);
  assert.doesNotMatch(code, /user_metadata\?\.role/);
  assert.match(code, /UUID\.test\(userId\)/);
  assert.match(code, /\.eq\(['"]user_id['"],\s*userId\)/);
  assert.match(code, /\.maybeSingle\(\)/);
});

test('service client deletes exactly one Auth user and returns only display name', () => {
  const code = source();
  assert.match(code, /Deno\.env\.get\(['"]SUPABASE_SERVICE_ROLE_KEY['"]\)/);
  assert.match(code, /auth\.admin\.deleteUser\(userId\)/);
  assert.doesNotMatch(code, /auth\.admin\.listUsers/);
  assert.match(code, /displayName\s*:\s*profile\.display_name/);
  assert.doesNotMatch(code, /JSON\.stringify\([^)]*(?:userId|authorization|serviceRoleKey)/i);
  assert.doesNotMatch(code, /console\.(?:log|info|debug|warn|error)/);
});

test('function files exist and platform JWT verification stays enabled', () => {
  assert.ok(fs.existsSync(denoFile), 'Deno config must exist');
  const config = fs.readFileSync(configFile, 'utf8');
  assert.match(config, /\[functions\.teacher-delete-student\]/);
  assert.match(config, /verify_jwt\s*=\s*true/);
});
