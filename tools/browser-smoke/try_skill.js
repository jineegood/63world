const run = require(require('path').join(__dirname, 'harness.js'));
const root = process.argv[2];
run(root, async ({ window, $, click, sleep, asyncErrors }) => {
  $('loginName').value = '검증용';
  $('loginPassword').value = '1234';
  click('studentLoginBtn'); await sleep(1200);
  console.log('생성화면 active:', window.document.querySelector('#creator')?.classList.contains('active'));
  click('createCharacterBtn'); await sleep(2500);
  console.log('플레이어:', window.game?.player?.name, '/ 맵:', window.game?.currentMap);
  try {
    window.openSkillTreeModal();
    const html = $('modalContent').innerHTML;
    console.log('스킬창 OK, 노드:', (html.match(/skill-node-v35|skill-card-v35|v35-skill/g) || []).length, ', 레인:', (html.match(/skill-lane-v35|skill-branch-v35/g) || []).length);
  } catch (e) {
    console.log('!!! 스킬창 오류:', String(e).split('\n')[0]);
  }
  console.log('비동기 오류 수:', asyncErrors.length, asyncErrors.slice(0,2));
  process.exit(0);
}).catch((e) => { console.log('!!! 하네스 실패:', String(e).split('\n')[0]); process.exit(1); });
