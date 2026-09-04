import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Called by test-db-contention.mjs after historical migrations have been applied
// to its disposable local cluster. This module never bootstraps or discovers DBs.
export async function runRaidLockTests({ connect, admin, repoRoot }) {
  assert.ok(['127.0.0.1', '::1', 'localhost'].includes(admin.connectionParameters.host),
    'raid regression refuses non-loopback connections');
  const server = await admin.query('select host(inet_server_addr()) as address, current_database() as database');
  assert.ok(['127.0.0.1', '::1'].includes(server.rows[0].address),
    'raid regression requires an actual loopback PostgreSQL server');
  assert.equal(admin.connectionParameters.application_name, '63world-isolated-regression',
    'use the disposable-cluster runner, not an application connection');

  const readMigration = (name) => fs.readFileSync(path.join(repoRoot, 'supabase/migrations', name), 'utf8');
  const originalSql = readMigration('202608010002_raid_party_rooms_v1.sql');
  const originalHeartbeat = originalSql.match(
    /create or replace function public\.private_heartbeat_raid_room_v1\([\s\S]*?\n\$\$;/i,
  )?.[0];
  assert.ok(originalHeartbeat, 'original heartbeat function is required for the negative control');
  const candidateSql = readMigration('202609040001_raid_lock_order_v1.sql');
  const users = Array.from({ length: 6 }, () => randomUUID());
  const roomIds = [randomUUID(), randomUUID()];
  const seenAt = '2026-09-04T04:30:00.000Z';
  const initialAt = '2026-09-04T04:29:00.000Z';
  const expiresAt = '2026-09-04T04:59:00.000Z';
  const report = { passed: [], oldDeadlocks: 0, correctedInterleavings: 0 };

  function recordPass(message) {
    report.passed.push(message);
    console.log(`PASS: raid ${message}.`);
  }

  async function client() {
    const connection = await connect();
    assert.equal(connection.connectionParameters.host, admin.connectionParameters.host);
    assert.equal(connection.connectionParameters.database, admin.connectionParameters.database);
    return connection;
  }

  async function withClients(count, callback) {
    const connections = [];
    try {
      for (let index = 0; index < count; index += 1) connections.push(await client());
      return await callback(connections);
    } finally {
      await Promise.allSettled(connections.map((connection) => connection.query('rollback')));
      await Promise.allSettled(connections.map((connection) => connection.end()));
    }
  }

  async function begin(connection) {
    await connection.query("begin; set local statement_timeout = '5s'; set local lock_timeout = '4s'; set local deadlock_timeout = '75ms'");
  }

  async function finishTransaction(connection, callback) {
    try {
      const result = await callback();
      await connection.query('commit');
      return result;
    } catch (error) {
      await connection.query('rollback');
      throw error;
    }
  }

  async function transaction(connection, callback) {
    await begin(connection);
    return finishTransaction(connection, callback);
  }

  const settled = (promise) => promise.then(
    (value) => ({ status: 'fulfilled', value }),
    (reason) => ({ status: 'rejected', reason }),
  );

  async function waitForBlock(waiter, blocker) {
    const limit = Date.now() + 2500;
    while (Date.now() < limit) {
      const result = await admin.query('select $2::integer = any(pg_blocking_pids($1::integer)) as blocked',
        [waiter.processID, blocker.processID]);
      if (result.rows[0].blocked) return;
      await delay(10);
    }
    throw new Error(`expected backend ${waiter.processID} to wait for ${blocker.processID}`);
  }

  async function resetRoom(index, { phase = 'question', deadline = null } = {}) {
    const roomId = roomIds[index];
    const memberIds = users.slice(index * 3, index * 3 + 3);
    await admin.query('delete from public.raid_rooms_v1 where id = $1', [roomId]);
    // Choose a free four-digit code instead of assuming the fixture DB has none.
    const code = (await admin.query(`select candidate::text as code
      from generate_series(8000, 9999) as candidate
      where not exists (select 1 from public.raid_rooms_v1 where invite_code = candidate::text)
      order by candidate limit 1`)).rows[0]?.code;
    assert.ok(code, 'fixture needs a free invite code');
    await admin.query(`insert into public.raid_rooms_v1(
        id, invite_code, host_id, floor_group, phase, round_no, question_public,
        question_deadline, create_request_id, created_at, updated_at, expires_at
      ) values ($1, $2, $3, 1, $4, 1, $5::jsonb, $6, $7, $8, $8, $9)`,
    [roomId, code, memberIds[0], phase,
      JSON.stringify({ byUser: Object.fromEntries(memberIds.map((id) => [id, { question: '1 + 1' }])) }),
      deadline, `fixture-create-${roomId}`, initialAt, expiresAt]);
    for (const [memberIndex, userId] of memberIds.entries()) {
      await admin.query(`insert into public.raid_room_members_v1(
          room_id, user_id, join_order, profile_snapshot, combat_state,
          join_request_id, joined_at, last_seen_at
        ) values ($1, $2, $3, '{"maxHp":100}'::jsonb, '{"hp":100}'::jsonb, $4, $5, $5)`,
      [roomId, userId, memberIndex + 1, `fixture-join-${roomId}-${userId}`, initialAt]);
    }
  }

  async function heartbeat(connection, roomIndex = 0, userId = users[roomIndex * 3], at = seenAt) {
    return (await connection.query('select public.private_heartbeat_raid_room_v1($1, $2, $3) as result',
      [userId, roomIds[roomIndex], at])).rows[0].result;
  }

  async function questionReady(connection, roomIndex = 0, userId = users[roomIndex * 3]) {
    return (await connection.query('select public.private_ack_raid_question_ready_v1($1, $2, 1, $3) as result',
      [userId, roomIds[roomIndex], seenAt])).rows[0].result;
  }

  async function publish(connection, roomIndex = 0) {
    const memberIds = users.slice(roomIndex * 3, roomIndex * 3 + 3);
    const result = {
      nextPhase: 'effects',
      memberStates: Object.fromEntries(memberIds.map((id, index) => [id, { hp: 90 - index }])),
      events: [{ kind: 'regression-test', marker: roomIds[roomIndex] }],
    };
    return (await connection.query('select public.private_publish_raid_round_v1($1, $2, 1, $3::jsonb, $4, $5) as result',
      [memberIds[0], roomIds[roomIndex], JSON.stringify(result), `fixture-publish-${roomIds[roomIndex]}`, seenAt])).rows[0].result;
  }

  async function roomState(index = 0) {
    return (await admin.query('select * from public.raid_rooms_v1 where id = $1', [roomIds[index]])).rows[0];
  }

  async function memberState(index = 0, userId = users[index * 3]) {
    return (await admin.query('select * from public.raid_room_members_v1 where room_id = $1 and user_id = $2',
      [roomIds[index], userId])).rows[0];
  }

  async function probeMemberLock(roomIndex, shouldBeLocked) {
    await admin.query('begin');
    let error = null;
    try {
      await admin.query('select user_id from public.raid_room_members_v1 where room_id = $1 and user_id = $2 for update nowait',
        [roomIds[roomIndex], users[roomIndex * 3]]);
    } catch (caught) {
      error = caught;
    } finally {
      await admin.query('rollback');
    }
    if (shouldBeLocked) assert.equal(error?.code, '55P03', 'old heartbeat must hold its member while blocked');
    else assert.equal(error, null, 'corrected blocked heartbeat must not hold its member');
  }

  async function interleave(operation, corrected) {
    const roomIndex = operation === 'publish' ? 0 : 1;
    await resetRoom(roomIndex, { phase: operation === 'publish' ? 'resolving' : 'question' });
    await withClients(2, async ([owner, pulse]) => {
      await begin(owner);
      await owner.query('select id from public.raid_rooms_v1 where id = $1 for update', [roomIds[roomIndex]]);
      // This promise is handled immediately so an expected deadlock rejection
      // cannot become an unhandled rejection while its peer is still running.
      const heartbeatResult = settled(transaction(pulse, () => heartbeat(pulse, roomIndex)));
      await waitForBlock(pulse, owner);
      await probeMemberLock(roomIndex, !corrected);
      const ownerResult = settled(finishTransaction(owner, () => (
        operation === 'publish' ? publish(owner, roomIndex) : questionReady(owner, roomIndex)
      )));
      const results = await Promise.all([heartbeatResult, ownerResult]);
      const errors = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
      if (corrected) {
        assert.deepEqual(errors.map((error) => ({ code: error.code, message: error.message })), [],
          `${operation} and corrected heartbeat must both commit`);
        report.correctedInterleavings += 1;
      } else {
        assert.equal(errors.length, 1, 'negative control must abort exactly one participant');
        assert.equal(errors[0].code, '40P01', 'negative control must reproduce a deadlock, not a timeout');
        report.oldDeadlocks += 1;
      }
    });
    recordPass(`${corrected ? 'fixed' : 'original'} heartbeat / ${operation} forced interleaving`);
  }

  async function heartbeatFirstInterleave(operation) {
    const roomIndex = operation === 'publish' ? 0 : 1;
    await resetRoom(roomIndex, { phase: operation === 'publish' ? 'resolving' : 'question' });
    await withClients(2, async ([pulse, owner]) => {
      await begin(pulse);
      await heartbeat(pulse, roomIndex);
      const pendingOwner = settled(transaction(owner, () => (
        operation === 'publish' ? publish(owner, roomIndex) : questionReady(owner, roomIndex)
      )));
      await waitForBlock(owner, pulse);
      await pulse.query('commit');
      const result = await pendingOwner;
      assert.equal(result.status, 'fulfilled', result.reason?.message);
      assert.equal((await memberState(roomIndex)).last_seen_at.toISOString(), seenAt);
      report.correctedInterleavings += 1;
    });
    recordPass(`fixed heartbeat first / ${operation} waits then commits`);
  }

  async function expectNotMember(query) {
    await assert.rejects(query, (error) => error.code === 'P0001' && error.message === 'NOT_MEMBER');
  }

  async function testErrors() {
    await resetRoom(0, { deadline: seenAt });
    const beforeRoom = await roomState();
    const beforeMember = await memberState();
    await expectNotMember(heartbeat(admin, 0, randomUUID()));
    await expectNotMember(admin.query('select public.private_heartbeat_raid_room_v1($1, $2, $3)',
      [users[0], randomUUID(), seenAt]));
    await expectNotMember(admin.query('select public.private_heartbeat_raid_room_v1(null, null, $1)', [seenAt]));
    assert.deepEqual(await roomState(), beforeRoom, 'rejected callers cannot resolve an expired question');
    assert.deepEqual(await memberState(), beforeMember);
    await admin.query('update public.raid_room_members_v1 set active = false where room_id = $1 and user_id = $2',
      [roomIds[0], users[0]]);
    const inactiveBefore = await memberState();
    await expectNotMember(heartbeat(admin));
    assert.deepEqual(await memberState(), inactiveBefore);
    assert.deepEqual(await roomState(), beforeRoom);
    recordPass('NOT_MEMBER precedence and inactive/outsider denial without writes');
  }

  async function testLeaveWhileWaiting() {
    await resetRoom(0, { deadline: seenAt });
    await withClients(2, async ([leaver, pulse]) => {
      await begin(leaver);
      await leaver.query('select id from public.raid_rooms_v1 where id = $1 for update', [roomIds[0]]);
      const pendingHeartbeat = settled(transaction(pulse, () => heartbeat(pulse)));
      await waitForBlock(pulse, leaver);
      await finishTransaction(leaver, () => leaver.query(
        'select public.private_leave_raid_room_v1($1, $2, $3, $4)',
        [users[0], roomIds[0], `fixture-leave-${roomIds[0]}`, seenAt],
      ));
      const result = await pendingHeartbeat;
      assert.equal(result.status, 'rejected');
      assert.equal(result.reason.code, 'P0001');
      assert.equal(result.reason.message, 'NOT_MEMBER');
    });
    const room = await roomState();
    const member = await memberState();
    assert.equal(room.phase, 'cancelled');
    assert.equal(room.resolution_started_at, null);
    assert.equal(Number(room.version), 2, 'only leave may increment room version');
    assert.equal(member.active, false);
    assert.equal(member.last_seen_at.toISOString(), initialAt);
    recordPass('active membership rechecked after room-lock wait / actual leave');
  }

  async function testDeadline() {
    await resetRoom(0);
    const initial = await roomState();
    assert.deepEqual(await heartbeat(admin), { ok: true });
    assert.deepEqual(await roomState(), initial, 'null deadline must retain the question-ready barrier');
    assert.equal((await memberState()).last_seen_at.toISOString(), seenAt);
    const deadline = '2026-09-04T04:30:01.000Z';
    await admin.query('update public.raid_rooms_v1 set question_deadline = $2 where id = $1', [roomIds[0], deadline]);
    const before = await roomState();
    await heartbeat(admin);
    assert.deepEqual(await roomState(), before, 'heartbeat before deadline must not resolve');
    await heartbeat(admin, 0, users[0], deadline);
    const resolved = await roomState();
    assert.equal(resolved.phase, 'resolving');
    assert.equal(resolved.resolution_started_at.toISOString(), deadline);
    assert.equal(resolved.updated_at.toISOString(), deadline);
    assert.equal(Number(resolved.version), Number(before.version) + 1);
    assert.deepEqual(resolved.expires_at, before.expires_at, 'idle TTL source fields must not be rewritten');
    assert.deepEqual(resolved.finished_at, before.finished_at);
    await heartbeat(admin, 0, users[0], '2026-09-04T04:30:02.000Z');
    assert.deepEqual(await roomState(), resolved, 'already-resolving heartbeat is not another transition');
    await resetRoom(1, { phase: 'waiting', deadline: seenAt });
    await heartbeat(admin, 1);
    assert.equal((await roomState(1)).phase, 'resolving', 'waiting uses the same inclusive deadline');
    recordPass('null / before / exact deadline, resolving idempotency and preserved TTL fields');
  }

  async function testTwoParties() {
    await resetRoom(0);
    await resetRoom(1);
    await withClients(12, async (connections) => {
      const results = await Promise.all(connections.map((connection, index) => {
        const userIndex = index % 6;
        const roomIndex = Math.floor(userIndex / 3);
        return transaction(connection, () => (
          index < 6 ? questionReady(connection, roomIndex, users[userIndex])
            : heartbeat(connection, roomIndex, users[userIndex])
        ));
      }));
      for (let roomIndex = 0; roomIndex < 2; roomIndex += 1) {
        const readyResults = results.slice(roomIndex * 3, roomIndex * 3 + 3);
        assert.equal(readyResults.filter((result) => result.started).length, 1,
          'exactly one ACK starts each question deadline');
        const room = await roomState(roomIndex);
        assert.equal(room.question_deadline.toISOString(), '2026-09-04T04:30:30.000Z');
        assert.equal(room.phase, 'question');
        const members = (await admin.query('select * from public.raid_room_members_v1 where room_id = $1',
          [roomIds[roomIndex]])).rows;
        assert.equal(members.length, 3);
        assert.ok(members.every((member) => member.question_ready_round === 1));
      }
    });
    await admin.query("update public.raid_rooms_v1 set phase = 'resolving' where id = any($1::uuid[])", [roomIds]);
    await withClients(8, async (connections) => {
      await Promise.all(connections.map((connection, index) => transaction(connection, () => (
        index < 2 ? publish(connection, index)
          : heartbeat(connection, Math.floor((index - 2) / 3), users[index - 2])
      ))));
    });
    for (let roomIndex = 0; roomIndex < 2; roomIndex += 1) {
      const room = await roomState(roomIndex);
      assert.equal(room.phase, 'effects');
      assert.equal(Number(room.next_sequence), 2);
      const events = (await admin.query('select * from public.raid_events_v1 where room_id = $1', [roomIds[roomIndex]])).rows;
      assert.equal(events.length, 1, 'one authoritative publication per party');
      assert.equal(events[0].event.marker, roomIds[roomIndex]);
      for (let memberIndex = 0; memberIndex < 3; memberIndex += 1) {
        const member = await memberState(roomIndex, users[roomIndex * 3 + memberIndex]);
        assert.deepEqual(member.combat_state, { hp: 90 - memberIndex }, 'heartbeat cannot overwrite combat results');
        assert.equal(member.last_seen_at.toISOString(), seenAt);
      }
      assert.equal((await publish(admin, roomIndex)).recovered, true, 'publish retry remains idempotent');
      assert.equal((await admin.query('select count(*)::integer as count from public.raid_events_v1 where room_id = $1',
        [roomIds[roomIndex]])).rows[0].count, 1);
    }
    recordPass('two rooms / six members concurrent ACK + heartbeat then publish + heartbeat');
  }

  try {
    for (const userId of users) {
      // Teacher metadata bypasses unrelated automatic student provisioning.
      await admin.query(`insert into auth.users(id, email, raw_app_meta_data, raw_user_meta_data)
        values ($1, $2, '{"role":"teacher"}'::jsonb, '{}'::jsonb)`,
      [userId, `raid-regression-${userId}@example.invalid`]);
    }
    await admin.query(originalHeartbeat);
    await interleave('publish', false);
    await interleave('question-ready', false);
    await admin.query(candidateSql);
    await interleave('publish', true);
    await interleave('question-ready', true);
    await heartbeatFirstInterleave('publish');
    await heartbeatFirstInterleave('question-ready');
    await testErrors();
    await testLeaveWhileWaiting();
    await testDeadline();
    await testTwoParties();
    const permission = await admin.query(`select
      has_function_privilege('anon', 'public.private_heartbeat_raid_room_v1(uuid,uuid,timestamptz)', 'execute') as anon,
      has_function_privilege('authenticated', 'public.private_heartbeat_raid_room_v1(uuid,uuid,timestamptz)', 'execute') as authenticated,
      has_function_privilege('service_role', 'public.private_heartbeat_raid_room_v1(uuid,uuid,timestamptz)', 'execute') as service_role`);
    assert.deepEqual(permission.rows[0], { anon: false, authenticated: false, service_role: true });
    recordPass('PostgreSQL execution privileges remain service-role-only');
    console.log(`Raid regression: ${report.passed.length} checks passed; ${report.oldDeadlocks} old deadlocks reproduced; ${report.correctedInterleavings} corrected lock schedules committed.`);
    return report;
  } finally {
    // Leave the candidate definition installed even when a negative control or
    // assertion fails. Cleanup targets only IDs created by this invocation.
    await admin.query(candidateSql);
    await admin.query('delete from public.raid_rooms_v1 where id = any($1::uuid[])', [roomIds]);
    await admin.query('delete from auth.users where id = any($1::uuid[])', [users]);
  }
}
