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
    if (!P) return [{ id:1, label:'1–10층', recommended:'추천 레벨 Lv.5', unlocked:true, needs:0 }];
    const highest = P.highestUnlockedGroup(player());
    return P.GROUPS.map((group) => ({
      id:group.id,
      label:group.label,
      recommended:`추천 레벨 Lv.${group.recommendedLevel}`,
      unlocked:group.id <= highest,
      needs:group.id - 1,
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
      .raid-floor-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px;margin:14px 0}
      .raid-floor-card{min-height:104px;border-radius:14px;border:1px solid rgba(56,189,248,.65);
        background:linear-gradient(145deg,rgba(14,74,108,.96),rgba(12,40,67,.96));color:#f0f9ff;
        display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;cursor:pointer}
      .raid-floor-card:hover{filter:brightness(1.15);transform:translateY(-1px)}
      .raid-floor-card strong{font-size:25px}.raid-floor-card span{font-size:13px;color:#bae6fd;font-weight:800}
      .raid-floor-card.locked{background:linear-gradient(145deg,#080b11,#151922);border-color:#303643;
        color:#626b79;cursor:not-allowed;filter:none;transform:none;box-shadow:inset 0 0 28px rgba(0,0,0,.5)}
      .raid-floor-card.locked span{color:#545d6b}.raid-floor-lock{font-size:11px!important;color:#737c89!important}
      .raid-floor-actions{display:flex;justify-content:center;margin-top:8px}
      @media (max-width:720px){
        .raid-entry-actions,.raid-floor-grid{grid-template-columns:1fr}
        .raid-entry-card{min-height:150px}
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

  function floorCardsHtml() {
    return floorGroups().map((group) => {
      const lockNote = group.needs > 0
        ? `🔒 ${progress()?.labelFor(group.needs) || `${group.needs}구간`}을 먼저 깨야 합니다`
        : '🔒 잠김';
      return `
      <button class="raid-floor-card${group.unlocked ? '' : ' locked'}"
        data-raid-floor-group="${group.id}" ${group.unlocked ? '' : 'disabled aria-disabled="true"'}>
        <strong>${group.label}</strong>
        <span>${group.recommended}</span>
        ${group.unlocked ? '' : `<span class="raid-floor-lock">${lockNote}</span>`}
      </button>`;
    }).join('');
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
