# 63world 인수인계 — Claude Opus → Codex (2026-08-02)

Codex가 같은 날 쓴 `HANDOFF-2026-08-02-Codex-to-Claude-Opus-LATEST.md`가 **앞으로 할 일의 기준 문서**다.
이 문서는 그 계획과 겹치지 않는 부분, 즉 **Claude가 만든 던전 토대에서 반드시 알아야 할 것과 남긴 구멍**만 적는다.
두 문서가 충돌하면 몬스터·출현 규칙은 Codex 문서를, 아래 "지뢰밭"은 이 문서를 따른다.

## 1. 지금 상태 (확인한 사실)

- 브랜치 `recovery/local-engine-20260726`, 작업 트리 깨끗함
- 최신 커밋 `11960cf` (Codex의 문서 커밋)
- Claude의 마지막 코드 커밋은 `4235682`. 그 뒤 Codex가 실시간 3인 레이드까지 진전시킴
- `npm.cmd test` 전체 통과 — **660개 통과 / 실패 0** (70개 묶음, 끝까지 완주 확인)
- Vercel production 배포됨: https://63world.vercel.app
- DB 마이그레이션 원격 반영 완료 (`supabase db push --linked` 기준 up to date)

### 던전 관련 파일 지도

| 파일 | 역할 |
|---|---|
| `src/raid-rules.js` | 순수 계산. 대형 배율·몬스터·회복·치명타/빗나감 |
| `src/raid-run.js` | 한 판의 진행 상태 기계 (이동 → 전투 → 보스) |
| `src/raid-run-ui.js` | 던전 맵·로비·전투 화면 |
| `src/raid-combat-rules.js` | (Codex) 전투 규칙 |
| `src/raid-entry-ui.js`, `src/raid-party-client.js` | (Codex) 방 만들기·참가·실시간 |
| `src/raid-dungeon.js` | 마을의 63빌딩·명진도사·입장 조건 |
| `supabase/functions/raid-room-v1/` | 방 서버 함수 |
| `tests/raid-*.test.mjs`, `tools/browser-smoke/try_raid_*.js` | 검사 |

## 2. 아직 안 된 것 (Claude가 명시적으로 남긴 구멍)

제작자가 "사냥터 전투와 100% 똑같이"를 요구했고 대부분 맞췄지만 **두 가지는 못 넣었다.**

1. **스킬의 고유 효과가 전혀 반영되지 않는다.**
   던전은 지금 "기본 공격 피해"만 계산한다. 기절·독·냉기·보호막·중첩·흡혈·반격 같은
   상태이상과 스킬 특수효과는 사냥터 전투(`game.js`의 `calculateActionDamageV25` 계열)에만 있고
   던전 규칙(`raid-rules.js`)에는 연결돼 있지 않다.
   → 스킬을 골라도 피해만 들어가고 효과는 안 걸린다.

2. **투사체 연출이 없다.**
   사냥터는 `YuksamCombatFx`로 투사체가 날아가 맞는 순간에 효과음·타격 연출이 난다.
   던전은 피해 숫자와 흔들림만 있고 투사체가 없다.

Codex 문서 5절의 8번 항목(패턴을 구조화된 행동으로 구현)이 사실상 1번과 같은 작업이다.
**이 둘을 할 때 사냥터 코드를 재구현하지 말고 최대한 그대로 호출해 쓰는 방향을 권한다.**
같은 실수를 반복해서 제작자가 여러 번 지적했다.

## 3. 지뢰밭 — 모르면 반드시 다시 밟는다

이 프로젝트에서 실제로 사고가 났던 것들이다. 전부 원인까지 확인했다.

### 3-1. `game.js`의 `const`는 `window`에 없다

`game`, `worldInteractionRegistry`, `worldNavigationRegistry`는 `const`로 선언돼 있어
`window.game`으로 접근하면 **조용히 undefined**가 된다. 반드시 이름으로 직접 찾아야 한다.

```js
const G = () => (typeof game !== 'undefined' ? game : null);
```

반면 최상위 `function` 선언(`openModal`, `savePlayer`, `drawTown` 등)은 `window`에 올라간다.

### 3-2. 효과음 재생 함수 이름은 `window.playMappedAudio`

`playAudioAssetV42` 같은 이름은 **존재하지 않는다.** 예전에 이 이름을 불러서
적 등장 효과음·치명타·빗나감 소리가 전부 안 났다. 매니페스트 소리는 `playMappedAudio(audioId)`.

### 3-3. `showLoadingTransition`은 콜백 뒤에도 modalState를 덮어쓴다

콜백 안에서 창을 열면 약 720ms 뒤 `modalState`가 지워져 조작이 안 먹는다.
로딩이 완전히 걷힌 뒤(약 820ms) 열어야 한다. `raid-run-ui.js`의 `LOADING_TAIL_MS` 참고.

### 3-4. 전투 중 창을 다시 열면 체력바 애니메이션이 죽는다

`openModal`로 매번 다시 그리면 체력바 DOM이 새로 만들어져 CSS transition이 발동하지 않는다.
재생 중에는 **값만 고쳐야** 한다(`updateBattleView()`). 이걸 몰라서 "체력이 한 번에 확 빠진다"는
지적을 받았다.

### 3-5. 몬스터를 죽자마자 `null`로 지우면 화면이 멈춘다

진행 엔진이 `state.monster = null`을 하면 화면 그리기가 곧바로 빠져나가
**마지막 로그와 사망 연출이 통째로 사라지고 게임이 멈춘 것처럼 보인다.**
지금은 `dying` 표시만 하고 다음 몬스터가 나올 때 교체한다.

### 3-6. `confirmFormation`은 검증 함수가 아니다

이름과 달리 진행 상태를 `travel`로 **바꾼다.** 검증만 할 때는 `validateFormation`을 쓰고,
`confirmFormation`은 실제로 출발시킬 때 딱 한 번만 불러야 한다.
(준비 버튼에서 검증용으로 불렀다가 카운트다운이 끝나도 출발하지 못하는 버그가 났다.)

### 3-7. 소스는 CRLF, 테스트의 슬라이스 정규식은 LF 기준

`gameSource.match(/...\n  }\n  function.../)` 형태가 CRLF 때문에 빈 문자열을 뽑는다.
`assert.match`는 실패하고 **`assert.doesNotMatch`는 가짜로 통과한다**(`actual: ''`가 신호).
테스트에서 소스를 읽을 때 `.replace(/\r\n/g,'\n')`을 반드시 걸 것.

### 3-8. 새 스크립트를 만들면 세 곳에 등록해야 한다

`index.html`(game.js 뒤), `tools/run-baseline.ps1`(문법 검사 + 검사 모드 + ValidateSet), `package.json`.
baseline 테스트가 "모든 production 스크립트가 러너에 있는지" 검사하므로 빠뜨리면 바로 실패한다.
ValidateSet은 파일 맨 위 `param(...)` 줄에 있다. 실행 블록의 문자열과 헷갈리지 말 것.

### 3-9. `npm test`는 실패하면 그 지점에서 멈춘다

뒤쪽 검사가 아예 안 돌아간다. 실패 개수만 보고 "나머지는 통과"라고 판단하면 안 된다.

## 4. 밸런스 수치의 뜻 (건드리기 전에 읽을 것)

`src/raid-rules.js` 상단 상수들이다. 서로 물려 있어서 하나만 바꾸면 클리어가 불가능해진다.

| 상수 | 현재 | 뜻 |
|---|---|---|
| `PARTY_POWER` | **1** | 던전 피해 배수. 제작자 요구로 **사냥터와 완전히 같은 피해**여야 하므로 1을 유지할 것 |
| `SINGLE_TARGET_BONUS` | 1.6 | 한 명만 노리는 공격이 전체 공격보다 아픈 정도 |
| `DAMAGE_TAKEN` | 앞 1.5 / 가운데 1.0 / 뒤 0.6 | 대형의 핵심. 이 순서가 뒤집히면 탱커·힐러 역할이 무너진다 |
| `HEAL_RATIO` | 6 | 신성 전문화의 회복 배수 |
| `TRAVEL_RECOVERY` | 0 | 전투 사이 회복 비율. Codex가 0으로 바꿔 둠 |
| `CRIT_CHANCE` / `MISS_CHANCE` | 0.15 / 0.10 | 치명타·빗나감 |

**경고:** 몬스터 체력을 올릴 때마다 클리어가 불가능해지는 일이 반복됐다.
수치를 바꾸면 반드시 시뮬레이션으로 "힐러 있으면 클리어 / 없으면 전멸"을 확인할 것.
`tests/raid-run.test.mjs`에 그 두 가지를 못박은 검사가 있다.

## 5. 작업 절차

```powershell
cd "C:\Users\fiost\Desktop\63world (1)\00_63월드_새배포본"
npm.cmd test                      # 전체. 실패 0이어야 한다
npx.cmd supabase db push --linked --dry-run   # DB 바꿨을 때만, 먼저 dry-run
git add -- <파일>
git commit -m "설명"
git push origin recovery/local-engine-20260726
npx.cmd vercel --prod --yes --cwd "C:\Users\fiost\Desktop\63world (1)\00_63월드_새배포본"
```

배포 후 로컬 파일과 배포본 해시가 같은지 확인하고, 제작자에게 **https://63world.vercel.app** 링크를 준다.

### 제작자가 정한 방식

- **묻지 말고 배포까지 하고 링크를 줄 것.** 제작자는 실서비스를 보고 피드백한다
- `game.js`에 새 기능을 덧붙이지 말고 `src/` 아래 모듈로 분리한다
- game.js 쪽 연결은 호출 시점 참조(늦은 바인딩)로만
- 브라우저 미리보기를 띄우지 말 것 (게임이 자동 실행되며 소리가 난다). 검증은 테스트로만
- `origin/main`을 병합하거나 일반 몬스터 전투를 서버 권위형으로 되돌리지 말 것

## 6. 제작자가 최근에 지적한 것 중 확인이 필요한 항목

Claude가 고쳤다고 보고했으나 **제작자가 실제 화면에서 다시 봐야 확실한 것들**이다.

- 몬스터를 쓰러뜨리는 일격에서 문제·버튼이 남지 않는가 (원인은 3-5, 고쳤지만 실기기 확인 필요)
- 체력바가 로그 한 줄마다 스르륵 줄어드는가 (원인은 3-4)
- 캐릭터가 가만히 있을 때 살짝 움직이는가 (`combat-idle` 클래스)
- 오답 시 정답이 초록색으로 잠깐 보이는가 (`YuksamWrongAnswerReview` 연결)
- 스킬 쿨타임이 실제로 돌아가는가

## 7. Codex에게 바로 보낼 문장

```text
C:\Users\fiost\Desktop\63world (1)\00_63월드_새배포본\docs\archive\handoffs\HANDOFF-2026-08-02-Codex-to-Claude-Opus-LATEST.md 를
기준 계획으로 삼고, docs\archive\handoffs\HANDOFF-2026-08-02-Claude-to-Codex.md 의 "지뢰밭"과 "아직 안 된 것"을 먼저 읽어줘.
17마리 Excel 반영과 층 확장을 이어서 하되, 스킬 고유 효과(기절·독·보호막 등)와 투사체 연출은
사냥터 전투 코드를 재구현하지 말고 그대로 호출해서 붙여줘.
작업이 끝나면 묻지 말고 커밋·푸시·Vercel 배포까지 하고 링크를 줘.
```
