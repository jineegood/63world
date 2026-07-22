# Single Input Router Implementation Plan

1. Add pure router unit tests for priority, stable ties, consume/fall-through, unregister, duplicate IDs, keyup routing, and runtime listener count.
2. Add browser regression cases from `docs/audits/2026-07-16-input-routing-inventory.md`, starting with typing isolation and one-owner E/Escape paths.
3. Implement `src/input-router.js`, load it before `game.js`, and connect it to the default gate.
4. Migrate capture owners one at a time: tooltip, world map, dialogue, boss confirm, combat Escape, V26 choices. Run focused browser tests after each migration.
5. Migrate core keydown/keyup and `src/combat-keys.js`; assert only the router installs global key listeners.
6. Run keyboard, combat sequence, boot, and safety-net smokes plus `npm.cmd test`.
7. Record exact hashes, update the handoff, and create a post-package ZIP checkpoint.

Do not merge V26 and generic modal button-selection implementations in the same package. That is a follow-up cleanup after routing parity is established.
