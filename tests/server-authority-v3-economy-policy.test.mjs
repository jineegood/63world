import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const sql = fs.readFileSync(
  path.join(root, 'supabase/migrations/202607260003_server_authoritative_economy_v3.sql'),
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
