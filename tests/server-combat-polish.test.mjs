import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const game = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

/* 서버 전투로 옮기면서 사라지거나 어긋났던 것들을 되돌린 뒤, 다시 무너지지 않게 고정한다. */

test('a defeated monster is finished off only after its log has played', () => {
  // 연출 재생기는 몬스터가 이미 죽어 있으면 큐를 버리고 완료 신호도 보내지 않는다.
  // 그래서 승리 처리는 로그가 끝난 뒤에 해야 하고, 그때까지는 살아 있어야 한다.
  const presentation = game.slice(game.indexOf('function presentResponse'));
  const presentationBody = presentation.slice(0, presentation.indexOf('\n  function renderAuthorityQuestionV3'));
  assert.doesNotMatch(presentationBody, /applySession\(response\.session/);
  const victory = game.slice(game.indexOf('function finishVictory'));
  const body = victory.slice(0, victory.indexOf('\n  function finishDefeat'));
  assert.match(body, /monster\.hp = 0;/);
  assert.match(body, /monster\.alive = false;/);
});

test('a defeated monster plays its falling animation before the rewards', () => {
  const victory = game.slice(game.indexOf('function finishVictory'));
  const body = victory.slice(0, victory.indexOf('\n  function finishDefeat'));
  // 회색으로 기울어지며 사라지는 연출은 dying + deathStartedAt 으로 그려진다
  assert.match(body, /monster\.dying = true;/);
  assert.match(body, /monster\.deathStartedAt = Date\.now\(\);/);
  assert.doesNotMatch(body, /monster\.dying = false;\s*\n\s*monster\.respawnAt/, '연출을 건너뛰던 예전 코드가 남아 있습니다');
  // 쓰러지는 소리 → 처치 소리 → 보상 순서
  assert.ok(body.indexOf("playSfx('hit')") < body.indexOf("playSfx('victory')"), '소리 순서가 어긋납니다');
  assert.ok(body.indexOf("playSfx('victory')") < body.indexOf('showRewardSequenceV2'), '보상이 처치보다 먼저 나옵니다');
  // 같은 몬스터를 두 번 쓰러뜨리지 않는다
  assert.match(body, /if \(monster\.dying\) return;/);
});

test('every blow carries a sound', () => {
  const log = fs.readFileSync(path.join(root, 'src/combat-log-v3.js'), 'utf8');
  for (const id of ['critical', 'miss', 'enemyAttack', 'shadowStackHit', 'defensiveStance', 'synthWindupCue']) {
    assert.ok(log.includes(`'${id}'`), `${id} 소리가 연결되지 않았습니다`);
  }
  // 기본 공격은 직업별 소리를 쓴다
  assert.match(game, /classBasicSounds\?\.\[game\.player\?\.class \|\| 'warrior'\]/);
});

test('running away is called 도망 again and gets its old send-off', () => {
  const menu = game.slice(game.indexOf('function renderAuthorityMenuV3'));
  const body = menu.slice(0, menu.indexOf('\n  function showSkillsV3'));
  assert.match(body, /'도망 불가' : \(escapeLocked \? '도망 실패' : '도망'\)/);
  assert.doesNotMatch(body, /전투 그만두기/);

  const escape = game.slice(game.indexOf('window.escapeCombat = async function escapeCombatAuthorityV3'));
  const escapeBody = escape.slice(0, 3200);
  assert.match(escapeBody, /도망치는 데 성공했다!/);
  assert.match(escapeBody, /playSfx\('step'\)/);
});

test('the four choices are shuffled so the answer is not always in the same slot', () => {
  assert.match(game, /choices:Array\.isArray\(session\.question\?\.choices\) \? shuffleArray\(/);
  // 제출은 번호가 아니라 고른 값으로 가야 섞어도 채점이 맞는다
  const submit = game.slice(game.indexOf('window.submitAuthorityPveChoiceV3'));
  assert.match(submit.slice(0, 260), /submitTurnV3\(choice\)/);
});

test('the battle opens with the old wording', () => {
  assert.match(game, /'보스 몬스터가 나타났다!' : '야생의 적이 나타났다!'/);
  assert.match(game, /\$\{monster\.name\}\(이\)가 전투를 걸어왔다!/);
  assert.ok(!game.includes('전투 서버에 연결하고 있습니다'), '서버 연결 문구가 남아 있습니다');
});

test('the tutorial turns pages with the same sound as quest talk', () => {
  const tutorial = fs.readFileSync(path.join(root, 'src/tutorial.js'), 'utf8');
  assert.match(tutorial, /playSfx\?\.\('dialogue'\)/);
  // 소리가 너무 작아 잘 안 들리던 것을 키웠다
  assert.match(game, /if \(name === 'dialogue'\) \{ playTone\(880, \.05, 'sine', \.14\); return; \}/);
});

test('nothing tells the player about servers any more', () => {
  for (const phrase of [
    '서버가 안전하게',
    '서버가 채점하고',
    '서버가 계산하고',
    '정답과 피해량은 서버',
    '서버가 출제',
  ]) {
    assert.ok(!game.includes(phrase), `플레이어에게 보이는 문구가 남아 있습니다: ${phrase}`);
  }
});

test('four choices lay out in the two by two grid the old battle used', () => {
  const render = game.slice(game.indexOf('function renderAuthorityQuestionV3'));
  const body = render.slice(0, render.indexOf('\n  }\n'));
  assert.match(body, /class="choice-grid"/);
  assert.match(body, /class="objective-chip"/);
  assert.match(body, /class="combat-question"/);
  assert.match(body, /class="answer-row"/);
  // 스타일이 없어 버튼이 붙어 나오던 예전 클래스는 쓰지 않는다
  assert.doesNotMatch(body, /class="combat-choices"/);
  // 격자 스타일이 실제로 정의돼 있어야 한다
  assert.match(style, /\.choice-grid \{[^}]*grid-template-columns: repeat\(2,/);
});

test('typing an answer still works and takes focus', () => {
  const render = game.slice(game.indexOf('function renderAuthorityQuestionV3'));
  const body = render.slice(0, render.indexOf('\n  }\n'));
  assert.match(body, /id="combatAnswer"/);
  assert.match(body, /event\.key==='Enter'/);
  assert.match(body, /combatAnswer'\)\?\.focus\(\)/);
});

test('the screen shake is reachable from every patch block', () => {
  assert.match(game, /window\.triggerScreenShakeV19 = triggerScreenShakeV19;/);
  const exportIndex = game.indexOf('window.triggerScreenShakeV19 = triggerScreenShakeV19;');
  const declIndex = game.indexOf('function triggerScreenShakeV19');
  assert.ok(declIndex < exportIndex, '정의보다 먼저 내보낼 수 없습니다');
  // 스코프 밖에서 부르다 ReferenceError를 내던 예전 호출은 남아 있으면 안 된다
  assert.doesNotMatch(game, /try \{ triggerScreenShakeV19\(\); \} catch/);
});

test('making a new character still gets its announcement', () => {
  const login = game.slice(game.indexOf('async function handleStudentLogin'));
  const body = login.slice(0, login.indexOf('\nfunction hasAvailableQuest'));
  assert.match(body, /새 캐릭터를 등록합니다/);
  assert.match(body, /cinematicOverlay/);
  assert.match(body, /showScreen\('creator'\)/);
});

test('turning a dialogue page makes a small sound', () => {
  assert.match(game, /if \(name === 'dialogue'\) \{ playTone\(/);
  const advance = game.match(/window\.nextDialoguePage = function[^\n]*/)[0];
  assert.match(advance, /playSfx\('dialogue'\)/);
  // 마지막 장에서 계속 누를 때 소리가 반복되면 안 된다
  assert.match(advance, /if \(next !== game\.dialogue\.page\) playSfx\('dialogue'\)/);
});

test('clicking your way to an npc or portal talks to it on arrival', () => {
  // 클릭 이동이 목적지에 서면(moving:false) 그 자리의 상호작용을 한 번만 실행한다
  assert.match(game, /if \(state && state\.moving === false\) tryClickInteractOnArrivalV59\(state\);/);
  const helper = game.slice(game.indexOf('function tryClickInteractOnArrivalV59'));
  const body = helper.slice(0, helper.indexOf('\nconst clickMovementControllerV1'));
  assert.match(body, /worldInteractionRegistry\.find\?\.\(\)/);
  assert.match(body, /interact\(\)/);
  // 같은 도착에서 두 번 실행되면 안 된다
  assert.match(body, /clickInteractHandledV59 === token/);
  // 전투 중이거나 창이 열려 있으면 건드리지 않는다
  assert.match(body, /game\.modalState\?\.type/);
  assert.match(body, /game\.currentCombatMonsterId/);
  assert.match(body, /isPaused\?\.\(\)/);
});
