/* v53: 실시간 멀티플레이 — 같은 맵의 다른 학생을 화면에 표시하고 채팅을 공유한다.
   Supabase Realtime Broadcast 사용(DB 저장 없음 → 무료 한도 넉넉).
   설정(src/cloud-config.js)이 비어 있으면 완전히 비활성(싱글 플레이와 동일). */
(function multiplayerV53() {
  if (window.__MULTIPLAYER_V53__) return;
  window.__MULTIPLAYER_V53__ = true;

  const cfg = window.YUKSAM_CLOUD || {};
  const multiplayerCore = window.YuksamMultiplayerCore;
  const enabled = typeof cfg.url === 'string' && cfg.url.startsWith('http')
    && typeof cfg.anonKey === 'string' && cfg.anonKey.length > 20
    && typeof multiplayerCore?.realtimeWebSocketUrl === 'function';
  const SEND_MS = 220;       // 내 위치 전송 주기
  const STALE_MS = 6000;     // 이 시간 동안 소식 없으면 화면에서 제거
  const remotes = new Map(); // name -> { x, y, map, class, spec, level, equipment, appearance, moving, bubble, at }

  window.__remotePlayersV53 = remotes;
  window.__multiplayerStatusV53 = enabled ? 'connecting' : 'off';
  if (!enabled) return;

  const g = () => (typeof game !== 'undefined' ? game : window.__G);
  let socket = null, ref = 0, joined = false, lastSent = 0, heartbeat = null;
  const TOPIC = 'realtime:yuksam-world';

  function connect() {
    const wsUrl = multiplayerCore.realtimeWebSocketUrl(cfg.url, cfg.anonKey);
    if (!wsUrl) { window.__multiplayerStatusV53 = 'offline'; return; }
    try { socket = new WebSocket(wsUrl); } catch { window.__multiplayerStatusV53 = 'offline'; return; }
    socket.onopen = () => {
      send({ topic: TOPIC, event: 'phx_join', payload: { config: { broadcast: { self: false } } } });
      heartbeat = setInterval(() => send({ topic: 'phoenix', event: 'heartbeat', payload: {} }), 25000);
    };
    socket.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.event === 'phx_reply' && msg.topic === TOPIC) { joined = true; window.__multiplayerStatusV53 = 'online'; return; }
      if (msg.event !== 'broadcast') return;
      const p = msg.payload?.payload || msg.payload;
      if (!p || !p.name) return;
      const me = g()?.player?.name;
      if (p.name === me) return;
      if (p.type === 'leave') { remotes.delete(p.name); return; }
      if (p.type === 'chat') {
        const prev = remotes.get(p.name) || {};
        remotes.set(p.name, { ...prev, name: p.name, bubble: { text: p.text, until: Date.now() + 4200 }, at: Date.now() });
        try { window.appendChatMessage?.('user', p.name, p.text); } catch {}
        return;
      }
      remotes.set(p.name, { ...(remotes.get(p.name) || {}), ...p, at: Date.now() });
    };
    socket.onclose = () => {
      window.__multiplayerStatusV53 = 'offline'; joined = false;
      if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
      setTimeout(connect, 3000); // 자동 재접속
    };
    socket.onerror = () => { try { socket.close(); } catch {} };
  }

  function send(obj) {
    if (!socket || socket.readyState !== 1) return;
    try { socket.send(JSON.stringify({ ref: String(++ref), join_ref: '1', ...obj })); } catch {}
  }
  function broadcast(payload) {
    if (!joined) return;
    send({ topic: TOPIC, event: 'broadcast', payload: { type: 'broadcast', event: 'p', payload } });
  }
  window.__mpBroadcastChatV53 = function (text) {
    const G = g(); if (!G?.player) return;
    broadcast({ type: 'chat', name: G.player.name, text: String(text).slice(0, 120) });
  };

  function tick() {
    const G = g();
    const now = Date.now();
    remotes.forEach((v, k) => { if (now - (v.at || 0) > STALE_MS) remotes.delete(k); });
    if (G?.player && now - lastSent >= SEND_MS && document.querySelector('#game.active')) {
      lastSent = now;
      broadcast({
        type: 'pos',
        name: G.player.name,
        map: G.currentMap,
        x: Math.round(G.player.x), y: Math.round(G.player.y),
        level: G.player.level, class: G.player.class, spec: G.player.spec || null,
        equipment: G.player.equipment || {}, appearance: G.player.appearance || {},
        moving: !!G.isMoving,
      });
    }
  }
  setInterval(tick, SEND_MS);
  window.addEventListener('beforeunload', () => {
    const G = g();
    if (G?.player) broadcast({ type: 'leave', name: G.player.name });
  });
  connect();

  /* ── 렌더: 같은 맵의 다른 플레이어 그리기 ── */
  function renderRemotes() {
    const G = g();
    if (!G?.player || !G.ctx) return;
    const draw = (typeof drawPlayerSprite === 'function') ? drawPlayerSprite : null;
    const toScreen = (typeof worldToScreen === 'function') ? worldToScreen : null;
    if (!draw || !toScreen) return;
    const ctx = G.ctx;
    remotes.forEach((p) => {
      if (!p || p.map !== G.currentMap || typeof p.x !== 'number') return;
      const s = toScreen(p.x, p.y);
      if (s.x < -120 || s.y < -120 || s.x > G.width + 120 || s.y > G.height + 120) return;
      ctx.save();
      ctx.globalAlpha = 0.96;
      try {
        draw(ctx, s.x, s.y, p.appearance || {}, p.class || 'warrior',
          { attack: 0, moving: !!p.moving, dance: 0, equipment: p.equipment || {} },
          (typeof PLAYER_WORLD_SCALE !== 'undefined' ? PLAYER_WORLD_SCALE : 1.26), p.spec || null);
      } catch {}
      ctx.restore();
      // 이름표
      ctx.save();
      ctx.font = '700 12px "Noto Sans KR", sans-serif';
      ctx.textAlign = 'center';
      const label = `${p.name} (Lv.${p.level || 1})`;
      const w = ctx.measureText(label).width + 14;
      ctx.fillStyle = 'rgba(15,23,42,.72)';
      ctx.beginPath(); ctx.roundRect(s.x - w / 2, s.y - 62, w, 20, 8); ctx.fill();
      ctx.fillStyle = '#bae6fd';
      ctx.fillText(label, s.x, s.y - 48);
      // 말풍선
      if (p.bubble && p.bubble.until > Date.now()) {
        const t = p.bubble.text;
        const bw = Math.min(220, ctx.measureText(t).width + 18);
        ctx.fillStyle = 'rgba(255,255,255,.94)';
        ctx.beginPath(); ctx.roundRect(s.x - bw / 2, s.y - 92, bw, 24, 10); ctx.fill();
        ctx.fillStyle = '#0f172a';
        ctx.fillText(t, s.x, s.y - 75);
      }
      ctx.restore();
    });
  }

  function attachLayer() {
    if (typeof worldRenderPipeline !== 'undefined' && worldRenderPipeline?.registerLayer) {
      worldRenderPipeline.registerLayer({
        id: 'remote-players-v53',
        priority: 335, // 플레이어(340)보다 살짝 뒤
        when: ({ map }) => !['petShopInterior', 'upgradeShopInterior'].includes(map),
        render: renderRemotes,
      });
      return true;
    }
    return false;
  }
  if (!attachLayer()) {
    const t = setInterval(() => { if (attachLayer()) clearInterval(t); }, 300);
  }
})();
