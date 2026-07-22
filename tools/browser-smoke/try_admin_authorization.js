const path = require('path');
const run = require(path.join(__dirname, 'harness.js'));
const root = process.argv[2] || path.join(__dirname, '..', '..');

run(root, async ({ window, $, asyncErrors }) => {
  const playerName = '관리대상';
  window.__G.selectedClass = 'warrior';
  window.__G.currentPassword = 'admin-test';
  window.__G.currentAppearance = {};
  window.__G.player = window.eval(`createNewPlayer(${JSON.stringify(playerName)})`);
  window.eval('savePlayer()');
  window.__G.player = null;

  const playerKey = window.eval(`playerKey(${JSON.stringify(playerName)})`);
  const workbooksKey = window.YuksamData.STORAGE.workbooks;
  const teacherKey = 'ysb_teacher_v1';
  const workbookId = JSON.parse(window.localStorage.getItem(workbooksKey))[0].id;
  const before = {
    player: window.localStorage.getItem(playerKey),
    workbooks: window.localStorage.getItem(workbooksKey),
    teacher: window.localStorage.getItem(teacherKey),
  };

  window.grantBuildingToStudent(playerName);
  window.adminToggleWorkbook(workbookId);
  window.adminSetServerOpen(false);
  const afterBlocked = {
    player: window.localStorage.getItem(playerKey),
    workbooks: window.localStorage.getItem(workbooksKey),
    teacher: window.localStorage.getItem(teacherKey),
  };

  const checks = [];
  const check = (name, passed) => checks.push({ name, passed });
  check('unauthenticated player mutation is blocked', afterBlocked.player === before.player);
  check('unauthenticated workbook mutation is blocked', afterBlocked.workbooks === before.workbooks);
  check('unauthenticated teacher setting mutation is blocked', afterBlocked.teacher === before.teacher);

  window.eval('openTeacherLogin()');
  $('teacherPw').value = '6363';
  window.adminTeacherLogin();
  window.grantBuildingToStudent(playerName);
  window.adminToggleWorkbook(workbookId);
  window.adminSetServerOpen(false);

  const player = JSON.parse(window.localStorage.getItem(playerKey));
  const workbooks = JSON.parse(window.localStorage.getItem(workbooksKey));
  const teacher = JSON.parse(window.localStorage.getItem(teacherKey));
  check('authenticated player mutation succeeds', player.building === JSON.parse(before.player).building + 1);
  check('authenticated workbook mutation succeeds', workbooks[0].enabled !== JSON.parse(before.workbooks)[0].enabled);
  check('authenticated teacher setting mutation succeeds', teacher.serverOpen === false);
  check('administrator authorization smoke has no async errors', asyncErrors.length === 0);

  let failures = 0;
  for (const { name, passed } of checks) {
    console.log(`${passed ? 'PASS' : 'FAIL'}: ${name}`);
    if (!passed) failures += 1;
  }
  console.log(`RESULT: ${failures === 0 ? 'PASS' : 'FAIL'} ${checks.length - failures}/${checks.length}`);
  process.exit(failures === 0 ? 0 : 1);
}).catch((error) => {
  console.log(String(error?.stack || error));
  process.exit(1);
});
