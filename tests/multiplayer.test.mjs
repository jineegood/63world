import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const coreSource = () => fs.readFileSync(path.join(root, 'src/multiplayer-core.js'), 'utf8');
const multiplayerSource = () => fs.readFileSync(path.join(root, 'src/multiplayer.js'), 'utf8');

test('Supabase REST configuration normalizes to one Realtime websocket endpoint', () => {
  const window = {};
  vm.runInNewContext(coreSource(), { window, URL });
  assert.equal(
    window.YuksamMultiplayerCore.realtimeWebSocketUrl(
      'https://example.supabase.co/rest/v1/',
      'public key',
    ),
    'wss://example.supabase.co/realtime/v1/websocket?apikey=public+key&vsn=1.0.0',
  );
});

test('two mocked browser sessions exchange positions and chat', async () => {
  const sockets = [];
  class FakeWebSocket {
    static OPEN = 1;
    constructor(url) {
      this.url = url;
      this.readyState = 1;
      sockets.push(this);
      queueMicrotask(() => this.onopen?.());
    }
    send(raw) {
      const message = JSON.parse(raw);
      if (message.event === 'phx_join') {
        queueMicrotask(() => this.onmessage?.({ data:JSON.stringify({
          topic:message.topic,
          event:'phx_reply',
          payload:{ status:'ok', response:{} },
        }) }));
        return;
      }
      if (message.event === 'broadcast') {
        sockets.forEach((socket) => queueMicrotask(() => socket.onmessage?.({ data:JSON.stringify({
          topic:message.topic,
          event:'broadcast',
          payload:message.payload,
        }) })));
      }
    }
    close() {
      this.readyState = 3;
    }
  }

  function createSession(name, x) {
    const intervals = [];
    const chats = [];
    const canvasListeners = new Map();
    const layers = [];
    const window = {
      YUKSAM_CLOUD:{ url:'https://example.supabase.co/rest/v1/', anonKey:'x'.repeat(30) },
      addEventListener() {},
      appendChatMessage:(type, sender, message) => chats.push({ type, sender, message }),
      getPvpIdentityV1:() => ({ userId:`id-${name}`, displayName:name, role:'student' }),
      openRemoteProfileV1:(userId) => chats.push({ type:'profile', userId }),
    };
    const game = {
      player:{ name, x, y:200, level:1, class:'warrior', equipment:{}, appearance:{}, costume:{ hat:'blue-cap' } },
      currentMap:'town',
      isMoving:false,
      currentCombatMonsterId:null,
      modalState:{ pause:false },
      canvas:{
        addEventListener:(type, fn) => canvasListeners.set(type, fn),
        getBoundingClientRect:() => ({ left:0, top:0, width:800, height:450 }),
        width:800, height:450,
      },
      width:800, height:450,
      ctx:{
        save() {}, restore() {}, measureText:() => ({ width:50 }),
        beginPath() {}, roundRect() {}, fill() {}, fillText() {},
      },
    };
    const context = {
      window,
      game,
      URL,
      WebSocket:FakeWebSocket,
      document:{ querySelector:() => ({}) },
      Date,
      Math,
      JSON,
      setInterval:(fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
      clearInterval() {},
      setTimeout:() => 1,
      clearTimeout() {},
      worldRenderPipeline:{ registerLayer(layer) { layers.push(layer); } },
      drawPlayerSprite() {},
      worldToScreen:(px, py) => ({ x:px, y:py }),
      PLAYER_WORLD_SCALE:1.26,
    };
    vm.runInNewContext(coreSource(), context);
    vm.runInNewContext(multiplayerSource(), context);
    return { window, game, intervals, chats, canvasListeners, layers };
  }

  const first = createSession('첫째', 100);
  const second = createSession('둘째', 300);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(first.window.__multiplayerStatusV53, 'online');
  assert.equal(second.window.__multiplayerStatusV53, 'online');

  first.intervals.find((entry) => entry.ms === 220).fn();
  second.intervals.find((entry) => entry.ms === 220).fn();
  await Promise.resolve();
  assert.equal(first.window.__remotePlayersV53.get('둘째').x, 300);
  assert.equal(second.window.__remotePlayersV53.get('첫째').x, 100);
  assert.equal(first.window.__remotePlayersV53.get('둘째').userId, 'id-둘째');
  assert.equal(first.window.__remotePlayersV53.get('둘째').costume.hat, 'blue-cap');
  assert.equal(first.window.__remotePlayersV53.get('둘째').pvpAvailable, true);

  first.window.__mpBroadcastChatV53('안녕!');
  await Promise.resolve();
  assert.deepEqual(second.chats.at(-1), { type:'user', sender:'첫째', message:'안녕!' });

  first.layers[0].render();
  const contextmenu = first.canvasListeners.get('contextmenu');
  let prevented = false;
  contextmenu({ clientX:300, clientY:200, preventDefault:() => { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(first.chats.at(-1), { type:'profile', userId:'id-둘째' });
});
