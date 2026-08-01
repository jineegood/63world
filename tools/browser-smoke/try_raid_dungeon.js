/* 63빌딩 던전 1단계 스모크
   - 마을에 빌딩과 명진도사가 실제로 붙었는지
   - 느낌표가 Lv.5부터만 뜨는지
   - 입장 조건(Lv.5 + 전문화 + 이야기 청취)이 제대로 막고 열리는지
   - 빌딩과 NPC가 통과되지 않는지
   - 마을 그리기가 새 건물 때문에 깨지지 않는지 */
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
  $('loginName').value = '던전검증';
  $('loginPassword').value = '1234';
  click('studentLoginBtn'); await sleep(1200);
  click('createCharacterBtn'); await sleep(2600);

  const G = window.__G;
  const raid = window.YuksamRaidDungeon;

  check('모듈이 로드된다', !!raid);
  if (!raid) {
    console.log(`요약: PASS ${pass} / FAIL ${fail}`);
    process.exit(1);
  }

  const { TOWER, ELDER } = raid;

  /* 레벨은 경험치에서 계산된다(addExp가 항상 다시 계산한다).
     그래서 level 값을 직접 넣지 않고 실제 게임처럼 경험치를 맞춰 준다. */
  const XP = window.YuksamData.XP_REQUIREMENTS;
  const setLevel = (lv) => {
    G.player.exp = lv <= 1 ? 0 : XP[lv - 1];
    G.player.level = window.eval(`computeLevelFromExp(${G.player.exp})`);
    return G.player.level;
  };

  // 후보 탐색은 game.js의 렉시컬 스코프 함수라 eval로 부른다.
  const nearest = (point) => {
    G.currentMap = 'town';
    G.player.map = 'town';
    G.player.x = point.x;
    G.player.y = point.y;
    return window.eval('getNearestInteractable()');
  };

  // ===== 위치와 상호작용 =====
  check('빌딩이 마을 남쪽 길 끝에 있다',
    TOWER.x === 1200 && TOWER.doorY > 1500 && TOWER.doorY < 1800,
    `door=(${TOWER.doorX},${TOWER.doorY})`);

  const atDoor = nearest({ x: TOWER.doorX, y: TOWER.doorY });
  check('입구에 서면 던전 들어가기가 잡힌다', atDoor?.type === 'raidTowerDoor',
    `type=${atDoor?.type || 'null'}`);

  const atElder = nearest({ x: ELDER.x, y: ELDER.y });
  check('명진도사 옆에 서면 대화가 잡힌다', atElder?.type === 'raidElderNpc',
    `type=${atElder?.type || 'null'}`);

  const farAway = nearest({ x: 300, y: 300 });
  check('멀리 떨어지면 던전 상호작용이 잡히지 않는다',
    farAway?.type !== 'raidTowerDoor' && farAway?.type !== 'raidElderNpc',
    `type=${farAway?.type || 'null'}`);

  // ===== 느낌표(퀘스트 개방) 시점 =====
  setLevel(1);
  G.player.spec = null;
  G.player.quests = G.player.quests || {};
  delete G.player.quests[raid.QUEST_ID];
  check('Lv.1에는 느낌표가 뜨지 않는다', raid.questAvailable() === false, `lv=${G.player.level}`);

  setLevel(4);
  check('Lv.4에도 아직 느낌표가 없다', raid.questAvailable() === false, `lv=${G.player.level}`);

  setLevel(5);
  check('Lv.5가 되면 느낌표가 뜬다', raid.questAvailable() === true, `lv=${G.player.level}`);

  // ===== 입장 조건 =====
  setLevel(4);
  G.player.spec = '방어';
  check('Lv.5 미만이면 레벨 때문에 막힌다',
    /Lv\.5/.test(raid.entryBlockReason() || ''), raid.entryBlockReason());

  setLevel(5);
  G.player.spec = null;
  check('전문화가 없으면 전문화 때문에 막힌다',
    /전문화/.test(raid.entryBlockReason() || ''), raid.entryBlockReason());

  G.player.spec = '방어';
  check('이야기를 안 들었으면 명진도사 때문에 막힌다',
    /명진도사/.test(raid.entryBlockReason() || ''), raid.entryBlockReason());

  check('조건이 하나라도 모자라면 입장 불가', raid.canEnter() === false);

  // ===== 이야기를 끝까지 듣는다 =====
  raid.openElderDialogue();
  await sleep(40);
  // 명진쌤과 같은 dialogue-box 형식이어야 한다.
  check('명진쌤과 같은 대화창 형식을 쓴다',
    G.modalState?.type === 'dialogue' && !!window.document.querySelector('.dialogue-box'),
    `type=${G.modalState?.type}`);
  check('말머리와 E키 배지가 명진쌤과 같다',
    !!window.document.querySelector('.dialogue-speaker')
    && /E키로 진행/.test(window.document.querySelector('.dialogue-speaker')?.textContent || ''));
  check('첫 화면에 이야기 듣기 선택지가 있다',
    /이야기 듣기/.test(window.document.querySelector('.dialogue-options')?.textContent || ''),
    window.document.querySelector('.dialogue-options')?.textContent?.trim());

  // 첫 선택지(이야기 듣기)를 누르고, 마지막 장까지 '다음 이야기'를 눌러 나간다.
  const firstOption = () => window.document.querySelector('.dialogue-options button');
  firstOption().dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(40);

  let guard = 0;
  while (guard < 12) {
    const label = firstOption()?.textContent || '';
    if (/퀘스트 수락/.test(label)) {
      firstOption().dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await sleep(40);
      break;
    }
    if (!/다음 이야기/.test(label)) break;
    firstOption().dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await sleep(40);
    guard += 1;
  }
  check('여러 장의 이야기를 끝까지 볼 수 있다', guard >= 2 && guard <= 10, `넘김 ${guard}회`);
  check('이야기를 들으면 퀘스트가 완료로 남는다', raid.heardTheStory() === true,
    `status=${G.player.quests[raid.QUEST_ID]?.status}`);
  check('이야기를 들은 뒤에는 느낌표가 사라진다', raid.questAvailable() === false);

  // 퀘스트 보상 경험치가 들어가면서 레벨이 다시 계산된다. 완료 연출도 끝날 때까지 기다린다.
  await sleep(2400);

  // ===== 조건을 모두 갖추면 입장 가능 =====
  check('Lv.5 + 전문화 + 이야기 청취면 입장 가능', raid.canEnter() === true,
    raid.entryBlockReason() || `통과(lv=${G.player.level}, spec=${G.player.spec})`);

  raid.openTowerEntrance();
  await sleep(30);
  check('입장하면 던전 안내창이 열린다', G.modalState?.type === 'raidEntryHome',
    `type=${G.modalState?.type}`);
  window.closeModal();
  await sleep(20);

  // 조건이 안 되면 창이 열리지 않아야 한다.
  setLevel(3);
  G.modalState = { type: null, pause: false };
  raid.openTowerEntrance();
  await sleep(20);
  check('조건 미달이면 던전 안내창이 열리지 않는다', G.modalState?.type !== 'raidEntryHome',
    `type=${G.modalState?.type}`);
  setLevel(5);

  // ===== 통과 방지(충돌) =====
  const colliders = window.eval('getCurrentMapColliders()');
  const hitsTower = colliders.some((c) => c.type === 'rect'
    && Math.abs(c.x - TOWER.x) < 40 && Math.abs(c.y - TOWER.y) < 60);
  const hitsElder = colliders.some((c) => c.type === 'circle'
    && Math.abs(c.x - ELDER.x) < 8 && Math.abs(c.y - ELDER.y) < 8);
  check('빌딩이 통과되지 않는다', hitsTower, `충돌체 ${colliders.length}개`);
  check('명진도사가 통과되지 않는다', hitsElder);
  // 기존 마을 건물 충돌이 사라지지 않았는지 함께 본다.
  const worlds = window.YuksamData.worldDefs;
  const keepsPetShop = colliders.some((c) => c.type === 'rect'
    && Math.abs(c.x - worlds.town.petShop.x) < 6);
  const keepsHall = colliders.some((c) => c.type === 'rect'
    && Math.abs(c.x - worlds.town.hall.x) < 6);
  check('기존 펫 상점 충돌이 유지된다', keepsPetShop);
  check('기존 명예의 전당 충돌이 유지된다', keepsHall);

  // ===== 그리기가 깨지지 않는지 =====
  G.currentMap = 'town';
  let drawError = '';
  try {
    window.eval('drawTown()');
  } catch (err) {
    drawError = String(err && err.message || err);
  }
  check('새 건물이 들어가도 마을 그리기가 정상', drawError === '', drawError);

  check('비동기 오류 없음', asyncErrors.length === 0, asyncErrors.slice(0, 3).join(' | '));
  console.log(`요약: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 && asyncErrors.length === 0 ? 0 : 1);
});
