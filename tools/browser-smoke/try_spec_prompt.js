/* Lv.5 달성 시 전문화 선택창이 자동으로 뜨는지 확인한다. */
const run = require(require('path').join(__dirname, 'harness.js'));
const root = process.argv[2];

let pass = 0;
let fail = 0;
function check(name, condition, detail = '') {
  if (condition) { pass += 1; console.log(`PASS: ${name}${detail ? ` | ${detail}` : ''}`); }
  else { fail += 1; console.log(`FAIL: ${name}${detail ? ` | ${detail}` : ''}`); }
}

run(root, async ({ window, $, click, sleep, asyncErrors }) => {
  $('loginName').value = '전문화검증';
  $('loginPassword').value = '1234';
  click('studentLoginBtn'); await sleep(1200);
  click('createCharacterBtn'); await sleep(2600);

  const G = window.__G;
  G.player.spec = null;
  G.player.exp = 0;
  G.player.level = 1;

  // 실제 게임처럼 경험치를 얻어 Lv.5에 도달한다.
  window.eval('addExp(200)');
  check('경험치로 Lv.5가 된다', G.player.level >= 5, `lv=${G.player.level}`);

  await sleep(2400); // 자동 오픈은 1.8초 뒤
  check('Lv.5가 되면 전문화 창이 자동으로 뜬다',
    G.modalState?.type === 'spec' || !!window.document.querySelector('.spec-card, .spec-grid'),
    `modalType=${G.modalState?.type}`);

  // 창을 직접 열면 뜨는지도 확인한다(코드 자체가 망가졌는지 구분).
  G.modalState = { type: null, pause: false };
  window.eval('openSpecModal()');
  await sleep(60);
  check('버튼으로는 전문화 창이 열린다',
    G.modalState?.type === 'spec' || !!window.document.querySelector('.spec-card, .spec-grid'),
    `modalType=${G.modalState?.type}`);

  // ===== 실제 상황: 전투로 몬스터를 잡다가 Lv.5가 되는 경우 =====
  G.player.spec = null;
  G.player.exp = 0;
  G.player.level = 1;
  window.eval('addExp(120)');            // Lv.4 근처까지
  await sleep(2400);
  window.closeModal();
  G.modalState = { type: null, pause: false };

  window.eval('enterForest()');
  await sleep(1700);
  const monster = (G.forestMonsters || []).find((m) => !m.dead);
  if (monster) {
    G.player.x = monster.x; G.player.y = monster.y;
    await sleep(900);
  }
  const inCombat = G.modalState?.type === 'combat';
  check('전투에 들어간다', inCombat, `type=${G.modalState?.type}`);

  // 전투 중 몬스터를 잡아 Lv.5가 되게 한다.
  if (inCombat) {
    window.eval('addExp(120)');           // 전투 도중 레벨업 (Lv.5 도달)
    check('전투 중 Lv.5가 된다', G.player.level >= 5, `lv=${G.player.level}`);
    await sleep(3000);                    // 자동 오픈(1.8초) 이후까지 기다린다
    check('전투 중 레벨업해도 전문화 창이 뜬다',
      G.modalState?.type === 'spec' || !!window.document.querySelector('.spec-card, .spec-grid'),
      `modalType=${G.modalState?.type}`);
  }

  check('비동기 오류 없음', asyncErrors.length === 0, asyncErrors.slice(0, 3).join(' | '));
  console.log(`요약: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 && asyncErrors.length === 0 ? 0 : 1);
});
