# Combat Feedback and Audio Polish Design

## Scope

This patch covers only the requested combat timing, combat feedback, weapon tier styling, map label placement, new-character vitality, and audio mapping changes. Character renaming and save-key migration are explicitly excluded.

## Combat Event Timing

- The combat sequence remains event-driven through the existing combat event queue.
- Reduce each existing notice duration by 400 ms, clamped at zero.
- A critical hit triggers its sound and visual flash when that hit's log is displayed, not when damage is calculated.
- Damage is applied, the impact animation runs, and a floating red `-N` appears on the damaged actor during the matching log event.
- Show `총 N의 피해를 주었다!` only when the player action contains at least two damaging hits.
- Remove the generic `전투 효과가 적용되었습니다.` detail line.

## Warrior Feedback

- Offensive Armor bonus damage uses a short half-distance forward bump and return.
- Shield Charge moves the player into the monster, collides, and returns.
- Shield Charge uses a shield icon instead of a fortress icon.
- When Block Training creates its pre-counter shield, add `막기 훈련으로 보호막을 생성했다!` before the monster attack proceeds.
- A Frost Mage stun is announced as `상대는 강력한 냉기에 의해 얼어붙어 기절했다!`.
- A chill application produces one status explanation only, even when both the active skill and specialization passive request chill.
- Holy Priest basic attacks do not heal. Only skills with an explicit healing property restore HP.

## Floating Damage Numbers

- Floating damage numbers are transient DOM nodes attached to the combat stage.
- Player and monster damage use red `-N` text positioned over the target body and animated upward/outward with fade-out.
- Blocked damage displays only the actual HP damage. A fully blocked hit does not create `-0`.
- Nodes are cancelled and removed when combat ends or its event generation changes.

## Weapon Tier Presentation

- Tier 0 weapons have no tier border, outline, glow, or aura.
- Tiers 1-4 retain their green, blue, purple, and gold identities.
- Reduce outline thickness, glow radius, inset glow, and opacity by 20% for Warrior weapons and 40% for Mage and Priest weapons so the weapon art remains readable.
- Apply the same restrained treatment to world/combat canvas weapons and equipment/upgrade DOM cards.

## Guardian Aura

- Replace the body-centered radial wash with a clearly visible horizontal circular aura at the character's feet.
- The ring uses a restrained pulse and remains behind the character sprite in every world and preview drawing path.

## Map Label

- Keep the current zone-entry message behavior.
- Position the cinematic zone title below the fixed HUD safe area so it cannot be covered by the top window on desktop or mobile.
- Other cinematic messages retain their current centered presentation.

## New Character Vitality

- Change only class creation base stats: warrior vitality 8 to 4; mage vitality 5 to 2; priest vitality 5 to 2.
- Existing saved characters are not migrated or rewritten.

## Audio

- Replace stale hard-coded filenames with the numbered Korean filenames currently present in `assets`.
- Map renamed town, forest, desert, swamp, boss, door, enhancement, quest, critical, and skill audio through one manifest module.
- Add mappings for the newly supplied mage basic attack, magic missile, enemy attack, Offensive Armor, and Shattering Strike sounds where their matching events exist.
- Double only the gain of the built-in synthesized player-hit sound, clamped to the audio system's safe maximum.
- Future audio additions use stable event IDs mapped to filename and volume in the manifest. Automated tests verify that every configured file exists.
- Missing optional files fall back to the existing synthesized sound without stopping combat.

## Testing

- Unit tests cover shortened durations, single-hit total suppression, per-hit critical event metadata, Block Training notice ordering, base vitality, audio manifest paths, and tier-0 suppression.
- Browser smoke tests verify map-label visibility, restrained weapon tiers, exact per-hit critical feedback, floating damage numbers for both sides, and both warrior movement profiles.
- Run the complete existing test suite after focused tests.
