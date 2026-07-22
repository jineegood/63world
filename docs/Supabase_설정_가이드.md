# Supabase 동시 접속 설정 가이드 (비개발자용)

이 가이드대로 하면 학생들이 **어느 컴퓨터에서든 자기 계정으로 접속**할 수 있고, 명예의 전당·교사 대시보드·서버 열기/닫기가 학급 전체에 실시간 반영됩니다. 소요 시간 약 10분.

## 0. 미리 알아두기

- 설정 파일(`src/cloud-config.js`)이 비어 있으면 지금까지처럼 각 컴퓨터에만 저장됩니다. 즉 이 작업을 하다 실패해도 게임은 망가지지 않습니다.
- 무료 플랜으로 충분합니다 (30명, 하루 1~2시간 기준 한도의 1%도 안 씀).

## 1. Supabase 프로젝트 만들기

1. https://supabase.com 접속 → **Start your project** → GitHub 계정으로 가입/로그인
2. **New project** 클릭
   - Name: `63world` (아무거나)
   - Database Password: 아무 비밀번호 (기록해두기 — 나중에 쓸 일은 거의 없음)
   - Region: `Northeast Asia (Seoul)` 선택
3. 1~2분 기다리면 프로젝트가 만들어짐

## 2. 데이터베이스 표 만들기 (복사-붙여넣기 한 번)

1. 왼쪽 메뉴에서 **SQL Editor** 클릭 → **New query**
2. 아래 내용을 통째로 붙여넣고 **Run** 버튼:

```sql
-- 학생 캐릭터 저장 표
create table if not exists players (
  name text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- 공용 데이터(교사 설정·문제집) 저장 표
create table if not exists shared_state (
  key text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- 접근 규칙 (교실용: 게임 클라이언트가 읽고 쓸 수 있게)
alter table players enable row level security;
alter table shared_state enable row level security;
create policy "game read players"  on players for select using (true);
create policy "game write players" on players for insert with check (true);
create policy "game update players" on players for update using (true) with check (true);
create policy "game read shared"  on shared_state for select using (true);
create policy "game write shared" on shared_state for insert with check (true);
create policy "game update shared" on shared_state for update using (true) with check (true);
```

3. "Success. No rows returned" 라고 나오면 성공

## 3. 연결 주소 2개 복사하기

1. 왼쪽 메뉴 **Project Settings**(톱니바퀴) → **API**
2. 두 값을 복사:
   - **Project URL** (예: `https://abcdefghijk.supabase.co`)
   - **Project API keys** 중 `anon` `public` 키 (긴 문자열)
3. 게임 폴더의 `src/cloud-config.js` 파일을 메모장으로 열어 붙여넣기:

```js
window.YUKSAM_CLOUD = {
  url: 'https://abcdefghijk.supabase.co',   // ← 복사한 Project URL
  anonKey: 'eyJhbGciOiJIUzI1...',           // ← 복사한 anon public 키
};
```

## 4. 배포

GitHub에 푸시하면 Vercel이 자동 배포. 끝.

## 5. 잘 되는지 확인

1. 게임 접속 → 로그인 버튼이 잠깐 "서버 연결 중..."으로 바뀌었다가 풀리면 연결 성공
2. 캐릭터로 잠깐 플레이 → Supabase 화면의 **Table Editor → players**에 학생 이름이 표처럼 보이면 저장되고 있는 것
3. 다른 컴퓨터/브라우저에서 같은 이름+비밀번호로 로그인 → 이어하기 되면 완성

## 6. 운영 팁

- **학생 데이터 보기/수정**: Table Editor → players → 행 클릭. 레벨·골드를 직접 고칠 수도 있음 (data 칸의 JSON 수정)
- **데이터 초기화**: players 표에서 해당 행 삭제 (학기 초 리셋 시 전체 선택 삭제)
- **문제 생겼을 때**: `src/cloud-config.js`의 두 값을 지우면 즉시 "이 컴퓨터에만 저장" 모드로 복귀

## 동작 방식 (참고)

- 접속하면 서버의 모든 학급 데이터를 내려받고(더 최신인 것만), 이후 4초마다 바뀐 내용을 자동 업로드. 창을 닫는 순간에도 마지막 저장을 시도.
- 인터넷이 끊기면 자동으로 로컬 저장 모드로 계속 동작하고, 이 사이 진행분은 그 컴퓨터에 남음.
- 같은 계정으로 두 곳에서 동시에 플레이하면 "더 나중에 저장한 쪽"이 남습니다. 학생들에게 한 곳에서만 플레이하라고 안내해 주세요.
