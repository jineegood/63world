import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const game = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const questData = fs.readFileSync(path.join(root, 'src', 'quest-data.js'), 'utf8');
const costume = fs.readFileSync(path.join(root, 'src', 'costume-ui.js'), 'utf8');

test('early quests clearly explain the forest portal and western equipment shop', () => {
  assert.match(questData, /사냥터에 가려면 마을 가운데의 포탈을 이용하렴/);
  assert.match(questData, /상점은 마을 서쪽 장비 상점에 있단다/);
});

test('redundant mouse-click helper copy is removed from visible game UI', () => {
  assert.doesNotMatch(game, /마우스 클릭도 가능|클릭으로 대화 진행|클릭 또는 E키로 진행/);
});

test('skill learning waits for the teacher skill tutorial', () => {
  assert.match(game, /if \(!getQuestState\('tut_skill'\)\) return '아직 명진쌤의 가르침을 받지 못했습니다!'/);
});

test('two-column answer navigation moves vertically by rows', () => {
  assert.match(game, /function moveChoiceGridV62/);
  assert.match(game, /targetRow = Math\.min\(rows - 1, row \+ 1\)/);
  assert.match(game, /targetGridIndex = targetRow \* columns \+ targetColumn/);
});

test('shops and enhancement use prominent resource balance banners', () => {
  assert.match(game, /resource-balance-banner resource-gold/);
  assert.match(game, /resource-balance-banner resource-building/);
  assert.match(costume, /resource-balance-banner resource-gold/);
  assert.match(style, /\.resource-balance-banner\s*\{/);
  assert.match(style, /\.resource-balance-banner\.resource-gold/);
  assert.match(style, /\.resource-balance-banner\.resource-building/);
});
