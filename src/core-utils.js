(function initYuksamCore(global) {
  function uid() {
    if (global.crypto?.randomUUID) return global.crypto.randomUUID();
    return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function randomFrom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function randomInt(min, max) { return Math.floor(min + Math.random() * (max - min + 1)); }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function normalize(v) { return String(v ?? '').trim().replace(/\s+/g, '').toLowerCase(); }
  function escapeHtml(v) {
    return String(v).replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[ch]));
  }
  function fmtDate(ts) {
    try { return new Date(ts).toLocaleString('ko-KR'); } catch { return '-'; }
  }

  global.YuksamCore = Object.freeze({
    uid,
    randomFrom,
    randomInt,
    clamp,
    distance,
    normalize,
    escapeHtml,
    fmtDate,
  });
})(window);
