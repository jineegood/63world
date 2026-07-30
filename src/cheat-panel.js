/* =========================================================
   cheat-panel.js — 치트 버튼 꾸러미 (v41)
   HUD의 '🧪 치트' 토글로 접이식 패널을 열고 닫는다.
   기존 6개 치트 버튼은 index.html에서 이 패널로 이동(리스너는 game.js가 그대로 연결).
   신규 2개: 몬스터 즉시 처치 / 퀘스트 즉시 완료 — 전투 중에도 동작.
   ========================================================= */
(function cheatPanelV41() {
  if (window.__CHEAT_PANEL_V41__) return;
  window.__CHEAT_PANEL_V41__ = true;

  function g() { return (typeof game !== 'undefined' ? game : (window.__G || null)); }
  function call(name) {
    const fn = window[name] || (typeof globalThis !== 'undefined' ? globalThis[name] : undefined);
    return typeof fn === 'function' ? fn : null;
  }
  function toastMsg(msg) {
    const fn = call('toast');
    if (fn) fn(msg); else console.log('[cheat]', msg);
  }

  async function hasTeacherAccess() {
    const requireAccess = call('requireTeacherCheatAccessV3');
    return Boolean(requireAccess && await requireAccess());
  }

  async function togglePanel(force) {
    if (!(await hasTeacherAccess())) return;
    const panel = document.getElementById('cheatPanel');
    const cluster = document.getElementById('cheatCluster');
    if (!panel) return;
    const open = typeof force === 'boolean' ? force : panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !open);
    if (cluster) cluster.classList.toggle('open', open);
  }

  async function killCurrentMonster() {
    if (!(await hasTeacherAccess())) return;
    const gm = g();
    const ccm = call('currentCombatMonster');
    const monster = ccm ? ccm() : (gm && gm.currentCombatMonster ? gm.currentCombatMonster() : null);
    const kill = window.startMonsterDefeatSequenceV25 || call('startMonsterDefeatSequenceV25');
    if (!monster) { toastMsg('전투 중이 아닙니다.'); return; }
    if (!kill) { toastMsg('처치 함수를 찾을 수 없습니다.'); return; }
    kill(monster, '치트: ');
    toastMsg('치트: 몬스터 즉시 처치!');
  }

  async function completeAcceptedQuest() {
    if (!(await hasTeacherAccess())) return;
    const gm = g();
    if (!gm || !gm.player || !gm.player.quests) { toastMsg('진행 중인 퀘스트가 없습니다.'); return; }
    const defs = window.QUEST_DEFS || (typeof QUEST_DEFS !== 'undefined' ? QUEST_DEFS : {});
    let done = 0;
    Object.values(gm.player.quests).forEach((q) => {
      if (q && q.status === 'accepted') {
        q.status = 'ready';
        if (defs[q.id] && typeof defs[q.id].target === 'number') q.progress = defs[q.id].target;
        done++;
      }
    });
    const save = call('savePlayer'); if (save) save();
    const tracker = call('updateQuestTracker'); if (tracker) tracker();
    const hud = call('updateHud'); if (hud) hud();
    toastMsg(done ? `치트: 진행 중 퀘스트 ${done}개 완료 가능 상태로!` : '진행 중(수락)인 퀘스트가 없습니다.');
  }

  function init() {
    const toggle = document.getElementById('cheatToggleBtn');
    if (toggle && !toggle.dataset.boundV41) {
      toggle.dataset.boundV41 = '1';
      toggle.addEventListener('click', () => { togglePanel(); });
    }
    const killBtn = document.getElementById('cheatKillMonsterBtn');
    if (killBtn && !killBtn.dataset.boundV41) {
      killBtn.dataset.boundV41 = '1';
      killBtn.addEventListener('click', () => { killCurrentMonster(); });
    }
    const questBtn = document.getElementById('cheatCompleteQuestBtn');
    if (questBtn && !questBtn.dataset.boundV41) {
      questBtn.dataset.boundV41 = '1';
      questBtn.addEventListener('click', () => { completeAcceptedQuest(); });
    }
    const speedBtn = document.getElementById('combatLogSpeedBtn');
    if (speedBtn && !speedBtn.dataset.boundV50) {
      speedBtn.dataset.boundV50 = '1';
      speedBtn.addEventListener('click', async function () {
        if (!(await hasTeacherAccess())) return;
        window.__combatLogFastV50 = !window.__combatLogFastV50;
        speedBtn.textContent = '⏩ 전투로그 2배속 ' + (window.__combatLogFastV50 ? 'ON' : 'OFF');
        toastMsg('전투 로그 속도: ' + (window.__combatLogFastV50 ? '2배속' : '기본'));
      });
    }
    const upgradeBtn = document.getElementById('cheatUpgradeWeaponBtn');
    if (upgradeBtn && !upgradeBtn.dataset.boundV42) {
      upgradeBtn.dataset.boundV42 = '1';
      upgradeBtn.addEventListener('click', async () => {
        if (!(await hasTeacherAccess())) return;
        const upgrade = call('cheatUpgradeEquippedWeapon');
        if (upgrade) upgrade(); else toastMsg('무기 즉시 강화 기능을 찾을 수 없습니다.');
      });
    }
  }

  window.__cheatPanelInitV41 = init;
  window.__cheatKillMonsterV41 = killCurrentMonster;
  window.__cheatCompleteQuestV41 = completeAcceptedQuest;
  window.__cheatTogglePanelV41 = togglePanel;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
