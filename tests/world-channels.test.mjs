import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const migration = fs.readFileSync(path.join(
  root,
  'supabase/migrations/202608290001_world_channels_v1.sql',
), 'utf8');
const expansion = fs.readFileSync(path.join(
  root,
  'supabase/migrations/202608310001_expand_channels_and_teacher_announcements_v1.sql',
), 'utf8');
const autoDistribution = fs.readFileSync(path.join(
  root,
  'supabase/migrations/202609010002_world_channel_auto_distribution_v1.sql',
), 'utf8');

function functionBody(name) {
  const match = migration.match(new RegExp(
    `create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
    'i',
  ));
  assert.ok(match, `${name} function must exist`);
  return match[0];
}

test('presence and chat gain one bounded server-owned channel without opening table access', () => {
  assert.match(migration, /alter table public\.world_presence_v1\s+add column if not exists channel smallint not null default 1/i);
  assert.match(migration, /alter table public\.world_chat_v1\s+add column if not exists channel smallint not null default 1/i);
  assert.match(migration, /world_presence_v1_channel_safe[\s\S]*check \(channel between 1 and 5\)/i);
  assert.match(migration, /world_chat_v1_channel_safe[\s\S]*check \(channel between 1 and 5\)/i);
  assert.match(migration, /world_presence_v1_active_channel_idx[\s\S]*\(channel, last_seen_at desc, user_id\)/i);
  assert.match(migration, /world_presence_v1_active_map_channel_idx[\s\S]*\(map, channel, last_seen_at desc, user_id\)/i);
  assert.match(migration, /world_chat_v1_channel_recent_idx[\s\S]*\(channel, id desc\)/i);
  assert.match(migration, /alter table public\.world_presence_v1 force row level security/i);
  assert.match(migration, /alter table public\.world_chat_v1 force row level security/i);
  assert.match(migration, /revoke all on table public\.world_presence_v1 from public, anon, authenticated/i);
  assert.match(migration, /revoke all on table public\.world_chat_v1 from public, anon, authenticated/i);
  assert.doesNotMatch(migration, /grant\s+(?:select|insert|update|delete)[\s\S]*world_(?:presence|chat)_v1/i);
});

test('capacity is eight and admission is serialized across simultaneous and legacy heartbeats', () => {
  const trigger = functionBody('private_enforce_world_channel_capacity_v1');
  const lockAt = trigger.indexOf('pg_advisory_xact_lock');
  const countAt = trigger.indexOf('select count(*)::integer');
  const rejectAt = trigger.indexOf('v_active_others >= 8');

  assert.ok(lockAt >= 0 && lockAt < countAt && countAt < rejectAt,
    'capacity lock must be held before counting and rejecting the ninth entrant');
  assert.match(trigger, /last_seen_at >= v_now - interval '8 seconds'/i);
  assert.match(trigger, /presence\.user_id <> new\.user_id/i);
  assert.match(trigger, /v_active_incumbent[\s\S]*old\.channel = new\.channel/i);
  assert.match(trigger, /detail = 'CHANNEL_FULL'/i);
  assert.match(migration, /before insert or update of channel, last_seen_at on public\.world_presence_v1[\s\S]*private_enforce_world_channel_capacity_v1/i,
    'the trigger must protect old v1/v2 callers, not only the v3 RPC');

  const v3 = functionBody('sync_world_presence_v3');
  const rpcLockAt = v3.indexOf('pg_advisory_xact_lock');
  const rpcCountAt = v3.indexOf('select count(*)::integer');
  const rpcFullAt = v3.indexOf("'CHANNEL_FULL'");
  const rpcWriteAt = v3.indexOf('insert into public.world_presence_v1');
  assert.ok(rpcLockAt >= 0 && rpcLockAt < rpcCountAt && rpcCountAt < rpcFullAt && rpcFullAt < rpcWriteAt,
    'v3 must return CHANNEL_FULL before mutating presence while holding the channel lock');
  assert.match(v3, /v_active_requested >= 8 and not v_active_incumbent/i);
  assert.doesNotMatch(v3, /(?:>=|=)\s*6\b|limit\s+6\b/i);
});

test('v3 validates manual channels 1-5 and returns all five occupancy counters', () => {
  const v3 = functionBody('sync_world_presence_v3');
  assert.match(v3, /jsonb_typeof\(p_state -> 'channel'\) is distinct from 'number'/i);
  assert.match(v3, /\(p_state ->> 'channel'\) !~ '\^\[1-5\]/i);
  assert.match(v3, /raise exception 'invalid world channel'[\s\S]*errcode = '22023'/i);
  assert.match(v3, /'1', count\(\*\) filter \(where presence\.channel = 1\)[\s\S]*'5', count\(\*\) filter \(where presence\.channel = 5\)/i);
  assert.match(v3, /'ok', false,[\s\S]*'code', 'CHANNEL_FULL'[\s\S]*'previousChannel'[\s\S]*'channelCounts'/i);
  assert.match(v3, /'ok', true,[\s\S]*'map', v_map,[\s\S]*'channel', v_channel,[\s\S]*'channelCounts'/i);
  assert.match(migration, /revoke all on function public\.sync_world_presence_v3\(jsonb\)[\s\S]*grant execute[\s\S]*to authenticated/i);
  assert.match(v3, /security definer\s+set search_path = ''/i);
  assert.match(v3, /v_user_id uuid := auth\.uid\(\)/i);
});

test('v3 isolates map roster and chat by channel but preserves global announcements', () => {
  const v3 = functionBody('sync_world_presence_v3');
  assert.match(v3, /candidate\.map = v_map\s+and candidate\.channel = v_channel\s+and candidate\.last_seen_at >= v_now - interval '8 seconds'/i);
  assert.match(v3, /from public\.world_chat_v1 as message\s+where message\.channel = v_channel\s+and message\.id > v_last_chat_id/i);
  assert.match(v3, /insert into public\.world_chat_v1 \([\s\S]*channel, created_at[\s\S]*v_channel, v_now/i);
  assert.match(v3, /public\.sync_world_presence_v2\(p_state - 'chat'\)/i,
    'v2 remains the single global-announcement cursor implementation');
  assert.match(v3, /'announcements', coalesce\(v_base -> 'announcements', '\[\]'::jsonb\)/i);
  assert.match(v3, /'players', coalesce\(v_players, '\[\]'::jsonb\)[\s\S]*'visuals'[\s\S]*'messages'[\s\S]*'announcements'/i);
  assert.match(migration, /Compatibility is deliberate:[\s\S]*older deployed clients can keep calling v2/i);
  assert.doesNotMatch(migration, /(?:drop|revoke all on function) public\.sync_world_presence_v2/i);
});

test('private realtime motion topics require a recent assignment to the exact channel', () => {
  const access = functionBody('can_access_world_motion_channel_v1');
  assert.match(access, /\^world-motion-v1:channel-\[1-5\]\$/i);
  assert.match(access, /presence\.user_id = v_user_id[\s\S]*presence\.channel = v_channel[\s\S]*last_seen_at >= clock_timestamp\(\) - interval '8 seconds'/i);
  assert.match(migration, /create policy "world motion broadcast receive v1"[\s\S]*for select[\s\S]*to authenticated[\s\S]*extension = 'broadcast'[\s\S]*realtime\.topic\(\)/i);
  assert.match(migration, /create policy "world motion broadcast send v1"[\s\S]*for insert[\s\S]*to authenticated[\s\S]*with check[\s\S]*extension = 'broadcast'[\s\S]*realtime\.topic\(\)/i);
  assert.match(migration, /revoke all on function public\.can_access_world_motion_channel_v1\(text\)[\s\S]*grant execute[\s\S]*to authenticated/i);
});

test('current upgrade expands the protected channel range to 1-10 while keeping capacity eight', () => {
  assert.match(expansion, /world_presence_v1_channel_safe[\s\S]*check \(channel between 1 and 10\)/i);
  assert.match(expansion, /world_chat_v1_channel_safe[\s\S]*check \(channel between 1 and 10\)/i);
  assert.match(expansion, /new\.channel not between 1 and 10/i);
  assert.match(expansion, /v_active_others >= 8 and not v_active_incumbent/i);
  assert.match(expansion, /\^world-motion-v1:channel-\(\?:\[1-9\]\|10\)\$/i);
  assert.match(expansion, /\^world-motion-v1:channel-\(\[1-9\]\|10\)\$/i);
  assert.doesNotMatch(expansion, /world-motion-v1:channel-\[1-10\]/i,
    '[1-10] is a character range and must never be used for channel ten');
  assert.match(expansion, /v_channel_pattern text := '''\^\[1-5\]\(\?:\\\.0\+\)\?\$'''/i);
  assert.match(expansion, /v_channel_replacement text := '''\^\(\?:\[1-9\]\|10\)\(\?:\\\.0\+\)\?\$'''/i);
  assert.match(expansion, /''6'', count\(\*\) filter \(where presence\.channel = 6\)[\s\S]*''10'', count\(\*\) filter \(where presence\.channel = 10\)/i);
  assert.match(expansion, /v_count_occurrences <> 2[\s\S]*unexpected sync_world_presence_v3 channel counter count/i,
    'the migration must fail closed instead of silently half-patching v3');
  assert.match(expansion, /revoke all on function public\.sync_world_presence_v3\(jsonb\)[\s\S]*grant execute[\s\S]*to authenticated/i);
});

test('v4 serializes automatic admissions and fills each channel to three in order before a fourth', () => {
  assert.match(autoDistribution,
    /create or replace function public\.sync_world_presence_v4\(p_state jsonb\)/i);
  assert.match(autoDistribution,
    /jsonb_typeof\(p_state -> 'channelMode'\) is distinct from 'string'/i);
  assert.match(autoDistribution, /v_channel_mode not in \('auto', 'manual'\)/i);
  assert.match(autoDistribution,
    /v_channel_mode = 'manual'[\s\S]*return public\.sync_world_presence_v3\(p_state - 'channelMode'\)/i,
    'manual selection must keep the requested v3 channel and its hard cap of eight');

  const lockAt = autoDistribution.indexOf("'yuksam-world-auto-admission-v1'");
  const chooseAt = autoDistribution.indexOf('from pg_catalog.generate_series(1, 10)');
  const writeAt = autoDistribution.lastIndexOf('public.sync_world_presence_v3(');
  assert.ok(lockAt >= 0 && lockAt < chooseAt && chooseAt < writeAt,
    'the global automatic-admission lock must cover both channel selection and the v3 write');
  assert.match(autoDistribution, /presence\.user_id <> v_user_id/i);
  assert.match(autoDistribution, /presence\.last_seen_at >= clock_timestamp\(\) - interval '8 seconds'/i);
  assert.match(autoDistribution, /where active\.occupancy < 8/i);
  assert.match(autoDistribution,
    /order by\s+\(active\.occupancy >= 3\),\s+case when active\.occupancy >= 3 then active\.occupancy else 0 end,\s+candidate\.channel/i,
    'automatic admission must fill channel 1 to three before moving to channel 2');
  assert.match(autoDistribution,
    /\(p_state - 'channelMode' - 'channel'\)[\s\S]*jsonb_build_object\('channel', v_selected_channel\)/i,
    'the server-selected channel must replace, not trust, the automatic client preference');
  assert.match(autoDistribution,
    /revoke all on function public\.sync_world_presence_v4\(jsonb\)[\s\S]*grant execute[\s\S]*to authenticated/i);
  assert.match(autoDistribution, /security definer\s+set search_path = ''/i);
});
