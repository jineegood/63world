/* =========================================================
   spec-prompt.js — 전문화 선택 안내를 놓치지 않게 한다

   원래 게임은 "레벨이 오르는 순간"에만 전문화 창을 띄운다(addExp 안).
   그래서 이미 Lv.5를 넘긴 캐릭터가 창을 한 번 닫아 버리면 다시 뜨지 않고,
   학생 입장에서는 "왜 안 띄워주냐"가 된다.

   여기서는 조건이 맞을 때 다시 안내한다.
     - 게임 화면으로 들어올 때(로그인·마을 복귀 등)
     - 다른 창이 떠 있지 않고 전투 중도 아닐 때만

   game.js는 건드리지 않고 호출 시점 참조로만 붙인다.
   ========================================================= */
(function initYuksamSpecPrompt(global) {
  'use strict';

  if (global.__YUKSAM_SPEC_PROMPT_V1__) return;
  global.__YUKSAM_SPEC_PROMPT_V1__ = true;

  const REQUIRED_LEVEL = 5;
  const DELAY_MS = 900;

  const G = () => (typeof game !== 'undefined' ? game : null);
  const call = (name, ...args) => (typeof global[name] === 'function' ? global[name](...args) : undefined);

  /* 지금 전문화를 골라야 하는 상태인가? */
  function needsSpec() {
    const player = G()?.player;
    return !!player && (player.level || 1) >= REQUIRED_LEVEL && !player.spec;
  }

  /* 방해하면 안 되는 순간인지 본다(전투 중, 다른 창이 떠 있을 때). */
  function busyNow() {
    const g = G();
    const type = g?.modalState?.type;
    if (!type) return false;
    return true;   // 어떤 창이든 떠 있으면 기다린다
  }

  function promptIfNeeded() {
    if (!needsSpec() || busyNow()) return false;
    const screens = global.document.getElementById('game');
    if (!screens || !screens.classList.contains('active')) return false;
    call('openSpecModal');
    return true;
  }

  function schedulePrompt() {
    global.setTimeout(() => { promptIfNeeded(); }, DELAY_MS);
  }

  function install() {
    // 게임 화면으로 들어올 때마다 확인한다(로그인, 마을 복귀 등).
    if (typeof global.showScreen === 'function') {
      const previousShowScreen = global.showScreen;
      global.showScreen = function showScreenWithSpecPrompt(name) {
        const result = previousShowScreen.apply(this, arguments);
        if (name === 'game') schedulePrompt();
        return result;
      };
    }

    /* 창을 닫을 때도 확인한다. 전투가 끝나 창이 닫히는 순간이
       전문화를 고르기에 가장 자연스러운 시점이기 때문이다. */
    if (typeof global.closeModal === 'function') {
      const previousCloseModal = global.closeModal;
      global.closeModal = function closeModalWithSpecPrompt() {
        const result = previousCloseModal.apply(this, arguments);
        if (needsSpec()) schedulePrompt();
        return result;
      };
    }
  }

  global.YuksamSpecPrompt = Object.freeze({
    REQUIRED_LEVEL,
    needsSpec,
    promptIfNeeded,
    install,
  });

  install();
})(typeof window !== 'undefined' ? window : globalThis);
