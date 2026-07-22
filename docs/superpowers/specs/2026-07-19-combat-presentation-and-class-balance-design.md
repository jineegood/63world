# Combat Presentation and Class Balance Design

## Scope and implementation assumptions

This pass applies every requirement whose behavior can be determined from the current combat model. The user explicitly selected fire skill critical damage option B and fixed elite Hardening at 22.5% maximum HP. No unrelated systems or legacy data snapshots are changed.

Where a numeric interpretation is implicit, this design uses the existing combat conventions:

- Shield Charge base damage is capped at 100 before critical calculation. It uses the normal player critical roll and 150% critical multiplier, so only a critical Shield Charge may exceed 100 (maximum 150 before chill or other downstream modifiers).
- Teacher Boss damage is increased by multiplying its base attack roll by 1.2 before technique multipliers. This raises normal attacks and every derived technique, including both Homework Bomb hits, by the same 20%.
- Fire skill critical damage starts at 200%, then Ember Amplification adds 20/40/60/80/100 percentage points for final multipliers of 220/240/260/280/300%. Fire basic attacks retain the universal 150% critical multiplier.
- Holy specialization cannot critically hit with basic attacks or damaging skills. Enemy critical hits against the Holy Priest remain possible.

## Warrior behavior

Shield Charge remains a two-stage action:

1. The pre-hit shield notice applies the shield, displays a gray `+amount` number over the player, plays the Defense Stance sound, and plays the shield wave animation.
2. The following hit notice performs the charge, plays the Shield Charge sound, and applies the capped/critical damage.

The damage input is the player's shield after the new shield is added. Non-critical base damage is `min(current shield, 100)`. A normal critical roll may then multiply the capped value by 1.5.

When Guardian's Oath revives the player, player HP is restored as before and `game.combatShield` is set to zero before the revive frame is rendered.

## Monster action timing and Hardening

Monster action events keep their attack announcement and actor wind-up. Projectile creation moves from `monster-action` to the corresponding landed `player-damage` event so the projectile travels during the log where damage is applied. Multi-hit projectile techniques attach one projectile FX to each damage event.

Elite Hardening is a self-only turn:

- It grants 22.5% of monster maximum HP as shield.
- It deals no damage.
- It uses no projectile.
- Its action/status presentation uses a dedicated defensive shield-orbit/wave animation around the monster.
- It plays the Defense Stance audio instead of the enemy attack audio.

Other monster self-shield techniques retain their configured shield percentages unless they are the elite Hardening technique.

## Mage balance and presentation

Frost:

- Frost Focus keeps three ranks and its 7/21/35% stun chances, but grants Intelligence +1 per rank.
- Frost Lance changes from 180% to 210% damage; cooldown and chill behavior remain unchanged.
- Mind of Winter changes to five ranks and Intelligence +4 per rank.

Fire:

- Ember Amplification changes to five ranks.
- It grants the existing Intelligence +1 per rank.
- Fire skill critical multipliers by rank become 220/240/260/280/300%.
- Fire critical chance remains base 15% plus Fire Focus 10/20/30 percentage points, for 25/35/45% total.
- The specialization selection card is synchronized to `치명타 확률 최대 45% · 스킬 치명타 피해 최대 300%`.
- Meteor creates its full animation and plays the Meteor sound on each of its four hit notices, not only the first.

## Priest balance and feedback

Prayer Barrier retaliation:

- Plays `assets/8. 기도의 방벽 소리.mp3` on every proc; the audio manifest and tests use the actual spaced filename.
- Displays red damage `-amount` over the monster and green healing `+amount` over the player.
- Its retaliation log states both reflected damage and actual HP restored.
- Healing remains affected by Holy healing mastery and is clamped to missing HP; the log and popup use the actual restored amount.

Global positive floating numbers:

- Every combat HP restoration event displays a green `+amount` centered on the healed actor.
- Every player or monster shield creation event displays a gray `+amount` centered on the shielded actor.
- Zero actual healing produces no popup.
- Existing red damage numbers remain unchanged.

Holy Judgment uses its prayer/impact animation but no projectile.

Faith Radiance retains the current miss partition:

- Universal miss occupies the first 10 percentage points and uses the ordinary miss message.
- Faith Radiance occupies its configured additional 5/10/15/20/25 percentage points and uses the Faith Radiance message.
- Therefore rank 3 totals 25%, while rank 5 totals 35%.

Cooldown and sustain changes:

- Faith Strike cooldown 4 to 5 and maximum-HP healing 15% to 25%.
- Holy Barrier cooldown 5 to 6.
- Holy Judgment cooldown 6 to 8.
- Holy specialization player attacks never critically hit; this restriction is shown on the specialization selection card.

Shadow:

- Void Mastery changes to five ranks, grants Spirit +2 per rank, and gives shadow-stack critical chances 20/40/60/80/100%.
- Shadow Focus life-steal is deferred because the existing skill has five ranks while the requested chance list contains only 10/20/30%. No rank count or missing rank-four/five probabilities are inferred during the unattended pass.

## Teacher Boss

Teacher Boss base attack is multiplied by 1.2 before all technique calculations. This affects normal attacks, Heavy attacks, Homework Bomb, and Chill attacks consistently. Homework Bomb remains two hits and each hit receives its own projectile FX at its damage notice.

## Event and effect architecture

Presentation is driven by typed combat events rather than direct timers in damage calculation:

- Extend effect metadata for actual healing/shield feedback.
- Attach audio and FX to the exact notice that applies the matching state change.
- Allow per-hit FX/audio replay metadata for multi-hit skills.
- Split monster wind-up FX from projectile/impact FX so action and damage notices can present separately.
- Add a dedicated monster self-shield profile instead of reusing projectile attacks.

## Verification

Tests cover:

- Every new skill rank, bonus array, multiplier, cooldown, and tooltip.
- Shield Charge pre-shield sound/FX order, damage cap, critical-only overflow, and Guardian's Oath shield reset.
- Projectile absence/presence and per-hit placement for monsters, Hardening, Meteor, Holy Judgment, and Homework Bomb.
- Elite Hardening shield amount and no-damage turn.
- Fire damage formulas and specialization text.
- Faith Radiance probability partitions.
- Prayer Barrier audio filename, event log, actual healing, and two floating numbers.
- Green heal and gray shield floating numbers for all supported combat effect handlers.
- Holy specialization critical suppression and Shadow Focus/Void Mastery runtime behavior.

## Deferred question

Shadow Focus currently has five ranks, but the requested life-steal schedule lists only 10/20/30%. Before implementing that one effect, confirm whether the skill should become three ranks or remain five ranks with explicit fourth/fifth-rank chances. All other confirmed work proceeds independently.

Focused jsdom combat tests run serially. The complete suite runs afterward.
