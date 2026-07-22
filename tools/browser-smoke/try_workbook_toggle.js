const path = require('path');
const run = require(path.join(__dirname, 'harness.js'));
const root = process.argv[2] || path.join(__dirname, '..', '..');

run(root, async ({ window, $, click, sleep, asyncErrors }) => {
  let pass = 0;
  let fail = 0;
  const check = (condition, name, detail = '') => {
    condition ? pass++ : fail++;
    console.log(condition ? 'PASS:' : 'FAIL:', name, detail);
  };

  $('loginName').value = '문제집검증';
  $('loginPassword').value = '1';
  click('studentLoginBtn');
  await sleep(1300);
  click('createCharacterBtn');
  await sleep(2400);

  const getBooks = () => window.getWorkbooks();
  const drawIds = (zone, count = 80) => {
    const ids = new Set();
    for (let i = 0; i < count; i += 1) {
      const question = window.getQuestionForZone(zone);
      if (question) ids.add(question.workbookId);
    }
    return ids;
  };

  const books = getBooks();
  check(books.length >= 2, '기본 문제집 존재', books.map((book) => book.id).join(','));
  const enabledIds = new Set(books.filter((book) => book.enabled !== false).map((book) => book.id));
  const forestDraws = drawIds('silent_forest');
  check([...forestDraws].every((id) => enabledIds.has(id)), '모든 지역에서 활성 문제집만 출제', [...forestDraws].join(','));
  check(forestDraws.size >= 2, '지역 제한 없이 활성 문제집 전체를 사용', [...forestDraws].join(','));

  const first = books[0];
  const disabled = getBooks();
  disabled.find((book) => book.id === first.id).enabled = false;
  window.saveWorkbooks(disabled);
  const afterDisable = drawIds('silent_forest');
  check(!afterDisable.has(first.id), '꺼진 문제집 제외', [...afterDisable].join(','));

  const allOff = getBooks();
  allOff.forEach((book) => { book.enabled = false; });
  window.saveWorkbooks(allOff);
  check(window.getQuestionForZone('silent_forest') === null, '모든 문제집 비활성 시 출제 중단');

  const restored = getBooks();
  restored.forEach((book) => { book.enabled = true; });
  window.saveWorkbooks(restored);
  window.__teacherAuthed_bypass = true;
  window.adminToggleWorkbook(first.id);
  check(getBooks().find((book) => book.id === first.id).enabled === false, '관리자 토글 끄기');
  window.adminToggleWorkbook(first.id);
  check(getBooks().find((book) => book.id === first.id).enabled === true, '관리자 토글 켜기');

  await sleep(200);
  check(asyncErrors.length === 0, '비동기 오류 없음', JSON.stringify(asyncErrors.slice(0, 2)));
  console.log(`\n결과: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
}).catch((error) => {
  console.log('하네스 실패:', String(error?.stack || error).split('\n').slice(0, 3).join(' / '));
  process.exit(1);
});
