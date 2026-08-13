# Combat Frame Pipeline Implementation Plan

> **For agentic workers:** Execute inline in the authoritative workspace. Do not use Git reset or checkout; use the documented ZIP/SHA-256 checkpoints.

**Goal:** Replace five nested combat-frame render wrappers with one tested, ordered post-render boundary while preserving the final browser DOM.

**Architecture:** A pure browser-global module owns deterministic after-hook ordering. `game.js` retains the base renderer and all DOM/game-specific patch handlers.

**Tech Stack:** Browser JavaScript, Node test runner, jsdom browser-smoke harness, PowerShell baseline runner.

## Global Constraints

- Preserve final combat DOM and message escaping exactly.
- Do not modify combat entry, turn sequencing, HP state, canvas timing, or save data.
- Do not add dependencies.
- Use `apply_patch` for text edits and ZIP/SHA-256 for recovery.

---

### Task 1: Freeze existing behavior

**Files:**
- Create: `tools/browser-smoke/try_combat_frame.js`
- Create: `tests/combat-frame-pipeline.test.mjs`

**Interfaces:**
- Consumes: the current production script chain and `renderCombatFrame(message, contentHtml)`.
- Produces: repeatable assertions for final DOM plus the desired pipeline API.

- [ ] Capture one live combat frame containing HP loss, damage, healing, shield, markup-like text, and caller content.
- [ ] Assert V25 span ownership, escaping, rollback class, removed temporary classes, and safe missing-target behavior.
- [ ] Write pure module tests and a production-boundary test.
- [ ] Run `node --test tests/combat-frame-pipeline.test.mjs` and confirm the browser capture passes while missing-module/boundary assertions fail.

### Task 2: Implement the boundary

**Files:**
- Create: `src/combat-frame-pipeline.js`
- Modify: `index.html`
- Modify: `game.js`

**Interfaces:**
- Consumes: `create({ render(context) })` and registrations shaped as `{ id, priority, after(context) }`.
- Produces: `combatFramePipeline.render({ message, contentHtml })` and one public `renderCombatFrame` delegate.

- [ ] Implement ascending, stable after-hook execution with duplicate-ID validation and unregister support.
- [ ] Load the module before `game.js`.
- [ ] Rename the base renderer and add the single delegate.
- [ ] Convert V20/V23/V25/V26/V27 bodies to registrations with priorities 200/230/250/260/270.
- [ ] Run syntax and the focused test until all assertions pass.

### Task 3: Integrate verification and recovery

**Files:**
- Modify: `package.json`
- Modify: `tools/run-baseline.ps1`
- Create: `docs/audits/2026-07-16-combat-frame-pipeline-result.md`
- Modify: `docs/archive/handoffs/HANDOFF-2026-07-16.md`
- Create: `backups/2026-07-16-pre-combat-frame-pipeline.zip`
- Create: `backups/2026-07-16-post-combat-frame-pipeline.zip`

**Interfaces:**
- Produces: `npm.cmd run test:combat-frame-pipeline` and inclusion in the default test gate.

- [ ] Add module syntax and focused tests to the baseline runner and package scripts.
- [ ] Run combat-frame, combat-entry, combat-flow, combat-FX, and safety-net suites.
- [ ] Run the complete default gate and require zero failures.
- [ ] Record hashes, remaining versioned assignments, recovery points, and the next isolated candidate.
- [ ] Verify the post ZIP hash matches its manifest and contains the expected files.
