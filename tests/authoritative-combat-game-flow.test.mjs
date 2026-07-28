import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const game = readFileSync(join(root, 'game.js'), 'utf8');

function functionBody(name, nextName) {
  const start = game.indexOf(`function ${name}`);
  const end = game.indexOf(`\n  function ${nextName}`, start);
  assert.notEqual(start, -1, `${name} must exist`);
  assert.notEqual(end, -1, `${nextName} must follow ${name}`);
  return game.slice(start, end);
}

test('a submitted turn does not apply its final snapshot before combat notices', () => {
  const body = functionBody('presentResponse', 'renderAuthorityQuestionV3');
  const presentationStart = body.indexOf('.present(');

  assert.notEqual(presentationStart, -1, 'the authoritative presenter must own turn presentation');
  assert.doesNotMatch(
    body.slice(0, presentationStart),
    /applyServerPlayer\(response|applySession\(response\.session/,
  );
});

test('continue reconciles once, while victory and defeat wait for their endings', () => {
  const presentation = functionBody('presentResponse', 'renderAuthorityQuestionV3');
  const victory = functionBody('finishVictory', 'finishDefeat');
  const defeat = functionBody('finishDefeat', 'presentResponse');

  assert.match(presentation, /outcome === 'continue'[\s\S]*applySession\(serverResponse\.session, monster\)/);
  assert.doesNotMatch(presentation, /outcome === 'victory'[\s\S]*applyServerPlayer\(response/);
  assert.match(victory, /setTimeout\(\(\) => \{[\s\S]*applyServerPlayer\(response\)[\s\S]*showRewardSequenceV2/);
  assert.match(defeat, /applyServerPlayer\(response, true\)[\s\S]*resetLocalCombat\(\)/);
});

test('server outcome, not visually mutated hp, chooses the end of battle', () => {
  const body = functionBody('presentResponse', 'renderAuthorityQuestionV3');

  assert.match(body, /if \(outcome === 'victory'\) finishVictory\(response, monster\)/);
  assert.match(body, /else if \(outcome === 'defeat'\) finishDefeat\(response\)/);
  assert.doesNotMatch(body, /(?:monster|player)\.hp\s*<=\s*0[\s\S]*finish(?:Victory|Defeat)/);
});
