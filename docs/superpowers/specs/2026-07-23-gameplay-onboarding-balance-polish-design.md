# Gameplay Onboarding and Balance Polish Design

**Date:** 2026-07-23

## Goal

Improve the early-game experience with clearer presentation, gentler failure rules, better access to healing, two tutorial quests, and sequential reward feedback without changing live deployment state.

## Scope

This change includes:

- removing `Demo` from the login screen;
- matching the costume return button to the existing blue primary button style;
- preserving experience on death until the player has selected a level-5 specialization;
- reducing normal Mushroom attack output by 20%;
- increasing normal Slime maximum HP by 10%;
- letting incorrect combat answers deal 50% of the action's calculated damage before the normal monster turn;
- showing the correct answer in green for at least two seconds after an incorrect answer;
- adding two healing wells to each hunting map;
- increasing the town Myeongjin teacher interaction distance from 72 to approximately 110;
- presenting monster and quest rewards in the order EXP, Gold, then Building at one-second intervals;
- adding a skill-learning tutorial quest after `tut_shop`;
- adding a costume-purchase tutorial quest after `slime_hunt`.

Elite monster balance, deployment, Supabase execution, GitHub push, and the disabled security-v2 switch are outside this change.

## Implementation Shape

A small pure browser module will own the new calculations and presentation plans. It will expose deterministic helpers for:

- early death experience preservation;
- normal-monster balance adjustment;
- half-damage rounding for incorrect answers;
- ordered non-zero reward steps;
- fixed healing-well definitions for each hunting map.

`game.js` will integrate those helpers with the existing final combat, defeat, reward, world-render, interaction, and quest-action boundaries. Quest definitions remain in `src/quest-data.js`, and costume purchase completion remains in `src/costume-ui.js`.

This avoids another large collection of unrelated numeric rules inside the existing patch chain while preserving current save formats and runtime globals.

## User Interface Changes

### Login and Costume

- Change `Classroom MMORPG Demo` to `Classroom MMORPG`.
- Replace the costume return button's inline red gradient with the existing `primary wide` styling used by the costume controls.

### Incorrect Answers

An incorrect answer will show:

- an explicit incorrect-answer heading;
- the correct answer in green;
- a display duration of at least 2,000 milliseconds;
- the reduced damage dealt by the attempted attack, when the action is damaging.

The monster then takes its normal turn. Incorrect support-only actions do not grant healing, shields, buffs, or status effects.
Each non-missed damaging hit is reduced with `Math.max(1, Math.floor(originalHit * 0.5))`.

## Early-Game Balance

### Death

Before specialization selection, death preserves the player's current total experience exactly. Existing gold loss and town respawn behavior remain unchanged.

After specialization selection, the existing loss of half the current level's experience progress remains unchanged.

The death message must accurately say whether experience was protected or reduced.

### Monsters

- Normal Mushroom attack values are multiplied by `0.8` and rounded to the nearest integer with a minimum of 1.
- Normal Slime maximum HP is multiplied by `1.1` and rounded to the nearest integer.
- Elite Mushrooms and elite Slimes are unchanged.

## Healing Wells

The existing town healing well remains.

Each hunting map receives two additional wells:

- one near the map entrance/player spawn;
- one on the route immediately before the stronger normal-monster area.

The stronger-area boundary means Slimes in the forest, Snakes in the desert, and Zombies in the swamp. Placement will use fixed world coordinates selected from current spawn and path geometry. Wells must not overlap portals, colliders, or monster spawn centers.

All wells use the existing healing question flow: a correct answer restores full HP, while an incorrect answer closes the well without healing.

The world renderer and interaction registry will read the same well collection so visible and interactive positions cannot diverge.

## Reward Presentation

Monster and quest rewards are applied to player data and saved immediately. Only the visual announcements are delayed, preventing lost rewards if the modal closes or the page is interrupted.

Announcements are queued as:

1. EXP immediately;
2. Gold after 1,000 milliseconds;
3. Building after another 1,000 milliseconds, only when the reward is greater than zero.

Level-up presentation remains authoritative and must not be suppressed. Chat receives one concise final reward summary to avoid three permanent duplicate messages.

## Tutorial Quests

### Skill Quest

Insert `tut_skill` immediately after `tut_shop`.

- Action: learn one skill.
- The dialogue explains the N key, skill points, the unused-point reminder, and that an active skill becomes a selectable combat action.
- Existing characters that have already learned a skill may complete the quest when it is accepted by detecting their learned skill state; they are not forced to spend another point.

### Costume Quest

Insert `tut_costume` immediately after `slime_hunt`.

- On acceptance, grant 150 Gold once.
- Action: purchase one costume item from the costume merchant.
- The purchase hook records `buyCostume` only after Gold is deducted and ownership is added.
- Existing owned costumes do not auto-complete the quest; the tutorial is specifically about making a purchase after acceptance.
- If an old character already owns every costume sold by the merchant, accepting the quest completes the purchase objective immediately so the quest line cannot become blocked.

Quest IDs and the existing quest-state object format remain unchanged apart from the two additive definitions, preserving old saves.

## Error and State Safety

- Timed reward announcements capture immutable reward values rather than reading mutable player state later.
- Reopening or leaving a modal cannot award resources twice.
- Healing wells do not create new save fields.
- Wrong-answer damage uses the existing combat event queue so damage, defeat detection, and the monster turn remain ordered.
- A wrong damaging skill consumes its normal cooldown; secondary beneficial effects and statuses are not applied.
- Security v2 remains disabled.

## Testing

Add focused tests for:

- login and costume copy/style;
- pre-specialization and post-specialization death experience;
- Mushroom and Slime normal/elite balance boundaries;
- wrong-answer half damage, minimum damage, correct-answer visibility, cooldown use, and monster counterattack;
- reward step order, timing, zero-value omission, and immediate resource persistence;
- six hunting-map well definitions, rendering, and interaction;
- expanded Myeongjin teacher interaction range;
- quest order, dialogue content, one-time acceptance grants, learned-skill compatibility, and costume purchase completion.

Run focused suites, browser smoke tests, safety-net tests, and finally `npm.cmd test`. No GitHub push, Vercel deployment, Supabase SQL execution, or production switch activation is part of verification.
