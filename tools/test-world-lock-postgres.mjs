import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Called only by the disposable cluster runner, never against linked Supabase.
export async function runWorldLockTests({ connect, admin, repoRoot }) {
  assert.equal(admin.connectionParameters.host, '127.0.0.1');
  assert.equal(admin.connectionParameters.application_name, '63world-isolated-regression');
  const students = Array.from({ length: 85 }, (_, i) => `bbbbbbbb-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
  const baseState = { map: 'town', x: 120.126, y: 230.784, channel: 2, channelMode: 'manual' };
  const channelKey = channel => `yuksam-world-channel-capacity-v1|${channel}`;
  const lock = (client, key) => client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
  const normalize = value => {
    if (Array.isArray(value)) return value.map(normalize);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'at').map(([key, entry]) => [key, normalize(entry)]));
  };
  async function studentClient(user) {
    const client = await connect();
    await client.query('set role authenticated');
    await client.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    await client.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: user, role: 'authenticated' })]);
    return client;
  }
  const rpc = async (client, version, state = baseState) => {
    assert.ok([1, 2, 3, 4].includes(version));
    return (await client.query(`select public.sync_world_presence_v${version}($1::jsonb) as result`, [JSON.stringify(state)])).rows[0].result;
  };
  async function asStudent(index, version, state = baseState) {
    const client = await studentClient(students[index]);
    try { return await rpc(client, version, state); }
    finally { await client.end(); }
  }
  async function clearWorld() {
    await admin.query('truncate public.world_presence_v1, public.world_chat_v1, public.world_announcements_v1 restart identity');
  }
  async function seedPresence(indices, channel) {
    await admin.query(`insert into public.world_presence_v1(user_id,display_name,map,x,y,channel,state,last_seen_at)
      select p.user_id,p.display_name,'town',100,200,$2,'{}',clock_timestamp()
      from public.player_profiles_v2 p where p.user_id=any($1::uuid[])`, [indices.map(i => students[i]), channel]);
  }
  async function waitBlocked(client) {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      if ((await admin.query('select cardinality(pg_blocking_pids($1)) > 0 as blocked', [client.processID])).rows[0].blocked) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail(`Expected synthetic connection ${client.processID} to wait for lock`);
  }
  await admin.query(`insert into auth.users(id,email,raw_app_meta_data)
    select u,'local-test@63world.invalid','{"role":"teacher"}'::jsonb from unnest($1::uuid[]) u`, [students]);
  await admin.query(`insert into public.player_profiles_v2(user_id,normalized_name,display_name,data)
    select u,'test'||ord,'Test'||ord,'{}'::jsonb from unnest($1::uuid[]) with ordinality as item(u,ord)`, [students]);
  await admin.query(`create table public.test_presence_writes(user_id uuid);
    create function public.test_count_presence_write() returns trigger language plpgsql as $$
      begin insert into public.test_presence_writes values(new.user_id); return new; end $$;
    create trigger test_count_presence_write after insert or update on public.world_presence_v1
      for each row execute function public.test_count_presence_write();`);

  // Compare identical small-world scenarios before/after, including legacy RPCs.
  async function snapshots() {
    await clearWorld();
    await admin.query('truncate public.test_presence_writes');
    await admin.query(`insert into public.world_announcements_v1(kind,source_id,payload) values
      ('teacher_notice','aaaaaaaa-1111-4000-8000-000000000001','{"actorName":"Teacher","message":"Test notice"}'),
      ('raid_clear','aaaaaaaa-1111-4000-8000-000000000002','{"partyNames":["A","B","C"],"floor":20}')`);
    const rich = { ...baseState, level: 500, class: 'priest', spec: 'holy', name: 'spoof', userId: students[80],
      equipment: { weapon: 'wand', head: 'hat', secret: 'drop' }, appearance: { hair: 'black', bad: 'drop' },
      costume: { armor: 'cloak', bad: 'drop' }, nameplate: { theme: 'tower20', secret: 'drop' },
      moving: true, dance: false, facing: -1, petSide: 1, pvpAvailable: true,
      password: 'NEVER_STORE', arbitrary: { field: 'drop' } };
    const first = await asStudent(0, 4, rich);
    const writes = Number((await admin.query('select count(*) as n from public.test_presence_writes')).rows[0].n);
    const second = await asStudent(1, 4, { ...baseState, channel: 3 });
    const third = await asStudent(2, 4, { ...baseState, chat: { id: 'aaaaaaaa-2222-4000-8000-000000000001', text: 'Hello' } });
    const legacy1 = await asStudent(0, 1, rich);
    const legacy2 = await asStudent(0, 2, rich);
    const knownVisuals = Object.fromEntries(third.visuals.map(visual => [visual.u, visual.v]));
    // Only the third student's unchanged visual is known after legacy rewrites.
    const delta = await asStudent(2, 4, { ...baseState, knownVisuals, lastAnnouncementId: '1', lastChatId: '0' });
    const stored = (await admin.query(`select user_id,display_name,map,x,y,channel,state
      from public.world_presence_v1 order by user_id`)).rows;
    assert.equal(stored[0].display_name, 'Test1');
    assert.ok(!JSON.stringify(stored).includes('NEVER_STORE'));
    assert.equal(third.players.length, 2, 'channel-scoped roster excludes channel 3');
    assert.equal(legacy1.players.length, 3, 'legacy global roster unchanged');
    assert.equal(legacy2.announcements[0].message, 'Test notice');
    assert.equal(delta.announcements.length, 1, 'announcement cursor honored');
    assert.equal(delta.visuals.length, 0, 'known visuals suppress unchanged appearance');
    return { data: normalize({ first, second, third, legacy1, legacy2, delta, stored }), writes };
  }
  const before = await snapshots();
  assert.equal(before.writes, 2, 'reproduce old v3 double presence write');
  const blocker = await connect();
  const oldCaller = await studentClient(students[0]);
  await blocker.query('begin');
  await lock(blocker, channelKey(1));
  await oldCaller.query("set statement_timeout='400ms'");
  await assert.rejects(rpc(oldCaller, 4), error => error.code === '57014', 'old channel 2 request blocks on channel 1');
  await blocker.query('rollback');
  await oldCaller.end();
  console.log('PASS: old world code reproduces duplicate writes and cross-channel lock wait.');

  await admin.query(await readFile(path.join(repoRoot, 'supabase/migrations/202609040002_world_presence_lock_v1.sql'), 'utf8'));
  const after = await snapshots();
  assert.equal(after.writes, 1, 'new v3 writes once');
  assert.deepEqual(after.data, before.data, 'sanitization, payloads, chat, announcements, legacy and visuals unchanged');
  console.log('PASS: new/old world payload equivalence; authoritative presence writes reduced from 2 to 1.');

  // Holding channel 1 no longer blocks any channel-2 heartbeat API version.
  await blocker.query('begin');
  await lock(blocker, channelKey(1));
  try {
    for (const version of [1, 2, 3, 4]) {
      const caller = await studentClient(students[0]);
      try {
        await caller.query("set statement_timeout='1500ms'");
        const result = await rpc(caller, version);
        assert.ok(Array.isArray(result.players));
      } finally { await caller.end(); }
    }
    assert.equal((await asStudent(3, 4)).ok, true, 'new channel-2 entrant also succeeds');
  } finally { await blocker.query('rollback'); }
  console.log('PASS: legacy v1/v2 and current v3/v4 channel-2 calls bypass a held channel-1 lock.');

  // Channel 1 can be full without falsely rejecting an entrant elsewhere.
  await clearWorld();
  await seedPresence([0, 1, 2, 3, 4, 5, 6, 7], 1);
  assert.equal((await asStudent(8, 4)).ok, true);
  assert.equal((await asStudent(9, 4, { ...baseState, channel: 1 })).code, 'CHANNEL_FULL');
  assert.equal((await asStudent(0, 4, { ...baseState, channel: 1 })).ok, true, 'incumbent stays in full channel');
  assert.equal((await asStudent(8, 4, { ...baseState, channel: 1 })).previousChannel, 2);
  assert.equal((await admin.query('select channel from public.world_presence_v1 where user_id=$1', [students[8]])).rows[0].channel, 2);

  // Capacity is tested with separate connections released from the same lock.
  await clearWorld();
  await seedPresence([0, 1, 2, 3, 4, 5, 6], 4);
  await blocker.query('begin');
  await lock(blocker, channelKey(4));
  const contenders = await Promise.all([studentClient(students[7]), studentClient(students[8])]);
  const pending = contenders.map(client => rpc(client, 4, { ...baseState, channel: 4 }));
  await Promise.all(contenders.map(waitBlocked));
  await blocker.query('commit');
  const admissions = await Promise.all(pending);
  assert.equal(admissions.filter(result => result.ok).length, 1);
  assert.equal(admissions.filter(result => result.code === 'CHANNEL_FULL').length, 1);
  assert.equal(Number((await admin.query('select count(*) as n from public.world_presence_v1 where channel=4')).rows[0].n), 8);
  await Promise.all(contenders.map(client => client.end()));

  await clearWorld();
  const auto = await Promise.all(Array.from({ length: 31 }, (_, i) => asStudent(i, 4, { ...baseState, channelMode: 'auto' })));
  assert.equal(auto.filter(result => result.ok).length, 31);
  assert.deepEqual((await admin.query('select channel,count(*)::int as n from public.world_presence_v1 group by channel order by channel')).rows,
    Array.from({ length: 10 }, (_, i) => ({ channel: i + 1, n: i === 0 ? 4 : 3 })));
  console.log('PASS: 31 simultaneous automatic logins distribute 3 per channel first; manual hard cap remains 8.');

  // Same-user legacy heartbeat waits behind a channel move, reads the committed
  // assignment afterward, and cannot restore a stale channel or invert locks.
  await clearWorld();
  await asStudent(0, 4);
  const mover = await studentClient(students[0]);
  const legacy = await studentClient(students[0]);
  await mover.query('begin');
  await rpc(mover, 4, { ...baseState, channel: 3 });
  const lateLegacy = rpc(legacy, 1, { ...baseState, channel: 1, skipWrite: true, includeSnapshot: false });
  await waitBlocked(legacy);
  await mover.query('commit');
  const legacyResult = await lateLegacy;
  assert.equal(legacyResult.players.length, 1);
  assert.equal((await admin.query('select channel from public.world_presence_v1 where user_id=$1', [students[0]])).rows[0].channel, 3);
  // Opposite start order: legacy holds user->old-channel, new move waits at user.
  await legacy.query('begin');
  await rpc(legacy, 2);
  const lateMove = rpc(mover, 4, { ...baseState, channel: 2 });
  await waitBlocked(mover);
  await legacy.query('commit');
  assert.equal((await lateMove).channel, 2);
  await Promise.all([mover.end(), legacy.end()]);
  console.log('PASS: same-user channel changes and old-client heartbeats serialize safely in both orders.');

  // Security: helpers and backing tables remain inaccessible to student roles.
  const student = await studentClient(students[0]);
  await assert.rejects(student.query('select public.private_sync_world_presence_core_v1($1,2::smallint,false)', [baseState]), error => error.code === '42501');
  await assert.rejects(student.query('select public.private_list_world_announcements_v1($1)', [baseState]), error => error.code === '42501');
  await assert.rejects(student.query('select * from public.world_presence_v1'), error => error.code === '42501');
  for (const state of [
    { ...baseState, channel: 11 }, { ...baseState, x: -1 }, { ...baseState, map: '<bad>' },
    { ...baseState, knownVisuals: [] }, { ...baseState, lastChatId: '9223372036854775808' },
    { ...baseState, lastAnnouncementId: 'not-a-cursor' }, { ...baseState, channelMode: 'bad' }
  ]) await assert.rejects(rpc(student, 4, state), error => error.code === '22023');
  const permission = await student.query("select public.can_access_world_motion_channel_v1('world-motion-v1:channel-2') as yes, public.can_access_world_motion_channel_v1('world-motion-v1:channel-3') as no");
  assert.deepEqual(permission.rows[0], { yes: true, no: false });
  await student.end();
  const anonymous = await connect();
  await anonymous.query('set role anon');
  await assert.rejects(rpc(anonymous, 4), error => error.code === '42501');
  await anonymous.end();
  console.log('PASS: private helper/table grants, channel broadcast authorization and malformed-input validation.');

  // Bounded classroom contention exercise: independent channels remain live
  // while multiple distinct student connections poll them repeatedly.
  await clearWorld();
  await Promise.all(Array.from({ length: 28 }, (_, i) => asStudent(i, 4, { ...baseState, channelMode: 'auto' })));
  const assignments = (await admin.query('select user_id,channel from public.world_presence_v1 order by user_id')).rows;
  const started = performance.now();
  await Promise.all(assignments.map(async ({ user_id, channel }) => {
    const client = await studentClient(user_id);
    try {
      for (let tick = 0; tick < 10; tick++) {
        assert.equal((await rpc(client, 4, { ...baseState, channel, x: 120 + tick })).ok, true);
      }
    } finally { await client.end(); }
  }));
  console.log(`PASS: 28 synthetic students, 280 concurrent-channel heartbeat calls, no SQL errors (${Math.round(performance.now() - started)}ms locally; not a production capacity benchmark).`);
  await blocker.end();
}
