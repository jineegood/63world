(function initYuksamWorldRenderPipeline(global) {
  'use strict';

  function create(options = {}) {
    const fallback = typeof options.fallback === 'function' ? options.fallback : () => {};
    const owners = [];
    const layers = [];
    const ids = new Set();
    let order = 0;

    function addEntry(collection, entry) {
      const id = String(entry?.id || '').trim();
      if (!id) throw new Error('World render registration id is required');
      if (ids.has(id)) throw new Error(`Duplicate world render registration: ${id}`);
      ids.add(id);
      const stored = { ...entry, id, priority:Number(entry.priority) || 0, order:order++ };
      collection.push(stored);
      let active = true;
      return function unregister() {
        if (!active) return;
        active = false;
        ids.delete(id);
        const index = collection.indexOf(stored);
        if (index >= 0) collection.splice(index, 1);
      };
    }

    function registerOwner(entry) {
      if (typeof entry?.owns !== 'function') throw new Error('World render owner predicate is required');
      if (typeof entry?.render !== 'function') throw new Error('World render owner renderer is required');
      const unregister = addEntry(owners, entry);
      owners.sort((a, b) => b.priority - a.priority || a.order - b.order);
      return unregister;
    }

    function registerLayer(entry) {
      if (typeof entry?.render !== 'function') throw new Error('World render layer renderer is required');
      const unregister = addEntry(layers, { when:() => true, ...entry });
      layers.sort((a, b) => a.priority - b.priority || a.order - b.order);
      return unregister;
    }

    function render(context) {
      const owner = owners.find((entry) => entry.owns(context));
      if (owner) owner.render(context);
      else fallback(context);
      for (const layer of layers) {
        if (layer.when(context)) layer.render(context);
      }
    }

    return Object.freeze({ registerOwner, registerLayer, render });
  }

  global.YuksamWorldRenderPipeline = Object.freeze({ create });
})(window);
