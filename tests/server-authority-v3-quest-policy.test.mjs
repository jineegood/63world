import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const migration = path.join(
  root,
  'supabase/migrations/202607260005_server_authoritative_quests_v3.sql',
);

function source() {
  assert.ok(fs.existsSync(migration), 'authoritative quest migration must exist');
  return fs.readFileSync(migration, 'utf8');
}

function body(sql, name) {
  const match = sql.match(new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\([\\s\\S]*?\\n\\$\\$;`,
    'i',
  ));
  assert.ok(match, `${name} must exist`);
  return match[0];
}

test('quest catalog and healing secrets are inaccessible to students', () => {
  const sql = source();
  assert.match(sql, /create table if not exists public\.game_quest_catalog_v3/i);
  assert.match(sql, /create table if not exists public\.player_healing_sessions_v3/i);
  assert.match(sql, /create table if not exists public\.player_healing_question_secrets_v3/i);
  for (const table of [
    'game_quest_catalog_v3',
    'player_healing_sessions_v3',
    'player_healing_question_secrets_v3',
  ]) {
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`, 'i'));
  }
});

test('quest acceptance locks revision, enforces sequence, and grants only catalog rewards', () => {
  const fn = body(source(), 'accept_student_quest_v3');
  assert.match(fn, /auth\.uid\(\)/i);
  assert.match(fn, /for update/i);
  assert.match(fn, /revision\s*<>\s*p_expected_revision/i);
  assert.match(fn, /sequence_number\s*-\s*1/i);
  assert.match(fn, /status\s*=\s*'claimed'/i);
  assert.match(fn, /v_quest\.accept_(?:gold|building)/i);
  assert.match(fn, /v_quest\.accept_item_id/i);
  assert.match(fn, /private_store_receipt_v3/i);
});

test('quest claims reject unfinished goals and award the catalog exactly once', () => {
  const fn = body(source(), 'claim_student_quest_v3');
  assert.match(fn, /private_is_teacher_v3/i);
  assert.doesNotMatch(fn, /select\s+q\.status\s*,\s*c\.\*\s+into\s+v_status\s*,\s*v_quest/i);
  assert.match(fn, /status\s*<>\s*'ready'/i);
  assert.match(fn, /reward_exp/i);
  assert.match(fn, /reward_gold/i);
  assert.match(fn, /reward_building/i);
  assert.match(fn, /reward_item_id/i);
  assert.match(fn, /set status\s*=\s*'claimed'/i);
  assert.match(fn, /private_store_receipt_v3/i);
});

test('public quest mutations reject malformed request ids before uuid casts', () => {
  const sql = source();
  for (const name of [
    'accept_student_quest_v3',
    'claim_student_quest_v3',
    'receive_student_quest_gift_v3',
  ]) {
    const fn = body(sql, name);
    assert.match(fn, /\^\[0-9a-fA-F\]\{8\}-\[0-9a-fA-F\]\{4\}-\[1-5\]/i);
  }
  assert.match(body(sql, 'receive_student_quest_gift_v3'), /private_is_teacher_v3/i);
});

test('trusted gameplay events advance only the matching active quest', () => {
  const sql = source();
  const fn = body(sql, 'private_progress_student_quest_v3');
  assert.match(fn, /q\.status\s*=\s*'active'/i);
  assert.match(fn, /c\.event_kind\s*=\s*p_event_kind/i);
  assert.match(fn, /c\.event_target\s*=\s*p_event_target/i);
  assert.match(fn, /least\s*\(\s*c\.target_count/i);
  assert.match(fn, /then 'ready'/i);
  assert.match(fn, /v_count\s+integer/i);
  assert.match(fn, /return\s+v_count\s*>\s*0/i);
  assert.match(sql, /revoke all on function public\.private_progress_student_quest_v3/i);
});

test('healing start returns no answer and submit compares only inside private SQL', () => {
  const sql = source();
  const normalize = body(sql, 'private_normalize_combat_answer_v3');
  const start = body(sql, 'private_start_student_healing_v3');
  const submit = body(sql, 'private_submit_student_healing_v3');
  assert.match(start, /private_pick_combat_question_v3\s*\(\s*'forest'\s*\)/i);
  assert.match(normalize, /regexp_replace/i);
  assert.match(start, /private_read_service_receipt_v3/i);
  assert.match(start, /private_store_service_receipt_v3/i);
  assert.match(start, /-\s*'answerKey'/i);
  assert.doesNotMatch(start, /jsonb_build_object\([^)]*answerKey/i);
  assert.match(submit, /private_normalize_combat_answer_v3/i);
  assert.match(submit, /private_read_service_receipt_v3/i);
  assert.match(submit, /private_store_service_receipt_v3/i);
  assert.match(submit, /current_hp\s*=\s*max_hp/i);
  assert.match(submit, /private_progress_student_quest_v3[\s\S]*'healing'[\s\S]*'well'/i);
});

test('authoritative economy and combat outcomes emit trusted quest events', () => {
  const economy = fs.readFileSync(path.join(
    root, 'supabase/migrations/202607260003_server_authoritative_economy_v3.sql'
  ), 'utf8');
  const combat = fs.readFileSync(path.join(
    root, 'supabase/migrations/202607260004_server_authoritative_pve_combat_v3.sql'
  ), 'utf8');

  assert.match(body(economy, 'purchase_student_item_v3'), /private_progress_student_quest_v3[\s\S]*'action'\s*,\s*'buy'/i);
  assert.match(body(economy, 'purchase_student_item_v3'), /v_slot\s*=\s*'accessory'[\s\S]*'buyAccessory'/i);
  assert.match(body(economy, 'equip_student_item_v3'), /private_progress_student_quest_v3[\s\S]*'equip'/i);
  assert.match(body(economy, 'enhance_student_weapon_v3'), /private_progress_student_quest_v3[\s\S]*'enhance'/i);
  assert.match(body(economy, 'learn_student_skill_v3'), /private_progress_student_quest_v3[\s\S]*'learnSkill'/i);
  assert.match(body(economy, 'summon_student_pet_v3'), /private_progress_student_quest_v3[\s\S]*'pet'/i);
  assert.match(body(combat, 'private_commit_student_combat_turn_v3'), /v_kind\s*=\s*'victory'[\s\S]*private_progress_student_quest_v3[\s\S]*v_session\.monster_key/i);
});

test('accepting healing training makes server hp one and pre-learned skill becomes ready', () => {
  const fn = body(source(), 'accept_student_quest_v3');
  assert.match(fn, /current_hp\s*=\s*case\s+when\s+p_quest_id\s*=\s*'tut_healing_well'\s+then\s+1/i);
  assert.match(fn, /p_quest_id\s*=\s*'tut_skill'[\s\S]*player_skills_v3[\s\S]*private_progress_student_quest_v3/i);
});
