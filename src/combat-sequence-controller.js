(function initYuksamCombatSequenceController(global) {
  'use strict';

  function create(options = {}) {
    const readCombatId = typeof options.readCombatId === 'function' ? options.readCombatId : () => null;
    const writeState = typeof options.writeState === 'function' ? options.writeState : () => {};
    const resetTransient = typeof options.resetTransient === 'function' ? options.resetTransient : () => {};
    const setTimer = typeof options.setTimer === 'function' ? options.setTimer : (...args) => global.setTimeout(...args);
    const clearTimer = typeof options.clearTimer === 'function' ? options.clearTimer : (timer) => global.clearTimeout(timer);
    const timers = new Set();
    let generation = Math.max(0, Math.floor(Number(options.initialGeneration) || 0));
    let active = false;

    function publish() {
      writeState({ generation, active });
    }

    function clearTimers() {
      timers.forEach((timer) => clearTimer(timer));
      timers.clear();
    }

    function reset() {
      clearTimers();
      resetTransient();
    }

    function begin() {
      reset();
      generation += 1;
      active = true;
      const token = Object.freeze({ generation, combatId:readCombatId() ?? null });
      publish();
      return token;
    }

    function isCurrent(token) {
      return Boolean(
        active
        && token
        && isSameGeneration(token)
      );
    }

    function isSameGeneration(token) {
      return Boolean(
        token
        && token.generation === generation
        && token.combatId === (readCombatId() ?? null)
      );
    }

    function scheduleWhen(token, callback, delay, isValid) {
      if (!isValid(token) || typeof callback !== 'function') return null;
      let timer = null;
      timer = setTimer(() => {
        timers.delete(timer);
        if (isValid(token)) callback();
      }, Math.max(0, Number(delay) || 0));
      timers.add(timer);
      return timer;
    }

    function schedule(token, callback, delay) {
      return scheduleWhen(token, callback, delay, isCurrent);
    }

    function defer(callback, delay) {
      const token = Object.freeze({ generation, combatId:readCombatId() ?? null });
      return scheduleWhen(token, callback, delay, isSameGeneration);
    }

    function finish(token) {
      if (!isCurrent(token)) return false;
      active = false;
      publish();
      return true;
    }

    function invalidate() {
      reset();
      generation += 1;
      active = false;
      publish();
    }

    return Object.freeze({ begin, isCurrent, schedule, defer, finish, invalidate, isActive:() => active });
  }

  global.YuksamCombatSequenceController = Object.freeze({ create });
})(window);
