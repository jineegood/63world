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
    hp:48, maxHp:70, skillPoints:2, baseStatsVersion:2,
    appearance:{ shirt:'#2563eb', pants:'#1e293b', hair:'#111827', hairStyle:'wave', skin:'#f1d2b6', accessory:'none' },
    costume:{ head:'costume_ninja_mask', armor:'costume_ninja_suit', accessory:'costume_spartan_cape' },
    equipment:{ weapon:'ironwoodStaff', armor:'navyRobe', head:'navyWizardHat', accessory:null },
    inventory:['ironwoodStaff','navyRobe','navyWizardHat'],
    skills:{ mage_basic_element:2, mage_fire_meteor_v24:1 }, weaponUpgrades:{ ironwoodStaff:2 },
    pets:['pet_slime'], activePet:'pet_slime', raidTopGroup:4,
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
      async rpc(name) {
        window.__adminCalls.push(['rpc', name]);
        if (name !== 'teacher_student_status_v1') return { data:null, error:{ status:404 } };
        return { data:window.__profileRows.map((row) => ({
          user_id:row.user_id, is_online:true,
          presence_last_seen_at:'2026-08-29T01:02:03.000Z', current_map:'town',
          raid_top_group:4, raid_top_floor:40,
        })), error:null };
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
  check('current online status is shown', window.document.querySelector('#secureAdminStudentRows')?.textContent.includes('접속 중'));
  check('real raid clear floor is shown', window.document.querySelector('#secureAdminStudentRows')?.textContent.includes('4구간 · 40층'));
  const dashboardHtml = window.document.querySelector('#modal').innerHTML;
  check('dashboard contains no credentials', !/must-not-render|access_token|teacher-secret|6363/.test(dashboardHtml));

  window.adminOpenStudentDetailV2(studentId);
  const detailText = window.document.querySelector('#modal').textContent;
  check('student detail shows stats and equipment', /HP 48\/70/.test(detailText) && detailText.includes('수정 지팡이'));
  check('student detail shows learned skills', detailText.includes('원소') && detailText.includes('메테오'));
  check('student detail contains no credentials', !/must-not-render|access_token|teacher-secret/.test(window.document.querySelector('#modal').innerHTML));

  window.adminOpenStudentEquipmentV2(studentId);
  await sleep(60);
  const equipmentRoot = window.document.querySelector('#modalContent .character-window-v33');
  check('equipment reuses the actual character screen in read-only mode', Boolean(equipmentRoot)
    && equipmentRoot.classList.contains('admin-student-readonly-preview-v1')
    && equipmentRoot.textContent.includes('인벤토리 / 상태창')
    && equipmentRoot.textContent.includes('별빛')
    && equipmentRoot.textContent.includes('수정 지팡이')
    && Boolean(equipmentRoot.querySelector('#characterPanelCanvas')));
  check('equipment preview removes all mutating inline actions', equipmentRoot?.querySelectorAll('[onclick], [ondragstart], [ondragover], [ondrop]').length === 0
    && Array.from(equipmentRoot?.querySelectorAll('[draggable]') || []).every((element) => element.getAttribute('draggable') === 'false'));
  window.adminOpenStudentSkillsV2(studentId);
  const skillRoot = window.document.querySelector('#modalContent .skill-window-v35');
  check('skills reuse the actual skill tree in read-only mode', Boolean(skillRoot)
    && skillRoot.classList.contains('admin-student-readonly-preview-v1')
    && Boolean(skillRoot.querySelector('.skill-tree-v35'))
    && skillRoot.textContent.includes('화염')
    && skillRoot.textContent.includes('메테오'));
  check('skill preview removes all learning actions', skillRoot?.querySelectorAll('[onclick]').length === 0);

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
