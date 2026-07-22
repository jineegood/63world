/* v55: 코스튬 아이템 — 능력치는 없지만 외형을 바꾸는 치장 장비 (옷 상인 상남 판매) */
(function costumeDataV55() {
  if (window.__COSTUME_DATA_V55__) return;
  window.__COSTUME_DATA_V55__ = true;

  const COSTUME_DEFS = {
    /* ── 머리 3종 ── */
    cs_bunnyBand: {
      id: 'cs_bunnyBand', name: '토끼 머리띠', slot: 'head', classOnly: null, price: 120, costume: true,
      desc: '폭신폭신한 토끼 귀 머리띠. 능력치는 없지만 아주 귀엽습니다.',
      look: { type: 'bunnyEars', color: '#fbcfe8' },
    },
    cs_flowerCrown: {
      id: 'cs_flowerCrown', name: '꽃 화관', slot: 'head', classOnly: null, price: 260, costume: true,
      desc: '봄날의 들꽃을 엮어 만든 화관. 머리 위에 작은 정원이 피어납니다.',
      look: { type: 'flowerCrown', color: '#fda4af' },
    },
    cs_starCrown: {
      id: 'cs_starCrown', name: '별빛 왕관', slot: 'head', classOnly: null, price: 480, costume: true,
      desc: '밤하늘의 별을 담은 왕관. 은은한 별빛이 반짝입니다.',
      look: { type: 'starCrown', color: '#fde68a' },
    },
    /* ── 옷 3종 ── */
    cs_sailorCape: {
      id: 'cs_sailorCape', name: '세일러 교복', slot: 'armor', classOnly: null, price: 150, costume: true,
      desc: '남색 카라와 붉은 스카프, 주름 치마가 한 벌인 세일러 교복.',
      look: { type: 'sailorSuit', color: '#1d4ed8' },
    },
    cs_starryRobe: {
      id: 'cs_starryRobe', name: '별무리 로브', slot: 'armor', classOnly: null, price: 320, costume: true,
      desc: '밤하늘을 그대로 두른 로브. 별이 반짝이고 은하수가 흐릅니다.',
      look: { type: 'starryRobe', color: '#312e81' },
    },
    cs_peachDress: {
      id: 'cs_peachDress', name: '복숭아 드레스', slot: 'armor', classOnly: null, price: 420, costume: true,
      desc: '3단 프릴과 허리 리본이 살랑이는 드레스. 상남의 대표작입니다.',
      look: { type: 'peachDress', color: '#fda4af' },
    },
    /* ── 악세서리 3종 ── */
    cs_ribbon: {
      id: 'cs_ribbon', name: '나비 리본', slot: 'accessory', classOnly: null, price: 100, costume: true,
      desc: '목에 매는 커다란 나비 모양 리본. 살랑살랑 흔들립니다.',
      look: { type: 'butterflyRibbon', color: '#f9a8d4' },
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
