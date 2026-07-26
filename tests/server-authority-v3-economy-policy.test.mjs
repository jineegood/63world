import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const sql = fs.readFileSync(
  path.join(root, 'supabase/migrations/202607260003_server_authoritative_economy_v3.sql'),
  'utf8',
);
const authoritySql = fs.readFileSync(
  path.join(root, 'supabase/migrations/202607260002_server_authoritative_player_v3.sql'),
  'utf8',
);

function body(name) {
  return sql.match(
    new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}[\\s\\S]*?as\\s+\\$\\$([\\s\\S]*?)\\$\\$;`, 'i'),
  )?.[1] || '';
}

test('purchase derives identity, price, requirements, and currency from locked server rows', () => {
  const fn = body('purchase_student_item_v3');
  assert.match(fn, /auth\.uid\(\)/i);
  assert.doesNotMatch(fn, /\bp_user_id\b/i);
  assert.match(fn, /private_read_receipt_v3\s*\(\s*v_request_id\s*,\s*'purchase_student_item_v3'/i);
  assert.match(fn, /from\s+public\.player_core_v3[\s\S]*?for\s+update/i);
  assert.match(fn, /from\s+public\.game_item_catalog_v3/i);
  assert.match(fn, /quest_only[\s\S]*?ITEM_NOT_PURCHASABLE/i);
  assert.match(fn, /class_name[\s\S]*?CLASS_REQUIRED/i);
  assert.match(fn, /level_required[\s\S]*?LEVEL_REQUIRED/i);
  assert.match(fn, /currency_kind\s*=\s*'gold'[\s\S]*?gold\s*-\s*v_price/i);
  assert.match(fn, /currency_kind\s*=\s*'building'[\s\S]*?building\s*-\s*v_price/i);
  assert.match(fn, /insert\s+into\s+public\.player_inventory_v3/i);
  assert.match(fn, /revision\s*=\s*revision\s*\+\s*1/i);
  assert.match(fn, /private_build_student_snapshot_v3/i);
});

test('equip and unequip accept only owned instances and kind-scoped slots', () => {
  const equip = body('equip_student_item_v3');
  assert.match(equip, /i\.user_id\s*=\s*v_user_id/i);
  assert.match(equip, /where\s+user_id\s*=\s*v_user_id[\s\S]*?inventory_kind\s*=\s*v_kind[\s\S]*?equipped_slot\s*=\s*v_slot/i);
  assert.match(equip, /update\s+public\.player_inventory_v3[\s\S]*?equipped_slot\s*=\s*v_slot/i);
  assert.match(equip, /CLASS_REQUIRED|class_name/i);
  assert.match(equip, /LEVEL_REQUIRED|level_required/i);

  const unequip = body('unequip_student_slot_v3');
  assert.match(unequip, /p_inventory_kind\s+not\s+in\s*\(\s*'gear'\s*,\s*'costume'\s*\)/i);
  assert.match(unequip, /p_slot\s+not\s+in\s*\(\s*'weapon'\s*,\s*'head'\s*,\s*'armor'\s*,\s*'accessory'\s*\)/i);
  assert.match(unequip, /inventory_kind\s*=\s*p_inventory_kind/i);
  assert.match(unequip, /equipped_slot\s*=\s*p_slot/i);
});

test('economy RPCs are revision-bound, text-request validated, and authenticated-only', () => {
  for (const [name, signature] of [
    ['purchase_student_item_v3', 'text,\\s*bigint,\\s*text'],
    ['equip_student_item_v3', 'uuid,\\s*bigint,\\s*text'],
    ['unequip_student_slot_v3', 'text,\\s*text,\\s*bigint,\\s*text'],
    ['enhance_student_weapon_v3', 'bigint,\\s*text'],
    ['choose_student_specialization_v3', 'text,\\s*bigint,\\s*text'],
    ['learn_student_skill_v3', 'text,\\s*bigint,\\s*text'],
    ['summon_student_pet_v3', 'bigint,\\s*text'],
    ['set_student_active_pet_v3', 'text,\\s*bigint,\\s*text'],
  ]) {
    const fn = body(name);
    assert.match(fn, /p_request_id[\s\S]*?\^\[0-9a-fA-F\]/i);
    assert.match(fn, /p_expected_revision\s+is\s+distinct\s+from\s+v_current_revision/i);
    assert.match(fn, /REVISION_CONFLICT/i);
    assert.match(fn, /private_store_receipt_v3/i);
    assert.match(sql, new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${name}\\(${signature}\\)\\s+from\\s+public\\s*,\\s*anon`, 'i'));
    assert.match(sql, new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\(${signature}\\)\\s+to\\s+authenticated`, 'i'));
  }
});

test('enhancement charges building currency and rolls the existing tier chances on the server', () => {
  const fn = body('enhance_student_weapon_v3');
  assert.match(fn, /equipped_slot\s*=\s*'weapon'/i);
  assert.match(fn, /enhancement_tier[\s\S]*?for\s+update/i);
  assert.match(fn, /v_building\s*<\s*3/i);
  assert.match(fn, /building\s*=\s*building\s*-\s*3/i);
  assert.match(fn, /case\s+v_current_tier[\s\S]*?when\s+0\s+then\s+0\.80[\s\S]*?when\s+1\s+then\s+0\.60[\s\S]*?when\s+2\s+then\s+0\.40[\s\S]*?when\s+3\s+then\s+0\.20/i);
  assert.match(fn, /pg_catalog\.random\(\)\s*<\s*v_chance/i);
  assert.match(fn, /greatest\s*\(\s*0\s*,\s*v_current_tier\s*-\s*1\s*\)/i);
  assert.match(fn, /'outcome'[\s\S]*?'success'[\s\S]*?'old_tier'[\s\S]*?'new_tier'/i);
});

test('specialization is class-bound, level-gated, and can only be chosen once', () => {
  const fn = body('choose_student_specialization_v3');
  assert.match(fn, /v_level\s*<\s*5/i);
  assert.match(fn, /v_current_spec\s+is\s+not\s+null/i);
  assert.match(fn, /from\s+public\.game_specialization_catalog_v3/i);
  assert.match(fn, /class_name\s*=\s*v_class_name/i);
  assert.match(fn, /spec\s*=\s*p_spec_name/i);
});

test('skill learning derives points and validates class, spec, level, rank, and prerequisites', () => {
  const fn = body('learn_student_skill_v3');
  assert.match(fn, /from\s+public\.game_skill_catalog_v3/i);
  assert.match(fn, /v_skill_class\s+is\s+distinct\s+from\s+v_class_name/i);
  assert.match(fn, /v_skill_spec\s+is\s+not\s+null[\s\S]*?v_skill_spec\s+is\s+distinct\s+from\s+v_spec/i);
  assert.match(fn, /v_level\s*<\s*v_unlock_level/i);
  assert.match(fn, /v_current_rank\s*>=\s*v_max_rank/i);
  assert.match(fn, /\(\s*v_level\s*-\s*1\s*\)\s*\*\s*2\s*-\s*v_spent_points/i);
  assert.match(fn, /jsonb_array_elements_text\s*\(\s*v_prerequisites\s*->\s*'all'\s*\)/i);
  assert.match(fn, /insert\s+into\s+public\.player_skills_v3[\s\S]*?on\s+conflict[\s\S]*?rank\s*=\s*public\.player_skills_v3\.rank\s*\+\s*1/i);
});

test('public economy actions cannot target another user or submit protected results', () => {
  for (const name of [
    'purchase_student_item_v3',
    'equip_student_item_v3',
    'unequip_student_slot_v3',
    'enhance_student_weapon_v3',
    'choose_student_specialization_v3',
    'learn_student_skill_v3',
    'summon_student_pet_v3',
    'set_student_active_pet_v3',
  ]) {
    const fn = body(name);
    assert.match(fn, /v_user_id\s+uuid\s*:=\s*auth\.uid\(\)/i);
    assert.doesNotMatch(fn, /\bp_user_id\b|\bp_price\b|\bp_gold\b|\bp_building\b|\bp_balance\b/i);
    assert.doesNotMatch(fn, /\bp_success\b|\bp_outcome\b|\bp_chance\b|\bp_tier\b|\bp_rank\b/i);
  }
});

test('request receipts reject replaying one request id across different action names', () => {
  const receipt = authoritySql.match(
    /create\s+or\s+replace\s+function\s+public\.private_read_receipt_v3[\s\S]*?as\s+\$\$([\s\S]*?)\$\$;/i,
  )?.[1] || '';
  assert.match(receipt, /where\s+r\.user_id\s*=\s*auth\.uid\(\)[\s\S]*?r\.request_id\s*=\s*p_request_id/i);
  assert.match(receipt, /v_action_name\s+is\s+distinct\s+from\s+p_action_name/i);
  assert.match(receipt, /request_id_reused/i);
  assert.match(receipt, /REQUEST_ID_REUSED/i);
  assert.match(receipt, /pg_advisory_xact_lock/i);
});

test('malformed identifiers and invalid catalog values are rejected before mutation', () => {
  assert.match(sql, /item_id\s+text\s+primary\s+key\s+check\s*\(\s*char_length\(item_id\)\s+between\s+1\s+and\s+80\s*\)/i);
  assert.match(sql, /price\s+integer\s+not\s+null\s+check\s*\(\s*price\s*>=\s*0\s*\)/i);
  assert.match(sql, /level_required\s+integer\s+not\s+null\s+check\s*\(\s*level_required\s+between\s+1\s+and\s+10\s*\)/i);
  assert.match(sql, /max_rank\s+integer\s+not\s+null\s+check\s*\(\s*max_rank\s+between\s+1\s+and\s+20\s*\)/i);
  assert.match(sql, /point_cost\s+integer\s+not\s+null\s+check\s*\(\s*point_cost\s+between\s+1\s+and\s+20\s*\)/i);
  assert.match(body('purchase_student_item_v3'), /char_length\(p_item_id\)\s+not\s+between\s+1\s+and\s+80/i);
  assert.match(body('choose_student_specialization_v3'), /char_length\(p_spec_name\)\s+not\s+between\s+1\s+and\s+40/i);
  assert.match(body('learn_student_skill_v3'), /char_length\(p_skill_id\)\s+not\s+between\s+1\s+and\s+80/i);
});

test('database uniqueness prevents duplicate ownership and double-equipped slots', () => {
  assert.match(
    sql,
    /create\s+unique\s+index\s+if\s+not\s+exists\s+player_inventory_v3_kind_item_uidx[\s\S]*?\(\s*user_id\s*,\s*inventory_kind\s*,\s*item_definition_id\s*\)/i,
  );
  assert.match(
    sql,
    /create\s+unique\s+index\s+if\s+not\s+exists\s+player_inventory_v3_kind_slot_uidx[\s\S]*?\(\s*user_id\s*,\s*inventory_kind\s*,\s*equipped_slot\s*\)[\s\S]*?where\s+equipped_slot\s+is\s+not\s+null/i,
  );
  assert.match(body('purchase_student_item_v3'), /where\s+user_id\s*=\s*v_user_id[\s\S]*?item_definition_id\s*=\s*p_item_id/i);
  assert.match(body('purchase_student_item_v3'), /ALREADY_OWNED/i);
});

test('pet spending, weighted outcome, ownership, and active pet are server-authoritative', () => {
  const summon = body('summon_student_pet_v3');
  assert.match(summon, /from\s+public\.player_core_v3[\s\S]*?for\s+update/i);
  assert.match(summon, /v_building\s*<\s*10/i);
  assert.match(summon, /pg_catalog\.random\(\)\s*\*\s*v_total_weight/i);
  assert.match(summon, /from\s+public\.game_pet_catalog_v3/i);
  assert.match(summon, /building\s*=\s*building\s*-\s*10/i);
  assert.match(summon, /insert\s+into\s+public\.player_pets_v3/i);
  assert.match(summon, /active_pet\s*=\s*v_pet_id/i);
  assert.match(summon, /'outcome'[\s\S]*?'pet_id'/i);
  assert.doesNotMatch(summon, /\bp_pet_id\b|\bp_building\b|\bp_weight\b|\bp_outcome\b/i);

  const active = body('set_student_active_pet_v3');
  assert.match(active, /where\s+p\.user_id\s*=\s*v_user_id\s+and\s+p\.pet_id\s*=\s*p_pet_id/i);
  assert.match(active, /active_pet\s*=\s*p_pet_id/i);
  assert.match(active, /equip_unowned_pet/i);
  assert.match(sql, /primary\s+key\s*\(\s*user_id\s*,\s*pet_id\s*\)/i);
  assert.match(sql, /user_id\s+uuid\s+not\s+null\s+references\s+public\.player_core_v3\s*\(\s*user_id\s*\)\s+on\s+delete\s+cascade/i);
  assert.match(sql, /revoke\s+all\s+on\s+table\s+public\.player_pets_v3\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i);
});
