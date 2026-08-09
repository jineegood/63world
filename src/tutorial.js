/* v53: 첫 캐릭터 생성 시 나오는 간단한 튜토리얼 안내 */
(function tutorialV53() {
  if (window.__TUTORIAL_V53__) return;
  window.__TUTORIAL_V53__ = true;

  function escapeTutorialTextV1(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&':'&amp;',
      '<':'&lt;',
      '>':'&gt;',
      '"':'&quot;',
      "'":'&#39;',
    })[char]);
  }

  function tutorialGreenV1(value) {
    return `<strong class="quest-keyword-green">${escapeTutorialTextV1(value)}</strong>`;
  }
  window.tutorialGreenV1 = tutorialGreenV1;

  const STEPS = [
    {
      title: '🎉 63월드에 온 것을 환영합니다!',
      body: `<p>여기는 문제를 풀며 성장하는 세계입니다.</p>
        <p class="muted">먼저 ${tutorialGreenV1('명진쌤')}에게 가서 말을 걸어 첫 번째 퀘스트를 받아보세요.</p>`,
    },
    {
      title: '🕹️ 움직이는 방법',
      body: `<ul style="line-height:1.9;margin:0;padding-left:20px">
        <li>${tutorialGreenV1('W A S D')} 또는 ${tutorialGreenV1('방향키')} — 캐릭터 이동</li>
        <li>${tutorialGreenV1('E')} — NPC·문·포탈과 상호작용 (가까이 가면 안내가 떠요)</li>
        <li>${tutorialGreenV1('N')} — 스킬창 열기 / ${tutorialGreenV1('C')} — 장비창 열기</li>
        <li>아래 <b>채팅창</b>에 글을 쓰면 친구들에게 말을 걸 수 있어요</li>
      </ul>`,
    },
    {
      title: '⚔️ 전투와 성장',
      body: `<p>몬스터에게 다가가면 전투가 시작됩니다. ${tutorialGreenV1('문제를 맞히면 공격')}해 온전한 피해를 주고,
        틀려도 정답을 확인한 뒤 ${tutorialGreenV1('절반의 피해')}를 줄 수 있어요.</p>
        <p class="muted">레벨이 오르면 스킬 포인트를 받고, ${tutorialGreenV1('5레벨')}이 되면 전문화를 고를 수 있습니다.
        마을 상점에서 장비를 사면 훨씬 강해져요!</p>`,
    },
  ];

  function render(idx) {
    const open = window.openModal;
    if (typeof open !== 'function') return;
    const step = STEPS[idx];
    const isLast = idx === STEPS.length - 1;
    const dots = STEPS.map((_, i) => `<span style="display:inline-block;width:8px;height:8px;border-radius:999px;margin:0 3px;background:${i === idx ? '#facc15' : 'rgba(255,255,255,.25)'}"></span>`).join('');
    open(`
      <h2>${step.title}</h2>
      <div class="panel-card" style="line-height:1.7">${step.body}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px">
        <div>${dots}</div>
        <div style="display:flex;gap:8px">
          <button class="primary" data-default-action="true" data-tutorial-next-v62="true" style="order:2" onclick="${isLast ? '__tutorialDoneV53()' : `__tutorialStepV53(${idx + 1})`}">${isLast ? '시작하기!' : '다음'}</button>
          ${idx > 0 ? `<button class="ghost small" style="order:1" onclick="__tutorialStepV53(${idx - 1})">이전</button>` : ''}
        </div>
      </div>
    `, { type: 'tutorial', pause: true });
  }

  // [v59] 튜토리얼도 퀘스트 대화와 같은 소리로 넘어가게 한다
  window.__tutorialStepV53 = function tutorialStepWithSound(idx) {
    try { window.playSfx?.('dialogue'); } catch {}
    render(idx);
  };
  window.__tutorialDoneV53 = function () {
    try { window.closeModal?.(); } catch {}
    try {
      window.toast?.('명진쌤에게 가서 E를 눌러 대화해 보세요!', 3200);
      window.appendChatMessage?.('system', '안내', '명진쌤에게 가서 첫 퀘스트를 받아보세요. (가까이 가서 E)');
    } catch {}
  };
  window.startTutorialV53 = function () { try { window.playSfx?.('dialogue'); } catch {} render(0); };

  const PVP_STEPS = [
    {
      title: '⚔️ 학생 대전 시작하기',
      body: `<p>마을에서 다른 학생 캐릭터를 ${tutorialGreenV1('오른쪽 클릭')}하면 얼굴과 승패 기록을 볼 수 있어요.</p>
        <p>프로필의 ${tutorialGreenV1('대전 신청')} 버튼을 누르면 친선 대전을 요청합니다.</p>`,
    },
    {
      title: '✏️ 같은 문제를 함께 풀어요',
      body: `<p>두 학생에게 같은 문제가 나오고, 제한 시간은 ${tutorialGreenV1('30초')}예요.</p>
        <p>먼저 제출해도 상대가 다 풀 때까지 기다린 뒤 함께 결과를 확인합니다.</p>`,
    },
    {
      title: '🎲 매 라운드 공격 순서',
      body: `<p>매 라운드 두 학생이 ${tutorialGreenV1('30면체 주사위')}를 굴려 높은 숫자가 먼저 공격해요.</p>
        <p>그만하고 싶을 때는 ${tutorialGreenV1('항복')}을 누를 수 있고, 게임 아이템이나 체력은 잃지 않아요.</p>`,
    },
  ];
  let pvpTutorialDone = null;

  function renderPvpTutorial(idx) {
    const step = PVP_STEPS[idx];
    if (!step || typeof window.openModal !== 'function') return;
    const isLast = idx === PVP_STEPS.length - 1;
    window.openModal(`
      <h2>${step.title}</h2>
      <div class="panel-card" style="line-height:1.7">${step.body}</div>
      <div class="action-row" style="justify-content:flex-end;margin-top:12px">
        <button class="primary" data-default-action="true" data-tutorial-next-v62="true" style="order:2" onclick="${isLast ? '__pvpTutorialDoneV1()' : `__pvpTutorialStepV1(${idx + 1})`}">${isLast ? '확인' : '다음'}</button>
        ${idx > 0 ? `<button class="ghost" style="order:1" onclick="__pvpTutorialStepV1(${idx - 1})">이전</button>` : ''}
      </div>
    `, { type:'pvpTutorial', pause:true });
  }

  window.__pvpTutorialStepV1 = renderPvpTutorial;
  window.__pvpTutorialDoneV1 = async function () {
    window.closeModal?.();
    const done = pvpTutorialDone;
    pvpTutorialDone = null;
    await done?.();
  };
  window.startPvpTutorialV1 = function (done) {
    pvpTutorialDone = typeof done === 'function' ? done : null;
    /* 자동 안내는 캐릭터마다 정말 한 번만 보여 준다. 첫 화면을 여는 순간
       저장해 두므로 X/ESC로 닫더라도 다음 우클릭 때 반복되지 않는다. */
    window.markPvpTutorialSeenV1?.();
    renderPvpTutorial(0);
  };

  const HELP_SECTIONS = [
    {
      id:'movement', icon:'🕹️', title:'기본 이동',
      body:`${STEPS[1].body}
        <p class="help-note-v1">${tutorialGreenV1('마우스 왼쪽 클릭')}으로도 원하는 곳까지 이동할 수 있고,
        ${tutorialGreenV1('Z')}를 누르면 잠시 춤을 춥니다.</p>`,
    },
    {
      id:'interaction', icon:'💬', title:'상호작용/퀘스트',
      body:`<ul>
        <li>NPC·문·포탈 가까이에 생기는 ${tutorialGreenV1('원 안')}으로 이동하세요.</li>
        <li>${tutorialGreenV1('E')}를 눌러 대화하거나 들어가고, 대화 중에도 E로 다음 문장을 볼 수 있어요.</li>
        <li>처음에는 ${tutorialGreenV1('명진쌤')}의 퀘스트를 따라가세요. 화면의 퀘스트 목록에서 목표와 진행도를 확인할 수 있습니다.</li>
        <li>완료 표시가 뜨면 퀘스트를 준 NPC에게 돌아가 보상을 받으세요.</li>
      </ul>`,
    },
    {
      id:'combat', icon:'⚔️', title:'전투/문제',
      body:`${STEPS[2].body}
        <ul>
          <li>객관식은 방향키로 보기를 고를 수 있고, 주관식은 정답을 입력해 제출합니다.</li>
          <li>오답이면 올바른 정답을 잠시 보여 준 뒤 공격 피해가 절반으로 적용됩니다.</li>
          <li>적이 살아 있으면 자기 차례에 공격하므로 ${tutorialGreenV1('HP와 보호막')}도 살펴보세요.</li>
        </ul>`,
    },
    {
      id:'skills', icon:'✨', title:'스킬/전문화',
      body:`<ul>
        <li>${tutorialGreenV1('N')}을 눌러 스킬창을 엽니다.</li>
        <li>레벨이 오르면 받은 ${tutorialGreenV1('스킬 포인트')}로 공용 스킬을 자유롭게 배울 수 있어요.</li>
        <li>${tutorialGreenV1('5레벨')}부터 직업별 전문화를 고르고, 해당 전문화의 스킬을 배울 수 있습니다.</li>
        <li>${tutorialGreenV1('액티브 스킬')}은 전투에서 직접 선택해 쓰며, 사용 뒤에는 표시된 쿨타임을 기다려야 합니다.</li>
      </ul>`,
    },
    {
      id:'equipment', icon:'🛡️', title:'장비/강화',
      body:`<ul>
        <li>${tutorialGreenV1('C')}를 눌러 상태창과 가방을 열고 장비를 장착합니다.</li>
        <li>마을 서쪽 장비 상점에서 무기·방어구를 ${tutorialGreenV1('Gold')}로 살 수 있어요.</li>
        <li>강화 상점에서는 장착 중인 무기를 ${tutorialGreenV1('빌딩 3개')}로 강화합니다.</li>
        <li>등급이 오르면 무기 능력치와 빛깔이 강해지지만, 강화 실패 시 한 등급 내려갈 수 있습니다.</li>
      </ul>`,
    },
    {
      id:'stats', icon:'📊', title:'능력치/자원',
      body:`<ul>
        <li>${tutorialGreenV1('EXP')}가 쌓이면 레벨이 오르고 HP와 성장 기회가 늘어납니다.</li>
        <li>${tutorialGreenV1('Gold')}는 일반 장비와 코스튬을 살 때 사용합니다.</li>
        <li>${tutorialGreenV1('빌딩')}은 특별 상점·펫 소환·무기 강화에 쓰는 특별 화폐입니다.</li>
        <li>${tutorialGreenV1('스킬 포인트')}는 스킬을 배우는 데 사용하며 상태창과 스킬창에서 남은 수를 확인할 수 있어요.</li>
      </ul>`,
    },
    {
      id:'companions', icon:'🐾', title:'펫/코스튬',
      body:`<ul>
        <li>펫 상점의 수정구에서 ${tutorialGreenV1('빌딩 10개')}로 새로운 펫을 만날 수 있어요.</li>
        <li>얻은 펫은 ${tutorialGreenV1('C')} 상태창에서 장착하며, 장착한 펫의 능력치가 적용됩니다.</li>
        <li>옷 상인 상남에게 코스튬을 사고 상태창의 코스튬 칸에서 입을 수 있습니다.</li>
        <li>코스튬은 실제 장비 위에 보이는 ${tutorialGreenV1('꾸미기 아이템')}이며 전투 능력치는 바꾸지 않습니다.</li>
      </ul>`,
    },
    {
      id:'pvp', icon:'🎲', title:'PVP',
      body:PVP_STEPS.map((step) => `<div class="help-subsection-v1"><h4>${step.title}</h4>${step.body}</div>`).join(''),
    },
  ];

  function renderGameHelpV1(sectionId) {
    if (typeof window.openModal !== 'function') return;
    const active = HELP_SECTIONS.find((section) => section.id === sectionId) || HELP_SECTIONS[0];
    const tabs = HELP_SECTIONS.map((section) => `
      <button type="button" class="help-tab-v1${section.id === active.id ? ' active' : ''}"
        data-help-section-v1="${section.id}" aria-selected="${section.id === active.id}"
        onclick="__openGameHelpSectionV1('${section.id}')">
        <span>${section.icon}</span>${section.title}
      </button>`).join('');
    window.openModal(`
      <div class="game-help-v1">
        <header class="game-help-head-v1">
          <h2>❓ 63월드 도움말</h2>
          <p>궁금한 항목을 누르면 바로 설명을 볼 수 있어요.</p>
        </header>
        <nav class="game-help-tabs-v1" role="tablist" aria-label="도움말 항목">${tabs}</nav>
        <section class="game-help-content-v1 panel-card" role="tabpanel">
          <h3><span>${active.icon}</span>${active.title}</h3>
          <div class="game-help-copy-v1">${active.body}</div>
        </section>
      </div>
    `, { type:'help', pause:true });
  }

  window.YuksamHelpSectionsV1 = Object.freeze(HELP_SECTIONS.map((section) => Object.freeze({ ...section })));
  window.__openGameHelpSectionV1 = renderGameHelpV1;
  window.openGameHelpV1 = function (sectionId = 'movement') {
    try { window.playSfx?.('open'); } catch {}
    renderGameHelpV1(sectionId);
  };

  // 튜토리얼에서는 현재 포커스와 무관하게 E키가 항상 '다음/확인'을 실행한다.
  window.YuksamInputRouter?.register({
    id:'tutorial-default-next-v62',
    type:'keydown',
    priority:96,
    handle:(event) => {
      if (event.key?.toLowerCase() !== 'e') return false;
      const next = window.document?.querySelector('#modalContent [data-tutorial-next-v62="true"]');
      if (!next) return false;
      event.preventDefault();
      event.stopImmediatePropagation();
      next.click();
      return true;
    },
  });
})();
