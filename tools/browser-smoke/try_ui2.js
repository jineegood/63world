// try_ui2.js — UI 4종(HUD 세로바 / 신분칩 4색 / 전문화 카드 모달 / 모달 공용 키보드) 검증
const path = require('path');
const fs = require('fs');
const run = require(path.join(__dirname, 'harness.js'));
const root = process.argv[2] || path.join(__dirname, '..', '..');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS: ' + name + (extra ? ' | ' + extra : '')); }
  else { fail++; console.log('FAIL: ' + name + (extra ? ' | ' + extra : '')); }
}

// ── (a) 정적 파일 검증: HUD 세로 2줄 + 150%/80% ──────────────
(function staticHudChecks() {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  // 구조: hud-meter-stack가 HP/EXP 두 meter를 감싼다
  const stackMatch = html.match(/hud-meter-stack[\s\S]*?hud-meter-hp[\s\S]*?hud-meter-exp/);
  ok('(a1) index.html: hud-meter-stack가 HP·EXP를 세로로 감쌈', !!stackMatch);
  // CSS: 세로(column)
  ok('(a2) style.css: hud-meter-stack flex-direction column',
     /\.hud-meter-stack\s*\{[^}]*flex-direction:\s*column/.test(css));
  // CSS: 가로폭 150% (168 -> 252), 두께 80% (30 -> 24)
  ok('(a3) style.css: 가로폭 150%(min-width 252px)',
     /\.hud-meter-stack\s+\.hud-meter\s*\{[^}]*min-width:\s*252px/.test(css));
  ok('(a4) style.css: 바 두께 80%(height 24px)',
     /\.hud-meter-stack\s+\.hud-meter\s*\{[^}]*height:\s*24px/.test(css));
  ok('(a5) style.css: 라벨 폰트 조정(11px)',
     /\.hud-meter-stack\s+\.hud-meter\s+\.hud-meter-label\s*\{[^}]*font-size:\s*11px/.test(css));
})();

run(root, async ({ window, $, click, sleep, asyncErrors }) => {
  const doc = window.document;
  const G = () => window.__G;

  function keydown(key, target) {
    const t = target || doc.body;
    const ev = new window.KeyboardEvent('keydown', { key: key, bubbles: true, cancelable: true });
    t.dispatchEvent(ev);
    return ev;
  }
  const kbSel = () => doc.querySelector('#modalContent .kb-select');

  // ── 로그인 & 캐릭터 생성 (전사) ──
  $('loginName').value = 'UI2검증';
  $('loginPassword').value = '1234';
  click('studentLoginBtn'); await sleep(1300);
  click('createCharacterBtn'); await sleep(2600);
  ok('부팅/캐릭터 생성', !!G().player, 'class=' + (G().player && G().player.class));

  // ── (b) 캐릭터 패널 헤더 신분 칩 4색 클래스 ──────────────
  window.openCharacterPanel();
  await sleep(80);
  const panelHtml = $('modalContent').innerHTML;
  ok('(b1) identity-chip-lv(레벨/하늘)', panelHtml.includes('identity-chip-lv'));
  ok('(b2) identity-chip-name(이름/초록)', panelHtml.includes('identity-chip-name'));
  ok('(b3) identity-chip-job(직업/주황)', panelHtml.includes('identity-chip-job'));
  ok('(b4) identity-chip-spec(전문화/보라)', panelHtml.includes('identity-chip-spec'));
  window.closeModal(); await sleep(60);

  // ── (c) 전문화 선택 모달: 대형 카드 2장 + 카드클릭→chooseSpec ──
  G().player.level = 5;
  G().player.spec = null;
  window.openSpecModal();
  await sleep(120);
  const cards = doc.querySelectorAll('#modalContent .spec-card-v37');
  ok('(c1) 대형 카드 2장 렌더', cards.length === 2, 'count=' + cards.length);
  const names = Array.from(doc.querySelectorAll('#modalContent .spec-card-name-v37')).map((e) => e.textContent.trim());
  ok('(c2) 전문화명 대형 표시(방어/무기)', names.length === 2 && names.includes('방어') && names.includes('무기'), names.join(','));
  const descs = doc.querySelectorAll('#modalContent .spec-card-desc-v37');
  ok('(c3) 카드 하단 설명 텍스트 존재', descs.length === 2 && descs[0].textContent.trim().length > 4);
  ok('(c4) 경고문 "바꿀 수 없습니다" 표시', /바꿀 수 없습니다/.test($('modalContent').textContent));
  // 카드 클릭 경로 → chooseSpec 호출 → spec 설정 (jsdom: native click은 inline onclick 미실행 → onclick eval로 우회)
  const first = cards[0];
  const specName = first.querySelector('.spec-card-name-v37').textContent.trim();
  ok('(c5) 카드 onclick이 chooseSpec 경로', /chooseSpec\('/.test(first.getAttribute('onclick') || ''), first.getAttribute('onclick'));
  window.eval(first.getAttribute('onclick'));
  await sleep(80);
  ok('(c6) 카드 클릭 → spec 설정됨', G().player.spec === specName, 'spec=' + G().player.spec);

  // ── (d) 상점 모달: 공용 키보드(ArrowRight/E) ──────────────
  window.openShopModal('all');
  await sleep(120);
  ok('(d0) 상점 모달 open(type=shop)', G().modalState && G().modalState.type === 'shop', 'type=' + (G().modalState && G().modalState.type));
  // 관찰자 자동 선택: 첫 버튼에 .kb-select
  ok('(d1) 상점 첫 버튼 자동 .kb-select', kbSel() !== null);
  const before = kbSel();
  await sleep(400); // E키 이중입력 보호(OPEN_GRACE_MS) 경과 대기
  const rEv = keydown('ArrowRight');
  await sleep(20);
  const after = kbSel();
  ok('(d2) ArrowRight로 .kb-select 이동', after !== null && after !== before);
  ok('(d3) ArrowRight preventDefault 발생', rEv.defaultPrevented === true);
  // E → 선택 버튼 .click() 호출 (스파이로 확인; jsdom native click은 inline onclick 미실행)
  let spy = 0;
  const target = kbSel();
  target.addEventListener('click', () => { spy++; });
  const eEv = keydown('e');
  await sleep(20);
  ok('(d4) E → 선택 버튼 .click() 호출', spy === 1, 'spy=' + spy);
  ok('(d5) E preventDefault 발생', eEv.defaultPrevented === true);

  console.log('---');
  console.log('결과: PASS ' + pass + ' / FAIL ' + fail + ' | 비동기오류 ' + asyncErrors.length + (asyncErrors.length ? ' :: ' + asyncErrors.slice(0,3).join(' || ') : ''));
  process.exit(fail === 0 && asyncErrors.length === 0 ? 0 : 1);
}).catch((e) => { console.log('!!! 하네스 실패:', String(e && e.stack || e).split('\n').slice(0, 5).join(' / ')); process.exit(1); });
