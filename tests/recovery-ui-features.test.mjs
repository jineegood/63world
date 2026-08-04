import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const game = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('the recovered skill window keeps the requested two-column progression', () => {
  assert.match(game, /class="skill-common-grid-v35"/);
  assert.match(game, /class="skill-spec-level-v35\$\{single\}"/);
  assert.match(game, /class="skill-tier-link-v35"/);
  assert.match(game, /skill\.prereqAny = level <= 5 \? \[\] : level <= 7/);
  // 스킬 트리는 요청대로 2열을 유지한다.
  assert.match(style, /\.skill-common-grid-v35\{[^}]*repeat\(2,/);
  assert.match(style, /\.skill-spec-level-v35\{[^}]*repeat\(2,/);
  /* 아래 '현재 사용 가능 액티브' 띠는 2026-07-30 350ee08에서 일부러 좁게
     바꿨다(fix: compact active skills). 트리와 달리 한 줄에 여러 개를
     늘어놓아야 해서 화면 폭에 맞춰 칸 수가 줄어든다. */
  assert.match(style, /\.skill-active-strip-v35\{[^}]*repeat\(auto-fit,minmax\(180px,1fr\)\)/);
  assert.match(style, /\.skill-window-v35 \.skill-active-strip-v35\{[^}]*repeat\(6,minmax\(0,1fr\)\)/);
  assert.match(style, /@media[^{]*\{\s*\.skill-window-v35 \.skill-active-strip-v35\{[^}]*repeat\(4,/);
});

test('healing wells and portals retain their visual guidance', () => {
  assert.match(game, /healing-well-quiz-image/);
  assert.match(game, /healing-well-choice-grid/);
  assert.match(game, /drawPortalInteractionRingV60/);
  assert.match(game, /color:'250,204,21'/);
  assert.match(game, /radiusX:58/);
  assert.match(game, /tryClickInteractOnArrivalV59/);
  assert.match(style, /\.healing-well-quiz-image/);
});

test('the latest safe modules are loaded without the authority combat client', () => {
  for (const file of [
    'src/audio-defaults.js',
    'src/login-keys.js',
    'src/quest-dialogue-theme.js',
    'src/workbook-import.js',
    'src/chatgpt-prompt.js',
    'src/remote-motion.js',
  ]) {
    assert.match(html, new RegExp(file.replaceAll('.', '\\.')));
  }
  assert.doesNotMatch(html, /src\/pve-combat-client-v3\.js/);
  assert.doesNotMatch(html, /src\/player-authority-v3\.js/);
});
