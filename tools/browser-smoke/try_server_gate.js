// 서버 오픈/닫기 게이트 검증:
//  (a) 교사 게이트 통과(6363) 후 설정 탭에 "서버 상태" 카드가 렌더되는지
//  (b) adminSetServerOpen(false) 후 학생 로그인 시도 → 차단 토스트, 화면 전환 없음
//  (c) 다시 열면 로그인 성공(캐릭터 생성 화면 진입)
const run = require(require('path').join(__dirname, 'harness.js'));
const root = process.argv[2];
run(root, async ({ window, $, click, sleep, asyncErrors }) => {
  let ok = true;
  const check = (label, cond) => { console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label); if (!cond) ok = false; };

  // (a) 교사 로그인 → 설정 탭 → 서버 상태 카드 확인
  window.openTeacherLogin();
  await sleep(80);
  $('teacherPw').value = '6363';
  window.adminTeacherLogin();
  await sleep(50);
  window.openAdminPanel('settings');
  await sleep(50);
  const settingsHtml = $('modalContent').innerHTML;
  check('설정 탭에 "서버 상태" 카드 렌더', settingsHtml.includes('서버 상태') && settingsHtml.includes('서버 열기') && settingsHtml.includes('서버 닫기'));
  check('기본 상태 = 열림(🟢) 표시', settingsHtml.includes('🟢') && settingsHtml.includes('열림'));
  check('isServerOpen() 기본 true', window.isServerOpen() === true);

  // (b) 서버 닫기 → 학생 로그인 차단
  window.adminSetServerOpen(false);
  await sleep(50);
  check('adminSetServerOpen(false) 후 isServerOpen() false', window.isServerOpen() === false);
  // 모달/화면 상태 스냅샷
  window.closeModal && window.closeModal();
  await sleep(30);
  const creatorBefore = window.document.querySelector('#creator')?.classList.contains('active');
  const landingBefore = window.document.querySelector('#landing')?.classList.contains('active');
  $('loginName').value = '차단시험';
  $('loginPassword').value = '1234';
  click('studentLoginBtn');
  await sleep(1400);
  const toastText = $('toast')?.textContent || '';
  const creatorAfter = window.document.querySelector('#creator')?.classList.contains('active');
  check('닫힘 상태 로그인 차단 토스트 노출', toastText.includes('서버가 닫혀'));
  check('차단 시 캐릭터 생성 화면으로 전환되지 않음', creatorAfter === false && creatorAfter === (creatorBefore || false));
  check('차단 시 player 미생성', !window.game || !window.game.player);

  // (c) 다시 열기 → 로그인 성공
  window.adminSetServerOpen(true);
  await sleep(30);
  check('다시 열면 isServerOpen() true', window.isServerOpen() === true);
  $('loginName').value = '통과시험';
  $('loginPassword').value = '1234';
  click('studentLoginBtn');
  await sleep(2000);
  const creatorOpen = window.document.querySelector('#creator')?.classList.contains('active');
  check('서버 열림 상태 로그인 성공(생성 화면 진입)', creatorOpen === true);

  check('비동기 오류 없음', asyncErrors.length === 0);
  console.log('asyncErrors:', asyncErrors.slice(0, 3));
  console.log(ok ? '\n=== ALL SERVER-GATE CHECKS PASSED ===' : '\n=== SOME CHECKS FAILED ===');
  process.exit(ok ? 0 : 1);
}).catch((e) => { console.log('!!! 하네스 실패:', String(e).split('\n')[0]); process.exit(1); });
