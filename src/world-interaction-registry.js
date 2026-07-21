(function initYuksamWorldInteractionRegistry(global) {
  'use strict';

  const STOP = Symbol('world-interaction-stop');

  function create(options = {}) {
    const findFallback = typeof options.findFallback === 'function' ? options.findFallback : () => null;
    const dispatchFallback = typeof options.dispatchFallback === 'function' ? options.dispatchFallback : () => false;
    const beforeDispatch = typeof options.beforeDispatch === 'function' ? options.beforeDispatch : () => {};
    const candidates = [];
    const actions = [];
    const ids = new Set();
    let order = 0;

    function sortEntries(entries) {
      entries.sort((a, b) => b.priority - a.priority || a.order - b.order);
    }

    function addEntry(collection, entry) {
      const id = String(entry?.id || '').trim();
      if (!id) throw new Error('World interaction registration id is required');
      if (ids.has(id)) throw new Error(`Duplicate world interaction registration: ${id}`);
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

    function registerCandidate(entry) {
      if (typeof entry?.find !== 'function') throw new Error('World interaction candidate finder is required');
      return addEntry(candidates, entry);
    }

    function registerAction(entry) {
      if (typeof entry?.handle !== 'function') throw new Error('World interaction action handler is required');
      const types = new Set((Array.isArray(entry.types) ? entry.types : [entry.types]).filter(Boolean).map(String));
      if (!types.size) throw new Error('World interaction action types are required');
      return addEntry(actions, { ...entry, types });
    }

    function find(context) {
      for (const entry of candidates) {
        const candidate = entry.find(context);
        if (candidate === STOP) return null;
        if (candidate) return candidate;
      }
      return findFallback(context) || null;
    }

    function dispatch(context) {
      const candidate = find(context);
      beforeDispatch(candidate, context);
      if (!candidate) return false;
      for (const entry of actions) {
        if (entry.types.has(String(candidate.type)) && entry.handle(candidate, context) === true) return true;
      }
      return dispatchFallback(candidate, context) === true;
    }

    return Object.freeze({ registerCandidate, registerAction, find, dispatch });
  }

  global.YuksamWorldInteractionRegistry = Object.freeze({ create, STOP });
})(window);
