import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');

test('wrong answers show the answer in green, deal half damage, then allow the counterattack', () => {
  const game = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
  const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  const review = fs.readFileSync(path.join(root, 'src', 'wrong-answer-review.js'), 'utf8');
  const start = game.indexOf('function calculateWrongActionDamageV2');
  const wrongBranch = game.slice(start, game.indexOf('function applyDamageToMonsterV40', start));

  assert.match(wrongBranch, /calculateWrongActionDamageV2\(\)/);
  assert.match(wrongBranch, /wrongHitDamage/);
  assert.match(wrongBranch, /Number\(active\.multiplier\) === 0/);
  assert.doesNotMatch(wrongBranch, /critRollV25|applyPlayerChillToActionV25|supportEffects/);
  assert.match(wrongBranch, /오답입니다! 정답은 \$\{correctAnswer\} \(오답이라 데미지가 절반만 들어갑니다\)/);
  assert.equal((wrongBranch.match(/type:'answer-wrong'/g) || []).length, 1);
  assert.match(wrongBranch, /tone:'correct-answer'/);
  assert.match(wrongBranch, /duration:2[0-9]{3}/);
  assert.match(wrongBranch, /preserveDuration:true/);
  assert.match(wrongBranch, /wrongActionAudioId/);
  assert.match(wrongBranch, /audioId:wrongActionAudioId, fallbackSfx:'hit'/);
  assert.match(wrongBranch, /monsterCounterAttack/);
  assert.match(style, /\.combat-notice\.correct-answer[^}]*#(?:22c55e|4ade80)/);
  assert.match(game, /YuksamWrongAnswerReview\.reveal/);
  assert.match(game, /data-answer-key=/);
  assert.match(review, /REVIEW_MS = 2000/);
  assert.match(review, /correct-answer-review/);
  assert.match(style, /\.choice-grid button\.correct-answer-review/);
  assert.match(style, /\.answer-row input\.correct-answer-review/);
});

test('healing well wrong answers reveal the correct answer for two seconds before failing', () => {
  const game = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
  const review = fs.readFileSync(path.join(root, 'src', 'wrong-answer-review.js'), 'utf8');
  const start = game.indexOf('window.openHealingWellModal');
  const healingWell = game.slice(start, game.indexOf('const QUEST_ORDER_V19', start));

  assert.match(healingWell, /data-answer-key=/);
  assert.match(healingWell, /data-answer-review-input/);
  assert.match(healingWell, /game\.healingAnswerReviewing = true/);
  assert.match(healingWell, /YuksamWrongAnswerReview\.reveal\(\{[\s\S]*?correctAnswer:q\.answer/);
  assert.match(healingWell, /game\.healingReviewGeneration !== reviewGeneration/);
  assert.match(healingWell, /game\.healingQuestion === reviewedQuestion/);
  assert.match(healingWell, /game\.modalState\?\.type !== 'healingWell'/);
  assert.match(healingWell, /onComplete:\(\) => \{[\s\S]*?closeModal\(\);[\s\S]*?showCinematicMessage\('회복 실패'/);
  assert.match(review, /REVIEW_MS = 2000/);
  assert.match(review, /\[data-answer-review-input\], #combatAnswer/);
});

test('wrong-answer review disables both answer UIs until its exact two-second timer completes', () => {
  const window = { setTimeout };
  vm.runInNewContext(
    fs.readFileSync(path.join(root, 'src', 'wrong-answer-review.js'), 'utf8'),
    { window },
    { filename:'src/wrong-answer-review.js' },
  );
  const api = window.YuksamWrongAnswerReview;
  const makeClassList = () => {
    const values = new Set();
    return { add:(value) => values.add(value), contains:(value) => values.has(value) };
  };

  const wrongChoice = { disabled:false, dataset:{ answerKey:encodeURIComponent('11') }, classList:makeClassList() };
  const correctChoice = { disabled:false, dataset:{ answerKey:encodeURIComponent('12') }, classList:makeClassList() };
  let choiceDelay = 0;
  let finishChoices = null;
  let choicesComplete = false;
  api.reveal({
    root:{ querySelectorAll:() => [wrongChoice, correctChoice], querySelector:() => null },
    correctAnswer:'12',
    onComplete:() => { choicesComplete = true; },
    setTimer:(callback, delay) => { finishChoices = callback; choiceDelay = delay; return 1; },
  });
  assert.equal(choiceDelay, 2000);
  assert.equal(choicesComplete, false);
  assert.equal(wrongChoice.disabled, true);
  assert.equal(correctChoice.disabled, true);
  assert.equal(wrongChoice.classList.contains('correct-answer-review'), false);
  assert.equal(correctChoice.classList.contains('correct-answer-review'), true);
  finishChoices();
  assert.equal(choicesComplete, true);

  const answerInput = { value:'오답', readOnly:false, classList:makeClassList() };
  const submitButton = { disabled:false };
  let inputDelay = 0;
  let finishInput = null;
  let inputComplete = false;
  api.reveal({
    root:{
      querySelectorAll:() => [],
      querySelector:(selector) => selector === '.answer-row button' ? submitButton : answerInput,
    },
    correctAnswer:'정답',
    onComplete:() => { inputComplete = true; },
    setTimer:(callback, delay) => { finishInput = callback; inputDelay = delay; return 2; },
  });
  assert.equal(inputDelay, 2000);
  assert.equal(inputComplete, false);
  assert.equal(answerInput.value, '정답');
  assert.equal(answerInput.readOnly, true);
  assert.equal(answerInput.classList.contains('correct-answer-review'), true);
  assert.equal(submitButton.disabled, true);
  finishInput();
  assert.equal(inputComplete, true);
});

function loadHealingWellFlow(questions) {
  const game = {
    player:{ hp:1, maxHp:10 },
    modalState:{ type:null, pause:false },
  };
  const reviews = [];
  let closeCalls = 0;
  const sandbox = {
    game,
    window:{},
    getHealingQuestion:() => questions.shift(),
    escapeJs:(value) => String(value),
    escapeHtml:(value) => String(value),
    openModal:(_html, options) => { game.modalState = { type:options.type, pause:!!options.pause }; },
    closeModal:() => { closeCalls += 1; game.modalState = { type:null, pause:false }; },
    setTimeout:() => 0,
    $:() => ({ focus() {} }),
    normalize:(value) => String(value ?? '').trim(),
    savePlayer() {},
    updateHud() {},
    playSfx() {},
    showCinematicMessage() {},
    appendChatMessage() {},
    YuksamWrongAnswerReview:{ reveal:({ onComplete }) => reviews.push(onComplete) },
  };
  sandbox.window.YuksamWrongAnswerReview = sandbox.YuksamWrongAnswerReview;
  const source = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
  const start = source.indexOf('window.openHealingWellModal');
  const flow = source.slice(start, source.indexOf('const QUEST_ORDER_V19', start));
  vm.runInNewContext(flow, sandbox, { filename:'game.js#healing-well-flow' });
  return {
    game,
    reviews,
    open:sandbox.window.openHealingWellModal,
    submit:sandbox.window.submitHealingAnswer,
    closeCalls:() => closeCalls,
  };
}

test('an expired healing review never closes a newer modal', () => {
  const firstQuestion = { q:'1 + 1', choices:['1', '2', '3', '4'], answer:'2' };
  const flow = loadHealingWellFlow([firstQuestion]);
  flow.open();
  flow.submit('1');
  assert.equal(flow.game.healingAnswerReviewing, true);

  flow.game.modalState = { type:'workbook', pause:true };
  flow.reviews[0]();
  assert.deepEqual(flow.game.modalState, { type:'workbook', pause:true });
  assert.equal(flow.closeCalls(), 0);
  assert.equal(flow.game.healingAnswerReviewing, false);
  assert.equal(flow.game.healingQuestion, null);
});

test('an old healing review cannot clear or unlock a newly opened well review', () => {
  const firstQuestion = { q:'1 + 1', choices:['1', '2', '3', '4'], answer:'2' };
  const secondQuestion = { q:'2 + 2', choices:['2', '3', '4', '5'], answer:'4' };
  const flow = loadHealingWellFlow([firstQuestion, secondQuestion]);
  flow.open();
  flow.submit('1');
  const finishOldReview = flow.reviews[0];

  flow.open();
  flow.submit('3');
  const finishNewReview = flow.reviews[1];
  finishOldReview();
  assert.equal(flow.game.healingQuestion, secondQuestion);
  assert.equal(flow.game.healingAnswerReviewing, true);
  assert.equal(flow.game.modalState.type, 'healingWell');
  assert.equal(flow.closeCalls(), 0);

  finishNewReview();
  assert.equal(flow.game.healingQuestion, null);
  assert.equal(flow.game.healingAnswerReviewing, false);
  assert.equal(flow.game.modalState.type, null);
  assert.equal(flow.closeCalls(), 1);
});
