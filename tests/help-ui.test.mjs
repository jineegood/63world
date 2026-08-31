import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const gameSource = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
const tutorialSource = fs.readFileSync(path.join(root, 'src', 'tutorial.js'), 'utf8');
const styleSource = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

test('환경설정 하단은 눈에 띄는 도움말과 관리자 모드 두 버튼을 나란히 제공한다', () => {
  const start = gameSource.indexOf('function openSettingsModal()');
  const end = gameSource.indexOf('function monsterBase', start);
  const settings = start >= 0 && end > start ? gameSource.slice(start, end) : '';
  assert.match(settings, /class="settings-actions-v1"/);
  assert.match(settings, /id="worldChannelSettingsV1"/);
  assert.match(settings, /10개 채널 · 채널당 최대 8명/);
  assert.match(settings, /mountWorldChannelSettingsV1\(\)/);
  assert.match(settings, /class="help-launch-v1"[^>]*onclick="openGameHelpV1\(\)"[^>]*>❓ 도움말/);
  assert.match(settings, /onclick="openAdminPanel\(\)"[^>]*>🔐 관리자 모드/);
  assert.doesNotMatch(settings, /관리자 창 열기/);
  assert.match(styleSource, /button\.help-launch-v1\s*\{[\s\S]*?#fde047[\s\S]*?#86efac/);
});

test('게임 화면에서 ESC는 전투·PVP·던전이 아닐 때 환경설정을 연다', () => {
  assert.match(gameSource, /k === 'escape'[\s\S]*?game\.currentMap !== 'raidTower'[\s\S]*?YuksamRaidRunUi\?\.hasSession\?\.\(\)[\s\S]*?openSettingsModal\(\)/);
  assert.match(gameSource, /game\.modalState\.type === 'combat'\) window\.escapeCombat\(\)/);
  assert.match(gameSource, /!window\.getActivePvpMatchV1\?\.\(\)/);
});

test('도움말은 여덟 항목을 탭으로 구분하고 기존 이동·전투·PVP 튜토리얼 문구를 재사용한다', () => {
  const expected = [
    ['movement', '기본 이동'],
    ['interaction', '상호작용/퀘스트'],
    ['combat', '전투/문제'],
    ['skills', '스킬/전문화'],
    ['equipment', '장비/강화'],
    ['stats', '능력치/자원'],
    ['companions', '펫/코스튬'],
    ['pvp', 'PVP'],
  ];
  for (const [id, title] of expected) {
    assert.match(tutorialSource, new RegExp(`id:'${id}'[^}]*?title:'${title.replace('/', '\\/')}'`));
  }
  assert.match(tutorialSource, /body:`\$\{STEPS\[1\]\.body\}/);
  assert.match(tutorialSource, /body:`\$\{STEPS\[2\]\.body\}/);
  assert.match(tutorialSource, /body:PVP_STEPS\.map\(/);
  assert.match(tutorialSource, /role="tablist"/);
  assert.match(tutorialSource, /role="tabpanel"/);
});

test('도움말 버튼은 한 모달 안에서 원하는 항목으로 전환된다', () => {
  const opened = [];
  const window = {
    openModal:(html, options) => opened.push({ html, options }),
    closeModal:() => {},
    playSfx:() => {},
    YuksamInputRouter:{ register:() => {} },
  };
  vm.runInNewContext(tutorialSource, { window });

  window.openGameHelpV1();
  assert.equal(opened.at(-1).options.type, 'help');
  assert.equal((opened.at(-1).html.match(/data-help-section-v1=/g) || []).length, 8);
  assert.match(opened.at(-1).html, /data-help-section-v1="movement"[^>]*aria-selected="true"/);
  assert.match(opened.at(-1).html, /W A S D/);

  window.__openGameHelpSectionV1('equipment');
  assert.match(opened.at(-1).html, /장비\/강화/);
  assert.match(opened.at(-1).html, /빌딩 3개/);

  window.__openGameHelpSectionV1('pvp');
  assert.match(opened.at(-1).html, /오른쪽 클릭/);
  assert.match(opened.at(-1).html, /30면체 주사위/);
  assert.match(opened.at(-1).html, /30초/);
});

test('도움말 전용 스타일은 공용 모달 크기를 덮어쓰지 않고 작은 화면에서만 탭 수를 줄인다', () => {
  const helpStyles = styleSource.match(/\/\* 환경설정에서 다시 열 수 있는 학생용 도움말[\s\S]*?(?=\n\.combat-layout)/)?.[0] || '';
  assert.match(helpStyles, /\.game-help-tabs-v1\s*\{[^}]*repeat\(4/);
  assert.match(helpStyles, /@media \(max-width: 720px\)[\s\S]*?repeat\(2/);
  assert.doesNotMatch(helpStyles, /\.modal-box\s*\{/);
});
