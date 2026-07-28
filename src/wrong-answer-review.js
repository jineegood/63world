(function (global) {
  'use strict';

  const REVIEW_MS = 2000;

  function reveal({ root, correctAnswer, onComplete, setTimer = global.setTimeout } = {}) {
    const answer = String(correctAnswer ?? '');
    const choiceButtons = Array.from(root?.querySelectorAll?.('.choice-grid button') || []);
    const answerInput = root?.querySelector?.('#combatAnswer') || null;
    const submitButton = root?.querySelector?.('.answer-row button') || null;

    choiceButtons.forEach((button) => {
      button.disabled = true;
      if (decodeURIComponent(button.dataset.answerKey || '') === answer) {
        button.classList.add('correct-answer-review');
      }
    });

    if (!choiceButtons.length && answerInput) {
      answerInput.value = answer;
      answerInput.readOnly = true;
      answerInput.classList.add('correct-answer-review');
      if (submitButton) submitButton.disabled = true;
    }

    return setTimer(() => onComplete?.(), REVIEW_MS);
  }

  global.YuksamWrongAnswerReview = Object.freeze({
    REVIEW_MS,
    reveal,
  });
})(window);
