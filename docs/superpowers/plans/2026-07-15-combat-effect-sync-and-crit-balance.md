# Combat Effect Sync and Critical Balance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 전투 로그와 상태 표시를 같은 프레임에 동기화하고 수정된 치명타 밸런스, 처형 음향, 툴팁 및 엑셀 시트를 반영한다.

**Architecture:** 큐 효과를 상태 변경과 후렌더 시각 효과로 분리해 상태를 먼저 적용하고 갱신된 전투 프레임 위에 숫자와 FX를 표시한다. 밸런스 값은 `src/combat-rules.js`와 `src/game-data.js`에 두고 전투 코드가 이를 소비한다.

**Tech Stack:** Browser JavaScript, Node test runner, jsdom smoke harness, Excel `.xlsx` via `@oai/artifact-tool`.

## Global Constraints

- 지원·회복·보호막·버프는 빗나가지 않는다.
- 타격별 독립 빗나감 규칙은 유지한다.
- 기존 전투 큐의 이벤트 순서와 취소 안전성을 유지한다.
- 사용자 수정 엑셀의 id 열과 기존 시트 구조를 보존한다.

---

### Task 1: Combat Event State and Render Synchronization

**Files:**
- Modify: `game.js`
- Test: `tests/combat-flow.test.mjs`
- Test: `tools/browser-smoke/try_combat_event_timing.js`

- [ ] 피해 로그 콜백 시 HP와 렌더된 HP 바가 이미 감소한 실패 테스트를 작성한다.
- [ ] 보호막 로그 콜백 시 보호막과 렌더된 배지가 이미 갱신된 실패 테스트를 작성한다.
- [ ] 효과 상태 변경을 렌더 전에, 피해 숫자와 FX를 렌더 후에 실행하도록 큐 소비 코드를 분리한다.
- [ ] 막기 훈련 로그에 실제 `guardGain`을 포함한다.
- [ ] 집중 테스트를 실행해 통과시킨다.

### Task 2: Critical Balance and Skill Data

**Files:**
- Modify: `src/combat-rules.js`
- Modify: `src/game-data.js`
- Modify: `game.js`
- Test: `tests/combat-rules.test.mjs`
- Test: `tests/game-data.test.mjs`

- [ ] 기본 치명타 150%, 화염 스킬 보너스 170/190/210%, 확률 25/35/45%의 실패 테스트를 작성한다.
- [ ] 마법사 기본 공격 예외를 제거하고 모든 기본·스킬 치명타 기본값을 1.5로 통일한다.
- [ ] 불씨 증폭은 화염 전문화 스킬 타격에만 추가 배율이 적용되도록 한다.
- [ ] 파쇄 일격을 180%로 변경하고 설명을 동기화한다.
- [ ] 관련 테스트를 실행해 통과시킨다.

### Task 3: Tooltip, Execution Audio, and Player Log Duration

**Files:**
- Modify: `src/sfx-map.js`
- Modify: `game.js`
- Test: `tests/sfx-map.test.mjs`
- Test: `tests/combat-flow.test.mjs`

- [ ] 충전 툴팁, 처형 음향 매핑, 플레이어 로그 +400ms의 실패 테스트를 작성한다.
- [ ] 충전 배지에 툴팁을 추가한다.
- [ ] 처형 판정 이벤트에 전용 audio id를 연결한다.
- [ ] 플레이어가 만든 공격·추가타·합계 로그만 400ms 연장한다.
- [ ] 관련 테스트를 실행해 통과시킨다.

### Task 4: Workbook Synchronization and Styling

**Files:**
- Modify: `시트/아이템_스킬_수정시트.xlsx`
- Modify: `src/game-data.js`

- [ ] 수정된 계산식 값을 읽어 코드와 충돌하는 입력을 확인한다.
- [ ] 비교 스킬 이름 및 총 배율 열을 분리하고 파쇄 일격 180%를 반영한다.
- [ ] 스킬 행에 전문화별 연한 배경색을 적용한다.
- [ ] 수식 오류 검사를 수행하고 여섯 시트를 모두 렌더링한다.
- [ ] 검증된 결과를 `시트/아이템_스킬_수정시트.xlsx`에 반영한다.

### Task 5: Full Verification

**Files:**
- Test: `tests/*.test.mjs`
- Test: `tools/browser-smoke/*.js`

- [ ] `node --check game.js`를 실행한다.
- [ ] 전투, 규칙, 데이터, 음향 집중 테스트를 실행한다.
- [ ] `npm.cmd test` 전체 기준 테스트를 실행한다.
- [ ] 실제 브라우저 스모크에서 HP·보호막·처형 경로를 확인한다.
