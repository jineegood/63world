/* 대화창이 '일반 대화'인지 '퀘스트 대화'인지에 따라 붙일 CSS 클래스를 정한다.
   색과 모양은 style.css가 담당하고, 여기서는 어떤 상태인지만 판단한다(순수 계산). */
(function installQuestDialogueTheme(global) {
  'use strict';

  const QUEST_STORY = 'quest-dialogue';          // 퀘스트 이야기 듣기 · 수락
  const QUEST_COMPLETE = 'quest-complete-dialogue'; // 퀘스트 완료 보고 · 보상 받기
  const PLAIN = '';                               // 일반 대화

  /* mode: 'quest'면 퀘스트 이야기 화면
     questStatus: 해당 퀘스트의 진행 상태('accepted' | 'ready' | 'done' 등)
     hasQuest: 지금 대화에 연결된 퀘스트가 있는지 */
  function classFor(state) {
    const mode = state && state.mode;
    const questStatus = state && state.questStatus;
    const hasQuest = Boolean(state && state.hasQuest);
    if (!hasQuest) return PLAIN;
    if (mode === 'quest') return QUEST_STORY;
    if (questStatus === 'ready') return QUEST_COMPLETE;
    return PLAIN;
  }

  /* class 속성에 바로 넣을 수 있게 앞 공백까지 붙여서 돌려준다. */
  function classSuffix(state) {
    const name = classFor(state);
    return name ? ` ${name}` : '';
  }

  global.YuksamQuestDialogueTheme = Object.freeze({
    classFor,
    classSuffix,
    QUEST_STORY,
    QUEST_COMPLETE,
  });
})(window);
