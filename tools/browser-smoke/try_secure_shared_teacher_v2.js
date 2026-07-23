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
  check('cloud workbook loads in teacher dashboard', window.document.querySelector('#modal').textContent.includes('Cloud Math'));

  if (mode === 'save-error') {
    const before = JSON.stringify(window.__sharedRows.workbooks);
    await window.adminToggleWorkbook('cloud-book');
    check('failed save leaves cloud workbook unchanged', JSON.stringify(window.__sharedRows.workbooks) === before);
    check('failed save shows a safe message', $('toast').textContent.length > 0);
  } else {
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
    check('workbook deletion is saved to cloud', window.__sharedRows.workbooks.items.length === 0);
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
