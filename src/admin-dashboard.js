/*
 * admin-dashboard.js — 교사 대시보드 & 서버 오픈/닫기
 * game.js에서 분리된 교사 전용 모듈. 클래식 스크립트로 로드되어 최상위 함수가 window에 노출된다.
 * (index.html에서 game.js 다음 줄에 로드됨 — game.js의 유틸/전역보다 늦게 실행)
 * 공용 유틸(escapeHtml, escapeJs, fmtDate 등)과 game 객체는 game.js에 남아 있으며 호출 시점에 늦은 바인딩으로 참조한다.
 */

const SECURE_ADMIN_MODE_V2 = window.YUKSAM_CLOUD?.securityV2Enabled === true;
let secureAdminAuthV2 = null;
let secureAdminDataV2 = null;
let secureAdminSharedV2 = null;
let secureAdminStudentsV2 = [];
let secureAdminStudentsStatusV2 = 'idle';
let secureAdminStudentsErrorV2 = '';
let secureAdminMutationV2 = false;
const checkedAdminStudentsV2 = new Set();
// [v59] 문제집 화면을 다시 그려도 펼친 목록·수정 중인 문제·직전 등록 결과를 잃지 않게 보존
const openWorkbookDetailsV2 = new Set();
let editingWorkbookQuestionV2 = null;
let workbookImportReportV2 = null;
let workbookToolV2 = 'direct';
let selectedWorkbookV2 = '';
const checkedWorkbookQuestionsV2 = new Set();
let secureAdminWorkbookRefreshV2 = false;
let secureAdminWorkbookSyncedAtV2 = 0;
let secureAdminCheatPendingV3 = false;
const CHEAT_ENABLED_KEY_V2 = 'ysb_teacher_cheat_enabled_v2';
window.__cheatEnabledV54 = false;
const initialCheatClusterV2 = document.getElementById('cheatCluster');
if (initialCheatClusterV2) initialCheatClusterV2.style.display = 'none';

function setTeacherCheatUiV3(enabled) {
  window.__cheatEnabledV54 = Boolean(enabled);
  try { sessionStorage.setItem(CHEAT_ENABLED_KEY_V2, enabled ? '1' : '0'); } catch {}
  const cluster = document.getElementById('cheatCluster');
  if (cluster) cluster.style.display = enabled ? 'flex' : 'none';
  if (!enabled) {
    const panel = document.getElementById('cheatPanel');
    if (panel) panel.classList.add('hidden');
  }
}

if (SECURE_ADMIN_MODE_V2) {
  const secureAdminUrlV2 = String(window.YUKSAM_CLOUD?.url || '')
    .trim()
    .replace(/\/rest\/v1\/?$/i, '')
    .replace(/\/+$/, '');
  const secureAdminAnonKeyV2 = String(window.YUKSAM_CLOUD?.anonKey || '').trim();
  if (secureAdminUrlV2 && secureAdminAnonKeyV2
    && window.YuksamSupabaseClient?.createClient
    && window.YuksamAdminAuthV2?.create
    && window.YuksamAuthV2?.normalizeStudentName) {
    const secureAdminClientV2 = window.YuksamSupabaseClient.createClient(
      secureAdminUrlV2,
      secureAdminAnonKeyV2,
      {
        auth:{
          storageKey:'ysb_teacher_auth_v2',
          persistSession:true,
          autoRefreshToken:true,
          detectSessionInUrl:false,
        },
      },
    );
    secureAdminAuthV2 = window.YuksamAdminAuthV2.create({
      client:secureAdminClientV2,
      normalizeStudentName:window.YuksamAuthV2.normalizeStudentName,
    });
    if (window.YuksamAdminDataV2?.create && typeof secureAdminClientV2.from === 'function') {
      secureAdminDataV2 = window.YuksamAdminDataV2.create({ client:secureAdminClientV2 });
    }
    if (window.YuksamSharedStateV2?.create && typeof secureAdminClientV2.from === 'function') {
      secureAdminSharedV2 = window.YuksamSharedStateV2.create({
        client:secureAdminClientV2,
        storage:localStorage,
        defaultWorkbooks,
      });
    }
  }
}

window.adminApplyCurrentStudentCheatV3 = async function adminApplyCurrentStudentCheatV3(action) {
  if (secureAdminCheatPendingV3) return;
  const identity = window.getPvpIdentityV1?.();
  if (!identity?.userId) {
    toast('먼저 학생 캐릭터로 로그인해 주세요.');
    return;
  }
  if (!requireTeacherAuth() || !secureAdminDataV2?.applyStudentCheat) return;
  secureAdminCheatPendingV3 = true;
  try {
    await window.flushLocalPlayerForPvpV1?.();
    const result = await secureAdminDataV2.applyStudentCheat(identity.userId, action);
    if (!window.applyAuthoritySnapshotFromServerV3?.(result.snapshot)) {
      throw new Error('서버 캐릭터 정보를 적용하지 못했어요.');
    }
    const labels = {
      exp20:'EXP +20',
      exp100:'EXP +100',
      gold3000:'Gold +3000',
      building200:'빌딩 +200',
      heal:'HP 100% 회복',
    };
    toast(`테스트: ${labels[action] || '치트 적용 완료'}`);
    appendChatMessage?.('system', '테스트', labels[action] || '치트 적용 완료');
  } catch (error) {
    toast(error?.message || '서버 치트를 적용하지 못했어요.');
  } finally {
    secureAdminCheatPendingV3 = false;
  }
};

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
  if (SECURE_ADMIN_MODE_V2) {
    let studentContent = '';
    if (!secureAdminDataV2) {
      studentContent = '<div class="empty-state danger-text">클라우드 학생 관리 설정을 확인해 주세요.</div>';
    } else if (secureAdminStudentsStatusV2 === 'loading' || secureAdminStudentsStatusV2 === 'idle') {
      studentContent = '<div class="empty-state" id="secureAdminLoading">학생 목록을 불러오는 중...</div>';
    } else if (secureAdminStudentsStatusV2 === 'error') {
      studentContent = `<div class="empty-state danger-text">${escapeHtml(secureAdminStudentsErrorV2 || '학생 목록을 불러오지 못했어요.')}
        <button class="ghost" onclick="adminRetryStudentListV2()">다시 시도</button></div>`;
    } else if (!secureAdminStudentsV2.length) {
      studentContent = '<div class="empty-state">등록된 학생 계정이 없습니다.</div>';
    } else {
      const rows = secureAdminStudentsV2.map((student) => {
        const classMeta = CLASS_META[student.className] || { name:student.className || '미정' };
        const spec = student.spec ? ` <small class="muted">${escapeHtml(student.spec)}</small>` : '';
        return `<tr data-user-id="${escapeHtml(student.userId)}">
          <td><input type="checkbox" aria-label="${escapeHtml(student.displayName)} 계정 선택"
            ${checkedAdminStudentsV2.has(student.userId) ? 'checked' : ''}
            onchange="adminToggleStudentSelectionV2('${student.userId}',this.checked)"></td>
          <td><b>${escapeHtml(student.displayName)}</b></td>
          <td>${escapeHtml(classMeta.name || '')}${spec}</td>
          <td>Lv.${student.level}</td>
          <td>${fmtAcc(student.records)}</td>
          <td>${student.gold}</td>
          <td>${student.building}</td>
          <td class="muted">${fmtDate(student.updatedAt)}</td>
          <td class="t-actions">
            <button class="primary tiny" onclick="adminOpenGrantModalV2('${student.userId}')">보상</button>
            <button class="ghost tiny" onclick="adminOpenWrongLogV2('${student.userId}')">오답</button>
            <button class="ghost tiny" onclick="adminOpenResetPasswordV2('${student.userId}')">비밀번호 재설정</button>
            <button class="ghost tiny danger-text" onclick="adminConfirmDeleteStudentV2('${student.userId}')">계정 삭제</button>
          </td>
        </tr>`;
      }).join('');
      studentContent = `<div class="teacher-body">
        <div class="workbook-bulk-actions">
          <button class="ghost tiny" onclick="adminSelectAllStudentsV2(true)">전체 선택</button>
          <button class="ghost tiny" onclick="adminSelectAllStudentsV2(false)">선택 해제</button>
          <button class="ghost tiny danger-text" ${checkedAdminStudentsV2.size ? '' : 'disabled'}
            onclick="adminConfirmDeleteSelectedStudentsV2()">선택 계정 삭제 (${checkedAdminStudentsV2.size})</button>
        </div>
        <table class="teacher-table"><thead><tr><th>선택</th><th>이름</th><th>직업</th><th>레벨</th><th>정답률</th><th>골드</th><th>빌딩</th><th>최근 저장</th><th>관리</th></tr></thead>
        <tbody id="secureAdminStudentRows">${rows}</tbody></table>
      </div>`;
    }
    return `<div class="teacher-body">
      <p class="muted">보상은 안전하게 보관되며 학생의 다음 로그인 또는 새로고침 때 적용됩니다.</p>
      ${studentContent}
    </div>`;
  }
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

function teacherQuestionRowHtml(wb, q, qi){
  const selectionKey = `${wb.id}:${q.id}`;
  const checked = checkedWorkbookQuestionsV2.has(selectionKey);
  const editing = editingWorkbookQuestionV2
    && editingWorkbookQuestionV2.workbookId === wb.id
    && editingWorkbookQuestionV2.questionId === q.id;
  if (!editing) {
    return `<tr>
      <td class="workbook-question-number"><input type="checkbox" ${checked ? 'checked' : ''} aria-label="${qi + 1}번 문제 선택" onchange="adminToggleWorkbookQuestion('${escapeJs(wb.id)}','${escapeJs(q.id)}',this.checked)"> <span>${qi + 1}</span></td>
      <td>${escapeHtml(q.q)}</td>
      <td class="good-text">${escapeHtml(q.answer)}</td>
      <td class="t-actions">
        <button class="ghost tiny" onclick="startEditWorkbookQuestion('${escapeJs(wb.id)}', '${escapeJs(q.id)}')">수정</button>
        <button class="ghost tiny danger-text" onclick="removeQuestionFromWorkbook('${escapeJs(wb.id)}', '${escapeJs(q.id)}')">삭제</button>
      </td>
    </tr>`;
  }
  const choiceText = Array.isArray(q.choices) ? q.choices.join(', ') : '';
  return `<tr>
    <td class="workbook-question-number"><input type="checkbox" ${checked ? 'checked' : ''} aria-label="${qi + 1}번 문제 선택" onchange="adminToggleWorkbookQuestion('${escapeJs(wb.id)}','${escapeJs(q.id)}',this.checked)"> <span>${qi + 1}</span></td>
    <td colspan="2">
      <input id="editQuestionText" value="${escapeHtml(q.q)}" placeholder="문제" />
      <input id="editQuestionAnswer" value="${escapeHtml(q.answer)}" placeholder="정답" />
      <input id="editQuestionChoices" value="${escapeHtml(choiceText)}" placeholder="보기 4개 (쉼표로 구분, 비우면 자동 생성)" />
    </td>
    <td class="t-actions">
      <button class="primary tiny" onclick="saveEditWorkbookQuestion()">저장</button>
      <button class="ghost tiny" onclick="cancelEditWorkbookQuestion()">취소</button>
    </td>
  </tr>`;
}

function workbookImportReportHtml(){
  if (!workbookImportReportV2) return '';
  const { added, skipped } = workbookImportReportV2;
  const skippedRows = skipped.slice(0, 20).map((item) => `
    <tr><td>${item.line}줄</td><td>${escapeHtml(item.text || '')}</td><td class="danger-text">${escapeHtml(item.reason)}</td></tr>
  `).join('');
  return `<div class="panel-card" style="margin-top:12px">
    <h3>표 등록 결과</h3>
    <p><b class="good-text">${added}개</b> 추가${skipped.length ? ` · <b class="danger-text">${skipped.length}개</b> 건너뜀` : ''}</p>
    ${skipped.length ? `<table class="teacher-table" style="margin-top:8px">
      <tr><th>위치</th><th>내용</th><th>건너뛴 이유</th></tr>
      ${skippedRows}
    </table>${skipped.length > 20 ? `<p class="muted">외 ${skipped.length - 20}줄 더 있습니다.</p>` : ''}` : ''}
    <button class="ghost wide" onclick="adminClearImportReport()" style="margin-top:8px">결과 지우기</button>
  </div>`;
}

function teacherWorkbooksHtml(){
  const workbooks = SECURE_ADMIN_MODE_V2 && secureAdminSharedV2
    ? secureAdminSharedV2.getWorkbooks()
    : getWorkbooks();
  if (!workbooks.some((wb) => wb.id === selectedWorkbookV2)) selectedWorkbookV2 = workbooks[0]?.id || '';
  const workbookOptions = workbooks.map((wb) => (
    `<option value="${wb.id}" ${wb.id === selectedWorkbookV2 ? 'selected' : ''}>${escapeHtml(wb.name)} (${wb.questions.length}문제)</option>`
  )).join('');
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
      <details ${openWorkbookDetailsV2.has(wb.id) ? 'open' : ''} ontoggle="adminTrackWorkbookDetails('${escapeJs(wb.id)}', this.open)">
        <summary>문제 보기 / 수정 / 삭제</summary>
        <div class="workbook-bulk-actions">
          <button class="ghost tiny" onclick="adminSelectAllWorkbookQuestions('${escapeJs(wb.id)}', true)">전체 선택</button>
          <button class="ghost tiny" onclick="adminSelectAllWorkbookQuestions('${escapeJs(wb.id)}', false)">선택 해제</button>
          <button class="ghost tiny danger-text" onclick="adminDeleteSelectedWorkbookQuestions('${escapeJs(wb.id)}')">선택한 문제 삭제 (${wb.questions.filter((q) => checkedWorkbookQuestionsV2.has(`${wb.id}:${q.id}`)).length})</button>
        </div>
        <table class="teacher-table" style="margin-top:8px">
          <tr><th>선택 · #</th><th>문제</th><th>정답</th><th></th></tr>
          ${wb.questions.length ? wb.questions.map((q, qi) => teacherQuestionRowHtml(wb, q, qi)).join('') : '<tr><td colspan="4" class="muted">문제가 없습니다.</td></tr>'}
        </table>
      </details>
    </div>
  `).join('') : '<div class="empty-state">등록된 문제집이 없습니다.</div>';

  const tools = {
    direct:`<div class="panel-card workbook-tool-panel">
      <h3>문제 직접 추가</h3>
      <div class="wb-new-row">
        <input id="adminQuestion" placeholder="예: 24 ÷ 6 = ?" />
        <input id="adminAnswer" placeholder="정답" style="max-width:140px" />
        <button class="primary" onclick="addAdminQuestion()">추가</button>
      </div>
      <label>객관식 보기 4개 (선택사항)</label>
      <input id="adminChoices" placeholder="예: 2, 3, 4, 5" />
    </div>`,
    bulk:`<div class="panel-card workbook-tool-panel">
      <h3>여러 문제 한 번에 등록</h3>
      <textarea id="adminBulk" rows="4" placeholder="한 줄에 하나씩:  문제 = 정답&#10;예)&#10;7 × 8 = ? = 56&#10;대한민국의 수도는? = 서울"></textarea>
      <button class="ghost wide" onclick="adminBulkImport()">붙여넣은 문제 모두 추가</button>
      <p class="muted">마지막 "=" 뒤가 정답으로 인식됩니다.</p>
    </div>`,
    table:`<div class="panel-card workbook-tool-panel">
      <h3>엑셀 · CSV로 문제 추가</h3>
      <p class="muted">위에서 고른 문제집에 들어갑니다.</p>
      <label>① 엑셀에서 칸을 드래그해 복사(Ctrl+C)한 뒤, 아래에 붙여넣기(Ctrl+V)</label>
      <textarea id="adminImportTable" rows="5" placeholder="문제&#9;정답&#10;7 × 8 = ?&#9;56&#10;대한민국의 수도는?&#9;서울&#9;부산&#9;대구&#9;광주"></textarea>
      <label>② 또는 CSV 파일 선택</label>
      <input type="file" id="adminImportFile" accept=".csv,.tsv,.txt,text/csv,text/plain" onchange="adminImportTableFile(this)" />
      <button class="primary wide" onclick="adminImportTable()" style="margin-top:8px">표에서 문제 추가</button>
      <p class="muted">두 칸(문제·정답)이면 보기는 게임이 자동으로 만들어 줍니다.
        여섯 칸(문제·정답·보기4개)이면 적어주신 보기를 그대로 씁니다. 첫 줄이 제목줄이면 알아서 건너뜁니다.</p>
    </div>`,
    ai:`<div class="panel-card workbook-tool-panel">
      <h3>ChatGPT로 문제 만들기</h3>
      <p class="muted">아래 버튼으로 문장을 복사해 ChatGPT에 붙여넣고, 나온 결과를 위 "엑셀 · CSV로 문제 추가" 칸에 붙여넣으면 됩니다.</p>
      <label>주제</label>
      <input id="chatGptTopic" placeholder="예: 초등학교 5학년 수학, 분수의 덧셈" />
      <label>문제 수 (최대 20개)</label>
      <input id="chatGptCount" type="number" min="1" max="20" value="20" style="max-width:140px" />
      <button class="primary wide" onclick="copyChatGptPrompt()" style="margin-top:8px">ChatGPT에 넣을 문장 복사</button>
      <textarea id="chatGptPromptBox" rows="4" readonly class="hidden" style="margin-top:8px"></textarea>
    </div>`,
  };
  const toolButtons = [
    ['direct', '문제 직접 추가'],
    ['bulk', '여러 문제 등록'],
    ['table', '엑셀 · CSV'],
    ['ai', 'ChatGPT로 만들기'],
  ];

  return `<div class="teacher-body">
    <h3>내 문제집</h3>
    ${SECURE_ADMIN_MODE_V2 ? `<p class="workbook-sync-state">${secureAdminWorkbookSyncedAtV2 ? '🟢 서버 문제집과 동기화됨' : '🔄 서버 문제집 확인 중'}</p>` : ''}
    <div>${cards}</div>
    <div class="panel-card workbook-tools-wrap" style="margin-top:12px">
      <h3>문제 추가 도구</h3>
      <label>추가할 문제집</label>
      <select id="adminWorkbook" onchange="adminRememberWorkbook(this.value)">${workbookOptions || '<option value="">문제집 없음</option>'}</select>
      <div class="workbook-tool-tabs">
        ${toolButtons.map(([key, label]) => `<button class="${workbookToolV2 === key ? 'primary' : 'ghost'}" onclick="adminOpenWorkbookTool('${key}')">${label}</button>`).join('')}
      </div>
    </div>
    ${Object.entries(tools).map(([key, html]) => `<div class="${workbookToolV2 === key ? '' : 'hidden'}" data-workbook-tool="${key}">${html}</div>`).join('')}
    ${workbookImportReportHtml()}
  </div>`;
}

window.adminRememberWorkbook = function adminRememberWorkbook(workbookId){
  selectedWorkbookV2 = String(workbookId || '');
};

window.adminOpenWorkbookTool = function adminOpenWorkbookTool(tool){
  if (!['direct', 'bulk', 'table', 'ai'].includes(tool)) return;
  selectedWorkbookV2 = $('adminWorkbook')?.value || selectedWorkbookV2;
  workbookToolV2 = tool;
  openAdminPanel('workbooks', { keepScroll:true });
};

window.adminToggleWorkbookQuestion = function adminToggleWorkbookQuestion(workbookId, questionId, checked){
  const key = `${workbookId}:${questionId}`;
  if (checked) checkedWorkbookQuestionsV2.add(key);
  else checkedWorkbookQuestionsV2.delete(key);
  openWorkbookDetailsV2.add(workbookId);
  openAdminPanel('workbooks', { keepScroll:true, skipWorkbookRefresh:true });
};

window.adminSelectAllWorkbookQuestions = function adminSelectAllWorkbookQuestions(workbookId, checked){
  const workbook = getAdminWorkbooksV2().find((book) => book.id === workbookId);
  if (!workbook) return;
  workbook.questions.forEach((question) => {
    const key = `${workbookId}:${question.id}`;
    if (checked) checkedWorkbookQuestionsV2.add(key);
    else checkedWorkbookQuestionsV2.delete(key);
  });
  openWorkbookDetailsV2.add(workbookId);
  openAdminPanel('workbooks', { keepScroll:true, skipWorkbookRefresh:true });
};

window.adminDeleteSelectedWorkbookQuestions = async function adminDeleteSelectedWorkbookQuestions(workbookId){
  if (!requireTeacherAuth()) return;
  const workbooks = getAdminWorkbooksV2().map((book) => ({ ...book, questions:[...book.questions] }));
  const workbook = workbooks.find((book) => book.id === workbookId);
  if (!workbook) return;
  const selected = workbook.questions.filter((question) => checkedWorkbookQuestionsV2.has(`${workbookId}:${question.id}`));
  if (!selected.length) { toast('삭제할 문제를 먼저 선택하세요.'); return; }
  if (!confirm(`선택한 문제 ${selected.length}개를 한 번에 삭제할까요?`)) return;
  const selectedIds = new Set(selected.map((question) => question.id));
  workbook.questions = workbook.questions.filter((question) => !selectedIds.has(question.id));
  if (!(await saveAdminWorkbooksV2(workbooks))) return;
  selected.forEach((question) => checkedWorkbookQuestionsV2.delete(`${workbookId}:${question.id}`));
  openWorkbookDetailsV2.add(workbookId);
  openAdminPanel('workbooks', { keepScroll:true, skipWorkbookRefresh:true });
  toast(`문제 ${selected.length}개를 삭제하고 서버 문제집에 반영했습니다.`);
};

function teacherCheatCardHtml(){
  return `<div class="panel-card" style="margin-top:12px">
    <h3>🧪 치트(테스트) 도구</h3>
    <div style="text-align:center;margin:10px 0">현재: ${window.__cheatEnabledV54 ? '<span class="good-text" style="font-weight:800">🟢 활성화됨</span>' : '<span class="muted" style="font-weight:800">⚪ 비활성</span>'}</div>
    <div class="action-row">
      <button class="primary" onclick="adminSetCheatEnabled(true)" ${window.__cheatEnabledV54 ? 'disabled' : ''}>치트 활성화</button>
      <button class="ghost danger-text" onclick="adminSetCheatEnabled(false)" ${window.__cheatEnabledV54 ? '' : 'disabled'}>치트 비활성</button>
    </div>
    <p class="muted">활성화하면 화면 왼쪽에 치트 꾸러미(EXP·Gold·빌딩·즉시처치 등)가 나타납니다. 이 브라우저에서 관리자 테스트를 할 때만 사용하세요.</p>
  </div>`;
}

function teacherSettingsHtml(){
  if (SECURE_ADMIN_MODE_V2) {
    const open = secureAdminSharedV2 ? secureAdminSharedV2.getServerOpen() : true;
    return `<div class="teacher-body">
      <div class="panel-card">
        <h3>관리자 비밀번호 변경</h3>
        <input type="password" id="teacherNewPw" autocomplete="new-password" placeholder="새 비밀번호 (6자 이상)" />
        <button class="primary wide" onclick="adminSaveTeacherSettings()">내 비밀번호 바꾸기</button>
      </div>
      <div class="panel-card" style="margin-top:12px">
        <h3>수업 서버 상태</h3>
        <p style="text-align:center;font-weight:800">${open ? '🟢 열림' : '🔴 닫힘'}</p>
        <div class="action-row">
          <button class="primary" onclick="adminSetServerOpen(true)" ${open ? 'disabled' : ''}>서버 열기</button>
          <button class="ghost danger-text" onclick="adminSetServerOpen(false)" ${open ? '' : 'disabled'}>서버 닫기</button>
        </div>
        <p class="muted">변경 내용은 학생 화면에 약 15초 안에 반영됩니다.</p>
      </div>
      ${teacherCheatCardHtml()}
      <button class="ghost wide" onclick="adminTeacherLogout()" style="margin-top:12px">관리자 로그아웃</button>
    </div>`;
  }
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
    ${teacherCheatCardHtml()}
  </div>`;
}

window.adminSetCheatEnabled = async function adminSetCheatEnabled(on){
  if (on) {
    try {
      if (!secureAdminAuthV2) throw new Error('관리자 연결 설정을 확인해 주세요.');
      await secureAdminAuthV2.requireTeacher();
      __teacherAuthed = true;
    } catch (error) {
      setTeacherCheatUiV3(false);
      __teacherAuthed = false;
      toast(error?.message || '교사 계정으로 로그인해야 치트를 사용할 수 있어요.');
      openTeacherLogin();
      return;
    }
  }
  setTeacherCheatUiV3(Boolean(on));
  if (typeof openAdminPanel === 'function') openAdminPanel('settings');
};

window.requireTeacherCheatAccessV3 = async function requireTeacherCheatAccessV3() {
  try {
    if (!SECURE_ADMIN_MODE_V2 || !secureAdminAuthV2) throw new Error('FORBIDDEN');
    await secureAdminAuthV2.requireTeacher();
    __teacherAuthed = true;
    return true;
  } catch (_) {
    setTeacherCheatUiV3(false);
    __teacherAuthed = false;
    toast('교사 계정으로 로그인해야 치트를 사용할 수 있어요.');
    return false;
  }
};

function buildAdminPanelHtml(tab){
  const tabs = SECURE_ADMIN_MODE_V2
    ? [['students', '👨‍🎓 학생 관리'], ['workbooks', '📚 문제집 관리'], ['settings', '⚙️ 수업 설정']]
    : [['students', '👨‍🎓 학생 현황'], ['workbooks', '📚 문제집 관리'], ['settings', '⚙️ 수업 설정']];
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

if (SECURE_ADMIN_MODE_V2 && secureAdminAuthV2) {
  secureAdminAuthV2.restore()
    .then((identity) => {
      __teacherAuthed = Boolean(identity);
      let restoreCheat = false;
      try { restoreCheat = sessionStorage.getItem(CHEAT_ENABLED_KEY_V2) === '1'; } catch {}
      setTeacherCheatUiV3(Boolean(identity) && restoreCheat);
    })
    .catch(() => {
      __teacherAuthed = false;
      setTeacherCheatUiV3(false);
    });
}

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
  if (SECURE_ADMIN_MODE_V2) {
    const unavailable = !secureAdminAuthV2;
    openModal(`
      <h2>🧑‍🏫 관리자 로그인</h2>
      <div class="panel-card">
        <label>관리자 이메일</label>
        <input type="email" id="teacherEmail" autocomplete="username" placeholder="관리자 이메일" ${unavailable ? 'disabled' : ''} />
        <label>관리자 비밀번호</label>
        <input type="password" id="teacherPw" autocomplete="current-password" placeholder="관리자 비밀번호" onkeydown="if(event.key==='Enter')adminTeacherLogin()" ${unavailable ? 'disabled' : ''} />
        ${unavailable ? '<p class="danger-text">보안 관리자 연결 설정을 확인해 주세요.</p>' : ''}
      </div>
      <div class="action-row">
        <button class="primary" id="teacherLoginBtn" onclick="adminTeacherLogin()" ${unavailable ? 'disabled' : ''}>로그인</button>
        <button class="ghost" onclick="closeModal()">취소</button>
      </div>
    `, { type:'admin', pause:false });
    setTimeout(() => $('teacherEmail')?.focus(), 50);
    return;
  }
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

window.adminTeacherLogin = async function adminTeacherLogin(){
  if (SECURE_ADMIN_MODE_V2) {
    if (!secureAdminAuthV2) { toast('관리자 연결 설정을 확인해 주세요.'); return; }
    const email = $('teacherEmail')?.value || '';
    const pw = $('teacherPw')?.value || '';
    const button = $('teacherLoginBtn');
    if (button) { button.disabled = true; button.textContent = '확인 중...'; }
    try {
      await secureAdminAuthV2.signIn(email, pw);
      if (secureAdminSharedV2) {
        await Promise.all([
          secureAdminSharedV2.refreshClassroomSettings(),
          secureAdminSharedV2.refreshWorkbooks(),
        ]);
      }
      __teacherAuthed = true;
      openAdminPanel('students');
    } catch (error) {
      __teacherAuthed = false;
      toast(error?.message || '관리자 로그인을 확인하지 못했어요.');
      if (button) { button.disabled = false; button.textContent = '로그인'; }
    }
    return;
  }
  const pw = $('teacherPw')?.value || '';
  const store = teacherStore();
  if (pw !== store.pw) { toast('비밀번호가 틀렸습니다.'); return; }
  __teacherAuthed = true;
  openAdminPanel('students');
};

window.adminTeacherLogout = async function adminTeacherLogout(){
  if (SECURE_ADMIN_MODE_V2 && secureAdminAuthV2) {
    try { await secureAdminAuthV2.signOut(); }
    catch (error) { toast(error?.message || '로그아웃하지 못했어요.'); return; }
  }
  __teacherAuthed = false;
  setTeacherCheatUiV3(false);
  openTeacherLogin();
};

window.adminResetStudentPassword = async function adminResetStudentPassword(){
  if (!SECURE_ADMIN_MODE_V2 || !requireTeacherAuth() || !secureAdminAuthV2) return;
  const studentName = $('secureAdminStudentName')?.value || '';
  const newPassword = $('secureAdminStudentPw')?.value || '';
  try {
    const result = await secureAdminAuthV2.resetStudentPassword(studentName, newPassword);
    const passwordInput = $('secureAdminStudentPw');
    if (passwordInput) passwordInput.value = '';
    toast(`${result.displayName} 학생의 비밀번호를 바꿨어요.`);
  } catch (error) {
    toast(error?.message || '학생 비밀번호를 바꾸지 못했어요.');
  }
};

function secureAdminStudentByIdV2(userId){
  return secureAdminStudentsV2.find((student) => student.userId === userId) || null;
}

async function loadSecureAdminStudentsV2(){
  if (!SECURE_ADMIN_MODE_V2 || !secureAdminDataV2 || secureAdminStudentsStatusV2 === 'loading') return;
  secureAdminStudentsStatusV2 = 'loading';
  secureAdminStudentsErrorV2 = '';
  try {
    secureAdminStudentsV2 = await secureAdminDataV2.listStudents();
    secureAdminStudentsStatusV2 = 'ready';
  } catch (error) {
    secureAdminStudentsV2 = [];
    secureAdminStudentsStatusV2 = 'error';
    secureAdminStudentsErrorV2 = error?.message || '학생 목록을 불러오지 못했어요.';
  }
  if (__teacherAuthed) openAdminPanel('students', { skipSecureLoad:true });
}

window.adminRetryStudentListV2 = function adminRetryStudentListV2(){
  if (!SECURE_ADMIN_MODE_V2 || !requireTeacherAuth()) return;
  secureAdminStudentsStatusV2 = 'idle';
  openAdminPanel('students');
};

window.adminOpenWrongLogV2 = function adminOpenWrongLogV2(userId){
  if (!SECURE_ADMIN_MODE_V2 || !requireTeacherAuth()) return;
  const student = secureAdminStudentByIdV2(userId);
  if (!student) { toast('학생 계정을 찾지 못했어요.'); return; }
  const log = student.records.wrongLog.slice().reverse();
  openModal(`
    <h2>📝 오답 기록 · ${escapeHtml(student.displayName)}</h2>
    <div class="teacher-body">
      ${log.length ? `<table class="teacher-table"><tr><th>문제</th><th>정답</th><th>학생 답</th></tr>
        ${log.map((entry) => `<tr><td>${escapeHtml(entry.q)}</td><td class="good-text">${escapeHtml(entry.a)}</td><td class="danger-text">${escapeHtml(entry.mine)}</td></tr>`).join('')}
      </table>` : '<div class="empty-state">오답 기록이 없습니다.</div>'}
    </div>
    <button class="ghost wide" onclick="openAdminPanel('students')">돌아가기</button>
  `, { type:'admin', pause:false });
};

window.adminOpenGrantModalV2 = function adminOpenGrantModalV2(userId){
  if (!SECURE_ADMIN_MODE_V2 || !requireTeacherAuth()) return;
  const student = secureAdminStudentByIdV2(userId);
  if (!student) { toast('학생 계정을 찾지 못했어요.'); return; }
  openModal(`
    <h2>🎁 보상 지급 · ${escapeHtml(student.displayName)}</h2>
    <div class="panel-card">
      <label>골드</label><input type="number" id="grantGoldV2" value="0" min="0" max="1000000" />
      <label>빌딩 재료</label><input type="number" id="grantBuildingV2" value="0" min="0" max="1000000" />
      <label>경험치 (EXP)</label><input type="number" id="grantExpV2" value="0" min="0" max="1000000" />
      <p class="muted">보상은 학생의 다음 로그인 또는 새로고침 때 안전하게 적용됩니다.</p>
    </div>
    <div class="action-row">
      <button class="primary" id="grantRewardV2Btn" onclick="adminGrantRewardV2('${userId}')">지급하기</button>
      <button class="ghost" onclick="openAdminPanel('students')">취소</button>
    </div>
  `, { type:'admin', pause:false });
};

window.adminGrantRewardV2 = async function adminGrantRewardV2(userId){
  if (!SECURE_ADMIN_MODE_V2 || !requireTeacherAuth() || !secureAdminDataV2 || secureAdminMutationV2) return;
  const reward = {
    gold:Number($('grantGoldV2')?.value || 0),
    building:Number($('grantBuildingV2')?.value || 0),
    exp:Number($('grantExpV2')?.value || 0),
  };
  const button = $('grantRewardV2Btn');
  secureAdminMutationV2 = true;
  if (button) { button.disabled = true; button.textContent = '저장 중...'; }
  try {
    const result = await secureAdminDataV2.grantReward(userId, reward);
    openAdminPanel('students');
    toast(`${result.displayName} 학생의 보상을 보관했어요. 다음 로그인 때 적용됩니다.`);
  } catch (error) {
    toast(error?.message || '학생 보상을 저장하지 못했어요.');
    if (button) { button.disabled = false; button.textContent = '지급하기'; }
  } finally {
    secureAdminMutationV2 = false;
  }
};

window.adminOpenResetPasswordV2 = function adminOpenResetPasswordV2(userId){
  if (!SECURE_ADMIN_MODE_V2 || !requireTeacherAuth()) return;
  const student = secureAdminStudentByIdV2(userId);
  if (!student) { toast('학생 계정을 찾지 못했어요.'); return; }
  openModal(`
    <h2>🔑 비밀번호 재설정 · ${escapeHtml(student.displayName)}</h2>
    <input type="hidden" id="secureAdminStudentName" value="${escapeHtml(student.displayName)}" />
    <label>새 비밀번호</label>
    <input type="password" id="secureAdminStudentPw" autocomplete="new-password" placeholder="6자 이상" />
    <div class="action-row">
      <button class="primary" onclick="adminResetStudentPassword()">비밀번호 바꾸기</button>
      <button class="ghost" onclick="openAdminPanel('students')">취소</button>
    </div>
  `, { type:'admin', pause:false });
};

window.adminConfirmDeleteStudentV2 = function adminConfirmDeleteStudentV2(userId){
  if (!SECURE_ADMIN_MODE_V2 || !requireTeacherAuth()) return;
  const student = secureAdminStudentByIdV2(userId);
  if (!student) { toast('학생 계정을 찾지 못했어요.'); return; }
  openModal(`
    <h2>⚠️ 학생 계정 완전 삭제</h2>
    <div class="panel-card"><p><b>${escapeHtml(student.displayName)}</b> 학생의 로그인 계정과 게임 데이터를 모두 삭제합니다. 되돌릴 수 없습니다.</p></div>
    <div class="action-row">
      <button class="ghost danger-text" id="confirmDeleteStudentV2Btn" onclick="adminDeleteStudentV2('${userId}')">완전히 삭제</button>
      <button class="ghost" onclick="openAdminPanel('students')">취소</button>
    </div>
  `, { type:'admin', pause:false });
};

window.adminDeleteStudentV2 = async function adminDeleteStudentV2(userId){
  if (!SECURE_ADMIN_MODE_V2 || !requireTeacherAuth() || !secureAdminDataV2 || secureAdminMutationV2) return;
  const button = $('confirmDeleteStudentV2Btn');
  secureAdminMutationV2 = true;
  if (button) { button.disabled = true; button.textContent = '삭제 중...'; }
  try {
    const result = await secureAdminDataV2.deleteStudent(userId);
    secureAdminStudentsStatusV2 = 'idle';
    await loadSecureAdminStudentsV2();
    toast(`${result.displayName} 학생 계정을 삭제했어요.`);
  } catch (error) {
    toast(error?.message || '학생 계정을 삭제하지 못했어요.');
    if (button) { button.disabled = false; button.textContent = '완전히 삭제'; }
  } finally {
    secureAdminMutationV2 = false;
  }
};

window.adminToggleStudentSelectionV2 = function adminToggleStudentSelectionV2(userId, checked) {
  if (checked) checkedAdminStudentsV2.add(userId);
  else checkedAdminStudentsV2.delete(userId);
  openAdminPanel('students', { keepScroll:true });
};

window.adminSelectAllStudentsV2 = function adminSelectAllStudentsV2(checked) {
  checkedAdminStudentsV2.clear();
  if (checked) secureAdminStudentsV2.forEach((student) => checkedAdminStudentsV2.add(student.userId));
  openAdminPanel('students', { keepScroll:true });
};

window.adminConfirmDeleteSelectedStudentsV2 = function adminConfirmDeleteSelectedStudentsV2() {
  if (!SECURE_ADMIN_MODE_V2 || !requireTeacherAuth()) return;
  const selected = secureAdminStudentsV2.filter((student) => checkedAdminStudentsV2.has(student.userId));
  if (!selected.length) { toast('삭제할 학생 계정을 선택해 주세요.'); return; }
  openModal(`
    <h2>⚠️ 선택 계정 ${selected.length}개 완전 삭제</h2>
    <div class="panel-card">
      <p><b>${selected.map((student) => escapeHtml(student.displayName)).join(', ')}</b></p>
      <p>선택한 로그인 계정과 게임 데이터를 모두 삭제합니다. 되돌릴 수 없습니다.</p>
    </div>
    <div class="action-row">
      <button class="ghost danger-text" id="confirmBulkDeleteStudentsV2Btn" onclick="adminDeleteSelectedStudentsV2()">선택 계정 완전히 삭제</button>
      <button class="ghost" onclick="openAdminPanel('students')">취소</button>
    </div>
  `, { type:'admin', pause:false });
};

window.adminDeleteSelectedStudentsV2 = async function adminDeleteSelectedStudentsV2() {
  if (!SECURE_ADMIN_MODE_V2 || !requireTeacherAuth() || !secureAdminDataV2 || secureAdminMutationV2) return;
  const selected = secureAdminStudentsV2.filter((student) => checkedAdminStudentsV2.has(student.userId));
  if (!selected.length) return;
  const button = $('confirmBulkDeleteStudentsV2Btn');
  secureAdminMutationV2 = true;
  try {
    for (let index = 0; index < selected.length; index += 1) {
      if (button) {
        button.disabled = true;
        button.textContent = `삭제 중... (${index + 1}/${selected.length})`;
      }
      await secureAdminDataV2.deleteStudent(selected[index].userId);
      checkedAdminStudentsV2.delete(selected[index].userId);
    }
    secureAdminStudentsStatusV2 = 'idle';
    await loadSecureAdminStudentsV2();
    toast(`학생 계정 ${selected.length}개를 삭제했어요.`);
  } catch (error) {
    toast(error?.message || '선택 계정을 삭제하는 중 문제가 생겼어요.');
    openAdminPanel('students');
  } finally {
    secureAdminMutationV2 = false;
  }
};

function openAdminPanel(tab, options) {
  if (!requireTeacherAuth()) return;
  if (SECURE_ADMIN_MODE_V2 && tab === 'workbooks' && secureAdminSharedV2
    && !(options && options.skipWorkbookRefresh) && !secureAdminWorkbookRefreshV2) {
    secureAdminWorkbookRefreshV2 = true;
    secureAdminSharedV2.refreshWorkbooks()
      .then(() => {
        secureAdminWorkbookSyncedAtV2 = Date.now();
        openAdminPanel('workbooks', { ...(options || {}), keepScroll:true, skipWorkbookRefresh:true });
      })
      .catch((error) => toast(error?.message || '서버 문제집을 불러오지 못했어요.'))
      .finally(() => { secureAdminWorkbookRefreshV2 = false; });
  }
  // [v58] 문제집 관리에서 토글·삭제 시 스크롤이 맨 위로 튀지 않도록 위치 보존
  const keepScroll = options && options.keepScroll;
  const box = document.querySelector('#modal .modal-box');
  const prevTop = keepScroll && box ? box.scrollTop : null;
  openModal(buildAdminPanelHtml(tab), { type: 'admin', pause: false });
  if (SECURE_ADMIN_MODE_V2 && (tab || 'students') === 'students'
    && !(options && options.skipSecureLoad)
    && secureAdminStudentsStatusV2 !== 'loading') {
    loadSecureAdminStudentsV2();
  }
  if (prevTop != null) {
    const restore = () => {
      const next = document.querySelector('#modal .modal-box');
      if (next) next.scrollTop = prevTop;
    };
    restore();
    requestAnimationFrame(restore);
  }
}

function getAdminWorkbooksV2(){
  return SECURE_ADMIN_MODE_V2 && secureAdminSharedV2
    ? secureAdminSharedV2.getWorkbooks()
    : getWorkbooks();
}

async function saveAdminWorkbooksV2(workbooks){
  try {
    if (SECURE_ADMIN_MODE_V2) {
      if (!secureAdminSharedV2) throw new Error('클라우드 문제집 설정을 확인해 주세요.');
      await secureAdminSharedV2.saveWorkbooks(workbooks);
      const verified = await secureAdminSharedV2.refreshWorkbooks();
      const expected = JSON.stringify(window.YuksamSharedStateV2.validateWorkbooks(workbooks));
      if (JSON.stringify(verified.workbooks) !== expected) throw new Error('서버 문제집 동기화를 확인하지 못했어요.');
      secureAdminWorkbookSyncedAtV2 = Date.now();
      return true;
    }
    saveWorkbooks(workbooks);
    return true;
  } catch (error) {
    toast(error?.message || '문제집을 저장하지 못했어요.');
    return false;
  }
}

function hasAdminQuestionDuplicate(workbook, question, answer){
  const key = (value) => String(value || '').normalize('NFKC').trim().toLocaleLowerCase('ko');
  const questionKey = key(question);
  const answerKey = key(answer);
  return workbook.questions.some((item) => key(item.q) === questionKey && key(item.answer) === answerKey);
}

window.addAdminQuestion = async function addAdminQuestion() {
  if (!requireTeacherAuth()) return;
  const workbookId = $('adminWorkbook')?.value;
  const q = $('adminQuestion').value.trim();
  const answer = $('adminAnswer').value.trim();
  if (!workbookId) { toast('먼저 문제집을 생성하세요.'); return; }
  if (!q || !answer) { toast('문제와 정답을 모두 입력하세요.'); return; }
  const workbooks = getAdminWorkbooksV2().map((book) => ({ ...book, questions:[...book.questions] }));
  const wb = workbooks.find((book) => book.id === workbookId);
  if (!wb) { toast('문제집을 찾을 수 없습니다.'); return; }
  if (hasAdminQuestionDuplicate(wb, q, answer)) { toast('같은 문제와 정답이 이미 있어요.'); return; }
  const choiceRaw = $('adminChoices')?.value.trim() || '';
  const choices = choiceRaw ? choiceRaw.split(',').map((v) => v.trim()).filter(Boolean).slice(0, 4) : null;
  wb.questions.push({ id: uid(), workbookId: wb.id, zone: wb.zone, q, answer, choices, source: '직접입력' });
  if (!(await saveAdminWorkbooksV2(workbooks))) return;
  openAdminPanel('workbooks', { keepScroll: true });
  toast('선택한 문제집에 문제가 추가되었습니다.');
};

window.adminTrackWorkbookDetails = function adminTrackWorkbookDetails(workbookId, open){
  if (open) openWorkbookDetailsV2.add(workbookId);
  else openWorkbookDetailsV2.delete(workbookId);
};

window.adminClearImportReport = function adminClearImportReport(){
  workbookImportReportV2 = null;
  openAdminPanel('workbooks', { keepScroll: true });
};

window.startEditWorkbookQuestion = function startEditWorkbookQuestion(workbookId, questionId){
  if (!requireTeacherAuth()) return;
  editingWorkbookQuestionV2 = { workbookId, questionId };
  openWorkbookDetailsV2.add(workbookId);
  openAdminPanel('workbooks', { keepScroll: true });
};

window.cancelEditWorkbookQuestion = function cancelEditWorkbookQuestion(){
  editingWorkbookQuestionV2 = null;
  openAdminPanel('workbooks', { keepScroll: true });
};

window.saveEditWorkbookQuestion = async function saveEditWorkbookQuestion(){
  if (!requireTeacherAuth()) return;
  if (!editingWorkbookQuestionV2) return;
  const { workbookId, questionId } = editingWorkbookQuestionV2;
  const q = ($('editQuestionText')?.value || '').trim();
  const answer = ($('editQuestionAnswer')?.value || '').trim();
  const choiceRaw = ($('editQuestionChoices')?.value || '').trim();
  if (!q || !answer) { toast('문제와 정답을 모두 입력하세요.'); return; }
  const limits = window.YuksamWorkbookImport;
  if (limits && q.length > limits.MAX_QUESTION_LENGTH) { toast(`문제는 ${limits.MAX_QUESTION_LENGTH}자까지 쓸 수 있어요.`); return; }
  if (limits && answer.length > limits.MAX_ANSWER_LENGTH) { toast(`정답은 ${limits.MAX_ANSWER_LENGTH}자까지 쓸 수 있어요.`); return; }

  const workbooks = getAdminWorkbooksV2().map((book) => ({ ...book, questions:[...book.questions] }));
  const wb = workbooks.find((book) => book.id === workbookId);
  if (!wb) { toast('문제집을 찾을 수 없습니다.'); return; }
  const index = wb.questions.findIndex((item) => item.id === questionId);
  if (index < 0) { toast('문제를 찾을 수 없습니다.'); return; }

  let choices = null;
  if (choiceRaw) {
    choices = choiceRaw.split(',').map((v) => v.trim()).filter(Boolean).slice(0, 4);
    // 정답이 보기에 없으면 학생이 맞힐 수 없으므로 반드시 넣는다
    if (!choices.includes(answer)) choices = [answer, ...choices].slice(0, 4);
  }
  wb.questions[index] = { ...wb.questions[index], q, answer, choices };
  if (!(await saveAdminWorkbooksV2(workbooks))) return;
  editingWorkbookQuestionV2 = null;
  openAdminPanel('workbooks', { keepScroll: true });
  toast('문제를 수정했습니다.');
};

window.adminImportTableFile = function adminImportTableFile(input){
  const file = input?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const box = $('adminImportTable');
    if (box) box.value = String(reader.result || '');
    toast(`"${file.name}"을 읽었습니다. 아래 버튼으로 추가하세요.`);
  };
  reader.onerror = () => toast('파일을 읽지 못했습니다.');
  reader.readAsText(file, 'utf-8');
};

window.adminImportTable = async function adminImportTable(){
  if (!requireTeacherAuth()) return;
  const importer = window.YuksamWorkbookImport;
  if (!importer) { toast('표 읽기 기능을 불러오지 못했습니다.'); return; }
  const workbookId = $('adminWorkbook')?.value;
  if (!workbookId) { toast('먼저 문제집을 선택하세요.'); return; }
  const raw = ($('adminImportTable')?.value || '').trim();
  if (!raw) { toast('붙여넣거나 파일을 선택하세요.'); return; }

  const workbooks = getAdminWorkbooksV2().map((book) => ({ ...book, questions:[...book.questions] }));
  const wb = workbooks.find((book) => book.id === workbookId);
  if (!wb) { toast('문제집을 찾을 수 없습니다.'); return; }

  const parsed = importer.parseTable(raw, { existingQuestions: wb.questions });
  if (!parsed.questions.length) {
    workbookImportReportV2 = { added: 0, skipped: parsed.skipped };
    openAdminPanel('workbooks', { keepScroll: true });
    toast('추가할 수 있는 문제가 없습니다. 건너뛴 이유를 확인하세요.');
    return;
  }
  for (const item of parsed.questions) {
    wb.questions.push({
      id: uid(),
      workbookId: wb.id,
      zone: wb.zone,
      q: item.q,
      answer: item.answer,
      choices: item.choices,
      source: '표등록',
    });
  }
  if (!(await saveAdminWorkbooksV2(workbooks))) return;
  workbookImportReportV2 = { added: parsed.questions.length, skipped: parsed.skipped };
  openWorkbookDetailsV2.add(wb.id);
  const box = $('adminImportTable');
  if (box) box.value = '';
  openAdminPanel('workbooks', { keepScroll: true });
  toast(`${parsed.questions.length}개 문제를 추가했습니다.`);
};

window.removeQuestionFromWorkbook = async function removeQuestionFromWorkbook(workbookId, questionId) {
  if (!requireTeacherAuth()) return;
  const workbooks = getAdminWorkbooksV2().map((book) => ({ ...book, questions:[...book.questions] }));
  const wb = workbooks.find((book) => book.id === workbookId);
  if (!wb) return;
  wb.questions = wb.questions.filter((q) => q.id !== questionId);
  if (!(await saveAdminWorkbooksV2(workbooks))) return;
  openAdminPanel('workbooks', { keepScroll: true });
  toast('문제를 삭제했습니다.');
};

window.deleteWorkbook = async function deleteWorkbook(workbookId) {
  if (!requireTeacherAuth()) return;
  const wb = getAdminWorkbooksV2().find((book) => book.id === workbookId);
  if (!wb) return;
  if (!confirm(`${wb.name} 문제집을 삭제할까요?`)) return;
  if (!(await saveAdminWorkbooksV2(getAdminWorkbooksV2().filter((book) => book.id !== workbookId)))) return;
  openAdminPanel('workbooks', { keepScroll: true });
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

window.copyChatGptPrompt = async function copyChatGptPrompt() {
  if (!requireTeacherAuth()) return;
  const builder = window.YuksamChatGptPrompt;
  if (!builder) { toast('문장 만들기 기능을 불러오지 못했습니다.'); return; }
  const built = builder.buildPrompt({
    topic:$('chatGptTopic')?.value,
    count:$('chatGptCount')?.value,
  });
  if (!built.ok) { toast(built.reason); return; }

  const box = $('chatGptPromptBox');
  if (box) {
    box.value = built.prompt;
    box.classList.remove('hidden');
  }
  // 클립보드가 막힌 환경에서도 문장은 위 칸에 보이므로 직접 복사할 수 있다
  try {
    await navigator.clipboard.writeText(built.prompt);
    toast('문장을 복사했습니다. ChatGPT에 붙여넣으세요.');
    return;
  } catch {}
  try {
    box?.select();
    document.execCommand('copy');
    toast('문장을 복사했습니다. ChatGPT에 붙여넣으세요.');
  } catch {
    toast('아래 칸의 문장을 직접 복사해 주세요.');
  }
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

window.adminToggleWorkbook = async function adminToggleWorkbook(workbookId){
  if (!requireTeacherAuth()) return;
  const workbooks = getAdminWorkbooksV2().map((book) => ({ ...book, questions:[...book.questions] }));
  const wb = workbooks.find((w) => w.id === workbookId);
  if (!wb) return;
  wb.enabled = wb.enabled === false ? true : false;
  if (!(await saveAdminWorkbooksV2(workbooks))) return;
  toast(wb.enabled === false ? `『${wb.name}』 출제를 껐습니다.` : `『${wb.name}』 출제를 켰습니다!`);
  openAdminPanel('workbooks', { keepScroll: true });
};

window.adminBulkImport = async function adminBulkImport(){
  if (!requireTeacherAuth()) return;
  const workbookId = $('adminWorkbook')?.value;
  if (!workbookId) { toast('먼저 문제집을 선택하세요.'); return; }
  const raw = ($('adminBulk')?.value || '').trim();
  if (!raw) { toast('등록할 문제를 입력하세요.'); return; }
  const workbooks = getAdminWorkbooksV2().map((book) => ({ ...book, questions:[...book.questions] }));
  const wb = workbooks.find((book) => book.id === workbookId);
  if (!wb) { toast('문제집을 찾을 수 없습니다.'); return; }
  let added = 0;
  for (const line of raw.split('\n')) {
    const idx = line.lastIndexOf('=');
    if (idx < 1) continue;
    const q = line.slice(0, idx).trim();
    const answer = line.slice(idx + 1).trim();
    if (!q || !answer) continue;
    if (hasAdminQuestionDuplicate(wb, q, answer)) continue;
    wb.questions.push({ id: uid(), workbookId: wb.id, zone: wb.zone, q, answer, choices: null, source: '일괄등록' });
    added += 1;
  }
  if (!(await saveAdminWorkbooksV2(workbooks))) return;
  openAdminPanel('workbooks', { keepScroll: true });
  toast(`${added}개 문제를 추가했습니다.`);
};

window.adminSaveTeacherSettings = async function adminSaveTeacherSettings(){
  if (!requireTeacherAuth()) return;
  const newPw = ($('teacherNewPw')?.value || '').trim();
  if (!newPw) { toast('새 비밀번호를 입력하세요.'); return; }
  if (SECURE_ADMIN_MODE_V2) {
    try {
      await secureAdminAuthV2.changeOwnPassword(newPw);
      openAdminPanel('settings');
      toast('관리자 비밀번호를 바꿨어요.');
    } catch (error) {
      toast(error?.message || '관리자 비밀번호를 바꾸지 못했어요.');
    }
    return;
  }
  const store = teacherStore();
  store.pw = newPw;
  saveTeacherStore(store);
  openAdminPanel('settings');
  toast('교사 비밀번호를 변경했습니다.');
};

// ── 서버 오픈/닫기 상태 ─────────────────────────────────────────
function isServerOpen(){
  if (SECURE_ADMIN_MODE_V2 && typeof secureStudentAccess?.isServerOpen === 'function') {
    return secureStudentAccess.isServerOpen();
  }
  // 기존 저장데이터에 serverOpen 필드가 없으면 열림(true)으로 간주
  const store = teacherStore();
  return store.serverOpen !== false;
}

window.adminSetServerOpen = async function adminSetServerOpen(open){
  if (!requireTeacherAuth()) return;
  if (SECURE_ADMIN_MODE_V2) {
    if (!secureAdminSharedV2) { toast('클라우드 수업 설정을 확인해 주세요.'); return; }
    try {
      await secureAdminSharedV2.setServerOpen(Boolean(open));
      openAdminPanel('settings');
      toast(open ? '🟢 서버를 열었어요.' : '🔴 서버를 닫았어요.');
    } catch (error) {
      toast(error?.message || '서버 상태를 저장하지 못했어요.');
    }
    return;
  }
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
