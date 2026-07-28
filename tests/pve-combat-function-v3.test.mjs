import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createSupabasePveCombatStore } from '../supabase/functions/_shared/pve-combat-store-v3.mjs';

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
  assert.match(source, /HEALING_NOT_ACTIVE/);
  assert.doesNotMatch(source, /console\.(?:log|error)\s*\([^)]*(?:answer|body|result)/i);
  assert.doesNotMatch(source, /JSON\.stringify\s*\([^)]*answerKey/i);
});

test('endpoint logs bounded combat diagnostics without logging answers or request bodies', () => {
  const source = fs.readFileSync(entryPath, 'utf8');
  assert.match(source, /event:\s*'student_combat_v3_error'/);
  for (const field of ['operation', 'errorCode', 'userId', 'sessionRevision', 'requestId']) {
    assert.match(source, new RegExp(`${field}\\s*:`));
  }
  assert.doesNotMatch(source, /console\.error\s*\([^)]*(?:authorization|answer|questionToken|serviceKey|body)/i);
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
    'private_start_student_healing_v3',
    'private_submit_student_healing_v3',
  ]) {
    assert.ok(source.includes(`'${rpc}'`), `${rpc} must be used`);
  }
  assert.doesNotMatch(source, /\.from\(\s*['"]player_combat_question_secrets_v3/i);
});

test('store turns private application rejections into stable service errors', async () => {
  const store = createSupabasePveCombatStore({
    async rpc() {
      return { data:{ ok:false, code:'REQUEST_ID_REUSED' }, error:null };
    },
  });
  await assert.rejects(
    store.start({
      userId:'user-a',
      monsterKey:'forest_mushroom',
      state:{},
      requestId:'request-a',
    }),
    (error) => error.code === 'REQUEST_ID_REUSED',
  );
});

test('combat start binds the projected player revision inside the locked transaction', async () => {
  const calls = [];
  const store = createSupabasePveCombatStore({
    rpc:async (name, payload) => {
      calls.push([name, payload]);
      return { data:{ ok:true } };
    },
  });
  await store.start({
    userId:'user-a',
    monsterKey:'forest_mushroom',
    expectedPlayerRevision:7,
    state:{ playerHp:22, playerMaxHp:22 },
    requestId:'33333333-3333-4333-8333-333333333333',
  });
  assert.deepEqual(calls[0], ['private_start_student_combat_v3', {
    p_user_id:'user-a',
    p_monster_key:'forest_mushroom',
    p_expected_player_revision:7,
    p_state:{ playerHp:22, playerMaxHp:22 },
    p_request_id:'33333333-3333-4333-8333-333333333333',
  }]);
});
