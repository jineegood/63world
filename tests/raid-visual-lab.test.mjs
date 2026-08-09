import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const html = readFileSync(join(root, 'tools', 'raid-visual-lab.html'), 'utf8').replace(/\r\n/g, '\n');
const source = readFileSync(join(root, 'tools', 'raid-visual-lab.js'), 'utf8').replace(/\r\n/g, '\n');
const executableSource = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

test('던전 1인 검사실은 로컬 주소에서만 열리고 실제 저장·통신 경계를 갖지 않는다', () => {
  assert.match(source, /LOCAL_HOSTS = new Set\(\['localhost', '127\.0\.0\.1', '::1', '\[::1\]'\]\)/);
  assert.match(source, /getElementById\('labLocalBlock'\)[\s\S]*?if \(!isLocal\) \{/);
  const scriptSources = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(scriptSources.length > 0);
  assert.equal(scriptSources.some((path) => /cloud-config|auth-v2|student-access-v2|cloud-sync|supabase/i.test(path)), false);
  assert.doesNotMatch(executableSource, /localStorage\s*\.|sessionStorage\s*\.|fetch\s*\(|functions\s*\.\s*invoke|supabase/i);
  assert.match(source, /global\.savePlayer = \(\) => true/);
  assert.match(source, /global\.applyAuthoritySnapshotFromServerV3 = \(\) => true/);
});

test('검사실은 복제 전투가 아니라 실제 던전 규칙·진행·화면·효과·음원을 로드한다', () => {
  const required = [
    '../src/combat-rules.js',
    '../src/combat-fx.js',
    '../src/audio-manifest.js',
    '../src/raid-progress.js',
    '../src/raid-combat-rules.js',
    '../src/raid-rules.js',
    '../src/raid-run.js',
    '../src/raid-run-ui.js',
  ];
  const positions = required.map((path) => html.indexOf(`src="${path}"`));
  assert.ok(positions.every((position) => position >= 0));
  for (let index = 1; index < positions.length; index += 1) {
    assert.ok(positions[index] > positions[index - 1], `${required[index]} 로드 순서가 올바르지 않다`);
  }
  assert.doesNotMatch(source, /const\s+MONSTERS\s*=|function\s+resolveRound\s*\(/);
});

test('한 브라우저에서 구간·한 턴·자동 패턴·다음 몬스터·종료를 조작할 수 있다', () => {
  for (const id of [
    'labFloorSelect', 'labStartBtn', 'labOneTurnBtn', 'labAutoBtn', 'labFinishBtn', 'labStopBtn',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(source, /async playOneTurn\(\{ allowWhileFinishing = false \} = \{\}\)/);
  assert.match(source, /async autoLoop\(\)/);
  assert.match(source, /async finishMonster\(\)/);
  assert.match(source, /forceMonsterHpOne\(\)/);
  assert.match(source, /event\?\.planName/);
});

test('메모리 방은 가짜 3인 파티를 자동 제출시키고 연출 완료 장벽도 셋 모두 통과시킨다', () => {
  assert.match(source, /profile\(PLAYER_ID,[\s\S]*?profile\('local-lab-mage'[\s\S]*?profile\('local-lab-priest'/);
  assert.match(source, /memory\.submissions = \[[\s\S]*?local-lab-mage[\s\S]*?local-lab-priest[\s\S]*?\];/);
  assert.match(source, /async ackPlayback[\s\S]*?memory\.members\.forEach[\s\S]*?playbackRound/);
  assert.match(source, /completion = \{[\s\S]*?awarded:false[\s\S]*?reward:\{ exp:0, gold:0, building:0 \}/);
});
