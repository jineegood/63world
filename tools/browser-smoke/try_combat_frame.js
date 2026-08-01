const run = require(require('path').join(__dirname, 'harness.js'));
const root = process.argv[2];
const fs = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;
function check(name, condition, detail = '') {
  if (condition) {
    pass += 1;
    console.log(`PASS: ${name}${detail ? ` | ${detail}` : ''}`);
  } else {
    fail += 1;
    console.log(`FAIL: ${name}${detail ? ` | ${detail}` : ''}`);
  }
}

run(root, async ({ window, $, click, sleep, asyncErrors }) => {
  $('loginName').value = 'frame-smoke';
  $('loginPassword').value = '1234';
  click('studentLoginBtn'); await sleep(1200);
  click('createCharacterBtn'); await sleep(2600);
  try { window.__tutorialDoneV53?.(); } catch {}
  $('game').classList.remove('active');

  const G = window.__G;
  const target = {
    id:'frame-target', name:'프레임 대상', type:'teacherBoss', level:3, alive:true,
    hp:31, maxHp:40, shield:0, chasing:false, stunTurns:0, chillTurns:0,
    x:500, y:500, r:28, ignorePlayerUntil:0,
  };
  G.currentMap = 'forest';
  G.forestMonsters = [target];
  window.openCombat(target);

  const message = '<img src=x> HP -17 / 42 피해 / 9 회복 / 보호막 11';
  window.renderCombatFrame(message, '<button id="frameCallerContent">caller content</button>');
  const heading = $('modalContent').querySelector('.combat-layout .panel-card h3');
  const stage = $('modalContent').querySelector('.combat-stage');
  const playerNumbers = [...heading.querySelectorAll('.damage-number-v25-player')].map((node) => node.textContent);
  const enemyNumbers = [...heading.querySelectorAll('.damage-number-v25-enemy')].map((node) => node.textContent);
  const genericNumbers = [...heading.querySelectorAll('.damage-number-v25-generic')].map((node) => node.textContent);

  check('combat frame renders one layout with caller content', $('modalContent').querySelectorAll('.combat-layout').length === 1 && !!$('frameCallerContent'));
  check('message text is preserved while markup is escaped', heading.textContent === message && !heading.querySelector('img'), heading.innerHTML);
  check('HP loss uses the V25 player number class', playerNumbers.join(',') === '17', playerNumbers.join(','));
  check('damage uses the V25 enemy number class', enemyNumbers.join(',') === '42', enemyNumbers.join(','));
  check('healing and shield use the V25 generic number class', genericNumbers.join(',') === '9,11', genericNumbers.join(','));
  check('V25 output supersedes V23 number spans', heading.querySelectorAll('.damage-number-v23').length === 0);
  check('V27 rollback class owns the final combat stage', stage.classList.contains('combat-layout-rollback-v27'));
  check('V27 removes every temporary V26 background class', ![...stage.classList].some((name) => name === 'combat-bg-v26' || name.startsWith('combat-bg-')));
  check('V20 remains an observable no-op without combat-scene markup', !$('modalContent').querySelector('.combat-slower-v20') && !$('modalContent').querySelector('.combat-scene'));
  const floatingStyle = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  const hasPositiveFloatingStyles =
    /\.combat-floating-damage\.heal\s*\{[^}]*color:\s*#(?:86efac|22c55e)/.test(floatingStyle)
      && /\.combat-floating-damage\.shield\s*\{[^}]*color:\s*#(?:d1d5db|9ca3af)/.test(floatingStyle)
      && /animation:\s*combatFloatingDamage\s+1\.2s/.test(floatingStyle);
  check('floating combat numbers define heal and shield color variants without changing their animation lifetime',
    hasPositiveFloatingStyles,
    hasPositiveFloatingStyles ? '' : (floatingStyle.match(/\.combat-floating-damage[\s\S]*?@keyframes combatFloatingDamage/)?.[0] || 'missing'));

  G.currentCombatMonsterId = 'missing-target';
  let missingError = null;
  try { window.renderCombatFrame('HP -3', '<div id="shouldNotReplaceFrame"></div>'); } catch (error) { missingError = error; }
  const staleHeading = $('modalContent').querySelector('.combat-layout .panel-card h3');
  check('missing target keeps legacy outer-hook rewrite without replacing the frame', !missingError && staleHeading.textContent === 'HP -3' && !$('shouldNotReplaceFrame'), missingError && String(missingError));

  await sleep(80);
  check('combat frame smoke has no async errors', asyncErrors.length === 0, asyncErrors.join(' | '));
  console.log(`RESULT: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 && asyncErrors.length === 0 ? 0 : 1);
}).catch((error) => {
  console.log(String(error?.stack || error));
  process.exit(1);
});
