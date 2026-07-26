(function installAuthorityActionRunnerV3(global) {
  'use strict';

  const ACTIONS = new Set([
    'purchaseItem',
    'equipItem',
    'unequipSlot',
    'enhanceWeapon',
    'chooseSpecialization',
    'learnSkill',
  ]);

  function create({ service, isEnabled, getRevision, applySnapshot } = {}) {
    if (!service || typeof isEnabled !== 'function'
      || typeof getRevision !== 'function' || typeof applySnapshot !== 'function') {
      throw new TypeError('authority action runner v3 requires its dependencies');
    }
    const pending = new Set();

    async function run(actionName, payload = {}, options = {}) {
      if (!isEnabled()) return Object.freeze({ handled:false });
      if (!ACTIONS.has(actionName) || typeof service[actionName] !== 'function') {
        throw new TypeError('unknown authority action');
      }
      const pendingKey = options.pendingKey || null;
      if (pendingKey && pending.has(pendingKey)) {
        return Object.freeze({ handled:true, pending:true });
      }
      if (pendingKey) pending.add(pendingKey);
      try {
        const result = await service[actionName]({
          ...payload,
          expectedRevision:getRevision(),
        });
        applySnapshot(result);
        return Object.freeze({ handled:true, result });
      } catch (error) {
        if (error?.code === 'REVISION_CONFLICT' && error.player
          && Number.isSafeInteger(error.revision)) {
          applySnapshot({ player:error.player, revision:error.revision });
        }
        throw error;
      } finally {
        if (pendingKey) pending.delete(pendingKey);
      }
    }

    return Object.freeze({
      run,
      isPending:(key) => pending.has(key),
    });
  }

  global.YuksamAuthorityActionRunnerV3 = Object.freeze({ create });
})(window);
