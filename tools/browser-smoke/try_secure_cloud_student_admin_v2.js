const path = require('path');
const run = require(path.join(__dirname, 'harness.js'));
const root = process.argv[2] || path.join(__dirname, '..', '..');

const studentId = '22222222-2222-4222-8222-222222222222';
const fakeClientSource = `
window.__adminCalls = [];
window.__teacherSignedIn = false;
window.__profileRows = [{
  user_id:'${studentId}', display_name:'별빛', updated_at:'2026-07-23T01:02:03.000Z',
  data:{ class:'mage', spec:'화염', level:7, exp:1234, gold:44, building:8,
    password:'must-not-render', records:{ answered:12, correct:9, wrongLog:[{ q:'<img src=x>', a:'정답', mine:'<script>bad</script>', at:1, access_token:'hidden' }] } }
}];
window.YuksamSupabaseClient = {
  createClient(url, key, options) {
    const storageKey = options && options.auth && options.auth.storageKey;
    if (storageKey !== 'ysb_teacher_auth_v2') {
      return {
        auth:{
          async signInWithPassword() { return { data:null, error:{ code:'invalid_credentials' } }; },
          async signUp() { return { data:null, error:{ code:'user_already_exists' } }; },
          async getSession() { return { data:{ session:null }, error:null }; },
          async signOut() { return { error:null }; },
        },
        async rpc() { return { data:null, error:null }; },
        from() { return {}; },
      };
    }
    const teacher = { id:'11111111-1111-4111-8111-111111111111', email:'teacher@example.com', app_metadata:{ role:'teacher' } };
    return {
      auth:{
        async signInWithPassword() { window.__teacherSignedIn = true; return { data:{ user:teacher }, error:null }; },
        async getUser() { return window.__teacherSignedIn ? { data:{ user:teacher }, error:null } : { data:{ user:null }, error:{ code:'session_not_found' } }; },
        async signOut() { window.__teacherSignedIn = false; return { error:null }; },
        async updateUser() { return { data:{ user:teacher }, error:null }; },
      },
      from(table) {
        if (table === 'shared_state_v2') return {
          select() { return { eq(column, key) { return { async maybeSingle() {
            return { data:{ data:key === 'classroom_settings' ? { version:1, serverOpen:true } : { version:1, items:[] } }, error:null };
          } }; } }; },
          async upsert() { return { error:null }; },
        };
        if (table === 'player_profiles_v2') return {
          select(columns) { return {
            async order() { window.__adminCalls.push(['list']); return { data:window.__profileRows, error:null }; },
            eq(column, value) { return { async maybeSingle() {
              const row = window.__profileRows.find((item) => item.user_id === value);
              return { data:row ? { display_name:row.display_name } : null, error:null };
            } }; },
          }; },
        };
        if (table === 'student_reward_grants_v2') return {
          async insert(payload) {
            window.__adminCalls.push(['grant', payload]);
            await new Promise((resolve) => setTimeout(resolve, 20));
            return { data:null, error:null };
          },
        };
        throw new Error('unexpected table ' + table);
      },
      functions:{
        async invoke(name, input) {
          window.__adminCalls.push(['invoke', name, input]);
          if (name === 'teacher-delete-student') {
            window.__profileRows = [];
            return { data:{ ok:true, displayName:'별빛' }, error:null };
          }
          return { data:{ ok:true, displayName:'별빛' }, error:null };
        },
      },
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
  $('teacherPw').value = 'teacher-secret';
  await window.adminTeacherLogin();
  await sleep(40);

  check('cloud student row is shown', window.document.querySelector('#secureAdminStudentRows')?.textContent.includes('별빛'));
  const dashboardHtml = window.document.querySelector('#modal').innerHTML;
  check('dashboard contains no credentials', !/must-not-render|access_token|teacher-secret|6363/.test(dashboardHtml));

  window.adminOpenWrongLogV2(studentId);
  check('wrong log is displayed as text', window.document.querySelector('#modal').textContent.includes('<img src=x>'));
  check('wrong log markup is escaped', !window.document.querySelector('#modal img') && !window.document.querySelector('#modal script'));

  window.adminOpenGrantModalV2(studentId);
  $('grantGoldV2').value = '10';
  $('grantBuildingV2').value = '2';
  $('grantExpV2').value = '30';
  const firstGrant = window.adminGrantRewardV2(studentId);
  const secondGrant = window.adminGrantRewardV2(studentId);
  await Promise.all([firstGrant, secondGrant]);
  check('duplicate reward click creates one grant', window.__adminCalls.filter(([name]) => name === 'grant').length === 1);
  check('reward targets immutable user id', window.__adminCalls.find(([name]) => name === 'grant')?.[1]?.user_id === studentId);
  check('reward copy explains next login', window.document.querySelector('#modal').textContent.includes('다음 로그인'));

  await sleep(30);
  window.adminConfirmDeleteStudentV2(studentId);
  check('delete requires a confirmation screen', Boolean($('confirmDeleteStudentV2Btn')));
  await window.adminDeleteStudentV2(studentId);
  await sleep(30);
  check('delete calls the server function once', window.__adminCalls.filter((call) => call[0] === 'invoke' && call[1] === 'teacher-delete-student').length === 1);
  check('list refresh shows empty state', window.document.querySelector('#modal').textContent.includes('학생 계정이 없습니다'));
  const stored = Array.from({ length:window.localStorage.length }, (_, i) => window.localStorage.getItem(window.localStorage.key(i))).join(' ');
  check('admin data is not persisted locally', !/별빛|must-not-render|teacher-secret/.test(stored));
  check('browser flow produced no async errors', asyncErrors.length === 0);

  const failures = checks.filter(([, passed]) => !passed).length;
  console.log(`RESULT: ${failures === 0 ? 'PASS' : 'FAIL'} ${checks.length - failures}/${checks.length}`);
  process.exit(failures === 0 ? 0 : 1);
}, {
  cloudConfigCode:"window.YUKSAM_CLOUD = { securityV2Enabled:true, url:'https://project.supabase.co', anonKey:'publishable-key-that-is-long-enough' };",
  scriptOverrides:{ 'vendor/supabase-client.bundle.js':fakeClientSource },
}).catch((error) => {
  console.log(String(error?.stack || error));
  process.exit(1);
});
