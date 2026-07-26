# Server-Authoritative PvE Combat Design

## Goal

Move ordinary monster combat, answer grading, random combat rolls, health
changes, death handling, experience, gold, building rewards, and question
statistics out of the browser. Preserve the current combat presentation and
keep movement and multiplayer presence on their existing lightweight paths.
The v3 cutover flag remains disabled until the complete security migration is
tested and deliberately deployed.

## Approaches considered

1. Let the browser calculate an outcome and sign or validate it later. This is
   inexpensive, but a student can still invent damage, rewards, or a correct
   answer before validation. It does not meet the security goal.
2. Put the complete combat engine in PostgreSQL. This is strongly
   transactional, but the existing skills, effects, monster techniques, and
   presentation events would become difficult to understand and maintain.
3. Use a trusted Edge Function for combat rules and narrow service-only
   PostgreSQL functions for atomic state changes. This is selected. It keeps
   complex rules testable in JavaScript while the database prevents duplicate
   or stale writes.

## Trust boundary

The browser may submit only an action identifier, answer text, monster
identifier, expected combat revision, and request ID. It may never submit a
correctness result, answer key, damage, random roll, player stats, monster
stats, health result, reward amount, level result, cooldown result, or user ID.

The Edge Function verifies the access token and derives the user from it. It
loads private combat state and the answer key through service-role-only
database functions, runs the pure combat engine, and commits a bounded outcome
using the revisions returned by the database. The database rejects stale
player or combat revisions and replays each request ID at most once.

## Authoritative catalogs

A deterministic generator emits a shared combat catalog module and SQL seed
data from the current game definitions. The catalog includes:

- class base stats and maximum-health rules;
- security-relevant item, enhancement, pet, specialization, and skill effects;
- active-skill costs, cooldowns, hits, multipliers, healing, shields, and
  supported status effects;
- canonical monster map, level, health range, attack range, rewards, patterns,
  elite/boss flags, and allowed encounters;
- level experience thresholds and death-loss rules.

The generated Edge module and database monster rows are checked together in
tests so a browser-only balance edit cannot silently change authoritative
combat.

## Persistent combat model

`player_combat_sessions_v3` stores at most one active PvE session per student.
It contains the canonical encounter, player and monster combat health, shields,
statuses, cooldowns, turn number, player revision at start, session revision,
status, timestamps, and the current safe question payload.

`player_combat_question_secrets_v3` stores the corresponding answer key and
source metadata. It is readable only by the service role. The answer key never
appears in a browser-readable table, realtime payload, log, audit detail, or
normal Edge response.

Question totals and correct counts are stored in a bounded per-player row.
Wrong-answer history stores only the last 30 normalized entries per player and
is not used as an authority source.

## Question privacy

At final cutover, authenticated students lose direct `select` access to the
`workbooks` shared-state row. Teachers retain their existing administration
policy. Students continue to read public classroom settings, but obtain one
safe question at a time from the combat Edge Function.

The browser receives prompt, choices, subject, and a server-created opaque
question token. A correct answer response never needs to reveal the key. A
wrong answer response includes the correct answer only in that response so the
existing interface can display it in green for at least two seconds.

Because the current legacy combat still reads workbooks, the permission change,
Edge deployment, web deployment, and flag activation must occur together
during a no-class maintenance window. This phase prepares the code but does not
perform that rollout.

## Combat lifecycle

### Start

The browser requests a canonical monster key. The database locks the player's
core row, rejects an existing incompatible session, validates the player's
authoritative current map and encounter eligibility, derives total combat
stats from normalized player rows and immutable catalogs, rolls canonical
monster values, selects an enabled workbook question, creates the private
secret and safe session, and returns the safe initial state.

Reconnecting to an active compatible session returns that session instead of
creating a second fight. A stale abandoned session can be recovered using a
bounded server timeout without awarding a victory.

### Submit a turn

The browser submits the opaque question token, selected action, answer text,
expected session revision, and request ID. A private prepare function returns
the locked snapshot and answer key to the trusted Edge service. The pure engine
grades the answer, owns all miss/critical/damage/status/random decisions,
applies the action and monster response in the existing order, advances
cooldowns and statuses, and emits semantic presentation events.

The commit function accepts only service-role calls, validates strict outcome
bounds and the expected player/session revisions, writes the resulting combat
state and statistics atomically, stores the replay receipt, and returns a safe
response. A concurrent or repeated submission cannot apply twice.

If combat continues, the commit creates the next secret question and returns
its safe payload in the same response. This avoids a separate network request.

### Victory, defeat, and surrender

Victory rewards are read from the canonical monster catalog. The server applies
experience, level changes, gold, and the existing building-drop chance and
roll. The response emits rewards in experience, gold, then building order so
the browser can retain the current staged presentation.

Defeat sets authoritative health and applies the existing no-experience-loss
protection before level-5 specialization. Surrender ends the session without a
victory reward and uses the same safe return-to-world path. All terminal paths
clear private question secrets and leave no resumable active fight.

## Rules and compatibility

The initial engine matches the current effective PvE rules rather than
rebalance them. It includes the current 10% base player miss chance,
wrong-answer half damage, critical rules, shields, healing, supported active
skills, learned passives, equipment/enhancement/pet bonuses, monster
techniques, boss exceptions, cooldowns, and status durations.

Unsupported or malformed action identifiers are rejected; they never fall back
to a client calculation. Boss-map music and all animation, shake, sound,
floating-number, wrong-answer delay, and reward-card timing remain local
presentation driven by sanitized server events.

## Edge API

One `student-combat-v3` Edge Function exposes bounded actions:

- `start`
- `submit_turn`
- `surrender`
- `resume`

Each request has a short validated request ID. Responses use stable error codes
and include only safe session state, presentation events, the next safe
question when applicable, and the latest authoritative player snapshot when
the player row changes. Arbitrary client text is not copied into logs or error
messages.

There is no combat polling. A normal fight uses one invocation to start and one
per answered turn. Movement, animations, multiplayer positions, chat, and
ordinary map frames cause no Edge calls.

## Client integration

The existing v3 flag selects the new path at the final effective combat entry,
answer-submit, reconnect, and surrender handlers. While the flag is off,
legacy behavior remains available for local development.

When enabled, the browser treats its combat object as a presentation
projection. It waits for the server, applies the returned safe state, and plays
events sequentially. It cannot optimistically change health, cooldowns,
question statistics, currency, experience, level, inventory, or rewards.

Student login skips workbook download when v3 is enabled. Map transitions that
affect encounter validation update the existing authoritative map field through
the bounded player-state path; realtime position broadcasts remain unchanged.

## Failure and recovery

Network failure leaves the last acknowledged state unchanged and offers retry.
The same request ID returns the stored result. A revision conflict fetches or
resumes the authoritative session before another action is allowed. Buttons
are disabled while a request is pending. Invalid tokens, expired sessions,
missing questions, catalog mismatches, and impossible engine outcomes fail
closed without rewards.

## Testing

- Generator tests pin catalog counts and representative player, skill,
  monster, reward, and balance rules.
- Pure engine tests inject deterministic random values and cover correct,
  wrong, miss, critical, shield, healing, cooldown, status, victory, defeat,
  surrender, and reward outcomes.
- Migration contract tests cover private tables, grants, workbook privacy,
  service-only functions, locks, revisions, receipts, strict bounds, question
  secrecy, and terminal cleanup.
- Edge service tests use mocked stores and prove identity derivation, no answer
  leak, idempotency, sanitized errors, and safe response shapes.
- Browser wiring tests prove the enabled path performs no protected local
  mutation before a server response and preserves legacy behavior when off.
- The full existing regression suite remains green.

## Rollout boundary

This implementation does not apply Supabase migrations, deploy Edge Functions,
push GitHub, deploy Vercel, or enable the v3 flag. A later explicit rollout
must deploy all compatible pieces together, run live database smoke tests,
verify student answer privacy, and retain a rollback window.
