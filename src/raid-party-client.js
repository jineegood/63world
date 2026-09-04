(function installYuksamRaidPartyClient(global) {
  'use strict';

  const MESSAGES = Object.freeze({
    UNAUTHENTICATED:'다시 로그인한 뒤 이용해 주세요.',
    SESSION_CHANGED:'다른 창에서 로그인 계정이 바뀌었습니다. 다시 로그인해 주세요.',
    INVALID_REQUEST:'던전 요청이 올바르지 않습니다.',
    FLOOR_LOCKED:'이 구간은 아직 준비 중입니다.',
    PROFILE_MISSING:'저장된 캐릭터 정보를 확인하지 못했습니다.',
    ROOM_NOT_FOUND:'초대 코드를 다시 확인해 주세요.',
    ROOM_FULL:'이미 3명이 모인 방입니다.',
    ROOM_CLOSED:'이미 출발했거나 끝난 방입니다.',
    ALREADY_IN_ROOM:'이미 참여 중인 던전 방이 있습니다.',
    NOT_MEMBER:'이 던전 방에 참여한 계정이 아닙니다.',
    HOST_ONLY:'방장만 할 수 있습니다.',
    PARTY_INCOMPLETE:'3명이 모두 모여야 출발할 수 있습니다.',
    PARTY_COMPOSITION_INVALID:'더 다양한 직업군으로 파티를 구성해야 합니다!',
    FORMATION_INVALID:'앞·가운데·뒤에 한 명씩 배치해 주세요.',
    NOT_READY:'모든 파티원이 준비되어야 출발할 수 있습니다.',
    ROUND_CHANGED:'이미 다음 전투 순서로 넘어갔습니다.',
    ROUND_CLOSED:'지금은 답을 제출할 수 없습니다.',
    PLAYBACK_PENDING:'서버 대기중입니다.',
    QUESTION_PENDING:'서버 대기중입니다.',
    /* 문제 발급이 막힌 이유들 — 예전에는 전부 한 문구로 뭉뚱그려져 있었다. */
    QUESTION_INVALID:'문제를 만들지 못했습니다. 선생님이 문제집을 확인해 주세요.',
    ANSWER_INVALID:'문제의 정답이 비어 있습니다. 선생님이 문제집을 확인해 주세요.',
    QUESTION_COUNT:'세 명 몫의 문제가 만들어지지 않았습니다.',
    ANSWER_COUNT:'세 명 몫의 정답이 만들어지지 않았습니다.',
    MEMBER_MISMATCH:'참가자와 문제가 짝이 맞지 않습니다. 방을 다시 만들어 주세요.',
    JOIN_RATE_LIMIT:'코드를 너무 자주 입력했습니다. 잠시 뒤 다시 시도해 주세요.',
    TEMPORARY_UNAVAILABLE:'던전 서버가 잠시 바쁩니다. 자동으로 다시 연결하고 있어요.',
    SERVER_ERROR:'던전 서버가 응답하지 않습니다. 잠시 뒤 다시 시도해 주세요.',
  });

  /* 실패한 단계를 사람이 읽는 말로 붙여 준다.
     같은 문구라도 어디서 막혔는지 알아야 원인을 찾을 수 있다. */
  const STEP_NAMES = Object.freeze({
    create:'방 만들기',
    join:'방 참가',
    resume:'방 복구',
    sync:'상태 동기화',
    setFormation:'대형 저장',
    ready:'준비',
    start:'던전 출발',
    beginRound:'문제 발급',
    submit:'답 제출',
    publishRound:'전투 결과 반영',
    ackPlayback:'전투 연출 확인',
    ackQuestionReady:'문제 준비 확인',
    heartbeat:'접속 유지',
    leave:'방 나가기',
  });

  function create({ client, getIdentity }) {
    if (!client?.functions?.invoke || typeof getIdentity !== 'function') {
      throw new TypeError('Raid party client dependencies are required.');
    }

    const channels = new Map();
    let requestSequence = 0;
    let lastTraceId = '';

    function identity() {
      const value = getIdentity();
      if (!value?.userId) {
        const error = new Error(MESSAGES.UNAUTHENTICATED);
        error.code = 'UNAUTHENTICATED';
        throw error;
      }
      return value;
    }

    async function assertLiveIdentity() {
      const expected = identity();
      if (typeof client.auth?.getUser !== 'function') return expected;
      const { data, error } = await client.auth.getUser();
      if (error) return expected;
      const actualUserId = String(data?.user?.id || '');
      if (actualUserId && actualUserId !== String(expected.userId)) {
        const failure = new Error(MESSAGES.SESSION_CHANGED);
        failure.code = 'SESSION_CHANGED';
        throw failure;
      }
      return expected;
    }

    function requestId(prefix) {
      requestSequence += 1;
      if (global.crypto?.randomUUID) return global.crypto.randomUUID();
      return `${prefix}-${Date.now().toString(36)}-${requestSequence.toString(36)}`;
    }

    async function readErrorCode(error, data) {
      /* 서버가 붙여 주는 추적 번호도 같이 챙긴다. 원인을 알 수 없는 오류가
         났을 때 이 번호로 서버 기록을 찾을 수 있다. */
      if (typeof data?.traceId === 'string') lastTraceId = data.traceId;
      if (typeof data?.error === 'string' && data.error) return data.error;
      const context = error?.context;
      if (typeof context?.error === 'string' && context.error) return context.error;
      if (context && typeof context.json === 'function') {
        try {
          const response = typeof context.clone === 'function' ? context.clone() : context;
          const payload = await response.json();
          if (typeof payload?.traceId === 'string') lastTraceId = payload.traceId;
          if (typeof payload?.error === 'string' && payload.error) return payload.error;
        } catch {}
      }
      const message = String(error?.message || '');
      return Object.keys(MESSAGES).find((known) => message.includes(known)) || '';
    }

    const wait = (milliseconds) => new Promise((resolve) => global.setTimeout(resolve, milliseconds));

    async function invoke(body, { verifySession = false, retry = true } = {}) {
      if (verifySession) await assertLiveIdentity();
      else identity();

      for (let attempt = 0; attempt < 2; attempt += 1) {
        let data;
        let error;
        try {
          ({ data, error } = await client.functions.invoke('raid-room-v1', { body }));
        } catch (networkError) {
          error = networkError;
        }
        const code = await readErrorCode(error, data);
        if (!error && !data?.error) return data?.data ?? data;
        const retryable = !code || ['SERVER_ERROR', 'TEMPORARY_UNAVAILABLE'].includes(code);
        if (retry && retryable && attempt === 0) {
          await wait(350);
          continue;
        }
        /* 어느 단계에서 막혔는지 함께 보여 준다.
           "던전 요청이 올바르지 않습니다"만 뜨면 방 만들기인지 문제 발급인지
           알 수가 없어 원인을 찾지 못한다. */
        const step = STEP_NAMES[String(body?.op || '')] || String(body?.op || '');
        const base = MESSAGES[code] || MESSAGES.SERVER_ERROR;
        /* 원인을 알 수 없는 오류에는 추적 번호를 붙인다.
           이 번호를 알려 주면 서버 기록에서 그 요청을 바로 찾을 수 있다. */
        const trace = code === 'SERVER_ERROR' && lastTraceId ? ` [${lastTraceId.slice(0, 8)}]` : '';
        const failure = new Error(`${step ? `${base} (${step})` : base}${trace}`);
        failure.code = code || 'SERVER_ERROR';
        failure.op = String(body?.op || '');
        throw failure;
      }
      return null;
    }

    /* 이미 참여 중인 방이 있으면 서버가 ALREADY_IN_ROOM으로 막는다.
       그럴 때 무조건 옛 방으로 돌아가면 "방을 만든 적도 없는데 남들과
       같이 들어가 있는" 상황이 된다. 그래서 옛 방의 상태를 보고 나눈다.

         아직 출발 전(로비) : 버려진 방이므로 정리하고 새로 만든다.
         진행 중            : 끊겼다 돌아온 것이므로 그 방으로 복구한다.
                              (돌아왔다는 사실을 resumed로 알려 준다.) */
    async function enterOrResume(body) {
      try {
        return await invoke(body, { verifySession:true });
      } catch (error) {
        if (error?.code !== 'ALREADY_IN_ROOM') throw error;
        const existing = await invoke({ op:'resume' }, { verifySession:true });
        /* '방 만들기'는 새로 시작하겠다는 뜻이다. 예전 방이 어떤 상태든
           정리하고 새 방을 만든다. 그러지 않으면 방을 만든 적도 없는데
           예전에 하던 전투가 그대로 이어져 버린다(실제 사고).
           끊겼다 돌아오는 복구는 게임을 켤 때 자동으로 따로 처리한다. */
        if (body?.op === 'create' && existing?.room?.id) {
          try {
            await invoke({ op:'leave', roomId:existing.room.id, requestId:requestId('leave') });
            return await invoke({ ...body, requestId:requestId('create') }, { verifySession:true });
          } catch (retryError) {
            /* 정리에 실패했으면 새로 만들지 못한다. 오류로 끝내지 말고
               들어가 있던 방으로 돌려보내 준다(그래야 갇히지 않는다). */
            if (retryError?.code !== 'ALREADY_IN_ROOM') throw retryError;
          }
        }
        return existing ? { ...existing, resumed:true } : existing;
      }
    }

    function remove(channel) {
      if (!channels.has(channel)) return;
      channels.get(channel)();
      channels.delete(channel);
      client.removeChannel?.(channel);
    }

    function memberSignature(row) {
      /* UPDATE의 old는 기본 replica identity에서 기본키뿐일 수 있다.
         전체 NEW 행끼리 비교하며, 필드가 부족한 알림은 항상 다시 조회한다. */
      const required = ['room_id', 'user_id', 'active', 'ready', 'slot', 'profile_snapshot', 'combat_state'];
      if (!row || required.some((key) => !Object.prototype.hasOwnProperty.call(row, key))) return null;
      const canonical = (value) => {
        if (Array.isArray(value)) return value.map(canonical);
        if (!value || typeof value !== 'object') return value;
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
      };
      const { last_seen_at, ...meaningful } = row;
      return JSON.stringify(canonical(meaningful));
    }

    function subscribe(roomId, listener, onReady) {
      identity();
      const safeRoomId = String(roomId || '');
      if (!safeRoomId || typeof listener !== 'function' || typeof client.channel !== 'function') {
        return () => {};
      }
      const seenSequences = new Set();
      const memberSignatures = new Map();
      let active = true;
      const channel = client.channel(`raid-room-${safeRoomId}`)
        .on('postgres_changes', {
          event:'UPDATE', schema:'public', table:'raid_rooms_v1', filter:`id=eq.${safeRoomId}`,
        }, (payload) => {
          if (active) listener({ type:'room', room:payload?.new || null });
        })
        .on('postgres_changes', {
          event:'*', schema:'public', table:'raid_room_members_v1', filter:`room_id=eq.${safeRoomId}`,
        }, (payload) => {
          if (!active) return;
          const row = payload?.new || payload?.old || null;
          const id = String(row?.user_id || '');
          const signature = memberSignature(payload?.new);
          if (payload?.eventType === 'UPDATE' && signature !== null
            && memberSignatures.get(id) === signature) return;
          if (signature !== null && payload?.eventType !== 'DELETE') {
            if (memberSignatures.size >= 32 && !memberSignatures.has(id)) memberSignatures.clear();
            memberSignatures.set(id, signature);
          } else memberSignatures.delete(id);
          listener({ type:'member', eventType:payload?.eventType || '', member:row });
        })
        .on('postgres_changes', {
          event:'INSERT', schema:'public', table:'raid_events_v1', filter:`room_id=eq.${safeRoomId}`,
        }, (payload) => {
          if (!active) return;
          const row = payload?.new;
          const sequenceNo = Number(row?.sequence_no);
          if (!Number.isSafeInteger(sequenceNo) || seenSequences.has(sequenceNo)) return;
          seenSequences.add(sequenceNo);
          listener({
            type:'event',
            sequenceNo,
            round:Number(row.round_no) || 0,
            event:row.event || {},
          });
        })
        .subscribe((status) => {
          if (active && status === 'SUBSCRIBED') {
            /* 재접속 중 놓친 상태는 전체 sync로 복구하고 NEW 기준도 새로 쌓는다. */
            memberSignatures.clear();
            onReady?.();
          }
        });
      channels.set(channel, () => { active = false; });
      return () => remove(channel);
    }

    function close() {
      [...channels.keys()].forEach(remove);
    }

    return Object.freeze({
      create:({ floorGroup = 1 } = {}) => enterOrResume({
        op:'create', floorGroup, requestId:requestId('create'),
      }),
      join:({ code } = {}) => enterOrResume({
        op:'join', code:String(code ?? ''), requestId:requestId('join'),
      }),
      resume:() => invoke({ op:'resume' }, { verifySession:true }),
      /* 주기 요청의 재시도는 UI의 단일 전송 큐가 간격을 늘려 처리한다.
         답 제출 뒤 직접 조회하는 기존 경로는 한 번의 즉시 재시도를 유지한다. */
      sync:(roomId, afterSequence = 0, { retry = true } = {}) => invoke(
        { op:'sync', roomId, afterSequence }, { retry },
      ),
      setFormation:(roomId, assignments) => invoke({
        op:'setFormation', roomId, assignments, requestId:requestId('formation'),
      }, { verifySession:true }),
      ready:(roomId, ready = true) => invoke({ op:'ready', roomId, ready:ready === true }),
      start:(roomId) => invoke({
        op:'start', roomId, requestId:requestId('start'),
      }, { verifySession:true }),
      beginRound:(roomId, questionPublic, answerKey) => invoke({
        op:'beginRound', roomId, questionPublic, answerKey,
        requestId:requestId('round'),
      }, { verifySession:true }),
      submit:(roomId, round, actionId, answer) => invoke({
        op:'submit', roomId, round, actionId, answer,
        requestId:requestId('submit'),
      }),
      publishRound:(roomId, round, result, stableRequestId = '') => invoke({
        op:'publishRound', roomId, round, result,
        requestId:String(stableRequestId || requestId('publish')).slice(0, 100),
      }, { verifySession:true }),
      ackPlayback:(roomId, round, afterSequence = 0) => invoke({
        op:'ackPlayback', roomId, round, afterSequence,
      }),
      ackQuestionReady:(roomId, round, afterSequence = 0) => invoke({
        op:'ackQuestionReady', roomId, round, afterSequence,
      }),
      heartbeat:(roomId, afterSequence = 0) => invoke({ op:'heartbeat', roomId, afterSequence }, { retry:false }),
      leave:(roomId) => invoke({
        op:'leave', roomId, requestId:requestId('leave'),
      }, { verifySession:true }),
      subscribe,
      close,
    });
  }

  global.YuksamRaidPartyClient = Object.freeze({ create, messages:MESSAGES });
})(typeof window !== 'undefined' ? window : globalThis);
