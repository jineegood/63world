(function initYuksamTotalStatsPipeline(global) {
  'use strict';

  function create(options = {}) {
    const calculate = typeof options.calculate === 'function' ? options.calculate : () => ({});
    const entries = [];
    const ids = new Set();
    let order = 0;

    function register(entry) {
      const hasPrepare = typeof entry?.prepare === 'function';
      const hasApply = typeof entry?.apply === 'function';
      if (!hasPrepare && !hasApply) throw new Error('Total stats registration requires a prepare or apply hook');
      const id = String(entry?.id || '').trim();
      if (!id) throw new Error('Total stats registration id is required');
      if (ids.has(id)) throw new Error(`Duplicate total stats registration: ${id}`);
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

    function compute(context) {
      const prepares = entries
        .filter((entry) => typeof entry.prepare === 'function')
        .sort((a, b) => b.priority - a.priority || a.order - b.order);
      const modifiers = entries
        .filter((entry) => typeof entry.apply === 'function')
        .sort((a, b) => a.priority - b.priority || a.order - b.order);
      for (const entry of prepares) entry.prepare(context);
      const total = calculate(context);
      if (!total || typeof total !== 'object' || Array.isArray(total)) throw new Error('Total stats calculator must return a stats object');
      for (const entry of modifiers) entry.apply(total, context);
      return total;
    }

    return Object.freeze({ register, compute });
  }

  global.YuksamTotalStatsPipeline = Object.freeze({ create });
})(window);
