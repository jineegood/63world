// 3차 수정 검증: 툴팁 재표시 / E 이중입력 방지 / 객관식 키보드 / 보스 밸런스
const path = require('path');
const run = require(path.join(__dirname, 'harness.js'));
const root = process.argv[2] || path.join(__dirname, '..', '..');
run(root, async ({ window, $, click, sleep, asyncErrors }) => {
  const G = () => window.__G;
  let pass = 0, fail = 0;
  const chk = (c, n, x) => { c ? pass++ : fail++; console.log(c ? 'PASS:' : 'FAIL:', n, x || ''); };

  $('loginName').value = '삼차검증'; $('loginPassword').value = '1';
  click('studentLoginBtn'); await sleep(1300);
  click('createCharacterBtn'); await sleep(2600);

  // (a) 툴팁 v37: 폴링 방식 표시/숨김 (구 v31 요소는 CSS로 봉인됨)
  window.openCharacterPanel(); await sleep(150);
  const holder = window.document.querySelector('#modalContent [data-tooltip]');
  window.document.elementFromPoint = () => holder;
  window.document.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 90, clientY: 90 }));
  await sleep(300);
  const tip37 = window.document.querySelector('.ys-tooltip-v37');
  chk(tip37 && tip37.style.display === 'block', '툴팁 v37 표시');
  window.document.elementFromPoint = () => window.document.body;
  await sleep(300);
  chk(tip37.style.display === 'none', '툴팁 v37 숨김(마우스 이탈)');
  window.closeModal(); await sleep(100);

  // (b) E 이중입력 방지: 모달을 연 직후의 E는 무시, 이후 E는 실행
  window.eval("openModal('<div><button class=\"primary\">사기</button></div>', { type:'petShop', pause:true })");
  await sleep(60); // 관찰 주기보다 짧게 — 방금 열림 상태
  window.__clicked = 0;
  window.document.querySelectorAll('#modalContent button').forEach((b) => b.addEventListener('click', () => { window.__clicked += 1; }));
  const dispatchE = () => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'e', bubbles: true }));
  dispatchE();
  await sleep(50);
  chk(window.__clicked === 0, '방금 연 모달에서 E 무시', 'clicked=' + window.__clicked);
  await sleep(400); // grace 경과
  dispatchE();
  await sleep(50);
  chk(window.__clicked === 1, 'grace 이후 E 실행', 'clicked=' + window.__clicked);
  window.closeModal(); await sleep(150);

  // (c) 객관식: 네이티브 v26 셀렉터에 .choice-grid 포함(정적) + 모듈 양보 목록 포함(정적)
  // (jsdom은 offsetParent가 항상 null이라 v26 런타임 동작은 실제 브라우저에서만 확인 가능)
  const fs = require('fs');
  const gameSrc = fs.readFileSync(require('path').join(root, 'game.js'), 'utf8');
  const keysSrc = fs.readFileSync(require('path').join(root, 'src/combat-keys.js'), 'utf8');
  chk(/modal\.querySelectorAll\('[^']*\.choice-grid button/.test(gameSrc), 'v26 셀렉터에 .choice-grid 포함');
  chk(/V26_SELECTOR = '[^']*\.choice-grid button/.test(keysSrc), '모듈 양보 목록에 .choice-grid 포함');

  // (d) 최종보스 밸런스
  window.enterFinalBossRoomV21(); await sleep(1400);
  window.startFinalTeacherBattleV34(); await sleep(400);
  const fb = G().finalTeacherBossV34;
  const bstats = fb ? fb.maxHp + '/' + fb.attack + '/' + fb.exp + '/' + fb.gold : null;
  chk(fb && fb.maxHp === 999 && fb.attack >= 40 && fb.attack <= 50 && fb.exp === 363 && fb.gold === 363, '보스 밸런스 999HP/공40~50/보상363', bstats);

  await sleep(300);
  chk(asyncErrors.length === 0, '비동기 오류 없음', JSON.stringify(asyncErrors.slice(0, 2)));
  console.log(`\n결과: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.log('하네스 실패:', String(e && e.stack || e).split('\n').slice(0, 4).join(' / ')); process.exit(1); });
