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
          <button class="primary" onclick="${isLast ? '__tutorialDoneV53()' : `__tutorialStepV53(${idx + 1})`}">${isLast ? '시작하기!' : '다음'}</button>
        </div>
      </div>
    `, { type: 'tutorial', pause: true });
  }

  window.__tutorialStepV53 = render;
  window.__tutorialDoneV53 = function () {
    try { window.closeModal?.(); } catch {}
    try {
      window.toast?.('명진쌤에게 가서 E를 눌러 대화해 보세요!', 3200);
      window.appendChatMessage?.('system', '안내', '명진쌤에게 가서 첫 퀘스트를 받아보세요. (가까이 가서 E)');
    } catch {}
  };
  window.startTutorialV53 = function () { render(0); };
})();
