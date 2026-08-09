/* 63빌딩 던전 구간 해금 규칙 — 앞 구간을 깨야 다음이 열리고,
   파티원 셋이 모두 열어야 함께 들어갈 수 있다. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Script, createContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const source = readFileSync(join(root, 'src', 'raid-progress.js'), 'utf8').replace(/\r\n/g, '\n');
const gameSource = readFileSync(join(root, 'game.js'), 'utf8').replace(/\r\n/g, '\n');

const context = createContext({ window:{} });
new Script(source, { filename:'src/raid-progress.js' }).runInContext(context);
const P = context.window.YuksamRaidProgress;

const who = (name, cleared) => ({ name, raidTopGroup:cleared });

test('구간 일곱 개가 시트의 층 구성과 같은 순서로 있다', () => {
  assert.equal(P.GROUPS.length, 7);
  assert.deepEqual([...P.GROUPS.map((group) => group.floor)], [1, 11, 21, 31, 41, 51, 61]);
  assert.equal(P.floorForGroup(1), 1);
  assert.equal(P.floorForGroup(7), 61);
  assert.equal(P.floorForGroup(8), 0, '없는 구간은 0');
  assert.equal(P.groupForFloor(21)?.id, 3);
  assert.equal(P.labelFor(2), '11–20층');
});

test('아무것도 못 깬 사람은 1구간만 열려 있다', () => {
  const rookie = who('새내기', 0);
  assert.equal(P.highestUnlockedGroup(rookie), 1);
  assert.equal(P.isUnlocked(rookie, 1), true);
  assert.equal(P.isUnlocked(rookie, 2), false);
  assert.deepEqual([...P.unlockedGroups(rookie)], [1]);
});

test('앞 구간을 깨면 바로 다음 구간 하나가 열린다', () => {
  assert.deepEqual([...P.unlockedGroups(who('둘째', 1))], [1, 2]);
  assert.deepEqual([...P.unlockedGroups(who('셋째', 3))], [1, 2, 3, 4]);
  // 두 칸 건너뛰기는 없다.
  assert.equal(P.isUnlocked(who('둘째', 1), 3), false);
});

test('마지막 구간을 깨도 그 위로는 열리지 않는다', () => {
  assert.equal(P.highestUnlockedGroup(who('끝', 7)), 7);
  assert.deepEqual([...P.unlockedGroups(who('끝', 7))], [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(P.isUnlocked(who('끝', 7), 8), false, '없는 구간은 열리지 않는다');
});

test('이상한 진행도 값은 안전한 범위로 다듬는다', () => {
  assert.equal(P.clearedGroup(who('음수', -5)), 0);
  assert.equal(P.clearedGroup(who('과한 값', 999)), 7);
  assert.equal(P.clearedGroup(who('글자', 'abc')), 0);
  assert.equal(P.clearedGroup(null), 0);
  assert.equal(P.clearedGroup({}), 0);
  // 서버가 스네이크 표기로 줄 때도 읽는다.
  assert.equal(P.clearedGroup({ raid_top_group:3 }), 3);
});

test('파티원 셋이 모두 열어야 그 구간에 들어갈 수 있다', () => {
  const party = [who('탱커', 2), who('딜러', 2), who('힐러', 2)];
  assert.equal(P.partyUnlockCheck(party, 3).ok, true);

  const behind = [who('탱커', 2), who('딜러', 0), who('힐러', 2)];
  const result = P.partyUnlockCheck(behind, 3);
  assert.equal(result.ok, false);
  assert.deepEqual([...result.lockedNames], ['딜러'], '못 연 사람 이름을 알려 준다');

  // 1구간은 누구나 들어갈 수 있다.
  assert.equal(P.partyUnlockCheck(behind, 1).ok, true);
  // 아무도 없으면 통과시키지 않는다.
  assert.equal(P.partyUnlockCheck([], 1).ok, false);
});

test('구간을 깨면 진행도가 오르고, 이미 앞서 있으면 그대로 둔다', () => {
  const player = { raidTopGroup:0 };
  assert.equal(P.recordClear(player, 1), true);
  assert.equal(player.raidTopGroup, 1);

  // 같은 구간을 다시 깨도 바뀌지 않는다(중복 저장 방지).
  assert.equal(P.recordClear(player, 1), false);
  assert.equal(player.raidTopGroup, 1);

  // 이미 3구간까지 깬 사람이 1구간을 다시 돌아도 내려가지 않는다.
  player.raidTopGroup = 3;
  assert.equal(P.recordClear(player, 1), false);
  assert.equal(player.raidTopGroup, 3);

  // 없는 구간 번호는 무시한다.
  assert.equal(P.recordClear(player, 99), false);
  assert.equal(player.raidTopGroup, 3);
  assert.equal(P.recordClear(null, 1), false);
});

test('로그인 정리 과정에서도 저장된 던전 해금값을 보존한다', () => {
  const normalizer = gameSource.match(/function normalizePlayer\(p\)[\s\S]*?\n}/)?.[0] || '';
  assert.notEqual(normalizer, '');
  assert.match(normalizer, /raidTopGroup:\s*Math\.max\(0, Math\.min\(7,/);
  assert.match(normalizer, /p\.raidTopGroup \?\? p\.raid_top_group/);
  assert.match(normalizer, /raidRewardVersion:\s*Math\.max\(0, Math\.min\(7,/);

  const creator = gameSource.match(/function createNewPlayer\(name\)[\s\S]*?\n}/)?.[0] || '';
  assert.match(creator, /raidTopGroup:\s*0/);
  assert.match(creator, /raidRewardVersion:\s*0/);
});

test('서버 보상 스냅샷은 영수증 버전을 보존하고 레벨 5 전문화 안내도 복구한다', () => {
  const apply = gameSource.match(/window\.applyAuthoritySnapshotFromServerV3[\s\S]*?\n};/)?.[0] || '';
  assert.notEqual(apply, '');
  assert.match(apply, /snapshot\.raidRewardVersion/);
  assert.match(apply, /game\.player\.raidRewardVersion/);
  assert.match(apply, /game\.player\.level >= 5 && !game\.player\.spec/);
  assert.match(apply, /setTimeout\(openSpecModal, 1800\)/);
});

test('화면·저장·서버를 건드리지 않는 순수 규칙이다', () => {
  // 주석은 빼고 실제 코드만 본다(주석에서는 savePlayer를 설명만 한다).
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(code, /document\.|localStorage|fetch\(|openModal|playSfx|savePlayer/);
});
