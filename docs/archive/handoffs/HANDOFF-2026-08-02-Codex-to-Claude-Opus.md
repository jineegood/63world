# 63world 인수인계 — Codex → Claude Opus (2026-08-02)

이 문서는 새 Claude Opus 채팅이 이전 대화를 읽지 않아도 바로 이어서 작업할 수 있도록 만든 최신 인수인계다.

## 1. 가장 먼저 알아야 할 경로와 주소

- 실제 작업 폴더: `C:\Users\fiost\Desktop\63world (1)\00_63월드_새배포본`
- Git 브랜치: `recovery/local-engine-20260726`
- 이번 핵심 기능 커밋: `4f8fc2c feat: rebalance realtime raid rounds`
- 직전 기준 커밋: `ef8d99b feat: polish realtime raid presentation`
- GitHub: `https://github.com/jineegood/63world`
- GitHub 최신 복구본 브랜치: `origin/recovery/local-engine-20260726` (`075b34a`까지 업로드 완료)
- 배포 게임: `https://63world.vercel.app`
- 로컬 확인 주소: `http://127.0.0.1:8765/`
- Supabase project ref: `eabxfedywcxbnfyyufcs`
- Vercel project: `63world`

제작자는 비개발자다. 설명은 쉬운 한국어로 짧게 하고, 작업이 끝날 때 로컬 주소와 배포 주소를 함께 알려 주는 편이 좋다. 계획 문서를 길게 만들거나 사소한 선택을 계속 되묻는 방식을 싫어한다. 합리적으로 판단 가능한 것은 바로 구현·검사·배포까지 이어서 한다.

## 2. 이번 작업에서 받은 요구와 완료 상태

### 완료 — 쓰러진 학생의 다음 조우 복귀

기존 문제는 화면에서 HP 1로 일으켜도 서버에 직전 HP 0이 남을 수 있었다는 점이다. 그 결과 다음 몬스터에서 다시 쓰러진 학생으로 처리되는 경우가 있었다.

수정 내용:

- 몬스터를 쓰러뜨려 다음 이동 단계로 바뀌는 순간, 쓰러졌던 파티원을 HP 1로 먼저 부활시킨다.
- 그 상태를 서버 `memberStates`에 저장하므로 세 기기 모두 다음 전투에서 정상 참가한다.
- 마지막 보스를 잡아 던전을 끝낸 경우에는 불필요하게 부활시키지 않는다.
- 관련 파일: `src/raid-run.js`

### 완료 — 쓰러진 동안 쿨타임 정지

- `src/raid-combat-rules.js`의 `tickCooldowns`는 HP 0인 학생을 건너뛴다.
- 쓰러진 학생은 공격, 피격 대상, 재생, 쿨타임 감소에서 제외된다.
- 다음 몬스터에서 HP 1로 돌아오면 그때부터 다시 정상적으로 턴과 쿨타임이 진행된다.
- 해당 동작은 자동 검사로 고정되어 있다.

### 완료 — 파티원마다 서로 다른 문제

이전에는 방 전체가 `question_public` 하나와 정답 하나를 공유했다. 지금은 라운드마다 활성 문제집에서 서로 다른 문제 3개를 고른다.

동작:

1. 방장이 활성 문제집에서 중복되지 않은 문제 3개를 고른다.
2. 학생 UUID별로 문제와 정답을 각각 묶어 서버로 보낸다.
3. 서버는 각 학생에게 자기 문제만 내려 준다.
4. 답 제출 시 서버가 그 학생 전용 정답으로 판정한다.
5. 세 답이 모이면 기존처럼 방장이 전투 결과를 계산하고 발행한다.

활성 문제가 3개 미만이면 던전을 억지로 시작하지 않고 `던전에는 서로 다른 활성 문제 3개 이상이 필요합니다`라고 안내한다.

관련 파일:

- `src/raid-run-ui.js`
- `supabase/functions/_shared/raid-room-service.mjs`
- `supabase/functions/_shared/raid-room-store.mjs`
- `supabase/migrations/202608020001_raid_individual_questions_v1.sql`
- `tests/raid-multiplayer-integration.test.mjs`
- `tests/raid-room-backend.test.mjs`

서버 반영 상태:

- 위 migration은 2026-08-02에 원격 DB에 적용 완료했다.
- `raid-room-v1` Edge Function 배포 완료했다.
- 정답 묶음은 일반 학생에게 노출하지 않고, 모든 답 제출 후 결과를 발행해야 하는 방장에게만 돌려준다.

### 완료 — 던전 몬스터 피해와 연속 공격

공통 규칙:

- 모든 던전 몬스터 실제 피해에 `1.6배`를 적용했다. 즉 60% 강화다.
- 단일 집중 공격 보너스를 `1.35배 → 1.6배`로 올렸다.
- 자리 피해 배율은 기존대로 앞 `1.5`, 가운데 `1.0`, 뒤 `0.6`이다.
- 단일 공격은 가장 앞에 있는 생존자를 노리므로 특히 앞자리가 강하게 맞는다.

1–10층 현재 패턴:

- 경비 로봇: 단일 → 단일 → 전체 2타
- 사무실 유령: 단일 → 전체 2타 → 단일
- 정전 그림자: 전체 2타 → 전체 1타 → 단일
- 63빌딩 관리자: 단일 → 전체 2타 → 단일 → 전체 3타 → 전체 1타

전체 2타/3타는 각 타격마다 반드시 `앞 → 가운데 → 뒤` 순서로 재생된다. 중간에 쓰러진 학생은 다음 연속 타격에서 제외된다.

관련 파일:

- `src/raid-rules.js`: 공통 배율, 몬스터 수치, 패턴, `attackPlanForRound`
- `src/raid-combat-rules.js`: 2타/3타 실제 처리
- `src/raid-run.js`: 라운드의 공격 계획 전달

### 완료 — 피해/회복 숫자 연출

- 던전의 `-숫자`, `+숫자`, 보호막 숫자를 더 굵게 했다.
- 외곽선과 그림자를 보강했다.
- 표시 시간과 페이드아웃을 1초에서 2초로 늘렸다.
- 관련 파일: `src/raid-run-ui.js`

### 완료 — 던전 체력창 톤다운

- 앞 초록, 가운데 노랑, 뒤 파랑 구분은 유지했다.
- 배경과 테두리의 채도·밝기를 낮춰 덜 쨍하게 바꿨다.
- 관련 파일: `src/raid-run-ui.js`

### 완료 — PVP 피해 절반과 설명

- 친선 PVP에서 모든 공격 피해는 원래 계산값의 50%가 된다.
- 오답이면 PVP 절반 피해에서 다시 절반이므로 원래 공격의 25%가 된다.
- 보호막 강타처럼 피해를 주는 스킬에도 같은 공통 배율이 적용된다.
- 대전 신청 설명에 `PVP에서는 모든 공격 데미지가 50%로 적용됩니다.`를 추가했다.
- `pvp-match-v1` Edge Function을 2026-08-02에 배포 완료했다.

관련 파일:

- `supabase/functions/_shared/pvp-rules.mjs`
- `src/pvp-ui.js`
- `tests/pvp-rules.test.mjs`

## 3. 제작자가 직접 수정할 몬스터 엑셀

엑셀 파일:

`C:\Users\fiost\Desktop\63world (1)\00_63월드_새배포본\outputs\raid_monster_sheet_20260802\63빌딩_1층_몬스터_밸런스_시트.xlsx`

미리보기:

`C:\Users\fiost\Desktop\63world (1)\00_63월드_새배포본\outputs\raid_monster_sheet_20260802\몬스터_설정_미리보기.png`

사용법:

- `몬스터 설정` 시트의 노란색 칸만 수정한다.
- 체력, 기본 공격력, 패턴 1–5를 바꿀 수 있다.
- 오른쪽 칸은 앞/가운데/뒤 예상 피해가 자동 계산된다.
- 엑셀만 저장해도 게임이 자동으로 바뀌는 것은 아니다.
- 제작자가 수정한 파일을 다시 보내면 `src/raid-rules.js`의 네 몬스터 정의에 반영한다.

현재 Excel 수식은 방어력, 치명타, 보호막을 적용하기 전의 기본 예상 피해다. 공격 패턴 선택지는 `단일 1타`, `전체 1타`, `전체 2타`, `전체 3타`다.

## 4. 서버 구조 — 다음 작업자가 반드시 지킬 것

일반 사냥터 전투와 던전/PVP의 구조가 다르다.

- 일반 사냥터 전투: 복구본의 로컬 전투 엔진 중심
- PVP: Supabase 서버가 문제, 주사위, 피해, 승패를 판정
- 3인 던전: Supabase가 방·개별 문제·정답 판정·동기화 상태를 맡고, 방장 브라우저가 순수 던전 전투 엔진으로 라운드 결과를 계산해 발행

던전의 신뢰 경계:

- 학생이 보낸 공격력/체력은 신뢰하지 않는다.
- 서버의 `player_profiles_v2`에서 권위 프로필을 다시 만든다.
- 문제 정답은 `raid_question_secrets_v1`에 저장하며 학생 테이블 권한으로 읽을 수 없다.
- 방장만 전투 결과 발행 RPC를 호출할 수 있다.
- 발행할 학생 ID가 실제 방 참가자인지 DB가 검사한다.

이번 변경을 되돌리거나 서버 함수를 옛 버전으로 배포하면 세 학생의 문제가 다시 같아지거나 제출 판정이 실패한다. DB migration과 `raid-room-v1` 코드는 한 쌍이다.

## 5. 배포 명령

Supabase CLI는 전역 설치가 아니라 npx로 사용했다. PowerShell 실행 정책 때문에 `npx`가 아니라 `npx.cmd`를 직접 호출한다.

```powershell
& 'C:\Program Files\nodejs\npx.cmd' --yes supabase@latest db push --linked
& 'C:\Program Files\nodejs\npx.cmd' --yes supabase@latest functions deploy raid-room-v1 --project-ref eabxfedywcxbnfyyufcs
& 'C:\Program Files\nodejs\npx.cmd' --yes supabase@latest functions deploy pvp-match-v1 --project-ref eabxfedywcxbnfyyufcs
```

Vercel:

```powershell
vercel.cmd --prod --yes
```

GitHub 복구본 브랜치:

```powershell
git push origin recovery/local-engine-20260726
```

주의: 2026-08-02 현재 원격 `main`은 이 복구본과 공통 조상은 있지만, 한때 진행했다가 버린 대규모 서버 권위형 작업 이력이 별도로 올라가 있어 단순 fast-forward가 아니다. 안전을 위해 `main`을 force push로 덮어쓰지 않았다. 현재 올바른 최신 게임은 `recovery/local-engine-20260726` 브랜치이며, Vercel production은 이 로컬 복구본에서 직접 배포했다. 다음 작업자도 제작자 확인 없이 `origin/main`을 merge하거나 복구본으로 강제 덮어쓰지 말 것.

## 6. 검사 결과

2026-08-02에 다음 검사를 완료했다.

- 던전/PVP/서버 관련 표적 검사: 139개 전부 통과
- 전체 `npm.cmd test`: 통과
- 몬스터 Excel: 렌더링 확인 완료
- Excel 수식 오류 검색: `#REF!`, `#DIV/0!`, `#VALUE!`, `#NAME?`, `#N/A` 없음
- Supabase DB migration 원격 적용 완료
- `raid-room-v1` 배포 완료
- `pvp-match-v1` 배포 완료
- GitHub `recovery/local-engine-20260726` 브랜치에 `075b34a`까지 업로드 완료
- Vercel production 직접 배포 완료, `https://63world.vercel.app` HTTP 200 확인

## 7. 다음 작업에서 실제 브라우저로 꼭 확인할 것

자동 검사는 모두 통과했지만 실제 크롬 3개로 다음 한 번은 확인하는 것이 좋다.

1. 서로 다른 학생 계정 3개로 4자리 초대 코드 입장
2. 각 화면에서 같은 라운드 문제가 서로 다른지 확인
3. 한 학생을 첫 몬스터에서 쓰러뜨린 뒤 다음 몬스터에서 HP 1로 정상 문제 풀이가 가능한지 확인
4. 쓰러져 있던 라운드 동안 해당 학생 스킬 쿨타임이 줄지 않았는지 확인
5. 경비 로봇 3번째 패턴의 전체 2타가 앞→가운데→뒤, 다시 앞→가운데→뒤로 재생되는지 확인
6. 보스의 전체 3타가 지나치게 강한지 체감 확인
7. PVP에서 예전보다 피해가 정확히 절반쯤 줄고 한 방 결판이 감소했는지 확인

던전 수치는 제작자가 엑셀로 다시 조정할 예정이므로, 체감 난이도 의견이 나오면 즉시 코드를 임의로 재수정하기보다 수정된 Excel을 먼저 확인한다.

## 8. 현재 알려진 주의점

- 던전에서 활성 문제는 최소 3개가 필요하다.
- 60% 피해 강화와 2타/3타 패턴이 동시에 들어갔으므로 보스는 상당히 강할 수 있다. 이것은 이번 제작자 요구대로 넣은 상태다.
- Excel 출력 폴더는 `.gitignore`에 의해 GitHub에는 올라가지 않을 수 있으므로 로컬 파일을 보존한다.
- Docker가 꺼져 있다는 Supabase 경고가 나왔지만 원격 함수 배포에는 문제가 없었다.
- 실제 교실 28명 동시 환경의 장시간 부하 검사는 아직 하지 않았다.

## 9. 이전 인수인계 문서

전체 게임의 더 오래된 기능, 보안 구조, PVP 30초 동기화, 퀘스트와 UI 작업은 아래 문서에 상세히 남아 있다.

`docs/archive/handoffs/HANDOFF-2026-07-31-Codex-to-Claude-Opus.md`

새 작업자는 이 문서를 먼저 읽고, 과거 배경이 더 필요할 때 7월 31일 문서를 이어서 보면 된다.

## 10. 제작자에게 보고할 때 쓸 짧은 요약

`쓰러진 학생의 다음 전투 HP 1 복귀와 쿨타임 정지, 세 명의 서로 다른 문제, 던전 몬스터 60% 강화와 2·3연속 전체 공격, 전투 숫자·체력창 정리, PVP 피해 절반을 완료했습니다. 서버와 전체 검사도 통과했고, 직접 수정할 몬스터 엑셀과 오푸스 인수인계 문서도 준비했습니다.`
