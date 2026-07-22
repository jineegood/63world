const run = require(require('path').join(__dirname, 'harness.js'));
const root = process.argv[2];

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

run(root, async ({ window, $, sleep, asyncErrors }) => {
  const G = window.__G;
  const press = (key, type = 'keydown') => {
    const event = new window.KeyboardEvent(type, { key, bubbles:true, cancelable:true });
    window.dispatchEvent(event);
    return event;
  };

  let worldMapEntries = 0;
  window.enterSelectedDungeonV25 = () => { worldMapEntries += 1; };
  G.modalState = { type:'worldmap', pause:true };
  press('e');
  check('world-map E has one owner', worldMapEntries === 1, `calls=${worldMapEntries}`);

  let escapes = 0;
  window.escapeCombat = () => { escapes += 1; return false; };
  G.modalState = { type:'combat', pause:true };
  $('modal').classList.remove('hidden');
  press('Escape');
  check('combat Escape invokes one escape attempt', escapes === 1, `calls=${escapes}`);

  let genericClicks = 0;
  G.modalState = { type:'test-generic', pause:true };
  $('modalContent').innerHTML = '<button id="genericInputChoice">choice</button>';
  $('genericInputChoice').addEventListener('click', () => { genericClicks += 1; });
  window.__combatKeys.refresh();
  $('genericInputChoice').focus();
  await sleep(500);
  check('generic modal has one selected action', window.__combatKeys.buttons().length === 1 && window.__combatKeys.selected()?.id === 'genericInputChoice', `buttons=${window.__combatKeys.buttons().length}, selected=${window.__combatKeys.selected()?.id || 'none'}`);
  press('e');
  check('generic modal E clicks once', genericClicks === 1, `clicks=${genericClicks}`);

  $('modalContent').innerHTML = '<input id="routerTyping"><button id="typingChoice">choice</button>';
  $('typingChoice').addEventListener('click', () => { genericClicks += 1; });
  window.__combatKeys.refresh();
  $('routerTyping').focus();
  press('e');
  check('typing focus isolates generic E', genericClicks === 1, `clicks=${genericClicks}`);

  $('routerTyping').blur();
  $('game').classList.add('active');
  $('modal').classList.add('hidden');
  G.modalState = { type:null, pause:false };
  press('w');
  const pressed = G.keys.w === true;
  G.modalState = { type:'test-generic', pause:true };
  press('w', 'keyup');
  check('movement starts in world context', pressed);
  check('keyup clears movement after context changes', G.keys.w === false, `w=${G.keys.w}`);

  check('input routing produces no async errors', asyncErrors.length === 0, asyncErrors.join(' | '));
  console.log(`RESULT: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 && asyncErrors.length === 0 ? 0 : 1);
}).catch((error) => {
  console.log(String(error?.stack || error));
  process.exit(1);
});
