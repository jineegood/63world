# Default Gate Coverage Implementation Plan

**Goal:** Run every production script syntax check and both omitted unit suites through the default gate.

**Files:** `tests/baseline.test.mjs`, `tools/run-baseline.ps1`, `package.json`, handoff and audit docs.

- [ ] Add a failing baseline assertion for all 17 local scripts and both omitted test files.
- [ ] Observe RED.
- [ ] Extend runner modes and all-mode execution; add matching package scripts.
- [ ] Observe GREEN, run syntax, omitted suites, and full default gate.
- [ ] Record changed files and final pass count.
