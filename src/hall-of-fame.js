/* v58: 명예의 전당 — EXP/던전/PvP Top 5, 시상대 그래픽, 실제 이름표 스킨. */
(function hallOfFameV58() {
  if (window.__HALL_OF_FAME_V58__) return;
  window.__HALL_OF_FAME_V58__ = true;
  window.__HALL_OF_FAME_V52__ = true;

  let rafId = null;
  let viewToken = 0;
  let activeScope = 'all';
  const rankingCache = new Map();

  function g() { return (typeof game !== 'undefined' ? game : window.__G); }
  function call(name) { const fn = window[name]; return typeof fn === 'function' ? fn : null; }

  const FILTERS = Object.freeze([
    Object.freeze({ id:'all', label:'전체', icon:'🏆', title:'전체 모험가', metric:'EXP RANKING', subtitle:'문제를 풀고 가장 많은 경험을 쌓은 영웅들' }),
    Object.freeze({ id:'warrior', label:'전사', icon:'⚔️', title:'전사', metric:'EXP RANKING', subtitle:'문제를 풀고 가장 많은 경험을 쌓은 전사들' }),
    Object.freeze({ id:'mage', label:'마법사', icon:'🔮', title:'마법사', metric:'EXP RANKING', subtitle:'문제를 풀고 가장 많은 경험을 쌓은 마법사들' }),
    Object.freeze({ id:'priest', label:'사제', icon:'✨', title:'사제', metric:'EXP RANKING', subtitle:'문제를 풀고 가장 많은 경험을 쌓은 사제들' }),
    Object.freeze({ id:'raid', label:'던전 진행', icon:'🗼', title:'던전 진행', metric:'RAID PROGRESS', subtitle:'실제 파티 던전에서 가장 멀리 전진한 영웅들' }),
    Object.freeze({ id:'pvp', label:'PvP', icon:'⚡', title:'PvP 승리', metric:'PVP RECORD', subtitle:'서버에 승패가 확정된 대결에서 가장 많이 승리한 영웅들' }),
  ]);
  const FILTER_IDS = new Set(FILTERS.map((entry) => entry.id));
  const MEDALS = ['🥇', '🥈', '🥉', '◆', '◆'];
  const STAND_H = [112, 84, 68, 46, 38];
  // 1920×1080 화면의 CSS 96dpi 기준 1cm(37.8px)만 캐릭터와 동행 펫을 위로 올린다.
  const HALL_AVATAR_RAISE_Y = 38;
  const SLOT_W = 194;
  const CANVAS_W = 194;
  // 위로 올린 만큼 캔버스를 늘리고 음수 여백으로 상쇄해 시상대 위치는 유지한다.
  const CANVAS_H = 210 + HALL_AVATAR_RAISE_Y;
  const NAMEPLATE_W = 216;
  const NAMEPLATE_H = 76;
  const NAMEPLATE_DRAW_Y = -38;

  function safeScope(value) {
    const scope = String(value || 'all');
    return FILTER_IDS.has(scope) ? scope : 'all';
  }

  function filterMeta(scope) {
    return FILTERS.find((entry) => entry.id === safeScope(scope)) || FILTERS[0];
  }

  function escape(value) {
    const esc = call('escapeHtml');
    return esc ? esc(String(value ?? '')) : String(value ?? '')
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }

  function filterMarkup(scope) {
    const selected = safeScope(scope);
    return FILTERS.map((entry) => {
      const active = entry.id === selected;
      return `<button type="button" class="hof-filter-v58${active ? ' active' : ''}" data-hof-scope-v58="${entry.id}" aria-pressed="${active}">
        <span aria-hidden="true">${entry.icon}</span><b>${entry.label}</b><small>TOP 5</small>
      </button>`;
    }).join('');
  }

  function shellMarkup(scope, body) {
    const meta = filterMeta(scope);
    return `<section class="hof-shell-v58">
      <header class="hof-hero-v58">
        <div class="hof-trophy-v58" aria-hidden="true"><span>🏆</span></div>
        <div class="hof-hero-copy-v58">
          <small>63 WORLD · HALL OF FAME</small>
          <h2>명예의 전당</h2>
          <p>${escape(meta.subtitle)}</p>
        </div>
        <div class="hof-rule-v58"><b>${escape(meta.title)} TOP 5</b><span>${escape(meta.metric)}</span></div>
      </header>
      <nav class="hof-filters-v58" aria-label="명예의 전당 순위 분류">${filterMarkup(scope)}</nav>
      ${body}
    </section>`;
  }

  function loadingMarkup(scope) {
    return shellMarkup(scope, `<div class="hof-loading-v58" role="status"><span>✦</span><b>${escape(filterMeta(scope).title)} 기록을 불러오는 중...</b></div>`);
  }

  function localRanking(scope) {
    const getAll = call('getAllPlayers');
    const selected = safeScope(scope);
    if (selected === 'raid' || selected === 'pvp') return [];
    const classId = selected === 'all' ? null : selected;
    return (getAll?.() || [])
      .filter((player) => !classId || player?.class === classId)
      .slice()
      .sort((a, b) => (Number(b?.exp) - Number(a?.exp))
        || (Number(b?.level) - Number(a?.level))
        || (Number(b?.gold) - Number(a?.gold)))
      .slice(0, 5);
  }

  async function loadRanking(scope) {
    const selected = safeScope(scope);
    if (rankingCache.has(selected)) return rankingCache.get(selected);
    let players = [];
    let remoteLoaded = false;
    try {
      const loader = window.secureStudentAccessV2?.loadHallOfFame;
      if (typeof loader === 'function') {
        const remotePlayers = await loader(selected);
        if (Array.isArray(remotePlayers)) {
          players = remotePlayers;
          remoteLoaded = true;
        }
      }
    } catch {}
    if (!remoteLoaded) players = (selected === 'raid' || selected === 'pvp')
      ? []
      : localRanking(selected);
    const result = players.slice(0, 5);
    rankingCache.set(selected, result);
    return result;
  }

  function rankingMetric(scope, player) {
    const selected = safeScope(scope);
    if (selected === 'raid') {
      const floor = Math.max(1, Math.min(63, Math.trunc(Number(player?.reachedFloor) || 1)));
      const encounter = Math.max(0, Math.min(20, Math.trunc(Number(player?.encounterIndex) || 0)));
      return player?.cleared === true
        ? `${floor}층 구간 클리어`
        : `${floor}층 · ${encounter + 1}번째 몬스터 도전`;
    }
    if (selected === 'pvp') {
      const wins = Math.max(0, Math.trunc(Number(player?.wins) || 0));
      const losses = Math.max(0, Math.trunc(Number(player?.losses) || 0));
      return `PVP ${wins.toLocaleString('ko-KR')}승 ${losses.toLocaleString('ko-KR')}패`;
    }
    return `EXP ${Math.max(0, Number(player?.exp) || 0).toLocaleString('ko-KR')}`;
  }

  function slotMarkup(scope, players) {
    const meta = (typeof CLASS_META !== 'undefined')
      ? CLASS_META
      : { warrior:{name:'전사'}, mage:{name:'마법사'}, priest:{name:'사제'} };
    // 시상대 배치: 4위, 2위, 1위, 3위, 5위
    return [3, 1, 0, 2, 4].map((rank) => {
      const player = players[rank];
      if (!player) return `<div class="hof-slot-v58 hof-slot-empty-v58" style="--hof-slot-width:${SLOT_W}px"></div>`;
      const className = meta[player.class]?.name || player.class || '모험가';
      const spec = player.spec || '전문화 전';
      return `<article class="hof-slot-v58 hof-rank-${rank + 1}-v58" style="--hof-slot-width:${SLOT_W}px;--hof-stand-height:${STAND_H[rank]}px" aria-label="${rank + 1}위 ${escape(player.name)}">
        <div class="hof-medal-v58" aria-hidden="true">${MEDALS[rank]}</div>
        <div class="hof-avatar-frame-v58">
          <canvas id="hofCanvasV52_${rank}" width="${CANVAS_W}" height="${CANVAS_H}" style="margin-top:-${HALL_AVATAR_RAISE_Y}px"></canvas>
        </div>
        <canvas class="hof-nameplate-canvas-v58" id="hofNameplateV58_${rank}" width="${NAMEPLATE_W}" height="${NAMEPLATE_H}" aria-label="${escape(player.name)}의 장착 이름표"></canvas>
        <div class="hof-stand-v58"><span>${rank + 1}</span><small>RANK</small></div>
        <div class="hof-card-v58">
          <b>${escape(player.name)}</b>
          <span>${escape(className)} · ${escape(spec)} · Lv.${Math.max(1, Number(player.level) || 1)}</span>
          <strong>${escape(rankingMetric(scope, player))}</strong>
        </div>
      </article>`;
    }).join('');
  }

  function boardMarkup(scope, players) {
    const title = filterMeta(scope).title;
    if (!players.length) {
      return shellMarkup(scope, `<section class="hof-board-v58 hof-empty-v58">
        <div aria-hidden="true">◇</div><h3>${escape(title)} 기록이 아직 없습니다.</h3><p>첫 번째 전설의 주인공을 기다리고 있어요.</p>
      </section>`);
    }
    return shellMarkup(scope, `<section class="hof-board-v58">
      <div class="hof-board-heading-v58"><span>✦</span><div><small>CURRENT LEGENDS</small><h3>${escape(title)} TOP 5</h3></div><span>✦</span></div>
      <div class="hof-stage-v58">
        <div class="hof-stars-v58" aria-hidden="true">✦ · ✧ · ✦ · ✧ · ✦</div>
        <div class="hof-spotlights-v58" aria-hidden="true"><i></i><i></i><i></i></div>
        <div class="hof-podium-v58">${slotMarkup(scope, players)}</div>
      </div>
    </section>`);
  }

  function bindFilters() {
    document.querySelectorAll?.('[data-hof-scope-v58]').forEach((button) => {
      button.addEventListener('click', () => {
        const scope = safeScope(button.dataset.hofScopeV58);
        if (scope === activeScope && rankingCache.has(scope)) return;
        showScope(scope);
      });
    });
  }

  async function showScope(scope) {
    const open = call('openModal');
    if (!open) return;
    const selected = safeScope(scope);
    const token = ++viewToken;
    activeScope = selected;
    stopAnim();
    open(loadingMarkup(selected), { type:'hall', pause:true, wide:true });
    bindFilters();
    const players = await loadRanking(selected);
    if (token !== viewToken || g()?.modalState?.type !== 'hall') return;
    open(boardMarkup(selected, players), { type:'hall', pause:true, wide:true });
    bindFilters();
    startAnim(players);
  }

  window.openHallOfFameV52 = function openHallOfFameV52() {
    rankingCache.clear();
    return showScope('all');
  };
  window.selectHallScopeV58 = showScope;

  function startAnim(players) {
    stopAnim();
    const draw = call('drawPlayerSprite');
    if (!draw) return;
    const startedAt = performance.now();
    const loop = () => {
      const G = g();
      if (!G || G.modalState?.type !== 'hall' || performance.now() - startedAt > 600000) { stopAnim(); return; }
      players.forEach((player, rank) => {
        const canvas = document.getElementById(`hofCanvasV52_${rank}`);
        if (!canvas || !player) return;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        try {
          drawPetBeside(ctx, canvas, player, rank, performance.now());
          draw(ctx, canvas.width / 2, canvas.height - 58 - HALL_AVATAR_RAISE_Y, player.appearance, player.class, {
            remote:true,
            attack:0,
            moving:true,
            dance:0,
            equipment:player.equipment || {},
            costume:player.costume || {},
            weaponTierStyle:call('getEquippedWeaponTierStyle') ? window.getEquippedWeaponTierStyle(player) : null,
          }, rank === 0 ? 1.7 : 1.5, player.spec || null);
          drawHallNameplate(player, rank);
        } catch { /* 렌더 실패 시 해당 프레임만 건너뜀 */ }
      });
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
  }

  function drawHallNameplate(player, rank) {
    const canvas = document.getElementById(`hofNameplateV58_${rank}`);
    const renderer = window.YuksamPlayerNameplateV1;
    if (!canvas || !renderer?.draw) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    renderer.draw(ctx, canvas.width / 2, NAMEPLATE_DRAW_Y, player, { source:'remote' });
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
    ctx.fillStyle = 'rgba(6,12,22,.28)';
    ctx.beginPath();
    ctx.ellipse(x, canvas.height - 46 - HALL_AVATAR_RAISE_Y, 13 * scale, 4.5 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    if (pet.legendary) {
      const glow = ctx.createRadialGradient(x, y, 0, x, y, 26 * scale);
      glow.addColorStop(0, 'rgba(251,191,36,.45)');
      glow.addColorStop(1, 'rgba(251,191,36,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, 26 * scale, 0, Math.PI * 2);
      ctx.fill();
    }
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
