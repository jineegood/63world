# Combat Entry Pipeline Design

## Goal

Replace three `openCombat` wrappers with one explicit middleware pipeline while preserving the final V25 entry order and keeping combat rendering/turn resolution out of scope.

## Captured behavior

- V25 always invalidates the previous combat sequence, even when the new entry is paused or invalid.
- V25 clears respawn/death residue only for an alive monster with positive HP.
- V24 then stops a paused entry. Because this is inside V25, sequence invalidation and monster cleanup have already happened.
- An unpaused entry clears held keys.
- V22 clears per-combat escape failure/resolution state, including before an invalid monster is rejected.
- Base entry rejects missing/dead monsters; otherwise it initializes player/monster status, identity, action, shield, charge/buffs, HP display, intro timing, audio, and the combat modal.

The browser baseline is 12/12 across valid, paused, and dead-monster entry paths.

## Architecture

Create `src/combat-entry-pipeline.js`:

```js
const pipeline = YuksamCombatEntryPipeline.create({ enter });
pipeline.register({ id, priority, handle(context, next) });
pipeline.open(context);
```

Middleware runs by descending priority and stable registration order. A handler calls `next()` to continue or returns to short-circuit. The final callback is the base entry. Each `next()` may be called once; reentry throws. Registrations require unique IDs and handlers and return unregister callbacks. Exceptions surface.

`game.js` retains all game, monster, status, audio, modal, and combat-sequence knowledge. V25, V24, and V22 register from their existing IIFEs, where their local helpers remain private.

## Verification

- Pure tests cover priority, stable ties, short-circuiting, result propagation, next-once protection, duplicate IDs, unregister, validation, and exception propagation.
- Browser smoke preserves the 12 captured valid/paused/invalid entry assertions.
- Source tests require one pipeline/delegate and forbid `openCombatV*` assignments and aliases.
- Combat controller, combat flow, FX, input, HUD, stats, safety-net, and full gates remain green.

## Out of scope

No question selection, combat menu/frame redesign, damage calculation, turn order, escape probability, animation, balance, audio mapping, monster generation, save data, or world collision changes.
