import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const migrationsDir = path.join(root, 'supabase/migrations');
const migrationName = '202609040001_raid_lock_order_v1.sql';
const migration = fs.readFileSync(path.join(migrationsDir, migrationName), 'utf8');
const baseMigration = fs.readFileSync(
  path.join(migrationsDir, '202608010002_raid_party_rooms_v1.sql'), 'utf8',
);

function sqlWithoutComments(sql) {
  return sql.replace(/--[^\r\n]*/g, '').replace(/\s+/g, ' ').trim();
}

function functionDefinition(sql, name) {
  const match = sql.match(new RegExp(
    `create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, 'i',
  ));
  return match ? sqlWithoutComments(match[0]) : null;
}

function latestFunction(name) {
  let latest = null;
  for (const filename of fs.readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort()) {
    const definition = functionDefinition(
      fs.readFileSync(path.join(migrationsDir, filename), 'utf8'), name,
    );
    if (definition) latest = { filename, definition };
  }
  assert.ok(latest, `missing function ${name}`);
  return latest;
}

const heartbeatName = 'private_heartbeat_raid_room_v1';
const heartbeat = functionDefinition(migration, heartbeatName);
const originalHeartbeat = functionDefinition(baseMigration, heartbeatName);
const roomLock = 'select * into v_room from public.raid_rooms_v1 where id = p_room_id for update;';
const roomError = "if not found then raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND'; end if;";
const memberUpdate = 'update public.raid_room_members_v1 set last_seen_at = p_seen_at where room_id = p_room_id and user_id = p_user_id and active;';
const memberError = "if not found then raise exception using errcode = 'P0001', message = 'NOT_MEMBER'; end if;";
const membershipPrecheck = "if not exists ( select 1 from public.raid_room_members_v1 where room_id = p_room_id and user_id = p_user_id and active ) then raise exception using errcode = 'P0001', message = 'NOT_MEMBER'; end if;";

// These are migration-contract checks. Actual PostgreSQL interleaving tests
// are necessary to prove the deadlock is removed; regex checks alone do not.
test('raid lock fix is additive and only replaces the heartbeat function', () => {
  const sql = sqlWithoutComments(migration);
  assert.ok(sql.startsWith('begin;'));
  assert.ok(sql.endsWith('commit;'));
  assert.deepEqual(
    [...sql.matchAll(/create or replace function public\.(\w+)\(/g)].map((match) => match[1]),
    [heartbeatName],
  );
  assert.doesNotMatch(sql, /\b(?:drop|alter|create table|create trigger|create index)\b/i);
  const outerSql = sql.replace(heartbeat, '');
  assert.doesNotMatch(outerSql, /\b(?:update|delete|insert|truncate|select|perform)\b/i,
    'migration must not rewrite room/member data or invoke cleanup on application');
  assert.equal(latestFunction(heartbeatName).filename, migrationName);
});

test('heartbeat preserves membership-first errors without locking members first', () => {
  assert.ok(heartbeat.includes(membershipPrecheck));
  assert.ok(heartbeat.indexOf(membershipPrecheck) < heartbeat.indexOf(roomLock));
  const preLockSql = heartbeat.slice(0, heartbeat.indexOf(roomLock));
  assert.doesNotMatch(preLockSql, /\b(?:update|insert|delete|for share|for key share|for no key update)\b/i);
  assert.ok(heartbeat.indexOf(roomLock) < heartbeat.indexOf(memberUpdate));
  assert.ok(heartbeat.includes(`${memberUpdate} ${memberError}`),
    'membership must be revalidated after waiting for the room, not just prechecked');
  assert.ok(heartbeat.indexOf(memberError) < heartbeat.indexOf("if v_room.phase in ('question', 'waiting')"));
});

test('heartbeat changes only lock acquisition order and the read-only membership precheck', () => {
  assert.ok(originalHeartbeat.includes(`${memberUpdate} ${memberError} ${roomLock} ${roomError}`),
    'baseline must contain the verified member-before-room inversion');
  const expected = originalHeartbeat.replace(
    `${memberUpdate} ${memberError} ${roomLock} ${roomError}`,
    `${membershipPrecheck} ${roomLock} ${roomError} ${memberUpdate} ${memberError}`,
  );
  assert.equal(heartbeat, expected,
    'leave parameters, search path, timestamp handling, phase/deadline checks and result unchanged');
});

test('latest heartbeat, publish and question-ready share room-before-member row locks', () => {
  for (const name of [heartbeatName, 'private_publish_raid_round_v1', 'private_ack_raid_question_ready_v1']) {
    const { definition } = latestFunction(name);
    const lockedRoom = definition.match(/select \* into v_room from public\.raid_rooms_v1 where id = p_room_id for update;/i);
    assert.ok(lockedRoom, `${name} must lock its room row`);
    const memberWrite = definition.search(/update public\.raid_room_members_v1\b/i);
    assert.ok(memberWrite > definition.indexOf(lockedRoom[0]), `${name} cannot update members before locking its room`);
    assert.doesNotMatch(definition.slice(0, definition.indexOf(lockedRoom[0])),
      /\b(?:insert into|delete from|update) public\.raid_room_members_v1\b|for (?:update|no key update|share|key share)/i);
  }
});

test('heartbeat retains question barrier, deadline boundary, timestamp and TTL contracts', () => {
  assert.match(heartbeat, /if v_room\.phase in \('question', 'waiting'\) and v_room\.question_deadline is not null and v_room\.question_deadline <= p_seen_at then/);
  assert.match(heartbeat, /phase = 'resolving', resolution_started_at = p_seen_at, version = version \+ 1, updated_at = p_seen_at/);
  assert.ok(heartbeat.includes(memberUpdate), 'keep the existing last_seen_at write used by idle expiry');
  assert.doesNotMatch(heartbeat, /\b(?:expires_at|finished_at|combat_state|profile_snapshot|question_ready_round|playback_round)\b|raid_reward|raid_progress|player_profiles/);
  assert.match(heartbeat, /return jsonb_build_object\('ok', true\); end; \$\$;$/);
  assert.equal(latestFunction('private_expire_idle_raid_rooms_v1').filename,
    '202609020001_raid_room_idle_ttl_v1.sql', 'lock fix must not redefine idle-expiry rules');
  assert.equal(latestFunction('private_record_raid_clear_v1').filename,
    '202608090006_raid_balance_and_teacher_progress_v1.sql', 'lock fix must not redefine reward handling');
});

test('heartbeat remains security-definer and service-role-only with the same signature', () => {
  const sql = sqlWithoutComments(migration);
  assert.match(heartbeat, /^create or replace function public\.private_heartbeat_raid_room_v1\( p_user_id uuid, p_room_id uuid, p_seen_at timestamptz \) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as \$\$/);
  assert.match(sql, /revoke all on function public\.private_heartbeat_raid_room_v1\(uuid, uuid, timestamptz\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.private_heartbeat_raid_room_v1\(uuid, uuid, timestamptz\) to service_role;/);
  assert.doesNotMatch(sql, /grant[^;]*\b(?:anon|authenticated|public)\s*;/i);
});
