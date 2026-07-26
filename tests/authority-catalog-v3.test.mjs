import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const generator = path.join(root, 'tools/generate-authority-catalog-v3.mjs');
const output = path.join(root, 'supabase/generated/authority-catalog-v3.sql');

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
