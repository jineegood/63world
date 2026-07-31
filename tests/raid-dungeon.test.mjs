import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync as readFileRaw } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
/* 소스는 CRLF로 저장될 수 있고 아래 슬라이스 정규식은 \n 기준이므로 읽을 때 LF로 맞춘다. */
const readFileSync = (path, options) => readFileRaw(path, options).replace(/\r\n/g, '\n');
const raidSource = readFileSync(join(root, 'src', 'raid-dungeon.js'), 'utf8');
const htmlSource = readFileSync(join(root, 'index.html'), 'utf8');
const gameSource = readFileSync(join(root, 'game.js'), 'utf8');
const runnerSource = readFileSync(join(root, 'tools', 'run-baseline.ps1'), 'utf8');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

test('63빌딩 던전은 game.js가 아니라 별도 모듈로 분리되어 있다', () => {
  // 프로젝트 규칙: 새 기능은 game.js에 덧붙이지 않는다.
  assert.doesNotMatch(gameSource, /YuksamRaidDungeon/);
  assert.doesNotMatch(gameSource, /raidTowerDoor|raidElderNpc/);
  assert.match(raidSource, /global\.YuksamRaidDungeon = Object\.freeze\(\{/);
});

test('모듈은 index.html에서 game.js보다 뒤에 로드된다', () => {
  const gameIndex = htmlSource.indexOf('<script src="game.js"></script>');
  const raidIndex = htmlSource.indexOf('<script src="src/raid-dungeon.js"></script>');
  assert.ok(gameIndex > -1, 'game.js 로드 태그가 있어야 한다');
  assert.ok(raidIndex > -1, 'raid-dungeon.js 로드 태그가 있어야 한다');
  assert.ok(raidIndex > gameIndex, 'raid-dungeon.js는 game.js 뒤에 와야 한다');
});

test('game.js 연결은 전부 늦은 바인딩이라 부팅 순서에 기대지 않는다', () => {
  /* game.js의 game / 레지스트리들은 const 라 window에 올라가지 않는다.
     반드시 이름으로 직접 찾아야 하고, 이 규칙이 깨지면 던전이 조용히 동작하지 않는다. */
  assert.match(raidSource, /typeof game !== 'undefined' \? game : null/);
  assert.match(raidSource, /typeof worldInteractionRegistry !== 'undefined'/);
  assert.match(raidSource, /typeof worldNavigationRegistry !== 'undefined'/);
  // drawTown은 함수 선언이라 window에 있고, 감싸서 확장한다.
  assert.match(raidSource, /const previousDrawTown = global\.drawTown;[\s\S]*?previousDrawTown\(\);/);
});

test('빌딩은 마을 남쪽 길 끝에 서 있고 입구가 길과 만난다', () => {
  // 마을 남쪽 길은 x=1200을 따라 y=1720까지 내려간다.
  assert.match(gameSource, /\[1200, 1720\]/);
  const tower = raidSource.match(/const TOWER = \{[\s\S]*?\n  \};/)?.[0] || '';
  assert.notEqual(tower, '');
  assert.match(tower, /x: 1200/);
  assert.match(tower, /doorX: 1200/);
  const doorY = Number(tower.match(/doorY: (\d+)/)?.[1]);
  assert.ok(doorY > 1500 && doorY < 1720, `입구가 남쪽 길 위에 있어야 한다 (doorY=${doorY})`);
  assert.match(tower, /floors: 63/);
  assert.match(tower, /name: '63빌딩 던전'/);
});

test('입장 조건은 Lv.5 + 전문화 + 원로 명진 이야기 세 가지다', () => {
  const reason = raidSource.match(/function entryBlockReason\(\) \{[\s\S]*?\n  \}/)?.[0] || '';
  assert.notEqual(reason, '');
  assert.match(reason, /\(p\.level \|\| 1\) < REQUIRED_LEVEL/);
  assert.match(reason, /if \(!p\.spec\)/);
  assert.match(reason, /if \(!heardTheStory\(\)\)/);
  assert.match(raidSource, /const REQUIRED_LEVEL = 5;/);
  // 조건을 다 만족해야만 통과한다.
  assert.match(raidSource, /function canEnter\(\) \{\s*\n\s*return entryBlockReason\(\) === null;/);
});

test('원로 명진의 느낌표는 Lv.5부터, 이야기를 들은 뒤에는 사라진다', () => {
  const available = raidSource.match(/function questAvailable\(\) \{[\s\S]*?\n  \}/)?.[0] || '';
  assert.notEqual(available, '');
  assert.match(available, /\(p\.level \|\| 1\) >= REQUIRED_LEVEL/);
  assert.match(available, /&& !heardTheStory\(\)/);
  // 느낌표는 기존 NPC 그리기의 hasQuest 인자로 전달한다.
  assert.match(raidSource, /call\('drawNpcWorld', ELDER\.x, ELDER\.y, ELDER\.name, questAvailable\(\)/);
});

test('던전 퀘스트는 명진쌤의 퀘스트 순서를 건드리지 않는다', () => {
  /* QUEST_ORDER에 끼워 넣으면 명진쌤의 튜토리얼 체인이 밀린다.
     원로 명진의 퀘스트는 독립적으로 관리해야 한다. */
  const questData = readFileSync(join(root, 'src', 'quest-data.js'), 'utf8');
  assert.doesNotMatch(questData, /raid_tower_intro/);
  assert.match(raidSource, /const QUEST_ID = 'raid_tower_intro';/);
});

test('기존 마을 충돌을 지우지 않고 빌딩과 NPC 충돌만 더한다', () => {
  const collider = raidSource.match(/id: 'raid-tower-colliders-v1',[\s\S]*?\n      \}\);/)?.[0] || '';
  assert.notEqual(collider, '');
  // 마을이 아니면 손대지 않고 다음 등록기로 넘긴다.
  assert.match(collider, /if \(G\(\)\?\.currentMap !== 'town'\) return null;/);
  assert.match(collider, /getBaseMapColliders\(\)/);
  // 우선순위가 높으므로 낮은 등록기의 상점 충돌도 함께 돌려줘야 한다.
  assert.match(collider, /t\?\.petShop/);
  assert.match(collider, /t\?\.upgradeShop/);
});

test('브라우저 스모크가 던전 1단계를 통과한다', { timeout:60000 }, () => {
  const script = join(root, 'tools', 'browser-smoke', 'try_raid_dungeon.js');
  const result = spawnSync(process.execPath, [script, root], { encoding:'utf8', timeout:55000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PASS: 입구에 서면 던전 들어가기가 잡힌다/);
  assert.match(result.stdout, /PASS: 원로 명진 옆에 서면 대화가 잡힌다/);
  assert.match(result.stdout, /PASS: Lv\.4에도 아직 느낌표가 없다/);
  assert.match(result.stdout, /PASS: Lv\.5가 되면 느낌표가 뜬다/);
  assert.match(result.stdout, /PASS: 전문화가 없으면 전문화 때문에 막힌다/);
  assert.match(result.stdout, /PASS: Lv\.5 \+ 전문화 \+ 이야기 청취면 입장 가능/);
  assert.match(result.stdout, /PASS: 빌딩이 통과되지 않는다/);
  assert.match(result.stdout, /PASS: 기존 펫 상점 충돌이 유지된다/);
  assert.match(result.stdout, /PASS: 새 건물이 들어가도 마을 그리기가 정상/);
  assert.match(result.stdout, /PASS: 비동기 오류 없음/);
});

test('검사 러너와 package.json에 던전 검사가 등록되어 있다', () => {
  assert.match(runnerSource, /'raid-dungeon'/);
  assert.match(runnerSource, /tests\/raid-dungeon\.test\.mjs/);
  assert.match(runnerSource, /src\/raid-dungeon\.js/);
  assert.equal(
    pkg.scripts['test:raid-dungeon'],
    'powershell -NoProfile -ExecutionPolicy Bypass -File tools/run-baseline.ps1 raid-dungeon',
  );
});
