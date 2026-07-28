(function installYuksamPvpClient(global) {
  'use strict';

  const messages = Object.freeze({
    TOWN_ONLY:'대전 신청은 두 학생 모두 마을에 있을 때만 할 수 있어요.',
    OFFLINE:'상대 학생이 지금 접속 중이 아니에요.',
    BUSY:'상대 학생은 지금 다른 활동 중이에요.',
    NO_QUESTIONS:'선생님이 활성화한 문제가 없어 대전을 시작할 수 없어요.',
    MATCH_CLOSED:'이미 끝난 대전이에요.',
    RECONNECTING:'상대 학생의 재접속을 기다리는 중이에요.',
    PROFILE_MISSING:'저장된 캐릭터 정보를 확인한 뒤 다시 시도해 주세요.',
    UNAUTHENTICATED:'다시 로그인한 뒤 이용해 주세요.',
    NOT_INVITED:'이미 끝났거나 내게 온 대전 신청이 아니에요.',
    INVITE_CLOSED:'대전 신청 시간이 지나서 다시 신청해야 해요.',
    INVALID_TARGET:'대전 상대를 다시 선택해 주세요.',
    SERVER_ERROR:'대전 서버에서 오류가 났어요. 잠시 뒤 다시 시도해 주세요.',
  });

  function create({ client, getIdentity }) {
    if (!client?.functions?.invoke || typeof getIdentity !== 'function') {
      throw new Error('PvP client dependencies are required');
    }
    let requestSequence = 0;
    const channels = new Set();

    function identity() {
      const value = getIdentity();
      if (!value?.userId) {
        const error = new Error(messages.UNAUTHENTICATED);
        error.code = 'UNAUTHENTICATED';
        throw error;
      }
      return value;
    }

    function requestId(prefix) {
      requestSequence += 1;
      return `${prefix}-${Date.now().toString(36)}-${requestSequence.toString(36)}`;
    }

    async function invoke(body) {
      identity();
      const { data, error } = await client.functions.invoke('pvp-match-v1', { body });
      let responseError = null;
      if (error?.context && typeof error.context.clone === 'function') {
        try {
          responseError = (await error.context.clone().json())?.error || null;
        } catch {
          responseError = null;
        }
      }
      const code = responseError || data?.error || error?.context?.error || error?.message;
      if (error || data?.error) {
        const failure = new Error(messages[code] || '대전 서버에 연결하지 못했어요.');
        failure.code = code || 'PVP_SERVER_ERROR';
        throw failure;
      }
      return data?.data ?? data;
    }

    function remove(channel) {
      if (!channels.has(channel)) return;
      channels.delete(channel);
      client.removeChannel?.(channel);
    }

    function subscribe(matchId, listener) {
      identity();
      let lastSequence = -1;
      const channel = client.channel(`pvp-match-${matchId}`)
        .on('postgres_changes', {
          event:'*', schema:'public', table:'pvp_match_events_v1',
          filter:`match_id=eq.${matchId}`,
        }, (payload) => {
          const row = payload?.new;
          const sequenceNo = Number(row?.sequence_no);
          if (!Number.isFinite(sequenceNo) || sequenceNo <= lastSequence) return;
          lastSequence = sequenceNo;
          listener({ type:'event', sequenceNo, ...(row.event || {}) });
        })
        .on('postgres_changes', {
          event:'UPDATE', schema:'public', table:'pvp_matches_v1',
          filter:`id=eq.${matchId}`,
        }, (payload) => listener({ type:'match', match:payload?.new }))
        .subscribe();
      channels.add(channel);
      return () => remove(channel);
    }

    function onInvite(listener) {
      const me = identity();
      const channel = client.channel(`pvp-invites-${me.userId}`)
        .on('postgres_changes', {
          event:'*', schema:'public', table:'pvp_invites_v1',
          filter:`target_id=eq.${me.userId}`,
        }, (payload) => listener(payload?.new || payload?.old))
        .on('postgres_changes', {
          event:'*', schema:'public', table:'pvp_invites_v1',
          filter:`challenger_id=eq.${me.userId}`,
        }, (payload) => listener(payload?.new || payload?.old))
        .subscribe();
      channels.add(channel);
      return () => remove(channel);
    }

    function close() {
      [...channels].forEach(remove);
    }

    return Object.freeze({
      presence:(map, busy, publicProfile) => invoke({ op:'presence', map, busy, publicProfile }),
      profile:(userId) => invoke({ op:'profile', userId }),
      invite:(targetUserId) => invoke({ op:'invite', targetUserId, requestId:requestId('invite') }),
      respond:(inviteId, accept) => invoke({ op:'respond', inviteId, accept, requestId:requestId('respond') }),
      submit:(matchId, round, actionId, answer) => invoke({
        op:'submit', matchId, round, actionId, answer, requestId:requestId('submit'),
      }),
      sync:(matchId) => invoke({ op:'sync', matchId }),
      heartbeat:(matchId) => invoke({ op:'heartbeat', matchId }),
      surrender:(matchId) => invoke({ op:'surrender', matchId, requestId:requestId('surrender') }),
      cleanup:() => invoke({ op:'cleanup' }),
      subscribe,
      onInvite,
      close,
    });
  }

  global.YuksamPvpClient = Object.freeze({ create });
})(window);
