# GitHub 기록 재연결 설계

## 목적

현재 바탕화면의 최신 프로젝트 파일을 그대로 유지하면서 기존 GitHub 저장소 `jineegood/63world`의 변경 기록을 다시 연결한다. 이번 작업에서는 GitHub에 업로드하거나 Vercel을 재배포하지 않는다.

## 기준

- 현재 최신본: `C:\Users\fiost\Desktop\63world (1)\63world`
- 기존 원격 저장소: `https://github.com/jineegood/63world.git`
- 원격 기준 브랜치: `main`
- 확인된 원격 HEAD: `f0f5aa2b9a3dd6e4060cbddba655e9714b056d9c`

## 방식

1. 현재 최신 프로젝트를 복구 가능한 체크포인트로 보존한다.
2. 기존 GitHub 저장소를 임시 폴더에 별도로 복제한다.
3. 현재 폴더의 비어 있는 `.git`은 프로젝트 밖에 백업한다.
4. 임시 복제본의 Git 기록만 현재 최신 폴더에 옮긴다. 최신 게임 파일은 덮어쓰지 않는다.
5. `main`을 직접 수정하지 않고 로컬 전용 작업 브랜치를 만든다.
6. `.gitignore`로 작업용 폴더와 생성물을 제외한다.
7. 현재 최신 상태를 로컬 커밋으로 기록한다.

## `.gitignore` 범위

- `.codex_work/`
- `.superpowers/`
- `backups/`
- `outputs/`
- `node_modules/`
- `.vercel/`
- 일반 로그와 운영체제 임시 파일

게임 코드, `src/`, `tests/`, `tools/`, `docs/`, `assets/`, `data/`, `시트/`는 기록 대상에 포함한다.

## 안전 조건

- `git push`를 실행하지 않는다.
- 현재 파일에 `reset`, `checkout`, `clean`을 실행하지 않는다.
- Vercel과 Supabase 설정을 변경하지 않는다.
- 임시 복제본의 파일을 현재 프로젝트에 덮어쓰지 않는다.
- 연결 후 Git 상태와 원격 주소를 확인하고 전체 테스트를 실행한다.

## 성공 기준

- 현재 폴더에서 `git status`와 `git log`가 정상 작동한다.
- `origin`이 `https://github.com/jineegood/63world.git`을 가리킨다.
- 현재 작업은 `main`이 아닌 로컬 브랜치에 기록된다.
- 원격 `main`의 HEAD는 작업 전과 동일하다.
- 전체 자동 검사가 통과한다.
