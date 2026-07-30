(function installYuksamPvpClient(global) {
  'use strict';

  const messages = Object.freeze({
    INVALID_TARGET:'대전 상대를 다시 선택해 주세요.',
    INVALID_OPERATION:'대전 요청을 다시 시도해 주세요.',
    METHOD_NOT_ALLOWED:'대전 연결 방식이 올바르지 않아요.',
    TOWN_ONLY:'대전 신청은 두 학생 모두 마을에 있을 때만 할 수 있어요.',
    OFFLINE:'상대 학생이 지금 접속 중이 아니에요.',
    BUSY:'상대 학생은 지금 다른 활동 중이에요.',
    NO_QUESTIONS:'선생님이 활성화한 문제가 없어 대전을 시작할 수 없어요.',
    MATCH_CLOSED:'이미 끝난 대전이에요.',
    RECONNECTING:'상대 학생의 재접속을 기다리는 중이에요.',
    PROFILE_MISSING:'저장된 캐릭터 정보를 확인한 뒤 다시 시도해 주세요.',
    UNAUTHENTICATED:'다시 로그인한 뒤 이용해 주세요.',
    NOT_INVITED:'이미 끝났거나 나에게 온 대전 신청이 아니에요.',
    INVITE_CLOSED:'대전 신청 시간이 지났어요. 다시 신청해 주세요.',
    NOT_PARTICIPANT:'이 대전에 참가한 학생 계정으로 다시 로그인해 주세요.',
    MATCH_NOT_FOUND:'대전 정보를 찾지 못했어요. 다시 신청해 주세요.',
    MATCH_STATE_MISSING:'대전 상태를 불러오지 못했어요. 다시 신청해 주세요.',
    ROUND_CHANGED:'이미 다음 문제로 넘어갔어요.',
    ROUND_CLOSED:'이미 처리된 문제예요.',
    INVALID_REQUEST:'대전 요청이 올바르지 않아요. 다시 시도해 주세요.',
    INVALID_PVP_RESULT:'대전 결과를 저장하지 못했어요. 다시 시도해 주세요.',
    TEMPORARY_UNAVAILABLE:'대전 서버가 잠시 바쁩니다. 자동으로 다시 연결하고 있어요.',
    SERVER_ERROR:'대전 서버가 잠시 응답하지 않습니다. 잠시 후 다시 시도해 주세요.',
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

    async function readErrorCode(error, data) {
      if (typeof data?.error === 'string' && data.error) return data.error;
      const context = error?.context;
      if (typeof context?.error === 'string' && context.error) return context.error;
      if (context && typeof context.json === 'function') {
        try {
          const response = typeof context.clone === 'function' ? context.clone() : context;
          const payload = await response.json();
          if (typeof payload?.error === 'string' && payload.error) return payload.error;
        } catch {}
      }
      const message = String(error?.message || '');
      return Object.keys(messages).find((known) => message.includes(known)) || '';
    }

    const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

    async function invoke(body) {
      identity();
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let data;
        let error;
        try {
          ({ data, error } = await client.functions.invoke('pvp-match-v1', { body }));
        } catch (networkError) {
          error = networkError;
        }
        const code = await readErrorCode(error, data);
        if (!error && !data?.error) return data?.data ?? data;
        const retryable = !code || ['SERVER_ERROR', 'PVP_SERVER_ERROR', 'TEMPORARY_UNAVAILABLE'].includes(code);
        if (retryable && attempt === 0) {
          await wait(350);
          continue;
        }
        const failure = new Error(messages[code] || messages.SERVER_ERROR);
        failure.code = code || 'PVP_SERVER_ERROR';
        throw failure;
      }
      return null;
    }

    function remove(channel) {
      if (!channels.has(channel)) return;
      channels.delete(channel);
      client.removeChannel?.(channel);
    }

    function subscribe(matchId, listener) {
      identity();
      if (typeof client.channel !== 'function') return () => {};
      const seenSequences = new Set();
      const channel = client.channel(`pvp-match-${matchId}`)
        .on('postgres_changes', {
          event:'*', schema:'public', table:'pvp_match_events_v1',
          filter:`match_id=eq.${matchId}`,
        }, (payload) => {
          const row = payload?.new;
          const sequenceNo = Number(row?.sequence_no);
          if (!Number.isFinite(sequenceNo) || seenSequences.has(sequenceNo)) return;
          seenSequences.add(sequenceNo);
          listener({
            type:'event',
            sequenceNo,
            round:Number(row?.round_no) || undefined,
            ...(row.event || {}),
          });
        })
        .on('postgres_changes', {
          event:'UPDATE', schema:'public', table:'pvp_matches_v1',
          filter:`id=eq.${matchId}`,
        }, (payload) => listener({ type:'match', match:payload?.new }))
        .subscribe();
      channels.add(channel);
      return () => remove(channel);
    }

    function onInvite(listener, onReady) {
      const me = identity();
      if (typeof client.channel !== 'function') return () => {};
      const channel = client.channel(`pvp-invites-${me.userId}`)
        .on('postgres_changes', {
          event:'*', schema:'public', table:'pvp_invites_v1',
          filter:`target_id=eq.${me.userId}`,
        }, (payload) => listener(payload?.new || payload?.old))
        .on('postgres_changes', {
          event:'*', schema:'public', table:'pvp_invites_v1',
          filter:`challenger_id=eq.${me.userId}`,
        }, (payload) => listener(payload?.new || payload?.old))
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') onReady?.();
        });
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
      sync:(matchId, afterSequence) => invoke({ op:'sync', matchId, afterSequence }),
      heartbeat:(matchId, afterSequence) => invoke({ op:'heartbeat', matchId, afterSequence }),
      surrender:(matchId) => invoke({ op:'surrender', matchId, requestId:requestId('surrender') }),
      cleanup:() => invoke({ op:'cleanup' }),
      subscribe,
      onInvite,
      close,
    });
  }

  global.YuksamPvpClient = Object.freeze({ create });
})(window);
