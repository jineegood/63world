const run = require(require('path').join(__dirname, 'harness.js'));
const root = process.argv[2];
run(root, async ({ window, $, click, sleep, asyncErrors }) => {
  const G = () => window.__G;
  $('loginName').value = '전투검증';
  $('loginPassword').value = '1234';
  click('studentLoginBtn'); await sleep(1300);
  click('createCharacterBtn'); await sleep(2600);
  console.log('플레이어:', G().player?.name, '| 맵:', G().currentMap, '| 직업:', G().player?.class);

  window.enterForest(); await sleep(1800);
  console.log('숲 진입:', G().currentMap, '| 몬스터:', (G().forestMonsters || []).length);

  const m0 = G().forestMonsters.find((m) => !m.dead);
  G().player.x = m0.x; G().player.y = m0.y;
  await sleep(800);
  console.log('전투 모달 타입:', G().modalState?.type, '| 문제:', G().currentQuestion ? '출제' : '아직');

  // 전투 메뉴에서 공격 버튼 클릭 (모달 내 첫 primary 버튼)
  const html = () => $('modalContent').innerHTML;
  if (!G().currentQuestion) {
    const btn = window.document.querySelector('#modalContent button.primary, #modalContent .combat-menu button');
    console.log('메뉴 버튼:', btn ? btn.textContent.trim().slice(0, 12) : '없음', '| onclick:', btn && btn.getAttribute('onclick'));
    if (btn) { window.eval(btn.getAttribute('onclick')); await sleep(400); }
  }
  console.log('행동 선택 후 문제:', G().currentQuestion ? JSON.stringify(G().currentQuestion.q) : '없음', '| 입력창:', !!$('combatAnswer'));

  if (G().currentQuestion && $('combatAnswer')) {
    $('combatAnswer').value = G().currentQuestion.answer;
    window.submitCombatAnswer();
    await sleep(400);
    console.log('정답 제출 → records:', JSON.stringify(G().player.records));
    // 오답도 한 번
    if (G().currentQuestion === null) {
      await sleep(1200); // 반격 연출 대기
    }
    if (G().currentQuestion && $('combatAnswer')) {
      $('combatAnswer').value = '완전틀린답';
      window.submitCombatAnswer();
      await sleep(400);
      console.log('오답 제출 → records:', JSON.stringify({ a: G().player.records.answered, c: G().player.records.correct, w: G().player.records.wrongLog.length }));
    } else { console.log('오답 테스트: 다음 문제 대기 상태 아님 (전투 진행 중)'); }
  }
  await sleep(500);
  console.log(asyncErrors.length ? '!!! 비동기 오류 ' + asyncErrors.length + '건: ' + asyncErrors.slice(0, 3).join(' || ') : '비동기 오류 없음');
  process.exit(0);
}).catch((e) => { console.log('!!! 하네스 실패:', String(e && e.stack || e).split('\n').slice(0,3).join(' / ')); process.exit(1); });
