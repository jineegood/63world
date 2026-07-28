# Authoritative Combat Presentation Recovery Implementation Plan

> **For Codex:** REQUIRED SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** 서버가 계산한 전투 결과를 한 번만 적용하면서 예전 전투 연출과 로그를 복구하고, 도망·보상·튜토리얼 피격·배경음까지 현재 서버 전투 구조에 안전하게 맞춘다.

**Architecture:** 서버는 체력, 피해량, 승패, 보상, 도망 성공 여부를 유일하게 계산한다. 브라우저는 서버의 최종 결과를 즉시 화면에 덮어쓰지 않고 잠시 보관한 뒤, 서버가 보낸 전투 사건을 순서대로 연출하고 마지막에 한 번만 최종 상태와 맞춘다. 도망도 새 서버 명령으로 처리해 브라우저 조작으로 성공 여부나 피해량을 바꿀 수 없게 한다.

**Tech Stack:** Vanilla JavaScript, Supabase Edge Functions (Deno/ES modules), PostgreSQL migrations/RPC, Node test runner, jsdom, PowerShell baseline runner.

---

## Task 1: 서버 결과를 늦게 적용하는 전투 연출 조정기

**Files:**
- Create: `src/authoritative-combat-presentation-v3.js`
- Create: `tests/authoritative-combat-presentation-v3.test.mjs`
- Modify: `index.html`
- Modify: `package.json`
- Modify: `tools/run-baseline.ps1`

- [ ] **Step 1: 중복 피해를 재현하는 실패 테스트 작성**

  테스트에 다음 상황을 고정한다.

  - 화면 속 몬스터 체력은 10이다.
  - 서버 응답의 최종 체력은 5다.
  - 서버 사건은 `monster-damage: 5` 하나다.
  - 연출 시작 전에 최종 체력 5를 적용하면 피해 연출이 다시 5를 빼서 0이 되는 기존 오류를 재현한다.
  - 새 조정기는 연출 중 화면을 10 → 5로 보이고, 연출 종료 후 서버 최종값 5와 정확히 맞춰야 한다.
  - 플레이어 체력·레벨·경험치·골드도 연출 종료 전에는 최종값으로 바뀌지 않아야 한다.

  Run: `node --test tests/authoritative-combat-presentation-v3.test.mjs`
  Expected: FAIL because the presentation module does not exist.

- [ ] **Step 2: 최소 전투 연출 조정기 구현**

  `window.YuksamAuthoritativeCombatPresentationV3.create(options)`를 추가한다.

  ```js
  const presenter = YuksamAuthoritativeCombatPresentationV3.create({
    playNotices(notices, done) {},
    reconcile(response) {},
    finish(response) {},
  });

  presenter.present({ response, notices });
  presenter.isPresenting();
  ```

  `present()`의 순서는 반드시 `playNotices` → `reconcile` → `finish`다. 같은 서버 응답을 두 번 넘겨도 한 번만 처리하도록 `requestId` 또는 `sessionRevision` 기반 중복 방지 키를 받는다. 연출 도중에는 다음 입력을 잠근다.

- [ ] **Step 3: 테스트 통과 및 로드 순서 연결**

  `index.html`에서 `src/combat-log-v3.js` 다음, `game.js` 전에 새 모듈을 불러온다. `package.json`과 `tools/run-baseline.ps1`의 테스트 목록에 새 테스트를 넣는다.

  Run: `node --test tests/authoritative-combat-presentation-v3.test.mjs`
  Expected: PASS.

- [ ] **Step 4: 커밋**

  ```powershell
  git add src/authoritative-combat-presentation-v3.js tests/authoritative-combat-presentation-v3.test.mjs index.html package.json tools/run-baseline.ps1
  git commit -m "fix: defer authoritative combat state presentation"
  ```

## Task 2: 일반 공격의 체력·사망·보상 타이밍 복구

**Files:**
- Modify: `game.js`
- Modify: `tests/server-combat-polish.test.mjs`
- Create: `tests/authoritative-combat-game-flow.test.mjs`

- [ ] **Step 1: 현재 오류를 잡는 게임 흐름 테스트 작성**

  jsdom 기반 테스트로 `wireAuthoritativePveCombatV3()`의 다음 조건을 검증한다.

  - `submit_turn` 직후 `applyServerPlayer()`와 `applySession()`이 실행되지 않는다.
  - 피해 숫자와 흔들림이 나온 뒤 서버 최종 체력이 한 번만 적용된다.
  - 몬스터 최종 체력이 0이고 서버 결과가 `victory`이면 쓰러짐 연출 후 전투가 닫힌다.
  - 플레이어 최종 체력이 0이고 서버 결과가 `defeat`이면 반드시 패배 처리된다.
  - 경험치·골드·빌딩·레벨업·최대 체력 증가는 전투 종료 전 HUD에 선반영되지 않는다.
  - `continue`인 경우에만 다음 문제 메뉴가 열린다.

  Run: `node --test tests/authoritative-combat-game-flow.test.mjs`
  Expected: FAIL against the current eager `applyServerPlayer/applySession` path.

- [ ] **Step 2: `presentResponse()`를 지연 적용 구조로 변경**

  `wireAuthoritativePveCombatV3()`에서 서버 응답을 받자마자 실행하는 아래 동작을 제거한다.

  - 즉시 `applyServerPlayer(response)`
  - 즉시 `applySession(response.session, monster)`
  - 승리 보상과 레벨업의 전투 중 HUD 반영

  대신 서버 응답과 세션을 presenter에 넘긴다. `YuksamCombatLogV3.translate()`가 만든 기존 전투 사건을 현재 `queueCombatSequence()`로 모두 재생한 뒤에만 다음을 실행한다.

  1. 플레이어와 몬스터를 서버 최종값으로 맞춘다.
  2. `continue`, `victory`, `defeat`를 서버 outcome 기준으로 분기한다.
  3. 승리라면 쓰러짐/승리 연출과 전투창 종료 후 경험치 → 골드 → 빌딩 → 레벨업 순서로 보상을 보여준다.

- [ ] **Step 3: 예전 전투 로그와 0 체력 종료 보장**

  전투 로그 텍스트는 `src/combat-log-v3.js`에서 변환한 사건을 그대로 사용한다. 화면 체력을 보고 승패를 추측하지 않고 서버의 `response.outcome`을 기준으로 종료하되, 종료 직전 서버 최종 체력을 한 번 맞춰 HP 0이 화면에도 확실히 보이게 한다.

- [ ] **Step 4: 회귀 테스트 실행**

  Run:

  ```powershell
  node --test tests/authoritative-combat-game-flow.test.mjs tests/server-combat-polish.test.mjs tests/combat-log-v3.test.mjs
  ```

  Expected: all PASS.

- [ ] **Step 5: 커밋**

  ```powershell
  git add game.js tests/server-combat-polish.test.mjs tests/authoritative-combat-game-flow.test.mjs
  git commit -m "fix: synchronize combat visuals after server events"
  ```

## Task 3: 서버 오류 원인 안내와 안전한 1회 복구

**Files:**
- Modify: `src/pve-combat-client-v3.js`
- Modify: `game.js`
- Modify: `supabase/functions/_shared/pve-combat-service-v3.mjs`
- Modify: `tests/pve-combat-client-v3.test.mjs`
- Modify: `tests/pve-combat-service-v3.test.mjs`
- Modify: `tests/authoritative-combat-game-flow.test.mjs`

- [ ] **Step 1: 뭉뚱그린 오류 메시지와 중복 제출 회귀 테스트 작성**

  다음 서버 코드를 각각 사용자에게 이해 가능한 문장으로 표시하는 테스트를 추가한다.

  - `MONSTER_MAP_MISMATCH`: 몬스터 위치 정보가 달라 전투를 다시 불러온다.
  - `COMBAT_STATE_MISSING`: 전투 기록을 찾지 못해 안전하게 종료한다.
  - `PLAYER_NOT_FOUND`: 캐릭터 정보를 다시 확인해야 한다.
  - `UNKNOWN_MONSTER`: 몬스터 정보를 찾지 못했다.
  - `REVISION_CONFLICT`: 최신 전투 상태를 한 번 불러온 뒤 같은 공격을 자동 재전송하지 않는다.

  같은 요청 버튼을 여러 번 눌러도 동일 `requestId`로 한 번만 전송되고, 자동 `resume()`도 한 번만 호출되는지 검증한다.

  Run: `node --test tests/pve-combat-client-v3.test.mjs tests/authoritative-combat-game-flow.test.mjs`
  Expected: FAIL for missing mappings and recovery guards.

- [ ] **Step 2: 오류 매핑과 1회 복구 구현**

  `src/pve-combat-client-v3.js`에 위 오류 문구를 추가한다. `game.js`에는 전투별 `hasAttemptedResume` 플래그를 두어 최초 오류에만 `resume()`하고, 복구 후에는 서버 상태만 다시 표시한다. 공격 요청을 몰래 다시 보내지 않는다.

- [ ] **Step 3: Edge Function 진단 로그 추가**

  `pve-combat-service-v3.mjs`의 catch 경로에서 비밀번호·토큰·정답 원문을 제외하고 아래 정보만 구조화해 기록한다.

  ```js
  {
    event: 'student_combat_v3_error',
    operation,
    errorCode,
    userId,
    sessionId,
    sessionRevision,
    requestId
  }
  ```

  사용자 응답에는 내부 오류 내용이나 DB 문장을 노출하지 않는다.

- [ ] **Step 4: 테스트 실행**

  Run:

  ```powershell
  node --test tests/pve-combat-client-v3.test.mjs tests/pve-combat-service-v3.test.mjs tests/authoritative-combat-game-flow.test.mjs
  ```

  Expected: all PASS.

- [ ] **Step 5: 커밋**

  ```powershell
  git add src/pve-combat-client-v3.js game.js supabase/functions/_shared/pve-combat-service-v3.mjs tests/pve-combat-client-v3.test.mjs tests/pve-combat-service-v3.test.mjs tests/authoritative-combat-game-flow.test.mjs
  git commit -m "fix: recover combat state without duplicate attacks"
  ```

## Task 4: 서버가 판정하는 도망 규칙과 저장 구조

**Files:**
- Modify: `supabase/functions/_shared/pve-combat-rules-v3.mjs`
- Modify: `supabase/functions/_shared/pve-combat-service-v3.mjs`
- Modify: `supabase/functions/_shared/pve-combat-store-v3.mjs`
- Modify: `supabase/functions/student-combat-v3/index.ts`
- Create: `supabase/migrations/202607280003_authoritative_combat_escape_v3.sql`
- Modify: `tests/pve-combat-rules-v3.test.mjs`
- Modify: `tests/pve-combat-service-v3.test.mjs`
- Modify: `tests/pve-combat-function-v3.test.mjs`
- Create: `tests/authoritative-combat-escape-migration-v3.test.mjs`

- [ ] **Step 1: 도망 규칙 실패 테스트 작성**

  순수 규칙 테스트에 아래 값을 고정한다.

  - 플레이어 레벨 ≥ 몬스터 레벨: 성공 확률 80%.
  - 플레이어 레벨 < 몬스터 레벨: 성공 확률 50%.
  - 보스전: 도망 불가.
  - 한 번 실패한 전투: 다시 도망 불가.
  - 성공: 세션 종료, 플레이어 피해 없음.
  - 실패: `escape_failed`가 true가 되고 몬스터가 기존 서버 공격 계산으로 한 번 반격한다.
  - 실패 반격으로 플레이어 HP가 0이면 outcome은 `defeat`.

  Run: `node --test tests/pve-combat-rules-v3.test.mjs tests/pve-combat-service-v3.test.mjs`
  Expected: FAIL because `attempt_escape` does not exist.

- [ ] **Step 2: 순수 도망 규칙 추가**

  `pve-combat-rules-v3.mjs`에 다음 인터페이스를 추가한다.

  ```js
  resolveEscapeAttempt({
    state,
    player,
    monster,
    randomValue
  }) => {
    success,
    chance,
    state,
    events,
    outcome
  }
  ```

  실패 반격 피해량, 보호막, 상태 효과, 치명타, 사망 판정은 기존 몬스터 턴 계산 함수를 재사용한다. SQL이나 브라우저에 별도의 피해 공식을 만들지 않는다.

- [ ] **Step 3: DB 마이그레이션 테스트와 SQL 작성**

  `202607280003_authoritative_combat_escape_v3.sql`에 다음을 구현한다.

  - `student_combat_sessions_v3.escape_failed boolean not null default false`
  - 세션 revision과 사용자 소유권을 확인하는 `private_prepare_student_combat_escape_v3`
  - 예상 session/player revision을 다시 확인하고 한 번만 결과를 저장하는 `private_commit_student_combat_escape_v3`
  - 성공 시 세션 종료, 실패 시 체력·상태·`escape_failed`·revision 저장
  - 동일 `request_id` 재요청은 같은 저장 결과를 반환
  - 다른 학생의 전투 세션은 읽거나 변경할 수 없음

  이미 적용된 과거 마이그레이션은 수정하지 않는다. 새 설치와 기존 배포 DB 모두 마이그레이션 순서에 따라 `202607280003`에서 최종 구조가 된다.

  Run: `node --test tests/authoritative-combat-escape-migration-v3.test.mjs`
  Expected: PASS after SQL assertions cover ownership, revision, idempotency, and `escape_failed`.

- [ ] **Step 4: 서비스와 저장소에 `attempt_escape` 연결**

  서비스 입력:

  ```json
  {
    "op": "attempt_escape",
    "sessionRevision": 3,
    "requestId": "uuid"
  }
  ```

  저장소의 prepare → 순수 규칙 계산 → commit 순서를 사용한다. 응답은 기존 전투 응답과 같은 `session`, `player`, `events`, `outcome` 형태를 유지하고 도망 전용 `escape: { success, chance, locked }`만 추가한다.

- [ ] **Step 5: 서버 테스트 실행**

  Run:

  ```powershell
  node --test tests/pve-combat-rules-v3.test.mjs tests/pve-combat-service-v3.test.mjs tests/pve-combat-function-v3.test.mjs tests/authoritative-combat-escape-migration-v3.test.mjs
  ```

  Expected: all PASS.

- [ ] **Step 6: 커밋**

  ```powershell
  git add supabase/functions/_shared/pve-combat-rules-v3.mjs supabase/functions/_shared/pve-combat-service-v3.mjs supabase/functions/_shared/pve-combat-store-v3.mjs supabase/functions/student-combat-v3/index.ts supabase/migrations/202607280003_authoritative_combat_escape_v3.sql tests/pve-combat-rules-v3.test.mjs tests/pve-combat-service-v3.test.mjs tests/pve-combat-function-v3.test.mjs tests/authoritative-combat-escape-migration-v3.test.mjs
  git commit -m "feat: add authoritative combat escape"
  ```

## Task 5: 예전 도망 애니메이션을 새 서버 도망에 연결

**Files:**
- Modify: `src/pve-combat-client-v3.js`
- Modify: `game.js`
- Modify: `tests/pve-combat-client-v3.test.mjs`
- Modify: `tests/authoritative-combat-game-flow.test.mjs`

- [ ] **Step 1: 클라이언트와 애니메이션 실패 테스트 작성**

  - 버튼 문구는 `항복`이 아니라 `도망`이어야 한다.
  - 클릭 시 `surrender`가 아니라 `attempt_escape`를 호출한다.
  - 성공 시 예전 1120ms 후퇴·희미해짐 애니메이션 후 사냥터로 돌아간다.
  - 실패 시 몬스터 반격 사건을 정상 전투처럼 재생하고, 그 전투에서는 도망 버튼을 잠근다.
  - 실패 반격으로 HP 0이면 패배한다.
  - 도망 요청 중 중복 클릭은 한 번만 전송된다.

  Run: `node --test tests/pve-combat-client-v3.test.mjs tests/authoritative-combat-game-flow.test.mjs`
  Expected: FAIL because authority mode still calls `surrender()`.

- [ ] **Step 2: 전투 클라이언트 API 추가**

  ```js
  client.attemptEscape(sessionRevision, requestId)
  ```

  본문은 `op: 'attempt_escape'`를 보내고 기존 인증·재시도·오류 변환 규칙을 사용한다.

- [ ] **Step 3: 성공/실패 연출 연결**

  성공이면 기존 도망 연출의 `FLEE_MS = 1120`, 발소리, 두 단계 후퇴, 투명도 감소를 그대로 재사용한다. 실패면 서버 사건을 presenter와 `queueCombatSequence()`에 넘긴다. 성공과 실패 모두 서버 최종 상태는 사건/도망 연출 종료 후 한 번만 맞춘다.

- [ ] **Step 4: 테스트 실행**

  Run:

  ```powershell
  node --test tests/pve-combat-client-v3.test.mjs tests/authoritative-combat-game-flow.test.mjs
  ```

  Expected: all PASS.

- [ ] **Step 5: 커밋**

  ```powershell
  git add src/pve-combat-client-v3.js game.js tests/pve-combat-client-v3.test.mjs tests/authoritative-combat-game-flow.test.mjs
  git commit -m "fix: restore animated authoritative escape"
  ```

## Task 6: 맵 음악 유지와 명진쌤 치명타 연출

**Files:**
- Modify: `game.js`
- Modify: `tests/server-combat-polish.test.mjs`
- Create: `tests/tutorial-critical-hit.test.mjs`

- [ ] **Step 1: 음악과 튜토리얼 피격 실패 테스트 작성**

  - 일반 사냥터에서 전투가 시작되어도 `getDesiredAudioFileV21()`은 현재 맵 음악을 유지한다.
  - 보스맵은 입장 때부터 전투 내내 보스맵 음악을 유지한다.
  - `tut_healing_well` 수락 시 서버가 준 HP 1 결과를 즉시 HUD에 덮어쓰기 전에 공격음, 치명타음, 화면 흔들림, 치명타 글자/섬광을 순서대로 보여준다.
  - 연출이 끝난 뒤 HUD 체력이 1이 된다.

  Run: `node --test tests/server-combat-polish.test.mjs tests/tutorial-critical-hit.test.mjs`
  Expected: FAIL because normal combat selects battle music and the teacher hit has no critical presentation.

- [ ] **Step 2: 일반 전투 음악 분기 제거**

  `getDesiredAudioFileV21()`에서 `game.currentCombatMonsterId` 때문에 별도 전투 음악을 선택하는 분기를 제거한다. 현재 맵의 음악을 유지하며, 보스맵 분기는 맵 우선 규칙으로 남긴다.

- [ ] **Step 3: 명진쌤 공격을 치명타 연출로 변경**

  퀘스트 수락 응답의 HP 1을 잠시 보관한다. 기존 적 공격 효과음에 치명타 효과음을 추가하고, 화면 흔들림·피해 숫자·치명타 글자/섬광이 끝난 뒤 서버 스냅샷을 HUD에 적용한다. 서버가 정한 실제 HP 1 값은 바꾸지 않는다.

- [ ] **Step 4: 테스트 실행**

  Run:

  ```powershell
  node --test tests/server-combat-polish.test.mjs tests/tutorial-critical-hit.test.mjs
  ```

  Expected: all PASS.

- [ ] **Step 5: 커밋**

  ```powershell
  git add game.js tests/server-combat-polish.test.mjs tests/tutorial-critical-hit.test.mjs
  git commit -m "fix: preserve map music and restore tutorial critical hit"
  ```

## Task 7: 전체 검증과 배포 전 실서버 진단

**Files:**
- Modify only if a test exposes a defect in files already listed above.

- [ ] **Step 1: 전체 자동 테스트**

  Run:

  ```powershell
  npm test
  powershell -ExecutionPolicy Bypass -File tools/run-baseline.ps1
  ```

  Expected: exit code 0 with no failed test.

- [ ] **Step 2: 변경 파일과 비밀정보 검사**

  Run:

  ```powershell
  git status --short
  git diff --check
  rg -n "sbp_|service_role|SUPABASE_SERVICE_ROLE_KEY|Authorization: Bearer" src game.js tests supabase/functions supabase/migrations
  ```

  Expected: no accidentally committed token or service-role value; only environment-variable names and safe test fixtures may match.

- [ ] **Step 3: 로컬 정적 실행 검사**

  게임을 자동 플레이하거나 소리를 재생하지 않는다. jsdom 테스트로 로그인 화면 → 전투 시작 → 정답 제출 → 승리/패배/도망 성공/도망 실패의 DOM 상태와 이벤트 순서를 검증한다.

  Run:

  ```powershell
  node --test tests/authoritative-combat-game-flow.test.mjs tests/tutorial-critical-hit.test.mjs
  ```

  Expected: all PASS.

- [ ] **Step 4: 사용자 승인 후에만 Supabase 배포**

  자동 테스트와 코드 검토 결과를 사용자에게 쉬운 말로 보고하고 배포 승인을 받는다. 승인 전에는 아래 명령을 실행하지 않는다.

  ```powershell
  supabase db push
  supabase functions deploy student-combat-v3
  ```

- [ ] **Step 5: 승인 후 임시 테스트 계정으로 실서버 확인**

  새 마이그레이션과 Edge Function이 배포된 뒤 임시 학생 계정 한 개로 아래를 검증한다.

  - 일반 공격에서 피해가 한 번만 저장된다.
  - 몬스터 HP 0 승리와 플레이어 HP 0 패배가 즉시 확정된다.
  - 보상은 전투 종료 응답에만 들어온다.
  - 도망 성공 확률 분기와 실패 후 재시도 잠금이 저장된다.
  - 도망 실패 반격도 기존 서버 피해 계산을 사용한다.

  검증이 끝나면 임시 계정과 임시 캐릭터만 정확히 삭제한다.

- [ ] **Step 6: 최종 회귀 테스트와 커밋**

  Run:

  ```powershell
  npm test
  powershell -ExecutionPolicy Bypass -File tools/run-baseline.ps1
  git diff --check
  git status --short
  ```

  Expected: all tests pass; only intentional changes remain.

  ```powershell
  git add game.js index.html package.json tools/run-baseline.ps1 src tests supabase/functions supabase/migrations
  git commit -m "fix: complete authoritative combat recovery"
  ```
