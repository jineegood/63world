import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const entryPath = path.join(root, 'supabase/functions/student-combat-v3/index.ts');

test('combat Edge endpoint verifies JWT and separates anon from service clients', () => {
  const source = fs.readFileSync(entryPath, 'utf8');
  const config = fs.readFileSync(path.join(root, 'supabase/config.toml'), 'utf8');
  assert.match(source, /npm:@supabase\/supabase-js@2\.110\.8/);
  assert.match(source, /auth\.getUser\(\)/);
  assert.match(source, /SUPABASE_ANON_KEY/);
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source, /createSupabasePveCombatStore\s*\(\s*serviceClient\s*\)/);
  assert.doesNotMatch(source, /body\.(?:userId|callerId)/);
  assert.match(config, /\[functions\.student-combat-v3\][\s\S]*?verify_jwt\s*=\s*true/);
});

test('endpoint enforces origin, bearer, method, content type, and body limits', () => {
  const source = fs.readFileSync(entryPath, 'utf8');
  assert.match(source, /ALLOWED_ORIGINS/);
  assert.match(source, /ORIGIN_NOT_ALLOWED/);
  assert.doesNotMatch(source, /Access-Control-Allow-Origin['"]\s*:\s*['"]\*/);
  assert.match(source, /request\.method\s*!==\s*['"]POST['"]/);
  assert.match(source, /application\/json/);
  assert.match(source, /content-length/i);
  assert.match(source, />\s*16384/);
  assert.match(source, /\/\^Bearer\\s\+/);
});

test('endpoint returns stable sanitized errors and never logs or responds with answer keys', () => {
  const source = fs.readFileSync(entryPath, 'utf8');
  assert.match(source, /publicErrorCode/);
  assert.match(source, /SERVER_ERROR/);
  assert.doesNotMatch(source, /console\.(?:log|error)\s*\([^)]*(?:answer|body|result)/i);
  assert.doesNotMatch(source, /JSON\.stringify\s*\([^)]*answerKey/i);
});

test('store maps only bounded private RPC calls', () => {
  const source = fs.readFileSync(
    path.join(root, 'supabase/functions/_shared/pve-combat-store-v3.mjs'),
    'utf8',
  );
  for (const rpc of [
    'private_read_combatant_v3',
    'private_start_student_combat_v3',
    'private_prepare_student_combat_turn_v3',
    'private_commit_student_combat_turn_v3',
    'private_surrender_student_combat_v3',
    'private_resume_student_combat_v3',
  ]) {
    assert.ok(source.includes(`'${rpc}'`), `${rpc} must be used`);
  }
  assert.doesNotMatch(source, /\.from\(\s*['"]player_combat_question_secrets_v3/i);
});
