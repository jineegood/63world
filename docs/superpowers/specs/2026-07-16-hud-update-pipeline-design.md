# HUD Update Pipeline Design

## Goal

Replace the five `updateHud` wrapper assignments with one explicit before/core/after pipeline while preserving final V27 behavior.

## Current behavior contract

- Missing-player calls do not throw and do not run audio or quest updates.
- V27 field normalization occurs before skill synchronization and core rendering.
- V24 skill synchronization removes obsolete skills, clamps ranks, and derives remaining points from level and spent ranks.
- Core rendering updates level, HP, EXP, currencies, percentage bars, specialization button, zone badge, audio, and quest tracker once.
- The V23 settings button is created once and its click handler stays current after every update.
- The V25 heal/cooldown development buttons remain unique and bound.
- V22/V23 specialization normalization remains in its historical order even though the current mappings are identity operations.

## Architecture

Create `src/hud-update-pipeline.js`, a pure browser-global factory:

```js
const pipeline = YuksamHudUpdatePipeline.create({ render });
pipeline.register({ id, priority, before, after });
pipeline.update(context);
```

Before hooks run by descending priority and stable registration order. The core renderer runs once. After hooks run by ascending priority and stable registration order, reproducing nested wrapper unwind order. Registrations require an ID and at least one hook, reject duplicate active IDs, and return unregister callbacks. Exceptions surface to callers.

`game.js` retains DOM, game state, skill rules, persistence, audio, and quest behavior. The base HUD body becomes `renderBaseHud()`, while `updateHud()` is the only public delegate. V22, V23, V24, V25, and V27 register their local adapters from the IIFEs where their helpers are visible.

## Alternatives

- Flatten local helper bodies into the base HUD function: removes wrappers but couples patch-owned migration/skill/pet rules to presentation.
- Export every local helper globally: creates new mutable API surface.
- Explicit hook pipeline: preserves local ownership, makes order testable, and avoids both problems. Selected.

## Verification

- Pure tests cover descending before order, one core call, ascending after order, stable ties, duplicate IDs, unregister, invalid entries, and exception propagation.
- The pre-refactor browser capture must remain 11/11 for legacy player normalization, skill points, DOM text/bars, specialization controls, settings uniqueness, side-effect counts, and missing-player safety.
- Source tests require one pipeline instance/delegate and forbid `updateHudV*` assignments and `oldUpdateHudV*` aliases.
- Syntax, boot, player storage, UI/combat flow, safety-net, and full default gates remain green.

## Out of scope

No stat formula, skill balance, HUD layout/style, audio behavior, quest behavior, persistence format, combat, world rendering, navigation, or interaction changes.
