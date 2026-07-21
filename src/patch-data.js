(function initYuksamPatchData(global) {
  const PET_DEFS_V27 = {
    chick: { id:'chick', name:'삐약이', icon:'🐤', desc:'노란 병아리 펫. 총명한 응원으로 지능을 올려줍니다.', stats:{ 지능:5 }, color:'#fde68a', bob:0 },
    miniMushroom: { id:'miniMushroom', name:'미니버섯돌이', icon:'🍄', desc:'작은 버섯돌이 펫. 정신과 체력을 올려줍니다.', stats:{ 정신:3, 체력:3 }, color:'#fca5a5', bob:1 },
    dragon: { id:'dragon', name:'용용이', icon:'🐉', desc:'작은 용 펫. 용감한 기운으로 힘을 올려줍니다.', stats:{ 힘:5 }, color:'#fdba74', bob:2 },
    cat: { id:'cat', name:'냥냥이', icon:'🐱', desc:'고양이 펫. 차분한 집중력으로 정신을 올려줍니다.', stats:{ 정신:5 }, color:'#f9a8d4', bob:3 },
    dog: { id:'dog', name:'멍멍이', icon:'🐶', desc:'강아지 펫. 씩씩한 기운으로 힘과 체력을 올려줍니다.', stats:{ 힘:3, 체력:3 }, color:'#bfdbfe', bob:4 },
    yuksam: { id:'yuksam', name:'육삼이', icon:'🏢', desc:'전설 펫. 눈과 미소를 가진 작은 육삼빌딩이 당신의 곁을 지켜줍니다.', stats:{ 힘:8, 지능:8, 정신:8, 체력:8 }, color:'#fbbf24', bob:6, legendary:true },
  };

  const TIER_INFO_V27 = [
    { name:'일반', cls:'tier-0', color:'#cbd5e1', chance:null },
    { name:'고급', cls:'tier-1', color:'#22c55e', chance:.80 },
    { name:'희귀', cls:'tier-2', color:'#3b82f6', chance:.60 },
    { name:'에픽', cls:'tier-3', color:'#a855f7', chance:.40 },
    { name:'전설', cls:'tier-4', color:'#f59e0b', chance:.20 },
  ];

  const WORLD_PATCHES_V17 = {
    swamp: {
      key: 'swamp',
      label: 'Lv.7 으스스한 늪지',
      width: 3600,
      height: 2400,
      playerSpawn: { x: 500, y: 1980 },
      zoneKey: 'spooky_swamp',
    },
  };

  const WORLD_PATCHES_V21 = {
    finalBossRoom: { key:'finalBossRoom', label:'???', width:1280, height:720, playerSpawn:{x:420,y:520}, zoneKey:'final_void', exit:{x:250,y:540,r:54} },
  };

  const WORLD_PATCHES_V27 = {
    town: {
      petShop: { x: 470, y: 1110, w: 250, h: 190, name: '펫 상점', doorX: 470, doorY: 1214 },
      upgradeShop: { x: 1930, y: 620, w: 260, h: 200, name: '강화 상점', doorX: 1930, doorY: 730 },
    },
    maps: {
      petShopInterior: { key:'petShopInterior', label:'펫 상점 내부', width:1600, height:1000, playerSpawn:{x:800,y:820}, exit:{x:800,y:910,r:70}, orb:{x:800,y:420,r:46,name:'펫 수정구'} },
      upgradeShopInterior: { key:'upgradeShopInterior', label:'강화 상점 내부', width:1600, height:1000, playerSpawn:{x:800,y:820}, exit:{x:800,y:910,r:70}, blacksmith:{x:800,y:430,r:46,name:'강화 장인 도담'} },
    },
  };

  const WORLD_PATCHES_V29 = {
    petShopInterior: {
      key: 'petShopInterior',
      label: '펫 상점 내부',
      width: 1180,
      height: 760,
      playerSpawn: { x: 590, y: 610 },
      exit: { x: 590, y: 684, r: 68 },
      orb: { x: 590, y: 268, r: 48, name: '펫 수정구' },
    },
  };

  const WORLD_PATCHES_V30 = {
    petShopInterior: {
      key: 'petShopInterior',
      label: '펫 상점 내부',
      width: 1180,
      height: 760,
      playerSpawn: { x: 590, y: 610 },
      exit: { x: 590, y: 684, r: 68 },
      orb: { x: 590, y: 268, r: 50, name: '펫 수정구' },
    },
    upgradeShopInterior: {
      key: 'upgradeShopInterior',
      label: '대장간 내부',
      width: 1180,
      height: 760,
      playerSpawn: { x: 590, y: 610 },
      exit: { x: 590, y: 684, r: 68 },
      blacksmith: { x: 590, y: 280, r: 50, name: '대장장이 진명' },
    },
    townUpgradeShopName: '대장간',
  };

  const WORLD_PATCHES_V34 = {
    townUpgradeShop: { x: 1930, y: 620, w: 260, h: 200, name: '대장간', doorX: 1930, doorY: 730 },
    finalBossRoom: {
      key:'finalBossRoom',
      label:'???',
      width:1280,
      height:720,
      playerSpawn:{x:350,y:540},
      exit:{x:180,y:540,r:62},
      teacher:{x:860,y:380,r:54},
      zoneKey:'final_void',
    },
    petShopOrb: { x:590, y:268, r:50, name:'펫 수정구' },
  };

  const WORLD_PATCHES_V35 = {
    finalBossRoom: {
      key:'finalBossRoom',
      label:'???',
      width:1100,
      height:760,
      playerSpawn:{x:260,y:560},
      exit:{x:130,y:560,r:58},
      teacher:{x:780,y:420,r:40},
      zoneKey:'final_void',
    },
  };

  const DUNGEONS_V25 = [
    { key:'forest', level:1, title:'고요한 숲', desc:'버섯돌이와 더 깊은 곳의 Lv.3 슬라임이 등장합니다.', enter:'enterForest()' },
    { key:'desert', level:4, title:'황량한 사막', desc:'스톰프와 스네이크가 등장하는 두 번째 사냥터입니다.', enter:'enterDesert()' },
    { key:'swamp', level:7, title:'으스스한 늪지', desc:'타란툴라와 좀비가 등장하는 세 번째 사냥터입니다.', enter:'enterSwamp()' },
  ];

  global.YuksamPatchData = {
    PET_DEFS_V27,
    TIER_INFO_V27,
    WORLD_PATCHES_V17,
    WORLD_PATCHES_V21,
    WORLD_PATCHES_V27,
    WORLD_PATCHES_V29,
    WORLD_PATCHES_V30,
    WORLD_PATCHES_V34,
    WORLD_PATCHES_V35,
    DUNGEONS_V25,
  };
})(window);
