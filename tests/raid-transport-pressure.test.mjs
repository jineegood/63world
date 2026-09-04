import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const uiSource = readFileSync(new URL('../src/raid-run-ui.js', import.meta.url), 'utf8');
const clientSource = readFileSync(new URL('../src/raid-party-client.js', import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

class Clock {
  now = 0;
  sequence = 0;
  timers = new Map();
  setTimeout = (callback, delay = 0) => {
    const id = ++this.sequence;
    this.timers.set(id, { callback, at:this.now + Math.max(0, delay) });
    return id;
  };
  clearTimeout = (id) => this.timers.delete(id);
  async tick(milliseconds) {
    const end = this.now + milliseconds;
    for (let count = 0; count < 1000; count += 1) {
      await flush();
      const next = [...this.timers.entries()].filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) { this.now = end; await flush(); return; }
      this.now = next[1].at;
      this.timers.delete(next[0]);
      next[1].callback();
    }
    assert.fail('timer loop did not apply backpressure');
  }
}

function snapshot({ id = 'room-a', code = '1001', version = 1, name = '앨리스', ...room } = {}) {
  return {
    room:{ id, code, version, hostId:'alice', floorGroup:1, phase:'lobby', round:0, ...room },
    members:[{
      roomId:id, userId:'alice', joinOrder:1, slot:null, ready:false, active:true,
      profile:{ name, spec:'무기', className:'warrior', level:5, maxHp:40, attack:9 },
      state:{ hp:40, maxHp:40, cooldowns:{}, statuses:{} },
    }], events:[],
  };
}

function partySnapshot({ ready = false, ...options } = {}) {
  const data = snapshot(options);
  data.members = ['alice', 'bob', 'carol'].map((userId, index) => ({
    ...structuredClone(data.members[0]), userId, joinOrder:index + 1, ready,
    slot:['front', 'middle', 'back'][index],
    profile:{ ...data.members[0].profile, spec:['무기', '원소', '신성'][index] },
  }));
  return data;
}

function uiHarness() {
  const clock = new Clock();
  const requests = [];
  const subscriptions = [];
  const leaves = [];
  const toasts = [];
  let html = '';
  let lobby = snapshot();
  let inflight = 0;
  let maximumInflight = 0;
  const request = (op, roomId, afterSequence, options) => {
    const result = deferred();
    inflight += 1;
    maximumInflight = Math.max(maximumInflight, inflight);
    requests.push({ op, roomId, afterSequence, options, at:clock.now, ...result });
    return result.promise.finally(() => { inflight -= 1; });
  };
  const partyClient = {
    async create() { return structuredClone(lobby); },
    async join() { return structuredClone(lobby); },
    sync:(...args) => request('sync', ...args),
    heartbeat:(...args) => request('heartbeat', ...args),
    subscribe(roomId, listener, onReady) {
      const subscription = { roomId, listener, onReady, removed:false };
      subscriptions.push(subscription);
      return () => { subscription.removed = true; };
    },
    leave(roomId) {
      const result = deferred();
      leaves.push({ roomId, ...result });
      return result.promise;
    },
  };
  const styles = new Map();
  const nodes = new Map();
  const controls = new Map();
  const game = { modalState:null, player:{ name:'앨리스' } };
  const context = {
    console, game, Date:class extends Date { static now() { return clock.now; } },
    performance:{ now:() => clock.now },
    setTimeout:clock.setTimeout, clearTimeout:clock.clearTimeout,
    setInterval:() => { throw new Error('transport must not use async setInterval'); },
    clearInterval() {},
    document:{
      head:{ appendChild(node) { styles.set(node.id, node); } },
      createElement:() => ({ id:'', textContent:'' }),
      getElementById:(id) => {
        if (styles.has(id)) return styles.get(id);
        if (!html.includes(`id="${id}"`)) return null;
        if (!nodes.has(id)) nodes.set(id, { disabled:false, classList:{ toggle() {} } });
        return nodes.get(id);
      },
      querySelectorAll:(selector) => {
        const kind = selector === '[data-network-pick]' ? 'pick' : selector === '[data-network-slot]' ? 'slot' : '';
        if (!kind) return [];
        return [...html.matchAll(new RegExp(`data-network-${kind}="([^"]+)"`, 'g'))].map((match) => {
          const key = `${kind}:${match[1]}`;
          if (!controls.has(key)) controls.set(key, { dataset:{
            [kind === 'pick' ? 'networkPick' : 'networkSlot']:match[1],
          } });
          return controls.get(key);
        });
      }, querySelector:() => null,
    },
    openModal(nextHtml, options) { html = nextHtml; game.modalState = { type:options?.type }; },
    closeModal() { html = ''; game.modalState = null; },
    toast:(message) => toasts.push(message),
    getPvpIdentityV1:() => ({ userId:'alice' }),
    secureStudentAccessV2:{ getClient:() => ({}) },
    YuksamRaidPartyClient:{ create:() => partyClient },
    YuksamRaidRules:{ SLOTS:['front', 'middle', 'back'], slotLabel:(slot) => slot },
    YuksamRaidRun:{},
    YuksamCore:{ escapeHtml:(value) => String(value), normalize:(value) => String(value ?? '').trim() },
  };
  context.window = context;
  vm.runInNewContext(uiSource, context);
  return {
    api:context.YuksamRaidRunUi, clock, requests, subscriptions, leaves, toasts, partyClient, nodes, controls,
    html:() => html, maximumInflight:() => maximumInflight,
    open:async (next = snapshot()) => { lobby = next; return context.YuksamRaidRunUi.openNetworkLobby(); },
  };
}

test('healthy heartbeat stays on 3s starts; a slow response never creates overlapping requests', async () => {
  const h = uiHarness();
  await h.open();
  await h.clock.tick(2999);
  assert.equal(h.requests.length, 0);
  await h.clock.tick(1);
  assert.equal(h.requests[0].op, 'heartbeat');
  await h.clock.tick(500);
  h.requests[0].resolve(snapshot());
  await h.clock.tick(2500);
  assert.deepEqual(h.requests.map((request) => request.at), [3000, 6000]);
  await h.clock.tick(150_000);
  assert.equal(h.requests.length, 2, '150s server delay must not enqueue 50 heartbeats');
  h.requests[1].resolve(snapshot());
  await h.clock.tick(2999);
  assert.equal(h.requests.length, 2);
  await h.clock.tick(1);
  assert.equal(h.requests.length, 3);
  assert.equal(h.maximumInflight(), 1);
});

test('sync/heartbeat share one lane; burst updates coalesce and cannot starve heartbeat', async () => {
  const h = uiHarness();
  await h.open();
  h.subscriptions[0].onReady();
  assert.equal(h.requests[0].op, 'sync');
  assert.equal(h.requests[0].options.retry, false);
  for (let i = 0; i < 100; i += 1) h.subscriptions[0].listener({ type:'room' });
  await h.clock.tick(10_000);
  assert.equal(h.requests.length, 1);
  h.requests[0].resolve(snapshot({ version:2 }));
  await h.clock.tick(0);
  assert.equal(h.requests[1].op, 'heartbeat', 'overdue heartbeat also fetches the queued state');
  h.requests[1].resolve(snapshot({ version:3 }));
  await h.clock.tick(0);
  assert.equal(h.requests.length, 2, 'burst is consumed by one fresh snapshot');
  assert.equal(h.maximumInflight(), 1);
});

test('a notification arriving during sync is replayed once, with a bounded minimum sync gap', async () => {
  const h = uiHarness();
  await h.open();
  h.subscriptions[0].listener();
  for (let i = 0; i < 200; i += 1) h.subscriptions[0].listener();
  h.requests[0].resolve(snapshot());
  await h.clock.tick(249);
  assert.equal(h.requests.length, 1);
  await h.clock.tick(1);
  assert.equal(h.requests[1].op, 'sync');
  h.requests[1].resolve(snapshot({ version:2, name:'최신 파티원' }));
  await h.clock.tick(249);
  assert.equal(h.requests.length, 2);
  assert.match(h.html(), /최신 파티원/);
});

test('outage backoff survives Realtime storms, notifies once, and resets after recovery', async () => {
  const h = uiHarness();
  await h.open();
  h.subscriptions[0].onReady();
  for (const delay of [3000, 6000, 12000, 24000, 30000, 30000]) {
    const count = h.requests.length;
    h.requests.at(-1).reject(Object.assign(new Error('server busy'), { code:'TEMPORARY_UNAVAILABLE' }));
    await flush();
    for (let i = 0; i < 200; i += 1) h.subscriptions[0].listener();
    await h.clock.tick(delay - 1);
    assert.equal(h.requests.length, count);
    await h.clock.tick(1);
    assert.equal(h.requests.length, count + 1);
  }
  assert.equal(h.toasts.length, 1);
  assert.equal(h.maximumInflight(), 1);
  h.requests.at(-1).resolve(snapshot({ version:7, name:'다시 연결됨' }));
  await h.clock.tick(0);
  assert.match(h.html(), /다시 연결됨/);
  const recoveredCount = h.requests.length;
  await h.clock.tick(2999);
  assert.equal(h.requests.length, recoveredCount);
  await h.clock.tick(1);
  assert.equal(h.requests.length, recoveredCount + 1);
  h.requests.at(-1).reject(new Error('offline again'));
  await h.clock.tick(2999);
  assert.equal(h.requests.length, recoveredCount + 1);
  await h.clock.tick(1);
  assert.equal(h.requests.length, recoveredCount + 2, 'new outage starts at 3s, not the old 30s cap');
});

test('terminal identity/member errors surface and stop automated requests', async () => {
  for (const code of ['UNAUTHENTICATED', 'SESSION_CHANGED', 'NOT_MEMBER', 'ROOM_NOT_FOUND']) {
    const h = uiHarness();
    await h.open();
    await h.clock.tick(3000);
    h.requests[0].reject(Object.assign(new Error(code), { code }));
    await h.clock.tick(120_000);
    assert.equal(h.requests.length, 1);
    assert.deepEqual(h.toasts, [code]);
    assert.equal(h.subscriptions[0].removed, true);
    h.subscriptions[0].onReady();
    assert.equal(h.requests.length, 1);
  }
});

test('terminal failure cancels ready-host countdown and a delayed ready response cannot rearm it', async () => {
  const h = uiHarness();
  const ready = deferred();
  let starts = 0;
  h.partyClient.ready = () => ready.promise;
  h.partyClient.start = async () => { starts += 1; return partySnapshot({ ready:true }); };
  await h.open(partySnapshot({ ready:true }));
  const pendingReady = h.nodes.get('raidReadyBtn').onclick();
  await h.clock.tick(3000);
  h.requests[0].reject(Object.assign(new Error('NOT_MEMBER'), { code:'NOT_MEMBER' }));
  await flush();
  ready.resolve(partySnapshot({ ready:true, version:2 }));
  await pendingReady;
  await h.clock.tick(20_000);
  assert.equal(starts, 0);
  assert.equal(h.requests.length, 1);
  assert.doesNotMatch(h.html(), /raid-countdown/);
  assert.match(h.html(), /NOT_MEMBER/);
  assert.match(h.html(), /id="raidNetworkLeaveBtn"/);
  assert.equal(h.nodes.get('raidReadyBtn').disabled, true);
});

test('late successful start cannot enter a running room after a terminal transport failure', async () => {
  const h = uiHarness();
  const started = deferred();
  h.partyClient.start = () => started.promise;
  h.api.setCountdownSpeed(1, 1000);
  await h.open(partySnapshot({ ready:true }));
  await h.clock.tick(3000);
  h.requests[0].reject(Object.assign(new Error('SESSION_CHANGED'), { code:'SESSION_CHANGED' }));
  await flush();
  started.resolve(partySnapshot({ ready:true, phase:'travel', version:2 }));
  await h.clock.tick(10_000);
  assert.equal(h.api.isRunning(), false);
  assert.equal(h.requests.length, 1);
  assert.match(h.html(), /SESSION_CHANGED/);
  assert.match(h.html(), /id="raidNetworkLeaveBtn"/);
});

test('old ready/formation successes and failures cannot overwrite or repaint a new lobby', async () => {
  for (const [operation, button] of [
    ['ready', 'raidReadyBtn'], ['setFormation', 'raidSaveFormationBtn'],
  ]) {
    for (const rejected of [false, true]) {
      const h = uiHarness();
      const result = deferred();
      h.partyClient[operation] = (roomId) => {
        assert.equal(roomId, 'room-a');
        return result.promise;
      };
      const data = partySnapshot();
      if (operation === 'setFormation') data.members[2].slot = null;
      await h.open(data);
      if (operation === 'setFormation') {
        h.controls.get('pick:carol').onclick();
        h.controls.get('slot:back').onclick();
        assert.equal(h.nodes.get(button).disabled, false);
      }
      const pending = h.nodes.get(button).onclick();
      h.api.leaveNow();
      await h.open(snapshot({ id:'room-b', name:'새 방 유지' }));
      if (rejected) result.reject(new Error('old manual operation failed'));
      else result.resolve(partySnapshot({ version:999, name:'오래된 대형' }));
      await pending;
      h.leaves[0].resolve({ left:true });
      await flush();
      assert.match(h.html(), /새 방 유지/);
      assert.doesNotMatch(h.html(), /오래된 대형|old manual operation failed/);
    }
  }
});

test('leaving/new-room races cannot apply old snapshots, clear new pending state, or close the new UI', async () => {
  const h = uiHarness();
  await h.open();
  h.subscriptions[0].listener();
  h.api.leaveNow();
  assert.equal(h.subscriptions[0].removed, true);
  await h.open(snapshot({ id:'room-b', code:'2002', name:'새 방' }));
  h.subscriptions[1].onReady();
  assert.equal(h.requests.length, 2);
  h.requests[0].resolve(snapshot({ version:999, name:'오래된 방' }));
  h.leaves[0].resolve({ left:true });
  await flush();
  assert.match(h.html(), /새 방/);
  assert.doesNotMatch(h.html(), /오래된 방/);
  h.subscriptions[0].listener();
  h.subscriptions[0].onReady();
  await h.clock.tick(20_000);
  assert.equal(h.requests.length, 2, 'old finally/callbacks must not unlock the new pending request');
  h.requests[1].resolve(snapshot({ id:'room-b', code:'2002', version:2, name:'새 방 최신' }));
  await h.clock.tick(0);
  assert.equal(h.requests.at(-1).roomId, 'room-b');
  assert.match(h.html(), /새 방 최신/);
});

test('old failed entry cannot overwrite a later successful room or show a stale failure modal', async () => {
  const h = uiHarness();
  const first = deferred();
  h.partyClient.create = () => first.promise;
  const pending = h.open();
  await flush();
  h.partyClient.create = async () => snapshot({ id:'room-b', name:'두 번째 방' });
  await h.open();
  first.reject(new Error('old request failed'));
  assert.equal(await pending, false);
  assert.match(h.html(), /두 번째 방/);
  assert.doesNotMatch(h.html(), /old request failed/);
  assert.equal(h.subscriptions.length, 1);
});

test('lower-version responses remain unable to roll roster state backwards', async () => {
  const h = uiHarness();
  await h.open(snapshot({ version:5, name:'현재 멤버' }));
  h.subscriptions[0].listener();
  h.requests[0].resolve(snapshot({ version:4, name:'이전 멤버' }));
  await flush();
  assert.match(h.html(), /현재 멤버/);
  assert.doesNotMatch(h.html(), /이전 멤버/);
});

test('re-SUBSCRIBED fetches missed roster/event state and heartbeat continues from the recovered cursor', async () => {
  const h = uiHarness();
  const initial = snapshot();
  initial.events = [{ sequenceNo:7, round:0 }];
  await h.open(initial);
  h.subscriptions[0].onReady();
  assert.equal(h.requests[0].afterSequence, 7);
  const synced = snapshot({ version:2 });
  synced.events = [{ sequenceNo:8, round:0 }];
  h.requests[0].resolve(synced);
  await h.clock.tick(250);
  h.subscriptions[0].onReady();
  assert.equal(h.requests[1].op, 'sync');
  assert.equal(h.requests[1].afterSequence, 8);
  const recovered = partySnapshot({ version:3, name:'복구한 파티' });
  recovered.events = [{ sequenceNo:10, round:0 }];
  h.requests[1].resolve(recovered);
  await h.clock.tick(2750);
  assert.equal(h.requests[2].op, 'heartbeat');
  assert.equal(h.requests[2].afterSequence, 10);
  assert.match(h.html(), /복구한 파티/);
  assert.match(h.html(), /id="raidReadyBtn"/);
});

function clientHarness() {
  const clock = new Clock();
  const channels = [];
  const calls = [];
  const client = {
    functions:{ async invoke(_name, { body }) {
      calls.push(body);
      return { data:{ error:'TEMPORARY_UNAVAILABLE' }, error:null };
    } },
    channel() {
      const channel = {
        handlers:[], removed:false,
        on(_type, filter, handler) { this.handlers.push({ filter, handler }); return this; },
        subscribe(onStatus) { this.onStatus = onStatus; channels.push(this); return this; },
      };
      return channel;
    },
    removeChannel(channel) { channel.removed = true; },
  };
  const context = { setTimeout:clock.setTimeout };
  context.window = context;
  vm.runInNewContext(clientSource, context);
  return {
    clock, channels, calls,
    api:context.YuksamRaidPartyClient.create({ client, getIdentity:() => ({ userId:'alice' }) }),
  };
}

function memberRow(overrides = {}) {
  return {
    room_id:'room-a', user_id:'alice', active:true, ready:false, slot:'front', join_order:1,
    profile_snapshot:{ name:'앨리스' }, combat_state:{ hp:40, shield:0 },
    playback_round:0, question_ready_round:0, joined_at:'start', last_seen_at:'seen',
    ...overrides,
  };
}

test('only heartbeat timestamps are suppressed; all member changes work without full OLD replicas', () => {
  const h = clientHarness();
  const received = [];
  const unsubscribe = h.api.subscribe('room-a', (message) => received.push(message));
  const channel = h.channels[0];
  const member = channel.handlers.find(({ filter }) => filter.table === 'raid_room_members_v1').handler;
  const deliver = (row, eventType = 'UPDATE') => member({
    eventType, new:row, old:{ room_id:'room-a', user_id:'alice' },
  });
  const baseline = memberRow();
  deliver(baseline);
  for (let i = 0; i < 200; i += 1) deliver({ ...baseline, last_seen_at:`seen-${i}` });
  assert.equal(received.length, 1, 'unknown first NEW row refreshes; repeated heartbeats do not');
  deliver(memberRow({ combat_state:{ shield:0, hp:40 }, last_seen_at:'later' }));
  assert.equal(received.length, 1, 'JSON key order is not a state change');
  for (const change of [
    { ready:true }, { slot:'middle' }, { playback_round:1 }, { question_ready_round:1 },
    { combat_state:{ hp:25, shield:0 } }, { profile_snapshot:{ name:'바뀐 이름' } },
    { active:false }, { joined_at:'rejoined' }, { future_semantic_field:true },
  ]) {
    const count = received.length;
    deliver(memberRow(change));
    assert.equal(received.length, count + 1);
  }
  deliver(memberRow({ user_id:'bob' }), 'INSERT');
  deliver(null, 'DELETE');
  const count = received.length;
  deliver({ user_id:'alice', last_seen_at:'partial' });
  deliver({ user_id:'alice', last_seen_at:'partial' });
  assert.equal(received.length, count + 2, 'partial NEW payload is never assumed heartbeat-only');
  unsubscribe();
  deliver(memberRow({ ready:true }));
  assert.equal(received.length, count + 2);
  assert.equal(channel.removed, true);
});

test('resubscribe requests recovery sync, resets NEW baselines, and ignores disposed channel callbacks', () => {
  const h = clientHarness();
  const received = [];
  let ready = 0;
  h.api.subscribe('room-a', (message) => received.push(message), () => { ready += 1; });
  const channel = h.channels[0];
  const member = channel.handlers.find(({ filter }) => filter.table === 'raid_room_members_v1').handler;
  const room = channel.handlers.find(({ filter }) => filter.table === 'raid_rooms_v1').handler;
  const event = channel.handlers.find(({ filter }) => filter.table === 'raid_events_v1').handler;
  channel.onStatus('SUBSCRIBED');
  member({ eventType:'UPDATE', new:memberRow() });
  channel.onStatus('CHANNEL_ERROR');
  channel.onStatus('SUBSCRIBED');
  member({ eventType:'UPDATE', new:memberRow() });
  assert.equal(ready, 2);
  assert.equal(received.length, 2);
  room({ new:{ id:'room-a', version:2 } });
  event({ new:{ sequence_no:5, round_no:1, event:{} } });
  event({ new:{ sequence_no:5, round_no:1, event:{} } });
  assert.equal(received.length, 4);
  h.api.close();
  channel.onStatus('SUBSCRIBED');
  room({ new:{ id:'room-a', version:3 } });
  event({ new:{ sequence_no:6, round_no:1, event:{} } });
  assert.equal(ready, 2);
  assert.equal(received.length, 4);
});

test('background failures have no hidden immediate retry; manual sync/mutations retain one retry', async () => {
  const h = clientHarness();
  await assert.rejects(h.api.heartbeat('room-a'), { code:'TEMPORARY_UNAVAILABLE' });
  await assert.rejects(h.api.sync('room-a', 0, { retry:false }), { code:'TEMPORARY_UNAVAILABLE' });
  assert.equal(h.calls.length, 2);
  assert.equal(h.clock.timers.size, 0);
  const manual = assert.rejects(h.api.sync('room-a'), { code:'TEMPORARY_UNAVAILABLE' });
  await h.clock.tick(350);
  await manual;
  assert.equal(h.calls.length, 4);
  const ready = assert.rejects(h.api.ready('room-a'), { code:'TEMPORARY_UNAVAILABLE' });
  await h.clock.tick(350);
  await ready;
  assert.equal(h.calls.length, 6);
});
