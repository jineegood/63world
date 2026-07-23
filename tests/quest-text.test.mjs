import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');

function loadApi() {
  const window = {};
  const source = fs.readFileSync(path.join(root, 'src/quest-text.js'), 'utf8');
  vm.runInNewContext(source, { window }, { filename:'src/quest-text.js' });
  return window.YuksamQuestText;
}

test('quest emphasis safely escapes text before adding approved highlights', () => {
  const html = loadApi().emphasize('<script>alert(1)</script> N키로 스킬창을 열고 버섯돌이를 처치하세요.');
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<strong class="quest-keyword-yellow">N키<\/strong>/);
  assert.match(html, /<strong class="quest-keyword-yellow">스킬창<\/strong>/);
  assert.match(html, /<strong class="quest-keyword-green">버섯돌이<\/strong>/);
  assert.match(html, /<strong class="quest-keyword-green">처치<\/strong>/);
});

test('quest dialogue and tracker use emphasis without changing chat rendering', () => {
  const game = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
  const dialogue = game.match(/function renderNpcDialogueV21\(\) \{[\s\S]*?\n  }/)?.[0] || '';
  const tracker = game.match(/updateQuestTracker = function updateQuestTrackerV21\(\) \{[\s\S]*?\n  };/)?.[0] || '';
  const chat = game.match(/function appendChatMessage\([\s\S]*?\n}/)?.[0] || '';
  assert.match(dialogue, /YuksamQuestText\.emphasize\(text\)/);
  assert.match(dialogue, /YuksamQuestText\.emphasize\(opt\.label\)/);
  assert.match(tracker, /YuksamQuestText\.emphasize\(def\.title\)/);
  assert.match(tracker, /YuksamQuestText\.emphasize\(def\.desc\)/);
  assert.doesNotMatch(chat, /YuksamQuestText/);
});

test('quest highlight colors are bold yellow and green', () => {
  const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  assert.match(style, /\.quest-keyword-yellow\s*\{[^}]*color:#fde047;[^}]*font-weight:900/);
  assert.match(style, /\.quest-keyword-green\s*\{[^}]*color:#4ade80;[^}]*font-weight:900/);
});
