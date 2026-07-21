(function audioDispatcherModule() {
  'use strict';

  const UPGRADE_NAMES = new Set(['upgradeCharge', 'upgradeSuccess', 'upgradeFail']);

  function once(fn) {
    let called = false;
    return () => {
      if (called) return;
      called = true;
      fn?.();
    };
  }

  function create(options) {
    const deps = options || {};
    return function play(name) {
      if (name === 'critical') {
        const fallback = once(deps.playPlayerHitFallback);
        deps.playCriticalVisuals?.(deps.getCriticalSource?.() || 'player');
        if (!deps.playMapped?.('critical', fallback)) fallback();
        return;
      }
      if (name === 'door') {
        deps.playDoor?.();
        return;
      }
      if (UPGRADE_NAMES.has(name)) {
        if (!deps.playUpgrade?.(name)) deps.playSynth?.(name);
        return;
      }
      deps.playSynth?.(name);
    };
  }

  window.YuksamAudioDispatcher = Object.freeze({ create });
})();
