/* ============================================================
   ui-tooltip.js — 전용 툴팁 엔진 (v37, 전면 교체판)
   과거 v31/v33/v35 툴팁 시스템 3개가 같은 요소(.ys-tooltip-v31)를
   서로 다른 방식(클래스 vs 인라인 display)으로 조작하며 간섭해온 역사가 있어,
   이 모듈은 "아무도 모르는 전용 요소"(.ys-tooltip-v37)만 사용한다.
   - 표시 판정: 이벤트 델리게이션이 아니라 120ms 폴링 + elementFromPoint.
     (이벤트 경로/전파/기존 핸들러와 완전히 무관하게 동작)
   - 구 요소(.ys-tooltip-v31)는 style.css에서 display:none !important로 봉인.
   - 스타일은 style.css 정적 규칙 + 여기서 인라인 이중 보증.
   ============================================================ */
(function () {
  'use strict';

  const CLS = 'ys-tooltip-v37';

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  let tip = null;
  function tipEl() {
    if (tip && document.body.contains(tip)) return tip;
    tip = document.querySelector('.' + CLS);
    if (!tip) {
      tip = document.createElement('div');
      tip.className = CLS;
      // CSS 로드 실패 시에도 최소한 보이도록 핵심 스타일 인라인 이중 보증
      tip.style.cssText = [
        'position:fixed', 'z-index:2147483000', 'pointer-events:none',
        'min-width:200px', 'max-width:340px', 'padding:12px 14px', 'border-radius:14px',
        'background:linear-gradient(180deg, rgba(15,23,42,.97), rgba(2,6,23,.96))',
        'border:1px solid rgba(125,211,252,.4)', 'color:#e5f2ff',
        "font-family:'Noto Sans KR', system-ui, sans-serif", 'font-size:13px', 'line-height:1.5',
        'box-shadow:0 18px 50px rgba(0,0,0,.5)', 'white-space:pre-line', 'display:none',
      ].join(';');
      document.body.appendChild(tip);
    }
    return tip;
  }

  function formatTip(raw) {
    const lines = String(raw || '').split(/\n+/).filter(Boolean);
    if (!lines.length) return '';
    const head = lines[0];
    const rest = lines.slice(1);
    return '<b style="display:block;font-size:15px;color:#fff;margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid rgba(148,163,184,.25)">' + escHtml(head) + '</b>' +
      rest.map((line, i) => '<span style="display:block;margin:2px 0;color:' + (i >= rest.length - 1 ? '#94a3b8' : '#bfdbfe') + '">' + escHtml(line) + '</span>').join('');
  }

  function position(x, y) {
    const t = tipEl();
    const pad = 16;
    const w = Math.min(340, Math.max(200, t.offsetWidth || 240));
    const h = t.offsetHeight || 110;
    let nx = x + pad, ny = y + pad;
    if (nx + w > window.innerWidth - 8) nx = x - w - pad;
    if (ny + h > window.innerHeight - 8) ny = y - h - pad;
    t.style.left = Math.max(6, nx) + 'px';
    t.style.top = Math.max(6, ny) + 'px';
  }

  let lastX = -1, lastY = -1, lastRaw = null;
  const trackPos = (e) => { lastX = e.clientX; lastY = e.clientY; };
  document.addEventListener('pointermove', trackPos, true);
  document.addEventListener('mousemove', trackPos, true);

  function tick() {
    if (lastX < 0) return;
    let target = null;
    try {
      const el = document.elementFromPoint(lastX, lastY);
      target = el && typeof el.closest === 'function' ? el.closest('[data-tooltip], [title]') : null;
    } catch (err) { target = null; }
    const t = tipEl();
    if (target) {
      if (target.getAttribute('title')) {
        target.setAttribute('data-tooltip', target.getAttribute('title'));
        target.removeAttribute('title'); // 브라우저 기본 툴팁과 중복 방지
      }
      const raw = target.getAttribute('data-tooltip');
      if (!raw) { t.style.display = 'none'; lastRaw = null; return; }
      if (raw !== lastRaw) { t.innerHTML = formatTip(raw); lastRaw = raw; }
      t.style.display = 'block';
      position(lastX, lastY);
    } else if (t.style.display !== 'none') {
      t.style.display = 'none';
      lastRaw = null;
    }
  }
  setInterval(tick, 120);
  // 마우스 이동 시엔 즉각 반응 (폴링 간격 사이의 지연 제거)
  document.addEventListener('mousemove', function () { try { tick(); } catch (err) {} }, true);

  window.__ysTooltipReady = 'v37';
})();
