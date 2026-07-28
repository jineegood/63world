import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const generator = path.join(root, 'tools/generate-authority-catalog-v3.mjs');
const output = path.join(root, 'supabase/generated/authority-catalog-v3.sql');
const commonMigration = path.join(root, 'supabase/migrations/202607290001_common_skills_no_prerequisites_v3.sql');
const game = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

test('authority catalog generator is deterministic and current', () => {
  const result = spawnSync(process.execPath, [generator, '--check'], {
    cwd:root,
    encoding:'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(fs.existsSync(output));
});

test('authority catalog pins all current items, costumes, skills, and specializations', () => {
  const sql = fs.readFileSync(output, 'utf8');
  assert.match(sql, /-- base-items: 43\b/);
  assert.match(sql, /-- costumes: 11\b/);
  assert.match(sql, /-- total-items: 54\b/);
  assert.match(sql, /-- skills: 42\b/);
  assert.match(sql, /-- pets: 6\b/);
  assert.match(sql, /\('bronzeGreatsword','gear','gold',30,'weapon','warrior',1,false\)/);
  assert.match(sql, /\('training_greatsword','gear','none',0,'weapon','warrior',1,true\)/);
  assert.match(sql, /\('training_staff','gear','none',0,'weapon','mage',1,true\)/);
  assert.match(sql, /\('training_book','gear','none',0,'weapon','priest',1,true\)/);
  assert.match(sql, /\('featherWing','gear','building',5,'accessory',null,3,false\)/);
  assert.match(sql, /\('cs_bunnyBand','costume','gold',120,'head',null,1,false\)/);
  assert.match(sql, /'warrior_basic_body'[\s\S]*?'warrior'[\s\S]*?3[\s\S]*?1/);
  assert.match(sql, /\('chick',19\)/);
  assert.match(sql, /\('yuksam',5\)/);
  for (const spec of ['방어', '무기', '냉기', '화염', '신성', '암흑']) {
    assert.ok(sql.includes(`'${spec}'`), `${spec} specialization must be seeded`);
  }
});

test('common skills have no prerequisites while specialization skills keep their progression', () => {
  const sql = fs.readFileSync(output, 'utf8');
  const migration = fs.readFileSync(commonMigration, 'utf8');
  const empty = String.raw`\{"all":\[\],"ranks":\{\},"any":\[\],"total":null\}`;
  for (const id of [
    'warrior_basic_body', 'warrior_basic_blade', 'warrior_basic_guard', 'warrior_basic_strike',
    'mage_basic_mana', 'mage_basic_element', 'mage_basic_bolt', 'mage_basic_barrier',
    'priest_basic_faith', 'priest_basic_life', 'priest_basic_smite', 'priest_basic_prayer',
  ]) {
    assert.match(sql, new RegExp(`\\('${id}',[^\\n]*,null,[^\\n]*'${empty}'::jsonb\\)`), `${id} must be freely learnable`);
  }
  assert.match(sql, /\('warrior_def_armor','warrior','방어'[^]*?"all":\["warrior_def_stance"\]/);
  assert.match(migration, /update\s+public\.game_skill_catalog_v3/i);
  assert.match(migration, /where\s+spec_name\s+is\s+null/i);
});

test('the common lane alone uses a two-by-two grid inside the existing three-column skill tree', () => {
  assert.match(game, /class="skill-lane-v35 common-grid-v35"/);
  assert.match(game, /class="skill-common-grid-v35"/);
  assert.match(style, /\.skill-tree-v35\{[^}]*grid-template-columns:repeat\(3,/);
  assert.match(style, /\.skill-common-grid-v35\{[^}]*grid-template-columns:repeat\(2,/);
});
