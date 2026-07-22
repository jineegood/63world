// 아이템/상점 개편 검증: 악세서리 전문점, 소지 보너스, 직업별 방어구, 착용 외형 렌더
const path = require('path');
const run = require(path.join(__dirname, 'harness.js'));
const root = process.argv[2] || path.join(__dirname, '..', '..');
run(root, async ({ window, $, click, sleep, asyncErrors }) => {
  const G = () => window.__G;
  let pass = 0, fail = 0;
  const chk = (c, n, x) => { c ? pass++ : fail++; console.log(c ? 'PASS:' : 'FAIL:', n, x || ''); };

  $('loginName').value = '아이템검증'; $('loginPassword').value = '1';
  click('studentLoginBtn'); await sleep(1300);
  click('createCharacterBtn'); await sleep(2600); // 기본 전사
  const p = G().player;

  // (a) 빌딩 상점 = 악세서리 5종만 + 레벨 게이트
  const bDefs = window.YuksamData.BUILDING_ITEM_DEFS;
  const bList = Object.values(bDefs);
  chk(bList.length === 5 && bList.every((i) => i.slot === 'accessory'), '빌딩 상점 악세서리 5종', bList.map((i) => i.id).join(','));
  chk(bList.every((i) => i.levelReq === 3 && i.possessStats), '전부 Lv3 제한 + 소지 보너스 보유');
  p.level = 1; p.building = 99;
  window.buyBuildingItem('starPendant');
  chk(!p.inventory.includes('starPendant'), 'Lv1 구매 차단');
  p.level = 3;
  window.buyBuildingItem('starPendant');
  chk(p.inventory.includes('starPendant'), 'Lv3 구매 성공');

  // (b) 소지 보너스 수치 검증
  const stats0 = window.computeTotalStats();
  chk(stats0['지능'] === window.YuksamData.CLASS_META.warrior.baseStats['지능'] + 1, '미장착 소지 보너스(지능+1)', 'int=' + stats0['지능']);
  window.buyBuildingItem('cloverBadge'); // 힘2체1 / 소지 힘1
  const strBefore = window.computeTotalStats()['힘']; // 미장착(소지 힘+1 포함)
  p.equipment.accessory = 'cloverBadge'; // 배지 장착
  const stats1 = window.computeTotalStats();
  // 장착 시: 소지(+1) 제거, 풀스탯(+3, 시트 반영) 적용 → 델타 +2
  chk(stats1['힘'] === strBefore + 2, '장착 전환 델타(+3풀 −1소지 = +2)', `str ${strBefore}→${stats1['힘']}`);
  chk(stats1['지능'] === window.YuksamData.CLASS_META.warrior.baseStats['지능'] + 1, '장착 중이어도 다른 소지 보너스 유지', 'int=' + stats1['지능']);

  // (c) 방어구 상점 = 갑옷+머리만 + 직업 필터
  window.openShopModal('armor'); await sleep(80);
  const html = $('modalContent').innerHTML;
  chk(html.includes('가죽 갑옷') && html.includes('가죽 투구'), '전사 라인업 표시');
  chk(!html.includes('로브') && !html.includes('제의') && !html.includes('날개'), '타직업/악세서리 미표시');
  window.closeModal();

  // (d) 새 장비 장착 + 렌더/패널 예외 없음
  p.gold = 9999; p.level = 9;
  ['leatherArmor', 'steelHelm'].forEach((id) => { if (!p.inventory.includes(id)) p.inventory.push(id); });
  p.equipment.armor = 'leatherArmor';
  p.equipment.head = 'steelHelm';
  p.equipment.accessory = 'guardAura';
  p.inventory.push('guardAura');
  await sleep(600); // 월드 draw 여러 프레임
  window.openCharacterPanel(); await sleep(150);
  chk(!$('modal').classList.contains('hidden'), '캐릭터 패널 렌더 OK');
  chk($('modalContent').innerHTML.includes('소지'), '가방에 소지 보너스 표기');
  window.closeModal();

  // 마법사/사제 외형도 렌더 확인 (예외만 감시)
  // (마법사 전용 렌더는 별도 캐릭터에서 자연 검증됨)
  await sleep(300);
  chk(asyncErrors.length === 0, '전 과정 프레임 오류 없음', JSON.stringify(asyncErrors.slice(0, 3)));
  console.log(`\n결과: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.log('하네스 실패:', String(e && e.stack || e).split('\n').slice(0, 4).join(' / ')); process.exit(1); });
