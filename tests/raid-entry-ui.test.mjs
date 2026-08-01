import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const source = readFileSync(join(root, 'src', 'raid-entry-ui.js'), 'utf8');
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

function createHarness() {
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
  };
  context.window = context;
  context.globalThis = context;
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

test('방 만들기를 누르면 일곱 구간 중 1–10층만 열린다', () => {
  const h = createHarness();
  h.context.YuksamRaidEntryUi.open();
  h.nodes.get('raidCreateRoomBtn').onclick();

  assert.equal(h.modalOptions().type, 'raidFloorSelect');
  assert.equal(h.floorButtons().length, 7);
  assert.equal(h.floorButtons().filter((button) => !button.disabled).length, 1);
  assert.equal(h.floorButtons()[0].dataset.raidFloorGroup, '1');
  assert.match(h.html(), /1–10층/);
  assert.match(h.html(), /11–20층/);
  assert.match(h.html(), /61–63층/);
  assert.equal((h.html().match(/향후 업데이트/g) || []).length, 6);
  assert.match(source, /\.raid-floor-card\.locked\{background:linear-gradient\([^;]*#080b11/);
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
