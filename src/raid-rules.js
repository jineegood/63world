/* =========================================================
   raid-rules.js — 63빌딩 던전의 규칙 (순수 계산만)

   화면도 소리도 저장도 건드리지 않는다. 값을 넣으면 값이 나온다.
   그래서 검사하기 쉽고, 나중에 서버(Edge Function)가 이 파일을 그대로
   다시 쓸 수 있다. 서버와 브라우저의 계산이 갈라지면 안 되기 때문이다.

   무작위가 필요한 곳은 전부 rng를 밖에서 받는다.
   서버가 같은 rng로 같은 결과를 다시 만들 수 있어야 하기 때문이다.
   ========================================================= */
(function initYuksamRaidRules(global) {
  'use strict';

  /* ---------- 대형(앞·가운데·뒤) ---------- */

  const SLOTS = Object.freeze(['front', 'middle', 'back']);

  const SLOT_LABEL = Object.freeze({
    front: '앞',
    middle: '가운데',
    back: '뒤',
  });

  /* 앞에 설수록 많이 맞고 뒤에 설수록 덜 맞는다.
     이 숫자가 탱커와 힐러의 역할을 갈라 준다. */
  const DAMAGE_TAKEN = Object.freeze({
    front: 1.5,
    middle: 1.0,
    back: 0.6,
  });

  const PARTY_SIZE = 3;

  function slotLabel(slot) {
    return SLOT_LABEL[slot] || String(slot || '');
  }

  function damageMultiplier(slot) {
    const value = DAMAGE_TAKEN[slot];
    return typeof value === 'number' ? value : 1;
  }

  /* 세 명이 앞·가운데·뒤에 하나씩 서 있어야 올바른 대형이다. */
  function validateFormation(members) {
    if (!Array.isArray(members) || members.length !== PARTY_SIZE) {
      return { ok:false, reason:`파티는 ${PARTY_SIZE}명이어야 합니다.` };
    }
    const used = members.map((m) => m && m.slot);
    for (const slot of used) {
      if (!SLOTS.includes(slot)) return { ok:false, reason:'앞·가운데·뒤 중에서 골라 주세요.' };
    }
    if (new Set(used).size !== PARTY_SIZE) {
      return { ok:false, reason:'같은 자리에 두 명이 설 수 없습니다.' };
    }
    return { ok:true };
  }

  /* ---------- 몬스터가 누구를 때리는가 ---------- */

  /* 몬스터는 앞부터 노린다. 앞이 쓰러졌으면 가운데, 그 다음 뒤.
     그래서 앞에 선 사람이 진짜로 막아 주는 역할이 된다. */
  function pickTarget(members) {
    const alive = (members || [])
      .filter((m) => m && m.hp > 0)
      .sort((a, b) => (ATTACK_ORDER[a?.slot] ?? 1) - (ATTACK_ORDER[b?.slot] ?? 1));
    if (!alive.length) return null;
    for (const slot of SLOTS) {
      const found = alive.find((m) => m.slot === slot);
      if (found) return found;
    }
    return alive[0];
  }

  /* 한 번의 몬스터 공격을 계산한다. 실제 체력을 깎지는 않고 결과만 돌려준다.
     kind: 'single' 이면 한 명, 'all' 이면 전체 공격. */
  function resolveMonsterAttack({ members, attack, kind = 'single', rng }) {
    const base = Math.max(0, Math.floor(Number(attack) || 0));
    const alive = (members || [])
      .filter((m) => m && m.hp > 0)
      .sort((a, b) => (ATTACK_ORDER[a?.slot] ?? 1) - (ATTACK_ORDER[b?.slot] ?? 1));
    if (!alive.length || base <= 0) return { kind, hits:[] };
    const roll = typeof rng === 'function' ? rng : Math.random;

    const targets = kind === 'all' ? alive : [pickTarget(alive)].filter(Boolean);
    // 한 명만 노리는 공격은 전체 공격보다 한 방이 더 아프다.
    const focus = kind === 'all' ? 1 : SINGLE_TARGET_BONUS;
    const hits = targets.map((member) => {
      const multiplier = damageMultiplier(member.slot);
      if (roll() < MISS_CHANCE) {
        return { memberId:member.id, slot:member.slot, multiplier, damage:0, missed:true, critical:false, lethal:false };
      }
      const critical = roll() < CRIT_CHANCE;
      // 배율을 곱해도 최소 1은 들어간다. 뒤에 섰다고 0이 되면 안 된다.
      const raw = Math.max(1, Math.round(base * multiplier * focus * (critical ? CRIT_MULTIPLIER : 1)));
      return {
        memberId: member.id,
        slot: member.slot,
        multiplier,
        critical,
        missed: false,
        damage: Math.min(raw, member.hp),
        lethal: raw >= member.hp,
      };
    });
    return { kind, hits };
  }

  /* ---------- 플레이어 쪽 공격 ---------- */

  /* 일반 전투와 같은 감각을 내기 위한 치명타·빗나감.
     rng는 밖에서 받아 서버가 같은 결과를 재현할 수 있게 한다. */
  /* 한 명만 노리는 공격은 전체 공격보다 한 방이 더 아프다. */
  const SINGLE_TARGET_BONUS = 1.35;

  /* 던전이라고 캐릭터가 더 세지지 않는다.
     일반 몬스터 전투와 완전히 같은 피해가 나와야 한다(제작자 요구). */
  const PARTY_POWER = 1;

  const CRIT_CHANCE = 0.15;
  const CRIT_MULTIPLIER = 1.5;
  const MISS_CHANCE = 0.10;

  /* 셋이 같은 문제를 동시에 푼다. 맞힌 사람만 제 몫의 피해를 넣고,
     틀린 사람은 절반만 들어간다(일반 전투와 같은 규칙).
     여기에 더해 빗나감과 치명타가 각자 따로 판정된다. */
  /* 공격 순서는 항상 앞 → 가운데 → 뒤. */
  const ATTACK_ORDER = Object.freeze({ front:0, middle:1, back:2 });

  function resolvePartyAttack({ members, answers, rng }) {
    const list = (Array.isArray(members) ? [...members] : [])
      .sort((a, b) => (ATTACK_ORDER[a?.slot] ?? 1) - (ATTACK_ORDER[b?.slot] ?? 1));
    const given = answers && typeof answers === 'object' ? answers : {};
    const roll = typeof rng === 'function' ? rng : Math.random;
    const hits = list
      .filter((m) => m && m.hp > 0)
      .map((member) => {
        const correct = given[member.id] === true;
        const power = Math.max(1, Math.floor((Number(member.attack) || 1) * PARTY_POWER));
        const base = correct ? power : Math.max(1, Math.floor(power / 2));

        // 빗나가면 피해가 없다.
        if (roll() < MISS_CHANCE) {
          return { memberId:member.id, correct, damage:0, missed:true, critical:false };
        }
        const critical = roll() < CRIT_CHANCE;
        const damage = critical ? Math.max(1, Math.round(base * CRIT_MULTIPLIER)) : base;
        return { memberId:member.id, correct, damage, missed:false, critical };
      });
    const total = hits.reduce((sum, hit) => sum + hit.damage, 0);
    return { hits, total };
  }

  /* ---------- 회복 (힐러 역할) ---------- */

  /* 신성 전문화는 던전에서 회복을 맡는다.
     앞이 1.5배로 맞는 만큼 누군가 뒤에서 채워 주지 않으면 층을 넘길 수 없다.
     그래서 탱커(앞)와 힐러(뒤)가 함께 있어야 굴러가는 구조가 된다. */
  const HEAL_SPECS = Object.freeze(['신성']);
  const HEAL_RATIO = 6;

  function isHealer(member) {
    return !!member && HEAL_SPECS.includes(member.spec);
  }

  /* 문제를 맞힌 힐러가 가장 많이 다친 동료를 회복시킨다.
     실제 체력을 바꾸지 않고 결과만 돌려준다. */
  function resolvePartyHeal({ members, answers }) {
    const list = Array.isArray(members) ? members : [];
    const given = answers && typeof answers === 'object' ? answers : {};
    const healers = list.filter((m) => m && m.hp > 0 && isHealer(m) && given[m.id] === true);
    if (!healers.length) return { heals:[] };

    // 회복량은 미리 정해 두고, 대상은 그때그때 가장 다친 사람으로 고른다.
    const pending = list.map((m) => ({ ...m }));
    const heals = [];
    healers.forEach((healer) => {
      const wounded = pending
        .filter((m) => m.hp > 0 && m.hp < m.maxHp)
        .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0];
      if (!wounded) return;
      const power = Math.max(1, Math.round((Number(healer.attack) || 1) * HEAL_RATIO));
      const amount = Math.min(power, wounded.maxHp - wounded.hp);
      if (amount <= 0) return;
      wounded.hp += amount;
      heals.push({ healerId:healer.id, memberId:wounded.id, amount });
    });
    return { heals };
  }

  /* 몬스터 하나와 싸우는 동안 쓰러진 파티원은 그 전투에서 빠진다.
     파티가 살아남아 다음 몬스터를 만나면 쓰러졌던 사람만 HP 1로 돌아온다.
     생존자의 HP는 그대로 유지해 전투 사이 무료 회복과 섞이지 않게 한다. */
  const TRAVEL_RECOVERY = 0;
  const NEXT_ENCOUNTER_REVIVE_HP = 1;

  function travelRecovery(members) {
    return (members || [])
      .filter((m) => m && m.hp <= 0)
      .map((member) => ({
        memberId:member.id,
        amount:NEXT_ENCOUNTER_REVIVE_HP,
        revived:true,
      }));
  }

  /* ---------- 층 구성 ---------- */

  /* 63층 컨셉이지만 한 번에 다 만들지 않는다.
     1층부터 열고 10층·20층 식으로 천천히 늘린다. */
  const MONSTERS = Object.freeze({
    /* 수치 기준: Lv.5 셋이 힐러를 데리고 가면 넘길 수 있는 선.
       셋이 동시에 때리므로 피해가 대략 3배다. 그만큼 체력을 두껍게 잡아
       한 마리를 여러 라운드에 걸쳐 잡도록 했다. */
    guardBot: {
      id:'guardBot', name:'경비 로봇', level:5, hp:192, attack:8,
      pattern:['single', 'single', 'all'],
      desc:'1층 로비를 지키는 낡은 경비 로봇. 가끔 사방으로 경보를 터뜨린다.',
    },
    officeGhost: {
      id:'officeGhost', name:'사무실 유령', level:5, hp:224, attack:10,
      pattern:['single', 'all', 'single'],
      desc:'야근하다 사라진 직원의 그림자. 서류를 흩뿌려 모두를 덮친다.',
    },
    blackoutShade: {
      id:'blackoutShade', name:'정전 그림자', level:6, hp:248, attack:8,
      pattern:['all', 'all', 'single'],
      desc:'정전된 층에 고인 어둠. 전체를 한꺼번에 노린다.',
    },
    towerWarden: {
      id:'towerWarden', name:'63빌딩 관리자', level:7, hp:460, attack:12,
      pattern:['single', 'single', 'all', 'single', 'all'],
      boss:true,
      desc:'빌딩의 모든 층을 관리해 온 존재. 1층의 마지막 관문이다.',
    },
  });

  const FLOORS = Object.freeze({
    1: Object.freeze({
      floor:1,
      title:'63빌딩 1층 — 로비',
      recommendedLevel:5,
      stages:Object.freeze(['guardBot', 'officeGhost', 'blackoutShade']),
      boss:'towerWarden',
      reward:Object.freeze({ exp:40, gold:180, building:20 }),
    }),
  });

  function getFloor(floor) {
    return FLOORS[Number(floor)] || null;
  }

  function availableFloors() {
    return Object.keys(FLOORS).map(Number).sort((a, b) => a - b);
  }

  /* 한 층에서 순서대로 만나는 몬스터들. 마지막이 레이드 보스다. */
  function floorEncounters(floor) {
    const def = getFloor(floor);
    if (!def) return [];
    return [...def.stages, def.boss]
      .map((id) => MONSTERS[id])
      .filter(Boolean)
      .map((monster, index, all) => ({
        ...monster,
        index,
        isBoss: index === all.length - 1,
      }));
  }

  /* 몬스터가 이번 라운드에 단일 공격을 하는지 전체 공격을 하는지.
     정해진 순서를 반복하므로 학생이 패턴을 외워 대비할 수 있다. */
  function attackKindForRound(monster, round) {
    const pattern = Array.isArray(monster?.pattern) && monster.pattern.length
      ? monster.pattern
      : ['single'];
    const index = Math.max(0, Math.floor(Number(round) || 0));
    return pattern[index % pattern.length] === 'all' ? 'all' : 'single';
  }

  /* ---------- 혼자 도는 버전의 동료 ---------- */

  /* 3명이 모이기 전에도 던전을 돌아 볼 수 있도록 동료 둘을 붙인다.
     동료는 정해진 확률로 정답을 맞힌다. rng는 밖에서 받는다. */
  const ALLY_CORRECT_RATE = 0.7;

  function allyAnswersCorrectly(rng) {
    const roll = typeof rng === 'function' ? Number(rng()) : Math.random();
    return roll < ALLY_CORRECT_RATE;
  }

  /* ---------- 승패 판정 ---------- */

  function isPartyWiped(members) {
    return (members || []).every((m) => !m || m.hp <= 0);
  }

  function isMonsterDown(monster) {
    return !monster || Number(monster.hp) <= 0;
  }

  /* 스킬이 포함된 실제 3인 전투는 별도의 순수 계산 모듈에 맡긴다.
     raid-rules의 자리 배율과 표적 선택 규칙은 주입해서 한 벌만 유지한다. */
  function resolvePartyCombatRound(options = {}) {
    const engine = global.YuksamRaidCombatRules;
    if (!engine || typeof engine.resolveRound !== 'function') {
      return { ok:false, reason:'던전 전투 규칙을 불러오지 못했습니다.', events:[] };
    }
    const result = engine.resolveRound({
      ...options,
      raidRules:{ damageMultiplier, pickTarget, SINGLE_TARGET_BONUS },
    });
    return { ok:true, ...result };
  }

  global.YuksamRaidRules = Object.freeze({
    SLOTS,
    SLOT_LABEL,
    DAMAGE_TAKEN,
    PARTY_SIZE,
    MONSTERS,
    FLOORS,
    ALLY_CORRECT_RATE,
    PARTY_POWER,
    SINGLE_TARGET_BONUS,
    CRIT_CHANCE,
    CRIT_MULTIPLIER,
    MISS_CHANCE,
    HEAL_SPECS,
    HEAL_RATIO,
    TRAVEL_RECOVERY,
    NEXT_ENCOUNTER_REVIVE_HP,
    slotLabel,
    damageMultiplier,
    validateFormation,
    pickTarget,
    resolveMonsterAttack,
    resolvePartyAttack,
    isHealer,
    resolvePartyHeal,
    travelRecovery,
    getFloor,
    availableFloors,
    floorEncounters,
    attackKindForRound,
    allyAnswersCorrectly,
    isPartyWiped,
    isMonsterDown,
    resolvePartyCombatRound,
  });
})(typeof window !== 'undefined' ? window : globalThis);
