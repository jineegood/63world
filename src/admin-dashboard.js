/*
 * admin-dashboard.js — 교사 대시보드 & 서버 오픈/닫기
 * game.js에서 분리된 교사 전용 모듈. 클래식 스크립트로 로드되어 최상위 함수가 window에 노출된다.
 * (index.html에서 game.js 다음 줄에 로드됨 — game.js의 유틸/전역보다 늦게 실행)
 * 공용 유틸(escapeHtml, escapeJs, fmtDate 등)과 game 객체는 game.js에 남아 있으며 호출 시점에 늦은 바인딩으로 참조한다.
 */

function fmtAcc(rec){
  const answered = rec && rec.answered ? rec.answered : 0;
  const correct = rec && rec.correct ? rec.correct : 0;
  const pct = answered ? Math.round((correct/answered)*100) : 0;
  return `${pct}% <span class="muted">(${correct}/${answered})</span>`;
}

function teacherZoneLabel(zone){
  const map = { silent_forest:'고요한 숲', desert_wasteland:'황량한 사막', spooky_swamp:'으스스한 늪지' };
  return map[zone] || zone || '미지정';
}

function teacherZoneOptions(selected){
  const zones = [['silent_forest','고요한 숲'],['desert_wasteland','황량한 사막'],['spooky_swamp','으스스한 늪지']];
  return zones.map(([k,v]) => `<option value="${k}" ${selected===k?'selected':''}>${escapeHtml(v)}</option>`).join('');
}

function teacherStudentsHtml(){
  const players = getAllPlayers();
  if (!players.length) return '<div class="empty-state">저장된 학생 데이터가 없습니다.</div>';
  const rows = players.map((p) => {
    const meta = CLASS_META[p.class] || { name: p.class };
    const spec = p.spec ? ` <small class="muted">${escapeHtml(p.spec)}</small>` : '';
    return `<tr>
      <td><b>${escapeHtml(p.name)}</b></td>
      <td>${escapeHtml(meta.name)}${spec}</td>
      <td>Lv.${p.level}</td>
      <td>${fmtAcc(p.records)}</td>
      <td>${p.gold}</td>
      <td>${p.building}</td>
      <td><code>${escapeHtml(p.password)}</code></td>
      <td class="muted">${fmtDate(p.updatedAt)}</td>
      <td class="t-actions">
        <button class="primary tiny" onclick="adminOpenGrantModal('${escapeJs(p.name)}')">보상지급</button>
        <button class="ghost tiny" onclick="adminOpenWrongLog('${escapeJs(p.name)}')">오답기록</button>
        <button class="ghost tiny danger-text" onclick="adminConfirmDeleteStudent('${escapeJs(p.name)}')">계정삭제</button>
      </td>
    </tr>`;
  }).join('');
  return `<div class="teacher-body">
    <table class="teacher-table">
      <tr><th>이름</th><th>직업</th><th>레벨</th><th>정답률</th><th>골드</th><th>빌딩</th><th>비밀번호</th><th>최근저장</th><th>관리</th></tr>
      ${rows}
    </table>
  </div>`;
}

function teacherWorkbooksHtml(){
  const workbooks = getWorkbooks();
  const workbookOptions = workbooks.map((wb) => `<option value="${wb.id}">${escapeHtml(wb.name)} (${wb.questions.length}문제)</option>`).join('');
  const cards = workbooks.length ? workbooks.map((wb, i) => `
    <div class="workbook-card${wb.enabled === false ? ' wb-disabled' : ''}">
      <div class="wb-head">
        <div>
          <b>${escapeHtml(wb.name)}</b>
          <span class="badge ${wb.enabled === false ? '' : 'gold'}">${wb.enabled === false ? '⚪ 꺼짐' : '🟢 출제 중'}</span>
          <span class="badge">문제집${i + 1}</span>
          <span class="badge">${escapeHtml(wb.subject || '미분류')}</span>
          <span class="badge gold">${wb.questions.length}문제</span>
          <span class="badge">${escapeHtml(teacherZoneLabel(wb.zone))}</span>
        </div>
        <div class="t-actions">
          <button class="${wb.enabled === false ? 'primary' : 'ghost'} tiny" onclick="adminToggleWorkbook('${wb.id}')">${wb.enabled === false ? '켜기' : '끄기'}</button>
          <button class="ghost tiny danger-text" onclick="deleteWorkbook('${wb.id}')">문제집 삭제</button>
        </div>
      </div>
      <p class="muted" style="margin:6px 0 2px">요청: ${escapeHtml(wb.prompt || '직접 생성')}</p>
      <details>
        <summary>문제 보기 / 삭제</summary>
        <table class="teacher-table" style="margin-top:8px">
          <tr><th>#</th><th>문제</th><th>정답</th><th></th></tr>
          ${wb.questions.length ? wb.questions.map((q, qi) => `
            <tr>
              <td>${qi + 1}</td>
              <td>${escapeHtml(q.q)}</td>
              <td class="good-text">${escapeHtml(q.answer)}</td>
              <td><button class="ghost tiny danger-text" onclick="removeQuestionFromWorkbook('${wb.id}', '${q.id}')">삭제</button></td>
            </tr>
          `).join('') : '<tr><td colspan="4" class="muted">문제가 없습니다.</td></tr>'}
        </table>
      </details>
    </div>
  `).join('') : '<div class="empty-state">등록된 문제집이 없습니다.</div>';

  return `<div class="teacher-body">
    <div class="panel-card">
      <h3>문제 직접 추가</h3>
      <label>추가할 문제집</label>
      <select id="adminWorkbook">${workbookOptions || '<option value="">문제집 없음</option>'}</select>
      <div class="wb-new-row">
        <input id="adminQuestion" placeholder="예: 24 ÷ 6 = ?" />
        <input id="adminAnswer" placeholder="정답" style="max-width:140px" />
        <button class="primary" onclick="addAdminQuestion()">추가</button>
      </div>
      <label>객관식 보기 4개 (선택사항)</label>
      <input id="adminChoices" placeholder="예: 2, 3, 4, 5" />
      <h3 style="margin-top:16px">여러 문제 한 번에 등록</h3>
      <textarea id="adminBulk" rows="4" placeholder="한 줄에 하나씩:  문제 = 정답&#10;예)&#10;7 × 8 = ? = 56&#10;대한민국의 수도는? = 서울"></textarea>
      <button class="ghost wide" onclick="adminBulkImport()">붙여넣은 문제 모두 추가</button>
      <p class="muted">마지막 "=" 뒤가 정답으로 인식됩니다.</p>
    </div>
    <div class="panel-card" style="margin-top:12px">
      <h3>AI 문제집 생성</h3>
      <label>문제집 이름</label>
      <input id="aiWorkbookName" placeholder="예: 문제집2 - 영어 단어 20문제 세트" />
      <label>AI 요청 문장</label>
      <textarea id="aiPrompt" placeholder="예: 초등학교 6학년 영단어 20개 문제집 만들어줘"></textarea>
      <button class="primary wide" onclick="generateAiQuestionSet()">AI로 문제집 생성</button>
    </div>
    <div style="margin-top:12px">${cards}</div>
  </div>`;
}

function teacherSettingsHtml(){
  const open = isServerOpen();
  const stateHtml = open
    ? '<span class="good-text" style="font-size:1.5em;font-weight:800">🟢 열림</span>'
    : '<span class="danger-text" style="font-size:1.5em;font-weight:800">🔴 닫힘</span>';
  return `<div class="teacher-body">
    <div class="panel-card">
      <h3>🔑 교사 비밀번호 변경</h3>
      <div class="wb-new-row">
        <input type="password" id="teacherNewPw" placeholder="새 비밀번호" />
        <button class="primary" onclick="adminSaveTeacherSettings()">변경</button>
      </div>
      <p class="muted">교사 대시보드 진입 시 입력하는 비밀번호입니다. 기본값은 6363입니다.</p>
    </div>
    <div class="panel-card" style="margin-top:12px">
      <h3>🖥️ 서버 상태</h3>
      <div style="text-align:center;margin:10px 0">현재 상태: ${stateHtml}</div>
      <div class="action-row">
        <button class="primary" onclick="adminSetServerOpen(true)" ${open ? 'disabled' : ''}>서버 열기</button>
        <button class="ghost danger-text" onclick="adminSetServerOpen(false)" ${open ? '' : 'disabled'}>서버 닫기</button>
      </div>
      <p class="muted">서버를 닫으면 학생들이 접속하거나 계속 플레이할 수 없습니다. 수업이 아닌 시간에 닫아 두세요.</p>
    </div>
  </div>`;
}

function buildAdminPanelHtml(tab){
  const tabs = [['students', '👨‍🎓 학생 현황'], ['workbooks', '📚 문제집 관리'], ['settings', '⚙️ 수업 설정']];
  const active = tabs.some(([k]) => k === tab) ? tab : 'students';
  let body = '';
  if (active === 'students') body = teacherStudentsHtml();
  else if (active === 'workbooks') body = teacherWorkbooksHtml();
  else body = teacherSettingsHtml();
  return `
    <h2>🧑‍🏫 교사 대시보드</h2>
    <div class="teacher-tabs">${tabs.map(([k, label]) => `<button class="tab-btn ${active === k ? 'on' : ''}" onclick="openAdminPanel('${k}')">${label}</button>`).join('')}</div>
    ${body}
    <button class="ghost wide" onclick="closeModal()" style="margin-top:14px">닫기</button>
  `;
}

const TEACHER_STORE_KEY = 'ysb_teacher_v1';
let __teacherAuthed = false;

function teacherStore(){
  try {
    const raw = localStorage.getItem(TEACHER_STORE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && typeof p.pw === 'string') {
        // 기존 저장데이터에 serverOpen 필드가 없으면 열림(true)으로 보정
        if (typeof p.serverOpen !== 'boolean') p.serverOpen = true;
        return p;
      }
    }
  } catch {}
  return { pw: '6363', serverOpen: true };
}
function saveTeacherStore(store){
  localStorage.setItem(TEACHER_STORE_KEY, JSON.stringify({
    pw: String(store.pw || '6363'),
    serverOpen: store.serverOpen !== false,
  }));
}

function openTeacherLogin(){
  openModal(`
    <h2>🧑‍🏫 교사 모드</h2>
    <div class="panel-card">
      <label>교사 비밀번호</label>
      <input type="password" id="teacherPw" placeholder="기본값: 6363" onkeydown="if(event.key==='Enter')adminTeacherLogin()" />
    </div>
    <div class="action-row">
      <button class="primary" onclick="adminTeacherLogin()">입장</button>
      <button class="ghost" onclick="closeModal()">취소</button>
    </div>
  `, { type: 'admin', pause: false });
  setTimeout(() => $('teacherPw')?.focus(), 50);
}

function requireTeacherAuth(){
  if (__teacherAuthed) return true;
  openTeacherLogin();
  return false;
}

window.adminTeacherLogin = function adminTeacherLogin(){
  const pw = $('teacherPw')?.value || '';
  const store = teacherStore();
  if (pw !== store.pw) { toast('비밀번호가 틀렸습니다.'); return; }
  __teacherAuthed = true;
  openAdminPanel('students');
};

function openAdminPanel(tab) {
  if (!requireTeacherAuth()) return;
  openModal(buildAdminPanelHtml(tab), { type: 'admin', pause: false });
}

window.addAdminQuestion = function addAdminQuestion() {
  if (!requireTeacherAuth()) return;
  const workbookId = $('adminWorkbook')?.value;
  const q = $('adminQuestion').value.trim();
  const answer = $('adminAnswer').value.trim();
  if (!workbookId) { toast('먼저 문제집을 생성하세요.'); return; }
  if (!q || !answer) { toast('문제와 정답을 모두 입력하세요.'); return; }
  const workbooks = getWorkbooks();
  const wb = workbooks.find((book) => book.id === workbookId);
  if (!wb) { toast('문제집을 찾을 수 없습니다.'); return; }
  const choiceRaw = $('adminChoices')?.value.trim() || '';
  const choices = choiceRaw ? choiceRaw.split(',').map((v) => v.trim()).filter(Boolean).slice(0, 4) : null;
  wb.questions.push({ id: uid(), workbookId: wb.id, zone: wb.zone, q, answer, choices, source: '직접입력' });
  saveWorkbooks(workbooks);
  openAdminPanel('workbooks');
  toast('선택한 문제집에 문제가 추가되었습니다.');
};

window.removeQuestionFromWorkbook = function removeQuestionFromWorkbook(workbookId, questionId) {
  if (!requireTeacherAuth()) return;
  const workbooks = getWorkbooks();
  const wb = workbooks.find((book) => book.id === workbookId);
  if (!wb) return;
  wb.questions = wb.questions.filter((q) => q.id !== questionId);
  saveWorkbooks(workbooks);
  openAdminPanel('workbooks');
  toast('문제를 삭제했습니다.');
};

window.deleteWorkbook = function deleteWorkbook(workbookId) {
  if (!requireTeacherAuth()) return;
  const wb = getWorkbookById(workbookId);
  if (!wb) return;
  if (!confirm(`${wb.name} 문제집을 삭제할까요?`)) return;
  saveWorkbooks(getWorkbooks().filter((book) => book.id !== workbookId));
  openAdminPanel('workbooks');
  toast('문제집을 삭제했습니다.');
};

window.deleteStudentAccount = function deleteStudentAccount(name) {
  if (!requireTeacherAuth()) return;
  if (!confirm(`${name} 계정을 삭제할까요?`)) return;
  deletePlayer(name);
  openAdminPanel();
  toast('학생 계정을 삭제했습니다.');
};

window.grantBuildingToStudent = function grantBuildingToStudent(name) {
  if (!requireTeacherAuth()) return;
  const amount = Math.max(1, parseInt($(`grantBuilding_${name}`)?.value || '1', 10));
  const p = loadPlayer(name);
  if (!p) { toast('학생 계정을 찾을 수 없습니다.'); return; }
  p.building = (p.building || 0) + amount;
  savePlayerRecord(p);
  if (game.player?.name === p.name) game.player = normalizePlayer(p);
  openAdminPanel();
  updateHud();
  toast(`${name}에게 빌딩 ${amount}개를 지급했습니다.`);
};

window.generateAiQuestionSet = function generateAiQuestionSet() {
  if (!requireTeacherAuth()) return;
  const prompt = $('aiPrompt').value.trim();
  if (!prompt) { toast('AI 요청 문장을 입력하세요.'); return; }
  const questions = generateAiQuestions(prompt, 'silent_forest');
  const workbooks = getWorkbooks();
  const index = workbooks.length + 1;
  const name = $('aiWorkbookName').value.trim() || `문제집${index} - ${inferSubject(prompt)} ${questions.length}문제 세트`;
  const id = 'wb_' + uid();
  workbooks.push(normalizeWorkbook({
    id,
    name,
    zone: 'silent_forest',
    subject: inferSubject(prompt),
    prompt,
    createdAt: Date.now(),
    questions: questions.map((q) => ({ ...q, workbookId: id })),
  }));
  saveWorkbooks(workbooks);
  openAdminPanel('workbooks');
  toast(`AI 문제집 "${name}"을 추가했습니다.`);
};

window.adminOpenGrantModal = function adminOpenGrantModal(name){
  if (!requireTeacherAuth()) return;
  openModal(`
    <h2>🎁 보상 지급 — ${escapeHtml(name)}</h2>
    <div class="panel-card">
      <label>골드</label><input type="number" id="grantGold" value="0" min="0" />
      <label>빌딩 화폐</label><input type="number" id="grantBuildingAmt" value="0" min="0" />
      <label>경험치(EXP)</label><input type="number" id="grantExp" value="0" min="0" />
      <p class="muted">수업 태도, 발표, 과제 완료 보상으로 활용하세요.</p>
    </div>
    <div class="action-row">
      <button class="primary" onclick="adminGrantReward('${escapeJs(name)}')">지급하기</button>
      <button class="ghost" onclick="openAdminPanel('students')">취소</button>
    </div>
  `, { type: 'admin', pause: false });
};

window.adminGrantReward = function adminGrantReward(name){
  if (!requireTeacherAuth()) return;
  const p = loadPlayer(name);
  if (!p) { toast('학생 계정을 찾을 수 없습니다.'); return; }
  const gold = Math.max(0, parseInt($('grantGold')?.value || '0', 10) || 0);
  const building = Math.max(0, parseInt($('grantBuildingAmt')?.value || '0', 10) || 0);
  const exp = Math.max(0, parseInt($('grantExp')?.value || '0', 10) || 0);
  p.gold = (p.gold || 0) + gold;
  p.building = (p.building || 0) + building;
  p.exp = (p.exp || 0) + exp;
  savePlayerRecord(p);
  if (game.player?.name === p.name) { game.player = normalizePlayer(p); updateHud(); }
  openAdminPanel('students');
  toast(`${name}에게 지급 완료! (골드 ${gold} / 빌딩 ${building} / EXP ${exp})`);
};

window.adminOpenWrongLog = function adminOpenWrongLog(name){
  if (!requireTeacherAuth()) return;
  const p = loadPlayer(name);
  if (!p) { toast('학생 계정을 찾을 수 없습니다.'); return; }
  const log = (p.records?.wrongLog || []).slice().reverse();
  openModal(`
    <h2>📝 오답 기록 — ${escapeHtml(name)}</h2>
    <div class="teacher-body">
      ${log.length ? `<table class="teacher-table">
        <tr><th>문제</th><th>정답</th><th>학생 답</th></tr>
        ${log.map((w) => `<tr><td>${escapeHtml(w.q || '')}</td><td class="good-text">${escapeHtml(w.a || '')}</td><td class="danger-text">${escapeHtml(w.mine || '')}</td></tr>`).join('')}
      </table>` : '<div class="empty-state">오답 기록이 없습니다.</div>'}
    </div>
    <button class="ghost wide" onclick="openAdminPanel('students')" style="margin-top:14px">돌아가기</button>
  `, { type: 'admin', pause: false });
};

window.adminConfirmDeleteStudent = function adminConfirmDeleteStudent(name){
  if (!requireTeacherAuth()) return;
  openModal(`
    <h2>⚠️ 계정 삭제</h2>
    <div class="panel-card"><p><b>${escapeHtml(name)}</b> 계정을 완전히 삭제할까요? 되돌릴 수 없습니다.</p></div>
    <div class="action-row">
      <button class="ghost danger-text" onclick="deleteStudentAccount('${escapeJs(name)}')">삭제한다</button>
      <button class="ghost" onclick="openAdminPanel('students')">취소</button>
    </div>
  `, { type: 'admin', pause: false });
};

window.adminToggleWorkbook = function adminToggleWorkbook(workbookId){
  if (!requireTeacherAuth()) return;
  const workbooks = getWorkbooks();
  const wb = workbooks.find((w) => w.id === workbookId);
  if (!wb) return;
  wb.enabled = wb.enabled === false ? true : false;
  saveWorkbooks(workbooks);
  toast(wb.enabled === false ? `『${wb.name}』 출제를 껐습니다.` : `『${wb.name}』 출제를 켰습니다!`);
  openAdminPanel('workbooks');
};

window.adminBulkImport = function adminBulkImport(){
  if (!requireTeacherAuth()) return;
  const workbookId = $('adminWorkbook')?.value;
  if (!workbookId) { toast('먼저 문제집을 선택하세요.'); return; }
  const raw = ($('adminBulk')?.value || '').trim();
  if (!raw) { toast('등록할 문제를 입력하세요.'); return; }
  const workbooks = getWorkbooks();
  const wb = workbooks.find((book) => book.id === workbookId);
  if (!wb) { toast('문제집을 찾을 수 없습니다.'); return; }
  let added = 0;
  for (const line of raw.split('\n')) {
    const idx = line.lastIndexOf('=');
    if (idx < 1) continue;
    const q = line.slice(0, idx).trim();
    const answer = line.slice(idx + 1).trim();
    if (!q || !answer) continue;
    wb.questions.push({ id: uid(), workbookId: wb.id, zone: wb.zone, q, answer, choices: null, source: '일괄등록' });
    added += 1;
  }
  saveWorkbooks(workbooks);
  openAdminPanel('workbooks');
  toast(`${added}개 문제를 추가했습니다.`);
};

window.adminSaveTeacherSettings = function adminSaveTeacherSettings(){
  if (!requireTeacherAuth()) return;
  const newPw = ($('teacherNewPw')?.value || '').trim();
  if (!newPw) { toast('새 비밀번호를 입력하세요.'); return; }
  const store = teacherStore();
  store.pw = newPw;
  saveTeacherStore(store);
  openAdminPanel('settings');
  toast('교사 비밀번호를 변경했습니다.');
};

// ── 서버 오픈/닫기 상태 ─────────────────────────────────────────
function isServerOpen(){
  // 기존 저장데이터에 serverOpen 필드가 없으면 열림(true)으로 간주
  const store = teacherStore();
  return store.serverOpen !== false;
}

window.adminSetServerOpen = function adminSetServerOpen(open){
  if (!requireTeacherAuth()) return;
  const store = teacherStore();
  store.serverOpen = !!open;
  saveTeacherStore(store);
  openAdminPanel('settings');
  toast(open ? '🟢 서버를 열었습니다. 학생들이 접속할 수 있어요.' : '🔴 서버를 닫았습니다. 학생 접속이 차단됩니다.');
};

// 플레이 중 서버가 닫히면 학생을 랜딩 화면으로 내보낸다 (교사 인증 세션은 예외)
setInterval(() => {
  try {
    if (isServerOpen()) return;
    if (typeof __teacherAuthed !== 'undefined' && __teacherAuthed) return;
    if (typeof game === 'undefined' || !game || !game.player) return;
    if (typeof savePlayer === 'function') savePlayer();
    game.player = null;
    game.currentMap = 'town';
    if (typeof showScreen === 'function') showScreen('landing');
    if (typeof toast === 'function') toast('선생님이 서버를 닫았습니다. 다음 시간에 만나요!');
  } catch (e) {}
}, 30000);
