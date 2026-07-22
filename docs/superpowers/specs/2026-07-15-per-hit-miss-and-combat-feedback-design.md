# Per-Hit Miss and Combat Feedback Design

## Scope

- Add an independent 10% miss roll to every hostile player and monster hit.
- Play the class basic-attack sound again on the second Double Attack hit.
- Move floating damage numbers diagonally away from the actor with stronger typography and a slightly longer fade.
- Apply Block Training shield on the exact notice that announces it.

## Combat Rules

Each hostile hit rolls independently. A multi-hit action may therefore partially hit and partially miss. Healing, shields, buffs, and other friendly support effects never roll for miss.

A missed hit deals no damage, cannot critically hit, and does not trigger hit-dependent statuses or healing. The combat sequence contains a visible miss event with the existing miss sound. Player and monster hit calculations must store the result once and reuse it for both the log and the queued effect; the queue must not reroll.

The existing Holy Priest monster miss bonus remains additive to the new universal monster miss chance, capped at 100%. The universal player miss chance is 10%.

## Audio

The first normal attack hit keeps its current class basic sound. When Double Attack creates a second hit, that hit receives the same class basic audio ID and plays it when the second-hit notice appears. A missed Double Attack hit uses the miss sound instead of the attack sound.

## Floating Damage

Floating numbers begin near the upper side of the damaged actor and travel outward diagonally. Player damage moves toward one side and monster damage toward the opposite side so the number does not cover the sprite. Use a bold, high-contrast game UI font stack, a dark text stroke/drop shadow, and a duration around 1.2 seconds. Zero damage never creates a number.

## Block Training Timing

Block Training remains a typed queued effect. Its shield mutation must run inside the same `showNotice` pass that renders `막기 훈련으로 보호막을 생성했다!`, before the next combat notice is scheduled. Tests will capture shield values at each emitted event to prevent a one-message delay regression.

## Testing

- Unit-test 10% hit rolls and additive monster miss chance.
- Verify multi-hit results can mix hit and miss without rerolling.
- Verify missed hits omit damage, critical, and hit-dependent effects.
- Verify Double Attack's second event carries class basic audio or miss audio.
- Verify floating-number direction, font treatment, and duration contracts.
- Verify Block Training shield is present on its own emitted notice and absent before it.
- Run the complete test suite and reload the local browser with no console errors.
