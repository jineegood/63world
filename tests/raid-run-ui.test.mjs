import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync as readFileRaw } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const readFileSync = (path, options) => readFileRaw(path, options).replace(/\r\n/g, '\n');
const uiSource = readFileSync(join(root, 'src', 'raid-run-ui.js'), 'utf8');
const htmlSource = readFileSync(join(root, 'index.html'), 'utf8');
const styleSource = readFileSync(join(root, 'style.css'), 'utf8');
const dungeonSource = readFileSync(join(root, 'src', 'raid-dungeon.js'), 'utf8');

test('화면 모듈은 규칙과 진행 뒤에 로드된다', () => {
  const order = ['src/raid-rules.js', 'src/raid-run.js', 'src/raid-run-ui.js', 'src/raid-dungeon.js']
    .map((name) => htmlSource.indexOf(`<script src="${name}"></script>`));
  assert.ok(order.every((index) => index > -1), '네 모듈이 모두 로드되어야 한다');
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(order[i] > order[i - 1], `${i}번째 모듈 순서가 뒤집혔다`);
  }
});

test('화면은 계산을 직접 하지 않고 규칙·진행에 맡긴다', () => {
  /* 나중에 서버가 진행을 대신 굴려도 이 화면을 그대로 쓰려면
     피해·회복 계산이 화면 쪽에 새로 생기면 안 된다. */
  /* 규칙 값을 화면이 다시 정의하면 서버로 옮길 때 계산이 갈라진다.
     (그림 좌표에 쓰이는 숫자까지 막으면 안 되므로 규칙 이름으로만 확인한다.) */
  assert.doesNotMatch(uiSource, /DAMAGE_TAKEN\s*=/);
  assert.doesNotMatch(uiSource, /CRIT_CHANCE\s*=|CRIT_MULTIPLIER\s*=|MISS_CHANCE\s*=/);
  assert.doesNotMatch(uiSource, /HEAL_RATIO\s*=|TRAVEL_RECOVERY\s*=/);
  assert.match(uiSource, /rules\(\)\.attackKindForRound/);
  assert.match(uiSource, /active\.resolveRound\(answers\)/);
  assert.match(uiSource, /active\.rollAllyAnswers\(\)/);
});

test('style.css를 건드리지 않고 자기 스타일만 넣는다', () => {
  assert.doesNotMatch(styleSource, /raid-slot-card|raid-monster-box|raid-party/);
  assert.match(uiSource, /id = 'raidRunStylesV1'/);
});

test('던전 입구가 화면 모듈을 늦은 바인딩으로 부른다', () => {
  // 화면 모듈이 뒤에 로드되므로 누르는 시점에 찾아야 한다.
  assert.match(dungeonSource, /raidEnterFloor1Btn/);
  assert.match(dungeonSource, /const ui = global\.YuksamRaidRunUi;/);
});

test('동료 능력치는 내 능력치를 기준으로 만들어진다', () => {
  // 레벨이 올라도 동료가 뒤처지거나 앞서지 않아야 한다.
  const build = uiSource.match(/function buildParty\(\) \{[\s\S]*?\n  \}/)?.[0] || '';
  assert.notEqual(build, '');
  assert.match(build, /maxHpForPlayer/);
  assert.match(build, /computeTotalStats/);
  assert.match(build, /Math\.round\(maxHp \* [\d.]+\)/);
  assert.match(build, /spec:'신성'/, '동료 중 한 명은 힐러여야 1층을 깰 수 있다');
});

test('브라우저에서 1층을 처음부터 끝까지 깬다', { timeout:180000 }, () => {
  const script = join(root, 'tools', 'browser-smoke', 'try_raid_run.js');
  const result = spawnSync(process.execPath, [script, root], { encoding:'utf8', timeout:170000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  // 던전 맵으로 실제 이동
  assert.match(result.stdout, /PASS: 마을이 아니라 던전 맵으로 이동한다/);
  assert.match(result.stdout, /PASS: 던전 맵이 월드에 등록되어 있다/);
  // 로비 대형 배치 — 대기칸과 + 버튼
  assert.match(result.stdout, /PASS: 로비 대형 화면이 열린다/);
  assert.match(result.stdout, /PASS: 처음에는 세 자리가 모두 비어 있다/);
  assert.match(result.stdout, /PASS: 세 명이 모두 대기칸에 서 있다/);
  assert.match(result.stdout, /PASS: 캐릭터 그림이 실제로 그려진다/);
  assert.match(result.stdout, /PASS: 고른 캐릭터가 앞줄에 선다/);
  assert.match(result.stdout, /PASS: 배치한 캐릭터를 대기칸으로 되돌릴 수 있다/);
  assert.match(result.stdout, /PASS: 세 자리를 채우기 전에는 출발할 수 없다/);
  // 전투 — 일반 전투 무대 + 왼쪽 3명
  assert.match(result.stdout, /PASS: 이동이 끝나면 전투가 시작된다/);
  assert.match(result.stdout, /PASS: 일반 전투와 같은 무대를 쓴다/);
  assert.match(result.stdout, /PASS: 왼쪽에 캐릭터 셋이 보인다/);
  assert.match(result.stdout, /PASS: 셋의 체력창이 각각 보인다/);
  assert.match(result.stdout, /PASS: 정답을 넣으면 몬스터 체력이 줄어든다/);
  assert.match(result.stdout, /PASS: 앞줄에 선 캐릭터가 반격을 맞는다/);
  // 전투 흐름 — 로그가 한 줄씩 쌓이고 치명타·빗나감·회복이 실제로 나온다
  assert.match(result.stdout, /PASS: 전투 로그가 한 줄씩 쌓인다/);
  assert.match(result.stdout, /PASS: 전투 로그에 공격·피격이 모두 나온다/);
  assert.match(result.stdout, /PASS: 치명타와 빗나감이 실제로 발동한다/);
  assert.match(result.stdout, /PASS: 힐러 회복 로그가 나온다/);
  assert.match(result.stdout, /PASS: 몬스터가 그림으로 그려진다/);
  // 끝까지
  assert.match(result.stdout, /PASS: 일반 몬스터 3종을 모두 만난다/);
  assert.match(result.stdout, /PASS: 레이드 보스까지 도달한다/);
  assert.match(result.stdout, /PASS: Lv\.5 파티가 1층을 깬다/);
  assert.match(result.stdout, /PASS: 클리어 보상이 지급된다/);
  assert.match(result.stdout, /PASS: 끝나면 마을로 돌아간다/);
  // 던전에 갇히지 않는지 (실제로 났던 버그)
  assert.match(result.stdout, /PASS: 던전 안에서는 마을 귀환 버튼이 보인다/);
  assert.match(result.stdout, /PASS: 저장에는 던전이 아니라 마을이 남는다/);
  assert.match(result.stdout, /PASS: 진행 없이 던전에 있으면 자동으로 마을로 나온다/);
  assert.match(result.stdout, /PASS: 전투 화면에 포기 버튼이 있다/);
  assert.match(result.stdout, /PASS: 포기하면 한 번 물어본다/);
  assert.match(result.stdout, /PASS: 포기하면 마을로 돌아간다/);
  assert.match(result.stdout, /PASS: 비동기 오류 없음/);
});

test('던전은 마을이 아니라 전용 맵을 화면 전체로 쓴다', () => {
  /* 이동이 작은 이모티콘 연출이 아니라 실제 장소 이동이어야 한다. */
  assert.match(uiSource, /const MAP_KEY = 'raidTower';/);
  assert.match(uiSource, /owns:\(\{ map \}\) => map === MAP_KEY/);
  assert.match(uiSource, /showLoadingTransition\('63빌딩 던전으로 들어갑니다\.'/);
  assert.match(uiSource, /function drawDungeon\(\)/);
  // 던전 안에서 파티 세 명을 직접 그린다.
  assert.match(uiSource, /function drawParty\(\)/);
  // 끝나면 마을로 되돌아간다.
  assert.match(uiSource, /function leaveDungeonMap\(\)/);
});

test('던전 전용 음악이 등록되고 던전 안에서만 재생된다', () => {
  const manifest = readFileSync(join(root, 'src', 'audio-manifest.js'), 'utf8');
  assert.match(manifest, /dungeonBgm: \{ src:'assets\/1\. 던전 음악\.mp3'/);
  // 던전 맵일 때만 우리 곡을 고른다.
  assert.match(uiSource, /if \(g && g\.currentMap === MAP_KEY\) \{[\s\S]*?ensureDungeonAudio\(\)/);
  // 나머지 곡이 멈추도록 동기화도 함께 감싼다.
  assert.match(uiSource, /global\.syncAudioFileBgm = function syncAudioFileBgmWithRaid/);
});

test('몬스터는 이모티콘이 아니라 직접 그린 모델을 쓴다', () => {
  assert.doesNotMatch(uiSource, /raid-monster-face/);
  assert.match(uiSource, /id="raidMonsterCanvas"/);
  assert.match(uiSource, /const MONSTER_PAINTERS = \{/);
  // 1층에 나오는 네 마리 모두 그림이 있어야 한다.
  ['guardBot', 'officeGhost', 'blackoutShade', 'towerWarden'].forEach((id) => {
    assert.match(uiSource, new RegExp(`${id}\\(ctx, cx, cy, t`), `${id} 그림이 없다`);
  });
});

test('전투 로그를 한 줄씩 순서대로 재생한다', () => {
  /* 결과를 한 번에 보여 주지 않고, 일반 전투처럼 한 줄씩 쌓으며 소리를 낸다. */
  assert.match(uiSource, /function playEvents\(events, onDone\)/);
  assert.match(uiSource, /playEventSound\(event\);\s*\n\s*renderBattle\(\);/);
  assert.match(uiSource, /playEvents\(\[opening, \.\.\.result\.events\]/);
  // 재생 중에는 다음 답을 받지 않는다.
  assert.match(uiSource, /isBusy:\(\) => busy/);
});

test('아바타는 진행 엔진을 통과해도 살아남는다', () => {
  /* 예전에 createRun에서 appearance를 빠뜨려 셋이 모두 같은 차림으로 보였다. */
  const runSource = readFileSync(join(root, 'src', 'raid-run.js'), 'utf8');
  assert.match(runSource, /appearance:member\.appearance \|\| null/);
  assert.match(runSource, /equipment:member\.equipment \|\| null/);
  // 던전 맵에서도 각자 아바타로 그린다.
  assert.match(uiSource, /member\.appearance \|\| \{\}/);
});

test('던전에 갇히지 않도록 세 겹으로 막는다', () => {
  /* 던전 안에서 게임을 끄면 저장된 맵이 raidTower로 남아 다시 접속했을 때
     아무것도 할 수 없는 곳에 갇힌다. 실제로 났던 버그다. */
  // 1) 애초에 던전을 저장하지 않는다
  assert.match(uiSource, /global\.savePlayer = function savePlayerWithoutRaidMap/);
  assert.match(uiSource, /if \(player && player\.map === MAP_KEY\)/);
  // 2) 그래도 던전에서 시작하면 자동으로 마을로 내보낸다
  assert.match(uiSource, /function rescueIfStranded\(\)/);
  assert.match(uiSource, /if \(!g \|\| g\.currentMap !== MAP_KEY \|\| active\) return;/);
  assert.match(uiSource, /global\.showScreen = function showScreenWithRaidGuard/);
  // 3) 던전 안에서 언제든 나갈 수 있다
  assert.match(uiSource, /toggleReturnButton\(true\)/);
  assert.match(uiSource, /id="raidGiveUpBtn"/);
  assert.match(uiSource, /function confirmGiveUp\(\)/);
  // 마을 귀환 버튼을 눌렀을 때도 던전 상태를 함께 정리한다
  assert.match(uiSource, /global\.returnTown = function returnTownWithRaidCleanup/);
  assert.match(uiSource, /function abandonRun\(\)/);
});

test('로딩 연출이 끝난 뒤에 창을 연다', () => {
  /* showLoadingTransition은 콜백 뒤에도 modalState를 'loading'으로 덮어쓴다.
     그 안에서 창을 열면 modalState가 지워져 조작이 먹히지 않는다. */
  assert.match(uiSource, /const LOADING_TAIL_MS = \d+;/);
  assert.match(uiSource, /global\.setTimeout\(\(\) => onReady\?\.\(\), LOADING_TAIL_MS\)/);
});
