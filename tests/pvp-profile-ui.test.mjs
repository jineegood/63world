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
  const { pvpClientOverrides = {}, ...windowOverrides } = overrides;
  const opened = [];
  const calls = [];
  const elements = new Map();
  let inviteListener = null;
  let inviteReady = null;
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
      async presence() { calls.push(['presence']); return { ok:true }; },
      async sync(matchId) { calls.push(['sync', matchId]); return { id:matchId }; },
      onInvite(listener, onReady) { inviteListener = listener; inviteReady = onReady; return () => {}; },
      ...pvpClientOverrides,
    }),
    getPvpIdentityV1:() => ({ userId:'student-a', displayName:'별빛', role:'student' }),
    getLocalPvpProfileV1:() => ({ map:'town', busy:false }),
    flushLocalPlayerForPvpV1:async () => { calls.push(['flush']); },
    enterPvpMatchV1:(match) => calls.push(['enterMatch', match.id]),
    openModal:(html, options) => { opened.push({ html, options }); },
    closeModal:() => calls.push(['close']),
    renderPlayerPortraitForPvpV1:(canvas, profile) => calls.push(['portrait', canvas, profile]),
    toast:(message) => calls.push(['toast', message]),
    ...windowOverrides,
  };
  vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), {
    window, document, setTimeout, clearTimeout,
    setInterval:() => 1,
    clearInterval() {},
  });
  return {
    window,
    opened,
    calls,
    elements,
    emitInvite:(invite) => inviteListener?.(invite),
    emitInviteReady:() => inviteReady?.(),
  };
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

test('my PvP record refreshes presence and reads the authenticated student profile', async () => {
  const profiledIds = [];
  const ui = loadUi({
    pvpClientOverrides:{
      async profile(userId) {
        profiledIds.push(userId);
        return { wins:4.9, losses:1 };
      },
    },
  });

  const record = await ui.window.getMyPvpRecordV1();
  assert.equal(record.wins, 4);
  assert.equal(record.losses, 1);
  assert.deepEqual(profiledIds, ['student-a']);
  assert.equal(ui.calls.some(([type]) => type === 'presence'), true);
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

test('challenge and accept flush the latest character and refresh presence first', async () => {
  const ui = loadUi();
  await ui.window.challengeRemoteV1('student-b');
  await ui.window.respondPvpInviteV1('invite-1', true);
  assert.deepEqual(ui.calls.filter(([type]) => (
    ['flush', 'presence', 'invite', 'respond'].includes(type)
  )), [
    ['flush'],
    ['presence'],
    ['invite', 'student-b'],
    ['flush'],
    ['presence'],
    ['respond', 'invite-1', true],
  ]);
});

test('rapid double clicks send only one challenge request', async () => {
  let inviteAttempts = 0;
  let releaseInvite;
  const inviteGate = new Promise((resolve) => { releaseInvite = resolve; });
  const ui = loadUi({
    pvpClientOverrides:{
      async invite() {
        inviteAttempts += 1;
        await inviteGate;
        return { ok:true };
      },
    },
  });
  const first = ui.window.challengeRemoteV1('student-b');
  const second = ui.window.challengeRemoteV1('student-b');
  await second;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(inviteAttempts, 1);
  releaseInvite();
  await first;
});

test('a delayed setup response cannot close a PvP battle already opened by realtime', async () => {
  let modalType = 'pvpProfile';
  let releaseInvite;
  const inviteGate = new Promise((resolve) => { releaseInvite = resolve; });
  const ui = loadUi({
    getModalStateTypeV1:() => modalType,
    pvpClientOverrides:{
      async invite() {
        await inviteGate;
        return { ok:true };
      },
    },
  });
  const request = ui.window.challengeRemoteV1('student-b');
  await new Promise((resolve) => setTimeout(resolve, 0));
  modalType = 'pvpBattle';
  releaseInvite();
  await request;
  assert.equal(ui.calls.some(([type]) => type === 'close'), false);
});

test('accept resumes a match that was created before its response was lost', async () => {
  let respondAttempts = 0;
  const ui = loadUi({
    pvpClientOverrides:{
      async presence() {
        return { ok:true, activeMatch:{ id:'match-already-created' } };
      },
      async respond() {
        respondAttempts += 1;
        return null;
      },
    },
  });
  const result = await ui.window.respondPvpInviteV1('invite-1', true);
  assert.equal(result.recovered, true);
  assert.equal(respondAttempts, 0);
  assert.deepEqual(
    ui.calls.filter(([type]) => type === 'enterMatch'),
    [['enterMatch', 'match-already-created']],
  );
});

test('game supplies the real equipped portrait and starts presence after entering the world', () => {
  assert.match(gameSource, /window\.renderPlayerPortraitForPvpV1\s*=/);
  assert.match(gameSource, /drawPlayerSprite\(/);
  assert.match(gameSource, /window\.getLocalPvpProfileV1\s*=/);
  assert.match(gameSource, /window\.flushLocalPlayerForPvpV1\s*=/);
  assert.match(gameSource, /window\.getModalStateTypeV1\s*=/);
  assert.match(gameSource, /window\.startPvpUiV1\?\.\(\)/);
  assert.ok(htmlSource.indexOf('src/pvp-ui.js') < htmlSource.indexOf('src/multiplayer.js'));
  assert.match(gameSource, /modalState\.type === 'pvpBattle'[\s\S]{0,100}surrenderPvpV1/);
  assert.match(gameSource, /modalState\.type === 'pvpSurrender'[\s\S]{0,100}restorePvpMatchV1/);
});

test('character status keeps the name beside its title and orders four fixed identity cells below', () => {
  const panel = gameSource.slice(
    gameSource.indexOf('function openCharacterPanelV33'),
    gameSource.indexOf('function openUpgradeShopModalV33'),
  );
  const positions = [
    'identity-chip-lv',
    'identity-chip-job',
    'identity-chip-spec',
    'identity-chip-pvp',
  ].map((marker) => panel.indexOf(marker));

  assert.equal(positions.every((position) => position >= 0), true);
  assert.deepEqual(positions, [...positions].sort((left, right) => left - right));
  assert.match(panel, /character-status-title-v60"><h3>캐릭터 상태<\/h3><div class="character-name-line-v60"><span>이름<\/span><b>/);
  assert.doesNotMatch(panel, /identity-chip-name|data-tooltip="\$\{tooltipAttrV33\(playerNameV33\)\}"/);
  assert.match(panel, /id="characterPvpRecordV33">확인 중…/);
  assert.match(panel, /window\.getMyPvpRecordV1\(\)/);
  assert.match(gameSource, /\.identity-strip-v33\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(gameSource, /\.character-name-line-v60 b\{[^}]*font-size:20px[^}]*font-weight:950/);
  assert.match(gameSource, /\.wallet-gold-v33\{[^}]*background:/);
  assert.match(gameSource, /\.wallet-building-v33\{[^}]*background:/);
  assert.match(gameSource, /\.wallet-skillp-v33\{[^}]*background:/);
  assert.match(gameSource, /\.wallet-chip-v32 b\{[^}]*font-size:20px/);
});

test('challenger enters the match when the opponent accepts the invitation', async () => {
  const ui = loadUi();
  ui.window.startPvpUiV1();
  ui.emitInvite({ id:'invite-1', status:'accepted', challenger_id:'student-a', match_id:'match-1' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(ui.calls.filter(([type]) => ['sync', 'enterMatch'].includes(type)), [
    ['sync', 'match-1'],
    ['enterMatch', 'match-1'],
  ]);
  ui.window.stopPvpUiV1();
});

test('entering the world after refresh restores the active server match', async () => {
  const ui = loadUi({
    pvpClientOverrides:{
      async presence() { return { ok:true, activeMatch:{ id:'match-restored' } }; },
    },
  });
  ui.window.startPvpUiV1();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(
    ui.calls.filter(([type]) => type === 'enterMatch'),
    [['enterMatch', 'match-restored']],
  );
});

test('presence backfill restores an invitation missed before realtime subscribed', async () => {
  const pendingInvite = {
    id:'invite-missed',
    status:'pending',
    challenger_id:'student-b',
    target_id:'student-a',
  };
  const ui = loadUi({
    pvpClientOverrides:{
      async presence() { return { ok:true, pendingInvite }; },
    },
  });
  ui.window.startPvpUiV1();
  ui.emitInviteReady();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(ui.opened.some(({ options }) => options?.type === 'pvpInvite'), true);
});

test('a delayed pending invite profile cannot reopen over an accepted PvP match', async () => {
  let releaseProfile;
  const profileGate = new Promise((resolve) => { releaseProfile = resolve; });
  const ui = loadUi({
    pvpClientOverrides:{
      async profile() {
        return profileGate;
      },
    },
  });
  ui.window.startPvpUiV1();
  ui.emitInvite({
    id:'invite-race',
    status:'pending',
    challenger_id:'student-b',
    target_id:'student-a',
  });
  await Promise.resolve();
  ui.emitInvite({
    id:'invite-race',
    status:'accepted',
    challenger_id:'student-b',
    target_id:'student-a',
    match_id:'match-race',
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  releaseProfile({ name:'늦게 도착한 학생' });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(
    ui.calls.filter(([type]) => type === 'enterMatch'),
    [['enterMatch', 'match-race']],
  );
  assert.equal(ui.opened.some(({ options }) => options?.type === 'pvpInvite'), false);
});
