const run = require(require('path').join(__dirname, 'harness.js'));
const root = process.argv[2];

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS: ' + name + (extra ? ' | ' + extra : '')); }
  else { fail++; console.log('FAIL: ' + name + (extra ? ' | ' + extra : '')); }
}

run(root, async ({ window, $, click, sleep, asyncErrors }) => {
  const doc = window.document;
  const G = () => window.__G;
  const SEL = '.kb-select';

  function keydown(key, target) {
    const t = target || doc.body;
    const ev = new window.KeyboardEvent('keydown', { key: key, bubbles: true, cancelable: true });
    t.dispatchEvent(ev);
    return ev;
  }
  function selected() { return doc.querySelector('#modalContent ' + SEL); }
  function label(b) { return b ? b.textContent.trim().slice(0, 8) : '(없음)'; }

  // ── 로그인 & 캐릭터 생성 ──
  $('loginName').value = '키검증';
  $('loginPassword').value = '1234';
  click('studentLoginBtn'); await sleep(1300);
  click('createCharacterBtn'); await sleep(2600);

  // [v53] 신규 캐릭터 튜토리얼이 떠 있으면 닫고 시작
  try { window.__tutorialDoneV53 && window.__tutorialDoneV53(); } catch (e) {}
  await sleep(200);

  // (e) 비전투(마을)에서 방향키 → .kb-select 미생성
  keydown('ArrowRight');
  keydown('ArrowDown');
  ok('(e) 비전투 마을: 방향키로 .kb-select 미생성', selected() === null, '맵=' + G().currentMap);

  // ── 전투 진입 ──
  window.enterForest(); await sleep(1600);
  const m0 = G().forestMonsters.find((m) => !m.dead);
  G().player.x = m0.x; G().player.y = m0.y;
  await sleep(900);
  ok('전투 진입: modalState=combat', G().modalState && G().modalState.type === 'combat', 'type=' + (G().modalState && G().modalState.type));

  // (a) 메뉴 단계에서 첫 버튼에 .kb-select 자동 부여 (MutationObserver)
  let sel = selected();
  const btns = doc.querySelectorAll('#modalContent button:not(:disabled)');
  ok('(a) 첫 활성 버튼 자동 .kb-select', sel !== null && sel === btns[0], '선택=' + label(sel) + ' / 첫버튼=' + label(btns[0]));

  // (b) ArrowRight 디스패치로 다음 버튼으로 선택 이동
  const before = selected();
  const ev = keydown('ArrowRight');
  await sleep(20);
  const after = selected();
  ok('(b) ArrowRight로 선택 이동', after !== null && after !== before, before ? (label(before) + ' → ' + label(after)) : 'no-before');
  ok('(b2) ArrowRight preventDefault 발생', ev.defaultPrevented === true);

  // ArrowLeft로 되돌아와 첫 버튼(공격) 선택 상태로 맞춘다
  keydown('ArrowLeft'); await sleep(20);
  // 선택을 확실히 첫 버튼으로: 현재 선택이 첫 버튼이 아닐 수 있으니 순환 이동으로 맞춤
  let guard = 0;
  while (selected() !== btns[0] && guard++ < 6) { keydown('ArrowLeft'); await sleep(10); }
  ok('첫 버튼(공격) 재선택', selected() === btns[0], '선택=' + label(selected()));

  // (c) E 디스패치 → 선택 버튼 실행 → 문제 단계(#combatAnswer) 진입
  // 하네스 제약: jsdom runScripts:'outside-only'는 native .click()으로 inline onclick 속성을
  // 실행하지 않는다(실제 브라우저에서는 실행됨). 그래서 실제 동작을 두 단계로 우회 검증한다:
  //  (c1) 선택 버튼에 addEventListener('click') 스파이를 달아 E가 그 버튼의 .click()을
  //       호출함을 확인 — E→.click() 경로가 올바른 버튼에 도달함을 증명한다.
  //  (c3) 그 버튼의 onclick 속성을 직접 eval 해(브라우저였다면 .click()이 했을 일) 실제
  //       문제 단계(#combatAnswer) 진입까지 확인한다.
  const targetBtn = selected();
  let clickSpy = 0;
  targetBtn.addEventListener('click', function () { clickSpy++; });
  const eEv = keydown('e');
  await sleep(20);
  ok('(c1) E → 선택 버튼 .click() 호출됨(click 스파이)', clickSpy === 1, 'spy=' + clickSpy + ', btn=' + label(targetBtn) + ', onclick=' + targetBtn.getAttribute('onclick'));
  ok('(c2) E preventDefault 발생', eEv.defaultPrevented === true);
  // 브라우저였다면 .click()이 실행했을 onclick을 직접 실행해 문제 단계 진입 확인
  const nativeRandom = window.Math.random;
  window.Math.random = () => 0; // 첫 번째 주관식 문제로 고정해 input focus 검사를 항상 실행
  try { window.eval(targetBtn.getAttribute('onclick')); }
  finally { window.Math.random = nativeRandom; }
  await sleep(400);
  const answerControl = $('combatAnswer') || doc.querySelector('.choice-grid button');
  ok('(c3) 선택 버튼 onclick 실행 시 문제 단계 진입', !!answerControl, 'answerControl=' + !!answerControl + ', currentQuestion=' + !!G().currentQuestion);

  // 문제 단계에서 선택 해제되었는지 (observer)
  await sleep(20);
  ok('(c4) 문제 단계에서 .kb-select 해제', selected() === null);

  // (d) 입력창 포커스 상태에서 E → 가로채지 않음(preventDefault 미발생 + 선택 미변경)
  const input = $('combatAnswer');
  ok('정답 컨트롤 존재', !!answerControl);
  if (input) {
    if (typeof input.focus === 'function') input.focus();
    // activeState 강제: jsdom focus가 activeElement를 설정하는지 확인
    const beforeSel = selected();
    const dEv = keydown('e', input);
    await sleep(20);
    const notIntercepted = dEv.defaultPrevented === false;
    const selUnchanged = selected() === beforeSel;
    ok('(d) 입력창 포커스 중 E 미가로챔(preventDefault 미발생)', notIntercepted, 'defaultPrevented=' + dEv.defaultPrevented + ', active=' + (doc.activeElement && doc.activeElement.id));
    ok('(d2) 입력창 포커스 중 선택 미변경', selUnchanged);
    // 방향키도 입력창에서 미가로챔
    const arrowEv = keydown('ArrowRight', input);
    ok('(d3) 입력창 포커스 중 방향키 미가로챔', arrowEv.defaultPrevented === false);
  }

  console.log('---');
  console.log('결과: PASS ' + pass + ' / FAIL ' + fail + ' | 비동기오류 ' + asyncErrors.length + (asyncErrors.length ? ' :: ' + asyncErrors.slice(0,3).join(' || ') : ''));
  process.exit(fail === 0 && asyncErrors.length === 0 ? 0 : 1);
}).catch((e) => { console.log('!!! 하네스 실패:', String(e && e.stack || e).split('\n').slice(0, 4).join(' / ')); process.exit(1); });
