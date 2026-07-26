# Server-Authoritative Economy, Equipment, and Skills Design

## Goal

Move every non-combat student action that changes gold, building currency,
owned gear, costume ownership, equipped items, weapon enhancement,
specialization, or learned skills behind revision-bound Supabase RPCs.
The Phase 1 cutover flag remains disabled until later phases are complete.

## Approaches considered

1. One generic `perform_action` RPC: compact, but difficult to audit and easy
   to grow into an unsafe collection of loosely validated payloads.
2. Separate bounded RPCs backed by server catalogs: more functions, but each
   payload and mutation is narrow and independently testable. This is selected.
3. Edge Functions for every action: flexible, but adds avoidable invocations
   and latency for transactional database work.

## Architecture

Add immutable server catalog tables for items and skills. A deterministic
generator reads the existing game-data and costume-data modules and emits the
catalog seed SQL, so browser display data and server validation cannot drift
silently. Catalog rows contain only security-relevant fields: identifier,
currency and price, slot, class and level requirements, costume/quest flags,
maximum skill rank, specialization, unlock level, cost, and prerequisites.

Expose these authenticated, `security definer`, locked-search-path RPCs:

- `purchase_student_item_v3`
- `equip_student_item_v3`
- `unequip_student_slot_v3`
- `enhance_student_weapon_v3`
- `choose_student_specialization_v3`
- `learn_student_skill_v3`

Every mutation derives the student from `auth.uid()`, validates a text request
ID inside the function, serializes replay handling through the Phase 1 receipt
lock, checks `expected_revision`, performs all related writes in one database
transaction, increments the revision once, and returns the full authoritative
snapshot. Rejections return stable codes and security-relevant rejections are
logged without storing arbitrary client text.

## Inventory model

`player_inventory_v3` gains `inventory_kind` with `gear` and `costume` values.
The old cross-kind equipped-slot uniqueness is replaced by uniqueness per
student, kind, and slot. Gear purchases are unique per definition and consume
gold or building currency according to the server catalog. Costumes consume
gold, have no gameplay stats, and use the costume equipment layer.

Starter and quest-only items cannot be purchased. Class and level restrictions
are enforced for purchases and gear equips. A student may equip only an owned
instance. Unequip affects only the requested kind and slot.

## Enhancement

Only the currently equipped weapon can be enhanced. Each attempt costs exactly
3 building currency. The server reads the current tier, uses the existing
success chances (80%, 60%, 40%, 20%), rolls with PostgreSQL `random()`, raises
the tier on success, and lowers it by one on failure without going below zero.
The response includes a presentation-only outcome object; the inventory row is
the source of truth.

## Specialization and skills

Specialization is chosen once at level 5 or later from the two server-defined
options for the student's class. Skill learning validates class,
specialization, unlock level, maximum rank, prerequisite ranks, and available
points. Available points are derived on the server from level and already spent
points; the browser cannot submit or store a skill-point balance.

## Client integration

Extend the Phase 1 authority adapter with one method per RPC. When the v3 flag
is on, existing shop, equipment, enhancement, specialization, costume, and
skill UI handlers await the server result, replace the local authoritative
projection, and then play their existing animation or notification. They never
subtract currency or add ownership before the response. With the flag off,
current behavior remains byte-for-byte compatible.

## Errors and recovery

Network failure leaves local authoritative values unchanged. A revision
conflict replaces the local projection with the returned current snapshot and
asks the student to retry. Replayed request IDs return the original result;
cross-action reuse returns `REQUEST_ID_REUSED` before mutation. Enhancement
animation cannot trigger a second request while one is pending.

## Testing and rollout

- Generator tests pin the catalog counts and important representative rows.
- Migration contract tests verify grants, catalogs, bounds, receipt locking,
  revision checks, and rejection paths.
- Adapter tests verify exact payloads and sanitized failures.
- Executable flag-on handler tests prove no optimistic currency or ownership
  mutation occurs and returned snapshots are applied.
- Existing full regression suite must remain green.

No production migration, GitHub push, Vercel deployment, or cutover flag change
is included. Runtime PostgreSQL integration remains a required deployment
check because this workstation has no local PostgreSQL/Supabase runtime.
