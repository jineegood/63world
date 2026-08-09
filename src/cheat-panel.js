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

  let detailEnabled = false;
  let detailEntries = [];

  function shortNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '-';
    return Number.isInteger(number) ? String(number) : number.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  }

  function detailFormula(calc) {
    if (!calc || typeof calc !== 'object') return '';
    if (calc.kind === 'party-damage') {
      const factors = [
        `${calc.statName || '능력치'} ${shortNumber(calc.stat)}`,
        `기본 공격 굴림 ${shortNumber(calc.rolledPower)}(난수 ${shortNumber(calc.powerRoll)})`,
        `기술 배율 ×${shortNumber(calc.actionMultiplier)}`,
      ];
      if (Number(calc.answerMultiplier) !== 1) factors.push(`오답 ×${shortNumber(calc.answerMultiplier)}`);
      if (Number(calc.criticalMultiplier) !== 1) factors.push(`치명타 ×${shortNumber(calc.criticalMultiplier)}`);
      if (Number(calc.chargeMultiplier) !== 1) factors.push(`차지 ×${shortNumber(calc.chargeMultiplier)}`);
      if (Number(calc.chillMultiplier) !== 1) factors.push(`냉기 ×${shortNumber(calc.chillMultiplier)}`);
      factors.push(`계산 피해 ${shortNumber(calc.requestedDamage)}`);
      return `${factors.join(' → ')} / 보호막 ${shortNumber(calc.shieldDamage)}, HP ${shortNumber(calc.hpDamage)}`;
    }
    if (calc.kind === 'monster-damage' || calc.kind === 'monster-counter') {
      const factors = [
        `몬스터 공격력 ${shortNumber(calc.baseAttack)}`,
        `던전 보정 ×${shortNumber(calc.raidMultiplier)}`,
        `${calc.slotLabel || calc.slot || '자리'} ×${shortNumber(calc.slotMultiplier)}`,
        `${calc.attackType || '공격'} ×${shortNumber(calc.focusMultiplier)}`,
      ];
      if (Number(calc.empowerMultiplier) !== 1) factors.push(`강화 ×${shortNumber(calc.empowerMultiplier)}`);
      if (Number(calc.chargeMultiplier) !== 1) factors.push(`예고 강화 ×${shortNumber(calc.chargeMultiplier)}`);
      if (Number(calc.classMultiplier) !== 1) factors.push(`직업/전문화 방어 ×${shortNumber(calc.classMultiplier)}`);
      if (Number(calc.armorMultiplier) !== 1) factors.push(`특성 방어 ×${shortNumber(calc.armorMultiplier)}`);
      if (Number(calc.chillMultiplier) !== 1) factors.push(`몬스터 냉기 ×${shortNumber(calc.chillMultiplier)}`);
      if (Number(calc.criticalMultiplier) !== 1) factors.push(`치명타 ×${shortNumber(calc.criticalMultiplier)}`);
      factors.push(`계산 피해 ${shortNumber(calc.requestedDamage)}`);
      return `${factors.join(' → ')} / 보호막 ${shortNumber(calc.shieldDamage)}, HP ${shortNumber(calc.hpDamage)}`;
    }
    return String(calc.formula || '');
  }

  function detailMeta(calc) {
    if (!calc || typeof calc !== 'object') return '';
    const bits = [];
    if (calc.missRoll != null) bits.push(`빗나감 난수 ${shortNumber(calc.missRoll)} / 확률 ${shortNumber(Number(calc.missChance) * 100)}%`);
    if (calc.criticalRoll != null) bits.push(`치명타 난수 ${shortNumber(calc.criticalRoll)} / 확률 ${shortNumber(Number(calc.criticalChance) * 100)}%`);
    if (calc.reason) bits.push(String(calc.reason));
    return bits.join(' · ');
  }

  function ensureDetailOverlay() {
    let overlay = document.getElementById('combatDetailOverlay');
    if (overlay) return overlay;
    overlay = document.createElement('section');
    overlay.id = 'combatDetailOverlay';
    overlay.className = 'combat-detail-overlay hidden';
    overlay.innerHTML = '<div class="combat-detail-head"><b>🔎 전투 세분화 로그</b>'
      + '<button type="button" data-detail-collapse>접기</button>'
      + '<button type="button" data-detail-clear>지우기</button>'
      + '<button type="button" data-detail-close>닫기</button></div>'
      + '<div class="combat-detail-body"></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('[data-detail-collapse]').onclick = (event) => {
      const collapsed = overlay.classList.toggle('collapsed');
      event.currentTarget.textContent = collapsed ? '펼치기' : '접기';
    };
    overlay.querySelector('[data-detail-clear]').onclick = () => {
      detailEntries = [];
      renderDetailEntries();
    };
    overlay.querySelector('[data-detail-close]').onclick = () => setDetailEnabled(false);
    return overlay;
  }

  function renderDetailEntries() {
    const overlay = ensureDetailOverlay();
    const body = overlay.querySelector('.combat-detail-body');
    if (!body) return;
    body.textContent = '';
    if (!detailEntries.length) {
      const empty = document.createElement('div');
      empty.className = 'combat-detail-empty';
      empty.textContent = '전투를 시작하면 계산 과정이 여기에 표시됩니다.';
      body.appendChild(empty);
      return;
    }
    detailEntries.forEach((entry) => {
      const item = document.createElement('article');
      item.className = 'combat-detail-entry';
      const title = document.createElement('strong');
      title.textContent = entry.text || entry.kind || '전투 처리';
      item.appendChild(title);
      const formula = detailFormula(entry.debugCalc);
      if (formula) {
        const node = document.createElement('div');
        node.className = 'combat-detail-formula';
        node.textContent = formula;
        item.appendChild(node);
      }
      const metaText = detailMeta(entry.debugCalc);
      if (metaText) {
        const meta = document.createElement('div');
        meta.className = 'combat-detail-meta';
        meta.textContent = metaText;
        item.appendChild(meta);
      }
      body.appendChild(item);
    });
    body.scrollTop = body.scrollHeight;
  }

  function setDetailEnabled(enabled) {
    detailEnabled = Boolean(enabled);
    const overlay = ensureDetailOverlay();
    overlay.classList.toggle('hidden', !detailEnabled);
    const button = document.getElementById('combatDetailLogBtn');
    if (button) button.textContent = `🔎 전투 세분화 로그 ${detailEnabled ? 'ON' : 'OFF'}`;
    if (detailEnabled) renderDetailEntries();
  }

  function recordDetailEvent(event, snapshot) {
    if (!detailEnabled || !event) return;
    detailEntries.push({
      kind:String(event.kind || ''),
      text:String(event.text || ''),
      round:Math.max(0, Number(snapshot?.round) || 0),
      debugCalc:event.debugCalc && typeof event.debugCalc === 'object' ? { ...event.debugCalc } : null,
    });
    if (detailEntries.length > 200) detailEntries = detailEntries.slice(-200);
    renderDetailEntries();
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
    if (window.YuksamRaidRunUi?.isRunning?.()) {
      const killRaid = call('adminKillCurrentRaidMonsterV1');
      if (!killRaid) { toastMsg('던전 처치 기능을 찾지 못했습니다.'); return; }
      await killRaid();
      return;
    }
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
    const detailBtn = document.getElementById('combatDetailLogBtn');
    if (detailBtn && !detailBtn.dataset.boundDetailV1) {
      detailBtn.dataset.boundDetailV1 = '1';
      detailBtn.addEventListener('click', async () => {
        if (!(await hasTeacherAccess())) return;
        setDetailEnabled(!detailEnabled);
        toastMsg(`전투 세분화 로그: ${detailEnabled ? '켜짐' : '꺼짐'}`);
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
  window.YuksamCombatDetailLog = Object.freeze({
    record:recordDetailEvent,
    setEnabled:setDetailEnabled,
    isEnabled:() => detailEnabled,
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
