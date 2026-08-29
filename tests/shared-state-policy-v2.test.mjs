import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const file = path.join(root, 'supabase/migrations/202607230003_shared_classroom_state_v2.sql');
const restoreFile = path.join(root, 'supabase/migrations/202608270002_restore_student_workbook_reads_v1.sql');

function sql() {
  assert.ok(fs.existsSync(file), 'shared classroom migration must exist');
  return fs.readFileSync(file, 'utf8');
}

test('anonymous users can select only classroom settings', () => {
  const source = sql();
  assert.match(source, /grant select on table public\.shared_state_v2 to anon/i);
  assert.match(source, /for select to anon[\s\S]*key\s*=\s*'classroom_settings'/i);
  assert.doesNotMatch(source, /for (?:insert|update|delete) to anon/i);
});

test('authenticated users read only the two fixed shared keys', () => {
  const source = sql();
  assert.match(source, /drop policy if exists "authenticated users read shared state v2"/i);
  assert.match(source, /for select to authenticated[\s\S]*key\s+in\s*\(\s*'classroom_settings'\s*,\s*'workbooks'\s*\)/i);
});

test('teacher administration remains trusted and no student write policy is added', () => {
  const source = sql();
  assert.match(source, /teachers administer shared state v2[\s\S]*public\.is_teacher\(\)/i);
  assert.doesNotMatch(source, /create policy\s+"[^"]*student[^"]*"[\s\S]{0,160}shared_state_v2/i);
});

test('migration is additive and never touches the legacy shared_state table', () => {
  const source = sql();
  assert.doesNotMatch(source, /\b(?:alter|drop|truncate|delete from|update)\s+(?:table\s+)?public\.shared_state\b/i);
  assert.doesNotMatch(source, /\bgrant\b[^;]*\bpublic\.shared_state\b/i);
});

test('the final recovery migration restores student workbook reads after the abandoned authority policy', () => {
  assert.ok(fs.existsSync(restoreFile), 'student workbook read repair migration must exist');
  const source = fs.readFileSync(restoreFile, 'utf8');
  assert.match(source, /grant select on table public\.shared_state_v2 to authenticated/i);
  assert.match(source, /drop policy if exists "authenticated users read classroom settings v3"/i);
  assert.match(source, /for select\s+to authenticated[\s\S]*key\s+in\s*\(\s*'classroom_settings'\s*,\s*'workbooks'\s*\)/i);
  assert.doesNotMatch(source, /for (?:insert|update|delete)\s+to authenticated/i);
  assert.doesNotMatch(source, /to anon[\s\S]*workbooks/i);
});
