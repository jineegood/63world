# Visual Workspace Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the project look tidy in Windows File Explorer without duplicating, deleting, or restructuring the active project.

**Architecture:** Move only obsolete reconnect backups from the parent directory into one archive folder. Preserve every active project path and apply the Windows Hidden attribute to technical items so Git, npm, Codex, and Vercel continue using the same files.

**Tech Stack:** Windows PowerShell, NTFS file attributes, Git, npm

## Global Constraints

- Do not create a second project copy.
- Do not move the active `63world` project or its `.git` repository.
- Do not delete any file.
- Do not overwrite an existing archive destination.
- Hidden attributes must not change file contents.

---

### Task 1: Archive obsolete parent-level reconnect backups

**Files:**
- Create directory: `C:\Users\fiost\Desktop\63world (1)\이전작업보관`
- Move: `C:\Users\fiost\Desktop\63world (1)\.git-empty-backup-20260723`
- Move: `C:\Users\fiost\Desktop\63world (1)\.git-reconnect-temp-20260723`
- Move: `C:\Users\fiost\Desktop\63world (1)\63world-pre-git-reconnect-20260723.zip`
- Move: `C:\Users\fiost\Desktop\63world (1)\63world-pre-git-reconnect-20260723.zip.sha256.txt`

**Interfaces:**
- Consumes: Four obsolete reconnect backup items in the project parent directory.
- Produces: One `이전작업보관` folder containing the same files and bytes.

- [ ] **Step 1: Validate exact source and destination paths**

Run:

```powershell
$parent = 'C:\Users\fiost\Desktop\63world (1)'
$archive = Join-Path $parent '이전작업보관'
$names = @(
  '.git-empty-backup-20260723',
  '.git-reconnect-temp-20260723',
  '63world-pre-git-reconnect-20260723.zip',
  '63world-pre-git-reconnect-20260723.zip.sha256.txt'
)
if ((Resolve-Path $parent).Path -ne $parent) { throw 'Unexpected parent path' }
if (Test-Path -LiteralPath $archive) { throw "Archive already exists: $archive" }
foreach ($name in $names) {
  $source = Join-Path $parent $name
  if (-not (Test-Path -LiteralPath $source)) { throw "Missing source: $source" }
  if (Test-Path -LiteralPath (Join-Path $archive $name)) { throw "Destination exists: $name" }
}
```

Expected: The command exits with code 0 and produces no error.

- [ ] **Step 2: Record aggregate file count and byte size**

Run:

```powershell
$parent = 'C:\Users\fiost\Desktop\63world (1)'
$names = @(
  '.git-empty-backup-20260723',
  '.git-reconnect-temp-20260723',
  '63world-pre-git-reconnect-20260723.zip',
  '63world-pre-git-reconnect-20260723.zip.sha256.txt'
)
$files = foreach ($name in $names) {
  $path = Join-Path $parent $name
  if (Test-Path -LiteralPath $path -PathType Leaf) { Get-Item -LiteralPath $path }
  else { Get-ChildItem -LiteralPath $path -File -Recurse -Force }
}
$files | Measure-Object -Property Length -Sum
```

Expected: A nonzero `Count` and `Sum`; retain both values for the post-move comparison.

- [ ] **Step 3: Move the four items into the archive**

Run:

```powershell
$parent = 'C:\Users\fiost\Desktop\63world (1)'
$archive = Join-Path $parent '이전작업보관'
$names = @(
  '.git-empty-backup-20260723',
  '.git-reconnect-temp-20260723',
  '63world-pre-git-reconnect-20260723.zip',
  '63world-pre-git-reconnect-20260723.zip.sha256.txt'
)
New-Item -ItemType Directory -Path $archive | Out-Null
foreach ($name in $names) {
  Move-Item -LiteralPath (Join-Path $parent $name) -Destination (Join-Path $archive $name)
}
```

Expected: All four items exist inside `이전작업보관` and no longer exist at the parent root.

- [ ] **Step 4: Compare the archived file count and byte size**

Run:

```powershell
Get-ChildItem -LiteralPath 'C:\Users\fiost\Desktop\63world (1)\이전작업보관' -File -Recurse -Force |
  Measure-Object -Property Length -Sum
```

Expected: `Count` and `Sum` exactly match Step 2.

### Task 2: Hide technical items without moving them

**Files:**
- Attribute-only update: `C:\Users\fiost\Desktop\63world (1)\CLAUDE.md`
- Attribute-only updates inside `C:\Users\fiost\Desktop\63world (1)\63world`

**Interfaces:**
- Consumes: Existing technical files and directories at their current paths.
- Produces: The same paths and bytes with the Windows Hidden attribute added.

- [ ] **Step 1: Apply Hidden only to the approved item list**

Run:

```powershell
$project = 'C:\Users\fiost\Desktop\63world (1)\63world'
$targets = @(
  'C:\Users\fiost\Desktop\63world (1)\CLAUDE.md',
  (Join-Path $project '.agents'),
  (Join-Path $project '.codex_work'),
  (Join-Path $project '.git'),
  (Join-Path $project '.superpowers'),
  (Join-Path $project 'node_modules'),
  (Join-Path $project 'docs'),
  (Join-Path $project 'tests'),
  (Join-Path $project 'tools'),
  (Join-Path $project 'supabase'),
  (Join-Path $project 'vendor'),
  (Join-Path $project '시트'),
  (Join-Path $project '작업자료'),
  (Join-Path $project '.gitignore'),
  (Join-Path $project 'package.json'),
  (Join-Path $project 'package-lock.json'),
  (Join-Path $project 'README.md'),
  (Join-Path $project 'schema.sql'),
  (Join-Path $project '인수인계.txt')
)
foreach ($target in $targets) {
  $item = Get-Item -LiteralPath $target -Force
  $item.Attributes = $item.Attributes -bor [IO.FileAttributes]::Hidden
}
```

Expected: All commands succeed; no path changes and no content changes occur.

- [ ] **Step 2: Verify every approved target is hidden**

Run:

```powershell
$project = 'C:\Users\fiost\Desktop\63world (1)\63world'
$targets = @(
  'C:\Users\fiost\Desktop\63world (1)\CLAUDE.md',
  (Join-Path $project '.agents'),
  (Join-Path $project '.codex_work'),
  (Join-Path $project '.git'),
  (Join-Path $project '.superpowers'),
  (Join-Path $project 'node_modules'),
  (Join-Path $project 'docs'),
  (Join-Path $project 'tests'),
  (Join-Path $project 'tools'),
  (Join-Path $project 'supabase'),
  (Join-Path $project 'vendor'),
  (Join-Path $project '시트'),
  (Join-Path $project '작업자료'),
  (Join-Path $project '.gitignore'),
  (Join-Path $project 'package.json'),
  (Join-Path $project 'package-lock.json'),
  (Join-Path $project 'README.md'),
  (Join-Path $project 'schema.sql'),
  (Join-Path $project '인수인계.txt')
)
$targets | ForEach-Object {
  $item = Get-Item -LiteralPath $_ -Force
  [pscustomobject]@{
    Path = $item.FullName
    Hidden = [bool]($item.Attributes -band [IO.FileAttributes]::Hidden)
  }
}
```

Expected: Every row reports `Hidden = True`.

- [ ] **Step 3: Verify the intended primary app items remain visible**

Run:

```powershell
$project = 'C:\Users\fiost\Desktop\63world (1)\63world'
@('assets','data','src','game.js','index.html','style.css') | ForEach-Object {
  $item = Get-Item -LiteralPath (Join-Path $project $_) -Force
  [pscustomobject]@{
    Name = $item.Name
    Hidden = [bool]($item.Attributes -band [IO.FileAttributes]::Hidden)
  }
}
```

Expected: Every row reports `Hidden = False`.

### Task 3: Verify project integrity and record the plan

**Files:**
- Create: `docs/superpowers/plans/2026-07-24-visual-workspace-cleanup.md`

**Interfaces:**
- Consumes: The visually cleaned workspace from Tasks 1 and 2.
- Produces: Verified unchanged application behavior and a clean local Git branch.

- [ ] **Step 1: Verify Git repository and remote**

Run:

```powershell
git status --short
git remote -v
git rev-parse --show-toplevel
```

Expected: Only this plan document is untracked before commit; `origin` remains configured; the repository root remains the active `63world` folder.

- [ ] **Step 2: Run the complete test suite**

Run:

```powershell
npm.cmd test
```

Expected: Exit code 0 with zero failed tests.

- [ ] **Step 3: Commit only the plan document**

Run:

```powershell
git add -- docs/superpowers/plans/2026-07-24-visual-workspace-cleanup.md
git commit -m "docs: plan visual workspace cleanup"
```

Expected: The commit contains only the plan document because archive moves and Hidden attributes are outside Git content tracking.

- [ ] **Step 4: Confirm final Git state**

Run:

```powershell
git status --porcelain
git log -1 --oneline
```

Expected: Git status is empty and the latest commit is `docs: plan visual workspace cleanup`.
