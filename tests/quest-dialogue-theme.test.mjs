import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function loadApi() {
  const window = {};
  vm.runInNewContext(read('src/quest-dialogue-theme.js'), { window }, { filename:'src/quest-dialogue-theme.js' });
  return window.YuksamQuestDialogueTheme;
}

test('quest story dialogue is themed apart from ordinary talk', () => {
  const api = loadApi();
  assert.equal(api.classFor({ mode:'quest', hasQuest:true }), api.QUEST_STORY);
  assert.equal(api.classFor({ mode:'quest', questStatus:'accepted', hasQuest:true }), api.QUEST_STORY);
});

test('a finished quest waiting for its reward gets its own theme', () => {
  const api = loadApi();
  assert.equal(api.classFor({ mode:'base', questStatus:'ready', hasQuest:true }), api.QUEST_COMPLETE);
});

test('ordinary talk stays untouched', () => {
  const api = loadApi();
  assert.equal(api.classFor({ mode:'base', hasQuest:true }), '');
  assert.equal(api.classFor({ mode:'base', questStatus:'accepted', hasQuest:true }), '');
  assert.equal(api.classFor({ mode:'base', questStatus:'done', hasQuest:true }), '');
});

test('talk with no quest attached is never themed, whatever the mode', () => {
  const api = loadApi();
  assert.equal(api.classFor({ mode:'quest', hasQuest:false }), '');
  assert.equal(api.classFor({ questStatus:'ready', hasQuest:false }), '');
  assert.equal(api.classFor({}), '');
  assert.equal(api.classFor(), '');
});

test('the suffix carries its own separating space so class lists stay valid', () => {
  const api = loadApi();
  assert.equal(api.classSuffix({ mode:'quest', hasQuest:true }), ` ${api.QUEST_STORY}`);
  assert.equal(api.classSuffix({ mode:'base', hasQuest:true }), '');
  assert.doesNotMatch(api.classSuffix({ mode:'base', hasQuest:true }), /\s/);
});

test('the two quest themes are distinct class names', () => {
  const api = loadApi();
  assert.notEqual(api.QUEST_STORY, api.QUEST_COMPLETE);
});

test('the live dialogue renderer applies the theme and the stylesheet defines both', () => {
  const game = read('game.js');
  const style = read('style.css');
  const html = read('index.html');

  // game.js는 패치 체인이므로 마지막(살아있는) 대화 렌더러가 테마를 붙여야 한다
  const lastRenderer = game.lastIndexOf('function renderNpcDialogueV21');
  assert.ok(lastRenderer > 0, '최신 대화 렌더러를 찾지 못했습니다');
  const rendererBody = game.slice(lastRenderer, lastRenderer + 4000);
  assert.match(rendererBody, /YuksamQuestDialogueTheme\?\.classSuffix/);
  assert.match(rendererBody, /class="dialogue-box\$\{dialogueTheme\}"/);

  for (const name of ['quest-dialogue', 'quest-complete-dialogue']) {
    assert.ok(style.includes(`.modal-box:has(.${name})`), `${name} 배경색 규칙이 없습니다`);
    assert.ok(style.includes(`.${name} .dialogue-text`), `${name} 본문 색 규칙이 없습니다`);
  }

  const themeIndex = html.indexOf('<script src="src/quest-dialogue-theme.js"></script>');
  const gameIndex = html.indexOf('<script src="game.js"></script>');
  assert.ok(themeIndex > 0, '모듈이 index.html에 등록되지 않았습니다');
  assert.ok(themeIndex < gameIndex, '모듈은 game.js보다 먼저 로드되어야 합니다');
});
