import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/raid-party-client.js'), 'utf8');

function harness({ liveUserId = 'student-a' } = {}) {
  const invokes = [];
  const channels = [];
  const removed = [];
  const client = {
    auth:{ async getUser() { return { data:{ user:{ id:liveUserId } }, error:null }; } },
    functions:{ async invoke(name, options) {
      invokes.push({ name, body:options.body });
      return { data:{ data:{ ok:true } }, error:null };
    } },
    channel(name) {
      const handlers = [];
      const channel = {
        name,
        on(type, filter, handler) { handlers.push({ type, filter, handler }); return channel; },
        subscribe(onStatus) { channels.push({ channel, handlers, onStatus }); return channel; },
      };
      return channel;
    },
    removeChannel(channel) { removed.push(channel.name); },
  };
  const window = { setTimeout:(callback) => callback() };
  vm.runInNewContext(source, { window, globalThis:window });
  const api = window.YuksamRaidPartyClient.create({
    client,
    getIdentity:() => ({ userId:'student-a', displayName:'별빛', role:'student' }),
  });
  return { api, invokes, channels, removed };
}

test('raid room client exposes the complete three-player room API through one authenticated endpoint', async () => {
  const { api, invokes } = harness();
  await api.create({ floorGroup:1, profile:{ attack:999999 } });
  await api.join({ code:'1234', profile:{ name:'별빛' } });
  await api.resume();
  await api.sync('room-1', 9);
  await api.setFormation('room-1', { a:'front', b:'middle', c:'back' });
  await api.ready('room-1', true);
  await api.start('room-1');
  await api.beginRound('room-1', { prompt:'1+1=?', choices:['1', '2'] }, '2');
  await api.submit('room-1', 1, 'basic', '2');
  await api.publishRound('room-1', 1, { nextPhase:'effects', events:[] }, 'stable-publish-1');
  await api.ackPlayback('room-1', 1, 12);
  await api.heartbeat('room-1', 12);
  await api.leave('room-1');

  assert.equal(invokes.length, 13);
  assert.equal(invokes.every((entry) => entry.name === 'raid-room-v1'), true);
  assert.deepEqual(invokes.map((entry) => entry.body.op), [
    'create', 'join', 'resume', 'sync', 'setFormation', 'ready', 'start',
    'beginRound', 'submit', 'publishRound', 'ackPlayback', 'heartbeat', 'leave',
  ]);
  assert.equal(invokes[0].body.floorGroup, 1);
  assert.equal(invokes[1].body.code, '1234');
  assert.equal(invokes.every((entry) => !('profile' in entry.body)), true);
  assert.equal(invokes[3].body.afterSequence, 9);
  assert.equal(invokes[9].body.requestId, 'stable-publish-1');
  assert.equal(invokes[10].body.afterSequence, 12);
  assert.equal(invokes[11].body.afterSequence, 12);
  assert.equal(invokes.every((entry) => !('userId' in entry.body)), true);
});

test('create and join automatically resume the authenticated active room', async () => {
  const calls = [];
  const window = { setTimeout:(callback) => callback() };
  vm.runInNewContext(source, { window, globalThis:window });
  const api = window.YuksamRaidPartyClient.create({
    client:{
      auth:{ getUser:async () => ({ data:{ user:{ id:'student-a' } }, error:null }) },
      functions:{ invoke:async (_name, options) => {
        calls.push(options.body);
        if (options.body.op === 'create' || options.body.op === 'join') {
          return { data:{ error:'ALREADY_IN_ROOM' }, error:null };
        }
        return { data:{ data:{ room:{ id:'room-existing' }, members:[], events:[] } }, error:null };
      } },
    },
    getIdentity:() => ({ userId:'student-a' }),
  });

  const created = await api.create({ floorGroup:1 });
  const joined = await api.join({ code:'1234' });

  assert.equal(created.room.id, 'room-existing');
  assert.equal(joined.room.id, 'room-existing');
  /* 방 참가는 이미 들어가 있는 방으로 돌아간다(끊겼다 돌아온 경우).
     방 만들기는 새로 시작하겠다는 뜻이라 예전 방을 정리하고 다시 만든다.
     여기서는 정리해도 계속 막히는 서버를 흉내 내므로, 오류로 끝내지 않고
     들어가 있던 방으로 돌려보내야 한다(갇히면 안 된다). */
  assert.deepEqual(calls.map((body) => body.op),
    ['create', 'resume', 'leave', 'create', 'join', 'resume']);
  assert.equal(calls.every((body) => !('userId' in body)), true);
});

test('mutating room ownership requests stop if another tab changed the authenticated account', async () => {
  const { api, invokes } = harness({ liveUserId:'student-other' });
  await assert.rejects(
    api.create({ floorGroup:1 }),
    (error) => error.code === 'SESSION_CHANGED',
  );
  await assert.rejects(
    api.publishRound('room-1', 1, { nextPhase:'effects', events:[] }),
    (error) => error.code === 'SESSION_CHANGED',
  );
  assert.equal(invokes.length, 0);
});

test('raid subscription listens only to one room, deduplicates events, and removes its channel', () => {
  const { api, channels, removed } = harness();
  const received = [];
  let ready = false;
  const unsubscribe = api.subscribe('room-1', (message) => received.push(message), () => { ready = true; });
  const registration = channels[0];
  assert.deepEqual(registration.handlers.map((entry) => entry.filter.table), [
    'raid_rooms_v1', 'raid_room_members_v1', 'raid_events_v1',
  ]);
  assert.equal(registration.handlers.every((entry) => entry.filter.filter === 'room_id=eq.room-1'
    || entry.filter.filter === 'id=eq.room-1'), true);
  registration.onStatus('SUBSCRIBED');
  assert.equal(ready, true);

  const eventHandler = registration.handlers.find((entry) => entry.filter.table === 'raid_events_v1').handler;
  eventHandler({ new:{ sequence_no:4, round_no:2, event:{ kind:'damage' } } });
  eventHandler({ new:{ sequence_no:4, round_no:2, event:{ kind:'damage' } } });
  eventHandler({ new:{ sequence_no:5, round_no:2, event:{ kind:'heal' } } });
  assert.deepEqual(received.map((entry) => entry.sequenceNo), [4, 5]);

  unsubscribe();
  assert.deepEqual(removed, ['raid-room-room-1']);
});

test('known server codes are shown instead of a generic connection failure', async () => {
  const window = { setTimeout:(callback) => callback() };
  vm.runInNewContext(source, { window, globalThis:window });
  const response = { clone() { return this; }, async json() { return { error:'ROOM_FULL' }; } };
  const api = window.YuksamRaidPartyClient.create({
    client:{
      auth:{ getUser:async () => ({ data:{ user:{ id:'a' } }, error:null }) },
      functions:{ invoke:async () => ({
        data:null,
        error:{ message:'Edge Function returned a non-2xx status code', context:response },
      }) },
    },
    getIdentity:() => ({ userId:'a' }),
  });
  await assert.rejects(api.join({ code:'1234' }), (error) => (
    error.code === 'ROOM_FULL' && error.message.includes('3명')
  ));
});
