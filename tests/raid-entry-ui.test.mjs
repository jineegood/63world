import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const source = readFileSync(join(root, 'src', 'raid-entry-ui.js'), 'utf8');
const progressSource = readFileSync(join(root, 'src', 'raid-progress.js'), 'utf8');
const dungeonSource = readFileSync(join(root, 'src', 'raid-dungeon.js'), 'utf8');

class FakeNode {
  constructor({ id = '', dataset = {}, disabled = false } = {}) {
    this.id = id;
    this.dataset = dataset;
    this.disabled = disabled;
    this.isConnected = true;
    this.value = '';
    this.textContent = '';
    this.onclick = null;
    this.oninput = null;
    this.onkeydown = null;
    this.focused = false;
  }

  focus() { this.focused = true; }
}

/* clearedGroup: 이 학생이 지금까지 깬 던전 구간(0이면 아직 하나도 못 깼다). */
function createHarness({ clearedGroup = 0 } = {}) {
  const nodes = new Map();
  let floorButtons = [];
  const styles = [];
  const calls = [];
  let html = '';
  let modalOptions = null;

  const document = {
    head:{ appendChild(node) { styles.push(node); nodes.set(node.id, node); } },
    createElement() { return new FakeNode(); },
    getElementById(id) { return nodes.get(id) || null; },
    querySelectorAll(selector) {
      return selector === '[data-raid-floor-group]' ? floorButtons : [];
    },
  };

  function parse(nextHtml) {
    [...nodes.entries()].forEach(([key, node]) => {
      if (key !== 'raidEntryStylesV1') node.isConnected = false;
    });
    [...nodes.keys()].forEach((key) => { if (key !== 'raidEntryStylesV1') nodes.delete(key); });
    floorButtons = [];
    for (const match of nextHtml.matchAll(/id="([^"]+)"/g)) nodes.set(match[1], new FakeNode({ id:match[1] }));
    for (const match of nextHtml.matchAll(/<button class="raid-floor-card([^"]*)"\s+data-raid-floor-group="(\d+)"([^>]*)>/g)) {
      const button = new FakeNode({
        dataset:{ raidFloorGroup:match[2] },
        disabled:/\bdisabled\b/.test(match[3]),
      });
      floorButtons.push(button);
    }
  }

  const context = {
    document,
    setTimeout(callback) { callback(); return 1; },
    closeModal() { calls.push({ type:'close' }); },
    openModal(nextHtml, options) {
      html = nextHtml;
      modalOptions = options;
      parse(nextHtml);
    },
    YuksamRaidRunUi:{
      async openNetworkLobby(options) { calls.push(options); return true; },
    },
    YuksamRaidNameplatesV1:{
      rewardForGroup(group) {
        return ({
          2:{ icon:'▣', floorLabel:'20층', name:'강철 승강기 이름표', shortName:'강철 승강기' },
          4:{ icon:'◆', floorLabel:'40층', name:'황혼의 창 이름표', shortName:'황혼의 창' },
          7:{ icon:'♛', floorLabel:'63층', name:'육삼 정상 이름표', shortName:'육삼의 정상' },
        })[group] || null;
      },
    },
    /* 구간 해금은 플레이어의 raidTopGroup으로 정해진다. */
    game:{ player:{ raidTopGroup:clearedGroup } },
  };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(progressSource, context, { filename:'raid-progress.js' });
  vm.runInNewContext(source, context, { filename:'raid-entry-ui.js' });
  return {
    context,
    calls,
    nodes,
    floorButtons:() => floorButtons,
    html:() => html,
    modalOptions:() => modalOptions,
    tick:() => new Promise((resolve) => setImmediate(resolve)),
  };
}

test('던전 입구는 예전 혼자 도전 버튼 대신 새 입장 화면을 연다', () => {
  const block = dungeonSource.match(/function openTowerEntrance\(\) \{[\s\S]*?\n  \}/)?.[0] || '';
  assert.match(block, /global\.YuksamRaidEntryUi/);
  assert.match(block, /entryUi\.open\(\)/);
  assert.doesNotMatch(block, /startRun\(1\)/);
  assert.doesNotMatch(block, /동료 둘/);
});

test('첫 화면에는 방 만들기와 숫자 4자리 참가 입력이 있다', () => {
  const h = createHarness();
  assert.equal(h.context.YuksamRaidEntryUi.open(), true);
  assert.equal(h.modalOptions().type, 'raidEntryHome');
  assert.match(h.html(), /방 만들기/);
  assert.match(h.html(), /초대 코드 입력하기/);
  assert.match(h.html(), /inputmode="numeric"/);
  assert.match(h.html(), /maxlength="4"/);
  assert.match(h.html(), /친구 <strong>3명<\/strong>/);
});

test('아직 아무것도 못 깼으면 일곱 구간 중 1–10층만 열린다', () => {
  const h = createHarness({ clearedGroup:0 });
  h.context.YuksamRaidEntryUi.open();
  h.nodes.get('raidCreateRoomBtn').onclick();

  assert.equal(h.modalOptions().type, 'raidFloorSelect');
  assert.equal(h.floorButtons().length, 7);
  assert.equal(h.floorButtons().filter((button) => !button.disabled).length, 1);
  assert.equal(h.floorButtons()[0].dataset.raidFloorGroup, '1');
  assert.match(h.html(), /1–10층/);
  assert.match(h.html(), /11–20층/);
  assert.match(h.html(), /61–63층/);
  // 잠긴 구간은 무엇을 먼저 깨야 하는지 알려 준다.
  assert.equal((h.html().match(/먼저 깨야 합니다/g) || []).length, 6);
  assert.match(h.html(), /1–10층을 먼저 깨야 합니다/);
  assert.match(source, /\.raid-floor-card\.locked\{background:linear-gradient\([^;]*#12161d/);
});

test('마지막 61–63층은 추천 레벨을 밝히지 않는다', () => {
  const h = createHarness({ clearedGroup:7 });
  h.context.YuksamRaidEntryUi.openFloorSelection();
  assert.match(h.html(), /추천 레벨 \?\?\?/);
  // 나머지 여섯 구간은 숫자로 알려 준다.
  assert.equal((h.html().match(/추천 레벨 Lv\.\d+/g) || []).length, 6);
  assert.equal((h.html().match(/추천 레벨 \?\?\?/g) || []).length, 1);
});

test('층 선택은 빌딩처럼 아래에서 위로 쌓이고 올라갈수록 색이 뜨거워진다', () => {
  const h = createHarness({ clearedGroup:7 });
  h.context.YuksamRaidEntryUi.openFloorSelection();

  // 1–10층이 맨 아래에 오도록 세로로 뒤집어 쌓는다.
  assert.match(source, /\.raid-floor-grid\{display:flex;flex-direction:column-reverse/);
  // 바닥선이 있어야 건물이 땅에 서 있는 것처럼 보인다.
  assert.match(h.html(), /<div class="raid-floor-ground"><\/div>/);

  // 일곱 구간이 각자 다른 난이도 색을 가진다.
  for (let tier = 1; tier <= 7; tier += 1) {
    assert.match(h.html(), new RegExp(`raid-floor-card tier${tier}\\b`), `${tier}층 색 지정`);
    assert.match(source, new RegExp(`\\.raid-floor-card\\.tier${tier}\\{background:linear-gradient`), `tier${tier} 색 정의`);
  }
  // 맨 위 구간은 붉은 경고색이어야 한다.
  assert.match(source, /\.raid-floor-card\.tier7\{background:linear-gradient\(180deg,#8c1d1d/);

  // 난이도 눈금은 층이 올라갈수록 채워진 칸이 늘어난다.
  const filled = [...h.html().matchAll(/<span class="raid-floor-heat">(.*?)<\/span>/g)]
    .map((match) => (match[1].match(/class="on"/g) || []).length);
  assert.deepEqual(filled, [1, 2, 3, 4, 5, 6, 7]);
});

test('앞 구간을 깨면 바로 다음 구간이 열린다', () => {
  const h = createHarness({ clearedGroup:2 });
  h.context.YuksamRaidEntryUi.openFloorSelection();
  const open = h.floorButtons().filter((button) => !button.disabled);
  // 1·2구간을 깼으니 3구간까지 열려 있고 4구간부터는 잠겨 있다.
  assert.equal(open.length, 3);
  assert.deepEqual(open.map((button) => button.dataset.raidFloorGroup), ['1', '2', '3']);
  assert.equal(h.floorButtons()[3].disabled, true);
});

test('방 만들기 층 목록은 실제로 깬 구간에만 Clear 표시를 붙인다', () => {
  const h = createHarness({ clearedGroup:2 });
  h.context.YuksamRaidEntryUi.openFloorSelection();
  assert.equal((h.html().match(/class="raid-floor-clear">Clear!<\/em>/g) || []).length, 2);
  assert.match(h.html(), /1–10층<em class="raid-floor-clear">Clear!<\/em>/);
  assert.match(h.html(), /11–20층<em class="raid-floor-clear">Clear!<\/em>/);
  assert.doesNotMatch(h.html(), /21–30층<em class="raid-floor-clear">Clear!<\/em>/);
  assert.match(source, /\.raid-floor-clear\{[^}]*background:#86efac/);
});

test('20·40·63층 구간에는 이름표 보상이 미리 표시된다', () => {
  const h = createHarness({ clearedGroup:7 });
  h.context.YuksamRaidEntryUi.openFloorSelection();

  assert.equal((h.html().match(/class="raid-floor-reward/g) || []).length, 3);
  assert.match(h.html(), /title="강철 승강기 이름표">▣ 강철 승강기/);
  assert.match(h.html(), /title="황혼의 창 이름표">◆ 황혼의 창/);
  assert.match(h.html(), /class="raid-floor-reward summit" title="육삼 정상 이름표">♛ 육삼의 정상/);
  assert.match(source, /\.raid-floor-reward\.summit\{[^}]*#67e8f9/);
});

test('마지막 구간까지 깨도 목록은 일곱 구간 그대로다', () => {
  const h = createHarness({ clearedGroup:7 });
  h.context.YuksamRaidEntryUi.openFloorSelection();
  assert.equal(h.floorButtons().length, 7);
  assert.equal(h.floorButtons().filter((button) => !button.disabled).length, 7);
});

test('입장 안내에 3명 모두 열어야 한다는 조건이 적혀 있다', () => {
  const h = createHarness({ clearedGroup:1 });
  h.context.YuksamRaidEntryUi.openFloorSelection();
  assert.match(h.html(), /파티원 3명이 모두 열어야/);
});

test('열린 구간을 누르면 방 생성 계약을 정확히 호출한다', async () => {
  const h = createHarness();
  h.context.YuksamRaidEntryUi.openFloorSelection();
  await h.floorButtons()[0].onclick();
  assert.equal(h.calls[0]?.mode, 'create');
  assert.equal(h.calls[0]?.floorGroup, 1);
});

test('초대 코드는 숫자만 네 자리로 정리하고 Enter로 참가한다', async () => {
  const h = createHarness();
  h.context.YuksamRaidEntryUi.open();
  const input = h.nodes.get('raidInviteCodeInput');
  input.value = '01가23 9';
  input.oninput();
  assert.equal(input.value, '0123', '앞의 0을 보존하고 숫자 네 자리까지만 남겨야 한다');

  let prevented = false;
  input.onkeydown({ key:'Enter', repeat:false, preventDefault() { prevented = true; } });
  await h.tick();
  assert.equal(prevented, true);
  assert.equal(h.calls[0]?.mode, 'join');
  assert.equal(h.calls[0]?.code, '0123');
});

test('네 자리가 아니면 참가 호출 없이 쉬운 오류를 보여 준다', () => {
  const h = createHarness();
  h.context.YuksamRaidEntryUi.open();
  const input = h.nodes.get('raidInviteCodeInput');
  input.value = '123';
  h.nodes.get('raidJoinRoomBtn').onclick();
  assert.equal(h.calls.length, 0);
  assert.match(h.nodes.get('raidEntryError').textContent, /숫자 4자리/);
  assert.equal(input.focused, true);
});
