const path = require('path');
const run = require(path.join(__dirname, 'harness.js'));
const root = process.argv[2] || path.join(__dirname, '..', '..');

run(root, async ({ window, $, asyncErrors }) => {
  const game = window.__G;
  const checks = [];
  const check = (name, passed, detail = '') => {
    checks.push({ name, passed });
    console.log(`${passed ? 'PASS' : 'FAIL'}: ${name}${detail ? ` | ${detail}` : ''}`);
  };
  const hasUsableWorkbookShape = (workbooks) => Array.isArray(workbooks) && workbooks.length > 0
    && workbooks.every((workbook) => typeof workbook?.id === 'string' && workbook.id.length > 0
      && typeof workbook.enabled === 'boolean' && Array.isArray(workbook.questions));

  window.localStorage.clear();
  game.selectedClass = 'warrior';
  game.currentPassword = 'storage-test-password';
  game.currentAppearance = {};
  game.player = window.eval("createNewPlayer('저장안전망')");
  game.player.pets = ['owl'];
  game.player.activePet = 'owl';
  window.eval('savePlayer()');

  const accountKey = window.eval("playerKey(' 저장안전망 ')");
  const storedKeys = () => Array.from({ length:window.localStorage.length }, (_, index) => window.localStorage.key(index))
    .filter((key) => key && key.includes('저장안전망'));

  const rawAfterSave = JSON.parse(window.localStorage.getItem(accountKey));
  check('save raw JSON preserves pet fields', rawAfterSave?.pets?.length === 1 && rawAfterSave.pets[0] === 'owl' && rawAfterSave.activePet === 'owl');
  check('save creates one trimmed account key', storedKeys().length === 1 && storedKeys()[0] === accountKey, storedKeys().join(','));
  game.player.gold = 999;
  const reloaded = window.eval("loadPlayer('저장안전망')");
  check('load returns persisted data instead of unsaved memory', reloaded?.gold === 20, `gold=${reloaded?.gold}`);
  check('load preserves pet fields', reloaded?.pets?.length === 1 && reloaded.pets[0] === 'owl' && reloaded.activePet === 'owl');
  game.player = reloaded;
  window.eval('savePlayer()');
  const resaved = window.eval(`loadPlayer(${JSON.stringify(reloaded.name)})`);
  check('save preserves pet fields', resaved?.pets?.length === 1 && resaved.pets[0] === 'owl' && resaved.activePet === 'owl');
  const listed = window.eval('getAllPlayers()');
  check('player listing preserves pet fields', listed[0]?.pets?.length === 1 && listed[0].pets[0] === 'owl' && listed[0].activePet === 'owl');
  const invalidPets = window.eval("normalizePlayer({ pets: 'owl', activePet: 42 })");
  check('invalid pet fields normalize to defaults', Array.isArray(invalidPets.pets) && invalidPets.pets.length === 0 && invalidPets.activePet === null);
  const absentPets = window.eval('normalizePlayer({})');
  check('absent pet fields normalize to defaults', Array.isArray(absentPets.pets) && absentPets.pets.length === 0 && absentPets.activePet === null);
  check('saved account appears once in player listing', listed.length === 1 && listed[0].name === '저장안전망', `count=${listed.length}`);

  window.eval('openTeacherLogin()');
  $('teacherPw').value = '6363';
  window.adminTeacherLogin();
  window.adminOpenGrantModal('저장안전망');
  $('grantGold').value = '7';
  $('grantBuildingAmt').value = '3';
  $('grantExp').value = '5';
  window.adminGrantReward('저장안전망');
  const rewarded = window.eval("loadPlayer('저장안전망')");
  const rawAfterAdminReward = JSON.parse(window.localStorage.getItem(accountKey));
  check('administrator reward raw JSON preserves pet fields', rawAfterAdminReward?.pets?.length === 1 && rawAfterAdminReward.pets[0] === 'owl' && rawAfterAdminReward.activePet === 'owl');
  check('administrator reward persists all requested values', rewarded?.gold === 27 && rewarded?.building === 3 && rewarded?.exp === 5,
    `gold=${rewarded?.gold}, building=${rewarded?.building}, exp=${rewarded?.exp}`);
  check('administrator reward preserves account name and storage key', rewarded?.name === '저장안전망' && storedKeys().length === 1 && storedKeys()[0] === accountKey);

  const corruptKey = window.eval("playerKey('손상계정')");
  const classifierKey = window.eval("playerKey('분류계정')");
  window.localStorage.removeItem(classifierKey);
  check('absent player storage is classified explicitly', window.eval("readPlayerStorage('분류계정')").status === 'absent');
  check('valid player storage is classified explicitly', window.eval("readPlayerStorage('저장안전망')").status === 'valid');
  for (const raw of ['{broken-json', 'null', '[]', '"text"', '42', 'true']) {
    window.localStorage.setItem(classifierKey, raw);
    const classified = window.eval("readPlayerStorage('분류계정')");
    check(`corrupt player value is classified without mutation: ${raw}`,
      classified.status === 'corrupt' && window.localStorage.getItem(classifierKey) === raw);
  }
  window.localStorage.removeItem(classifierKey);
  check('administrator reward preserves pet fields', rewarded?.pets?.length === 1 && rewarded.pets[0] === 'owl' && rewarded.activePet === 'owl');

  const workbooksKey = window.YuksamData.STORAGE.workbooks;
  const corruptWorkbooksRaw = '{broken-json';
  window.localStorage.setItem(workbooksKey, corruptWorkbooksRaw);
  const workbooksFromCorruptJson = window.eval('getWorkbooks()');
  check('corrupt workbook JSON returns usable normalized defaults', hasUsableWorkbookShape(workbooksFromCorruptJson));
  check('corrupt workbook JSON remains byte-for-byte unchanged', window.localStorage.getItem(workbooksKey) === corruptWorkbooksRaw,
    `stored=${window.localStorage.getItem(workbooksKey)}`);

  const nonArrayWorkbooksRaw = '{"unexpected":true}';
  window.localStorage.setItem(workbooksKey, nonArrayWorkbooksRaw);
  const workbooksFromNonArray = window.eval('getWorkbooks()');
  check('non-array workbook JSON returns usable normalized defaults', hasUsableWorkbookShape(workbooksFromNonArray));
  check('non-array workbook JSON remains byte-for-byte unchanged', window.localStorage.getItem(workbooksKey) === nonArrayWorkbooksRaw,
    `stored=${window.localStorage.getItem(workbooksKey)}`);

  const legacyQuestionsKey = window.YuksamData.STORAGE.questions;
  const legacyQuestion = { id: 'legacy-storage-question', q: '2 + 2 = ?', answer: '4' };
  window.localStorage.removeItem(workbooksKey);
  window.localStorage.setItem(legacyQuestionsKey, JSON.stringify([legacyQuestion]));
  const migratedWorkbooks = window.eval('getWorkbooks()');
  const persistedMigratedWorkbooks = JSON.parse(window.localStorage.getItem(workbooksKey));
  check('absent current workbook key migrates legacy questions into usable normalized workbook',
    hasUsableWorkbookShape(migratedWorkbooks) && migratedWorkbooks[0].questions.some((question) => question.id === legacyQuestion.id));
  check('legacy migration persists usable normalized workbook in current key',
    hasUsableWorkbookShape(persistedMigratedWorkbooks) && persistedMigratedWorkbooks[0].questions.some((question) => question.id === legacyQuestion.id));

  window.localStorage.removeItem(workbooksKey);
  window.localStorage.removeItem(legacyQuestionsKey);
  const initializedWorkbooks = window.eval('getWorkbooks()');
  const persistedWorkbooks = JSON.parse(window.localStorage.getItem(workbooksKey));
  check('truly absent workbook state returns usable normalized defaults', hasUsableWorkbookShape(initializedWorkbooks));
  check('truly absent workbook state persists usable normalized defaults', hasUsableWorkbookShape(persistedWorkbooks));

  window.localStorage.setItem(corruptKey, '{broken-json');
  check('corrupted player JSON returns null', window.eval("loadPlayer('손상계정')") === null);
  window.eval("deletePlayer('손상계정')");
  window.eval("deletePlayer('저장안전망')");
  check('delete removes the saved account', window.eval("loadPlayer('저장안전망')") === null && !window.localStorage.getItem(accountKey));
  check('storage smoke produced no async errors', asyncErrors.length === 0, asyncErrors.join(' | '));

  const failures = checks.filter((entry) => !entry.passed).length;
  console.log(`RESULT: ${failures === 0 ? 'PASS' : 'FAIL'} ${checks.length - failures}/${checks.length}`);
  process.exit(failures === 0 ? 0 : 1);
}).catch((error) => {
  console.log(String(error?.stack || error));
  process.exit(1);
});
