import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Script, createContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const read = (file) => readFileSync(join(root, file), 'utf8');

test('core utilities are split into a browser global module loaded before game.js', () => {
  const corePath = join(root, 'src', 'core-utils.js');
  assert.equal(existsSync(corePath), true, 'src/core-utils.js should exist');

  const html = read('index.html');
  const coreScriptIndex = html.indexOf('<script src="src/core-utils.js"></script>');
  const gameScriptIndex = html.indexOf('<script src="game.js"></script>');

  assert.ok(coreScriptIndex > -1, 'index.html should load src/core-utils.js');
  assert.ok(gameScriptIndex > coreScriptIndex, 'src/core-utils.js should load before game.js');
});

test('core utility module exposes the expected behavior', () => {
  const source = read('src/core-utils.js');
  const context = createContext({
    window: {
      crypto: {
        randomUUID: () => 'fixed-id',
      },
    },
    Math,
    Date,
  });
  context.globalThis = context.window;

  new Script(source, { filename: 'src/core-utils.js' }).runInContext(context);

  const core = context.window.YuksamCore;
  assert.equal(typeof core, 'object');
  assert.equal(core.uid(), 'fixed-id');
  assert.equal(core.randomFrom(['a']), 'a');
  assert.equal(core.randomInt(5, 5), 5);
  assert.equal(core.clamp(12, 1, 10), 10);
  assert.equal(core.distance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  assert.equal(core.normalize('  A  B  '), 'ab');
  assert.equal(core.escapeHtml(`<b>'"&`), '&lt;b&gt;&#039;&quot;&amp;');
  assert.equal(typeof core.fmtDate(Date.now()), 'string');
});

test('game.js consumes the split utility module instead of defining local copies', () => {
  const js = read('game.js');

  assert.match(js, /const YuksamCore = window\.YuksamCore;/);
  assert.match(js, /const \{ uid, randomFrom, randomInt, clamp, distance, normalize, escapeHtml, fmtDate \} = YuksamCore;/);
  assert.doesNotMatch(js, /function uid\(\)/);
  assert.doesNotMatch(js, /function randomFrom\(arr\)/);
  assert.doesNotMatch(js, /function randomInt\(min, max\)/);
  assert.doesNotMatch(js, /function clamp\(v, min, max\)/);
  assert.doesNotMatch(js, /function distance\(a, b\)/);
  assert.doesNotMatch(js, /function escapeHtml\(v\)/);
});
