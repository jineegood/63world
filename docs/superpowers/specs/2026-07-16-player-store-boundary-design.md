# Player Store Boundary Design

## Goal

Route every player-account localStorage read, list, write, and delete through one pure, testable boundary while keeping the existing `ysb_player_` keys, JSON payloads, normalization, login behavior, corrupt-byte preservation, and administrator rewards unchanged.

## Audit findings

`game.js` currently owns key construction, account enumeration, save, delete, classification, and load. `src/admin-dashboard.js` correctly uses `loadPlayer()` but bypasses the save path in two reward functions with direct `localStorage.setItem(...)`. This split lets future changes to key normalization, corruption policy, or serialization reach gameplay saves but miss administrator mutations.

The existing contracts are:

- names are trimmed before key construction;
- absent records classify as `{ status:'absent', player:null, raw:null }`;
- valid JSON must be a non-array object and is normalized on read;
- malformed JSON and JSON primitives/arrays classify as corrupt;
- corrupt bytes are never rewritten by read, login, or character creation;
- enumeration silently skips corrupt/invalid entries and sorts normalized players in the existing UI layer;
- ordinary gameplay save updates `updatedAt` before persistence;
- administrator rewards preserve all unrelated player fields and do not require a second account key;
- deletion removes only the trimmed target account key.

## Chosen architecture

Create `src/player-store.js`, a browser-global factory with injected `storage`, `prefix`, and `normalizePlayer` dependencies.

```js
const playerStore = window.YuksamPlayerStore.create({
  storage: window.localStorage,
  prefix: STORAGE.playerPrefix,
  normalizePlayer,
});

playerStore.key(name);
playerStore.read(name);
playerStore.load(name);
playerStore.list();
playerStore.write(player);
playerStore.remove(name);
```

The module performs storage mechanics only. It does not know about the DOM, game state, passwords, teacher authentication, timestamps, sorting, workbooks, or teacher settings. `write(player)` serializes the supplied object without normalization or mutation so callers retain existing semantics. `read` returns the original raw bytes alongside the normalized player.

`game.js` keeps its existing public lexical functions (`playerKey`, `getPlayers`, `savePlayer`, `deletePlayer`, `readPlayerStorage`, `loadPlayer`) as thin compatibility delegates. `savePlayer` remains responsible for `updatedAt`; `getPlayers` retains its current sorting. The two authenticated administrator reward paths call a shared game-level `savePlayerRecord(player)` delegate instead of localStorage directly.

## Scope boundary

Teacher configuration (`ysb_teacher_v1`) and workbook/question storage have different validation, fallback, migration, and authorization contracts. They were inventoried but are intentionally excluded from this player-account package. No save migration, password hashing, current-user session key, UI change, gameplay rule, or data normalization change is included.

## Verification

- Pure unit tests cover trimmed keys, absent/valid/corrupt classification, byte preservation, exact writes, delete targeting, list filtering, and storage exceptions.
- Source-boundary tests forbid player-key localStorage access outside `src/player-store.js` and require administrator rewards to use the shared write delegate.
- Existing browser smokes prove save/reload, pet-field preservation, one trimmed key, admin rewards, corrupt classification, corrupt login/create blocking, and delete behavior.
- The complete default gate must pass before completion.
