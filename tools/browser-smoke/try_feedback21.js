const path = require('path');
const run = require("/sessions/exciting-amazing-mendel/mnt/63world (1)/63world/tools/browser-smoke/harness.js");
run(process.argv[2], async ({ window, $, click, sleep, asyncErrors }) => {
  const G = () => window.__G;
  let pass = 0, fail = 0;
  const chk = (c, n, x) => { c ? pass++ : fail++; console.log(c ? 'PASS:' : 'FAIL:', n, x || ''); };
  $('loginName').value = '피드백검증'; $('loginPassword').value = '1';
  click('studentLoginBtn'); await sleep(1300);
  // 사제로 생성
  const priestBtn = window.document.querySelector('[data-class="priest"]');
  if (priestBtn) priestBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  click('createCharacterBtn'); await sleep(2400);
  const p = G().player;

  // 1) 흰 망토 수락 지급
  window.eval("acceptQuest('tut_equip')"); await sleep(100);
  chk(p.inventory.includes('whiteCloak'), '퀘1 수락 → 흰 망토 지급');

  // 2) 악세서리 퀘: 수락 시 빌딩 5 + 구매 시 진행
  const b0 = p.building;
  window.eval("acceptQuest('tut_accessory')"); await sleep(100);
  chk(p.building === b0 + 5, '악세퀘 수락 → 빌딩 +5', b0 + '→' + p.building);
  p.level = 3;
  window.eval("buyBuildingItem('cloverBadge')"); await sleep(100);
  const q = window.eval("getQuestState('tut_accessory')");
  chk(q && q.status === 'ready', '악세서리 구매 → 퀘스트 달성', q && q.status);

  // 3) 사제 외형 (robe/nurseCap/최종무기 반짝) — 착용 후 렌더 예외 없음
  p.inventory.push('whiteVestment', 'whiteHood', 'dawnTome');
  p.equipment.armor = 'whiteVestment';
  p.equipment.head = 'whiteHood';
  p.equipment.weapon = 'dawnTome';
  await sleep(700); // 여러 프레임 렌더
  chk(asyncErrors.length === 0, '사제 제의+성모 모자+최종무기 렌더 무예외');

  // 4) 스킬 해금: Lv1 공용 자유 습득 / 전문화 레벨 게이트
  G().player.level = 2; // Lv1=0포인트(설계), Lv2부터 2포인트
  window.learnSkill('priest_basic_prayer'); // line3 공용 — 선행 없이 바로
  chk(window.getSkillRank('priest_basic_prayer') === 1, 'Lv2 공용 스킬 순서 무관 습득(선행 폐지)');
  window.learnSkill('priest_holy_focus_v24');
  chk(window.getSkillRank('priest_holy_focus_v24') === 0, '저레벨에서 전문화 잠김(Lv5 게이트)');

  await sleep(200);
  chk(asyncErrors.length === 0, '비동기 오류 없음', JSON.stringify(asyncErrors.slice(0,2)));
  console.log(`\n결과: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.log('하네스 실패:', String(e && e.stack || e).split('\n').slice(0,3).join(' / ')); process.exit(1); });
