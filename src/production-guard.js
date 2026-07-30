(function installProductionGuard(global) {
  'use strict';

  const hostname = String(global.location?.hostname || '').toLowerCase();
  const local = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  global.__YUKSAM_PRODUCTION_GUARD__ = Object.freeze({ enabled:!local });
  if (local) return;

  document.addEventListener('keydown', (event) => {
    const key = String(event.key || '').toLowerCase();
    const developerShortcut = key === 'f12'
      || (event.ctrlKey && event.shiftKey && ['i', 'j', 'c', 'k'].includes(key))
      || (event.ctrlKey && key === 'u');
    if (!developerShortcut) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  // 기본 검사 메뉴만 숨긴다. 이벤트 전파는 막지 않아 게임의 우클릭 PVP는 그대로 작동한다.
  document.addEventListener('contextmenu', (event) => event.preventDefault(), true);
})(window);
