(function initYuksamHudUpdatePipeline(global) {
  'use strict';

  function create(options = {}) {
    const render = typeof options.render === 'function' ? options.render : () => {};
    const entries = [];
    const ids = new Set();
    let order = 0;

    function register(entry) {
      const hasBefore = typeof entry?.before === 'function';
      const hasAfter = typeof entry?.after === 'function';
      if (!hasBefore && !hasAfter) throw new Error('HUD update registration requires a before or after hook');
      const id = String(entry?.id || '').trim();
      if (!id) throw new Error('HUD update registration id is required');
      if (ids.has(id)) throw new Error(`Duplicate HUD update registration: ${id}`);
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

    function update(context) {
      const beforeEntries = entries
        .filter((entry) => typeof entry.before === 'function')
        .sort((a, b) => b.priority - a.priority || a.order - b.order);
      const afterEntries = entries
        .filter((entry) => typeof entry.after === 'function')
        .sort((a, b) => a.priority - b.priority || a.order - b.order);
      for (const entry of beforeEntries) entry.before(context);
      render(context);
      for (const entry of afterEntries) entry.after(context);
    }

    return Object.freeze({ register, update });
  }

  global.YuksamHudUpdatePipeline = Object.freeze({ create });
})(window);
