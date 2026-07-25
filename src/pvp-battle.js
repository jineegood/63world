(function installPvpBattleV1(global) {
  'use strict';

  let state = null;
  let unsubscribe = null;
  let heartbeatTimer = null;
  let countdownTimer = null;
  let notice = '';
  let dice = null;
  let confirmingSurrender = false;

  function escape(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
    })[char]);
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

  function skillOptions() {
    const me = state[meSide()];
    const catalog = global.YuksamData?.V24_SKILLS || {};
    const options = ['<option value="basic">기본 공격</option>'];
    Object.keys(me.skills || {}).forEach((id) => {
      const skill = catalog[id];
      if (skill?.active) options.push(`<option value="${escape(id)}">${escape(skill.active.name || skill.name)}</option>`);
    });
    return options.join('');
  }

  function hpCard(side, label) {
    const player = state[side];
    const hp = Math.max(0, Number(player.hp) || 0);
    const max = Math.max(1, Number(player.maxHp) || 1);
    const ratio = Math.max(0, Math.min(100, hp / max * 100));
    return `<div class="pvp-fighter-v1">
      <canvas id="pvpPortrait${side.toUpperCase()}V1" width="150" height="150"></canvas>
      <h3>${escape(player.name || label)}</h3>
      <div class="pvp-hp-v1"><i style="width:${ratio}%"></i></div>
      <b>HP ${hp} / ${max}</b>${player.shield ? `<span>🛡 ${Number(player.shield)}</span>` : ''}
    </div>`;
  }

  function diceHtml() {
    if (!dice) return '';
    const rows = dice.rolls.map((roll, index) => `<div class="pvp-dice-row-v1">
      <span class="pvp-die-v1">${roll.a}</span><em>${roll.a === roll.b ? '동점! 다시 굴립니다' : index === dice.rolls.length - 1 ? 'VS' : '다시'}</em><span class="pvp-die-v1">${roll.b}</span>
    </div>`).join('');
    const firstName = state[dice.first]?.name || (dice.first === 'a' ? 'A' : 'B');
    return `<div class="pvp-dice-v1"><h3>🎲 30면체 주사위</h3>${rows}<strong>${escape(firstName)} 학생이 먼저 공격합니다!</strong></div>`;
  }

  function phaseContent() {
    if (state.phase === 'reconnect') {
      const seconds = Math.max(0, Math.ceil((state.reconnectDeadline - Date.now()) / 1000));
      return `<div class="pvp-wait-v1">상대의 재접속을 기다리고 있어요. <b>${seconds}초</b></div>`;
    }
    if (state.phase === 'finished') {
      const won = state.winnerId === global.getPvpIdentityV1?.()?.userId;
      return `<div class="pvp-result-v1"><h2>${won ? '🏆 승리!' : '다음엔 이길 수 있어요!'}</h2><p>월드 체력과 보유 자원은 그대로 유지됩니다.</p><button class="primary" onclick="leavePvpScreenV1()">마을로 돌아가기</button></div>`;
    }
    if (notice === 'waiting') return '<div class="pvp-wait-v1">상대가 문제를 풀고 있어요. 잠시만 기다려 주세요!</div>';
    const seconds = Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000));
    return `<div class="pvp-question-v1">
      <div class="pvp-timer-v1">${seconds}초</div>
      <h3>${escape(state.question.prompt || state.question.q || '문제를 준비하고 있어요.')}</h3>
      <select id="pvpActionV1">${skillOptions()}</select>
      <input id="pvpAnswerV1" autocomplete="off" placeholder="답 입력" onkeydown="if(event.key==='Enter') submitPvpActionV1()" />
      <button class="primary" onclick="submitPvpActionV1()">제출</button>
    </div>`;
  }

  function render() {
    if (!state) return;
    global.openModal?.(`<div class="pvp-battle-v1">
      <header><h2>학생 친선 대전 · ${state.round}라운드</h2><button class="danger small" onclick="surrenderPvpV1()">항복</button></header>
      <div class="pvp-arena-v1">${hpCard('a', 'A')}<div class="pvp-center-v1">${diceHtml()}${phaseContent()}</div>${hpCard('b', 'B')}</div>
    </div>`, { type:'pvpBattle', pause:true });
    global.renderPlayerPortraitForPvpV1?.(document.getElementById('pvpPortraitAV1'), state.a);
    global.renderPlayerPortraitForPvpV1?.(document.getElementById('pvpPortraitBV1'), state.b);
  }

  function applyEvent(event) {
    if (!state || event.type !== 'event') return;
    if (event.kind === 'dice') {
      dice = { rolls:event.rolls || [], first:event.first };
      notice = '';
      render();
      return;
    }
    const target = state[event.target];
    if (target && event.kind === 'damage') {
      target.shield = Math.max(0, Number(target.shield || 0) - Number(event.absorbed || 0));
      target.hp = Math.max(0, Number(target.hp || 0) - Number(event.hpDamage || 0));
    } else if (target && event.kind === 'heal') {
      target.hp = Math.min(target.maxHp, Number(target.hp || 0) + Number(event.amount || 0));
    } else if (target && event.kind === 'shield') {
      target.shield = Number(target.shield || 0) + Number(event.amount || 0);
    }
    global.playSfx?.(event.kind === 'damage' ? 'hit' : 'reward');
    render();
  }

  function handleRealtime(event) {
    if (event.type === 'event') applyEvent(event);
    if (event.type === 'match' && event.match) {
      const applyMatch = () => {
        if (!state) return;
        state = { ...state, ...normalizedMatch(event.match) };
        notice = '';
        dice = null;
        render();
      };
      if (dice) setTimeout(applyMatch, 1800);
      else applyMatch();
    }
  }

  function enterPvpMatchV1(match) {
    unsubscribe?.();
    state = normalizedMatch(match);
    notice = '';
    dice = null;
    confirmingSurrender = false;
    const client = global.getPvpClientV1?.();
    unsubscribe = client?.subscribe(state.matchId, handleRealtime) || null;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => client?.heartbeat(state.matchId).catch(() => {}), 5000);
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
      if (!confirmingSurrender && state && ['question', 'reconnect'].includes(state.phase)) render();
    }, 1000);
    render();
  }

  async function submitPvpActionV1(actionId, answer) {
    if (!state || notice === 'waiting') return;
    const selectedAction = actionId || document.getElementById('pvpActionV1')?.value || 'basic';
    const submittedAnswer = answer ?? document.getElementById('pvpAnswerV1')?.value ?? '';
    notice = 'waiting';
    render();
    try {
      const result = await global.getPvpClientV1().submit(state.matchId, state.round, selectedAction, submittedAnswer);
      if (!result?.waiting) notice = '';
      render();
    } catch (error) {
      notice = '';
      global.toast?.(error?.message || '답을 제출하지 못했어요.');
      render();
    }
  }

  function surrenderPvpV1() {
    if (!state) return;
    if (state.phase === 'finished') { leavePvpScreenV1(); return; }
    confirmingSurrender = true;
    global.openModal?.(`<div class="pvp-surrender-v1"><h2>정말 항복할까요?</h2>
      <p>항복하면 내 패배 기록과 상대의 승리 기록이 각각 1회 추가됩니다.</p>
      <div class="action-row"><button class="danger" onclick="confirmSurrenderPvpV1()">항복하기</button><button class="ghost" onclick="restorePvpMatchV1()">계속 싸우기</button></div>
    </div>`, { type:'pvpSurrender', pause:true });
  }

  async function confirmSurrenderPvpV1() {
    if (!state) return;
    const client = global.getPvpClientV1();
    await client.surrender(state.matchId);
    const synced = await client.sync?.(state.matchId);
    if (synced) state = { ...state, ...normalizedMatch(synced) };
    else {
      state.phase = 'finished';
      state.loserId = global.getPvpIdentityV1?.()?.userId;
      state.winnerId = state.loserId === state.playerAId ? state.playerBId : state.playerAId;
    }
    confirmingSurrender = false;
    render();
  }

  function restorePvpMatchV1() {
    confirmingSurrender = false;
    render();
  }

  function leavePvpScreenV1() {
    unsubscribe?.(); unsubscribe = null;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (countdownTimer) clearInterval(countdownTimer);
    heartbeatTimer = null; countdownTimer = null;
    state = null; notice = ''; dice = null; confirmingSurrender = false;
    global.closeModal?.();
  }

  global.enterPvpMatchV1 = enterPvpMatchV1;
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
