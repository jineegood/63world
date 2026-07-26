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

