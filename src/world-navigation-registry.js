(function initYuksamWorldNavigationRegistry(global) {
  'use strict';

  function create(options = {}) {
    const colliderFallback = typeof options.colliderFallback === 'function' ? options.colliderFallback : () => [];
    const transitionFallback = typeof options.transitionFallback === 'function' ? options.transitionFallback : () => false;
    const colliders = [];
    const transitions = [];
    const ids = new Set();
    let order = 0;

    function sortEntries(entries) {
      entries.sort((a, b) => b.priority - a.priority || a.order - b.order);
    }

    function addEntry(collection, entry) {
      const id = String(entry?.id || '').trim();
      if (!id) throw new Error('World navigation registration id is required');
      if (ids.has(id)) throw new Error(`Duplicate world navigation registration: ${id}`);
      ids.add(id);
      const stored = { ...entry, id, priority:Number(entry.priority) || 0, order:order++ };
      collection.push(stored);
      sortEntries(collection);
      let active = true;
      return function unregister() {
        if (!active) return;
        active = false;
        ids.delete(id);
        const index = collection.indexOf(stored);
        if (index >= 0) collection.splice(index, 1);
      };
    }

    function registerCollider(entry) {
      if (typeof entry?.resolve !== 'function') throw new Error('World navigation collider resolver is required');
      return addEntry(colliders, entry);
    }

    function registerTransition(entry) {
      if (typeof entry?.handle !== 'function') throw new Error('World navigation transition handler is required');
      return addEntry(transitions, entry);
    }

    function getColliders(context) {
      for (const entry of colliders) {
        const result = entry.resolve(context);
        if (Array.isArray(result)) return result;
      }
      const fallback = colliderFallback(context);
      return Array.isArray(fallback) ? fallback : [];
    }

    function runTransition(context) {
      for (const entry of transitions) {
        if (entry.handle(context) === true) return true;
      }
      return transitionFallback(context) === true;
    }

    return Object.freeze({ registerCollider, registerTransition, getColliders, runTransition });
  }

  global.YuksamWorldNavigationRegistry = Object.freeze({ create });
})(window);
