const path = require('path');
const run = require(path.join(__dirname, 'harness.js'));
const root = process.argv[2] || path.join(__dirname, '..', '..');
const mode = process.argv[3] || 'teacher';

const fakeClientSource = `
window.__teacherClientCalls = [];
window.__teacherSignedIn = false;
window.YuksamSupabaseClient = {
  createClient(url, key, options) {
    const storageKey = options && options.auth && options.auth.storageKey;
    window.__teacherClientCalls.push(['createClient', storageKey || 'student']);
    if (storageKey === 'ysb_teacher_auth_v2') {
      const teacherUser = () => ({
        id:'teacher-user-a', email:'teacher@example.com',
        app_metadata:{ role:window.__teacherLoginMode === 'teacher' ? 'teacher' : 'student' },
      });
      return {
        auth:{
          async signInWithPassword(input) {
            window.__teacherClientCalls.push(['teacherSignIn', input.email]);
            window.__teacherSignedIn = true;
            return { data:{ user:teacherUser() }, error:null };
          },
          async getUser() {
            return window.__teacherSignedIn
              ? { data:{ user:teacherUser() }, error:null }
              : { data:{ user:null }, error:{ code:'session_not_found', message:'Auth session missing' } };
          },
          async signOut() {
            window.__teacherClientCalls.push(['teacherSignOut']);
            window.__teacherSignedIn = false;
            return { error:null };
          },
          async updateUser(input) {
            window.__ownPasswordUpdate = input;
            return { data:{ user:teacherUser() }, error:null };
          },
        },
        functions:{
          async invoke(name, input) {
            window.__studentReset = { name, input };
            return { data:{ ok:true, displayName:'별빛' }, error:null };
          },
        },
        from(table) {
          if (table !== 'player_profiles_v2') throw new Error('unexpected table ' + table);
          return { select() { return {
            async order() { return { data:[{
              user_id:'22222222-2222-4222-8222-222222222222', display_name:'별빛',
              updated_at:'2026-07-23T00:00:00.000Z', data:{ class:'mage', level:3, records:{} },
            }], error:null }; },
            eq() { return { async maybeSingle() { return { data:{ display_name:'별빛' }, error:null }; } }; },
          }; } };
        },
      };
    }
    return {
      async rpc() { return { data:null, error:null }; },
      auth:{
        async signInWithPassword() { return { data:null, error:{ code:'invalid_credentials' } }; },
        async signUp() { return { data:null, error:{ code:'user_already_exists' } }; },
        async getSession() { return { data:{ session:null }, error:null }; },
        async signOut() { return { error:null }; },
      },
      from() { return {}; },
    };
  }
};`;

run(root, async ({ window, $, sleep, asyncErrors }) => {
  const checks = [];
  const check = (name, passed) => {
    checks.push([name, Boolean(passed)]);
    console.log(`${passed ? 'PASS' : 'FAIL'}: ${name}`);
  };
  window.__teacherLoginMode = mode;
  window.openAdminPanel('students');
  check('secure login asks for teacher email', Boolean($('teacherEmail')));
  check('secure login hides the legacy 6363 hint', !window.document.querySelector('#modal').textContent.includes('6363'));
  $('teacherEmail').value = 'teacher@example.com';
  $('teacherPw').value = 'teacher-secret';
  await window.adminTeacherLogin();
  await sleep(20);

  if (mode === 'student') {
    check('student role remains outside dashboard', Boolean($('teacherEmail')) && !$('secureAdminStudentName'));
    check('rejected account is signed out', window.__teacherSignedIn === false);
  } else {
    check('teacher sees cloud student controls', Boolean($('secureAdminStudentRows')));
    const dashboardText = window.document.querySelector('#modal').textContent;
    check('secure dashboard contains no legacy password hint', !dashboardText.includes('6363'));
    check('secure dashboard contains no password column', !/비밀번호\s*최근/.test(dashboardText));

    window.adminOpenResetPasswordV2('22222222-2222-4222-8222-222222222222');
    check('teacher can open student reset controls', Boolean($('secureAdminStudentName')) && Boolean($('secureAdminStudentPw')));
    $('secureAdminStudentPw').value = 'new-student-password';
    await window.adminResetStudentPassword();
    check('reset uses the named server function', window.__studentReset?.name === 'teacher-reset-password');
    check('reset sends normalized student name', window.__studentReset?.input?.body?.normalizedName === '별빛');
    check('reset field is cleared', $('secureAdminStudentPw').value === '');

    window.openAdminPanel('settings');
    $('teacherNewPw').value = 'new-teacher-password';
    await window.adminSaveTeacherSettings();
    check('own password change uses Supabase Auth', window.__ownPasswordUpdate?.password === 'new-teacher-password');
    const stored = Object.entries(window.localStorage).map(([, value]) => value).join(' ');
    check('passwords are absent from localStorage', !/new-student-password|new-teacher-password|teacher-secret/.test(stored));
    await window.adminTeacherLogout();
    check('logout closes teacher authorization', window.__teacherSignedIn === false && Boolean($('teacherEmail')));
  }

  check('secure teacher flow produced no async errors', asyncErrors.length === 0);
  if (asyncErrors.length) console.log(asyncErrors.join('\n'));
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
