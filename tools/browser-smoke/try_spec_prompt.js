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
  /* 전문화 창이 뜰 때까지 걸린 시간(ms)을 잰다. 안 뜨면 Infinity.
     제작자 요구: 레벨 5가 된 뒤 3초 안에는 떠야 한다. */
  const specOpen = (G) => G.modalState?.type === 'spec'
    || !!window.document.querySelector('.spec-card, .spec-grid');
  async function waitForSpec(G, limitMs = 3000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < limitMs) {
      if (specOpen(G)) return Date.now() - startedAt;
      await sleep(50);
    }
    return Infinity;
  }

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

  const openedIn = await waitForSpec(G);
  check('Lv.5가 되면 전문화 창이 3초 안에 뜬다', openedIn < 3000,
    Number.isFinite(openedIn) ? `${openedIn}ms` : '3초 안에 뜨지 않음');

  // 창을 직접 열면 뜨는지도 확인한다(코드 자체가 망가졌는지 구분).
  G.modalState = { type: null, pause: false };
  window.eval('openSpecModal()');
  await sleep(60);
  check('버튼으로는 전문화 창이 열린다',
    G.modalState?.type === 'spec' || !!window.document.querySelector('.spec-card, .spec-grid'),
    `modalType=${G.modalState?.type}`);

  /* 학생이 창을 실수로 닫아 버려도 다시 떠야 한다.
     여기가 예전에 "전문화 창이 한참 뒤에야 떴다"의 원인이었다. */
  window.closeModal();
  G.modalState = { type:null, pause:false };
  G.player.spec = null;
  const reopenedIn = await waitForSpec(G);
  check('창을 닫아도 3초 안에 다시 뜬다', reopenedIn < 3000,
    Number.isFinite(reopenedIn) ? `${reopenedIn}ms` : '3초 안에 다시 뜨지 않음');

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
    const combatOpenedIn = await waitForSpec(G);
    check('전투 중 레벨업해도 전문화 창이 3초 안에 뜬다', combatOpenedIn < 3000,
      Number.isFinite(combatOpenedIn) ? `${combatOpenedIn}ms` : '3초 안에 뜨지 않음');
  }

  check('비동기 오류 없음', asyncErrors.length === 0, asyncErrors.slice(0, 3).join(' | '));
  console.log(`요약: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 && asyncErrors.length === 0 ? 0 : 1);
});
