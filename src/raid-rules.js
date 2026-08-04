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
    /* 한 명만 노리는 공격은 전체 공격보다 한 방이 더 아프다.
       전체 공격은 셋을 한꺼번에 때리므로 한 사람 몫을 낮춘다(제작자 조정).
       스킬을 쓰는 3인 전투 계산기와 같은 값을 써야 결과가 갈리지 않는다. */
    const focus = kind === 'all' ? PATTERN_EFFECT.ALL_ATTACK_MULTIPLIER : SINGLE_TARGET_BONUS;
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
  const SINGLE_TARGET_BONUS = 1.6;

  /* 예전에는 시트의 낮은 공격력에 여기서 60%를 더했다.
     지금 MONSTERS의 공격력은 최종 시트의 「기본 공격력」이고 그 60% 상향이
     이미 들어 있는 값이다. 여기서 다시 곱하면 피해가 두 배가 되므로 1로 둔다.
     (시트 「계산 설정」과 Codex 인수인계 문서가 같은 내용을 명시한다.) */
  const MONSTER_DAMAGE_MULTIPLIER = 1;

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
  /* 제작자가 만든 기존 몬스터 17마리.
     출처: outputs/raid_roster_revision_20260802/63빌딩_기존몬스터_출현규칙_최종본.xlsx
     - hp / attack 은 시트의 「체력」·「기본 공격력」을 그대로 옮긴 값이다.
     - attack 에는 예전 60% 상향분이 이미 들어 있으므로 여기에 다시 곱하지 않는다.
     - 단일 공격은 계산할 때 SINGLE_TARGET_BONUS(1.6)가 곱해진다(시트의 예상 피해와 일치).

     pattern 한 칸이 그 몬스터의 한 턴이다. 시트의 「패턴 N」을 그대로 옮겼다.
       kind      : 'single' | 'all' | 'none'   (none은 공격하지 않는 턴)
       hits      : 타수 (기본 1)
       target    : 'front' | 'middle' | 'back' | 'random'  (single일 때 노리는 자리)
       poison    : 한 타마다 쌓는 독 중첩
       stun      : 기절
       chill     : 냉기(대상의 다음 턴 공격 피해 50% 감소)
       drain     : 준 피해만큼 몬스터 체력 회복
       shieldPct : 자기 최대 체력 대비 보호막 생성 비율
       healPct   : 자기 최대 체력 대비 회복 비율
       counter   : 이번 턴 피격될 때마다 반격 ('single' | 'all')
       blind     : 파티 전체의 다음 공격 N회를 빗나가게 함
       empower   : 본인 공격력 강화 턴 수
       chargeNext: 다음 턴에 반드시 쓰는 기술과 2배 피해 예약 */
  const MONSTERS = Object.freeze({
    // ── Lv.5 ─────────────────────────────────────────────
    mushroomKing: {
      id:'mushroomKing', name:'버섯돌이킹', level:5, hp:154, attack:13,
      desc:'버섯돌이들의 왕. 포자를 뿌려 독을 남긴다.',
      pattern:[
        { name:'버섯 박치기', kind:'single', target:'back' },
        { name:'포자 뿌리기', kind:'all', poison:4 },
        { name:'균사 재생', kind:'none', healPct:0.30 },
      ],
    },
    paperPigeon: {
      id:'paperPigeon', name:'종이비둘기', level:5, hp:179, attack:16,
      desc:'서류 뭉치가 새처럼 접혀 날아다닌다.',
      pattern:[
        { name:'종이부리 쪼기', kind:'single', target:'front' },
        { name:'종이날개 폭풍', kind:'all', hits:2 },
        { name:'접힌 날개 반격', kind:'none', counter:'single' },
      ],
    },
    // ── Lv.6 ─────────────────────────────────────────────
    buildingStomp: {
      id:'buildingStomp', name:'빌딩 스톰프', level:6, hp:368, attack:19,
      desc:'건물을 통째로 흔드는 거구.',
      pattern:[
        { name:'대지 찍기', kind:'all', stun:true },
        { name:'콘크리트 돌진', kind:'single', hits:2, target:'middle' },
        { name:'빌딩 진동', kind:'all', hits:3 },
      ],
    },
    brokenPhone: {
      id:'brokenPhone', name:'고장 난 전화기', level:6, hp:216, attack:16,
      desc:'끊이지 않는 벨소리로 정신을 흔든다.',
      pattern:[
        { name:'수화기 강타', kind:'single', target:'front' },
        { name:'폭주 벨소리', kind:'all', hits:2 },
        { name:'먹통 신호', kind:'none', blind:1 },
      ],
    },
    // ── Lv.7 ─────────────────────────────────────────────
    pollutedSlime: {
      id:'pollutedSlime', name:'오염된 슬라임', level:7, hp:198, attack:13,
      desc:'빌딩 배수구에서 자란 오염 덩어리.',
      pattern:[
        { name:'산성 몸통박치기', kind:'single', target:'random', poison:4 },
        { name:'오염 파동', kind:'all', poison:3 },
        { name:'점액 방패', kind:'none', shieldPct:0.30 },
        { name:'차가운 오염액', kind:'all', chill:true },
      ],
    },
    rampageCopier: {
      id:'rampageCopier', name:'폭주 복사기', level:7, hp:272, attack:19,
      desc:'멈추지 않고 스스로를 복사한다.',
      pattern:[
        { name:'용지 절단', kind:'single', hits:2, target:'front' },
        { name:'토너 폭발', kind:'all', hits:2 },
        { name:'무한 복사', kind:'all', hits:3 },
      ],
    },
    // ── Lv.8 ─────────────────────────────────────────────
    officeGhost: {
      id:'officeGhost', name:'사무실 유령', level:8, hp:336, attack:22,
      desc:'야근하다 사라진 직원의 그림자.',
      pattern:[
        { name:'야근의 손길', kind:'single', target:'front' },
        { name:'서류 폭풍', kind:'all', hits:2 },
        { name:'퇴근 금지', kind:'all', chill:true },
        { name:'원한 흡수', kind:'single', hits:2, target:'back', drain:true },
      ],
    },
    guardBot: {
      id:'guardBot', name:'경비 로봇', level:8, hp:320, attack:21,
      desc:'로비를 지키는 낡은 경비 로봇.',
      pattern:[
        { name:'진압봉 타격', kind:'single', target:'back' },
        { name:'경고 사격', kind:'all' },
        { name:'과잉 진압', kind:'single', target:'front', stun:true },
        { name:'비상 복구 미사일', kind:'single', hits:2, target:'front', drain:true },
      ],
    },
    // ── Lv.9 ─────────────────────────────────────────────
    blackoutShade: {
      id:'blackoutShade', name:'정전 그림자', level:9, hp:400, attack:26,
      desc:'정전된 층에 고인 어둠.',
      pattern:[
        { name:'암전 습격', kind:'single', target:'back' },
        { name:'어둠의 파동', kind:'all', hits:2 },
        { name:'완전 정전', kind:'none', blind:1 },
        { name:'그림자 반사', kind:'none', counter:'single' },
        { name:'어둠 흡수', kind:'all', drain:true },
      ],
    },
    emergencyExitGhost: {
      id:'emergencyExitGhost', name:'비상구 귀신', level:9, hp:352, attack:24,
      desc:'비상구 유도등 뒤에 숨어 있다.',
      pattern:[
        { name:'비상문 충돌', kind:'single', target:'front', stun:true },
        { name:'차가운 유도등', kind:'all', chill:true },
        { name:'탈출구 봉쇄', kind:'all', hits:2 },
        { name:'귀신 형상', kind:'none', empower:3 },
      ],
    },
    // ── Lv.10 ────────────────────────────────────────────
    towerWarden: {
      id:'towerWarden', name:'63빌딩 관리자', level:10, hp:464, attack:29,
      desc:'빌딩의 모든 층을 관리해 온 존재.',
      pattern:[
        { name:'관리봉 휘두르기', kind:'single', target:'front' },
        { name:'시설 통제', kind:'all', stun:true },
        { name:'긴급 보수', kind:'none', healPct:0.30 },
        { name:'관리 경고', kind:'none', chargeNext:'시설 통제' },
        { name:'강제 퇴실', kind:'all', hits:3 },
      ],
    },
    elevatorSoul: {
      id:'elevatorSoul', name:'엘리베이터 영혼', level:10, hp:432, attack:29,
      desc:'멈춘 엘리베이터에 갇힌 혼.',
      pattern:[
        { name:'급상승 충격', kind:'single', hits:2, target:'middle' },
        { name:'층간 급정지', kind:'all', stun:true },
        { name:'추락 운행', kind:'all', hits:3 },
      ],
    },
    // ── Lv.11 ────────────────────────────────────────────
    windowWraith: {
      id:'windowWraith', name:'유리창 망령', level:11, hp:544, attack:32,
      desc:'깨진 유리창에 비친 형상.',
      pattern:[
        { name:'유리 파편', kind:'single', hits:2, target:'front' },
        { name:'차가운 반사광', kind:'all', chill:true },
        { name:'깨진 잔상', kind:'all', poison:8 },
      ],
    },
    engineIronGiant: {
      id:'engineIronGiant', name:'기계실 철갑거인', level:11, hp:520, attack:32,
      desc:'기계실을 지키는 철갑 거인.',
      pattern:[
        { name:'강철 주먹', kind:'single', target:'middle', stun:true },
        { name:'증기 분출', kind:'all', hits:2 },
        { name:'철갑 방벽', kind:'none', shieldPct:0.50 },
        { name:'반격 장갑', kind:'none', counter:'all' },
      ],
    },
    // ── Lv.12~14 (각 한 마리, 확정 출현) ──────────────────
    ominousFloorManager: {
      id:'ominousFloorManager', name:'불길한 층간 관리자', level:12, hp:656, attack:37,
      desc:'층과 층 사이를 관리하는 존재.',
      pattern:[
        { name:'층간 소음 경고', kind:'single', target:'front', stun:true },
        { name:'소음 민원 폭발', kind:'all', hits:2 },
        { name:'관리비 징수', kind:'single', hits:2, target:'front', drain:true },
        { name:'규정 강화', kind:'none', empower:3 },
        { name:'출입 제한', kind:'none', blind:2 },
      ],
    },
    nonexistentFloorLord: {
      id:'nonexistentFloorLord', name:'존재하지 않는 층의 지배자', level:13, hp:880, attack:42,
      desc:'있어서는 안 되는 층을 다스린다.',
      pattern:[
        { name:'존재 삭제', kind:'single', target:'front', stun:true },
        { name:'공허의 냉기', kind:'all', chill:true },
        { name:'좌표 경고', kind:'none', chargeNext:'공허 흡수' },
        { name:'공허 흡수', kind:'all', drain:true },
        { name:'층 재구성', kind:'none', healPct:0.25 },
      ],
    },
    rooftopMyeongjinRobot: {
      id:'rooftopMyeongjinRobot', name:'옥상의 명진쌤 로봇', level:14, hp:1280, attack:48,
      desc:'옥상에서 기다리는 마지막 관문.',
      pattern:[
        { name:'출석 점검', kind:'single', hits:3, target:'front', stun:true },
        { name:'레이저 지시봉', kind:'all', hits:4, poison:5 },
        { name:'채점 방어막', kind:'none', shieldPct:1.00 },
        { name:'보충수업 모드', kind:'none', empower:3 },
        { name:'최종 평가', kind:'all', hits:2, stun:true },
      ],
    },
  });

  /* 같은 레벨에 두 마리가 있으면 A/B 중 하나를 무작위로 뽑는다.
     Lv.12~14는 한 마리뿐이라 확정 출현한다. */
  const LEVEL_ROSTER = Object.freeze({
    5:Object.freeze(['mushroomKing', 'paperPigeon']),
    6:Object.freeze(['buildingStomp', 'brokenPhone']),
    7:Object.freeze(['pollutedSlime', 'rampageCopier']),
    8:Object.freeze(['officeGhost', 'guardBot']),
    9:Object.freeze(['blackoutShade', 'emergencyExitGhost']),
    10:Object.freeze(['towerWarden', 'elevatorSoul']),
    11:Object.freeze(['windowWraith', 'engineIronGiant']),
    12:Object.freeze(['ominousFloorManager']),
    13:Object.freeze(['nonexistentFloorLord']),
    14:Object.freeze(['rooftopMyeongjinRobot']),
  });

  /* 던전 구간별 네 번의 조우 구성.
     'both'  = 그 레벨 두 마리를 모두 순서대로
     'pick'  = 그 레벨에서 한 마리를 무작위로
     'fixed' = 한 마리뿐이라 확정 */
  const FLOORS = Object.freeze({
    1: Object.freeze({
      floor:1, title:'63빌딩 1~10층', range:'1–10층', recommendedLevel:5,
      plan:Object.freeze([{ level:5, mode:'both' }, { level:6, mode:'pick' }, { level:7, mode:'pick' }]),
      reward:Object.freeze({ exp:40, gold:180, building:20 }),
    }),
    11: Object.freeze({
      floor:11, title:'63빌딩 11~20층', range:'11–20층', recommendedLevel:6,
      plan:Object.freeze([{ level:6, mode:'both' }, { level:7, mode:'pick' }, { level:8, mode:'pick' }]),
      reward:Object.freeze({ exp:60, gold:240, building:26 }),
    }),
    21: Object.freeze({
      floor:21, title:'63빌딩 21~30층', range:'21–30층', recommendedLevel:7,
      plan:Object.freeze([{ level:7, mode:'both' }, { level:8, mode:'pick' }, { level:9, mode:'pick' }]),
      reward:Object.freeze({ exp:85, gold:300, building:32 }),
    }),
    31: Object.freeze({
      floor:31, title:'63빌딩 31~40층', range:'31–40층', recommendedLevel:8,
      plan:Object.freeze([{ level:8, mode:'both' }, { level:9, mode:'pick' }, { level:10, mode:'pick' }]),
      reward:Object.freeze({ exp:115, gold:380, building:40 }),
    }),
    41: Object.freeze({
      floor:41, title:'63빌딩 41~50층', range:'41–50층', recommendedLevel:9,
      plan:Object.freeze([{ level:9, mode:'both' }, { level:10, mode:'pick' }, { level:11, mode:'pick' }]),
      reward:Object.freeze({ exp:150, gold:460, building:48 }),
    }),
    51: Object.freeze({
      floor:51, title:'63빌딩 51~60층', range:'51–60층', recommendedLevel:10,
      plan:Object.freeze([{ level:10, mode:'both' }, { level:11, mode:'pick' }, { level:12, mode:'fixed' }]),
      reward:Object.freeze({ exp:200, gold:560, building:58 }),
    }),
    61: Object.freeze({
      floor:61, title:'63빌딩 61~63층', range:'61–63층', recommendedLevel:12,
      // 고레벨은 한 마리뿐이라 세 번 조우로 끝난다.
      plan:Object.freeze([{ level:12, mode:'fixed' }, { level:13, mode:'fixed' }, { level:14, mode:'fixed' }]),
      reward:Object.freeze({ exp:300, gold:800, building:80 }),
    }),
  });

  /* 방을 시작할 때 딱 한 번 뽑아 서버 방 상태에 저장할 조우 목록.
     세 학생이 같은 목록을 봐야 하므로 각자 다시 뽑으면 안 된다. */
  function rollEncounters(floor, rng = Math.random) {
    const def = getFloor(floor);
    if (!def) return [];
    const ids = [];
    def.plan.forEach((step) => {
      const roster = LEVEL_ROSTER[step.level] || [];
      if (!roster.length) return;
      if (step.mode === 'both') { ids.push(...roster); return; }
      if (step.mode === 'fixed') { ids.push(roster[0]); return; }
      const pick = Math.floor(Number(rng()) * roster.length);
      ids.push(roster[Math.min(roster.length - 1, Math.max(0, pick))]);
    });
    return ids;
  }

  function getFloor(floor) {
    return FLOORS[Number(floor)] || null;
  }

  function availableFloors() {
    return Object.keys(FLOORS).map(Number).sort((a, b) => a - b);
  }

  /* 한 층에서 순서대로 만나는 몬스터들. 마지막이 레이드 보스다. */
  /* 이 층에서 순서대로 만나는 몬스터들. 마지막이 그 층의 보스다.
     ids 를 넘기면 그 목록을 그대로 쓴다(방 시작 때 한 번 뽑아 저장한 목록).
     안 넘기면 그 자리에서 뽑는다 — 혼자 도는 경우에만 쓴다. */
  function floorEncounters(floor, ids = null) {
    const def = getFloor(floor);
    if (!def) return [];
    const list = Array.isArray(ids) && ids.length ? ids : rollEncounters(floor);
    return list
      .map((id) => MONSTERS[id])
      .filter(Boolean)
      .map((monster, index, all) => ({
        ...monster,
        index,
        isBoss: index === all.length - 1,
      }));
  }

  /* ---------- 패턴 효과의 세기 ----------

     시트에는 효과의 '이름'만 있고 몇 턴짜리인지·몇 배인지는 없다.
     그래서 그 수치만 여기 따로 모아 둔다. 위쪽 밸런스 상수표와 달리
     이 표는 이번에 새로 만든 것이라 나중에 마음대로 조절해도 된다. */
  const PATTERN_EFFECT = Object.freeze({
    /* 전체 공격은 셋을 한꺼번에 때려서 실제로는 단일 공격의 몇 배가 된다.
       그대로 두면 너무 세서 절반으로 낮춘다(제작자 조정). */
    ALL_ATTACK_MULTIPLIER:0.5,
    POISON_TURNS:2,          // 독은 두 턴 동안 남아 매 턴 같은 피해를 준다
    STUN_TURNS:1,            // 기절하면 다음 한 턴을 통째로 건너뛴다
    CHILL_TURNS:1,           // 냉기는 그 사람의 다음 공격 피해를 절반으로
    DRAIN_RATIO:1,           // 흡혈은 준 피해만큼 몬스터가 회복
    EMPOWER_MULTIPLIER:1.5,  // 강화 중인 몬스터의 공격력
    COUNTER_RATIO:1,         // 반격 한 대 = 그 몬스터의 전체 공격 한 대
    COUNTER_CHANCE:0.5,      // 반격은 절반의 확률로만 되돌아온다(제작자 조정)
    CHARGE_MULTIPLIER:2,     // 예고한 기술은 두 배로 들어온다
  });

  const PLAN_TARGETS = Object.freeze(['front', 'middle', 'back', 'random']);

  /* 시트에서 옮긴 패턴 한 칸을 계산에 쓸 수 있는 모양으로 다듬는다.
     빠진 항목은 전부 '없음'으로 채우므로 계산 쪽에서 있는지 없는지 따지지 않아도 된다. */
  function normalizeAttackPlan(source) {
    const src = source && typeof source === 'object' ? source : { kind:source };
    const kind = src.kind === 'all' ? 'all' : (src.kind === 'none' ? 'none' : 'single');
    return {
      name:String(src.name || (kind === 'all' ? '전체 공격' : '공격')),
      kind,
      hits:Math.max(1, Math.min(4, Math.trunc(Number(src.hits) || 1))),
      target:PLAN_TARGETS.includes(src.target) ? src.target : null,
      poison:Math.max(0, Math.trunc(Number(src.poison) || 0)),
      stun:src.stun === true,
      chill:src.chill === true,
      drain:src.drain === true,
      shieldPct:Math.max(0, Number(src.shieldPct) || 0),
      healPct:Math.max(0, Number(src.healPct) || 0),
      counter:src.counter === 'all' ? 'all' : (src.counter === 'single' ? 'single' : null),
      blind:Math.max(0, Math.trunc(Number(src.blind) || 0)),
      empower:Math.max(0, Math.trunc(Number(src.empower) || 0)),
      chargeNext:src.chargeNext ? String(src.chargeNext) : null,
    };
  }

  /* ---------- 기술 순서는 무작위 ----------

     몬스터는 자기 기술을 정해진 차례가 아니라 무작위로 쓴다.
     다만 두 가지를 지켜야 한다.

     1) 같은 방의 셋과 서버가 반드시 '같은' 순서를 봐야 한다.
        각자 따로 굴리면 화면마다 다음 턴 예고가 어긋난다.
        그래서 난수를 그때그때 굴리지 않고 (씨앗, 몬스터, 라운드)에서
        똑같이 다시 만들어 낸다. 같은 값을 넣으면 언제나 같은 결과다.

     2) 한 기술만 계속 나오거나 회복·보호막이 한 번도 안 나오면 안 된다.
        그래서 '섞은 주머니' 방식을 쓴다 — 기술 수만큼의 한 바퀴 안에서는
        모든 기술이 한 번씩 나오되, 그 안의 순서를 매번 새로 섞는다.
        (기술이 셋이면 3턴마다 새로 섞는다.) */

  /* 문자열이든 숫자든 32비트 정수 하나로 접는다. */
  function hashSeed(value) {
    const text = String(value == null ? '' : value);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  /* 씨앗 하나로 굴러가는 작은 난수기(mulberry32). 같은 씨앗이면 같은 값. */
  function seededRng(seed) {
    let state = (hashSeed(seed) + 0x6d2b79f5) >>> 0;
    return function next() {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* 0..length-1을 씨앗대로 섞은 차례. 같은 씨앗이면 언제나 같은 차례다. */
  function shuffledOrder(length, seed) {
    const order = Array.from({ length }, (_, index) => index);
    const rng = seededRng(seed);
    for (let index = length - 1; index > 0; index -= 1) {
      const pick = Math.floor(rng() * (index + 1));
      const swap = order[index];
      order[index] = order[pick];
      order[pick] = swap;
    }
    return order;
  }

  /* 이 몬스터의 이번 한 바퀴에 쓸 씨앗.
     몬스터·조우 순서·바퀴 수가 다르면 순서도 달라진다. */
  function cycleSeed(monster, cycle, seed) {
    return `${seed ?? ''}|${monster?.id || 'monster'}|${monster?.index ?? 0}|${cycle}`;
  }

  function attackKindForRound(monster, round, seed = 0) {
    return attackPlanForRound(monster, round, seed).kind;
  }

  function attackPlanForRound(monster, round, seed = 0) {
    const pattern = Array.isArray(monster?.pattern) && monster.pattern.length
      ? monster.pattern
      : ['single'];
    const index = Math.max(0, Math.floor(Number(round) || 0));
    if (pattern.length === 1) return normalizeAttackPlan(pattern[0]);
    const cycle = Math.floor(index / pattern.length);
    const order = shuffledOrder(pattern.length, cycleSeed(monster, cycle, seed));
    return normalizeAttackPlan(pattern[order[index % pattern.length]]);
  }

  /* chargeNext가 이름으로 가리키는 기술을 그 몬스터의 패턴에서 찾는다. */
  function planByName(monster, name) {
    const pattern = Array.isArray(monster?.pattern) ? monster.pattern : [];
    const found = pattern.find((entry) => entry && typeof entry === 'object' && entry.name === name);
    return found ? normalizeAttackPlan(found) : null;
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
      raidRules:{
        damageMultiplier, pickTarget, SINGLE_TARGET_BONUS, MONSTER_DAMAGE_MULTIPLIER,
        PATTERN_EFFECT, SLOTS,
      },
    });
    return { ok:true, ...result };
  }

  global.YuksamRaidRules = Object.freeze({
    SLOTS,
    SLOT_LABEL,
    DAMAGE_TAKEN,
    PARTY_SIZE,
    MONSTERS,
    LEVEL_ROSTER,
    FLOORS,
    ALLY_CORRECT_RATE,
    PARTY_POWER,
    SINGLE_TARGET_BONUS,
    MONSTER_DAMAGE_MULTIPLIER,
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
    rollEncounters,
    PATTERN_EFFECT,
    normalizeAttackPlan,
    hashSeed,
    seededRng,
    shuffledOrder,
    attackKindForRound,
    attackPlanForRound,
    planByName,
    allyAnswersCorrectly,
    isPartyWiped,
    isMonsterDown,
    resolvePartyCombatRound,
  });
})(typeof window !== 'undefined' ? window : globalThis);
