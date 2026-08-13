# Workbook Boot Preservation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Preserve an exact present corrupt workbook storage value across the complete production boot script chain while retaining first-run, legacy-migration, and valid-workbook behavior.

**Architecture:** Add a backward-compatible pre-script hook to the shared jsdom harness so storage can be seeded before classic scripts execute. Introduce one workbook-storage classifier in game.js; normal reads still return normalized defaults for corrupt input, while the automatic swamp-workbook migration skips every write when the classifier reports corrupt.

**Tech Stack:** Browser JavaScript, jsdom, Node test runner, PowerShell baseline runner.

## Global Constraints

- Preserve exact corrupt and non-array workbook bytes; do not repair, delete, migrate, back up, or rewrite them automatically.
- Keep absent workbook initialization, legacy-question migration, valid workbook normalization, and missing swamp-workbook insertion unchanged.
- Do not change gameplay, balance, UI, copy, audio, combat, input, assets, spreadsheets, storage keys, or index.html script order.
- Use the production index.html script order in the failing and passing smoke.
- Observe RED before changing game.js.
- Run focused, safety-net, omitted-unit, and full default gates after implementation.
- Git is unavailable; use checkpoint archives, SHA-256 manifests, and a changed-file record instead of commits.

---

### Task 1: Create the Package Recovery Checkpoint

**Files:**
- Create: backups/2026-07-16-pre-workbook-boot-preservation.zip
- Create: backups/2026-07-16-pre-workbook-boot-preservation.sha256.txt

**Interfaces:**
- Consumes: current runtime source, tests, tools, package metadata, and documentation
- Produces: a verified recovery archive excluding generated caches, prior backups, outputs, and assets

- [ ] **Step 1: Build the scoped checkpoint**

Archive game.js, index.html, style.css, package.json, src, tests, tools, and docs.

Expected: the ZIP exists, is non-empty, and its entries can be listed.

- [ ] **Step 2: Write and verify SHA-256**

Write one manifest line in this shape:

~~~text
<UPPERCASE_SHA256>  2026-07-16-pre-workbook-boot-preservation.zip
~~~

Run Get-FileHash again and require an exact match.

### Task 2: Seed Storage Before Production Scripts

**Files:**
- Modify: tools/browser-smoke/harness.js
- Create: tools/browser-smoke/try_workbook_boot_preservation.js
- Modify: tests/safety-net.test.mjs

**Interfaces:**
- Consumes: run(root, actions, options)
- Produces: optional options.beforeLoad({ window }), invoked after browser stubs and before window.eval(combined)
- Preserves: all existing two-argument smoke callers

- [ ] **Step 1: Add the backward-compatible hook**

Change the harness signature and call the hook directly before script evaluation:

~~~js
module.exports = async function run(root, actions, options = {}) {
  // existing setup
  if (typeof options.beforeLoad === 'function') {
    await options.beforeLoad({ window });
  }
  window.eval(combined);
  // existing event dispatch and actions
};
~~~

- [ ] **Step 2: Create the focused smoke**

The smoke must:

1. call the shared harness with beforeLoad;
2. write the exact value {broken-json under ysb_workbooks_v3 before evaluation;
3. load the complete index.html script chain;
4. compare the post-boot raw value byte-for-byte;
5. require zero async errors;
6. print RESULT: PASS only when every assertion passes.

Core preload:

~~~js
const corruptRaw = '{broken-json';
run(root, actions, {
  beforeLoad({ window }) {
    window.localStorage.setItem('ysb_workbooks_v3', corruptRaw);
  },
});
~~~

- [ ] **Step 3: Connect it to the safety net**

Add:

~~~js
test('boot preserves exact corrupt workbook storage bytes', () => {
  const output = runSmoke('try_workbook_boot_preservation.js');
  assert.match(output, /RESULT: PASS/);
});
~~~

- [ ] **Step 4: Observe RED**

Run:

~~~powershell
node --test --test-name-pattern "boot preserves exact corrupt workbook storage bytes" tests/safety-net.test.mjs
~~~

Expected: FAIL because ensureSwampWorkbook calls saveWorkbooks during evaluation and replaces the corrupt raw value.

### Task 3: Classify Storage and Guard Boot Migration

**Files:**
- Modify: game.js near normalizeWorkbook and getWorkbooks
- Modify: game.js inside ensureSwampWorkbook
- Modify: tools/browser-smoke/try_workbook_boot_preservation.js

**Interfaces:**
- Produces: readWorkbookStorage() returning a status of absent, valid, or corrupt and normalized workbooks or null
- Consumes: readWorkbookStorage() from getWorkbooks() and ensureSwampWorkbook()
- Preserves: public getWorkbooks(): Array and saveWorkbooks(workbooks): void

- [ ] **Step 1: Add the classifier**

~~~js
function readWorkbookStorage() {
  const raw = localStorage.getItem(STORAGE.workbooks);
  if (raw === null) return { status: 'absent', workbooks: null };
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return { status: 'valid', workbooks: parsed.map(normalizeWorkbook) };
    }
  } catch {}
  return { status: 'corrupt', workbooks: null };
}
~~~

- [ ] **Step 2: Route getWorkbooks through the classifier**

~~~js
function getWorkbooks() {
  const stored = readWorkbookStorage();
  if (stored.status === 'valid') return stored.workbooks;
  if (stored.status === 'corrupt') return defaultWorkbooks.map(normalizeWorkbook);

  // retain the existing absent-key legacy migration and persistence
}
~~~

- [ ] **Step 3: Guard the automatic swamp migration**

At the start of ensureSwampWorkbook:

~~~js
const stored = readWorkbookStorage();
if (stored.status === 'corrupt') return;
const books = stored.status === 'valid' ? stored.workbooks : getWorkbooks();
~~~

Keep the existing swamp lookup, workbook data, and saveWorkbooks call unchanged.

- [ ] **Step 4: Observe GREEN**

Re-run the focused test.

Expected: PASS with exact corrupt bytes unchanged.

- [ ] **Step 5: Cover every required state**

Extend the focused smoke or run isolated child cases for:

- invalid JSON remains byte-for-byte unchanged through boot;
- valid non-array JSON remains byte-for-byte unchanged through boot;
- absent storage still persists defaults containing the swamp workbook;
- valid storage missing the swamp workbook still receives it;
- valid storage already containing it is not duplicated.

Use a fresh jsdom instance for each case.

- [ ] **Step 6: Preserve direct-read and legacy behavior**

Run try_player_storage.js and require its existing corrupt direct-read, non-array direct-read, legacy migration, and first-run initialization checks to pass.

### Task 4: Verify and Record Evidence

**Files:**
- Modify: docs/archive/handoffs/HANDOFF-2026-07-16.md
- Create: docs/audits/2026-07-16-workbook-boot-preservation-result.md

**Interfaces:**
- Consumes: the completed Package 1 change
- Produces: commands, outcomes, changed-file hashes, checkpoint hash, remaining risks, and next-package handoff

- [ ] **Step 1: Run syntax checks**

~~~powershell
node --check game.js
node --check tools/browser-smoke/harness.js
node --check tools/browser-smoke/try_workbook_boot_preservation.js
~~~

Expected: all exit 0.

- [ ] **Step 2: Run focused browser checks**

~~~powershell
node tools/browser-smoke/try_workbook_boot_preservation.js "C:\Users\fiost\Desktop\63world (1)\63world"
node tools/browser-smoke/try_player_storage.js "C:\Users\fiost\Desktop\63world (1)\63world"
~~~

Expected: both print RESULT: PASS.

- [ ] **Step 3: Run automated gates**

~~~powershell
node --test tests/safety-net.test.mjs
node --test tests/audio-manifest.test.mjs tests/weapon-tier.test.mjs
npm.cmd test
~~~

Expected: zero failures; safety net contains five passing tests, omitted suites contain nine passing tests, and the default gate retains all prior checks plus the new check.

- [ ] **Step 4: Record hashes and scope**

Record SHA-256 for every changed or created file. Confirm game.js is the only changed production runtime file and that index.html, style.css, src, data, assets, and spreadsheets are unchanged.

- [ ] **Step 5: Update handoff**

Mark only the boot-time corrupt-workbook defect complete. Keep corrupt-player handling as the next S1 package and keep administrator, audio, combat, input, world, CSS, data, and gameplay work separate.
