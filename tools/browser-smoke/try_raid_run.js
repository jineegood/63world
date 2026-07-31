/* 63빌딩 던전 스모크 — 실제 브라우저에서 한 판을 끝까지 돌려 본다.
   던전 맵 이동 → 로비 대형 배치(대기칸/+버튼) → 이동 → 전투 3회 → 보스 → 보상 */
const run = require(require('path').join(__dirname, 'harness.js'));
const root = process.argv[2];

let pass = 0;
let fail = 0;
function check(name, condition, detail = '') {
  if (condition) {
    pass += 1;
    console.log(`PASS: ${name}${detail ? ` | ${detail}` : ''}`);
  } else {
    fail += 1;
    console.log(`FAIL: ${name}${detail ? ` | ${detail}` : ''}`);
  }
}

run(root, async ({ window, $, click, sleep, asyncErrors }) => {
  $('loginName').value = '레이드검증';
  $('loginPassword').value = '1234';
  click('studentLoginBtn'); await sleep(1200);
  click('createCharacterBtn'); await sleep(2600);

  const G = window.__G;
  const ui = window.YuksamRaidRunUi;
  const rules = window.YuksamRaidRules;
  const fire = (node) => node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  check('던전 화면 모듈이 로드된다', !!ui && !!rules);
  if (!ui || !rules) {
    console.log(`요약: PASS ${pass} / FAIL ${fail}`);
    process.exit(1);
  }

  // 실제 게임처럼 Lv.5 + 전문화를 갖춘 상태로 만든다.
  const XP = window.YuksamData.XP_REQUIREMENTS;
  G.player.exp = XP[4];
  G.player.level = window.eval(`computeLevelFromExp(${XP[4]})`);
  G.player.spec = '방어';
  const townBefore = G.currentMap;

  // ===== 던전 맵으로 실제 이동 =====
  check('던전을 시작할 수 있다', ui.startRun(1) === true);
  await sleep(2600); // 로딩 연출이 완전히 끝날 때까지
  check('마을이 아니라 던전 맵으로 이동한다',
    G.currentMap === 'raidTower' && townBefore === 'town', `map=${G.currentMap}`);
  check('던전 맵이 월드에 등록되어 있다',
    !!window.YuksamData.worldDefs.raidTower, window.YuksamData.worldDefs.raidTower?.label);

  // ===== 로비: 대형 배치 =====
  check('로비 대형 화면이 열린다', G.modalState?.type === 'raidFormation', `type=${G.modalState?.type}`);

  const plusButtons = () => window.document.querySelectorAll('.raid-plus');
  const benchCards = () => window.document.querySelectorAll('.raid-bench-card');
  const emptyPosts = () => window.document.querySelectorAll('.raid-post.empty');
  const filledPosts = () => window.document.querySelectorAll('.raid-post.filled');

  check('처음에는 세 자리가 모두 비어 있다', emptyPosts().length === 3, `빈칸=${emptyPosts().length}`);
  check('세 명이 모두 대기칸에 서 있다', benchCards().length === 3, `대기=${benchCards().length}`);
  check('캐릭터 그림이 실제로 그려진다',
    window.document.querySelectorAll('.raid-face').length === 3,
    `캔버스=${window.document.querySelectorAll('.raid-face').length}`);
  check('자리마다 + 버튼이 있다', plusButtons().length >= 4, `+버튼=${plusButtons().length}`);
  check('세 자리를 채우기 전에는 출발할 수 없다',
    window.document.getElementById('raidStartBtn').disabled === true);

  // 첫 캐릭터를 골라 앞줄에 세운다.
  fire(benchCards()[0]);
  await sleep(20);
  fire(window.document.querySelector('.raid-plus[data-slot="front"]'));
  await sleep(30);
  check('고른 캐릭터가 앞줄에 선다',
    filledPosts().length === 1 && benchCards().length === 2,
    `배치=${filledPosts().length}, 대기=${benchCards().length}`);

  // 나머지 둘을 중간·뒷줄에 세운다.
  fire(benchCards()[0]);
  await sleep(20);
  fire(window.document.querySelector('.raid-plus[data-slot="middle"]'));
  await sleep(30);
  fire(benchCards()[0]);
  await sleep(20);
  fire(window.document.querySelector('.raid-plus[data-slot="back"]'));
  await sleep(30);
  check('세 자리가 모두 찬다', filledPosts().length === 3 && emptyPosts().length === 0);
  check('다 채우면 출발 버튼이 열린다',
    window.document.getElementById('raidStartBtn').disabled === false);

  // 배치된 캐릭터를 대기칸으로 되돌릴 수 있어야 한다.
  fire(window.document.querySelector('.raid-post.filled .raid-figure'));
  await sleep(20);
  fire(window.document.querySelector('.raid-plus[data-slot=""]'));
  await sleep(30);
  check('배치한 캐릭터를 대기칸으로 되돌릴 수 있다',
    benchCards().length === 1 && emptyPosts().length === 1,
    `대기=${benchCards().length}, 빈칸=${emptyPosts().length}`);

  // 다시 세워서 출발한다.
  fire(benchCards()[0]);
  await sleep(20);
  fire(window.document.querySelector('.raid-post.empty .raid-plus'));
  await sleep(30);
  check('빈칸에 다시 세울 수 있다', emptyPosts().length === 0);

  fire(window.document.getElementById('raidStartBtn'));
  await sleep(60);
  check('출발하면 창이 닫히고 던전 맵이 화면을 채운다',
    G.modalState?.type !== 'raidFormation' && G.currentMap === 'raidTower',
    `type=${G.modalState?.type}`);

  // ===== 전투 =====
  await sleep(2200);
  check('이동이 끝나면 전투가 시작된다', G.modalState?.type === 'raidBattle', `type=${G.modalState?.type}`);
  check('첫 몬스터는 경비 로봇', ui.peek().monster?.name === '경비 로봇', ui.peek().monster?.name);
  check('일반 전투와 같은 무대를 쓴다', !!window.document.querySelector('.combat-stage'));
  check('왼쪽에 캐릭터 셋이 보인다',
    window.document.querySelectorAll('.raid-ally-sprite').length === 3,
    `n=${window.document.querySelectorAll('.raid-ally-sprite').length}`);
  check('셋의 체력창이 각각 보인다',
    window.document.querySelectorAll('.raid-ally-hp').length === 3);
  check('몬스터 체력창이 보인다', !!window.document.querySelector('.combat-hpbox.monster'));
  check('문제가 출제된다', !!ui.currentQuestion()?.q, ui.currentQuestion()?.q);

  // 전투 로그를 한 줄씩 재생하므로 재생이 끝날 때까지 기다린다.
  const waitIdle = async (limit = 300) => {
    let n = 0;
    while (ui.isRunning() && ui.isBusy() && n < limit) { await sleep(25); n += 1; }
  };

  const hpBefore = ui.peek().monster.hp;
  ui.submitAnswerForTest(ui.currentQuestion().answer);
  await sleep(80);
  check('전투 로그가 한 줄씩 쌓인다',
    window.document.querySelectorAll('.raid-log div').length > 0,
    `줄=${window.document.querySelectorAll('.raid-log div').length}`);
  await waitIdle();
  check('정답을 넣으면 몬스터 체력이 줄어든다', ui.peek().monster.hp < hpBefore,
    `${hpBefore} -> ${ui.peek().monster.hp}`);
  check('몬스터가 그림으로 그려진다', !!window.document.getElementById('raidMonsterCanvas'));

  /* 몬스터도 10% 확률로 빗나가므로 한 라운드만 보면 흔들린다.
     몇 라운드 안에 앞줄이 실제로 맞는지 확인한다. */
  let frontHurt = false;
  for (let i = 0; i < 6 && !frontHurt; i += 1) {
    const front = ui.peek().members.find((m) => m.slot === 'front');
    if (front.hp < front.maxHp) { frontHurt = true; break; }
    if (ui.peek().phase !== 'battle') break;
    const q = ui.currentQuestion();
    if (q) ui.submitAnswerForTest(q.answer);
    await waitIdle();
    await sleep(20);
  }
  const frontNow = ui.peek().members.find((m) => m.slot === 'front');
  check('앞줄에 선 캐릭터가 반격을 맞는다', frontHurt,
    `${frontNow.name} ${frontNow.hp}/${frontNow.maxHp}`);

  // ===== 보스까지 끝까지 =====
  ui.setLogSpeed(0);   // 검사에서는 연출을 기다리지 않는다
  const seen = new Set();
  const sawKind = new Set();
  let sawBoss = false;
  let guard = 0;
  while (ui.isRunning() && !['cleared', 'wiped'].includes(ui.peek().phase) && guard < 400) {
    const snap = ui.peek();
    if (snap.phase === 'battle' && snap.monster) {
      seen.add(snap.monster.name);
      if (snap.monster.isBoss) sawBoss = true;
      const q = ui.currentQuestion();
      if (q) ui.submitAnswerForTest(q.answer);
      await waitIdle();
      // 한 판 동안 치명타·빗나감·회복이 실제로 나오는지 로그 색으로 확인한다.
      window.document.querySelectorAll('.raid-log div').forEach((node) => {
        if (node.className) sawKind.add(node.className);
      });
      await sleep(20);
    } else {
      await sleep(200);
    }
    guard += 1;
  }

  const finalPhase = ui.isRunning() ? ui.peek().phase : 'closed';
  check('일반 몬스터 3종을 모두 만난다',
    ['경비 로봇', '사무실 유령', '정전 그림자'].every((name) => seen.has(name)),
    [...seen].join(', '));
  check('레이드 보스까지 도달한다', sawBoss);
  check('전투 로그에 공격·피격이 모두 나온다',
    sawKind.has('mine') && sawKind.has('hit'), [...sawKind].join(','));
  check('치명타와 빗나감이 실제로 발동한다',
    sawKind.has('crit') && sawKind.has('miss'), [...sawKind].join(','));
  check('힐러 회복 로그가 나온다', sawKind.has('heal'), [...sawKind].join(','));
  check('Lv.5 파티가 1층을 깬다', finalPhase === 'cleared', `phase=${finalPhase}, 반복=${guard}`);
  check('결과 화면이 뜬다', G.modalState?.type === 'raidResult', `type=${G.modalState?.type}`);
  check('클리어 보상이 지급된다', G.player.building > 0, `빌딩=${G.player.building}`);

  // ===== 마을 복귀 =====
  fire(window.document.getElementById('raidDoneBtn'));
  await sleep(2600);
  check('끝나면 마을로 돌아간다', G.currentMap === 'town', `map=${G.currentMap}`);

  check('비동기 오류 없음', asyncErrors.length === 0, asyncErrors.slice(0, 3).join(' | '));
  console.log(`요약: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 && asyncErrors.length === 0 ? 0 : 1);
});
