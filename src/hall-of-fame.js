/* v52: 명예의 전당 — Top5 올림픽 시상대 (캐릭터 애니메이션) */
(function hallOfFameV52() {
  if (window.__HALL_OF_FAME_V52__) return;
  window.__HALL_OF_FAME_V52__ = true;

  let rafId = null;

  function g() { return (typeof game !== 'undefined' ? game : window.__G); }
  function call(name) { const fn = window[name]; return typeof fn === 'function' ? fn : null; }

  const MEDALS = ['🥇', '🥈', '🥉', '4위', '5위'];
  const STAND_H = [96, 72, 56, 34, 26];
  const STAND_COLOR = [
    'linear-gradient(180deg,#fde047,#b45309)',
    'linear-gradient(180deg,#e2e8f0,#64748b)',
    'linear-gradient(180deg,#fdba74,#9a3412)',
    'linear-gradient(180deg,#94a3b8,#475569)',
    'linear-gradient(180deg,#94a3b8,#475569)',
  ];

  window.openHallOfFameV52 = function openHallOfFameV52() {
    const getAll = call('getAllPlayers');
    const open = call('openModal');
    const esc = call('escapeHtml') || ((t) => String(t));
    if (!getAll || !open) return;
    const players = (getAll() || [])
      .slice()
      .sort((a, b) => (b.level - a.level) || (b.exp - a.exp) || (b.gold - a.gold))
      .slice(0, 5);
    const meta = (typeof CLASS_META !== 'undefined') ? CLASS_META : { warrior:{name:'전사'}, mage:{name:'마법사'}, priest:{name:'사제'} };
    // 시상대 배치: 4위, 2위, 1위, 3위, 5위
    const order = [3, 1, 0, 2, 4];
    const slots = order.map((rank) => {
      const p = players[rank];
      if (!p) return `<div class="hof-slot-v52" style="width:108px"></div>`;
      return `<div class="hof-slot-v52" style="display:flex;flex-direction:column;align-items:center;justify-content:flex-end;width:108px">
        <div style="font-size:${rank === 0 ? 26 : 19}px;line-height:1.2">${MEDALS[rank]}</div>
        <canvas id="hofCanvasV52_${rank}" width="108" height="132" style="display:block"></canvas>
        <div style="background:${STAND_COLOR[rank]};width:96px;height:${STAND_H[rank]}px;border-radius:8px 8px 0 0;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:${rank === 0 ? 22 : 17}px;color:rgba(15,23,42,.82);box-shadow:inset 0 3px 6px rgba(255,255,255,.35), 0 4px 10px rgba(0,0,0,.35)">${rank + 1}</div>
        <div style="margin-top:6px;text-align:center;line-height:1.35">
          <b>${esc(p.name)}</b><br>
          <small class="muted">${meta[p.class]?.name || p.class} · ${esc(p.spec || '전문화 전')} · Lv.${p.level}</small>
        </div>
      </div>`;
    }).join('');
    open(`
      <h2>🏆 명예의 전당</h2>
      <p class="muted" style="margin:2px 0 10px">63월드 최고의 모험가 TOP 5</p>
      <div class="hall-board" style="padding:10px 4px 16px">
        <div style="display:flex;align-items:flex-end;justify-content:center;gap:10px">${slots}</div>
        ${players.length ? '' : '<p class="muted" style="text-align:center">등록된 학생이 없습니다.</p>'}
      </div>
    `, { type:'hall', pause:true });
    startAnim(players);
  };

  function startAnim(players) {
    stopAnim();
    const draw = call('drawPlayerSprite');
    if (!draw) return;
    const startedAt = performance.now();
    const loop = () => {
      const G = g();
      if (!G || G.modalState?.type !== 'hall' || performance.now() - startedAt > 600000) { stopAnim(); return; }
      players.forEach((p, rank) => {
        const canvas = document.getElementById(`hofCanvasV52_${rank}`);
        if (!canvas || !p) return;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        try {
          draw(ctx, canvas.width / 2, 78, p.appearance, p.class, {
            attack: 0,
            moving: true, // 걷기 모션으로 살아있는 느낌
            dance: 0,
            equipment: p.equipment || {},
            weaponTierStyle: call('getEquippedWeaponTierStyle') ? window.getEquippedWeaponTierStyle(p) : null,
          }, rank === 0 ? 1.75 : 1.5, p.spec || null);
        } catch (err) { /* 렌더 실패 시 해당 프레임만 건너뜀 */ }
      });
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
  }

  function stopAnim() {
    if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
  }
})();
