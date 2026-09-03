// ??? 최종보스방 전체 흐름: 진입 → 명진쌤 대화 → 전투 → 마을 복귀
const path = require('path');
const run = require(path.join(__dirname, 'harness.js'));
const root = process.argv[2] || path.join(__dirname, '..', '..');
run(root, async ({ window, $, click, sleep, asyncErrors }) => {
  const G = () => window.__G;
  let pass = 0, fail = 0;
  const chk = (c, n, x) => { c ? pass++ : fail++; console.log(c ? 'PASS:' : 'FAIL:', n, x || ''); };

  $('loginName').value = '최종보스검증'; $('loginPassword').value = '1';
  click('studentLoginBtn'); await sleep(1300);
  click('createCharacterBtn'); await sleep(2600);
  window.enterFinalBossRoomV21(); await sleep(1500);
  chk(G().currentMap === 'finalBossRoom', '??? 맵 진입', G().currentMap);
  chk(asyncErrors.length === 0, '진입 후 프레임 오류 없음', JSON.stringify(asyncErrors.slice(0,2)));

  // 명진쌤 옆으로 이동 후 상호작용
  const world = ((window.YuksamData && window.YuksamData.worldDefs) || {}).finalBossRoom;
  if (world && world.teacher) { G().player.x = world.teacher.x + 40; G().player.y = world.teacher.y + 10; }
  else { G().player.x = 640; G().player.y = 300; }
  await sleep(300);
  try { window.eval('interact()'); } catch (e) { chk(false, '상호작용 예외', String(e).split('\n')[0]); }
  await sleep(400);
  const modalHtml = () => $('modalContent').innerHTML;
  chk(!$('modal').classList.contains('hidden'), '대화/모달 열림');
  // 대화 진행: 버튼 순차 클릭 (최대 8번, 전투 시작까지)
  for (let i = 0; i < 8; i++) {
    if (G().modalState?.type === 'combat') break;
    const btn = window.document.querySelector('#modalContent button.primary, #modalContent .dialogue-options button, #modalContent button');
    if (!btn) break;
    const oc = btn.getAttribute('onclick');
    if (oc) { try { window.eval(oc); } catch (e) { chk(false, '대화 버튼 예외', oc + ' → ' + String(e).split('\n')[0]); break; } }
    else btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await sleep(400);
  }
  chk(G().modalState?.type === 'combat', '최종보스 전투 진입', 'modal=' + G().modalState?.type);
  if (G().modalState?.type === 'combat') {
    const m = window.eval('currentCombatMonster()');
    chk(m && m.name === '최종보스 명진쌤' && m.type === 'teacherBoss', '전투창 보스 이름 = 최종보스 명진쌤', m && m.name);
    window.Math.random = () => 0.99;
    m.attack = 50;
    G().player.maxHp = 100;
    G().player.hp = 100;
    G().combatShield = 0;
    // 한 라운드: 공격 → 문제 → 정답
    const atk = window.document.querySelector('#modalContent button.primary, #modalContent .combat-menu button');
    if (atk) { window.eval(atk.getAttribute('onclick')); await sleep(400); }
    if (G().currentQuestion && $('combatAnswer')) {
      const hpBefore = m.hp;
      const playerHpBefore = G().player.hp;
      $('combatAnswer').value = G().currentQuestion.answer;
      window.submitCombatAnswer();
      const deadline = Date.now() + 5000;
      while (m.hp >= hpBefore && Date.now() < deadline) await sleep(50);
      chk(m.hp < hpBefore, '보스에게 피해', `${m.hp}/${hpBefore}`);
      const counterDeadline = Date.now() + 5000;
      while (G().player.hp >= playerHpBefore && Date.now() < counterDeadline) await sleep(50);
      chk(playerHpBefore - G().player.hp === 42, '최종보스 실제 피해 30% 감소', `${playerHpBefore}→${G().player.hp}`);
    }
  }
  await sleep(400);
  chk(asyncErrors.length === 0, '전 과정 프레임 오류 없음', JSON.stringify(asyncErrors.slice(0,3)));
  console.log(`\n결과: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.log('하네스 실패:', String(e && e.stack || e).split('\n').slice(0,4).join(' / ')); process.exit(1); });
