/* 가짜 던전 방 서버.
   진짜 Supabase 대신 메모리 안에서 방 하나를 굴린다. 실제 Edge Function과
   같은 모양의 응답을 돌려주므로, 화면 코드는 진짜 3인 방에 들어간 것과
   똑같이 동작한다.

   나(테스트를 도는 학생) + 친구 둘, 모두 세 명이 들어와 있다.
   친구 둘의 답은 자동으로 채워 준다(항상 정답). */
module.exports = function createFakeRaidRoom({
  meId = 'me-1',
  meName = '나',
  floorGroup = 1,
  profileOf = () => ({}),
} = {}) {
  const OTHERS = [
    { userId:'friend-a', name:'친구가온', klass:'warrior', spec:'방어' },
    { userId:'friend-b', name:'친구나온', klass:'priest', spec:'신성' },
  ];

  const room = {
    id:'fake-room-1', code:'1234', hostId:meId, floorGroup,
    phase:'lobby', encounterIndex:0, currentFloor:1, round:0,
    monsterState:{}, question:null, questionDeadline:0, version:1,
  };
  let sequence = 0;
  const events = [];           // { sequenceNo, round, event }
  const listeners = new Set();
  let answerKeys = {};

  const members = [
    { roomId:room.id, userId:meId, joinOrder:1, slot:null, ready:false, active:true, playbackRound:0,
      profile:{ userId:meId, name:meName, ...profileOf() },
      state:{ hp:1, maxHp:1, shield:0, cooldowns:{}, statuses:{} } },
    ...OTHERS.map((other, index) => ({
      roomId:room.id, userId:other.userId, joinOrder:index + 2, slot:null, ready:false, active:true,
      playbackRound:0,
      profile:{
        userId:other.userId, name:other.name, className:other.klass, spec:other.spec,
        /* 검사에서는 몬스터를 빨리 잡아 다음 조우까지 흐름을 보는 게 목적이라
           친구 둘의 능력치를 넉넉히 준다(밸런스 검사가 아니다). */
        level:9, maxHp:120, hp:120, primaryStat:70, attack:35, defense:4,
        skills:{}, appearance:{}, equipment:{}, costume:{}, activePet:'', weaponTier:0,
        raidTopGroup:6,
      },
      state:{ hp:60, maxHp:60, shield:0, cooldowns:{}, statuses:{} },
    })),
  ];

  const clone = (value) => JSON.parse(JSON.stringify(value));

  function snapshot(afterSequence = 0) {
    const fresh = events.filter((row) => row.sequenceNo > (Number(afterSequence) || 0));
    const data = {
      room:clone({ ...room, question:room.question?.byUser?.[meId] || room.question }),
      members:clone(members),
      events:clone(fresh),
    };
    if (room.phase === 'resolving') {
      /* 방장에게만 셋의 제출을 넘겨 준다(진짜 서버와 같다). */
      data.submissions = members.map((member) => ({
        userId:member.userId,
        actionId:member.lastActionId || 'basic',
        correct:member.lastCorrect === true,
        timedOut:false,
      }));
      data.answerKeys = clone(answerKeys);
    }
    return data;
  }

  function notify() {
    [...listeners].forEach((listener) => {
      try { listener({ type:'room', room:clone(room) }); } catch (_) {}
    });
  }

  const client = {
    async create() { return snapshot(0); },
    async join() { return snapshot(0); },
    async resume() { return snapshot(0); },
    async sync(roomId, afterSequence) { return snapshot(afterSequence); },

    async setFormation(roomId, assignments) {
      Object.entries(assignments || {}).forEach(([userId, slot]) => {
        const member = members.find((entry) => entry.userId === userId);
        if (member) member.slot = slot;
      });
      room.version += 1;
      return snapshot(0);
    },

    async ready(roomId, ready) {
      const me = members.find((entry) => entry.userId === meId);
      if (me) me.ready = ready === true;
      // 친구 둘은 곧바로 준비를 맞춰 준다.
      members.forEach((member) => { if (member.userId !== meId) member.ready = true; });
      return snapshot(0);
    },

    async start() {
      room.phase = 'travel';
      room.round = 0;
      room.encounterIndex = 0;
      room.version += 1;
      notify();
      return snapshot(0);
    },

    async beginRound(roomId, questionPublic, answerKey) {
      room.round += 1;
      room.phase = 'question';
      room.question = questionPublic;
      room.questionDeadline = Date.now() + 30000;
      answerKeys = JSON.parse(answerKey);
      room.version += 1;
      members.forEach((member) => { member.lastCorrect = undefined; member.lastActionId = undefined; });
      notify();
      return snapshot(0);
    },

    async submit(roomId, round, actionId, answer) {
      const me = members.find((entry) => entry.userId === meId);
      if (me) {
        me.lastActionId = actionId;
        me.lastCorrect = String(answer) === String(answerKeys[meId] ?? '');
      }
      // 친구 둘은 항상 정답을 맞힌다.
      members.forEach((member) => {
        if (member.userId === meId) return;
        member.lastActionId = 'basic';
        member.lastCorrect = true;
      });
      room.phase = 'resolving';
      room.version += 1;
      notify();
      return { ok:true, round };
    },

    async publishRound(roomId, round, result) {
      room.phase = result.nextPhase;
      room.encounterIndex = Number(result.encounterIndex) || 0;
      room.currentFloor = Number(result.currentFloor) || room.currentFloor;
      room.monsterState = result.monsterState || {};
      room.question = null;
      room.version += 1;
      /* 화면 하나짜리 스모크 검사에서는 가짜 친구 둘이 연출도 곧바로
         다 봤다고 처리한다. 실제 학생 화면은 ackPlayback을 직접 보낸다. */
      members.forEach((member) => {
        if (member.userId !== meId) member.playbackRound = Math.max(member.playbackRound || 0, round);
      });
      (result.events || []).forEach((event) => {
        sequence += 1;
        events.push({ sequenceNo:sequence, round, event:clone(event) });
      });
      const rows = events.slice(-((result.events || []).length));
      [...listeners].forEach((listener) => {
        rows.forEach((row) => {
          try { listener({ type:'event', sequenceNo:row.sequenceNo, round:row.round, event:row.event }); }
          catch (_) {}
        });
      });
      notify();
      return snapshot(0);
    },

    async ackPlayback(roomId, round, afterSequence) {
      const me = members.find((entry) => entry.userId === meId);
      if (me) me.playbackRound = Math.max(me.playbackRound || 0, Number(round) || 0);
      notify();
      return snapshot(afterSequence);
    },

    async heartbeat(roomId, afterSequence) { return snapshot(afterSequence); },
    async leave() { room.phase = 'cancelled'; return { left:true }; },

    subscribe(roomId, listener, onReady) {
      listeners.add(listener);
      if (typeof onReady === 'function') onReady();
      return () => listeners.delete(listener);
    },
    close() { listeners.clear(); },
  };

  return { client, room, members, notify, get eventCount() { return events.length; } };
};
