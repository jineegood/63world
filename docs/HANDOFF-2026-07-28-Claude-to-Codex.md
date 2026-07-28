# 63world 인수인계 (2026-07-28, Claude → Codex)

이 문서 하나만 읽으면 이어서 작업할 수 있게 정리했다. **먼저 이 문서를 끝까지 읽고, 그다음 "지금 당장 할 일"부터 시작하면 된다.**

---

## 0. 30초 요약

- 이번 세션의 대부분은 **"서버 판정 전환(v3) 때 조용히 사라진 것들"을 되찾는 작업**이었다.
- 배포까지 끝난 것: 로그인 Enter, 퀘스트 대화창 색, 문제집 엑셀/CSV·ChatGPT 문장, 퀘스트 수락 버그, 소리 기본값, 프로필 얼굴, **전투 로그 전체 복구**, 전투 연출 8종.
- **아직 커밋도 배포도 안 된 작업이 하나 있다** → 아래 1번.
- **사용자가 직접 해야 하는 Supabase 작업이 남아 있다** → 아래 2번.
- **사용자 결정 대기 중인 항목이 하나 있다** → 아래 3번.

---

## 1. 지금 당장 할 일 — 커밋되지 않은 작업 마무리

`git status`에 아래가 남아 있다. 이것은 **"전투 로그 복구 2단계"** 작업이며 기능적으로 완성되어 있고 개별 테스트도 통과했다.

```
M src/combat-log-v3.js
M supabase/functions/_shared/generated-combat-catalog-v3.mjs
M supabase/functions/_shared/pve-combat-rules-v3.mjs
M supabase/generated/combat-monster-catalog-v3.sql
M supabase/migrations/202607260004_server_authoritative_pve_combat_v3.sql
M tests/combat-log-v3.test.mjs
M tools/generate-combat-catalog-v3.mjs
?? supabase/migrations/202607280002_monster_technique_names_v3.sql
```

**내용 세 가지:**

1. **몬스터 기술 이름** — `버섯돌이의 공격!` → `포자 뿌리기을(를) 사용했다!`
   - `tools/generate-combat-catalog-v3.mjs`의 패턴 표에 `name` 추가 (예전 `game.js`의 `PATTERNS_V40`과 같은 이름)
   - `node tools/generate-combat-catalog-v3.mjs` 로 카탈로그 재생성 완료
   - `pve-combat-rules-v3.mjs`: `monster-action` 이벤트를 **패턴을 고른 뒤에** 밀어넣도록 바꾸고 `name`/`kind`를 실었다
   - 새 마이그레이션 `202607280002_monster_technique_names_v3.sql` 추가 (DB 카탈로그에도 이름 반영)

2. **보호막이 막은 양** — `🛡️ 보호막이 5을 막아냈다! 2의 피해를 받았다! (총 7의 데미지)`
   - 서버는 원래부터 `shieldDamage`/`hpDamage`를 보내고 있었다. 클라이언트가 버리고 있었을 뿐이다.

3. **기도의 방벽 반사** — `기도의 방벽이 발동했다! 버섯돌이에게 반사 피해 1! 실제 회복 1!`
   - 서버는 원래부터 `monster-damage {reflected:true}` 와 `player-heal {source:'prayer-barrier'}` 를 보내고 있었다.
   - 반사 피해는 **내 공격 횟수/총 피해 합계에 넣지 않는다** (테스트로 고정).

**해야 할 일:** 전체 검사(`node --run test`)를 돌려 통과 확인 후 커밋·푸시.
마지막 실행은 70묶음까지 진행된 상태에서 세션이 끝났으므로 **처음부터 다시 돌려야 한다.**

> ⚠️ `202607260004_...sql`이 수정된 것은 정상이다. 생성기가 마이그레이션까지 동기화하도록 설계돼 있다.
> 다만 그 파일은 **이미 실서버에 적용된** 것이라 다시 적용되지 않는다. 그래서 새 마이그레이션(`202607280002`)을 따로 만들었다.

---

## 2. 사용자가 직접 해야 하는 Supabase 작업 (아직 안 함)

**GitHub 푸시만으로는 반영되지 않는다.** Vercel은 자동 배포되지만 Supabase는 아니다.

### (1) Edge Function 재배포 — 기술 이름에 **반드시 필요**

전투 계산은 **Edge Function(JS)** 안에서 돈다(`resolveTurn`). DB는 결과 저장과 초기 상태 생성만 한다.
`supabase/functions/_shared/pve-combat-rules-v3.mjs` 와 `generated-combat-catalog-v3.mjs` 를 고쳤으므로 재배포해야 한다.

```bash
supabase functions deploy student-combat-v3
```

### (2) 마이그레이션 적용 — DB 카탈로그 일관성용

Supabase → SQL Editor 에 `supabase/migrations/202607280002_monster_technique_names_v3.sql` 내용을 붙여넣고 Run.
(멱등이라 여러 번 돌려도 안전하다. 능력치·확률은 그대로이고 `patterns` 안에 `name`만 추가된다.)

### (3) 소리 기본값 마이그레이션 — 사용자가 이미 실행함 ✅

`202607280001_default_audio_levels_v3.sql` (배경음 15 / 효과음 60). 사용자가 "하라는 건 다 했다"고 확인함.

---

## 3. 사용자 결정 대기 — "도망 실패"

예전에는 도망에 **실패 확률**이 있었고 실패하면 몬스터에게 반격을 맞았다. 지금은 누르면 무조건 성공한다.

**왜 아직 안 했나:** 구조가 갈라져 있다.
- 전투 계산 = **Edge Function(JS)** 의 `resolveTurn`
- 도망 = **PostgreSQL 함수** `private_surrender_student_combat_v3` (약 67줄, 세션 삭제 + HP 저장만)

실패 반격을 넣으려면 둘 중 하나가 필요하다.
- **(가)** SQL 안에 몬스터 공격 계산을 새로 짠다 → 실제 전투 공식과 따로 놀 위험
- **(나)** "적 턴만 실행"을 빼내도록 전투 처리 구조를 손본다 → 이미 배포된 핵심 로직 수정

Claude의 추천은 **보류**였고 사용자에게 물어본 상태에서 세션이 끝났다. **먼저 물어보고 진행할 것.**

---

## 4. 이 프로젝트에서 반드시 알아야 할 함정 (실제로 다 밟았다)

### ① `game.js`는 패치 체인 — "마지막 살아있는 정의"만 유효
같은 함수가 v13~v38까지 여러 번 덮어써진다. 위쪽 정의를 고치면 **아무 일도 일어나지 않는다.**
실제로 확인하려면 jsdom으로 부팅해서 `window.함수이름.name` 을 찍어보는 게 가장 확실하다.

```js
// tools/browser-smoke/harness.js 를 써서 확인 가능
```

### ② IIFE 스코프 밖 호출 → ReferenceError
`triggerScreenShakeV19`는 v19 패치 블록 안에 있어서 v17 블록에서 부르면 터졌다.
→ `window.xxx = xxx` 로 노출하고 `window.xxx?.()` 로 부르는 방식으로 고쳤다.

### ③ 연출 재생기는 `type` 없는 알림을 **전부 버린다**
`YuksamCombatRules.buildCombatSequence`는 `COMBAT_EVENT_ORDER`에 있는 `type`만 통과시킨다.
이번 세션 최대 사고("전투 과정이 통째로 사라짐")의 원인이 정확히 이것이었다.
→ `tests/combat-log-v3.test.mjs`의 **"the whole battle log survives the sequence builder"** 검사가 이걸 지킨다. 절대 지우지 말 것.

### ④ 몬스터가 죽어 있으면 연출 큐가 완료 신호를 안 보낸다
`showNext`가 `!fresh.alive`면 `onComplete` 없이 중단한다. 그래서 승리 처리가 안 됐다(HP 0인데 안 죽음).
→ 로그가 끝날 때까지 `monster.alive = true` 로 두고, `finishVictory`가 마지막에 쓰러뜨린다.

### ⑤ 효과(데미지 숫자)는 형식이 까다롭다
`normalizeCombatEffect`가 조건 미달이면 **조용히 null을 반환**한다.
- `player-support` → `kind`('shield'|'heal'|...) 필수, shield/heal은 `amount > 0` 필수
- `monster-status`/`player-status` → `status` 필수, `shadow`는 `stacks > 0` 필수

### ⑥ 간헐적으로 실패하는 검사 (원래 있던 문제, 내 변경 아님)
`tests/combat-flow.test.mjs` 의 *"jsdom combat state changes occur on their matching queued events"* 가 **약 5번에 1번 실패**한다.
- 실패할 땐 **14.4초**, 통과할 땐 **30초** (조기 종료)
- 실패 시 여러 검사가 한꺼번에 **빈 결과**(`[]`, `{}`)로 무너진다 → 준비 단계 타이밍 경합으로 추정
- 17회 중 3회 실패 측정됨. `login-keys` 도입 **이전**에도 실패한 기록이 있어 이번 작업과 무관함이 확인됨
- **전체 검사가 이것 하나로 실패하면 다시 돌려보면 된다.** 다른 게 실패하면 진짜 문제다.

### ⑦ 환경 제약
- **Python 없음** (Windows 스토어 스텁만). openpyxl 등 사용 불가. 엑셀은 `jszip`으로 직접 생성했다(`시트/퀘스트_문구_검토용.xlsx`).
- **`@oai/artifact-tool`은 이 환경에서 빈 시트만 내보낸다.** 쓰지 말 것.
- Git Bash가 **한글 인자를 깨뜨린다.** 한글이 들어가는 curl/node 호출은 반드시 **파일로 전달**할 것. (이것 때문에 "한글 이름 가입 실패"라는 잘못된 진단을 한 적 있음)
- jsdom은 `.codex_work/browser-smoke/node_modules/jsdom` 에 있다.

---

## 5. 사용자가 명시적으로 요구한 작업 방식

- **브라우저 미리보기를 띄우지 말 것.** 게임이 자동 실행되며 소리가 나서 방해된다. 검증은 `node --run test`와 jsdom 스모크로만. 사용자는 직접 주소로 접속해 확인한다.
- **비개발자다.** 개발 용어 빼고 쉬운 말로 설명할 것.
- 배포는 **매번 물어보고** 진행했다.
- 새 기능은 `game.js`에 덧붙이지 말고 `src/` 모듈로 분리 (프로젝트 CLAUDE.md 규칙).
- 검사 추가 시 `tools/run-baseline.ps1`과 `package.json` 둘 다 갱신.

---

## 6. 이번 세션에서 만든 것 (모두 배포 완료)

| 모듈 | 역할 |
|---|---|
| `src/combat-log-v3.js` | **서버 전투 결과 → 예전 연출 지시서 번역** (핵심) |
| `src/login-keys.js` | 로그인창 Enter |
| `src/quest-dialogue-theme.js` | 퀘스트 대화창 색 구분 |
| `src/workbook-import.js` | 엑셀 붙여넣기·CSV 문제 등록 |
| `src/chatgpt-prompt.js` | ChatGPT에 넣을 문장 생성 |
| `src/audio-defaults.js` | 소리 기본값 한 곳에서 관리 (15/60) |
| `src/remote-motion.js` | 다른 학생 움직임 부드럽게 |

**AI 문제집은 API 유료라 사용자가 취소했다.** 대신 ChatGPT 웹에서 문제를 만들어 CSV로 붙여넣는 방식으로 확정. 가짜 AI 버튼은 제거하고 "ChatGPT 문장 복사" 버튼으로 교체함.

---

## 7. 남은 일 (우선순위 순)

1. **1번 커밋·푸시** + **2번 Supabase 작업 안내**
2. **사용자 실플레이 확인** — 전투 연출이 예전 느낌인지 (속도/순서/빠진 연출). 사용자가 계속 피드백을 주고 있다.
3. **도망 실패** — 3번 결정 후
4. `tests/combat-flow.test.mjs` 간헐 실패 고치기 (급하지 않음)
5. 실제 브라우저 다기기 검증 — `docs/server-authority-v3-cutover-checklist.md`의 미체크 항목들. **28명 동시 접속·보안 검증은 아직 한 번도 안 했다.**

---

## 8. 참고 문서

- `docs/프로젝트_전체설명_2026-07-27.md` — 비개발자용 전체 설명 (기능·폴더·인프라)
- `docs/server-authority-v3-cutover-checklist.md` — 서버 전환 체크리스트(미완 항목 있음)
- `CLAUDE.md` (상위 폴더) — 프로젝트 규칙

**주의:** 실제 프로젝트 폴더는 `바탕화면\63world (1)\63world` (안쪽). 바깥은 껍데기다.
GitHub: `github.com/jineegood/63world`, 작업 브랜치 `local-latest-20260723` → `origin/main` 으로 푸시.
