# Input Routing Inventory — 2026-07-16

## Current production layers

Global keyboard behavior is split across eight listeners plus the chat input's local Enter listener.

Capture-phase `keydown` listeners, in registration order:

1. V21 dialogue E: confirms dialogue and stops immediate propagation.
2. V22 boss-confirm E: clicks the primary button and stops immediate propagation.
3. V22 combat Escape: calls the same escape function as the button and stops immediate propagation.
4. V25 world-map arrows/A/D/E/Enter: changes or enters the selected dungeon and stops immediate propagation.
5. V26 modal-choice arrows/WASD/E/Enter: moves focus or clicks the selected choice and stops immediate propagation.
6. V34 tooltip Escape: hides the tooltip but deliberately does not consume the key.

Bubble-phase listeners:

7. Core `game.js` keydown: world movement, chat focus, dance, character/skill panels, Space combat opening, E interaction, and generic Escape modal close.
8. `src/combat-keys.js`: generic modal button navigation and E activation for modal types not owned by V25/V26.

One core `keyup` listener clears WASD state. `#chatInput` separately handles Enter to send chat.

## Current priority contract

- Capture owners win through `stopImmediatePropagation()`.
- Tooltip Escape is observational and intentionally falls through.
- Typing guards exist in core world input and `combat-keys`, but the combat Escape owner intentionally handles Escape even while the answer input is focused.
- V26 modal choices are selected by DOM shape; `combat-keys` duplicates similar behavior but excludes V26-owned modal types/shapes.
- Keyup always clears movement state regardless of active screen or modal.
- Modal-opening E has a 300 ms grace period only in `combat-keys`; other E owners rely on capture order and modal type.

## Main risks

- Priority is implicit in source execution order and capture/bubble phase.
- Adding a new earlier capture listener can silently disable all later input.
- V26 and `combat-keys` duplicate button collection, visibility, selection, and E activation rules.
- Typing-field policy is repeated and not identical (`contenteditable` is only covered by `combat-keys`).
- `index.html` script order is part of keyboard correctness but the relationship is not represented as one interface.

## Required regression matrix before consolidation

- E on world: exactly one interaction.
- E on newly opened modal: does not immediately activate its first button.
- E on dialogue/boss confirm/world map/generic modal: exactly one owner.
- Escape in combat answer: one escape attempt, no generic close.
- Escape in non-combat modal: one close; tooltip also hides.
- Arrow/WASD in world vs world map vs modal choices: only the active context changes.
- Enter in chat input sends chat and triggers no world/modal action.
- E and arrows in input/textarea/select/contenteditable do not activate generic routes.
- Keyup clears a movement key even if a modal opens between keydown and keyup.

## Recommended boundary

Create one `YuksamInputRouter` with a single capture `keydown` and one `keyup` listener. Register ordered context handlers from game patches and `combat-keys`; handler return values control router continuation while handlers retain their exact preventDefault behavior. Migrate one context at a time under the regression matrix, then merge the duplicated V26/generic modal selection implementation only after runtime parity is proven.
