/* 다른 학생의 위치가 띄엄띄엄 도착해도 화면에서는 부드럽게 이어 보이게 하는 계산 모듈.
   네트워크를 더 쓰지 않고 이미 받은 두 지점 사이를 채워 그린다.
   순수 계산만 한다 — 화면이나 통신은 multiplayer.js가 담당한다. */
(function installRemoteMotion(global) {
  'use strict';

  const DEFAULT_STEP_MS = 220;  // 기본 전송 주기
  const MIN_STEP_MS = 90;       // 너무 짧으면 오히려 튀어 보인다
  const MAX_STEP_MS = 600;      // 오래 끊겼다가 오면 질질 끌지 않는다
  const SNAP_DISTANCE = 360;    // 포탈·순간이동은 미끄러지지 않고 즉시 이동
  const MOVING_EPSILON = 0.6;   // 이보다 적게 움직이면 걷는 중으로 보지 않는다

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function positiveOption(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  function create(options = {}) {
    const defaultStepMs = positiveOption(options.defaultStepMs, DEFAULT_STEP_MS);
    const minStepMs = Math.min(defaultStepMs, positiveOption(options.minStepMs, MIN_STEP_MS));
    const maxStepMs = Math.max(defaultStepMs, positiveOption(options.maxStepMs, MAX_STEP_MS));
    const snapDistance = positiveOption(options.snapDistance, SNAP_DISTANCE);
    let from = null;
    let to = null;
    let startedAt = 0;
    let durationMs = defaultStepMs;
    let lastPacketAt = 0;

    function sample(now) {
      if (!to) return null;
      if (!from) return { x: to.x, y: to.y, moving: false };
      const elapsed = now - startedAt;
      const k = durationMs <= 0 ? 1 : clamp(elapsed / durationMs, 0, 1);
      const x = from.x + (to.x - from.x) * k;
      const y = from.y + (to.y - from.y) * k;
      const remaining = Math.hypot(to.x - x, to.y - y);
      return { x, y, moving: k < 1 && remaining > MOVING_EPSILON };
    }

    /* 새 위치가 도착했을 때 호출한다.
       snap=true 이거나 거리가 너무 멀면 사이를 채우지 않고 즉시 옮긴다. */
    function push(x, y, now, options) {
      const nextX = Number(x);
      const nextY = Number(y);
      if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) return;

      const forceSnap = Boolean(options && options.snap);
      const current = sample(now);

      if (!current || forceSnap || Math.hypot(nextX - current.x, nextY - current.y) > snapDistance) {
        from = null;
        to = { x: nextX, y: nextY };
        startedAt = now;
        durationMs = defaultStepMs;
        lastPacketAt = now;
        return;
      }

      const gap = lastPacketAt ? now - lastPacketAt : defaultStepMs;
      from = { x: current.x, y: current.y };
      to = { x: nextX, y: nextY };
      startedAt = now;
      durationMs = clamp(gap, minStepMs, maxStepMs);
      lastPacketAt = now;
    }

    return { push, sample };
  }

  global.YuksamRemoteMotion = Object.freeze({
    create,
    DEFAULT_STEP_MS,
    MIN_STEP_MS,
    MAX_STEP_MS,
    SNAP_DISTANCE,
  });
})(window);
