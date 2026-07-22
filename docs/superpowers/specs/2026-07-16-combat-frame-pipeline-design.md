# Combat Frame Pipeline Design

## Scope

Replace the five versioned `renderCombatFrame` wrappers (V20, V23, V25, V26, and V27) with one explicit post-render pipeline. Preserve the current final DOM exactly. Do not change combat entry, turn sequencing, HP calculation, canvas drawing, modal ownership, timing values, or visual design.

## Existing order and observable behavior

The current wrapper chain executes in this order:

1. Base combat frame render.
2. V20 searches for `.combat-scene` and conditionally adds `combat-slower-v20`. The current base markup has no `.combat-scene`, so this is an observable no-op.
3. V23 rewrites the message heading with `damage-number-v23` spans.
4. V25 rewrites the same heading again, replacing V23 output with player/enemy/generic V25 spans.
5. V26 temporarily adds map-specific `combat-bg-*` classes.
6. V27 removes every `combat-bg-*` class and adds `combat-layout-rollback-v27`.

The behavior capture must prove the final message text, V25 span classification, HTML escaping, content insertion, rollback class, absence of V23/background/slow classes, and missing-target behavior. A missing target makes the base renderer return early, but the historical outer hooks still rewrite any existing combat heading; the pipeline must preserve this behavior without throwing.

## Selected architecture

Create `src/combat-frame-pipeline.js` with a DOM-independent factory:

```js
const pipeline = YuksamCombatFramePipeline.create({ render });
const unregister = pipeline.register({ id, priority, after });
const result = pipeline.render(context);
```

`render(context)` calls the base renderer exactly once, then executes registered `after(context)` hooks by ascending priority and stable registration order. Duplicate IDs and entries without an ID or handler are rejected. Hook errors remain visible to callers.

`game.js` owns all game and DOM dependencies. It registers the five existing patch bodies using priorities 200, 230, 250, 260, and 270. This retains historical ownership and order without function reassignment.

## Alternatives rejected

- Folding only the final V25/V27 effects into the base renderer is smaller but hides why V20/V23/V26 disappeared and makes behavior comparison harder.
- A generic DOM plugin framework adds capabilities that no current caller requires.

## Testing

- Pure unit tests cover order, stable ties, unregister, duplicate IDs, base return value, and surfaced errors.
- A real jsdom browser capture covers final combat DOM before and after the refactor.
- A production boundary test requires one pipeline instance and rejects all versioned `renderCombatFrame` assignments and aliases.
- Focused combat flow, combat FX, combat entry, safety-net, and the complete default gate protect integration.

## Recovery

Create pre- and post-package ZIP files with SHA-256 manifests. This workspace is not a usable Git repository, so no reset, checkout, or commit operation is allowed.
