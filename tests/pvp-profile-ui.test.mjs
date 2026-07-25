import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const sourcePath = path.join(root, 'src/pvp-ui.js');
const gameSource = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function loadUi(overrides = {}) {
  const opened = [];
  const calls = [];
  const elements = new Map();
  const document = {
    getElementById:(id) => elements.get(id) || null,
  };
  const window = {
    getPvpClientV1:() => ({
      async profile() {
        return {
          userId:'student-b', name:'달빛', level:7, className:'mage', spec:'화염',
          appearance:{ hair:'#111' }, equipment:{ weapon:'staff' }, costume:{ hat:'cap' },
          wins:3, losses:2, pvpAvailable:true,
        };
      },
      async invite(userId) { calls.push(['invite', userId]); return { ok:true }; },
      async respond(inviteId, accept) { calls.push(['respond', inviteId, accept]); return { accepted:accept }; },
    }),
    openModal:(html, options) => { opened.push({ html, options }); },
    renderPlayerPortraitForPvpV1:(canvas, profile) => calls.push(['portrait', canvas, profile]),
    toast:(message) => calls.push(['toast', message]),
    ...overrides,
  };
  vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), { window, document, setTimeout, clearTimeout });
  return { window, opened, calls, elements };
}

test('right-click profile shows safe public details and renders equipped face portrait', async () => {
  const ui = loadUi();
  const canvas = { id:'pvpProfilePortraitV1' };
  ui.elements.set('pvpProfilePortraitV1', canvas);
  await ui.window.openRemoteProfileV1('student-b');
  const html = ui.opened.at(-1).html;
  for (const text of ['달빛', 'Lv.7', '마법사', '화염', '3승', '2패', '대전 신청']) {
    assert.match(html, new RegExp(text));
  }
  assert.doesNotMatch(html, /password|token|answer/i);
  const portrait = ui.calls.find(([type]) => type === 'portrait');
  assert.equal(portrait[1], canvas);
  assert.equal(portrait[2].equipment.weapon, 'staff');
  assert.equal(portrait[2].costume.hat, 'cap');
});

test('challenge and invitation response use the authenticated PvP client', async () => {
  const ui = loadUi();
  await ui.window.challengeRemoteV1('student-b');
  await ui.window.respondPvpInviteV1('invite-1', true);
  assert.deepEqual(ui.calls.filter(([type]) => ['invite', 'respond'].includes(type)), [
    ['invite', 'student-b'],
    ['respond', 'invite-1', true],
  ]);
});

test('game supplies the real equipped portrait and starts presence after entering the world', () => {
  assert.match(gameSource, /window\.renderPlayerPortraitForPvpV1\s*=/);
  assert.match(gameSource, /drawPlayerSprite\(/);
  assert.match(gameSource, /window\.getLocalPvpProfileV1\s*=/);
  assert.match(gameSource, /window\.startPvpUiV1\?\.\(\)/);
  assert.ok(htmlSource.indexOf('src/pvp-ui.js') < htmlSource.indexOf('src/multiplayer.js'));
});
