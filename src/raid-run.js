/* =========================================================
   raid-run.js — 63빌딩 던전 한 판의 진행 (상태 기계)

   흐름: 대형 배치 → 이동 → 전투1 → 이동 → 전투2 → 이동 → 전투3
         → 이동 → 레이드 보스 → 보상(또는 전멸)

   이 파일도 화면을 직접 그리지 않는다. "지금 어떤 장면이고, 무엇이
   일어났는가"만 들고 있고, 화면은 raid-run-ui.js가 이 상태를 보고 그린다.
   그래서 나중에 서버가 이 진행을 대신 굴려도 화면 코드를 고칠 필요가 없다.

   무작위는 전부 밖에서 rng를 받는다(서버 재현성).
   ========================================================= */
(function initYuksamRaidRun(global) {
  'use strict';

  const rules = () => global.YuksamRaidRules;
  const combatRules = () => global.YuksamRaidCombatRules;

  function copyNumberMap(source) {
    const result = {};
    if (!source || typeof source !== 'object' || Array.isArray(source)) return result;
    Object.entries(source).forEach(([key, value]) => {
      const safe = Math.max(0, Math.trunc(Number(value) || 0));
      if (safe > 0) result[String(key)] = safe;
    });
    return result;
  }

  function cloneMemberState(member) {
    const engine = combatRules();
    const normalized = engine?.normalizeMember ? engine.normalizeMember(member) : {
        ...member,
        skills:copyNumberMap(member?.skills),
        cooldowns:copyNumberMap(member?.cooldowns || member?.skillCooldowns),
        shield:Math.max(0, Math.trunc(Number(member?.shield) || 0)),
        statuses:{ ...(member?.statuses || member?.ailments || {}) },
        buffs:{ ...(member?.buffs || member?.combatBuffs || {}) },
        chargeActive:member?.chargeActive === true,
        bastionUsed:member?.bastionUsed === true,
      };
    return {
      ...normalized,
      appearance:normalized.appearance ? { ...normalized.appearance } : normalized.appearance,
      equipment:normalized.equipment ? { ...normalized.equipment } : normalized.equipment,
      costume:normalized.costume ? { ...normalized.costume } : normalized.costume,
    };
  }

  function snapshotMember(member) {
    return {
      ...member,
      appearance:member.appearance ? { ...member.appearance } : member.appearance,
      equipment:member.equipment ? { ...member.equipment } : member.equipment,
      costume:member.costume ? { ...member.costume } : member.costume,
      skills:{ ...(member.skills || {}) },
      cooldowns:{ ...(member.cooldowns || {}) },
      statuses:{ ...(member.statuses || {}) },
      buffs:{ ...(member.buffs || {}) },
    };
  }

  function snapshotMonster(monster) {
    if (!monster) return null;
    return {
      ...monster,
      shadowBySource:{ ...(monster.shadowBySource || {}) },
      pattern:Array.isArray(monster.pattern) ? [...monster.pattern] : monster.pattern,
    };
  }

  /* 장면(phase)
     - formation : 대형을 정하는 중
     - travel    : 다음 몬스터에게 걸어가는 중
     - battle    : 전투 중
     - cleared   : 층을 깼다
     - wiped     : 전멸했다 */
  const PHASES = Object.freeze(['formation', 'travel', 'battle', 'cleared', 'wiped']);

  function createRun({ floor = 1, members = [], rng = Math.random } = {}) {
    const R = rules();
    if (!R) throw new Error('YuksamRaidRules must be loaded before raid-run.js');

    const floorDef = R.getFloor(floor);
    if (!floorDef) throw new Error(`아직 열리지 않은 층입니다: ${floor}`);

    const encounters = R.floorEncounters(floor);
    const roster = members.map((member) => cloneMemberState({
      id:String(member.id),
      name:String(member.name || '동료'),
      klass:member.klass || 'warrior',
      spec:member.spec || '',
      slot:member.slot || 'middle',
      level:Math.max(1, Math.floor(Number(member.level) || 1)),
      maxHp:Math.max(1, Math.floor(Number(member.maxHp) || 1)),
      /* 진행 중 전투를 다시 연결할 때 HP 0을 1로 바꾸면 같은 몬스터에게
         즉시 부활해 버린다. 부활은 다음 조우의 arriveAtEncounter에서만 한다. */
      hp:Math.max(0, Math.floor(Number(member.hp ?? member.maxHp ?? 1) || 0)),
      /* 일반 사냥터와 같은 주 능력치 원값으로 공격력을 굴린다. */
      attack:Math.max(1, Math.floor(Number(member.primaryStat) || Number(member.attack) || 1)),
      defense:Math.max(0, Math.floor(Number(member.defense) || 0)),
      isPlayer:member.isPlayer === true,
      /* 겉모습은 계산에 쓰이지 않지만 화면이 실제 아바타를 그리려면 반드시 함께 넘겨야 한다.
         예전에 여기서 빠뜨려 셋이 모두 같은 기본 차림으로 보였다. */
      appearance:member.appearance || null,
      equipment:member.equipment || null,
      costume:member.costume || null,
      activePet:member.activePet || '',
      weaponTier:Math.max(0, Math.min(4, Math.trunc(Number(member.weaponTier) || 0))),
      skills:member.skills,
      cooldowns:member.cooldowns || member.skillCooldowns,
      shield:member.shield,
      statuses:member.statuses || member.ailments,
      buffs:member.buffs || member.combatBuffs,
      chargeActive:member.chargeActive,
      bastionUsed:member.bastionUsed,
    }));

    const state = {
      floor,
      title:floorDef.title,
      phase:'formation',
      members:roster,
      encounterIndex:0,
      monster:null,
      round:0,
      log:[],
      reward:floorDef.reward,
      finishedAt:null,
    };

    /* ---------- 안쪽 도우미 ---------- */

    function push(kind, text, extra = {}) {
      state.log.push({ kind, text, ...extra });
      return state.log[state.log.length - 1];
    }

    function currentEncounter() {
      return encounters[state.encounterIndex] || null;
    }

    function spawnMonster() {
      const def = currentEncounter();
      if (!def) return null;
      const monsterState = {
        id:def.id,
        name:def.name,
        level:def.level,
        maxHp:def.hp,
        hp:def.hp,
        attack:def.attack,
        pattern:def.pattern,
        isBoss:def.isBoss === true,
        desc:def.desc,
      };
      const engine = combatRules();
      state.monster = engine?.normalizeMonster ? engine.normalizeMonster(monsterState) : monsterState;
      if (engine?.resetMonsterForEncounter) engine.resetMonsterForEncounter(state.monster);
      if (engine?.resetMemberForEncounter) state.members.forEach((member) => engine.resetMemberForEncounter(member));
      state.round = 0;
      return state.monster;
    }

    function livingMembers() {
      return state.members.filter((m) => m.hp > 0);
    }

    function reviveForNextEncounter() {
      const recovered = [];
      R.travelRecovery(state.members).forEach((entry) => {
        const member = state.members.find((m) => m.id === entry.memberId);
        if (!member) return;
        member.hp = entry.revived
          ? Math.min(member.maxHp, Math.max(1, Number(entry.amount) || 1))
          : Math.min(member.maxHp, member.hp + entry.amount);
        recovered.push({
          memberId:member.id,
          amount:entry.amount,
          memberHp:member.hp,
          revived:entry.revived === true,
        });
      });
      if (recovered.length) {
        push('travel-recovery', '쓰러졌던 파티원이 HP 1로 다시 일어났습니다.', { recovered });
      }
      return recovered;
    }

    /* ---------- 밖에서 부르는 것 ---------- */

    /* 대형을 확정하고 첫 이동을 시작한다. */
    function confirmFormation(assignments = {}) {
      if (state.phase !== 'formation') return { ok:false, reason:'이미 출발했습니다.' };
      state.members.forEach((member) => {
        if (assignments[member.id]) member.slot = assignments[member.id];
      });
      const check = R.validateFormation(state.members);
      if (!check.ok) return check;
      state.phase = 'travel';
      push('travel', `${state.title} — 안으로 들어갑니다.`);
      return { ok:true };
    }

    /* 이동 연출이 끝나면 부른다. 다음 몬스터가 나타난다. */
    function arriveAtEncounter() {
      if (state.phase !== 'travel') return { ok:false, reason:'지금은 이동 중이 아닙니다.' };

      /* 직전 몬스터에게 쓰러진 사람만 다음 전투 시작 직전에 HP 1로 돌아온다.
         살아 있던 사람은 이동 중에도 현재 HP를 그대로 유지한다. */
      reviveForNextEncounter();

      const monster = spawnMonster();
      if (!monster) {
        state.phase = 'cleared';
        state.finishedAt = Date.now();
        return { ok:true, cleared:true };
      }
      state.phase = 'battle';
      push('encounter', monster.isBoss
        ? `레이드 보스 ${monster.name}이(가) 나타났다!`
        : `${monster.name}이(가) 나타났다!`, { monsterId:monster.id, boss:monster.isBoss });
      return { ok:true, monster };
    }

    /* 한 라운드를 처리한다.
       answers: { 멤버id: true/false } — 셋이 같은 문제를 푼 결과 */
    function resolveRound(answers = {}) {
      if (state.phase !== 'battle' || !state.monster) {
        return { ok:false, reason:'지금은 전투 중이 아닙니다.' };
      }

      const events = [];

      /* 예전 혼자 연습 모드는 { id:true/false }를 보냈다. 실제 3인 방은
         { id:{ correct, actionId } }를 보내며, 이때부터 각 학생의 스킬과
         상태를 서로 섞이지 않게 독립적으로 계산한다. */
      const structured = Object.values(answers || {}).some((entry) => (
        entry && typeof entry === 'object' && !Array.isArray(entry)
      ));
      if (structured) {
        const attackPlan = typeof R.attackPlanForRound === 'function'
          ? R.attackPlanForRound(state.monster, state.round)
          : { kind:R.attackKindForRound(state.monster, state.round), hits:1 };
        const kind = attackPlan.kind;
        const resolved = R.resolvePartyCombatRound({
          members:state.members,
          monster:state.monster,
          submissions:answers,
          attackKind:kind,
          monsterHitCount:attackPlan.hits,
          monsterAttack:state.monster.attack,
          rng,
        });
        if (!resolved.ok) return resolved;
        events.push(...(resolved.events || []));

        if (resolved.monsterDown || R.isMonsterDown(state.monster)) {
          if (!events.some((event) => event.kind === 'monster-down')) {
            events.push({ kind:'monster-down', text:`${state.monster.name}을(를) 쓰러뜨렸습니다!` });
          }
          state.log.push(...events);
          state.encounterIndex += 1;
          const more = state.encounterIndex < encounters.length;
          state.monster.dying = true;
          state.phase = more ? 'travel' : 'cleared';
          /* 다음 전투용 HP 1 부활을 서버에 HP 0이 저장되기 전에 반영한다. */
          if (more) reviveForNextEncounter();
          if (!more) state.finishedAt = Date.now();
          return { ok:true, events, monsterDown:true, cleared:!more };
        }

        state.round += 1;
        const wiped = resolved.partyWiped || R.isPartyWiped(state.members);
        if (wiped) {
          state.phase = 'wiped';
          state.finishedAt = Date.now();
          if (!events.some((event) => event.kind === 'wiped')) {
            events.push({ kind:'wiped', text:'파티가 전멸했습니다...' });
          }
        }
        state.log.push(...events);
        return wiped ? { ok:true, events, wiped:true } : { ok:true, events, attackKind:kind, monsterHitCount:attackPlan.hits };
      }

      // 1) 파티가 때린다. 각자 빗나감·치명타가 따로 판정된다.
      const attack = R.resolvePartyAttack({ members:state.members, answers, rng });
      attack.hits.forEach((hit) => {
        const member = state.members.find((m) => m.id === hit.memberId);
        const who = member?.name || '동료';
        state.monster.hp = Math.max(0, state.monster.hp - hit.damage);
        events.push({
          kind:'party-hit',
          memberId:hit.memberId,
          memberName:who,
          correct:hit.correct,
          critical:hit.critical === true,
          missed:hit.missed === true,
          damage:hit.damage,
          monsterHp:state.monster.hp,
          audioId:hit.missed ? 'miss' : (hit.critical ? 'critical' : null),
          text:hit.missed
            ? `${who}의 공격이 빗나갔다!`
            : `${hit.critical ? '💥 치명타! ' : ''}${who}${hit.correct ? '' : '(오답)'}이(가) ${hit.damage}의 피해를 주었다!`,
        });
      });

      // 1-2) 힐러(신성)가 문제를 맞혔으면 가장 다친 동료를 회복시킨다.
      R.resolvePartyHeal({ members:state.members, answers }).heals.forEach((heal) => {
        const target = state.members.find((m) => m.id === heal.memberId);
        const healer = state.members.find((m) => m.id === heal.healerId);
        if (!target) return;
        target.hp = Math.min(target.maxHp, target.hp + heal.amount);
        events.push({
          kind:'party-heal',
          healerId:heal.healerId,
          memberId:heal.memberId,
          amount:heal.amount,
          memberHp:target.hp,
          text:`${healer?.name || '힐러'}이(가) ${target.name}의 체력을 ${heal.amount} 회복시켰다!`,
        });
      });

      // 2) 몬스터가 쓰러졌으면 반격 없이 끝난다.
      if (R.isMonsterDown(state.monster)) {
        events.push({ kind:'monster-down', text:`${state.monster.name}을(를) 쓰러뜨렸다!` });
        state.log.push(...events);
        state.encounterIndex += 1;
        const more = state.encounterIndex < encounters.length;
        /* 몬스터를 바로 지우면 화면이 사망 연출과 마지막 로그를 그릴 수 없다.
           쓰러진 표시만 해 두고, 다음 몬스터가 나올 때 교체한다. */
        state.monster.dying = true;
        state.phase = more ? 'travel' : 'cleared';
        if (!more) state.finishedAt = Date.now();
        return { ok:true, events, monsterDown:true, cleared:!more };
      }

      // 3) 몬스터가 반격한다. 대형에 따라 맞는 정도가 갈린다.
      const kind = R.attackKindForRound(state.monster, state.round);
      const counter = R.resolveMonsterAttack({
        members:state.members,
        attack:state.monster.attack,
        kind,
        rng,
      });
      events.push({
        kind:'monster-windup',
        all:kind === 'all',
        audioId:'enemyAttack',
        text:kind === 'all'
          ? `${state.monster.name}이(가) 전체 공격을 준비한다!`
          : `${state.monster.name}의 공격!`,
      });
      counter.hits.forEach((hit) => {
        const member = state.members.find((m) => m.id === hit.memberId);
        if (!member) return;
        member.hp = Math.max(0, member.hp - hit.damage);
        events.push({
          kind:'monster-hit',
          memberId:hit.memberId,
          memberName:member.name,
          slot:hit.slot,
          multiplier:hit.multiplier,
          critical:hit.critical === true,
          missed:hit.missed === true,
          damage:hit.damage,
          memberHp:member.hp,
          audioId:hit.missed ? 'miss' : (hit.critical ? 'critical' : null),
          text:hit.missed
            ? `${member.name}이(가) 공격을 피했다!`
            : `${hit.critical ? '💥 치명타! ' : ''}${member.name}이(가) ${hit.damage}의 피해를 받았다! (${R.slotLabel(hit.slot)})`,
        });
        if (member.hp <= 0) {
          events.push({ kind:'member-down', memberId:member.id, text:`${member.name}이(가) 쓰러졌다!` });
        }
      });

      state.round += 1;

      // 4) 전멸 확인 — 로그에 남기기 전에 판정해서 전멸도 기록에 남게 한다.
      const wiped = R.isPartyWiped(state.members);
      if (wiped) {
        state.phase = 'wiped';
        state.finishedAt = Date.now();
        events.push({ kind:'wiped', text:'파티가 전멸했습니다...' });
      }

      state.log.push(...events);
      return wiped ? { ok:true, events, wiped:true } : { ok:true, events, attackKind:kind };
    }

    /* 동료(혼자 도는 버전)의 정답 여부를 굴린다. */
    function rollAllyAnswers() {
      const answers = {};
      state.members.filter((m) => !m.isPlayer && m.hp > 0).forEach((member) => {
        answers[member.id] = R.allyAnswersCorrectly(rng);
      });
      return answers;
    }

    function snapshot() {
      return {
        floor:state.floor,
        title:state.title,
        phase:state.phase,
        round:state.round,
        encounterIndex:state.encounterIndex,
        encounterTotal:encounters.length,
        members:state.members.map(snapshotMember),
        monster:snapshotMonster(state.monster),
        reward:state.reward ? { ...state.reward } : state.reward,
        aliveCount:livingMembers().length,
        finishedAt:state.finishedAt,
      };
    }

    /* 방장이 보낸 전투 스냅샷을 참가자의 로컬 진행 엔진에 반영한다.
       네트워크는 일부 필드만 보내기도 하므로 빠진 값은 현재 값을 유지한다.
       특히 isPlayer는 각 브라우저마다 다르고, 외형 자료는 메시지를 가볍게
       만들기 위해 생략될 수 있으므로 함부로 지우지 않는다. */
    function importSnapshot(next = {}) {
      if (!next || typeof next !== 'object' || Array.isArray(next)) {
        return { ok:false, reason:'올바르지 않은 던전 상태입니다.' };
      }
      if (Object.prototype.hasOwnProperty.call(next, 'floor') && Number(next.floor) !== state.floor) {
        return { ok:false, reason:'다른 층의 던전 상태는 불러올 수 없습니다.' };
      }
      if (Object.prototype.hasOwnProperty.call(next, 'phase') && !PHASES.includes(next.phase)) {
        return { ok:false, reason:'알 수 없는 던전 진행 상태입니다.' };
      }
      if (Object.prototype.hasOwnProperty.call(next, 'members') && !Array.isArray(next.members)) {
        return { ok:false, reason:'파티원 상태가 올바르지 않습니다.' };
      }
      if (Object.prototype.hasOwnProperty.call(next, 'monster')
        && next.monster !== null
        && (typeof next.monster !== 'object' || Array.isArray(next.monster))) {
        return { ok:false, reason:'몬스터 상태가 올바르지 않습니다.' };
      }

      let importedMembers = state.members;
      if (Array.isArray(next.members)) {
        const currentById = new Map(state.members.map((member) => [String(member.id), member]));
        const incomingIds = new Set();
        const updates = [];
        for (const incoming of next.members) {
          if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
            return { ok:false, reason:'파티원 상태가 올바르지 않습니다.' };
          }
          const id = String(incoming.id || '');
          if (!id || incomingIds.has(id)) {
            return { ok:false, reason:'파티원 식별 정보가 올바르지 않습니다.' };
          }
          incomingIds.add(id);
          const current = currentById.get(id);
          const merged = { ...(current || {}), ...incoming, id };
          for (const key of ['appearance', 'equipment', 'costume', 'activePet']) {
            if (!Object.prototype.hasOwnProperty.call(incoming, key) && current) merged[key] = current[key];
          }
          if (current) merged.isPlayer = current.isPlayer === true;
          updates.push(cloneMemberState(merged));
        }

        /* 일반 스냅샷은 세 명 전부를 보내므로 방장의 순서를 따른다.
           일부만 온 갱신은 기존 파티원을 남겨 둔 채 해당 학생만 교체한다. */
        if (updates.length === R.PARTY_SIZE || next.replaceMembers === true) {
          importedMembers = updates.slice(0, R.PARTY_SIZE);
        } else {
          const updateById = new Map(updates.map((member) => [member.id, member]));
          importedMembers = state.members.map((member) => updateById.get(member.id) || member);
          updates.forEach((member) => {
            if (!currentById.has(member.id) && importedMembers.length < R.PARTY_SIZE) importedMembers.push(member);
          });
        }
      }

      let importedMonster = state.monster;
      if (Object.prototype.hasOwnProperty.call(next, 'monster')) {
        if (next.monster === null) {
          importedMonster = null;
        } else {
          const merged = { ...(state.monster || {}), ...next.monster };
          if (!Object.prototype.hasOwnProperty.call(next.monster, 'shadowBySource') && state.monster) {
            merged.shadowBySource = state.monster.shadowBySource;
          }
          const engine = combatRules();
          importedMonster = engine?.normalizeMonster
            ? engine.normalizeMonster(merged)
            : snapshotMonster(merged);
        }
      }

      const importedRound = Object.prototype.hasOwnProperty.call(next, 'round')
        ? Math.max(0, Math.floor(Number(next.round) || 0))
        : state.round;
      const importedEncounterIndex = Object.prototype.hasOwnProperty.call(next, 'encounterIndex')
        ? Math.max(0, Math.min(encounters.length, Math.floor(Number(next.encounterIndex) || 0)))
        : state.encounterIndex;

      state.members = importedMembers;
      state.monster = importedMonster;
      state.round = importedRound;
      state.encounterIndex = importedEncounterIndex;
      if (Object.prototype.hasOwnProperty.call(next, 'phase')) state.phase = next.phase;
      if (typeof next.title === 'string' && next.title) state.title = next.title;
      if (next.reward && typeof next.reward === 'object' && !Array.isArray(next.reward)) {
        state.reward = { ...next.reward };
      }
      if (Object.prototype.hasOwnProperty.call(next, 'finishedAt')) {
        state.finishedAt = next.finishedAt == null ? null : Number(next.finishedAt) || null;
      }
      return { ok:true, snapshot:snapshot() };
    }

    return Object.freeze({
      PHASES,
      confirmFormation,
      arriveAtEncounter,
      resolveRound,
      rollAllyAnswers,
      snapshot,
      importSnapshot,
      get phase() { return state.phase; },
      get log() { return state.log.slice(); },
      get members() { return state.members; },
      get monster() { return state.monster; },
      get encounterTotal() { return encounters.length; },
    });
  }

  global.YuksamRaidRun = Object.freeze({ PHASES, createRun });
})(typeof window !== 'undefined' ? window : globalThis);
