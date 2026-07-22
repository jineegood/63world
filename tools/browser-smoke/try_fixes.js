// 버그 수정 검증: 장착 / 전문화 / 펫 확률 / 툴팁
const path = require('path');
const run = require(path.join(__dirname, 'harness.js'));
const root = process.argv[2] || path.join(__dirname, '..', '..');
run(root, async ({ window, $, click, sleep, asyncErrors }) => {
  const G = () => window.__G;
  let pass = 0, fail = 0;
  const chk = (cond, name, extra) => { if (cond) { pass++; console.log('PASS:', name, extra || ''); } else { fail++; console.log('FAIL:', name, extra || ''); } };

  $('loginName').value = '수정검증'; $('loginPassword').value = '1';
  click('studentLoginBtn'); await sleep(1300);
  click('createCharacterBtn'); await sleep(2600);
  chk(G().player && G().player.name === '수정검증', '플레이어 생성');

  // (a) 장착: 인벤토리에 상점 아이템 추가 후 장착 버튼 경로(equipItem) 직접 호출
  const p = G().player;
  p.inventory.push('bronzeGreatsword');
  p.level = 5; // levelReq 3 충족
  let equipErr = null;
  try { window.equipItem('bronzeGreatsword'); } catch (e) { equipErr = e; }
  chk(!equipErr, '장착 TypeError 없음', equipErr ? String(equipErr).split('\n')[0] : '');
  chk(p.equipment.weapon === 'bronzeGreatsword', '장착 반영', '무기=' + p.equipment.weapon);

  // (b) 전문화: chooseSpec 직접 호출 (모달 버튼 onclick과 동일 경로)
  let specErr = null;
  try { window.chooseSpec('무기'); } catch (e) { specErr = e; }
  chk(!specErr, '전문화 TypeError 없음', specErr ? String(specErr).split('\n')[0] : '');
  chk(p.spec === '무기', '전문화 반영', 'spec=' + p.spec);

  // (c) 펫 가중치 뽑기: rollWeightedPetV34가 전역에서 보이고 분포가 다양한지
  chk(typeof window.rollWeightedPetV34 === 'function' || window.eval('typeof rollWeightedPetV34') === 'function', 'rollWeightedPetV34 전역 접근');
  const counts = {};
  for (let i = 0; i < 200; i++) {
    const id = window.eval('rollWeightedPetV34()');
    counts[id] = (counts[id] || 0) + 1;
  }
  const kinds = Object.keys(counts);
  chk(kinds.length >= 4, '펫 분포 다양성(4종+)', JSON.stringify(counts));
  chk((counts.chick || 0) < 120, '삐약이 편중 없음', 'chick=' + (counts.chick || 0) + '/200');

  // (d) 툴팁: 독립 모듈 경유
  chk(window.__ysTooltipReady === 'v37', 'ui-tooltip.js(v37) 로드됨');
  window.openCharacterPanel(); await sleep(100);
  const holder = window.document.querySelector('#modalContent [data-tooltip]');
  chk(!!holder, '패널 내 data-tooltip 존재');
  if (holder) {
    // v37은 폴링+elementFromPoint 방식: elementFromPoint를 스텁하고 좌표만 전달
    window.document.elementFromPoint = () => holder;
    window.document.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 90, clientY: 90 }));
    await sleep(300);
    const tip = window.document.querySelector('.ys-tooltip-v37');
    chk(tip && tip.style.display === 'block' && tip.innerHTML.length > 5, 'v37 툴팁 표시', tip ? 'len=' + tip.innerHTML.length : '없음');
    // 벗어나면 숨김
    window.document.elementFromPoint = () => window.document.body;
    await sleep(300);
    chk(tip.style.display === 'none', 'v37 툴팁 숨김');
  }
  window.closeModal();

  await sleep(300);
  chk(asyncErrors.length === 0, '비동기 오류 없음', JSON.stringify(asyncErrors.slice(0, 2)));
  console.log(`\n결과: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.log('하네스 실패:', String(e && e.stack || e).split('\n').slice(0, 3).join(' / ')); process.exit(1); });
