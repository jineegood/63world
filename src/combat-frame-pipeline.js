(function initYuksamCombatFramePipeline(global) {
  'use strict';

  function create(options = {}) {
    const renderBase = typeof options.render === 'function' ? options.render : () => {};
    const entries = [];
    const ids = new Set();
    let order = 0;

    function register(entry) {
      if (typeof entry?.after !== 'function') throw new Error('Combat frame handler is required');
      const id = String(entry?.id || '').trim();
      if (!id) throw new Error('Combat frame registration id is required');
      if (ids.has(id)) throw new Error(`Duplicate combat frame registration: ${id}`);
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

    function render(context) {
      const ordered = entries.slice().sort((a, b) => a.priority - b.priority || a.order - b.order);
      const result = renderBase(context);
      for (const entry of ordered) entry.after(context);
      return result;
    }

    return Object.freeze({ register, render });
  }

  global.YuksamCombatFramePipeline = Object.freeze({ create });
})(window);
