# Safe Workspace Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move non-Git backup and generated-output folders into one clearly named local-only folder without changing application files.

**Architecture:** Create a top-level `작업자료` container and move the existing `backups` and `outputs` directories beneath it with Korean display names. Keep all runtime, dependency, tracked development, and hidden tool-state directories in place, and exclude the container from Git.

**Tech Stack:** Windows PowerShell, Git, npm

## Global Constraints

- Move `backups` to `작업자료/백업`.
- Move `outputs` to `작업자료/작업결과`.
- Do not move or delete any Git-tracked file.
- Do not overwrite an existing destination.
- Keep `.codex_work`, `.superpowers`, `.agents`, and `node_modules` in place.
- Keep the old `backups/` and `outputs/` Git ignore rules as safeguards.

---

### Task 1: Move local-only folders and update Git exclusion

**Files:**
- Modify: `.gitignore`
- Move: `backups` → `작업자료/백업`
- Move: `outputs` → `작업자료/작업결과`

**Interfaces:**
- Consumes: Existing ignored `backups` and `outputs` directories.
- Produces: One ignored `작업자료` directory containing both collections.

- [ ] **Step 1: Record source counts and validate every path**

Run:

```powershell
$repo = (Resolve-Path '.').Path
$sources = @(
  (Join-Path $repo 'backups'),
  (Join-Path $repo 'outputs')
)
$destinations = @(
  (Join-Path $repo '작업자료\백업'),
  (Join-Path $repo '작업자료\작업결과')
)
$sources | ForEach-Object {
  if (-not (Test-Path -LiteralPath $_ -PathType Container)) {
    throw "Missing source: $_"
  }
  if (-not ([IO.Path]::GetFullPath($_)).StartsWith($repo + [IO.Path]::DirectorySeparatorChar)) {
    throw "Source outside repository: $_"
  }
}
$destinations | ForEach-Object {
  if (Test-Path -LiteralPath $_) {
    throw "Destination already exists: $_"
  }
  if (-not ([IO.Path]::GetFullPath($_)).StartsWith($repo + [IO.Path]::DirectorySeparatorChar)) {
    throw "Destination outside repository: $_"
  }
}
Get-ChildItem -LiteralPath $sources[0] -File -Recurse | Measure-Object
Get-ChildItem -LiteralPath $sources[1] -File -Recurse | Measure-Object
```

Expected: Both sources exist, both destinations do not exist, and the counts are 62 backup files and 69 output files.

- [ ] **Step 2: Add the local-only container to `.gitignore`**

Add this rule after the existing `outputs/` rule:

```gitignore
작업자료/
```

- [ ] **Step 3: Move the folders without deleting or overwriting**

Run:

```powershell
$repo = (Resolve-Path '.').Path
$container = Join-Path $repo '작업자료'
New-Item -ItemType Directory -Path $container | Out-Null
Move-Item -LiteralPath (Join-Path $repo 'backups') -Destination (Join-Path $container '백업')
Move-Item -LiteralPath (Join-Path $repo 'outputs') -Destination (Join-Path $container '작업결과')
```

Expected: `작업자료/백업` and `작업자료/작업결과` exist, while the two original paths no longer exist.

- [ ] **Step 4: Verify counts and Git behavior**

Run:

```powershell
(Get-ChildItem -LiteralPath '.\작업자료\백업' -File -Recurse | Measure-Object).Count
(Get-ChildItem -LiteralPath '.\작업자료\작업결과' -File -Recurse | Measure-Object).Count
git check-ignore -v -- '작업자료/백업' '작업자료/작업결과'
git status --short
```

Expected: Counts are 62 and 69; both destinations match the `작업자료/` ignore rule; Git reports only `.gitignore` and this plan document before commit.

- [ ] **Step 5: Run the full application test suite**

Run:

```powershell
npm.cmd test
```

Expected: Exit code 0 with the full test suite passing.

- [ ] **Step 6: Commit the tracked cleanup configuration**

Run:

```powershell
git add -- .gitignore docs/superpowers/plans/2026-07-24-safe-workspace-cleanup.md
git commit -m "chore: organize local workspace artifacts"
```

Expected: Commit succeeds. The moved `작업자료` contents remain local and do not appear in the commit.
