(function initYuksamInputRouter(global) {
  'use strict';

  const handlers = { keydown:[], keyup:[] };
  const ids = new Set();
  let sequence = 0;

  function register(options = {}) {
    const id = String(options.id || '').trim();
    const type = options.type === 'keyup' ? 'keyup' : 'keydown';
    if (!id) throw new Error('Input handler id is required');
    if (ids.has(id)) throw new Error(`Duplicate input handler: ${id}`);
    if (typeof options.handle !== 'function') throw new Error(`Input handler must be a function: ${id}`);

    const entry = {
      id,
      type,
      priority:Number(options.priority) || 0,
      order:sequence++,
      handle:options.handle,
    };
    ids.add(id);
    handlers[type].push(entry);
    handlers[type].sort((a, b) => b.priority - a.priority || a.order - b.order);

    let active = true;
    return function unregister() {
      if (!active) return;
      active = false;
      ids.delete(id);
      const index = handlers[type].indexOf(entry);
      if (index >= 0) handlers[type].splice(index, 1);
    };
  }

  function dispatch(type, event) {
    const snapshot = handlers[type].slice();
    for (const entry of snapshot) {
      if (entry.handle(event) === true) return true;
    }
    return false;
  }

  global.addEventListener('keydown', (event) => dispatch('keydown', event), true);
  global.addEventListener('keyup', (event) => dispatch('keyup', event), true);
  global.YuksamInputRouter = Object.freeze({ register });
})(window);
