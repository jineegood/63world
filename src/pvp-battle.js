(function installPvpBattleV1(global) {
  'use strict';

  const SUPPORT_TYPES = new Set(['shield', 'buff', 'healBuff', 'healAllies']);
  const EVENT_DELAYS = Object.freeze({
    action:700,
    damage:850,
    heal:750,
    shield:750,
    status:700,
  });

  let state = null;
  let unsubscribe = null;
  let heartbeatTimer = null;
  let countdownTimer = null;
  let pendingMatchTimer = null;
  let queueStartTimer = null;
  let pendingMatch = null;
  let uiMode = 'menu';
  let selectedAction = 'basic';
  let combatMessage = '';
  let combatTone = '';
  let diceVisual = null;
  let confirmingSurrender = false;
  let eventQueue = [];
  let processingEvents = false;
  let eventOrder = 0;
  let playbackGeneration = 0;
  let profileGeneration = 0;
  let hpDisplay = { me:null, opponent:null };
  let submittedRound = null;
  let syncInFlight = false;
  const processedEvents = new Set();

  function escape(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
    })[char]);
  }

  function encoded(value) {
    return encodeURIComponent(String(value ?? '')).replace(/'/g, '%27');
  }

  function normalizedMatch(match) {
    const a = match.playerAState || match.player_a_state || {};
    const b = match.playerBState || match.player_b_state || {};
    return {
      matchId:match.id,
      round:Number(match.round ?? match.round_no) || 1,
      phase:match.phase || 'question',
      deadline:Number(match.deadline) || (match.question_deadline ? new Date(match.question_deadline).getTime() : Date.now() + 20000),
      reconnectDeadline:Number(match.reconnectDeadline) || (match.reconnect_deadline ? new Date(match.reconnect_deadline).getTime() : 0),
      playerAId:match.playerAId || match.player_a_id || a.userId,
      playerBId:match.playerBId || match.player_b_id || b.userId,
      a:{ ...a },
      b:{ ...b },
      question:match.question || match.question_public || {},
      winnerId:match.winnerId || match.winner_id || null,
      loserId:match.loserId || match.loser_id || null,
    };
  }

  function meSide() {
    return global.getPvpIdentityV1?.()?.userId === state?.playerAId ? 'a' : 'b';
  }

  function otherSide() {
    return meSide() === 'a' ? 'b' : 'a';
  }

  function playerForRole(role) {
    if (!state) return {};
    return state[role === 'me' ? meSide() : otherSide()] || {};
  }

  function sideName(side) {
    return state?.[side]?.name || (side === 'a' ? 'A' : 'B');
  }

  function actionDefinition(actionId) {
    if (!actionId || actionId === 'basic') {
      return { id:'basic', name:'기본 공격', active:{ name:'기본 공격', type:'damage' } };
    }
    const skill = global.YuksamData?.V24_SKILLS?.[actionId];
    return skill ? { ...skill, name:skill.active?.name || skill.name || '스킬' }
      : { id:actionId, name:'스킬', active:{ name:'스킬', type:'damage' } };
  }

  function activeSkills() {
    const me = playerForRole('me');
    const catalog = global.YuksamData?.V24_SKILLS || {};
    return Object.keys(me.skills || {})
      .map((id) => catalog[id])
      .filter((skill) => skill?.active);
  }

  function statusBadges(player) {
    const badges = [];
    if (Number(player.shield) > 0) {
      badges.push(`<span class="combat-badge-v38 shield" title="피해를 먼저 막아 줍니다.">🛡 보호막 ${Math.trunc(Number(player.shield))}</span>`);
    }
    if (Number(player.statuses?.stun) > 0) {
      badges.push(`<span class="combat-badge-v38 stun" title="행동할 수 없습니다.">💫 기절 ${Math.trunc(Number(player.statuses.stun))}</span>`);
    }
    if (Number(player.statuses?.chill) > 0) {
      badges.push(`<span class="combat-badge-v38 chill" title="공격력이 감소합니다.">❄️ 냉기 ${Math.trunc(Number(player.statuses.chill))}</span>`);
    }
    if (Number(player.statuses?.shadow) > 0) {
      badges.push(`<span class="combat-badge-v38 shadow" title="암흑의 흔적입니다.">🌑 암흑 ${Math.trunc(Number(player.statuses.shadow))}</span>`);
    }
    return badges.length ? `<div class="combat-badges-v38">${badges.join('')}</div>` : '';
  }

  function hpBox(role) {
    const player = playerForRole(role);
    const hp = Math.max(0, Number(player.hp) || 0);
    const maxHp = Math.max(1, Number(player.maxHp) || 1);
    const ratio = Math.max(0, Math.min(100, hp / maxHp * 100));
    const displayedRatio = Number.isFinite(hpDisplay[role]) ? hpDisplay[role] : ratio;
    const cssRole = role === 'me' ? 'player' : 'monster';
    const fillId = role === 'me' ? 'pvpPlayerHpFillV2' : 'pvpOpponentHpFillV2';
    return `<div class="combat-hpbox ${cssRole}">
      <b>Lv.${Math.max(1, Number(player.level) || 1)} ${escape(player.name || '학생')}</b>
      <div>HP ${hp}/${maxHp}${Number(player.shield) > 0 ? ` <span class="shield-badge">🛡 ${Math.trunc(Number(player.shield))}</span>` : ''}</div>
      ${statusBadges(player)}
      <div class="hpbar"><div id="${fillId}" class="hpfill" style="width:${displayedRatio}%"></div></div>
    </div>`;
  }

  function diceOverlay() {
    if (!diceVisual?.visible) return '';
    const rollingClass = diceVisual.rolling ? ' rolling' : '';
    return `<div class="pvp-dice-overlay-v2" aria-live="polite">
      <div class="pvp-dice-title-v2">🎲 30면체 주사위</div>
      <div class="pvp-dice-pair-v2">
        <div class="pvp-die-shell-v2">
          <small>${escape(playerForRole('me').name || '나')}</small>
          <span id="pvpLeftDieV2" class="pvp-die-v2${rollingClass}">${Math.max(1, Number(diceVisual.left) || 1)}</span>
        </div>
        <strong>VS</strong>
        <div class="pvp-die-shell-v2">
          <small>${escape(playerForRole('opponent').name || '상대')}</small>
          <span id="pvpRightDieV2" class="pvp-die-v2${rollingClass}">${Math.max(1, Number(diceVisual.right) || 1)}</span>
        </div>
      </div>
      <div id="pvpDiceCaptionV2" class="pvp-dice-caption-v2">${escape(diceVisual.caption || '주사위를 굴리는 중...')}</div>
      ${diceVisual.history ? `<small class="pvp-dice-history-v2">${escape(diceVisual.history)}</small>` : ''}
    </div>`;
  }

  function actionMenuHtml() {
    return `<div class="combat-menu">
      <button class="primary" data-tooltip="기본 공격&#10;문제를 맞히면 온전한 피해를 줍니다." onclick="choosePvpActionV1('basic')">공격</button>
      <button class="primary" data-tooltip="배운 액티브 스킬을 사용합니다." onclick="openPvpSkillMenuV1()">스킬</button>
      <button class="ghost" data-tooltip="대전을 포기하고 패배로 기록합니다." onclick="surrenderPvpV1()">항복</button>
    </div>
    <p class="muted">두 학생이 같은 문제를 푼 뒤, 매 라운드 주사위로 공격 순서를 정합니다.</p>`;
  }

  function skillMenuHtml() {
    const me = playerForRole('me');
    const skills = activeSkills();
    if (!skills.length) {
      return `<p class="muted">아직 배운 액티브 스킬이 없습니다.</p>
        <div class="action-row"><button class="ghost" onclick="renderPvpMenuV1()">뒤로</button></div>`;
    }
    const buttons = skills.map((skill) => {
      const cooldown = Math.max(0, Number(me.cooldowns?.[skill.id]) || 0);
      const tip = escape([skill.active?.name || skill.name, skill.desc || '', `쿨타임 ${skill.active?.cooldown || 0}턴`]
        .filter(Boolean).join('\n')).replace(/\n/g, '&#10;');
      return `<button class="primary" data-tooltip="${tip}" ${cooldown > 0 ? 'disabled' : ''}
        onclick="choosePvpActionV1('${escape(skill.id)}')">${escape(skill.active?.name || skill.name)}${cooldown > 0 ? ` · ${cooldown}턴` : ''}</button>`;
    }).join('');
    return `<div class="combat-menu pvp-skill-menu-v2">${buttons}<button class="ghost" onclick="renderPvpMenuV1()">뒤로</button></div>`;
  }

  function questionHtml() {
    const question = state?.question || {};
    const choices = Array.isArray(question.choices) && question.choices.length >= 2
      ? question.choices.slice(0, 4)
      : null;
    const action = actionDefinition(selectedAction);
    const answerHtml = choices ? `<div class="choice-grid">
      ${choices.map((choice, index) => `<button data-answer-key="${encoded(choice)}" onclick="submitPvpChoiceV1('${encoded(choice)}')">
        <span class="objective-chip">${index + 1}</span>${escape(choice)}
      </button>`).join('')}
    </div>` : `<div class="answer-row">
      <input id="pvpAnswerV1" autocomplete="off" placeholder="정답 입력" onkeydown="if(event.key==='Enter') submitPvpActionV1()" autofocus />
      <button class="primary" onclick="submitPvpActionV1()">정답 제출</button>
    </div>`;
    return `<div class="combat-question">
      <div class="pvp-question-topline-v2"><span class="badge">${escape(action.name)}</span><b id="pvpTimerV2">${remainingSeconds()}초</b></div>
      <h3>${escape(question.prompt || question.q || '문제를 준비하고 있어요.')}</h3>
      ${answerHtml}
      <div class="action-row"><button class="ghost" onclick="renderPvpMenuV1()">취소</button></div>
    </div>`;
  }

  function remainingSeconds() {
    if (!state) return 0;
    const deadline = state.phase === 'reconnect' ? state.reconnectDeadline : state.deadline;
    return Math.max(0, Math.ceil((Number(deadline) - Date.now()) / 1000));
  }

  function contentHtml() {
    if (!state) return '';
    if (state.phase === 'finished' || state.phase === 'cancelled') {
      if (state.phase === 'cancelled') {
        return `<div class="pvp-result-v1">
          <h2>대전이 종료되었습니다.</h2>
          <p>다음 문제를 준비할 수 없어 대전을 안전하게 마쳤습니다. 승패에는 반영되지 않습니다.</p>
          <button class="primary" onclick="leavePvpScreenV1()">마을로 돌아가기</button>
        </div>`;
      }
      const won = state.winnerId === global.getPvpIdentityV1?.()?.userId;
      return `<div class="pvp-result-v1">
        <h2>${won ? '🏆 승리!' : '다음엔 이길 수 있어요!'}</h2>
        <p>월드 체력과 보유 자원은 그대로 유지됩니다.</p>
        <button class="primary" onclick="leavePvpScreenV1()">마을로 돌아가기</button>
      </div>`;
    }
    if (state.phase === 'reconnect') {
      return `<div class="pvp-wait-v1">상대의 재접속을 기다리고 있어요. <b id="pvpTimerV2">${remainingSeconds()}초</b></div>`;
    }
    if (processingEvents || uiMode === 'playback') {
      return '<div class="pvp-combat-progress-v2">선공부터 차례대로 공격합니다.</div>';
    }
    if (uiMode === 'waiting') {
      return '<div class="pvp-wait-v1">상대가 문제를 풀고 있어요. 잠시만 기다려 주세요!</div>';
    }
    if (uiMode === 'skill') return skillMenuHtml();
    if (uiMode === 'question') return questionHtml();
    return actionMenuHtml();
  }

  function render() {
    if (!state || confirmingSurrender) return;
    const me = playerForRole('me');
    const opponent = playerForRole('opponent');
    const meDefeated = Number(me.hp) <= 0 ? ' pvp-defeated-v2' : '';
    const opponentDefeated = Number(opponent.hp) <= 0 ? ' pvp-defeated-v2' : '';
    const message = combatMessage || `${opponent.name || '상대'} 학생과의 대전! 무엇을 할까요?`;
    global.openModal?.(`<div class="pvp-battle-v2">
      <h2>전투 <span class="pvp-round-badge-v2">친선 대전 · ${Math.max(1, Number(state.round) || 1)}라운드
        ${!['finished', 'cancelled'].includes(state.phase) ? `<b id="pvpRoundTimerV2">${remainingSeconds()}초</b>` : ''}
      </span></h2>
      <div class="combat-layout">
        <div class="combat-stage combat-layout-rollback-v27 pvp-combat-stage-v2">
          <div class="combat-vs-flash"></div>
          ${hpBox('me')}
          ${hpBox('opponent')}
          <div class="combat-sprite combat-player combat-idle combat-idle-player${meDefeated}">
            <canvas id="pvpPlayerCanvasV2" width="230" height="190"></canvas>
          </div>
          <div class="combat-sprite combat-monster combat-idle combat-idle-monster${opponentDefeated}">
            <canvas id="pvpOpponentCanvasV2" width="230" height="190"></canvas>
          </div>
          ${diceOverlay()}
        </div>
        <div class="panel-card pvp-combat-panel-v2">
          <h3 class="combat-notice ${escape(combatTone)}">${escape(message)}</h3>
          ${contentHtml()}
        </div>
      </div>
    </div>`, { type:'pvpBattle', pause:true });
    drawCombatants();
    const settleHpBars = () => {
      if (!state) return;
      const me = playerForRole('me');
      const opponent = playerForRole('opponent');
      const ratios = {
        me:Math.max(0, Math.min(100, (Number(me.hp) || 0) / Math.max(1, Number(me.maxHp) || 1) * 100)),
        opponent:Math.max(0, Math.min(100, (Number(opponent.hp) || 0) / Math.max(1, Number(opponent.maxHp) || 1) * 100)),
      };
      const meFill = document.getElementById('pvpPlayerHpFillV2');
      const opponentFill = document.getElementById('pvpOpponentHpFillV2');
      if (meFill) meFill.style.width = `${ratios.me}%`;
      if (opponentFill) opponentFill.style.width = `${ratios.opponent}%`;
      hpDisplay = ratios;
    };
    if (typeof global.requestAnimationFrame === 'function') global.requestAnimationFrame(settleHpBars);
    else setTimeout(settleHpBars, 0);
    if (uiMode === 'question' && !(state.question?.choices?.length >= 2)) {
      setTimeout(() => document.getElementById('pvpAnswerV1')?.focus?.(), 40);
    }
  }

  function drawCombatants() {
    global.renderPlayerCombatantForPvpV1?.(
      document.getElementById('pvpPlayerCanvasV2'),
      playerForRole('me'),
      false,
    );
    global.renderPlayerCombatantForPvpV1?.(
      document.getElementById('pvpOpponentCanvasV2'),
      playerForRole('opponent'),
      true,
    );
  }

  function updateCountdown() {
    if (!state || confirmingSurrender) return;
    const value = `${remainingSeconds()}초`;
    const timer = document.getElementById('pvpTimerV2');
    const roundTimer = document.getElementById('pvpRoundTimerV2');
    if (timer) timer.textContent = value;
    if (roundTimer) roundTimer.textContent = value;
  }

  function updateDiceDom() {
    const left = document.getElementById('pvpLeftDieV2');
    const right = document.getElementById('pvpRightDieV2');
    const caption = document.getElementById('pvpDiceCaptionV2');
    if (left) left.textContent = String(diceVisual?.left ?? 1);
    if (right) right.textContent = String(diceVisual?.right ?? 1);
    if (caption) caption.textContent = diceVisual?.caption || '';
    [left, right].forEach((die) => {
      if (!die?.classList) return;
      die.classList.toggle('rolling', diceVisual?.rolling === true);
      die.classList.toggle('settled', diceVisual?.rolling === false);
    });
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
  }

  function randomDie() {
    return 1 + Math.floor(Math.random() * 30);
  }

  async function animateDice(event, generation) {
    const rolls = Array.isArray(event.rolls) && event.rolls.length
      ? event.rolls
      : [{ a:1, b:1 }];
    const mine = meSide();
    const opponent = otherSide();
    const history = [];
    uiMode = 'playback';
    combatTone = '';

    for (let rollIndex = 0; rollIndex < rolls.length; rollIndex += 1) {
      if (!state || generation !== playbackGeneration) return;
      const roll = rolls[rollIndex];
      diceVisual = {
        visible:true,
        rolling:true,
        left:randomDie(),
        right:randomDie(),
        caption:rollIndex === 0 ? '주사위를 굴리는 중...' : '동점! 다시 굴립니다...',
        history:history.join(' → '),
      };
      combatMessage = '누가 먼저 공격할지 주사위를 굴립니다!';
      render();
      for (let frame = 0; frame < 13; frame += 1) {
        if (!state || generation !== playbackGeneration) return;
        diceVisual.left = randomDie();
        diceVisual.right = randomDie();
        updateDiceDom();
        await delay(60);
      }
      diceVisual.left = Number(roll[mine]) || 1;
      diceVisual.right = Number(roll[opponent]) || 1;
      diceVisual.rolling = false;
      const tied = Number(roll.a) === Number(roll.b);
      history.push(`${diceVisual.left} : ${diceVisual.right}`);
      diceVisual.history = history.join(' → ');
      diceVisual.caption = tied
        ? '동점! 주사위를 다시 굴립니다.'
        : `${sideName(event.first)} 학생이 먼저 공격합니다!`;
      updateDiceDom();
      global.playSfx?.(tied ? 'open' : 'reward');
      await delay(tied ? 650 : 900);
    }
    diceVisual = null;
  }

  function setCombatLog(message, tone = '') {
    combatMessage = message;
    combatTone = tone;
    render();
  }

  function playActionSound(sourceSide, actionId, skill) {
    if (actionId !== 'basic' && skill) {
      global.playSkillSfxV42?.(actionId, skill);
      return;
    }
    const klass = state?.[sourceSide]?.className || 'warrior';
    const audioId = global.YuksamAudioManifest?.classBasicSounds?.[klass];
    const fallback = () => global.playSfx?.(klass === 'warrior' ? 'slash' : klass === 'mage' ? 'magic' : 'shadow');
    if (!audioId || !global.playMappedAudio?.(audioId, { onFallback:fallback })) fallback();
  }

  async function playActionFx(event, skill) {
    const fx = global.YuksamCombatFx;
    if (!fx) {
      await delay(320);
      return;
    }
    const sourceIsMe = event.source === meSide();
    const source = state?.[event.source] || {};
    let profile = event.actionId && event.actionId !== 'basic'
      ? fx.getSkillFxProfile?.(event.actionId, skill)
      : fx.getBasicAttackFxProfile?.(source.className || 'warrior');
    if (!profile) {
      await delay(320);
      return;
    }
    const selfTarget = SUPPORT_TYPES.has(skill?.active?.type);
    profile = {
      ...profile,
      source:sourceIsMe ? 'player' : 'monster',
      target:selfTarget
        ? (sourceIsMe ? 'player' : 'monster')
        : (sourceIsMe ? 'monster' : 'player'),
    };
    try {
      await (sourceIsMe ? fx.playPlayerActionFx?.(profile) : fx.playMonsterActionFx?.(profile));
    } catch {
      await delay(320);
    }
  }

  function showImpact(targetSide, amount, kind = 'damage') {
    const targetIsMe = targetSide === meSide();
    const selector = targetIsMe ? '.combat-player' : '.combat-monster';
    const actor = document.querySelector?.(`#modalContent ${selector}`) || document.querySelector?.(selector);
    actor?.classList?.add('impact');
    setTimeout(() => actor?.classList?.remove('impact'), 430);
    const stage = document.querySelector?.('#modalContent .pvp-combat-stage-v2')
      || document.querySelector?.('.pvp-combat-stage-v2');
    if (!stage?.appendChild || !document.createElement) return;
    const number = document.createElement('span');
    number.className = `combat-floating-damage ${targetIsMe ? 'player' : 'monster'} ${kind}`;
    number.textContent = kind === 'heal' || kind === 'shield' ? `+${Math.max(0, Number(amount) || 0)}` : `-${Math.max(0, Number(amount) || 0)}`;
    number.style.left = targetIsMe ? '24%' : '76%';
    number.style.top = targetIsMe ? '62%' : '48%';
    stage.appendChild(number);
    setTimeout(() => number.remove?.(), 1250);
  }

  async function playEvent(event, generation) {
    if (!state || generation !== playbackGeneration) return;
    if (event.kind === 'dice') {
      await animateDice(event, generation);
      return;
    }

    const target = state[event.target];
    const source = state[event.source];
    const sourceName = source?.name || sideName(event.source);
    if (event.kind === 'action') {
      const skill = event.actionId === 'basic' ? null : global.YuksamData?.V24_SKILLS?.[event.actionId];
      const action = actionDefinition(event.actionId);
      const wrong = event.correct !== true;
      const answerMessage = wrong
        ? `${sourceName}: 오답입니다! 정답은 ${event.correctAnswer ?? ''} (오답이라 데미지가 절반만 들어갑니다)`
        : `${sourceName} 학생이 정답을 맞혔습니다!`;
      const message = event.prevented === 'stun'
        ? `${answerMessage} 하지만 기절해서 행동하지 못했습니다!`
        : wrong ? answerMessage : `${answerMessage} ${action.name}!`;
      setCombatLog(message, wrong ? 'wrong-answer' : event.source === meSide() ? 'correct-answer' : 'enemy-action');
      if (event.prevented === 'stun') {
        global.playSfx?.('open');
        await delay(EVENT_DELAYS.action);
        return;
      }
      playActionSound(event.source, event.actionId || 'basic', skill);
      await playActionFx(event, skill);
      return;
    }

    if (event.kind === 'cooldown' && target) {
      target.cooldowns = target.cooldowns || {};
      target.cooldowns[event.skillId] = Math.max(0, Number(event.amount) || 0);
      return;
    }

    if (event.kind === 'damage' && target) {
      const absorbed = Math.max(0, Number(event.absorbed) || 0);
      const hpDamage = Math.max(0, Number(event.hpDamage) || 0);
      target.shield = Math.max(0, Number(target.shield || 0) - absorbed);
      target.hp = Math.max(0, Number(target.hp || 0) - hpDamage);
      const targetName = target.name || sideName(event.target);
      const parts = [];
      if (hpDamage > 0) parts.push(`체력 ${hpDamage} 피해`);
      if (absorbed > 0) parts.push(`보호막 ${absorbed} 피해`);
      setCombatLog(`${targetName} 학생이 ${parts.join(', ') || '피해를 막아냈습니다'}!`,
        event.target === meSide() ? 'enemy-action' : 'correct-answer');
      showImpact(event.target, hpDamage || absorbed, hpDamage > 0 ? 'damage' : 'shield-damage');
      if (absorbed > 0 && hpDamage === 0) global.playSfx?.('shieldBlock');
      else global.playSfx?.('hit');
      await delay(EVENT_DELAYS.damage);
      return;
    }

    if (event.kind === 'heal' && target) {
      const before = Math.max(0, Number(target.hp) || 0);
      target.hp = Math.min(Math.max(1, Number(target.maxHp) || 1), before + Math.max(0, Number(event.amount) || 0));
      const gained = Math.max(0, Number(target.hp) - before);
      setCombatLog(`${target.name || sideName(event.target)} 학생의 체력이 ${gained} 회복되었습니다!`, 'correct-answer');
      showImpact(event.target, gained, 'heal');
      global.playSfx?.('heal');
      await delay(EVENT_DELAYS.heal);
      return;
    }

    if (event.kind === 'shield' && target) {
      const amount = Math.max(0, Number(event.amount) || 0);
      target.shield = Math.max(0, Number(target.shield) || 0) + amount;
      const passive = event.skillId === 'warrior_basic_guard' || event.passive === true;
      setCombatLog(passive
        ? `${target.name || sideName(event.target)} 학생의 막기 훈련! 보호막 ${amount} 생성!`
        : `${target.name || sideName(event.target)} 학생에게 보호막 ${amount} 생성!`,
      'correct-answer');
      showImpact(event.target, amount, 'shield');
      const fallback = () => global.playSfx?.('reward');
      if (!global.playMappedAudio?.('blockShield', { onFallback:fallback })) fallback();
      await delay(EVENT_DELAYS.shield);
      return;
    }

    if (event.kind === 'status' && target) {
      target.statuses = target.statuses || {};
      target.statuses[event.status] = Math.max(0, Number(event.turns ?? event.amount) || 0);
      const labels = { stun:'기절', chill:'냉기', shadow:'암흑' };
      setCombatLog(`${target.name || sideName(event.target)} 학생에게 ${labels[event.status] || event.status} 효과가 적용되었습니다!`,
        event.target === meSide() ? 'enemy-action' : 'correct-answer');
      global.playSfx?.('open');
      await delay(EVENT_DELAYS.status);
    }
  }

  function eventKey(event) {
    if (event.id) return String(event.id);
    if (Number.isFinite(Number(event.sequenceNo))) {
      return `${event.round ?? state?.round}:${Number(event.sequenceNo)}`;
    }
    return `local:${event.round ?? state?.round}:${event.kind}:${event.source || ''}:${event.target || ''}:${eventOrder}`;
  }

  function enqueueEvent(event) {
    if (!state || event.type && event.type !== 'event') return;
    const eventRound = Number(event.round);
    if (Number.isFinite(eventRound) && eventRound < Number(state.round)) return;
    const key = eventKey(event);
    if (processedEvents.has(key) || eventQueue.some((entry) => entry.key === key)) return;
    eventOrder += 1;
    eventQueue.push({ key, event:{ ...event }, order:eventOrder });
    eventQueue.sort((left, right) => {
      const a = Number(left.event.sequenceNo);
      const b = Number(right.event.sequenceNo);
      if (Number.isFinite(a) && Number.isFinite(b)) return a - b;
      return left.order - right.order;
    });
    if (event.kind === 'dice') {
      if (queueStartTimer) clearTimeout(queueStartTimer);
      queueStartTimer = null;
      processEventQueue();
    } else if (!processingEvents && !queueStartTimer) {
      queueStartTimer = setTimeout(() => {
        queueStartTimer = null;
        processEventQueue();
      }, 70);
    }
  }

  async function processEventQueue() {
    if (processingEvents || !state) return;
    processingEvents = true;
    uiMode = 'playback';
    const generation = playbackGeneration;
    while (state && generation === playbackGeneration && eventQueue.length) {
      const entry = eventQueue.shift();
      if (processedEvents.has(entry.key)) continue;
      processedEvents.add(entry.key);
      await playEvent(entry.event, generation);
    }
    if (!state || generation !== playbackGeneration) return;
    processingEvents = false;
    diceVisual = null;
    applyPendingMatchSoon(320);
  }

  function applyPendingMatchSoon(delayMs = 700) {
    if (!pendingMatch || processingEvents || eventQueue.length) return;
    if (pendingMatchTimer) clearTimeout(pendingMatchTimer);
    pendingMatchTimer = setTimeout(() => {
      pendingMatchTimer = null;
      if (!pendingMatch || processingEvents || eventQueue.length || !state) return;
      const next = pendingMatch;
      pendingMatch = null;
      const previousRound = Number(state.round);
      const previousPhase = state.phase;
      const nextRound = Number(next.round);
      const roundAdvanced = nextRound > previousRound;
      const terminal = ['finished', 'cancelled'].includes(next.phase);
      const preserveAnimatedHealth = terminal && nextRound === previousRound;
      state = {
        ...state,
        ...next,
        a:preserveAnimatedHealth ? state.a : { ...state.a, ...next.a },
        b:preserveAnimatedHealth ? state.b : { ...state.b, ...next.b },
      };
      diceVisual = null;
      if (terminal) {
        submittedRound = null;
        selectedAction = 'basic';
        uiMode = 'result';
        combatMessage = state.phase === 'cancelled'
          ? '대전을 안전하게 종료했습니다.'
          : (state.winnerId === global.getPvpIdentityV1?.()?.userId ? '대전에서 승리했습니다!' : '대전이 끝났습니다.');
        combatTone = state.phase === 'finished'
          ? (state.winnerId === global.getPvpIdentityV1?.()?.userId ? 'correct-answer' : 'enemy-action')
          : '';
        render();
        return;
      }
      if (roundAdvanced) {
        submittedRound = null;
        selectedAction = 'basic';
        uiMode = 'menu';
        combatMessage = `${state.round}라운드! 무엇을 할까요?`;
        combatTone = '';
        render();
        return;
      }
      if (Number(submittedRound) === nextRound) {
        uiMode = 'waiting';
        combatMessage = '답을 제출했습니다. 상대를 기다리는 중입니다.';
        combatTone = '';
        if (previousPhase === 'reconnect' || state.phase === 'reconnect') render();
        return;
      }
      if (previousPhase === 'reconnect' || state.phase === 'reconnect') render();
    }, delayMs);
  }

  function handleRealtime(event) {
    if (!state || !event) return;
    if (event.type === 'event') {
      enqueueEvent(event);
      return;
    }
    if (event.type === 'match' && event.match) {
      const next = normalizedMatch(event.match);
      if (Number(next.round) < Number(state.round)) return;
      const needsRoundReplay = Number(next.round) > Number(state.round)
        || ['finished', 'cancelled'].includes(next.phase);
      pendingMatch = next;
      if (needsRoundReplay) syncFromServer(Number(state.round));
      applyPendingMatchSoon(needsRoundReplay ? 1200 : 800);
    }
  }

  async function loadProfiles(matchId, generation) {
    const client = global.getPvpClientV1?.();
    if (!client?.profile || !state) return;
    const ids = [state.playerAId, state.playerBId];
    const profiles = await Promise.all(ids.map((id) => client.profile(id).catch(() => null)));
    if (!state || state.matchId !== matchId || generation !== profileGeneration) return;
    if (profiles[0]) state.a = { ...profiles[0], ...state.a, appearance:profiles[0].appearance || {}, equipment:profiles[0].equipment || {}, costume:profiles[0].costume || {} };
    if (profiles[1]) state.b = { ...profiles[1], ...state.b, appearance:profiles[1].appearance || {}, equipment:profiles[1].equipment || {}, costume:profiles[1].costume || {} };
    if (processingEvents || diceVisual?.visible) drawCombatants();
    else render();
  }

  function enterPvpMatchV1(match) {
    const incoming = normalizedMatch(match);
    if (state?.matchId === incoming.matchId) {
      pendingMatch = incoming;
      applyPendingMatchSoon(80);
      return;
    }
    unsubscribe?.();
    if (queueStartTimer) clearTimeout(queueStartTimer);
    queueStartTimer = null;
    playbackGeneration += 1;
    profileGeneration += 1;
    state = incoming;
    pendingMatch = null;
    eventQueue = [];
    processedEvents.clear();
    processingEvents = false;
    eventOrder = 0;
    hpDisplay = { me:null, opponent:null };
    submittedRound = null;
    syncInFlight = false;
    selectedAction = 'basic';
    uiMode = ['finished', 'cancelled'].includes(state.phase) ? 'result' : 'menu';
    combatMessage = state.phase === 'finished'
      ? '대전이 끝났습니다.'
      : state.phase === 'cancelled'
        ? '대전을 안전하게 종료했습니다.'
        : `${playerForRole('opponent').name || '상대'} 학생과의 대전!`;
    combatTone = '';
    diceVisual = null;
    confirmingSurrender = false;
    const client = global.getPvpClientV1?.();
    unsubscribe = client?.subscribe(state.matchId, handleRealtime) || null;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      if (!state) return;
      const roundAtHeartbeat = Number(state.round);
      const afterSequence = Math.max(0, roundAtHeartbeat * 1000 - 1);
      client?.heartbeat(state.matchId, afterSequence)
        .then?.((result) => handleSubmitResult(result, roundAtHeartbeat))
        .catch?.(() => {});
    }, 5000);
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = setInterval(updateCountdown, 1000);
    render();
    loadProfiles(state.matchId, profileGeneration).catch(() => {});
  }

  function renderPvpMenuV1(message) {
    if (!state || processingEvents || uiMode === 'waiting') return;
    selectedAction = 'basic';
    uiMode = 'menu';
    combatMessage = message || '무엇을 할까요?';
    combatTone = '';
    render();
  }

  function openPvpSkillMenuV1() {
    if (!state || processingEvents || uiMode === 'waiting') return;
    uiMode = 'skill';
    combatMessage = activeSkills().length ? '사용할 스킬을 선택하세요.' : '아직 배운 액티브 스킬이 없습니다.';
    combatTone = '';
    render();
  }

  function choosePvpActionV1(actionId) {
    if (!state || processingEvents || uiMode === 'waiting') return;
    const action = actionDefinition(actionId);
    if (actionId !== 'basic') {
      const me = playerForRole('me');
      if (!me.skills?.[actionId] || !action.active) return;
      const cooldown = Math.max(0, Number(me.cooldowns?.[actionId]) || 0);
      if (cooldown > 0) {
        global.toast?.(`${action.name}은(는) ${cooldown}턴 뒤에 사용할 수 있어요.`);
        return;
      }
    }
    selectedAction = actionId || 'basic';
    uiMode = 'question';
    combatMessage = `${action.name}을(를) 사용하려면 문제를 맞혀 보세요.`;
    combatTone = '';
    render();
  }

  function submitPvpChoiceV1(value) {
    let answer = '';
    try { answer = decodeURIComponent(String(value ?? '')); } catch { answer = String(value ?? ''); }
    return submitPvpActionV1(selectedAction, answer);
  }

  function applyServerSnapshot(snapshot, fallbackRound) {
    if (!state || !snapshot) return;
    const rawMatch = snapshot.match || snapshot;
    const replayEvents = snapshot.replayEvents || rawMatch.replayEvents || [];
    for (const event of replayEvents) {
      enqueueEvent({
        ...event,
        type:'event',
        round:Number(event.round) || Number(fallbackRound) || Number(state.round),
      });
    }
    if (rawMatch?.id) {
      const next = normalizedMatch(rawMatch);
      if (Number(next.round) < Number(state.round)) return;
      pendingMatch = next;
      applyPendingMatchSoon(replayEvents.length ? 450 : 120);
    }
  }

  async function syncFromServer(roundHint) {
    if (!state || syncInFlight) return;
    const client = global.getPvpClientV1?.();
    if (!client?.sync) return;
    const matchId = state.matchId;
    const replayRound = Math.max(1, Number(roundHint) || Number(state.round) || 1);
    syncInFlight = true;
    try {
      const synced = await client.sync(matchId, replayRound * 1000 - 1);
      if (state?.matchId === matchId && synced) applyServerSnapshot(synced, replayRound);
    } catch {}
    finally {
      syncInFlight = false;
    }
  }

  async function handleSubmitResult(result, responseRound) {
    if (!state || !result) return;
    const resolvedRound = Math.max(1, Number(result.round) || Number(responseRound) || Number(state.round) || 1);
    if (result.waiting === true) submittedRound = resolvedRound;
    if (Array.isArray(result.events)) {
      result.events.forEach((event) => enqueueEvent({
        ...event,
        type:'event',
        round:Number(event.round) || resolvedRound,
      }));
    }
    if (result.match || result.replayEvents) applyServerSnapshot(result, resolvedRound);
    if ((result.resolved || result.finished || result.cancelled) && !result.match) {
      await syncFromServer(resolvedRound);
    }
  }

  async function submitPvpActionV1(actionId, answer) {
    if (!state || processingEvents || uiMode === 'waiting') return;
    const chosen = actionId || selectedAction || 'basic';
    const submittedAnswer = answer ?? document.getElementById('pvpAnswerV1')?.value ?? '';
    const submittedMatchId = state.matchId;
    const roundAtSubmit = Number(state.round);
    submittedRound = roundAtSubmit;
    uiMode = 'waiting';
    combatMessage = '답을 제출했습니다. 상대를 기다리는 중입니다.';
    combatTone = '';
    render();
    try {
      const result = await global.getPvpClientV1().submit(submittedMatchId, roundAtSubmit, chosen, submittedAnswer);
      if (state?.matchId !== submittedMatchId) return;
      await handleSubmitResult(result, roundAtSubmit);
      if (!result?.waiting && !processingEvents && !eventQueue.length) {
        uiMode = 'playback';
        combatMessage = '두 학생의 답이 도착했습니다!';
        render();
      }
    } catch (error) {
      if (state?.matchId !== submittedMatchId) return;
      submittedRound = null;
      uiMode = 'question';
      global.toast?.(error?.message || '답을 제출하지 못했어요.');
      render();
    }
  }

  function surrenderPvpV1() {
    if (!state) return;
    if (['finished', 'cancelled'].includes(state.phase)) { leavePvpScreenV1(); return; }
    confirmingSurrender = true;
    global.openModal?.(`<div class="pvp-surrender-v1"><h2>정말 항복할까요?</h2>
      <p>항복하면 내 패배 기록과 상대의 승리 기록이 각각 1회 추가됩니다.</p>
      <div class="action-row"><button class="danger" onclick="confirmSurrenderPvpV1()">항복하기</button><button class="ghost" onclick="restorePvpMatchV1()">계속 싸우기</button></div>
    </div>`, { type:'pvpSurrender', pause:true });
  }

  async function confirmSurrenderPvpV1() {
    if (!state) return;
    const client = global.getPvpClientV1();
    try {
      await client.surrender(state.matchId);
      const synced = await client.sync?.(state.matchId);
      if (synced) {
        const next = normalizedMatch(synced);
        state = { ...state, ...next, a:state.a, b:state.b };
      } else {
        state.phase = 'finished';
        state.loserId = global.getPvpIdentityV1?.()?.userId;
        state.winnerId = state.loserId === state.playerAId ? state.playerBId : state.playerAId;
      }
      combatMessage = '항복하여 대전이 끝났습니다.';
      combatTone = 'enemy-action';
      uiMode = 'result';
    } catch (error) {
      global.toast?.(error?.message || '항복을 처리하지 못했어요.');
    }
    confirmingSurrender = false;
    render();
  }

  function restorePvpMatchV1() {
    confirmingSurrender = false;
    render();
  }

  function leavePvpScreenV1() {
    unsubscribe?.();
    unsubscribe = null;
    playbackGeneration += 1;
    profileGeneration += 1;
    global.YuksamCombatFx?.cancelAllCombatFx?.();
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (countdownTimer) clearInterval(countdownTimer);
    if (pendingMatchTimer) clearTimeout(pendingMatchTimer);
    if (queueStartTimer) clearTimeout(queueStartTimer);
    heartbeatTimer = null;
    countdownTimer = null;
    pendingMatchTimer = null;
    queueStartTimer = null;
    pendingMatch = null;
    state = null;
    uiMode = 'menu';
    selectedAction = 'basic';
    combatMessage = '';
    combatTone = '';
    diceVisual = null;
    confirmingSurrender = false;
    eventQueue = [];
    processingEvents = false;
    processedEvents.clear();
    hpDisplay = { me:null, opponent:null };
    submittedRound = null;
    syncInFlight = false;
    global.closeModal?.();
  }

  global.enterPvpMatchV1 = enterPvpMatchV1;
  global.renderPvpMenuV1 = renderPvpMenuV1;
  global.openPvpSkillMenuV1 = openPvpSkillMenuV1;
  global.choosePvpActionV1 = choosePvpActionV1;
  global.submitPvpChoiceV1 = submitPvpChoiceV1;
  global.restorePvpMatchV1 = restorePvpMatchV1;
  global.submitPvpActionV1 = submitPvpActionV1;
  global.surrenderPvpV1 = surrenderPvpV1;
  global.confirmSurrenderPvpV1 = confirmSurrenderPvpV1;
  global.leavePvpScreenV1 = leavePvpScreenV1;
  global.getActivePvpMatchV1 = () => state ? { matchId:state.matchId, phase:state.phase } : null;
  global.YuksamInputRouter?.register({
    id:'pvp-surrender-escape',
    type:'keydown',
    priority:120,
    handle:(event) => {
      if (event.key !== 'Escape' || !state) return false;
      event.preventDefault?.();
      surrenderPvpV1();
      return true;
    },
  });
})(window);
