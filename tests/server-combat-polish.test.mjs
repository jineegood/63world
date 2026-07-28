import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const game = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

/* 서버 전투로 옮기면서 사라지거나 어긋났던 것들을 되돌린 뒤, 다시 무너지지 않게 고정한다. */

test('a defeated monster is finished off only after its log has played', () => {
  // 연출 재생기는 몬스터가 이미 죽어 있으면 큐를 버리고 완료 신호도 보내지 않는다.
  // 그래서 승리 처리는 로그가 끝난 뒤에 해야 하고, 그때까지는 살아 있어야 한다.
  assert.match(game, /if \(outcome === 'victory' && monster\) monster\.alive = true;/);
  const victory = game.slice(game.indexOf('function finishVictory'));
  assert.match(victory.slice(0, 400), /monster\.hp = 0;[\s\S]*monster\.alive = false;/);
});

test('nothing tells the player about servers any more', () => {
  for (const phrase of [
    '서버가 안전하게',
    '서버가 채점하고',
    '서버가 계산하고',
    '정답과 피해량은 서버',
    '서버가 출제',
  ]) {
    assert.ok(!game.includes(phrase), `플레이어에게 보이는 문구가 남아 있습니다: ${phrase}`);
  }
});

test('four choices lay out in the two by two grid the old battle used', () => {
  const render = game.slice(game.indexOf('function renderAuthorityQuestionV3'));
  const body = render.slice(0, render.indexOf('\n  }\n'));
  assert.match(body, /class="choice-grid"/);
  assert.match(body, /class="objective-chip"/);
  assert.match(body, /class="combat-question"/);
  assert.match(body, /class="answer-row"/);
  // 스타일이 없어 버튼이 붙어 나오던 예전 클래스는 쓰지 않는다
  assert.doesNotMatch(body, /class="combat-choices"/);
  // 격자 스타일이 실제로 정의돼 있어야 한다
  assert.match(style, /\.choice-grid \{[^}]*grid-template-columns: repeat\(2,/);
});

test('typing an answer still works and takes focus', () => {
  const render = game.slice(game.indexOf('function renderAuthorityQuestionV3'));
  const body = render.slice(0, render.indexOf('\n  }\n'));
  assert.match(body, /id="combatAnswer"/);
  assert.match(body, /event\.key==='Enter'/);
  assert.match(body, /combatAnswer'\)\?\.focus\(\)/);
});

test('the screen shake is reachable from every patch block', () => {
  assert.match(game, /window\.triggerScreenShakeV19 = triggerScreenShakeV19;/);
  const exportIndex = game.indexOf('window.triggerScreenShakeV19 = triggerScreenShakeV19;');
  const declIndex = game.indexOf('function triggerScreenShakeV19');
  assert.ok(declIndex < exportIndex, '정의보다 먼저 내보낼 수 없습니다');
  // 스코프 밖에서 부르다 ReferenceError를 내던 예전 호출은 남아 있으면 안 된다
  assert.doesNotMatch(game, /try \{ triggerScreenShakeV19\(\); \} catch/);
});

test('making a new character still gets its announcement', () => {
  const login = game.slice(game.indexOf('async function handleStudentLogin'));
  const body = login.slice(0, login.indexOf('\nfunction hasAvailableQuest'));
  assert.match(body, /새 캐릭터를 등록합니다/);
  assert.match(body, /cinematicOverlay/);
  assert.match(body, /showScreen\('creator'\)/);
});

test('turning a dialogue page makes a small sound', () => {
  assert.match(game, /if \(name === 'dialogue'\) \{ playTone\(/);
  const advance = game.match(/window\.nextDialoguePage = function[^\n]*/)[0];
  assert.match(advance, /playSfx\('dialogue'\)/);
  // 마지막 장에서 계속 누를 때 소리가 반복되면 안 된다
  assert.match(advance, /if \(next !== game\.dialogue\.page\) playSfx\('dialogue'\)/);
});
