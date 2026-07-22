// v38 퀘스트 체인 검증: 튜토리얼(행동형) 인프라 + 보상 아이템 + 처치형 유지
const path = require('path');
const run = require(path.join(__dirname, 'harness.js'));
const root = process.argv[2] || path.join(__dirname, '..', '..');
run(root, async ({ window, $, click, sleep, asyncErrors }) => {
  const G = () => window.__G;
  let pass = 0, fail = 0;
  const chk = (c, n, x) => { c ? pass++ : fail++; console.log(c ? 'PASS:' : 'FAIL:', n, x || ''); };
  const qs = (id) => G().player.quests[id] || null;
  const ev = (code) => window.eval(code);

  $('loginName').value = '퀘스트검증'; $('loginPassword').value = '1';
  click('studentLoginBtn'); await sleep(1300);
  click('createCharacterBtn'); await sleep(2600);
  chk(!!G().player, '캐릭터 생성', G().player && G().player.name);

  // (a) 새 체인 순서: 1번 퀘스트 = tut_equip 제안 (첫 페이지 텍스트 → 마지막 페이지의 수락 버튼)
  ev('startQuestStory()'); await sleep(120);
  const dlgFirst = $('modalContent') ? $('modalContent').innerHTML : '';
  ev('nextDialoguePage()'); ev('nextDialoguePage()'); await sleep(120);
  const dlgLast = $('modalContent') ? $('modalContent').innerHTML : '';
  chk(dlgFirst.includes('새 모험가') && dlgLast.includes("acceptCurrentQuest('tut_equip')"), '(a) tut_equip 최초 제안', '');
  ev('closeModal()'); await sleep(100);

  // (a) 수락
  ev("acceptQuest('tut_equip')"); await sleep(100);
  chk(qs('tut_equip') && qs('tut_equip').status === 'accepted', '(a) tut_equip 수락', qs('tut_equip') && qs('tut_equip').status);

  // (b) 장착 훅 → ready → 완료 보상
  const weaponId = G().player.inventory[0];
  const goldBefore = G().player.gold;
  ev(`equipItem('${weaponId}')`); await sleep(150);
  chk(qs('tut_equip').status === 'ready', '(b) 장착 훅으로 목표 달성', qs('tut_equip').status);
  ev("claimQuestReward('tut_equip')"); await sleep(150);
  chk(qs('tut_equip').status === 'completed', '(b) tut_equip 완료', qs('tut_equip').status);
  chk(G().player.gold === goldBefore + 35, '(b) 보상 골드 +35 지급', `${goldBefore}->${G().player.gold}`);

  // (c) 구매 훅
  ev("acceptQuest('tut_shop')"); await sleep(60);
  G().player.gold = 999;
  ev("buyItem('noviceHat','all')"); await sleep(150);
  chk(qs('tut_shop').progress >= 1 && qs('tut_shop').status === 'ready', '(c) 구매 훅 진행', qs('tut_shop').status);

  // (c) 강화 훅 (빌딩 차감 시도 = 진행, 성공/실패 무관)
  ev("acceptQuest('tut_enhance')"); await sleep(60);
  G().player.building = 50;
  ev('upgradeCurrentWeaponV33()'); await sleep(150);
  chk(qs('tut_enhance').progress >= 1 && qs('tut_enhance').status === 'ready', '(c) 강화 훅 진행', qs('tut_enhance').status);

  // (c) 펫 훅 (소환 확정은 약 5초 후)
  ev("acceptQuest('tut_pet')"); await sleep(60);
  G().player.building = 50;
  ev('rollPetV34()'); await sleep(5400);
  chk(qs('tut_pet').progress >= 1 && qs('tut_pet').status === 'ready', '(c) 펫 훅 진행', qs('tut_pet').status);

  // (d) 수정시트 기준 elite_slime_hunt 완료 시 honorCrown 지급
  ev("acceptQuest('elite_slime_hunt')"); await sleep(60);
  ev("incrementQuestProgressByMonster({type:'slime', elite:true})"); await sleep(30);
  chk(qs('elite_slime_hunt').status === 'ready', '(d) 엘리트 슬라임 처치 목표 달성', qs('elite_slime_hunt').status);
  const hadCrown = G().player.inventory.includes('honorCrown');
  ev("claimQuestReward('elite_slime_hunt')"); await sleep(150);
  chk(!hadCrown && G().player.inventory.includes('honorCrown'), '(d) honorCrown 인벤 지급', '');

  // (e) 처치형 퀘스트(버섯 4) 수정시트 목표 유지
  ev("acceptQuest('mushroom_hunt')"); await sleep(60);
  for (let i = 0; i < 4; i++) { ev("incrementQuestProgressByMonster({type:'mushroom', elite:false})"); await sleep(30); }
  chk(qs('mushroom_hunt').status === 'ready' && qs('mushroom_hunt').progress === 4, '(e) 버섯 4처치 수정시트 목표 유지', qs('mushroom_hunt').progress);

  // actionType 퀘스트가 처치 인정/추적 UI에서 오류를 내지 않는지 (가드 확인)
  ev("incrementQuestProgressByMonster({type:'slime', elite:false})"); await sleep(30);
  ev('updateQuestTracker()'); await sleep(30);

  // (f) 비동기 오류 0
  await sleep(200);
  chk(asyncErrors.length === 0, '(f) 비동기 오류 없음', JSON.stringify(asyncErrors.slice(0, 3)));

  console.log(`\n결과: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.log('하네스 실패:', String(e && e.stack || e).split('\n').slice(0, 5).join(' / ')); process.exit(1); });
