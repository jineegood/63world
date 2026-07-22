// UI 개선 검증 (요청 3/4/5/6/8)
const run = require(require('path').join(__dirname, 'harness.js'));
const fs = require('fs');
const path = require('path');
const root = process.argv[2];

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS' : 'FAIL') + ' — ' + msg); if (!cond) fails += 1; };

run(root, async ({ window, $, click, sleep, asyncErrors }) => {
  $('loginName').value = 'UI검증';
  $('loginPassword').value = '1234';
  click('studentLoginBtn'); await sleep(1200);
  click('createCharacterBtn'); await sleep(2500);
  console.log('플레이어:', window.game?.player?.name, '/ 맵:', window.game?.currentMap);

  window.openCharacterPanel();
  await sleep(200);
  const html = $('modalContent').innerHTML;

  // (a) 능력치 설명 툴팁 4종
  ok(html.includes('힘은 전사의 공격력에 작용하는 능력치입니다.'), '힘 능력치 설명 툴팁');
  ok(html.includes('지능은 마법사의 공격력에 작용하는 능력치입니다.'), '지능 능력치 설명 툴팁');
  ok(html.includes('정신은 사제의 공격력에 작용하는 능력치입니다.'), '정신 능력치 설명 툴팁');
  ok(html.includes('체력은 캐릭터의 체력을 올려주는 능력치입니다.'), '체력 능력치 설명 툴팁');

  // (b) 장비 슬롯 툴팁에 스탯 문자열 포함 (기본 무기 힘/지능/정신 +1 장착)
  const modalEl = $('modalContent');
  const slotTips = [...modalEl.querySelectorAll('.equip-slot[data-tooltip]')].map((e)=>e.getAttribute('data-tooltip'));
  const hasStatInSlot = slotTips.some((t)=> /(?:힘|지능|정신|체력) \+\d/.test(t || ''));
  ok(hasStatInSlot, '장비 슬롯 툴팁에 스탯(예: 힘 +1) 포함');

  // (c) 스킬포인트 표기 · 스킬P 부재
  ok(html.includes('스킬포인트'), '"스킬포인트" 표기 존재');
  ok(!/스킬P(?![가-힣])/.test(html), '"스킬P" 표기 부재');

  // (d) HUD 바 마크업 + 채움 width 갱신
  const idx = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  ok(idx.includes('id="hudHpFill"') && idx.includes('id="hudExpFill"'), 'index.html HUD 바 fill 마크업 존재');
  ok(idx.includes('hud-meter-hp') && idx.includes('hud-meter-exp'), 'index.html HUD 바 컨테이너 마크업 존재');

  window.updateHud();
  await sleep(30);
  const hpFillW = $('hudHpFill') && $('hudHpFill').style.width;
  const expFillW = $('hudExpFill') && $('hudExpFill').style.width;
  ok(!!hpFillW && hpFillW.endsWith('%'), 'updateHud 후 HP fill width 갱신 (' + hpFillW + ')');
  ok(!!expFillW && expFillW.endsWith('%'), 'updateHud 후 EXP fill width 갱신 (' + expFillW + ')');

  ok(asyncErrors.length === 0, '비동기 오류 없음 ' + JSON.stringify(asyncErrors.slice(0,2)));

  console.log(fails === 0 ? '\n=== ALL UI CHECKS PASSED ===' : ('\n=== ' + fails + ' UI CHECK(S) FAILED ==='));
  process.exit(fails === 0 ? 0 : 1);
}).catch((e) => { console.log('!!! 하네스 실패:', String(e).stack || e); process.exit(1); });
