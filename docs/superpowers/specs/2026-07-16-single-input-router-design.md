# Single Input Router Design

## Goal

Replace order-dependent global keyboard listeners with one explicit priority router while preserving every current key action and context priority.

## Architecture

`src/input-router.js` exposes a browser-global registry. It installs exactly one capture-phase `keydown` listener and one `keyup` listener, then calls registered handlers in descending numeric priority and stable registration order. A handler returns `true` only when later router handlers must not run. Handlers keep responsibility for `preventDefault()` so existing browser behavior is preserved precisely.

Registration returns an unregister callback. Duplicate handler IDs throw during development to prevent patch layers from silently shadowing each other.

The first migration keeps current context functions in their existing scopes and only replaces listener registration. Shared typing and modal-choice helpers are consolidated in a later task after behavior parity.

## Priority table

- 100: non-consuming tooltip Escape observation.
- 90: world map.
- 85: dialogue and boss confirmation.
- 80: combat Escape.
- 70: V26 owned modal choices.
- 30: core game/world controls.
- 20: generic modal/combat button navigation.
- keyup: movement release.

Exact ordering among same-priority registrations is stable and covered by unit tests.

## Safety

The router must dynamically inspect current DOM/game state on every event, never cache modal or typing state. The 300 ms generic-modal E grace period remains. Chat Enter remains a local input listener. No world interaction, combat action, modal UI, or key binding changes are permitted in this package.
