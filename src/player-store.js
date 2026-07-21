(function installPlayerStore(global) {
  'use strict';

  function create({ storage, prefix, normalizePlayer } = {}) {
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function'
      || typeof storage.removeItem !== 'function' || typeof storage.key !== 'function') {
      throw new TypeError('player store requires a storage implementation');
    }
    if (typeof prefix !== 'string') throw new TypeError('player store requires a string prefix');
    if (typeof normalizePlayer !== 'function') throw new TypeError('player store requires normalizePlayer');

    const key = (name) => prefix + String(name).trim();

    function read(name) {
      const raw = storage.getItem(key(name));
      if (raw === null) return { status:'absent', player:null, raw:null };
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return { status:'valid', player:normalizePlayer(parsed), raw };
        }
      } catch {}
      return { status:'corrupt', player:null, raw };
    }

    function load(name) {
      const stored = read(name);
      return stored.status === 'valid' ? stored.player : null;
    }

    function list() {
      const players = [];
      for (let index = 0; index < storage.length; index += 1) {
        const storageKey = storage.key(index);
        if (!storageKey || !storageKey.startsWith(prefix)) continue;
        try {
          const parsed = JSON.parse(storage.getItem(storageKey));
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.name) {
            players.push(normalizePlayer(parsed));
          }
        } catch {}
      }
      return players;
    }

    function write(player) {
      if (!player || typeof player !== 'object' || Array.isArray(player)) {
        throw new TypeError('player store requires a player object');
      }
      storage.setItem(key(player.name), JSON.stringify(player));
      return true;
    }

    function remove(name) {
      storage.removeItem(key(name));
      return true;
    }

    return Object.freeze({ key, read, load, list, write, remove });
  }

  global.YuksamPlayerStore = Object.freeze({ create });
})(window);
