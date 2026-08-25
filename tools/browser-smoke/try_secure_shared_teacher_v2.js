const path = require('path');
const run = require(path.join(__dirname, 'harness.js'));
const root = process.argv[2] || path.join(__dirname, '..', '..');
const mode = process.argv[3] || 'manage';

const fakeClientSource = `
window.__teacherSignedIn = false;
window.__sharedWrites = [];
window.__sharedRows = {
  classroom_settings:{ version:1, serverOpen:true },
  workbooks:{ version:1, items:[{
    id:'cloud-book', name:'Cloud Math', zone:'silent_forest', subject:'math',
    prompt:'teacher cloud book', enabled:true, createdAt:1,
    questions:[{ id:'q-old', workbookId:'cloud-book', zone:'silent_forest', q:'1+1?', answer:'2', choices:null, source:'teacher' }]
  }] }
};
window.YuksamSupabaseClient = {
  createClient(url, key, options) {
    const isTeacher = options && options.auth && options.auth.storageKey === 'ysb_teacher_auth_v2';
    const user = { id:isTeacher ? 'teacher-user' : 'student-user', email:'teacher@example.com', app_metadata:{ role:isTeacher ? 'teacher' : 'student' } };
    return {
      async rpc() { return { data:null, error:null }; },
      auth:{
        async signInWithPassword() { window.__teacherSignedIn = true; return { data:{ user }, error:null }; },
        async signUp() { return { data:null, error:{ code:'user_already_exists' } }; },
        async getSession() { return { data:{ session:null }, error:null }; },
        async getUser() {
          return window.__teacherSignedIn
            ? { data:{ user }, error:null }
            : { data:{ user:null }, error:{ code:'session_not_found', message:'Auth session missing' } };
        },
        async updateUser() { return { data:{ user }, error:null }; },
        async signOut() { window.__teacherSignedIn = false; return { error:null }; }
      },
      functions:{ async invoke() { return { data:{ ok:true }, error:null }; } },
      from(table) {
        if (table === 'shared_state_v2') return {
          select() { return { eq(column, rowKey) { return { async maybeSingle() {
            if (rowKey === 'workbooks' && window.__failWorkbookRefresh) {
              return { data:null, error:new TypeError('Failed to fetch') };
            }
            return { data:{ data:window.__sharedRows[rowKey] }, error:null };
          } }; } }; },
          async upsert(payload) {
            if (window.__sharedTeacherMode === 'save-error') {
              return { error:{ code:'42501', message:'permission denied' } };
            }
            window.__sharedWrites.push(payload);
            window.__sharedRows[payload.key] = JSON.parse(JSON.stringify(payload.data));
            return { error:null };
          }
        };
        if (table !== 'player_profiles_v2') throw new Error('unexpected table ' + table);
        return {
          select() { return {
            async order() { return { data:[], error:null }; },
            eq() { return { async maybeSingle() { return { data:null, error:null }; } }; },
          }; },
          update() { return { async eq() { return { data:null, error:null }; } }; }
        };
      }
    };
  }
};`;

run(root, async ({ window, $, sleep, asyncErrors }) => {
  const checks = [];
  const check = (name, passed) => {
    checks.push([name, Boolean(passed)]);
    console.log(`${passed ? 'PASS' : 'FAIL'}: ${name}`);
  };

  window.openAdminPanel('students');
  $('teacherEmail').value = 'teacher@example.com';
  $('teacherPw').value = 'teacher-password';
  await window.adminTeacherLogin();
  await sleep(20);
  window.openAdminPanel('workbooks');
  await sleep(20);
  check('cloud workbook loads in teacher dashboard', window.document.querySelector('#modal').textContent.includes('Cloud Math'));
  const addWorkbookButton = [...window.document.querySelectorAll('#modal button')]
    .find((button) => button.textContent.includes('문제집 추가'));
  check('workbook add button is visible', Boolean(addWorkbookButton));
  check('workbook add button is enabled after the server refresh', addWorkbookButton?.disabled === false);
  check('workbook add button opens the creator', addWorkbookButton?.getAttribute('onclick') === 'adminOpenWorkbookCreator()');

  if (mode === 'save-error' || mode === 'offline-create') {
    const before = JSON.stringify(window.__sharedRows.workbooks);
    window.adminOpenWorkbookCreator();
    $('adminNewWorkbookName').value = mode === 'offline-create' ? '오프라인 문제집' : '저장 실패 문제집';
    $('adminNewWorkbookSubject').value = '과학';
    $('adminNewWorkbookZone').value = 'spooky_swamp';
    if (mode === 'offline-create') window.__failWorkbookRefresh = true;
    await window.adminCreateWorkbook();
    check('blocked create leaves cloud workbooks unchanged', JSON.stringify(window.__sharedRows.workbooks) === before);
    check('blocked create performs no workbook write', !window.__sharedWrites.some((write) => write.key === 'workbooks'));
    check('blocked create keeps the retry form open', Boolean($('adminNewWorkbookName')));
    check('blocked create restores the create button', $('adminCreateWorkbookBtn')?.disabled === false);
    check('blocked create shows a safe message', $('toast').textContent.length > 0);
  } else {
    window.adminOpenWorkbookCreator();
    $('adminNewWorkbookName').value = '직접 만든 과학 문제집';
    $('adminNewWorkbookSubject').value = '과학';
    $('adminNewWorkbookZone').value = 'spooky_swamp';
    await window.adminCreateWorkbook();
    const createdBook = window.__sharedRows.workbooks.items.find((book) => book.name === '직접 만든 과학 문제집');
    check('new workbook is saved to cloud', Boolean(createdBook));
    check('new workbook has safe empty defaults', createdBook?.subject === '과학'
      && createdBook?.zone === 'spooky_swamp' && createdBook?.enabled === true
      && Array.isArray(createdBook?.questions) && createdBook.questions.length === 0);
    check('new workbook is selected for question entry', $('adminWorkbook')?.value === createdBook?.id);
    check('new workbook card is visible immediately', window.document.querySelector('#modal').textContent.includes('직접 만든 과학 문제집'));
    $('adminQuestion').value = '물이 어는 온도는?';
    $('adminAnswer').value = '0도';
    await window.addAdminQuestion();
    check('direct question entry continues in the new workbook', window.__sharedRows.workbooks.items
      .find((book) => book.id === createdBook.id)?.questions.some((question) => question.q === '물이 어는 온도는?'));

    $('adminWorkbook').value = 'cloud-book';
    $('adminQuestion').value = '2+2?';
    $('adminAnswer').value = '4';
    await window.addAdminQuestion();
    const afterAdd = window.__sharedRows.workbooks.items[0];
    check('direct question is saved to cloud', afterAdd.questions.some((question) => question.q === '2+2?'));

    window.openAdminPanel('workbooks');
    $('adminWorkbook').value = 'cloud-book';
    $('adminBulk').value = '3+3?=6\n4+4?=8';
    await window.adminBulkImport();
    check('bulk questions are saved to cloud', window.__sharedRows.workbooks.items[0].questions.length === 4);

    window.openAdminPanel('workbooks');
    $('adminWorkbook').value = 'cloud-book';
    $('adminQuestion').value = '2+2?';
    $('adminAnswer').value = '4';
    await window.addAdminQuestion();
    const duplicateCount = window.__sharedRows.workbooks.items[0].questions
      .filter((question) => question.q === '2+2?' && question.answer === '4').length;
    check('duplicate question is blocked', duplicateCount === 1);

    await window.adminToggleWorkbook('cloud-book');
    check('workbook enable state is saved to cloud', window.__sharedRows.workbooks.items[0].enabled === false);

    await window.removeQuestionFromWorkbook('cloud-book', 'q-old');
    check('question deletion is saved to cloud', !window.__sharedRows.workbooks.items[0].questions.some((question) => question.id === 'q-old'));

    window.openAdminPanel('settings');
    await window.adminSetServerOpen(false);
    check('server close is saved to cloud', window.__sharedRows.classroom_settings.serverOpen === false);
    check('teacher settings immediately show closed', window.document.querySelector('#modal').textContent.includes('🔴 닫힘'));
    await window.adminSetServerOpen(true);
    check('server open is saved to cloud', window.__sharedRows.classroom_settings.serverOpen === true);

    await window.deleteWorkbook('cloud-book');
    check('workbook deletion is saved to cloud', !window.__sharedRows.workbooks.items.some((book) => book.id === 'cloud-book'));
    check('newly created workbook remains after deleting another workbook', window.__sharedRows.workbooks.items.some((book) => book.id === createdBook.id));
  }

  const legacyKeys = ['ysb_teacher_v1', 'ysb_workbooks_v3', 'ysb_questions_v2'];
  check('secure teacher flow writes no legacy shared key', legacyKeys.every((key) => window.localStorage.getItem(key) === null));
  check('secure teacher flow produced no async errors', asyncErrors.length === 0);
  if (asyncErrors.length) console.log(asyncErrors.join('\\n'));
  const failures = checks.filter(([, passed]) => !passed).length;
  console.log(`RESULT: ${failures === 0 ? 'PASS' : 'FAIL'} ${checks.length - failures}/${checks.length}`);
  process.exit(failures === 0 ? 0 : 1);
}, {
  cloudConfigCode:"window.YUKSAM_CLOUD = { securityV2Enabled:true, url:'https://project.supabase.co', anonKey:'publishable-key-that-is-long-enough' };",
  scriptOverrides:{ 'vendor/supabase-client.bundle.js':fakeClientSource },
  beforeLoad({ window }) {
    window.__sharedTeacherMode = mode;
    window.confirm = () => true;
  },
}).catch((error) => {
  console.log(String(error?.stack || error));
  process.exit(1);
});
