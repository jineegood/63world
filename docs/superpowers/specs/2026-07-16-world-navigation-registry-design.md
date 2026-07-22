# World Navigation Registry Design

## Goal

Replace the active collider, movement, and automatic-transition wrapper chains with one explicit navigation registry while preserving the final V35 map geometry and transitions exactly. Drawing remains a separate next package.

## Scope decomposition

The audit found four related but independently risky chains: 10 `drawWorld` wrappers, 7 collider wrappers, 6 automatic-transition wrappers, and 1 movement wrapper. Rendering defects and movement defects need different probes and rollback points. This package therefore handles collider resolution, movement permission, and automatic transitions only. The following package handles drawing composition.

## Current final behavior

### Colliders

- Town starts with base shop, building shop, hall, NPC, and 12 tree colliders; adds the healing well; then adds pet-shop and upgrade-shop building rectangles twice through V33 and V34.
- The duplicate town rectangles do not change the boolean collision result and are historical wrapper residue. The final registry returns one rectangle per building while preserving movement behavior.
- Forest, desert, and swamp use the current deterministic `scatterPointsV37` layouts when available, otherwise their existing formulas.
- Equipment shop, building shop, and boss room retain their base lists.
- Pet shop interior is finally replaced by the V34 five-circle list.
- Upgrade shop interior is finally replaced by the V34 four-shape list.
- Final boss room has no collider provider and therefore resolves to the base empty list.

### Movement

- The player collision radius remains 30.
- Boss-room movement remains constrained to the current ellipse before collider checks.
- Town pet/upgrade buildings remain impassable through the resolved collider list; the separate V34 pre-check is redundant and will be removed.
- `circleHitsCollider` rectangle and circle boundary math remains unchanged.

### Automatic transitions

- A missing player or active `transitionLock` stops evaluation.
- `finalBossRoom` is exclusive and performs no automatic transition.
- Town pet and upgrade doors use the latest V33 entry functions before base equipment/building doors.
- Pet and upgrade interior exits use the latest V33 return-to-door behavior.
- Equipment/building interior exits use V23 return-to-the-corresponding-door behavior and door SFX.
- All proximity thresholds remain strict `< 42`.
- A transition attempt runs at most one handler.

## Chosen architecture

Create `src/world-navigation-registry.js`, a pure browser-global factory with no DOM, game-state, map-data, or audio dependency.

```js
const registry = YuksamWorldNavigationRegistry.create({
  colliderFallback(context),
  transitionFallback(context),
});

registry.registerCollider({ id, priority, resolve(context) });
registry.registerTransition({ id, priority, handle(context) });
registry.getColliders(context);
registry.runTransition(context);
```

Collider providers run by descending priority. Returning an array owns the final list, including an intentional empty array; returning `null` or `undefined` continues. Transition handlers use the same stable priority order and return `true` when handled. Duplicate active IDs throw, and each registration returns an unregister callback.

`game.js` retains map coordinates, scatter functions, collision math, and transition side effects. `getBaseMapColliders()` supplies unchanged base/forest/desert/swamp behavior. One final provider supplies current town/pet/upgrade lists. One final transition handler supplies final-room exclusion and current shop rules. `getCurrentMapColliders()` and `checkAutoTransitions()` become single delegates. `canPlayerMoveTo()` retains only the boss ellipse and one resolved-list collision check.

## Alternatives considered

1. Directly flatten every rule into large `switch` statements. This removes wrappers but makes every future map edit touch the same central function.
2. Extract a complete map service containing drawing, geometry, transitions, world data, and effects. This is cleaner long term but too broad for a behavior-preserving package.
3. Use a small navigation registry with injected fallbacks. This matches the proven interaction registry pattern, keeps side effects in `game.js`, and allows future maps to add isolated rules. This is the selected approach.

## Error and exclusivity semantics

Provider exceptions surface instead of silently changing movement. An empty collider list is a valid owned result. Transition handlers must return `true` even for an intentional exclusive no-op such as `finalBossRoom`; this prevents lower handlers from leaking through. The public transition delegate still returns `undefined` to match its current call sites.

## Verification

- Pure unit tests cover priority, stable ties, empty-list ownership, fallback, exclusivity, one-shot transitions, duplicates, and unregister.
- A real-browser smoke captures collider signatures for town, pet shop, upgrade shop, swamp, boss room, and final room.
- Movement probes verify town building blocking, nearby open ground, boss ellipse boundaries, and pet/upgrade obstacles.
- Transition probes verify all four shop families, town entry priority, final-room exclusion, strict distance threshold, and lock suppression.
- Source-boundary tests require one collider delegate, one transition delegate, no versioned wrappers, and no V34 movement wrapper.
- Existing world interaction, input, storage, combat, and full default gates remain green.

## Out of scope

No `drawWorld` changes, visual changes, map geometry changes, distance changes, balance changes, interaction changes, save changes, or teacher/workbook storage changes are included.
