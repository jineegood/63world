/* =========================================================
   raid-entry-ui.js — 63빌딩 던전 방 생성·참가 화면

   이 파일은 입장 방법과 층 구간만 고른다. 실제 실시간 대기실과 던전
   진행은 YuksamRaidRunUi.openNetworkLobby(...)가 담당한다.
   ========================================================= */
(function installYuksamRaidEntryUi(global) {
  'use strict';

  if (global.__YUKSAM_RAID_ENTRY_UI_V1__) return;
  global.__YUKSAM_RAID_ENTRY_UI_V1__ = true;

  const doc = () => global.document;
  const call = (name, ...args) => (typeof global[name] === 'function' ? global[name](...args) : undefined);
  const progress = () => global.YuksamRaidProgress;
  const player = () => (typeof game !== 'undefined' ? game?.player : null) || null;

  /* 구간 목록은 진행도 모듈이 갖고 있다.
     앞 구간을 깨면 다음 구간이 열리므로 열림 여부는 그때그때 계산한다. */
  function floorGroups() {
    const P = progress();
    if (!P) return [{ id:1, label:'1–10층', recommended:'추천 레벨 Lv.5', unlocked:true, cleared:false, needs:0 }];
    const highest = P.highestUnlockedGroup(player());
    const cleared = P.clearedGroup(player());
    return P.GROUPS.map((group) => ({
      id:group.id,
      label:group.label,
      /* 마지막 61–63층은 얼마나 어려운지 아직 밝히지 않는다. */
      recommended:group.id === P.LAST_GROUP ? '추천 레벨 ???' : `추천 레벨 Lv.${group.recommendedLevel}`,
      unlocked:group.id <= highest,
      cleared:group.id <= cleared,
      needs:group.id - 1,
      reward:global.YuksamRaidNameplatesV1?.rewardForGroup?.(group.id) || null,
    }));
  }

  function ensureStyles() {
    const document = doc();
    if (!document || document.getElementById('raidEntryStylesV1')) return;
    const style = document.createElement('style');
    style.id = 'raidEntryStylesV1';
    style.textContent = `
      .raid-entry-intro{text-align:center;margin:2px 0 16px;color:#cbd5e1;line-height:1.65}
      .raid-entry-actions{display:grid;grid-template-columns:1fr 1fr;gap:14px}
      .raid-entry-card{min-height:188px;border:1px solid rgba(125,211,252,.38);border-radius:16px;
        padding:18px;background:linear-gradient(180deg,rgba(14,46,70,.92),rgba(8,23,39,.94));
        display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;gap:10px}
      .raid-entry-card h3{margin:0;color:#e0f2fe;font-size:24px}
      .raid-entry-card p{margin:0;color:#aebed2;font-size:13px;line-height:1.55}
      .raid-code-row{display:flex;gap:8px;justify-content:center;width:100%;margin-top:4px}
      .raid-code-input{width:132px!important;max-width:132px;text-align:center;font-size:26px!important;
        font-weight:900;letter-spacing:8px;padding:9px 6px!important;font-variant-numeric:tabular-nums}
      .raid-code-input::placeholder{letter-spacing:4px;color:#64748b}
      .raid-entry-error{min-height:20px;margin:5px 0 0;color:#fca5a5;font-size:13px;font-weight:800;text-align:center}
      /* 층 선택 — 빌딩을 올려다보는 모양.
         아래가 1–10층이고 위로 갈수록 높은 층이다(그래서 column-reverse).
         한 칸이 건물 한 층처럼 보이도록 가로로 길게 눕히고 위아래로 쌓는다. */
      .raid-floor-grid{display:flex;flex-direction:column-reverse;gap:5px;margin:14px 0}
      .raid-floor-card{min-height:56px;border-radius:7px;border:1px solid rgba(255,255,255,.16);
        color:#f8fafc;display:grid;grid-template-columns:auto 1fr auto;align-items:center;
        gap:12px;padding:9px 16px;text-align:left;cursor:pointer;position:relative;
        box-shadow:0 2px 0 rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.12)}
      /* 위층일수록 폭이 살짝 좁아 탑처럼 보인다. */
      .raid-floor-card[data-raid-floor-group="2"]{width:98%;margin:0 auto}
      .raid-floor-card[data-raid-floor-group="3"]{width:96%;margin:0 auto}
      .raid-floor-card[data-raid-floor-group="4"]{width:94%;margin:0 auto}
      .raid-floor-card[data-raid-floor-group="5"]{width:92%;margin:0 auto}
      .raid-floor-card[data-raid-floor-group="6"]{width:90%;margin:0 auto}
      .raid-floor-card[data-raid-floor-group="7"]{width:87%;margin:0 auto;border-radius:7px 7px 12px 12px}
      /* 난이도 색 — 아래는 시원한 파랑, 올라갈수록 보라·주황·붉은색으로 달아오른다. */
      .raid-floor-card.tier1{background:linear-gradient(180deg,#1d6ea8,#144b73)}
      .raid-floor-card.tier2{background:linear-gradient(180deg,#1a7f97,#125767)}
      .raid-floor-card.tier3{background:linear-gradient(180deg,#4a5aa8,#2f3a70)}
      .raid-floor-card.tier4{background:linear-gradient(180deg,#6b46a8,#452c6e)}
      .raid-floor-card.tier5{background:linear-gradient(180deg,#9a4a86,#652f57)}
      .raid-floor-card.tier6{background:linear-gradient(180deg,#b25334,#732f1c)}
      .raid-floor-card.tier7{background:linear-gradient(180deg,#8c1d1d,#4a0d0d);
        border-color:rgba(252,165,165,.5);box-shadow:0 2px 0 rgba(0,0,0,.5),
        inset 0 1px 0 rgba(255,255,255,.12), 0 0 16px rgba(220,38,38,.35)}
      .raid-floor-card:hover{filter:brightness(1.18);transform:translateY(-1px)}
      .raid-floor-card strong{font-size:20px;letter-spacing:-.02em;white-space:nowrap;
        display:flex;align-items:center;gap:9px}
      .raid-floor-clear{display:inline-flex;padding:3px 8px;border-radius:999px;font-size:11px;
        line-height:1;font-style:normal;font-weight:1000;color:#052e16;background:#86efac;
        border:1px solid #bbf7d0;box-shadow:0 0 12px rgba(74,222,128,.45)}
      .raid-floor-reward{display:inline-flex;align-items:center;gap:4px;padding:3px 7px;border-radius:999px;
        font-size:10px;font-style:normal;font-weight:1000;color:#fef3c7;background:rgba(15,23,42,.6);
        border:1px solid rgba(250,204,21,.66);box-shadow:0 0 9px rgba(250,204,21,.22)}
      .raid-floor-reward.summit{color:#ecfeff;border-color:#67e8f9;background:linear-gradient(90deg,rgba(8,47,73,.78),rgba(88,28,135,.78));
        box-shadow:0 0 8px #22d3ee,0 0 14px rgba(217,70,239,.55)}
      .raid-floor-card span{font-size:12px;color:rgba(255,255,255,.86);font-weight:800}
      /* 난이도 눈금 — 층이 올라갈수록 채워지는 칸이 늘어난다. */
      .raid-floor-heat{display:flex;gap:3px;justify-self:end}
      .raid-floor-heat i{width:7px;height:14px;border-radius:2px;background:rgba(255,255,255,.18)}
      .raid-floor-heat i.on{background:rgba(255,255,255,.9)}
      .raid-floor-card.locked{background:linear-gradient(180deg,#12161d,#0a0d12);border-color:#2b313b;
        color:#5c6673;cursor:not-allowed;filter:none;transform:none;
        box-shadow:0 2px 0 rgba(0,0,0,.4), inset 0 0 24px rgba(0,0,0,.55)}
      .raid-floor-card.locked span{color:#4d5764}
      .raid-floor-card.locked .raid-floor-heat i{background:rgba(255,255,255,.09)}
      .raid-floor-card.locked .raid-floor-heat i.on{background:rgba(255,255,255,.22)}
      .raid-floor-lock{font-size:11px!important;color:#6b7482!important}
      /* 맨 아래 바닥선 — 빌딩이 땅에 서 있는 느낌 */
      .raid-floor-ground{height:8px;border-radius:0 0 10px 10px;margin:0 auto;width:100%;
        background:linear-gradient(180deg,#2a3340,#141a22);box-shadow:0 3px 10px rgba(0,0,0,.5)}
      .raid-floor-actions{display:flex;justify-content:center;margin-top:8px}
      @media (max-width:720px){
        .raid-entry-actions{grid-template-columns:1fr}
        .raid-entry-card{min-height:150px}
        .raid-floor-card{grid-template-columns:auto 1fr;padding:8px 12px;min-height:50px}
        .raid-floor-card strong{font-size:17px}
        .raid-floor-heat{display:none}
      }
    `;
    document.head.appendChild(style);
  }

  function normalizeInviteCode(value) {
    return String(value == null ? '' : value).replace(/\D/g, '').slice(0, 4);
  }

  function setError(message) {
    const node = doc()?.getElementById('raidEntryError');
    if (node) node.textContent = String(message || '');
  }

  async function openNetworkLobby(options, triggerButton) {
    const ui = global.YuksamRaidRunUi;
    if (!ui || typeof ui.openNetworkLobby !== 'function') {
      setError('실시간 던전 대기실을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
      return false;
    }

    if (triggerButton) triggerButton.disabled = true;
    try {
      const result = await ui.openNetworkLobby(options);
      if (result === false) {
        setError('대기실에 연결하지 못했습니다. 다시 시도해 주세요.');
        return false;
      }
      return true;
    } catch (error) {
      setError(error?.message || '대기실에 연결하지 못했습니다. 다시 시도해 주세요.');
      return false;
    } finally {
      if (triggerButton?.isConnected !== false) triggerButton.disabled = false;
    }
  }

  /* 난이도 눈금 일곱 칸. 층이 올라갈수록 채워진 칸이 늘어난다. */
  function heatHtml(level) {
    return `<span class="raid-floor-heat">${
      Array.from({ length:7 }, (_, index) => `<i class="${index < level ? 'on' : ''}"></i>`).join('')
    }</span>`;
  }

  function floorCardsHtml() {
    const groups = floorGroups();
    const cards = groups.map((group) => {
      const lockNote = group.needs > 0
        ? `🔒 ${progress()?.labelFor(group.needs) || `${group.needs}구간`}을 먼저 깨야 합니다`
        : '🔒 잠김';
      const note = group.unlocked
        ? `<span>${group.recommended}</span>`
        : `<span class="raid-floor-lock">${lockNote}</span>`;
      return `
      <button class="raid-floor-card tier${group.id}${group.unlocked ? '' : ' locked'}"
        data-raid-floor-group="${group.id}" ${group.unlocked ? '' : 'disabled aria-disabled="true"'}>
        <strong>${group.label}${group.cleared ? '<em class="raid-floor-clear">Clear!</em>' : ''}${group.reward
          ? `<em class="raid-floor-reward${group.id === 7 ? ' summit' : ''}" title="${group.reward.name}">${group.reward.icon} ${group.reward.shortName}</em>`
          : ''}</strong>
        ${note}
        ${heatHtml(group.id)}
      </button>`;
    }).join('');
    // 아래에서 위로 쌓이므로(column-reverse) 바닥선은 목록 맨 앞에 둔다.
    return `<div class="raid-floor-ground"></div>${cards}`;
  }

  function openFloorSelection() {
    ensureStyles();
    if (typeof global.openModal !== 'function') return false;
    global.openModal(`
      <h2>도전할 층 선택</h2>
      <p class="raid-entry-intro">방장이 도전할 구간을 고르면 <strong>4자리 초대 코드</strong>가 만들어집니다.<br>
        앞 구간을 깨야 다음 구간이 열리고, <strong>파티원 3명이 모두 열어야</strong> 함께 들어갈 수 있어요.</p>
      <div class="panel-card">
        <div class="raid-floor-grid">${floorCardsHtml()}</div>
        <p id="raidEntryError" class="raid-entry-error" role="alert"></p>
        <div class="raid-floor-actions"><button class="ghost" id="raidEntryBackBtn">이전</button></div>
      </div>
    `, { type:'raidFloorSelect', pause:true });

    const groups = floorGroups();
    doc().querySelectorAll('[data-raid-floor-group]').forEach((button) => {
      const group = groups.find((item) => item.id === Number(button.dataset.raidFloorGroup));
      if (!group?.unlocked) return;
      button.onclick = () => openNetworkLobby({ mode:'create', floorGroup:group.id }, button);
    });
    const back = doc().getElementById('raidEntryBackBtn');
    if (back) back.onclick = () => open();
    return true;
  }

  function joinFromInput(triggerButton) {
    const input = doc()?.getElementById('raidInviteCodeInput');
    const code = normalizeInviteCode(input?.value);
    if (input) input.value = code;
    if (code.length !== 4) {
      setError('초대 코드 숫자 4자리를 입력해 주세요.');
      input?.focus?.();
      return false;
    }
    setError('');
    return openNetworkLobby({ mode:'join', code }, triggerButton);
  }

  function open() {
    ensureStyles();
    if (typeof global.openModal !== 'function') return false;
    global.openModal(`
      <h2>63빌딩 던전</h2>
      <p class="raid-entry-intro">친구 <strong>3명</strong>이 모여 함께 도전하는 던전입니다.</p>
      <div class="raid-entry-actions">
        <section class="raid-entry-card">
          <h3>방 만들기</h3>
          <p>도전할 층을 고르고 친구들에게<br>초대 코드를 알려 주세요.</p>
          <button class="primary" id="raidCreateRoomBtn">방 만들기</button>
        </section>
        <section class="raid-entry-card">
          <h3>초대 코드 입력하기</h3>
          <p>방장에게 받은 숫자 4자리를 입력하세요.</p>
          <div class="raid-code-row">
            <input id="raidInviteCodeInput" class="raid-code-input" type="text" inputmode="numeric"
              pattern="[0-9]*" maxlength="4" autocomplete="one-time-code" placeholder="0000" aria-label="4자리 초대 코드">
            <button class="primary" id="raidJoinRoomBtn">입장</button>
          </div>
        </section>
      </div>
      <p id="raidEntryError" class="raid-entry-error" role="alert"></p>
      <div class="raid-floor-actions"><button class="ghost" id="raidEntryCloseBtn">닫기</button></div>
    `, { type:'raidEntryHome', pause:true });

    const createButton = doc().getElementById('raidCreateRoomBtn');
    const joinButton = doc().getElementById('raidJoinRoomBtn');
    const input = doc().getElementById('raidInviteCodeInput');
    const closeButton = doc().getElementById('raidEntryCloseBtn');

    if (createButton) createButton.onclick = () => openFloorSelection();
    if (joinButton) joinButton.onclick = () => joinFromInput(joinButton);
    if (input) {
      input.oninput = () => { input.value = normalizeInviteCode(input.value); setError(''); };
      input.onkeydown = (event) => {
        if (event.key !== 'Enter' || event.repeat) return;
        event.preventDefault?.();
        joinFromInput(joinButton);
      };
    }
    if (closeButton) closeButton.onclick = () => call('closeModal');
    global.setTimeout?.(() => input?.focus?.(), 0);
    return true;
  }

  global.YuksamRaidEntryUi = Object.freeze({
    floorGroups,
    normalizeInviteCode,
    open,
    openFloorSelection,
  });
})(typeof window !== 'undefined' ? window : globalThis);
