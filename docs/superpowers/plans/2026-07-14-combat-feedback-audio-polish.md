# Combat Feedback and Audio Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten combat pacing and synchronize logs, damage, critical feedback, movement, map labels, weapon tiers, starting vitality, and renamed audio assets.

**Architecture:** Keep the existing combat event queue as the source of truth. Add small reusable helpers for display durations, floating damage, and audio paths, then make each event trigger its own state change and feedback when displayed.

**Tech Stack:** Browser JavaScript, CSS animations, Canvas 2D, Node built-in test runner.

## Global Constraints

- Character renaming and save-key migration are excluded.
- Existing player saves are not migrated.
- No new runtime dependencies.
- Missing optional audio falls back to synthesized sound and never blocks combat.
- Git commits are skipped because this workspace is not a valid Git repository.

---

### Task 1: Combat Queue Timing and Per-Hit Feedback

**Files:**
- Modify: `src/combat-rules.js`
- Modify: `game.js`
- Modify: `style.css`
- Test: `tests/combat-rules.test.mjs`
- Test: `tests/combat-flow.test.mjs`

**Interfaces:**
- Produces: `shortenCombatDelay(delay, reduction = 400)` and per-event `effect.critical` / `effect.amount` feedback.
- Consumes: existing `queueCombatSequence(events, onComplete)` and one-shot combat effect handler.

- [ ] **Step 1: Add failing timing and flow tests**

```js
assert.equal(rules.shortenCombatDelay(2520), 2120);
assert.equal(rules.shortenCombatDelay(300), 0);
assert.match(gameSource, /hitInfo\.length\s*>\s*1/);
assert.doesNotMatch(gameSource, /전투 효과가 적용되었습니다/);
assert.match(gameSource, /상대는 강력한 냉기에 의해 얼어붙어 기절했다!/);
assert.doesNotMatch(gameSource, /Math\.ceil\(damage \* 0\.35\)/);
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `node --test tests/combat-rules.test.mjs tests/combat-flow.test.mjs`
Expected: failures for the missing helper and old total/detail behavior.

- [ ] **Step 3: Implement timing, exact critical triggers, and floating damage**

```js
const shortenCombatDelay = (delay, reduction = 400) =>
  Math.max(0, (Number(delay) || 0) - Math.max(0, Number(reduction) || 0));
```

Use shortened queue durations (`2520 -> 2120`, `2600 -> 2200`, `1000 -> 600`). Remove the early critical `playSfx` call from damage calculation. In the matching `monster-damage`, `player-damage`, and DOT handlers, trigger critical sound/flash and call a combat-stage floating-number helper with actual HP damage. Render no generic detail paragraph when `notice.detail` is absent. Append `player-total` only when the damaging `hitInfo` count is greater than one.

Deduplicate chill status events by normalized status type before queueing them, use the requested Frost Mage stun sentence for the specialization stun proc, and remove the undocumented Holy Priest damage-to-healing branch while preserving healing declared by active skill data.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/combat-rules.test.mjs tests/combat-flow.test.mjs`
Expected: all focused tests pass.

### Task 2: Warrior Motion and Block Training Notice

**Files:**
- Modify: `src/game-data.js`
- Modify: `src/combat-fx.js`
- Modify: `style.css`
- Modify: `game.js`
- Test: `tests/combat-fx.test.mjs`
- Test: `tests/game-data.test.mjs`
- Test: `tests/combat-flow.test.mjs`

**Interfaces:**
- Produces: player FX motions `offensive-armor-bump` and `shield-charge`.
- Consumes: existing `playPlayerActionFx(profile, applyImpact)` callback contract.

- [ ] **Step 1: Add failing profile, icon, and notice-order tests**

```js
assert.equal(data.SKILL_DEFS.warrior_def_wall.icon, '🛡️');
assert.equal(fx.getSkillFxProfile('warrior_def_wall', data.SKILL_DEFS.warrior_def_wall).motion, 'shield-charge');
assert.match(gameSource, /막기 훈련으로 보호막을 생성했다!/);
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `node --test tests/combat-fx.test.mjs tests/game-data.test.mjs tests/combat-flow.test.mjs`
Expected: old fortress icon and missing Block Training notice fail.

- [ ] **Step 3: Implement the two motions and queued shield notice**

Assign Offensive Armor extra-hit events `motion:'offensive-armor-bump'`; keep Shield Charge on `motion:'shield-charge'`. CSS keyframes move the player roughly 35% and 85% of the actor gap respectively before returning. Queue the Block Training status log immediately after shield creation and before the monster action event.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/combat-fx.test.mjs tests/game-data.test.mjs tests/combat-flow.test.mjs`
Expected: all focused tests pass.

### Task 3: Weapon Tiers, Zone Label, and New Character Vitality

**Files:**
- Modify: `src/game-data.js`
- Modify: `src/zone-banner.js`
- Modify: `game.js`
- Modify: `style.css`
- Test: `tests/game-data.test.mjs`
- Test: `tests/weapon-tier.test.mjs`
- Test: `tests/combat-flow.test.mjs`

**Interfaces:**
- Produces: tier-zero no-effect rule and zone-only cinematic CSS marker.
- Consumes: `getEquippedWeaponTierStyle(player)` and `showCinematicMessage`.

- [ ] **Step 1: Add failing vitality and tier tests**

```js
assert.equal(data.CLASS_META.warrior.baseStats.체력, 4);
assert.equal(data.CLASS_META.mage.baseStats.체력, 2);
assert.equal(data.CLASS_META.priest.baseStats.체력, 2);
assert.match(gameSource, /if \(!tierStyle \|\| tierStyle\.tier <= 0\) return/);
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `node --test tests/game-data.test.mjs tests/weapon-tier.test.mjs`
Expected: old vitality and tier-zero outline behavior fail.

- [ ] **Step 3: Implement restrained tiers and safe zone placement**

Tier zero returns before canvas outline drawing and receives no DOM tier class. Zone banner calls add a temporary `zone-entry` class to the cinematic overlay; CSS places that content below the HUD with desktop/mobile safe offsets while ordinary cinematics remain centered.

Use class-specific intensity factors: Warrior `0.8` (20% reduction), Mage and Priest `0.6` (40% reduction). Replace the Guardian Aura's body-centered radial fill with a pulsing horizontal ellipse/ring centered at the character's feet and drawn behind the sprite.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/game-data.test.mjs tests/weapon-tier.test.mjs`
Expected: all focused tests pass.

### Task 4: Central Audio Manifest and Renamed Assets

**Files:**
- Create: `src/audio-manifest.js`
- Modify: `index.html`
- Modify: `src/sfx-map.js`
- Modify: `src/ultimate-fx.js`
- Modify: `game.js`
- Create: `tests/audio-manifest.test.mjs`
- Modify: `tests/sfx-map.test.mjs`

**Interfaces:**
- Produces: `window.YuksamAudioManifest`, `getAudioAsset(id)`, and `playMappedAudio(id, options)`.
- Consumes: `game.settings.bgmVolume`, `game.settings.sfxVolume`, and current `assets/*.mp3` files.

- [ ] **Step 1: Add failing manifest and filesystem tests**

```js
for (const entry of Object.values(manifest.assets)) {
  assert.ok(existsSync(resolve(root, entry.src)), `missing ${entry.src}`);
}
assert.equal(manifest.assets.critical.src, 'assets/치명타 소리.mp3');
assert.equal(manifest.assets.townBgm.src, 'assets/마을 음악.mp3');
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `node --test tests/audio-manifest.test.mjs tests/sfx-map.test.mjs`
Expected: manifest module is missing and stale paths remain.

- [ ] **Step 3: Implement manifest and route audio calls**

```js
const assets = {
  townBgm:{ src:'assets/1. 마을 음악.mp3', volume:1 },
  forestBgm:{ src:'assets/1. 숲 음악.mp3', volume:1 },
  desertBgm:{ src:'assets/1. 사막 음악.mp3', volume:1 },
  swampBgm:{ src:'assets/1. 늪 음악.mp3', volume:1 },
  bossBgm:{ src:'assets/1. 보스전 음악.mp3', volume:1 },
  critical:{ src:'assets/3. 치명타 소리.mp3', volume:1 },
  playerHit:{ synth:'hit', volume:2 },
};
```

Include all present enhancement, quest, door, pet, class, specialization, and newly supplied event sounds. Replace stale paths in `game.js`, `sfx-map.js`, and `ultimate-fx.js`. Keep an explicit synthesized fallback. Double only the synthesized player-hit gain and clamp WebAudio gain to its existing maximum.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/audio-manifest.test.mjs tests/sfx-map.test.mjs`
Expected: every configured path exists and all focused tests pass.

### Task 5: Browser Smoke and Full Regression

**Files:**
- Modify: existing `try_combat_event_timing.js`, `try_combat_animation.js`, and `try_weapon_tiers.js` only if selectors require updates.

**Interfaces:**
- Consumes: completed Tasks 1-4.
- Produces: verified user-visible behavior.

- [ ] **Step 1: Run the complete unit suite**

Run: `npm.cmd test`
Expected: all tests pass with zero failures.

- [ ] **Step 2: Start a local static server**

Run: `python -m http.server 4173`
Expected: server listens on `http://localhost:4173`.

- [ ] **Step 3: Run browser smokes**

Run: `node try_combat_event_timing.js && node try_combat_animation.js && node try_weapon_tiers.js`
Expected: critical feedback matches its hit log, both targets show floating damage, warrior motions return to origin, tier zero has no effect, higher tiers are restrained, and the zone label is not hidden by the HUD.

- [ ] **Step 4: Inspect desktop and mobile screenshots**

Verify `1280x800` and `390x844`: no overlap, clipped text, hidden zone title, lingering FX node, or weapon-obscuring glow.
