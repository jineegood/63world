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
  assert.doesNotMatch(uiSource, /DAMAGE_TAKEN\s*=|\* 1\.5|\* 0\.6/);
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
  assert.match(result.stdout, /PASS: 대형 배치 화면이 열린다/);
  assert.match(result.stdout, /PASS: 같은 자리에 두 명이면 출발이 막힌다/);
  assert.match(result.stdout, /PASS: 올바른 대형이면 이동이 시작된다/);
  assert.match(result.stdout, /PASS: 이동이 끝나면 전투가 시작된다/);
  assert.match(result.stdout, /PASS: 파티 3명이 모두 표시된다/);
  assert.match(result.stdout, /PASS: 정답을 넣으면 몬스터 체력이 줄어든다/);
  assert.match(result.stdout, /PASS: 앞줄에 선 내가 반격을 맞는다/);
  assert.match(result.stdout, /PASS: 일반 몬스터 3종을 모두 만난다/);
  assert.match(result.stdout, /PASS: 레이드 보스까지 도달한다/);
  assert.match(result.stdout, /PASS: Lv\.5 파티가 1층을 깬다/);
  assert.match(result.stdout, /PASS: 클리어 보상이 지급된다/);
  assert.match(result.stdout, /PASS: 비동기 오류 없음/);
});
