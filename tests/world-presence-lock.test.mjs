import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const readMigration = (name) => fs.readFileSync(path.join(root, 'supabase/migrations', name), 'utf8')
  .replaceAll('\r\n', '\n');
const originalV1 = readMigration('202608270003_world_presence_v1.sql');
const originalV3 = readMigration('202608290001_world_channels_v1.sql');
const expansion = readMigration('202608310001_expand_channels_and_teacher_announcements_v1.sql');
const autoDistribution = readMigration('202609010002_world_channel_auto_distribution_v1.sql');
const migration = readMigration('202609040002_world_presence_lock_v1.sql');

function functionBody(sql, name) {
  const match = sql.match(new RegExp(
    `create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, 'i',
  ));
  assert.ok(match, `${name} function must exist`);
  return match[0];
}

function between(source, start, end) {
  const startAt = source.indexOf(start);
  assert.ok(startAt >= 0, `missing start: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.ok(endAt > startAt, `missing end: ${end}`);
  return source.slice(startAt, endAt).trimEnd();
}

const oldV1 = functionBody(originalV1, 'sync_world_presence_v1');
const oldV3 = functionBody(originalV3, 'sync_world_presence_v3');
const oldV2 = functionBody(expansion, 'sync_world_presence_v2');
const core = functionBody(migration, 'private_sync_world_presence_core_v1');
const announcements = functionBody(migration, 'private_list_world_announcements_v1');
const v1 = functionBody(migration, 'sync_world_presence_v1');
const v2 = functionBody(migration, 'sync_world_presence_v2');
const v3 = functionBody(migration, 'sync_world_presence_v3');

test('world lock correction is additive and leaves admission trigger, v4, tables and realtime boundaries alone', () => {
  assert.match(migration, /^begin;[\s\S]*commit;\s*$/);
  assert.doesNotMatch(migration, /(?:create or replace|drop) function public\.(?:sync_world_presence_v4|private_enforce_world_channel_capacity_v1|can_access_world_motion_channel_v1)\b/i);
  assert.doesNotMatch(migration, /(?:alter|drop|truncate) table|(?:create|alter|drop) policy|(?:create|drop) trigger/i);
  assert.doesNotMatch(migration, /grant\s+(?:select|insert|update|delete)\b/i);
  assert.match(expansion, /new\.channel not between 1 and 10/);
  assert.match(expansion, /v_active_others >= 8 and not v_active_incumbent/);
  assert.match(autoDistribution, /generate_series\(1, 10\)/);
  assert.match(autoDistribution, /where active\.occupancy < 8/);
  assert.match(autoDistribution, /order by\s+\(active\.occupancy >= 3\),\s+case when active\.occupancy >= 3 then active\.occupancy else 0 end,\s+candidate\.channel/);
  assert.match(autoDistribution, /v_channel_mode = 'manual'[\s\S]*return public\.sync_world_presence_v3\(p_state - 'channelMode'\)/);
});

test('all identity validation, coordinate limits and visual sanitization are byte-for-byte unchanged', () => {
  assert.equal(
    between(core, 'begin\n  if v_user_id is null', "  -- Serialize this student's channel"),
    between(oldV1, 'begin\n  if v_user_id is null', '  v_now := clock_timestamp();'),
  );
  assert.match(core, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(core, /select profile\.display_name[\s\S]*where profile\.user_id = v_user_id/);
  assert.match(core, /raise exception 'student profile is required'[\s\S]*errcode = '42501'/);
});

test('legacy calls preserve the existing channel under a user lock and never rely on INSERT default channel 1', () => {
  const lockAt = core.indexOf("'yuksam-world-presence-user-v1|'");
  const existingAt = core.indexOf('select presence.channel');
  const channelLockAt = core.indexOf("'yuksam-world-channel-capacity-v1|'");
  const clockAt = core.indexOf('v_now := clock_timestamp();');
  const writeAt = core.indexOf('insert into public.world_presence_v1');
  assert.ok(lockAt < existingAt && existingAt < channelLockAt && channelLockAt < clockAt && clockAt < writeAt);
  assert.match(core, /v_channel := p_channel;\s+if v_channel is null then[\s\S]*where presence\.user_id = v_user_id;\s+v_channel := coalesce\(v_channel, 1\)/);
  assert.match(core, /v_channel not between 1 and 10/);
  assert.match(core, /insert into public\.world_presence_v1 as presence \([\s\S]*state,\s+channel,\s+last_seen_at\s+\) values \([\s\S]*v_safe_state,\s+v_channel,\s+v_now/);
  assert.match(core, /on conflict \(user_id\) do update[\s\S]*channel = excluded\.channel/);
  assert.match(v1, /return public\.private_sync_world_presence_core_v1\(p_state, null, true\)/);
  assert.doesNotMatch(v1, /p_state\s*(?:->|\?)/, 'client JSON cannot control private channel/snapshot arguments');
});

test('v3 shares user then target-channel lock order and refreshes admission time after waiting', () => {
  const userLockAt = v3.indexOf("'yuksam-world-presence-user-v1|'");
  const channelLockAt = v3.indexOf("'yuksam-world-channel-capacity-v1|'");
  const clockAt = v3.indexOf('v_now := clock_timestamp();');
  const previousAt = v3.indexOf('select presence.channel');
  const countAt = v3.indexOf('select count(*)::integer');
  const fullAt = v3.indexOf('if v_active_requested >= 8 and not v_active_incumbent then');
  const writeAt = v3.indexOf('perform public.private_sync_world_presence_core_v1');
  assert.ok(userLockAt < channelLockAt && channelLockAt < clockAt && clockAt < previousAt);
  assert.ok(previousAt < countAt && countAt < fullAt && fullAt < writeAt);
  assert.match(v3, /presence\.user_id <> v_user_id/);
  assert.match(v3, /presence\.channel = v_channel\s+and presence\.last_seen_at >= v_now - interval '8 seconds'/);
  assert.match(v3, /'ok', false,[\s\S]*'code', 'CHANNEL_FULL',[\s\S]*'previousChannel', v_previous_channel/);
});

test('one sanitized presence write replaces v3 pre-upsert plus the legacy upsert and discarded snapshots', () => {
  assert.equal((core.match(/insert into public\.world_presence_v1/g) || []).length, 1);
  assert.doesNotMatch(v3, /(?:insert into|update) public\.world_presence_v1/);
  assert.doesNotMatch(v3, /public\.sync_world_presence_v[12]\(/);
  assert.equal((v3.match(/perform public\.private_sync_world_presence_core_v1/g) || []).length, 1);
  assert.match(v3, /private_sync_world_presence_core_v1\(\s+p_state - 'chat', v_channel, false\s+\)/);
  const skipAt = core.indexOf('if not p_include_snapshot then');
  const writeAt = core.indexOf('insert into public.world_presence_v1');
  const rosterAt = core.indexOf('with active as materialized (');
  const messagesAt = core.indexOf('from public.world_chat_v1 as message');
  assert.ok(writeAt < skipAt && skipAt < rosterAt && rosterAt < messagesAt);
  assert.match(core, /if not p_include_snapshot then\s+return '\{\}'::jsonb;\s+end if;/);
  assert.equal((v3.match(/with active as materialized \(/g) || []).length, 1);
  assert.equal((v3.match(/from public\.world_chat_v1 as message/g) || []).length, 1);
});

test('legacy global chat, visual deltas and full response stay byte-for-byte unchanged', () => {
  assert.equal(
    between(core, '  if v_chat_id is not null then', '  -- v3 builds its channel-scoped snapshot'),
    between(oldV1, '  if v_chat_id is not null then', '  with active as materialized ('),
  );
  assert.equal(
    core.slice(core.indexOf('  with active as materialized (')),
    oldV1.slice(oldV1.indexOf('  with active as materialized (')),
  );
  assert.match(v2, /v_base := public\.sync_world_presence_v1\(p_state\)/);
});

test('channel-specific chat throttle, idempotency, retention and compact roster stay byte-for-byte unchanged', () => {
  const end = "  select jsonb_build_object(\n    '1', count(*)";
  assert.equal(
    between(v3, '  if v_chat_id is not null then', end),
    between(oldV3, '  if v_chat_id is not null then', end),
  );
  assert.match(v3, /candidate\.map = v_map\s+and candidate\.channel = v_channel/);
  assert.match(v3, /from public\.world_chat_v1 as message\s+where message\.channel = v_channel/);
});

test('all ten counters are returned, with the first occupancy scan only on the full-channel branch', () => {
  assert.match(v3, /\(p_state ->> 'channel'\) !~ '\^\(\?:\[1-9\]\|10\)\(\?:\\\.0\+\)\?\$'/);
  const fullAt = v3.indexOf('if v_active_requested >= 8 and not v_active_incumbent then');
  const firstCountsAt = v3.indexOf("select jsonb_build_object(\n      '1', count(*)");
  const rejectAt = v3.indexOf("'ok', false");
  const writeAt = v3.indexOf('perform public.private_sync_world_presence_core_v1');
  const secondCountsAt = v3.indexOf("select jsonb_build_object(\n    '1', count(*)");
  assert.ok(fullAt < firstCountsAt && firstCountsAt < rejectAt && rejectAt < writeAt && writeAt < secondCountsAt);
  for (let channel = 1; channel <= 10; channel += 1) {
    const needle = `'${channel}', count(*) filter (where presence.channel = ${channel})`;
    assert.equal(v3.split(needle).length - 1, 2, `channel ${channel} needs both failure/success counters`);
  }
});

test('global announcement cursor and all payload fields including teacher messages are unchanged and shared', () => {
  assert.equal(
    between(announcements, "  if p_state ? 'lastAnnouncementId'", '  select coalesce(jsonb_agg'),
    between(oldV2, "  if p_state ? 'lastAnnouncementId'", '  v_base := public.sync_world_presence_v1'),
  );
  assert.equal(
    between(announcements, '  select coalesce(jsonb_agg', '  return coalesce('),
    between(oldV2, '  select coalesce(jsonb_agg', '  return coalesce('),
  );
  assert.match(announcements, /'message', recent\.payload ->> 'message'/);
  assert.match(announcements, /limit 30/);
  assert.doesNotMatch(announcements, /(?:insert into|update|delete from) public\.|public\.sync_world_presence/);
  assert.match(v2, /v_announcements := public\.private_list_world_announcements_v1\(p_state\)/);
  assert.match(v3, /v_announcements := public\.private_list_world_announcements_v1\(p_state\)/);
  assert.ok(v2.indexOf('private_list_world_announcements_v1') < v2.indexOf('public.sync_world_presence_v1'));
  assert.ok(v3.indexOf('private_list_world_announcements_v1') < v3.indexOf('perform public.private_sync_world_presence_core_v1'));
});

test('private helpers cannot be exposed as caller-controlled bypass RPCs', () => {
  for (const body of [core, announcements, v1, v2, v3]) {
    assert.match(body, /security definer\s+set search_path = ''/);
  }
  assert.match(migration, /revoke all on function public\.private_sync_world_presence_core_v1\(jsonb, smallint, boolean\)\s+from public, anon, authenticated;/);
  assert.match(migration, /revoke all on function public\.private_list_world_announcements_v1\(jsonb\)\s+from public, anon, authenticated;/);
  assert.doesNotMatch(migration, /grant execute on function public\.private_/);
  for (const version of [1, 2, 3]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.sync_world_presence_v${version}\\(jsonb\\)\\s+from public, anon, authenticated;\\s+grant execute on function public\\.sync_world_presence_v${version}\\(jsonb\\)\\s+to authenticated;`));
  }
});
