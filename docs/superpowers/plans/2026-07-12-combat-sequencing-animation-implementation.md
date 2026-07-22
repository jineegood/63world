# 전투 순서 및 애니메이션 개선 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 상태효과와 전투 로그를 일관된 이벤트 순서로 통합하고 모든 액티브 스킬 및 몬스터 공격에 단계별 Canvas/CSS 연출을 제공한다.

**Architecture:** 전투 규칙은 `src/combat-rules.js`, 연출 프로필과 실행은 새 `src/combat-fx.js`, 실제 전투 연결은 `game.js`가 담당한다. 피해 계산 결과를 이벤트 배열로 만든 뒤 직렬 큐가 로그와 연출을 순서대로 재생해 정오답보다 몬스터 공격이 앞서는 문제를 구조적으로 차단한다.

**Tech Stack:** Vanilla JavaScript, Canvas 2D, DOM/CSS animations, Node test runner, jsdom browser smoke harness

## Global Constraints

- 현재 프로젝트 파일을 기준으로 수정하고 과거 사본으로 덮어쓰지 않는다.
- 새 이미지 자산 없이 Canvas/CSS 기반 모션, 투사체, 파티클을 사용한다.
- 궁극기가 가장 화려하고 일반 액티브부터 단계적으로 연출 강도가 증가해야 한다.
- 몬스터 로그는 옅은 빨간색으로 표시한다.
- 툴팁 문구는 냉기 `다음 공격 데미지가 50% 감소합니다.`를 그대로 사용한다.
- 기존 저장 데이터의 `weakenTurns`는 손실 없이 `chillTurns`로 흡수한다.

---

### Task 1: 상태효과와 밸런스 데이터 정리

**Files:**
- Modify: `src/combat-rules.js`
- Modify: `src/game-data.js`
- Modify: `game.js`
- Test: `tests/combat-rules.test.mjs`
- Test: `tests/game-data.test.mjs`

**Interfaces:**
- Produces: `normalizeCombatStatuses(source)`, `buildStatusBadges(source)`, 냉기 단일 상태 계약

- [ ] **Step 1: 실패 테스트 작성**

```js
assert.equal(buildStatusBadges({ shield:43 }).some((badge) => badge.key === 'shield'), false);
assert.deepEqual(buildStatusBadges({ chillTurns:1 })[0], {
  key:'chill', label:'냉기 1', tooltip:'다음 공격 데미지가 50% 감소합니다.'
});
assert.match(buildStatusBadges({ intBuffTurns:2 })[0].tooltip, /지능이 30% 증가합니다/);
assert.equal(SKILL_DEFS.mage_frost_armor_v24.active.cooldown, 5);
```

- [ ] **Step 2: 테스트가 실패하는지 실행**

Run: `powershell -ExecutionPolicy Bypass -File tools/run-baseline.ps1 combat-rules`

- [ ] **Step 3: 냉기 통합과 데이터 변경 구현**

`weakenTurns`를 로드 및 전투 시작 시 `chillTurns`로 합치고, 공격 피해 계산 시 냉기를 1회 소모해 50% 감소시킨다. 보호막 배지는 만들지 않으며 환기 버프 배지와 툴팁을 추가한다. 서리 갑옷 쿨타임과 설명, 스네이크 30% 및 스톰프 20% 기본 능력치 배율을 갱신한다.

- [ ] **Step 4: 관련 테스트 실행**

Run: `powershell -ExecutionPolicy Bypass -File tools/run-baseline.ps1 all`
Expected: 모든 테스트 통과

### Task 2: 전투 이벤트 큐와 로그 순서 통합

**Files:**
- Modify: `src/combat-rules.js`
- Modify: `game.js`
- Modify: `style.css`
- Test: `tests/combat-flow.test.mjs`

**Interfaces:**
- Produces: `queueCombatSequence(events)`, `{ type, text, tone, duration, fx }` 이벤트 계약

- [ ] **Step 1: 실패 테스트 작성**

```js
assert.deepEqual(sequence.map((event) => event.type), [
  'answer-correct','player-hit','player-extra-hit','enemy-status','player-total',
  'monster-action','player-status','player-damage','retaliation','player-dot'
]);
assert.deepEqual(wrongSequence.map((event) => event.type), [
  'answer-wrong','monster-action','player-damage'
]);
```

- [ ] **Step 2: 실패 확인**

Run: `powershell -ExecutionPolicy Bypass -File tools/run-baseline.ps1 combat-flow`

- [ ] **Step 3: 플레이어와 몬스터 턴을 이벤트 배열로 변환**

정답/오답 표시가 첫 이벤트가 되도록 하고 다단 피해, 상태, 총 피해, 몬스터 공격, 보호막 흡수, 반격, 지속 피해를 각각 별도 이벤트로 만든다. `적이 충격을 받았습니다`와 `피해를 받지 않았다!` 생성 경로를 제거한다.

- [ ] **Step 4: 로그 톤 스타일 추가**

```css
.combat-notice.enemy-action,
.combat-log.enemy-action { color:#fca5a5; text-shadow:0 1px 0 rgba(69,10,10,.55); }
```

- [ ] **Step 5: 전투 흐름 테스트 실행**

Run: `powershell -ExecutionPolicy Bypass -File tools/run-baseline.ps1 combat-flow`
Expected: 모든 전투 순서 테스트 통과

### Task 3: 데이터 기반 플레이어 액티브 스킬 연출

**Files:**
- Create: `src/combat-fx.js`
- Modify: `index.html`
- Modify: `style.css`
- Modify: `game.js`
- Test: `tests/combat-fx.test.mjs`

**Interfaces:**
- Produces: `window.YuksamCombatFx.getSkillFxProfile(skillId, skill)`, `playPlayerActionFx(profile)`, `queueCombatSequence(events)`

- [ ] **Step 1: 모든 액티브 스킬 프로필 전수 테스트 작성**

```js
for (const skill of Object.values(SKILL_DEFS).filter((entry) => entry.active)) {
  const profile = fx.getSkillFxProfile(skill.id, skill);
  assert.ok(profile.motion);
  assert.ok(profile.impact);
  assert.ok(profile.tier >= 1 && profile.tier <= 4);
}
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/combat-fx.test.mjs`

- [ ] **Step 3: 연출 프로필과 DOM 실행기 구현**

스킬 타입, 전문화, 궁극기 여부에 따라 `slash`, `charge`, `shield`, `fire-projectile`, `ice-projectile`, `holy-projectile`, `shadow-projectile`, `heal-wave`, `area-burst` 프로필을 반환한다. 프로필의 `tier`에 따라 투사체 크기, 파티클 수, 화면 흔들림을 증가시킨다.

- [ ] **Step 4: 스킬 실행 큐에 연출 연결**

각 타격 직전에 플레이어 모션과 투사체를 재생하고 명중 시점에 피해 로그를 표시한다. 궁극기는 기존 `playUltimateFxV41`과 중복되지 않도록 새 연출의 강도를 보완 효과로 제한한다.

- [ ] **Step 5: 프로필 및 문법 테스트 실행**

Run: `node --test tests/combat-fx.test.mjs; node --check src/combat-fx.js; node --check game.js`

### Task 4: 몬스터 공격 연출과 전투 대기 모션

**Files:**
- Modify: `src/combat-fx.js`
- Modify: `style.css`
- Modify: `game.js`
- Test: `tests/combat-fx.test.mjs`
- Test: `tools/browser-smoke/try_combat_animation.js`

**Interfaces:**
- Produces: `getMonsterFxProfile(monster, technique)`, `playMonsterActionFx(profile)`

- [ ] **Step 1: 몬스터 프로필 실패 테스트 작성**

기본 공격, 버섯 독, 슬라임 점액 방패, 스톰프 대지 찍기, 스네이크 맹독, 늪 및 보스 기술에 모두 모션과 명중 효과가 존재하는지 검사한다.

- [ ] **Step 2: 몬스터 연출 프로필 구현**

일반 공격은 짧은 돌진 또는 할퀴기, 독은 녹색 투사체, 점액은 점액탄과 방패 파동, 대지 찍기는 수직 점프와 지면 충격파, 보스는 큰 범위 효과를 사용한다.

- [ ] **Step 3: 대기 모션 구현**

전투 프레임의 플레이어와 몬스터에 서로 다른 위상의 `combat-idle` 애니메이션을 적용하고 공격 중에는 `combat-acting` 클래스로 일시 중단한다.

- [ ] **Step 4: 브라우저 검증**

Run: `node tools/browser-smoke/try_combat_animation.js`
Expected: 투사체 생성 후 제거, 양측 대기 모션, 몬스터 공격 클래스, 비동기 오류 0

### Task 5: 강화 외형 공통화와 즉시 강화 치트

**Files:**
- Modify: `src/cheat-panel.js`
- Modify: `index.html`
- Modify: `game.js`
- Modify: `style.css`
- Test: `tests/combat-flow.test.mjs`
- Test: `tools/browser-smoke/try_weapon_tiers.js`

**Interfaces:**
- Produces: `getEquippedWeaponTierStyle(player)`, `window.cheatUpgradeEquippedWeapon()`

- [ ] **Step 1: 실패 테스트 작성**

```js
assert.match(gameSource, /cheatUpgradeEquippedWeapon/);
assert.match(gameSource, /getEquippedWeaponTierStyle/);
```

- [ ] **Step 2: 모든 무기 렌더 경로 조사 테스트 추가**

전투 캐릭터, 월드 캐릭터, 장비창, 강화소 미리보기가 같은 등급 색상 함수를 참조하는지 검사한다.

- [ ] **Step 3: 공통 등급 스타일과 치트 구현**

장착 무기의 `weaponUpgrades[weaponId]`를 기준으로 외곽선과 오라를 반환한다. 즉시 강화 치트는 비용·확률·퀘스트 진행 없이 한 등급만 올리고 저장 및 화면 갱신을 호출한다.

- [ ] **Step 4: 브라우저 테스트 갱신 및 실행**

Run: `node tools/browser-smoke/try_weapon_tiers.js`
Expected: 치트 버튼 9개, 장착 무기 한 등급 증가, 전설 상한, 외형 클래스 확인

### Task 6: 전체 회귀 및 시각 검증

**Files:**
- Verify: `tests/combat-rules.test.mjs`
- Verify: `tests/combat-flow.test.mjs`
- Verify: `tests/combat-fx.test.mjs`
- Verify: `tests/game-data.test.mjs`
- Verify: `tools/browser-smoke/try_combat.js`
- Verify: `tools/browser-smoke/try_combat_keys.js`
- Verify: `tools/browser-smoke/try_skills2.js`
- Verify: `tools/browser-smoke/try_fx.js`
- Verify: `tools/browser-smoke/try_combat_animation.js`

- [ ] **Step 1: 전체 자동 테스트 실행**

Run: `powershell -ExecutionPolicy Bypass -File tools/run-baseline.ps1 all`
Expected: 실패 0

- [ ] **Step 2: 주요 브라우저 흐름 실행**

Run each command: `node tools/browser-smoke/try_combat.js`, `node tools/browser-smoke/try_combat_keys.js`, `node tools/browser-smoke/try_skills2.js`, `node tools/browser-smoke/try_fx.js`, `node tools/browser-smoke/try_combat_animation.js`
Expected: 모든 검증 통과, 비동기 오류 0

- [ ] **Step 3: 실제 화면 시각 점검**

마법사 투사체, 일반 액티브와 궁극기 강도 차이, 몬스터 기본·특수 공격, 강화 등급별 오라, 상태 툴팁, 옅은 빨간 몬스터 로그가 겹치거나 화면 밖으로 나가지 않는지 데스크톱 화면에서 확인한다.

- [ ] **Step 4: 구형 문구와 상태 이름 검색**

Run: `rg -n "적이 충격을 받았습니다|피해를 받지 않았다|약화 [0-9]|보호막 [0-9]" game.js src`
Expected: 사용자 화면에 노출되는 구형 문구 없음
