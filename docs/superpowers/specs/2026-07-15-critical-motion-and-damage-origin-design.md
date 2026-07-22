# Critical Motion and Damage Number Origin Design

## Goal

Restore the existing V23 and V24 critical-hit motion exactly as it behaved before, while moving floating damage numbers so they begin at the visual center of the affected combat character.

## Scope

- Keep the current mapped critical sound file and its timing.
- Restore both existing critical visual layers: the V23 flash and the V24 stronger flash/screen shake.
- Do not redesign, weaken, replace, or remove any existing critical animation.
- Calculate floating damage `left` and `top` from the target actor rectangle center relative to the combat stage.
- Keep the current diagonal outward fade animation and 1.2-second duration.
- Do not change damage calculations, critical chance, critical multipliers, combat log duration, or unrelated combat FX.

## Implementation

The V25 critical sound branch currently returns after mapped audio playback, bypassing the older wrapped `playSfx` chain that used to trigger V23 and V24 visuals. The fix will explicitly invoke the two existing visual functions in the V25 critical branch before playing the mapped sound. This restores the original visuals without re-entering the older sound chain and playing duplicate audio.

`showCombatFloatingDamageV45` will place the number at `actor center - stage origin` for both player and monster. CSS movement remains unchanged so the number starts on the body and travels diagonally away.

## Verification

- Add a regression test proving the V25 critical branch calls both legacy visual functions and still maps the critical sound once.
- Add a regression test proving floating numbers use `rect.width * .5` and `rect.height * .5` rather than actor outer edges.
- Run the focused combat-flow tests and the full baseline suite.
