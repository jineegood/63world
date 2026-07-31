(function initYuksamData(global) {
  const YuksamCore = global.YuksamCore;
  if (!YuksamCore) throw new Error('YuksamCore must be loaded before game-data.js');
  const { uid } = YuksamCore;

  const CLASS_META = {
    warrior: {
      name: '전사',
      weapon: '훈련용 목검',
      specs: ['방어', '무기'],
      baseStats: { 힘: 8, 지능: 2, 정신: 3, 체력: 4 },
      color: '#ef4444',
    },
    mage: {
      name: '마법사',
      weapon: '견습생 지팡이',
      specs: ['냉기', '화염'],
      baseStats: { 힘: 2, 지능: 9, 정신: 5, 체력: 2 },
      color: '#60a5fa',
    },
    priest: {
      name: '사제',
      weapon: '수련용 성서',
      specs: ['신성', '암흑'],
      baseStats: { 힘: 3, 지능: 5, 정신: 9, 체력: 2 },
      color: '#f8fafc',
    },
  };

  const LEGACY_BASE_VITALITY = Object.freeze({ warrior: 8, mage: 5, priest: 5 });
  function resolvePlayerBaseStats(klass, baseStatsVersion) {
    const classKey = CLASS_META[klass] ? klass : 'warrior';
    const stats = { ...CLASS_META[classKey].baseStats };
    if (Number(baseStatsVersion) < 2) stats.체력 = LEGACY_BASE_VITALITY[classKey];
    return stats;
  }

  const XP_REQUIREMENTS = { 1: 10, 2: 40, 3: 80, 4: 130, 5: 200, 6: 280, 7: 370, 8: 470, 9: 580, 10: 700 };
  const PLAYER_WORLD_SCALE = 1.26;
  const NPC_WORLD_SCALE = 1.26;
  const STORAGE = {
    playerPrefix: 'ysb_player_',
    questions: 'ysb_questions_v2',
    workbooks: 'ysb_workbooks_v3',
  };

  const ITEM_DEFS = {
    bronzeGreatsword: { id: 'bronzeGreatsword', name: '목검', slot: 'weapon', classOnly: 'warrior', price: 30, desc: '전사용 장비. 훈련용보다 단단한 목검입니다. 힘 +2, 체력 +1', stats: { 힘: 2, 체력: 1 }, visual: 'woodSwordPlus' },
    blueSword: { id: 'blueSword', name: '푸른 검', slot: 'weapon', classOnly: 'warrior', price: 70, levelReq: 3, desc: '전사용 장비. 푸른 빛이 도는 검입니다. 힘 +4, 체력 +1', stats: { 힘: 4, 체력: 1 }, visual: 'mithrilSword' },
    ironSword: { id: 'ironSword', name: '은빛 검', slot: 'weapon', classOnly: 'warrior', price: 160, levelReq: 6, desc: '전사용 장비. 은빛으로 벼려진 검입니다. 힘 +6, 체력 +2', stats: { 힘: 6, 체력: 2 }, visual: 'ironSword' },
    mithrilSword: { id: 'mithrilSword', name: '미스릴 검', slot: 'weapon', classOnly: 'warrior', price: 320, levelReq: 9, desc: '전사용 장비. 가볍고 강력한 미스릴 검입니다. 힘 +9, 체력 +3', stats: { 힘: 9, 체력: 3 }, visual: 'mithrilSword' },
    crystalStaff: { id: 'crystalStaff', name: '떡갈나무 지팡이', slot: 'weapon', classOnly: 'mage', price: 30, desc: '마법사용 장비. 숲의 기운이 깃든 지팡이입니다. 지능 +3', stats: { 지능: 3 } },
    holyBook: { id: 'holyBook', name: '기도서', slot: 'weapon', classOnly: 'priest', price: 30, desc: '사제용 장비. 기초 기도문이 담긴 책입니다. 정신 +3', stats: { 정신: 3 } },
    oakStaff: { id: 'oakStaff', name: '철목 지팡이', slot: 'weapon', classOnly: 'mage', price: 70, levelReq: 3, desc: '마법사용 장비. 단단한 철목 지팡이입니다. 지능 +5', stats: { 지능: 5 }, visual: 'oakStaff' },
    ironwoodStaff: { id: 'ironwoodStaff', name: '수정 지팡이', slot: 'weapon', classOnly: 'mage', price: 160, levelReq: 6, desc: '마법사용 장비. 수정의 마력이 흐르는 지팡이입니다. 지능 +7', stats: { 지능: 7 }, visual: 'ironwoodStaff' },
    mithrilStaff: { id: 'mithrilStaff', name: '미스릴 지팡이', slot: 'weapon', classOnly: 'mage', price: 320, levelReq: 9, desc: '마법사용 장비. 푸른 마력이 흐르는 지팡이입니다. 지능 +10', stats: { 지능: 10 }, visual: 'mithrilStaff' },
    prayerBook: { id: 'prayerBook', name: '빛의 성서', slot: 'weapon', classOnly: 'priest', price: 70, levelReq: 3, desc: '사제용 장비. 빛의 기도문이 담긴 성서입니다. 정신 +5', stats: { 정신: 5 }, visual: 'prayerBook' },
    silverBook: { id: 'silverBook', name: '은빛 성서', slot: 'weapon', classOnly: 'priest', price: 160, levelReq: 6, desc: '사제용 장비. 은빛 문양의 성서입니다. 정신 +7', stats: { 정신: 7 }, visual: 'silverBook' },
    dawnTome: { id: 'dawnTome', name: '새벽의 고서', slot: 'weapon', classOnly: 'priest', price: 320, levelReq: 9, desc: '사제용 장비. 빛과 암흑의 문장이 함께 적힌 고서입니다. 정신 +10', stats: { 정신: 10 }, visual: 'dawnTome' },
    whiteCloak: { id: 'whiteCloak', name: '흰 망토', slot: 'armor', classOnly: null, desc: '명진쌤이 챙겨준 기본 보급 망토. 체력 +1 (퀘스트 지급품)', stats: { 체력: 1 }, look: { type: 'cloak', color: '#f8fafc' }, questReward: true },
    noviceHat: { id: 'noviceHat', name: '수련 모자', slot: 'head', classOnly: null, price: 20, desc: '모든 직업 착용 가능. 체력 +1', stats: { 체력: 1 }, visual: 'blueCap' },
    forestCloak: { id: 'forestCloak', name: '숲의 망토', slot: 'armor', classOnly: null, price: 30, desc: '모든 직업 착용 가능. 체력 +2', stats: { 체력: 2 }, visual: 'greenCloak' },
    /* ── 직업별 방어구 3단계 (Lv.3/6/9, 전부 다른 색) ── */
    leatherArmor:  { id: 'leatherArmor',  name: '가죽 갑옷',       slot: 'armor', classOnly: 'warrior', price: 70,  levelReq: 3, desc: '전사용 방어구. 체력 +2, 힘 +1', stats: { 체력: 2, 힘: 1 }, look: { type: 'chestplate', color: '#a16207' } },
    steelArmor:    { id: 'steelArmor',    name: '강철 흉갑',       slot: 'armor', classOnly: 'warrior', price: 160, levelReq: 6, desc: '전사용 방어구. 체력 +4, 힘 +1', stats: { 체력: 4, 힘: 1 }, look: { type: 'chestplate', color: '#94a3b8' } },
    crimsonArmor:  { id: 'crimsonArmor',  name: '진홍 판금 갑옷',  slot: 'armor', classOnly: 'warrior', price: 320, levelReq: 9, desc: '전사용 방어구. 체력 +6, 힘 +2', stats: { 체력: 6, 힘: 2 }, look: { type: 'chestplate', color: '#dc2626' } },
    skyRobe:       { id: 'skyRobe',       name: '하늘빛 로브',     slot: 'armor', classOnly: 'mage', price: 70,  levelReq: 3, desc: '마법사용 로브. 체력 +2, 지능 +1', stats: { 체력: 2, 지능: 1 }, look: { type: 'cloak', color: '#38bdf8' } },
    navyRobe:      { id: 'navyRobe',      name: '남색 현자 로브',  slot: 'armor', classOnly: 'mage', price: 160, levelReq: 6, desc: '마법사용 로브. 체력 +3, 지능 +2', stats: { 체력: 3, 지능: 2 }, look: { type: 'cloak', color: '#1e3a8a' } },
    violetRobe:    { id: 'violetRobe',    name: '보랏빛 대마법사 로브', slot: 'armor', classOnly: 'mage', price: 320, levelReq: 9, desc: '마법사용 로브. 체력 +4, 지능 +3', stats: { 체력: 4, 지능: 3 }, look: { type: 'cloak', color: '#7c3aed' } },
    whiteVestment: { id: 'whiteVestment', name: '순백의 제의',     slot: 'armor', classOnly: 'priest', price: 70,  levelReq: 3, desc: '사제용 제의. 체력 +2, 정신 +1', stats: { 체력: 2, 정신: 1 }, look: { type: 'robe', color: '#f1f5f9' } },
    goldVestment:  { id: 'goldVestment',  name: '금빛 축복 제의',  slot: 'armor', classOnly: 'priest', price: 160, levelReq: 6, desc: '사제용 제의. 체력 +3, 정신 +2', stats: { 체력: 3, 정신: 2 }, look: { type: 'robe', color: '#facc15' } },
    roseVestment:  { id: 'roseVestment',  name: '장미빛 성자 제의', slot: 'armor', classOnly: 'priest', price: 320, levelReq: 9, desc: '사제용 제의. 체력 +4, 정신 +3', stats: { 체력: 4, 정신: 3 }, look: { type: 'robe', color: '#fb7185' } },
    /* ── 직업별 머리 3단계 (Lv.3/6/9, 전부 다른 색) ── */
    leatherHelm:   { id: 'leatherHelm',   name: '가죽 투구',       slot: 'head', classOnly: 'warrior', price: 55,  levelReq: 3, desc: '전사용 투구. 체력 +1, 힘 +1', stats: { 체력: 1, 힘: 1 }, look: { type: 'helm', color: '#a16207' } },
    steelHelm:     { id: 'steelHelm',     name: '강철 투구',       slot: 'head', classOnly: 'warrior', price: 130, levelReq: 6, desc: '전사용 투구. 체력 +2, 힘 +2', stats: { 체력: 2, 힘: 2 }, look: { type: 'helm', color: '#cbd5e1' } },
    crimsonHelm:   { id: 'crimsonHelm',   name: '진홍 투구',       slot: 'head', classOnly: 'warrior', price: 260, levelReq: 9, desc: '전사용 투구. 체력 +3, 힘 +3', stats: { 체력: 3, 힘: 3 }, look: { type: 'helm', color: '#ef4444' } },
    blueWizardHat: { id: 'blueWizardHat', name: '파란 마법 고깔',  slot: 'head', classOnly: 'mage', price: 55,  levelReq: 3, desc: '마법사용 모자. 지능 +2', stats: { 지능: 2 }, look: { type: 'wizardHat', color: '#3b82f6' } },
    navyWizardHat: { id: 'navyWizardHat', name: '남색 별 고깔',    slot: 'head', classOnly: 'mage', price: 130, levelReq: 6, desc: '마법사용 모자. 지능 +3, 체력 +1', stats: { 지능: 3, 체력: 1 }, look: { type: 'wizardHat', color: '#312e81' } },
    violetWizardHat:{ id: 'violetWizardHat', name: '보라 현자 고깔', slot: 'head', classOnly: 'mage', price: 260, levelReq: 9, desc: '마법사용 모자. 지능 +4, 체력 +1', stats: { 지능: 4, 체력: 1 }, look: { type: 'wizardHat', color: '#8b5cf6' } },
    whiteHood:     { id: 'whiteHood',     name: '순백 두건',       slot: 'head', classOnly: 'priest', price: 55,  levelReq: 3, desc: '사제용 두건. 정신 +2', stats: { 정신: 2 }, look: { type: 'nurseCap', color: '#e2e8f0' } },
    goldCirclet:   { id: 'goldCirclet',   name: '금빛 성관',       slot: 'head', classOnly: 'priest', price: 130, levelReq: 6, desc: '사제용 관. 정신 +3, 체력 +1', stats: { 정신: 3, 체력: 1 }, look: { type: 'nurseCap', color: '#eab308' } },
    roseHood:      { id: 'roseHood',      name: '장미빛 성자 두건', slot: 'head', classOnly: 'priest', price: 260, levelReq: 9, desc: '사제용 두건. 정신 +4, 체력 +1', stats: { 정신: 4, 체력: 1 }, look: { type: 'nurseCap', color: '#fb7185' } },
    /* ── 구버전 특별 아이템 (판매 중단, 보유자 호환용) ── */
    starCape: { id: 'starCape', name: '별빛 망토', slot: 'armor', classOnly: null, desc: '전설의 망토. 주요 능력치 +2, 체력 +4 (퀘스트 보상)', stats: { 힘: 2, 지능: 2, 정신: 2, 체력: 4 }, visual: 'starCape', questReward: true },
    honorCrown: { id: 'honorCrown', name: '명예 왕관', slot: 'head', classOnly: null, desc: '명예의 증표. 모든 주요 능력치 +2 (퀘스트 보상)', stats: { 힘: 2, 지능: 2, 정신: 2, 체력: 2 }, visual: 'crown', questReward: true },
  };
  // 특별 상점 = 악세서리 전문점 (5종, Lv.3+, 소지만 해도 possessStats 보너스)
  const BUILDING_ITEM_DEFS = {
    featherWing: { id: 'featherWing', name: '하얀 날개 장식', slot: 'accessory', classOnly: null, buildingPrice: 5, levelReq: 3, desc: '순백의 날개. 장착: 정신 +2, 체력 +4 · 소지: 정신 +1', stats: { 정신: 2, 체력: 4 }, possessStats: { 정신: 1 }, visual: 'whiteWing', look: { type: 'wing', color: 'rgba(255,255,255,.92)' } },
    sixthWing: { id: 'sixthWing', name: '육삼 황금 날개', slot: 'accessory', classOnly: null, buildingPrice: 5, levelReq: 3, desc: '63층의 바람을 담은 금빛 날개. 장착: 정신 +3, 체력 +2 · 소지: 체력 +1', stats: { 정신: 3, 체력: 2 }, possessStats: { 체력: 1 }, visual: 'sixthWing', look: { type: 'wing', color: 'rgba(250,204,21,.92)' } },
    starPendant: { id: 'starPendant', name: '별빛 목걸이', slot: 'accessory', classOnly: null, buildingPrice: 5, levelReq: 3, desc: '가슴에서 반짝이는 별. 장착: 지능 +3 · 소지: 지능 +1', stats: { 지능: 3 }, possessStats: { 지능: 1 }, look: { type: 'necklace', color: '#fde68a' } },
    guardAura: { id: 'guardAura', name: '수호의 오라', slot: 'accessory', classOnly: null, buildingPrice: 5, levelReq: 3, desc: '몸을 감싸는 은은한 빛. 장착: 체력 +3 · 소지: 체력 +1', stats: { 체력: 3 }, possessStats: { 체력: 1 }, look: { type: 'aura', color: 'rgba(125,211,252,.45)' } },
    cloverBadge: { id: 'cloverBadge', name: '네잎클로버 배지', slot: 'accessory', classOnly: null, buildingPrice: 5, levelReq: 3, desc: '행운의 초록 배지. 장착: 힘 +3, 체력 +1 · 소지: 힘 +1', stats: { 힘: 3, 체력: 1 }, possessStats: { 힘: 1 }, look: { type: 'badge', color: '#4ade80' } },
  };
  Object.assign(ITEM_DEFS, BUILDING_ITEM_DEFS);

  const SKILL_DEFS = {
    warrior_toughness: { id: 'warrior_toughness', classOnly: 'warrior', name: '강인한 체력', line: 1, desc: '기초 체력을 단련합니다. 체력 스텟 +1을 얻습니다.', cost: 1, maxPoints: 1, prereq: [], x: 14, y: 50, kind: 'root', bonuses: { 체력: 1 }, passiveText: '체력 +1' },
    warrior_charge: { id: 'warrior_charge', classOnly: 'warrior', name: '돌진', line: 2, desc: '적에게 순식간에 거리를 좁혀 타격합니다. 현재 공격력의 150% 피해. 쿨타임 3턴.', cost: 1, maxPoints: 1, prereqPoints: { warrior_toughness: 1 }, mutualGroup: 'warrior_line2', x: 32, y: 35, kind: 'power', active: { name: '돌진', cooldown: 3, type: 'damage', multiplier: 1.5 } },
    warrior_defense_stance: { id: 'warrior_defense_stance', classOnly: 'warrior', name: '방어 태세', line: 2, desc: '최대 체력의 30%만큼 피해를 흡수하는 보호막을 얻습니다. 전투 종료 시 소멸. 쿨타임 3턴.', cost: 1, maxPoints: 1, prereqPoints: { warrior_toughness: 1 }, mutualGroup: 'warrior_line2', x: 32, y: 65, kind: 'guard', active: { name: '방어 태세', cooldown: 3, type: 'shield', shieldPct: 0.3 } },
    warrior_sharp_blade: { id: 'warrior_sharp_blade', classOnly: 'warrior', name: '예리한 칼날', line: 3, desc: '공격 시 적의 방어력을 포인트당 5% / 10% 무시합니다.', cost: 1, maxPoints: 2, prereqAny: ['warrior_charge', 'warrior_defense_stance'], x: 52, y: 35, kind: 'power', passiveText: '방어력 무시' },
    warrior_thick_armor: { id: 'warrior_thick_armor', classOnly: 'warrior', name: '두터운 갑옷', line: 3, desc: '자신이 받는 최종 데미지가 포인트당 5% / 10% 감소합니다.', cost: 1, maxPoints: 2, prereqAny: ['warrior_charge', 'warrior_defense_stance'], x: 52, y: 65, kind: 'guard', passiveText: '피해 감소' },
    warrior_frenzy: { id: 'warrior_frenzy', classOnly: 'warrior', name: '광분', line: 4, desc: '체력이 낮아질수록 힘이 포인트당 최대 15% / 30% 증가합니다.', cost: 1, maxPoints: 2, prereqTotal: { ids: ['warrior_sharp_blade', 'warrior_thick_armor'], points: 2 }, x: 74, y: 35, kind: 'power', passiveText: '저체력 힘 증가' },
    warrior_regeneration: { id: 'warrior_regeneration', classOnly: 'warrior', name: '재생력 강화', line: 4, desc: '매 턴 시작 시 최대 체력의 1.5% / 3%만큼 체력을 회복합니다.', cost: 1, maxPoints: 2, prereqTotal: { ids: ['warrior_sharp_blade', 'warrior_thick_armor'], points: 2 }, x: 74, y: 65, kind: 'guard', passiveText: '턴 시작 회복' },
  };
  const SKILL_LINES = [
    ['warrior_toughness', 'warrior_charge'], ['warrior_toughness', 'warrior_defense_stance'],
    ['warrior_charge', 'warrior_sharp_blade'], ['warrior_charge', 'warrior_thick_armor'],
    ['warrior_defense_stance', 'warrior_sharp_blade'], ['warrior_defense_stance', 'warrior_thick_armor'],
    ['warrior_sharp_blade', 'warrior_frenzy'], ['warrior_sharp_blade', 'warrior_regeneration'],
    ['warrior_thick_armor', 'warrior_frenzy'], ['warrior_thick_armor', 'warrior_regeneration'],
  ];

  const V24_SKILLS = {
    // === 전사 공용 ===
    warrior_basic_body: { id:'warrior_basic_body', v24:true, classOnly:'warrior', name:'기초 체력 단련', icon:'💪', line:1, desc:'전사의 기본기는 체력이다. 체력 +2.', cost:1, maxPoints:3, prereq:[], kind:'root', bonuses:{ 체력:2 }, passiveText:'체력 +2' },
    warrior_basic_blade: { id:'warrior_basic_blade', v24:true, classOnly:'warrior', name:'기초 검술', icon:'🗡️', line:2, desc:'검을 다루는 기본 자세이다. 힘 +1.', cost:1, maxPoints:3, prereq:['warrior_basic_body'], kind:'power', bonuses:{ 힘:1 }, passiveText:'힘 +1' },
    warrior_basic_guard: { id:'warrior_basic_guard', v24:true, classOnly:'warrior', name:'막기 훈련', icon:'🛡️', line:3, desc:'매 턴 상대의 공격을 막는다. 매 턴 보호막 2,4,6% 생성', cost:1, maxPoints:3, prereq:['warrior_basic_blade'], kind:'guard', guardShieldPct:[0,.02,.04,.06], passiveText:'매 턴 현재 체력 2/4/6% 보호막' },
    warrior_basic_strike: { id:'warrior_basic_strike', v24:true, classOnly:'warrior', name:'전사의 일격', icon:'⚔️', line:4, desc:'상대의 보호막을 무시하고 현재 공격력의 180% 피해를 준다. 쿨타임 4턴.', cost:1, maxPoints:1, prereq:['warrior_basic_guard'], kind:'power', active:{ name:'전사의 일격', cooldown:4, type:'damage', multiplier:1.8, ignoreShield:true } },
    // === 전사 방어 ===
    warrior_def_stance: { id:'warrior_def_stance', v24:true, classOnly:'warrior', specOnly:'방어', name:'방어 태세', icon:'🛡️', line:5, desc:'방어의 태세, 최대 체력의 10% 보호막을 얻는다. 쿨타임 6턴.', cost:1, maxPoints:1, prereq:['warrior_basic_strike'], kind:'guard', active:{ name:'방어 태세', cooldown:6, type:'shield', shieldPct:.10 } },
    warrior_def_armor: { id:'warrior_def_armor', v24:true, classOnly:'warrior', specOnly:'방어', name:'공세 갑옷', icon:'🥋', line:6, desc:'체력+3, 최대 체력의 2,4,6,8,10%만큼 기본 공격에 추가 데미지', cost:1, maxPoints:5, prereq:['warrior_def_stance'], kind:'guard', flatBonuses:{ 체력:3 }, armorBonusPct:[0,.02,.04,.06,.08,.10], passiveText:'체력 +3 · 기본 공격 추가 피해 2~10%' },
    warrior_def_resist: { id:'warrior_def_resist', v24:true, classOnly:'warrior', specOnly:'방어', name:'불굴의 의지', icon:'🔰', line:7, desc:'상태 이상에 잘 걸리지 않는 전사의 의지. 체력 +1. 매 턴 20,40,60,80,100% 확률로 상태이상에서 깨어난다.', cost:1, maxPoints:5, prereq:['warrior_def_armor'], kind:'guard', bonuses:{ 체력:1 }, cleanseChance:[0,.20,.40,.60,.80,1], passiveText:'체력 +1 · 매 턴 20/40/60/80/100% 상태이상 해제' },
    warrior_def_wall: { id:'warrior_def_wall', v24:true, classOnly:'warrior', specOnly:'방어', name:'방패 돌진', icon:'🛡️', line:8, desc:'최대 체력의 10% 보호막을 얻고 내 현재 보호막만큼의 피해를 준다. 쿨타임 7턴', cost:1, maxPoints:1, prereq:['warrior_def_resist'], kind:'guard', active:{ name:'방패 돌진', cooldown:7, type:'shieldBash', shieldPct:.10 } },
    warrior_def_bastion: { id:'warrior_def_bastion', v24:true, classOnly:'warrior', specOnly:'방어', name:'수호자의 맹세', icon:'🌟', line:9, desc:'쓰러질 때, 다시 한번 회복해 일어나 싸운다. 쿨타임 11턴, 한 전투에서 두번 사용 불가', cost:1, maxPoints:1, prereq:['warrior_def_wall'], kind:'ultimate', reviveHealPct:1.0, reviveCooldown:11, passiveText:'전투당 1회 부활(HP 전체 회복)' },
    // === 전사 무기 ===
    warrior_weapon_mastery: { id:'warrior_weapon_mastery', v24:true, classOnly:'warrior', specOnly:'무기', name:'무기 숙련', icon:'⚔️', line:5, desc:'무기의 달인이 된다. 힘 +1. 치명타 피격 시 원래 피해의 10,20,30,40,50%를 반사한다.', cost:1, maxPoints:5, prereq:['warrior_basic_strike'], kind:'power', bonuses:{ 힘:1 }, reflectPct:[0,.10,.20,.30,.40,.50], passiveText:'힘 +1 · 치명타 피격 시 10/20/30/40/50% 반사' },
    warrior_weapon_slash: { id:'warrior_weapon_slash', v24:true, classOnly:'warrior', specOnly:'무기', name:'파쇄 일격', icon:'🗡️', line:6, desc:'현재 공격력의 180% 피해. 상대를 1턴간 기절시킨다. 쿨타임 5턴.', cost:1, maxPoints:1, prereq:['warrior_weapon_mastery'], kind:'power', active:{ name:'파쇄 일격', cooldown:5, type:'damage', multiplier:1.8, stun:1 } },
    warrior_weapon_rage: { id:'warrior_weapon_rage', v24:true, classOnly:'warrior', specOnly:'무기', name:'전투의 대가', icon:'🔥', line:7, desc:'전투의 대가로 성장한다. 힘 +3.', cost:1, maxPoints:3, prereq:['warrior_weapon_slash'], kind:'power', bonuses:{ 힘:3 }, passiveText:'힘 +3' },
    warrior_weapon_breaker: { id:'warrior_weapon_breaker', v24:true, classOnly:'warrior', specOnly:'무기', name:'더블 어택', icon:'💥', line:8, desc:'모든 일반 공격을 빠르게 두번씩 한다. 두번째는 감소된 데미지 (25/50/75%)', cost:1, maxPoints:3, prereq:['warrior_weapon_rage'], kind:'power', doubleAttackPct:[0,.25,.50,.75], passiveText:'일반 공격 2회 타격(2타 25/50/75%)' },
    warrior_weapon_judgment: { id:'warrior_weapon_judgment', v24:true, classOnly:'warrior', specOnly:'무기', name:'최후의 심판', icon:'✦', line:9, desc:'한 턴간 모은 후, 현재 공격력의 280% 피해. 쿨타임 6턴.', cost:1, maxPoints:1, prereq:['warrior_weapon_breaker'], kind:'ultimate', active:{ name:'최후의 심판', cooldown:6, type:'charge', charge:true, chargeMult:2.8 } },
    // === 마법사 공용 ===
    mage_basic_mana: { id:'mage_basic_mana', v24:true, classOnly:'mage', name:'기초 마력 수련', icon:'🔷', line:1, desc:'마법사의 기본 마력 수련. 지능+1.', cost:1, maxPoints:5, prereq:[], kind:'root', bonuses:{ 지능:1 }, passiveText:'지능 +1' },
    mage_basic_element: { id:'mage_basic_element', v24:true, classOnly:'mage', name:'원소 폭발', icon:'✨', line:2, desc:'상대의 원소를 폭발시킨다. 상대의 남은 체력 3,6,9,12,15 이하 즉시 처형', cost:1, maxPoints:5, prereq:['mage_basic_mana'], kind:'root', executeHp:[0,3,6,9,12,15], passiveText:'적의 남은 체력 3/6/9/12/15 이하 즉시 처치' },
    mage_basic_bolt: { id:'mage_basic_bolt', v24:true, classOnly:'mage', name:'마력탄', icon:'🌠', line:3, desc:'현재 공격력의 150% 피해. 쿨타임 2턴.', cost:1, maxPoints:1, prereq:['mage_basic_element'], kind:'power', active:{ name:'마력탄', cooldown:2, type:'damage', multiplier:1.5 } },
    mage_basic_barrier: { id:'mage_basic_barrier', v24:true, classOnly:'mage', name:'환기', icon:'🔮', line:4, desc:'4턴간 자신의 지능을 30% 늘리고, 최대 체력의 30%를 회복한다. 쿨타임 5턴.', cost:1, maxPoints:1, prereq:['mage_basic_bolt'], kind:'guard', active:{ name:'환기', cooldown:5, type:'buff', buffStat:'지능', buffPct:.30, buffTurns:4, healMaxPct:.30 } },
    // === 마법사 냉기 ===
    mage_frost_focus_v24: { id:'mage_frost_focus_v24', v24:true, classOnly:'mage', specOnly:'냉기', name:'냉기 집중', icon:'❄️', line:5, desc:'냉기의 흐름에 집중한다. 지능 +2, 모든 공격 주문에 상대 기절 확률 7,21,35%', cost:1, maxPoints:3, prereq:['mage_basic_barrier'], kind:'frost', bonuses:{ 지능:2 }, activeStunChance:[0,.07,.21,.35], passiveText:'지능 +2 · 공격 주문 기절 7/21/35%' },
    mage_frost_lance_v24: { id:'mage_frost_lance_v24', v24:true, classOnly:'mage', specOnly:'냉기', name:'빙결 창', icon:'🧊', line:6, desc:'현재 공격력의 180% 피해. 상대를 1턴간 냉기 상태로 만든다. 쿨타임 4턴.', cost:1, maxPoints:1, prereq:['mage_frost_focus_v24'], kind:'frost', active:{ name:'빙결 창', cooldown:4, type:'damage', multiplier:1.8, forceChill:true, chillTurns:1 } },
    mage_frost_armor_v24: { id:'mage_frost_armor_v24', v24:true, classOnly:'mage', specOnly:'냉기', name:'서리 갑옷', icon:'🛡️', line:7, desc:'최대 체력의 130% 보호막. 쿨타임 6턴.', cost:1, maxPoints:1, prereq:['mage_frost_lance_v24'], kind:'guard', active:{ name:'서리 갑옷', cooldown:6, type:'shield', shieldPct:1.30 } },
    mage_frost_mind_v24: { id:'mage_frost_mind_v24', v24:true, classOnly:'mage', specOnly:'냉기', name:'혹한의 정신', icon:'💎', line:8, desc:'차가운 지능을 얻는다. 지능 +3.', cost:1, maxPoints:3, prereq:['mage_frost_armor_v24'], kind:'frost', bonuses:{ 지능:3 }, passiveText:'지능 +3' },
    mage_frost_storm_v24: { id:'mage_frost_storm_v24', v24:true, classOnly:'mage', specOnly:'냉기', name:'빙하 폭풍', icon:'🌨️', line:9, desc:'현재 공격력의 270% 피해. 상대를 2턴간 얼려 공격 피해를 50% 감소시킨다. 쿨타임 6턴.', cost:1, maxPoints:1, prereq:['mage_frost_mind_v24'], kind:'ultimate', active:{ name:'빙하 폭풍', cooldown:6, type:'damage', multiplier:2.7, chillTurns:2 } },
    // === 마법사 화염 ===
    mage_fire_focus_v24: { id:'mage_fire_focus_v24', v24:true, classOnly:'mage', specOnly:'화염', name:'화염 집중', icon:'🔥', line:5, desc:'화염의 흐름에 집중한다. 지능 +1. 치명타 확률 10,20,30% 증가', cost:1, maxPoints:3, prereq:['mage_basic_barrier'], kind:'fire', bonuses:{ 지능:1 }, critChanceBonus:[0,.10,.20,.30], passiveText:'지능 +1 · 치명타 확률 +10/20/30%p' },
    mage_fireball_v24: { id:'mage_fireball_v24', v24:true, classOnly:'mage', specOnly:'화염', name:'대화염구', icon:'☄️', line:6, desc:'현재 공격력의 105% 피해로 2번 타격한다. 쿨타임 4턴.', cost:1, maxPoints:1, prereq:['mage_fire_focus_v24'], kind:'fire', active:{ name:'대화염구', cooldown:4, type:'damage', hits:2, hitMult:1.05 } },
    mage_fire_ember_v24: { id:'mage_fire_ember_v24', v24:true, classOnly:'mage', specOnly:'화염', name:'불씨 증폭', icon:'💥', line:7, desc:'화염 치명타 감각을 높인다. 지능 +1, 스킬 치명타 데미지 20,40,60% 증가', cost:1, maxPoints:3, prereq:['mage_fireball_v24'], kind:'fire', bonuses:{ 지능:1 }, critDmgBonus:[0,.20,.40,.60], passiveText:'지능 +1 · 스킬 치명타 피해 +20/40/60%p' },
    mage_fire_burst_v24: { id:'mage_fire_burst_v24', v24:true, classOnly:'mage', specOnly:'화염', name:'폭열', icon:'🔥', line:8, desc:'현재 공격력의 90% 피해로 3번 타격한다. 쿨타임 5턴.', cost:1, maxPoints:1, prereq:['mage_fire_ember_v24'], kind:'fire', active:{ name:'폭열', cooldown:5, type:'damage', hits:3, hitMult:0.90 } },
    mage_fire_meteor_v24: { id:'mage_fire_meteor_v24', v24:true, classOnly:'mage', specOnly:'화염', name:'메테오', icon:'🌋', line:9, desc:'현재 공격력의 100% 피해로 4번 타격한다. 쿨타임 6턴.', cost:1, maxPoints:1, prereq:['mage_fire_burst_v24'], kind:'ultimate', active:{ name:'메테오', cooldown:6, type:'damage', hits:4, hitMult:1.00 } },
    // === 사제 공용 ===
    priest_basic_faith: { id:'priest_basic_faith', v24:true, classOnly:'priest', name:'기초 신앙', icon:'📖', line:1, desc:'기초적인 신앙심을 기른다. 정신 +1.', cost:1, maxPoints:3, prereq:[], kind:'root', bonuses:{ 정신:1 }, passiveText:'정신 +1' },
    priest_basic_life: { id:'priest_basic_life', v24:true, classOnly:'priest', name:'신앙의 광채', icon:'✚', line:2, desc:'상대의 공격이 빗나갈 확률이 증가한다. 5,10,15,20,25% 빗나감', cost:1, maxPoints:5, prereq:['priest_basic_faith'], kind:'holy', monsterMissChance:[0,.05,.10,.15,.20,.25], passiveText:'상대 공격 5~25% 빗나감' },
    priest_basic_smite: { id:'priest_basic_smite', v24:true, classOnly:'priest', name:'신앙의 일격', icon:'🌟', line:3, desc:'현재 공격력의 130% 피해, 최대 체력의 15% 회복. 쿨타임 4턴.', cost:1, maxPoints:1, prereq:['priest_basic_life'], kind:'holy', active:{ name:'신앙의 일격', cooldown:4, type:'damage', multiplier:1.3, healMaxPct:.15 } },
    priest_basic_prayer: { id:'priest_basic_prayer', v24:true, classOnly:'priest', name:'기도의 방벽', icon:'🛡️', line:4, desc:'상대에게 공격받으면 5,10,15%만큼 피해를 돌려주고 그만큼 회복한다.', cost:1, maxPoints:3, prereq:['priest_basic_smite'], kind:'guard', reflectPct:[0,.05,.10,.15], passiveText:'피격 시 5/10/15% 반사 및 회복' },
    // === 사제 신성 ===
    priest_holy_focus_v24: { id:'priest_holy_focus_v24', v24:true, classOnly:'priest', specOnly:'신성', name:'신성 집중', icon:'☀️', line:5, desc:'신성의 힘에 집중한다. 정신 +2.', cost:1, maxPoints:5, prereq:['priest_basic_prayer'], kind:'holy', bonuses:{ 정신:2 }, passiveText:'정신 +2' },
    priest_holy_absorb_v24: { id:'priest_holy_absorb_v24', v24:true, classOnly:'priest', specOnly:'신성', name:'빛의 섬광', icon:'✨', line:6, desc:'모든 생존 아군의 체력을 각 대상 최대 체력의 50%만큼 회복한다. 쿨타임 5턴.', cost:1, maxPoints:1, prereq:['priest_holy_focus_v24'], kind:'holy', active:{ name:'빛의 섬광', cooldown:5, type:'healAllies', healMaxPct:.50 } },
    priest_holy_barrier_v24: { id:'priest_holy_barrier_v24', v24:true, classOnly:'priest', specOnly:'신성', name:'신성 보호막', icon:'🛡️', line:7, desc:'최대 체력의 70% 보호막. 쿨타임 5턴.', cost:1, maxPoints:1, prereq:['priest_holy_absorb_v24'], kind:'guard', active:{ name:'신성 보호막', cooldown:5, type:'shield', shieldPct:.70 } },
    priest_holy_grace_v24: { id:'priest_holy_grace_v24', v24:true, classOnly:'priest', specOnly:'신성', name:'치유 숙련', icon:'💫', line:8, desc:'체력을 회복하는 모든 기술들의 효율이 50, 100, 150% 증가한다.', cost:1, maxPoints:3, prereq:['priest_holy_barrier_v24'], kind:'holy', healBoost:[0,.50,1.0,1.5], passiveText:'모든 회복량 +50/100/150%' },
    priest_holy_judgment_v24: { id:'priest_holy_judgment_v24', v24:true, classOnly:'priest', specOnly:'신성', name:'은총의 심판', icon:'✦', line:9, desc:'현재 공격력의 230% 피해를 주고 크게 회복한다. 쿨타임 6턴.', cost:1, maxPoints:1, prereq:['priest_holy_grace_v24'], kind:'ultimate', active:{ name:'은총의 심판', cooldown:6, type:'damageHeal', multiplier:2.3, healRate:.75 } },
    // === 사제 암흑 ===
    priest_shadow_focus_v24: { id:'priest_shadow_focus_v24', v24:true, classOnly:'priest', specOnly:'암흑', name:'암흑 집중', icon:'☾', line:5, desc:'암흑의 힘에 집중한다. 정신 +2. 포인트별 10/15/20/25/30% 확률로 암흑 중첩 데미지만큼 생명력을 회복한다.', cost:1, maxPoints:5, prereq:['priest_basic_prayer'], kind:'shadow', bonuses:{ 정신:2 }, shadowLifestealChance:[0,.10,.15,.20,.25,.30], passiveText:'정신 +2 · 포인트별 10/15/20/25/30% 확률로 암흑 중첩 데미지만큼 생명력 회복' },
    priest_shadow_seed_v24: { id:'priest_shadow_seed_v24', v24:true, classOnly:'priest', specOnly:'암흑', name:'암흑의 씨앗', icon:'🟣', line:6, desc:'120%의 피해와 암흑 4중첩을 쌓는다. 쿨타임 4턴.', cost:1, maxPoints:1, prereq:['priest_shadow_focus_v24'], kind:'shadow', active:{ name:'암흑의 씨앗', cooldown:4, type:'shadowDot', multiplier:1.2, stacks:4 } },
    priest_shadow_mark_v24: { id:'priest_shadow_mark_v24', v24:true, classOnly:'priest', specOnly:'암흑', name:'암흑 낙인', icon:'🌑', line:7, desc:'암흑 7중첩을 적에게 추가한다. 쿨타임 5턴.', cost:1, maxPoints:1, prereq:['priest_shadow_seed_v24'], kind:'shadow', active:{ name:'암흑 낙인', cooldown:5, type:'shadowDot', multiplier:0, stacks:7 } },
    priest_shadow_void_v24: { id:'priest_shadow_void_v24', v24:true, classOnly:'priest', specOnly:'암흑', name:'공허 숙련', icon:'🌌', line:8, desc:'암흑 중첩 피해도 20,40,60% 확률로 치명타로 작용할 수 있게 된다.', cost:1, maxPoints:3, prereq:['priest_shadow_mark_v24'], kind:'shadow', shadowCritChance:[0,.20,.40,.60], passiveText:'암흑 틱 20/40/60% 치명타' },
    priest_shadow_judgment_v24: { id:'priest_shadow_judgment_v24', v24:true, classOnly:'priest', specOnly:'암흑', name:'암흑 심판', icon:'☄️', line:9, desc:'현재 공격력의 260% 피해와 암흑 6중첩, 자신 최대 체력의 30% 회복. 쿨타임 6턴.', cost:1, maxPoints:1, prereq:['priest_shadow_void_v24'], kind:'ultimate', active:{ name:'암흑 심판', cooldown:6, type:'shadowDot', multiplier:2.6, stacks:6, healMaxPct:.30 } },
  };
  Object.assign(V24_SKILLS.mage_frost_focus_v24, {
    desc:'냉기의 흐름에 집중한다. 지능 +1, 모든 공격 주문에 상대를 기절 시킬 확률 7,21,35%',
    bonuses:{ 지능:1 },
    passiveText:'지능 +1 · 공격 주문 기절 7/21/35%',
  });
  Object.assign(V24_SKILLS.mage_frost_lance_v24.active, { multiplier:2.1 });
  V24_SKILLS.mage_frost_lance_v24.desc = '현재 공격력의 210% 피해. 상대를 1턴간 냉기 상태로 만든다. 쿨타임 4턴.';
  Object.assign(V24_SKILLS.mage_frost_mind_v24, {
    desc:'차가운 지능을 얻는다. 지능 +4.', maxPoints:5, bonuses:{ 지능:4 }, passiveText:'지능 +4',
  });
  Object.assign(V24_SKILLS.mage_fire_ember_v24, {
    desc:'화염 치명타 감각을 높인다. 지능 +1, 스킬 치명타 데미지 20,40,60,80,100% 증가',
    maxPoints:5, critDmgBonus:[0,.20,.40,.60,.80,1], passiveText:'지능 +1 · 스킬 치명타 피해 +20/40/60/80/100%p',
  });
  Object.assign(V24_SKILLS.priest_basic_smite.active, { cooldown:5, healMaxPct:.25 });
  V24_SKILLS.priest_basic_smite.desc = '현재 공격력의 130% 피해, 최대 체력의 25% 회복. 쿨타임 5턴.';
  Object.assign(V24_SKILLS.priest_holy_barrier_v24.active, { cooldown:6 });
  V24_SKILLS.priest_holy_barrier_v24.desc = '최대 체력의 70% 보호막. 쿨타임 6턴.';
  Object.assign(V24_SKILLS.priest_holy_judgment_v24.active, { cooldown:8 });
  V24_SKILLS.priest_holy_judgment_v24.desc = '현재 공격력의 230% 피해를 주고 크게 회복한다. 쿨타임 8턴.';
  Object.assign(V24_SKILLS.priest_shadow_void_v24, {
    desc:'암흑 중첩 피해도 20,40,60,80,100% 확률로 치명타로 작용할 수 있게 된다. 정신 +2.',
    maxPoints:5, bonuses:{ 정신:2 }, shadowCritChance:[0,.20,.40,.60,.80,1], passiveText:'정신 +2 · 암흑 틱 20/40/60/80/100% 치명타',
  });

  const V24_LINES = [
    ['warrior_basic_body','warrior_basic_blade'], ['warrior_basic_blade','warrior_basic_guard'], ['warrior_basic_guard','warrior_basic_strike'],
    ['warrior_basic_strike','warrior_def_stance'], ['warrior_def_stance','warrior_def_armor'], ['warrior_def_armor','warrior_def_resist'], ['warrior_def_resist','warrior_def_wall'], ['warrior_def_wall','warrior_def_bastion'],
    ['warrior_basic_strike','warrior_weapon_mastery'], ['warrior_weapon_mastery','warrior_weapon_slash'], ['warrior_weapon_slash','warrior_weapon_rage'], ['warrior_weapon_rage','warrior_weapon_breaker'], ['warrior_weapon_breaker','warrior_weapon_judgment'],
    ['mage_basic_mana','mage_basic_element'], ['mage_basic_element','mage_basic_bolt'], ['mage_basic_bolt','mage_basic_barrier'],
    ['mage_basic_barrier','mage_frost_focus_v24'], ['mage_frost_focus_v24','mage_frost_lance_v24'], ['mage_frost_lance_v24','mage_frost_armor_v24'], ['mage_frost_armor_v24','mage_frost_mind_v24'], ['mage_frost_mind_v24','mage_frost_storm_v24'],
    ['mage_basic_barrier','mage_fire_focus_v24'], ['mage_fire_focus_v24','mage_fireball_v24'], ['mage_fireball_v24','mage_fire_ember_v24'], ['mage_fire_ember_v24','mage_fire_burst_v24'], ['mage_fire_burst_v24','mage_fire_meteor_v24'],
    ['priest_basic_faith','priest_basic_life'], ['priest_basic_life','priest_basic_smite'], ['priest_basic_smite','priest_basic_prayer'],
    ['priest_basic_prayer','priest_holy_focus_v24'], ['priest_holy_focus_v24','priest_holy_absorb_v24'], ['priest_holy_absorb_v24','priest_holy_barrier_v24'], ['priest_holy_barrier_v24','priest_holy_grace_v24'], ['priest_holy_grace_v24','priest_holy_judgment_v24'],
    ['priest_basic_prayer','priest_shadow_focus_v24'], ['priest_shadow_focus_v24','priest_shadow_seed_v24'], ['priest_shadow_seed_v24','priest_shadow_mark_v24'], ['priest_shadow_mark_v24','priest_shadow_void_v24'], ['priest_shadow_void_v24','priest_shadow_judgment_v24'],
  ];

  const V18_SKILL_PATCHES = {
    warrior_final_judgment: {
      id: 'warrior_final_judgment', classOnly: 'warrior', name: '최후의 심판', line: 5,
      desc: '적의 방어를 무색하게 만드는 파괴적인 일격입니다. 현재 공격력의 300% 피해. 적 체력이 20% 이하가 되면 처형합니다. 쿨타임 5턴.',
      cost: 1, maxPoints: 1,
      prereqTotal: { ids: ['warrior_frenzy', 'warrior_regeneration'], points: 2 },
      x: 92, y: 50, kind: 'ultimate',
      active: { name: '최후의 심판', cooldown: 5, type: 'damage', multiplier: 3.0, executePct: 0.2 },
    },
    mage_arcane_focus: { id: 'mage_arcane_focus', classOnly: 'mage', name: '마력 집중', line: 1, desc: '마력을 안정시켜 지능 +1을 얻습니다.', cost: 1, maxPoints: 1, prereq: [], x: 14, y: 50, kind: 'root', bonuses: { 지능: 1 }, passiveText: '지능 +1' },
    mage_ice_lance: { id: 'mage_ice_lance', classOnly: 'mage', name: '얼음창', line: 2, desc: '날카로운 얼음을 발사합니다. 현재 공격력의 150% 피해. 쿨타임 3턴.', cost: 1, maxPoints: 1, prereqPoints: { mage_arcane_focus: 1 }, mutualGroup: 'mage_line2', x: 32, y: 35, kind: 'frost', active: { name: '얼음창', cooldown: 3, type: 'damage', multiplier: 1.5 } },
    mage_fireball: { id: 'mage_fireball', classOnly: 'mage', name: '화염구', line: 2, desc: '불꽃 구체를 날립니다. 현재 공격력의 160% 피해. 쿨타임 3턴.', cost: 1, maxPoints: 1, prereqPoints: { mage_arcane_focus: 1 }, mutualGroup: 'mage_line2', x: 32, y: 65, kind: 'fire', active: { name: '화염구', cooldown: 3, type: 'damage', multiplier: 1.6 } },
    mage_frost_mastery: { id: 'mage_frost_mastery', classOnly: 'mage', name: '서리 숙련', line: 3, desc: '냉기의 흐름을 다룹니다. 포인트당 지능 +1.', cost: 1, maxPoints: 2, prereqAny: ['mage_ice_lance', 'mage_fireball'], x: 52, y: 35, kind: 'frost', bonuses: { 지능: 1 }, passiveText: '지능 +1/점' },
    mage_flame_mastery: { id: 'mage_flame_mastery', classOnly: 'mage', name: '불꽃 숙련', line: 3, desc: '화염 마법의 위력을 높입니다. 포인트당 지능 +1.', cost: 1, maxPoints: 2, prereqAny: ['mage_ice_lance', 'mage_fireball'], x: 52, y: 65, kind: 'fire', bonuses: { 지능: 1 }, passiveText: '지능 +1/점' },
    mage_crystal_barrier: { id: 'mage_crystal_barrier', classOnly: 'mage', name: '수정 보호막', line: 4, desc: '수정 장막을 두릅니다. 최대 체력의 25% 보호막. 쿨타임 4턴.', cost: 1, maxPoints: 1, prereqTotal: { ids: ['mage_frost_mastery', 'mage_flame_mastery'], points: 2 }, x: 74, y: 35, kind: 'guard', active: { name: '수정 보호막', cooldown: 4, type: 'shield', shieldPct: 0.25 } },
    mage_mana_overflow: { id: 'mage_mana_overflow', classOnly: 'mage', name: '마력 과충전', line: 4, desc: '마력이 넘쳐흐릅니다. 지능 +2.', cost: 1, maxPoints: 1, prereqTotal: { ids: ['mage_frost_mastery', 'mage_flame_mastery'], points: 2 }, x: 74, y: 65, kind: 'power', bonuses: { 지능: 2 }, passiveText: '지능 +2' },
    mage_arcane_comet: { id: 'mage_arcane_comet', classOnly: 'mage', name: '비전 혜성', line: 5, desc: '비전의 별빛을 떨어뜨립니다. 현재 공격력의 280% 피해. 쿨타임 5턴.', cost: 1, maxPoints: 1, prereqAny: ['mage_crystal_barrier', 'mage_mana_overflow'], x: 92, y: 50, kind: 'ultimate', active: { name: '비전 혜성', cooldown: 5, type: 'damage', multiplier: 2.8 } },
    priest_faith: { id: 'priest_faith', classOnly: 'priest', name: '깊은 믿음', line: 1, desc: '마음을 단련해 정신 +1을 얻습니다.', cost: 1, maxPoints: 1, prereq: [], x: 14, y: 50, kind: 'root', bonuses: { 정신: 1 }, passiveText: '정신 +1' },
    priest_holy_light: { id: 'priest_holy_light', classOnly: 'priest', name: '신성한 빛', line: 2, desc: '빛으로 회복합니다. 잃은 체력의 30% 회복. 쿨타임 3턴.', cost: 1, maxPoints: 1, prereqPoints: { priest_faith: 1 }, mutualGroup: 'priest_line2', x: 32, y: 35, kind: 'holy', active: { name: '신성한 빛', cooldown: 3, type: 'healBuff', healLostPct: 0.3 } },
    priest_shadow_bolt: { id: 'priest_shadow_bolt', classOnly: 'priest', name: '암흑의 화살', line: 2, desc: '암흑의 힘을 쏘아냅니다. 현재 공격력의 150% 피해. 쿨타임 3턴.', cost: 1, maxPoints: 1, prereqPoints: { priest_faith: 1 }, mutualGroup: 'priest_line2', x: 32, y: 65, kind: 'shadow', active: { name: '암흑의 화살', cooldown: 3, type: 'damage', multiplier: 1.5 } },
    priest_blessing: { id: 'priest_blessing', classOnly: 'priest', name: '축복 숙련', line: 3, desc: '아군을 지키는 힘을 배웁니다. 포인트당 체력 +1.', cost: 1, maxPoints: 2, prereqAny: ['priest_holy_light', 'priest_shadow_bolt'], x: 52, y: 35, kind: 'holy', bonuses: { 체력: 1 }, passiveText: '체력 +1/점' },
    priest_dark_focus: { id: 'priest_dark_focus', classOnly: 'priest', name: '암흑 집중', line: 3, desc: '암흑의 힘을 정제합니다. 포인트당 정신 +1.', cost: 1, maxPoints: 2, prereqAny: ['priest_holy_light', 'priest_shadow_bolt'], x: 52, y: 65, kind: 'shadow', bonuses: { 정신: 1 }, passiveText: '정신 +1/점' },
    priest_guardian_prayer: { id: 'priest_guardian_prayer', classOnly: 'priest', name: '수호 기도', line: 4, desc: '기도로 보호막을 얻습니다. 최대 체력의 25% 보호막. 쿨타임 4턴.', cost: 1, maxPoints: 1, prereqTotal: { ids: ['priest_blessing', 'priest_dark_focus'], points: 2 }, x: 74, y: 35, kind: 'guard', active: { name: '수호 기도', cooldown: 4, type: 'shield', shieldPct: 0.25 } },
    priest_void_mark: { id: 'priest_void_mark', classOnly: 'priest', name: '공허의 낙인', line: 4, desc: '적에게 암흑의 낙인을 새깁니다. 현재 공격력의 190% 피해. 쿨타임 4턴.', cost: 1, maxPoints: 1, prereqTotal: { ids: ['priest_blessing', 'priest_dark_focus'], points: 2 }, x: 74, y: 65, kind: 'shadow', active: { name: '공허의 낙인', cooldown: 4, type: 'damage', multiplier: 1.9 } },
    priest_final_grace: { id: 'priest_final_grace', classOnly: 'priest', name: '심판의 은총', line: 5, desc: '빛과 암흑을 함께 불러냅니다. 현재 공격력의 260% 피해. 쿨타임 5턴.', cost: 1, maxPoints: 1, prereqAny: ['priest_guardian_prayer', 'priest_void_mark'], x: 92, y: 50, kind: 'ultimate', active: { name: '심판의 은총', cooldown: 5, type: 'damage', multiplier: 2.6 } },
  };
  const V18_SKILL_LINES = [
    ['warrior_frenzy', 'warrior_final_judgment'], ['warrior_regeneration', 'warrior_final_judgment'],
    ['mage_arcane_focus', 'mage_ice_lance'], ['mage_arcane_focus', 'mage_fireball'],
    ['mage_ice_lance', 'mage_frost_mastery'], ['mage_ice_lance', 'mage_flame_mastery'],
    ['mage_fireball', 'mage_frost_mastery'], ['mage_fireball', 'mage_flame_mastery'],
    ['mage_frost_mastery', 'mage_crystal_barrier'], ['mage_frost_mastery', 'mage_mana_overflow'],
    ['mage_flame_mastery', 'mage_crystal_barrier'], ['mage_flame_mastery', 'mage_mana_overflow'],
    ['mage_crystal_barrier', 'mage_arcane_comet'], ['mage_mana_overflow', 'mage_arcane_comet'],
    ['priest_faith', 'priest_holy_light'], ['priest_faith', 'priest_shadow_bolt'],
    ['priest_holy_light', 'priest_blessing'], ['priest_holy_light', 'priest_dark_focus'],
    ['priest_shadow_bolt', 'priest_blessing'], ['priest_shadow_bolt', 'priest_dark_focus'],
    ['priest_blessing', 'priest_guardian_prayer'], ['priest_blessing', 'priest_void_mark'],
    ['priest_dark_focus', 'priest_guardian_prayer'], ['priest_dark_focus', 'priest_void_mark'],
    ['priest_guardian_prayer', 'priest_final_grace'], ['priest_void_mark', 'priest_final_grace'],
  ];

  const V23_SKILL_OVERRIDES = {
    warrior_defense_stance: { name: '방패 올리기', desc: '방어 전사의 든든한 자세입니다. 최대 체력의 40% 보호막을 얻습니다.', active: { name: '방패 올리기', cooldown: 3, type: 'shield', shieldPct: 0.40 } },
    warrior_charge: { name: '무기 강타', desc: '무기 전사의 강한 일격입니다. 현재 공격력의 170% 피해. 쿨타임 3턴.', active: { name: '무기 강타', cooldown: 3, type: 'damage', multiplier: 1.7 } },
    mage_ice_lance: { name: '빙결 창', desc: '냉기를 담은 얼음창입니다. 피해와 함께 냉기 디버프 확률을 높입니다.', active: { name: '빙결 창', cooldown: 3, type: 'damage', multiplier: 1.45, forceChill: true } },
    mage_fireball: { name: '대화염구', desc: '화염 전문화에 어울리는 강력한 불꽃입니다. 현재 공격력의 175% 피해.', active: { name: '대화염구', cooldown: 3, type: 'damage', multiplier: 1.75 } },
    priest_holy_light: { name: '흡수의 빛', desc: '적에게 피해를 주고 자신의 HP를 회복합니다.', active: { name: '흡수의 빛', cooldown: 3, type: 'damageHeal', multiplier: 1.35, healRate: 0.60 } },
    priest_shadow_bolt: { name: '암흑의 씨앗', desc: '암흑 중첩을 심어 매턴 피해를 줍니다.', active: { name: '암흑의 씨앗', cooldown: 3, type: 'shadowDot', multiplier: 1.25, stacks: 2 } },
    priest_void_mark: { name: '암흑 낙인', desc: '강한 피해와 함께 암흑 중첩을 크게 심습니다.', active: { name: '암흑 낙인', cooldown: 4, type: 'shadowDot', multiplier: 1.8, stacks: 3 } },
  };

  const defaultQuestions = [
    { id: uid(), zone: 'silent_forest', q: '3 + 4 = ?', answer: '7', source: '기본' },
    { id: uid(), zone: 'silent_forest', q: '10 - 6 = ?', answer: '4', source: '기본' },
    { id: uid(), zone: 'silent_forest', q: '2 × 5 = ?', answer: '10', source: '기본' },
    { id: uid(), zone: 'silent_forest', q: '63월드의 시작 마을 이름은?', answer: '63마을', source: '기본' },
    { id: uid(), zone: 'silent_forest', q: '18 ÷ 3 = ?', answer: '6', source: '기본' },
    { id: uid(), zone: 'desert_wasteland', q: '12 × 3 = ?', answer: '36', source: '기본' },
    { id: uid(), zone: 'desert_wasteland', q: '45 ÷ 5 = ?', answer: '9', source: '기본' },
    { id: uid(), zone: 'desert_wasteland', q: '황량한 사막의 두 번째 몬스터 이름은?', answer: '스네이크', source: '기본' },
  ];

  const defaultWorkbooks = [
    {
      id: 'wb_basic_math',
      name: '문제집1 - 고요한 숲 기본 수학 세트',
      zone: 'silent_forest',
      subject: '수학',
      prompt: '기본 문제',
      createdAt: Date.now(),
      questions: defaultQuestions.filter((q) => q.zone === 'silent_forest').map((q) => ({ ...q, workbookId: 'wb_basic_math' })),
    },
    {
      id: 'wb_desert_basic',
      name: '문제집2 - 황량한 사막 기본 문제 세트',
      zone: 'desert_wasteland',
      subject: '수학',
      prompt: '사막 문제',
      createdAt: Date.now(),
      questions: defaultQuestions.filter((q) => q.zone === 'desert_wasteland').map((q) => ({ ...q, workbookId: 'wb_desert_basic' })),
    },
  ];

  const appearancePools = {
    shirt: ['#ef4444', '#f97316', '#facc15', '#22c55e', '#38bdf8', '#6366f1', '#a855f7', '#ec4899'],
    pants: ['#111827', '#334155', '#475569', '#1e3a8a', '#14532d', '#713f12', '#7c2d12'],
    hair: ['#0f172a', '#3f2d20', '#6b3f22', '#d97706', '#f5deb3', '#e5e7eb', '#7c2d12'],
    hairStyle: ['short', 'crop', 'spiky', 'sidePart', 'buzz', 'shortWave', 'bob', 'long', 'ponytail', 'twinTail', 'curlyBob', 'curlyLong'],
    skin: ['#f1d2b6', '#fff1df', '#b8784e'],
    accessory: ['none'],
  };

  const worldDefs = {
    town: {
      key: 'town',
      label: '63마을',
      width: 2400,
      height: 1800,
      playerSpawn: { x: 1190, y: 1060 },
      portal: { x: 1200, y: 930, r: 94 },
      npc: { x: 1338, y: 842, r: 26, name: '명진쌤' },
      shop: { x: 700, y: 650, w: 260, h: 200, name: '장비상점', doorX: 700, doorY: 760 },
      buildingShop: { x: 1660, y: 980, w: 270, h: 210, name: '특별 상점', doorX: 1660, doorY: 1100 },
      hall: { x: 1200, y: 500, w: 300, h: 220, name: '명예의 전당' },
    },
    forest: {
      key: 'forest',
      label: 'Lv.1 고요한 숲',
      width: 3200,
      height: 2200,
      playerSpawn: { x: 360, y: 1820 },
      zoneKey: 'silent_forest',
    },
    desert: {
      key: 'desert',
      label: 'Lv.4 황량한 사막',
      width: 3400,
      height: 2300,
      playerSpawn: { x: 420, y: 1880 },
      zoneKey: 'desert_wasteland',
    },
    equipmentShop: {
      key: 'equipmentShop',
      label: '장비상점 내부',
      width: 1600,
      height: 1000,
      playerSpawn: { x: 800, y: 820 },
      exit: { x: 800, y: 910, r: 70 },
      genie: { x: 560, y: 470, r: 42, name: '무기 상인 의석' },
      andre: { x: 1040, y: 470, r: 42, name: '방어구 상인 상미' },
    },
    buildingShopInterior: {
      key: 'buildingShopInterior',
      label: '특별 상점 내부',
      width: 1600,
      height: 1000,
      playerSpawn: { x: 800, y: 820 },
      exit: { x: 800, y: 910, r: 70 },
      saenari: { x: 680, y: 430, r: 42, name: '특별 상인 새나리' },
      sangnam: { x: 920, y: 430, r: 42, name: '옷 상인 상남' },
    },
    bossRoom: {
      key: 'bossRoom',
      label: '보스 방',
      width: 1280,
      height: 720,
      playerSpawn: { x: 520, y: 540 },
      zoneKey: 'silent_forest',
      exit: { x: 410, y: 500, r: 54 },
    },
  };

  global.YuksamData = {
    CLASS_META,
    resolvePlayerBaseStats,
    XP_REQUIREMENTS,
    PLAYER_WORLD_SCALE,
    NPC_WORLD_SCALE,
    STORAGE,
    ITEM_DEFS,
    BUILDING_ITEM_DEFS,
    SKILL_DEFS,
    SKILL_LINES,
    V24_SKILLS,
    V24_LINES,
    V18_SKILL_PATCHES,
    V18_SKILL_LINES,
    V23_SKILL_OVERRIDES,
    defaultQuestions,
    defaultWorkbooks,
    appearancePools,
    worldDefs,
  };
})(window);
