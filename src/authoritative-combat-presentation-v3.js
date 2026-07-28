(function initYuksamAuthoritativeCombatPresentationV3(global) {
  'use strict';

  function responseKey(response) {
    if (!response || typeof response !== 'object') return '';
    if (response.requestId) return `request:${String(response.requestId)}`;
    const revision = response.session?.revision ?? response.sessionRevision;
    return revision == null ? '' : `revision:${String(revision)}`;
  }

  function create(options = {}) {
    const playNotices = typeof options.playNotices === 'function'
      ? options.playNotices
      : (_notices, done) => done();
    const reconcile = typeof options.reconcile === 'function' ? options.reconcile : () => {};
    const finish = typeof options.finish === 'function' ? options.finish : () => {};
    const presented = new Set();
    let active = false;

    function present({ response, notices = [] } = {}) {
      const key = responseKey(response);
      if (active || (key && presented.has(key))) return false;

      active = true;
      if (key) {
        presented.add(key);
        if (presented.size > 64) presented.delete(presented.values().next().value);
      }

      let completed = false;
      const complete = () => {
        if (completed) return;
        completed = true;
        try {
          reconcile(response);
          finish(response);
        } finally {
          active = false;
        }
      };

      try {
        playNotices(Array.isArray(notices) ? notices : [], complete);
      } catch (error) {
        active = false;
        throw error;
      }
      return true;
    }

    return Object.freeze({
      present,
      isPresenting:() => active,
    });
  }

  global.YuksamAuthoritativeCombatPresentationV3 = Object.freeze({ create });
})(window);
