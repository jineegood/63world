import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const gameSource = fs.readFileSync(path.join(root, 'game.js'), 'utf8');

function functionSource(name) {
  return gameSource.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0] || '';
}

test('login music remains selected through character creation until the game screen opens', () => {
  const desiredAudio = functionSource('getDesiredAudioFile');

  assert.match(
    desiredAudio,
    /if \(!screens\.game\?\.classList\.contains\('active'\)\) return game\.audio\.loginFile \|\| null;/,
  );
  assert.doesNotMatch(
    desiredAudio,
    /if \(!screens\.game(?:\?)?\.classList\.contains\('active'\)\) return game\.audio\.file/,
  );
});

test('screen changes resynchronize BGM and world entry opens the game screen', () => {
  const showScreen = functionSource('showScreen');
  const startGame = functionSource('startGame');

  assert.match(showScreen, /syncAudioFileBgm\?\.\(\);/);
  assert.match(startGame, /showScreen\('game'\);/);
});

test('an active friendly match selects the looping battle music before map music', () => {
  const pvpSelector = functionSource('getDesiredAudioFileV21');
  const pvpSync = functionSource('syncPvpBgmV1');

  assert.match(pvpSelector, /window\.getActivePvpMatchV1\?\.\(\)/);
  assert.match(pvpSelector, /!\['finished', 'cancelled'\]\.includes\(activePvpV21\.phase\)/);
  assert.match(pvpSelector, /return game\.audio\.battleFile \|\| null;/);
  assert.match(pvpSync, /resumeAudio\(\);/);
});
