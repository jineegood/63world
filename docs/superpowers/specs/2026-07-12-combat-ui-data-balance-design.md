# Combat, UI, Data, and Balance Design

## Goal

Apply the requested UI, combat feedback, question selection, balance, audio, quest, and workbook changes to the current `63world` project without replacing the current implementation with an older version.

## Scope And Delivery Order

Work is divided into five independently verifiable groups:

1. HUD, skill-point hint, status tooltips, and weapon-tier visuals.
2. Combat notice sequencing, question locking, and effect visibility.
3. Class skills, monster scaling, critical damage, and enhancement rates.
4. Audio mappings, active-workbook-only question selection, and quest data.
5. Current-data workbook generation and editable combat formulas.

The existing patch-based structure remains in place. New reusable calculations and data selectors may be placed in focused `src/` modules, while DOM/canvas integration stays at the final active call sites in `game.js`.

## UI Design

### Logout Button

The in-game `나가기` button uses a red background, red-family border, white text, and a clearly visible hover state. This styling applies only to the HUD logout command.

### Unspent Skill Point Hint

The hint is rendered inside the skill window, below the skill tree content. It is visible only while the skill window is open and the player has at least one unspent skill point. The old HUD-anchored speech bubble is removed or disabled so it cannot leave the viewport.

### Combat Status Badges And Tooltips

Combat badges use a shared metadata map containing label, description, duration text, and numeric value text. At minimum it covers poison, stun, shield, weaken, increased miss chance, and Guardian Oath readiness. Hovering or keyboard-focusing a badge displays a tooltip explaining the effect and remaining turns or amount.

Guardian Oath is shown as `맹세 준비` while revival is available. It disappears as soon as the once-per-battle revival is consumed.

### Enhanced Weapon Visuals

Equipped weapons receive both a colored outline and a restrained aura in the character panel and combat scene:

- Advanced: green.
- Rare: blue.
- Epic: purple.
- Legendary: gold.

Normal weapons receive no aura. The color always comes from the shared tier data.

## Combat Flow Design

### Notice Sequencing

Combat events are converted into ordered notices rather than one concatenated message. Every meaningful action or effect remains visible for at least the configured combat notice duration. The normal duration is increased by 600 milliseconds over the current duration, while the existing combat-speed cheat continues to scale it.

The sequence must explicitly show:

- Skill or monster technique activation.
- Direct damage and critical damage.
- Shield creation, shield absorption, healing, and revival.
- Poison application and poison tick damage.
- Stun application and the skipped enemy action.
- Weaken or miss-chance application.
- Misses caused by a named player skill.
- Defeat and reward transitions.

Examples:

- Mushroom poison: attack notice, poison application notice, then on its tick `중독으로 독이 몸을 갉아먹습니다!` with the damage amount.
- Slime shield: `점액 방패를 사용했다!`, then shield creation, then damage dealt.
- Stomp Earth Slam: activation, damage, then one-turn stun application.

Notices cannot be skipped merely because several effects happen in one action. Input is disabled while an action sequence is resolving.

### Question Locking

The first question opened during a player turn is stored as the turn question. Closing the answer UI, returning to the combat menu, or switching between basic attack and any skill reuses that exact question. The lock clears only when:

- A submitted correct or incorrect answer resolves the turn.
- Combat ends.
- The player successfully escapes or leaves combat through a legitimate terminal path.

Selecting an action does not replace the question. This rule applies equally to basic attacks and skills.

## Balance Design

### Monster Techniques

- Stomp `대지찍기` deals its existing damage and applies one turn of stun.
- All monster techniques and special effects use the notice sequence described above.

### Zone Scaling

Scaling applies once to the final base values used to create each monster, including zone bosses:

- Desert: HP x 1.20 and attack x 1.10.
- Swamp: HP x 1.30 and attack x 1.20.

Final HP and attack values use one documented integer-rounding helper, and tests verify that scaling is not applied twice when maps or bosses are recreated.

### Mage

- `원소 폭발` executes when the enemy's remaining absolute HP is at or below 3, 6, 9, 12, or 15 according to skill rank. Percent-based execution is removed from calculations, descriptions, and workbook formulas.
- A mage basic-attack critical always deals 180% of that basic attack's normal damage.
- Skill-tree critical-damage bonuses apply only to active-skill critical damage. Tooltips use the phrase `스킬 치명타 피해` so basic attacks are not implied.

### Priest

- `빛의 일격` becomes `빛의 섬광`.
- Light Flash heals every living ally for 50% of each target's maximum HP and has a four-turn cooldown. In current solo combat the ally list contains the player; future party members can be added through the same ally-target interface.
- `신앙의 일격` has a three-turn cooldown and heals 15% of the caster's maximum HP.
- Priest miss-chance effects participate in the final monster hit roll. A miss caused by the effect names its source, for example `신앙의 광채로 인해 공격이 빗나갔다!`.

### Defensive Warrior

- `방어태세` grants a shield equal to 25% of maximum HP.
- `방패돌진` grants a shield equal to 25% of maximum HP.
- Guardian Oath readiness is exposed through the combat badge metadata and consumed on revival.

### Teacher Boss Copy

Combat copy such as `명진쌤이 얻어맞는다` is replaced with respectful damage language such as `명진쌤이 피해를 받았다`.

### Enhancement

The shared tier table is the only source for display and resolution probabilities:

- Normal to Advanced: 80%.
- Advanced to Rare: 60%.
- Rare to Epic: 40%.
- Epic to Legendary: 20%.

The stale hard-coded 70/50/30/10 display is removed. Boundary tests mock the random value immediately below, equal to, and above each threshold. Browser tests verify that the current shop button reaches the latest enhancement resolver. Existing cost, four-second presentation, one-tier failure downgrade, and legendary cap remain unchanged.

## Audio Design

Audio files with a specialization name and `스킬들` are shared only by active skills belonging to that specialization. They do not play for class-common skills or basic attacks. A specialization-specific ultimate file overrides the shared specialization file for that ultimate.

Mappings include the currently supplied frost mage, fire mage, weapon warrior, holy priest, and shadow priest files. Existing Guardian Oath, enhancement, quest completion, pet, door, and basic combat audio remains available. Playback continues to respect the existing SFX enabled and volume settings.

## Question Workbook Design

Every hunting zone and boss requests questions from the same enabled-workbook selector. Only questions in administrator-enabled workbooks are eligible, regardless of workbook zone metadata. If no enabled workbook contains a usable question, combat action resolution is blocked and the user sees `선생님이 활성화한 문제집이 없습니다.` No hidden default-question fallback is used in that state.

Existing saved workbook data is normalized without silently re-enabling a workbook the administrator disabled.

## Quest And Spreadsheet Design

### Quest Import

`시트/퀘스트_수정시트.xlsx` is treated as the requested quest source. Its identifiers, targets, counts, rewards, descriptions, dialogue, and order are compared with `src/quest-data.js`, then the code data and tests are updated to match the sheet. Invalid or duplicate quest IDs fail validation rather than being guessed.

### Current Item And Skill Workbook

The original `시트/아이템_스킬_수정시트.xlsx` is preserved. A new workbook is exported under `outputs/` and contains the current in-game item and skill definitions after these changes.

The workbook also contains editable calculation sheets for each class and specialization. Inputs are visibly separated from formula cells. It exposes at least:

- Primary stats and equipment contributions.
- Final attack power.
- Basic-attack damage.
- Active-skill multiplier and damage.
- Critical chance.
- Basic-attack critical damage fixed at 180% for mage.
- Active-skill critical damage and skill-only bonuses.
- Defense and incoming-damage reduction.
- Healing and shield amounts.
- Cooldowns and execute thresholds where applicable.

Derived values use Excel formulas referencing editable cells. The workbook preserves the established visual style where practical, includes no formula errors, and is rendered for visual inspection before delivery.

## Testing And Verification

Behavior changes follow a failing-test-first cycle. Tests cover question reuse across cancelled attacks and skills, notice ordering, effect visibility, status metadata, absolute-HP execution, class balance values, zone scaling, enhancement thresholds, enabled-workbook filtering, audio mapping scope, and quest-sheet synchronization.

After unit and data tests pass, the existing browser smoke harness verifies the active UI paths. Manual browser screenshots verify the logout button, skill-window hint, status tooltips, and weapon aura at desktop and narrow viewport sizes. The final workbook is inspected for formulas and rendered sheet by sheet.

## Out Of Scope

This change does not implement multiplayer party membership, networking, or a server. It provides an ally-target interface for Light Flash so those systems can attach later. It also does not broadly rewrite the versioned patch history in `game.js`; only touched behavior is consolidated where required to guarantee one active implementation.
