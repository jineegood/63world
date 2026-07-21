(function initYuksamAudioVolumePipeline(global) {
  'use strict';

  function create(options = {}) {
    const updateBase = typeof options.update === 'function' ? options.update : () => {};
    const entries = [];
    const ids = new Set();
    let order = 0;

    function register(entry) {
      if (typeof entry?.after !== 'function') throw new Error('Audio volume handler is required');
      const id = String(entry?.id || '').trim();
      if (!id) throw new Error('Audio volume registration id is required');
      if (ids.has(id)) throw new Error(`Duplicate audio volume registration: ${id}`);
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
      const ordered = entries.slice().sort((a, b) => a.priority - b.priority || a.order - b.order);
      const result = updateBase(context);
      for (const entry of ordered) entry.after(context);
      return result;
    }

    return Object.freeze({ register, update });
  }

  global.YuksamAudioVolumePipeline = Object.freeze({ create });
})(window);
