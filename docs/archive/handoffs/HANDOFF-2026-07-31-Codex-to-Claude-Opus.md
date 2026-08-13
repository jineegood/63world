# 63world 인수인계 — Codex → Claude Opus

작성일: 2026-07-31  
대상: 새 Claude Opus 채팅  
작성 기준 기능 커밋: `00ef969` (`fix: polish pvp feedback chat and pet shop entry`)

## 0. 새 채팅에서 가장 먼저 읽을 내용

이 문서는 비개발자 제작자와 Codex가 복구본을 기준으로 진행한 작업 전체를 요약한 문서다.

현재 실제 작업본은 아래 폴더다.

```text
C:\Users\fiost\Desktop\63world (1)\00_63월드_새배포본
```

반드시 이 폴더에서 작업해야 한다. 바탕화면의 다른 63world 폴더, 예전 작업 보관 폴더, `origin/main`을 현재 정답으로 착각하면 안 된다.

현재 Git 정보:

```text
remote: https://github.com/jineegood/63world.git
branch: recovery/local-engine-20260726
기능 기준 HEAD: 00ef969
```

현재 서비스 주소:

- 실제 게임: https://63world.vercel.app
- 로컬 확인: http://127.0.0.1:8765/
- Supabase project ref: `eabxfedywcxbnfyyufcs`
- Vercel project: `63world`

중요: `origin/main`은 서버 권위형 일반 전투를 크게 적용했던 예전 흐름이다. 그 과정에서 전투 연출, 체력 타이밍, 스킬, 도망 등 여러 게임 기능이 무너져서 제작자가 2026-07-26 복구본으로 돌아오기로 결정했다. 현재 배포 기준은 `recovery/local-engine-20260726` 브랜치다. 임의로 `main`을 병합하거나 현재 브랜치를 `main` 내용으로 덮지 말 것.

## 1. 제작자의 방향과 꼭 지킬 원칙

제작자는 비개발자다. 설명은 쉬운 한국어로 짧게 하고, 기술 선택이 필요할 때만 이유를 설명한다.

작업 방식:

1. 긴 설계 문서나 계획을 매번 먼저 요구하지 않는다.
2. 안전하게 추론 가능한 것은 바로 구현하고 검사한다.
3. 변경 후에는 GitHub 저장과 Vercel 실제 배포까지 마무리한다.
4. 답변 마지막에는 항상 실제 주소와 로컬 주소를 준다.
5. 현재 완벽한 복구본의 기존 전투 감각과 UI를 함부로 재설계하지 않는다.
6. `game.js`는 패치가 여러 겹 쌓인 대형 파일이므로, 같은 이름의 예전 함수가 아니라 실제로 마지막에 살아 있는 함수/등록기를 확인한다.
7. 일반 몬스터 전투를 다시 서버 권위형으로 옮기지 않는다. 제작자가 명시적으로 다시 요청하기 전에는 현재 복구 방식 유지가 우선이다.
8. PVP는 조작 방지를 위해 서버가 판정하고, 화면은 기존 일반 전투처럼 보여주는 혼합 구조를 유지한다.

## 2. 현재 서버와 로컬의 역할 구분

### Supabase 서버가 담당

- 학생/교사 로그인과 세션
- 학생 저장 데이터의 클라우드 동기화
- 교사 대시보드의 학생 관리, 비밀번호 재설정, 계정 삭제
- 교사 치트의 서버 적용
- 문제집과 수업 설정 공유
- 학생 위치·채팅·춤·펫 등 Realtime 전달
- PVP 초대, 수락, 매치, 주사위, 정답 판정, 피해, 스킬, 쿨타임, 승패
- PVP 접속 상태와 재접속 유예
- PVP 기록 및 보안 정책

### 브라우저가 담당

- 월드 이동과 충돌
- 일반 몬스터 전투의 계산·연출
- 퀘스트, 튜토리얼, 상점, 펫, 강화의 대부분 화면 흐름
- 애니메이션, 효과음, 배경음, 전투 로그 표시
- PVP 서버가 보내 준 결과의 순차 재생

즉, 일반 전투는 현재 복구본의 쾌적한 로컬 전투다. PVP만 서버가 진짜 결과를 결정한다.

Supabase 원격에는 과거 `student-combat-v3` 함수가 남아 있지만, 현재 복구본 소스에는 해당 함수 폴더가 없고 일반 전투에서도 호출하지 않는다. 명시적인 요청 없이 다시 연결하지 말 것.

## 3. 핵심 파일 지도

- `index.html`: 화면 뼈대와 스크립트 로드 순서
- `style.css`: 전체 게임 및 PVP UI
- `game.js`: 월드, 일반 전투, 퀘스트, 상점, 펫, 강화 등 오래된 핵심 코드
- `src/game-data.js`: 직업·스킬·아이템·몬스터·맵 기본 데이터
- `src/quest-data.js`: 퀘스트 데이터와 대사
- `src/quest-text.js`: 퀘스트 중요 단어 강조
- `src/patch-data.js`: 펫·후반 맵 등 패치 데이터
- `src/pvp-client.js`: 인증된 PVP Edge Function 호출과 Realtime 구독
- `src/pvp-ui.js`: 다른 캐릭터 오른쪽 클릭 프로필, 대전 신청/수락 UI
- `src/pvp-battle.js`: 일반 전투 화면을 재사용하는 PVP 화면과 이벤트 재생
- `src/multiplayer.js`: 위치, 채팅, 춤, 펫 Realtime 송수신·렌더링
- `src/click-movement.js`: 마우스 이동 경로 계산
- `src/world-interaction-registry.js`: 현재 상호작용 후보와 행동의 최종 연결점
- `src/world-navigation-registry.js`: 맵 충돌과 자동 출입 전환
- `src/admin-dashboard.js`: 교사 대시보드와 문제집 관리
- `src/admin-auth-v2.js`, `src/admin-data-v2.js`: 교사 인증과 서버 관리 작업
- `src/production-guard.js`: 배포 환경 개발자도구 단축키 억제(완전한 보안 기능은 아님)
- `supabase/functions/pvp-match-v1/`: PVP 서버 진입점
- `supabase/functions/_shared/pvp-*.mjs`: PVP 서버 규칙·저장·프로필·오류 처리
- `supabase/functions/teacher-apply-cheat/`: 교사 치트 서버 적용
- `supabase/migrations/`: 실제 DB 구조와 보안 정책
- `tests/`: 정적 검사와 jsdom/브라우저 스모크 검사
- `tools/browser-smoke/`: 실제 게임 로드에 가까운 상호작용 검사

스크립트는 `index.html`의 순서대로 전역 객체를 공유한다. ES module 번들 프로젝트가 아니다. 새 파일을 만들면 `game.js`보다 먼저 필요한지, 뒤에 필요한지를 확인해야 한다.

## 4. 복구본 이후 완료한 주요 작업

### 4-1. 복구 및 일반 전투

- 2026-07-26의 쾌적한 로컬 전투 기반을 새 배포본으로 복구했다.
- 복구 전 새 버전의 화면, 음악, 효과음, 에셋은 보존했다.
- 오답 공격은 0 피해가 아니라 원래 피해의 절반이 들어간다.
- 오답 로그는 `오답입니다! 정답은 ... (오답이라 데미지가 절반만 들어갑니다)` 한 줄로 표시한다.
- 객관식 오답은 정답 선택지를 초록색으로, 주관식은 입력칸에 정답을 초록색으로 2초 동안 보여 준다.
- 보호막 생성량이 소수점 때문에 0이 되지 않도록 최소 1을 보장했다.
- 보호막 피해와 체력 피해 숫자, 피격 흔들림, 효과음 흐름을 복구했다.
- 일반 전투는 해당 맵 음악을 유지하도록 제작자 방향을 반영했다.
- 명진쌤 치유 튜토리얼 공격, 치명타 연출, 체력 1 만들기 흐름을 복구했다.

### 4-2. 튜토리얼·퀘스트·치유의 우물

- 튜토리얼과 퀘스트의 중요 단어·숫자에 초록/노란 강조를 적용했다.
- 치유의 우물 퀘스트와 문제 풀이 회복 흐름을 추가·복구했다.
- E/Enter 진행, 2×2 선택지, 우물 이미지와 로딩 안내를 적용했다.
- 스킬 배우기, 장보기, 코스튬, NPC 첫 만남 등의 초반 안내를 다듬었다.
- 스킬 퀘스트 전에는 스킬 포인트 사용을 막고 명진쌤의 가르침 안내를 띄운다.
- LV5 전 공용 스킬은 선행 조건 없이 자유롭게 찍는 복구 방향을 유지했다.
- 전문화 스킬은 같은 레벨 줄의 좌우 스킬끼리 선행 관계가 없도록 고쳤다.

### 4-3. 마우스 이동·월드 상호작용

- 왼쪽 클릭 자동 이동과 충돌 회피 경로를 연결했다.
- 건물, 포탈, NPC에 마우스로 이동한 뒤 상호작용하는 흐름을 연결했다.
- 마을 포탈, 치유의 우물, NPC 근접 원 표시를 보강했다.
- 펫 상점 입구가 마우스 도착 뒤 열리지 않던 마지막 누락을 `00ef969`에서 해결했다.

### 4-4. Realtime 멀티플레이

- 같은 맵의 학생 위치와 부드러운 이동을 Realtime으로 표시한다.
- 채팅과 말풍선을 서로 볼 수 있다.
- 춤 상태도 서로 보인다.
- 장착 중인 펫 ID와 바라보는 방향을 전송하고, 다른 학생의 펫도 실시간으로 그린다.
- 2026-07-31에 펫 실시간 표시를 추가했다.

### 4-5. PVP 전체

- 다른 학생을 오른쪽 클릭하면 얼굴 확대 프로필, 레벨, 직업, 전문화, 승패가 보인다.
- 프로필 창에서 마을에 있는 접속 학생에게 대전을 신청한다.
- 상대가 수락하면 서버 매치가 생성된다.
- 두 학생은 같은 문제를 풀며, 먼저 제출해도 공격 순서가 앞서지 않는다.
- 매 라운드 30면체 주사위를 굴리고 높은 학생부터 공격한다. 동점이면 다시 굴린다.
- 일반 몬스터 전투와 같은 캐릭터 배치, 체력창, 스킬, 전투 로그, 효과음, 연출을 사용한다.
- 실제 캐릭터의 레벨, 체력, 공격력, 방어력, 스킬과 쿨타임을 서버 프로필에서 가져온다.
- 항복은 서버에서 승패 1회만 기록한다.
- 승자는 PVP 승리 음악, 패자는 강화 실패 음악을 듣는다.
- PVP 중에는 전용 전투 음악을 반복 재생한다.
- 개인 상태창에도 PVP 전적이 나온다.
- 매치/이벤트/초대 테이블은 RLS와 service-role 전용 RPC로 보호한다.
- 같은 요청 재시도, 중복 이벤트, 새로고침 복구, 상대 접속 끊김 유예를 처리한다.
- 교실 환경에서 잠시 늦는 Realtime 신호를 오프라인으로 오판하지 않도록 presence 유예를 90초로 조정했다.
- 같은 브라우저의 두 탭에서 서로 다른 테스트 계정을 쓸 수 있도록 학생 인증을 `sessionStorage` 기준으로 분리했다.
- 2026-07-31에 모든 PVP 전투 로그를 기존보다 1초씩 더 보여 주도록 변경했다.
- 2라운드부터 시간이 10초 정도만 남던 원인을 해결했다. 두 기기의 주사위·공격 로그가 모두 끝났다고 서버에 알린 뒤에 정확한 새 30초를 시작한다.
- PVP 서버 함수 현재 원격 버전은 배포 시점 기준 `pvp-match-v1` version 14다.

### 4-6. 교사 화면과 보안

- 배포 주소에서도 교사 로그인을 사용할 수 있다.
- 교사 치트는 브라우저 값만 바꾸지 않고 `teacher-apply-cheat` 서버 함수를 거쳐 저장한다.
- 교사만 학생 삭제, 비밀번호 재설정, 치트 사용이 가능하게 서버 검사를 둔다.
- 생산 환경에서 F12, Ctrl+Shift+I/J/C, Ctrl+U를 막는 억제 기능을 넣었다. 이것은 불편하게 만드는 장치이지 절대적인 보안은 아니다.
- 민감한 학생 프로필 필드 노출을 검사하는 보안 감사와 대시보드 알림을 추가했다.
- 학생 여러 명 선택 삭제, 문제 여러 개 선택 삭제, 문제집 서버 동기화 기능이 있다.
- 현재 AI 문제집 기능은 직접 생성 기능이 아니다. “ChatGPT에 붙여넣을 문장 복사”까지만 구현되어 있다.

### 4-7. 상태창·UI·음악

- 캐릭터 생성 시 “새 캐릭터를 생성합니다” 안내를 복구했다.
- 상태창 이름을 제목 옆 초록 상자에 두고 레벨/직업/전문화/PVP 전적을 정리했다.
- 골드·빌딩·스킬 포인트 가시성을 높였다.
- 스킬창 아래 액티브 스킬 카드 너비를 줄였다.
- 로그인 음악은 캐릭터 생성 화면까지 유지한다.
- PVP 시작·종료 음악과 결과 효과음을 연결했다.

## 5. 2026-07-31 마지막 요청에서 방금 완료한 작업

기능 커밋 `00ef969`에 포함:

1. 채팅 입력 중 스페이스바가 공격키로 가로채지 않도록 수정했다.
2. PVP 피해 로그를 아래 형식으로 변경했다.

```text
A 학생이 B 학생에게 총 15의 피해를 주었습니다! (보호막 7, 체력 8)
```

3. 보호막과 체력이 동시에 깎이면 회색 보호막 숫자와 빨간 체력 숫자를 서로 겹치지 않게 두 개 띄운다.
4. PVP 오답 시 객관식 정답 선택지 또는 주관식 정답칸을 초록색으로 정확히 2초 보여 준 뒤 공격을 재생한다.
5. PVP 시작 시 두 학생 이름, 큰 VS, `전투 시작!`이 나오는 1.8초 연출을 추가했다. 연출은 포인터 입력을 막지 않는다.
6. `빌딩 화폐 상점`의 사용자 표시 이름을 전부 `특별 상점`으로 변경했다.
7. 펫 상점 입구가 마우스 이동 도착 후 열리지 않던 상호작용 등록 누락을 해결했다.

## 6. PVP 30초 동기화 구현 메모

관련 파일:

- `src/pvp-battle.js`
- `src/pvp-client.js`
- `supabase/functions/_shared/pvp-service.mjs`
- `supabase/functions/_shared/pvp-store.mjs`
- `supabase/functions/pvp-match-v1/index.ts`
- `supabase/migrations/202607310002_pvp_round_ready_timer_v1.sql`

DB의 `player_a_ready_round`, `player_b_ready_round`, `timer_started_round`를 사용한다.

라운드 결과를 서버가 만든 직후에는 60초짜리 안전 대기 시간을 넣는다. 양쪽 브라우저가 전투 로그를 모두 재생한 후 `ready`를 호출하면 `private_mark_pvp_round_ready_v1` RPC가 두 사람 준비 여부를 잠금 상태에서 확인하고, 둘 다 준비됐을 때 `question_deadline = ready_at + 30 seconds`로 바꾼다.

이 구조를 단순히 클라이언트 타이머 30초로 되돌리면 한쪽 기기의 긴 연출이 다시 문제 풀이 시간을 먹는다.

## 7. 현재 DB/Edge Function 상태

최근 적용된 중요 migration:

- `202607290005_pvp_round_resolution_lock_v2.sql`
- `202607300001_pvp_v2_finish_compatibility.sql`
- `202607300002_pvp_invite_match_lock_v2.sql`
- `202607300003_profile_security_audit_v1.sql`
- `202607310001_pvp_presence_grace_v1.sql`
- `202607310002_pvp_round_ready_timer_v1.sql`

현재 로컬 Edge Function:

- `pvp-match-v1`
- `teacher-apply-cheat`
- `teacher-delete-student`
- `teacher-reset-password`

Supabase 원격에는 위 함수 외 과거 함수가 남아 있을 수 있다. 로컬 폴더에 없는 함수를 무작정 재배포하지 말 것.

DB migration 또는 Edge Function을 실제로 수정했을 때만:

```powershell
npx.cmd supabase db push --linked
npx.cmd supabase functions deploy pvp-match-v1 --project-ref eabxfedywcxbnfyyufcs
```

서비스 키, access token, 비밀번호는 문서나 Git에 기록하지 않는다.

## 8. 검사 상태

마지막 기능 변경에서 통과한 검사:

```powershell
npm.cmd run check:syntax
npm.cmd run test:baseline
npm.cmd run test:input-router
npm.cmd run test:click-movement-integration
npm.cmd run test:world-interaction-registry
npm.cmd run test:game-data
npm.cmd run test:pvp-battle-ui
npm.cmd run test:pvp-function-v1
npm.cmd run test:pvp-policy-v1
npm.cmd run test:pvp-reconnect-v1
```

특히 `test:pvp-battle-ui`는 25개가 모두 통과하며 다음을 직접 검사한다.

- 시작 VS 연출
- 총 피해와 보호막/체력 분리 로그
- 보호막/체력 숫자 두 개
- 객관식과 주관식 오답 정답 표시 2초
- 주사위와 라운드 재생 순서
- 라운드 준비 후 30초
- 항복과 종료

주의: `npm.cmd test` 전체 장기 검사는 현재 19개가 실패한다. 대부분 `tests/combat-flow.test.mjs`와 예전 브라우저 스모크가 복구 전 서버 권위형/옛 치트/옛 BGM/이전 함수 이름을 기대해서 생기는 오래된 불일치다. 이번 마지막 기능의 관련 검사는 전부 통과했다. 전체 검사를 억지로 초록색으로 만들기 위해 현재 복구 전투를 옛 서버 전투에 맞춰 되돌리면 안 된다. 다음 담당자는 실패 하나씩 “테스트가 오래된 것인지 실제 기능 버그인지” 분류한 뒤 정리해야 한다.

## 9. 아직 남은 일과 실제 기기 확인 항목

### 최우선 실제 확인

두 학생 계정, 가능하면 서로 다른 두 기기에서 다음을 확인한다.

1. 서로 마을에서 보이는지
2. 서로의 춤과 펫이 보이는지
3. 오른쪽 클릭 대전 신청/수락이 되는지
4. PVP 첫 VS 연출이 자연스러운지
5. 두 명이 문제를 푼 뒤 주사위와 공격 로그 순서가 같은지
6. 보호막+체력 동시 피해 숫자가 두 개 보이는지
7. 오답 정답 표시가 두 기기 모두 2초 보이는지
8. 모든 다음 라운드에서 로그가 끝난 뒤 30초가 새로 시작하는지

자동검사는 통과했지만 실제 서로 다른 두 물리 기기에서 마지막 기능까지 직접 플레이한 상태는 아니다.

### 미완성 큰 기능

교사 대시보드에서 AI가 직접 최대 20문제를 생성해 문제집에 넣는 기능은 아직 미완성이다. 현재는 ChatGPT용 프롬프트를 복사하는 기능뿐이다.

제작자가 전에 선택한 방향:

- 교사 화면에서 주제와 개수(최대 20)를 입력
- AI가 바로 문제를 생성
- 교사가 검토한 뒤 문제집으로 저장
- API 키를 브라우저에 넣지 않고 서버 함수에서 사용

다음 담당자는 모델/API 비용이 무료 사용 범위에 미치는 영향과 키 보관 방식을 먼저 확인하고 구현해야 한다.

### 기술 부채

- `README.md`의 날짜와 “브라우저 테스트 없음” 설명은 오래되어 현재 상태와 맞지 않는다.
- `game.js`에는 v17~v60대 패치가 누적되어 있다.
- 전체 `npm test`의 오래된 일반 전투 기대값 19개를 현재 복구 방향에 맞춰 분류·정리할 필요가 있다.
- PVP/Realtime은 실제 교실 와이파이와 28명 환경에서 부하 시험을 하지 않았다.

## 10. 안전한 작업·배포 순서

작업 전:

```powershell
cd "C:\Users\fiost\Desktop\63world (1)\00_63월드_새배포본"
git branch --show-current
git status --short
```

브랜치가 반드시 `recovery/local-engine-20260726`인지 확인한다.

변경 후 최소 검사:

```powershell
npm.cmd run check:syntax
npm.cmd run test:baseline
```

PVP 변경이면:

```powershell
npm.cmd run test:pvp-battle-ui
npm.cmd run test:pvp-client
npm.cmd run test:pvp-function-v1
npm.cmd run test:pvp-policy-v1
npm.cmd run test:pvp-reconnect-v1
```

Realtime 변경이면:

```powershell
npm.cmd run test:multiplayer
```

GitHub:

```powershell
git add -- <수정한 파일>
git commit -m "설명"
git push origin recovery/local-engine-20260726
```

Vercel 실제 배포:

```powershell
npx.cmd vercel --prod --yes
```

배포 후:

- 출력에 `Aliased https://63world.vercel.app` 확인
- `https://63world.vercel.app`가 HTTP 200인지 확인
- 바뀐 JS/CSS가 실제 공개 주소에 올라갔는지 확인
- 제작자에게 두 주소를 제공

## 11. 새 Claude Opus 채팅에 그대로 보낼 첫 문장

```text
C:\Users\fiost\Desktop\63world (1)\00_63월드_새배포본\docs\archive\handoffs\HANDOFF-2026-07-31-Codex-to-Claude-Opus.md 를 처음부터 끝까지 읽고 이어서 작업해줘. 실제 작업 폴더는 00_63월드_새배포본이고 브랜치는 recovery/local-engine-20260726이야. origin/main으로 바꾸거나 일반 몬스터 전투를 서버 권위형으로 되돌리지 말고, 먼저 git status와 현재 배포 상태를 확인해줘.
```

