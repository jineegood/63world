/* 스킬 포인트 미사용 안내 — HUD 스킬 버튼 아래(화면 중앙 방향)로 화살표와 함께 표시 + 스킬창 내부 힌트 */
(function skillPointHintV50() {
  if (window.__SKILLPOINT_HINT_V50__) return;
  window.__SKILLPOINT_HINT_V50__ = true;
  window.__SKILLPOINT_HINT_V42__ = true;

  // (기존 v42) 스킬창 내부 힌트 토글
  window.__skillPointHintTickV42 = function () {
    const hint = document.querySelector('.skill-window-v35 .skillpoint-hint-v42');
    if (!hint) return;
    const points = Number(window.__G?.player?.skillPoints || 0);
    hint.style.display = points > 0 ? 'block' : 'none';
  };

  function ensureBubble() {
    let el = document.getElementById('skillpointHudHintV50');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'skillpointHudHintV50';
    el.style.cssText = [
      'position:fixed', 'z-index:60', 'display:none', 'pointer-events:none',
      'background:rgba(15,23,42,.92)', 'color:#fde68a', 'border:1px solid rgba(250,204,21,.55)',
      'border-radius:10px', 'padding:7px 11px', 'font-size:12.5px', 'font-weight:700',
      'box-shadow:0 6px 18px rgba(0,0,0,.35)', 'text-align:center', 'line-height:1.35',
      'transform:translate(-50%, 0)', 'animation:spHintBobV50 1.1s ease-in-out infinite',
    ].join(';');
    el.innerHTML = '<div style="font-size:15px;line-height:1;margin-bottom:2px;color:#facc15">▲</div>아직 사용하지 않은 스킬 포인트가 있습니다';
    const style = document.createElement('style');
    style.textContent = '@keyframes spHintBobV50 { 0%,100% { transform:translate(-50%, 0); } 50% { transform:translate(-50%, 5px); } }';
    document.head.appendChild(style);
    document.body.appendChild(el);
    return el;
  }

  function tick() {
    const G = (typeof game !== 'undefined' ? game : window.__G);
    const bubble = ensureBubble();
    const btn = document.getElementById('openSkillTreeBtn');
    const gameActive = document.querySelector('#game.active');
    const points = Number(G?.player?.skillPoints || 0);
    const paused = !!G?.modalState?.pause || !!G?.modalState?.type;
    if (!btn || !gameActive || paused || points <= 0) { bubble.style.display = 'none'; return; }
    const rect = btn.getBoundingClientRect();
    if (!rect.width) { bubble.style.display = 'none'; return; }
    // 버튼 아래(아래 방향 = 화면 중앙 쪽)에 말풍선, 화살표(▲)는 스킬 버튼을 가리킴
    bubble.style.left = Math.round(rect.left + rect.width / 2) + 'px';
    bubble.style.top = Math.round(rect.bottom + 8) + 'px';
    bubble.style.display = 'block';
  }

  setInterval(tick, 800);
})();
