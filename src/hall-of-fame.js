/* v52: 명예의 전당 — Top5 올림픽 시상대 (캐릭터 애니메이션) */
(function hallOfFameV52() {
  if (window.__HALL_OF_FAME_V52__) return;
  window.__HALL_OF_FAME_V52__ = true;

  let rafId = null;

  function g() { return (typeof game !== 'undefined' ? game : window.__G); }
  function call(name) { const fn = window[name]; return typeof fn === 'function' ? fn : null; }

  const MEDALS = ['🥇', '🥈', '🥉', '', ''];
  const STAND_H = [96, 72, 56, 34, 26];
  // 1920×1080 화면의 CSS 96dpi 기준 1cm(37.8px)만 캐릭터와 동행 펫을 위로 올린다.
  const HALL_AVATAR_RAISE_Y = 38;
  const STAND_COLOR = [
    'linear-gradient(180deg,#fde047,#b45309)',
    'linear-gradient(180deg,#e2e8f0,#64748b)',
    'linear-gradient(180deg,#fdba74,#9a3412)',
    'linear-gradient(180deg,#94a3b8,#475569)',
    'linear-gradient(180deg,#94a3b8,#475569)',
  ];

  window.openHallOfFameV52 = async function openHallOfFameV52() {
    const getAll = call('getAllPlayers');
    const open = call('openModal');
    const esc = call('escapeHtml') || ((t) => String(t));
    if (!open) return;
    open(`
      <h2>🏆 명예의 전당</h2>
      <div class="panel-card" style="text-align:center"><p class="muted">서버 기록을 불러오는 중..</p></div>
    `, { type:'hall', pause:true, wide:true });
    let players = [];
    try {
      players = await window.secureStudentAccessV2?.loadHallOfFame?.();
    } catch {}
    if (!Array.isArray(players) || !players.length) {
      players = (getAll?.() || [])
        .slice()
        .sort((a, b) => (b.exp - a.exp) || (b.level - a.level) || (b.gold - a.gold))
        .slice(0, 5);
    }
    const meta = (typeof CLASS_META !== 'undefined') ? CLASS_META : { warrior:{name:'전사'}, mage:{name:'마법사'}, priest:{name:'사제'} };
    // 시상대 배치: 4위, 2위, 1위, 3위, 5위
    const order = [3, 1, 0, 2, 4];
    const SLOT_W = 176;   // 슬롯 폭 확대 → 좌우 간격·텍스트 공간 확보
    const CANVAS_W = 176; // 캔버스 폭 확대 → 무기(칼) 좌우 잘림 방지
    // 위로 올린 만큼 캔버스를 늘리고 음수 여백으로 상쇄해 시상대·이름 위치는 유지한다.
    const CANVAS_H = 210 + HALL_AVATAR_RAISE_Y;
    const slots = order.map((rank) => {
      const p = players[rank];
      if (!p) return `<div class="hof-slot-v52" style="width:${SLOT_W}px"></div>`;
      return `<div class="hof-slot-v52" style="display:flex;flex-direction:column;align-items:center;justify-content:flex-end;width:${SLOT_W}px">
        <div style="font-size:${rank === 0 ? 26 : 19}px;line-height:1.2;min-height:${rank < 3 ? 30 : 8}px">${MEDALS[rank]}</div>
        <canvas id="hofCanvasV52_${rank}" width="${CANVAS_W}" height="${CANVAS_H}" style="display:block;margin-top:-${HALL_AVATAR_RAISE_Y}px"></canvas>
        <div style="background:${STAND_COLOR[rank]};width:118px;height:${STAND_H[rank]}px;border-radius:8px 8px 0 0;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:${rank === 0 ? 22 : 17}px;color:rgba(15,23,42,.82);box-shadow:inset 0 3px 6px rgba(255,255,255,.35), 0 4px 10px rgba(0,0,0,.35)">${rank + 1}</div>
        <div style="margin-top:6px;text-align:center;line-height:1.35;width:100%;padding:0 4px">
          <b>${esc(p.name)}</b><br>
          <small class="muted" style="white-space:nowrap">${meta[p.class]?.name || p.class} · ${esc(p.spec || '전문화 전')} · Lv.${p.level}</small><br>
          <small style="color:#c4b5fd;font-weight:800">EXP ${p.exp || 0}</small>
        </div>
      </div>`;
    }).join('');
    open(`
      <h2>🏆 명예의 전당</h2>
      <div style="display:flex;align-items:baseline;justify-content:flex-start;gap:14px;flex-wrap:wrap;margin:2px 0 10px">
        <p class="muted" style="margin:0">63월드 최고의 모험가 TOP 5</p>
        <b style="font-size:16px;font-weight:900;color:#fde68a">제일 많이 문제를 풀며 몬스터를 잡은 영웅!</b>
      </div>
      <div class="hall-board" style="padding:10px 4px 18px;overflow-x:auto">
        <div style="display:flex;align-items:flex-end;justify-content:center;gap:26px;min-width:max-content;margin:0 auto">${slots}</div>
        ${players.length ? '' : '<p class="muted" style="text-align:center">등록된 학생이 없습니다.</p>'}
      </div>
    `, { type:'hall', pause:true, wide:true });
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
          drawPetBeside(ctx, canvas, p, rank, performance.now());
          draw(ctx, canvas.width / 2, canvas.height - 58 - HALL_AVATAR_RAISE_Y, p.appearance, p.class, {
            attack: 0,
            moving: true, // 걷기 모션으로 살아있는 느낌
            dance: 0,
            equipment: p.equipment || {},
            costume: p.costume || {}, // [v57] 명예의 전당에도 코스튬 반영
            weaponTierStyle: call('getEquippedWeaponTierStyle') ? window.getEquippedWeaponTierStyle(p) : null,
          }, rank === 0 ? 1.7 : 1.5, p.spec || null);
        } catch (err) { /* 렌더 실패 시 해당 프레임만 건너뜀 */ }
      });
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
  }

  /* 장착한 펫을 캐릭터 옆에 함께 띄운다.
     서버가 activePet을 내려 주지 않으면 조용히 건너뛴다. */
  function drawPetBeside(ctx, canvas, player, rank, now) {
    const petId = player?.activePet;
    if (!petId) return;
    const defs = window.YuksamPatchData?.PET_DEFS_V27 || window.PET_DEFS_V27 || {};
    const pet = defs[petId];
    if (!pet) return;

    const scale = rank === 0 ? 1.25 : 1.1;
    const bob = Math.sin(now / 320 + (pet.bob || 0)) * 4;
    const x = canvas.width / 2 - (rank === 0 ? 58 : 52);
    const y = canvas.height - 66 - HALL_AVATAR_RAISE_Y + bob;

    ctx.save();
    // 발밑 그림자
    ctx.fillStyle = 'rgba(6,12,22,.28)';
    ctx.beginPath();
    ctx.ellipse(x, canvas.height - 46 - HALL_AVATAR_RAISE_Y, 13 * scale, 4.5 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    // 전설 펫은 은은하게 빛난다
    if (pet.legendary) {
      const glow = ctx.createRadialGradient(x, y, 0, x, y, 26 * scale);
      glow.addColorStop(0, 'rgba(251,191,36,.45)');
      glow.addColorStop(1, 'rgba(251,191,36,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, 26 * scale, 0, Math.PI * 2);
      ctx.fill();
    }
    // 펫 본체는 아이콘으로 표현한다(월드와 같은 방식)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(26 * scale)}px Noto Color Emoji, Apple Color Emoji, Segoe UI Emoji, system-ui`;
    ctx.fillText(pet.icon || '🐾', x, y);
    ctx.restore();
  }

  function stopAnim() {
    if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
  }
})();
