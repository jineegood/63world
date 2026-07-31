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

  let active = null;      // 지금 돌고 있는 판
  let question = null;    // 지금 화면에 뜬 문제
  let busy = false;       // 연출 재생 중에는 입력을 막는다

  /* ---------- 스타일 ---------- */

  function ensureStyles() {
    if (global.document.getElementById('raidRunStylesV1')) return;
    const style = global.document.createElement('style');
    style.id = 'raidRunStylesV1';
    style.textContent = `
      .raid-slots{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:14px 0}
      .raid-slot-card{background:rgba(15,23,42,.72);border:1px solid rgba(148,163,184,.35);
        border-radius:12px;padding:12px;text-align:center}
      .raid-slot-card h4{margin:0 0 4px;font-size:15px}
      .raid-slot-card .raid-role{font-size:12px;color:#9fb3cd;margin-bottom:8px}
      .raid-slot-pick{display:flex;gap:4px;justify-content:center;flex-wrap:wrap}
      .raid-slot-pick button{font-size:12px;padding:4px 8px;border-radius:8px;
        border:1px solid rgba(148,163,184,.45);background:rgba(30,41,59,.9);color:#e2e8f0;cursor:pointer}
      .raid-slot-pick button.on{background:#38bdf8;border-color:#7dd3fc;color:#06263a;font-weight:700}
      .raid-hint{font-size:12px;color:#9fb3cd;margin-top:2px}
      .raid-travel{position:relative;height:130px;overflow:hidden;border-radius:12px;
        background:linear-gradient(180deg,#111c2e,#1e293b);margin:14px 0}
      .raid-travel .raid-walker{position:absolute;bottom:26px;font-size:26px;animation:raidWalk 1.6s linear forwards}
      @keyframes raidWalk{from{left:-12%}to{left:104%}}
      .raid-travel .raid-floorline{position:absolute;bottom:20px;left:0;right:0;height:2px;background:rgba(148,163,184,.4)}
      .raid-monster-box{text-align:center;margin-bottom:10px}
      .raid-monster-name{font-size:17px;font-weight:800;color:#fca5a5}
      .raid-monster-name.boss{color:#fbbf24}
      .raid-bar{position:relative;height:14px;border-radius:999px;background:rgba(2,6,23,.75);
        border:1px solid rgba(148,163,184,.35);overflow:hidden;margin-top:4px}
      .raid-bar span{display:block;height:100%;background:linear-gradient(90deg,#ef4444,#f97316);transition:width .25s}
      .raid-bar.ally span{background:linear-gradient(90deg,#22c55e,#4ade80)}
      .raid-bar em{position:absolute;inset:0;font-style:normal;font-size:11px;line-height:14px;
        text-align:center;color:#f8fafc;text-shadow:0 1px 2px rgba(0,0,0,.8)}
      .raid-party{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:10px 0}
      .raid-party .raid-member{background:rgba(15,23,42,.7);border:1px solid rgba(148,163,184,.3);
        border-radius:10px;padding:8px}
      .raid-party .raid-member.down{opacity:.42}
      .raid-party .raid-member.me{border-color:#38bdf8}
      .raid-member-top{display:flex;justify-content:space-between;font-size:12px;margin-bottom:2px}
      .raid-member-slot{color:#9fb3cd}
      .raid-log{max-height:120px;overflow-y:auto;background:rgba(2,6,23,.55);border-radius:10px;
        padding:8px 10px;font-size:13px;line-height:1.5;margin-top:8px}
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
      },
      {
        id:'ally_guard', name:'훈련병 도윤', klass:'warrior', spec:'방어',
        slot:'middle', maxHp:Math.round(maxHp * 1.15), hp:Math.round(maxHp * 1.15),
        attack:Math.max(3, Math.round(attack * 0.85)),
      },
      {
        id:'ally_priest', name:'수련사제 하린', klass:'priest', spec:'신성',
        slot:'back', maxHp:Math.round(maxHp * 0.85), hp:Math.round(maxHp * 0.85),
        attack:Math.max(3, Math.round(attack * 0.8)),
      },
    ];
  }

  /* ---------- 문제 ---------- */

  function pickQuestion() {
    const list = (call('getQuestions') || []).filter((q) => q && q.q && q.answer != null);
    if (!list.length) return { q:'7 + 5 = ?', choices:['10', '11', '12', '13'], answer:'12' };
    return list[Math.floor(Math.random() * list.length)];
  }

  /* ---------- 화면 1: 대형 배치 ---------- */

  function openFormationScreen() {
    ensureStyles();
    const R = rules();
    const snap = active.snapshot();
    const picks = Object.fromEntries(snap.members.map((m) => [m.id, m.slot]));

    function render(message = '') {
      const cards = snap.members.map((member) => `
        <div class="raid-slot-card">
          <h4>${esc(member.name)}${member.isPlayer ? ' (나)' : ''}</h4>
          <div class="raid-role">${esc(member.spec || '전문화 없음')} · 공격 ${member.attack} · HP ${member.maxHp}</div>
          <div class="raid-slot-pick">
            ${R.SLOTS.map((slot) => `
              <button data-member="${esc(member.id)}" data-slot="${slot}"
                class="${picks[member.id] === slot ? 'on' : ''}">${esc(R.slotLabel(slot))}</button>
            `).join('')}
          </div>
        </div>
      `).join('');

      call('openModal', `
        <h2>${esc(snap.title)}</h2>
        <div class="panel-card">
          <p>대형을 정하세요. <strong>앞줄은 1.5배로 맞고 뒷줄은 0.6배만 맞습니다.</strong></p>
          <p class="raid-hint">몬스터는 앞줄부터 노립니다. 튼튼한 사람을 앞에 세우세요.</p>
          <div class="raid-slots">${cards}</div>
          ${message ? `<p class="raid-hint" style="color:#fca5a5">${esc(message)}</p>` : ''}
          <div class="answer-row">
            <button class="primary" id="raidStartBtn">출발</button>
            <button class="ghost" id="raidCancelBtn">돌아가기</button>
          </div>
        </div>
      `, { type:'raidFormation', pause:true });

      global.document.querySelectorAll('.raid-slot-pick button').forEach((button) => {
        button.onclick = () => {
          picks[button.dataset.member] = button.dataset.slot;
          render();
        };
      });
      const startBtn = global.document.getElementById('raidStartBtn');
      if (startBtn) {
        startBtn.onclick = () => {
          const result = active.confirmFormation(picks);
          if (!result.ok) { render(result.reason); return; }
          playTravelScene();
        };
      }
      const cancelBtn = global.document.getElementById('raidCancelBtn');
      if (cancelBtn) cancelBtn.onclick = () => { active = null; call('closeModal'); };
    }

    render();
  }

  /* ---------- 화면 2: 이동 연출 ---------- */

  function playTravelScene() {
    ensureStyles();
    const snap = active.snapshot();
    const step = snap.encounterIndex + 1;
    const walkers = ['🧝', '🛡️', '✨'];

    call('openModal', `
      <h2>${esc(snap.title)}</h2>
      <div class="panel-card">
        <p class="raid-progress">${step} / ${snap.encounterTotal} — 안쪽으로 이동 중…</p>
        <div class="raid-travel">
          <div class="raid-floorline"></div>
          ${walkers.map((face, i) => `
            <div class="raid-walker" style="animation-delay:${i * 0.16}s">${face}</div>
          `).join('')}
        </div>
        <p class="raid-hint">셋이 함께 걸어갑니다.</p>
      </div>
    `, { type:'raidTravel', pause:true });

    global.setTimeout(() => {
      if (!active) return;
      const arrival = active.arriveAtEncounter();
      if (!arrival.ok) return;
      if (arrival.cleared) { finishRun(); return; }
      openBattleScreen();
    }, 1750);
  }

  /* ---------- 화면 3: 전투 ---------- */

  function openBattleScreen() {
    ensureStyles();
    question = pickQuestion();
    busy = false;
    renderBattle();
  }

  function memberCard(member) {
    const R = rules();
    const percent = Math.max(0, Math.round((member.hp / member.maxHp) * 100));
    return `
      <div class="raid-member ${member.hp <= 0 ? 'down' : ''} ${member.isPlayer ? 'me' : ''}">
        <div class="raid-member-top">
          <strong>${esc(member.name)}</strong>
          <span class="raid-member-slot">${esc(R.slotLabel(member.slot))}</span>
        </div>
        <div class="raid-bar ally"><span style="width:${percent}%"></span><em>${member.hp}/${member.maxHp}</em></div>
      </div>
    `;
  }

  function logHtml() {
    const recent = active.log.slice(-8);
    return recent.map((entry) => {
      const cls = entry.kind === 'monster-hit' ? 'hit'
        : entry.kind === 'party-hit' ? 'mine'
        : ['monster-windup', 'monster-down', 'member-down', 'wiped', 'encounter'].includes(entry.kind) ? 'warn'
        : '';
      return `<div class="${cls}">${esc(entry.text)}</div>`;
    }).join('');
  }

  function answerHtml() {
    if (busy) return '<p class="raid-hint">진행 중…</p>';
    const choices = Array.isArray(question?.choices) && question.choices.length === 4 ? question.choices : null;
    if (choices) {
      return `<div class="choice-grid">${choices.map((choice, i) => `
        <button class="primary raid-choice" data-choice="${i}">${esc(choice)}</button>
      `).join('')}</div>`;
    }
    return `<div class="answer-row">
      <input id="raidAnswer" placeholder="정답 입력" autocomplete="off" />
      <button class="primary" id="raidSubmitBtn">공격</button>
    </div>`;
  }

  function renderBattle() {
    const snap = active.snapshot();
    const monster = snap.monster;
    if (!monster) return;
    const percent = Math.max(0, Math.round((monster.hp / monster.maxHp) * 100));
    const nextKind = rules().attackKindForRound(monster, snap.round);

    call('openModal', `
      <h2>${esc(snap.title)}</h2>
      <div class="panel-card">
        <p class="raid-progress">${snap.encounterIndex + 1} / ${snap.encounterTotal}</p>
        <div class="raid-monster-box">
          <div class="raid-monster-name ${monster.isBoss ? 'boss' : ''}">
            ${monster.isBoss ? '👑 ' : ''}Lv.${monster.level} ${esc(monster.name)}
          </div>
          <div class="raid-bar"><span style="width:${percent}%"></span><em>${monster.hp}/${monster.maxHp}</em></div>
          <p class="raid-hint">${nextKind === 'all' ? '⚠ 다음은 전체 공격입니다!' : '다음은 앞줄을 노립니다.'}</p>
        </div>
        <div class="raid-party">${snap.members.map(memberCard).join('')}</div>
        <h3>${esc(question?.q || '')}</h3>
        ${answerHtml()}
        <div class="raid-log">${logHtml()}</div>
      </div>
    `, { type:'raidBattle', pause:true });

    if (busy) return;
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

  function submitAnswer(given) {
    if (busy || !active || active.phase !== 'battle') return;
    busy = true;

    const correct = norm(given) === norm(question?.answer);
    const answers = active.rollAllyAnswers();
    answers.me = correct;

    call('playSfx', correct ? 'hit' : 'miss');
    const result = active.resolveRound(answers);
    renderBattle();

    if (!result.ok) { busy = false; return; }

    global.setTimeout(() => {
      if (!active) return;
      if (result.wiped) { finishRun(); return; }
      if (result.cleared) { finishRun(); return; }
      if (result.monsterDown) { playTravelScene(); return; }
      question = pickQuestion();
      busy = false;
      renderBattle();
    }, 1100);
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
    if (doneBtn) doneBtn.onclick = () => { active = null; question = null; call('closeModal'); };
  }

  /* ---------- 밖에서 부르는 입구 ---------- */

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
    openFormationScreen();
    return true;
  }

  global.YuksamRaidRunUi = Object.freeze({
    startRun,
    isRunning:() => !!active,
    /* 검사에서 쓰려고 지금 상태를 들여다볼 수 있게 열어 둔다. */
    peek:() => (active ? active.snapshot() : null),
    currentQuestion:() => question,
    submitAnswerForTest:(value) => submitAnswer(value),
  });
})(typeof window !== 'undefined' ? window : globalThis);
