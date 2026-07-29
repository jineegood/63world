import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const storeUrl = pathToFileURL(path.join(root, 'supabase/functions/_shared/pvp-store.mjs'));

test('disconnect decisions pause, resume, forfeit, or cancel a match after the grace period', async () => {
  const { decideDisconnectV1 } = await import(storeUrl.href);
  const now = 100_000;
  const match = {
    phase:'question',
    deadline:now + 12_000,
    playerAId:'a',
    playerBId:'b',
  };

  assert.deepEqual(
    decideDisconnectV1(match, { a:now - 11_000, b:now - 1_000 }, now),
    {
      type:'reconnect',
      disconnectedUserId:'a',
      reconnectDeadline:now + 30_000,
      resumePhase:'question',
      pausedQuestionMs:12_000,
    },
  );

  assert.deepEqual(
    decideDisconnectV1({
      ...match,
      phase:'reconnect',
      disconnectedUserId:'a',
      reconnectDeadline:now + 15_000,
      resumePhase:'question',
      pausedQuestionMs:12_000,
    }, { a:now, b:now }, now),
    { type:'resume', phase:'question', deadline:now + 12_000 },
  );

  assert.deepEqual(
    decideDisconnectV1({
      ...match,
      phase:'reconnect',
      disconnectedUserId:'a',
      reconnectDeadline:now - 1,
    }, { a:now - 40_000, b:now }, now),
    { type:'finish', winnerId:'b', loserId:'a', reason:'disconnect' },
  );

  assert.deepEqual(
    decideDisconnectV1({
      ...match,
      phase:'reconnect',
      disconnectedUserId:null,
      reconnectDeadline:now - 1,
    }, { a:now - 40_000, b:now - 40_000 }, now),
    { type:'cancel', reason:'both_disconnected' },
  );
});

test('event replay store reads ordered rows after a clamped sequence and strips private fields', async () => {
  const { createSupabasePvpStore } = await import(storeUrl.href);
  const calls = [];
  const rows = [
    {
      round_no:2,
      sequence_no:2000,
      event:{
        id:'m1:2:action',
        kind:'action',
        source:'a',
        correct:false,
        correctAnswer:'5',
        submittedAnswer:'4',
      },
    },
    {
      round_no:2,
      sequence_no:2001,
      event:{
        id:'m1:2:damage',
        kind:'damage',
        amount:5,
        correctAnswer:'should-not-leak',
        answerKey:'should-not-leak',
      },
    },
  ];
  const query = {
    select(value) { calls.push(['select', value]); return this; },
    eq(column, value) { calls.push(['eq', column, value]); return this; },
    gt(column, value) { calls.push(['gt', column, value]); return this; },
    order(column, value) { calls.push(['order', column, value]); return this; },
    limit(value) { calls.push(['limit', value]); return this; },
    then(resolve, reject) {
      return Promise.resolve({ data:rows, error:null }).then(resolve, reject);
    },
  };
  const store = createSupabasePvpStore({
    from(table) {
      calls.push(['from', table]);
      return query;
    },
  });

  assert.deepEqual(await store.listEventsAfter('m1', -99), [
    {
      id:'m1:2:action',
      kind:'action',
      source:'a',
      correct:false,
      correctAnswer:'5',
      round:2,
      sequenceNo:2000,
    },
    {
      id:'m1:2:damage',
      kind:'damage',
      amount:5,
      round:2,
      sequenceNo:2001,
    },
  ]);
  assert.deepEqual(calls, [
    ['from', 'pvp_match_events_v1'],
    ['select', 'round_no,sequence_no,event'],
    ['eq', 'match_id', 'm1'],
    ['gt', 'sequence_no', 0],
    ['order', 'sequence_no', { ascending:true }],
    ['limit', 500],
  ]);
});

test('invite maintenance expires only stale requests involving the two participants', async () => {
  const { createSupabasePvpStore } = await import(storeUrl.href);
  const calls = [];
  const makeQuery = () => ({
    update(value) { calls.push(['update', value]); return this; },
    eq(column, value) { calls.push(['eq', column, value]); return this; },
    lte(column, value) { calls.push(['lte', column, value]); return this; },
    in(column, value) { calls.push(['in', column, value]); return this; },
    then(resolve, reject) {
      return Promise.resolve({ data:[], error:null }).then(resolve, reject);
    },
  });
  const store = createSupabasePvpStore({
    from(table) {
      calls.push(['from', table]);
      return makeQuery();
    },
  });

  await store.expirePendingInvitesForUsers(['a', 'b', 'a'], 5000);
  const expiresAt = new Date(5000).toISOString();
  assert.deepEqual(calls, [
    ['from', 'pvp_invites_v1'],
    ['update', { status:'expired' }],
    ['eq', 'status', 'pending'],
    ['lte', 'expires_at', expiresAt],
    ['in', 'challenger_id', ['a', 'b']],
    ['from', 'pvp_invites_v1'],
    ['update', { status:'expired' }],
    ['eq', 'status', 'pending'],
    ['lte', 'expires_at', expiresAt],
    ['in', 'target_id', ['a', 'b']],
  ]);
});

test('presence backfill reads only the target current pending invitation', async () => {
  const { createSupabasePvpStore } = await import(storeUrl.href);
  const calls = [];
  const invite = {
    id:'invite-1', challenger_id:'a', target_id:'b', status:'pending',
  };
  const query = {
    select(value) { calls.push(['select', value]); return this; },
    eq(column, value) { calls.push(['eq', column, value]); return this; },
    gt(column, value) { calls.push(['gt', column, value]); return this; },
    order(column, value) { calls.push(['order', column, value]); return this; },
    limit(value) { calls.push(['limit', value]); return this; },
    async maybeSingle() { return { data:invite, error:null }; },
  };
  const store = createSupabasePvpStore({
    from(table) {
      calls.push(['from', table]);
      return query;
    },
  });

  assert.equal(await store.getPendingInviteForTarget('b', 5000), invite);
  assert.deepEqual(calls, [
    ['from', 'pvp_invites_v1'],
    ['select', '*'],
    ['eq', 'target_id', 'b'],
    ['eq', 'status', 'pending'],
    ['gt', 'expires_at', new Date(5000).toISOString()],
    ['order', 'created_at', { ascending:false }],
    ['limit', 1],
  ]);
});

test('repeating the same invite request id returns its existing invitation without inserting twice', async () => {
  const { createSupabasePvpStore } = await import(storeUrl.href);
  let insertCalls = 0;
  const existing = {
    id:'invite-1',
    challenger_id:'a',
    target_id:'b',
    request_id:'same-request',
    status:'pending',
  };
  const client = {
    from(table) {
      assert.equal(table, 'pvp_invites_v1');
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() { return { data:existing, error:null }; },
        insert() { insertCalls += 1; return this; },
        single() { return Promise.resolve({ data:existing, error:null }); },
      };
    },
  };
  const store = createSupabasePvpStore(client);
  const result = await store.createInvite({
    challengerId:'a',
    targetId:'b',
    requestId:'same-request',
    expiresAt:10000,
  });
  assert.equal(result.id, 'invite-1');
  assert.equal(insertCalls, 0);
});

test('new invitation creation uses the participant-locking transaction RPC', async () => {
  const { createSupabasePvpStore } = await import(storeUrl.href);
  const calls = [];
  const created = {
    id:'invite-new',
    challenger_id:'a',
    target_id:'b',
    request_id:'request-new',
    status:'pending',
  };
  const client = {
    from(table) {
      assert.equal(table, 'pvp_invites_v1');
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() { return { data:null, error:null }; },
      };
    },
    async rpc(name, args) {
      calls.push([name, args]);
      return { data:created, error:null };
    },
  };
  const store = createSupabasePvpStore(client);
  assert.equal(await store.createInvite({
    challengerId:'a',
    targetId:'b',
    requestId:'request-new',
    requestedAt:5000,
    expiresAt:25000,
  }), created);
  assert.deepEqual(calls, [[
    'private_create_pvp_invite_v2',
    {
      p_challenger_id:'a',
      p_target_id:'b',
      p_request_id:'request-new',
      p_requested_at:new Date(5000).toISOString(),
    },
  ]]);
});

test('repeating acceptance of an accepted invite returns its existing public match', async () => {
  const { createSupabasePvpStore } = await import(storeUrl.href);
  const rows = {
    pvp_invites_v1:{
      id:'invite-1',
      challenger_id:'a',
      target_id:'b',
      status:'accepted',
      match_id:'match-1',
      expires_at:'2026-07-30T00:00:20Z',
    },
    pvp_matches_v1:{
      id:'match-1',
      player_a_id:'a',
      player_b_id:'b',
      phase:'question',
      round_no:1,
      player_a_state:{ hp:22 },
      player_b_state:{ hp:35 },
      question_public:{ prompt:'2+2' },
    },
    pvp_match_secrets_v1:{ answer_key:'4' },
  };
  const client = {
    from(table) {
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() { return { data:rows[table] || null, error:null }; },
      };
    },
  };
  const store = createSupabasePvpStore(client);
  const result = await store.respondToInvite(
    'b',
    { inviteId:'invite-1', accept:true },
    Date.parse('2026-07-30T00:00:10Z'),
    () => 0,
    {},
  );
  assert.equal(result.accepted, true);
  assert.equal(result.recovered, true);
  assert.equal(result.match.id, 'match-1');
  assert.equal(Object.hasOwn(result.match, 'answerKey'), false);
});

test('pending invitation acceptance creates match and answer in one transaction RPC', async () => {
  const { createSupabasePvpStore } = await import(storeUrl.href);
  const calls = [];
  const rows = {
    pvp_invites_v1:{
      id:'invite-1',
      challenger_id:'a',
      target_id:'b',
      status:'pending',
      expires_at:'2026-07-30T00:00:20Z',
    },
    pvp_matches_v1:{
      id:'match-1',
      player_a_id:'a',
      player_b_id:'b',
      phase:'question',
      round_no:1,
      player_a_state:{ userId:'a', hp:22, maxHp:22 },
      player_b_state:{ userId:'b', hp:22, maxHp:22 },
      question_public:{ prompt:'2+2' },
    },
    pvp_match_secrets_v1:{ answer_key:'4' },
    shared_state_v2:{
      data:[{ enabled:true, questions:[{ id:'q1', prompt:'2+2', answer:'4' }] }],
    },
  };
  const profiles = {
    a:{
      display_name:'A',
      data:{ name:'A', class:'warrior', exp:0, inventory:[], equipment:{}, skills:{} },
    },
    b:{
      display_name:'B',
      data:{ name:'B', class:'warrior', exp:0, inventory:[], equipment:{}, skills:{} },
    },
  };
  const client = {
    from(table) {
      let selectedId = '';
      return {
        select() { return this; },
        eq(column, value) {
          if (column === 'user_id' || column === 'id' || column === 'key') selectedId = value;
          return this;
        },
        async maybeSingle() {
          if (table === 'player_profiles_v2') {
            return { data:profiles[selectedId] || null, error:null };
          }
          return { data:rows[table] || null, error:null };
        },
      };
    },
    async rpc(name, args) {
      calls.push([name, args]);
      return { data:{ match_id:'match-1', created:true }, error:null };
    },
  };
  const store = createSupabasePvpStore(client);
  const result = await store.respondToInvite(
    'b',
    { inviteId:'invite-1', accept:true },
    Date.parse('2026-07-30T00:00:10Z'),
    () => 0,
    {
      normalizeSnapshot:(profile) => ({ ...profile }),
      selectQuestion:() => ({ id:'q1', prompt:'2+2', answer:'4' }),
      publicQuestion:(question) => ({ id:question.id, prompt:question.prompt }),
    },
  );
  assert.equal(result.accepted, true);
  assert.equal(result.recovered, false);
  assert.equal(result.match.id, 'match-1');
  assert.equal(Object.hasOwn(result.match, 'answerKey'), false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'private_accept_pvp_invite_v2');
  assert.equal(calls[0][1].p_invite_id, 'invite-1');
  assert.equal(calls[0][1].p_user_id, 'b');
  assert.deepEqual(calls[0][1].p_question_public, { id:'q1', prompt:'2+2' });
  assert.equal(calls[0][1].p_answer_key, '4');
});

test('first PvP profile use shows one tutorial with green key phrases before opening the profile', async () => {
  const tutorialSource = fs.readFileSync(path.join(root, 'src/tutorial.js'), 'utf8');
  const uiSource = fs.readFileSync(path.join(root, 'src/pvp-ui.js'), 'utf8');
  const opened = [];
  const calls = [];
  let seen = false;
  const window = {
    openModal:(html, options) => opened.push({ html, options }),
    closeModal:() => {},
    tutorialGreenV1:null,
    getPvpClientV1:() => ({
      async profile() {
        calls.push('profile');
        return { userId:'b', name:'B', level:1, className:'warrior', wins:0, losses:0, pvpAvailable:true };
      },
    }),
    shouldShowPvpTutorialV1:() => !seen,
    markPvpTutorialSeenV1:() => { seen = true; calls.push('seen'); },
    renderPlayerPortraitForPvpV1:() => {},
    toast:() => {},
  };
  const document = { getElementById:() => null };
  const context = {
    window, document,
    setInterval:() => 1,
    clearInterval() {},
  };
  vm.runInNewContext(tutorialSource, context);
  vm.runInNewContext(uiSource, context);

  await window.openRemoteProfileV1('b');
  assert.equal(calls.includes('profile'), false);
  for (const [step, phrases] of [
    [0, ['오른쪽 클릭', '대전 신청']],
    [1, ['20초']],
    [2, ['30면체 주사위', '항복']],
  ]) {
    window.__pvpTutorialStepV1(step);
    for (const phrase of phrases) {
      assert.match(opened.at(-1).html, new RegExp(`<strong class="quest-keyword-green">${phrase}</strong>`));
    }
  }

  await window.__pvpTutorialDoneV1();
  assert.deepEqual(calls, ['seen', 'profile']);
  await window.openRemoteProfileV1('b');
  assert.deepEqual(calls, ['seen', 'profile', 'profile']);
});

test('game persists the one-time PvP tutorial flag on the player record', () => {
  const source = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
  assert.match(source, /shouldShowPvpTutorialV1\s*=\s*\(\)\s*=>\s*!!game\.player\s*&&\s*!game\.player\.pvpTutorialSeen/);
  assert.match(source, /markPvpTutorialSeenV1[\s\S]{0,180}pvpTutorialSeen\s*=\s*true[\s\S]{0,180}savePlayer/);
});
