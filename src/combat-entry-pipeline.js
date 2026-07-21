(function initYuksamCombatEntryPipeline(global) {
  'use strict';

  function create(options = {}) {
    const enter = typeof options.enter === 'function' ? options.enter : () => {};
    const entries = [];
    const ids = new Set();
    let order = 0;

    function register(entry) {
      if (typeof entry?.handle !== 'function') throw new Error('Combat entry handler is required');
      const id = String(entry?.id || '').trim();
      if (!id) throw new Error('Combat entry registration id is required');
      if (ids.has(id)) throw new Error(`Duplicate combat entry registration: ${id}`);
      ids.add(id);
      const stored = { ...entry, id, priority:Number(entry.priority) || 0, order:order++ };
      entries.push(stored);
      let active = true;
      return function unregister() {
        if (!active) return;
        active = false;
        ids.delete(id);
        const index = entries.indexOf(stored);
        if (index >= 0) entries.splice(index, 1);
      };
    }

    function open(context) {
      const ordered = entries.slice().sort((a, b) => b.priority - a.priority || a.order - b.order);
      function dispatch(index) {
        const entry = ordered[index];
        if (!entry) return enter(context);
        let called = false;
        return entry.handle(context, () => {
          if (called) throw new Error('Combat entry next may only be called once');
          called = true;
          return dispatch(index + 1);
        });
      }
      return dispatch(0);
    }

    return Object.freeze({ register, open });
  }

  global.YuksamCombatEntryPipeline = Object.freeze({ create });
})(window);
