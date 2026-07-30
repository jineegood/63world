import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(
  path.join(root, 'supabase/functions/teacher-apply-cheat/index.ts'),
  'utf8',
);
const config = fs.readFileSync(path.join(root, 'supabase/config.toml'), 'utf8');

test('teacher cheat function verifies the caller and trusts app_metadata only', () => {
  assert.match(source, /Authorization/);
  assert.match(source, /auth\.getUser\(\)/);
  assert.match(source, /app_metadata\?\.role\s*!==\s*['"]teacher['"]/);
  assert.doesNotMatch(source, /user_metadata\?\.role/);
});

test('teacher cheat function accepts a narrow action list and one UUID target', () => {
  assert.match(source, /const UUID\s*=/);
  assert.match(source, /exp20/);
  assert.match(source, /exp100/);
  assert.match(source, /gold3000/);
  assert.match(source, /building200/);
  assert.match(source, /heal/);
  assert.match(source, /\.eq\(['"]user_id['"], userId\)/);
});

test('teacher cheat function keeps service credentials server-side', () => {
  assert.match(source, /Deno\.env\.get\(['"]SUPABASE_SERVICE_ROLE_KEY['"]\)/);
  assert.doesNotMatch(source, /console\.(?:log|error)/);
  assert.match(config, /\[functions\.teacher-apply-cheat\][\s\S]*?verify_jwt\s*=\s*true/);
});
