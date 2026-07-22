# Stability and Feature-Boundary Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the current build and produce a prioritized, evidence-based stability and feature-boundary audit without changing game behavior.

**Architecture:** Treat runtime files as immutable inputs. Generate a selective checkpoint archive, collect static and test evidence, and synthesize findings into one audit report that separates immediate bug fixes from later module extraction.

**Tech Stack:** PowerShell, Node.js test runner, ripgrep, browser-smoke tests, Markdown.

## Global Constraints

- Production code, game data, spreadsheets, and assets remain unchanged.
- Every finding must cite concrete files, functions, or tests.
- Refactoring recommendations must preserve behavior and proceed behind regression tests.
- This directory is not a Git repository; the checkpoint archive is the rollback mechanism.

---

### Task 1: Create and Verify Checkpoint

**Files:**
- Create: `backups/2026-07-15-pre-audit-checkpoint.zip`
- Create: `backups/2026-07-15-pre-audit-checkpoint.sha256.txt`

- [ ] Hash the principal runtime files before audit work.
- [ ] Archive `index.html`, `game.js`, `style.css`, `src`, `tests`, `tools`, `시트`, and package metadata.
- [ ] List the archive and verify its SHA-256 hash.

### Task 2: Collect Stability Evidence

**Files:**
- Read: `game.js`, `index.html`, `style.css`, `src/*.js`, `tests/*.mjs`, `tools/browser-smoke/*.js`

- [ ] Run `npm.cmd test` and record group totals and failures.
- [ ] Inventory `game.js` size, top-level declarations, versioned reassignments, and repeated handler names.
- [ ] Map loaded modules from `index.html` and compare them with responsibilities still embedded in `game.js`.
- [ ] Identify important user flows lacking runtime browser-smoke coverage.

### Task 3: Write Prioritized Audit

**Files:**
- Create: `docs/audits/2026-07-15-stability-and-boundary-audit.md`

- [ ] Rank concrete risks from S1 to S4 with evidence and likely failure modes.
- [ ] Define recommended module boundaries and dependencies.
- [ ] Propose a staged order: stabilize critical flows, add missing tests, then extract one boundary at a time.
- [ ] Recompute runtime hashes and confirm no production files changed.
