# World Render Pipeline Design

## Goal

Replace the 11 active `drawWorld` wrapper assignments with one explicit render pipeline while preserving the final V35 visuals and map ownership.

## Audited final behavior

- Base maps clear the canvas, update the camera, render town/forest/desert/swamp/boss/equipment/building content, then render the player, level aura, speech bubble, and nameplate once.
- The pet shop is exclusively rendered by V34. The upgrade shop background is V33; the former V34 wrapper could not see that IIFE-local function and therefore called the V33 wrapper before drawing the player stack a second time.
- The final boss room is exclusively rendered by `drawFinalBossRoomV35`; historical V21/V26/V31/V34 paths are unreachable.
- Ordinary maps suppress all historical pet renderers, render the V34 follower once, then apply the V35 legendary `yuksam` overlay.
- The V35 final boss room intentionally does not render a pet.

## Architecture

Create `src/world-render-pipeline.js`, a pure browser-global factory:

```js
const pipeline = YuksamWorldRenderPipeline.create({ fallback });
pipeline.registerOwner({ id, priority, owns(context), render(context) });
pipeline.registerLayer({ id, priority, when(context), render(context) });
pipeline.render(context);
```

Owners are checked by descending priority with stable registration order. The first owner whose `owns` function returns `true` renders the world; otherwise the fallback renders it. Afterward, matching layers run by ascending priority and stable registration order so composition order is visible and deterministic. Duplicate active IDs throw, and registrations return unregister callbacks.

`game.js` keeps all canvas, map, player, and pet knowledge. The base `drawWorld()` becomes one pipeline delegate. V33 registers the upgrade-shop background owner; V34 registers the pet-shop background owner, one shared shop-actor layer, and an ordinary-map pet layer. V35 registers the higher-priority final-room owner and the final legendary-pet layer. Historical wrapper assignments are deleted without moving their unrelated patch behavior.

## Safety properties

- Exactly one world owner runs per frame.
- Base player UI renders once on base maps.
- Exclusive interiors and the final room never leak through to base drawing.
- Render layers cannot replace the owner and have explicit ordering.
- Exceptions surface to the existing frame error boundary; the pipeline does not silently hide rendering defects.
- The registry has no dependency on the DOM, game state, canvas, map data, or audio.

## Verification

- Pure unit tests cover owner priority, stable ties, fallback, layer order/filtering, duplicate IDs, unregister, and exception propagation.
- Source-boundary tests require one pipeline instance and delegate and forbid all versioned `drawWorld` assignments/old aliases.
- Real-browser smoke checks base, swamp, both interiors, final room, null-player safety, and representative player-layer counts.
- Syntax, boot, safety-net, navigation, interaction, and the complete default gate must remain green.

## Out of scope

No visual redesign, map geometry, movement, interactions, balance, audio, save format, combat, or teacher/development data changes are included.
