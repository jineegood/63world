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
  const testPetId = Object.keys(window.PET_DEFS_V27 || {})[0] || null;
  if (testPetId) G.player.activePet = testPetId;
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
  await sleep(140);
  const animatedFaces = [...window.document.querySelectorAll('.raid-face')];
  check('로비 캐릭터가 멈추지 않고 계속 움직인다',
    animatedFaces.length === 3
      && animatedFaces.every((canvas) => canvas.dataset.moving === 'true' && Number(canvas.dataset.paintCount) >= 2),
    animatedFaces.map((canvas) => `${canvas.dataset.moving}/${canvas.dataset.paintCount}`).join(', '));
  check('자리마다 + 버튼이 있다', plusButtons().length >= 4, `+버튼=${plusButtons().length}`);
  check('세 자리를 채우기 전에는 준비할 수 없다',
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
  check('다 채우면 준비 버튼이 열린다',
    window.document.getElementById('raidStartBtn').disabled === false);
  check('버튼 이름이 준비다',
    /준비/.test(window.document.getElementById('raidStartBtn').textContent || ''),
    window.document.getElementById('raidStartBtn').textContent);

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
  await sleep(80);
  check('준비를 누르면 각 칸에 Ready 표시가 뜬다',
    window.document.querySelectorAll('.raid-ready-badge').length === 3,
    'Ready=' + window.document.querySelectorAll('.raid-ready-badge').length);
  check('셋 다 준비되면 카운트다운이 시작된다',
    !!window.document.querySelector('.raid-countdown'),
    window.document.querySelector('.raid-countdown')?.textContent);
  check('카운트다운은 5초부터 센다',
    /5초/.test(window.document.querySelector('.raid-countdown')?.textContent || ''));
  // 카운트다운이 끝날 때까지 기다린다(기본 5초).
  let cdWait = 0;
  while (G.modalState?.type === 'raidFormation' && cdWait < 120) { await sleep(100); cdWait += 1; }
  check('카운트다운이 끝나면 창이 닫히고 던전 맵이 화면을 채운다',
    G.modalState?.type !== 'raidFormation' && G.currentMap === 'raidTower',
    `type=${G.modalState?.type}`);

  // ===== 전투 =====
  // 복도를 걷는 연출(약 4.2초) + 몬스터 등장 연출(약 1.9초)이 끝날 때까지 기다린다.
  await sleep(3000);
  check('걷는 동안 배경이 실제로 흘러간다', ui.travelScrollForTest() > 0,
    `scroll=${Math.round(ui.travelScrollForTest())}`);
  const petAnchor = ui.petAnchorForTest();
  check('복도에서 펫이 주인 옆을 따라 걷는다', !testPetId || (
    !!petAnchor && Math.hypot(petAnchor.x - petAnchor.ownerX, petAnchor.y - petAnchor.ownerY) < 80
  ), petAnchor ? JSON.stringify(petAnchor) : '펫 없음');
  await sleep(2000);
  check('복도 끝에서 몬스터가 나타나며 적 등장 연출이 뜬다',
    ui.encounterProgressForTest() > 0, `p=${ui.encounterProgressForTest().toFixed(2)}`);

  const travelWait = async (limit = 200) => {
    let n = 0;
    while (ui.isRunning() && G.modalState?.type !== 'raidBattle' && n < limit) { await sleep(60); n += 1; }
  };
  await travelWait();
  check('이동이 끝나면 전투가 시작된다', G.modalState?.type === 'raidBattle', `type=${G.modalState?.type}`);
  // 시트의 출현 규칙대로 1층 첫 상대는 Lv.5 버섯돌이킹이다.
  check('첫 몬스터는 버섯돌이킹', ui.peek().monster?.name === '버섯돌이킹', ui.peek().monster?.name);
  check('일반 전투와 같은 무대를 쓴다', !!window.document.querySelector('.combat-stage'));
  check('왼쪽에 캐릭터 셋이 보인다',
    window.document.querySelectorAll('.raid-ally-sprite').length === 3,
    `n=${window.document.querySelectorAll('.raid-ally-sprite').length}`);
  check('셋의 체력창이 각각 보인다',
    window.document.querySelectorAll('.raid-ally-hp').length === 3);
  check('몬스터 체력창이 보인다', !!window.document.querySelector('.combat-hpbox.monster'));
  check('적이 나타났다는 문구가 먼저 뜬다',
    /나타났다/.test(window.document.querySelector('.panel-card h3')?.textContent || ''),
    window.document.querySelector('.panel-card h3')?.textContent);
  // 등장 문구가 지나갈 때까지 기다린다
  let introWait = 0;
  while (!window.document.querySelector('[data-raid-menu="attack"]') && introWait < 80) { await sleep(60); introWait += 1; }
  // 일반 전투와 같은 행동 메뉴가 먼저 나온다.
  const menuBtn = (what) => window.document.querySelector(`[data-raid-menu="${what}"]`);
  check('공격 / 스킬 / 포기 메뉴가 나온다',
    !!menuBtn('attack') && !!menuBtn('skill') && !!menuBtn('giveup'));
  check('행동을 고르기 전에는 문제가 나오지 않는다', !ui.currentQuestion());

  fire(menuBtn('skill'));
  await sleep(30);
  check('스킬을 누르면 스킬 목록이나 안내가 나온다',
    !!window.document.querySelector('[data-raid-skill]')
    || /액티브 스킬이 없습니다/.test(window.document.querySelector('.panel-card')?.textContent || ''));
  fire(window.document.querySelector('[data-raid-menu="back"]'));
  await sleep(30);

  fire(menuBtn('attack'));
  await sleep(30);
  check('공격을 고르면 문제가 나온다', !!ui.currentQuestion()?.q, ui.currentQuestion()?.q);

  /* 매 턴 공격을 골라 문제를 푼다(일반 전투와 같은 흐름). */
  const attackOnce = async () => {
    const btn = menuBtn('attack');
    if (btn) { fire(btn); await sleep(25); }
    const q = ui.currentQuestion();
    if (q) ui.submitAnswerForTest(q.answer);
  };

  /* 전투 로그는 한 줄씩만 나오고 이전 줄은 지워진다.
     그래서 어떤 종류가 나왔는지는 재생 '도중'에 모아야 한다. */
  const sawKind = new Set();
  let sawPartyLunge = false;
  let sawMonsterLunge = false;
  const collectLine = () => {
    const text = window.document.querySelector('.panel-card h3')?.textContent || '';
    if (/치명타/.test(text)) sawKind.add('crit');
    if (/빗나갔|피했/.test(text)) sawKind.add('miss');
    if (/회복/.test(text)) sawKind.add('heal');
    /* 3인 전투 엔진은 "주었습니다/받았습니다", 옛 간이 경로는 "주었다/받았다"로 쓴다. */
    if (/피해를 주었(다|습니다)/.test(text)) sawKind.add('mine');
    if (/피해를 받았(다|습니다)/.test(text)) sawKind.add('hit');
    if (window.document.querySelector('.raid-party-lunge')) sawPartyLunge = true;
    if (window.document.querySelector('.raid-monster-lunge')) sawMonsterLunge = true;
  };
  const waitIdle = async (limit = 400) => {
    let n = 0;
    while (ui.isRunning() && ui.isBusy() && n < limit) { collectLine(); await sleep(20); n += 1; }
    collectLine();
  };

  const hpBefore = ui.peek().monster.hp;
  const stageBeforeSubmit = window.document.querySelector('.raid-stage');
  ui.submitAnswerForTest(ui.currentQuestion().answer);
  check('정답을 제출하면 입력칸과 공격 버튼이 즉시 사라진다',
    !window.document.getElementById('combatAnswer')
      && !window.document.getElementById('raidSubmitBtn')
      && !window.document.querySelector('.raid-choice')
      && !window.document.querySelector('[data-raid-menu]'));
  check('입력 UI를 지워도 전투 무대는 새로 만들지 않는다',
    window.document.querySelector('.raid-stage') === stageBeforeSubmit);
  await sleep(80);
  check('전투 기록은 따로 상자를 두지 않는다', !window.document.querySelector('.raid-log'));
  await waitIdle();
  check('정답을 넣으면 몬스터 체력이 줄어든다', ui.peek().monster.hp < hpBefore,
    `${hpBefore} -> ${ui.peek().monster.hp}`);
  check('파티원이 공격할 때 앞으로 나갔다 돌아온다', sawPartyLunge);
  check('몬스터가 반격할 때 앞으로 나갔다 돌아온다', sawMonsterLunge);
  check('몬스터가 그림으로 그려진다', !!window.document.getElementById('raidMonsterCanvas'));

  /* 몬스터도 10% 확률로 빗나가므로 한 라운드만 보면 흔들린다.
     몇 라운드 안에 앞줄이 실제로 맞는지 확인한다. */
  let frontHurt = false;
  for (let i = 0; i < 6 && !frontHurt; i += 1) {
    const front = ui.peek().members.find((m) => m.slot === 'front');
    if (front.hp < front.maxHp) { frontHurt = true; break; }
    if (ui.peek().phase !== 'battle') break;
    await attackOnce();
    await waitIdle();
    await sleep(20);
  }
  const frontNow = ui.peek().members.find((m) => m.slot === 'front');
  check('앞줄에 선 캐릭터가 반격을 맞는다', frontHurt,
    `${frontNow.name} ${frontNow.hp}/${frontNow.maxHp}`);

  // ===== 보스까지 끝까지 =====
  ui.setLogSpeed(0);            // 검사에서는 연출을 기다리지 않는다
  ui.setTravelSpeed(120, 80);   // 이동 연출도 짧게 줄인다
  const seen = new Set();
  let sawBoss = false;
  let guard = 0;
  while (ui.isRunning() && !['cleared', 'wiped'].includes(ui.peek().phase) && guard < 400) {
    const snap = ui.peek();
    if (snap.phase === 'battle' && snap.monster) {
      seen.add(snap.monster.name);
      if (snap.monster.isBoss) sawBoss = true;
      await attackOnce();
      await waitIdle();   // 재생 중에 로그 종류를 모은다
      await sleep(20);
    } else {
      await sleep(200);
    }
    guard += 1;
  }

  const finalPhase = ui.isRunning() ? ui.peek().phase : 'closed';
  /* 몬스터 구성은 시트의 출현 규칙에서 뽑히므로 이름을 박아 두지 않는다.
     그 층에 실제로 배정된 몬스터만 나왔는지, 보스 전까지 셋을 만났는지 본다. */
  const floorNames = new Set(
    (window.YuksamRaidRules?.floorEncounters(1, ui.peek().encounterIds) || []).map((m) => m.name),
  );
  check('만난 몬스터가 모두 1층 배정표 안에 있다',
    seen.size > 0 && [...seen].every((name) => floorNames.has(name)),
    `만남=${[...seen].join(', ')} / 배정=${[...floorNames].join(', ')}`);
  check('보스 전까지 일반 몬스터 3종을 만난다', seen.size >= 4, [...seen].join(', '));
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

  // ===== 던전에 갇히지 않는지 =====
  // (1) 저장에는 던전이 아니라 돌아갈 곳이 남아야 한다.
  ui.startRun(1);
  await sleep(2600);
  check('던전 안에서는 마을 귀환 버튼이 보인다',
    !$('returnTownBtn').classList.contains('hidden'));
  G.player.map = 'raidTower';
  window.eval('savePlayer()');
  check('저장에는 던전이 아니라 마을이 남는다', G.player.map !== 'raidTower',
    `저장된 map=${G.player.map}`);

  // (2) 그래도 던전에서 시작하면 자동으로 마을로 나와야 한다.
  window.YuksamRaidRunUi.leaveNow();
  await sleep(2600);
  G.currentMap = 'raidTower';
  G.player.map = 'raidTower';
  ui.rescueIfStranded();
  await sleep(40);
  check('진행 없이 던전에 있으면 자동으로 마을로 나온다', G.currentMap === 'town',
    `map=${G.currentMap}`);
  check('구조된 뒤에는 귀환 버튼이 숨는다', $('returnTownBtn').classList.contains('hidden'));

  // (3) 전투 중에도 포기하고 나갈 수 있어야 한다.
  ui.setCountdownSpeed(1, 40);   // 검사에서는 카운트다운을 짧게
  ui.startRun(1);
  await sleep(2600);
  const ids2 = ui.peek().members.map((m) => m.id);
  for (const [slot, id] of [['front', ids2[0]], ['middle', ids2[1]], ['back', ids2[2]]]) {
    fire(window.document.querySelector(`.raid-bench-card[data-pick="${id}"]`));
    await sleep(15);
    fire(window.document.querySelector(`.raid-plus[data-slot="${slot}"]`));
    await sleep(20);
  }
  fire(window.document.getElementById('raidStartBtn'));
  let waitBattle = 0;
  while (G.modalState?.type !== 'raidBattle' && waitBattle < 120) { await sleep(50); waitBattle += 1; }
  /* 전투가 열려도 "적이 나타났다" 문구가 지나가야 행동 메뉴가 붙는다.
     문구 길이가 몬스터마다 달라 바로 확인하면 검사가 들쭉날쭉해진다. */
  let menuWait = 0;
  while (!window.document.querySelector('[data-raid-menu="giveup"]') && menuWait < 120) {
    await sleep(50); menuWait += 1;
  }
  check('전투 화면에 포기 버튼이 있다', !!window.document.querySelector('[data-raid-menu="giveup"]'),
    `modal=${G.modalState?.type}`);
  fire(window.document.querySelector('[data-raid-menu="giveup"]'));
  await sleep(40);
  check('포기하면 한 번 물어본다', G.modalState?.type === 'raidGiveUp', `type=${G.modalState?.type}`);
  fire(window.document.getElementById('raidGiveUpYes'));
  await sleep(2600);
  check('포기하면 마을로 돌아간다', G.currentMap === 'town' && !ui.isRunning(),
    `map=${G.currentMap}, running=${ui.isRunning()}`);

  check('비동기 오류 없음', asyncErrors.length === 0, asyncErrors.slice(0, 3).join(' | '));
  console.log(`요약: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 && asyncErrors.length === 0 ? 0 : 1);
});
