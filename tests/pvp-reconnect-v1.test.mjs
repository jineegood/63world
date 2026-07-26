import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const storeUrl = pathToFileURL(path.join(root, 'supabase/functions/_shared/pvp-store.mjs'));

test('disconnect decisions pause, resume, forfeit, or cancel a match after the grace period', async () => {
  const { decideDisconnectV1 } = await import(storeUrl.href);
  const now = 100_000;
  const match = {
    phase:'question',
    deadline:now + 12_000,
    playerAId:'a',
    playerBId:'b',
  };

  assert.deepEqual(
    decideDisconnectV1(match, { a:now - 11_000, b:now - 1_000 }, now),
    {
      type:'reconnect',
      disconnectedUserId:'a',
      reconnectDeadline:now + 30_000,
      resumePhase:'question',
      pausedQuestionMs:12_000,
    },
  );

  assert.deepEqual(
    decideDisconnectV1({
      ...match,
      phase:'reconnect',
      disconnectedUserId:'a',
      reconnectDeadline:now + 15_000,
      resumePhase:'question',
      pausedQuestionMs:12_000,
    }, { a:now, b:now }, now),
    { type:'resume', phase:'question', deadline:now + 12_000 },
  );

  assert.deepEqual(
    decideDisconnectV1({
      ...match,
      phase:'reconnect',
      disconnectedUserId:'a',
      reconnectDeadline:now - 1,
    }, { a:now - 40_000, b:now }, now),
    { type:'finish', winnerId:'b', loserId:'a', reason:'disconnect' },
  );

  assert.deepEqual(
    decideDisconnectV1({
      ...match,
      phase:'reconnect',
      disconnectedUserId:null,
      reconnectDeadline:now - 1,
    }, { a:now - 40_000, b:now - 40_000 }, now),
    { type:'cancel', reason:'both_disconnected' },
  );

  assert.deepEqual(
    decideDisconnectV1(
      { ...match, phase:'resolving' },
      { a:now - 11_000, b:now - 1_000 },
      now,
    ),
    {
      type:'reconnect',
      disconnectedUserId:'a',
      reconnectDeadline:now + 30_000,
      resumePhase:'resolving',
      pausedQuestionMs:12_000,
    },
  );
});

test('first PvP profile use shows one tutorial with green key phrases before opening the profile', async () => {
  const tutorialSource = fs.readFileSync(path.join(root, 'src/tutorial.js'), 'utf8');
  const uiSource = fs.readFileSync(path.join(root, 'src/pvp-ui.js'), 'utf8');
  const opened = [];
  const calls = [];
  let seen = false;
  const window = {
    openModal:(html, options) => opened.push({ html, options }),
    closeModal:() => {},
    tutorialGreenV1:null,
    getPvpClientV1:() => ({
      async profile() {
        calls.push('profile');
        return { userId:'b', name:'B', level:1, className:'warrior', wins:0, losses:0, pvpAvailable:true };
      },
    }),
    shouldShowPvpTutorialV1:() => !seen,
    markPvpTutorialSeenV1:() => { seen = true; calls.push('seen'); },
    renderPlayerPortraitForPvpV1:() => {},
    toast:() => {},
  };
  const document = { getElementById:() => null };
  const context = {
    window, document,
    setInterval:() => 1,
    clearInterval() {},
  };
  vm.runInNewContext(tutorialSource, context);
  vm.runInNewContext(uiSource, context);

  await window.openRemoteProfileV1('b');
  assert.equal(calls.includes('profile'), false);
  for (const [step, phrases] of [
    [0, ['오른쪽 클릭', '대전 신청']],
    [1, ['20초']],
    [2, ['30면체 주사위', '항복']],
  ]) {
    window.__pvpTutorialStepV1(step);
    for (const phrase of phrases) {
      assert.match(opened.at(-1).html, new RegExp(`<strong class="quest-keyword-green">${phrase}</strong>`));
    }
  }

  await window.__pvpTutorialDoneV1();
  assert.deepEqual(calls, ['seen', 'profile']);
  await window.openRemoteProfileV1('b');
  assert.deepEqual(calls, ['seen', 'profile', 'profile']);
});

test('game persists the one-time PvP tutorial flag on the player record', () => {
  const source = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
  assert.match(source, /shouldShowPvpTutorialV1\s*=\s*\(\)\s*=>\s*!!game\.player\s*&&\s*!game\.player\.pvpTutorialSeen/);
  assert.match(source, /markPvpTutorialSeenV1[\s\S]{0,180}pvpTutorialSeen\s*=\s*true[\s\S]{0,180}savePlayer/);
});
