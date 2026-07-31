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
    const roster = members.map((member) => ({
      id:String(member.id),
      name:String(member.name || '동료'),
      klass:member.klass || 'warrior',
      spec:member.spec || '',
      slot:member.slot || 'middle',
      maxHp:Math.max(1, Math.floor(Number(member.maxHp) || 1)),
      hp:Math.max(1, Math.floor(Number(member.hp ?? member.maxHp) || 1)),
      attack:Math.max(1, Math.floor(Number(member.attack) || 1)),
      isPlayer:member.isPlayer === true,
      /* 겉모습은 계산에 쓰이지 않지만 화면이 실제 아바타를 그리려면 반드시 함께 넘겨야 한다.
         예전에 여기서 빠뜨려 셋이 모두 같은 기본 차림으로 보였다. */
      appearance:member.appearance || null,
      equipment:member.equipment || null,
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
      state.monster = {
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
      state.round = 0;
      return state.monster;
    }

    function livingMembers() {
      return state.members.filter((m) => m.hp > 0);
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

      /* 걸어오는 동안 숨을 고른다. 이게 없으면 네 번을 연달아 싸울 수 없다. */
      const recovered = [];
      R.travelRecovery(state.members).forEach((entry) => {
        const member = state.members.find((m) => m.id === entry.memberId);
        if (!member) return;
        member.hp = Math.min(member.maxHp, member.hp + entry.amount);
        recovered.push({ memberId:member.id, amount:entry.amount, memberHp:member.hp });
      });
      if (recovered.length) {
        push('travel-recovery', '이동하며 숨을 고릅니다. 체력을 조금 회복했습니다.', { recovered });
      }

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
        state.monster = null;
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
        members:state.members.map((m) => ({ ...m })),
        monster:state.monster ? { ...state.monster } : null,
        reward:state.reward,
        aliveCount:livingMembers().length,
      };
    }

    return Object.freeze({
      PHASES,
      confirmFormation,
      arriveAtEncounter,
      resolveRound,
      rollAllyAnswers,
      snapshot,
      get phase() { return state.phase; },
      get log() { return state.log.slice(); },
      get members() { return state.members; },
      get monster() { return state.monster; },
      get encounterTotal() { return encounters.length; },
    });
  }

  global.YuksamRaidRun = Object.freeze({ PHASES, createRun });
})(typeof window !== 'undefined' ? window : globalThis);
