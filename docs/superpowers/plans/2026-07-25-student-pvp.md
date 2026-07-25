# Student PvP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add secure, town-only student-versus-student battles with profile challenges, simultaneous 20-second questions, per-round 30-sided initiative dice, server-owned win/loss records, surrender, and 30-second reconnect protection.

**Architecture:** Supabase stores invitations, matches, private round inputs, public match events, presence, and immutable PvP records. A JWT-verified Edge Function is the only writer and uses a pure shared resolver; browser modules handle safe API calls, Realtime state, profile UI, portrait rendering, and animation without deciding authoritative outcomes.

**Tech Stack:** Browser JavaScript, Supabase Postgres/RLS/Realtime, Supabase Edge Functions with Deno and `@supabase/supabase-js@2.110.8`, Node.js test runner, Canvas 2D

## Global Constraints

- PvP challenge and acceptance are allowed only while both students are online in the 마을 map (`town`).
- Preserve current character level, class, specialization, equipment, learned skills, and passive effects.
- Use separate maximum PvP HP; never mutate world HP, EXP, gold, building currency, items, inventory, costume inventory, or quests.
- Returning from PvP restores the 원래 월드 상태 because PvP state is stored separately.
- Every round gives both players the same enabled-workbook question and the same 20-second server deadline.
- Early submission reveals no answer result until both submit or the deadline passes.
- Wrong and timed-out answers apply 50% of the selected action's normal numeric effect.
- Roll independent values from 1 through 30 after submissions; 동률이면 both dice reroll.
- 선공 attack defeating the opponent cancels the second action.
- PvP uses surrender in the existing escape-button position.
- One missing player has a 30초 reconnect grace; both missing players are later cancelled without records.
- Only final wins and losses are publicly visible; direct client record mutation is forbidden.
- No rewards, ranking, matchmaking, level normalization, spectating, teams, seasons, or PvP item loss.

---

### Task 1: Authoritative PvP Rule Resolver

**Files:**
- Create: `tools/build-pvp-catalog.mjs`
- Create: `supabase/functions/_shared/pvp-catalog.mjs`
- Create: `supabase/functions/_shared/pvp-rules.mjs`
- Create: `tests/pvp-rules.test.mjs`

**Interfaces:**
- Produces:
  - `normalizeSnapshot(raw): PlayerSnapshot`
  - `selectQuestion(workbooks, randomInt): PublicQuestion & { answer:string }`
  - `judgeAnswer(question, submittedAnswer): boolean`
  - `rollInitiative(randomInt): { rolls:Array<{ a:number,b:number }>, first:'a'|'b' }`
  - `resolveRound({ match, a, b, question, randomInt }): RoundResolution`
- `PlayerSnapshot` contains only bounded `userId`, `name`, `level`, `className`, `spec`, `maxHp`, `attack`, `defense`, `skills`, `skillRanks`, `cooldowns`, `statuses`, and PvP temporary `hp`/`shield`.
- `RoundResolution` contains a new immutable state plus ordered public events; it contains no submitted answers.
- `pvp-catalog.mjs` exports the exact current `V24_SKILLS` fields required for active and passive PvP behavior.

- [ ] **Step 1: Write failing deterministic rule tests**

Create `tests/pvp-rules.test.mjs` and assert:

```js
assert.deepEqual(rules.rollInitiative(sequence([29, 29, 4, 18])), {
  rolls:[{ a:29, b:29 }, { a:4, b:18 }],
  first:'b',
});
```

Run `node tools/build-pvp-catalog.mjs --check` in the test and require byte-for-byte agreement
between the committed catalog and the catalog generated from `src/game-data.js`. Add table-driven
tests for all active effect types present in `V24_SKILLS`:

```js
const activeTypes = [
  'damage', 'shield', 'shieldBash', 'charge', 'buff',
  'healAllies', 'damageHeal', 'shadowDot',
];
```

Test normal and wrong-answer scaling, multi-hit sequencing, shield absorption, shield bypass, healing clamp, cooldown rejection, stun, chill, shadow stacks, charge, resurrection once per match, critical damage, miss, reflect, execution thresholds, regeneration, and first-strike KO cancellation. Use an injected integer sequence so every random branch is deterministic.

- [ ] **Step 2: Run rule tests and verify failure**

```powershell
node --test tests/pvp-rules.test.mjs
```

Expected: FAIL because the shared rule module does not exist.

- [ ] **Step 3: Generate the canonical current skill catalog**

`tools/build-pvp-catalog.mjs` loads `src/core-utils.js` and `src/game-data.js` in a VM, reads
`window.YuksamData.V24_SKILLS`, keeps only these combat fields, sorts every object key, and writes
a deterministic ES module:

```js
const COMBAT_FIELDS = [
  'id','classOnly','specOnly','active','guardShieldPct','armorBonusPct',
  'cleanseChance','reviveHealPct','reviveCooldown','reflectPct','doubleAttackPct',
  'executeHp','activeStunChance','critChanceBonus','critDmgBonus',
  'monsterMissChance','healBoost','shadowLifestealChance','shadowCritChance',
];
```

The output format is:

```js
export const PVP_SKILLS = Object.freeze(/* deterministic generated object */);
```

`--check` compares generated bytes to the existing file and exits `1` without writing when stale.

- [ ] **Step 4: Implement bounded snapshots and question selection**

Use these hard bounds:

```js
const LIMITS = Object.freeze({
  level:[1, 100],
  maxHp:[1, 100000],
  attack:[1, 10000],
  defense:[0, 10000],
  skillRank:[0, 5],
});
```

Accept only classes `warrior`, `mage`, `priest`; accept only the current specialization names for that class.
Drop skill IDs absent from `PVP_SKILLS`, clamp their ranks to the catalog's `maxPoints`, and drop all
unknown fields. `selectQuestion` flattens only `enabled === true` workbooks with non-empty questions,
chooses by injected integer, and returns `null` when none exist.

- [ ] **Step 5: Implement action catalog and round resolution**

Define one handler for each active type listed in Step 1. Every handler returns typed effects instead of mutating input:

```js
{
  kind:'damage'|'heal'|'shield'|'status'|'cooldown',
  source:'a'|'b',
  target:'a'|'b',
  amount:number,
  critical?:boolean,
  status?:string,
  turns?:number,
}
```

Resolve every passive field retained by `COMBAT_FIELDS` for both players, validate each selected skill
is learned and off cooldown, substitute `basic` for missing/invalid actions, apply answer factor `1`
or `0.5`, roll initiative, apply first action, stop on defeat, otherwise apply second action, then
decrement statuses/cooldowns. Return event IDs formatted `${matchId}:${round}:${index}`. The test must
iterate all retained catalog fields and fail if any field has no resolver coverage entry.

- [ ] **Step 6: Run and commit**

```powershell
node --test tests/pvp-rules.test.mjs
git add -- tools/build-pvp-catalog.mjs supabase/functions/_shared/pvp-catalog.mjs supabase/functions/_shared/pvp-rules.mjs tests/pvp-rules.test.mjs
git commit -m "feat: add authoritative pvp round rules"
```

Expected: The focused suite exits `0`.

### Task 2: PvP Database, RLS, and Atomic Record Finalization

**Files:**
- Create: `supabase/migrations/202607250001_student_pvp_v1.sql`
- Create: `tests/pvp-policy-v1.test.mjs`

**Interfaces:**
- Produces tables:
  - `public.pvp_records_v1`
  - `public.pvp_presence_v1`
  - `public.pvp_invites_v1`
  - `public.pvp_matches_v1`
  - `public.pvp_round_inputs_v1`
  - `public.pvp_match_events_v1`
- Produces `public.finish_pvp_match_v1(match_id uuid, winner_id uuid, loser_id uuid, reason text)`.

- [ ] **Step 1: Write failing migration policy tests**

Assert the migration:

```js
for (const table of [
  'pvp_records_v1','pvp_presence_v1','pvp_invites_v1',
  'pvp_matches_v1','pvp_round_inputs_v1','pvp_match_events_v1',
]) {
  assert.match(sql, new RegExp(`alter table public\\\\.${table} enable row level security`, 'i'));
  assert.match(sql, new RegExp(`alter table public\\\\.${table} force row level security`, 'i'));
}
assert.match(sql, /revoke all on table public\.pvp_round_inputs_v1 from anon, authenticated/i);
assert.doesNotMatch(sql, /grant\s+(?:insert|update|delete)[^;]*pvp_records_v1[^;]*authenticated/i);
assert.match(sql, /unique\s*\(\s*match_id\s*,\s*round_no\s*,\s*user_id\s*\)/i);
```

Also require participant-only match/event reads, target-only invite reads, public authenticated record reads, check constraints for 20-second invites and terminal states, and one `finished_at is null` guard in the finalization function.

- [ ] **Step 2: Run and verify failure**

```powershell
node --test tests/pvp-policy-v1.test.mjs
```

Expected: FAIL because the migration is absent.

- [ ] **Step 3: Create the additive schema**

Use UUID primary keys from `extensions.gen_random_uuid()`, Auth foreign keys with `on delete cascade`, `jsonb` snapshots/state, `timestamptz` server deadlines, and constraints:

```sql
status text not null check (status in ('pending','accepted','declined','expired','cancelled'))
```

```sql
phase text not null check (phase in ('question','waiting','dice','effects','reconnect','finished','cancelled'))
```

Add partial unique indexes so one user cannot have two live invitations or matches. Add `(match_id, sequence_no)` uniqueness for events and `(match_id, round_no, user_id)` for private inputs.

- [ ] **Step 4: Add strict grants, participant reads, and finish function**

Revoke all table access first. Grant:

- Authenticated `SELECT` on `pvp_records_v1`.
- Authenticated `SELECT` on invites only when `auth.uid()` is challenger or target.
- Authenticated `SELECT` on matches/events only when `auth.uid()` is participant.
- No direct authenticated write grant to records, matches, inputs, or events.

`finish_pvp_match_v1` must be `security definer`, `set search_path = ''`, callable only by `service_role`, lock the match `for update`, return without changes if already terminal, update both records with one `insert ... on conflict ... do update`, and mark one final result.

- [ ] **Step 5: Run and commit**

```powershell
node --test tests/pvp-policy-v1.test.mjs
git add -- supabase/migrations/202607250001_student_pvp_v1.sql tests/pvp-policy-v1.test.mjs
git commit -m "feat: secure pvp match storage"
```

### Task 3: JWT-Verified PvP Edge Function

**Files:**
- Create: `supabase/functions/pvp-match-v1/index.ts`
- Create: `supabase/functions/pvp-match-v1/deno.json`
- Create: `supabase/functions/_shared/pvp-service.mjs`
- Modify: `supabase/config.toml`
- Create: `tests/pvp-function-v1.test.mjs`

**Interfaces:**
- Consumes: Task 1 rules and Task 2 tables/function.
- Produces operations through one request body:
  - `{ op:'presence', map, busy, publicProfile }`
  - `{ op:'profile', userId }`
  - `{ op:'invite', targetUserId, requestId }`
  - `{ op:'respond', inviteId, accept, requestId }`
  - `{ op:'submit', matchId, round, actionId, answer, requestId }`
  - `{ op:'sync', matchId }`
  - `{ op:'heartbeat', matchId }`
  - `{ op:'surrender', matchId, requestId }`
  - `{ op:'cleanup' }`

- [ ] **Step 1: Write failing authorization and lifecycle tests**

Statically require pinned `npm:@supabase/supabase-js@2.110.8`, `auth.getUser()`, no user ID accepted as caller, service key read only from `Deno.env`, safe CORS, `POST` only, and `verify_jwt = true`.

Unit-test `createPvpService({ store, now, randomInt })` with a fake store for:

- town/busy/offline invitation rejection
- duplicate request ID replay
- target-only acceptance
- no-workbook cancellation
- same question for both
- early submit returning only `waiting:true`
- deadline submission as wrong/default basic
- dice and ordered events
- surrender and disconnect finalization once
- both-disconnected cancellation without records

- [ ] **Step 2: Run and verify failure**

```powershell
node --test tests/pvp-function-v1.test.mjs
```

Expected: FAIL because the function and service do not exist.

- [ ] **Step 3: Implement the pure service state machine**

`createPvpService` must receive an explicit storage boundary with methods:

```js
getPresence, upsertPresence, getPublicProfile,
createInvite, getInviteForUpdate, updateInvite,
createMatch, getMatchForUpdate, updateMatch,
insertRoundInputOnce, listRoundInputs,
appendEvents, listEventsAfter,
readEnabledWorkbooks, finishMatchOnce, cancelMatch,
findActiveMatchForUser, cleanupStale
```

Use `now()` for every deadline. Do not accept client timestamps, dice, damage, HP, records, question answer, or opponent identity as authoritative values.

- [ ] **Step 4: Implement the thin Edge wrapper**

The Edge function:

1. Rejects non-POST requests except CORS `OPTIONS`.
2. Reads the bearer header.
3. Creates caller and service clients with `persistSession:false`.
4. Calls `callerClient.auth.getUser()`.
5. Passes `callerData.user.id` and a validated body to the service.
6. Maps known codes to safe Korean client codes without logging tokens, answers, IDs, or service keys.

Add:

```toml
[functions.pvp-match-v1]
verify_jwt = true
```

- [ ] **Step 5: Run and commit**

```powershell
node --test tests/pvp-function-v1.test.mjs tests/pvp-policy-v1.test.mjs tests/pvp-rules.test.mjs
git add -- supabase/functions/pvp-match-v1 supabase/functions/_shared/pvp-service.mjs supabase/config.toml tests/pvp-function-v1.test.mjs
git commit -m "feat: add secure pvp match endpoint"
```

### Task 4: Authenticated Browser PvP Client

**Files:**
- Create: `src/pvp-client.js`
- Modify: `src/student-access-v2.js`
- Modify: `game.js`
- Modify: `index.html`
- Create: `tests/pvp-client.test.mjs`
- Modify: `tools/run-baseline.ps1`
- Modify: `package.json`

**Interfaces:**
- `secureStudentAccess.getIdentity(): { userId, displayName, role } | null`
- `secureStudentAccess.getClient(): SupabaseClient | null`
- `YuksamPvpClient.create({ client, getIdentity }): PvpClient`
- `window.getPvpClientV1(): PvpClient | null`
- `window.getPvpIdentityV1(): { userId, displayName, role } | null`
- PvpClient methods mirror Task 3 operations and add:
  - `subscribe(matchId, listener): unsubscribe`
  - `onInvite(listener): unsubscribe`

- [ ] **Step 1: Write failing client and access-boundary tests**

Assert `getIdentity` returns a frozen copy and `getClient` returns the already-created client only while configured. Test that the client invokes only `pvp-match-v1`, sends no caller ID or record values, maps server codes to Korean messages, deduplicates event sequence numbers, and removes Realtime channels on unsubscribe/signout.

- [ ] **Step 2: Run and verify failure**

```powershell
node --test tests/pvp-client.test.mjs tests/student-access-v2.test.mjs
```

Expected: FAIL because the methods and module do not exist.

- [ ] **Step 3: Expose the authenticated boundary**

Add to the ready controller:

```js
getIdentity:() => currentIdentity ? Object.freeze({ ...currentIdentity }) : null,
getClient:() => currentIdentity ? client : null,
```

Add returning `null` versions to `closedController`. Do not expose sessions, passwords, access tokens, refresh tokens, or Auth mutation methods.

- [ ] **Step 4: Implement the client**

Each method calls:

```js
const { data, error } = await client.functions.invoke('pvp-match-v1', { body });
```

Reject if `getIdentity()` is null. Subscribe only to participant-visible invite/match/event rows. Track `lastSequence` per match and pass only newer events to listeners.

- [ ] **Step 5: Add a lazy game adapter**

After creating `secureStudentAccess` in `game.js`, add:

```js
let pvpClientV1 = null;
window.getPvpIdentityV1 = () => secureStudentAccess.getIdentity();
window.getPvpClientV1 = () => {
  const client = secureStudentAccess.getClient();
  const identity = secureStudentAccess.getIdentity();
  if (!client || !identity) return null;
  if (!pvpClientV1) {
    pvpClientV1 = YuksamPvpClient.create({
      client,
      getIdentity:() => secureStudentAccess.getIdentity(),
    });
  }
  return pvpClientV1;
};
```

Clear `pvpClientV1` after signout. This adapter exposes no Supabase token or Auth mutation method.

- [ ] **Step 6: Load, register, test, and commit**

Load `src/pvp-client.js` after `src/student-access-v2.js` and before `game.js`. Add syntax and test runner entries.
Add this exact package script:

```json
"test:pvp-client": "powershell -NoProfile -ExecutionPolicy Bypass -File tools/run-baseline.ps1 pvp-client"
```

```powershell
npm.cmd run test:pvp-client
npm.cmd run test:student-access-v2
npm.cmd run test:baseline
git add -- src/pvp-client.js src/student-access-v2.js game.js index.html tests/pvp-client.test.mjs tests/student-access-v2.test.mjs tools/run-baseline.ps1 package.json
git commit -m "feat: add authenticated pvp browser client"
```

### Task 5: Multiplayer Identity, Profile, Portrait, and Challenge UI

**Files:**
- Modify: `src/multiplayer.js`
- Create: `src/pvp-ui.js`
- Modify: `index.html`
- Modify: `style.css`
- Modify: `tests/multiplayer.test.mjs`
- Create: `tests/pvp-profile-ui.test.mjs`

**Interfaces:**
- Remote broadcast adds `userId`, `pvpAvailable`, and `costume`.
- Produces:
  - `window.openRemoteProfileV1(userId): Promise<void>`
  - `window.renderRemotePortraitV1(canvas, profile): void`
  - `window.respondPvpInviteV1(inviteId, accept): Promise<void>`

- [ ] **Step 1: Write failing broadcast, hit-test, and profile tests**

Extend the two-session multiplayer test to require a stable internal `userId`, safe costume object, and availability flag. In a browser test, right-click the rendered bounds of one same-map remote and assert the modal contains face canvas, name, level, class/spec, wins/losses, and challenge button. Assert background right-click is not prevented and no private profile data appears.

- [ ] **Step 2: Run and verify failure**

```powershell
node --test tests/multiplayer.test.mjs tests/pvp-profile-ui.test.mjs
```

Expected: FAIL because the remote payload and UI do not exist.

- [ ] **Step 3: Extend safe presence and remote hit boxes**

Broadcast:

```js
userId:window.getPvpIdentityV1?.()?.userId,
pvpAvailable:G.currentMap === 'town' && !G.modalState?.pause && !G.currentCombatMonsterId,
costume:G.player.costume || {},
```

Store the last rendered screen-space bounds for same-map remotes. On canvas `contextmenu`, select the closest bound containing the pointer, call `preventDefault()` only for that target, and open its profile.

- [ ] **Step 4: Render the safe profile and actual face**

Create a `180x180` profile canvas. Clip to a circle, call the existing player sprite renderer at an enlarged scale and translated position so the head/face fills the frame, and pass resolved equipment plus costume. Render only:

```js
{ userId, name, level, className, spec, appearance, equipment, costume, wins, losses, pvpAvailable }
```

Disable the button with a Korean reason when not in town, busy, offline, self, or server-closed.

- [ ] **Step 5: Add invitation modal**

Incoming invite modal shows challenger portrait/name, `수락`, `거절`, and a server-deadline countdown. Repeated Realtime delivery reuses one modal keyed by invite ID. Expiry closes without records.

- [ ] **Step 6: Run and commit**

```powershell
node --test tests/multiplayer.test.mjs tests/pvp-profile-ui.test.mjs
git add -- src/multiplayer.js src/pvp-ui.js index.html style.css tests/multiplayer.test.mjs tests/pvp-profile-ui.test.mjs
git commit -m "feat: add pvp profiles and challenges"
```

### Task 6: PvP Battle Screen, Dice, Effects, and Surrender

**Files:**
- Create: `src/pvp-battle.js`
- Modify: `index.html`
- Modify: `style.css`
- Modify: `game.js`
- Create: `tests/pvp-battle-ui.test.mjs`

**Interfaces:**
- Produces:
  - `window.enterPvpMatchV1(match): void`
  - `window.submitPvpActionV1(actionId, answer): Promise<void>`
  - `window.surrenderPvpV1(): Promise<void>`
  - `window.restorePvpMatchV1(match): void`
  - `window.leavePvpScreenV1(result): void`

- [ ] **Step 1: Write failing two-browser battle tests**

With fake PvP clients, assert:

- both screens receive identical prompt and 20-second deadline
- early submit locks controls and shows the exact waiting copy
- no correctness is visible before resolution
- tie then reroll animation renders all roll pairs
- effects execute in server event order
- second action is absent after first-strike KO
- PvP button says `항복`; normal combat still says `도망`
- finish changes only displayed PvP records, never player resources or world HP

- [ ] **Step 2: Run and verify failure**

```powershell
node --test tests/pvp-battle-ui.test.mjs
```

Expected: FAIL because the battle controller is absent.

- [ ] **Step 3: Build the phase-driven controller**

Keep one state:

```js
{
  matchId, round, phase, deadline, me, opponent,
  question, submitted, eventsSeen, reconnectUntil,
}
```

Render `question`, `waiting`, `dice`, `effects`, `reconnect`, and `finished` phases. Use server deadline minus `Date.now()` only for display; the server remains authoritative.

- [ ] **Step 4: Reuse current combat presentation**

Map public PvP effects to the existing audio manifest, combat FX profiles, floating numbers, shake, shield-loss number, and block sound. Never call monster defeat rewards, quest progress, `addExp`, `addGold`, `addBuilding`, inventory changes, or `savePlayer` from PvP.

For initiative, show both 30-sided dice in the center for each roll pair, pause on the final numbers, announce `${name}님이 먼저 공격합니다!`, then consume ordered effects.

- [ ] **Step 5: Replace escape with confirmed surrender only in PvP**

The existing normal combat remains unchanged. PvP renders `항복`; click and Escape open:

```text
정말 항복할까요?
항복하면 내 기록에 1패, 상대 기록에 1승이 남습니다.
```

Only confirmation invokes `surrender`.

- [ ] **Step 6: Run and commit**

```powershell
node --test tests/pvp-battle-ui.test.mjs tests/combat-flow.test.mjs
git add -- src/pvp-battle.js index.html style.css game.js tests/pvp-battle-ui.test.mjs
git commit -m "feat: add simultaneous-question pvp battles"
```

### Task 7: Reconnect, First-Use PvP Tutorial, and Full Verification

**Files:**
- Modify: `src/pvp-battle.js`
- Modify: `src/pvp-ui.js`
- Modify: `src/tutorial.js`
- Modify: `tests/pvp-battle-ui.test.mjs`
- Create: `tests/pvp-reconnect-v1.test.mjs`
- Modify: `tools/run-baseline.ps1`
- Modify: `package.json`

**Interfaces:**
- Consumes all previous PvP interfaces.
- Produces local boolean `game.player.pvpTutorialSeen` and complete resume/cleanup behavior.

- [ ] **Step 1: Write failing reconnect and first-use tutorial tests**

Test:

- one disconnected participant sees a 30-second reconnect countdown
- reconnect restores round, HP, phase, and consumes only unseen event sequences
- 30-second expiry finalizes exactly one loss/win
- both disconnected cleanup creates no records
- server-closed cancellation creates no records and preserves world state
- first remote profile right-click shows tutorial once, then opens the requested profile
- highlighted phrases are exactly `오른쪽 클릭`, `대전 신청`, `20초`, `30면체 주사위`, `항복`

- [ ] **Step 2: Run and verify failure**

```powershell
node --test tests/pvp-reconnect-v1.test.mjs tests/pvp-battle-ui.test.mjs
```

Expected: FAIL on resume and tutorial behavior.

- [ ] **Step 3: Implement heartbeat and resume**

While in a match, send heartbeat every `5,000ms`; stop it on finish/signout. On load or reconnect, call `sync`, rebuild state, subscribe after the latest sequence, and show `상대의 재접속을 기다리고 있어요.` while appropriate. Never decide timeout locally; request `sync` when the displayed countdown reaches zero.

- [ ] **Step 4: Add the one-time PvP tutorial**

Before the first remote profile opens, render five short pages from the design. Use the same safe `tutorialGreenV1` helper for approved static phrases. Set and save `pvpTutorialSeen = true` only after the last page, then continue to the originally requested profile.

- [ ] **Step 5: Register all production scripts and tests**

Add syntax checks and runner modes for:

```text
pvp-rules
pvp-policy-v1
pvp-function-v1
pvp-client
pvp-profile-ui
pvp-battle-ui
pvp-reconnect-v1
```

Add matching `package.json` scripts. Ensure the baseline test sees every new `index.html` script in the syntax-check list.

```json
"test:pvp-rules": "powershell -NoProfile -ExecutionPolicy Bypass -File tools/run-baseline.ps1 pvp-rules",
"test:pvp-policy-v1": "powershell -NoProfile -ExecutionPolicy Bypass -File tools/run-baseline.ps1 pvp-policy-v1",
"test:pvp-function-v1": "powershell -NoProfile -ExecutionPolicy Bypass -File tools/run-baseline.ps1 pvp-function-v1",
"test:pvp-client": "powershell -NoProfile -ExecutionPolicy Bypass -File tools/run-baseline.ps1 pvp-client",
"test:pvp-profile-ui": "powershell -NoProfile -ExecutionPolicy Bypass -File tools/run-baseline.ps1 pvp-profile-ui",
"test:pvp-battle-ui": "powershell -NoProfile -ExecutionPolicy Bypass -File tools/run-baseline.ps1 pvp-battle-ui",
"test:pvp-reconnect-v1": "powershell -NoProfile -ExecutionPolicy Bypass -File tools/run-baseline.ps1 pvp-reconnect-v1"
```

- [ ] **Step 6: Run affected suites**

```powershell
node --test tests/pvp-rules.test.mjs tests/pvp-policy-v1.test.mjs tests/pvp-function-v1.test.mjs tests/pvp-client.test.mjs tests/multiplayer.test.mjs tests/pvp-profile-ui.test.mjs tests/pvp-battle-ui.test.mjs tests/pvp-reconnect-v1.test.mjs
npm.cmd run test:combat-flow
npm.cmd run test:secure-student-login-v2
npm.cmd run test:baseline
```

Expected: Every command exits `0`.

- [ ] **Step 7: Run complete verification**

```powershell
npm.cmd run check:syntax
npm.cmd test
git diff --check
git status --short
```

Expected: Syntax and complete suite exit `0`; no uncommitted implementation files remain after the final commit.

- [ ] **Step 8: Commit final integration**

```powershell
git add -- src/pvp-battle.js src/pvp-ui.js src/tutorial.js tests/pvp-battle-ui.test.mjs tests/pvp-reconnect-v1.test.mjs tools/run-baseline.ps1 package.json
git commit -m "test: verify pvp reconnect and tutorial flow"
```
