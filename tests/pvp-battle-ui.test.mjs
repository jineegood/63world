import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const sourcePath = path.join(root, 'src/pvp-battle.js');

function harness() {
  const opened = [];
  const calls = [];
  const elements = new Map([
    ['pvpAnswerV1', { value:'5' }],
    ['pvpActionV1', { value:'basic' }],
  ]);
  let listener = null;
  const intervals = [];
  const client = {
    subscribe(_id, fn) { listener = fn; return () => calls.push(['unsubscribe']); },
    async submit(...args) { calls.push(['submit', ...args]); return { waiting:true, round:1 }; },
    async heartbeat(id) { calls.push(['heartbeat', id]); },
    async surrender(id) { calls.push(['surrender', id]); return { finished:true }; },
  };
  const window = {
    getPvpClientV1:() => client,
    getPvpIdentityV1:() => ({ userId:'a', displayName:'A', role:'student' }),
    openModal:(html, options) => opened.push({ html, options }),
    closeModal:() => calls.push(['close']),
    renderPlayerPortraitForPvpV1:() => {},
    toast:(message) => calls.push(['toast', message]),
    YuksamInputRouter:{
      register({ handle }) { window.escapeHandler = handle; },
    },
  };
  const document = { getElementById:(id) => elements.get(id) || null };
  vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), {
    window, document,
    setInterval:(fn) => { intervals.push(fn); return intervals.length; }, clearInterval() {},
    setTimeout:(fn) => { fn(); return 1; }, clearTimeout() {},
    Date,
  });
  const match = {
    id:'m1', round:1, phase:'question', deadline:Date.now() + 20000,
    playerAId:'a', playerBId:'b',
    playerAState:{ userId:'a', name:'A', hp:100, maxHp:100, shield:0, skills:{} },
    playerBState:{ userId:'b', name:'B', hp:100, maxHp:100, shield:0, skills:{} },
    question:{ prompt:'2 + 3 = ?', choices:[] },
  };
  return { window, opened, calls, client, emit:(event) => listener(event), tick:() => intervals.forEach((fn) => fn()), match };
}

test('PvP screen shows the shared question, both HP bars, and surrender instead of flee', () => {
  const ui = harness();
  ui.window.enterPvpMatchV1(ui.match);
  const html = ui.opened.at(-1).html;
  assert.match(html, /2 \+ 3 = \?/);
  assert.match(html, /A/);
  assert.match(html, /B/);
  assert.match(html, /항복/);
  assert.doesNotMatch(html, /도망/);
});

test('early submission locks the round and waits without revealing correctness', async () => {
  const ui = harness();
  ui.window.enterPvpMatchV1(ui.match);
  await ui.window.submitPvpActionV1();
  const html = ui.opened.at(-1).html;
  assert.match(html, /상대가 문제를 풀고 있어요/);
  assert.doesNotMatch(html, /정답|오답/);
});

test('server dice event displays every tie reroll and announces the higher roll first', () => {
  const ui = harness();
  ui.window.enterPvpMatchV1(ui.match);
  ui.emit({ type:'event', sequenceNo:1, kind:'dice', rolls:[{ a:12, b:12 }, { a:4, b:27 }], first:'b' });
  const html = ui.opened.at(-1).html;
  assert.match(html, /12/);
  assert.match(html, /4/);
  assert.match(html, /27/);
  assert.match(html, /B.*먼저 공격/);
});

test('surrender requires confirmation and records no local world rewards', async () => {
  const ui = harness();
  ui.window.enterPvpMatchV1(ui.match);
  ui.window.surrenderPvpV1();
  assert.match(ui.opened.at(-1).html, /정말 항복할까요/);
  await ui.window.confirmSurrenderPvpV1();
  assert.deepEqual(ui.calls.find(([type]) => type === 'surrender'), ['surrender', 'm1']);
});

test('Escape opens the surrender confirmation instead of silently closing an active match', () => {
  const ui = harness();
  ui.window.enterPvpMatchV1(ui.match);
  const event = { key:'Escape', preventDefault() { ui.calls.push(['prevent']); } };
  assert.equal(ui.window.escapeHandler(event), true);
  assert.match(ui.opened.at(-1).html, /정말 항복할까요/);
  assert.deepEqual(ui.calls.at(-1), ['prevent']);
});

test('countdown refresh does not overwrite the surrender confirmation', () => {
  const ui = harness();
  ui.window.enterPvpMatchV1(ui.match);
  ui.window.surrenderPvpV1();
  ui.tick();
  assert.match(ui.opened.at(-1).html, /정말 항복할까요/);
  ui.window.restorePvpMatchV1();
  assert.match(ui.opened.at(-1).html, /학생 친선 대전/);
});
