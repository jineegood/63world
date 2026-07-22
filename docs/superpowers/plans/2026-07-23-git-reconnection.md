# GitHub History Reconnection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 현재 최신 프로젝트 파일을 유지하면서 `jineegood/63world`의 기존 Git 기록을 연결하고 최신 상태를 로컬 브랜치에만 기록한다.

**Architecture:** 원격 저장소는 프로젝트 밖 임시 폴더에 복제한다. 복제본의 `.git` 메타데이터만 현재 프로젝트로 복사하고, 현재 파일은 체크아웃·리셋·덮어쓰기하지 않는다. 작업용 생성물은 `.gitignore`로 제외한 뒤 로컬 브랜치에 커밋한다.

**Tech Stack:** Git, PowerShell, Node.js

## Global Constraints

- 현재 최신본은 `C:\Users\fiost\Desktop\63world (1)\63world`이다.
- 원격 저장소는 `https://github.com/jineegood/63world.git`이다.
- 원격 `main`의 작업 전 HEAD는 `f0f5aa2b9a3dd6e4060cbddba655e9714b056d9c`이다.
- `git push`, `git reset`, `git checkout`, `git clean`을 실행하지 않는다.
- Vercel과 Supabase 설정을 변경하지 않는다.
- 현재 프로젝트 파일을 원격의 예전 파일로 덮어쓰지 않는다.

---

### Task 1: 최신 폴더 체크포인트 만들기

**Files:**
- Create: `C:\Users\fiost\Desktop\63world (1)\63world-pre-git-reconnect-20260723.zip`
- Create: `C:\Users\fiost\Desktop\63world (1)\63world-pre-git-reconnect-20260723.zip.sha256.txt`

**Interfaces:**
- Consumes: 현재 최신 프로젝트 파일
- Produces: Git 연결 전 복구용 ZIP과 SHA-256 해시

- [ ] **Step 1: 대상 경로와 빈 `.git` 확인**

Run:

```powershell
$projectRoot=(Resolve-Path 'C:\Users\fiost\Desktop\63world (1)\63world').Path
$gitPath=(Resolve-Path "$projectRoot\.git").Path
if($gitPath -ne "$projectRoot\.git"){ throw 'unexpected .git path' }
if((Get-ChildItem -Force $gitPath).Count -ne 0){ throw '.git is not empty' }
```

Expected: exit code 0

- [ ] **Step 2: 작업용 대용량 폴더를 제외한 체크포인트 생성**

Run from the project root:

```powershell
tar -a -c -f '..\63world-pre-git-reconnect-20260723.zip' --exclude=.git --exclude=.codex_work --exclude=.superpowers --exclude=backups --exclude=outputs .
```

Expected: `C:\Users\fiost\Desktop\63world (1)\63world-pre-git-reconnect-20260723.zip` exists and is larger than 1 MB

- [ ] **Step 3: 체크포인트 해시 저장**

Run:

```powershell
Get-FileHash '..\63world-pre-git-reconnect-20260723.zip' -Algorithm SHA256 | Format-List | Out-File '..\63world-pre-git-reconnect-20260723.zip.sha256.txt' -Encoding utf8
```

Expected: SHA-256 text file exists

---

### Task 2: 기존 GitHub 기록 연결

**Files:**
- Create: `C:\Users\fiost\Desktop\63world (1)\.git-reconnect-temp-20260723\`
- Move: `C:\Users\fiost\Desktop\63world (1)\63world\.git` → `C:\Users\fiost\Desktop\63world (1)\.git-empty-backup-20260723`
- Create: `C:\Users\fiost\Desktop\63world (1)\63world\.git\`

**Interfaces:**
- Consumes: 기존 원격 저장소의 `main` 기록
- Produces: 현재 최신 폴더에서 작동하는 Git 메타데이터와 `origin`

- [ ] **Step 1: 원격 저장소를 프로젝트 밖에 복제**

Run:

```powershell
git clone --branch main --single-branch 'https://github.com/jineegood/63world.git' 'C:\Users\fiost\Desktop\63world (1)\.git-reconnect-temp-20260723'
```

Expected: cloned HEAD equals `f0f5aa2b9a3dd6e4060cbddba655e9714b056d9c`

- [ ] **Step 2: 이동 대상 절대 경로 재검증**

Run:

```powershell
$projectRoot=(Resolve-Path 'C:\Users\fiost\Desktop\63world (1)\63world').Path
$oldGit=(Resolve-Path "$projectRoot\.git").Path
$cloneGit=(Resolve-Path 'C:\Users\fiost\Desktop\63world (1)\.git-reconnect-temp-20260723\.git').Path
if($oldGit -ne "$projectRoot\.git"){ throw 'unexpected old .git path' }
if($cloneGit -ne 'C:\Users\fiost\Desktop\63world (1)\.git-reconnect-temp-20260723\.git'){ throw 'unexpected clone .git path' }
```

Expected: exit code 0

- [ ] **Step 3: 빈 Git 폴더를 프로젝트 밖으로 보존하고 원격 메타데이터 복사**

Run:

```powershell
Move-Item -LiteralPath 'C:\Users\fiost\Desktop\63world (1)\63world\.git' -Destination 'C:\Users\fiost\Desktop\63world (1)\.git-empty-backup-20260723'
Copy-Item -LiteralPath 'C:\Users\fiost\Desktop\63world (1)\.git-reconnect-temp-20260723\.git' -Destination 'C:\Users\fiost\Desktop\63world (1)\63world\.git' -Recurse
```

Expected: `git status --short --branch` works in the current project and lists current-file differences without overwriting files

- [ ] **Step 4: 로컬 작업 브랜치 생성**

Run: `git switch -c local-latest-20260723`

Expected: current branch is `local-latest-20260723`

---

### Task 3: 생성물 제외와 최신 상태 로컬 기록

**Files:**
- Create: `.gitignore`

**Interfaces:**
- Consumes: 현재 최신 프로젝트와 연결된 Git 기록
- Produces: 작업용 생성물을 제외한 로컬 최신 커밋

- [ ] **Step 1: `.gitignore` 작성**

Create exactly:

```gitignore
.codex_work/
.superpowers/
backups/
outputs/
node_modules/
.vercel/
*.log
.DS_Store
Thumbs.db
desktop.ini
```

- [ ] **Step 2: 제외 결과 확인**

Run:

```powershell
git status --short
git check-ignore -v .codex_work .superpowers backups outputs
```

Expected: generated directories are ignored; source directories remain visible to Git

- [ ] **Step 3: 현재 최신 상태 스테이징**

Run: `git add -A`

Expected: `git diff --cached --stat` shows source changes but no `.codex_work`, `.superpowers`, `backups`, or `outputs` files

- [ ] **Step 4: 현재 최신 상태를 로컬 커밋으로 저장**

Run: `git commit -m "chore: capture current 63world state"`

Expected: one local commit is created on `local-latest-20260723`

---

### Task 4: 연결과 게임 상태 검증

**Files:**
- Test: Git metadata, remote HEAD, project test suite

**Interfaces:**
- Consumes: Task 2–3 결과
- Produces: 연결·로컬 기록·게임 정상 상태에 대한 증거

- [ ] **Step 1: Git 연결 확인**

Run:

```powershell
git status --short --branch
git remote -v
git log -3 --oneline --decorate
```

Expected: local branch is clean, `origin` is `jineegood/63world`, and local commit is above remote `main`

- [ ] **Step 2: 원격이 변경되지 않았는지 확인**

Run:

```powershell
$remoteHead=(git ls-remote --heads origin main).Split("`t")[0]
if($remoteHead -ne 'f0f5aa2b9a3dd6e4060cbddba655e9714b056d9c'){ throw "remote main changed: $remoteHead" }
```

Expected: remote `main` remains unchanged

- [ ] **Step 3: 전체 게임 검사 실행**

Run: `npm.cmd test`

Expected: exit code 0 with no failing tests
