const path = require('path');
const run = require(path.join(__dirname, 'harness.js'));
const root = process.argv[2] || path.join(__dirname, '..', '..');
const mode = process.argv[3] || 'workbooks';

const fakeClientSource = `
window.__studentAuthCalls = 0;
window.__studentSignOutCalls = 0;
window.__sharedRows = {
  classroom_settings:{ version:1, serverOpen:window.__sharedStudentMode !== 'closed' },
  workbooks:{ version:1, items:[{
    id:'cloud-book', name:'Cloud Math', zone:'silent_forest', subject:'math',
    prompt:'cloud only', enabled:true, createdAt:1,
    questions:[{ id:'cloud-q', workbookId:'cloud-book', zone:'silent_forest', q:'Cloud only question?', answer:'42', choices:null, source:'teacher' }]
  }] }
};
window.YuksamSupabaseClient = {
  createClient() {
    const user = { id:'shared-student', app_metadata:{ role:'student' }, user_metadata:{ display_name:'Student', normalized_name:'student' } };
    return {
      async rpc() { return { data:null, error:null }; },
      auth:{
        async signInWithPassword() {
          window.__studentAuthCalls += 1;
          return { data:{ user, session:{ user } }, error:null };
        },
        async signUp() { throw new Error('unexpected signUp'); },
        async getSession() { return { data:{ session:null }, error:null }; },
        async getUser() { return { data:{ user }, error:null }; },
        async updateUser() { return { data:{ user }, error:null }; },
        async signOut() { window.__studentSignOutCalls += 1; return { error:null }; }
      },
      functions:{ async invoke() { return { data:null, error:{ status:403, message:'Forbidden' } }; } },
      from(table) {
        if (table === 'shared_state_v2') return {
          select() { return { eq(column, key) { return { async maybeSingle() {
            return { data:{ data:window.__sharedRows[key] }, error:null };
          } }; } }; }
        };
        if (table !== 'player_profiles_v2') throw new Error('unexpected table ' + table);
        return {
          select() { return { eq() { return { async maybeSingle() {
            return { data:{ data:{ name:'Student', class:'warrior', level:2, exp:100, gold:10, map:'town' }, updated_at:new Date().toISOString() }, error:null };
          } }; } }; },
          update(payload) {
            window.__sharedStudentSave = payload;
            return { async eq() { return { data:null, error:null }; } };
          }
        };
      }
    };
  }
};`;

run(root, async ({ window, $, click, sleep, asyncErrors }) => {
  const checks = [];
  const check = (name, passed) => {
    checks.push([name, Boolean(passed)]);
    console.log(`${passed ? 'PASS' : 'FAIL'}: ${name}`);
  };

  $('loginName').value = 'Student';
  $('loginPassword').value = 'student-password';
  click('studentLoginBtn');

  if (mode === 'closed') {
    await sleep(80);
    check('closed classroom stays on landing', $('landing').classList.contains('active'));
    check('closed classroom makes no Auth request', window.__studentAuthCalls === 0);
  } else {
    await sleep(1450);
    check('open classroom enters the game', $('game').classList.contains('active'));
    check('game uses the cloud workbook', window.getWorkbooks().some((book) => book.id === 'cloud-book'));
    check('game uses the cloud question', window.getQuestions().some((question) => question.id === 'cloud-q'));
    if (mode === 'later-close') {
      window.__sharedRows.classroom_settings = { version:1, serverOpen:false };
      await window.__sharedPoll();
      await sleep(30);
      check('later close saves the player', Boolean(window.__sharedStudentSave));
      check('later close signs the student out', window.__studentSignOutCalls >= 1);
      check('later close returns to landing', $('landing').classList.contains('active') && window.__G.player === null);
    }
  }

  const legacyKeys = ['ysb_teacher_v1', 'ysb_workbooks_v3', 'ysb_questions_v2'];
  check('secure shared flow writes no legacy shared key', legacyKeys.every((key) => window.localStorage.getItem(key) === null));
  check('secure shared flow produced no async errors', asyncErrors.length === 0);
  if (asyncErrors.length) console.log(asyncErrors.join('\\n'));
  const failures = checks.filter(([, passed]) => !passed).length;
  console.log(`RESULT: ${failures === 0 ? 'PASS' : 'FAIL'} ${checks.length - failures}/${checks.length}`);
  process.exit(failures === 0 ? 0 : 1);
}, {
  cloudConfigCode:"window.YUKSAM_CLOUD = { securityV2Enabled:true, url:'https://project.supabase.co', anonKey:'publishable-key-that-is-long-enough' };",
  scriptOverrides:{ 'vendor/supabase-client.bundle.js':fakeClientSource },
  beforeLoad({ window }) {
    window.__sharedStudentMode = mode;
    const originalSetInterval = window.setInterval.bind(window);
    window.setInterval = (fn, ms) => {
      if (ms === 15000) { window.__sharedPoll = fn; return 15000; }
      return originalSetInterval(fn, ms);
    };
  },
}).catch((error) => {
  console.log(String(error?.stack || error));
  process.exit(1);
});
