/*
 * combat-keys.js — 모달 공용 키보드 조작 (방향키 선택 + E키 실행)
 * game.js / admin-dashboard.js 이후 로드되는 클래식 스크립트.
 * 규칙:
 *   - 활성 조건: 아무 모달(#modal 표시)이나 열려 있고, 포커스가
 *     input/textarea/select/contenteditable에 있지 않을 때만 키를 가로챈다.
 *     상점·강화·펫·전문화·전투 등 대부분의 모달을 대상으로 한다.
 *   - 이미 game.js가 전용 키보드 처리를 하는 모달은 제외한다(이중 처리 방지):
 *       · 월드맵 모달(v25 전용 캡처 핸들러)
 *       · 선택형 모달(v26 캡처 핸들러가 .dialogue-options/.action-row/.choice-list/
 *         .combat-choice-grid/.worldmap 버튼을 이미 처리 — 해당 버튼이 있으면 양보)
 *       · 스킬/캐릭터/설정 모달(v26이 의도적으로 제외한 화면)
 *   - ←↑ = 이전 버튼, →↓ = 다음 버튼(순환). 선택 버튼에 .kb-select 부여 + scrollIntoView.
 *   - E = 선택 버튼 .click() (인라인 onclick 실행). 모달이 열려 있을 때만 E를
 *     가로채므로 월드 상호작용(E)과 충돌하지 않는다.
 *   - #modalContent를 MutationObserver로 감시: 모달 메뉴가 렌더되면 첫 활성 버튼 자동 선택.
 *     문제 단계(#combatAnswer 등장)에서는 선택 해제(입력창 자체 autofocus는 건드리지 않음).
 *   - 모달이 닫혀 있거나 입력 중이면 완전히 침묵 — 방향키 preventDefault도 하지 않는다.
 * window 버블 단계에 keydown 리스너 1개만 등록한다.
 */
(function () {
  'use strict';

  var SELECT_CLASS = 'kb-select';

  // E키 이중입력 방지: 상호작용 E로 모달이 '방금' 열린 경우, 같은/연달은 E가
  // 첫 버튼을 곧바로 눌러버리는 사고(펫 즉시 구매 등)를 막는다.
  var OPEN_GRACE_MS = 300;
  var lastModalVisible = false;
  var modalOpenedAt = 0;
  function noteModalState() {
    var vis = modalVisible();
    if (vis && !lastModalVisible) modalOpenedAt = Date.now();
    lastModalVisible = vis;
  }
  setInterval(noteModalState, 120);

  // ── 상태 판정 ────────────────────────────────────────────────
  // game.js의 v26 캡처 핸들러가 이미 순회하는 선택형 버튼들. 이 셀렉터가 잡히면 양보한다.
  var V26_SELECTOR = '.dialogue-options button, .action-row button, .choice-list button, .choice-grid button, .combat-choice-grid button, .worldmap-v25 button, .worldmap-v20 button';
  // game.js가 전용/의도적 처리를 하는 모달 타입(월드맵 전용 핸들러 + v26 제외 화면).
  var EXCLUDED_TYPES = { worldmap: 1, skill: 1, character: 1, settings: 1 };

  function modalVisible() {
    var modal = document.getElementById('modal');
    return !!(modal && !modal.classList.contains('hidden'));
  }

  function ownedElsewhere() {
    // game은 game.js 최상위 const — 늦은 바인딩으로 참조하되 가드한다.
    try {
      if (typeof game !== 'undefined' && game && game.modalState) {
        var t = game.modalState.type;
        if (t && EXCLUDED_TYPES[t]) return true;
      }
    } catch (e) { /* game 미정의 시 무시 */ }
    var c = document.getElementById('modalContent');
    if (c && c.querySelector(V26_SELECTOR)) return true; // v26이 처리하는 버튼 존재 → 양보
    return false;
  }

  // 활성 조건: 모달이 열려 있고, 다른 핸들러가 소유하지 않은 모달일 때.
  function active() {
    return modalVisible() && !ownedElsewhere();
  }

  function isTypingTarget(el) {
    if (!el) return false;
    var tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function focusInInput() {
    return isTypingTarget(document.activeElement);
  }

  // ── 버튼 수집 ────────────────────────────────────────────────
  function hiddenByMarkers(el) {
    if (el.classList && el.classList.contains('hidden')) return true;
    if (el.hidden) return true;
    var style = (el.getAttribute && el.getAttribute('style')) || '';
    if (/display\s*:\s*none/i.test(style)) return true;
    if (/visibility\s*:\s*hidden/i.test(style)) return true;
    return false;
  }

  function isVisible(el) {
    // 명시적 숨김 표시(.hidden 클래스 / hidden 속성 / inline display:none·visibility:hidden)만 걸러낸다.
    // offsetParent 기반 판정은 쓰지 않는다 — jsdom은 레이아웃을 계산하지 않아 항상 null이고,
    // 실제 브라우저에서도 position:fixed 요소가 null이 되는 등 신뢰할 수 없기 때문이다.
    // 조상까지 거슬러 올라가며 숨김 표시를 확인한다.
    var node = el;
    while (node && node.nodeType === 1) {
      if (hiddenByMarkers(node)) return false;
      if (node.id === 'modalContent') break; // 컨테이너까지만 검사
      node = node.parentElement;
    }
    return true;
  }

  function actionButtons() {
    var container = document.getElementById('modalContent');
    if (!container) return [];
    var all = container.querySelectorAll('button:not(:disabled)');
    var out = [];
    for (var i = 0; i < all.length; i++) {
      if (isVisible(all[i])) out.push(all[i]);
    }
    return out;
  }

  // ── 선택 관리 ────────────────────────────────────────────────
  function clearSelection() {
    var prev = document.querySelectorAll('#modalContent .' + SELECT_CLASS);
    for (var i = 0; i < prev.length; i++) prev[i].classList.remove(SELECT_CLASS);
  }

  function selectedButton() {
    return document.querySelector('#modalContent .' + SELECT_CLASS);
  }

  function selectButton(btn) {
    if (!btn) return;
    clearSelection();
    btn.classList.add(SELECT_CLASS);
    if (typeof btn.scrollIntoView === 'function') {
      try { btn.scrollIntoView({ block: 'nearest' }); } catch (e) { /* jsdom */ }
    }
  }

  function selectFirst() {
    var btns = actionButtons();
    if (btns.length) selectButton(btns[0]);
  }

  function moveSelection(dir) {
    var btns = actionButtons();
    if (!btns.length) return;
    var current = selectedButton();
    var idx = -1;
    for (var i = 0; i < btns.length; i++) {
      if (btns[i] === current) { idx = i; break; }
    }
    var next;
    if (idx === -1) {
      next = dir > 0 ? btns[0] : btns[btns.length - 1];
    } else {
      next = btns[(idx + dir + btns.length) % btns.length];
    }
    selectButton(next);
  }

  // ── 키 리스너 ────────────────────────────────────────────────
  function onKeyDown(e) {
    noteModalState();                    // 같은 이벤트로 방금 열린 모달도 즉시 감지
    if (!active()) return false;         // 모달 없음/다른 핸들러 소유: 완전 침묵
    if (focusInInput()) return false;    // 입력 중: E 포함 아무것도 가로채지 않음

    var key = e.key;
    if (key === 'ArrowLeft' || key === 'ArrowUp') {
      e.preventDefault();
      moveSelection(-1);
      return true;
    } else if (key === 'ArrowRight' || key === 'ArrowDown') {
      e.preventDefault();
      moveSelection(1);
      return true;
    } else if (key === 'e' || key === 'E') {
      if (Date.now() - modalOpenedAt < OPEN_GRACE_MS) return true; // 방금 열림 → 이 E는 무시
      var btn = selectedButton();
      if (btn) {
        e.preventDefault();
        btn.click();
        return true;
      }
    }
    return false;
  }

  window.YuksamInputRouter.register({ id:'generic-modal-keys', type:'keydown', priority:20, handle:onKeyDown });

  // ── 전투 메뉴 렌더 감시 ──────────────────────────────────────
  function refreshSelection() {
    if (!active()) { clearSelection(); return; }
    // 전투 문제 단계로 전환되면(입력창 존재) 선택 해제.
    if (document.getElementById('combatAnswer')) {
      clearSelection();
      return;
    }
    // 메뉴 단계: 선택이 없거나 선택 버튼이 사라졌으면 첫 버튼 선택.
    var current = selectedButton();
    if (!current) {
      selectFirst();
    }
  }

  function initObserver() {
    var container = document.getElementById('modalContent');
    if (!container || typeof MutationObserver === 'undefined') return;
    var mo = new MutationObserver(function () {
      // 렌더 직후 DOM이 안정된 뒤 판단.
      refreshSelection();
    });
    mo.observe(container, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initObserver);
  } else {
    initObserver();
  }

  // 하네스/테스트 및 재초기화용 최소 노출.
  window.__combatKeys = {
    refresh: refreshSelection,
    selectFirst: selectFirst,
    buttons: actionButtons,
    selected: selectedButton
  };
})();
