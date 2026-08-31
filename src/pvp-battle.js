(function installPvpBattleV1(global) {
  'use strict';

  const SUPPORT_TYPES = new Set(['shield', 'buff', 'healBuff', 'healAllies']);
  const LOG_HOLD_SCALE = 1.6;
  const LOG_HOLD_EXTRA_MS = 1000;
  const PVP_QUESTION_TIME_MS = 30000;
  const WRONG_ANSWER_REVIEW_MS = 2000;
  const PVP_INTRO_MS = 1800;
  const EVENT_DELAYS = Object.freeze({
    action:700 * LOG_HOLD_SCALE + LOG_HOLD_EXTRA_MS,
    damage:850 * LOG_HOLD_SCALE + LOG_HOLD_EXTRA_MS,
    heal:750 * LOG_HOLD_SCALE + LOG_HOLD_EXTRA_MS,
    shield:750 * LOG_HOLD_SCALE + LOG_HOLD_EXTRA_MS,
    status:700 * LOG_HOLD_SCALE + LOG_HOLD_EXTRA_MS,
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
  let roundReadyInFlight = false;
  let wrongReview = null;
  let introVisible = false;
  let introTimer = null;
  const processedEvents = new Set();
  const playedResultSoundMatches = new Set();

  function syncPvpAudioState() {
    global.syncPvpBgmV1?.();
    if (!state || state.phase !== 'finished' || !state.matchId) return;
    if (playedResultSoundMatches.has(state.matchId)) return;
    const myId = global.getPvpIdentityV1?.()?.userId;
    const soundId = state.winnerId === myId
      ? 'pvpVictory'
      : (state.loserId === myId ? 'upgradeFail' : null);
    if (!soundId) return;
    playedResultSoundMatches.add(state.matchId);
    global.playMappedAudio?.(soundId);
  }

  function escape(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
    })[char]);
  }

  function highlightPvpCombatNumbers(safeText) {
    return String(safeText || '').replace(
      /HP\s*(?:-\s*)?\d+(?:\s*\/\s*\d+)?|총\s*\d+\s*의\s*피해|\d+\s*피해|체력\s*\d+|보호막\s*\d+|\d+\s*회복/g,
      (fragment) => {
        const className = /^HP\s*/.test(fragment)
          ? 'damage-number-v25-player'
          : (/피해/.test(fragment) || /^체력\s*/.test(fragment)
            ? 'damage-number-v25-enemy'
            : 'damage-number-v25-generic');
        return fragment.replace(/\d+/g, (number) => `<span class="${className}">${number}</span>`);
      },
    );
  }

  function formatPvpCombatMessage(message) {
    /* 사용자 이름과 서버 문구를 먼저 전부 escape한다. 이후에는 정규식에
       사용자 문자열을 넣지 않고, escape된 이름을 글자 그대로 비교한다. */
    const safeMessage = escape(message);
    const names = [
      {
        literal:escape(playerForRole('me').name || ''),
        className:'pvp-combat-name-me',
        color:'#4ade80',
        order:0,
      },
      {
        literal:escape(playerForRole('opponent').name || ''),
        className:'pvp-combat-name-opponent',
        color:'#fca5a5',
        order:1,
      },
    ]
      .filter((entry) => entry.literal)
      .sort((left, right) => right.literal.length - left.literal.length || left.order - right.order);

    if (!names.length) return highlightPvpCombatNumbers(safeMessage);

    const parts = [];
    let plain = '';
    let cursor = 0;
    const flushPlain = () => {
      if (!plain) return;
      parts.push(highlightPvpCombatNumbers(plain));
      plain = '';
    };

    while (cursor < safeMessage.length) {
      const matched = names.find((entry) => safeMessage.startsWith(entry.literal, cursor));
      if (matched) {
        flushPlain();
        parts.push(`<span class="${matched.className}" style="color:${matched.color};font-weight:900">${matched.literal}</span>`);
        cursor += matched.literal.length;
        continue;
      }

      /* 이름이 'lt'처럼 HTML 엔티티 일부와 같아도 &lt; 내부를 건드리지 않는다. */
      const entity = safeMessage.slice(cursor).match(/^&(amp|lt|gt|quot|#39);/);
      if (entity) {
        plain += entity[0];
        cursor += entity[0].length;
        continue;
      }

      plain += safeMessage[cursor];
      cursor += 1;
    }
    flushPlain();
    return parts.join('');
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
      deadline:Number(match.deadline) || (match.question_deadline ? new Date(match.question_deadline).getTime() : Date.now() + PVP_QUESTION_TIME_MS),
      reconnectDeadline:Number(match.reconnectDeadline) || (match.reconnect_deadline ? new Date(match.reconnect_deadline).getTime() : 0),
      playerAId:match.playerAId || match.player_a_id || a.userId,
      playerBId:match.playerBId || match.player_b_id || b.userId,
      a:{ ...a },
      b:{ ...b },
      question:match.question || match.question_public || {},
      winnerId:match.winnerId || match.winner_id || null,
      loserId:match.loserId || match.loser_id || null,
      playerAReadyRound:Number(match.playerAReadyRound ?? match.player_a_ready_round) || 0,
      playerBReadyRound:Number(match.playerBReadyRound ?? match.player_b_ready_round) || 0,
      timerStartedRound:Number(match.timerStartedRound ?? match.timer_started_round)
        || Number(match.round ?? match.round_no)
        || 1,
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
    const stateClass = diceVisual.rolling ? ` rolling motion-${diceVisual.motion || 'launch'}` : ' settled';
    const rerollClass = diceVisual.rerolling ? ' rerolling' : '';
    return `<div class="pvp-dice-overlay-v2${rerollClass}" aria-live="polite">
      <div class="pvp-dice-title-v2"><span>🎲</span> 30면체 주사위</div>
      <div class="pvp-dice-stage-v3">
        <div class="pvp-dice-floor-v3" aria-hidden="true"><i></i><i></i><i></i></div>
        <div class="pvp-dice-pair-v2">
          <div class="pvp-die-shell-v2 side-left">
            <span class="pvp-die-ground-shadow-v3" aria-hidden="true"></span>
            <span class="pvp-die-dust-v3" aria-hidden="true"></span>
            <span id="pvpLeftDieRunnerV3" class="pvp-die-runner-v3 side-left${stateClass}">
              <span id="pvpLeftDieV2" class="pvp-die-v2${stateClass}">
                <i class="pvp-die-facet-v3 facet-a" aria-hidden="true"></i>
                <i class="pvp-die-facet-v3 facet-b" aria-hidden="true"></i>
                <i class="pvp-die-facet-v3 facet-c" aria-hidden="true"></i>
                <b id="pvpLeftDieValueV3">${Math.max(1, Number(diceVisual.left) || 1)}</b>
              </span>
            </span>
          </div>
          <strong class="pvp-dice-vs-v3">VS</strong>
          <div class="pvp-die-shell-v2 side-right">
            <span class="pvp-die-ground-shadow-v3" aria-hidden="true"></span>
            <span class="pvp-die-dust-v3" aria-hidden="true"></span>
            <span id="pvpRightDieRunnerV3" class="pvp-die-runner-v3 side-right${stateClass}">
              <span id="pvpRightDieV2" class="pvp-die-v2${stateClass}">
                <i class="pvp-die-facet-v3 facet-a" aria-hidden="true"></i>
                <i class="pvp-die-facet-v3 facet-b" aria-hidden="true"></i>
                <i class="pvp-die-facet-v3 facet-c" aria-hidden="true"></i>
                <b id="pvpRightDieValueV3">${Math.max(1, Number(diceVisual.right) || 1)}</b>
              </span>
            </span>
          </div>
        </div>
      </div>
      <div id="pvpDiceCaptionV2" class="pvp-dice-caption-v2">${escape(diceVisual.caption || '주사위를 굴리는 중...')}</div>
      <small id="pvpDiceHistoryV3" class="pvp-dice-history-v2">${escape(diceVisual.history || '')}</small>
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

  function normalizedAnswer(value) {
    return String(value ?? '').trim().toLocaleLowerCase('ko-KR');
  }

  function wrongReviewHtml() {
    const question = state?.question || {};
    const correctAnswer = String(wrongReview?.correctAnswer ?? '');
    const choices = Array.isArray(question.choices) && question.choices.length >= 2
      ? question.choices.slice(0, 4)
      : null;
    const answerHtml = choices ? `<div class="choice-grid">
      ${choices.map((choice, index) => {
        const correct = normalizedAnswer(choice) === normalizedAnswer(correctAnswer);
        return `<button disabled class="${correct ? 'correct-answer-review' : ''}">
          <span class="objective-chip">${index + 1}</span>${escape(choice)}
        </button>`;
      }).join('')}
    </div>` : `<div class="answer-row">
      <input value="${escape(correctAnswer)}" readonly class="correct-answer-review" aria-label="정답" />
    </div>`;
    return `<div class="combat-question pvp-wrong-review-v5">
      <div class="pvp-question-topline-v2"><span class="badge">오답 풀이</span><b>정답 확인</b></div>
      <h3>${escape(question.prompt || question.q || '문제')}</h3>
      ${answerHtml}
      <p class="muted">초록색으로 표시된 정답을 확인하세요.</p>
    </div>`;
  }

  function introOverlay() {
    if (!introVisible || !state) return '';
    const me = playerForRole('me');
    const opponent = playerForRole('opponent');
    return `<div class="pvp-battle-intro-v5" aria-live="polite">
      <div class="pvp-intro-title-v5">⚔ 친선 대전 ⚔</div>
      <div class="pvp-intro-versus-v5">
        <strong>${escape(me.name || '나')}</strong>
        <span>VS</span>
        <strong>${escape(opponent.name || '상대')}</strong>
      </div>
      <div class="pvp-intro-start-v5">전투 시작!</div>
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
        <button class="primary" onclick="leavePvpScreenV1()">마을로 돌아가기</button>
      </div>`;
    }
    if (state.phase === 'reconnect') {
      return `<div class="pvp-wait-v1">상대의 재접속을 기다리고 있어요. <b id="pvpTimerV2">${remainingSeconds()}초</b></div>`;
    }
    if (uiMode === 'wrong-review') return wrongReviewHtml();
    if (processingEvents || uiMode === 'playback') {
      return '<div class="pvp-combat-progress-v2">선공부터 차례대로 공격합니다.</div>';
    }
    if (uiMode === 'round-ready') {
      return '<div class="pvp-wait-v1">전투 연출이 끝났습니다. 상대 화면도 준비되는 중이에요...</div>';
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
      <div class="pvp-battle-header-v4">
        <h2>전투</h2>
        <span class="pvp-round-badge-v2">친선 대전 · ${Math.max(1, Number(state.round) || 1)}라운드
          ${!['finished', 'cancelled'].includes(state.phase) && uiMode !== 'round-ready' ? `<b id="pvpRoundTimerV2">${remainingSeconds()}초</b>` : ''}
        </span>
      </div>
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
          ${introOverlay()}
        </div>
        <div class="panel-card pvp-combat-panel-v2">
          <h3 class="combat-notice ${escape(combatTone)}">${formatPvpCombatMessage(message)}</h3>
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
    const leftRunner = document.getElementById('pvpLeftDieRunnerV3');
    const rightRunner = document.getElementById('pvpRightDieRunnerV3');
    const leftValue = document.getElementById('pvpLeftDieValueV3');
    const rightValue = document.getElementById('pvpRightDieValueV3');
    const caption = document.getElementById('pvpDiceCaptionV2');
    const history = document.getElementById('pvpDiceHistoryV3');
    if (leftValue) leftValue.textContent = String(diceVisual?.left ?? 1);
    if (rightValue) rightValue.textContent = String(diceVisual?.right ?? 1);
    if (caption) caption.textContent = diceVisual?.caption || '';
    if (history) history.textContent = diceVisual?.history || '';
    [left, right, leftRunner, rightRunner].forEach((part) => {
      if (!part?.classList) return;
      const rolling = diceVisual?.rolling === true;
      const motion = diceVisual?.motion || 'launch';
      part.classList.toggle('rolling', rolling);
      part.classList.toggle('settled', !rolling);
      part.classList.toggle('motion-launch', rolling && motion === 'launch');
      part.classList.toggle('motion-tumble', rolling && motion === 'tumble');
      part.classList.toggle('motion-brake', rolling && motion === 'brake');
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
        motion:'launch',
        rerolling:rollIndex > 0,
        left:randomDie(),
        right:randomDie(),
        caption:rollIndex === 0 ? '주사위를 굴리는 중...' : '동점! 다시 굴립니다...',
        history:history.join(' → '),
      };
      combatMessage = '누가 먼저 공격할지 주사위를 굴립니다!';
      global.playSfx?.('transition');
      render();
      const frameDelays = [
        55, 55, 55, 55, 55, 55, 55, 55,
        75, 75, 75, 75, 75,
        110, 110, 110,
        180, 180,
      ];
      for (let frame = 0; frame < frameDelays.length; frame += 1) {
        if (!state || generation !== playbackGeneration) return;
        diceVisual.motion = frame < 8 ? 'launch' : frame < 14 ? 'tumble' : 'brake';
        diceVisual.left = randomDie();
        diceVisual.right = randomDie();
        updateDiceDom();
        await delay(frameDelays[frame]);
      }
      diceVisual.left = Number(roll[mine]) || 1;
      diceVisual.right = Number(roll[opponent]) || 1;
      diceVisual.rolling = false;
      diceVisual.motion = 'settled';
      const tied = Number(roll.a) === Number(roll.b);
      history.push(`${diceVisual.left} : ${diceVisual.right}`);
      diceVisual.history = history.join(' → ');
      diceVisual.caption = tied
        ? '동점! 주사위를 다시 굴립니다.'
        : `${sideName(event.first)} 학생이 먼저 공격합니다!`;
      updateDiceDom();
      global.playSfx?.('open');
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

  function showImpact(targetSide, amount, kind = 'damage', lane = 0, critical = false) {
    const targetIsMe = targetSide === meSide();
    const selector = targetIsMe ? '.combat-player' : '.combat-monster';
    const actor = document.querySelector?.(`#modalContent ${selector}`) || document.querySelector?.(selector);
    actor?.classList?.add('impact');
    setTimeout(() => actor?.classList?.remove('impact'), 430);
    const stage = document.querySelector?.('#modalContent .pvp-combat-stage-v2')
      || document.querySelector?.('.pvp-combat-stage-v2');
    if (!stage?.appendChild || !document.createElement) return;
    const number = document.createElement('span');
    number.className = `combat-floating-damage ${targetIsMe ? 'player' : 'monster'} ${kind}${critical ? ' critical' : ''}`;
    number.textContent = kind === 'heal' || kind === 'shield' ? `+${Math.max(0, Number(amount) || 0)}` : `-${Math.max(0, Number(amount) || 0)}`;
    const baseLeft = targetIsMe ? 24 : 76;
    number.style.left = `${baseLeft + Math.max(-1, Math.min(1, Number(lane) || 0)) * 6}%`;
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
      if (wrong) {
        wrongReview = { correctAnswer:String(event.correctAnswer ?? '') };
        uiMode = 'wrong-review';
        render();
        await delay(WRONG_ANSWER_REVIEW_MS);
        if (!state || generation !== playbackGeneration) return;
        wrongReview = null;
        uiMode = 'playback';
        render();
      }
      if (event.prevented === 'stun') {
        global.playSfx?.('open');
        await delay(EVENT_DELAYS.action);
        return;
      }
      playActionSound(event.source, event.actionId || 'basic', skill);
      const actionStartedAt = Date.now();
      await playActionFx(event, skill);
      const actionFxElapsed = Math.max(0, Date.now() - actionStartedAt);
      await delay(Math.max(0, EVENT_DELAYS.action - actionFxElapsed));
      return;
    }

    if (event.kind === 'cooldown' && target) {
      target.cooldowns = target.cooldowns || {};
      target.cooldowns[event.skillId] = Math.max(0, Number(event.amount) || 0);
      return;
    }

    if (event.kind === 'damage' && target) {
      if (event.missed === true) {
        const targetName = target.name || sideName(event.target);
        const label = String(event.label || '').trim();
        setCombatLog(`${sourceName} 학생의 ${label || '공격'}이 ${targetName} 학생에게 빗나갔습니다!`,
          event.target === meSide() ? 'enemy-action' : 'correct-answer');
        const fallback = () => global.playSfx?.('miss');
        if (!global.playMappedAudio?.('miss', { onFallback:fallback })) fallback();
        await delay(EVENT_DELAYS.damage);
        return;
      }
      const absorbed = Math.max(0, Number(event.absorbed) || 0);
      const hpDamage = Math.max(0, Number(event.hpDamage) || 0);
      const critical = event.critical === true;
      target.shield = Math.max(0, Number(target.shield || 0) - absorbed);
      target.hp = Math.max(0, Number(target.hp || 0) - hpDamage);
      const targetName = target.name || sideName(event.target);
      const parts = [];
      if (absorbed > 0) parts.push(`보호막 ${absorbed}`);
      if (hpDamage > 0) parts.push(`체력 ${hpDamage}`);
      const totalDamage = absorbed + hpDamage;
      setCombatLog(totalDamage > 0
        ? `${critical ? '💥 치명타! ' : ''}${sourceName} 학생이 ${targetName} 학생에게 총 ${totalDamage}의 피해를 주었습니다! (${parts.join(', ')})`
        : `${targetName} 학생이 피해를 막아냈습니다!`,
        event.target === meSide() ? 'enemy-action' : 'correct-answer');
      if (absorbed > 0) showImpact(event.target, absorbed, 'shield-damage', hpDamage > 0 ? -1 : 0);
      if (hpDamage > 0) showImpact(event.target, hpDamage, 'damage', absorbed > 0 ? 1 : 0, critical);
      if (absorbed > 0 && hpDamage === 0) global.playSfx?.('shieldBlock');
      if (critical) global.playSfx?.('critical');
      else if (!(absorbed > 0 && hpDamage === 0)) global.playSfx?.('hit');
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
      const elementalBarrier = event.skillId === 'mage_basic_element';
      const blockTraining = event.skillId === 'warrior_basic_guard';
      setCombatLog(elementalBarrier
        ? `${target.name || sideName(event.target)} 학생의 원소 보호막 발동! 보호막 ${amount} 생성!`
        : blockTraining
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
    wrongReview = null;
    applyPendingMatchSoon(320);
  }

  function hasRoundTimerStarted(match = state) {
    const round = Math.max(1, Number(match?.round) || 1);
    return round === 1 || Number(match?.timerStartedRound) >= round;
  }

  async function signalRoundReady() {
    if (!state || Number(state.round) <= 1 || hasRoundTimerStarted() || roundReadyInFlight) return;
    const matchId = state.matchId;
    const round = Number(state.round);
    roundReadyInFlight = true;
    try {
      const result = await global.getPvpClientV1?.()?.ready?.(matchId, round);
      if (!state || state.matchId !== matchId || Number(state.round) !== round) return;
      if (result?.match) {
        pendingMatch = normalizedMatch(result.match);
        applyPendingMatchSoon(0);
      }
    } catch (error) {
      if (!state || state.matchId !== matchId || Number(state.round) !== round) return;
      global.toast?.(error?.message || '다음 라운드를 준비하지 못했어요. 다시 연결하고 있습니다.');
      setTimeout(() => signalRoundReady(), 1200);
    } finally {
      roundReadyInFlight = false;
    }
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
        syncPvpAudioState();
        render();
        return;
      }
      if (roundAdvanced) {
        submittedRound = null;
        selectedAction = 'basic';
        uiMode = hasRoundTimerStarted() ? 'menu' : 'round-ready';
        combatMessage = hasRoundTimerStarted()
          ? `${state.round}라운드! 무엇을 할까요?`
          : `${state.round}라운드를 함께 준비하고 있습니다.`;
        combatTone = '';
        render();
        if (!hasRoundTimerStarted()) signalRoundReady();
        return;
      }
      if (uiMode === 'round-ready' && hasRoundTimerStarted()) {
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
    roundReadyInFlight = false;
    wrongReview = null;
    if (introTimer) clearTimeout(introTimer);
    introVisible = Number(state.round) === 1 && !['finished', 'cancelled'].includes(state.phase);
    selectedAction = 'basic';
    uiMode = ['finished', 'cancelled'].includes(state.phase)
      ? 'result'
      : (hasRoundTimerStarted() ? 'menu' : 'round-ready');
    combatMessage = state.phase === 'finished'
      ? '대전이 끝났습니다.'
      : state.phase === 'cancelled'
        ? '대전을 안전하게 종료했습니다.'
        : (hasRoundTimerStarted()
          ? `${playerForRole('opponent').name || '상대'} 학생과의 대전!`
          : `${state.round}라운드를 함께 준비하고 있습니다.`);
    combatTone = '';
    diceVisual = null;
    confirmingSurrender = false;
    syncPvpAudioState();
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
    if (introVisible) {
      introTimer = setTimeout(() => {
        introTimer = null;
        introVisible = false;
        if (state && !confirmingSurrender) {
          render();
        }
      }, PVP_INTRO_MS);
    }
    if (!hasRoundTimerStarted()) signalRoundReady();
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
      syncPvpAudioState();
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
    global.syncPvpBgmV1?.();
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
    roundReadyInFlight = false;
    wrongReview = null;
    introVisible = false;
    if (introTimer) clearTimeout(introTimer);
    introTimer = null;
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
