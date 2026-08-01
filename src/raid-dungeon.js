/* =========================================================
   raid-dungeon.js — 63빌딩 던전 (1단계: 월드 · NPC · 퀘스트 · 입장 조건)

   마을 남쪽 길 끝에 높은 빌딩을 세우고, 그 앞에 퀘스트를 주는
   '명진도사' 할아버지(신선)를 배치한다.

   이 파일이 맡는 것
   - 63빌딩 건물과 명진도사를 마을에 그리기
   - 건물·NPC 충돌(통과 방지)
   - E키 / 마우스 이동 도착 시 상호작용 연결
   - 명진도사의 퀘스트(Lv.5부터 느낌표)
   - 입장 조건 검사: Lv.5 이상 + 전문화 선택 완료

   방 생성·3명 모집·던전 내부 진행과 전투는 뒤에서 로드되는
   raid-entry-ui.js / raid-run-ui.js가 맡는다.

   game.js와의 연결은 전부 호출 시점 참조(늦은 바인딩)로만 한다.
   ========================================================= */
(function initYuksamRaidDungeon(global) {
  'use strict';

  if (global.__YUKSAM_RAID_DUNGEON_V1__) return;
  global.__YUKSAM_RAID_DUNGEON_V1__ = true;

  /* ---------- 기본 값 ---------- */

  const QUEST_ID = 'raid_tower_intro';
  const REQUIRED_LEVEL = 5;

  // 마을 남쪽 길은 x=1200을 따라 y=1720까지 내려간다. 그 길 끝에 빌딩을 세운다.
  const TOWER = {
    x: 1200,      // 건물 중심 x
    y: 1470,      // 건물 중심 y
    w: 240,
    h: 330,
    name: '63빌딩 던전',
    doorX: 1200,
    doorY: 1655,  // 입구(길 끝과 만나는 지점)
    floors: 63,
  };

  const ELDER = {
    x: 1010,
    y: 1636,
    r: 30,
    name: '명진도사',
  };

  /* 가만히 있을 때 띄우는 혼잣말. 신선 컨셉으로 여러 개를 돌려 쓴다. */
  const IDLE_LINES = [
    '허허… 오늘도 바람이 서늘하구나.',
    '저 빌딩은 예순세 층이라 하였지. 끝을 본 자가 없다네.',
    '혼자 가면 죽고, 셋이 가면 산다. 잊지 말거라.',
    '앞에 선 자가 가장 많이 맞는 법이니라.',
    '뒤에 선 자는 동료를 살피거라. 그것이 도리지.',
    '조급함이 화를 부른다. 숨을 고르고 가거라.',
    '문제를 풀어야 힘이 실린다. 머리도 무기니라.',
  ];

  const QUEST_PAGES = [
    '허허… 젊은이, 저 높은 건물이 보이는가? 63층짜리 낡은 빌딩이라네.',
    '언제부턴가 저 안에서 이상한 기척이 흘러나와. 층을 오를수록 더 사나운 것들이 도사리고 있지.',
    '혼자서는 절대 안 된다. 서로 등을 맡길 동료 셋이 모여야 문이 열릴 것이야.',
    '앞에 선 자는 매를 더 맞고, 뒤에 선 자는 덜 맞는 법. 누가 앞에 설지 잘 정하거라.',
  ];

  /* 이야기를 이미 들은 뒤 다시 말을 걸었을 때 (여러 개를 돌려 쓴다) */
  const AFTER_LINES = [
    '준비가 되면 언제든 저 문을 두드리게. 동료 셋과 함께라면 말이야.',
    '조급해 말거라. 대형만 잘 갖추면 1층은 넘을 수 있느니라.',
    '앞에는 튼튼한 자를, 뒤에는 동료를 돌볼 자를 세우거라.',
    '허허, 또 왔는가. 몸은 성한가?',
  ];

  const QUEST_DEF = {
    id: QUEST_ID,
    title: '63빌딩의 기척',
    target: 1,
    desc: '명진도사에게 63빌딩 던전 이야기를 듣기',
    reward: { gold: 60 },
    pages: QUEST_PAGES,
    done: '준비가 되면 언제든 저 문을 두드리게. 동료 셋과 함께라면 말이야.',
  };

  /* ---------- 작은 도우미 (전부 늦은 바인딩) ---------- */

  /* game.js의 game / worldInteractionRegistry / worldNavigationRegistry 는 const 로 선언돼 있어서
     window에 올라가지 않는다. 반드시 이름으로 직접 찾아야 한다(cheat-panel.js와 같은 방식).
     반면 함수 선언들(openModal, savePlayer 등)은 window에 올라가므로 global[name]으로 부를 수 있다. */
  const G = () => (typeof game !== 'undefined' ? game : null);
  const interactionRegistry = () => (typeof worldInteractionRegistry !== 'undefined' ? worldInteractionRegistry : null);
  const navigationRegistry = () => (typeof worldNavigationRegistry !== 'undefined' ? worldNavigationRegistry : null);
  const escape = (value) => (typeof escapeHtml === 'function' ? escapeHtml(value) : String(value == null ? '' : value));

  const player = () => G()?.player || null;
  const worlds = () => (global.YuksamData && global.YuksamData.worldDefs) || null;
  const call = (name, ...args) => (typeof global[name] === 'function' ? global[name](...args) : undefined);

  function dist(a, b) {
    if (!a || !b) return Infinity;
    const dx = (a.x || 0) - (b.x || 0);
    const dy = (a.y || 0) - (b.y || 0);
    return Math.sqrt(dx * dx + dy * dy);
  }

  function questState() {
    const p = player();
    return p?.quests?.[QUEST_ID] || null;
  }

  function heardTheStory() {
    const state = questState();
    return state?.status === 'completed' || state?.status === 'done';
  }

  /* 명진도사의 이야기는 Lv.5부터 열린다. 그 전에는 느낌표도 뜨지 않는다. */
  function questAvailable() {
    const p = player();
    return !!p && (p.level || 1) >= REQUIRED_LEVEL && !heardTheStory();
  }

  /* ---------- 입장 조건 ---------- */

  /* 통과하면 null, 막히면 사람이 읽을 이유를 돌려준다. */
  function entryBlockReason() {
    const p = player();
    if (!p) return '먼저 캐릭터를 만들어 주세요.';
    if ((p.level || 1) < REQUIRED_LEVEL) return `63빌딩 던전은 Lv.${REQUIRED_LEVEL}부터 들어갈 수 있어요.`;
    if (!p.spec) return '전문화를 먼저 선택해야 63빌딩 던전에 들어갈 수 있어요.';
    if (!heardTheStory()) return '명진도사에게 먼저 이야기를 들어야 해요.';
    return null;
  }

  function canEnter() {
    return entryBlockReason() === null;
  }

  /* ---------- 그리기 ---------- */

  function drawTowerWorld(ctx) {
    const toScreen = global.worldToScreen;
    if (typeof toScreen !== 'function') return;

    const half = TOWER.w / 2;
    const top = toScreen(TOWER.x - half, TOWER.y - TOWER.h / 2);
    const bottom = toScreen(TOWER.x + half, TOWER.y + TOWER.h / 2);
    const w = bottom.x - top.x;
    const h = bottom.y - top.y;
    if (w <= 0 || h <= 0) return;

    ctx.save();

    // 바닥 그림자
    ctx.fillStyle = 'rgba(6,12,22,.30)';
    ctx.beginPath();
    ctx.ellipse(top.x + w / 2, top.y + h + 8, w * .58, 18, 0, 0, Math.PI * 2);
    ctx.fill();

    // 몸체
    const body = ctx.createLinearGradient(top.x, top.y, top.x + w, top.y + h);
    body.addColorStop(0, '#4a5b78');
    body.addColorStop(.5, '#38465f');
    body.addColorStop(1, '#26313f');
    ctx.fillStyle = body;
    ctx.fillRect(top.x, top.y, w, h);

    // 옆면(입체감)
    ctx.fillStyle = 'rgba(0,0,0,.20)';
    ctx.fillRect(top.x + w * .74, top.y, w * .26, h);

    // 층 창문 — 63층 느낌을 주되 실제로는 촘촘한 줄로만 표현한다.
    const rows = 14;
    const cols = 4;
    const padX = w * .12;
    const padTop = h * .07;
    const cellW = (w - padX * 2) / cols;
    const cellH = (h - padTop - h * .16) / rows;
    const t = (global.performance ? performance.now() : Date.now()) / 1000;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        // 몇몇 창에만 불이 들어와 있고 천천히 깜빡인다.
        const seed = (r * 7 + c * 13) % 11;
        const lit = seed < 4;
        const flicker = lit ? .55 + .35 * Math.sin(t * 1.2 + seed * 2.1) : .12;
        ctx.fillStyle = lit ? `rgba(255,214,120,${flicker.toFixed(3)})` : 'rgba(150,175,205,.16)';
        ctx.fillRect(
          top.x + padX + c * cellW + cellW * .16,
          top.y + padTop + r * cellH + cellH * .18,
          cellW * .68,
          cellH * .58,
        );
      }
    }

    // 옥상 안테나
    ctx.strokeStyle = '#93a4bd';
    ctx.lineWidth = Math.max(2, w * .022);
    ctx.beginPath();
    ctx.moveTo(top.x + w / 2, top.y);
    ctx.lineTo(top.x + w / 2, top.y - h * .12);
    ctx.stroke();
    const blink = .45 + .45 * Math.sin(t * 3.1);
    ctx.fillStyle = `rgba(255,90,90,${blink.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(top.x + w / 2, top.y - h * .12, Math.max(3, w * .034), 0, Math.PI * 2);
    ctx.fill();

    // 입구
    const door = toScreen(TOWER.doorX, TOWER.doorY);
    const doorW = w * .30;
    const doorH = h * .16;
    const near = isPlayerNearDoor();
    ctx.fillStyle = near ? 'rgba(120,220,255,.92)' : 'rgba(18,26,38,.92)';
    ctx.fillRect(door.x - doorW / 2, door.y - doorH, doorW, doorH);
    if (near) {
      ctx.strokeStyle = 'rgba(190,240,255,.95)';
      ctx.lineWidth = 3;
      ctx.strokeRect(door.x - doorW / 2, door.y - doorH, doorW, doorH);
    }

    // 간판
    ctx.textAlign = 'center';
    ctx.font = `${Math.max(13, Math.round(w * .14))}px Jua, Noto Sans KR, system-ui`;
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(6,12,22,.85)';
    ctx.strokeText(TOWER.name, door.x, door.y + 26);
    ctx.fillStyle = '#ffe6a3';
    ctx.fillText(TOWER.name, door.x, door.y + 26);

    ctx.restore();
  }

  /* 명진도사는 기본 NPC 그림 대신 직접 그린다.
     흰 도포, 긴 수염, 지팡이 — 신선 느낌을 내기 위해서다. */
  function drawElderWorld() {
    const toScreen = global.worldToScreen;
    const ctx = G()?.ctx;
    if (typeof toScreen !== 'function' || !ctx) return;
    const p = toScreen(ELDER.x, ELDER.y);
    const scale = (global.YuksamData && global.YuksamData.NPC_WORLD_SCALE) || 1.26;
    drawElderSprite(ctx, p.x, p.y, scale, isPlayerNearElder(), questAvailable());
    drawElderBubble(ctx, p.x, p.y, scale);
  }

  function drawElderSprite(ctx, x, y, scale, highlighted, hasQuest) {
    const t = (global.performance ? performance.now() : Date.now()) / 1000;
    const bob = Math.sin(t * 1.1) * 2 * scale;   // 천천히 숨쉬듯 위아래
    const s = (value) => value * scale;

    ctx.save();
    ctx.translate(x, y + bob);

    // 가까이 가면 발밑이 은은하게 빛난다
    if (highlighted) {
      const glow = ctx.createRadialGradient(0, s(34), 0, 0, s(34), s(56));
      glow.addColorStop(0, 'rgba(190,240,255,.45)');
      glow.addColorStop(1, 'rgba(190,240,255,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.ellipse(0, s(34), s(56), s(20), 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 그림자
    ctx.fillStyle = 'rgba(6,12,22,.28)';
    ctx.beginPath();
    ctx.ellipse(0, s(36), s(26), s(8), 0, 0, Math.PI * 2);
    ctx.fill();

    // 지팡이 — 옹이진 나무 막대에 구슬이 달려 있다
    ctx.strokeStyle = '#8b5e34';
    ctx.lineWidth = s(4);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s(26), s(34));
    ctx.quadraticCurveTo(s(31), s(2), s(27), s(-40));
    ctx.stroke();
    const orb = 0.5 + 0.5 * Math.sin(t * 2.2);
    ctx.fillStyle = `rgba(150,235,255,${(0.55 + orb * 0.4).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(s(27), s(-44), s(6), 0, Math.PI * 2);
    ctx.fill();

    // 흰 도포 — 아래로 갈수록 넓어진다
    const robe = ctx.createLinearGradient(0, s(-16), 0, s(36));
    robe.addColorStop(0, '#ffffff');
    robe.addColorStop(1, '#d8e4f0');
    ctx.fillStyle = robe;
    ctx.beginPath();
    ctx.moveTo(s(-12), s(-14));
    ctx.lineTo(s(12), s(-14));
    ctx.quadraticCurveTo(s(24), s(14), s(22), s(34));
    ctx.lineTo(s(-22), s(34));
    ctx.quadraticCurveTo(s(-24), s(14), s(-12), s(-14));
    ctx.closePath();
    ctx.fill();

    // 옷깃과 허리끈
    ctx.strokeStyle = '#9db4cc';
    ctx.lineWidth = s(1.6);
    ctx.beginPath();
    ctx.moveTo(0, s(-14));
    ctx.lineTo(0, s(8));
    ctx.stroke();
    ctx.fillStyle = '#7f9bb8';
    ctx.fillRect(s(-16), s(4), s(32), s(4));

    // 소매
    ctx.fillStyle = '#eef4fb';
    ctx.beginPath();
    ctx.ellipse(s(-18), s(2), s(7), s(12), -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(s(18), s(2), s(7), s(12), 0.2, 0, Math.PI * 2);
    ctx.fill();

    // 얼굴
    ctx.fillStyle = '#ffe8d2';
    ctx.beginPath();
    ctx.arc(0, s(-26), s(11), 0, Math.PI * 2);
    ctx.fill();

    // 눈 (지그시 감은 눈)
    ctx.strokeStyle = '#4a3b2f';
    ctx.lineWidth = s(1.4);
    ctx.beginPath();
    ctx.moveTo(s(-6), s(-28)); ctx.quadraticCurveTo(s(-4), s(-26), s(-2), s(-28));
    ctx.moveTo(s(2), s(-28)); ctx.quadraticCurveTo(s(4), s(-26), s(6), s(-28));
    ctx.stroke();

    // 흰 눈썹
    ctx.strokeStyle = '#f4f7fb';
    ctx.lineWidth = s(2.2);
    ctx.beginPath();
    ctx.moveTo(s(-8), s(-33)); ctx.lineTo(s(-2), s(-32));
    ctx.moveTo(s(2), s(-32)); ctx.lineTo(s(8), s(-33));
    ctx.stroke();

    // 긴 흰 수염 — 가슴까지 내려온다
    const beard = ctx.createLinearGradient(0, s(-20), 0, s(8));
    beard.addColorStop(0, '#ffffff');
    beard.addColorStop(1, '#e6eef7');
    ctx.fillStyle = beard;
    ctx.beginPath();
    ctx.moveTo(s(-8), s(-20));
    ctx.quadraticCurveTo(s(-10), s(-4), s(-3), s(8));
    ctx.quadraticCurveTo(0, s(12), s(3), s(8));
    ctx.quadraticCurveTo(s(10), s(-4), s(8), s(-20));
    ctx.quadraticCurveTo(0, s(-14), s(-8), s(-20));
    ctx.closePath();
    ctx.fill();

    // 상투와 머리띠
    ctx.fillStyle = '#f2f6fb';
    ctx.beginPath();
    ctx.arc(0, s(-36), s(9), Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, s(-42), s(4), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6f8bab';
    ctx.fillRect(s(-9), s(-38), s(18), s(3));

    ctx.restore();

    // 느낌표 (Lv.5부터)
    ctx.save();
    ctx.textAlign = 'center';
    if (hasQuest) {
      const mark = Math.sin(t * 4.4) * 3 * scale;
      ctx.font = `${Math.round(32 * scale)}px Jua, Noto Sans KR, system-ui`;
      ctx.lineWidth = 5 * scale;
      ctx.strokeStyle = 'rgba(20,20,20,.85)';
      ctx.strokeText('!', x, y - 62 * scale + mark);
      ctx.fillStyle = '#ffd84d';
      ctx.fillText('!', x, y - 62 * scale + mark);
    }
    // 이름표
    ctx.font = `${Math.round(14 * scale)}px Noto Sans KR, Jua, system-ui`;
    const nameW = ctx.measureText(ELDER.name).width + 22 * scale;
    ctx.fillStyle = 'rgba(7,16,27,.74)';
    ctx.beginPath();
    const bx = x - nameW / 2;
    const by = y + 45 * scale;
    const rr = 13 * scale;
    ctx.moveTo(bx + rr, by);
    ctx.arcTo(bx + nameW, by, bx + nameW, by + 26 * scale, rr);
    ctx.arcTo(bx + nameW, by + 26 * scale, bx, by + 26 * scale, rr);
    ctx.arcTo(bx, by + 26 * scale, bx, by, rr);
    ctx.arcTo(bx, by, bx + nameW, by, rr);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#edf5ff';
    ctx.fillText(ELDER.name, x, y + 63 * scale);
    ctx.restore();
  }

  /* 가만히 있을 때 여러 대사를 번갈아 띄운다. */
  const bubbleState = { idx: Math.floor(Math.random() * IDLE_LINES.length), nextAt: 0, visibleUntil: 0 };

  function drawElderBubble(ctx, x, y, scale) {
    const now = Date.now();
    if (!bubbleState.nextAt) bubbleState.nextAt = now + 1200;
    if (now >= bubbleState.nextAt && now >= bubbleState.visibleUntil) {
      // 같은 대사가 연달아 나오지 않도록 한 칸 이상 건너뛴다.
      bubbleState.idx = (bubbleState.idx + 1 + Math.floor(Math.random() * (IDLE_LINES.length - 1))) % IDLE_LINES.length;
      bubbleState.visibleUntil = now + 5200;
      bubbleState.nextAt = bubbleState.visibleUntil + 2600 + Math.random() * 2200;
    }
    if (now > bubbleState.visibleUntil) return;

    const text = IDLE_LINES[bubbleState.idx % IDLE_LINES.length];
    const phase = now - (bubbleState.visibleUntil - 5200);
    const alpha = Math.min(1, phase / 450) * Math.min(1, (bubbleState.visibleUntil - now) / 450);

    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `${Math.round(13 * scale)}px Jua, Noto Sans KR, system-ui`;
    const w = Math.min(260 * scale, ctx.measureText(text).width + 30 * scale);
    const bx = x - w / 2;
    const by = y - 110 * scale;
    const h = 30 * scale;
    const rr = 12 * scale;
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.fillStyle = 'rgba(255,255,255,.95)';
    ctx.beginPath();
    ctx.moveTo(bx + rr, by);
    ctx.arcTo(bx + w, by, bx + w, by + h, rr);
    ctx.arcTo(bx + w, by + h, bx, by + h, rr);
    ctx.arcTo(bx, by + h, bx, by, rr);
    ctx.arcTo(bx, by, bx + w, by, rr);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - 7 * scale, by + 27 * scale);
    ctx.lineTo(x, by + 38 * scale);
    ctx.lineTo(x + 7 * scale, by + 27 * scale);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#102033';
    ctx.fillText(text, x, by + 20 * scale);
    ctx.restore();
  }

  function isPlayerNearDoor() {
    return dist(player(), { x: TOWER.doorX, y: TOWER.doorY }) < 104;
  }

  function isPlayerNearElder() {
    return dist(player(), ELDER) < 104;
  }

  /* ---------- 대화 · 안내 ---------- */

  function openElderDialogue() {
    const p = player();
    if (!p) return;

    /* 안내는 화면 가운데 뜨는 알림(레벨업 같은 연출)이 아니라
       전부 대화창으로 보여 준다. NPC와 이야기하는 느낌을 유지하기 위해서다. */
    if (!questAvailable() && !heardTheStory()) {
      showElderSay(`허허, 아직은 이르구나. Lv.${REQUIRED_LEVEL}이 되거든 다시 오게.`);
      return;
    }

    // 명진쌤과 같은 흐름: 기본 대화 → 이야기 듣기 → 수락
    openBaseDialogue();
  }

  /* 대화 진행 상태(명진쌤의 game.dialogue와 같은 역할). */
  const dialogueState = { page: 0, selected: 0, mode: 'base' };

  /* 명진도사가 한 마디 하는 대화창(조건 미달 안내 등 짧은 말). */
  function showElderSay(text, options = {}) {
    const openModal = global.openModal;
    if (typeof openModal !== 'function') return;
    openModal(`
      <h2>${escape(ELDER.name)}</h2>
      <div class="panel-card">
        ${options.lead ? `<p><strong>${escape(options.lead)}</strong></p>` : ''}
        <p>${escape(text)}</p>
        ${options.note ? `<p class="muted">${escape(options.note)}</p>` : ''}
        <div class="answer-row">
          <button class="primary" id="raidSayCloseBtn">${escape(options.button || '알겠습니다')}</button>
        </div>
      </div>
    `, { type: 'raidElderSay', pause: true });
    const btn = global.document.getElementById('raidSayCloseBtn');
    if (btn) {
      btn.onclick = () => call('closeModal');
      btn.focus();
    }
  }

  /* 명진쌤 대화창과 똑같은 형식으로 그린다.
     같은 dialogue-box 뼈대, 같은 말머리·E키 배지, 같은 선택지 버튼을 쓴다.
     학생이 두 NPC를 오갈 때 이질감이 없어야 하기 때문이다. */
  function renderElderDialogue({ text, options, marker = '' }) {
    const openModal = global.openModal;
    if (typeof openModal !== 'function') return;
    const emphasize = global.YuksamQuestText?.emphasize
      ? (value) => global.YuksamQuestText.emphasize(value)
      : (value) => escape(value);
    const theme = global.YuksamQuestDialogueTheme?.classSuffix?.({
      mode: dialogueState.mode,
      questStatus: questState()?.status,
      hasQuest: true,
    }) || '';

    dialogueState.selected = Math.min(
      Math.max(0, dialogueState.selected || 0),
      Math.max(0, options.length - 1),
    );

    openModal(
      `<div class="dialogue-box${theme}">`
      + `<div class="dialogue-speaker"><h2>${escape(ELDER.name)} `
      + `${marker ? `<span class="badge quest-marker-badge">${escape(marker)}</span>` : ''}</h2>`
      + '<div class="badge">E키로 진행</div></div>'
      + `<div class="dialogue-text">${emphasize(text)}</div>`
      + `<div class="dialogue-options">${options.map((opt, i) => (
        `<button class="${i === dialogueState.selected ? 'selected' : ''}" data-raid-opt="${i}">`
        + `${emphasize(opt.label)}</button>`
      )).join('')}</div></div>`,
      { type: 'dialogue', pause: true },
    );

    global.document.querySelectorAll('[data-raid-opt]').forEach((button) => {
      button.onclick = () => {
        dialogueState.selected = Number(button.dataset.raidOpt) || 0;
        options[dialogueState.selected]?.run?.();
      };
    });
  }

  function showStoryPage(index) {
    dialogueState.mode = 'quest';
    dialogueState.page = index;
    dialogueState.selected = 0;
    const last = index >= QUEST_PAGES.length - 1;
    renderElderDialogue({
      marker: '!',
      text: QUEST_PAGES[index],
      options: last
        ? [
          { label: '퀘스트 수락', run: () => finishStory() },
          { label: '기본 대화로 돌아가기', run: () => openBaseDialogue() },
        ]
        : [
          { label: '다음 이야기', run: () => showStoryPage(index + 1) },
          { label: '기본 대화로 돌아가기', run: () => openBaseDialogue() },
        ],
    });
  }

  /* 명진쌤의 기본 대화와 같은 구성(이야기 듣기 / 대화 종료). */
  function openBaseDialogue() {
    dialogueState.mode = 'base';
    dialogueState.page = 0;
    dialogueState.selected = 0;

    if (heardTheStory()) {
      /* 이미 들은 이야기는 다시 볼 수 없다.
         다시 보기를 열어 두면 마지막에 보상을 또 받을 수 있었다. */
      renderElderDialogue({
        text: AFTER_LINES[Math.floor(Math.random() * AFTER_LINES.length)],
        options: [
          { label: '대화 종료', run: () => call('closeModal') },
        ],
      });
      return;
    }

    renderElderDialogue({
      marker: '!',
      text: '허허, 젊은이. 저 빌딩 이야기를 들어 보겠는가?',
      options: [
        { label: `! ${QUEST_DEF.title} 이야기 듣기`, run: () => showStoryPage(0) },
        { label: '대화 종료', run: () => call('closeModal') },
      ],
    });
  }

  function finishStory() {
    const p = player();
    if (!p) return;
    /* 보상은 딱 한 번만. 어떤 경로로 다시 들어와도 두 번 주지 않는다. */
    if (heardTheStory()) { call('closeModal'); return; }
    p.quests = p.quests || {};
    p.quests[QUEST_ID] = {
      id: QUEST_ID,
      status: 'completed',
      progress: QUEST_DEF.target,
      target: QUEST_DEF.target,
      acceptedAt: Date.now(),
      completedAt: Date.now(),
    };

    const reward = QUEST_DEF.reward;
    call('addGold', reward.gold);

    call('savePlayer');
    call('updateHud');
    call('playSfx', 'quest');
    // 완료도 명진쌤과 같은 대화창 형식으로 이어서 보여 준다.
    dialogueState.mode = 'base';
    dialogueState.selected = 0;
    renderElderDialogue({
      text: `이제 저 문은 자네에게 열려 있네. 동료 셋을 모아 오르거라.\n`
        + `Gold +${reward.gold}`,
      options: [{ label: '고맙습니다!', run: () => call('closeModal') }],
    });
    call('appendChatMessage', 'system', '퀘스트', `${QUEST_DEF.title} 완료! 63빌딩 던전 입구가 열렸습니다.`);
  }

  function openTowerEntrance() {
    const reason = entryBlockReason();
    if (reason) {
      call('toast', reason, 2200);
      call('appendChatMessage', 'system', '63빌딩 던전', reason);
      return;
    }
    // 방 생성·초대 코드 입력은 별도 화면 모듈이 맡는다. 실제 던전 진행은
    // 그 화면이 세 명을 모은 뒤 YuksamRaidRunUi에 넘긴다.
    const entryUi = global.YuksamRaidEntryUi;
    if (!entryUi || typeof entryUi.open !== 'function') {
      call('toast', '던전 입장 화면을 불러오지 못했습니다.');
      return;
    }
    entryUi.open();
  }

  /* ---------- game.js에 붙이기 ---------- */

  function install() {
    const registry = interactionRegistry();
    const navigation = navigationRegistry();

    // 1) 마을 그리기에 빌딩과 할아버지를 얹는다.
    if (typeof global.drawTown === 'function') {
      const previousDrawTown = global.drawTown;
      global.drawTown = function drawTownWithRaidTower() {
        previousDrawTown();
        const ctx = G()?.ctx;
        if (ctx) drawTowerWorld(ctx);
        drawElderWorld();
      };
    }

    // 2) 건물과 할아버지를 통과하지 못하게 막는다.
    if (navigation && typeof navigation.registerCollider === 'function') {
      navigation.registerCollider({
        id: 'raid-tower-colliders-v1',
        priority: 400,
        resolve: () => {
          if (G()?.currentMap !== 'town') return null;
          const base = typeof global.getBaseMapColliders === 'function' ? global.getBaseMapColliders() : [];
          const t = worlds()?.town;
          const extra = [];
          // 기존 상점 충돌(대장간·펫 상점)은 우선순위가 낮은 등록기에 있으므로 여기서 함께 돌려준다.
          if (t?.petShop) extra.push({ type:'rect', x:t.petShop.x, y:t.petShop.y + 18, w:t.petShop.w * .9, h:t.petShop.h * .82 });
          if (t?.upgradeShop) extra.push({ type:'rect', x:t.upgradeShop.x, y:t.upgradeShop.y + 18, w:t.upgradeShop.w * .9, h:t.upgradeShop.h * .82 });
          return [
            ...base,
            ...extra,
            // 입구 쪽은 열어 두려고 건물 아랫부분을 조금 남긴다.
            { type:'rect', x:TOWER.x, y:TOWER.y - 16, w:TOWER.w * .92, h:TOWER.h * .80 },
            { type:'circle', x:ELDER.x, y:ELDER.y, r:32 },
          ];
        },
      });
    }

    // 3) E키 / 마우스 도착 시 무엇과 상호작용할지 알려 준다.
    if (registry && typeof registry.registerCandidate === 'function') {
      registry.registerCandidate({
        id: 'raid-tower-candidates-v1',
        priority: 400,
        find: () => {
          if (!player() || G()?.currentMap !== 'town') return null;
          if (isPlayerNearElder()) {
            return { type:'raidElderNpc', label:`E: ${ELDER.name}과 대화` };
          }
          if (isPlayerNearDoor()) {
            return { type:'raidTowerDoor', label:`E: ${TOWER.name} - 들어가기` };
          }
          return null;
        },
      });
      registry.registerAction({
        id: 'raid-tower-actions-v1',
        priority: 400,
        types: ['raidElderNpc', 'raidTowerDoor'],
        handle: (nearest) => {
          if (nearest.type === 'raidElderNpc') openElderDialogue();
          else if (nearest.type === 'raidTowerDoor') openTowerEntrance();
          return true;
        },
      });
    }
  }

  /* 검사와 다음 단계에서 쓰려고 바깥에 열어 둔다. */
  global.YuksamRaidDungeon = Object.freeze({
    QUEST_ID,
    QUEST_DEF,
    REQUIRED_LEVEL,
    TOWER,
    ELDER,
    questAvailable,
    heardTheStory,
    entryBlockReason,
    canEnter,
    openElderDialogue,
    openTowerEntrance,
    install,
  });

  install();
})(window);
