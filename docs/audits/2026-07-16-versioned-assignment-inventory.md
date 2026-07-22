# Versioned Assignment Inventory

## Snapshot

After the world-render package, `game.js` contains 137 versioned function assignments when version names with suffixes such as `V25Buttons` are included. The repeated targets are:

| Count | Target |
|---:|---|
| 6 | `updateAudioVolumes` |
| 5 | `getDesiredAudioFile`, `renderCombatFrame` |
| 5 | `updateHud` |
| 4 | `getNearbyMonster`, `resumeAudio`, `updateForestMonsters` |
| 3 | `computeTotalStats`, `drawWeapon`, `openCombat` |
| 2 | `closeModal`, `drawBossRoom`, `drawTown`, `itemIcon`, `openModal`, `showScreen`, `startGame`, `syncAudioFileBgm`, `window.escapeCombat` |

All other targets occur once. A repeated assignment count is an architectural risk indicator, not permission to combine unrelated systems.

## Selection

`updateHud` is the next package because its four wrappers have a small synchronous surface and observable DOM/state behavior. Its final order is:

1. V27 normalizes pet, enhancement, and equipment fields.
2. V24 synchronizes skill points and removes obsolete skill IDs.
3. V23 performs its legacy specialization migration.
4. Base HUD updates values, bars, specialization controls, zone, audio, and quest tracker.
5. V22 applies display specialization normalization.
6. V23 ensures one in-game settings button.
7. V25 ensures the heal/cooldown development buttons and their listeners.

`renderCombatFrame`, `openCombat`, and `computeTotalStats` remain separate later packages. Audio chains should be reconciled with the existing dispatcher rather than folded into HUD work.
