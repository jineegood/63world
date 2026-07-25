(function initYuksamClickMovement(global) {
  'use strict';

  const DEFAULT_RADIUS = 30;
  const DEFAULT_CELL_SIZE = 24;
  const MAX_VISITED = 25000;
  const DIRECTIONS = Object.freeze([
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ]);

  function finitePositive(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  function normalizeContext(raw = {}) {
    const width = finitePositive(raw.bounds?.width, 1);
    const height = finitePositive(raw.bounds?.height, 1);
    const radius = finitePositive(raw.radius, DEFAULT_RADIUS);
    return {
      bounds:{ width, height },
      radius,
      colliders:Array.isArray(raw.colliders) ? raw.colliders : [],
    };
  }

  function hits(point, collider, radius) {
    if (collider?.type === 'circle') {
      return Math.hypot(
        point.x - Number(collider.x || 0),
        point.y - Number(collider.y || 0),
      ) < radius + Math.max(0, Number(collider.r || 0));
    }
    if (collider?.type === 'rect') {
      const width = Math.max(0, Number(collider.w || 0));
      const height = Math.max(0, Number(collider.h || 0));
      const left = Number(collider.x || 0) - width / 2;
      const right = left + width;
      const top = Number(collider.y || 0) - height / 2;
      const bottom = top + height;
      const nearestX = Math.max(left, Math.min(right, point.x));
      const nearestY = Math.max(top, Math.min(bottom, point.y));
      return Math.hypot(point.x - nearestX, point.y - nearestY) < radius;
    }
    return false;
  }

  function isWalkable(point, rawContext = {}) {
    const context = normalizeContext(rawContext);
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (
      x < context.radius || y < context.radius
      || x > context.bounds.width - context.radius
      || y > context.bounds.height - context.radius
    ) return false;
    return !context.colliders.some((collider) => hits({ x, y }, collider, context.radius));
  }

  function segmentWalkable(a, b, context) {
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    const count = Math.max(1, Math.ceil(distance / Math.max(4, context.radius / 2)));
    for (let index = 0; index <= count; index += 1) {
      const ratio = index / count;
      if (!isWalkable({
        x:a.x + (b.x - a.x) * ratio,
        y:a.y + (b.y - a.y) * ratio,
      }, context)) return false;
    }
    return true;
  }

  function planPath(options = {}) {
    const context = normalizeContext(options);
    const cellSize = finitePositive(options.cellSize, DEFAULT_CELL_SIZE);
    const start = { x:Number(options.start?.x), y:Number(options.start?.y) };
    const requestedTarget = { x:Number(options.target?.x), y:Number(options.target?.y) };
    if (!isWalkable(start, context)) return [];
    if (!Number.isFinite(requestedTarget.x) || !Number.isFinite(requestedTarget.y)) return [];

    const minX = context.radius;
    const minY = context.radius;
    const maxX = Math.max(minX, context.bounds.width - context.radius);
    const maxY = Math.max(minY, context.bounds.height - context.radius);
    const columns = Math.floor((maxX - minX) / cellSize) + 1;
    const rows = Math.floor((maxY - minY) / cellSize) + 1;
    if (columns <= 0 || rows <= 0 || columns * rows > MAX_VISITED) return [];

    const pointFor = (column, row) => ({
      x:Math.min(maxX, minX + column * cellSize),
      y:Math.min(maxY, minY + row * cellSize),
    });
    const cellFor = (point) => ({
      column:Math.max(0, Math.min(columns - 1, Math.round((point.x - minX) / cellSize))),
      row:Math.max(0, Math.min(rows - 1, Math.round((point.y - minY) / cellSize))),
    });
    const keyFor = (column, row) => `${column},${row}`;
    const walkableCell = (column, row) => (
      column >= 0 && row >= 0 && column < columns && row < rows
      && isWalkable(pointFor(column, row), context)
    );

    const startCell = cellFor(start);
    if (!walkableCell(startCell.column, startCell.row)) {
      const candidates = [];
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          if (!walkableCell(column, row)) continue;
          const point = pointFor(column, row);
          if (!segmentWalkable(start, point, context)) continue;
          candidates.push({ column, row, distance:Math.hypot(point.x - start.x, point.y - start.y) });
        }
      }
      candidates.sort((a, b) => a.distance - b.distance);
      if (!candidates.length) return [];
      startCell.column = candidates[0].column;
      startCell.row = candidates[0].row;
    }

    const clampedTarget = {
      x:Math.max(minX, Math.min(maxX, requestedTarget.x)),
      y:Math.max(minY, Math.min(maxY, requestedTarget.y)),
    };
    const desiredCell = cellFor(clampedTarget);
    let targetCell = desiredCell;
    if (!walkableCell(targetCell.column, targetCell.row)) {
      let best = null;
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          if (!walkableCell(column, row)) continue;
          const point = pointFor(column, row);
          const distance = Math.hypot(point.x - clampedTarget.x, point.y - clampedTarget.y);
          if (!best || distance < best.distance) best = { column, row, distance };
        }
      }
      if (!best) return [];
      targetCell = best;
    }

    const startKey = keyFor(startCell.column, startCell.row);
    const targetKey = keyFor(targetCell.column, targetCell.row);
    const open = [{
      column:startCell.column,
      row:startCell.row,
      g:0,
      f:Math.hypot(targetCell.column - startCell.column, targetCell.row - startCell.row),
    }];
    const openBest = new Map([[startKey, 0]]);
    const parents = new Map();
    const closed = new Set();
    let found = false;

    while (open.length && closed.size < MAX_VISITED) {
      open.sort((a, b) => a.f - b.f || a.g - b.g);
      const current = open.shift();
      const currentKey = keyFor(current.column, current.row);
      if (closed.has(currentKey)) continue;
      closed.add(currentKey);
      if (currentKey === targetKey) {
        found = true;
        break;
      }

      for (const [dc, dr] of DIRECTIONS) {
        const column = current.column + dc;
        const row = current.row + dr;
        if (!walkableCell(column, row)) continue;
        if (dc && dr && (
          !walkableCell(current.column + dc, current.row)
          || !walkableCell(current.column, current.row + dr)
        )) continue;
        const nextKey = keyFor(column, row);
        if (closed.has(nextKey)) continue;
        const nextG = current.g + (dc && dr ? Math.SQRT2 : 1);
        if (nextG >= (openBest.get(nextKey) ?? Infinity)) continue;
        openBest.set(nextKey, nextG);
        parents.set(nextKey, currentKey);
        open.push({
          column,
          row,
          g:nextG,
          f:nextG + Math.hypot(targetCell.column - column, targetCell.row - row),
        });
      }
    }
    if (!found) return [];

    const gridPath = [];
    let cursor = targetKey;
    while (cursor !== startKey) {
      const [column, row] = cursor.split(',').map(Number);
      gridPath.push(pointFor(column, row));
      cursor = parents.get(cursor);
      if (!cursor) return [];
    }
    gridPath.reverse();

    const snappedTarget = pointFor(targetCell.column, targetCell.row);
    const exactTarget = (
      isWalkable(clampedTarget, context)
      && segmentWalkable(snappedTarget, clampedTarget, context)
    ) ? clampedTarget : snappedTarget;
    if (
      !gridPath.length
      || Math.hypot(gridPath.at(-1).x - exactTarget.x, gridPath.at(-1).y - exactTarget.y) > 0.01
    ) gridPath.push(exactTarget);

    const smoothed = [];
    let anchor = start;
    let index = 0;
    while (index < gridPath.length) {
      let farthest = index;
      for (let candidate = gridPath.length - 1; candidate >= index; candidate -= 1) {
        if (segmentWalkable(anchor, gridPath[candidate], context)) {
          farthest = candidate;
          break;
        }
      }
      const waypoint = gridPath[farthest];
      smoothed.push(Object.freeze({ x:waypoint.x, y:waypoint.y }));
      anchor = waypoint;
      index = farthest + 1;
    }
    return Object.freeze(smoothed);
  }

  function advance(options = {}) {
    let position = { x:Number(options.position?.x) || 0, y:Number(options.position?.y) || 0 };
    const path = Array.isArray(options.path)
      ? options.path.map((point) => ({ x:Number(point.x), y:Number(point.y) }))
      : [];
    let remaining = Math.max(0, Number(options.speed) || 0);
    let direction = { x:0, y:0 };

    while (path.length && remaining > 0) {
      const waypoint = path[0];
      const dx = waypoint.x - position.x;
      const dy = waypoint.y - position.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= 0.0001) {
        position = { x:waypoint.x, y:waypoint.y };
        path.shift();
        continue;
      }
      direction = { x:dx / distance, y:dy / distance };
      if (remaining >= distance) {
        position = { x:waypoint.x, y:waypoint.y };
        remaining -= distance;
        path.shift();
      } else {
        position = {
          x:position.x + direction.x * remaining,
          y:position.y + direction.y * remaining,
        };
        remaining = 0;
      }
    }

    return Object.freeze({
      position:Object.freeze(position),
      path:Object.freeze(path.map((point) => Object.freeze(point))),
      moving:path.length > 0,
      direction:Object.freeze(direction),
    });
  }

  function createController(options = {}) {
    const canvas = options.canvas;
    const now = typeof options.now === 'function' ? options.now : Date.now;
    const radius = finitePositive(options.radius, DEFAULT_RADIUS);
    const cellSize = finitePositive(options.cellSize, 32);
    let state = null;
    let bound = false;

    function cancel() {
      state = null;
    }

    function getState() {
      if (!state) return null;
      return Object.freeze({
        map:state.map,
        path:Object.freeze(state.path.map((point) => Object.freeze({ ...point }))),
        target:Object.freeze({ ...state.target }),
        markerUntil:state.markerUntil,
        moving:state.path.length > 0,
      });
    }

    function pointerdown(event) {
      if (
        event?.button !== 0
        || options.isActive?.() !== true
        || options.isPaused?.() === true
        || options.isInCombat?.() === true
      ) return;
      const player = options.getPlayer?.();
      const world = options.getWorld?.();
      const camera = options.getCamera?.() || { x:0, y:0 };
      const map = options.getMap?.();
      const rect = canvas?.getBoundingClientRect?.();
      if (!player || !world || !rect?.width || !rect?.height || !map) return;
      const scaleX = finitePositive(canvas.width / rect.width, 1);
      const scaleY = finitePositive(canvas.height / rect.height, 1);
      const target = {
        x:(Number(event.clientX) - rect.left) * scaleX + Number(camera.x || 0),
        y:(Number(event.clientY) - rect.top) * scaleY + Number(camera.y || 0),
      };
      const path = planPath({
        start:{ x:player.x, y:player.y },
        target,
        bounds:{ width:world.width, height:world.height },
        colliders:options.getColliders?.() || [],
        radius,
        cellSize,
      });
      state = path.length ? {
        map,
        path:[...path],
        target:{ ...path.at(-1) },
        markerUntil:now() + 850,
      } : null;
      options.onStateChange?.(getState());
    }

    function bind() {
      if (bound || typeof canvas?.addEventListener !== 'function') return;
      bound = true;
      canvas.addEventListener('pointerdown', pointerdown);
    }

    function unbind() {
      if (!bound) return;
      bound = false;
      canvas.removeEventListener?.('pointerdown', pointerdown);
      cancel();
    }

    function update({ dt = 16.67, keyboardMoving = false, speedMultiplier = 1 } = {}) {
      const player = options.getPlayer?.();
      if (
        !state || !player
        || options.isActive?.() !== true
        || options.isPaused?.() === true
        || options.isInCombat?.() === true
        || state.map !== options.getMap?.()
      ) {
        if (state) cancel();
        return Object.freeze({ moved:false, moving:false });
      }
      if (keyboardMoving) {
        cancel();
        return Object.freeze({ moved:false, moving:false, cancelledByKeyboard:true });
      }
      if (!state.path.length) {
        if (state.markerUntil <= now()) cancel();
        return Object.freeze({ moved:false, moving:false });
      }

      const speed = 3.2
        * finitePositive(speedMultiplier, 1)
        * Math.min(Math.max(0, Number(dt) || 0) / 16.67, 2);
      const result = advance({
        position:{ x:player.x, y:player.y },
        path:state.path,
        speed,
      });
      const previous = { x:player.x, y:player.y };
      let nextX = result.position.x;
      let nextY = result.position.y;
      if (options.canMoveTo?.(nextX, player.y) === false) nextX = player.x;
      if (options.canMoveTo?.(nextX, nextY) === false) nextY = player.y;
      if (nextX === player.x && nextY === player.y) {
        cancel();
        return Object.freeze({ moved:false, moving:false, blocked:true });
      }
      player.x = nextX;
      player.y = nextY;
      state.path = [...result.path];
      const moved = player.x !== previous.x || player.y !== previous.y;
      if (moved) options.savePosition?.();
      options.onDirection?.(result.direction, state.path.length > 0);
      options.onStateChange?.(getState());
      return Object.freeze({ moved, moving:state.path.length > 0, direction:result.direction });
    }

    function drawMarker(context, worldToScreen) {
      if (!state || state.markerUntil <= now() || typeof worldToScreen !== 'function') return false;
      const marker = worldToScreen(state.target.x, state.target.y);
      context.save();
      context.strokeStyle = 'rgba(96,165,250,.95)';
      context.lineWidth = 4;
      context.beginPath();
      context.arc(marker.x, marker.y, 13, 0, Math.PI * 2);
      context.stroke();
      context.restore();
      return true;
    }

    return Object.freeze({ bind, unbind, cancel, getState, update, drawMarker });
  }

  global.YuksamClickMovement = Object.freeze({
    planPath,
    advance,
    isWalkable,
    createController,
  });
})(window);
