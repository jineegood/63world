import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/tutorial.js'), 'utf8');

function loadTutorial(window = {}) {
  vm.runInNewContext(source, { window });
  return window;
}

test('first-character tutorial gives approved guidance bold green emphasis', () => {
  const opened = [];
  const window = loadTutorial({
    openModal:(html, options) => opened.push({ html, options }),
  });

  window.startTutorialV53();
  window.__tutorialStepV53(1);
  window.__tutorialStepV53(2);

  const html = opened.map((entry) => entry.html).join('\n');
  for (const text of ['명진쌤', 'W A S D', '방향키', 'E', 'N', 'C', '문제를 맞히면 공격', '5레벨']) {
    const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(
      html,
      new RegExp(`<strong class="quest-keyword-green">${escaped}</strong>`),
      `${text} should use the shared quest-green emphasis`,
    );
  }
  assert.doesNotMatch(html, /<strong[^>]*><strong/);
  const secondStep = opened[1].html;
  assert.ok(
    secondStep.indexOf('data-default-action="true"') < secondStep.indexOf('>이전</button>'),
    'the next action should come first in keyboard order while CSS keeps it on the right',
  );
});

test('tutorial green helper escapes text instead of accepting raw html', () => {
  const window = loadTutorial();
  assert.equal(
    window.tutorialGreenV1('<img src=x>'),
    '<strong class="quest-keyword-green">&lt;img src=x&gt;</strong>',
  );
});

test('E is routed directly to the tutorial next action', () => {
  let handler = null;
  let clicked = 0;
  const next = { click:() => { clicked += 1; } };
  loadTutorial({
    YuksamInputRouter:{
      register:(entry) => { if (entry.id === 'tutorial-default-next-v62') handler = entry.handle; },
    },
    document:{
      querySelector:() => next,
    },
  });
  assert.equal(typeof handler, 'function');
  const event = {
    key:'e',
    preventDefault() {},
    stopImmediatePropagation() {},
  };
  assert.equal(handler(event), true);
  assert.equal(clicked, 1);
});
