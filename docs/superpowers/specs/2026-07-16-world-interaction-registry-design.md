# World Interaction Registry Design

## Goal

Replace the active `getNearestInteractable` and `interact` wrapper chains with one explicit, testable priority registry without changing any current map, distance, label, modal, automatic exit, portal, NPC, or collision behavior.

## Current problem

The final runtime behavior depends on 11 lookup wrappers and 12 dispatch wrappers installed between V17 and V35. Newer wrappers sometimes replace earlier distances, sometimes preempt a whole map, and sometimes deliberately return no action. Understanding the final result requires mentally executing the entire patch chain.

The most important implicit rules are:

- V35 exclusively owns the final-boss room and prevents lower providers from leaking into it.
- V34/V33 shop candidates preempt the healing well and base town candidates.
- equipment/building shop `shopExit` candidates are suppressed because those exits are automatic.
- pet/upgrade interior exit candidates remain visible but E deliberately performs no action.
- the latest pet, upgrade, and final-teacher modal functions must win over older patch functions.

## Chosen architecture

Create `src/world-interaction-registry.js`, a browser-global factory with no DOM, game-state, audio, or map-data dependency.

```js
const registry = window.YuksamWorldInteractionRegistry.create({
  findFallback(context),
  dispatchFallback(candidate, context),
  beforeDispatch(candidate, context),
});

registry.registerCandidate({ id, priority, find });
registry.registerAction({ id, types, priority, handle });
registry.find(context);
registry.dispatch(context);
```

Candidate providers run by descending numeric priority and stable registration order. Returning a candidate selects it. Returning `YuksamWorldInteractionRegistry.STOP` ends lookup with `null`; this preserves exclusive maps such as `finalBossRoom`.

Action handlers run only for matching candidate types, in the same priority order. Returning `true` means handled, including intentional no-op actions such as pet/upgrade automatic exits. Unhandled candidates flow to the injected base dispatcher. Duplicate active IDs throw so patches cannot silently shadow one another.

## Integration boundary

The base lookup and base dispatch remain in `game.js` as `findBaseWorldInteractable()` and `dispatchBaseWorldInteraction(candidate)`. Public `getNearestInteractable()` and `interact()` delegate to one registry instance.

Patch-local functions stay in their owning IIFEs. The final V35 integration block registers the current exported callbacks in one candidate provider and one action handler, so registration order cannot recreate another patch chain. Obsolete wrapper assignments and `oldGetNearestInteractable*`/`oldInteract*` chains are removed. Only final runtime rules are registered; historical intermediate implementations are not retained as dead code.

This package does not consolidate `drawWorld`, `getCurrentMapColliders`, automatic transition functions, nearby-monster lookup, or map data. Those remain separate because their lifecycle and regression surfaces differ.

## Final candidate priority inside the V35 provider

1. V35 final-boss room exclusive provider.
2. V34 final portal, town shop doors, and pet interior provider.
3. V33 upgrade interior provider.
4. V19 healing-well provider.
5. Base town/stage/shop/boss-room provider.

## Final action priority inside the V35 handler

1. V35 final exit and teacher dialogue.
2. V34 pet orb and final portal actions.
3. V33 upgrade NPC action.
4. V27 intentional no-op pet/upgrade exits.
5. V19 healing well.
6. Base portal, quest, stage, shop, hall, and boss-room actions.

`beforeDispatch` owns the current tooltip-hide side effect so it runs exactly once for every interaction attempt.

## Verification

- Pure unit tests cover priority, stable ties, STOP, type filtering, handled/no-op semantics, duplicate IDs, and one lookup per dispatch.
- A browser smoke samples final candidates in town, both shop interiors, equipment shop, boss room, and final-boss room.
- The smoke exercises healing, pet, upgrade, final-teacher, and intentional exit no-op actions.
- Source-boundary tests require one public lookup delegate, one public dispatch delegate, and no versioned lookup/dispatch wrapper assignments.
- The existing boot, input-router, combat-key, final-boss, storage, and full default gates must remain green.
