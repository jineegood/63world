# 브라우저 스모크 테스트 (jsdom)

문법 테스트로는 못 잡는 "부팅/플레이 런타임 오류"를 잡는 도구입니다.

준비 (1회):
    npm install jsdom

실행:
    node boot_test.js                # 부팅 + 첫 런타임 오류 탐지
    node try_skill.js <프로젝트경로>   # 로그인→생성→스킬창
    node try_combat.js <프로젝트경로>  # 숲 진입→전투→문제 풀이→기록

harness.js가 브라우저 API(canvas/audio)를 스텁하고 게임을 로드합니다.
