/* v53: Supabase 클라우드 동기화
   전략: 부팅 시 전체 데이터를 localStorage로 내려받고(원격이 더 최신일 때만),
         이후 4초마다 바뀐 로컬 데이터를 업로드. 게임 코드는 수정 없이 그대로 localStorage를 사용.
   설정(src/cloud-config.js)이 비어 있으면 아무것도 하지 않음. */
(function cloudSyncV53() {
  if (window.__CLOUD_SYNC_V53__) return;
  window.__CLOUD_SYNC_V53__ = true;

  const cfg = window.YUKSAM_CLOUD || {};
  if (cfg.securityV2Enabled === true) return;
  const PLAYER_PREFIX = 'ysb_player_';
  const SHARED_KEYS = ['ysb_teacher_v1', 'ysb_workbooks_v3', 'ysb_questions_v2'];
  const META_KEY = 'ysb_cloud_meta_v1';
  const PUSH_INTERVAL = 4000;
  const SHARED_PULL_INTERVAL = 20000;

  const enabled = typeof cfg.url === 'string' && cfg.url.startsWith('http') && typeof cfg.anonKey === 'string' && cfg.anonKey.length > 20;
  window.__cloudSyncStatusV53 = enabled ? 'connecting' : 'off';
  if (!enabled) return;

  const headers = {
    apikey: cfg.anonKey,
    Authorization: 'Bearer ' + cfg.anonKey,
    'Content-Type': 'application/json',
  };
  const base = cfg.url.replace(/\/$/, '') + '/rest/v1';
  const lastPushed = {};

  function meta() { try { return JSON.parse(localStorage.getItem(META_KEY) || '{}'); } catch { return {}; } }
  function setMeta(m) { try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch {} }

  async function api(path, options) {
    const res = await fetch(base + path, { ...options, headers: { ...headers, ...(options?.headers || {}) } });
    if (!res.ok) throw new Error('supabase ' + res.status);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  // ── 내려받기: 원격이 더 최신인 항목만 로컬에 반영 ──
  async function pullPlayers() {
    const rows = await api('/players?select=name,data,updated_at') || [];
    const m = meta();
    rows.forEach((row) => {
      if (!row?.name || !row.data) return;
      const key = PLAYER_PREFIX + row.name;
      const localKnown = m[key];
      if (!localKnown || new Date(row.updated_at) > new Date(localKnown)) {
        const serialized = JSON.stringify(row.data);
        localStorage.setItem(key, serialized);
        lastPushed[key] = serialized;
        m[key] = row.updated_at;
      }
    });
    setMeta(m);
  }
  async function pullShared() {
    const rows = await api('/shared_state?select=key,data,updated_at') || [];
    const m = meta();
    rows.forEach((row) => {
      if (!row?.key || !SHARED_KEYS.includes(row.key) || row.data == null) return;
      const localKnown = m[row.key];
      if (!localKnown || new Date(row.updated_at) > new Date(localKnown)) {
        const serialized = JSON.stringify(row.data);
        localStorage.setItem(row.key, serialized);
        lastPushed[row.key] = serialized;
        m[row.key] = row.updated_at;
      }
    });
    setMeta(m);
  }

  // ── 올리기: 바뀐 것만 업서트 ──
  async function pushChanged() {
    const now = new Date().toISOString();
    const m = meta();
    const playerRows = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(PLAYER_PREFIX)) continue;
      const raw = localStorage.getItem(key);
      if (!raw || raw === lastPushed[key]) continue;
      try { playerRows.push({ name: key.slice(PLAYER_PREFIX.length), data: JSON.parse(raw), updated_at: now }); } catch {}
      lastPushed[key] = raw;
      m[key] = now;
    }
    if (playerRows.length) {
      await api('/players?on_conflict=name', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(playerRows),
      });
    }
    const sharedRows = [];
    SHARED_KEYS.forEach((key) => {
      const raw = localStorage.getItem(key);
      if (!raw || raw === lastPushed[key]) return;
      try { sharedRows.push({ key, data: JSON.parse(raw), updated_at: now }); } catch {}
      lastPushed[key] = raw;
      m[key] = now;
    });
    if (sharedRows.length) {
      await api('/shared_state?on_conflict=key', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(sharedRows),
      });
    }
    setMeta(m);
  }

  // ── 첫 내려받기가 끝날 때까지 로그인 잠금 (신규 캐릭터로 덮어쓰는 사고 방지) ──
  const loginBtn = document.getElementById('studentLoginBtn');
  const originalLabel = loginBtn ? loginBtn.textContent : '';
  function lockLogin() { if (loginBtn) { loginBtn.disabled = true; loginBtn.textContent = '서버 연결 중...'; } }
  function unlockLogin() { if (loginBtn) { loginBtn.disabled = false; loginBtn.textContent = originalLabel; } }

  async function start() {
    lockLogin();
    const failSafe = setTimeout(() => { window.__cloudSyncStatusV53 = 'offline'; unlockLogin(); }, 6000);
    try {
      await Promise.all([pullPlayers(), pullShared()]);
      window.__cloudSyncStatusV53 = 'online';
    } catch (err) {
      window.__cloudSyncStatusV53 = 'offline';
      console.warn('[cloud-sync] 서버 연결 실패 — 로컬 저장으로 동작합니다.', err?.message || err);
    } finally {
      clearTimeout(failSafe);
      unlockLogin();
    }
    setInterval(() => { pushChanged().catch(() => {}); }, PUSH_INTERVAL);
    setInterval(() => { pullShared().catch(() => {}); }, SHARED_PULL_INTERVAL);
    window.addEventListener('beforeunload', () => {
      try {
        const raws = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith(PLAYER_PREFIX) && localStorage.getItem(key) !== lastPushed[key]) {
            raws.push({ name: key.slice(PLAYER_PREFIX.length), data: JSON.parse(localStorage.getItem(key)), updated_at: new Date().toISOString() });
          }
        }
        if (raws.length) fetch(base + '/players?on_conflict=name', {
          method: 'POST', keepalive: true,
          headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(raws),
        });
      } catch {}
    });
  }
  start();
})();
