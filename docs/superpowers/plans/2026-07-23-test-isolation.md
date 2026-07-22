# Test Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 일반 브라우저 자동 검사가 실제 Supabase 설정과 연결되지 않도록 분리한다.

**Architecture:** 공용 jsdom 하네스가 `index.html`의 스크립트를 합칠 때 `src/cloud-config.js`만 테스트용 빈 설정으로 대체한다. 전투 프레임 스모크는 신규 캐릭터 튜토리얼을 종료한 뒤 전투를 시작한다. 실제 게임 파일과 클라우드 설정은 수정하지 않는다.

**Tech Stack:** Node.js, jsdom, Node test runner, PowerShell test runner

## Global Constraints

- 실제 `src/cloud-config.js`의 URL과 공개 키를 수정하지 않는다.
- 학생 저장 데이터와 게임 기능을 수정하지 않는다.
- 일반 브라우저 실행의 클라우드 동작을 변경하지 않는다.
- 현재 `.git` 폴더가 비어 있으므로 이번 작업에서는 커밋 단계를 실행할 수 없다.

---

### Task 1: 공용 브라우저 검사에서 클라우드 설정 격리

**Files:**
- Modify: `tools/browser-smoke/harness.js:46-50`
- Modify: `tools/browser-smoke/try_combat_frame.js:18-24`
- Modify: `tools/browser-smoke/try_combat_event_timing.js:12-21`
- Test: `tests/combat-frame-pipeline.test.mjs:75-83`

**Interfaces:**
- Consumes: `index.html`에서 읽은 로컬 스크립트 경로 목록 `scriptSrcs`
- Produces: 자동 검사 안에서만 `window.YUKSAM_CLOUD = { url: '', anonKey: '' }`를 설정한 결합 스크립트

- [x] **Step 1: 기존 회귀 검사가 현재 문제를 재현하는지 확인**

Run: `node --test tests/combat-frame-pipeline.test.mjs`

Expected: `real browser preserves final combat frame DOM and missing-target behavior`가 `heading.querySelectorAll` 오류로 FAIL

- [x] **Step 2: 하네스에서 클라우드 설정 파일만 테스트용 값으로 대체**

`tools/browser-smoke/harness.js`의 스크립트 결합 부분에 다음 분기를 추가한다.

```js
const combined = scriptSrcs.map((s) => {
  let code = fs.readFileSync(fsPath(s), 'utf8');
  if (s.replace(/\\/g, '/') === 'src/cloud-config.js') {
    code = "window.YUKSAM_CLOUD = { url: '', anonKey: '' };";
  }
  if (s === 'game.js') code += '\n;window.__G = game;';
  return code;
}).join('\n;\n');
```

- [x] **Step 3: 전투 프레임 검사에서 튜토리얼 종료**

`tools/browser-smoke/try_combat_frame.js`에서 캐릭터 생성 대기 직후 다음 코드를 추가한다.

```js
try { window.__tutorialDoneV53?.(); } catch {}
```

같은 신규 캐릭터 흐름을 사용하는 `tools/browser-smoke/try_combat_event_timing.js`에도 캐릭터 생성 대기 직후 같은 종료 호출을 추가한다.

- [x] **Step 4: 재현 검사가 통과하는지 확인**

Run: `node --test tests/combat-frame-pipeline.test.mjs`

Expected: 7 tests, 7 pass, 0 fail

- [x] **Step 5: 브라우저 부팅 검사를 절대 경로로 확인**

Run: `node tools/browser-smoke/boot_test.js "C:\Users\fiost\Desktop\63world (1)\63world"`

Expected: `RESULT: PASS 9/9`

- [x] **Step 6: 전체 검사 실행**

Run: `npm.cmd test`

Expected: 모든 테스트 명령이 exit code 0으로 종료

- [x] **Step 7: 실제 클라우드 설정이 보존됐는지 확인**

Run: `node -e "const fs=require('fs');const s=fs.readFileSync('src/cloud-config.js','utf8');if(!/url:\s*'http/.test(s)||!/anonKey:\s*'[^']{20,}'/.test(s))process.exit(1);console.log('cloud config preserved')"`

Expected: `cloud config preserved`
