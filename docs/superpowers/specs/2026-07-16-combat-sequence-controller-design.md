# Combat Sequence Controller Boundary Design

## Problem

The active V42–V46 combat queue in `game.js` correctly serializes typed events, but lifecycle control is embedded inside rendering and effect application. Timer ownership, generation increments, combat-ID validation, active-state writes, and transient cleanup are repeated across `queueCombatSequence`, `scheduleCombatSequenceV43`, `invalidateCombatSequenceV42`, and the escape wrapper. A future edit can therefore leave a stale timer alive or unlock escape while an effect remains queued.

## Scope

Extract only queue lifecycle into a pure browser-global module named `YuksamCombatSequenceController`. It owns:

- one generation token per queue;
- active/inactive state;
- scheduled timer handles;
- stale-token and changed-combat rejection;
- begin, finish, and invalidate transitions;
- a single injected transient-reset callback.

`game.js` continues to own event sorting, effect mutation, combat rendering, audio, FX, timing values, defeat/counterattack decisions, and all gameplay data. This package changes no combat behavior, balance, notice text, delay, animation, or save format.

## Interface

```js
const controller = window.YuksamCombatSequenceController.create({
  initialGeneration,
  readCombatId,
  writeState({ generation, active }),
  resetTransient(),
  setTimer,
  clearTimer,
});

const token = controller.begin();
controller.isCurrent(token);
controller.schedule(token, callback, delay);
controller.finish(token);
controller.invalidate();
controller.isActive();
```

Timer functions are injectable for deterministic unit tests. `begin()` cancels the previous queue and resets transient visual/effect state before activating a new token. `invalidate()` performs the same cleanup and advances the generation. `finish()` only closes the matching current token. A combat-ID change makes a token stale even before explicit invalidation.

## Integration

Load the controller after `combat-rules.js` and before `game.js`. Instantiate it inside the active V25 patch, where existing cleanup functions and `game` state are available. Replace direct generation/timer bookkeeping in the queue with controller calls while keeping the queue body and all event callbacks intact.

Compatibility fields `game.combatSequenceGeneration` and `game.combatSequenceActive` remain updated through `writeState`, so input, escape, existing smokes, and handoff tooling keep their present contract.

## Safety properties

- A replaced queue cannot execute any remaining scheduled callback.
- An invalidated queue cannot apply pending status or damage.
- A token from another monster cannot render or mutate the current fight.
- A stale `finish()` cannot unlock a newer queue.
- Escape remains blocked precisely while the controller is active.
- FX/transient cleanup executes once per begin or invalidate transition.

## Verification

Add deterministic controller unit tests, production script-order and single-instantiation assertions, then run existing combat sequence/event-timing/FX browser smokes and the full default gate.
