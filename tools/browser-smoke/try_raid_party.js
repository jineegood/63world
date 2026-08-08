/* 던전 안쪽을 실제 브라우저(jsdom)에서 끝까지 돌려 본다.
   진짜 서버 대신 가짜 방 서버를 붙여 3인 방 경로를 그대로 태운다.

   예전 try_raid_run.js가 쓰던 '혼자 도는 경로'는 게임에서 쓰이지 않아
   걷어냈다. 이 검사가 그 자리를 대신한다 — 대기실·출발·복도 이동·전투
   화면·재생·포기·갇힘 구조를 모두 실제 화면으로 확인한다. */
const path = require('path');
const run = require(path.join(__dirname, 'harness.js'));
const createFakeRaidRoom = require(path.join(__dirname, 'fake-raid-room.js'));

let pass = 0;
let fail = 0;
function check(name, condition, detail = '') {
  if (condition) { pass += 1; console.log(`PASS: ${name}${detail ? ` | ${detail}` : ''}`); }
  else { fail += 1; console.log(`FAIL: ${name}${detail ? ` | ${detail}` : ''}`); }
}

run(process.argv[2], async ({ window, $, click, sleep, asyncErrors }) => {
  const G = window.__G;
  const document = window.document;
  const ui = window.YuksamRaidRunUi;

  $('loginName').value = '던전파티'; $('loginPassword').value = '1234';
  click('studentLoginBtn'); await sleep(1200);
  click('createCharacterBtn'); await sleep(2600);

  // Lv.5 전문화까지 갖춘 학생으로 맞춘다(던전 입장 조건).
  G.player.level = 6;
  G.player.spec = '무기';
  G.player.hp = G.player.maxHp;

  const me = 'me-1';
  const fake = createFakeRaidRoom({
    meId:me,
    meName:G.player.name,
    profileOf:() => ({
      className:G.player.class, spec:G.player.spec, level:G.player.level,
      maxHp:G.player.maxHp, hp:G.player.maxHp, primaryStat:16, attack:8, defense:2,
      skills:{}, appearance:{}, equipment:{}, costume:{}, activePet:'', weaponTier:0,
      raidTopGroup:6,
    }),
  });

  /* 진짜 서버 자리에 가짜를 끼운다. 화면 코드는 이 둘을 구분하지 못한다. */
  window.getPvpIdentityV1 = () => ({ userId:me, displayName:G.player.name, role:'student' });
  window.secureStudentAccessV2 = { ...(window.secureStudentAccessV2 || {}), getClient:() => ({ fake:true }) };
  window.YuksamRaidPartyClient = { create:() => fake.client };

  // ===== 대기실 =====
  ui.setCountdownSpeed(1, 30);   // 카운트다운은 짧게
  const opened = await ui.openNetworkLobby({ mode:'create', floorGroup:1 });
  check('가짜 방으로 대기실이 열린다', opened === true, `type=${G.modalState?.type}`);
  await sleep(120);
  check('대기실에 세 명이 보인다',
    document.querySelectorAll('.raid-face').length === 3,
    `n=${document.querySelectorAll('.raid-face').length}`);
  check('내 캐릭터에만 파란 테두리가 붙는다',
    document.querySelectorAll('.raid-bench-card.mine, .raid-post.filled.mine').length === 1);
  check('방장은 왕관으로 표시된다', /👑 방장/.test(document.body.innerHTML));

  // 대형 배치 — 방장이 셋을 앞·가운데·뒤에 세운다.
  for (const [slot, id] of [['front', me], ['middle', 'friend-a'], ['back', 'friend-b']]) {
    const pick = document.querySelector(`[data-network-pick="${id}"]`);
    if (pick?.onclick) pick.onclick();
    await sleep(20);
    const plus = document.querySelector(`[data-network-slot="${slot}"]`);
    if (plus?.onclick) plus.onclick();
    await sleep(30);
  }
  const save = document.getElementById('raidSaveFormationBtn');
  check('셋을 다 세우면 대형 확정 버튼이 열린다', !!save && save.disabled === false);
  if (save?.onclick) await save.onclick();
  await sleep(120);

  const ready = document.getElementById('raidReadyBtn');
  check('대형을 저장하면 준비 버튼이 나온다', !!ready);
  if (ready?.onclick) await ready.onclick();
  check('전원 준비되면 카운트다운이 뜬다', !!document.querySelector('.raid-countdown'),
    document.querySelector('.raid-countdown')?.textContent);
  await sleep(120);

  // ===== 출발 · 복도 이동 =====
  let waitMap = 0;
  while (G.currentMap !== 'raidTower' && waitMap < 200) { await sleep(50); waitMap += 1; }
  check('출발하면 던전 맵으로 들어간다', G.currentMap === 'raidTower', `map=${G.currentMap}`);
  check('던전 맵이 월드에 등록되어 있다', !!window.YuksamData.worldDefs.raidTower);

  ui.setTravelSpeed(120, 80);
  await sleep(400);
  check('복도 배경이 실제로 흘러간다', ui.travelScrollForTest() > 0,
    `scroll=${Math.round(ui.travelScrollForTest())}`);

  let waitBattle = 0;
  while (G.modalState?.type !== 'raidBattle' && waitBattle < 300) { await sleep(50); waitBattle += 1; }
  check('복도 끝에서 전투가 시작된다', G.modalState?.type === 'raidBattle', `type=${G.modalState?.type}`);

  // ===== 전투 화면 =====
  check('일반 전투와 같은 무대를 쓴다', !!document.querySelector('.combat-stage'));
  check('왼쪽에 캐릭터 셋이 선다', document.querySelectorAll('.raid-ally-sprite').length === 3);
  check('체력창이 각 캐릭터 머리 위에 붙는다',
    document.querySelectorAll('.raid-ally-sprite .raid-ally-hp').length === 3);
  check('몬스터가 그림으로 그려진다', !!document.getElementById('raidMonsterCanvas'));
  check('몬스터 체력창과 다음 턴 예고가 보인다',
    !!document.querySelector('.combat-hpbox.monster') && !!document.querySelector('.raid-next-hint'),
    document.querySelector('.raid-next-hint')?.textContent?.trim());

  let introWait = 0;
  while (!document.querySelector('[data-raid-menu="attack"]') && introWait < 200) { await sleep(50); introWait += 1; }
  check('공격 / 스킬 / 포기 메뉴가 나온다',
    !!document.querySelector('[data-raid-menu="attack"]')
    && !!document.querySelector('[data-raid-menu="skill"]')
    && !!document.querySelector('[data-raid-menu="giveup"]'));

  // ===== 한 라운드 굴리기 =====
  ui.setLogSpeed(0);
  /* 한 턴을 굴린다. 행동 메뉴가 붙을 때까지 기다렸다가 누른다.
     기다리지 않으면 재생 중에 헛돌기만 하고 라운드가 진행되지 않는다. */
  const attackOnce = async (limit = 120) => {
    let wait = 0;
    while (wait < limit) {
      if (!ui.isRunning()) return false;
      const phase = ui.peek()?.phase;
      if (phase === 'cleared' || phase === 'wiped') return false;
      const menu = document.querySelector('[data-raid-menu="attack"]');
      if (menu?.onclick && !ui.isBusy()) break;
      await sleep(50); wait += 1;
    }
    const menu = document.querySelector('[data-raid-menu="attack"]');
    if (!menu?.onclick) return false;
    menu.onclick();
    await sleep(40);
    const question = ui.currentQuestion();
    if (!question) return false;
    ui.submitAnswerForTest(question.answer);
    let n = 0;
    while (ui.isRunning() && ui.isBusy() && n < 400) { await sleep(20); n += 1; }
    await sleep(40);
    return true;
  };

  const hpBefore = ui.peek().monster.hp;
  check('행동을 고르면 문제가 나온다', await attackOnce() === true);
  check('세 명 몫의 문제가 서버로 올라간다', fake.eventCount > 0, `이벤트 ${fake.eventCount}줄`);

  /* 기술 순서는 무작위라 첫 턴이 회복·보호막일 수 있다.
     몇 라운드 안에 몬스터 체력이 실제로 줄어드는지로 본다. */
  let monsterHurt = ui.peek().monster.hp < hpBefore;
  let guard = 0;
  while (!monsterHurt && guard < 6 && ui.peek()?.phase === 'battle') {
    await attackOnce();
    if (ui.peek()?.monster && ui.peek().monster.hp < ui.peek().monster.maxHp) monsterHurt = true;
    guard += 1;
  }
  check('정답을 넣으면 몬스터 체력이 줄어든다', monsterHurt,
    `${hpBefore} -> ${ui.peek()?.monster?.hp}`);

  // ===== 몬스터를 잡고 다음 복도로 =====
  let killGuard = 0;
  const firstName = ui.peek()?.monster?.name;
  while (killGuard < 24 && ui.isRunning() && ui.peek()?.monster?.name === firstName
    && !['cleared', 'wiped'].includes(ui.peek()?.phase)) {
    if (!(await attackOnce())) break;
    killGuard += 1;
  }
  /* 몬스터를 잡으면 복도로 넘어간다. 다음 조우가 시작될 때까지 기다린다. */
  let bridgeWait = 0;
  while (bridgeWait < 200 && ui.isRunning() && ui.peek()?.monster?.name === firstName
    && !['cleared', 'wiped'].includes(ui.peek()?.phase)) {
    await sleep(50); bridgeWait += 1;
  }
  const afterKill = ui.peek();
  check('몬스터를 잡으면 다음 조우로 넘어간다',
    !afterKill || afterKill.monster?.name !== firstName || afterKill.phase === 'cleared',
    `첫 몬스터=${firstName} / 지금=${afterKill?.monster?.name} / phase=${afterKill?.phase}`);
  check('재생이 밀려도 행동 메뉴가 잠긴 채 따라간다',
    !document.querySelector('[data-raid-menu="attack"]')
    || !/따라가는 중/.test(document.querySelector('.panel-card h3')?.textContent || '')
    || ui.isBusy(),
    document.querySelector('.panel-card h3')?.textContent?.trim());

  // ===== 포기하고 나가기 =====
  if (ui.isRunning() && G.modalState?.type === 'raidBattle') {
    let menuWait = 0;
    while (!document.querySelector('[data-raid-menu="giveup"]') && menuWait < 200) {
      await sleep(50); menuWait += 1;
    }
    const giveup = document.querySelector('[data-raid-menu="giveup"]');
    check('전투 화면에 포기 버튼이 있다', !!giveup, `modal=${G.modalState?.type}`);
    if (giveup?.onclick) { giveup.onclick(); await sleep(60); }
    check('포기하면 한 번 물어본다', G.modalState?.type === 'raidGiveUp', `type=${G.modalState?.type}`);
    const yes = document.getElementById('raidGiveUpYes');
    if (yes?.onclick) { yes.onclick(); await sleep(2600); }
  }
  check('포기하면 마을로 돌아간다', G.currentMap === 'town', `map=${G.currentMap}`);

  // ===== 던전에 갇히지 않는지 =====
  G.currentMap = 'raidTower';
  G.player.map = 'raidTower';
  window.eval('savePlayer()');
  check('저장에는 던전이 아니라 마을이 남는다', G.player.map !== 'raidTower',
    `저장된 map=${G.player.map}`);
  ui.rescueIfStranded();
  await sleep(60);
  check('진행 없이 던전에 있으면 자동으로 마을로 나온다', G.currentMap === 'town',
    `map=${G.currentMap}`);

  check('비동기 오류 없음', asyncErrors.length === 0, asyncErrors.slice(0, 3).join(' | '));
  console.log(`요약: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 && asyncErrors.length === 0 ? 0 : 1);
});
