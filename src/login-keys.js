/* 로그인 입력칸에서 Enter를 누르면 버튼을 누른 것과 똑같이 동작하게 한다.
   버튼을 직접 click() 하므로 game.js가 나중에 바꿔 끼운 최신 로그인 처리가 그대로 쓰이고,
   처리 중이라 버튼이 잠겨 있으면 브라우저가 알아서 무시한다(중복 로그인 방지). */
(function installLoginKeys(global) {
  'use strict';

  // 입력칸 id -> 눌러야 할 버튼 id
  const SUBMIT_TARGETS = Object.freeze({
    loginName:'studentLoginBtn',
    loginPassword:'studentLoginBtn',
    teacherEmail:'teacherLoginBtn',
  });

  /* Enter가 눌렸으면 해당 버튼을 눌러주고 그 버튼 id를 돌려준다. 아무것도 안 했으면 null. */
  function handleKeyDown(event, doc) {
    if (!event || event.key !== 'Enter' || event.repeat) return null;
    if (event.isComposing) return null; // 한글 조합 중 Enter는 글자 확정이므로 건드리지 않는다
    const id = event.target && event.target.id;
    const buttonId = SUBMIT_TARGETS[id];
    if (!buttonId) return null;
    const button = doc && doc.getElementById(buttonId);
    if (!button || button.disabled) return null;
    if (typeof event.preventDefault === 'function') event.preventDefault();
    button.click();
    return buttonId;
  }

  function install(target, doc) {
    const listenOn = target || global;
    const document_ = doc || global.document;
    if (!listenOn || !listenOn.addEventListener || !document_) return false;
    listenOn.addEventListener('keydown', (event) => { handleKeyDown(event, document_); });
    return true;
  }

  global.YuksamLoginKeys = Object.freeze({ install, handleKeyDown, SUBMIT_TARGETS });
  install();
})(window);
