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
  const motions = new Map(); // name -> 도착한 위치 사이를 부드럽게 이어주는 계산기
  const IDLE_KEEPALIVE_MS = 2000; // 가만히 서 있으면 이 주기로만 알린다(무료 한도 절약)
  let remoteBounds = [];
  let lastPayloadKey = '';
  let lastKeepaliveAt = 0;

  // 위치가 띄엄띄엄 도착해도 화면에서는 이어 보이게 한다. 모듈이 없으면 예전처럼 그대로 그린다.
  function trackRemoteMotion(name, x, y, snap) {
    const api = window.YuksamRemoteMotion;
    if (!api || typeof x !== 'number' || typeof y !== 'number') return;
    let motion = motions.get(name);
    if (!motion) { motion = api.create(); motions.set(name, motion); }
    motion.push(x, y, Date.now(), { snap });
  }

  function forgetRemote(name) {
    remotes.delete(name);
    motions.delete(name);
  }

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
      if (p.type === 'leave') { forgetRemote(p.name); return; }
      if (p.type === 'chat') {
        const prev = remotes.get(p.name) || {};
        remotes.set(p.name, { ...prev, name: p.name, bubble: { text: p.text, until: Date.now() + 4200 }, at: Date.now() });
        try { window.appendChatMessage?.('user', p.name, p.text); } catch {}
        return;
      }
      const previous = remotes.get(p.name);
      // 새로 들어온 학생은 내가 가만히 서 있어도 나를 바로 볼 수 있어야 한다
      if (!previous) lastPayloadKey = '';
      remotes.set(p.name, { ...(previous || {}), ...p, at: Date.now() });
      // 처음 보이거나 맵을 옮겼으면 미끄러지지 않고 즉시 그 자리에 그린다
      trackRemoteMotion(p.name, p.x, p.y, !previous || previous.map !== p.map);
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
    remotes.forEach((v, k) => { if (now - (v.at || 0) > STALE_MS) forgetRemote(k); });
    if (G?.player && now - lastSent >= SEND_MS && document.querySelector('#game.active')) {
      lastSent = now;
      const payload = {
        type: 'pos',
        userId:window.getPvpIdentityV1?.()?.userId || null,
        name: G.player.name,
        map: G.currentMap,
        x: Math.round(G.player.x), y: Math.round(G.player.y),
        level: G.player.level, class: G.player.class, spec: G.player.spec || null,
        equipment: G.player.equipment || {}, appearance: G.player.appearance || {},
        costume: G.player.costume || {},
        activePet:typeof G.player.activePet === 'string' ? G.player.activePet : null,
        facing:{
          x:Number(G.lastMove?.x) || 0,
          y:Number(G.lastMove?.y) || 1,
        },
        pvpAvailable:G.currentMap === 'town' && !G.modalState?.pause && !G.currentCombatMonsterId,
        moving: !!G.isMoving,
        dance: Number(G.danceTimer || 0) > 0,
      };
      // 달라진 게 없으면 굳이 보내지 않는다. 대신 사라지지 않도록 가끔은 알린다.
      const key = `${payload.userId || ''}|${payload.map}|${payload.x}|${payload.y}|${payload.moving}|${payload.dance}|${payload.pvpAvailable}|${payload.level}|${payload.activePet || ''}|${payload.facing.x},${payload.facing.y}`;
      if (key !== lastPayloadKey || now - lastKeepaliveAt >= IDLE_KEEPALIVE_MS) {
        lastPayloadKey = key;
        lastKeepaliveAt = now;
        broadcast(payload);
      }
    }
  }
  setInterval(tick, SEND_MS);
  window.addEventListener('beforeunload', () => {
    const G = g();
    if (G?.player) broadcast({ type: 'leave', name: G.player.name });
  });
  connect();

  /* ── 렌더: 같은 맵의 다른 플레이어 그리기 ── */
  function drawRemotePet(ctx, remote, worldX, worldY, toScreen, now, moving) {
    const pet = window.PET_DEFS_V27?.[String(remote?.activePet || '')];
    if (!pet) return;
    const directionX = Number(remote?.facing?.x) || 0;
    const directionY = Number(remote?.facing?.y) || 1;
    const backX = Math.abs(directionX) > 0.1 ? -Math.sign(directionX) * 58 : -48;
    const backY = Math.abs(directionY) > 0.1 ? -Math.sign(directionY) * 38 : 38;
    const bob = Number(pet.bob) || 0;
    const hop = moving
      ? Math.abs(Math.sin(now / 115 + bob)) * 10
      : Math.sin(now / 330 + bob) * 3;
    const dancing = remote.dance === true;
    const danceX = dancing ? Math.sin(now / 80 + bob) * 16 : 0;
    const point = toScreen(worldX + backX + danceX, worldY + backY - hop);
    ctx.save();
    ctx.globalAlpha = 0.94;
    ctx.font = '900 30px "Noto Sans KR", "Apple Color Emoji", "Segoe UI Emoji", system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(15,23,42,.55)';
    ctx.strokeText?.(pet.icon, point.x, point.y);
    ctx.fillText(pet.icon, point.x, point.y);
    if (dancing) {
      ctx.font = '900 14px "Noto Sans KR", system-ui';
      ctx.fillStyle = pet.color || '#fde68a';
      ctx.fillText('♪', point.x - 24, point.y - 23);
      ctx.fillText('♬', point.x + 24, point.y - 28);
    }
    ctx.font = '900 9px "Noto Sans KR", system-ui';
    ctx.fillStyle = 'rgba(15,23,42,.78)';
    ctx.fillText(pet.name, point.x, point.y - 29);
    ctx.restore();
  }

  function renderRemotes() {
    const G = g();
    if (!G?.player || !G.ctx) return;
    const draw = (typeof drawPlayerSprite === 'function') ? drawPlayerSprite : null;
    const toScreen = (typeof worldToScreen === 'function') ? worldToScreen : null;
    if (!draw || !toScreen) return;
    const ctx = G.ctx;
    remoteBounds = [];
    const now = Date.now();
    remotes.forEach((p, name) => {
      if (!p || p.map !== G.currentMap || typeof p.x !== 'number') return;
      // 마지막으로 받은 좌표로 튀지 않고, 두 지점 사이를 채운 위치에 그린다
      const eased = motions.get(name)?.sample(now) || null;
      const worldX = eased ? eased.x : p.x;
      const worldY = eased ? eased.y : p.y;
      const s = toScreen(worldX, worldY);
      if (s.x < -120 || s.y < -120 || s.x > G.width + 120 || s.y > G.height + 120) return;
      drawRemotePet(ctx, p, worldX, worldY, toScreen, now, !!p.moving || !!eased?.moving);
      ctx.save();
      ctx.globalAlpha = 0.96;
      try {
        draw(ctx, s.x, s.y, p.appearance || {}, p.class || 'warrior',
          { attack: 0, moving: !!p.moving || !!eased?.moving, dance: p.dance ? 1 : 0, equipment: p.equipment || {}, costume:p.costume || {} },
          (typeof PLAYER_WORLD_SCALE !== 'undefined' ? PLAYER_WORLD_SCALE : 1.26), p.spec || null);
      } catch {}
      ctx.restore();
      if (p.userId) {
        remoteBounds.push({
          userId:String(p.userId),
          left:s.x - 46,
          right:s.x + 46,
          top:s.y - 90,
          bottom:s.y + 24,
          centerX:s.x,
          centerY:s.y - 30,
        });
      }
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

  g()?.canvas?.addEventListener?.('contextmenu', (event) => {
    const G = g();
    const rect = G?.canvas?.getBoundingClientRect?.();
    if (!rect?.width || !rect?.height) return;
    const x = (event.clientX - rect.left) * (G.canvas.width / rect.width);
    const y = (event.clientY - rect.top) * (G.canvas.height / rect.height);
    const target = remoteBounds
      .filter((bounds) => x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom)
      .sort((a, b) => Math.hypot(x - a.centerX, y - a.centerY) - Math.hypot(x - b.centerX, y - b.centerY))[0];
    if (!target) return;
    event.preventDefault();
    window.openRemoteProfileV1?.(target.userId);
  });

  function attachLayer() {
    if (typeof worldRenderPipeline !== 'undefined' && worldRenderPipeline?.registerLayer) {
      worldRenderPipeline.registerLayer({
        id: 'remote-players-v53',
        priority: 335, // 플레이어(340)보다 살짝 뒤
        when: ({ map }) => !['petShopInterior', 'upgradeShopInterior', 'raidTower'].includes(map),
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
