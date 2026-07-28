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
      body: `<p>몬스터에게 다가가면 전투가 시작됩니다. ${tutorialGreenV1('문제를 맞히면 공격')}하고, 틀리면 반격을 받아요.</p>
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
          ${idx > 0 ? `<button class="ghost small" onclick="__tutorialStepV53(${idx - 1})">이전</button>` : ''}
          <button class="primary" data-default-action="true" onclick="${isLast ? '__tutorialDoneV53()' : `__tutorialStepV53(${idx + 1})`}">${isLast ? '시작하기!' : '다음'}</button>
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
      body: `<p>두 학생에게 같은 문제가 나오고, 제한 시간은 ${tutorialGreenV1('20초')}예요.</p>
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
        ${idx > 0 ? `<button class="ghost" onclick="__pvpTutorialStepV1(${idx - 1})">이전</button>` : ''}
        <button class="primary" data-default-action="true" onclick="${isLast ? '__pvpTutorialDoneV1()' : `__pvpTutorialStepV1(${idx + 1})`}">${isLast ? '확인' : '다음'}</button>
      </div>
    `, { type:'pvpTutorial', pause:true });
  }

  window.__pvpTutorialStepV1 = renderPvpTutorial;
  window.__pvpTutorialDoneV1 = async function () {
    window.markPvpTutorialSeenV1?.();
    window.closeModal?.();
    const done = pvpTutorialDone;
    pvpTutorialDone = null;
    await done?.();
  };
  window.startPvpTutorialV1 = function (done) {
    pvpTutorialDone = typeof done === 'function' ? done : null;
    renderPvpTutorial(0);
  };
})();
