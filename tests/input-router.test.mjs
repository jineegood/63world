import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { Script, createContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const source = readFileSync(join(root, 'src', 'input-router.js'), 'utf8');
const gameSource = readFileSync(join(root, 'game.js'), 'utf8');
const combatKeysSource = readFileSync(join(root, 'src', 'combat-keys.js'), 'utf8');
const indexSource = readFileSync(join(root, 'index.html'), 'utf8');

function loadRouter() {
  const listeners = { keydown:[], keyup:[] };
  const window = {
    addEventListener(type, handler, capture) {
      if (listeners[type]) listeners[type].push({ handler, capture });
    },
  };
  const context = createContext({ window, Object, Number, String, Error });
  new Script(source, { filename:'src/input-router.js' }).runInContext(context);
  return { router:window.YuksamInputRouter, listeners };
}

test('router installs exactly one capture listener for keydown and keyup', () => {
  const { listeners } = loadRouter();
  assert.equal(listeners.keydown.length, 1);
  assert.equal(listeners.keyup.length, 1);
  assert.equal(listeners.keydown[0].capture, true);
  assert.equal(listeners.keyup[0].capture, true);
});

test('higher priority runs first, ties are stable, and true consumes later handlers', () => {
  const { router, listeners } = loadRouter();
  const events = [];
  router.register({ id:'low', type:'keydown', priority:10, handle:() => events.push('low') });
  router.register({ id:'high-a', type:'keydown', priority:20, handle:() => { events.push('high-a'); return false; } });
  router.register({ id:'high-b', type:'keydown', priority:20, handle:() => { events.push('high-b'); return true; } });

  listeners.keydown[0].handler({ key:'e' });
  assert.deepEqual(events, ['high-a', 'high-b']);
});

test('unregister removes a handler and duplicate active ids are rejected', () => {
  const { router, listeners } = loadRouter();
  const events = [];
  const remove = router.register({ id:'one', type:'keyup', handle:() => events.push('one') });
  assert.throws(() => router.register({ id:'one', type:'keydown', handle:() => {} }), /Duplicate input handler/);
  remove();
  listeners.keyup[0].handler({ key:'w' });
  assert.deepEqual(events, []);
  assert.doesNotThrow(() => router.register({ id:'one', type:'keydown', handle:() => {} }));
});

test('production input handlers register through the router only', () => {
  assert.match(indexSource, /src\/input-router\.js[\s\S]*game\.js/);
  assert.match(gameSource, /YuksamInputRouter\.register/);
  assert.match(combatKeysSource, /YuksamInputRouter\.register/);
  assert.doesNotMatch(gameSource, /window\.addEventListener\(['"]key(?:down|up)['"]/);
  assert.doesNotMatch(combatKeysSource, /window\.addEventListener\(['"]key(?:down|up)['"]/);
  assert.equal((source.match(/global\.addEventListener\('keydown'/g) || []).length, 1);
  assert.equal((source.match(/global\.addEventListener\('keyup'/g) || []).length, 1);
});

test('space remains ordinary text while the chat input has focus', () => {
  assert.match(gameSource, /if \(e\.code === 'Space' && !typing\)/);
  assert.doesNotMatch(gameSource, /if \(e\.code === 'Space'\) \{\s*e\.preventDefault\(\)/);
});

test('real browser routing keeps one owner per context and releases movement across contexts', { timeout:30000 }, () => {
  const script = join(root, 'tools', 'browser-smoke', 'try_input_router.js');
  const result = spawnSync(process.execPath, [script, root], { encoding:'utf8', timeout:25000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PASS: world-map E has one owner/);
  assert.match(result.stdout, /PASS: combat Escape invokes one escape attempt/);
  assert.match(result.stdout, /PASS: typing focus isolates generic E/);
  assert.match(result.stdout, /PASS: keyup clears movement after context changes/);
});
