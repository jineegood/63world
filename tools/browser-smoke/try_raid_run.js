/* 63빌딩 던전 2단계 스모크 — 실제 브라우저에서 한 판을 끝까지 돌려 본다.
   대형 배치 → 이동 → 전투 3회 → 레이드 보스 → 보상까지 확인한다. */
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

  // ===== 대형 배치 =====
  check('던전을 시작할 수 있다', ui.startRun(1) === true);
  await sleep(40);
  check('대형 배치 화면이 열린다', G.modalState?.type === 'raidFormation', `type=${G.modalState?.type}`);

  const slotButtons = window.document.querySelectorAll('.raid-slot-pick button');
  check('세 명 × 세 자리 버튼이 나온다', slotButtons.length === 9, `n=${slotButtons.length}`);
  check('시작 대형이 앞·중간·뒤로 하나씩 잡혀 있다',
    rules.validateFormation(ui.peek().members).ok === true);

  // 같은 자리에 둘을 세우면 출발이 막혀야 한다.
  const first = ui.peek().members[0].id;
  const second = ui.peek().members[1].id;
  window.document
    .querySelector(`.raid-slot-pick button[data-member="${second}"][data-slot="front"]`)
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(30);
  window.document.getElementById('raidStartBtn')
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(40);
  check('같은 자리에 두 명이면 출발이 막힌다',
    G.modalState?.type === 'raidFormation' && ui.peek().phase === 'formation',
    `phase=${ui.peek().phase}`);

  // 제대로 세운다: 나=앞줄, 도윤=중간, 하린=뒷줄
  const ids = ui.peek().members.map((m) => m.id);
  const wanted = { [ids[0]]:'front', [ids[1]]:'middle', [ids[2]]:'back' };
  for (const [id, slot] of Object.entries(wanted)) {
    window.document
      .querySelector(`.raid-slot-pick button[data-member="${id}"][data-slot="${slot}"]`)
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await sleep(15);
  }
  window.document.getElementById('raidStartBtn')
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(40);
  check('올바른 대형이면 이동이 시작된다', G.modalState?.type === 'raidTravel', `type=${G.modalState?.type}`);

  // ===== 전투 =====
  await sleep(1900);
  check('이동이 끝나면 전투가 시작된다', G.modalState?.type === 'raidBattle', `type=${G.modalState?.type}`);
  check('첫 몬스터는 경비 로봇', ui.peek().monster?.name === '경비 로봇', ui.peek().monster?.name);
  check('몬스터 체력바가 보인다', !!window.document.querySelector('.raid-monster-box .raid-bar'));
  check('파티 3명이 모두 표시된다',
    window.document.querySelectorAll('.raid-party .raid-member').length === 3);
  check('문제가 출제된다', !!ui.currentQuestion()?.q, ui.currentQuestion()?.q);

  // 정답을 넣어 실제로 몬스터 체력이 줄어드는지 본다.
  const hpBefore = ui.peek().monster.hp;
  ui.submitAnswerForTest(ui.currentQuestion().answer);
  await sleep(60);
  check('정답을 넣으면 몬스터 체력이 줄어든다', ui.peek().monster.hp < hpBefore,
    `${hpBefore} -> ${ui.peek().monster.hp}`);

  // 앞줄이 가장 많이 맞았는지 확인 (첫 라운드는 단일 공격 → 앞줄만)
  const meAfter = ui.peek().members.find((m) => m.isPlayer);
  check('앞줄에 선 내가 반격을 맞는다', meAfter.hp < meAfter.maxHp,
    `hp=${meAfter.hp}/${meAfter.maxHp}`);

  // 연출이 끝나면 다음 문제가 나온다.
  await sleep(1300);
  check('다음 라운드 문제가 이어서 나온다',
    G.modalState?.type === 'raidBattle' && !!ui.currentQuestion()?.q);

  // ===== 보스까지 끝까지 돌려 본다 =====
  const seen = new Set();
  let sawBoss = false;
  let guard = 0;
  while (ui.isRunning() && !['cleared', 'wiped'].includes(ui.peek().phase) && guard < 220) {
    const snap = ui.peek();
    if (snap.phase === 'battle' && snap.monster) {
      seen.add(snap.monster.name);
      if (snap.monster.isBoss) sawBoss = true;
      const q = ui.currentQuestion();
      if (q) ui.submitAnswerForTest(q.answer);
      await sleep(1250);
    } else {
      await sleep(260);
    }
    guard += 1;
  }

  const finalPhase = ui.isRunning() ? ui.peek().phase : 'closed';
  check('일반 몬스터 3종을 모두 만난다',
    ['경비 로봇', '사무실 유령', '정전 그림자'].every((name) => seen.has(name)),
    [...seen].join(', '));
  check('레이드 보스까지 도달한다', sawBoss);
  check('Lv.5 파티가 1층을 깬다', finalPhase === 'cleared', `phase=${finalPhase}, 반복=${guard}`);
  check('결과 화면이 뜬다', G.modalState?.type === 'raidResult', `type=${G.modalState?.type}`);
  check('클리어 보상이 지급된다', G.player.building > 0, `빌딩=${G.player.building}`);

  check('비동기 오류 없음', asyncErrors.length === 0, asyncErrors.slice(0, 3).join(' | '));
  console.log(`요약: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 && asyncErrors.length === 0 ? 0 : 1);
});
