const path = require('path');
const run = require(path.join(__dirname, 'harness.js'));
const root = process.argv[2] || path.join(__dirname, '..', '..');
const accountName = '손상계정';
const accountKey = `ysb_player_${accountName}`;

async function runCase({ name, raw, password, waitAfterLogin, verify, directCreate = false }) {
  let result = null;
  await run(root, async ({ window, $, click, sleep, asyncErrors }) => {
    $('loginName').value = accountName;
    $('loginPassword').value = password;
    click('studentLoginBtn');
    await sleep(waitAfterLogin);
    if (directCreate) {
      click('createCharacterBtn');
      await sleep(50);
    }
    const failure = verify({ window, $, storedRaw: window.localStorage.getItem(accountKey) });
    result = {
      name,
      passed: !failure && asyncErrors.length === 0,
      detail: failure || asyncErrors.join(' | '),
    };
  }, {
    beforeLoad({ window }) {
      if (raw !== null) window.localStorage.setItem(accountKey, raw);
    },
  });
  return result;
}

async function main() {
  const corruptRaw = '{broken-json';
  const validRaw = JSON.stringify({
    name: accountName,
    password: 'correct-password',
    class: 'warrior',
    level: 1,
    exp: 0,
    gold: 20,
    building: 0,
    inventory: [],
    equipment: {},
  });
  const results = [];

  results.push(await runCase({
    name: 'corrupt player login and direct creation preserve exact bytes',
    raw: corruptRaw,
    password: 'test-password',
    waitAfterLogin: 1900,
    directCreate: true,
    verify: ({ window, $, storedRaw }) => {
      if ($('creator').classList.contains('active')) return 'creator became active';
      if (window.__G.player !== null) return 'runtime player was created';
      if (storedRaw !== corruptRaw) return `stored=${storedRaw}`;
      return '';
    },
  }));

  results.push(await runCase({
    name: 'absent player reaches creator and creates one saved account',
    raw: null,
    password: 'new-password',
    waitAfterLogin: 1900,
    directCreate: true,
    verify: ({ window, storedRaw }) => {
      const stored = storedRaw ? JSON.parse(storedRaw) : null;
      if (!stored || stored.name !== accountName || stored.password !== 'new-password') return `stored=${storedRaw}`;
      if (window.__G.player?.name !== accountName) return 'runtime player missing';
      return '';
    },
  }));

  results.push(await runCase({
    name: 'valid player with matching password enters game with stable identity',
    raw: validRaw,
    password: 'correct-password',
    waitAfterLogin: 100,
    verify: ({ window, $, storedRaw }) => {
      const stored = storedRaw ? JSON.parse(storedRaw) : null;
      if (!$('game').classList.contains('active')) return 'game screen not active';
      if (window.__G.player?.name !== accountName) return 'runtime identity changed';
      if (stored?.name !== accountName || stored?.password !== 'correct-password') return `stored=${storedRaw}`;
      return '';
    },
  }));

  results.push(await runCase({
    name: 'valid player with wrong password stays out of creator without writes',
    raw: validRaw,
    password: 'wrong-password',
    waitAfterLogin: 100,
    verify: ({ window, $, storedRaw }) => {
      if ($('creator').classList.contains('active') || $('game').classList.contains('active')) return 'protected screen became active';
      if (window.__G.player !== null) return 'runtime player was set';
      if (storedRaw !== validRaw) return `stored=${storedRaw}`;
      return '';
    },
  }));

  let failures = 0;
  for (const { name, passed, detail } of results) {
    console.log(`${passed ? 'PASS' : 'FAIL'}: ${name}${detail ? ` | ${detail}` : ''}`);
    if (!passed) failures += 1;
  }
  console.log(`RESULT: ${failures === 0 ? 'PASS' : 'FAIL'} ${results.length - failures}/${results.length}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.log(String(error?.stack || error));
  process.exit(1);
});
