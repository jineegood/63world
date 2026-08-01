/* =========================================================
   raid-run-ui.js — 63빌딩 던전 화면

   화면 세 개를 담당한다.
     1) 대형 배치 — 셋을 앞줄·중간·뒷줄에 세운다
     2) 이동 연출 — 셋이 다음 층으로 걸어간다
     3) 전투 — 몬스터 하나와 셋이 싸운다

   규칙과 진행은 raid-rules.js / raid-run.js가 이미 다 계산해 둔다.
   여기서는 그 상태를 읽어 그리고, 학생의 입력을 되돌려 줄 뿐이다.
   그래서 나중에 진행을 서버가 대신 굴려도 이 파일은 거의 그대로 쓴다.

   style.css는 건드리지 않고 필요한 스타일만 이 파일이 넣는다.
   ========================================================= */
(function initYuksamRaidRunUi(global) {
  'use strict';

  if (global.__YUKSAM_RAID_RUN_UI_V1__) return;
  global.__YUKSAM_RAID_RUN_UI_V1__ = true;

  const G = () => (typeof game !== 'undefined' ? game : null);
  const core = () => global.YuksamCore || {};
  const rules = () => global.YuksamRaidRules;
  const runApi = () => global.YuksamRaidRun;
  const call = (name, ...args) => (typeof global[name] === 'function' ? global[name](...args) : undefined);
  const esc = (value) => (core().escapeHtml ? core().escapeHtml(value) : String(value == null ? '' : value));
  const norm = (value) => (core().normalize ? core().normalize(value) : String(value == null ? '' : value).trim());

  /* 혼자 도는 버전에서는 동료 자리도 내가 배치한다.
     나중에 셋이 실제로 함께할 때는 false가 되어 자기 캐릭터만 옮길 수 있다. */
  let soloMode = true;

  /* 셋 다 준비되면 세는 시간(초)과 한 칸의 길이(밀리초). 검사에서는 짧게 줄인다. */
  let READY_COUNTDOWN = 5;
  let COUNTDOWN_STEP_MS = 1000;

  let active = null;      // 지금 돌고 있는 판
  let question = null;    // 지금 화면에 뜬 문제
  let busy = false;       // 연출 재생 중에는 입력을 막는다

  /* ---------- 스타일 ---------- */

  function ensureStyles() {
    if (global.document.getElementById('raidRunStylesV1')) return;
    const style = global.document.createElement('style');
    style.id = 'raidRunStylesV1';
    style.textContent = `
      .raid-hint{font-size:12px;color:#9fb3cd;margin-top:2px}
      .raid-error{font-size:13px;color:#fca5a5;margin-top:6px}

      /* 대형 화면 — 위 세 자리, 아래 대기칸 */
      .raid-posts{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:12px 0 16px}
      .raid-post{border-radius:14px;padding:10px 8px 12px;text-align:center;min-height:210px;
        display:flex;flex-direction:column;align-items:center;gap:6px;position:relative}
      /* 빈 자리는 + 버튼이 칸 한가운데에 오도록 남는 공간을 나눠 준다 */
      .raid-post.empty{border:2px dashed rgba(125,211,252,.55);background:rgba(8,17,30,.55);
        justify-content:center}
      .raid-post.empty .raid-post-title{position:absolute;top:10px;left:0;right:0}
      .raid-post.filled{border:1px solid rgba(148,163,184,.4);background:rgba(15,23,42,.78);
        justify-content:flex-start}
      .raid-post.filled.on{border-color:#38bdf8;box-shadow:0 0 0 2px rgba(56,189,248,.35)}
      .raid-post.ready{border-color:#4ade80;box-shadow:0 0 0 2px rgba(74,222,128,.35)}
      /* 자리 이름은 크게 — 한눈에 앞/가운데/뒤를 알 수 있게 */
      .raid-post-title{font-size:39px;font-weight:900;color:#e2e8f0;line-height:1.1}
      .raid-ready-badge{margin-top:auto;font-size:20px;font-weight:900;color:#4ade80;
        text-shadow:0 2px 6px rgba(0,0,0,.6)}
      .raid-plus{width:88px;height:88px;border-radius:999px;font-size:46px;line-height:1;
        border:2px solid rgba(125,211,252,.75);background:rgba(56,189,248,.16);color:#7dd3fc;cursor:pointer}
      .raid-plus:hover{background:rgba(56,189,248,.34);color:#e0f2fe}
      .raid-plus.small{width:34px;height:34px;font-size:20px;border-width:1px}
      .raid-countdown{text-align:center;font-size:30px;font-weight:900;color:#fbbf24;
        margin:10px 0;text-shadow:0 2px 8px rgba(0,0,0,.6)}
      .raid-actions{display:flex;gap:10px;justify-content:center;margin-top:12px}
      .raid-figure{cursor:pointer;display:flex;flex-direction:column;align-items:center}
      .raid-figure-name{font-size:13px;font-weight:700;margin-top:2px}
      .raid-figure-sub{font-size:11px;color:#9fb3cd}
      .raid-face{display:block}
      .raid-bench-wrap{border-top:1px solid rgba(148,163,184,.28);padding-top:10px}
      .raid-bench-head{display:flex;align-items:center;gap:8px;font-size:13px;color:#cbd5e1;margin-bottom:8px}
      .raid-bench{display:flex;gap:10px;flex-wrap:wrap;min-height:110px}
      .raid-bench-card{cursor:pointer;border:1px solid rgba(148,163,184,.35);border-radius:12px;
        background:rgba(15,23,42,.7);padding:6px 10px 8px;text-align:center}
      .raid-bench-card.on{border-color:#38bdf8;box-shadow:0 0 0 2px rgba(56,189,248,.35)}
      /* "준비를 눌러주세요!" 는 대기칸 한가운데에 크게 */
      .raid-bench-empty{font-size:30px;font-weight:900;color:#7dd3fc;
        flex:1;display:flex;align-items:center;justify-content:center;text-align:center}
      /* 전투 — 일반 전투 무대를 그대로 쓰고 왼쪽에 세 명이 선다.
         체력창은 무대 위쪽에 가로로 놓아 캐릭터를 가리지 않게 한다. */
      .raid-stage{min-height:440px}
      .raid-ally-sprite{width:150px;height:164px}
      .raid-ally-0{bottom:16px;left:31%;z-index:4}
      .raid-ally-1{bottom:78px;left:18%;z-index:3}
      .raid-ally-2{bottom:140px;left:5%;z-index:2}
      .raid-ally-sprite.down{opacity:.35;filter:grayscale(.8)}
      .raid-monster-sprite{display:grid;place-items:center;right:5%;top:104px;width:236px;height:216px}
      .raid-party-hp{position:absolute;left:10px;right:10px;top:10px;z-index:9;
        display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
      .raid-ally-hp{background:rgba(6,13,24,.88);border:1px solid rgba(255,255,255,.10);
        border-radius:12px;padding:5px 9px;font-size:12px}
      /* 내 체력은 한눈에 찾을 수 있게 배경과 테두리를 다르게 준다 */
      .raid-ally-hp.me{border-color:rgba(56,189,248,.85);
        background:linear-gradient(180deg, rgba(14,58,86,.95), rgba(8,25,42,.95));
        box-shadow:0 0 0 2px rgba(56,189,248,.28), 0 6px 18px rgba(0,0,0,.35)}
      .raid-ally-hp.me b{color:#a5e9ff}
      .raid-ally-hp.down{opacity:.45}
      .raid-ally-slot{color:#9fb3cd;margin-left:5px;font-size:11px}
      .raid-ally-num{font-size:11px;color:#cbd5e1;text-align:right}
      .raid-combat .combat-hpbox.monster{right:5%;top:auto;bottom:16px;min-width:250px}
      .raid-next-hint{font-size:11px;color:#9fb3cd;margin-top:3px}
      .raid-next-hint.warn{color:#fbbf24;font-weight:800}
      .raid-log{max-height:190px;overflow-y:auto;background:rgba(2,6,23,.55);border-radius:10px;
        padding:8px 10px;font-size:13px;line-height:1.55;margin-top:8px}
      /* 피해 숫자와 피격 연출 — 일반 전투와 같은 감각 */
      .raid-float-layer{position:absolute;inset:0;pointer-events:none;z-index:12}
      .raid-float{position:absolute;transform:translate(-50%,0);font-weight:900;
        font-size:23px;text-shadow:0 2px 6px rgba(0,0,0,.85);animation:raidFloatUp .95s ease-out forwards}
      .raid-float.damage{color:#fb7185}
      .raid-float.crit{color:#fbbf24;font-size:30px}
      .raid-float.heal{color:#4ade80}
      .raid-float.miss{color:#cbd5e1;font-size:19px}
      @keyframes raidFloatUp{
        0%{opacity:0;transform:translate(-50%,6px) scale(.7)}
        18%{opacity:1;transform:translate(-50%,-6px) scale(1.12)}
        100%{opacity:0;transform:translate(-50%,-52px) scale(1)}
      }
      .raid-shake{animation:raidShake .42s ease-in-out both}
      @keyframes raidShake{
        0%,100%{transform:translateX(0)}
        20%{transform:translateX(-7px)} 40%{transform:translateX(6px)}
        60%{transform:translateX(-4px)} 80%{transform:translateX(3px)}
      }
      .raid-lunge{animation:raidLunge .36s ease-out both}
      @keyframes raidLunge{
        0%{transform:translateX(0)} 45%{transform:translateX(16px)} 100%{transform:translateX(0)}
      }
      .raid-stage.raid-danger{box-shadow:inset 0 0 0 3px rgba(251,191,36,.75)}
      .raid-escape-row{margin-top:10px;text-align:right}
      .raid-escape-row button{font-size:12px;opacity:.85}
      .raid-log div.crit{color:#fbbf24;font-weight:800}
      .raid-log div.miss{color:#94a3b8}
      .raid-log div.heal{color:#4ade80}
      .raid-log div.good{color:#7dd3fc;font-weight:700}
      .raid-log div.bad{color:#fca5a5;font-weight:700}
      .raid-log div.hit{color:#fca5a5}
      .raid-log div.mine{color:#7dd3fc}
      .raid-log div.warn{color:#fbbf24;font-weight:700}
      .raid-progress{font-size:12px;color:#9fb3cd;text-align:center;margin-bottom:6px}
    `;
    global.document.head.appendChild(style);
  }

  /* ---------- 파티 만들기 ---------- */

  /* 혼자 도는 버전이라 나머지 두 자리를 동료가 채운다.
     동료 능력치는 내 능력치를 기준으로 맞춰 레벨이 올라도 균형이 유지된다. */
  /* 동료 외형은 매번 달라지면 어색하므로 고정해 둔다. */
  const ALLY_LOOKS = {
    ally_guard:{ shirt:'#b45309', pants:'#334155', hair:'#312116', hairStyle:'short', skin:'#ffe0c4', accessory:'none' },
    ally_priest:{ shirt:'#4f46e5', pants:'#3f3f46', hair:'#5b3422', hairStyle:'curlyLong', skin:'#fff1df', accessory:'scarf' },
  };

  function buildParty() {
    const g = G();
    const player = g?.player;
    if (!player) return null;

    const stats = call('computeTotalStats') || {};
    const attackStat = player.class === 'mage' ? stats.지능
      : player.class === 'priest' ? stats.정신
      : stats.힘;
    const attack = Math.max(4, Math.floor(Number(attackStat) || 6));
    const maxHp = Math.max(12, Math.floor(Number(call('maxHpForPlayer', player)) || 30));

    return [
      {
        id:'me', name:player.name || '나', klass:player.class, spec:player.spec || '',
        slot:'front', maxHp, hp:maxHp, attack, isPlayer:true,
        appearance:player.appearance,
        equipment:player.equipment,
      },
      {
        id:'ally_guard', name:'훈련병 도윤', klass:'warrior', spec:'방어',
        slot:'middle', maxHp:Math.round(maxHp * 1.15), hp:Math.round(maxHp * 1.15),
        attack:Math.max(3, Math.round(attack * 0.85)),
        appearance:ALLY_LOOKS.ally_guard,
      },
      {
        id:'ally_priest', name:'수련사제 하린', klass:'priest', spec:'신성',
        slot:'back', maxHp:Math.round(maxHp * 0.85), hp:Math.round(maxHp * 0.85),
        attack:Math.max(3, Math.round(attack * 0.8)),
        appearance:ALLY_LOOKS.ally_priest,
      },
    ];
  }

  /* 캔버스 하나에 캐릭터 한 명을 그린다. 대형 화면과 전투 화면이 함께 쓴다. */
  function paintMember(canvas, member, scale = 1.5) {
    if (!canvas || !member) return;
    const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    const draw = global.drawPlayerSprite;
    if (!ctx || typeof draw !== 'function') return;
    try {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      /* 스프라이트는 기준점 아래로 발이 더 그려진다.
         0.78에 두면 발끝이 잘리므로 조금 더 위에서 시작한다. */
      draw(
        ctx,
        canvas.width / 2,
        canvas.height * 0.62,
        member.appearance || {},
        member.klass || 'warrior',
        { attack:0, moving:false, equipment:member.equipment },
        scale,
        member.spec || null,
      );
    } catch (_) { /* 그리기 실패가 진행을 막지 않게 한다 */ }
  }

  function paintAll(selector, lookup, scale) {
    global.document.querySelectorAll(selector).forEach((canvas) => {
      const member = lookup(canvas.dataset.member);
      if (member) paintMember(canvas, member, scale);
    });
  }

  /* ---------- 문제 ---------- */

  function pickQuestion() {
    const list = (call('getQuestions') || []).filter((q) => q && q.q && q.answer != null);
    if (!list.length) return { q:'7 + 5 = ?', choices:['10', '11', '12', '13'], answer:'12' };
    return list[Math.floor(Math.random() * list.length)];
  }

  /* ---------- 화면 1: 대형 배치 ---------- */

  /* 대형 화면
     - 위: 앞줄 / 중간 / 뒷줄 세 칸. 비어 있으면 큰 + 로 표시된다.
     - 아래: 아직 자리를 못 잡은 캐릭터들이 서 있는 대기칸.
     캐릭터를 먼저 고른 뒤 옮기고 싶은 칸의 + 를 누르면 그리로 간다.
     이미 배치된 캐릭터도 다른 빈칸이나 대기칸으로 다시 보낼 수 있다. */
  function openFormationScreen() {
    ensureStyles();
    const R = rules();
    const roster = active.snapshot().members;
    // 자리를 처음부터 다시 정하도록 전부 대기칸에서 시작한다.
    const placement = Object.fromEntries(roster.map((m) => [m.id, null]));
    let selected = roster[0]?.id || null;

    const memberById = (id) => roster.find((m) => m.id === id) || null;
    const inSlot = (slot) => roster.find((m) => placement[m.id] === slot) || null;
    const waiting = () => roster.filter((m) => !placement[m.id]);

    /* 준비를 누른 사람들. 셋 다 준비되면 카운트다운이 시작된다. */
    const readyIds = new Set();
    let countdown = 0;
    let countdownTimer = null;

    /* 실제로 셋이 함께 할 때는 자기 캐릭터만 옮길 수 있어야 한다.
       지금은 혼자 도는 버전이라 동료도 내가 배치한다. */
    function canControl(id) {
      if (soloMode) return true;
      return !!memberById(id)?.isPlayer;
    }

    /* 준비 버튼. 내가 맡은 캐릭터를 준비 상태로 표시한다. */
    function markReady() {
      const mine = soloMode ? roster : roster.filter((m) => m.isPlayer);
      mine.forEach((m) => readyIds.add(m.id));
      render();
      if (roster.every((m) => readyIds.has(m.id))) startCountdown();
    }

    /* 셋 다 준비되면 5초를 세고 출발한다. */
    function startCountdown() {
      if (countdownTimer) return;
      countdown = READY_COUNTDOWN;
      render();
      const tick = () => {
        countdown -= 1;
        if (countdown <= 0) {
          countdownTimer = null;
          countdown = 0;
          const result = active.confirmFormation(placement);
          if (!result.ok) { render(result.reason); return; }
          playTravelScene();
          return;
        }
        render();
        countdownTimer = global.setTimeout(tick, COUNTDOWN_STEP_MS);
      };
      countdownTimer = global.setTimeout(tick, COUNTDOWN_STEP_MS);
    }

    function moveSelectedTo(slot) {
      if (!selected) return;
      if (slot) {
        const occupant = inSlot(slot);
        // 이미 누가 서 있으면 서로 자리를 맞바꾼다(꽉 찼을 때도 바꿀 수 있게).
        if (occupant && occupant.id !== selected) placement[occupant.id] = placement[selected];
      }
      placement[selected] = slot;
      render();
    }

    function memberCanvasHtml(member, size) {
      return `<canvas class="raid-face" data-member="${esc(member.id)}" width="${size}" height="${size}"></canvas>`;
    }

    function slotHtml(slot) {
      const member = inSlot(slot);
      const label = esc(R.slotLabel(slot));
      if (!member) {
        return `
          <div class="raid-post empty" data-slot="${slot}">
            <div class="raid-post-title">${label}</div>
            <button class="raid-plus" data-slot="${slot}" title="${label}에 세우기">+</button>
          </div>`;
      }
      const ready = readyIds.has(member.id);
      return `
        <div class="raid-post filled ${selected === member.id ? 'on' : ''} ${ready ? 'ready' : ''}" data-slot="${slot}">
          <div class="raid-post-title">${label}</div>
          <div class="raid-figure" data-pick="${esc(member.id)}">
            ${memberCanvasHtml(member, 132)}
            <div class="raid-figure-name">${esc(member.name)}${member.isPlayer ? ' (나)' : ''}</div>
            <div class="raid-figure-sub">${esc(member.spec || '전문화 없음')}</div>
          </div>
          ${ready ? '<div class="raid-ready-badge">Ready!</div>' : ''}
        </div>`;
    }

    function render(message = '') {
      const bench = waiting();
      const benchHtml = bench.length
        ? bench.map((member) => `
            <div class="raid-bench-card ${selected === member.id ? 'on' : ''}" data-pick="${esc(member.id)}">
              ${memberCanvasHtml(member, 120)}
              <div class="raid-figure-name">${esc(member.name)}${member.isPlayer ? ' (나)' : ''}</div>
              <div class="raid-figure-sub">${esc(member.spec || '전문화 없음')} · 공격 ${member.attack} · HP ${member.maxHp}</div>
            </div>`).join('')
        : '<div class="raid-bench-empty">준비를 눌러주세요!</div>';

      const seated = R.SLOTS.every((slot) => !!inSlot(slot));
      const allReady = seated && roster.every((m) => readyIds.has(m.id));

      call('openModal', `
        <h2>${esc(active.snapshot().title)}</h2>
        <div class="panel-card raid-formation">
          <p class="raid-hint">캐릭터를 고른 뒤 세우고 싶은 자리의 <strong>+</strong>를 누르세요. 이미 세운 캐릭터도 다시 옮길 수 있습니다.</p>
          <!-- 전투 배치와 같은 순서로 보여 준다: 왼쪽이 뒤, 오른쪽이 앞 -->
          <div class="raid-posts">${[...R.SLOTS].reverse().map(slotHtml).join('')}</div>
          <div class="raid-bench-wrap">
            <div class="raid-bench-head">
              <span>대기 중</span>
              <button class="raid-plus small" data-slot="" title="대기칸으로 보내기">+</button>
            </div>
            <div class="raid-bench">${benchHtml}</div>
          </div>
          ${countdown > 0 ? `<div class="raid-countdown">${countdown}초 뒤 출발!</div>` : ''}
          ${message ? `<p class="raid-error">${esc(message)}</p>` : ''}
          <div class="raid-actions">
            <button class="primary" id="raidStartBtn" ${seated && !allReady ? '' : 'disabled'}>${
              allReady ? '출발 준비 완료' : (seated ? '준비' : '세 자리를 모두 채우세요')
            }</button>
            <button class="ghost" id="raidCancelBtn">돌아가기</button>
          </div>
        </div>
      `, { type:'raidFormation', pause:true });

      paintAll('.raid-face', memberById, 1.35);

      global.document.querySelectorAll('[data-pick]').forEach((node) => {
        node.onclick = () => {
          const id = node.dataset.pick;
          if (!canControl(id)) { render('다른 사람의 캐릭터는 옮길 수 없습니다.'); return; }
          selected = id;
          render();
        };
      });
      global.document.querySelectorAll('.raid-plus').forEach((button) => {
        button.onclick = () => {
          if (countdown > 0) return;   // 카운트다운 중에는 자리를 바꿀 수 없다
          if (!selected) { render('먼저 옮길 캐릭터를 고르세요.'); return; }
          if (!canControl(selected)) { render('다른 사람의 캐릭터는 옮길 수 없습니다.'); return; }
          // 자리를 바꾸면 준비를 다시 눌러야 한다.
          readyIds.clear();
          moveSelectedTo(button.dataset.slot || null);
        };
      });

      const startBtn = global.document.getElementById('raidStartBtn');
      if (startBtn) {
        startBtn.onclick = () => {
          /* 여기서는 '확인만' 한다. confirmFormation은 진행 상태를 바꾸므로
             카운트다운이 끝난 뒤 딱 한 번만 부른다. */
          const seatedMembers = roster.map((m) => ({ ...m, slot:placement[m.id] }));
          const check = R.validateFormation(seatedMembers);
          if (!check.ok) { render(check.reason); return; }
          markReady();
        };
      }
      const cancelBtn = global.document.getElementById('raidCancelBtn');
      if (cancelBtn) {
        cancelBtn.onclick = () => {
          if (countdownTimer) { global.clearInterval(countdownTimer); countdownTimer = null; }
          leaveDungeonNow();
        };
      }
    }

    render();
  }

  /* ---------- 던전 맵 (화면 전체) ---------- */

  const MAP_KEY = 'raidTower';
  const LOADING_TAIL_MS = 820;   // 로딩 오버레이가 완전히 걷힐 때까지 기다리는 시간
  let walkStartedAt = 0;   // 이동 연출 시작 시각
  let walkProgress = 1;    // 0=출발 지점, 1=몬스터 앞
  let returnMap = 'town';
  let returnPos = null;

  function ensureDungeonMap() {
    const worlds = global.YuksamData && global.YuksamData.worldDefs;
    if (!worlds || worlds[MAP_KEY]) return worlds;
    worlds[MAP_KEY] = {
      key:MAP_KEY,
      label:'63빌딩 던전 1층',
      width:1280,
      height:720,
      playerSpawn:{ x:200, y:520 },
    };
    return worlds;
  }

  /* 던전 내부를 화면 가득 그린다. 마을이 아니라 완전히 다른 장소로 보이게 한다. */
  function drawDungeon() {
    const g = G();
    const ctx = g?.ctx;
    if (!ctx) return;
    const w = g.width;
    const h = g.height;
    const t = (global.performance ? performance.now() : Date.now()) / 1000;

    // 바닥과 벽
    const wall = ctx.createLinearGradient(0, 0, 0, h);
    wall.addColorStop(0, '#0b1220');
    wall.addColorStop(0.52, '#16233a');
    wall.addColorStop(0.53, '#1f2a3c');
    wall.addColorStop(1, '#0d1522');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, w, h);

    /* 파티는 화면 왼쪽에 서 있고, 배경이 오른쪽에서 왼쪽으로 흘러간다.
       그래야 "복도를 따라 실제로 나아간다"는 느낌이 난다.
       scroll은 지금까지 지나온 거리(픽셀)다. */
    const scroll = travelScroll();

    // 안쪽으로 뻗은 복도 (원근감) — 가로선은 고정, 세로선만 흘러간다
    ctx.strokeStyle = 'rgba(148,163,184,.16)';
    ctx.lineWidth = 2;
    for (let i = 1; i <= 7; i += 1) {
      const y = h * 0.53 + (h * 0.47) * (i / 7) * (i / 7);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    const tileW = w / 10;
    for (let i = -1; i <= 11; i += 1) {
      const x = i * tileW - (scroll % tileW);
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.lineTo(w / 2 + (x - w / 2) * 0.22, h * 0.53);
      ctx.stroke();
    }

    // 벽면 창문 — 바깥 도시의 불빛. 함께 흘러간다.
    const winGap = (w - 80) / 9;
    for (let i = -1; i < 11; i += 1) {
      const x = 40 + i * winGap - (scroll * 0.82) % winGap - (Math.floor((scroll * 0.82) / winGap) % 1);
      const seed = ((i + Math.floor((scroll * 0.82) / winGap)) % 7 + 7) % 7;
      const lit = seed < 3;
      ctx.fillStyle = lit
        ? `rgba(255,214,120,${(0.35 + 0.25 * Math.sin(t * 1.1 + seed)).toFixed(3)})`
        : 'rgba(120,150,190,.12)';
      ctx.fillRect(x, h * 0.16, 62, 108);
      ctx.strokeStyle = 'rgba(10,16,26,.7)';
      ctx.lineWidth = 3;
      ctx.strokeRect(x, h * 0.16, 62, 108);
    }

    // 천장 형광등 (깜빡임) — 역시 흘러간다
    const lampGap = w * 0.22;
    for (let i = -1; i < 6; i += 1) {
      const x = w * 0.18 + i * lampGap - (scroll * 0.9) % lampGap;
      const seed = ((i + Math.floor((scroll * 0.9) / lampGap)) % 4 + 4) % 4;
      const flick = seed === 2 ? (Math.sin(t * 14) > -0.2 ? 1 : 0.25) : 1;
      const lamp = ctx.createRadialGradient(x, 40, 0, x, 40, 190);
      lamp.addColorStop(0, `rgba(200,230,255,${(0.20 * flick).toFixed(3)})`);
      lamp.addColorStop(1, 'rgba(200,230,255,0)');
      ctx.fillStyle = lamp;
      ctx.beginPath();
      ctx.arc(x, 40, 190, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(226,240,255,${(0.75 * flick).toFixed(3)})`;
      ctx.fillRect(x - 46, 24, 92, 7);
    }

    // 층 표시
    const snap = active ? active.snapshot() : null;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '600 15px Noto Sans KR, system-ui';
    ctx.fillStyle = 'rgba(226,240,255,.7)';
    if (snap) {
      ctx.fillText(`${snap.title}   ·   ${Math.min(snap.encounterIndex + 1, snap.encounterTotal)} / ${snap.encounterTotal}`, w / 2, 78);
    }
    ctx.restore();

    drawParty();
    drawApproachingMonster();
    drawEncounterBanner();
  }

  /* 이동이 끝날 무렵 오른쪽 복도 끝에서 몬스터가 걸어 나온다. */
  function drawApproachingMonster() {
    const g = G();
    const ctx = g?.ctx;
    if (!ctx || !active || !encounterMonster) return;
    const p = encounterProgress();
    if (p <= 0) return;
    const w = g.width;
    const h = g.height;
    // 복도 끝(오른쪽 밖)에서 화면 안쪽으로 들어온다.
    const x = w * (1.06 - 0.24 * p);
    const y = h * 0.74;
    const scale = 0.55 + 0.45 * p;

    ctx.save();
    ctx.globalAlpha = Math.min(1, p * 1.6);
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.translate(-x, -y);
    const painter = MONSTER_PAINTERS[encounterMonster.id] || MONSTER_PAINTERS.guardBot;
    // 바닥 그림자
    ctx.fillStyle = 'rgba(4,10,18,.35)';
    ctx.beginPath();
    ctx.ellipse(x, y + 62, 46, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    try {
      painter(ctx, x, y, (global.performance ? performance.now() : Date.now()) / 1000, encounterMonster);
    } catch (_) { /* 그리기 실패가 진행을 막지 않게 한다 */ }
    ctx.restore();
  }

  /* "적 등장!" 경고 문구 */
  function drawEncounterBanner() {
    const g = G();
    const ctx = g?.ctx;
    if (!ctx || !encounterMonster) return;
    const p = encounterProgress();
    if (p < 0.35) return;
    const w = g.width;
    const h = g.height;
    const alpha = Math.min(1, (p - 0.35) / 0.25);
    const pulse = 1 + 0.06 * Math.sin((global.performance ? performance.now() : Date.now()) / 90);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.translate(w / 2, h * 0.34);
    ctx.scale(pulse, pulse);
    ctx.font = '900 46px Jua, Noto Sans KR, system-ui';
    ctx.lineWidth = 9;
    ctx.strokeStyle = 'rgba(8,12,20,.9)';
    ctx.strokeText('적 등장!', 0, 0);
    ctx.fillStyle = '#fb7185';
    ctx.fillText('적 등장!', 0, 0);
    ctx.font = '700 20px Noto Sans KR, system-ui';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(8,12,20,.9)';
    ctx.strokeText(encounterMonster.name, 0, 38);
    ctx.fillStyle = '#ffe6a3';
    ctx.fillText(encounterMonster.name, 0, 38);
    ctx.restore();
  }

  /* 파티 세 명을 대형 순서대로 그린다. 이동 중이면 걸어가는 것처럼 옮겨 준다. */
  function drawParty() {
    const g = G();
    const ctx = g?.ctx;
    const draw = global.drawPlayerSprite;
    if (!ctx || !active || typeof draw !== 'function') return;
    const R = rules();
    const snap = active.snapshot();
    const w = g.width;
    const h = g.height;

    /* 파티는 화면 왼쪽에 서 있다(배경이 흘러가며 나아가는 느낌).
       조우 연출 동안에는 몬스터 쪽을 향해 조금 더 앞으로 나선다. */
    const moving = walkProgress < 1;
    const baseX = w * (0.20 + 0.06 * encounterProgress());
    const order = { front:0, middle:1, back:2 };

    snap.members.forEach((member) => {
      const index = order[member.slot] ?? 1;
      // 앞줄이 가장 앞(오른쪽), 뒷줄이 뒤에 선다.
      const x = baseX - index * 62;
      const y = h * 0.80 + index * 10;
      const step = moving ? Math.abs(Math.sin((walkProgress * 9) + index)) * 6 : 0;
      ctx.save();
      ctx.globalAlpha = member.hp > 0 ? 1 : 0.35;
      try {
        draw(ctx, x, y - step, member.appearance || {}, member.klass || 'warrior',
          { attack:0, moving, equipment:member.equipment }, 1.5, member.spec || null);
      } catch (_) { /* 그리기 실패가 진행을 막지 않게 한다 */ }
      ctx.restore();

      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = '600 12px Noto Sans KR, system-ui';
      ctx.fillStyle = member.hp > 0 ? '#e2e8f0' : '#94a3b8';
      // 이동 중에는 이름만 보여 준다(자리 이름은 로비와 전투에서 확인한다).
      ctx.fillText(member.name, x, y + 20);
      ctx.restore();
    });
  }

  function enterDungeonMap(onReady) {
    const g = G();
    const worlds = ensureDungeonMap();
    if (!g || !worlds) { onReady?.(); return; }
    returnMap = g.currentMap || 'town';
    returnPos = g.player ? { x:g.player.x, y:g.player.y } : null;

    const move = () => {
      g.currentMap = MAP_KEY;
      if (g.player) {
        g.player.map = MAP_KEY;
        g.player.x = worlds[MAP_KEY].playerSpawn.x;
        g.player.y = worlds[MAP_KEY].playerSpawn.y;
      }
      call('updateHud');
      call('syncAudioFileBgm');   // 던전 음악으로 갈아탄다
      toggleReturnButton(true);   // 던전 안에서도 언제든 마을로 나갈 수 있게
    };

    if (typeof global.showLoadingTransition === 'function') {
      /* showLoadingTransition은 콜백이 끝난 뒤에도 modalState를 'loading'으로
         다시 덮어쓰고, 약 720ms 뒤에야 되돌린다. 그 안에서 창을 열면
         modalState가 지워지므로 로딩이 완전히 걷힌 뒤에 연다. */
      global.showLoadingTransition('63빌딩 던전으로 들어갑니다.', () => {
        move();
        global.setTimeout(() => onReady?.(), LOADING_TAIL_MS);
      });
    } else {
      move();
      onReady?.();
    }
  }

  function leaveDungeonMap() {
    const g = G();
    const worlds = global.YuksamData && global.YuksamData.worldDefs;
    if (!g || !worlds) return;
    const back = () => {
      g.currentMap = returnMap || 'town';
      if (g.player) {
        g.player.map = g.currentMap;
        const spawn = returnPos || worlds[g.currentMap]?.playerSpawn || { x:1200, y:1700 };
        g.player.x = spawn.x;
        g.player.y = spawn.y;
      }
      call('updateHud');
      call('savePlayer');
      call('syncAudioFileBgm');   // 마을 음악으로 되돌린다
      toggleReturnButton(false);
    };
    if (typeof global.showLoadingTransition === 'function') {
      global.showLoadingTransition('마을로 돌아갑니다.', back);
    } else {
      back();
    }
  }

  /* ---------- 화면 2: 이동 (던전 맵 위에서) ---------- */

  /* 걷는 시간과 조우 연출 시간.
     복도를 지나는 느낌이 나도록 넉넉히 잡는다. */
  let WALK_MS = 4200;          // 배경이 흘러가는 구간
  /* 조우 효과음은 부저가 세 번 울린다. 세 번째 부저까지 들은 뒤 전투가 시작되도록
     연출을 넉넉히 잡는다(예전에는 두 번째 부저에서 전투가 시작됐다). */
  let ENCOUNTER_MS = 3400;     // 몬스터가 나타나 "적 등장!"이 뜨는 구간
  const SCROLL_SPEED = 240;    // 초당 흘러가는 픽셀

  let encounterMonster = null;
  let encounterStartedAt = 0;

  /* 지금까지 흘러온 배경 거리(픽셀). */
  function travelScroll() {
    return walkProgress * (WALK_MS / 1000) * SCROLL_SPEED;
  }

  /* 조우 연출 진행도 0~1. */
  function encounterProgress() {
    if (!encounterMonster || !encounterStartedAt) return 0;
    const now = (global.performance ? performance.now() : Date.now());
    return Math.max(0, Math.min(1, (now - encounterStartedAt) / ENCOUNTER_MS));
  }

  function playTravelScene() {
    // 모달을 닫아 던전 맵이 화면을 가득 채우게 한다.
    call('closeModal');
    walkStartedAt = (global.performance ? performance.now() : Date.now());
    walkProgress = 0;
    encounterMonster = null;
    encounterStartedAt = 0;

    // 다음에 만날 몬스터를 미리 알아 둔다(등장 연출에 필요).
    const R = rules();
    const snap = active.snapshot();
    const upcoming = R.floorEncounters(snap.floor)[snap.encounterIndex] || null;

    const tick = () => {
      if (!active) return;
      const now = (global.performance ? performance.now() : Date.now());
      walkProgress = Math.min(1, (now - walkStartedAt) / WALK_MS);

      // 걷기가 끝나면 몬스터가 복도 끝에서 나타난다.
      if (walkProgress >= 1 && !encounterStartedAt) {
        if (!upcoming) { finishTravel(); return; }
        encounterMonster = upcoming;
        encounterStartedAt = now;
        playEncounterSound();
      }

      if (encounterStartedAt && encounterProgress() >= 1) { finishTravel(); return; }

      if (global.requestAnimationFrame) global.requestAnimationFrame(tick);
      else global.setTimeout(tick, 32);
    };

    if (global.requestAnimationFrame) global.requestAnimationFrame(tick);
    else global.setTimeout(tick, 32);
  }

  function finishTravel() {
    encounterMonster = null;
    encounterStartedAt = 0;
    const arrival = active.arriveAtEncounter();
    if (!arrival.ok) return;
    if (arrival.cleared) { finishRun(); return; }
    openBattleScreen();
  }

  /* 매니페스트에 등록된 소리를 낸다.
     실제 API 이름은 window.playMappedAudio 다(예전에 잘못된 이름을 써서 소리가 나지 않았다). */
  function playAsset(audioId, fallbackSfx) {
    if (!audioId) return false;
    if (typeof global.playMappedAudio === 'function') {
      try {
        if (global.playMappedAudio(audioId)) return true;
      } catch (_) { /* 아래로 */ }
    }
    if (fallbackSfx) call('playSfx', fallbackSfx);
    return false;
  }

  /* 몬스터를 만나는 순간의 효과음. */
  function playEncounterSound() {
    playAsset('dungeonEncounter', 'hit');
  }

  /* ---------- 화면 3: 전투 ---------- */

  function openBattleScreen() {
    ensureStyles();
    question = null;          // 문제는 공격/스킬을 고른 뒤에 나온다
    chosenAction = null;
    currentLine = null;
    busy = false;
    panelMode = 'menu';
    panelMessage = '무엇을 할까?';
    renderBattle();
  }

  /* 왼쪽에 세 명이 대형 순서대로 선다(앞줄이 가장 앞). */
  function partySpriteHtml(members) {
    const order = { front:0, middle:1, back:2 };
    return [...members]
      .sort((a, b) => (order[a.slot] ?? 1) - (order[b.slot] ?? 1))
      .map((member, index) => `
        <div class="combat-sprite raid-ally-sprite raid-ally-${index} ${member.hp <= 0 ? 'down' : ''}">
          <canvas class="raid-battle-face" data-member="${esc(member.id)}" width="132" height="172"></canvas>
        </div>`).join('');
  }

  function partyHpHtml(members) {
    const R = rules();
    const order = { front:0, middle:1, back:2 };
    return [...members]
      .sort((a, b) => (order[a.slot] ?? 1) - (order[b.slot] ?? 1))
      .map((member) => {
        const percent = Math.max(0, Math.round((member.hp / member.maxHp) * 100));
        return `
          <div class="raid-ally-hp ${member.hp <= 0 ? 'down' : ''} ${member.isPlayer ? 'me' : ''}">
            <b>${esc(member.name)}${member.isPlayer ? ' (나)' : ''}</b>
            <span class="raid-ally-slot">${esc(R.slotLabel(member.slot))}</span>
            <div class="hpbar"><div class="hpfill" style="width:${percent}%"></div></div>
            <div class="raid-ally-num">${member.hp}/${member.maxHp}</div>
          </div>`;
      }).join('');
  }

  /* 일반 몬스터 전투와 똑같이 "지금 이 한 줄"만 보여 준다.
     예전 기록을 쌓아 두지 않는다(제작자 요구). */
  let currentLine = null;

  function logHtml() {
    if (!currentLine) return '';
    const entry = currentLine;
    const cls = entry.missed ? 'miss'
      : entry.critical ? 'crit'
      : entry.kind === 'monster-hit' ? 'hit'
      : entry.kind === 'party-hit' ? 'mine'
      : entry.kind === 'party-heal' ? 'heal'
      : entry.kind === 'answer-correct' ? 'good'
      : entry.kind === 'answer-wrong' ? 'bad'
      : ['monster-windup', 'monster-down', 'member-down', 'wiped', 'encounter'].includes(entry.kind) ? 'warn'
      : '';
    return `<div class="${cls}">${esc(entry.text)}</div>`;
  }

  /* ---------- 아래 패널: 일반 전투와 같은 3단계 ----------
     menu    : 공격 / 스킬 / 포기
     skills  : 배운 액티브 스킬 목록
     question: 문제 풀이 (공격 또는 스킬을 고른 뒤)
     playing : 결과 재생 중 */
  let panelMode = 'menu';
  let chosenAction = null;      // 'attack' 또는 'active:스킬id'
  let panelMessage = '무엇을 할까?';

  function learnedSkills() {
    const list = call('getLearnedActiveSkills') || [];
    return Array.isArray(list) ? list : [];
  }

  function actionLabel() {
    if (!chosenAction || chosenAction === 'attack') return '공격';
    const defs = global.SKILL_DEFS || global.YuksamData?.SKILL_DEFS || {};
    const skill = defs[String(chosenAction).slice(7)];
    return skill?.active?.name || '스킬';
  }

  function panelHtml() {
    if (panelMode === 'playing') {
      return `<h3>${esc(panelMessage)}</h3><p class="raid-hint">진행 중…</p>`;
    }

    if (panelMode === 'skills') {
      const skills = learnedSkills();
      if (!skills.length) {
        return '<h3>아직 획득한 액티브 스킬이 없습니다.</h3>'
          + '<div class="combat-menu"><button class="ghost" data-raid-menu="back">뒤로</button></div>';
      }
      const buttons = skills.map((skill) => {
        const cd = Number(call('getSkillCooldown', skill.id) || 0);
        return `<button class="primary" ${cd > 0 ? 'disabled' : ''} data-raid-skill="${esc(skill.id)}">`
          + `${esc(skill.active?.name || skill.name || '스킬')}${cd > 0 ? ` · ${cd}턴` : ''}</button>`;
      }).join('');
      return '<h3>사용할 스킬을 선택하세요.</h3>'
        + `<div class="combat-menu">${buttons}<button class="ghost" data-raid-menu="back">뒤로</button></div>`;
    }

    if (panelMode === 'question') {
      const choices = Array.isArray(question?.choices) && question.choices.length === 4 ? question.choices : null;
      const answer = choices
        ? `<div class="choice-grid">${choices.map((choice, i) => `
            <button class="primary raid-choice" data-choice="${i}">${esc(choice)}</button>`).join('')}</div>`
        : `<div class="answer-row">
            <input id="raidAnswer" placeholder="정답 입력" autocomplete="off" />
            <button class="primary" id="raidSubmitBtn">${esc(actionLabel())}</button>
          </div>`;
      return `<h3>${esc(question?.q || '')}</h3>${answer}`;
    }

    // 기본 메뉴 — 일반 전투와 같은 구성(도망 자리에 포기)
    return `<h3>${esc(panelMessage)}</h3>
      <div class="combat-menu">
        <button class="primary" data-raid-menu="attack">공격</button>
        <button class="primary" data-raid-menu="skill">스킬</button>
        <button class="ghost" data-raid-menu="giveup">포기</button>
      </div>`;
  }

  function bindPanel() {
    global.document.querySelectorAll('[data-raid-menu]').forEach((button) => {
      button.onclick = () => {
        const what = button.dataset.raidMenu;
        if (what === 'attack') startAction('attack');
        else if (what === 'skill') { panelMode = 'skills'; renderBattle(); }
        else if (what === 'back') { panelMode = 'menu'; panelMessage = '무엇을 할까?'; renderBattle(); }
        else if (what === 'giveup') confirmGiveUp();
      };
    });
    global.document.querySelectorAll('[data-raid-skill]').forEach((button) => {
      button.onclick = () => startAction(`active:${button.dataset.raidSkill}`);
    });
    global.document.querySelectorAll('.raid-choice').forEach((button) => {
      button.onclick = () => submitAnswer(question.choices[Number(button.dataset.choice)]);
    });
    const submitBtn = global.document.getElementById('raidSubmitBtn');
    const input = global.document.getElementById('raidAnswer');
    if (submitBtn && input) {
      submitBtn.onclick = () => submitAnswer(input.value);
      input.onkeydown = (event) => { if (event.key === 'Enter') submitAnswer(input.value); };
      input.focus();
    }
  }

  /* 공격이나 스킬을 고르면 문제가 나온다(일반 전투와 같은 흐름). */
  function startAction(action) {
    chosenAction = action;
    question = question || pickQuestion();
    panelMode = 'question';
    renderBattle();
  }

  function renderBattle() {
    const snap = active.snapshot();
    const monster = snap.monster;
    if (!monster) return;
    const percent = Math.max(0, Math.round((monster.hp / monster.maxHp) * 100));
    const nextKind = rules().attackKindForRound(monster, snap.round);

    // 일반 전투와 같은 무대(combat-stage)를 쓰되 왼쪽에 세 명이 선다.
    call('openModal', `
      <h2>전투 — ${esc(snap.title)}</h2>
      <div class="combat-layout raid-combat">
        <div class="combat-stage raid-stage">
          <div class="combat-hpbox monster">
            <b>${monster.isBoss ? '👑 ' : ''}Lv.${monster.level} ${esc(monster.name)}</b>
            <div>HP ${monster.hp}/${monster.maxHp}</div>
            <div class="hpbar"><div class="hpfill" style="width:${percent}%"></div></div>
            <div class="raid-next-hint ${nextKind === 'all' ? 'warn' : ''}">
              ${nextKind === 'all' ? '⚠ 다음은 전체 공격!' : '다음은 앞을 노립니다'}
            </div>
          </div>
          <div class="raid-party-hp">${partyHpHtml(snap.members)}</div>
          ${partySpriteHtml(snap.members)}
          <div class="combat-sprite combat-monster raid-monster-sprite ${monster.isBoss ? 'boss' : ''}">
            <canvas id="raidMonsterCanvas" width="230" height="210"></canvas>
          </div>
          <div id="raidFloatLayer" class="raid-float-layer"></div>
        </div>
        <div class="panel-card">
          <p class="raid-progress">${snap.encounterIndex + 1} / ${snap.encounterTotal}</p>
          <!-- 일반 전투와 같은 순서: 전투 기록이 위, 행동/문제가 아래 -->
          <div class="raid-log">${logHtml()}</div>
          ${panelHtml()}
        </div>
      </div>
    `, { type:'raidBattle', pause:true });

    paintAll('.raid-battle-face', (id) => snap.members.find((m) => m.id === id), 1.4);
    drawMonsterModel(global.document.getElementById('raidMonsterCanvas'), monster);
    bindPanel();
  }

  /* 소리는 게임의 오디오 목록을 그대로 쓴다. 없으면 조용히 넘어간다. */
  function playEventSound(event) {
    if (!event) return;
    if (event.audioId) {
      playAsset(event.audioId, event.audioId === 'miss' ? 'miss' : 'hit');
      return;
    }
    if (event.kind === 'party-hit') call('playSfx', 'hit');
    else if (event.kind === 'monster-hit') call('playSfx', 'hit');
    else if (event.kind === 'party-heal') call('playSfx', 'heal');
    else if (event.kind === 'monster-down') call('playSfx', 'quest');
  }

  /* 일반 전투처럼 피해 숫자를 대상 위에 띄우고 맞은 쪽을 흔든다.
     학생이 자기 몫의 피해를 눈으로 확인할 수 있어야 하기 때문이다. */
  function floatNumber(anchor, text, kind) {
    const layer = global.document.getElementById('raidFloatLayer');
    const stage = global.document.querySelector('.raid-stage');
    if (!layer || !stage || !anchor) return;
    const box = anchor.getBoundingClientRect?.();
    const base = stage.getBoundingClientRect?.();
    if (!box || !base || !box.width) return;
    const node = global.document.createElement('div');
    node.className = `raid-float ${kind}`;
    node.textContent = text;
    node.style.left = `${box.left - base.left + box.width / 2}px`;
    node.style.top = `${box.top - base.top + box.height * 0.28}px`;
    layer.appendChild(node);
    global.setTimeout(() => { try { node.remove(); } catch (_) {} }, 1000);
  }

  function shake(node) {
    if (!node || !node.classList) return;
    node.classList.remove('raid-shake');
    // 클래스를 다시 붙여야 애니메이션이 재생된다.
    void (node.offsetWidth);
    node.classList.add('raid-shake');
    global.setTimeout(() => { try { node.classList.remove('raid-shake'); } catch (_) {} }, 450);
  }

  function memberSpriteNode(memberId) {
    const canvas = global.document.querySelector(`.raid-battle-face[data-member="${memberId}"]`);
    return canvas ? canvas.parentNode : null;
  }

  function showEventEffect(event) {
    if (!event) return;
    const monsterNode = global.document.querySelector('.raid-monster-sprite');

    if (event.kind === 'party-hit') {
      if (event.missed) floatNumber(monsterNode, 'MISS', 'miss');
      else {
        floatNumber(monsterNode, `-${event.damage}`, event.critical ? 'crit' : 'damage');
        shake(monsterNode);
      }
      // 때린 사람도 살짝 앞으로 튀어나오게 한다.
      const attacker = memberSpriteNode(event.memberId);
      if (attacker && !event.missed) {
        attacker.classList.add('raid-lunge');
        global.setTimeout(() => { try { attacker.classList.remove('raid-lunge'); } catch (_) {} }, 380);
      }
      return;
    }

    if (event.kind === 'monster-hit') {
      const target = memberSpriteNode(event.memberId);
      if (event.missed) { floatNumber(target, 'MISS', 'miss'); return; }
      floatNumber(target, `-${event.damage}`, event.critical ? 'crit' : 'damage');
      shake(target);
      return;
    }

    if (event.kind === 'party-heal') {
      floatNumber(memberSpriteNode(event.memberId), `+${event.amount}`, 'heal');
      return;
    }

    if (event.kind === 'monster-windup' && event.all) {
      const stage = global.document.querySelector('.raid-stage');
      if (stage) {
        stage.classList.add('raid-danger');
        global.setTimeout(() => { try { stage.classList.remove('raid-danger'); } catch (_) {} }, 620);
      }
    }
  }

  /* 한 라운드에서 일어난 일을 한 줄씩 차례로 보여 준다.
     한 줄이 나오면 이전 줄은 지워진다(일반 전투와 같다).
     각 줄은 최소 1.5초씩 보여 준다 — 학생이 읽을 시간이 필요하다. */
  let eventDelayMs = 1500;

  function playEvents(events, onDone) {
    currentLine = null;
    let index = 0;
    const step = () => {
      if (!active) return;
      if (index >= events.length) { onDone?.(); return; }
      const event = events[index];
      index += 1;
      currentLine = event;      // 이전 줄을 지우고 이 줄만 보여 준다
      playEventSound(event);
      renderBattle();
      showEventEffect(event);   // 숫자와 흔들림은 그린 뒤에 얹는다
      global.setTimeout(step, eventDelayMs);
    };
    step();
  }

  /* 파티원의 직업 기본 공격 소리(또는 고른 스킬 소리)를 낸다.
     세 명이 각자 때리므로 각자의 직업 소리가 순서대로 들린다. */
  function attackAudioIdFor(member) {
    const manifest = global.YuksamAudioManifest;
    if (!manifest) return null;
    // 내가 스킬을 골랐으면 내 공격만 스킬 소리로 낸다.
    if (member?.isPlayer && chosenAction && chosenAction !== 'attack') {
      const skillId = String(chosenAction).slice(7);
      return manifest.skillSounds?.[skillId] || manifest.classBasicSounds?.[member.klass] || null;
    }
    return manifest.classBasicSounds?.[member?.klass] || null;
  }

  function submitAnswer(given) {
    if (busy || !active || active.phase !== 'battle') return;
    busy = true;
    panelMode = 'playing';
    panelMessage = '전투 중…';

    const correct = norm(given) === norm(question?.answer);
    const answers = active.rollAllyAnswers();
    answers.me = correct;

    const snapBefore = active.snapshot();
    const result = active.resolveRound(answers);
    if (!result.ok) { busy = false; panelMode = 'menu'; return; }

    // 정답/오답을 먼저 알려 준 뒤 공격이 이어진다(일반 전투와 같은 순서).
    const opening = {
      kind:correct ? 'answer-correct' : 'answer-wrong',
      text:correct ? '정답!' : `오답입니다! 정답은 ${question?.answer} (피해가 절반만 들어갑니다)`,
    };

    /* 파티원 공격에는 각자의 직업 소리를 붙인다.
       턴 순서는 캐릭1 → 캐릭2 → 캐릭3 → 적 공격이다. */
    const withSounds = result.events.map((event) => {
      if (event.kind !== 'party-hit' || event.missed) return event;
      const member = snapBefore.members.find((m) => m.id === event.memberId);
      const audioId = attackAudioIdFor(member);
      return audioId && !event.audioId ? { ...event, audioId } : event;
    });

    playEvents([opening, ...withSounds], () => {
      if (!active) return;
      if (result.wiped || result.cleared) { finishRun(); return; }
      /* 몬스터를 쓰러뜨렸으면 곧바로 이동으로 넘어간다.
         이때 문제와 행동 버튼을 반드시 지워야 한다(예전에 남아 있던 버그). */
      if (result.monsterDown) {
        question = null;
        chosenAction = null;
        panelMode = 'playing';
        playTravelScene();
        return;
      }
      question = pickQuestion();
      chosenAction = null;
      currentLine = null;
      busy = false;
      panelMode = 'menu';
      panelMessage = '무엇을 할까?';
      renderBattle();
    });
  }

  /* ---------- 끝맺음 ---------- */

  function finishRun() {
    if (!active) return;
    const snap = active.snapshot();
    const cleared = snap.phase === 'cleared';
    const reward = snap.reward || {};
    const g = G();

    if (cleared && g?.player) {
      call('addExp', reward.exp || 0);
      call('addGold', reward.gold || 0);
      if (reward.building) g.player.building = (g.player.building || 0) + reward.building;
      call('savePlayer');
      call('updateHud');
    }

    call('playSfx', cleared ? 'quest' : 'hit');
    call('openModal', `
      <h2>${cleared ? '🏆 1층 돌파!' : '전멸…'}</h2>
      <div class="panel-card">
        ${cleared
          ? `<p>63빌딩 관리자를 쓰러뜨렸습니다!</p>
             <p>EXP +${reward.exp || 0} · Gold +${reward.gold || 0} · 빌딩 +${reward.building || 0}</p>`
          : '<p>다음에는 대형을 바꿔서 다시 도전해 보세요.</p>'}
        <div class="answer-row"><button class="primary" id="raidDoneBtn">확인</button></div>
      </div>
    `, { type:'raidResult', pause:true });

    call('appendChatMessage', 'system', '63빌딩 던전',
      cleared ? '1층을 돌파했습니다!' : '1층에서 전멸했습니다.');

    const doneBtn = global.document.getElementById('raidDoneBtn');
    if (doneBtn) {
      doneBtn.onclick = () => {
        active = null;
        question = null;
        call('closeModal');
        leaveDungeonMap();   // 던전에서 마을로 실제로 돌아간다
      };
    }
  }

  /* ---------- 밖에서 부르는 입구 ---------- */

  /* ---------- 던전 몬스터 그림 ----------
     이모티콘 대신 버섯돌이·스톰프처럼 직접 그린 모델을 쓴다.
     캔버스 하나를 받아 가운데에 그린다. */

  function drawMonsterModel(canvas, monster, hurt = false) {
    if (!canvas || !monster) return;
    const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    if (!ctx) return;
    const cx = canvas.width / 2;
    const cy = canvas.height * 0.62;
    const t = (global.performance ? performance.now() : Date.now()) / 1000;
    try {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      if (hurt) ctx.globalAlpha = 0.75;
      // 바닥 그림자
      ctx.fillStyle = 'rgba(4,10,18,.35)';
      ctx.beginPath();
      ctx.ellipse(cx, cy + 62, 46, 13, 0, 0, Math.PI * 2);
      ctx.fill();
      const painter = MONSTER_PAINTERS[monster.id] || MONSTER_PAINTERS.guardBot;
      painter(ctx, cx, cy, t, monster);
      ctx.restore();
    } catch (_) { /* 그리기 실패가 전투를 막지 않게 한다 */ }
  }

  const MONSTER_PAINTERS = {
    /* 경비 로봇 — 네모난 몸통, 하나뿐인 붉은 눈, 회전하는 경광등 */
    guardBot(ctx, cx, cy, t) {
      const bob = Math.sin(t * 2.2) * 3;
      ctx.save();
      ctx.translate(cx, cy + bob);
      // 다리(바퀴)
      ctx.fillStyle = '#334155';
      ctx.beginPath(); ctx.ellipse(0, 52, 30, 12, 0, 0, Math.PI * 2); ctx.fill();
      // 몸통
      const body = ctx.createLinearGradient(-34, -20, 34, 50);
      body.addColorStop(0, '#8b9cb3'); body.addColorStop(1, '#4a5a70');
      ctx.fillStyle = body;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-34, -18, 68, 66, 12) : ctx.rect(-34, -18, 68, 66);
      ctx.fill();
      // 가슴 표시등
      ctx.fillStyle = `rgba(120,220,255,${(0.4 + 0.4 * Math.sin(t * 3)).toFixed(3)})`;
      ctx.fillRect(-14, 4, 28, 8);
      // 팔
      ctx.strokeStyle = '#64748b'; ctx.lineWidth = 9; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-34, -4); ctx.lineTo(-50, 20 + Math.sin(t * 2) * 4);
      ctx.moveTo(34, -4); ctx.lineTo(50, 20 - Math.sin(t * 2) * 4);
      ctx.stroke();
      // 머리
      ctx.fillStyle = '#94a3b8';
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-24, -52, 48, 36, 10) : ctx.rect(-24, -52, 48, 36);
      ctx.fill();
      // 외눈
      ctx.fillStyle = '#7f1d1d';
      ctx.beginPath(); ctx.arc(0, -34, 12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(255,80,80,${(0.55 + 0.45 * Math.sin(t * 4)).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(0, -34, 7, 0, Math.PI * 2); ctx.fill();
      // 경광등
      ctx.fillStyle = `rgba(255,170,60,${(0.35 + 0.5 * Math.abs(Math.sin(t * 3.4))).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(0, -58, 7, Math.PI, Math.PI * 2); ctx.fill();
      ctx.restore();
    },

    /* 사무실 유령 — 반투명한 몸, 흩날리는 서류, 넥타이 */
    officeGhost(ctx, cx, cy, t) {
      const float = Math.sin(t * 1.6) * 7;
      ctx.save();
      ctx.translate(cx, cy + float);
      // 흩날리는 서류
      for (let i = 0; i < 5; i += 1) {
        const a = t * 1.1 + i * 1.26;
        ctx.save();
        ctx.translate(Math.cos(a) * 56, Math.sin(a * 1.3) * 34 - 6);
        ctx.rotate(a);
        ctx.fillStyle = 'rgba(240,246,255,.75)';
        ctx.fillRect(-8, -10, 16, 20);
        ctx.strokeStyle = 'rgba(120,140,170,.6)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(-5, -4); ctx.lineTo(5, -4); ctx.moveTo(-5, 1); ctx.lineTo(5, 1); ctx.stroke();
        ctx.restore();
      }
      // 몸통(아래가 흩어지는 유령 형태)
      const g = ctx.createLinearGradient(0, -46, 0, 54);
      g.addColorStop(0, 'rgba(214,232,255,.95)');
      g.addColorStop(1, 'rgba(150,180,220,.25)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-30, 20);
      ctx.quadraticCurveTo(-34, -46, 0, -46);
      ctx.quadraticCurveTo(34, -46, 30, 20);
      for (let i = 0; i < 4; i += 1) {
        const x0 = 30 - i * 15;
        ctx.quadraticCurveTo(x0 - 7, 44 + Math.sin(t * 3 + i) * 7, x0 - 15, 22);
      }
      ctx.closePath(); ctx.fill();
      // 눈
      ctx.fillStyle = '#1e293b';
      ctx.beginPath(); ctx.ellipse(-10, -24, 4.5, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(10, -24, 4.5, 7, 0, 0, Math.PI * 2); ctx.fill();
      // 넥타이
      ctx.fillStyle = '#b91c1c';
      ctx.beginPath();
      ctx.moveTo(0, -8); ctx.lineTo(-6, 0); ctx.lineTo(0, 26); ctx.lineTo(6, 0);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    },

    /* 정전 그림자 — 검은 덩어리에서 번지는 어둠과 번쩍이는 눈 */
    blackoutShade(ctx, cx, cy, t) {
      ctx.save();
      ctx.translate(cx, cy);
      // 퍼지는 어둠
      const dark = ctx.createRadialGradient(0, 0, 6, 0, 0, 76);
      dark.addColorStop(0, 'rgba(10,12,20,.95)');
      dark.addColorStop(1, 'rgba(10,12,20,0)');
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.arc(0, 0, 76, 0, Math.PI * 2); ctx.fill();
      // 일렁이는 몸
      ctx.fillStyle = '#0b1020';
      ctx.beginPath();
      for (let i = 0; i <= 24; i += 1) {
        const a = (i / 24) * Math.PI * 2;
        const r = 40 + Math.sin(a * 3 + t * 2.6) * 8 + Math.cos(a * 5 - t * 1.7) * 5;
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r * 0.92;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill();
      // 번쩍이는 눈 두 쌍
      const flash = Math.sin(t * 7) > 0.1 ? 1 : 0.25;
      ctx.fillStyle = `rgba(180,230,255,${(0.85 * flash).toFixed(3)})`;
      [[-14, -10], [14, -10], [-8, 8], [8, 8]].forEach(([ex, ey], i) => {
        const s = i < 2 ? 5 : 3;
        ctx.beginPath(); ctx.ellipse(ex, ey, s, s * 0.6, 0, 0, Math.PI * 2); ctx.fill();
      });
      ctx.restore();
    },

    /* 63빌딩 관리자 — 커다란 몸에 왕관, 빌딩 모양 지팡이 */
    towerWarden(ctx, cx, cy, t) {
      const bob = Math.sin(t * 1.4) * 4;
      ctx.save();
      ctx.translate(cx, cy + bob);
      ctx.scale(1.18, 1.18);
      // 망토
      ctx.fillStyle = '#3b1d4d';
      ctx.beginPath();
      ctx.moveTo(-26, -20);
      ctx.quadraticCurveTo(-58, 20, -40, 54);
      ctx.lineTo(40, 54);
      ctx.quadraticCurveTo(58, 20, 26, -20);
      ctx.closePath(); ctx.fill();
      // 몸통
      const body = ctx.createLinearGradient(0, -26, 0, 50);
      body.addColorStop(0, '#6d5b8f'); body.addColorStop(1, '#332748');
      ctx.fillStyle = body;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-26, -22, 52, 72, 14) : ctx.rect(-26, -22, 52, 72);
      ctx.fill();
      // 가슴의 63
      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 17px Jua, Noto Sans KR, system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('63', 0, 14);
      // 얼굴
      ctx.fillStyle = '#1f1730';
      ctx.beginPath(); ctx.arc(0, -40, 19, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(251,191,36,${(0.6 + 0.4 * Math.sin(t * 3.2)).toFixed(3)})`;
      ctx.beginPath(); ctx.ellipse(-7, -42, 4.5, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(7, -42, 4.5, 6, 0, 0, Math.PI * 2); ctx.fill();
      // 왕관
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.moveTo(-18, -56); ctx.lineTo(-12, -70); ctx.lineTo(-6, -58);
      ctx.lineTo(0, -74); ctx.lineTo(6, -58); ctx.lineTo(12, -70); ctx.lineTo(18, -56);
      ctx.closePath(); ctx.fill();
      // 빌딩 모양 지팡이
      ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(38, 50); ctx.lineTo(38, -30); ctx.stroke();
      ctx.fillStyle = '#64748b';
      ctx.fillRect(30, -54, 16, 26);
      ctx.fillStyle = `rgba(255,214,120,${(0.5 + 0.4 * Math.sin(t * 2.5)).toFixed(3)})`;
      for (let r = 0; r < 3; r += 1) {
        for (let c = 0; c < 2; c += 1) ctx.fillRect(33 + c * 6, -50 + r * 8, 4, 5);
      }
      ctx.restore();
    },
  };

  /* ---------- 던전 음악 ---------- */

  /* 던전 안에 있는 동안 전용 음악을 반복 재생한다.
     기존 BGM 선택기(getDesiredAudioFile)를 감싸서, 던전 맵일 때만 우리 파일을 고르게 한다.
     syncAudioFileBgm도 감싸야 나머지 곡이 제대로 멈춘다. */
  function ensureDungeonAudio() {
    const g = G();
    if (!g || !g.audio) return null;
    if (!g.audio.raidDungeonFile) {
      const src = global.getAudioAsset?.('dungeonBgm')?.src || '';
      if (!src || typeof global.Audio !== 'function') return null;
      const file = new global.Audio(src);
      file.loop = true;
      file.preload = 'auto';
      file.volume = g.settings?.bgmEnabled ? Math.min(1, Math.max(0, g.settings.bgmVolume)) : 0;
      g.audio.raidDungeonFile = file;
    }
    return g.audio.raidDungeonFile;
  }

  function installDungeonAudio() {
    if (typeof global.getDesiredAudioFile === 'function' && !global.__RAID_BGM_V1__) {
      global.__RAID_BGM_V1__ = true;
      const previousDesired = global.getDesiredAudioFile;
      global.getDesiredAudioFile = function getDesiredAudioFileWithRaid() {
        const g = G();
        if (g && g.currentMap === MAP_KEY) {
          if (!g.settings?.bgmEnabled) return null;
          const file = ensureDungeonAudio();
          if (file) return file;
        }
        return previousDesired();
      };

      const previousSync = global.syncAudioFileBgm;
      if (typeof previousSync === 'function') {
        global.syncAudioFileBgm = function syncAudioFileBgmWithRaid() {
          previousSync();
          const g = G();
          const file = g?.audio?.raidDungeonFile;
          if (!file) return;
          const desired = global.getDesiredAudioFile();
          file.volume = g.settings?.bgmEnabled ? Math.min(1, Math.max(0, g.settings.bgmVolume)) : 0;
          if (file === desired) file.play?.().catch?.(() => {});
          else file.pause?.();
        };
      }
    }
  }

  /* ---------- 던전에 갇히지 않게 하는 안전장치 ----------

     던전은 한 판 도는 동안만 머무는 곳이다. 그런데 던전 안에서 게임을 끄면
     저장된 맵이 raidTower로 남아, 다시 접속했을 때 아무것도 할 수 없는 곳에
     갇힌다. 아래 세 겹으로 막는다.
       1) 애초에 raidTower를 저장하지 않는다 (근본 차단)
       2) 그래도 던전에서 시작하게 되면 자동으로 마을로 내보낸다 (안전망)
       3) 던전 안에서 언제든 마을로 나갈 수 있는 버튼을 둔다 (사용자 탈출구) */

  function installStuckGuards() {
    if (global.__RAID_STUCK_GUARD_V1__) return;
    global.__RAID_STUCK_GUARD_V1__ = true;

    // 1) 저장에는 던전이 아니라 돌아갈 곳을 남긴다.
    if (typeof global.savePlayer === 'function') {
      const previousSave = global.savePlayer;
      global.savePlayer = function savePlayerWithoutRaidMap() {
        const g = G();
        const player = g?.player;
        if (player && player.map === MAP_KEY) {
          const safe = (returnMap && returnMap !== MAP_KEY) ? returnMap : 'town';
          const spawn = (global.YuksamData?.worldDefs || {})[safe]?.playerSpawn;
          player.map = safe;
          if (returnPos) { player.x = returnPos.x; player.y = returnPos.y; }
          else if (spawn) { player.x = spawn.x; player.y = spawn.y; }
        }
        return previousSave.apply(this, arguments);
      };
    }

    // 2) 그래도 던전에서 시작했다면 조용히 마을로 되돌린다.
    if (typeof global.showScreen === 'function') {
      const previousShowScreen = global.showScreen;
      global.showScreen = function showScreenWithRaidGuard(name) {
        const result = previousShowScreen.apply(this, arguments);
        if (name === 'game') global.setTimeout(rescueIfStranded, 0);
        return result;
      };
    }

    // 3) 마을 귀환 버튼이 눌렸을 때 던전 상태도 함께 정리한다.
    if (typeof global.returnTown === 'function') {
      const previousReturnTown = global.returnTown;
      global.returnTown = function returnTownWithRaidCleanup() {
        abandonRun();
        return previousReturnTown.apply(this, arguments);
      };
    }
  }

  /* 한 판이 돌고 있지 않은데 던전에 서 있으면 갇힌 것이다. */
  function rescueIfStranded() {
    const g = G();
    if (!g || g.currentMap !== MAP_KEY || active) return;
    const worlds = global.YuksamData?.worldDefs || {};
    g.currentMap = 'town';
    if (g.player) {
      g.player.map = 'town';
      const spawn = worlds.town?.playerSpawn || { x:1190, y:1060 };
      g.player.x = spawn.x;
      g.player.y = spawn.y;
    }
    toggleReturnButton(false);
    call('updateHud');
    call('savePlayer');
    call('syncAudioFileBgm');
    call('appendChatMessage', 'system', '63빌딩 던전', '던전 밖으로 나와 마을에서 다시 시작합니다.');
  }

  /* 진행 중이던 판을 버린다(연출 중이어도 안전하게 멈춘다). */
  function abandonRun() {
    active = null;
    question = null;
    currentLine = null;
    busy = false;
    walkProgress = 1;
  }

  function toggleReturnButton(show) {
    const button = global.document.getElementById('returnTownBtn');
    if (button) button.classList.toggle('hidden', !show);
  }

  /* 던전 화면 안에서 쓰는 탈출 버튼. */
  function leaveDungeonNow() {
    abandonRun();
    call('closeModal');
    leaveDungeonMap();
  }

  /* 실수로 눌러 판을 날리지 않도록 한 번 물어본다. */
  function confirmGiveUp() {
    const openModal = global.openModal;
    if (typeof openModal !== 'function') { leaveDungeonNow(); return; }
    const snapshot = active ? active.snapshot() : null;
    openModal(`
      <h2>포기</h2>
      <div class="panel-card">
        <p>정말로 포기하시겠습니까?</p>
        <p class="raid-hint">${esc(snapshot?.title || '이번 층')}의 진행이 사라지고, 보상 없이 마을로 돌아갑니다.</p>
        <div class="action-row">
          <button class="primary" id="raidGiveUpYes">예, 포기합니다</button>
          <button class="ghost" id="raidGiveUpNo">아니오</button>
        </div>
      </div>
    `, { type:'raidGiveUp', pause:true });

    const yes = global.document.getElementById('raidGiveUpYes');
    const no = global.document.getElementById('raidGiveUpNo');
    if (yes) yes.onclick = () => leaveDungeonNow();
    if (no) {
      no.onclick = () => {
        // 전투로 되돌아간다. 행동 메뉴부터 다시 고르게 한다.
        if (!active) { leaveDungeonNow(); return; }
        busy = false;
        panelMode = 'menu';
        panelMessage = '무엇을 할까?';
        renderBattle();
      };
    }
  }

  /* 던전 맵을 화면 전체 렌더러로 등록한다(마을이 아닌 완전히 다른 장소). */
  function installDungeonRenderer() {
    const pipeline = (typeof worldRenderPipeline !== 'undefined') ? worldRenderPipeline : null;
    if (!pipeline || typeof pipeline.registerOwner !== 'function') return;
    ensureDungeonMap();
    pipeline.registerOwner({
      id:'raid-tower-map-v1',
      priority:420,
      owns:({ map }) => map === MAP_KEY,
      render:() => drawDungeon(),
    });
  }

  function startRun(floor = 1) {
    const members = buildParty();
    if (!members) { call('toast', '캐릭터 정보를 불러오지 못했습니다.'); return false; }
    try {
      active = runApi().createRun({ floor, members });
    } catch (error) {
      call('toast', String(error && error.message || error));
      return false;
    }
    question = null;
    busy = false;
    walkProgress = 1;
    // 먼저 던전 안으로 실제로 이동한 뒤, 로비에서 대형을 짠다.
    enterDungeonMap(() => openFormationScreen());
    return true;
  }

  installDungeonRenderer();
  installDungeonAudio();
  installStuckGuards();

  global.YuksamRaidRunUi = Object.freeze({
    startRun,
    isRunning:() => !!active,
    /* 전투 로그를 재생하는 중인지. 재생 중에는 다음 답을 받지 않는다. */
    isBusy:() => busy,
    /* 던전에서 나가기(진행 포기). 갇힘 방지용 탈출구. */
    leaveNow:() => leaveDungeonNow(),
    rescueIfStranded:() => rescueIfStranded(),
    /* 전투 로그 재생 속도(밀리초). 검사에서는 빠르게 돌린다. */
    setLogSpeed:(ms) => { eventDelayMs = Math.max(0, Number(ms) || 0); },
    /* 이동 연출 상태(검사용) — 배경이 얼마나 흘렀는지, 조우 연출이 어디까지 왔는지 */
    travelScrollForTest:() => travelScroll(),
    encounterProgressForTest:() => encounterProgress(),
    /* 이동 연출 길이(밀리초). 검사에서는 짧게 줄여 빠르게 돌린다. */
    /* 준비 카운트다운 길이(검사에서 짧게 줄이려고 연다). */
    setCountdownSpeed:(seconds, stepMs) => {
      READY_COUNTDOWN = Math.max(1, Number(seconds) || 1);
      COUNTDOWN_STEP_MS = Math.max(1, Number(stepMs) || 1);
    },
    setTravelSpeed:(walkMs, encounterMs) => {
      WALK_MS = Math.max(1, Number(walkMs) || 1);
      ENCOUNTER_MS = Math.max(1, Number(encounterMs) || 1);
    },
    /* 검사에서 쓰려고 지금 상태를 들여다볼 수 있게 열어 둔다. */
    peek:() => (active ? active.snapshot() : null),
    currentQuestion:() => question,
    submitAnswerForTest:(value) => submitAnswer(value),
  });
})(typeof window !== 'undefined' ? window : globalThis);
