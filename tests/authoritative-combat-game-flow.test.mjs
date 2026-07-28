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

test('a combat error resumes once without silently submitting the attack again', () => {
  const start = game.indexOf('async function submitTurnV3');
  const end = game.indexOf('\n  async function startV3', start);
  const body = game.slice(start, end);

  assert.match(body, /hasAttemptedResume/);
  assert.equal((body.match(/\.resume\(\)/g) || []).length, 1);
  assert.equal((body.match(/\.submitTurn\(/g) || []).length, 1);
  assert.doesNotMatch(body, /catch[\s\S]*\.submitTurn\(/);
});

test('authority escape uses the server result, restores the old animation, and locks after failure', () => {
  const menu = functionBody('renderAuthorityMenuV3', 'showSkillsV3');
  const start = game.indexOf('window.escapeCombat = async function escapeCombatAuthorityV3');
  const end = game.indexOf('\n\n  combatEntryPipeline.register', start);
  const escape = game.slice(start, end);

  assert.match(menu, /session\?\.escapeFailed/);
  assert.match(escape, /\.attemptEscape\(session\.sessionRevision\)/);
  assert.doesNotMatch(escape, /\.surrender\(/);
  assert.match(escape, /const FLEE_MS = 1120/);
  assert.match(escape, /playSfx\('step'\)/);
  assert.match(escape, /translateX\(\$\{dist\}px\)/);
  assert.match(escape, /presentResponse\(response\)/);
});
