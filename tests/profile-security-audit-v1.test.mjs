import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/202607300003_profile_security_audit_v1.sql'),
  'utf8',
);
const dashboard = fs.readFileSync(path.join(root, 'src/admin-dashboard.js'), 'utf8');
const adminData = fs.readFileSync(path.join(root, 'src/admin-data-v2.js'), 'utf8');

test('profile audit observes saves without rejecting or rewriting student data', () => {
  assert.match(migration, /after update of data on public\.player_profiles_v2/i);
  assert.match(migration, /return new;/i);
  assert.doesNotMatch(migration, /raise exception/i);
  assert.doesNotMatch(migration, /new\.data\s*:=/i);
});

test('audit table is teacher-only and deduplicates open alerts', () => {
  assert.match(migration, /force row level security/i);
  assert.match(migration, /public\.is_teacher\(\)/i);
  assert.match(migration, /on conflict \(user_id, fingerprint\) where resolved_at is null/i);
  assert.doesNotMatch(migration, /grant\s+insert[^;]*authenticated/i);
});

test('teacher dashboard can list and resolve translated security alerts', () => {
  assert.match(adminData, /profile_security_audits_v1/);
  assert.match(adminData, /listSecurityAlerts/);
  assert.match(adminData, /resolveSecurityAlert/);
  assert.match(dashboard, /보안 알림/);
  assert.match(dashboard, /현재는 기록만 하며 학생의 게임이나 저장을 차단하지 않습니다/);
});
