/* =========================================================
   raid-dungeon.js — 63빌딩 던전 (1단계: 월드 · NPC · 퀘스트 · 입장 조건)

   마을 남쪽 길 끝에 높은 빌딩을 세우고, 그 앞에 퀘스트를 주는
   '원로 명진' 할아버지를 배치한다.

   이 파일이 맡는 것
   - 63빌딩 건물과 원로 명진을 마을에 그리기
   - 건물·NPC 충돌(통과 방지)
   - E키 / 마우스 이동 도착 시 상호작용 연결
   - 원로 명진의 퀘스트(Lv.5부터 느낌표)
   - 입장 조건 검사: Lv.5 이상 + 전문화 선택 완료

   아직 없는 것(다음 단계)
   - 파티 방 만들기 / 3명 모집 / 준비 완료 / 출발
   - 던전 내부 진행, 전투, 대형(앞줄·뒷줄) 피해 배율, 레이드 보스

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
    name: '원로 명진',
  };

  const QUEST_PAGES = [
    '허허… 젊은이, 저 높은 건물이 보이는가? 63층짜리 낡은 빌딩이라네.',
    '언제부턴가 저 안에서 이상한 기척이 흘러나와. 층을 오를수록 더 사나운 것들이 도사리고 있지.',
    '혼자서는 절대 안 된다. 서로 등을 맡길 동료 셋이 모여야 문이 열릴 것이야.',
    '앞에 선 자는 매를 더 맞고, 뒤에 선 자는 덜 맞는 법. 누가 앞에 설지 잘 정하거라.',
  ];

  const QUEST_DEF = {
    id: QUEST_ID,
    title: '63빌딩의 기척',
    target: 1,
    desc: '원로 명진에게 63빌딩 던전 이야기를 듣기',
    reward: { exp: 10, gold: 60, building: 5 },
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

  /* 원로 명진의 이야기는 Lv.5부터 열린다. 그 전에는 느낌표도 뜨지 않는다. */
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
    if (!heardTheStory()) return '원로 명진에게 먼저 이야기를 들어야 해요.';
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

  function drawElderWorld() {
    // 할아버지는 기존 NPC 그리기를 그대로 쓰고, 느낌표만 조건부로 붙인다.
    call('drawNpcWorld', ELDER.x, ELDER.y, ELDER.name, questAvailable(), isPlayerNearElder(), 'priest');
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

    if (!questAvailable() && !heardTheStory()) {
      call('showCinematicMessage', '원로 명진',
        `허허, 아직은 이르구나. Lv.${REQUIRED_LEVEL}이 되거든 다시 오게.`, 1800);
      return;
    }

    if (heardTheStory()) {
      call('showCinematicMessage', '원로 명진', QUEST_DEF.done, 2000);
      return;
    }

    // 처음 듣는 이야기: 여러 장을 순서대로 보여 주고 마지막에 완료 처리한다.
    showStoryPage(0);
  }

  function showStoryPage(index) {
    const openModal = global.openModal;
    if (typeof openModal !== 'function') return;
    const page = QUEST_PAGES[index];
    const last = index >= QUEST_PAGES.length - 1;
    openModal(`
      <h2>${escape(ELDER.name)}</h2>
      <div class="panel-card">
        <p>${escape(page)}</p>
        <p class="muted">${index + 1} / ${QUEST_PAGES.length}</p>
        <div class="answer-row">
          <button class="primary" id="raidStoryNextBtn">${last ? '알겠습니다' : '다음'}</button>
        </div>
      </div>
    `, { type: 'raidElderStory', pause: true });

    const btn = global.document.getElementById('raidStoryNextBtn');
    if (btn) {
      btn.onclick = () => (last ? finishStory() : showStoryPage(index + 1));
      btn.focus();
    }
  }

  function finishStory() {
    const p = player();
    if (!p) return;
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
    call('addExp', reward.exp);
    call('addGold', reward.gold);
    if (reward.building) p.building = (p.building || 0) + reward.building;

    call('savePlayer');
    call('updateHud');
    call('closeModal');
    call('playSfx', 'quest');
    call('showCinematicMessage', '63빌딩 던전 개방',
      '원로 명진의 이야기를 들었습니다. 동료 셋을 모아 문을 두드려 보세요.', 2200);
    call('appendChatMessage', 'system', '퀘스트', `${QUEST_DEF.title} 완료! 63빌딩 던전 입구가 열렸습니다.`);
  }

  function openTowerEntrance() {
    const reason = entryBlockReason();
    if (reason) {
      call('toast', reason, 2200);
      call('appendChatMessage', 'system', '63빌딩 던전', reason);
      return;
    }
    const openModal = global.openModal;
    if (typeof openModal !== 'function') return;
    openModal(`
      <h2>63빌딩 던전</h2>
      <div class="panel-card">
        <p>총 ${TOWER.floors}층. 지금은 <strong>1층</strong>까지 준비되어 있습니다.</p>
        <p class="muted">셋이 함께 오르는 곳입니다. 지금은 동료 둘이 함께 가 줍니다.</p>
        <div class="answer-row">
          <button class="primary" id="raidEnterFloor1Btn">1층 도전</button>
          <button class="ghost" onclick="closeModal()">닫기</button>
        </div>
      </div>
    `, { type: 'raidTowerEntrance', pause: true });

    const enterBtn = global.document.getElementById('raidEnterFloor1Btn');
    if (enterBtn) {
      // 화면 모듈은 뒤에 로드되므로 누르는 시점에 찾는다(늦은 바인딩).
      enterBtn.onclick = () => {
        const ui = global.YuksamRaidRunUi;
        if (!ui || typeof ui.startRun !== 'function') {
          call('toast', '던전 화면을 불러오지 못했습니다.');
          return;
        }
        ui.startRun(1);
      };
    }
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
