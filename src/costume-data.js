/* v55: 코스튬 아이템 — 능력치는 없지만 외형을 바꾸는 치장 장비 (옷 상인 상남 판매) */
(function costumeDataV55() {
  if (window.__COSTUME_DATA_V55__) return;
  window.__COSTUME_DATA_V55__ = true;

  const COSTUME_DEFS = {
    cs_questSproutRibbon: {
      id: 'cs_questSproutRibbon', name: '새싹 리본', slot: 'accessory', classOnly: null,
      price: 0, costume: true, questOnly: true,
      desc: '명진쌤의 부탁을 받은 상남이 처음 모험을 축하하며 선물한 초록 리본.',
      look: { type: 'butterflyRibbon', color: '#4ade80' },
    },
    /* ── 머리 9종 ── */
    cs_bunnyBand: {
      id: 'cs_bunnyBand', name: '토끼 머리띠', slot: 'head', classOnly: null, price: 120, costume: true,
      desc: '폭신폭신한 토끼 귀 머리띠. 능력치는 없지만 아주 귀엽습니다.',
      look: { type: 'bunnyEars', color: '#fbcfe8' },
    },
    cs_catBand: {
      id: 'cs_catBand', name: '고양이 머리띠', slot: 'head', classOnly: null, price: 200, costume: true,
      desc: '쫑긋한 고양이 귀와 작은 방울이 달린 머리띠. 움직일 때 귀가 살랑입니다.',
      look: { type: 'catEars', color: '#475569' },
    },
    cs_flowerCrown: {
      id: 'cs_flowerCrown', name: '꽃 화관', slot: 'head', classOnly: null, price: 260, costume: true,
      desc: '봄날의 들꽃을 엮어 만든 화관. 머리 위에 작은 정원이 피어납니다.',
      look: { type: 'flowerCrown', color: '#fda4af' },
    },
    cs_sharkHood: {
      id: 'cs_sharkHood', name: '아기 상어 후드', slot: 'head', classOnly: null, price: 360, costume: true,
      desc: '동그란 눈과 삐죽한 이빨이 얼굴을 감싸는 익살스러운 아기 상어 후드.',
      look: { type: 'sharkHood', color: '#38bdf8' },
    },
    cs_starCrown: {
      id: 'cs_starCrown', name: '별빛 왕관', slot: 'head', classOnly: null, price: 480, costume: true,
      desc: '밤하늘의 별을 담은 왕관. 은은한 별빛이 반짝입니다.',
      look: { type: 'starCrown', color: '#fde68a' },
    },
    cs_violetMagicHat: {
      id: 'cs_violetMagicHat', name: '보랏빛 마법 모자', slot: 'head', classOnly: null, price: 540, costume: true,
      desc: '휘어진 달빛 고깔과 초승달 장식, 별가루가 맴도는 보랏빛 마법 모자.',
      look: { type: 'arcaneMoonHat', color: '#6d28d9' },
    },
    cs_ninjaMask: {
      id: 'cs_ninjaMask', name: '그림자 닌자 복면', slot: 'head', classOnly: null, price: 620, costume: true,
      desc: '눈빛만 드러나는 검은 닌자 복면. 말없이 서 있기만 해도 고수처럼 보입니다.',
      look: { type: 'ninjaMask', color: '#111827' },
    },
    cs_spartanHelm: {
      id: 'cs_spartanHelm', name: '스파르타 투구', slot: 'head', classOnly: null, price: 700, costume: true,
      desc: '붉은 말총 장식과 황동빛 얼굴 가리개가 달린 용맹한 전사 투구.',
      look: { type: 'spartanHelm', color: '#d97706' },
    },
    cs_blackDragonHelm: {
      id: 'cs_blackDragonHelm', name: '흑룡 뿔투구', slot: 'head', classOnly: null, price: 780, costume: true,
      desc: '뒤로 휘어진 쌍뿔과 자줏빛 용안 보석이 박힌 검은 용기사 투구.',
      look: { type: 'blackDragonHelm', color: '#111827' },
    },
    /* ── 옷 9종 ── */
    cs_sailorCape: {
      id: 'cs_sailorCape', name: '세일러 교복', slot: 'armor', classOnly: null, price: 150, costume: true,
      desc: '남색 카라와 붉은 스카프, 주름 치마가 한 벌인 세일러 교복.',
      look: { type: 'sailorSuit', color: '#1d4ed8' },
    },
    cs_cloudHoodie: {
      id: 'cs_cloudHoodie', name: '구름 후드티', slot: 'armor', classOnly: null, price: 230, costume: true,
      desc: '하늘빛 천과 구름 주머니로 만든 포근한 후드티. 둥실둥실 가벼운 기분이 듭니다.',
      look: { type: 'cloudHoodie', color: '#7dd3fc' },
    },
    cs_starryRobe: {
      id: 'cs_starryRobe', name: '별무리 로브', slot: 'armor', classOnly: null, price: 320, costume: true,
      desc: '밤하늘을 그대로 두른 로브. 별이 반짝이고 은하수가 흐릅니다.',
      look: { type: 'starryRobe', color: '#312e81' },
    },
    cs_sharkSuit: {
      id: 'cs_sharkSuit', name: '아기 상어 인형옷', slot: 'armor', classOnly: null, price: 420, costume: true,
      desc: '하얀 배와 통통한 옆지느러미가 달린 파란 상어 인형옷. 육지에서도 첨벙첨벙!',
      look: { type: 'sharkSuit', color: '#38bdf8' },
    },
    cs_peachDress: {
      id: 'cs_peachDress', name: '복숭아 드레스', slot: 'armor', classOnly: null, price: 420, costume: true,
      desc: '3단 프릴과 허리 리본이 살랑이는 드레스. 상남의 대표작입니다.',
      look: { type: 'peachDress', color: '#fda4af' },
    },
    cs_forestFairyCape: {
      id: 'cs_forestFairyCape', name: '숲요정 망토', slot: 'armor', classOnly: null, price: 460, costume: true,
      desc: '겹겹의 나뭇잎과 덩굴 깃, 도토리 브로치로 엮은 살아 있는 숲요정 망토.',
      look: { type: 'forestLeafMantle', color: '#15803d' },
    },
    cs_ninjaSuit: {
      id: 'cs_ninjaSuit', name: '그림자 닌자복', slot: 'armor', classOnly: null, price: 520, costume: true,
      desc: '붉은 허리띠와 교차 끈으로 단단히 여민 검은 닌자복. 발소리까지 작아질 것 같습니다.',
      look: { type: 'ninjaSuit', color: '#111827' },
    },
    cs_spartanArmor: {
      id: 'cs_spartanArmor', name: '스파르타 전투갑옷', slot: 'armor', classOnly: null, price: 640, costume: true,
      desc: '황동 흉갑과 붉은 전투 치마를 갖춘 스파르타식 갑옷. 오늘만큼은 물러서지 않습니다.',
      look: { type: 'spartanArmor', color: '#d97706' },
    },
    cs_blackDragonArmor: {
      id: 'cs_blackDragonArmor', name: '흑룡 비늘갑옷', slot: 'armor', classOnly: null, price: 820, costume: true,
      desc: '검은 용비늘을 겹쳐 만든 갑옷. 어깨 가시와 가슴의 용안 보석이 사납게 빛납니다.',
      look: { type: 'blackDragonArmor', color: '#1f2937' },
    },
    /* ── 악세서리 10종 ── */
    cs_ribbon: {
      id: 'cs_ribbon', name: '나비 리본', slot: 'accessory', classOnly: null, price: 100, costume: true,
      desc: '목에 매는 커다란 나비 모양 리본. 살랑살랑 흔들립니다.',
      look: { type: 'butterflyRibbon', color: '#f9a8d4' },
    },
    cs_goldenBell: {
      id: 'cs_goldenBell', name: '황금 방울 목걸이', slot: 'accessory', classOnly: null, price: 220, costume: true,
      desc: '걸음을 옮길 때마다 맑은 빛이 반짝이는 작은 황금 방울 목걸이.',
      look: { type: 'bellNecklace', color: '#facc15' },
    },
    cs_giantFishPack: {
      id: 'cs_giantFishPack', name: '대왕 생선 등짐', slot: 'accessory', classOnly: null, price: 260, costume: true,
      desc: '방금 잡은 듯 싱싱한 대왕 생선을 등에 멨습니다. 강해 보이는지는 잘 모르겠습니다.',
      look: { type: 'giantFishPack', color: '#38bdf8' },
    },
    cs_duckFloat: {
      id: 'cs_duckFloat', name: '고무 오리 튜브', slot: 'accessory', classOnly: null, price: 340, costume: true,
      desc: '전투 중에도 물놀이 기분을 잃지 않게 해 주는 노란 고무 오리 튜브.',
      look: { type: 'duckFloat', color: '#facc15' },
    },
    cs_sharkBuddy: {
      id: 'cs_sharkBuddy', name: '아기 상어 친구', slot: 'accessory', classOnly: null, price: 380, costume: true,
      desc: '어깨 옆에서 보글보글 물방울을 내뿜으며 헤엄치는 통통한 아기 상어 친구.',
      look: { type: 'sharkBuddy', color: '#38bdf8' },
    },
    cs_angelWing: {
      id: 'cs_angelWing', name: '하얀 줄끈', slot: 'accessory', classOnly: null, price: 380, costume: true,
      desc: '어깨에서 등 뒤로 흘러내리는 하얀 리본 끈. 걸을 때마다 살랑입니다.',
      look: { type: 'ribbonStreamer', color: 'rgba(255,255,255,.96)' },
    },
    cs_strangeWing: {
      id: 'cs_strangeWing', name: '기묘한 날개', slot: 'accessory', classOnly: null, price: 440, costume: true,
      desc: '어디서 온 것인지 알 수 없는 기묘한 날개. 깃털이 층층이 겹쳐 묘한 분위기를 냅니다.',
      look: { type: 'angelWing', color: 'rgba(255,255,255,.96)' },
    },
    cs_rainbowAura: {
      id: 'cs_rainbowAura', name: '무지개 오라', slot: 'accessory', classOnly: null, price: 500, costume: true,
      desc: '발밑에서 일곱 빛깔이 맴도는 화려한 오라.',
      look: { type: 'rainbowAura', color: 'rgba(167,243,208,.55)' },
    },
    cs_twilightBatWing: {
      id: 'cs_twilightBatWing', name: '밤빛 박쥐 날개', slot: 'accessory', classOnly: null, price: 560, costume: true,
      desc: '보랏빛 황혼을 닮은 박쥐 날개. 움직일 때마다 날개 끝이 살짝 펄럭입니다.',
      look: { type: 'batWing', color: '#7c3aed' },
    },
    cs_blackDragonShield: {
      id: 'cs_blackDragonShield', name: '흑룡 가시방패', slot: 'accessory', classOnly: null, price: 740, costume: true,
      desc: '검은 비늘과 보랏빛 가시로 두른 용기사 방패. 중앙의 용안이 사납게 빛납니다.',
      look: { type: 'blackDragonAegis', color: '#18181b' },
    },
  };

  window.COSTUME_DEFS_V55 = COSTUME_DEFS;
  const defs = window.YuksamData?.ITEM_DEFS;
  if (defs) Object.assign(defs, COSTUME_DEFS); // 기존 아이템 조회 경로에 편입
  window.isCostumeItemV55 = function (item) { return !!(item && item.costume); };

  /* 렌더링용 장비 해석: 실제 장비 위에 코스튬을 덮어씀(성능 계산과 무관) */
  window.resolveVisualEquipmentV55 = function (state) {
    const raw = (state && state.equipment) || {};
    const G = (typeof game !== 'undefined' ? game : window.__G);
    const costume = (state && state.costume)
      || ((G && G.player && raw === G.player.equipment) ? G.player.costume : null);
    if (!costume) return raw;
    const applied = Object.entries(costume).filter(function (e) { return !!e[1]; });
    if (!applied.length) return raw;
    const out = Object.assign({}, raw);
    applied.forEach(function (e) { out[e[0]] = e[1]; });
    return out;
  };
})();
