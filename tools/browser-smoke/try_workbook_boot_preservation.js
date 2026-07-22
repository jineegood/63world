const path = require('path');
const run = require(path.join(__dirname, 'harness.js'));
const root = process.argv[2] || path.join(__dirname, '..', '..');
const workbooksKey = 'ysb_workbooks_v3';

async function bootCase({ name, raw, verify }) {
  let result = null;
  await run(root, async ({ window, asyncErrors }) => {
    const storedRaw = window.localStorage.getItem(workbooksKey);
    result = {
      name,
      passed: verify(storedRaw) && asyncErrors.length === 0,
      detail: `stored=${storedRaw} errors=${asyncErrors.join(' | ')}`,
    };
    window.close();
  }, {
    beforeLoad({ window }) {
      if (raw !== null) window.localStorage.setItem(workbooksKey, raw);
    },
  });
  return result;
}

async function main() {
  const corruptRaw = '{broken-json';
  const nonArrayRaw = '{"unexpected":true}';
  const validWithoutSwamp = JSON.stringify([{
    id: 'wb_boot_test',
    name: 'Boot Test',
    zone: 'silent_forest',
    enabled: true,
    questions: [],
  }]);
  const validWithSwamp = JSON.stringify([{
    id: 'wb_existing_swamp',
    name: 'Existing Swamp',
    zone: 'spooky_swamp',
    enabled: true,
    questions: [],
  }]);

  const cases = [
    {
      name: 'boot preserves exact corrupt workbook bytes',
      raw: corruptRaw,
      verify: (storedRaw) => storedRaw === corruptRaw,
    },
    {
      name: 'boot preserves exact non-array workbook bytes',
      raw: nonArrayRaw,
      verify: (storedRaw) => storedRaw === nonArrayRaw,
    },
    {
      name: 'absent workbook storage initializes defaults with one swamp workbook',
      raw: null,
      verify: (storedRaw) => {
        const books = JSON.parse(storedRaw);
        return Array.isArray(books) && books.filter((book) => book.zone === 'spooky_swamp').length === 1;
      },
    },
    {
      name: 'valid workbook storage receives one missing swamp workbook',
      raw: validWithoutSwamp,
      verify: (storedRaw) => {
        const books = JSON.parse(storedRaw);
        return books.some((book) => book.id === 'wb_boot_test')
          && books.filter((book) => book.zone === 'spooky_swamp').length === 1;
      },
    },
    {
      name: 'valid workbook storage with swamp data is not rewritten or duplicated',
      raw: validWithSwamp,
      verify: (storedRaw) => storedRaw === validWithSwamp
        && JSON.parse(storedRaw).filter((book) => book.zone === 'spooky_swamp').length === 1,
    },
  ];

  const results = [];
  for (const testCase of cases) results.push(await bootCase(testCase));
  let failures = 0;
  for (const { name, passed, detail } of results) {
    console.log(`${passed ? 'PASS' : 'FAIL'}: ${name}${passed ? '' : ` | ${detail}`}`);
    if (!passed) failures += 1;
  }
  console.log(`RESULT: ${failures === 0 ? 'PASS' : 'FAIL'} ${results.length - failures}/${results.length}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.log(String(error?.stack || error));
  process.exit(1);
});
