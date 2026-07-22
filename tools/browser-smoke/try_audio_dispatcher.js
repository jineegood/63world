const path = require('path');
const run = require(path.join(__dirname, 'harness.js'));
const root = process.argv[2] || path.join(__dirname, '..', '..');

run(root, async ({ window, sleep, asyncErrors }) => {
  const checks = [];
  const check = (name, passed, detail = '') => checks.push({ name, passed, detail });
  window.__G.settings.sfxEnabled = false;
  let syncError = null;
  try { window.eval("playSfx('critical')"); } catch (error) { syncError = String(error?.message || error); }
  await sleep(40);
  check('critical call has no scope error', !syncError, syncError || '');
  check('V23 critical flash exists while muted', !!window.document.querySelector('.critical-flash-v23'));
  check('V24 critical flash exists while muted', !!window.document.querySelector('.critical-flash-v24'));
  check('audio dispatcher smoke has no async errors', asyncErrors.length === 0, asyncErrors.join(' | '));
  let failures = 0;
  for (const { name, passed, detail } of checks) {
    console.log(`${passed ? 'PASS' : 'FAIL'}: ${name}${detail ? ` | ${detail}` : ''}`);
    if (!passed) failures += 1;
  }
  console.log(`RESULT: ${failures === 0 ? 'PASS' : 'FAIL'} ${checks.length - failures}/${checks.length}`);
  process.exit(failures === 0 ? 0 : 1);
}).catch((error) => {
  console.log(String(error?.stack || error));
  process.exit(1);
});
