const path = require('path');
const run = require(path.join(__dirname, 'harness.js'));
const root = process.argv[2] || path.join(__dirname, '..', '..');
const mode = process.argv[3] || 'existing';

const fakeClientSource = `
window.YuksamSupabaseClient = {
  createClient() {
    const user = {
      id:'secure-user-a',
      app_metadata:{ role:'student' },
      user_metadata:{ display_name:'별빛', normalized_name:'별빛' }
    };
    return {
      async rpc() { return { data:null, error:null }; },
      auth:{
        async signInWithPassword() {
          if (window.__secureLoginMode === 'existing') return { data:{ user, session:{ user } }, error:null };
          return { data:{ user:null, session:null }, error:{ code:'invalid_credentials', message:'Invalid login credentials' } };
        },
        async signUp() {
          if (window.__secureLoginMode === 'new') return { data:{ user, session:{ user } }, error:null };
          return { data:{ user:null, session:null }, error:{ code:'user_already_exists', message:'User already registered' } };
        },
        async getSession() { return { data:{ session:null }, error:null }; },
        async getUser() { return { data:{ user:null }, error:{ code:'session_not_found', message:'Auth session missing' } }; },
        async updateUser() { return { data:null, error:null }; },
        async signOut() { return { error:null }; }
      },
      functions:{
        async invoke() { return { data:null, error:{ status:403, message:'Forbidden' } }; }
      },
      from(table) {
        if (table === 'shared_state_v2') {
          return { select() { return { eq(column, key) { return { async maybeSingle() {
            return { data:key === 'classroom_settings' ? { data:{ version:1, serverOpen:true } } : null, error:null };
          } }; } }; } };
        }
        if (table !== 'player_profiles_v2') throw new Error('unexpected table ' + table);
        return {
          select() {
            return { eq() { return { async maybeSingle() {
              if (window.__secureLoginMode === 'existing') {
                return { data:{ data:{ name:'별빛', class:'warrior', level:3, exp:300, gold:40, map:'town' }, updated_at:new Date().toISOString() }, error:null };
              }
              return { data:null, error:null };
            } }; } };
          },
          update(payload) {
            window.__lastSecureSave = payload;
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
    checks.push([name, passed]);
    console.log(`${passed ? 'PASS' : 'FAIL'}: ${name}`);
  };
  function findNonJson(value, currentPath = 'player', seen = new WeakSet(), found = []) {
    if (value === null || ['string','boolean'].includes(typeof value)) return found;
    if (typeof value === 'number') { if (!Number.isFinite(value)) found.push(currentPath + ':number'); return found; }
    if (typeof value !== 'object') { found.push(currentPath + ':' + typeof value); return found; }
    if (seen.has(value)) { found.push(currentPath + ':circular'); return found; }
    seen.add(value);
    if (Array.isArray(value)) value.forEach((child, index) => findNonJson(child, currentPath + '[' + index + ']', seen, found));
    else Object.entries(value).forEach(([key, child]) => findNonJson(child, currentPath + '.' + key, seen, found));
    seen.delete(value);
    return found;
  }

  window.__secureLoginMode = mode;
  // 기존 계정은 새 생성 제한보다 긴 옛 이름이어도 계속 로그인할 수 있어야 한다.
  $('loginName').value = mode === 'existing' ? '가나다라마바사아' : '별빛';
  $('loginPassword').value = mode === 'wrong' ? 'wrong-123' : 'secret-123';
  click('studentLoginBtn');
  await sleep(80);
  if ($('toast').textContent) console.log('LOGIN ERROR: ' + $('toast').textContent);

  if (mode === 'new') {
    check('new account shows creation notice', $('cinematicTitle').textContent === '새 캐릭터를 생성합니다');
    check('creation notice is visible before creator', $('cinematicOverlay').classList.contains('visible'));
    await sleep(1750);
    check('new account opens character creator', $('creator').classList.contains('active'));
    click('createCharacterBtn');
    await sleep(1350);
    check('new character enters game', $('game').classList.contains('active'));
  } else if (mode === 'existing') {
    await sleep(1350);
    check('existing account enters game', $('game').classList.contains('active'));
  } else {
    check('wrong password stays on landing', $('landing').classList.contains('active'));
    check('wrong password creates no legacy record', window.localStorage.getItem('ysb_player_별빛') === null);
    check('wrong password creates no secure cache', window.localStorage.getItem('ysb_player_v2_secure-user-a') === null);
  }

  if (mode !== 'wrong') {
    const raw = window.localStorage.getItem('ysb_player_v2_secure-user-a') || '';
    check('secure cache exists', raw.length > 0);
    check('secure cache has no credential fields', !/password|access_token|refresh_token|secret-123/i.test(raw));
    check('legacy name cache is unused', window.localStorage.getItem('ysb_player_별빛') === null);
    check('game retains no current password', window.__G.currentPassword === '');
  }

  check('secure flow produced no async errors', asyncErrors.length === 0);
  if (asyncErrors.length) console.log('DIAG nonJson=' + findNonJson(window.__G.player).join(','));
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
