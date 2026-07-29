(function installPvpUiV1(global) {
  'use strict';

  const classNames = Object.freeze({ warrior:'전사', mage:'마법사', priest:'사제' });
  let stopInvites = null;
  let presenceTimer = null;
  let activeInviteId = null;
  let challengePending = false;
  let responsePending = false;
  let presenceInFlight = null;
  const settledInviteIds = new Set();

  function escape(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
    })[char]);
  }

  function client() {
    const value = global.getPvpClientV1?.();
    if (!value) throw new Error('로그인한 뒤 대전을 이용해 주세요.');
    return value;
  }

  function closeSetupModal(type) {
    const current = global.getModalStateTypeV1?.();
    if (!current || current === type) global.closeModal?.();
  }

  function markInviteSettled(inviteId) {
    const safeId = String(inviteId || '');
    if (!safeId) return;
    settledInviteIds.add(safeId);
    if (activeInviteId === safeId) activeInviteId = null;
  }

  async function updatePresence(pvp, flushFirst = false) {
    if (presenceInFlight) {
      if (!flushFirst) return presenceInFlight;
      try { await presenceInFlight; } catch {}
    }
    const operation = (async () => {
      if (flushFirst) await global.flushLocalPlayerForPvpV1?.();
      const profile = global.getLocalPvpProfileV1?.();
      return profile ? pvp.presence(profile.map, profile.busy, profile) : null;
    })();
    presenceInFlight = operation;
    try {
      return await operation;
    } finally {
      if (presenceInFlight === operation) presenceInFlight = null;
    }
  }

  async function refreshMyPvpState(pvp) {
    return updatePresence(pvp, true);
  }

  async function openRemoteProfileV1(userId, skipTutorial = false) {
    if (!skipTutorial && global.shouldShowPvpTutorialV1?.() && global.startPvpTutorialV1) {
      global.startPvpTutorialV1(() => openRemoteProfileV1(userId, true));
      return;
    }
    try {
      const profile = await client().profile(userId);
      if (!profile) throw new Error('상대 학생의 정보를 불러오지 못했어요.');
      const available = profile.pvpAvailable === true;
      global.openModal?.(`
        <div class="pvp-profile-v1">
          <canvas id="pvpProfilePortraitV1" width="180" height="180" aria-label="${escape(profile.name)} 캐릭터 얼굴"></canvas>
          <div class="pvp-profile-info-v1">
            <h2>${escape(profile.name)}</h2>
            <p><b>Lv.${Number(profile.level) || 1}</b> · ${escape(classNames[profile.className] || profile.className || '모험가')} ${profile.spec ? `· ${escape(profile.spec)}` : ''}</p>
            <div class="pvp-record-v1"><strong>${Number(profile.wins) || 0}승</strong><span>${Number(profile.losses) || 0}패</span></div>
            <button class="primary wide" onclick="challengeRemoteV1('${escape(profile.userId)}')" ${available ? '' : 'disabled'}>
              ${available ? '대전 신청' : '지금은 대전할 수 없음'}
            </button>
            ${available ? '<p class="muted">마을에서만 대전을 신청할 수 있어요.</p>' : '<p class="muted">상대가 마을에 없거나 다른 활동 중이에요.</p>'}
          </div>
        </div>
      `, { type:'pvpProfile', pause:true });
      const canvas = document.getElementById('pvpProfilePortraitV1');
      if (canvas) global.renderPlayerPortraitForPvpV1?.(canvas, profile);
    } catch (error) {
      global.toast?.(error?.message || '프로필을 열지 못했어요.', 2600);
    }
  }

  async function challengeRemoteV1(userId) {
    if (challengePending) return;
    challengePending = true;
    try {
      const pvp = client();
      const refreshed = await refreshMyPvpState(pvp);
      if (refreshed?.activeMatch?.id) {
        closeSetupModal('pvpProfile');
        if (global.getActivePvpMatchV1?.()?.matchId !== refreshed.activeMatch.id) {
          global.enterPvpMatchV1?.(refreshed.activeMatch);
        }
        return;
      }
      await pvp.invite(userId);
      global.toast?.('대전 신청을 보냈어요. 상대의 응답을 기다려 주세요!', 3000);
      closeSetupModal('pvpProfile');
    } catch (error) {
      global.toast?.(error?.message || '대전 신청을 보내지 못했어요.', 3000);
    } finally {
      challengePending = false;
    }
  }

  async function respondPvpInviteV1(inviteId, accept) {
    if (responsePending) return null;
    responsePending = true;
    try {
      const pvp = client();
      if (accept === true) {
        const refreshed = await refreshMyPvpState(pvp);
        if (refreshed?.activeMatch?.id) {
          markInviteSettled(inviteId);
          closeSetupModal('pvpInvite');
          if (global.getActivePvpMatchV1?.()?.matchId !== refreshed.activeMatch.id) {
            global.enterPvpMatchV1?.(refreshed.activeMatch);
          }
          return { accepted:true, match:refreshed.activeMatch, recovered:true };
        }
      }
      const result = await pvp.respond(inviteId, accept === true);
      markInviteSettled(inviteId);
      closeSetupModal('pvpInvite');
      if (result?.accepted && result.match
        && global.getActivePvpMatchV1?.()?.matchId !== result.match.id) {
        global.enterPvpMatchV1?.(result.match);
      }
      else if (!accept) global.toast?.('대전 신청을 거절했어요.');
      return result;
    } catch (error) {
      global.toast?.(error?.message || '대전 신청에 응답하지 못했어요.', 3000);
      return null;
    } finally {
      responsePending = false;
    }
  }

  function showInvite(invite) {
    if (!invite?.id || invite.status !== 'pending'
      || settledInviteIds.has(String(invite.id))
      || activeInviteId === invite.id
      || global.getActivePvpMatchV1?.()) return;
    activeInviteId = invite.id;
    const name = invite.challenger_name || invite.challengerName || '다른 학생';
    global.openModal?.(`
      <div class="pvp-invite-v1">
        <h2>⚔️ 대전 신청</h2>
        <p><strong>${escape(name)}</strong> 학생이 대전을 신청했어요!</p>
        <p class="muted">마을에서 문제를 풀며 겨루는 친선 대전이에요. 보상이나 손해는 없고 승패만 기록됩니다.</p>
        <div class="action-row">
          <button class="primary" onclick="respondPvpInviteV1('${escape(invite.id)}', true)">수락</button>
          <button class="ghost" onclick="respondPvpInviteV1('${escape(invite.id)}', false)">거절</button>
        </div>
      </div>
    `, { type:'pvpInvite', pause:true });
  }

  async function handleInvite(pvp, invite) {
    const me = global.getPvpIdentityV1?.();
    const inviteId = String(invite?.id || '');
    const matchId = invite?.match_id || invite?.matchId;
    if (inviteId && invite?.status !== 'pending') {
      const wasVisible = activeInviteId === inviteId;
      markInviteSettled(inviteId);
      if (wasVisible) closeSetupModal('pvpInvite');
    }
    if (invite?.status === 'accepted' && matchId
      && (invite.challenger_id === me?.userId || invite.target_id === me?.userId)) {
      try {
        const match = await pvp.sync(matchId);
        if (match && global.getActivePvpMatchV1?.()?.matchId !== match.id) {
          global.enterPvpMatchV1?.(match);
        }
      } catch (error) {
        global.toast?.(error?.message || '대전 화면을 열지 못했어요.');
      }
      return;
    }
    if (invite?.status !== 'pending' || invite.target_id !== me?.userId) return;
    if (settledInviteIds.has(inviteId) || activeInviteId === inviteId
      || global.getActivePvpMatchV1?.()) return;
    try {
      const challenger = await pvp.profile(invite.challenger_id);
      if (settledInviteIds.has(inviteId) || global.getActivePvpMatchV1?.()) return;
      showInvite({ ...invite, challenger_name:challenger?.name || '다른 학생' });
    } catch {
      if (settledInviteIds.has(inviteId) || global.getActivePvpMatchV1?.()) return;
      showInvite(invite);
    }
  }

  function startPvpUiV1() {
    if (stopInvites) return;
    let pvp;
    try { pvp = client(); } catch { return; }
    const sendPresence = () => {
      updatePresence(pvp).then((result) => {
        const match = result?.activeMatch;
        const active = global.getActivePvpMatchV1?.();
        if (match?.id) {
          if (active?.matchId !== match.id) global.enterPvpMatchV1?.(match);
          return;
        }
        if (result?.pendingInvite) handleInvite(pvp, result.pendingInvite);
      }).catch(() => {});
    };
    stopInvites = pvp.onInvite(
      (invite) => { handleInvite(pvp, invite); },
      sendPresence,
    );
    sendPresence();
    pvp.cleanup?.().catch?.(() => {});
    presenceTimer = setInterval(sendPresence, 5000);
  }

  function stopPvpUiV1() {
    stopInvites?.();
    stopInvites = null;
    if (presenceTimer) clearInterval(presenceTimer);
    presenceTimer = null;
    activeInviteId = null;
    challengePending = false;
    responsePending = false;
    presenceInFlight = null;
    settledInviteIds.clear();
  }

  global.openRemoteProfileV1 = openRemoteProfileV1;
  global.challengeRemoteV1 = challengeRemoteV1;
  global.respondPvpInviteV1 = respondPvpInviteV1;
  global.startPvpUiV1 = startPvpUiV1;
  global.stopPvpUiV1 = stopPvpUiV1;
})(window);
