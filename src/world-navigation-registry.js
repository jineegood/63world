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

  function createPositionGuard(options = {}) {
    const step = Math.max(4, Number(options.step) || 8);
    const nearbyRadius = Math.max(step, Number(options.nearbyRadius) || 96);
    const maxSearchRadius = Math.max(nearbyRadius, Number(options.maxSearchRadius) || 640);
    const safeByMap = new Map();
    let lastObservation = null;

    function bounds() {
      const raw = options.getBounds?.() || {};
      const width = Number(raw.width);
      const height = Number(raw.height);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
      const minX = Number.isFinite(Number(raw.minX)) ? Number(raw.minX) : 0;
      const minY = Number.isFinite(Number(raw.minY)) ? Number(raw.minY) : 0;
      const maxX = Number.isFinite(Number(raw.maxX)) ? Number(raw.maxX) : width;
      const maxY = Number.isFinite(Number(raw.maxY)) ? Number(raw.maxY) : height;
      if (maxX < minX || maxY < minY) return null;
      return { minX, minY, maxX, maxY };
    }

    function point(value) {
      const x = Number(value?.x);
      const y = Number(value?.y);
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    }

    function clampToBounds(value, area) {
      const candidate = point(value);
      if (!candidate || !area) return null;
      return {
        x:Math.max(area.minX, Math.min(area.maxX, candidate.x)),
        y:Math.max(area.minY, Math.min(area.maxY, candidate.y)),
      };
    }

    function isSafe(value, area) {
      const candidate = point(value);
      if (!candidate || !area) return false;
      if (
        candidate.x < area.minX || candidate.x > area.maxX
        || candidate.y < area.minY || candidate.y > area.maxY
      ) return false;
      try {
        return options.isWalkable?.(candidate.x, candidate.y) === true;
      } catch {
        return false;
      }
    }

    function nearestSafe(origin, area, radiusLimit) {
      const center = clampToBounds(origin, area);
      if (!center) return null;
      if (isSafe(center, area)) return center;
      const seen = new Set();
      const consider = (x, y, candidates) => {
        const candidate = clampToBounds({ x, y }, area);
        if (!candidate) return;
        const key = `${candidate.x.toFixed(3)}:${candidate.y.toFixed(3)}`;
        if (seen.has(key)) return;
        seen.add(key);
        if (isSafe(candidate, area)) {
          candidates.push({
            ...candidate,
            distance:Math.hypot(candidate.x - center.x, candidate.y - center.y),
          });
        }
      };
      for (let radius = step; radius <= radiusLimit; radius += step) {
        const candidates = [];
        for (let offset = -radius; offset <= radius; offset += step) {
          consider(center.x + offset, center.y - radius, candidates);
          consider(center.x + offset, center.y + radius, candidates);
          consider(center.x - radius, center.y + offset, candidates);
          consider(center.x + radius, center.y + offset, candidates);
        }
        if (candidates.length) {
          candidates.sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x);
          return { x:candidates[0].x, y:candidates[0].y };
        }
      }
      return null;
    }

    function reconcile(meta = {}) {
      const map = String(options.getMap?.() || '');
      const current = point(options.getPosition?.());
      const area = bounds();
      if (!map || !area) return Object.freeze({ recovered:false, reason:'unavailable' });
      if (
        meta.force !== true && current && lastObservation?.map === map
        && lastObservation.x === current.x && lastObservation.y === current.y
      ) {
        return Object.freeze({ recovered:false, reason:'safe', position:Object.freeze({ ...current }) });
      }
      if (isSafe(current, area)) {
        safeByMap.set(map, { ...current });
        lastObservation = { map, ...current };
        return Object.freeze({ recovered:false, reason:'safe', position:Object.freeze({ ...current }) });
      }

      let reason = 'nearest';
      let recovered = nearestSafe(current, area, nearbyRadius);
      const lastSafe = safeByMap.get(map);
      if (!recovered && isSafe(lastSafe, area)) {
        recovered = { ...lastSafe };
        reason = 'last-safe';
      }
      if (!recovered) recovered = nearestSafe(current, area, maxSearchRadius);

      const fallback = point(options.getFallback?.());
      if (!recovered && isSafe(fallback, area)) {
        recovered = { ...fallback };
        reason = 'fallback';
      }
      if (!recovered && fallback) {
        recovered = nearestSafe(fallback, area, maxSearchRadius);
        if (recovered) reason = 'fallback-nearest';
      }
      if (!recovered) return Object.freeze({ recovered:false, reason:'no-safe-position' });

      options.setPosition?.(recovered, { map, reason, ...meta });
      safeByMap.set(map, { ...recovered });
      lastObservation = { map, ...recovered };
      options.onRecover?.({
        map,
        reason,
        from:current ? { ...current } : null,
        to:{ ...recovered },
        ...meta,
      });
      return Object.freeze({
        recovered:true,
        reason,
        position:Object.freeze({ ...recovered }),
      });
    }

    function reset(map) {
      if (map == null) {
        safeByMap.clear();
        lastObservation = null;
      } else {
        const key = String(map);
        safeByMap.delete(key);
        if (lastObservation?.map === key) lastObservation = null;
      }
    }

    return Object.freeze({ reconcile, reset });
  }

  global.YuksamWorldNavigationRegistry = Object.freeze({ create, createPositionGuard });
})(window);
