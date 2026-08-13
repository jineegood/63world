# Administrator Authorization Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Prevent direct calls to administrator globals from reading or mutating protected data before teacher authentication.

**Architecture:** Add one internal requireTeacherAuth() predicate beside the existing lexical authentication state. Every exported administrator function except adminTeacherLogin checks it before reading UI or data; authenticated behavior remains unchanged.

**Tech Stack:** Browser JavaScript, jsdom, Node test runner, PowerShell baseline runner.

## Global Constraints

- Do not change teacher password format, default password, login UI, player/workbook schemas, gameplay, balance, audio, or script order.
- Unauthenticated calls perform no player, workbook, or teacher-store mutation and route to the existing teacher login UI.
- Guard read-only administrator views as well as mutators.
- Observe RED before production changes.
- Git is unavailable; use checkpoint and hash evidence.

### Task 1: Checkpoint and RED

**Files:**
- Create: backups/2026-07-16-pre-admin-authorization.zip
- Create: backups/2026-07-16-pre-admin-authorization.sha256.txt
- Create: tools/browser-smoke/try_admin_authorization.js
- Modify: tests/safety-net.test.mjs

**Interfaces:**
- Consumes: direct administrator globals and real teacher login
- Produces: mutation snapshots before and after authentication

- [ ] Create and verify the scoped checkpoint.
- [ ] Seed a valid player and capture player, workbook, and teacher-store raw values.
- [ ] Directly call grantBuildingToStudent, adminToggleWorkbook, and adminSetServerOpen before authentication.
- [ ] Require every raw value to remain unchanged.
- [ ] Authenticate with the real default password 6363, repeat calls, and require intended mutations.
- [ ] Connect the smoke to safety-net.test.mjs and observe RED from unauthenticated mutation.

### Task 2: Add the Internal Guard

**Files:**
- Modify: src/admin-dashboard.js
- Modify: tools/browser-smoke/try_player_storage.js

**Interfaces:**
- Produces: requireTeacherAuth(): boolean
- Consumes: every window administrator function except adminTeacherLogin

- [ ] Add requireTeacherAuth() that returns true only for the lexical authenticated state; otherwise it opens teacher login and returns false.
- [ ] Replace openAdminPanel's inline check with the shared guard.
- [ ] Add an immediate authorization return as the first statement of every other exported administrator function.
- [ ] Update the storage smoke to authenticate through openTeacherLogin and adminTeacherLogin before administrator reward checks.
- [ ] Observe GREEN for authorization and storage smokes.

### Task 3: Verify and Record

**Files:**
- Create: docs/audits/2026-07-16-admin-authorization-result.md
- Modify: docs/archive/handoffs/HANDOFF-2026-07-16.md

**Interfaces:**
- Produces: RED-GREEN evidence, full test results, hashes, and next-package handoff

- [ ] Run syntax for every production script and focused smoke.
- [ ] Run authorization, storage, safety-net, and omitted unit suites.
- [ ] Run npm.cmd test with zero failures.
- [ ] Compare checkpoint scope and require admin-dashboard.js to be the only changed production module.
- [ ] Record evidence and leave audio, combat, input, world, CSS, and storage-write redesign separate.
