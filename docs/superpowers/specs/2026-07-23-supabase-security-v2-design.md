# Supabase 보안 저장·로그인 v2 설계

## 목표

학생이 지금처럼 이름과 비밀번호를 직접 정해 계정을 만들 수 있게 유지하면서 다음 문제를 제거한다.

- 모든 방문자가 전체 학생 데이터를 읽고 수정할 수 있는 문제
- 학생 비밀번호가 캐릭터 JSON과 관리자 화면에 평문으로 노출되는 문제
- 교사 비밀번호와 관리 기능이 브라우저 데이터만으로 보호되는 문제
- 공개 Realtime 채널에 인증 없이 참여할 수 있는 문제

현재 배포본은 학생 사용 전까지 유지한다. 새 보안 구조는 기존 표와 별도로 추가해 준비하고, 사용자 승인 전에는 GitHub 업로드나 Vercel 재배포를 하지 않는다.

## 선택한 방식

Supabase Auth의 이메일·비밀번호 인증을 사용한다. 학생 화면에는 이메일을 노출하지 않고 이름과 비밀번호만 받는다. 학생 이름을 정규화하고 SHA-256으로 변환해 내부 로그인 ID `student-<sha256>@63world.invalid`를 만든다. Supabase Auth의 이메일 확인은 끄고, 학생이 입력한 실제 이메일은 수집하지 않는다.

로그인 흐름은 다음과 같다.

1. 이름과 비밀번호로 기존 계정 로그인을 시도한다.
2. 계정이 없으면 같은 정보로 신규 가입한다.
3. 같은 이름을 누군가 먼저 만든 경우 기존 비밀번호 없이는 로그인할 수 없다.
4. 인증된 학생에게 발급된 사용자 ID로 자기 캐릭터 행만 읽고 저장한다.
5. 캐릭터 JSON에는 비밀번호를 저장하지 않는다.

Supabase Auth는 비밀번호를 bcrypt 해시로 저장한다. 데이터 접근은 `auth.uid()`와 RLS 정책으로 제한한다.

공식 근거:

- https://supabase.com/docs/guides/auth/passwords
- https://supabase.com/docs/guides/auth/password-security
- https://supabase.com/docs/guides/database/postgres/row-level-security

## 데이터 구조

### `player_profiles_v2`

- `user_id uuid primary key references auth.users(id) on delete cascade`
- `normalized_name text unique not null`
- `display_name text not null`
- `data jsonb not null`
- `updated_at timestamptz not null default now()`

학생은 `user_id = auth.uid()`인 자기 행만 조회·생성·수정할 수 있다. 교사 역할은 전체 행을 조회·수정·삭제할 수 있다.

`data`에는 게임 진행 정보만 저장한다. `password`, Supabase 세션 토큰, 교사 권한 정보는 저장하지 않는다.

### `leaderboard_entries_v2`

- `user_id uuid primary key references auth.users(id) on delete cascade`
- `display_name text not null`
- `score integer not null default 0`
- `level integer not null default 1`
- `appearance jsonb not null default '{}'::jsonb`
- `equipment jsonb not null default '{}'::jsonb`
- `costume jsonb not null default '{}'::jsonb`
- `updated_at timestamptz not null default now()`

로그인한 학생은 명예의 전당에 필요한 이 표만 전체 조회할 수 있다. 자기 행만 생성·수정할 수 있다. 캐릭터 전체 데이터, 오답 기록, 비밀번호는 노출하지 않는다.

### `shared_state_v2`

- `key text primary key`
- `data jsonb not null`
- `updated_at timestamptz not null default now()`

로그인한 학생은 문제집과 서버 열림 상태를 읽을 수 있다. 교사만 생성·수정·삭제할 수 있다. 교사 비밀번호는 이 표에 저장하지 않는다.

## 교사 계정과 관리 기능

교사는 Supabase Auth에 별도 계정을 하나 만든다. 이 계정의 `app_metadata.role`을 `teacher`로 지정한다. 학생이 수정할 수 있는 `user_metadata`는 권한 판단에 사용하지 않는다.

교사 화면은 Supabase 로그인에 성공하고 JWT의 서버 관리 역할이 확인된 경우에만 열린다. 기존 기본 비밀번호 `6363`과 `localStorage`의 `ysb_teacher_v1.pw`는 관리 인증에 사용하지 않는다.

교사는 다음 기능을 사용할 수 있다.

- 전체 학생 진행 정보 조회
- 보상 지급과 계정 삭제
- 문제집과 서버 열림 상태 변경
- 학생 비밀번호 재설정

기존 비밀번호를 보여주는 기능은 제거한다. 비밀번호 재설정은 `teacher-reset-password` Edge Function을 통해 실행한다. 함수는 호출자의 교사 역할을 다시 확인하고, 서버에만 존재하는 관리 키로 학생 Auth 계정의 비밀번호를 변경한다. 관리 키는 브라우저, GitHub, Vercel 공개 변수에 넣지 않는다.

공식 근거:

- https://supabase.com/docs/guides/functions/secrets
- https://supabase.com/docs/guides/database/postgres/row-level-security#helper-functions

## 클라이언트 구성

공식 `@supabase/supabase-js` 클라이언트를 버전을 고정해 프로젝트에 번들한다. 외부 CDN에서 실행 시점마다 코드를 받아오지 않는다.

역할별 모듈을 분리한다.

- `src/auth-v2.js`: 학생·교사 로그인, 세션 복원, 로그아웃
- `src/cloud-sync-v2.js`: 인증된 학생의 자기 캐릭터 저장과 공용 설정 읽기
- `src/admin-auth-v2.js`: 교사 세션 확인과 비밀번호 재설정 함수 호출
- `src/leaderboard-v2.js`: 명예의 전당용 최소 데이터 읽기·쓰기
- `src/multiplayer-v2.js`: 인증된 사용자만 참여하는 Realtime 채널

기존 `src/cloud-sync.js`와 `src/multiplayer.js`는 전환이 끝날 때까지 남겨 두되, v2가 활성화되면 실행하지 않는다. 새 모듈은 `game.js`에 기능을 덧붙이지 않고 `src/` 아래에 둔다.

## 오프라인 동작

이미 로그인한 학생의 캐릭터 캐시는 비밀번호 없이 `localStorage`에 남길 수 있다. 인터넷이 잠시 끊기면 로컬 플레이를 계속하고 연결 복구 후 자기 계정에만 동기화한다.

세션이 없거나 만료된 상태에서 인터넷이 끊기면 신원을 확인할 수 없으므로 신규 로그인과 계정 생성은 막고 명확한 오프라인 안내를 표시한다. 교사 관리 기능도 오프라인에서는 사용할 수 없다.

## Realtime과 채팅

멀티플레이와 채팅은 로그인 세션의 access token을 사용한다. 인증되지 않은 사용자는 채널에 참여할 수 없다. 메시지는 이름·맵·위치·외형·120자 이하 채팅만 포함하고 캐릭터 저장 데이터나 토큰은 포함하지 않는다.

## 단계적 전환

### 1단계: 안전한 추가

새 v2 표, RLS 정책, 교사 함수와 Auth 설정을 기존 Supabase에 추가한다. 기존 `players`와 `shared_state`는 건드리지 않으므로 현재 배포본은 계속 작동한다.

### 2단계: 로컬 구현과 검사

새 인증·저장 모듈과 자동 검사를 로컬 브랜치에서 구현한다. GitHub에는 업로드하지 않는다.

### 3단계: 최종 배포 전 점검

다음 시나리오를 실제 Supabase에서 확인한다.

- 학생 A가 학생 B의 캐릭터를 읽거나 수정할 수 없음
- 로그아웃 사용자는 학생 표와 공용 표를 읽을 수 없음
- 학생은 공용 설정을 수정할 수 없음
- 학생은 교사 함수를 호출할 수 없음
- 교사는 학생 목록 조회와 비밀번호 재설정을 할 수 있음
- 관리자 화면과 데이터 응답 어디에도 기존 비밀번호가 없음

### 4단계: 사용자 승인 후 전환

사용자의 명시적 허락을 받은 뒤 GitHub에 업로드하고 Vercel 배포를 확인한다. 새 배포가 정상 작동하면 기존 `players`·`shared_state`의 공개 정책을 즉시 제거한다. 테스트 계정 외 실제 학생 데이터가 없으므로 기존 표 데이터 마이그레이션은 하지 않는다.

## 오류 처리와 복구

- v2 초기화가 실패하면 자동으로 안전하지 않은 v1 클라우드 저장으로 되돌아가지 않는다. 로그인 화면에 연결 실패를 알리고 로컬 테스트 모드만 명시적으로 선택할 수 있게 한다.
- 배포 전에는 기존 표를 삭제하지 않는다.
- 새 구조에 문제가 생기면 Vercel을 이전 배포로 되돌리고, v2 표는 기존 서비스에 영향을 주지 않은 채 유지한다.
- 전환 후 기존 공개 정책을 다시 여는 방식으로 복구하지 않는다.

## 자동 검사

- 이름 정규화와 내부 로그인 ID가 항상 동일하게 생성되는지 검사
- 캐릭터 저장 JSON에 `password`가 포함되지 않는지 검사
- 학생·교사·로그아웃 상태별 RLS SQL 계약 검사
- 로그인·가입·세션 복원·오프라인 흐름 검사
- 학생 비밀번호 재설정 함수가 교사 역할만 허용하는지 검사
- 명예의 전당 응답에 허용된 필드만 포함되는지 검사
- 전체 기존 게임 테스트와 브라우저 스모크 검사

## 성공 기준

- 학생은 이름과 비밀번호로 자유롭게 계정을 만들고 다시 로그인할 수 있다.
- 학생은 자기 캐릭터만 읽고 저장할 수 있다.
- 비밀번호 원문은 캐릭터 데이터, 관리자 화면, 네트워크 응답에 존재하지 않는다.
- 교사는 전체 관리와 비밀번호 재설정을 할 수 있다.
- 인증되지 않은 사용자는 학생·공용·Realtime 데이터에 접근할 수 없다.
- 기존 게임 자동 검사가 모두 통과한다.
- 사용자 승인 전에는 GitHub·Vercel 배포가 발생하지 않는다.
