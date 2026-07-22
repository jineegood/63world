# Total Stats Pipeline Design

## Goal

Replace three `computeTotalStats` wrappers with one explicit prepare/base/modifier pipeline while preserving all final bonuses and making legacy first-call results deterministic.

## Captured final rules

- Base calculation adds class base stats, equipped item stats, unequipped accessory possession bonuses, ranked skill bonuses, flat skill bonuses, and final lost-health frenzy scaling.
- V19 and V23 specialization bonuses are cumulative, not replacements:
  - Warrior defense: stamina +9.
  - Warrior weapon: strength +5, stamina +3.
  - Mage frost: intellect +3, stamina +3.
  - Mage fire: intellect +6.
  - Priest holy: spirit +5, stamina +3.
  - Priest shadow: spirit +6.
- V27 adds one active-pet bonus and one weapon-enhancement bonus using `ceil(baseStat * tier * .45)`, minimum 1.
- Equipped accessories receive full stats and do not also receive their possession bonus.

## Confirmed defect

V27 currently calls the older calculation before `ensurePlayerV27Fields()`. If legacy data has no equipment object, the first call omits default-weapon stats, mutates the player, and the second call returns a different result. Preparation must happen before base calculation.

## Architecture

Create `src/total-stats-pipeline.js`:

```js
const pipeline = YuksamTotalStatsPipeline.create({ calculate });
pipeline.register({ id, priority, prepare, apply });
pipeline.compute(context);
```

Prepare hooks run by descending priority so newest data normalization happens before any calculation. The base calculator runs once. Apply hooks run by ascending priority and stable order, reproducing V19 → V23 → V27 composition. Apply hooks mutate the supplied total object in place; the pipeline returns that same object. Registrations need an ID and at least one hook, reject duplicates, and can be unregistered. Exceptions and invalid base results surface.

`game.js` retains all stat names, formulas, player data, items, skills, and patch-local helpers. `computeTotalStats()` becomes one delegate. V19, V23, and V27 register adapters inside their existing IIFEs.

## Verification

- Pure tests cover prepare/base/apply order, stable ties, duplicate IDs, unregister, invalid registration/base results, and exception propagation.
- Browser capture covers six specialization deltas, possession versus equipment, pet, enhancement, frenzy, repeatability, and legacy first-call determinism.
- Source tests require one delegate and forbid versioned stat wrappers/aliases.
- HUD, weapon tier, combat rules/flow, player storage, safety-net, and full gates remain green.

## Out of scope

No numeric balance changes, combat damage changes, item/skill/pet data edits, max-HP formula changes, save-format changes, UI changes, or equipment flow changes.
