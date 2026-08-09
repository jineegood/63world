const $ = (id) => document.getElementById(id);
const YuksamCore = window.YuksamCore;
if (!YuksamCore) throw new Error('YuksamCore must be loaded before game.js');
const YuksamPlayerStore = window.YuksamPlayerStore;
if (!YuksamPlayerStore) throw new Error('YuksamPlayerStore must be loaded before game.js');
const YuksamStudentAccessV2 = window.YuksamStudentAccessV2;
if (!YuksamStudentAccessV2) throw new Error('YuksamStudentAccessV2 must be loaded before game.js');
const YuksamPvpClient = window.YuksamPvpClient;
if (!YuksamPvpClient) throw new Error('YuksamPvpClient must be loaded before game.js');
const YuksamInputRouter = window.YuksamInputRouter;
if (!YuksamInputRouter) throw new Error('YuksamInputRouter must be loaded before game.js');
const YuksamWorldInteractionRegistry = window.YuksamWorldInteractionRegistry;
if (!YuksamWorldInteractionRegistry) throw new Error('YuksamWorldInteractionRegistry must be loaded before game.js');
const YuksamWorldNavigationRegistry = window.YuksamWorldNavigationRegistry;
if (!YuksamWorldNavigationRegistry) throw new Error('YuksamWorldNavigationRegistry must be loaded before game.js');
const YuksamClickMovement = window.YuksamClickMovement;
if (!YuksamClickMovement) throw new Error('YuksamClickMovement must be loaded before game.js');
const { uid, randomFrom, randomInt, clamp, distance, normalize, escapeHtml, fmtDate } = YuksamCore;
const YuksamData = window.YuksamData;
if (!YuksamData) throw new Error('YuksamData must be loaded before game.js');
const {
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
  defaultQuestions,
  defaultWorkbooks,
  appearancePools,
  worldDefs,
} = YuksamData;
const V24_SKILLS = YuksamData.V24_SKILLS;
const V24_LINES = YuksamData.V24_LINES;
const V18_SKILL_PATCHES = YuksamData.V18_SKILL_PATCHES;
const V18_SKILL_LINES = YuksamData.V18_SKILL_LINES;
const V23_SKILL_OVERRIDES = YuksamData.V23_SKILL_OVERRIDES;
const YuksamQuestData = window.YuksamQuestData;
if (!YuksamQuestData) throw new Error('YuksamQuestData must be loaded before game.js');
const QUEST_DEFS = YuksamQuestData.QUEST_DEFS;
const QUEST_ORDER = YuksamQuestData.QUEST_ORDER;
const YuksamQuestText = window.YuksamQuestText;
if (!YuksamQuestText) throw new Error('YuksamQuestText must be loaded before game.js');
const YuksamPatchData = window.YuksamPatchData;
if (!YuksamPatchData) throw new Error('YuksamPatchData must be loaded before game.js');
const PET_DEFS_V27 = YuksamPatchData.PET_DEFS_V27;
const TIER_INFO_V27 = YuksamPatchData.TIER_INFO_V27;

function getEquippedWeaponTierStyle(player) {
  const weaponId = player?.equipment?.weapon || null;
  const rawTier = weaponId ? Number(player?.weaponUpgrades?.[weaponId] || 0) : 0;
  const tier = Math.max(0, Math.min(4, Math.trunc(Number.isFinite(rawTier) ? rawTier : 0)));
  const info = TIER_INFO_V27[tier] || TIER_INFO_V27[0];
  const classIntensity = { warrior: 0.8, mage: 0.6, priest: 0.6 };
  return {
    weaponId,
    tier,
    name: info?.name || '일반',
    color: info?.color || '#cbd5e1',
    className: tier > 0 ? (info?.cls || `tier-${tier}`) : '',
    intensity: classIntensity[player?.class] || 0.8,
  };
}
window.getEquippedWeaponTierStyle = getEquippedWeaponTierStyle;
const YuksamCombatRules = window.YuksamCombatRules;
if (!YuksamCombatRules) throw new Error('YuksamCombatRules must be loaded before game.js');
const YuksamCombatSequenceController = window.YuksamCombatSequenceController;
if (!YuksamCombatSequenceController) throw new Error('YuksamCombatSequenceController must be loaded before game.js');
const YuksamCombatFx = window.YuksamCombatFx;
if (!YuksamCombatFx) throw new Error('YuksamCombatFx must be loaded before game.js');
const {
  WORLD_PATCHES_V17,
  WORLD_PATCHES_V21,
  WORLD_PATCHES_V27,
  WORLD_PATCHES_V29,
  WORLD_PATCHES_V30,
  WORLD_PATCHES_V34,
  WORLD_PATCHES_V35,
  DUNGEONS_V25,
} = YuksamPatchData;

const screens = {
  landing: $('landing'),
  creator: $('creator'),
  game: $('game'),
};

/* Character names use visual width instead of raw string length.
   One Hangul/CJK glyph is about as wide as two Latin letters, so both
   "한글 7자" and "English14Chars" fit the same nameplate budget. */
const CHARACTER_NAME_MAX_VISUAL_UNITS = 14;
const CHARACTER_NAME_LIMIT_MESSAGE = '이름은 한글 최대 7자 또는 영문 최대 14자까지 사용할 수 있어요.';

function characterNameVisualUnits(value) {
  const normalized = String(value ?? '').normalize('NFC');
  return [...normalized].reduce((total, character) => {
    if (/\p{Mark}/u.test(character)) return total;
    if (/[\p{Script=Latin}0-9 _.'-]/u.test(character)) return total + 1;
    return total + 2;
  }, 0);
}

function validateCharacterName(value) {
  const name = String(value ?? '').trim().normalize('NFC');
  if (!name) {
    return Object.freeze({ ok:false, name:'', units:0, message:'캐릭터 이름을 입력하세요.' });
  }
  const units = characterNameVisualUnits(name);
  if (units > CHARACTER_NAME_MAX_VISUAL_UNITS) {
    return Object.freeze({
      ok:false,
      name,
      units,
      message:CHARACTER_NAME_LIMIT_MESSAGE,
    });
  }
  return Object.freeze({ ok:true, name, units, message:'' });
}

window.YuksamCharacterNameRules = Object.freeze({
  maxVisualUnits:CHARACTER_NAME_MAX_VISUAL_UNITS,
  message:CHARACTER_NAME_LIMIT_MESSAGE,
  visualUnits:characterNameVisualUnits,
  validate:validateCharacterName,
});

const secureStudentAccess = YuksamStudentAccessV2.create({
  config:window.YUKSAM_CLOUD || {},
  clientFactory:window.YuksamSupabaseClient?.createClient,
  authApi:window.YuksamAuthV2,
  cloudApi:window.YuksamCloudSyncV2,
  sharedApi:window.YuksamSharedStateV2,
  storage:localStorage,
  authStorage:window.sessionStorage,
  defaultWorkbooks,
});
window.secureStudentAccessV2 = secureStudentAccess;
let pvpClientV1 = null;
window.getPvpIdentityV1 = () => secureStudentAccess.getIdentity();
window.getPvpClientV1 = () => {
  const client = secureStudentAccess.getClient();
  const identity = secureStudentAccess.getIdentity();
  if (!client || !identity) return null;
  if (!pvpClientV1) {
    pvpClientV1 = YuksamPvpClient.create({
      client,
      getIdentity:() => secureStudentAccess.getIdentity(),
    });
  }
  return pvpClientV1;
};
function closePvpClientV1() {
  window.stopPvpUiV1?.();
  pvpClientV1?.close();
  pvpClientV1 = null;
}

const game = {
  canvas: $('gameCanvas'),
  ctx: $('gameCanvas').getContext('2d'),
  previewCanvas: $('previewCanvas'),
  previewCtx: $('previewCanvas').getContext('2d'),
  splashCanvas: $('splashCanvas'),
  splashCtx: $('splashCanvas').getContext('2d'),
  width: $('gameCanvas').width,
  height: $('gameCanvas').height,
  camera: { x: 0, y: 0 },
  player: null,
  keys: {},
  currentName: '',
  currentPassword: '',
  selectedClass: 'warrior',
  currentAppearance: randomAppearance(),
  currentMap: 'town',
  lastMove: { x: 0, y: 1 },
  interactionHint: '포탈과 NPC에 가까이 가면 E로 상호작용',
  attackTimer: 0,
  danceTimer: 0,
  modalState: { type: null, pause: false },
  currentQuestion: null,
  currentCombatMonsterId: null,
  lastTick: 0,
  forestMonsters: [],
  dialogue: { page: 0, selected: 0, mode: 'base' },
  currentCombatAction: null,
  combatShield: 0,
  settings: window.YuksamAudioDefaults.defaultSettings(),
  audio: { ctx: null, master: null, bgmGain: null, bgmTimer: null, started: false, file: null, fileGain: 0 },
  combatHpDisplay: null,
  combatIntroUntil: 0,
  combatImpact: null,
  stagePortals: {},
  chatMessages: [],
  combatStatuses: {},
  transitionLock: 0,
  clickMovement: null,
};
window.getYuksamAudioSettings = () => game.settings;
window.shouldShowPvpTutorialV1 = () => !!game.player && !game.player.pvpTutorialSeen;
window.markPvpTutorialSeenV1 = () => {
  if (!game.player || game.player.pvpTutorialSeen) return;
  game.player.pvpTutorialSeen = true;
  savePlayer();
};

if (secureStudentAccess.enabled) {
  window.addEventListener('load', () => {
    secureStudentAccess.refreshClassroomSettings().catch(() => {});
    secureStudentAccess.startSharedPolling({
      onClassroomChange(open) {
        if (open || !game.player) return;
        try { savePlayer(); } catch (_) {}
        closePvpClientV1();
        secureStudentAccess.signOut().catch(() => {});
        game.player = null;
        game.currentMap = 'town';
        showScreen('landing');
        toast('선생님이 서버를 닫았어요. 다음 수업 시간에 다시 만나요!');
      },
    });
  });
}

function showScreen(name) {
  if (name !== 'game') window.cancelClickMovementV1?.({ clearArrivalLock:true });
  Object.values(screens).forEach((s) => s.classList.remove('active'));
  screens[name].classList.add('active');
  const settingsBtn = $('settingsBtn');
  if (settingsBtn) settingsBtn.classList.toggle('hidden', name === 'game');
  syncAudioFileBgm?.();
}

function showLoadingTransition(message, callback) {
  const overlay = $('loadingOverlay');
  const text = $('loadingText');
  if (!overlay) { callback?.(); return; }
  const previousModalState = { ...game.modalState };
  game.transitionLock = Date.now() + 2600;
  game.modalState = { type: 'loading', pause: true };
  if (text) text.textContent = message || '63월드로 이동중입니다.';
  overlay.classList.remove('hidden', 'leaving');
  overlay.classList.add('visible');
  playSfx('transition');
  setTimeout(() => {
    callback?.();
    // 콜백 내부에서 closeModal()이 호출되더라도 로딩이 끝날 때까지 월드 업데이트를 정지합니다.
    game.modalState = { type: 'loading', pause: true };
    overlay.classList.add('leaving');
    setTimeout(() => {
      overlay.classList.add('hidden');
      overlay.classList.remove('visible', 'leaving');
      if (game.modalState.type === 'loading') game.modalState = previousModalState.pause ? previousModalState : { type: null, pause: false };
    }, 720);
  }, 1200);
}

function showCinematicMessage(title, sub = '', ms = 1200) {
  const overlay = $('cinematicOverlay');
  if (!overlay) return;
  const pauseGame = screens.game.classList.contains('active');
  if (pauseGame) game.modalState = { type: 'cinematic', pause: true };
  $('cinematicTitle').textContent = title;
  $('cinematicSub').textContent = sub;
  overlay.classList.remove('hidden', 'leaving');
  overlay.classList.add('visible');
  setTimeout(() => overlay.classList.add('leaving'), Math.max(500, ms - 450));
  setTimeout(() => {
    overlay.classList.add('hidden');
    overlay.classList.remove('visible', 'leaving');
    if (game.modalState.type === 'cinematic') game.modalState = { type: null, pause: false };
  }, ms);
}

let rewardSequenceTokenV2 = 0;
function showRewardSequenceV2(title, prefix, reward = {}, options = {}) {
  const token = ++rewardSequenceTokenV2;
  const labels = {
    exp:(amount) => amount > 0 ? `EXP +${amount}` : 'EXP 없음',
    gold:(amount) => `Gold +${amount}`,
    building:(amount) => `빌딩 +${amount}`,
  };
  let overlay = $('rewardSequenceV2');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'rewardSequenceV2';
    overlay.className = 'reward-sequence-v2 hidden';
    document.body.appendChild(overlay);
  }
  const steps = YuksamGameplayPolishV2.rewardSteps(reward, options);
  steps.forEach((step) => {
    setTimeout(() => {
      if (token !== rewardSequenceTokenV2) return;
      overlay.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(prefix)} · ${escapeHtml(labels[step.kind](step.amount))}</span>`;
      overlay.classList.remove('hidden');
      overlay.classList.remove('reward-tone-exp', 'reward-tone-gold', 'reward-tone-building');
      overlay.classList.add(`reward-tone-${step.tone}`);
      overlay.classList.remove('reward-pop-v2');
      void overlay.offsetWidth;
      overlay.classList.add('reward-pop-v2');
      playSfx(step.sfx);
    }, step.delayMs);
  });
  const lastDelay = steps.at(-1)?.delayMs || 0;
  const lastDuration = steps.at(-1)?.durationMs || 1000;
  setTimeout(() => {
    if (token === rewardSequenceTokenV2) overlay.classList.add('hidden');
  }, lastDelay + lastDuration);
}

function appendChatMessage(type, sender, message) {
  const msg = { type, sender, message, at: Date.now() };
  game.chatMessages.push(msg);
  if (game.chatMessages.length > 80) game.chatMessages.shift();
  const box = $('chatMessages');
  if (!box) return;
  const row = document.createElement('div');
  row.className = 'chat-line ' + (type || 'system');
  row.innerHTML = `<b>${escapeHtml(sender || '시스템')}</b> <span>${escapeHtml(message)}</span>`;
  box.appendChild(row);
  while (box.children.length > 80) box.removeChild(box.firstChild);
  box.scrollTop = box.scrollHeight;
}

function sendChatMessage() {
  const input = $('chatInput');
  if (!input || !game.player) return;
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  appendChatMessage('user', game.player.name, text);
  game.speechBubble = { text, until: Date.now() + 4200 };
  try { window.__mpBroadcastChatV53?.(text); } catch {} // [v53] 다른 학생에게 채팅 전달
}

function toast(msg, ms = 1800) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.add('hidden'), ms);
}

function openModal(html, options = {}) {
  window.cancelClickMovementV1?.();
  $('modalContent').innerHTML = html;
  $('modal').classList.remove('hidden');
  game.modalState = { type: options.type || null, pause: !!options.pause };
}
function closeModal() {
  if (game.modalState?.type === 'combat') {
    if (typeof window.clearCombatImpactV44 === 'function') window.clearCombatImpactV44();
    else game.combatImpact = null;
    if (typeof window.invalidateCombatSequenceV42 === 'function') window.invalidateCombatSequenceV42();
    else {
      YuksamCombatFx.cancelAllCombatFx();
      game.combatSequenceGeneration = (Number(game.combatSequenceGeneration) || 0) + 1;
      game.combatSequenceActive = false;
    }
  }
  $('modal').classList.add('hidden');
  $('modalContent').innerHTML = '';
  game.modalState = { type: null, pause: false };
}
function isPaused() { return game.modalState.pause; }

function randomAppearance() {
  return {
    shirt: randomFrom(appearancePools.shirt),
    pants: randomFrom(appearancePools.pants),
    hair: randomFrom(appearancePools.hair),
    hairStyle: randomFrom(appearancePools.hairStyle),
    skin: randomFrom(appearancePools.skin),
    accessory: randomFrom(appearancePools.accessory),
  };
}

const playerStore = YuksamPlayerStore.create({ storage:localStorage, prefix:STORAGE.playerPrefix, normalizePlayer });

function playerKey(name) { return playerStore.key(name); }

function normalizeWorkbook(wb, idx = 0) {
  const id = wb.id || ('wb_' + uid());
  return {
    id,
    name: wb.name || `문제집${idx + 1}`,
    zone: wb.zone || 'silent_forest',
    subject: wb.subject || '미분류',
    prompt: wb.prompt || '직접 생성',
    enabled: wb.enabled !== false, // [활성 문제집] 출제 켜기/끄기 (정규화에서 보존)
    createdAt: wb.createdAt || Date.now(),
    questions: Array.isArray(wb.questions) ? wb.questions.map((q) => ({
      id: q.id || uid(),
      workbookId: id,
      zone: q.zone || wb.zone || 'silent_forest',
      q: q.q || q.question || '문제 내용 없음',
      answer: String(q.answer ?? ''),
      choices: Array.isArray(q.choices) ? q.choices.map(String) : (Array.isArray(q.options) ? q.options.map(String) : null),
      source: q.source || wb.name || '문제집',
    })) : [],
  };
}

function readWorkbookStorage() {
  const raw = localStorage.getItem(STORAGE.workbooks);
  if (raw === null) return { status: 'absent', workbooks: null };
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { status: 'valid', workbooks: parsed.map(normalizeWorkbook) };
  } catch {}
  return { status: 'corrupt', workbooks: null };
}

function getWorkbooks() {
  if (secureStudentAccess.enabled) {
    return JSON.parse(JSON.stringify(secureStudentAccess.getWorkbooks()));
  }
  const stored = readWorkbookStorage();
  if (stored.status === 'valid') return stored.workbooks;
  if (stored.status === 'corrupt') return defaultWorkbooks.map(normalizeWorkbook);

  // v2 문제 목록을 v3 문제집 구조로 자동 마이그레이션
  let migratedQuestions = null;
  const oldRaw = localStorage.getItem(STORAGE.questions);
  if (oldRaw) {
    try {
      const parsed = JSON.parse(oldRaw);
      if (Array.isArray(parsed) && parsed.length) migratedQuestions = parsed;
    } catch {}
  }

  const initial = migratedQuestions ? [{
    id: 'wb_migrated_' + Date.now(),
    name: '문제집1 - 기존 등록 문제 세트',
    zone: 'silent_forest',
    subject: '마이그레이션',
    prompt: '이전 버전 등록 문제',
    createdAt: Date.now(),
    questions: migratedQuestions,
  }] : defaultWorkbooks;
  const normalized = initial.map(normalizeWorkbook);
  localStorage.setItem(STORAGE.workbooks, JSON.stringify(normalized));
  return normalized;
}

function saveWorkbooks(workbooks) {
  if (secureStudentAccess.enabled) {
    secureStudentAccess.setLocalWorkbooks(workbooks.map(normalizeWorkbook));
    return;
  }
  localStorage.setItem(STORAGE.workbooks, JSON.stringify(workbooks.map(normalizeWorkbook)));
}

function getQuestions() {
  return getWorkbooks().flatMap((wb) => wb.questions.map((q) => ({ ...q, workbookId: wb.id, workbookName: wb.name, zone: q.zone || wb.zone })));
}

function getWorkbookById(id) {
  return getWorkbooks().find((wb) => wb.id === id) || null;
}

function getAllPlayers() {
  const list = playerStore.list();
  list.sort((a, b) => b.exp - a.exp || b.level - a.level || b.gold - a.gold || b.building - a.building || a.name.localeCompare(b.name, 'ko'));
  return list;
}

function savePlayer() {
  if (!game.player) return;
  game.player.updatedAt = Date.now();
  if (secureStudentAccess.enabled) {
    secureStudentAccess.savePlayer(game.player);
    return;
  }
  playerStore.write(game.player);
}

window.applyAuthoritySnapshotFromServerV3 = function applyAuthoritySnapshotFromServerV3(snapshot) {
  if (!game.player || !snapshot || typeof snapshot !== 'object') return false;
  const beforeLevel = Math.max(1, Number(game.player.level) || 1);
  const safeInteger = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : fallback;
  };
  game.player.exp = safeInteger(snapshot.exp, game.player.exp);
  game.player.level = Math.max(1, Math.min(10, safeInteger(snapshot.level, game.player.level)));
  game.player.skillPoints = safeInteger(snapshot.skillPoints, game.player.skillPoints);
  game.player.gold = safeInteger(snapshot.gold, game.player.gold);
  game.player.building = safeInteger(snapshot.building, game.player.building);
  game.player.raidRewardVersion = Math.min(7, safeInteger(
    snapshot.raidRewardVersion,
    safeInteger(game.player.raidRewardVersion, 0),
  ));
  ensurePlayerHp();
  if (snapshot.fullyHealed) {
    game.player.hp = game.player.maxHp;
  } else {
    game.player.hp = Math.min(game.player.maxHp, safeInteger(snapshot.hp, game.player.hp));
  }
  const gainedLevels = Math.max(0, game.player.level - beforeLevel);
  if (gainedLevels > 0) {
    triggerLevelUpEffect(gainedLevels);
    if (game.player.level >= 5 && !game.player.spec) setTimeout(openSpecModal, 1800);
  }
  updateHud();
  savePlayer();
  return true;
};

function savePlayerRecord(player) { return playerStore.write(player); }

function deletePlayer(name) {
  playerStore.remove(name);
}

function readPlayerStorage(name) {
  return playerStore.read(name);
}

function loadPlayer(name) {
  return playerStore.load(name);
}

function normalizePlayer(p) {
  const klass = p.class && CLASS_META[p.class] ? p.class : 'warrior';
  const combatStatuses = YuksamCombatRules.normalizeCombatStatuses({
    ...(p.combatStatuses || {}),
    chillTurns: p.combatStatuses?.chillTurns ?? p.chillTurns,
    chilledTurns: p.combatStatuses?.chilledTurns ?? p.chilledTurns,
    weakenTurns: p.combatStatuses?.weakenTurns ?? p.weakenTurns,
  });
  const normalized = {
    name: p.name || '이름없음',
    class: klass,
    baseStatsVersion: Number(p.baseStatsVersion) || 0,
    spec: p.spec === '분노' ? '무기' : (p.spec || null),
    level: Number(p.level) || 1,
    exp: Number(p.exp) || 0,
    gold: Number(p.gold) || 0,
    building: Number(p.building) || 0,
    hp: Number(p.hp) || 0,
    maxHp: Number(p.maxHp) || 0,
    appearance: {
      shirt: p.appearance?.shirt || '#38bdf8',
      pants: p.appearance?.pants || '#334155',
      hair: p.appearance?.hair || '#3f2d20',
      hairStyle: p.appearance?.hairStyle || 'short',
      skin: p.appearance?.skin || '#f1d2b6',
      accessory: (p.appearance?.accessory === 'glasses' ? 'none' : (p.appearance?.accessory || 'none')),
    },
    x: Number(p.x) || worldDefs.town.playerSpawn.x,
    y: Number(p.y) || worldDefs.town.playerSpawn.y,
    map: p.map || 'town',
    bossReturnMap: typeof p.bossReturnMap === 'string' ? p.bossReturnMap : null,
    costume: (p.costume && typeof p.costume === 'object' && !Array.isArray(p.costume)) ? { ...p.costume } : {},
    costumeInventory: Array.isArray(p.costumeInventory) ? [...p.costumeInventory] : [],
    inventory: Array.isArray(p.inventory) ? p.inventory : [],
    pets: Array.isArray(p.pets) ? p.pets : [],
    activePet: typeof p.activePet === 'string' ? p.activePet : null,
    equipment: p.equipment || {},
    weaponUpgrades: p.weaponUpgrades && typeof p.weaponUpgrades === 'object' ? { ...p.weaponUpgrades } : {},
    quests: p.quests || {},
    skills: p.skills || {},
    skillCooldowns: p.skillCooldowns || {},
    /* PVP 안내는 계정 전체가 아니라 이 캐릭터가 처음 다른 학생을 눌렀을 때만
       한 번 보여 준다. 정규화 뒤에도 보존해야 재접속할 때 다시 뜨지 않는다. */
    pvpTutorialSeen: p.pvpTutorialSeen === true,
    combatStatuses,
    skillPoints: Number.isFinite(Number(p.skillPoints)) ? Number(p.skillPoints) : Math.max(0, (Number(p.level) || 1) - 1),
    /* 63빌딩 던전에서 완료한 가장 높은 구간. 로그인 정리 과정에서도
       반드시 보존해야 다음 구간 해금이 서버 저장에서 사라지지 않는다. */
    raidTopGroup: Math.max(0, Math.min(7, Math.trunc(Number(p.raidTopGroup ?? p.raid_top_group) || 0))),
    /* 서버가 지급한 던전 최초 보상을 늦게 도착한 옛 저장이 덮지 못하게 하는
       영수증 버전. 일반 저장에서도 보존되어야 서버가 최신 저장을 구분한다. */
    raidRewardVersion: Math.max(0, Math.min(7, Math.trunc(Number(p.raidRewardVersion) || 0))),
    updatedAt: p.updatedAt || Date.now(),
    records: (function(){
      const r = p.records || {};
      return {
        answered: Number(r.answered) || 0,
        correct: Number(r.correct) || 0,
        wrongLog: Array.isArray(r.wrongLog) ? r.wrongLog.slice(-30) : [],
      };
    })(),
  };
  if (!secureStudentAccess.enabled) normalized.password = String(p.password || '1234');
  const classWeapon = defaultWeaponIdForClass(klass);
  if (!normalized.equipment.weapon) normalized.equipment.weapon = classWeapon;
  if (!normalized.inventory.includes(classWeapon)) normalized.inventory.unshift(classWeapon);
  if (!normalized.equipment.head) normalized.equipment.head = null;
  if (!normalized.equipment.accessory) normalized.equipment.accessory = null;
  if (!normalized.equipment.armor) normalized.equipment.armor = null;
  normalized.level = computeLevelFromExp(normalized.exp);
  const baseHp = maxHpForPlayer(normalized);
  normalized.maxHp = normalized.maxHp || baseHp;
  if (!normalized.hp || normalized.hp > normalized.maxHp) normalized.hp = normalized.maxHp;
  return normalized;
}

function defaultWeaponIdForClass(klass) {
  if (klass === 'warrior') return 'training_greatsword';
  if (klass === 'mage') return 'training_staff';
  return 'training_book';
}

function getItemDefinition(itemId, playerClass = null) {
  if (ITEM_DEFS[itemId]) return ITEM_DEFS[itemId];
  if (itemId === 'training_greatsword') return { id: itemId, name: '훈련용 목검', slot: 'weapon', classOnly: 'warrior', price: 0, desc: '기본 장비. 힘 +1', stats: { 힘: 1 }, visual: 'woodSword' };
  if (itemId === 'training_staff') return { id: itemId, name: '견습생 지팡이', slot: 'weapon', classOnly: 'mage', price: 0, desc: '기본 장비. 지능 +1', stats: { 지능: 1 } };
  if (itemId === 'training_book') return { id: itemId, name: '수련용 성서', slot: 'weapon', classOnly: 'priest', price: 0, desc: '기본 장비. 정신 +1', stats: { 정신: 1 } };
  if (playerClass) return getItemDefinition(defaultWeaponIdForClass(playerClass));
  return null;
}

function createNewPlayer(name) {
  const klass = game.selectedClass;
  const defaultWeapon = defaultWeaponIdForClass(klass);
  return normalizePlayer({
    name,
    ...(secureStudentAccess.enabled ? {} : { password:game.currentPassword }),
    class: klass,
    baseStatsVersion: 2,
    spec: null,
    level: 1,
    exp: 0,
    gold: 20,
    building: 0,
    hp: 0,
    maxHp: 0,
    appearance: { ...game.currentAppearance },
    map: 'town',
    x: worldDefs.town.playerSpawn.x,
    y: worldDefs.town.playerSpawn.y,
    inventory: [defaultWeapon],
    equipment: { weapon: defaultWeapon, head: null, accessory: null, armor: null },
    quests: {},
    skills: {},
    skillCooldowns: {},
    skillPoints: 0,
    raidTopGroup: 0,
    raidRewardVersion: 0,
    updatedAt: Date.now(),
  });
}

function computeLevelFromExp(exp) {
  const value = Number(exp) || 0;
  let level = 1;
  Object.keys(XP_REQUIREMENTS).map(Number).sort((a,b)=>a-b).forEach((lv) => {
    if (value >= XP_REQUIREMENTS[lv]) level = Math.max(level, lv + 1);
  });
  return Math.min(10, level);
}

function nextExpForLevel(level) {
  return XP_REQUIREMENTS[level] || XP_REQUIREMENTS[5];
}

function triggerLevelUpEffect(gainedLevels) {
  if (!game.player) return;
  game.levelUpEffect = { until: Date.now() + 2100, start: Date.now() };
  playSfx('levelup');
  showCinematicMessage('레벨업 하였습니다!', `Lv.${game.player.level} · 스킬 포인트 +${gainedLevels * 2}`, 1700);
  appendChatMessage('system', '레벨업', `${game.player.name}님이 Lv.${game.player.level}이 되었습니다!`);
}

function addExp(amount) {
  if (!game.player) return;
  const before = game.player.level;
  game.player.exp += amount;
  game.player.level = computeLevelFromExp(game.player.exp);
  ensurePlayerHp();
  if (game.player.level > before) {
    const gainedLevels = game.player.level - before;
    game.player.skillPoints = (game.player.skillPoints || 0) + gainedLevels * 2; // [피드백] 레벨업당 스킬포인트 2
    game.player.hp = game.player.maxHp; // [피드백] 레벨업 시 완전 회복
    triggerLevelUpEffect(gainedLevels);
    if (game.player.level >= 5 && !game.player.spec) setTimeout(openSpecModal, 1800);
  }
  updateHud();
  savePlayer();
}

function addGold(amount) {
  if (!game.player) return;
  game.player.gold += amount;
  updateHud();
  savePlayer();
}

function addBuilding(amount) {
  if (!game.player) return;
  game.player.building += amount;
  updateHud();
  savePlayer();
}

function calculateBaseStats() {
  const meta = CLASS_META[game.player.class];
  const total = resolvePlayerBaseStats(game.player.class, game.player.baseStatsVersion);
  Object.values(game.player.equipment || {}).forEach((itemId) => {
    if (!itemId) return;
    const item = getItemDefinition(itemId, game.player.class);
    if (!item?.stats) return;
    Object.entries(item.stats).forEach(([k, v]) => {
      total[k] = (total[k] || 0) + v;
    });
  });
  // [추가] 악세서리 소지 보너스: 장착하지 않아도 인벤토리에 있으면 possessStats 소량 적용
  // (장착한 악세서리는 위 장비 스탯으로 풀스탯 적용됨 — 5종 수집 + 최적 1개 장착이 최고 세팅)
  const equippedIds = Object.values(game.player.equipment || {});
  (game.player.inventory || []).forEach((invId) => {
    const acc = ITEM_DEFS[invId];
    if (!acc || acc.slot !== 'accessory' || !acc.possessStats) return;
    if (equippedIds.includes(invId)) return;
    Object.entries(acc.possessStats).forEach(([k, v]) => {
      total[k] = (total[k] || 0) + v;
    });
  });
  Object.entries(game.player.skills || {}).forEach(([skillId, rank]) => {
    const skill = SKILL_DEFS[skillId];
    const points = getSkillRank(skillId) || Number(rank) || 0;
    if (!skill?.bonuses || points <= 0) return;
    Object.entries(skill.bonuses).forEach(([k, v]) => {
      total[k] = (total[k] || 0) + v * points;
    });
  });
  // [시트개편] flatBonuses: 랭크와 무관하게 1회만 적용되는 스탯(공세 갑옷 체력 +3 등)
  Object.keys(game.player.skills || {}).forEach((skillId) => {
    const fskill = SKILL_DEFS[skillId];
    if (!fskill?.flatBonuses || getSkillRank(skillId) <= 0) return;
    Object.entries(fskill.flatBonuses).forEach(([k, v]) => { total[k] = (total[k] || 0) + Number(v || 0); });
  });
  const frenzy = getSkillRank('warrior_frenzy');
  if (frenzy > 0 && game.player?.maxHp) {
    const lostRatio = Math.max(0, 1 - (game.player.hp || game.player.maxHp) / game.player.maxHp);
    const caps = [0, .15, .30];
    total.힘 = Math.round((total.힘 || 0) * (1 + lostRatio * (caps[frenzy] || 0)));
  }
  return total;
}

const totalStatsPipeline = YuksamTotalStatsPipeline.create({ calculate:() => calculateBaseStats() });
function computeTotalStats() { return totalStatsPipeline.compute({ player:game.player }); }


function maxHpForPlayer(p = game.player) {
  const base = resolvePlayerBaseStats(p.class, p.baseStatsVersion);
  const equipmentStats = p === game.player ? computeTotalStats() : { ...base };
  const stamina = equipmentStats.체력 || base.체력 || 6;
  return 8 + stamina * 3 + (p.level || 1) * 2; // [v50] 체력 스탯 1당 HP 3 (전사 안정성 너프)
}

window.flushLocalPlayerForPvpV1 = async function flushLocalPlayerForPvpV1() {
  if (!game.player || !secureStudentAccess.enabled) return;
  savePlayer();
  await secureStudentAccess.flush?.();
};
window.getModalStateTypeV1 = () => game.modalState?.type || '';

window.getLocalPvpProfileV1 = function getLocalPvpProfileV1() {
  const identity = secureStudentAccess.getIdentity();
  const player = game.player;
  if (!identity || !player) return null;
  const stats = computeTotalStats();
  const attackStat = player.class === 'mage' ? stats.지능 : player.class === 'priest' ? stats.정신 : stats.힘;
  return {
    userId:identity.userId,
    name:player.name,
    level:Number(player.level) || 1,
    className:player.class,
    spec:player.spec || '',
    appearance:{ ...(player.appearance || {}) },
    equipment:{ ...(player.equipment || {}) },
    costume:{ ...(player.costume || {}) },
    skills:{ ...(player.skills || {}) },
    maxHp:maxHpForPlayer(player),
    hp:maxHpForPlayer(player),
    shield:0,
    primaryStat:Math.max(1, Math.round(Number(attackStat) || 1)),
    attack:Math.max(1, Math.round((Number(attackStat) || 1) / 2)),
    defense:Math.max(0, Math.round(Number(stats.방어) || 0)),
    map:game.currentMap,
    busy:game.currentMap !== 'town' || !!game.modalState?.pause || !!game.currentCombatMonsterId || !!window.getActivePvpMatchV1?.(),
  };
};

const PORTRAIT_HEAD_OFFSET_UNITS = 16;
window.renderPlayerPortraitForPvpV1 = function renderPlayerPortraitForPvpV1(canvas, profile) {
  const ctx = canvas?.getContext?.('2d');
  if (!ctx || !profile) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.beginPath();
  ctx.arc(canvas.width / 2, canvas.height / 2, Math.min(canvas.width, canvas.height) / 2 - 4, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#dbeafe';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const portraitScale = 3.25;
  const headOffset = PORTRAIT_HEAD_OFFSET_UNITS * portraitScale;
  drawPlayerSprite(
    ctx,
    canvas.width / 2,
    canvas.height / 2 + headOffset,
    profile.appearance || {},
    profile.className || 'warrior',
    { attack:0, moving:false, equipment:profile.equipment || {}, costume:profile.costume || {} },
    portraitScale,
    profile.spec || null,
  );
  ctx.restore();
};

window.renderPlayerCombatantForPvpV1 = function renderPlayerCombatantForPvpV1(canvas, profile, faceLeft = false) {
  const ctx = canvas?.getContext?.('2d');
  if (!ctx || !profile) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  if (faceLeft) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  drawPlayerSprite(
    ctx,
    canvas.width / 2,
    140,
    profile.appearance || {},
    profile.className || profile.class || 'warrior',
    {
      attack:0,
      moving:false,
      equipment:profile.equipment || {},
      costume:profile.costume || {},
    },
    1.9,
    profile.spec || null,
  );
  ctx.restore();
};

function ensurePlayerHp() {
  if (!game.player) return;
  const maxHp = maxHpForPlayer(game.player);
  const oldMax = game.player.maxHp || maxHp;
  const wasZero = Number(game.player.hp) <= 0 && oldMax > 0;
  const ratio = oldMax ? game.player.hp / oldMax : 1;
  game.player.maxHp = maxHp;
  game.player.hp = wasZero ? 0 : clamp(Math.round(maxHp * ratio), 0, maxHp);
}

function initAudio() {
  if (game.audio.ctx) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);
  const bgmGain = ctx.createGain();
  bgmGain.gain.value = game.settings.bgmEnabled ? game.settings.bgmVolume : 0;
  bgmGain.connect(master);
  game.audio.ctx = ctx;
  game.audio.master = master;
  game.audio.bgmGain = bgmGain;
  if (!game.audio.loginFile) {
    game.audio.loginFile = new Audio(window.getAudioAsset?.('loginBgm')?.src || '');
    game.audio.loginFile.loop = true;
    game.audio.loginFile.preload = 'auto';
    game.audio.loginFile.volume = game.settings.bgmEnabled ? Math.min(1, Math.max(0, game.settings.bgmVolume)) : 0;
  }
  if (!game.audio.file) {
    game.audio.file = new Audio(window.getAudioAsset?.('townBgm')?.src || '');
    game.audio.file.loop = true;
    game.audio.file.preload = 'auto';
    game.audio.file.volume = game.settings.bgmEnabled ? Math.min(1, Math.max(0, game.settings.bgmVolume)) : 0;
  }
  if (!game.audio.forestFile) {
    game.audio.forestFile = new Audio(window.getAudioAsset?.('forestBgm')?.src || '');
    game.audio.forestFile.loop = true;
    game.audio.forestFile.preload = 'auto';
    game.audio.forestFile.volume = game.settings.bgmEnabled ? Math.min(1, Math.max(0, game.settings.bgmVolume)) : 0;
  }
  if (!game.audio.desertFile) {
    game.audio.desertFile = new Audio(window.getAudioAsset?.('desertBgm')?.src || '');
    game.audio.desertFile.loop = true;
    game.audio.desertFile.preload = 'auto';
    game.audio.desertFile.volume = game.settings.bgmEnabled ? Math.min(1, Math.max(0, game.settings.bgmVolume)) : 0;
  }
}

function resumeAudio() {
  initAudio();
  if (!game.audio.ctx) return;
  if (game.audio.ctx.state === 'suspended') game.audio.ctx.resume();
  syncAudioFileBgm();
  if (!game.audio.started) startBgmLoop();
}

function updateBaseAudioVolumes() {
  if (!game.audio.bgmGain) return;
  game.audio.bgmGain.gain.setTargetAtTime(game.settings.bgmEnabled ? game.settings.bgmVolume : 0, game.audio.ctx.currentTime, 0.04);
  if (game.audio.loginFile) game.audio.loginFile.volume = game.settings.bgmEnabled ? Math.min(1, Math.max(0, game.settings.bgmVolume)) : 0;
  if (game.audio.file) game.audio.file.volume = game.settings.bgmEnabled ? Math.min(1, Math.max(0, game.settings.bgmVolume)) : 0;
  if (game.audio.forestFile) game.audio.forestFile.volume = game.settings.bgmEnabled ? Math.min(1, Math.max(0, game.settings.bgmVolume)) : 0;
  if (game.audio.desertFile) game.audio.desertFile.volume = game.settings.bgmEnabled ? Math.min(1, Math.max(0, game.settings.bgmVolume)) : 0;
}

const audioVolumePipeline = YuksamAudioVolumePipeline.create({ update:() => updateBaseAudioVolumes() });
function updateAudioVolumes() {
  return audioVolumePipeline.update({ settings:game.settings, audio:game.audio });
}

function playTone(freq, duration = 0.14, type = 'sine', volume = 0.35, destination = null) {
  initAudio();
  if (!game.audio.ctx) return;
  const ctx = game.audio.ctx;
  const gain = ctx.createGain();
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.value = 0;
  osc.connect(gain);
  gain.connect(destination || game.audio.master);
  const v = Math.min(1, Math.max(0, volume * (destination ? 1 : (game.settings.sfxEnabled ? game.settings.sfxVolume : 0))));
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(v, ctx.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + duration + 0.02);
}


function getDesiredAudioFile() {
  if (!game.settings.bgmEnabled) return null;
  // 로그인부터 캐릭터 생성 완료까지는 하나의 진입 흐름이다.
  // 실제 월드 화면이 열리기 전에는 캐릭터 생성창에서도 로그인 음악을 유지한다.
  if (!screens.game?.classList.contains('active')) return game.audio.loginFile || null;
  if (screens.game.classList.contains('active') && game.currentMap === 'forest') return game.audio.forestFile || null;
  if (screens.game.classList.contains('active') && game.currentMap === 'desert') return game.audio.desertFile || null;
  if (['town', 'equipmentShop', 'buildingShopInterior'].includes(game.currentMap || 'town')) return game.audio.file || null;
  return null;
}

function shouldUseAudioFileBgm() {
  return !!getDesiredAudioFile();
}


function getCurrentBgmPattern() {
  const map = game.currentMap || 'landing';
  if (!screens.game.classList.contains('active')) {
    return { step: 410, arp: [392, 493.88, 587.33, 739.99, 659.25, 587.33, 493.88, 440], bass: [98, 123.47, 146.83, 164.81] };
  }
  if (map === 'town' || map === 'equipmentShop' || map === 'buildingShopInterior') {
    return { step: 350, arp: [523.25, 659.25, 783.99, 1046.5, 987.77, 783.99, 659.25, 587.33, 523.25, 659.25, 739.99, 880, 783.99, 659.25, 587.33, 493.88], bass: [130.81, 164.81, 196, 174.61] };
  }
  if (map === 'forest') {
    return { step: 720, arp: [349.23, 440, 523.25, 659.25, 587.33, 523.25, 440, 392, 349.23, 440, 493.88, 587.33, 523.25, 440], bass: [87.31, 110, 130.81, 98] };
  }
  if (map === 'desert') {
    return { step: 430, arp: [329.63, 392, 440, 523.25, 493.88, 440, 392, 349.23, 329.63, 392, 493.88, 587.33], bass: [82.41, 98, 110, 123.47] };
  }
  if (map === 'bossRoom') {
    return { step: 300, arp: [220, 277.18, 329.63, 415.3, 392, 329.63, 277.18, 246.94], bass: [55, 65.41, 73.42, 82.41] };
  }
  return { step: 360, arp: [523.25, 659.25, 783.99, 987.77], bass: [130.81, 146.83] };
}

function startBgmLoop() {
  initAudio();
  if (!game.audio.ctx || game.audio.started) return;
  game.audio.started = true;
  let idx = 0;
  const tick = () => {
    if (!game.audio.ctx || !game.settings.bgmEnabled) return;
    syncAudioFileBgm();
    const pat = getCurrentBgmPattern();
    if (!shouldUseAudioFileBgm()) {
      const n = pat.arp[idx % pat.arp.length];
      const isForest = (game.currentMap || '') === 'forest';
      playTone(n, isForest ? 0.58 : 0.34, idx % 4 === 0 ? 'sine' : 'triangle', isForest ? 0.018 : 0.030, game.audio.bgmGain);
      if (idx % 4 === 0) playTone(pat.bass[(idx / 4) % pat.bass.length | 0], isForest ? 0.94 : 0.62, 'sine', isForest ? 0.012 : 0.020, game.audio.bgmGain);
      if (!isForest && idx % 6 === 3) playTone(n * 1.5, 0.18, 'sine', 0.010, game.audio.bgmGain);
    }
    idx += 1;
    clearTimeout(game.audio.bgmTimer);
    game.audio.bgmTimer = setTimeout(tick, pat.step);
  };
  tick();
}


function playSynthSfx(name) {
  resumeAudio();
  if (!game.settings.sfxEnabled) return;
  if (name === 'coin') {
    [1046, 1318, 1568, 1976].forEach((f, i) => setTimeout(() => playTone(f, .075, 'triangle', .20 - i*.025), i * 55));
    setTimeout(() => playTone(740, .12, 'sine', .08), 230);
    return;
  }
  if (name === 'quest') {
    playTone(523, .12, 'sine', .22); setTimeout(() => playTone(659, .12, 'sine', .22), 100); setTimeout(() => playTone(784, .18, 'sine', .22), 200); return;
  }
  if (name === 'hit') { playTone(180, .10, 'sawtooth', .20); setTimeout(() => playTone(92, .09, 'square', .10), 45); return; }
  if (name === 'slash') { playTone(760, .045, 'sawtooth', .18); setTimeout(() => playTone(310, .085, 'triangle', .18), 38); return; }
  if (name === 'magic') { [620, 930, 1240].forEach((f, i) => setTimeout(() => playTone(f, .11, 'sine', .16 - i*.025), i * 62)); return; }
  if (name === 'shadow') { playTone(210, .18, 'sawtooth', .16); setTimeout(() => playTone(330, .14, 'triangle', .10), 90); return; }
  /* 사망음은 낮은 사인파라 배경음악에 잘 묻혔다. 음량을 키우고 앞에 굵은
     한 방을 넣어 '쓰러졌다'가 확실히 들리게 한다(제작자 요청). */
  if (name === 'defeat') {
    playTone(110, .30, 'sawtooth', .34);
    [220, 196, 174, 130].forEach((f, i) => setTimeout(() => playTone(f, .26, 'sine', .34), i * 180));
    setTimeout(() => playTone(87, .34, 'triangle', .26), 240);
    return;
  }
  if (name === 'victory') { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => playTone(f, .16, 'triangle', .22), i * 115)); return; }
  if (name === 'world') { [196, 293.66, 392, 587.33, 783.99, 1046.5].forEach((f, i) => setTimeout(() => playTone(f, .18, i % 2 ? 'triangle' : 'sine', .15), i * 85)); return; }
  if (name === 'levelup') { [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => setTimeout(() => playTone(f, .18, 'triangle', .24 - i*.025), i * 80)); setTimeout(() => playTone(1975.5, .28, 'sine', .10), 430); return; }
  if (name === 'transition') { [330, 440, 660, 880].forEach((f, i) => setTimeout(() => playTone(f, .12, 'sine', .10), i * 90)); return; }
  if (name === 'attack') { playTone(300, .08, 'square', .15); setTimeout(() => playTone(140, .08, 'square', .12), 60); return; }
  if (name === 'open') { playTone(620, .10, 'sine', .16); return; }
}

const audioAdapters = {
  doorSynth:null,
  door:null,
  upgrade:null,
  criticalVisuals:[],
};
let activePlaySfx = playSynthSfx;
function playSfx(name) { return activePlaySfx(name); }

function playPlayerHitSfx() {
  playTone(180, .10, 'sawtooth', .40);
  setTimeout(() => playTone(92, .09, 'square', .20), 45);
}

function playClassAttackSfx() {
  const classKey = game.player?.class;
  const fallback = classKey === 'warrior' ? () => playSfx('slash')
    : classKey === 'mage' ? () => playSfx('magic')
      : classKey === 'priest' ? () => playSfx('shadow')
        : () => playSfx('attack');
  const audioId = window.YuksamAudioManifest?.classBasicSounds?.[classKey];
  if (audioId && window.playMappedAudio?.(audioId, { onFallback:fallback })) return;
  fallback();
}

function openSettingsModal() {
  openModal(`
    <h2>환경설정</h2>
    <div class="settings-grid panel-card">
      <label><input type="checkbox" id="bgmEnabledBox" ${game.settings.bgmEnabled ? 'checked' : ''} /> 배경음 켜기</label>
      <div class="range-row"><span>배경음</span><input id="bgmVolumeRange" type="range" min="0" max="100" value="${Math.round(game.settings.bgmVolume * 100)}" /><b id="bgmVolumeText">${Math.round(game.settings.bgmVolume * 100)}</b></div>
      <label><input type="checkbox" id="sfxEnabledBox" ${game.settings.sfxEnabled ? 'checked' : ''} /> 효과음 켜기</label>
      <div class="range-row"><span>효과음</span><input id="sfxVolumeRange" type="range" min="0" max="100" value="${Math.round(game.settings.sfxVolume * 100)}" /><b id="sfxVolumeText">${Math.round(game.settings.sfxVolume * 100)}</b></div>
      <p class="muted">로그인/캐릭터 생성/마을/사냥터별 배경음을 재생합니다.</p>
      <div class="settings-actions-v1">
        <button class="help-launch-v1" onclick="openGameHelpV1()">❓ 도움말</button>
        <button class="ghost" onclick="openAdminPanel()">🔐 관리자 모드</button>
      </div>
    </div>
  `, { type: 'settings', pause: true });
  const bgmBox = $('bgmEnabledBox');
  const sfxBox = $('sfxEnabledBox');
  const bgmRange = $('bgmVolumeRange');
  const sfxRange = $('sfxVolumeRange');
  bgmBox.addEventListener('change', () => { game.settings.bgmEnabled = bgmBox.checked; resumeAudio(); updateAudioVolumes(); });
  sfxBox.addEventListener('change', () => { game.settings.sfxEnabled = sfxBox.checked; playSfx('open'); });
  bgmRange.addEventListener('input', () => { game.settings.bgmVolume = Number(bgmRange.value) / 100; $('bgmVolumeText').textContent = bgmRange.value; resumeAudio(); updateAudioVolumes(); });
  sfxRange.addEventListener('input', () => { game.settings.sfxVolume = Number(sfxRange.value) / 100; $('sfxVolumeText').textContent = sfxRange.value; playSfx('open'); });
}

function monsterBase({ id, type, name, level, x, y, r, hp, exp, gold, attack, speed, aggro }) {
  // [피드백] 전 몬스터 일괄 버프: 체력 +20%, 공격력 +30% (명진쌤은 ensure에서 별도 고정)
  hp = Math.ceil((hp || 1) * 1.2);
  attack = Math.ceil((attack || 1) * 1.3);
  return {
    id,
    type,
    name,
    level,
    x,
    y,
    spawnX: x,
    spawnY: y,
    r,
    hp,
    maxHp: hp,
    exp,
    gold,
    attack,
    speed,
    aggro,
    alive: true,
    chasing: false,
    respawnAt: 0,
    ignorePlayerUntil: 0,
  };
}




function renderBaseHud() {
  if (!game.player) return;
  if ($('hudName')) $('hudName').textContent = game.player.name;
  if ($('hudClass')) $('hudClass').textContent = `${CLASS_META[game.player.class].name} · ${getItemDefinition(game.player.equipment.weapon, game.player.class).name}`;
  ensurePlayerHp();
  $('hudLevel').textContent = game.player.level;
  if ($('hudHp')) $('hudHp').textContent = game.player.hp;
  if ($('hudMaxHp')) $('hudMaxHp').textContent = game.player.maxHp;
  const _hudMinExp = minExpForLevel(game.player.level) || 0;
  const _hudSpan = Math.max(1, (nextExpForLevel(game.player.level) || 0) - _hudMinExp);
  $('hudExp').textContent = Math.max(0, (game.player.exp || 0) - _hudMinExp);
  $('hudNextExp').textContent = _hudSpan;
  const _hudNextExp = _hudSpan;
  const _hudHpPct = Math.max(0, Math.min(100, Math.round((game.player.hp / Math.max(1, game.player.maxHp)) * 100)));
  const _hudExpPct = Math.max(0, Math.min(100, Math.round((Math.max(0, (game.player.exp || 0) - _hudMinExp) / _hudSpan) * 100)));
  if ($('hudHpFill')) $('hudHpFill').style.width = _hudHpPct + '%';
  if ($('hudExpFill')) $('hudExpFill').style.width = _hudExpPct + '%';
  $('hudGold').textContent = game.player.gold;
  if ($('hudBuilding')) $('hudBuilding').textContent = game.player.building;
  if ($('hudSpec')) $('hudSpec').textContent = game.player.spec || '잠김';
  $('chooseSpecBtn').disabled = game.player.level < 5 || !!game.player.spec;
  $('chooseSpecBtn').textContent = game.player.spec ? '전문화 완료' : (game.player.level >= 5 ? '전문화' : 'Lv.5 필요');
  $('zoneBadge').textContent = worldDefs[game.currentMap].label;
  syncAudioFileBgm();
  updateQuestTracker();
}

const hudUpdatePipeline = YuksamHudUpdatePipeline.create({ render:() => renderBaseHud() });
function updateHud() { return hudUpdatePipeline.update({ player:game.player, map:game.currentMap }); }

function getQuestState(id = 'mushroom_hunt') {
  if (!game.player) return null;
  return game.player.quests?.[id] || null;
}
function incrementQuestProgress(id = 'mushroom_hunt', amount = 1) {
  const q = getQuestState(id);
  const def = QUEST_DEFS[id];
  if (!q || q.status !== 'accepted') return;
  q.progress = Math.min(def.target, (q.progress || 0) + amount);
  if (q.progress >= def.target) {
    q.status = 'ready';
    toast('퀘스트 목표 달성! 명진쌤에게 돌아가세요.');
  }
  savePlayer();
  updateQuestTracker();
}

function updateAppearanceSummary() {
  if (!$('appearanceSummary')) return;
  $('appearanceSummary').innerHTML = `
    <div><b>현재 외형</b></div>
    <div>상의 색상: <span style="color:${game.currentAppearance.shirt}">${game.currentAppearance.shirt}</span></div>
    <div>하의 색상: <span style="color:${game.currentAppearance.pants}">${game.currentAppearance.pants}</span></div>
    <div>머리 색상: <span style="color:${game.currentAppearance.hair}">${game.currentAppearance.hair}</span></div>
    <div>악세서리: <b>${accessoryLabel(game.currentAppearance.accessory)}</b></div>
  `;
}

function accessoryLabel(acc) {
  return ({ none: '없음', hat: '모자', wing: '날개', halo: '후광', cape: '망토', scarf: '목도리' })[acc] || acc;
}

function drawSplash() { }

function drawPreview() {
  const ctx = game.previewCtx;
  const w = game.previewCanvas.width;
  const h = game.previewCanvas.height;
  ctx.clearRect(0, 0, w, h);
  const bg = ctx.createRadialGradient(w / 2, h / 2, 30, w / 2, h / 2, w * .72);
  bg.addColorStop(0, 'rgba(99,213,255,.25)');
  bg.addColorStop(.55, 'rgba(199,166,255,.12)');
  bg.addColorStop(1, 'rgba(255,255,255,.025)');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,.10)';
  ctx.lineWidth = 2;
  roundRect(ctx, 24, 24, w - 48, h - 48, 34); ctx.stroke();
  drawPedestal(ctx, w / 2, 660, 3.3);
  drawPlayerSprite(ctx, w / 2, 500, game.currentAppearance, game.selectedClass, { attack: 0, moving: false, dance: 0, equipment: { weapon: defaultWeaponIdForClass(game.selectedClass) } }, 6.05);
  ctx.fillStyle = '#f7fbff';
  ctx.textAlign = 'center';
  ctx.font = '900 38px Jua, Noto Sans KR, system-ui';
  ctx.fillText(CLASS_META[game.selectedClass].name, w / 2, 64);
  ctx.font = '800 18px Noto Sans KR, Jua, system-ui';
  ctx.fillStyle = '#cce6fb';
  ctx.fillText(`무기: ${CLASS_META[game.selectedClass].weapon}`, w / 2, 94);
}

function worldToScreen(x, y) {
  return { x: x - game.camera.x, y: y - game.camera.y };
}

function updateCamera() {
  const world = worldDefs[game.currentMap];
  game.camera.x = clamp(game.player.x - game.width / 2, 0, world.width - game.width);
  game.camera.y = clamp(game.player.y - game.height / 2, 0, world.height - game.height);
}


function drawTown() {
  const ctx = game.ctx;
  const world = worldDefs.town;

  const g = ctx.createLinearGradient(0, 0, 0, game.height);
  g.addColorStop(0, '#5ba76a');
  g.addColorStop(.52, '#3d7750');
  g.addColorStop(1, '#24472f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, game.width, game.height);

  drawTerrainDots(ctx, world, '#ffffff', .052, 74, 22);
  drawTownBackdropDetails();
  drawRoadsTown();
  drawPlazaWorld(world.portal.x, world.portal.y);
  drawGardenPatch(ctx, 920, 1080, 560, 240, '#547c3f');
  drawGardenPatch(ctx, 1580, 720, 420, 190, '#4f7e50');

  drawFancyBuildingWorld(world.shop.x, world.shop.y, world.shop.w, world.shop.h, '#ef9a29', world.shop.name, 'weapon');
  drawFancyBuildingWorld(world.buildingShop.x, world.buildingShop.y, world.buildingShop.w, world.buildingShop.h, '#d6b4ff', world.buildingShop.name, 'crystal');
  drawEntranceGlowWorld(world.shop.doorX, world.shop.doorY, '#fbbf24');
  drawEntranceGlowWorld(world.buildingShop.doorX, world.buildingShop.doorY, '#c7a6ff');
  drawHallBoardWorld(world.hall.x, world.hall.y, world.hall.w, world.hall.h);
  drawPortalWorld(world.portal.x, world.portal.y, world.portal.r);
  drawNpcWorld(world.npc.x, world.npc.y, world.npc.name, hasAvailableQuest(), isNearPoint(world.npc, 82));

  const deco = [
    [540, 540, 1.1], [420, 920, .9], [740, 420, .9], [1640, 430, 1.0], [1780, 980, 1.1], [2040, 750, .95],
    [1630, 1440, 1.1], [920, 1450, 1.0], [520, 1400, .95], [2070, 1320, 1.0], [360, 680, .72], [1890, 570, .78]
  ];
  deco.forEach(([x, y, s]) => drawTreeWorld(x, y, s));
  drawTownLampsAndFlowers();
  if (typeof drawMapDetailV36 === 'function') drawMapDetailV36('town');
  drawTitleLabel(world.label);
}


function drawTownBackdropDetails() {
  const ctx = game.ctx;
  const ponds = [[360, 1220, 160, 64], [1940, 1180, 140, 58]];
  ponds.forEach(([x, y, rx, ry]) => {
    const p = worldToScreen(x, y);
    const g = ctx.createRadialGradient(p.x, p.y, 10, p.x, p.y, rx);
    g.addColorStop(0, 'rgba(167,243,208,.75)');
    g.addColorStop(1, 'rgba(37,99,235,.42)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(p.x, p.y, rx, ry, -.2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(219,255,247,.28)'; ctx.lineWidth = 5; ctx.stroke();
  });
}

function drawPlazaWorld(x, y) {
  const ctx = game.ctx;
  const p = worldToScreen(x, y);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.fillStyle = 'rgba(232,202,147,.55)';
  ctx.beginPath(); ctx.ellipse(0, 0, 188, 98, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 7; ctx.stroke();
  for (let i = 0; i < 16; i += 1) {
    const a = i / 16 * Math.PI * 2;
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,.13)' : 'rgba(101,67,33,.10)';
    ctx.beginPath(); ctx.ellipse(Math.cos(a) * 150, Math.sin(a) * 74, 18, 7, a, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawTownLampsAndFlowers() {
  const lamps = [[1000,880],[1400,880],[975,1120],[1425,1120],[690,850],[1540,1045]];
  lamps.forEach(([x,y], i) => drawLampWorld(x, y, i));
  const flowers = [[840,970],[1020,760],[1500,820],[1830,960],[720,1040],[1300,1180],[480,780],[2060,980]];
  flowers.forEach(([x,y], i) => drawFlowerClusterWorld(x, y, i));
}

function drawLampWorld(x, y, seed = 0) {
  const ctx = game.ctx;
  const p = worldToScreen(x, y);
  const t = performance.now()/1000 + seed;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.strokeStyle = '#3f2a1b'; ctx.lineWidth = 5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, 30); ctx.lineTo(0, -28); ctx.stroke();
  const glow = ctx.createRadialGradient(0, -36, 4, 0, -36, 36 + Math.sin(t*2)*3);
  glow.addColorStop(0, 'rgba(255,244,180,.92)'); glow.addColorStop(1, 'rgba(255,210,87,0)');
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, -36, 40, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#ffe08a'; ctx.beginPath(); ctx.arc(0, -36, 8, 0, Math.PI*2); ctx.fill();
  ctx.restore();
}

function drawFlowerClusterWorld(x, y, seed = 0) {
  const ctx = game.ctx;
  const p = worldToScreen(x, y);
  const colors = ['#fda4af','#fde68a','#93c5fd','#c4b5fd','#86efac'];
  ctx.save(); ctx.translate(p.x, p.y);
  for (let i = 0; i < 9; i += 1) {
    const a = i * 1.7 + seed;
    const fx = Math.cos(a) * (8 + (i % 3) * 5);
    const fy = Math.sin(a) * (5 + (i % 2) * 4);
    ctx.fillStyle = colors[(i+seed)%colors.length];
    ctx.beginPath(); ctx.arc(fx, fy, 4, 0, Math.PI*2); ctx.fill();
  }
  ctx.restore();
}



function drawEntranceGlowWorld(x, y, color) {
  const p = worldToScreen(x, y);
  const ctx = game.ctx;
  const t = performance.now()/1000;
  ctx.save(); ctx.translate(p.x, p.y);
  const pulse = 1 + Math.sin(t*4) * .08;
  const grad = ctx.createRadialGradient(0, 0, 4, 0, 0, 54 * pulse);
  grad.addColorStop(0, color);
  grad.addColorStop(.35, color + 'cc');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.ellipse(0, 0, 72 * pulse, 30 * pulse, 0, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.ellipse(0, 0, 46 * pulse, 18 * pulse, 0, 0, Math.PI*2); ctx.stroke();
  ctx.restore();
}

function drawHallBoardWorld(x, y, w, h) {
  const p = worldToScreen(x, y);
  const ctx = game.ctx;
  ctx.save();
  ctx.translate(p.x, p.y);
  drawShadow(ctx, 0, h * .42, w * .33, 18, .25);
  ctx.fillStyle = '#65401f';
  roundRect(ctx, -w / 2, -h / 2, w, h * .72, 18); ctx.fill();
  ctx.fillStyle = '#f3d49a';
  roundRect(ctx, -w / 2 + 22, -h / 2 + 20, w - 44, h * .72 - 40, 12); ctx.fill();
  ctx.strokeStyle = '#3b2411'; ctx.lineWidth = 10;
  roundRect(ctx, -w / 2, -h / 2, w, h * .72, 18); ctx.stroke();
  ctx.fillStyle = '#3b2411';
  roundRect(ctx, -w * .36, h * .21, 28, h * .34, 6); ctx.fill();
  roundRect(ctx, w * .28, h * .21, 28, h * .34, 6); ctx.fill();
  ctx.fillStyle = '#2f1e10';
  ctx.textAlign = 'center';
  ctx.font = '900 28px Noto Sans KR, Jua, system-ui';
  ctx.fillText('명예의 전당', 0, -h * .15);
  ctx.font = '800 16px Noto Sans KR, Jua, system-ui';
  ctx.fillText('RANKING BOARD', 0, h * .02);
  ctx.restore();
}

function drawEquipmentShopInterior() {
  const ctx = game.ctx;
  const world = worldDefs.equipmentShop;
  const g = ctx.createLinearGradient(0, 0, 0, game.height);
  g.addColorStop(0, '#33243d');
  g.addColorStop(.5, '#1b1f36');
  g.addColorStop(1, '#111827');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, game.width, game.height);
  drawTerrainDots(ctx, world, '#ffffff', .035, 68, 12);
  // floor carpet
  const c = worldToScreen(800, 650);
  ctx.save();
  ctx.fillStyle = 'rgba(141,91,46,.55)';
  roundRect(ctx, c.x - 460, c.y - 70, 920, 260, 34); ctx.fill();
  ctx.strokeStyle = 'rgba(255,215,106,.30)'; ctx.lineWidth = 8; roundRect(ctx, c.x - 450, c.y - 60, 900, 240, 30); ctx.stroke();
  ctx.restore();
  drawShopCounter(560, 390, '무기 진열대', '#ef4444');
  drawShopCounter(1040, 390, '방어구 진열대', '#60a5fa');
  drawWeaponRackWorld(380, 610);
  drawWeaponRackWorld(720, 610);
  drawArmorStandWorld(900, 610);
  drawArmorStandWorld(1200, 610);
  drawNpcWorld(world.genie.x, world.genie.y, world.genie.name, false, isNearPoint(world.genie, 86), 'mage');
  drawNpcWorld(world.andre.x, world.andre.y, world.andre.name, false, isNearPoint(world.andre, 86), 'warrior');
  drawExitMarker(world.exit.x, world.exit.y);
  drawTitleLabel(world.label);
}



function drawBuildingShopInterior() {
  const ctx = game.ctx;
  const world = worldDefs.buildingShopInterior;
  const g = ctx.createLinearGradient(0, 0, 0, game.height);
  g.addColorStop(0, '#2b2144');
  g.addColorStop(.52, '#1e1740');
  g.addColorStop(1, '#100d24');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, game.width, game.height);
  drawTerrainDots(ctx, world, '#f5e8ff', .04, 70, 13);
  const c = worldToScreen(800, 620);
  ctx.save();
  ctx.fillStyle = 'rgba(199,166,255,.22)';
  roundRect(ctx, c.x - 470, c.y - 120, 940, 330, 42); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 8; roundRect(ctx, c.x - 455, c.y - 105, 910, 300, 36); ctx.stroke();
  ctx.restore();
  drawBuildingSculptureWorld(520, 560, 0.9, '');
  drawBuildingSculptureWorld(1080, 560, 0.85, '');
  drawCrystalPedestalWorld(670, 330, '#c7a6ff');
  drawCrystalPedestalWorld(930, 330, '#93c5fd');
  drawNpcWorld(world.saenari.x, world.saenari.y, world.saenari.name, false, isNearPoint(world.saenari, 86), 'priest');
  if (world.sangnam) drawNpcWorld(world.sangnam.x, world.sangnam.y, world.sangnam.name, false, isNearPoint(world.sangnam, 86), 'mage');
  drawExitMarker(world.exit.x, world.exit.y);
  drawTitleLabel(world.label);
}

function drawBuildingSculptureWorld(x, y, scale, label) {
  const p = worldToScreen(x, y);
  const ctx = game.ctx;
  ctx.save(); ctx.translate(p.x, p.y); ctx.scale(scale, scale);
  drawShadow(ctx, 0, 72, 70, 18, .25);
  const grad = ctx.createLinearGradient(0, -90, 0, 75);
  grad.addColorStop(0, '#ede9fe'); grad.addColorStop(1, '#8b5cf6');
  ctx.fillStyle = grad;
  roundRect(ctx, -44, -60, 36, 126, 8); ctx.fill();
  roundRect(ctx, -4, -90, 36, 156, 8); ctx.fill();
  roundRect(ctx, 36, -36, 36, 102, 8); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.28)';
  for (let i = 0; i < 7; i += 1) {
    roundRect(ctx, -35, -44 + i * 15, 14, 5, 2); ctx.fill();
    roundRect(ctx, 5, -74 + i * 18, 14, 5, 2); ctx.fill();
    roundRect(ctx, 45, -22 + i * 14, 14, 5, 2); ctx.fill();
  }
  ctx.fillStyle = '#f4edff'; ctx.textAlign = 'center'; ctx.font = '900 16px Noto Sans KR, Jua, system-ui'; if (label) ctx.fillText(label, 0, 94);
  ctx.restore();
}

function drawCrystalPedestalWorld(x, y, color) {
  const p = worldToScreen(x, y);
  const ctx = game.ctx;
  const t = performance.now()/1000;
  ctx.save(); ctx.translate(p.x, p.y);
  drawShadow(ctx, 0, 50, 48, 12, .22);
  ctx.fillStyle = '#49316f'; roundRect(ctx, -54, 22, 108, 38, 12); ctx.fill();
  ctx.rotate(Math.sin(t*1.7) * .04);
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(0, -62); ctx.lineTo(34, -12); ctx.lineTo(20, 24); ctx.lineTo(-20, 24); ctx.lineTo(-34, -12); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.42)'; ctx.lineWidth = 3; ctx.stroke();
  ctx.restore();
}

function drawShopCounter(x, y, label, color) {
  const p = worldToScreen(x, y);
  const ctx = game.ctx;
  ctx.save();
  ctx.translate(p.x, p.y);
  drawShadow(ctx, 0, 55, 120, 18, .25);
  ctx.fillStyle = '#8b5e34';
  roundRect(ctx, -140, -30, 280, 90, 18); ctx.fill();
  ctx.fillStyle = color;
  roundRect(ctx, -126, -18, 252, 24, 999); ctx.fill();
  ctx.fillStyle = '#fff7ed';
  ctx.textAlign = 'center';
  ctx.font = '900 18px Noto Sans KR, Jua, system-ui';
  ctx.fillText(label, 0, 42);
  ctx.restore();
}



function drawWeaponRackWorld(x, y) {
  const p = worldToScreen(x, y);
  const ctx = game.ctx;
  ctx.save(); ctx.translate(p.x, p.y);
  drawShadow(ctx, 0, 44, 64, 12, .25);
  ctx.strokeStyle = '#7c4a22'; ctx.lineWidth = 8; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-58, 34); ctx.lineTo(58, 34); ctx.moveTo(-46, -34); ctx.lineTo(-46, 38); ctx.moveTo(46, -34); ctx.lineTo(46, 38); ctx.stroke();
  ['#d1d5db','#fbbf24','#93c5fd'].forEach((color, i) => {
    ctx.save(); ctx.translate(-26 + i*26, -4); ctx.rotate(-.75 + i*.16);
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(0,-38); ctx.lineTo(7,-12); ctx.lineTo(3,26); ctx.lineTo(-3,26); ctx.lineTo(-7,-12); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#92400e'; roundRect(ctx, -3, 24, 6, 20, 3); ctx.fill();
    ctx.restore();
  });
  ctx.restore();
}

function drawArmorStandWorld(x, y) {
  const p = worldToScreen(x, y);
  const ctx = game.ctx;
  ctx.save(); ctx.translate(p.x, p.y);
  drawShadow(ctx, 0, 48, 56, 13, .25);
  ctx.strokeStyle = '#7c4a22'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(0,-48); ctx.lineTo(0,44); ctx.moveTo(-34,44); ctx.lineTo(34,44); ctx.stroke();
  const grad = ctx.createLinearGradient(0,-52,0,34); grad.addColorStop(0,'#c7d2fe'); grad.addColorStop(1,'#475569');
  ctx.fillStyle = grad; roundRect(ctx, -34, -32, 68, 58, 14); ctx.fill();
  ctx.fillStyle = '#f8fafc'; roundRect(ctx, -13, -47, 26, 16, 8); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 3; roundRect(ctx, -26, -24, 52, 42, 12); ctx.stroke();
  ctx.restore();
}

function drawExitMarker(x, y) {
  const p = worldToScreen(x, y);
  const ctx = game.ctx;
  ctx.save();
  ctx.fillStyle = 'rgba(34,197,94,.16)';
  ctx.strokeStyle = 'rgba(134,239,172,.72)';
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.ellipse(p.x, p.y, 70, 28, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#dcfce7'; ctx.textAlign = 'center'; ctx.font = '900 16px Noto Sans KR, Jua, system-ui'; ctx.fillText('마을로', p.x, p.y + 5);
  ctx.restore();
}

function isNearPoint(point, range) {
  if (!game.player) return false;
  return distance(game.player, point) < range;
}

function drawRoadsTown() {
  const ctx = game.ctx;
  const roadPoints = [
    [1200, 1720], [1200, 960], [1200, 540],
    [1200, 960], [740, 740],
    [1200, 960], [1580, 1080],
  ];
  ctx.save();
  ctx.strokeStyle = '#b89463';
  ctx.lineWidth = 88;
  ctx.lineCap = 'round';
  ctx.globalAlpha = .82;
  ctx.beginPath();
  ctx.moveTo(...screenPair(roadPoints[0]));
  ctx.lineTo(...screenPair(roadPoints[1]));
  ctx.lineTo(...screenPair(roadPoints[2]));
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(...screenPair(roadPoints[1]));
  ctx.lineTo(...screenPair(roadPoints[3]));
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(...screenPair(roadPoints[1]));
  ctx.lineTo(...screenPair(roadPoints[5]));
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,.13)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(...screenPair([1200, 1720]));
  ctx.lineTo(...screenPair([1200, 540]));
  ctx.moveTo(...screenPair([1200, 960]));
  ctx.lineTo(...screenPair([740, 740]));
  ctx.moveTo(...screenPair([1200, 960]));
  ctx.lineTo(...screenPair([1580, 1080]));
  ctx.stroke();
  ctx.restore();
}

function drawForest() {
  const ctx = game.ctx;
  const world = worldDefs.forest;
  const g = ctx.createLinearGradient(0, 0, 0, game.height);
  g.addColorStop(0, '#285a36');
  g.addColorStop(.55, '#1d4128');
  g.addColorStop(1, '#102117');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, game.width, game.height);

  drawTerrainDots(ctx, world, '#d9f99d', .055, 84, 18);

  // [개선] 사선 등간격 배열 → 자연 산포 (scatterPointsV37)
  const forestTrees = (typeof scatterPointsV37 === 'function') ? scatterPointsV37('forestTrees', 26, world.width, world.height, 230) : null;
  for (let i = 0; i < 26; i += 1) {
    const p = forestTrees ? forestTrees[i] : { x: 260 + (i * 101) % 3000, y: 200 + (i * 149) % 2100, s: .9 + (i % 4) * .08 };
    if (p) drawTreeWorld(p.x, p.y, .78 + p.s * .35);
  }
  drawForestPath();
  drawDeepForestMist();
  if (typeof drawMapDetailV36 === 'function') drawMapDetailV36('forest');
  drawStagePortals(world.key);
  drawTitleLabel(world.label);

  game.forestMonsters.forEach((m) => {
    if (!m.alive) return;
    drawMushroomWorld(m);
  });
}

function drawDeepForestMist() {
  const ctx = game.ctx;
  const p = worldToScreen(2680, 780);
  ctx.save();
  const g = ctx.createRadialGradient(p.x, p.y, 40, p.x, p.y, 480);
  g.addColorStop(0, 'rgba(187,247,208,.16)');
  g.addColorStop(1, 'rgba(187,247,208,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, game.width, game.height);
  ctx.restore();
}

function drawDesert() {
  const ctx = game.ctx;
  const world = worldDefs.desert;
  const g = ctx.createLinearGradient(0, 0, 0, game.height);
  g.addColorStop(0, '#c78b3a');
  g.addColorStop(.55, '#b7792e');
  g.addColorStop(1, '#7c4a1f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, game.width, game.height);
  drawTerrainDots(ctx, world, '#fff7c2', .08, 92, 16);
  drawDesertPath();
  const desertCacti = (typeof scatterPointsV37 === 'function') ? scatterPointsV37('desertCacti', 20, world.width, world.height, 230) : null;
  for (let i = 0; i < 20; i += 1) {
    const p = desertCacti ? desertCacti[i] : { x: 260 + (i * 173) % 3100, y: 200 + (i * 131) % 2050, s: .75 + (i % 3) * .12 };
    if (p) drawCactusWorld(p.x, p.y, .68 + p.s * .35);
  }
  if (typeof drawMapDetailV36 === 'function') drawMapDetailV36('desert');
  drawStagePortals(world.key);
  drawTitleLabel(world.label);
  game.forestMonsters.forEach((m) => { if (m.alive) drawMushroomWorld(m); });
}

function drawDesertPath() {
  const ctx = game.ctx;
  const points = [[420,1880],[840,1600],[1320,1420],[1780,1480],[2240,1180],[2940,960]];
  ctx.save();
  ctx.strokeStyle = 'rgba(255,224,150,.44)';
  ctx.lineWidth = 90;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(...screenPair(points[0]));
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(...screenPair(points[i]));
  ctx.stroke();
  ctx.restore();
}

function drawCactusWorld(x, y, scale = 1) {
  const p = worldToScreen(x, y);
  const ctx = game.ctx;
  const sway = Math.sin(performance.now()/900 + x*.01) * .035;
  drawShadow(ctx, p.x, p.y + 30*scale, 22*scale, 8*scale, .18);
  ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(sway); ctx.scale(scale, scale);
  ctx.fillStyle = '#2f855a'; roundRect(ctx, -9, -32, 18, 72, 9); ctx.fill();
  roundRect(ctx, -33, -8, 14, 40, 7); ctx.fill(); roundRect(ctx, 19, -18, 14, 44, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0,-25); ctx.lineTo(0,30); ctx.moveTo(-26,-4); ctx.lineTo(-26,22); ctx.moveTo(26,-12); ctx.lineTo(26,18); ctx.stroke();
  ctx.restore();
}

function drawForestPath() {
  const ctx = game.ctx;
  const points = [[340, 1840], [900, 1600], [1480, 1500], [1980, 1550], [2480, 1480], [2920, 1380]];
  ctx.save();
  ctx.strokeStyle = '#7f6b4f';
  ctx.lineWidth = 70;
  ctx.lineCap = 'round';
  ctx.globalAlpha = .55;
  ctx.beginPath();
  ctx.moveTo(...screenPair(points[0]));
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(...screenPair(points[i]));
  ctx.stroke();
  ctx.restore();
}

function drawTerrainDots(ctx, world, color, alpha, gap, radius) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  const startX = Math.floor(game.camera.x / gap) * gap - gap;
  const endX = game.camera.x + game.width + gap;
  const startY = Math.floor(game.camera.y / gap) * gap - gap;
  const endY = game.camera.y + game.height + gap;
  for (let y = startY; y < endY; y += gap) {
    for (let x = startX; x < endX; x += gap) {
      const sx = x - game.camera.x + ((y / gap) % 2) * (gap * .25);
      const sy = y - game.camera.y;
      ctx.beginPath();
      ctx.ellipse(sx, sy, radius, radius * .38, -.28, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawGardenPatch(ctx, x, y, w, h, color) {
  const p = worldToScreen(x, y);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.fillStyle = color;
  roundRect(ctx, -w / 2, -h / 2, w, h, 28);
  ctx.fill();
  ctx.globalAlpha = .24;
  ctx.fillStyle = '#fef3c7';
  for (let i = 0; i < 48; i += 1) {
    ctx.beginPath();
    ctx.arc(-w / 2 + 20 + (i * 37) % (w - 40), -h / 2 + 20 + (i * 61) % (h - 40), 4 + (i % 3), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}


function drawStagePortals(mapKey) {
  const portals = ensureStagePortals(mapKey);
  if (!portals) return;
  const rp = worldToScreen(portals.returnPortal.x, portals.returnPortal.y);
  drawPortalSprite(game.ctx, rp.x, rp.y, portals.returnPortal.r * .42, performance.now()/760, '#22c55e');
  drawPortalInteractionRingV60(rp.x, rp.y, isNearPoint(portals.returnPortal, portals.returnPortal.r + 54));
  drawFloatingLabel(game.ctx, rp.x, rp.y - 55, '63마을 귀환');
  const bp = worldToScreen(portals.bossPortal.x, portals.bossPortal.y);
  drawPortalSprite(game.ctx, bp.x, bp.y, portals.bossPortal.r * .46, performance.now()/640, '#ef4444');
  drawPortalInteractionRingV60(bp.x, bp.y, isNearPoint(portals.bossPortal, portals.bossPortal.r + 54));
  drawFloatingLabel(game.ctx, bp.x, bp.y - 60, '보스 방');
}

function drawFloatingLabel(ctx, x, y, label) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = '900 14px Noto Sans KR, Jua, system-ui';
  const w = ctx.measureText(label).width + 22;
  ctx.fillStyle = 'rgba(7,16,27,.76)'; roundRect(ctx, x - w/2, y - 15, w, 25, 999); ctx.fill();
  ctx.fillStyle = '#f8fafc'; ctx.fillText(label, x, y + 3);
  ctx.restore();
}




function drawTitleLabel(text) {
  const ctx = game.ctx;
  ctx.save();
  ctx.fillStyle = 'rgba(4,10,19,.50)';
  roundRect(ctx, game.width / 2 - 150, 16, 300, 52, 999);
  ctx.fill();
  ctx.fillStyle = '#f4f9ff';
  ctx.textAlign = 'center';
  ctx.font = '900 24px Noto Sans KR, Jua, system-ui';
  ctx.fillText(text, game.width / 2, 50);
  ctx.restore();
}

function drawFancyBuildingWorld(x, y, w, h, roofColor, label, icon = 'none') {
  const p = worldToScreen(x, y);
  drawFancyBuilding(game.ctx, p.x, p.y, w, h, roofColor, label, icon);
}

function drawFancyBuilding(ctx, x, y, w, h, roofColor, label, icon = 'none') {
  ctx.save();
  ctx.translate(x, y);
  drawShadow(ctx, 0, h * .57, w * .48, 24, .28);

  // base wall with soft gradient
  const wall = ctx.createLinearGradient(0, -h * .2, 0, h * .58);
  wall.addColorStop(0, '#f0d099');
  wall.addColorStop(.55, '#d7aa6a');
  wall.addColorStop(1, '#a9753f');
  ctx.fillStyle = wall;
  roundRect(ctx, -w / 2, -h * .16, w, h * .72, 22);
  ctx.fill();

  // roof
  const roof = ctx.createLinearGradient(0, -h * .62, 0, h * .02);
  roof.addColorStop(0, '#fff0c2');
  roof.addColorStop(.18, roofColor);
  roof.addColorStop(1, '#82441f');
  ctx.fillStyle = roof;
  ctx.beginPath();
  ctx.moveTo(-w / 2 - 28, -h * .10);
  ctx.lineTo(0, -h * .62);
  ctx.lineTo(w / 2 + 28, -h * .10);
  ctx.lineTo(0, h * .05);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.26)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-w/2-14, -h*.12); ctx.lineTo(0, -h*.55); ctx.lineTo(w/2+14, -h*.12); ctx.stroke();

  // door/windows - windows are deliberately away from the doorway
  ctx.fillStyle = '#6b3f21';
  roundRect(ctx, -25, h * .14, 50, h * .32, 10); ctx.fill();
  const glow = ctx.createLinearGradient(0, 0, 0, h * .3);
  glow.addColorStop(0, '#e0f7ff'); glow.addColorStop(1, '#7dd3fc');
  ctx.fillStyle = glow;
  [-w * .34, w * .18].forEach((wx) => { roundRect(ctx, wx, -h * .015, 48, 34, 9); ctx.fill(); });
  ctx.fillStyle = 'rgba(255,255,255,.55)';
  [-w * .34, w * .18].forEach((wx) => { ctx.fillRect(wx + 22, -h * .015, 3, 34); ctx.fillRect(wx, -h * .015 + 15, 48, 3); });

  // signboard moved above roof to avoid entrance overlap
  ctx.font = '900 18px Jua, Noto Sans KR, system-ui';
  const signW = Math.max(152, Math.min(w * .96, ctx.measureText(label).width + 44));
  ctx.fillStyle = 'rgba(7,16,27,.86)';
  roundRect(ctx, -signW/2, -h * .74, signW, 40, 999); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 2; roundRect(ctx, -signW/2, -h * .74, signW, 40, 999); ctx.stroke();
  ctx.fillStyle = '#f8fbff';
  ctx.textAlign = 'center';
  ctx.fillText(label, 0, -h * .74 + 26);

  // icon crest
  ctx.fillStyle = 'rgba(255,255,255,.92)';
  ctx.font = '900 26px Noto Sans KR, Jua, system-ui';
  const glyph = icon === 'weapon' ? '⚔' : (icon === 'crystal' ? '◆' : '★');
  ctx.fillText(glyph, 0, -h * .18);
  ctx.restore();
}

function drawPortalWorld(x, y, r) {
  const p = worldToScreen(x, y);
  drawPortalSprite(game.ctx, p.x, p.y, r * .44, performance.now() / 700);
  drawPortalInteractionRingV60(p.x, p.y, isNearPoint({ x, y }, r + 54), {
    color:'250,204,21',
    lineWidth:5,
    radiusX:58,
    radiusY:21,
    offsetY:28,
  });
}

function drawPortalInteractionRingV60(x, y, highlighted, options = {}) {
  if (!highlighted) return;
  const ctx = game.ctx;
  ctx.save();
  const pulse = .6 + Math.sin(performance.now() / 180) * .22;
  ctx.strokeStyle = `rgba(${options.color || '137,230,255'},${pulse})`;
  ctx.lineWidth = Number(options.lineWidth) || 4;
  ctx.beginPath();
  ctx.ellipse(
    x,
    y + (Number(options.offsetY) || 24),
    Number(options.radiusX) || 34,
    Number(options.radiusY) || 13,
    0,
    0,
    Math.PI * 2
  );
  ctx.stroke();
  ctx.restore();
}

function drawPortalSprite(ctx, x, y, r, t, tint = '#60d8ff') {
  const now = performance.now() / 1000;
  const pulse = 1 + Math.sin(now * 3.2) * 0.07;
  const wobble = Math.sin(now * 2.7) * 0.08;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(pulse, 1 + Math.cos(now * 2.6) * 0.045);
  ctx.fillStyle = 'rgba(0,0,0,.24)';
  ctx.beginPath();
  ctx.ellipse(0, r * 1.1, r * 1.35, r * .48, 0, 0, Math.PI * 2);
  ctx.fill();

  // humming rings
  for (let i = 0; i < 4; i += 1) {
    const phase = (now * 0.95 + i * .25) % 1;
    ctx.strokeStyle = `rgba(135,229,255,${0.28 * (1 - phase)})`;
    ctx.lineWidth = 3 + i;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * (.82 + phase * .68), r * (1.12 + phase * .86), wobble, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.rotate(wobble);
  const grad = ctx.createRadialGradient(0, 0, r * .10, 0, 0, r * 1.18);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(.22, '#b8f3ff');
  grad.addColorStop(.58, '#38bdf8');
  grad.addColorStop(1, '#4338ca');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * .72, r * 1.02, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(244,253,255,.95)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * .86, r * 1.15, 0, 0, Math.PI * 2);
  ctx.stroke();

  // orbiting sparks
  ctx.fillStyle = '#e0fbff';
  for (let i = 0; i < 10; i += 1) {
    const a = now * 1.8 + i * Math.PI * .2;
    const px = Math.cos(a) * r * (0.82 + (i % 3) * .12);
    const py = Math.sin(a) * r * (1.18 + (i % 2) * .08);
    ctx.beginPath(); ctx.arc(px, py, 2.2 + (i % 2), 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawNpcWorld(x, y, name, hasQuest, highlighted = false, klass = 'priest') {
  const p = worldToScreen(x, y);
  drawNpcSprite(game.ctx, p.x, p.y, name, hasQuest, NPC_WORLD_SCALE, highlighted, klass);
}

function drawNpcSprite(ctx, x, y, name, hasQuest = false, scale = 1, highlighted = false, klass = 'priest') {
  if (highlighted) {
    ctx.save();
    const pulse = .6 + Math.sin(performance.now() / 180) * .22;
    ctx.strokeStyle = `rgba(137,230,255,${pulse})`;
    ctx.lineWidth = 4 * scale;
    ctx.beginPath(); ctx.ellipse(x, y + 24 * scale, 30 * scale, 12 * scale, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  drawShadow(ctx, x, y + 30 * scale, 22 * scale, 7 * scale, .25);
  const isLongHairNpc = /상미|새나리/.test(name);
  drawHumanoid(ctx, x, y, {
    shirt: klass === 'mage' ? '#7c3aed' : (klass === 'warrior' ? '#b45309' : '#4f46e5'),
    pants: '#334155',
    hair: isLongHairNpc ? '#5b3422' : '#312116',
    hairStyle: isLongHairNpc ? 'curlyLong' : 'short',
    skin: '#fff1df',
    accessory: klass === 'mage' ? 'scarf' : 'scarf',
  }, klass, { attack: 0, moving: false }, scale, true);
  drawNpcIdleBubble(ctx, x, y, name, scale);

  ctx.save();
  ctx.textAlign = 'center';
  if (hasQuest) {
    const bob = Math.sin(performance.now() / 220) * 3 * scale;
    ctx.fillStyle = '#ffd84d';
    ctx.font = `${Math.round(34 * scale)}px Noto Sans KR, Jua, system-ui`;
    ctx.fillText('!', x, y - 58 * scale + bob);
  }
  ctx.font = `${Math.round(14 * scale)}px Noto Sans KR, Jua, system-ui`;
  const nameW = ctx.measureText(name).width + 22 * scale;
  ctx.fillStyle = 'rgba(7,16,27,.74)';
  roundRect(ctx, x - nameW / 2, y + 45 * scale, nameW, 26 * scale, 999);
  ctx.fill();
  ctx.fillStyle = '#edf5ff';
  ctx.fillText(name, x, y + 63 * scale);
  ctx.restore();
}

function drawTreeWorld(x, y, scale = 1) {
  const p = worldToScreen(x, y);
  const ctx = game.ctx;
  const sway = Math.sin(performance.now() / 900 + x * .01 + y * .006) * .035;
  drawShadow(ctx, p.x, p.y + 26 * scale, 28 * scale, 10 * scale, .18);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.fillStyle = '#6f4e2a';
  roundRect(ctx, -7 * scale, 6 * scale, 14 * scale, 42 * scale, 5 * scale);
  ctx.fill();
  ctx.rotate(sway);
  const crown = ['#2f6c39', '#397f44', '#21592f'];
  crown.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc((i - 1) * 18 * scale, -8 * scale + (i % 2) * 6 * scale, 20 * scale, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.beginPath(); ctx.arc(0, -22 * scale, 24 * scale, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawMushroomWorld(monster) {
  const p = worldToScreen(monster.x, monster.y);
  const ctx = game.ctx;
  drawMonsterSprite(ctx, p.x, p.y, monster, 1);
  drawMonsterNameplate(ctx, p.x, p.y, monster);
}

function drawMonsterSprite(ctx, x, y, monster, scale = 1) {
  if (!monster) return;
  const eliteScale = monster.elite ? 1.32 : 1;
  if (monster.elite) {
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = 'rgba(127,29,29,.9)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.ellipse(0, 8, 54 * eliteScale, 54 * eliteScale, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  if (monster.type === 'slime') return drawSlimeSprite(ctx, x, y, monster, scale * eliteScale);
  if (monster.type === 'stomp') return drawStompSprite(ctx, x, y, monster, scale * eliteScale);
  if (monster.type === 'snake') return drawSnakeSprite(ctx, x, y, monster, scale * eliteScale);
  return drawMushroomSprite(ctx, x, y, monster, scale * eliteScale);
}

function drawMushroomSprite(ctx, x, y, monster, scale = 1) {
  const t = performance.now() / 1000;
  const bob = Math.sin(t * 3 + monster.spawnX * .01) * 3 * scale;
  drawShadow(ctx, x, y + 22 * scale, 24 * scale, 8 * scale, .25);
  ctx.save();
  ctx.translate(x, y + bob);
  ctx.scale(1.28 * scale, 1.28 * scale);
  ctx.fillStyle = '#e5dac4'; roundRect(ctx, -8, 0, 16, 22, 7); ctx.fill();
  const cap = ctx.createLinearGradient(0, -20, 0, 8);
  cap.addColorStop(0, monster.chasing ? '#fb7185' : '#e14d4d'); cap.addColorStop(1, '#a72e2e');
  ctx.fillStyle = cap;
  ctx.beginPath(); ctx.moveTo(-22, 0); ctx.quadraticCurveTo(-14, -24, 0, -26); ctx.quadraticCurveTo(14, -24, 22, 0); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#fff7ed'; [[-10,-10],[0,-14],[10,-8],[-2,-5],[12,-2]].forEach(([dx,dy])=>{ ctx.beginPath(); ctx.arc(dx, dy, 2.5, 0, Math.PI*2); ctx.fill(); });
  drawMonsterFace(ctx, t, 0, 5, 1);
  ctx.restore();
}

function drawSlimeSprite(ctx, x, y, monster, scale = 1) {
  const t = performance.now() / 1000;
  const squash = 1 + Math.sin(t * 4 + monster.spawnX * .02) * .08;
  drawShadow(ctx, x, y + 22 * scale, 26 * scale, 8 * scale, .24);
  ctx.save();
  ctx.translate(x, y + Math.sin(t * 3) * 3 * scale);
  ctx.scale(scale * 1.25 / squash, scale * 1.25 * squash);
  const g = ctx.createRadialGradient(-6, -8, 4, 0, 0, 30);
  g.addColorStop(0, '#bbf7d0'); g.addColorStop(.55, '#22c55e'); g.addColorStop(1, '#15803d');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(-26, 8); ctx.quadraticCurveTo(-18, -24, 0, -28); ctx.quadraticCurveTo(20, -24, 28, 8); ctx.quadraticCurveTo(14, 24, -16, 20); ctx.quadraticCurveTo(-26, 16, -26, 8); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.ellipse(-9, -12, 7, 4, -.5, 0, Math.PI*2); ctx.fill();
  drawMonsterFace(ctx, t, 0, 4, 1.05);
  ctx.restore();
}

function drawStompSprite(ctx, x, y, monster, scale = 1) {
  const t = performance.now() / 1000;
  const sway = Math.sin(t * 2.2 + monster.spawnX * .01) * .06;
  drawShadow(ctx, x, y + 34 * scale, 34 * scale, 11 * scale, .28);
  ctx.save(); ctx.translate(x, y); ctx.rotate(sway); ctx.scale(scale * 1.15, scale * 1.15);
  const trunk = ctx.createLinearGradient(0, -45, 0, 42); trunk.addColorStop(0, '#a56636'); trunk.addColorStop(1, '#5b321e'); ctx.fillStyle = trunk;
  roundRect(ctx, -24, -38, 48, 78, 18); ctx.fill();
  ctx.fillStyle = '#4b2e1d'; roundRect(ctx, -5, -32, 10, 68, 5); ctx.fill();
  ctx.strokeStyle = 'rgba(255,232,200,.25)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-16,-20); ctx.lineTo(-9,22); ctx.moveTo(14,-26); ctx.lineTo(8,28); ctx.stroke();
  ctx.fillStyle = '#2f1f16'; ctx.beginPath(); ctx.arc(-8, -2, 3, 0, Math.PI*2); ctx.arc(8, -2, 3, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#2f1f16'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 9, 8, 0, Math.PI); ctx.stroke();
  ctx.fillStyle = '#2f6c39'; ctx.beginPath(); ctx.arc(-10, -43, 14, 0, Math.PI*2); ctx.arc(9, -47, 16, 0, Math.PI*2); ctx.arc(24, -33, 13, 0, Math.PI*2); ctx.fill();
  ctx.restore();
}

function drawSnakeSprite(ctx, x, y, monster, scale = 1) {
  const t = performance.now() / 1000;
  const wiggle = Math.sin(t * 5 + monster.spawnX * .02) * 4 * scale;
  drawShadow(ctx, x, y + 24 * scale, 32 * scale, 8 * scale, .25);
  ctx.save(); ctx.translate(x, y); ctx.scale(scale * 1.15, scale * 1.15);
  ctx.strokeStyle = monster.chasing ? '#facc15' : '#84cc16'; ctx.lineWidth = 15; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-28, 18); ctx.quadraticCurveTo(-10 + wiggle, -8, 8, 8); ctx.quadraticCurveTo(24 - wiggle, 24, 34, -10); ctx.stroke();
  ctx.fillStyle = monster.chasing ? '#fef08a' : '#bef264'; ctx.beginPath(); ctx.ellipse(37, -13, 14, 11, -.2, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#111827'; ctx.beginPath(); ctx.arc(33, -15, 2, 0, Math.PI*2); ctx.arc(41, -14, 2, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(50, -12); ctx.lineTo(58, -15); ctx.moveTo(50, -12); ctx.lineTo(58, -9); ctx.stroke();
  ctx.restore();
}

function drawMonsterFace(ctx, t, cx, cy, scale = 1) {
  const blink = (t % 3.9) < .12;
  ctx.fillStyle = '#111827';
  if (blink) {
    ctx.strokeStyle = '#111827'; ctx.lineWidth = 1.3 * scale; ctx.beginPath(); ctx.moveTo(-8 * scale, 6 * scale); ctx.lineTo(-3 * scale, 6 * scale); ctx.moveTo(3 * scale, 6 * scale); ctx.lineTo(8 * scale, 6 * scale); ctx.stroke();
  } else {
    const eye = Math.sin(t * 1.8) * 1 * scale;
    ctx.beginPath(); ctx.arc(-5 * scale + eye, 6 * scale, 2.2 * scale, 0, Math.PI * 2); ctx.arc(5 * scale + eye, 6 * scale, 2.2 * scale, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = '#111827'; ctx.lineWidth = 1.4 * scale; ctx.beginPath(); ctx.arc(0, 11 * scale, 4 * scale, 0, Math.PI); ctx.stroke();
}


function drawPedestal(ctx, x, y, scale = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(255,255,255,.08)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 92 * scale, 30 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawLevelUpAura(ctx, x, y) {
  const fx = game.levelUpEffect;
  if (!fx || Date.now() > fx.until) return;
  const now = performance.now() / 1000;
  const left = Math.max(0, (fx.until - Date.now()) / 2100);
  ctx.save();
  ctx.globalAlpha = Math.min(1, left * 1.35);
  const r = 58 + Math.sin(now * 8) * 8;
  const grad = ctx.createRadialGradient(x, y - 12, 8, x, y - 12, r);
  grad.addColorStop(0, 'rgba(255,255,210,.55)');
  grad.addColorStop(.48, 'rgba(125,211,252,.24)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(x, y - 12, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff4a8';
  for (let i = 0; i < 18; i += 1) {
    const a = now * 2.6 + i * Math.PI * 2 / 18;
    const rr = 28 + (i % 4) * 11 + Math.sin(now * 6 + i) * 5;
    ctx.beginPath(); ctx.arc(x + Math.cos(a) * rr, y - 15 + Math.sin(a) * rr * .58, 2.2 + (i % 3), 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawPlayerSpeechBubble(ctx, x, y) {
  const bubble = game.speechBubble;
  if (!bubble || Date.now() > bubble.until) return;
  const alpha = Math.min(1, Math.max(0, (bubble.until - Date.now()) / 450));
  const text = bubble.text;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.font = '900 15px Noto Sans KR, Jua, system-ui';
  const max = 220;
  const display = text.length > 24 ? text.slice(0, 24) + '…' : text;
  const w = Math.min(max, ctx.measureText(display).width + 36);
  const bx = x - w / 2;
  const by = y - 116;
  ctx.fillStyle = 'rgba(255,255,255,.94)';
  roundRect(ctx, bx, by, w, 34, 14); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.94)';
  ctx.beginPath(); ctx.moveTo(x - 8, by + 31); ctx.lineTo(x, by + 43); ctx.lineTo(x + 8, by + 31); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#102033';
  ctx.fillText(display, x, by + 23);
  ctx.restore();
}


function drawPlayerSprite(ctx, x, y, appearance, klass, state, scale = 1, spec = null) {
  drawShadow(ctx, x, y + 30 * scale, 18 * scale, 6 * scale, .28);
  // [수정] 레벨업/전문화 오라: base drawWorld에서만 그려져 라이브 맵에서 안 보이던 것을
  // 플레이어 스프라이트 자체에 연결해 모든 경로(마을/필드/보스방)에서 표시
  try { if (typeof drawLevelUpAura === 'function') drawLevelUpAura(ctx, x, y); } catch (err) {}
  // [추가] 수호의 오라 악세서리: 캐릭터를 감싸는 은은한 원형 빛 (몸 뒤 레이어)
  const visEqV55 = window.resolveVisualEquipmentV55 ? window.resolveVisualEquipmentV55(state) : (state?.equipment || {});
  const auraItem = visEqV55.accessory ? getItemDefinition(visEqV55.accessory, klass) : null;
  if (auraItem?.look?.type === 'rainbowAura') {
    // [v56] 무지개 오라: 발밑에서 일곱 빛깔 고리가 회전
    const tt = performance.now() / 900;
    const pulse = 1 + Math.sin(performance.now() / 420) * 0.1;
    const COLORS = ['#f87171','#fb923c','#fde047','#4ade80','#38bdf8','#818cf8','#c084fc'];
    ctx.save();
    ctx.lineWidth = 3 * scale;
    for (let i = 0; i < COLORS.length; i++) {
      const a0 = tt + (i / COLORS.length) * Math.PI * 2;
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = COLORS[i];
      ctx.shadowColor = COLORS[i];
      ctx.shadowBlur = 7 * scale;
      ctx.beginPath();
      ctx.ellipse(x, y + 28 * scale, 30 * scale * pulse, 9 * scale * pulse, 0, a0, a0 + Math.PI / 4.2);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 7; i++) {
      const a = tt * 1.6 + (i / 7) * Math.PI * 2;
      ctx.fillStyle = COLORS[i];
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * 30 * scale, y + 28 * scale + Math.sin(a) * 9 * scale, 2.2 * scale, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  } else if (auraItem?.look?.type === 'aura') {
    const pulse = 1 + Math.sin(performance.now() / 480) * 0.08;
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = auraItem.look.color;
    ctx.shadowColor = auraItem.look.color;
    ctx.shadowBlur = 8 * scale;
    ctx.lineWidth = 2 * scale;
    ctx.beginPath(); ctx.ellipse(x, y + 28 * scale, 30 * scale * pulse, 9 * scale * pulse, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.24;
    ctx.lineWidth = 4 * scale;
    ctx.beginPath(); ctx.ellipse(x, y + 28 * scale, 22 * scale * pulse, 6 * scale * pulse, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  if (spec) drawSpecOrbit(ctx, x, y, scale, klass, spec);
  drawHumanoid(ctx, x, y, appearance, klass, state, scale, false, spec);
}

function drawSpecOrbit(ctx, x, y, scale, klass, spec) {
  const t = performance.now() / 1000;
  const orbit = 30 * scale;
  let symbols = [];
  let color = '#e0f2fe';
  if (klass === 'warrior' && spec === '방어') { symbols = ['🛡️']; color = '#93c5fd'; }
  else if (klass === 'warrior' && spec === '무기') { symbols = []; color = '#fb7185'; }
  else if (klass === 'mage' && spec === '냉기') { symbols = ['❄️','◆']; color = '#7dd3fc'; }
  else if (klass === 'mage' && spec === '화염') { symbols = ['🔥','✦']; color = '#fb923c'; }
  else if (klass === 'priest' && spec === '암흑') { symbols = ['●','✧']; color = '#a78bfa'; }
  else if (klass === 'priest' && spec === '신성') { symbols = ['✦','○']; color = '#fde68a'; }
  if (!symbols.length) return;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = `${Math.round(13 * scale)}px Noto Sans KR, system-ui`;
  symbols.forEach((sym, i) => {
    const a = t * 2.2 + i * Math.PI * 2 / symbols.length;
    const ox = x + Math.cos(a) * orbit;
    const oy = y - 8 * scale + Math.sin(a) * orbit * .42;
    ctx.globalAlpha = .88;
    ctx.fillStyle = color;
    if (/[◆●○✦✧]/.test(sym)) { ctx.beginPath(); ctx.arc(ox, oy, 4.5 * scale, 0, Math.PI * 2); ctx.fill(); }
    else ctx.fillText(sym, ox, oy);
  });
  ctx.restore();
}

function drawHumanoid(ctx, x, y, appearance, klass, state, scale = 1, isNpc = false, spec = null) {
  ctx.save();
  ctx.translate(x, y);
  const t = performance.now() / 1000;
  const moving = !!state.moving;
  const breath = Math.sin(t * 2.4 + (isNpc ? 1.1 : 0)) * 1.5 * scale;
  const walkBob = moving ? Math.abs(Math.sin(t * 9)) * -3 * scale : 0;
  const dancing = (state.dance || 0) > 0;
  const danceHop = dancing ? Math.sin(t * 18) * 8 * scale : 0;
  const danceLean = dancing ? Math.sin(t * 10) * 0.24 : 0;
  ctx.translate(0, breath + walkBob + danceHop);
  if (dancing) ctx.rotate(danceLean);
  const swing = state.attack > 0 ? Math.sin(performance.now() / 55) * 0.35 : (dancing ? Math.sin(t * 12) * .55 : 0);
  const legSwing = moving ? Math.sin(t * 10) * 4 * scale : (dancing ? Math.sin(t * 12) * 5 * scale : 0);
  const blink = (t % 4.7) < 0.11;
  const eyeShift = Math.sin(t * 1.6) * 0.9 * scale;
  // [v55] 코스튬: 성능은 원래 장비 유지, 보이는 모습만 코스튬으로 교체
  const equipment = (!isNpc && window.resolveVisualEquipmentV55)
    ? window.resolveVisualEquipmentV55(state)
    : (state.equipment || {});
  const headItem = equipment.head ? getItemDefinition(equipment.head, klass) : null;
  const armorItem = equipment.armor ? getItemDefinition(equipment.armor, klass) : null;
  const accessoryItem = equipment.accessory ? getItemDefinition(equipment.accessory, klass) : null;
  const skin = appearance.skin || '#f1d2b6';
  const shirt = appearance.shirt;
  const pants = appearance.pants;
  const hair = appearance.hair;
  const armY = 2 * scale;

  const hairStyle = appearance.hairStyle || 'short';

  // back hair silhouettes for longer randomized styles. Drawn before torso so it sits behind clothes.
  ctx.fillStyle = hair;
  if (hairStyle === 'crop' || hairStyle === 'buzz' || hairStyle === 'spiky' || hairStyle === 'sidePart' || hairStyle === 'shortWave') {
    // short styles stay close to the head and do not cover the body.
  }
  if (hairStyle === 'long') {
    ctx.beginPath(); ctx.ellipse(-11 * scale, -13 * scale, 7 * scale, 15 * scale, -.12, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(11 * scale, -13 * scale, 7 * scale, 15 * scale, .12, 0, Math.PI * 2); ctx.fill();
    roundRect(ctx, -9 * scale, -26 * scale, 18 * scale, 19 * scale, 10 * scale); ctx.fill();
  } else if (hairStyle === 'bob') {
    roundRect(ctx, -14 * scale, -24 * scale, 28 * scale, 17 * scale, 12 * scale); ctx.fill();
  } else if (hairStyle === 'ponytail') {
    ctx.beginPath(); ctx.ellipse(15 * scale, -15 * scale, 7 * scale, 14 * scale, .28, 0, Math.PI * 2); ctx.fill();
  } else if (hairStyle === 'twinTail') {
    ctx.beginPath(); ctx.ellipse(-16 * scale, -14 * scale, 7 * scale, 12 * scale, -.28, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(16 * scale, -14 * scale, 7 * scale, 12 * scale, .28, 0, Math.PI * 2); ctx.fill();
  } else if (hairStyle === 'curlyBob') {
    for (let i = 0; i < 7; i += 1) { ctx.beginPath(); ctx.arc((-12 + i * 4) * scale, (-18 + (i % 2) * 4) * scale, 5 * scale, 0, Math.PI * 2); ctx.fill(); }
  } else if (hairStyle === 'curlyLong') {
    roundRect(ctx, -10 * scale, -26 * scale, 20 * scale, 18 * scale, 12 * scale); ctx.fill();
    [-13, -10, 10, 13].forEach((dx, i) => { ctx.beginPath(); ctx.arc(dx * scale, (-10 + (i % 2) * 3) * scale, 5 * scale, 0, Math.PI * 2); ctx.fill(); });
    [-15, 15].forEach((dx) => { ctx.beginPath(); ctx.ellipse(dx * scale, -4 * scale, 5 * scale, 7 * scale, dx < 0 ? -.25 : .25, 0, Math.PI * 2); ctx.fill(); });
  }


  if (accessoryItem?.look?.type === 'ribbonStreamer') {
    // [v58] 하얀 줄끈: 등 뒤에서 부드럽게 흘러내리는 리본 끈
    const tt = performance.now() / 700;
    ctx.save();
    ctx.lineCap = 'round';
    for (const dir of [-1, 1]) {
      for (let k = 0; k < 2; k++) {
        const phase = tt + dir * 0.6 + k * 0.9;
        const baseX = dir * (5 + k * 3) * scale;
        ctx.strokeStyle = k === 0 ? 'rgba(255,255,255,.95)' : 'rgba(226,232,240,.8)';
        ctx.lineWidth = (2.6 - k * 0.7) * scale;
        ctx.beginPath();
        ctx.moveTo(baseX, -4 * scale);
        ctx.bezierCurveTo(
          baseX + dir * (9 + Math.sin(phase) * 3) * scale, 6 * scale,
          baseX + dir * (3 + Math.sin(phase * 1.3) * 5) * scale, 16 * scale,
          baseX + dir * (12 + Math.sin(phase * 0.8) * 4) * scale, 26 * scale,
        );
        ctx.stroke();
      }
    }
    // 어깨 매듭
    ctx.fillStyle = 'rgba(255,255,255,.97)';
    ctx.beginPath(); ctx.ellipse(-5 * scale, -5 * scale, 2.6 * scale, 1.9 * scale, -0.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(5 * scale, -5 * scale, 2.6 * scale, 1.9 * scale, 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(241,245,249,.9)';
    ctx.beginPath(); ctx.arc(0, -5 * scale, 1.7 * scale, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  if (accessoryItem?.look?.type === 'angelWing') {
    // [v56] 천사 날개: 깃털이 층층이 겹친 진짜 날개 실루엣
    const flap = Math.sin(performance.now() / 520) * 0.16;
    for (const dir of [-1, 1]) {
      ctx.save();
      ctx.translate(dir * 13 * scale, 0);
      ctx.rotate(dir * (0.28 + flap));
      for (let layer = 0; layer < 3; layer++) {
        const len = (32 - layer * 5) * scale;
        const spread = (19 - layer * 3.2) * scale;
        ctx.fillStyle = layer === 0 ? 'rgba(255,255,255,.97)' : (layer === 1 ? 'rgba(241,245,249,.93)' : 'rgba(219,234,254,.9)');
        ctx.beginPath();
        ctx.moveTo(0, 6 * scale - layer * 3 * scale);
        for (let f = 0; f < 4; f++) {
          const px = dir * (spread * (f + 1) / 4) * 1.7;
          const py = 6 * scale - len * (f + 1) / 4;
          ctx.quadraticCurveTo(px * 1.3, py + 5 * scale, px, py);
        }
        ctx.quadraticCurveTo(dir * spread * 0.8, 2 * scale, 0, 9 * scale - layer * 3 * scale);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(191,219,254,.55)'; ctx.lineWidth = 0.8 * scale; ctx.stroke();
      }
      ctx.restore();
    }
    ctx.save(); ctx.globalAlpha = .35; ctx.fillStyle = '#fef9c3';
    ctx.beginPath(); ctx.ellipse(0, 0, 22 * scale, 20 * scale, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  const wingLook = accessoryItem?.look?.type === 'wing' ? accessoryItem.look : null;
  if (appearance.accessory === 'wing' || wingLook || accessoryItem?.id === 'featherWing' || accessoryItem?.id === 'sixthWing') {
    ctx.fillStyle = wingLook?.color || (accessoryItem?.id === 'sixthWing' ? 'rgba(196,181,253,.94)' : 'rgba(255,255,255,.92)');
    ctx.beginPath(); ctx.ellipse(-14 * scale, 4 * scale, 10 * scale, 16 * scale, -.65, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(14 * scale, 4 * scale, 10 * scale, 16 * scale, .65, 0, Math.PI * 2); ctx.fill();
  }

  const cloakLook = armorItem?.look?.type === 'cloak' ? armorItem.look : null;
  if (appearance.accessory === 'cape' || cloakLook || armorItem?.id === 'forestCloak' || armorItem?.id === 'starCape') {
    const cloakColor = cloakLook?.color || (armorItem?.id === 'starCape' ? '#4c1d95' : (armorItem?.id === 'forestCloak' ? '#166534' : '#7c3aed'));
    const wave = Math.sin(t * 3.2) * 4 * scale;
    ctx.fillStyle = cloakColor;
    ctx.beginPath();
    ctx.moveTo(-10 * scale, -2 * scale);
    ctx.quadraticCurveTo(-28 * scale + wave, 8 * scale, -24 * scale + wave, 30 * scale);
    ctx.quadraticCurveTo(-8 * scale, 24 * scale, 5 * scale, 18 * scale);
    ctx.quadraticCurveTo(1 * scale, 6 * scale, -10 * scale, -2 * scale);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = .35;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.ellipse(-15 * scale + wave * .25, 14 * scale, 3 * scale, 9 * scale, -.2, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // legs
  ctx.fillStyle = pants;
  roundRect(ctx, -9 * scale, 16 * scale + legSwing, 7 * scale, 16 * scale, 4 * scale); ctx.fill();
  roundRect(ctx, 2 * scale, 16 * scale - legSwing, 7 * scale, 16 * scale, 4 * scale); ctx.fill();

  // arms
  ctx.strokeStyle = skin;
  ctx.lineWidth = 6 * scale;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-9 * scale, armY);
  ctx.lineTo(-16 * scale - (moving ? legSwing * .4 : 0), 10 * scale);
  ctx.moveTo(9 * scale, armY);
  ctx.lineTo(16 * scale + swing * 10 * scale + (moving ? legSwing * .4 : 0), 8 * scale - swing * 2 * scale);
  ctx.stroke();

  // body
  ctx.fillStyle = shirt;
  roundRect(ctx, -12 * scale, -4 * scale, 24 * scale, 24 * scale, 8 * scale);
  ctx.fill();

  if (appearance.accessory === 'scarf') {
    ctx.fillStyle = '#fde68a';
    roundRect(ctx, -10 * scale, -4 * scale, 20 * scale, 5 * scale, 3 * scale); ctx.fill();
  }

  // [추가] 가슴 계열 착용 외형: 흉갑(갑옷) / 목걸이·배지(악세서리)
  if (armorItem?.look?.type === 'sailorSuit') {
    // [v56] 세일러 교복: 흰 상의 + 남색 카라 + 붉은 스카프 + 주름치마
    ctx.fillStyle = '#f8fafc';
    roundRect(ctx, -11 * scale, -8 * scale, 22 * scale, 20 * scale, 5 * scale); ctx.fill();
    ctx.fillStyle = armorItem.look.color || '#1d4ed8';
    ctx.beginPath();
    ctx.moveTo(-11 * scale, -8 * scale); ctx.lineTo(11 * scale, -8 * scale);
    ctx.lineTo(9 * scale, -1 * scale); ctx.lineTo(0, 4 * scale); ctx.lineTo(-9 * scale, -1 * scale);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#f8fafc';
    roundRect(ctx, -10 * scale, -7 * scale, 20 * scale, 2 * scale, 1 * scale); ctx.fill();
    ctx.fillStyle = '#ef4444';
    ctx.beginPath(); ctx.moveTo(0, 1 * scale); ctx.lineTo(-3 * scale, 7 * scale); ctx.lineTo(3 * scale, 7 * scale); ctx.closePath(); ctx.fill();
    ctx.fillStyle = armorItem.look.color || '#1d4ed8';
    const pleat = Math.sin(t * 3) * 1.2 * scale;
    ctx.beginPath();
    ctx.moveTo(-11 * scale, 11 * scale); ctx.lineTo(11 * scale, 11 * scale);
    ctx.lineTo(14 * scale + pleat, 24 * scale); ctx.lineTo(-14 * scale + pleat, 24 * scale);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 0.9 * scale;
    for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(i * 3.4 * scale, 11 * scale); ctx.lineTo(i * 4.4 * scale + pleat, 24 * scale); ctx.stroke(); }
  } else if (armorItem?.look?.type === 'starryRobe') {
    // [v56] 별무리 로브: 밤하늘 그라데이션 + 반짝이는 별 + 흐르는 은하수
    const gradR = ctx.createLinearGradient(0, -10 * scale, 0, 26 * scale);
    gradR.addColorStop(0, '#312e81'); gradR.addColorStop(.55, '#1e1b4b'); gradR.addColorStop(1, '#0b1027');
    ctx.fillStyle = gradR;
    ctx.beginPath();
    ctx.moveTo(-11 * scale, -8 * scale);
    ctx.quadraticCurveTo(-17 * scale, 10 * scale, -15 * scale, 26 * scale);
    ctx.lineTo(15 * scale, 26 * scale);
    ctx.quadraticCurveTo(17 * scale, 10 * scale, 11 * scale, -8 * scale);
    ctx.closePath(); ctx.fill();
    ctx.save(); ctx.clip();
    ctx.globalAlpha = .34; ctx.fillStyle = '#a5b4fc';
    ctx.beginPath();
    ctx.ellipse(-2 * scale, 12 * scale, 15 * scale, 5 * scale, -0.5 + Math.sin(t) * 0.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    for (let i = 0; i < 9; i++) {
      const sx = ((i * 37) % 26 - 13) * scale;
      const sy = (-6 + ((i * 53) % 30)) * scale;
      const tw = 0.45 + 0.55 * Math.abs(Math.sin(t * 1.6 + i));
      ctx.globalAlpha = tw; ctx.fillStyle = i % 3 === 0 ? '#fde68a' : '#e0e7ff';
      const r = (i % 3 === 0 ? 1.5 : 1) * scale;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
      if (i % 4 === 0) { ctx.fillRect(sx - r * 2.4, sy - r * .28, r * 4.8, r * .56); ctx.fillRect(sx - r * .28, sy - r * 2.4, r * .56, r * 4.8); }
    }
    ctx.globalAlpha = 1; ctx.restore();
    ctx.strokeStyle = 'rgba(196,181,253,.65)'; ctx.lineWidth = 1.1 * scale;
    ctx.beginPath(); ctx.moveTo(-11 * scale, -8 * scale); ctx.lineTo(11 * scale, -8 * scale); ctx.stroke();
  } else if (armorItem?.look?.type === 'peachDress') {
    // [v56] 복숭아 드레스: 3단 프릴 + 허리 리본 + 어깨 퍼프
    const sway = Math.sin(t * 2.6) * 1.6 * scale;
    ctx.fillStyle = armorItem.look.color || '#fda4af';
    roundRect(ctx, -10 * scale, -8 * scale, 20 * scale, 16 * scale, 6 * scale); ctx.fill();
    ctx.fillStyle = '#fecdd3';
    ctx.beginPath(); ctx.arc(-10 * scale, -4 * scale, 4.6 * scale, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(10 * scale, -4 * scale, 4.6 * scale, 0, Math.PI * 2); ctx.fill();
    const tiers = [[8, 13, 16], [13, 19, 21], [19, 26, 25]];
    tiers.forEach(([y0, y1, w], i) => {
      ctx.fillStyle = i % 2 === 0 ? (armorItem.look.color || '#fda4af') : '#fecdd3';
      ctx.beginPath();
      ctx.moveTo(-(w - 4) * scale, y0 * scale);
      ctx.lineTo((w - 4) * scale, y0 * scale);
      ctx.quadraticCurveTo((w + 1) * scale + sway, (y0 + y1) / 2 * scale, w * scale + sway, y1 * scale);
      for (let f = 3; f >= -3; f--) {
        ctx.quadraticCurveTo(f * (w / 3.2) * scale + sway, (y1 + 2.2) * scale, (f - 0.5) * (w / 3.2) * scale + sway, y1 * scale);
      }
      ctx.quadraticCurveTo(-(w + 1) * scale + sway, (y0 + y1) / 2 * scale, -(w - 4) * scale, y0 * scale);
      ctx.closePath(); ctx.fill();
    });
    ctx.fillStyle = '#fb7185';
    roundRect(ctx, -10 * scale, 6 * scale, 20 * scale, 3.4 * scale, 1.6 * scale); ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, 7.6 * scale); ctx.lineTo(-5 * scale, 4 * scale); ctx.lineTo(-5 * scale, 11 * scale); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, 7.6 * scale); ctx.lineTo(5 * scale, 4 * scale); ctx.lineTo(5 * scale, 11 * scale); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff1f2';
    ctx.beginPath(); ctx.arc(0, 7.6 * scale, 2 * scale, 0, Math.PI * 2); ctx.fill();
  } else if (armorItem?.look?.type === 'robe') {
    // [피드백] 사제 제의: 망토가 아니라 '입는 옷' — 몸통 덮개 + 아랫단 치마
    ctx.fillStyle = armorItem.look.color;
    roundRect(ctx, -12 * scale, -4 * scale, 24 * scale, 20 * scale, 7 * scale); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-11 * scale, 14 * scale);
    ctx.lineTo(11 * scale, 14 * scale);
    ctx.lineTo(14 * scale, 28 * scale);
    ctx.lineTo(-14 * scale, 28 * scale);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = .3; ctx.fillStyle = '#ffffff';
    roundRect(ctx, -12 * scale, -4 * scale, 24 * scale, 5 * scale, 4 * scale); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 1.4 * scale;
    ctx.beginPath(); ctx.moveTo(0, -2 * scale); ctx.lineTo(0, 26 * scale); ctx.stroke();
  }
  if (armorItem?.look?.type === 'chestplate') {
    ctx.fillStyle = armorItem.look.color;
    roundRect(ctx, -12 * scale, -4 * scale, 24 * scale, 16 * scale, 6 * scale); ctx.fill();
    ctx.globalAlpha = .30; ctx.fillStyle = '#ffffff';
    roundRect(ctx, -12 * scale, -4 * scale, 24 * scale, 5 * scale, 4 * scale); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1.5 * scale;
    ctx.beginPath(); ctx.moveTo(0, -3 * scale); ctx.lineTo(0, 11 * scale); ctx.stroke();
  }
  if (accessoryItem?.look?.type === 'butterflyRibbon') {
    // [v56] 나비 리본: 목에 매는 큼직한 리본 (날개가 살짝 파닥임)
    const wob = Math.sin(performance.now() / 420) * 0.1;
    ctx.save();
    ctx.translate(0, -3 * scale);
    ctx.rotate(wob);
    const col = accessoryItem.look.color || '#f9a8d4';
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-9 * scale, -6 * scale, -8.5 * scale, 0.4 * scale);
    ctx.quadraticCurveTo(-9 * scale, 6.4 * scale, 0, 1.2 * scale);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(9 * scale, -6 * scale, 8.5 * scale, 0.4 * scale);
    ctx.quadraticCurveTo(9 * scale, 6.4 * scale, 0, 1.2 * scale);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = .45; ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(-5.4 * scale, 0.4 * scale, 2.4 * scale, 1.4 * scale, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(5.4 * scale, 0.4 * scale, 2.4 * scale, 1.4 * scale, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fb7185';
    ctx.beginPath(); ctx.ellipse(0, 0.5 * scale, 2.2 * scale, 2.8 * scale, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 1.5 * scale;
    ctx.beginPath(); ctx.moveTo(-2 * scale, 2.6 * scale); ctx.quadraticCurveTo(-4 * scale, 7 * scale, -1.4 * scale, 9 * scale); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(2 * scale, 2.6 * scale); ctx.quadraticCurveTo(4 * scale, 7 * scale, 1.4 * scale, 9 * scale); ctx.stroke();
    ctx.restore();
  }
  if (accessoryItem?.look?.type === 'necklace') {
    ctx.strokeStyle = 'rgba(226,232,240,.85)'; ctx.lineWidth = 1.6 * scale;
    ctx.beginPath(); ctx.arc(0, -6 * scale, 7 * scale, 0.25 * Math.PI, 0.75 * Math.PI); ctx.stroke();
    const tw = performance.now() / 300;
    ctx.fillStyle = accessoryItem.look.color;
    ctx.save();
    ctx.translate(0, 2 * scale);
    ctx.rotate(tw % (Math.PI * 2) * 0.05);
    const r1 = 3.4 * scale, r2 = 1.5 * scale;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 === 0 ? r1 : r2;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      ctx[i === 0 ? 'moveTo' : 'lineTo'](Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  if (accessoryItem?.look?.type === 'badge') {
    const bx = 6 * scale, by = 0; // [시트] 캐릭터 기준 왼쪽 가슴
    ctx.fillStyle = '#166534';
    ctx.beginPath(); ctx.arc(bx, by, 4 * scale, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = accessoryItem.look.color;
    [[-1.4, 0], [1.4, 0], [0, -1.4], [0, 1.4]].forEach(([dx, dy]) => {
      ctx.beginPath(); ctx.arc(bx + dx * scale, by + dy * scale, 1.6 * scale, 0, Math.PI * 2); ctx.fill();
    });
  }


  // head
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(0, -16 * scale, 12 * scale, 0, Math.PI * 2);
  ctx.fill();

  // hair top and separate bangs; no eye-band shape
  ctx.fillStyle = hair;
  ctx.beginPath();
  ctx.arc(0, -20 * scale, 12 * scale, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(-6 * scale, -22 * scale, 5 * scale, 5 * scale, -.28, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath();
  ctx.ellipse(3 * scale, -23 * scale, 6 * scale, 5 * scale, .18, 0, Math.PI * 2); ctx.fill();
  if (hairStyle === 'spiky') {
    ctx.beginPath(); ctx.moveTo(-10 * scale, -23 * scale); ctx.lineTo(-5 * scale, -34 * scale); ctx.lineTo(0, -23 * scale); ctx.lineTo(5 * scale, -34 * scale); ctx.lineTo(10 * scale, -23 * scale); ctx.closePath(); ctx.fill();
  } else if (hairStyle === 'sidePart') {
    ctx.beginPath(); ctx.ellipse(6 * scale, -21 * scale, 10 * scale, 6 * scale, .35, 0, Math.PI * 2); ctx.fill();
  } else if (hairStyle === 'buzz') {
    ctx.globalAlpha = .82; ctx.beginPath(); ctx.arc(0, -20 * scale, 10 * scale, Math.PI, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
  } else if (hairStyle === 'shortWave') {
    [-8,-3,3,8].forEach((dx,i)=>{ ctx.beginPath(); ctx.arc(dx * scale, (-23 + (i%2)*2) * scale, 4 * scale, 0, Math.PI*2); ctx.fill(); });
  }

  // face: blinking eyes and wandering pupils
  ctx.strokeStyle = '#111827';
  ctx.lineWidth = 1.4 * scale;
  if (blink) {
    ctx.beginPath();
    ctx.moveTo(-7 * scale, -16 * scale); ctx.lineTo(-2 * scale, -16 * scale);
    ctx.moveTo(2 * scale, -16 * scale); ctx.lineTo(7 * scale, -16 * scale);
    ctx.stroke();
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(-4 * scale, -16 * scale, 3.1 * scale, 0, Math.PI * 2); ctx.arc(4 * scale, -16 * scale, 3.1 * scale, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111827';
    ctx.beginPath(); ctx.arc(-4 * scale + eyeShift, -16 * scale, 1.55 * scale, 0, Math.PI * 2); ctx.arc(4 * scale + eyeShift, -16 * scale, 1.55 * scale, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = '#9a3412';
  ctx.lineWidth = 1.2 * scale;
  ctx.beginPath();
  ctx.arc(0, -11 * scale, 4 * scale, 0, Math.PI);
  ctx.stroke();

  // accessory
  if (appearance.accessory === 'hat') {
    ctx.fillStyle = '#2563eb';
    roundRect(ctx, -11 * scale, -31 * scale, 22 * scale, 8 * scale, 3 * scale); ctx.fill();
    roundRect(ctx, -14 * scale, -25 * scale, 28 * scale, 4 * scale, 3 * scale); ctx.fill();
  }
  if (appearance.accessory === 'halo') {
    ctx.strokeStyle = '#fde68a';
    ctx.lineWidth = 3 * scale;
    ctx.beginPath();
    ctx.ellipse(0, -32 * scale, 10 * scale, 4 * scale, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (headItem?.look?.type === 'bunnyEars') {
    // [v56] 토끼 머리띠: 긴 귀 두 짝이 살랑이고 안쪽은 분홍
    const wig = Math.sin(performance.now() / 560) * 0.13;
    const band = headItem.look.color || '#fbcfe8';
    for (const dir of [-1, 1]) {
      ctx.save();
      ctx.translate(dir * 6 * scale, -26 * scale);
      ctx.rotate(dir * (0.2 + wig));
      ctx.fillStyle = '#fdf2f8';
      ctx.beginPath(); ctx.ellipse(0, -11 * scale, 4.2 * scale, 12 * scale, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = band;
      ctx.beginPath(); ctx.ellipse(0, -11 * scale, 2.2 * scale, 8.6 * scale, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(148,163,184,.5)'; ctx.lineWidth = 0.8 * scale;
      ctx.beginPath(); ctx.ellipse(0, -11 * scale, 4.2 * scale, 12 * scale, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    ctx.strokeStyle = band; ctx.lineWidth = 2.6 * scale;
    ctx.beginPath(); ctx.arc(0, -22 * scale, 12.5 * scale, Math.PI * 1.12, Math.PI * -0.12); ctx.stroke();
    ctx.fillStyle = '#fb7185';
    ctx.beginPath(); ctx.arc(-9 * scale, -27 * scale, 2 * scale, 0, Math.PI * 2); ctx.fill();
  } else if (headItem?.look?.type === 'flowerCrown') {
    // [v56] 꽃 화관: 덩굴 위에 5송이 꽃 + 잎사귀
    ctx.strokeStyle = '#4d7c0f'; ctx.lineWidth = 2.2 * scale;
    ctx.beginPath(); ctx.arc(0, -22 * scale, 12.8 * scale, Math.PI * 1.08, Math.PI * -0.08); ctx.stroke();
    const petalColors = ['#fda4af', '#fde68a', '#f9a8d4', '#a7f3d0', '#fdba74'];
    for (let i = 0; i < 5; i++) {
      const a = Math.PI * (1.06 + (i / 4) * 0.88);
      const fx = Math.cos(a) * 12.8 * scale;
      const fy = -22 * scale + Math.sin(a) * 12.8 * scale;
      const sway = Math.sin(performance.now() / 700 + i) * 0.35 * scale;
      ctx.save(); ctx.translate(fx, fy + sway);
      ctx.fillStyle = '#65a30d';
      ctx.beginPath(); ctx.ellipse(-3 * scale, 1.6 * scale, 2.4 * scale, 1.2 * scale, -0.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = petalColors[i];
      for (let pIdx = 0; pIdx < 5; pIdx++) {
        const pa = (pIdx / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(Math.cos(pa) * 2.3 * scale, Math.sin(pa) * 2.3 * scale, 1.9 * scale, 1.5 * scale, pa, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#fef3c7';
      ctx.beginPath(); ctx.arc(0, 0, 1.3 * scale, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  } else if (headItem?.look?.type === 'starCrown') {
    // [v56] 별빛 왕관: 5갈래 왕관 + 큰 별 + 반짝임
    const col = headItem.look.color || '#fde68a';
    const glow = 0.55 + 0.45 * Math.abs(Math.sin(performance.now() / 620));
    ctx.save();
    ctx.shadowColor = col; ctx.shadowBlur = 9 * scale * glow;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(-12 * scale, -24 * scale);
    ctx.lineTo(-12 * scale, -30 * scale); ctx.lineTo(-7 * scale, -26.5 * scale);
    ctx.lineTo(-3 * scale, -33 * scale); ctx.lineTo(0, -27 * scale);
    ctx.lineTo(3 * scale, -33 * scale); ctx.lineTo(7 * scale, -26.5 * scale);
    ctx.lineTo(12 * scale, -30 * scale); ctx.lineTo(12 * scale, -24 * scale);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fffbeb';
    roundRect(ctx, -12 * scale, -25.6 * scale, 24 * scale, 2.6 * scale, 1.2 * scale); ctx.fill();
    // 중앙 큰 별
    ctx.fillStyle = '#fff7ed';
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rr = (i % 2 === 0 ? 4.4 : 1.9) * scale;
      const aa = (i / 10) * Math.PI * 2 - Math.PI / 2;
      ctx[i === 0 ? 'moveTo' : 'lineTo'](Math.cos(aa) * rr, -34 * scale + Math.sin(aa) * rr);
    }
    ctx.closePath(); ctx.fill();
    ctx.restore();
    for (let i = 0; i < 3; i++) {
      const tt = performance.now() / 800 + i * 2.1;
      const sx = Math.cos(tt) * 15 * scale;
      const sy = -30 * scale + Math.sin(tt * 1.4) * 5 * scale;
      ctx.globalAlpha = 0.35 + 0.4 * Math.abs(Math.sin(tt * 2));
      ctx.fillStyle = '#fef9c3';
      ctx.beginPath(); ctx.arc(sx, sy, 1.3 * scale, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else if (headItem?.look?.type === 'nurseCap') {
    // [피드백] 사제 모자: 네모난 높은 관 + 십자 마크
    ctx.fillStyle = headItem.look.color;
    roundRect(ctx, -10 * scale, -40 * scale, 20 * scale, 15 * scale, 2.5 * scale); ctx.fill();
    ctx.globalAlpha = .35; ctx.fillStyle = '#ffffff';
    roundRect(ctx, -10 * scale, -28 * scale, 20 * scale, 3.5 * scale, 2 * scale); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(0,0,0,.2)'; ctx.lineWidth = 1.2 * scale;
    roundRect(ctx, -10 * scale, -40 * scale, 20 * scale, 15 * scale, 2.5 * scale); ctx.stroke();
    // 십자 마크
    ctx.fillStyle = headItem.look.color === '#e2e8f0' ? '#ef4444' : '#ffffff';
    roundRect(ctx, -1.6 * scale, -37.5 * scale, 3.2 * scale, 10 * scale, 1.2 * scale); ctx.fill();
    roundRect(ctx, -5 * scale, -34.2 * scale, 10 * scale, 3.2 * scale, 1.2 * scale); ctx.fill();
  } else if (headItem?.look?.type === 'helm') {
    // 투구: 머리를 감싸는 반구 + 코가드
    ctx.fillStyle = headItem.look.color;
    ctx.beginPath(); ctx.arc(0, -24 * scale, 13 * scale, Math.PI, 0); ctx.fill();
    roundRect(ctx, -13 * scale, -25 * scale, 26 * scale, 5 * scale, 2.5 * scale); ctx.fill();
    ctx.globalAlpha = .35; ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(-4 * scale, -30 * scale, 4 * scale, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  } else if (headItem?.look?.type === 'wizardHat') {
    // 마법 고깔: 챙 + 원뿔
    ctx.fillStyle = headItem.look.color;
    ctx.beginPath(); ctx.ellipse(0, -25 * scale, 16 * scale, 4.5 * scale, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-9 * scale, -26 * scale);
    ctx.quadraticCurveTo(-2 * scale, -34 * scale, 3 * scale, -44 * scale);
    ctx.quadraticCurveTo(6 * scale, -34 * scale, 9 * scale, -26 * scale);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fde68a';
    ctx.beginPath(); ctx.arc(3 * scale, -43 * scale, 1.8 * scale, 0, Math.PI * 2); ctx.fill();
  } else if (headItem?.look?.type === 'hood') {
    // 두건/성관: 머리 둘레 밴드 + 뒷천
    ctx.fillStyle = headItem.look.color;
    ctx.beginPath(); ctx.arc(0, -23 * scale, 13.5 * scale, Math.PI * 1.05, Math.PI * -0.05); ctx.fill();
    roundRect(ctx, -13 * scale, -24 * scale, 26 * scale, 6 * scale, 3 * scale); ctx.fill();
    ctx.globalAlpha = .8;
    ctx.beginPath(); ctx.ellipse(0, -14 * scale, 10 * scale, 6 * scale, 0, 0, Math.PI); ctx.fill();
    ctx.globalAlpha = 1;
  } else if (headItem?.id === 'noviceHat') {
    ctx.fillStyle = '#1d4ed8';
    roundRect(ctx, -12 * scale, -32 * scale, 24 * scale, 9 * scale, 4 * scale); ctx.fill();
    ctx.fillStyle = '#60a5fa';
    roundRect(ctx, -16 * scale, -25 * scale, 32 * scale, 4 * scale, 3 * scale); ctx.fill();
  } else if (headItem?.id === 'honorCrown') {
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.moveTo(-13 * scale, -25 * scale); ctx.lineTo(-7 * scale, -35 * scale); ctx.lineTo(0, -26 * scale); ctx.lineTo(7 * scale, -35 * scale); ctx.lineTo(13 * scale, -25 * scale); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(0, -29 * scale, 2 * scale, 0, Math.PI*2); ctx.fill();
  }

  if (klass === 'warrior' && spec === '무기') {
    const markPulse = Math.sin(t * 5.2) * 1.2 * scale;
    ctx.save();
    ctx.strokeStyle = 'rgba(239,68,68,.86)';
    ctx.lineWidth = 2 * scale;
    ctx.lineCap = 'round';
    [-1, 1].forEach((side) => {
      const bx = side * 16 * scale;
      ctx.beginPath();
      ctx.moveTo(bx, -26 * scale + markPulse);
      ctx.lineTo(bx + side * 5 * scale, -31 * scale - markPulse);
      ctx.moveTo(bx + side * 1 * scale, -20 * scale - markPulse);
      ctx.lineTo(bx + side * 7 * scale, -24 * scale + markPulse);
      ctx.stroke();
    });
    ctx.restore();
  }

  if (klass === 'warrior' && spec === '방어') {
    ctx.fillStyle = '#64748b';
    ctx.strokeStyle = '#bfdbfe';
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    ctx.moveTo(-20 * scale, -2 * scale);
    ctx.lineTo(-10 * scale, -8 * scale);
    ctx.lineTo(0, -2 * scale);
    ctx.lineTo(-3 * scale, 13 * scale);
    ctx.lineTo(-17 * scale, 13 * scale);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
  }

  // [피드백] 강화 등급 잔상: 고급=초록, 희귀=파랑, 에픽=보라, 전설=금색 글로우

  // 무기 레이어: 캐릭터·장비·코스튬 위에 표시 (원래 순서)
  const weaponTierPlayer = !isNpc && game.player?.equipment?.weapon === state.equipment?.weapon
    ? game.player
    : { equipment:state.equipment, weaponUpgrades:state.weaponUpgrades || {} };
  const weaponTierStyle = !isNpc && state.equipment?.weapon
    ? state.weaponTierStyle || getEquippedWeaponTierStyle(weaponTierPlayer)
    : null;
  (function drawEnhanceGlow() {
    if (!(weaponTierStyle && weaponTierStyle.tier > 0)) return;
    const { tier, color, intensity = 0.8 } = weaponTierStyle;
    const anchors = klass === 'mage' ? [22, -12] : klass === 'priest' ? [20, 6] : [24, -2];
    const pulse = 0.55 + Math.sin(performance.now() / 300) * 0.25;
    ctx.save();
    const gx = anchors[0] * scale, gy = anchors[1] * scale;
    const grad = ctx.createRadialGradient(gx, gy, 2 * scale, gx, gy, (10 + tier * 3) * intensity * scale);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = (0.12 + 0.18 * pulse + tier * 0.05) * intensity;
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(gx, gy, (10 + tier * 3) * intensity * scale, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  })();
  ctx.save();
  if (weaponTierStyle && weaponTierStyle.tier > 0) {
    ctx.shadowColor = weaponTierStyle.color;
    ctx.shadowBlur = (4 + weaponTierStyle.tier * 2) * weaponTierStyle.intensity * scale;
    ctx.strokeStyle = weaponTierStyle.color;
    ctx.lineWidth = (1.25 + weaponTierStyle.tier * .3) * weaponTierStyle.intensity * scale;
    ctx.filter = `drop-shadow(0 0 ${Math.max(1, 1 + weaponTierStyle.tier * .45) * weaponTierStyle.intensity * scale}px ${weaponTierStyle.color})`;
  }
  drawWeapon(ctx, klass, scale, swing, isNpc, state.equipment?.weapon, spec, weaponTierStyle);
  ctx.restore();
  // [피드백] 최종 무기 반짝임 이펙트 (미스릴 검/미스릴 지팡이/새벽의 고서)
  (function drawFinalWeaponSparkle() {
    const FINALS = { mithrilSword: '#a5f3fc', mithrilStaff: '#93c5fd', dawnTome: '#fda4a5' };
    const wid = state.equipment?.weapon;
    const color = !isNpc && FINALS[wid];
    if (!color) return;
    const anchors = klass === 'mage' ? [[22, -20], [26, -8], [18, -30]] : klass === 'priest' ? [[20, 2], [26, 10], [16, 12]] : [[24, -6], [30, 4], [20, -16]];
    const tNow = performance.now() / 1000;
    ctx.save();
    anchors.forEach(([ax, ay], i) => {
      const tw = Math.abs(Math.sin(tNow * 2.6 + i * 2.1));
      if (tw < 0.25) return;
      const px = ax * scale + Math.sin(tNow * 1.7 + i * 3) * 3 * scale;
      const py = ay * scale + Math.cos(tNow * 1.3 + i * 2) * 3 * scale;
      const r = (1.4 + tw * 2.2) * scale;
      ctx.globalAlpha = 0.35 + tw * 0.55;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(px, py - r); ctx.quadraticCurveTo(px + r * .28, py - r * .28, px + r, py);
      ctx.quadraticCurveTo(px + r * .28, py + r * .28, px, py + r);
      ctx.quadraticCurveTo(px - r * .28, py + r * .28, px - r, py);
      ctx.quadraticCurveTo(px - r * .28, py - r * .28, px, py - r);
      ctx.fill();
    });
    ctx.restore();
  })();

  ctx.restore();
}

function drawShadow(ctx, x, y, rx, ry, alpha) {
  ctx.save();
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCloud(ctx, x, y, scale) {
  ctx.save();
  ctx.globalAlpha = .32;
  ctx.fillStyle = '#f8fbff';
  [[0,0,20],[20,0,26],[-18,4,18],[38,5,19]].forEach(([dx,dy,r])=>{
    ctx.beginPath(); ctx.arc(x + dx * scale, y + dy * scale, r * scale, 0, Math.PI*2); ctx.fill();
  });
  ctx.restore();
}

function drawMiniIsland(ctx, x, y, scale) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale * .72);
  const grad = ctx.createLinearGradient(0, -80, 0, 120);
  grad.addColorStop(0, '#4d8b56');
  grad.addColorStop(1, '#1d4b2f');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(0, 0, 120, 82, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  return ctx;
}

function screenPair(pair) {
  const p = worldToScreen(pair[0], pair[1]);
  return [p.x, p.y];
}



function updateInteractionHint() {
  const nearest = getNearestInteractable();
  game.interactionHint = nearest ? nearest.label : '포탈과 NPC에 가까이 가면 E로 상호작용';
  $('interactionHint').textContent = game.interactionHint;
}

function dispatchBaseWorldInteraction(nearest) {
  if (!nearest) return false;
  if (nearest.type === 'portal') { openWorldMapModal(); return true; }
  if (nearest.type === 'npc') { openQuestNpc(); return true; }
  if (nearest.type === 'shopDoor') { enterEquipmentShop(); return true; }
  if (nearest.type === 'buildingShopDoor') { enterBuildingShopInterior(); return true; }
  if (nearest.type === 'equipmentShopExit') { window.exitBuildingToTownV23?.('equipment'); return true; }
  if (nearest.type === 'buildingShopExit') { window.exitBuildingToTownV23?.('building'); return true; }
  if (nearest.type === 'stageReturnPortal') { confirmStageReturn(); return true; }
  if (nearest.type === 'bossPortal') { confirmBossPortal(game.currentMap); return true; }
  if (nearest.type === 'bossRoomExit') { returnToStageFromBossRoom(); return true; }
  if (nearest.type === 'weaponShop') {
    if (!window.openQuestNpcIntroV3?.('weapon', () => openShopModal('weapon'))) openShopModal('weapon');
    return true;
  }
  if (nearest.type === 'armorShop') {
    if (!window.openQuestNpcIntroV3?.('armor', () => openShopModal('armor'))) openShopModal('armor');
    return true;
  }
  if (nearest.type === 'buildingShopNpc') {
    if (!window.openQuestNpcIntroV3?.('accessory', () => openBuildingShopModal())) openBuildingShopModal();
    return true;
  }
  if (nearest.type === 'costumeShopNpc') {
    if (!window.openQuestNpcIntroV3?.('costume', () => window.openCostumeShopV55?.())) window.openCostumeShopV55?.();
    return true;
  }
  if (nearest.type === 'hall') { openHallOfFame(); return true; }
  return false;
}


function enterEquipmentShop() {
  if (game.transitionLock && Date.now() < game.transitionLock) return;
  game.transitionLock = Date.now() + 700;
  closeModal();
  game.currentMap = 'equipmentShop';
  game.player.map = 'equipmentShop';
  game.player.x = worldDefs.equipmentShop.playerSpawn.x;
  game.player.y = worldDefs.equipmentShop.playerSpawn.y;
  $('returnTownBtn').classList.remove('hidden');
  updateHud();
  savePlayer();
  playSfx('open');
  appendChatMessage('system', '이동', '장비상점 내부로 들어왔습니다.');
}

function enterBuildingShopInterior() {
  if (game.transitionLock && Date.now() < game.transitionLock) return;
  game.transitionLock = Date.now() + 700;
  closeModal();
  game.currentMap = 'buildingShopInterior';
  game.player.map = 'buildingShopInterior';
  game.player.x = worldDefs.buildingShopInterior.playerSpawn.x;
  game.player.y = worldDefs.buildingShopInterior.playerSpawn.y;
  $('returnTownBtn').classList.remove('hidden');
  updateHud();
  savePlayer();
  playSfx('open');
  appendChatMessage('system', '이동', '특별 상점 내부로 들어왔습니다.');
}

window.enterForest = function enterForest() {
  closeModal();
  showLoadingTransition('고요한 숲으로 이동중입니다.', () => {
    game.currentMap = 'forest';
    game.player.map = 'forest';
    const portals = ensureStagePortals('forest');
    game.player.x = portals.returnPortal.x + 170;
    game.player.y = portals.returnPortal.y + 20;
    game.lastMove = { x: 1, y: 0 };
    resetForestMonsters('forest');
    $('returnTownBtn').classList.remove('hidden');
    updateHud();
    savePlayer();
    appendChatMessage('system', '이동', '고요한 숲에 입장했습니다.');
  });
};

function returnTown() {
  closeModal();
  game.currentMap = 'town';
  game.player.map = 'town';
  game.player.x = worldDefs.town.playerSpawn.x;
  game.player.y = worldDefs.town.playerSpawn.y;
  game.currentCombatMonsterId = null;
  game.currentQuestion = null;
  $('returnTownBtn').classList.add('hidden');
  updateHud();
  savePlayer();
  toast('63마을로 돌아왔습니다.');
}

function returnTownWithLoading(message = '63마을로 귀환중입니다.') {
  closeModal();
  showLoadingTransition(message, () => returnTown());
}

function confirmStageReturn() {
  openModal(`
    <h2>63마을 귀환</h2>
    <div class="panel-card">
      <p>63마을로 돌아가시겠습니까?</p>
      <div class="action-row">
        <button class="primary" onclick="returnTownWithLoading()">예, 돌아가기</button>
        <button class="ghost" onclick="closeModal()">아니오</button>
      </div>
    </div>
  `, { type: 'returnConfirm', pause: true });
}

function confirmBossPortal(mapKey) {
  const label = worldDefs[mapKey]?.label || '보스 방';
  openModal(`
    <h2>보스 방 포탈</h2>
    <div class="panel-card">
      <p><b>${escapeHtml(label)}</b>의 보스 방에 들어가시겠습니까?</p>
      <p class="muted">보스는 도망칠 수 없고, HP와 공격력이 2배입니다.</p>
      <div class="action-row">
        <button class="primary" onclick="enterBossPortal('${mapKey}')">입장하기</button>
        <button class="ghost" onclick="closeModal()">취소</button>
      </div>
    </div>
  `, { type: 'bossConfirm', pause: true });
}

function returnToStageFromBossRoom() {
  const mapKey = game.bossReturnMap || game.player?.bossReturnMap || 'forest';
  game.finalBossPortalUnlocked = false; // [피드백] 방을 나가면 ??? 포탈 소멸
  closeModal();
  showLoadingTransition(`${worldDefs[mapKey]?.label || '사냥터'}로 돌아가는 중입니다.`, () => {
    game.currentMap = mapKey;
    game.player.map = mapKey;
    const portals = ensureStagePortals(mapKey);
    game.player.x = portals.bossPortal.x - 130;
    game.player.y = portals.bossPortal.y + 90;
    resetForestMonsters(mapKey);
    $('returnTownBtn').classList.remove('hidden');
    updateHud();
    savePlayer();
  });
}




window.acceptMushroomQuest = function acceptMushroomQuest() {
  if (getQuestState('mushroom_hunt')) { toast('이미 받은 퀘스트입니다.'); closeModal(); return; }
  acceptQuest('mushroom_hunt');
  playSfx('quest');
  closeModal();
  toast('퀘스트를 수락했습니다! 오른쪽 퀘스트 창을 확인하세요.');
};
window.completeMushroomQuest = function completeMushroomQuest() {
  completeQuest('mushroom_hunt');
  playSfx('quest');
  closeModal();
};
function moveDialogueSelection(dir) {
  if (game.modalState.type !== 'dialogue') return false;
  const buttons = Array.from(document.querySelectorAll('.dialogue-options button'));
  if (!buttons.length) return true;
  game.dialogue.selected = (game.dialogue.selected + dir + buttons.length) % buttons.length;
  renderNpcDialogue();
  return true;
}
function confirmDialogueSelection() {
  if (game.modalState.type !== 'dialogue') return false;
  const buttons = Array.from(document.querySelectorAll('.dialogue-options button'));
  const btn = buttons[game.dialogue.selected || 0];
  if (btn) btn.click();
  return true;
}

function openHallOfFame() {
  if (typeof window.openHallOfFameV52 === 'function') return window.openHallOfFameV52(); // [v52] 시상대형 명예의 전당 모듈로 위임
  const players = getAllPlayers();
  const rows = players.length ? players.map((p, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(p.name)}</td>
      <td>${CLASS_META[p.class].name}</td>
      <td>${escapeHtml(p.spec || '잠김')}</td>
      <td>Lv.${p.level}</td>
      <td>${p.exp}</td>
      <td>${p.gold}</td>
      <td>${p.building}</td>
    </tr>
  `).join('') : '<tr><td colspan="8">등록된 학생이 없습니다.</td></tr>';
  openModal(`
    <h2>명예의 전당 게시판</h2>
    <div class="hall-board">
      <div class="hall-board-inner table-wrap">
        <table class="table">
          <thead>
            <tr><th>순위</th><th>이름</th><th>직업</th><th>전문화</th><th>레벨</th><th>EXP</th><th>Gold</th><th>빌딩</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `, { type: 'hall', pause: true });
}

function openSpecModal() {
  if (!game.player) return;
  if (game.player.level < 5) { toast('전문화는 Lv.5부터 선택할 수 있습니다.'); return; }
  if (game.player.spec) { toast('이미 전문화를 선택했습니다.'); return; }
  const specs = CLASS_META[game.player.class].specs;
  const SPEC_META_V37 = {
    '방어': { icon: '🛡️', desc: '높은 체력 · 보호막 · 피해 감소 중심', grad: 'linear-gradient(160deg, rgba(59,130,246,.30), rgba(15,23,42,.92))', accent: 'rgba(96,165,250,.55)' },
    '무기': { icon: '⚔️', desc: '높은 체력 · 높은 직접 피해 중심', grad: 'linear-gradient(160deg, rgba(239,68,68,.30), rgba(15,23,42,.92))', accent: 'rgba(248,113,113,.55)' },
    '냉기': { icon: '❄️', desc: '공격 시 냉기로 적의 다음 공격 데미지 50% 감소', grad: 'linear-gradient(160deg, rgba(56,189,248,.28), rgba(15,23,42,.92))', accent: 'rgba(56,189,248,.55)' },
    '화염': { icon: '🔥', desc: '치명타 확률 35% · 치명타 피해 300%', grad: 'linear-gradient(160deg, rgba(251,146,60,.30), rgba(127,29,29,.72))', accent: 'rgba(251,146,60,.6)' },
    '신성': { icon: '✨', desc: '피해와 회복을 함께 수행하는 흡수형 전투', grad: 'linear-gradient(160deg, rgba(250,204,21,.28), rgba(15,23,42,.92))', accent: 'rgba(250,204,21,.55)' },
    '암흑': { icon: '🌑', desc: '암흑 중첩을 쌓아 턴마다 강해지는 DOT', grad: 'linear-gradient(160deg, rgba(168,85,247,.30), rgba(15,23,42,.94))', accent: 'rgba(192,132,252,.6)' },
  };
  SPEC_META_V37['화염'].desc = '치명타 확률 최대 45% · 스킬 치명타 피해 최대 300%';
  SPEC_META_V37['신성'].desc = '피해와 회복을 함께 수행하는 흡수형 전투';

  const cards = specs.map((spec) => {
    const m = SPEC_META_V37[spec] || { icon: '✦', desc: '', grad: 'linear-gradient(160deg, rgba(148,163,184,.22), rgba(15,23,42,.92))', accent: 'rgba(148,163,184,.5)' };
    return `<button type="button" class="spec-card-v37" style="--spec-grad:${m.grad};--spec-accent:${m.accent};" onclick="chooseSpec('${spec}')">
      <div class="spec-card-icon-v37">${m.icon}</div>
      <div class="spec-card-name-v37">${spec}</div>
      <div class="spec-card-desc-v37">${m.desc}</div>
      <div class="spec-card-pick-v37">이 전문화 선택</div>
    </button>`;
  }).join('');
  openModal(`
    <div class="spec-modal-v37">
      <h2>전문화 선택</h2>
      <div class="spec-card-grid-v37">${cards}</div>
      <p class="spec-warning-v37">⚠️ 한 번 선택하면 바꿀 수 없습니다.</p>
    </div>
  `, { type: 'spec', pause: true });
}

function enterBaseCombat(monster) {
  if (!monster || !monster.alive) return;
  game.playerAilments = {};
  game.player.combatStatuses = YuksamCombatRules.normalizeCombatStatuses(game.player.combatStatuses);
  game.playerChillTurns = Math.max(0, Number(game.player.combatStatuses.chillTurns) || 0);
  delete game.player.combatStatuses.chillTurns;
  monster.shield = 0; // [패턴] 전투 시작 시 상태 초기화
  monster.chasing = true;
  game.currentCombatMonsterId = monster.id;
  syncAudioFileBgm();
  game.currentQuestion = null;
  game.currentCombatAction = null;
  game.combatShield = 0;
  // [시트개편] 전투별 상태 초기화: 차지/버프/부활/기절/냉기
  game.chargeActive = false;
  game.combatBuffs = {};
  game.bastionUsed = false;
  game.bastionCd = 0;
  monster.stunTurns = 0;
  monster.chillTurns = 0;
  game.combatIntroUntil = Date.now() + 1400;
  game.combatImpact = null;
  ensurePlayerHp();
  game.combatHpDisplay = {
    player: Math.max(0, Math.min(100, Math.round((game.player.hp / game.player.maxHp) * 100))),
    monster: Math.max(0, Math.min(100, Math.round((monster.hp / monster.maxHp) * 100))),
  };
  playSfx('open');
  renderCombatMenu('야생의 적이 나타났다!');
}

const combatEntryPipeline = YuksamCombatEntryPipeline.create({
  enter:({ monster }) => enterBaseCombat(monster),
});

function openCombat(monster) {
  window.cancelClickMovementV1?.();
  return combatEntryPipeline.open({ monster });
}

function currentCombatMonster() {
  const field = game.forestMonsters.find((m) => m.id === game.currentCombatMonsterId);
  if (field) return field;
  // [수정] 최종보스(명진쌤)는 forestMonsters 목록에 없어 전투 시스템이 찾지 못하던
  // 원본부터의 버그 — 보스전이 아예 성립하지 않았다. 최종보스도 인식하게 한다.
  const fb = game.finalTeacherBossV34;
  if (fb && fb.id === game.currentCombatMonsterId) return fb;
  return null;
}

function getQuestionForZone(zoneKey) {
  // [활성 문제집] 선생님이 켜둔 문제집에서만 출제한다.
  // 지역과 보스를 가리지 않고 켜진 문제집 전체를 공통 출제 풀로 사용한다.
  return YuksamCombatRules.selectEnabledQuestion(getWorkbooks(), getQuestions(), Math.random);
}

function renderBaseCombatFrame(message, contentHtml) {
  const monster = currentCombatMonster();
  if (!monster) return;
  const normalizedMonsterStatuses = YuksamCombatRules.normalizeCombatStatuses(monster);
  Object.assign(monster, normalizedMonsterStatuses);
  delete monster.weakenTurns;
  delete monster.chilledTurns;
  const playerHpPct = Math.max(0, Math.min(100, Math.round((game.player.hp / game.player.maxHp) * 100)));
  const monsterHpPct = Math.max(0, Math.min(100, Math.round((monster.hp / monster.maxHp) * 100)));
  if (!game.combatHpDisplay) game.combatHpDisplay = { player: playerHpPct, monster: monsterHpPct };
  const introClass = Date.now() < game.combatIntroUntil ? ' entering' : '';
  const impactPlayer = game.combatImpact?.target === 'player' && Date.now() < game.combatImpact.until ? ' impact' : '';
  const impactMonster = game.combatImpact?.target === 'monster' && Date.now() < game.combatImpact.until ? ' impact' : '';
  const renderRuleBadge = (badge) => `<span tabindex="0" class="combat-badge-v38 ${escapeHtml(badge.key)}" data-tooltip="${escapeHtml(`${badge.label}\n${badge.tooltip}`)}">${escapeHtml(badge.label)}</span>`;
  const mBadges = YuksamCombatRules.buildStatusBadges({
    stunTurns: normalizedMonsterStatuses.stunTurns,
    shield: normalizedMonsterStatuses.shield,
    chillTurns: normalizedMonsterStatuses.chillTurns,
  }).map(renderRuleBadge);
  if (monster.shadowStacks > 0) mBadges.push(`<span tabindex="0" class="combat-badge-v38 shadow" data-tooltip="${escapeHtml('🌑 암흑 ' + monster.shadowStacks + '\n누적되는 지속 데미지, 턴이 끝날때 데미지를 준다.')}">🌑 ${monster.shadowStacks}</span>`);
  const mBadgeHtml = mBadges.length ? `<div class="combat-badges-v38">${mBadges.join('')}</div>` : '';
  const faithRank = getSkillRank('priest_basic_life');
  const faithMissChance = faithRank > 0 ? (SKILL_DEFS.priest_basic_life?.monsterMissChance || [])[faithRank] || 0 : 0;
  const guardianOathReady = getSkillRank('warrior_def_bastion') > 0 && !game.bastionUsed;
  // 맹세 준비 상태는 부활이 가능한 동안에만 표시한다.
  const pBadges = YuksamCombatRules.buildStatusBadges({
    poisonTurns: game.playerAilments?.poisonTurns,
    stunTurns: game.playerAilments?.stunTurns,
    shield: game.combatShield,
    chillTurns: game.playerChillTurns,
    intBuffTurns: game.combatBuffs?.intBuffTurns,
    missChance: faithMissChance,
    guardianOathReady,
  }).map(renderRuleBadge);
  if (game.chargeActive) pBadges.push(`<span class="combat-badge-v38 charge" data-tooltip="다음 공격이 강해집니다.">⚡ 충전</span>`);
  const pBadgeHtml = pBadges.length ? `<div class="combat-badges-v38">${pBadges.join('')}</div>` : '';
  openModal(`
    <h2>전투</h2>
    <div class="combat-layout">
      <div class="combat-stage${introClass}">
        <div class="combat-vs-flash"></div>
        <div class="combat-hpbox player"><b>${escapeHtml(game.player.name)}</b><div>HP ${game.player.hp}/${game.player.maxHp} ${game.combatShield > 0 ? `<span class="shield-badge">🛡 ${game.combatShield}</span>` : ''}</div>${pBadgeHtml}<div class="hpbar"><div id="playerHpFill" class="hpfill" style="width:${game.combatHpDisplay.player}%"></div></div></div>
        <div class="combat-hpbox monster"><b>Lv.${monster.level || 1} ${monster.name}</b><div>HP ${monster.hp}/${monster.maxHp} ${monster.shield > 0 ? `<span class="shield-badge">🛡 ${monster.shield}</span>` : ''}</div>${mBadgeHtml}<div class="hpbar"><div id="monsterHpFill" class="hpfill" style="width:${game.combatHpDisplay.monster}%"></div></div></div>
        <div class="combat-sprite combat-player combat-idle combat-idle-player${impactPlayer}"><canvas id="combatPlayerCanvas" width="230" height="190"></canvas></div>
        <div class="combat-sprite combat-monster combat-idle combat-idle-monster${impactMonster}"><canvas id="combatMonsterCanvas" width="230" height="190"></canvas></div>
      </div>
      <div class="panel-card"><h3>${escapeHtml(message)}</h3>${contentHtml}</div>
    </div>
  `, { type: 'combat', pause: true });
  requestAnimationFrame(() => {
    const pf = $('playerHpFill');
    const mf = $('monsterHpFill');
    if (pf) pf.style.width = playerHpPct + '%';
    if (mf) mf.style.width = monsterHpPct + '%';
    game.combatHpDisplay = { player: playerHpPct, monster: monsterHpPct };
  });
  setTimeout(drawCombatCanvases, 20);
}

const combatFramePipeline = YuksamCombatFramePipeline.create({
  render:({ message, contentHtml }) => renderBaseCombatFrame(message, contentHtml),
});

function renderCombatFrame(message, contentHtml = '') {
  return combatFramePipeline.render({ message, contentHtml });
}





function getSkillCooldown(skillId) {
  return Number(game.player?.skillCooldowns?.[skillId] || 0);
}

function setSkillCooldown(skillId, turns) {
  game.player.skillCooldowns = game.player.skillCooldowns || {};
  game.player.skillCooldowns[skillId] = turns;
}

function tickSkillCooldowns() {
  if (!game.player?.skillCooldowns) return;
  Object.keys(game.player.skillCooldowns).forEach((id) => {
    game.player.skillCooldowns[id] = Math.max(0, Number(game.player.skillCooldowns[id] || 0) - 1);
  });
}



window.chooseCombatAction = function chooseCombatAction(action) {
  if (action === 'skill') {
    const skills = getLearnedActiveSkills();
    if (!skills.length) {
      renderCombatMenu('아직 획득한 액티브 스킬이 없습니다. N키 스킬창에서 스킬을 습득하세요.');
      return;
    }
    const buttons = skills.map((skill) => {
      const cd = getSkillCooldown(skill.id);
      const tip = escapeHtml([skill.active.name, skill.desc || '', `쿨타임 ${skill.active.cooldown || 0}턴`].filter(Boolean).join('\n')).replace(/\n/g, '&#10;');
      return `<button class="primary" data-tooltip="${tip}" ${cd > 0 ? 'disabled' : ''} onclick="chooseActiveSkill('${skill.id}')">${skill.active.name}${cd > 0 ? ` · ${cd}턴` : ''}</button>`;
    }).join('');
    renderCombatFrame('사용할 스킬을 선택하세요.', `<div class="combat-menu">${buttons}<button class="ghost" onclick="renderCombatMenu('무엇을 할까?')">뒤로</button></div>`);
    return;
  }
  game.currentCombatAction = action;
  game.currentQuestion ||= getQuestionForZone(worldDefs[game.currentMap]?.zoneKey || worldDefs.forest.zoneKey);
  if (!game.currentQuestion) {
    game.currentCombatAction = null;
    renderCombatMenu('선생님이 활성화한 문제집이 없습니다.');
    return;
  }
  renderQuestionForCombat('공격');
};

window.chooseActiveSkill = function chooseActiveSkill(skillId) {
  const skill = SKILL_DEFS[skillId];
  if (!skill?.active || !isSkillLearned(skillId)) return;
  const cd = getSkillCooldown(skillId);
  if (cd > 0) { toast(`${skill.active.name}은 ${cd}턴 후 사용할 수 있습니다.`); return; }
  game.currentCombatAction = 'active:' + skillId;
  game.currentQuestion ||= getQuestionForZone(worldDefs[game.currentMap]?.zoneKey || worldDefs.forest.zoneKey);
  if (!game.currentQuestion) {
    game.currentCombatAction = null;
    renderCombatMenu('선생님이 활성화한 문제집이 없습니다.');
    return;
  }
  renderQuestionForCombat(skill.active.name);
};

function renderQuestionForCombat(label) {
  const q = game.currentQuestion || {};
  const choices = Array.isArray(q.choices) && q.choices.length >= 2 ? q.choices.slice(0, 4) : null;
  const answerHtml = choices ? `
      <div class="choice-grid">
        ${choices.map((choice, i) => `<button data-answer-key="${encodeURIComponent(String(choice))}" onclick="submitObjectiveAnswer('${escapeJs(choice)}')"><span class="objective-chip">${i + 1}</span>${escapeHtml(choice)}</button>`).join('')}
      </div>` : `
      <div class="answer-row">
        <input id="combatAnswer" placeholder="정답 입력" onkeydown="if(event.key==='Enter') submitCombatAnswer()" autofocus />
        <button class="primary" onclick="submitCombatAnswer()">정답 제출</button>
      </div>`;
  renderCombatFrame(`${label}을 사용하려면 문제를 맞히세요.`, `
    <div class="combat-question">
      <div class="badge">${label}</div>
      <h3>${escapeHtml(q.q || '문제 없음')}</h3>
      ${answerHtml}
      <div class="action-row"><button class="ghost" onclick="renderCombatMenu('다른 행동을 선택하세요.')">취소</button></div>
    </div>
  `);
  if (!choices) setTimeout(() => $('combatAnswer')?.focus(), 50);
}




function minExpForLevel(level) {
  const lv = Math.max(1, Number(level) || 1);
  if (lv <= 1) return 0;
  return XP_REQUIREMENTS[lv - 1] || 0;
}

function getMonsterExpGain(monster) {
  if (!monster) return 0;
  if ((game.player.level || 1) - (monster.level || 1) >= 2) return 0;
  return monster.exp || 0;
}


function updateStagePortalInteractions() {
  // v11: 사냥터 귀환/보스 포탈은 자동 이동하지 않고 E 상호작용으로 확인창을 띄웁니다.
  return;
}




function runBaseAutoTransition() {
  if (!game.player) return;
  if (game.transitionLock && Date.now() < game.transitionLock) return;
  if (game.currentMap === 'town') {
    const town = worldDefs.town;
    if (distance(game.player, { x: town.shop.doorX, y: town.shop.doorY }) < 42) enterEquipmentShop();
    else if (distance(game.player, { x: town.buildingShop.doorX, y: town.buildingShop.doorY }) < 42) enterBuildingShopInterior();
  } else if (game.currentMap === 'equipmentShop') {
    if (distance(game.player, worldDefs.equipmentShop.exit) < 42) returnTown();
  } else if (game.currentMap === 'buildingShopInterior') {
    if (distance(game.player, worldDefs.buildingShopInterior.exit) < 42) returnTown();
  }
}

function canPlayerMoveTo(x, y) {
  if (game.currentMap === 'bossRoom') {
    const cx = game.width / 2, cy = game.height / 2 + 45;
    const rx = 330, ry = 180;
    if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 1) return false;
  }
  const r = 30;
  return !getCurrentMapColliders().some((col) => circleHitsCollider(x, y, r, col));
}

function circleHitsCollider(cx, cy, r, col) {
  if (col.type === 'circle') return Math.hypot(cx - col.x, cy - col.y) < r + col.r;
  if (col.type === 'rect') {
    const left = col.x - col.w / 2;
    const right = col.x + col.w / 2;
    const top = col.y - col.h / 2;
    const bottom = col.y + col.h / 2;
    const nearestX = clamp(cx, left, right);
    const nearestY = clamp(cy, top, bottom);
    return Math.hypot(cx - nearestX, cy - nearestY) < r;
  }
  return false;
}

function getBaseMapColliders() {
  if (game.currentMap === 'town') {
    const t = worldDefs.town;
    const trees = [[540,540,34],[420,920,30],[740,420,30],[1640,430,32],[1780,980,34],[2040,750,30],[1630,1440,34],[920,1450,32],[520,1400,30],[2070,1320,32],[360,680,24],[1890,570,26]];
    return [
      { type: 'rect', x: t.shop.x, y: t.shop.y + 18, w: t.shop.w * .9, h: t.shop.h * .82 },
      { type: 'rect', x: t.buildingShop.x, y: t.buildingShop.y + 18, w: t.buildingShop.w * .9, h: t.buildingShop.h * .82 },
      { type: 'rect', x: t.hall.x, y: t.hall.y, w: t.hall.w * .86, h: t.hall.h * .72 },
      { type: 'circle', x: t.npc.x, y: t.npc.y, r: 34 },
      ...trees.map(([x,y,r]) => ({ type: 'circle', x, y, r })),
      ...(t.healingWell ? [{ type:'circle', x:t.healingWell.x, y:t.healingWell.y, r:44 }] : []),
    ];
  }
  if (game.currentMap === 'equipmentShop') {
    const s = worldDefs.equipmentShop;
    return [
      { type: 'rect', x: 560, y: 390, w: 310, h: 120 },
      { type: 'rect', x: 1040, y: 390, w: 310, h: 120 },
      { type: 'circle', x: s.genie.x, y: s.genie.y, r: 46 },
      { type: 'circle', x: s.andre.x, y: s.andre.y, r: 46 },
      { type: 'rect', x: 380, y: 610, w: 140, h: 110 },
      { type: 'rect', x: 720, y: 610, w: 140, h: 110 },
      { type: 'rect', x: 900, y: 610, w: 110, h: 120 },
      { type: 'rect', x: 1200, y: 610, w: 110, h: 120 },
    ];
  }
  if (game.currentMap === 'buildingShopInterior') {
    const s = worldDefs.buildingShopInterior;
    return [
      { type: 'circle', x: s.saenari.x, y: s.saenari.y, r: 46 },
      ...(s.sangnam ? [{ type: 'circle', x: s.sangnam.x, y: s.sangnam.y, r: 46 }] : []),
      { type: 'rect', x: 520, y: 560, w: 120, h: 180 },
      { type: 'rect', x: 1080, y: 560, w: 120, h: 180 },
      { type: 'circle', x: 670, y: 330, r: 60 },
      { type: 'circle', x: 930, y: 330, r: 60 },
    ];
  }
  if (game.currentMap === 'bossRoom') {
    return [];
  }
  if (game.currentMap === 'forest') {
    const fPts = (typeof scatterPointsV37 === 'function') ? scatterPointsV37('forestTrees', 26, worldDefs.forest.width, worldDefs.forest.height, 230) : null;
    const trees = fPts ? fPts.map((p) => [p.x, p.y, 22 + p.s * 12]) : Array.from({ length: 26 }, (_, i) => [260 + (i * 101) % 3000, 200 + (i * 149) % 2100, 28 + (i % 4) * 3]);
    return trees.map(([x,y,r]) => ({ type: 'circle', x, y, r }));
  }
  if (game.currentMap === 'desert') {
    const dPts = (typeof scatterPointsV37 === 'function') ? scatterPointsV37('desertCacti', 20, worldDefs.desert.width, worldDefs.desert.height, 230) : null;
    const cacti = dPts ? dPts.map((p) => [p.x, p.y, 18 + p.s * 10]) : Array.from({ length: 20 }, (_, i) => [260 + (i * 173) % 3100, 200 + (i * 131) % 2050, 24 + (i % 3) * 3]);
    return cacti.map(([x,y,r]) => ({ type: 'circle', x, y, r }));
  }
  if (game.currentMap === 'swamp') {
    const sPts = (typeof scatterPointsV37 === 'function') ? scatterPointsV37('swampTrees', 28, worldDefs.swamp.width, worldDefs.swamp.height, 210) : null;
    const trees = sPts ? sPts.map((p) => [p.x, p.y, 18 + p.s * 11]) : Array.from({ length: 28 }, (_, i) => [220 + (i * 137) % 3300, 170 + (i * 191) % 2200, 23 + (i % 4) * 3]);
    return trees.map(([x,y,r]) => ({ type:'circle', x, y, r }));
  }
  return [];
}

const worldNavigationRegistry = YuksamWorldNavigationRegistry.create({
  colliderFallback:() => getBaseMapColliders(),
  transitionFallback:() => runBaseAutoTransition(),
});
function getCurrentMapColliders() { return worldNavigationRegistry.getColliders(); }
function checkAutoTransitions() { worldNavigationRegistry.runTransition(); }

const worldPositionGuardV1 = YuksamWorldNavigationRegistry.createPositionGuard({
  getMap:() => game.currentMap,
  getPosition:() => game.player,
  getBounds:() => {
    const world = worldDefs[game.currentMap];
    if (!world) return null;
    return {
      width:world.width,
      height:world.height,
      minX:38,
      minY:48,
      maxX:world.width - 38,
      maxY:world.height - 48,
    };
  },
  isWalkable:(x, y) => canPlayerMoveTo(x, y),
  getFallback:() => worldDefs[game.currentMap]?.playerSpawn,
  setPosition:(position) => {
    if (!game.player) return;
    game.player.x = position.x;
    game.player.y = position.y;
    game.player.map = game.currentMap;
  },
  step:8,
  nearbyRadius:96,
  maxSearchRadius:640,
});

function reconcileWorldPlayerPositionV1(source = 'frame') {
  if (!game.player) return { recovered:false, reason:'no-player' };
  const result = worldPositionGuardV1.reconcile({ source });
  if (!result.recovered) return result;
  window.cancelClickMovementV1?.({ clearArrivalLock:true });
  game.isMoving = false;
  savePlayer();
  console.warn('[63world] blocked player position recovered', {
    map:game.currentMap,
    reason:result.reason,
    x:result.position.x,
    y:result.position.y,
  });
  return result;
}


let lastSavedPositionAt = 0;
function savePlayerPositionThrottled() {
  const now = Date.now();
  if (now - lastSavedPositionAt < 800) return;
  lastSavedPositionAt = now;
  game.player.map = game.currentMap;
  savePlayer();
}

let clickMovementArrivalLockV1 = null;
let clickInteractHandledV59 = '';
function tryClickInteractOnArrivalV59(state) {
  const target = state?.target;
  if (!target || !game.player) return false;
  const token = `${state.map}:${Math.round(target.x)}:${Math.round(target.y)}`;
  if (clickInteractHandledV59 === token) return false;
  clickInteractHandledV59 = token;
  if (isPaused?.() || game.modalState?.type || game.currentCombatMonsterId) return false;
  const found = worldInteractionRegistry.find?.();
  if (!found?.type) return false;
  try { interact(); } catch { return false; }
  return true;
}
const clickMovementControllerV1 = YuksamClickMovement.createController({
  canvas:game.canvas,
  isActive:() => !!game.player && screens.game.classList.contains('active'),
  isPaused,
  isInCombat:() => !!game.currentCombatMonsterId || game.modalState?.type === 'combat',
  getMap:() => game.currentMap,
  getPlayer:() => game.player,
  getCamera:() => game.camera,
  getWorld:() => worldDefs[game.currentMap],
  getColliders:getCurrentMapColliders,
  canMoveTo:canPlayerMoveTo,
  savePosition:savePlayerPositionThrottled,
  onDirection:(direction, moving) => {
    if (direction.x || direction.y) game.lastMove = direction;
    game.isMoving = moving;
  },
  onStateChange:(state) => {
    game.clickMovement = state;
    if (state) clickMovementArrivalLockV1 = state.map;
    if (state?.moving) clickInteractHandledV59 = '';
    if (state && state.moving === false) tryClickInteractOnArrivalV59(state);
  },
  radius:30,
  cellSize:32,
});
window.cancelClickMovementV1 = function cancelClickMovementV1(options = {}) {
  clickMovementControllerV1.cancel();
  game.clickMovement = null;
  if (options.clearArrivalLock) clickMovementArrivalLockV1 = null;
};

function gameLoop(ts) {
  const dt = ts - game.lastTick;
  game.lastTick = ts;
  // [수정] 프레임 오류 보호막: 한 프레임의 예외로 루프 전체가 영구 정지하지 않게 한다.
  // (??? 맵 프리즈처럼 "모든 게 멈추고 재로그인해도 그대로"인 증상의 근본 안전장치)
  try {
    update(dt || 16);
  } catch (err) {
    console.error('[63world] frame error:', err);
  }
  requestAnimationFrame(gameLoop);
}

function startGame(existing = false, options = {}) {
  if (!game.player) return;
  if (options.loading && !options.skipLoading) {
    showLoadingTransition('63월드로 이동중입니다.', () => startGame(existing, { skipLoading: true }));
    return;
  }
  if (!existing) {
    game.currentMap = 'town';
    game.player.map = 'town';
    game.player.x = worldDefs.town.playerSpawn.x;
    game.player.y = worldDefs.town.playerSpawn.y;
  } else {
    game.currentMap = game.player.map || 'town';
    if (game.currentMap === 'bossRoom') {
      // 재접속 시 보스방 복귀 맵 복원 (저장된 값이 없으면 forest)
      game.bossReturnMap = game.player.bossReturnMap || game.bossReturnMap || 'forest';
      worldDefs.bossRoom.label = game.bossReturnMap === 'desert' ? '황량한 사막 보스 방' : game.bossReturnMap === 'swamp' ? '으스스한 늪지 보스 방' : '고요한 숲 보스 방';
      if (worldDefs[game.bossReturnMap]) worldDefs.bossRoom.zoneKey = worldDefs[game.bossReturnMap].zoneKey;
    }
  }
  if (game.currentMap === 'forest' || game.currentMap === 'desert' || game.currentMap === 'swamp' || game.currentMap === 'bossRoom' || game.currentMap === 'equipmentShop' || game.currentMap === 'buildingShopInterior') $('returnTownBtn').classList.remove('hidden');
  else $('returnTownBtn').classList.add('hidden');
  reconcileWorldPlayerPositionV1('start-game');
  resetForestMonsters(game.currentMap);
  closeModal();
  updateHud();
  showScreen('game');
  window.startPvpUiV1?.();
  playSfx('world');
  savePlayer();
  toast(existing ? '기존 캐릭터로 접속했습니다.' : '63마을에 도착했습니다!');
  appendChatMessage('system', '안내', '채팅은 Enter를 눌러 입력할 수 있습니다.');
}

function canEquip(item, player) {
  if (!item || !player) return false;
  if (item.classOnly && item.classOnly !== player.class) return false;
  if (item.levelReq && Number(player.level || 1) < item.levelReq) return false;
  return true;
}

window.dragItemStart = function dragItemStart(event, index) {
  event.dataTransfer.setData('text/plain', String(index));
  event.dataTransfer.effectAllowed = 'move';
};
window.allowItemDrop = function allowItemDrop(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
};
window.dropItemOnBag = function dropItemOnBag(event, targetIndex) {
  event.preventDefault();
  const fromIndex = Number(event.dataTransfer.getData('text/plain'));
  if (!Number.isFinite(fromIndex) || fromIndex === targetIndex) return;
  const inv = game.player.inventory;
  const item = inv[fromIndex];
  if (!item) return;
  inv.splice(fromIndex, 1);
  const safeTarget = Math.max(0, Math.min(targetIndex, inv.length));
  inv.splice(safeTarget, 0, item);
  savePlayer();
  openCharacterPanel();
  playSfx('open');
};
window.dropItemOnEquip = function dropItemOnEquip(event, slot) {
  event.preventDefault();
  const fromIndex = Number(event.dataTransfer.getData('text/plain'));
  const itemId = game.player.inventory[fromIndex];
  if (!itemId) return;
  const item = getItemDefinition(itemId, game.player.class);
  if (!item || item.slot !== slot) { toast(`${slotLabel(slot)} 칸에 맞는 아이템이 아닙니다.`); return; }
  if (!canEquip(item, game.player)) { toast('이 직업은 해당 장비를 착용할 수 없습니다.'); return; }
  game.player.equipment[slot] = itemId;
  savePlayer();
  updateHud();
  openCharacterPanel();
  playSfx('open');
  toast(`${item.name} 장착 완료!`);
};

function drawCharacterPanelCanvas() {
  const canvas = $('characterPanelCanvas');
  if (!canvas || !game.player) return;
  const c = canvas.getContext('2d');
  c.clearRect(0,0,canvas.width,canvas.height);
  const bg = c.createRadialGradient(canvas.width/2, canvas.height/2, 20, canvas.width/2, canvas.height/2, 150);
  bg.addColorStop(0, 'rgba(92,200,255,.18)');
  bg.addColorStop(1, 'rgba(255,255,255,.02)');
  c.fillStyle = bg; c.fillRect(0,0,canvas.width,canvas.height);
  drawPedestal(c, canvas.width/2, 300, 1.8);
  drawPlayerSprite(c, canvas.width/2, 205, game.player.appearance, game.player.class, { attack: 0, moving: false, equipment: game.player.equipment }, 3.25, game.player.spec);
}

function openStatsModal() { openCharacterPanel(); }
function openEquipmentModal() { openCharacterPanel(); }

function slotLabel(slot) {
  return ({ weapon: '무기', head: '머리', armor: '방어구', accessory: '악세서리' })[slot] || slot;
}



function itemIcon(item) {
  if (!item) return '▫️';
  const map = {
    training_greatsword: '🗡️',
    training_staff: '🔮',
    training_book: '📘',
    bronzeGreatsword: '🗡️',
    ironSword: '⚔️',
    mithrilSword: '💠',
    crystalStaff: '🪄',
    holyBook: '📖',
    noviceHat: '🎩',
    featherWing: '🪽',
    forestCloak: '🟩',
    starCape: '🌌',
    honorCrown: '👑',
    sixthWing: '✨',
  };
  if (map[item.id]) return map[item.id];
  if (item.slot === 'weapon') return item.classOnly === 'mage' ? '🪄' : (item.classOnly === 'priest' ? '📖' : '🗡️');
  if (item.slot === 'head') return '🎩';
  if (item.slot === 'armor') return '🛡️';
  if (item.slot === 'accessory') return '💍';
  return '▫️';
}

function shopItemStatTextV36(item){
  if(!item||!item.stats) return '';
  return Object.entries(item.stats).map(([k,v])=>`${k} +${v}`).join(' \u00b7 ');
}
function shopItemTooltipV36(item, priceLine){
  if(!item) return '';
  const slotLabel = ({ weapon:'\uBB34\uAE30', head:'\uBA38\uB9AC', armor:'\uBC29\uC5B4\uAD6C', accessory:'\uC545\uC138\uC0AC\uB9AC' })[item.slot] || item.slot || '';
  const statText = shopItemStatTextV36(item);
  const reqClass = item.classOnly ? `\uCC29\uC6A9 \uC870\uAC74: ${CLASS_META[item.classOnly]?.name || item.classOnly} \uC804\uC6A9` : '\uCC29\uC6A9 \uC870\uAC74: \uBAA8\uB4E0 \uC9C1\uC5C5';
  const reqLevel = item.levelReq ? `\uD544\uC694 \uB808\uBCA8: Lv.${item.levelReq} \uC774\uC0C1` : '';
  const lines = [item.name, slotLabel, priceLine || '', statText ? `\uC2A4\uD0DC: ${statText}` : '', reqClass, reqLevel, item.desc].filter(Boolean);
  return escapeHtml(lines.join('\n')).replace(/\n/g,'&#10;');
}
function openShopModal(kind = 'all') {
  const kindLabel = kind === 'weapon' ? '무기 상인 의석' : (kind === 'armor' ? '방어구 상인 상미' : '장비상점');
  const items = Object.values(ITEM_DEFS)
    .filter((item) => typeof item.price === 'number')
    .filter((item) => !item.costume) // [v55] 코스튬은 옷 상인 상남 전용
    .filter((item) => kind === 'all' || (kind === 'weapon' ? item.slot === 'weapon' : ['armor', 'head'].includes(item.slot)))
    .filter((item) => !item.classOnly || item.classOnly === game.player.class)
    .map((item) => `
    <div class="shop-item" data-tooltip="${shopItemTooltipV36(item, `${item.price} Gold`)}">
      <div class="badge gold">${item.price} Gold</div>${item.levelReq ? `<div class="badge">Lv.${item.levelReq} 이상</div>` : ''}
      <h3>${itemIcon(item)} ${item.name}</h3>
      <p>${item.desc}</p>
      <p class="muted">${item.classOnly ? CLASS_META[item.classOnly].name + ' 전용' : '모든 직업 사용 가능'}</p>
      <button class="primary wide" onclick="buyItem('${item.id}', '${kind}')">구매</button>
    </div>
  `).join('');
  openModal(`
    <h2>${kindLabel}</h2>
    <div class="resource-balance-banner resource-gold"><span>현재 보유 골드</span><b>🪙 ${game.player.gold}</b></div>
    <div class="shop-grid" style="margin-top:12px">${items}</div>
  `, { type: 'shop', pause: true });
}

window.buyItem = function buyItem(itemId, returnKind = 'all') {
  const item = ITEM_DEFS[itemId];
  if (!item) return;
  if (item.levelReq && game.player.level < item.levelReq) { toast(`Lv.${item.levelReq}부터 구매할 수 있습니다.`); return; }
  if (game.player.gold < item.price) { toast('골드가 부족합니다.'); return; }
  if (game.player.inventory.includes(itemId)) { toast('이미 보유 중인 아이템입니다.'); return; }
  game.player.gold -= item.price;
  game.player.inventory.push(itemId);
  savePlayer();
  updateHud();
  playSfx('coin');
  openShopModal(returnKind);
  toast(`${item.name} 구매 완료!`);
  try { window.recordQuestActionV38 && window.recordQuestActionV38('buy'); } catch {}
};

function openBuildingShopModal() {
  const items = Object.values(BUILDING_ITEM_DEFS).map((item) => `
    <div class="shop-item" data-tooltip="${shopItemTooltipV36(item, `${item.buildingPrice} \uBE4C\uB529`)}">
      <div class="badge gold">${item.buildingPrice} 빌딩</div>${item.levelReq ? `<div class="badge">Lv.${item.levelReq} 이상</div>` : ''}
      <h3 class="special-shop-sign">${itemIcon(item)} ${item.name}</h3>
      <p>${item.desc}</p>
      <p class="muted">악세서리는 소지만 해도 능력치가 소량 오릅니다!</p>
      <button class="primary wide" onclick="buyBuildingItem('${item.id}')">구매</button>
    </div>
  `).join('');
  openModal(`
    <h2>특별 상인 새나리</h2>
    <div class="resource-balance-banner resource-building"><span>현재 보유 빌딩 화폐</span><b>🏢 ${game.player.building}</b></div>
    <div class="shop-grid" style="margin-top:12px">${items}</div>
  `, { type: 'buildingShop', pause: true });
}

window.buyBuildingItem = function buyBuildingItem(itemId) {
  const item = BUILDING_ITEM_DEFS[itemId];
  if (!item) return;
  if (item.levelReq && game.player.level < item.levelReq) { toast(`Lv.${item.levelReq}부터 구매할 수 있습니다.`); return; }
  if (game.player.building < item.buildingPrice) { toast('빌딩 화폐가 부족합니다.'); return; }
  if (game.player.inventory.includes(itemId)) { toast('이미 보유 중인 아이템입니다.'); return; }
  game.player.building -= item.buildingPrice;
  game.player.inventory.push(itemId);
  savePlayer();
  updateHud();
  playSfx('coin');
  openBuildingShopModal();
  toast(`${item.name} 구매 완료!`);
  try { window.recordQuestActionV38 && window.recordQuestActionV38('buy'); if (item.slot === 'accessory') window.recordQuestActionV38?.('buyAccessory'); } catch {}
};

function escapeJs(str) {
  return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function inferSubject(prompt) {
  const n = normalize(prompt);
  if (n.includes('영어')) return '영어';
  if (n.includes('수학') || n.includes('나눗셈') || n.includes('곱셈') || n.includes('소수')) return '수학';
  if (n.includes('과학')) return '과학';
  if (n.includes('국어')) return '국어';
  return '미분류';
}

function makeChoiceQuestion(zone, q, answer, wrongs, source) {
  const choices = shuffleArray([String(answer), ...wrongs.map(String)]).slice(0, 4);
  if (!choices.includes(String(answer))) choices[0] = String(answer);
  return { id: uid(), zone, q, answer: String(answer), choices, source };
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function extractRequestedQuestionCount(prompt) {
  const text = String(prompt || '');
  const explicit = [...text.matchAll(/(\d+)\s*(개|가지|문항|문제)/g)].map((m) => Number(m[1])).filter(Boolean);
  if (explicit.length) return Math.max(1, Math.min(60, explicit[explicit.length - 1]));
  const nums = [...text.matchAll(/\d+/g)].map((m) => Number(m[0])).filter(Boolean);
  if (nums.length) return Math.max(1, Math.min(60, nums[nums.length - 1]));
  return 10;
}

function generateAiQuestions(prompt, zone) {
  const count = extractRequestedQuestionCount(prompt);
  const results = [];
  const lower = normalize(prompt);
  const source = `AI: ${prompt}`;

  if (lower.includes('영어') || lower.includes('영단어') || lower.includes('단어')) {
    const words = [
      ['environment','환경'], ['describe','묘사하다'], ['improve','향상시키다'], ['culture','문화'], ['journey','여행'],
      ['important','중요한'], ['exercise','운동하다'], ['protect','보호하다'], ['museum','박물관'], ['library','도서관'],
      ['neighbor','이웃'], ['future','미래'], ['energy','에너지'], ['healthy','건강한'], ['weather','날씨'],
      ['festival','축제'], ['practice','연습하다'], ['invent','발명하다'], ['history','역사'], ['careful','조심스러운'],
      ['popular','인기 있는'], ['collect','모으다'], ['different','다른'], ['question','질문'], ['answer','대답']
    ];
    const korPool = words.map(([, k]) => k);
    for (let i = 0; i < count; i += 1) {
      const [eng, kor] = words[i % words.length];
      const wrongs = shuffleArray(korPool.filter((k) => k !== kor)).slice(0, 3);
      results.push(makeChoiceQuestion(zone, `다음 영단어의 뜻으로 알맞은 것은?  ${eng}`, kor, wrongs, source));
    }
    return results;
  }

  if (lower.includes('소수의나눗셈') || (lower.includes('소수') && lower.includes('나눗셈'))) {
    const divisors = [0.2, 0.4, 0.5, 0.8, 1.2, 2.5, 4];
    const answers = [0.5, 0.8, 1.2, 1.5, 2, 2.4, 2.5, 3, 4, 5, 6, 8, 10, 12];
    for (let i = 0; i < count; i += 1) {
      const divisor = divisors[i % divisors.length];
      const answer = answers[(i * 3 + 2) % answers.length];
      const dividend = +(divisor * answer).toFixed(2);
      const wrongs = [answer + 1, Math.max(0.1, answer - 0.5), +(answer * 10).toFixed(2)].map(formatNum);
      results.push(makeChoiceQuestion(zone, `${formatNum(dividend)} ÷ ${formatNum(divisor)} = ?`, formatNum(answer), wrongs, source));
    }
    return results;
  }

  if (lower.includes('곱셈')) {
    for (let i = 0; i < count; i += 1) {
      const a = 2 + (i % 8);
      const b = 3 + ((i * 2) % 9);
      const ans = a * b;
      results.push(makeChoiceQuestion(zone, `${a} × ${b} = ?`, ans, [ans + a, Math.max(1, ans - b), ans + 10], source));
    }
    return results;
  }

  if (lower.includes('나눗셈')) {
    for (let i = 0; i < count; i += 1) {
      const b = 2 + (i % 8);
      const ans = 2 + ((i * 3) % 9);
      const a = b * ans;
      results.push(makeChoiceQuestion(zone, `${a} ÷ ${b} = ?`, ans, [ans + 1, Math.max(1, ans - 1), ans + 3], source));
    }
    return results;
  }

  if (lower.includes('덧셈') || lower.includes('수학')) {
    for (let i = 0; i < count; i += 1) {
      const a = 10 + i;
      const b = 3 + (i % 7);
      const ans = a + b;
      results.push(makeChoiceQuestion(zone, `${a} + ${b} = ?`, ans, [ans + 1, Math.max(1, ans - 2), ans + 5], source));
    }
    return results;
  }

  for (let i = 0; i < count; i += 1) {
    results.push(makeChoiceQuestion(zone, `${prompt} - 예시 객관식 문제 ${i + 1}`, `정답${i + 1}`, [`오답A${i + 1}`, `오답B${i + 1}`, `오답C${i + 1}`], source));
  }
  return results;
}

function formatNum(num) {
  if (Number.isInteger(num)) return String(num);
  return String(+Number(num).toFixed(2));
}


function getLearnedSkills() {
  return game.player?.skills || {};
}
function getSkillRank(skillId) {
  const v = getLearnedSkills()[skillId];
  if (v === true) return 1;
  return Math.max(0, Number(v) || 0);
}
function isSkillLearned(skillId) {
  if (skillId === 'root') return true;
  return getSkillRank(skillId) > 0;
}
function getSkillGroupRank(group) {
  return Object.values(SKILL_DEFS).filter((s) => s.mutualGroup === group).reduce((sum, s) => sum + getSkillRank(s.id), 0);
}
function getSkillTotal(ids) {
  return ids.reduce((sum, id) => sum + getSkillRank(id), 0);
}



function bindEvents() {
  clickMovementControllerV1.bind();
  if ($('loginName')) {
    $('loginName').title = CHARACTER_NAME_LIMIT_MESSAGE;
  }
  $('studentLoginBtn').addEventListener('click', () => { resumeAudio(); handleStudentLogin(); });
  if ($('settingsBtn')) $('settingsBtn').addEventListener('click', () => { resumeAudio(); openSettingsModal(); });
  if ($('adminEntryBtn')) $('adminEntryBtn').addEventListener('click', () => { resumeAudio(); openAdminPanel(); });
  if ($('gameSettingsBtn')) $('gameSettingsBtn').addEventListener('click', () => { resumeAudio(); openSettingsModal(); });
  document.addEventListener('pointerdown', resumeAudio, { once: true });
  if ($('adminLoginBtn')) $('adminLoginBtn').addEventListener('click', () => { openAdminPanel(); });
  $('randomizeBtn').addEventListener('click', () => {
    game.currentAppearance = randomAppearance();
    drawPreview();
  });
  $('createCharacterBtn').addEventListener('click', () => {
    const checkedName = validateCharacterName(game.currentName);
    if (!checkedName.ok) { toast(checkedName.message); return; }
    game.currentName = checkedName.name;
    if (!secureStudentAccess.enabled) {
      const stored = readPlayerStorage(game.currentName);
      if (stored.status === 'corrupt') {
        game.player = null;
        toast('저장 데이터가 손상되어 캐릭터를 만들 수 없습니다.');
        return;
      }
    }
    game.player = createNewPlayer(game.currentName);
    savePlayer();
    startGame(false, { loading: true });
    // [v53] 신규 캐릭터 첫 진입 시 튜토리얼
    setTimeout(() => { try { window.startTutorialV53?.(); } catch {} }, 2200);
  });
  $('backLandingBtn').addEventListener('click', () => showScreen('landing'));
  document.querySelectorAll('.classBtn').forEach((btn) => {
    btn.addEventListener('click', () => {
      game.selectedClass = btn.dataset.class;
      document.querySelectorAll('.classBtn').forEach((el) => el.classList.toggle('selected', el === btn));
      drawPreview();
    });
  });

  $('modalClose').addEventListener('click', () => {
    if (game.modalState.type === 'combat') window.escapeCombat();
    else if (game.modalState.type === 'pvpBattle') window.surrenderPvpV1?.();
    else if (game.modalState.type === 'pvpSurrender') window.restorePvpMatchV1?.();
    else closeModal();
  });
  $('chooseSpecBtn').addEventListener('click', () => openSpecModal());
  $('openCharacterPanelBtn').addEventListener('click', () => openCharacterPanel());
  if ($('openSkillTreeBtn')) $('openSkillTreeBtn').addEventListener('click', () => openSkillTreeModal());
  $('testExpBtn').addEventListener('click', () => window.adminApplyCurrentStudentCheatV3?.('exp20'));
  if ($('testExp100Btn')) $('testExp100Btn').addEventListener('click', () => window.adminApplyCurrentStudentCheatV3?.('exp100'));
  $('testGoldBtn').addEventListener('click', () => window.adminApplyCurrentStudentCheatV3?.('gold3000'));
  if ($('testBuildingBtn')) $('testBuildingBtn').addEventListener('click', () => window.adminApplyCurrentStudentCheatV3?.('building200'));
  $('returnTownBtn').addEventListener('click', () => { if (game.currentMap === 'forest' || game.currentMap === 'desert' || game.currentMap === 'swamp') confirmStageReturn(); else if (game.currentMap === 'bossRoom') returnToStageFromBossRoom(); else returnTownWithLoading(); });
  if ($('chatInput')) $('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendChatMessage(); } });

  $('logoutBtn').addEventListener('click', () => {
    window.cancelClickMovementV1({ clearArrivalLock:true });
    savePlayer();
    closePvpClientV1();
    secureStudentAccess.signOut().catch(() => {});
    game.player = null;
    game.currentMap = 'town';
    showScreen('landing');
  });

  YuksamInputRouter.register({ id:'core-game-keydown', type:'keydown', priority:30, handle:(e) => {
    if (screens.game.classList.contains('active')) {
      const k = e.key.toLowerCase();
      const activeTag = document.activeElement?.tagName?.toLowerCase();
      const typing = ['input', 'textarea', 'select'].includes(activeTag);
      if (k === 'e' && ['tutorial', 'pvpTutorial'].includes(game.modalState?.type)) {
        const tutorialNext = document.querySelector('#modalContent [data-tutorial-next-v62="true"]');
        if (tutorialNext) {
          e.preventDefault();
          e.stopImmediatePropagation();
          tutorialNext.click();
          return true;
        }
      }

      const keyMap = { arrowup: 'w', arrowdown: 's', arrowleft: 'a', arrowright: 'd' };
      const moveKey = keyMap[k] || k;
      if (['w', 'a', 's', 'd'].includes(moveKey) && !isPaused() && !typing) {
        e.preventDefault();
        game.keys[moveKey] = true;
      }
      if (k === 'enter' && !typing && !isPaused()) { e.preventDefault(); $('chatInput')?.focus(); return; }
      if (k === 'z' && !typing && !isPaused()) {
        e.preventDefault();
        const now = Date.now();
        if (game.danceCooldownUntil && now < game.danceCooldownUntil) return;
        game.danceTimer = 3000;
        game.danceCooldownUntil = now + 3000;
        return;
      }
      if (k === 'c' && !typing && !isPaused()) { e.preventDefault(); openCharacterPanel(); return; }
      if (k === 'n' && !typing && !isPaused()) { e.preventDefault(); openSkillTreeModal(); return; }
      if (e.code === 'Space' && !typing) {
        e.preventDefault();
        if (!isPaused()) {
          game.attackTimer = 180;
          const nearby = getNearbyMonster(90);
          if (nearby) openCombat(nearby);
        }
      }
      if (k === 'e' && !isPaused() && !typing) interact();
      if (k === 'escape' && !$('modal').classList.contains('hidden')) {
        if (game.modalState.type === 'combat') window.escapeCombat();
        else closeModal();
      }
    }
  }});
  YuksamInputRouter.register({ id:'core-game-keyup', type:'keyup', priority:30, handle:(e) => {
    const k = e.key.toLowerCase();
    const keyMap = { arrowup: 'w', arrowdown: 's', arrowleft: 'a', arrowright: 'd' };
    const moveKey = keyMap[k] || k;
    if (['w', 'a', 's', 'd'].includes(moveKey)) game.keys[moveKey] = false;
  }});
}

function previewLoop() {
  if (screens.creator.classList.contains('active')) drawPreview();
  requestAnimationFrame(previewLoop);
}

getQuestions();
bindEvents();
drawPreview();
drawSplash();
requestAnimationFrame(previewLoop);
requestAnimationFrame(gameLoop);

/* =========================
   v13 refinement patch
   ========================= */


function drawWeapon(ctx, klass, scale, swing, isNpc, itemId = null, spec = null) {
  ctx.save();
  const item = itemId ? getItemDefinition(itemId, klass) : null;
  const variant = item?.id || '';
  if (klass === 'warrior') {
    ctx.translate(18 * scale + swing * 8 * scale, 11 * scale - swing * 4 * scale);
    ctx.rotate(.40 + swing * .75);
    const wood = variant === 'training_greatsword' || variant === 'bronzeGreatsword';
    if (wood) {
      const strong = variant === 'bronzeGreatsword';
      ctx.fillStyle = strong ? '#9a6a34' : '#b9874a';
      roundRect(ctx, -2.6 * scale, -6 * scale, 5.2 * scale, 23 * scale, 2.5 * scale); ctx.fill();
      ctx.fillStyle = strong ? '#6b3f1d' : '#8a5a2b';
      roundRect(ctx, -11 * scale, -7 * scale, 22 * scale, 5 * scale, 3 * scale); ctx.fill();
      ctx.fillStyle = strong ? '#c29152' : '#d6a665';
      ctx.beginPath();
      ctx.moveTo(0, -50 * scale);
      ctx.lineTo(7 * scale, -36 * scale);
      ctx.lineTo(4 * scale, -7 * scale);
      ctx.lineTo(-4 * scale, -7 * scale);
      ctx.lineTo(-7 * scale, -36 * scale);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = strong ? 'rgba(255,237,190,.75)' : 'rgba(255,246,215,.62)';
      ctx.lineWidth = 1.4 * scale;
      ctx.beginPath(); ctx.moveTo(0, -45 * scale); ctx.lineTo(0, -9 * scale); ctx.stroke();
    } else {
      const blade = '#dbe7f3';
      const edge = '#ffffff';
      const guard = '#526071';
      ctx.fillStyle = '#8b4513';
      roundRect(ctx, -3.3 * scale, -6 * scale, 6.6 * scale, 23 * scale, 3 * scale); ctx.fill();
      ctx.fillStyle = guard;
      roundRect(ctx, -13 * scale, -7 * scale, 26 * scale, 6 * scale, 3 * scale); ctx.fill();
      ctx.fillStyle = blade;
      ctx.beginPath();
      ctx.moveTo(0, -54 * scale);
      ctx.lineTo(10 * scale, -34 * scale);
      ctx.lineTo(6 * scale, -7 * scale);
      ctx.lineTo(-6 * scale, -7 * scale);
      ctx.lineTo(-10 * scale, -34 * scale);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = edge;
      ctx.lineWidth = 1.7 * scale;
      ctx.beginPath(); ctx.moveTo(0, -49 * scale); ctx.lineTo(0, -9 * scale); ctx.stroke();
    }
    if (spec === '무기') {
      const t = performance.now() / 1000;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const pulse = 0.42 + Math.sin(t * 6) * 0.12;
      ctx.strokeStyle = `rgba(239,68,68,${pulse})`;
      ctx.lineWidth = 3.2 * scale;
      ctx.beginPath();
      ctx.moveTo(-7 * scale, -48 * scale);
      ctx.quadraticCurveTo(-2 * scale + Math.sin(t*9)*2*scale, -30 * scale, -5 * scale, -10 * scale);
      ctx.moveTo(7 * scale, -45 * scale);
      ctx.quadraticCurveTo(2 * scale + Math.cos(t*8)*2*scale, -28 * scale, 5 * scale, -10 * scale);
      ctx.stroke();
      ctx.strokeStyle = `rgba(248,113,113,${pulse * .75})`;
      ctx.lineWidth = 1.4 * scale;
      ctx.beginPath();
      ctx.moveTo(-10 * scale, -36 * scale); ctx.lineTo(-4 * scale, -30 * scale); ctx.lineTo(-9 * scale, -25 * scale);
      ctx.moveTo(10 * scale, -34 * scale); ctx.lineTo(4 * scale, -28 * scale); ctx.lineTo(9 * scale, -22 * scale);
      ctx.stroke();
      ctx.restore();
    }
  } else if (klass === 'mage') {
    ctx.translate(14 * scale + swing * 6 * scale, 7 * scale);
    ctx.rotate(.15 + swing * .3);
    const staff = variant === 'crystalStaff' ? '#38bdf8' : '#8b5cf6';
    const orb = variant === 'crystalStaff' ? '#e0f2fe' : '#dbeafe';
    ctx.fillStyle = staff;
    roundRect(ctx, -2 * scale, -18 * scale, 4 * scale, 30 * scale, 2 * scale); ctx.fill();
    ctx.fillStyle = orb;
    ctx.beginPath(); ctx.arc(0, -22 * scale, 6 * scale, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.65)'; ctx.lineWidth = 1.5 * scale; ctx.stroke();
  } else {
    ctx.translate(20 * scale + swing * 4 * scale, 6 * scale);
    ctx.rotate(-.10 + swing * .2);
    const cover = variant === 'holyBook' ? '#fde68a' : '#f8fafc';
    ctx.fillStyle = cover;
    roundRect(ctx, -6 * scale, -11 * scale, 16 * scale, 18 * scale, 3 * scale); ctx.fill();
    ctx.strokeStyle = variant === 'holyBook' ? '#f59e0b' : '#93c5fd';
    ctx.lineWidth = 1.5 * scale;
    ctx.strokeRect(-4 * scale, -9 * scale, 12 * scale, 14 * scale);
    ctx.beginPath(); ctx.moveTo(2 * scale, -9 * scale); ctx.lineTo(2 * scale, 5 * scale); ctx.stroke();
  }
  ctx.restore();
}

function drawWeaponTierOutline(ctx, klass, scale, swing, itemId, tierStyle) {
  if (!tierStyle || tierStyle.tier <= 0) return;
  ctx.save();
  ctx.strokeStyle = tierStyle.color;
  ctx.shadowColor = tierStyle.color;
  ctx.shadowBlur = (4 + tierStyle.tier * 2) * tierStyle.intensity * scale;
  ctx.filter = `drop-shadow(0 0 ${Math.max(1, 1 + tierStyle.tier * .45) * tierStyle.intensity * scale}px ${tierStyle.color})`;
  ctx.globalAlpha = .9 * tierStyle.intensity;
  ctx.lineWidth = (1.8 + tierStyle.tier * .35) * tierStyle.intensity * scale;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const item = itemId ? getItemDefinition(itemId, klass) : null;
  const variant = item?.id || '';

  if (klass === 'warrior') {
    ctx.translate(18 * scale + swing * 8 * scale, 11 * scale - swing * 4 * scale);
    ctx.rotate(.40 + swing * .75);
    const wood = variant === 'training_greatsword' || variant === 'bronzeGreatsword';
    ctx.beginPath();
    if (wood) {
      ctx.moveTo(0, -50 * scale);
      ctx.lineTo(7 * scale, -36 * scale);
      ctx.lineTo(4 * scale, -7 * scale);
      ctx.lineTo(-4 * scale, -7 * scale);
      ctx.lineTo(-7 * scale, -36 * scale);
    } else {
      ctx.moveTo(0, -54 * scale);
      ctx.lineTo(10 * scale, -34 * scale);
      ctx.lineTo(6 * scale, -7 * scale);
      ctx.lineTo(-6 * scale, -7 * scale);
      ctx.lineTo(-10 * scale, -34 * scale);
    }
    ctx.closePath();
    ctx.stroke();
  } else if (klass === 'mage') {
    ctx.translate(14 * scale + swing * 6 * scale, 7 * scale);
    ctx.rotate(.15 + swing * .3);
    roundRect(ctx, -2.2 * scale, -18 * scale, 4.4 * scale, 32 * scale, 2 * scale);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -23 * scale, 6.5 * scale, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.translate(20 * scale + swing * 4 * scale, 6 * scale);
    ctx.rotate(-.10 + swing * .2);
    ctx.strokeRect(-4 * scale, -9 * scale, 12 * scale, 14 * scale);
    ctx.beginPath();
    ctx.moveTo(2 * scale, -9 * scale);
    ctx.lineTo(2 * scale, 5 * scale);
    ctx.stroke();
  }
  ctx.restore();
}



window.unequipSlot = function unequipSlot(slot) {
  if (!game.player) return;
  if (slot === 'weapon') game.player.equipment.weapon = defaultWeaponIdForClass(game.player.class);
  else game.player.equipment[slot] = null;
  savePlayer();
  updateHud();
  openCharacterPanel();
  playSfx('open');
  appendChatMessage('system', '장비', `${slotLabel(slot)} 장비를 해제했습니다.`);
};


/* ===== 복원된 기본 정의 (정리 중 오삭제 복구) ===== */
// [추가] 아이템 효과 요약 한 줄 (가방 카드 상시 표기용)
function itemStatShortV36(item) {
  if (!item || !item.stats) return '';
  let s = Object.entries(item.stats).map(([k, v]) => `${k}+${v}`).join(' ');
  if (item.possessStats) s += ' · 소지 ' + Object.entries(item.possessStats).map(([k, v]) => `${k}+${v}`).join(' ');
  return s;
}
// [수정] drawNameLabel — v35 최종보스방이 호출하지만 원본 어디에도 정의된 적 없던 함수.
// 존재하지 않는 함수 호출로 렌더 루프가 죽어 ??? 맵이 프리즈되던 치명 버그(원본부터 존재)의 수정.
function drawNameLabel(ctx, x, y, name, scale = 1) {
  ctx.save();
  ctx.textAlign = 'center';
  const label = String(name || '');
  ctx.font = `900 ${Math.round(14 * scale)}px Noto Sans KR, Jua, system-ui`;
  const w = Math.max(64, ctx.measureText(label).width + 24);
  const yy = y - Math.round(84 * scale);
  ctx.fillStyle = 'rgba(7,16,27,.78)';
  if (typeof roundRect === 'function') { roundRect(ctx, x - w / 2, yy, w, Math.round(24 * scale), 999); ctx.fill(); }
  else { ctx.fillRect(x - w / 2, yy, w, Math.round(24 * scale)); }
  ctx.fillStyle = '#ffd76a';
  ctx.shadowColor = 'rgba(0,0,0,.75)';
  ctx.shadowBlur = 6;
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, yy + Math.round(12 * scale));
  ctx.restore();
}
// [수정] 기반 window.equipItem — v27 래퍼(oldEquipItemV27)가 호출하는 원본. 오삭제로 장착 버튼이 TypeError를 내던 버그 복구.
window.equipItem = function equipItem(itemId) {
  const item = getItemDefinition(itemId, game.player.class);
  if (!item) return;
  if (!canEquip(item, game.player)) { toast('이 직업은 해당 장비를 착용할 수 없습니다.'); return; }
  game.player.equipment[item.slot] = itemId;
  savePlayer();
  updateHud();
  openCharacterPanel();
  playSfx('open');
  toast(`${item.name} 장착 완료!`);
  try { window.recordQuestActionV38 && window.recordQuestActionV38('equip'); } catch {}
};
// [수정] 기반 window.chooseSpec — v24 래퍼(oldChooseSpecV24)가 호출하는 원본. 전문화 선택 불가 버그 복구.
window.chooseSpec = function chooseSpec(spec) {
  game.player.spec = spec;
  savePlayer();
  updateHud();
  closeModal();
  // [추가] 레벨업과 같은 격의 연출: 시네마틱 메시지 + 캐릭터 오라
  game.levelUpEffect = { until: Date.now() + 2100, start: Date.now() };
  showCinematicMessage?.(`${spec} 전문화를 선택하셨습니다!`, '새로운 힘이 깨어납니다 · 스킬창(N)에서 전용 스킬을 배워보세요', 2000);
  appendChatMessage?.('system', '전문화', `${game.player.name}님이 ${spec}의 길을 걷기 시작했습니다!`);
  playSfx?.('quest');
  toast(`${spec} 전문화를 습득했습니다!`);
};
// [수정] rollWeightedPetV34 — v34 IIFE 안에 갇혀 v35 뽑기에서 typeof=undefined → 항상 삐약이만 나오던 버그 복구 (원본에도 있던 버그).
function rollWeightedPetV34() {
  const petDefs = window.PET_DEFS_V27 || {};
  const table = [
    ['chick', 19],
    ['miniMushroom', 19],
    ['dragon', 19],
    ['cat', 19],
    ['dog', 19],
    ['yuksam', 5],
  ].filter(([id]) => petDefs[id]);
  const total = table.reduce((sum, [,w]) => sum + w, 0);
  let r = Math.random() * total;
  for (const [id, w] of table) {
    r -= w;
    if (r <= 0) return id;
  }
  return table[0]?.[0] || Object.keys(petDefs)[0];
}
// v26 IIFE 안에만 있어 v35 스킬창에서 ReferenceError를 내던 헬퍼들 (원본 zip에도 있던 버그의 수정)
function normalizeSpecV26(spec) { return spec === '분노' ? '무기' : (spec || null); }
function currentSpecV26() { return normalizeSpecV26(game.player?.spec); }
function skillIconV26(skill) {
  return skill?.icon || (skill?.kind === 'ultimate' ? '✦' : skill?.kind === 'guard' ? '🛡' : skill?.kind === 'frost' ? '❄' : skill?.kind === 'fire' ? '🔥' : skill?.kind === 'holy' ? '✚' : skill?.kind === 'shadow' ? '☾' : '◆');
}
function skillShortEffectV26(skill) {
  if (!skill) return '';
  if (skill.active) return `액티브 · 쿨타임 ${skill.active.cooldown || 0}턴`;
  return skill.passiveText || Object.entries(skill.bonuses || {}).map(([k,v]) => `${k} +${v}`).join(' · ') || '패시브';
}

function renderBaseWorld() {
  const ctx = game.ctx;
  ctx.clearRect(0, 0, game.width, game.height);
  if (!game.player) return;
  updateCamera();
  if (game.currentMap === 'town') drawTown();
  if (game.currentMap === 'forest') drawForest();
  if (game.currentMap === 'desert') drawDesert();
  if (game.currentMap === 'swamp') window.drawSwamp?.();
  if (game.currentMap === 'bossRoom') drawBossRoom();
  if (game.currentMap === 'equipmentShop') drawEquipmentShopInterior();
  if (game.currentMap === 'buildingShopInterior') drawBuildingShopInterior();
  const ps = worldToScreen(game.player.x, game.player.y);
  drawPlayerSprite(ctx, ps.x, ps.y, game.player.appearance, game.player.class, { attack: game.attackTimer, moving: game.isMoving, dance: game.danceTimer, equipment: game.player.equipment, weaponTierStyle: getEquippedWeaponTierStyle(game.player) }, PLAYER_WORLD_SCALE, game.player.spec);
  drawLevelUpAura(ctx, ps.x, ps.y);
  drawPlayerSpeechBubble(ctx, ps.x, ps.y);
  drawPlayerNameplate(ctx, ps.x, ps.y, game.player);
}

const worldRenderPipeline = YuksamWorldRenderPipeline.create({ fallback:() => renderBaseWorld() });
worldRenderPipeline.registerLayer({
  id:'click-move-target-v1',
  priority:1000,
  render:() => clickMovementControllerV1.drawMarker(game.ctx, worldToScreen),
});
function drawWorld() { return worldRenderPipeline.render({ map:game.currentMap }); }

function drawBossRoom() {
  const ctx = game.ctx;
  const mapKey = game.bossReturnMap || game.player?.bossReturnMap || 'forest';
  const g = ctx.createLinearGradient(0, 0, 0, game.height);
  if (mapKey === 'desert') {
    g.addColorStop(0, '#70421e'); g.addColorStop(.55, '#3f2413'); g.addColorStop(1, '#180f0a');
    ctx.fillStyle = g; ctx.fillRect(0,0,game.width,game.height);
    drawTerrainDots(ctx, worldDefs.bossRoom, '#fde68a', .055, 90, 14);
  } else {
    g.addColorStop(0, '#173d2a'); g.addColorStop(.55, '#0f2418'); g.addColorStop(1, '#07120d');
    ctx.fillStyle = g; ctx.fillRect(0,0,game.width,game.height);
    drawTerrainDots(ctx, worldDefs.bossRoom, '#bbf7d0', .04, 86, 16);
  }
  const cx = game.width / 2, cy = game.height / 2 + 45;
  ctx.save();
  ctx.strokeStyle = mapKey === 'desert' ? 'rgba(250,204,21,.30)' : 'rgba(134,239,172,.30)';
  ctx.fillStyle = mapKey === 'desert' ? 'rgba(120,65,28,.18)' : 'rgba(22,101,52,.18)';
  ctx.lineWidth = 9;
  ctx.beginPath(); ctx.ellipse(cx, cy, 330, 180, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.restore();
  const exit = worldToScreen(worldDefs.bossRoom.exit.x, worldDefs.bossRoom.exit.y);
  drawPortalSprite(ctx, exit.x, exit.y, 24, performance.now()/760, '#22c55e');
  drawFloatingLabel(ctx, exit.x, exit.y - 48, '퇴장 포탈');
  game.forestMonsters.forEach((m) => { if (m.alive) drawMushroomWorld(m); });
  drawTitleLabel(worldDefs.bossRoom.label);
}

function drawCombatCanvases() {
  const pc = $('combatPlayerCanvas');
  const mc = $('combatMonsterCanvas');
  if (pc) {
    const c = pc.getContext('2d'); c.clearRect(0,0,pc.width,pc.height);
    drawPlayerSprite(c, pc.width/2, 140, game.player.appearance, game.player.class, { attack: game.attackTimer, moving: false, equipment: game.player.equipment }, 1.9, game.player.spec);
  }
  if (mc) {
    const c = mc.getContext('2d'); c.clearRect(0,0,mc.width,mc.height);
    const fake = currentCombatMonster();
    if (fake) drawMonsterSprite(c, mc.width/2, 122, fake, 2.2);
  }
}

function getNearbyMonster(range = 42) {
  if (game.currentMap !== 'forest' && game.currentMap !== 'desert' && game.currentMap !== 'bossRoom') return null;
  const now = Date.now();
  const alive = game.forestMonsters.filter((m) => m.alive && now >= m.ignorePlayerUntil);
  let nearest = null;
  let nearestD = Infinity;
  alive.forEach((m) => {
    const d = distance(game.player, m);
    if (d < range && d < nearestD) {
      nearest = m;
      nearestD = d;
    }
  });
  return nearest;
}

function findBaseWorldInteractable() {
  const p = game.player;
  if (game.currentMap === 'town') {
    const town = worldDefs.town;
    if (distance(p, town.portal) < town.portal.r + 48) return { type: 'portal', label: 'E: 포탈 - 사냥터 선택' };
    if (distance(p, town.npc) < 110) return { type: 'npc', label: 'E: 퀘스트 받기' };
    if (distance(p, { x: town.shop.doorX, y: town.shop.doorY }) < 100) return { type: 'shopDoor', label: '빛나는 입구에 접근하면 장비상점으로 이동' };
    if (distance(p, { x: town.buildingShop.doorX, y: town.buildingShop.doorY }) < 100) return { type: 'buildingShopDoor', label: '빛나는 입구에 접근하면 특별 상점으로 이동' };
    if (Math.abs(p.x - town.hall.x) < 200 && Math.abs(p.y - town.hall.y) < 140) return { type: 'hall', label: 'E: 명예의 전당 보기' };
  }
  if (['forest', 'desert', 'swamp'].includes(game.currentMap)) {
    const portals = ensureStagePortals(game.currentMap);
    if (portals && distance(p, portals.returnPortal) < portals.returnPortal.r + 34) return { type: 'stageReturnPortal', label: 'E: 귀환 포탈 - 63마을로 돌아가기' };
    if (portals && distance(p, portals.bossPortal) < portals.bossPortal.r + 38) return { type: 'bossPortal', label: 'E: 보스 방 포탈 - 입장 확인' };
    const nearby = getNearbyMonster(72);
    if (nearby) return { type: 'monster', label: `Space: ${nearby.name}와 전투` };
  }
  if (game.currentMap === 'equipmentShop') {
    const shop = worldDefs.equipmentShop;
    if (distance(p, shop.exit) < 100) return { type: 'equipmentShopExit', label: '출구로 이동하면 마을로 나가기' };
    if (distance(p, shop.genie) < 90) return { type: 'weaponShop', label: 'E: 무기 상인 의석과 대화' };
    if (distance(p, shop.andre) < 90) return { type: 'armorShop', label: 'E: 방어구 상인 상미와 대화' };
  }
  if (game.currentMap === 'buildingShopInterior') {
    const shop = worldDefs.buildingShopInterior;
    if (distance(p, shop.exit) < 100) return { type: 'buildingShopExit', label: '출구로 이동하면 마을로 나가기' };
    if (distance(p, shop.saenari) < 90) return { type: 'buildingShopNpc', label: 'E: 특별 상인 새나리와 대화' };
    if (shop.sangnam && distance(p, shop.sangnam) < 90) return { type: 'costumeShopNpc', label: 'E: 옷 상인 상남과 대화' };
  }
  if (game.currentMap === 'bossRoom') {
    const room = worldDefs.bossRoom;
    if (distance(p, room.exit) < room.exit.r + 18) return { type: 'bossRoomExit', label: 'E: 보스 방에서 나가기' };
    const nearby = getNearbyMonster(92);
    if (nearby) return { type: 'monster', label: `Space: ${nearby.name}와 전투` };
  }
  return null;
}

let worldInteractionBeforeDispatch = () => {};
const worldInteractionRegistry = YuksamWorldInteractionRegistry.create({
  findFallback:() => findBaseWorldInteractable(),
  dispatchFallback:(candidate) => dispatchBaseWorldInteraction(candidate),
  beforeDispatch:(candidate) => worldInteractionBeforeDispatch(candidate),
});
function getNearestInteractable() { return worldInteractionRegistry.find(); }
function interact() { return worldInteractionRegistry.dispatch(); }

function syncAudioFileBgm() {
  initAudio();
  const files = [game.audio.file, game.audio.forestFile, game.audio.desertFile].filter(Boolean);
  const desired = getDesiredAudioFile();
  files.forEach((file) => {
    file.volume = game.settings.bgmEnabled ? Math.min(1, Math.max(0, game.settings.bgmVolume)) : 0;
    if (file === desired) file.play().catch(() => {});
    else file.pause();
  });
}

function update(dt) {
  if (!game.player || !screens.game.classList.contains('active')) return;
  reconcileWorldPlayerPositionV1('base-update');
  if (!isPaused()) {
    const speed = 3.2 * Math.min(dt / 16.67, 2);
    let dx = 0;
    let dy = 0;
    if (game.keys.w) dy -= speed;
    if (game.keys.s) dy += speed;
    if (game.keys.a) dx -= speed;
    if (game.keys.d) dx += speed;
    game.isMoving = !!(dx || dy);
    if (dx || dy) {
      game.lastMove = { x: dx || game.lastMove.x, y: dy || game.lastMove.y };
      const world = worldDefs[game.currentMap];
      const nx = clamp(game.player.x + dx, 38, world.width - 38);
      const ny = clamp(game.player.y + dy, 48, world.height - 48);
      if (canPlayerMoveTo(nx, game.player.y)) game.player.x = nx;
      if (canPlayerMoveTo(game.player.x, ny)) game.player.y = ny;
      savePlayerPositionThrottled();
    }
    checkAutoTransitions();
    if (game.currentMap === 'forest' || game.currentMap === 'desert' || game.currentMap === 'bossRoom') { updateForestMonsters(dt); updateStagePortalInteractions(); }
    if (game.attackTimer > 0) game.attackTimer = Math.max(0, game.attackTimer - dt);
    if (game.danceTimer > 0) game.danceTimer = Math.max(0, game.danceTimer - dt);
  } else {
    game.isMoving = false;
  }
  updateInteractionHint();
  drawWorld();
}

function updateForestMonsters(dt) {
  if (game.currentMap !== 'forest' && game.currentMap !== 'desert' && game.currentMap !== 'bossRoom') return;
  const now = Date.now();
  game.forestMonsters.forEach((m) => {
    if (!m.alive) {
      if (now >= m.respawnAt) {
        m.alive = true;
        m.hp = m.maxHp;
        m.x = m.spawnX;
        m.y = m.spawnY;
        m.ignorePlayerUntil = now + 1500;
        m.chasing = false;
      }
      return;
    }
    if (now < m.ignorePlayerUntil) return;
    const d = distance(game.player, m);
    if (d < m.aggro) m.chasing = true;
    if (m.chasing && !m.elite && d > m.aggro * 1.75) {
      m.chasing = false;
      return;
    }
    if (m.chasing && d > 10) {
      const step = m.speed * Math.min(dt / 16.67, 2);
      m.x += ((game.player.x - m.x) / d) * step;
      m.y += ((game.player.y - m.y) / d) * step;
    }
    if (d < m.r + 32) openCombat(m);
  });
}

function ensureStagePortals(mapKey) {
  if (!['forest', 'desert'].includes(mapKey)) return null;
  if (!game.stagePortals[mapKey]) {
    const world = worldDefs[mapKey];
    // v16: 보스방 포탈은 매번 맵 오른쪽 깊은 구역에 생성하고, y축은 거의 전체 범위에서 난수로 잡습니다.
    const boss = {
      x: randomInt(Math.floor(world.width * 0.78), world.width - 170),
      y: randomInt(180, world.height - 180),
    };
    if (distance(boss, world.playerSpawn) < 1500) {
      boss.x = randomInt(Math.floor(world.width * 0.86), world.width - 130);
      boss.y = Math.random() < 0.5 ? randomInt(180, 420) : randomInt(world.height - 420, world.height - 180);
    }
    game.stagePortals[mapKey] = {
      returnPortal: { x: world.playerSpawn.x, y: world.playerSpawn.y, r: 64 },
      bossPortal: { x: boss.x, y: boss.y, r: 58 },
    };
  }
  return game.stagePortals[mapKey];
}

function drawPlayerNameplate(ctx, x, y, player) {
  const className = CLASS_META[player.class]?.name || '모험가';
  const roleLine = `LV.${player.level} ${player.spec ? player.spec + ' ' : ''}${className}`;
  const line1 = `${player.name}`;
  const top = y + 58;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = '900 18px Jua, Noto Sans KR, system-ui';
  const w = Math.max(ctx.measureText(line1).width, ctx.measureText(roleLine).width) + 34;
  const glow = performance.now() / 1000;
  ctx.shadowColor = 'rgba(0,0,0,.92)';
  ctx.shadowBlur = 8;
  ctx.fillStyle = 'rgba(4,11,22,.82)';
  roundRect(ctx, x - w / 2, top, w, 50, 16); ctx.fill();
  ctx.strokeStyle = `rgba(139,230,255,${0.70 + Math.sin(glow * 2.2) * .10})`;
  ctx.lineWidth = 2;
  roundRect(ctx, x - w / 2, top, w, 50, 16); ctx.stroke();
  ctx.shadowBlur = 5;
  ctx.fillStyle = '#fff7b0';
  ctx.fillText(line1, x, top + 21);
  ctx.font = '900 14px Noto Sans KR, Jua, system-ui';
  ctx.fillStyle = player.spec ? '#7fffd4' : '#d7ecff';
  ctx.fillText(roleLine, x, top + 39);
  ctx.restore();
}

function acceptQuest(id = 'mushroom_hunt') {
  const def = QUEST_DEFS[id];
  if (!game.player.quests) game.player.quests = {};
  game.player.quests[id] = { id, status: 'accepted', progress: 0, target: def.target, acceptedAt: Date.now() };
  savePlayer();
  updateQuestTracker();
}

function canLearnSkill(skill) {
  if (!game.player || !skill) return false;
  if (skill.classOnly && skill.classOnly !== game.player.class) return false;
  if (getSkillRank(skill.id) >= (skill.maxPoints || 1)) return false;
  if ((game.player.skillPoints || 0) < (skill.cost || 1)) return false;
  if (skill.mutualGroup && getSkillGroupRank(skill.mutualGroup) > 0 && getSkillRank(skill.id) === 0) return false;
  if (skill.prereqPoints) {
    for (const [id, need] of Object.entries(skill.prereqPoints)) if (getSkillRank(id) < need) return false;
  }
  if (skill.prereqAny && !skill.prereqAny.some(isSkillLearned)) return false;
  if (skill.prereqTotal && getSkillTotal(skill.prereqTotal.ids || []) < skill.prereqTotal.points) return false;
  const prereq = skill.prereq || [];
  if (prereq.length && !prereq.every(isSkillLearned)) return false;
  return true;
}

function completeQuest(id = 'mushroom_hunt') {
  const q = getQuestState(id);
  const def = QUEST_DEFS[id];
  if (!q || q.status !== 'ready') return;
  q.status = 'completed';
  q.completedAt = Date.now();
  game.player.exp += def.reward.exp;
  game.player.level = computeLevelFromExp(game.player.exp);
  game.player.gold += def.reward.gold;
  game.player.building += def.reward.building;
  savePlayer();
  updateHud();
  toast(`퀘스트 완료! EXP +${def.reward.exp}, Gold +${def.reward.gold}, 빌딩 +${def.reward.building}`);
}

function createDesertMonsters() {
  // v16: 사막도 진입부에는 스톰프, 깊은 오른쪽 구역에는 스네이크가 비슷한 수로 등장합니다.
  const stomps = [
    { x: 820, y: 1600 },
    { x: 1120, y: 1180 },
    { x: 1440, y: 1500 },
    { x: 1760, y: 980 },
    { x: 1940, y: 1780 },
  ].map((p, i) => monsterBase({
    id: 'stomp_' + i,
    type: 'stomp',
    name: '스톰프',
    level: 5,
    x: p.x,
    y: p.y,
    r: 34,
    hp: 15,
    exp: 6,
    gold: 9,
    attack: 4,
    speed: 0.66,
    aggro: 260,
  }));
  const snakes = [
    { x: 2320, y: 560 },
    { x: 2520, y: 1020 },
    { x: 2740, y: 1460 },
    { x: 3040, y: 820 },
    { x: 3180, y: 1840 },
  ].map((p, i) => monsterBase({
    id: 'snake_' + i,
    type: 'snake',
    name: '스네이크',
    level: 7,
    x: p.x,
    y: p.y,
    r: 26,
    hp: 22,
    exp: 9,
    gold: 12,
    attack: 6,
    speed: 0.95,
    aggro: 280,
  }));
  return [...stomps, ...snakes];
}

function createEliteBoss(mapKey) {
  const base = mapKey === 'desert'
    ? { type: 'snake', name: '엘리트 스네이크', level: 7, hp: 44, attack: 12, exp: 18, gold: 24, r: 32 }
    : { type: 'slime', name: '엘리트 슬라임', level: 3, hp: 16, attack: 6, exp: 6, gold: 8, r: 30 };
  const boss = monsterBase({
    id: 'elite_' + mapKey + '_' + uid(),
    ...base,
    x: 820,
    y: 430,
    speed: 0.0,
    aggro: 9999,
  });
  boss.elite = true;
  boss.noEscape = true;
  boss.chasing = true;
  return boss;
}

function createForestMonsters() {
  // v16: 숲 초반에는 버섯돌이, 맵 오른쪽 깊은 구역에는 슬라임이 비슷한 개체수로 등장합니다.
  const mushrooms = [
    { x: 760, y: 1600 },
    { x: 1040, y: 1380 },
    { x: 1320, y: 1660 },
    { x: 1560, y: 1260 },
    { x: 1780, y: 1580 },
    { x: 1980, y: 1360 },
  ].map((p, i) => monsterBase({
    id: 'mushroom_' + i,
    type: 'mushroom',
    name: '버섯돌이',
    level: 1,
    x: p.x,
    y: p.y,
    r: 20,
    hp: randomInt(9, 11),
    exp: 1,
    gold: 2,
    attack: 1,
    speed: 0.92,
    aggro: 220,
  }));
  const slimes = [
    { x: 2280, y: 520 },
    { x: 2520, y: 860 },
    { x: 2700, y: 1230 },
    { x: 2860, y: 1580 },
    { x: 3020, y: 760 },
    { x: 3060, y: 1900 },
  ].map((p, i) => monsterBase({
    id: 'slime_' + i,
    type: 'slime',
    name: '슬라임',
    level: 3,
    x: p.x,
    y: p.y,
    r: 24,
    hp: randomInt(18, 21),
    exp: 3,
    gold: 4,
    attack: 3,
    speed: 0.78,
    aggro: 250,
  }));
  return [...mushrooms, ...slimes];
}

function drawMonsterNameplate(ctx, x, y, monster) {
  ctx.save();
  ctx.textAlign = 'center';
  const label = `Lv.${monster.level || 1} ${monster.name}`;
  ctx.font = '900 14px Noto Sans KR, Jua, system-ui';
  const w = Math.max(74, ctx.measureText(label).width + 24);
  ctx.fillStyle = 'rgba(7,16,27,.75)'; roundRect(ctx, x - w/2, y - 78, w, 24, 999); ctx.fill();
  ctx.fillStyle = monster.elite ? '#ff3b3b' : '#f8fafc';
  ctx.shadowColor = monster.elite ? 'rgba(255,0,0,.75)' : 'rgba(0,0,0,.75)';
  ctx.shadowBlur = monster.elite ? 8 : 4;
  ctx.fillText(label, x, y - 61);
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(7,16,27,.7)'; roundRect(ctx, x - 28, y - 50, 56, 8, 999); ctx.fill();
  ctx.fillStyle = '#ef4444'; roundRect(ctx, x - 27, y - 50, (54 * monster.hp) / monster.maxHp, 8, 999); ctx.fill();
  ctx.restore();
}

function drawNpcIdleBubble(ctx, x, y, name, scale = 1) {
  const lines = {
    '명진쌤': ['오늘도 차근차근 성장해보자!', '문제를 풀어 몬스터에게 데미지를 입히렴.', '포탈 너머에서는 위험하니 조심하렴.'],
    '무기 상인 의석': ['좋은 무기는 바른 자세에서 시작되지.', '손에 맞는 무기를 골라봐.'],
    '방어구 상인 상미': ['방어구는 생존의 기본이야.', '망토는 뒤에서 자연스럽게 흘러야 예쁘지.'],
    '특별 상인 새나리': ['빌딩은 특별한 보상 화폐야.', '빛나는 아이템을 구경해봐!'],
      '옷 상인 상남': ['멋과 귀여움은 능력치보다 중요하지!', '코스튬은 성능은 그대로, 모습만 바꿔줘.'],
  };
  const arr = lines[name] || ['어서 와!'];
  game.npcBubbleState = game.npcBubbleState || {};
  const now = Date.now();
  let state = game.npcBubbleState[name];
  if (!state) {
    state = game.npcBubbleState[name] = {
      nextAt: now + 1000 + Math.random() * 2000 + (name.length % 4) * 350,
      visibleUntil: 0,
      idx: Math.floor(Math.random() * arr.length),
    };
  }
  if (now >= state.nextAt && now >= state.visibleUntil) {
    state.idx = (state.idx + 1 + Math.floor(Math.random() * Math.max(1, arr.length - 1))) % arr.length;
    state.visibleUntil = now + 5000;
    state.nextAt = state.visibleUntil + 2000 + 1000 + Math.random() * 2000 + (name.length % 5) * 280;
  }
  if (now > state.visibleUntil) return;
  const text = arr[state.idx % arr.length];
  const phase = now - (state.visibleUntil - 5000);
  const alpha = Math.min(1, phase / 450) * Math.min(1, (state.visibleUntil - now) / 450);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = `${Math.round(13 * scale)}px Jua, Noto Sans KR, system-ui`;
  const w = Math.min(230 * scale, ctx.measureText(text).width + 30 * scale);
  const bx = x - w / 2;
  const by = y - 104 * scale;
  ctx.globalAlpha = Math.max(0, alpha);
  ctx.fillStyle = 'rgba(255,255,255,.94)';
  roundRect(ctx, bx, by, w, 30 * scale, 12 * scale); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x - 7 * scale, by + 27 * scale); ctx.lineTo(x, by + 38 * scale); ctx.lineTo(x + 7 * scale, by + 27 * scale); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#102033';
  ctx.fillText(text, x, by + 20 * scale);
  ctx.restore();
}

function enterBossPortal(mapKey) {
  game.finalBossPortalUnlocked = false; // [피드백] 새로 입장 시 ??? 포탈 초기화 (엘리트 좀비 처치 시에만 다시 열림)
  if (game.transitionLock && Date.now() < game.transitionLock) return;
  game.transitionLock = Date.now() + 1500;
  closeModal();
  const portals = ensureStagePortals(mapKey);
  if (portals?.bossPortal) portals.bossPortal.disabledUntil = Date.now() + 45000;
  const boss = createEliteBoss(mapKey);
  game.bossReturnMap = mapKey;
  if (game.player) game.player.bossReturnMap = mapKey;
  worldDefs.bossRoom.label = mapKey === 'desert' ? '황량한 사막 보스 방' : '고요한 숲 보스 방';
  worldDefs.bossRoom.zoneKey = worldDefs[mapKey].zoneKey;
  showLoadingTransition('보스 방으로 이동중입니다.', () => {
    game.currentMap = 'bossRoom';
    game.player.map = 'bossRoom';
    game.player.x = worldDefs.bossRoom.playerSpawn.x;
    game.player.y = worldDefs.bossRoom.playerSpawn.y;
    game.forestMonsters = [boss];
    $('returnTownBtn').classList.remove('hidden');
    updateHud();
    savePlayer();
    playSfx('transition');
    showCinematicMessage('보스 방에 진입합니다', `${boss.name}이(가) 기다리고 있습니다.`, 1100);
  });
}

function getLearnedActiveSkills() {
  return Object.keys(game.player?.skills || {})
    .map((id) => SKILL_DEFS[id])
    .filter((skill) => skill && skill.active);
}

function getPlayerAttackPower() {
  const stats = computeTotalStats();
  const strength = Math.max(1, Number(stats.힘 || 1));
  const minRand = game.combatStatuses?.battleRoar ? 1.05 : 0.8;
  const maxRand = game.combatStatuses?.battleRoar ? 1.15 : 1.2;
  const rand = minRand + Math.random() * (maxRand - minRand);
  return Math.max(1, Math.round((strength / 2) * rand));
}

function handlePlayerDefeat() {
  if (!game.player) return;
  playSfx('defeat');
  closeModal();
  game.modalState = { type: 'defeat', pause: true };
  game.currentCombatMonsterId = null;
  game.currentQuestion = null;
  game.currentCombatAction = null;
  game.combatShield = 0;
  game.combatHpDisplay = null;

  const oldGold = Number(game.player.gold || 0);
  const lostGold = Math.floor(oldGold / 2);
  game.player.gold = oldGold - lostGold;
  game.player.exp = minExpForLevel(game.player.level);
  game.player.level = computeLevelFromExp(game.player.exp);
  ensurePlayerHp();

  const overlay = document.createElement('div');
  overlay.className = 'death-overlay';
  overlay.innerHTML = `<div class="death-message">으윽.. 쓰러졌다..!</div><div class="death-sub">Gold -${lostGold} · 현재 레벨의 시작 경험치로 돌아갑니다.</div>`;
  document.body.classList.add('defeated');
  document.body.appendChild(overlay);

  setTimeout(() => {
    overlay.classList.add('leaving');
    setTimeout(() => {
      overlay.remove();
      document.body.classList.remove('defeated');
      showLoadingTransition('63마을로 이동중입니다.', () => {
        closeModal();
        game.currentMap = 'town';
        game.player.map = 'town';
        game.player.x = worldDefs.town.playerSpawn.x;
        game.player.y = worldDefs.town.playerSpawn.y;
        game.player.hp = game.player.maxHp;
        game.forestMonsters = [];
        $('returnTownBtn').classList.add('hidden');
        updateHud();
        savePlayer();
        showScreen('game');
        appendChatMessage('system', '부활', '63마을에서 체력을 회복한 상태로 눈을 떴습니다.');
      });
    }, 350);
  }, 5000);
}

function showNewCharacterCreatorTransition(name) {
  const openCreator = () => {
    game.selectedClass = 'warrior';
    game.currentAppearance = randomAppearance();
    $('creatorNameLabel').textContent = name;
    document.querySelectorAll('.classBtn').forEach((btn) => btn.classList.toggle('selected', btn.dataset.class === 'warrior'));
    drawPreview();
    showScreen('creator');
    syncAudioFileBgm();
  };
  const overlay = $('cinematicOverlay');
  const title = $('cinematicTitle');
  const sub = $('cinematicSub');
  if (!overlay || !title || !sub) {
    openCreator();
    return;
  }
  title.textContent = '새 캐릭터를 생성합니다';
  sub.textContent = '잠시 후 캐릭터 생성창으로 이동합니다.';
  overlay.classList.remove('hidden', 'leaving');
  overlay.classList.add('visible');
  playSfx('world');
  setTimeout(() => overlay.classList.add('leaving'), 1250);
  setTimeout(() => {
    overlay.classList.add('hidden');
    overlay.classList.remove('visible', 'leaving');
    openCreator();
  }, 1700);
}

async function handleStudentLogin() {
  const name = String($('loginName').value ?? '').trim().normalize('NFC');
  const password = secureStudentAccess.enabled ? $('loginPassword').value : $('loginPassword').value.trim();
  if (!name) { toast('캐릭터 이름을 입력하세요.'); return; }
  if (!password) { toast('비밀번호를 입력하세요.'); return; }
  game.currentName = name;
  game.currentPassword = secureStudentAccess.enabled ? '' : password;
  if (secureStudentAccess.enabled) {
    const loginButton = $('studentLoginBtn');
    const originalLabel = loginButton.textContent;
    loginButton.disabled = true;
    loginButton.textContent = '로그인 중...';
    try {
      const entered = await secureStudentAccess.enter(name, password);
      game.currentName = entered.identity.displayName || name;
      if (entered.kind === 'existing') {
        game.player = normalizePlayer(entered.player);
        startGame(true, { loading: true });
        return;
      }
    } catch (error) {
      game.player = null;
      toast(error?.message || '로그인하지 못했습니다.');
      return;
    } finally {
      loginButton.disabled = false;
      loginButton.textContent = originalLabel;
    }
  } else {
    const existing = loadPlayer(name);
    if (existing) {
      if (existing.password !== password) { toast('비밀번호가 올바르지 않습니다.'); return; }
      game.player = existing;
      startGame(true, { loading: true });
      return;
    }
  }
  const checkedNewName = validateCharacterName(game.currentName || name);
  if (!checkedNewName.ok) { toast(checkedNewName.message); return; }
  game.currentName = checkedNewName.name;
  showNewCharacterCreatorTransition(game.currentName);
}

function hasAvailableQuest() {
  const q = getQuestState('mushroom_hunt');
  return !q || q.status === 'ready';
}

function monsterCounterAttack(messagePrefix = '') {
  const monster = currentCombatMonster();
  if (!monster || !monster.alive) return;
  const regenRank = getSkillRank('warrior_regeneration');
  if (regenRank > 0) {
    const rates = [0, .015, .03];
    const heal = Math.max(1, Math.floor(game.player.maxHp * (rates[regenRank] || 0)));
    game.player.hp = Math.min(game.player.maxHp, game.player.hp + heal);
  }
  let incoming = monster.attack || 1;
  const armorRank = getSkillRank('warrior_thick_armor');
  if (armorRank > 0) {
    const reductions = [0, .05, .10];
    incoming = Math.max(0, Math.ceil(incoming * (1 - (reductions[armorRank] || 0))));
  }
  if (game.combatShield > 0) {
    const blocked = Math.min(game.combatShield, incoming);
    game.combatShield -= blocked;
    incoming -= blocked;
  }
  game.player.hp = Math.max(0, game.player.hp - incoming);
  tickSkillCooldowns();
  game.combatImpact = { target: 'player', until: Date.now() + 560 };
  playPlayerHitSfx();
  savePlayer();
  updateHud();
  if (game.player.hp <= 0) {
    renderCombatFrame(`${messagePrefix}${monster.name}의 결정타!`, `<p class="muted">쓰러지는 중...</p>`);
    setTimeout(handlePlayerDefeat, 760);
    return;
  }
  renderCombatMenu(`${messagePrefix}${monster.name}의 반격! HP -${incoming}${game.combatShield > 0 ? ` · 보호막 ${game.combatShield}` : ''}`);
}

function openCharacterPanel() {
  ensurePlayerHp();
  const stats = computeTotalStats();
  const slotHtml = (slot, extraClass) => {
    const itemId = game.player.equipment[slot];
    const item = itemId ? getItemDefinition(itemId, game.player.class) : null;
    return `
      <div class="equip-slot paper-slot ${extraClass}" ondragover="allowItemDrop(event)" ondrop="dropItemOnEquip(event, '${slot}')">
        ${item ? `<button class="unequip-btn" title="장착 해제" onclick="unequipSlot('${slot}')">×</button>` : ''}
        <div class="slot-name">${slotLabel(slot)}</div>
        <div class="slot-icon ${item ? 'filled' : ''}">${item ? itemIcon(item) : '＋'}</div>
        <b>${item ? item.name : '비어 있음'}</b>
        <small>${item ? item.desc : '가방 아이템을 이 칸으로 드래그해 장착'}</small>
      </div>`;
  };
  const statHtml = Object.entries(stats).map(([k, v]) => `<div class="mini-stat"><span>${k}</span><b>${v}</b></div>`).join('');
  const inventory = Array.isArray(game.player.inventory) ? [...game.player.inventory] : [];
  const bagSlots = [];
  for (let idx = 0; idx < 20; idx += 1) {
    const itemId = inventory[idx];
    if (itemId) {
      const item = getItemDefinition(itemId, game.player.class);
      const can = canEquip(item, game.player);
      const equipped = Object.values(game.player.equipment).includes(itemId);
      bagSlots.push(`
        <div class="bag-slot" draggable="true" ondragstart="dragItemStart(event, ${idx})" ondragover="allowItemDrop(event)" ondrop="dropItemOnBag(event, ${idx})">
          <div class="bag-icon item-${item.slot}">${itemIcon(item)}</div>
          <b>${item.name}</b>
          <small>${slotLabel(item.slot)} · ${item.classOnly ? CLASS_META[item.classOnly].name + ' 전용' : '공용'}</small>
          <button ${!can || equipped ? 'disabled' : ''} class="primary small" onclick="equipItem('${itemId}')">${equipped ? '장착 중' : '장착'}</button>
        </div>`);
    } else {
      bagSlots.push(`<div class="bag-slot empty" ondragover="allowItemDrop(event)" ondrop="dropItemOnBag(event, ${idx})"><div class="bag-icon">＋</div><small>빈 칸</small></div>`);
    }
  }
  openModal(`
    <h2>인벤토리 / 상태창 <span class="badge">C 키</span></h2>
    <div class="character-panel character-panel-v7">
      <div class="panel-card paperdoll-card-v7">
        <h3>캐릭터 장비</h3>
        <div class="paperdoll paperdoll-v7">
          <canvas id="characterPanelCanvas" width="420" height="420"></canvas>
          ${slotHtml('head', 'slot-head-v7')}
          ${slotHtml('armor', 'slot-armor-v7')}
          ${slotHtml('weapon', 'slot-weapon-v7')}
          ${slotHtml('accessory', 'slot-accessory-v7')}
        </div>
        <div class="mini-stat-grid mini-stat-grid-v7">${statHtml}</div>
        <div class="info-stack info-stack-v7">
          <div class="badge">직업: ${CLASS_META[game.player.class].name}</div>
          <div class="badge">전문화: ${game.player.spec || '잠김'}</div>
          <div class="badge">스킬 포인트: ${game.player.skillPoints || 0}</div>
          <div class="badge gold">Gold ${game.player.gold}</div>
          <div class="badge building">빌딩 ${game.player.building}</div>
        </div>
      </div>
      <div class="panel-card">
        <h3>가방</h3>
        <p class="muted">아이템을 가방 칸끼리 드래그해 정렬하거나, 알맞은 장비 칸으로 드래그해 장착할 수 있습니다.</p>
        <div class="bag-grid">${bagSlots.join('')}</div>
      </div>
    </div>
  `, { type: 'character', pause: true });
  setTimeout(drawCharacterPanelCanvas, 20);
}

function openQuestNpc() {
  game.dialogue = { page: 0, selected: 0, mode: 'base' };
  renderNpcDialogue();
}

function openSkillTreeModal() {
  if (!game.player) return;
  const nodes = Object.values(SKILL_DEFS).map((skill) => {
    const rank = getSkillRank(skill.id);
    const learned = rank > 0;
    const learnable = canLearnSkill(skill);
    const cls = ['skill-node', `skill-${skill.kind}`, learned ? 'learned' : '', learnable ? 'learnable' : 'locked'].join(' ');
    const label = skill.active ? `액티브 · ${skill.active.cooldown}턴` : (skill.passiveText || Object.entries(skill.bonuses || {}).map(([k, v]) => `${k}+${v}`).join(' · '));
    return `
      <button class="${cls}" style="left:${skill.x}%; top:${skill.y}%" onclick="learnSkill('${skill.id}')" ${(!learnable) ? 'disabled' : ''}>
        <b>${skill.name} ${skill.maxPoints ? `<i>${rank}/${skill.maxPoints}</i>` : ''}</b>
        <small>${label || '기본'}</small>
      </button>`;
  }).join('');
  const lines = SKILL_LINES.map(([a, b]) => {
    const A = SKILL_DEFS[a];
    const B = SKILL_DEFS[b];
    const active = isSkillLearned(a) && isSkillLearned(b);
    return `<line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" class="${active ? 'active' : ''}" />`;
  }).join('');
  const learnedActive = getLearnedActiveSkills();
  const activeHtml = learnedActive.length ? learnedActive.map((skill) => `
    <div class="active-skill-card">
      <b>${skill.active.name}</b>
      <p>${escapeHtml(skill.desc)}</p>
      <small>쿨타임 ${skill.active.cooldown}턴</small>
    </div>
  `).join('') : '<div class="empty-state">아직 획득한 액티브 스킬이 없습니다.</div>';
  openModal(`
    <h2>스킬창 <span class="badge">N 키</span></h2>
    <div class="two-col">
      <div class="skill-summary panel-card">
        <h3>전사 기본 트랙</h3>
        <p><b>남은 스킬 포인트:</b> ${game.player.skillPoints || 0}</p>
        <p class="muted">왼쪽에서 오른쪽으로 진행합니다. <b>강인한 체력</b> 이후 전술 스킬을 선택하고, 예리한 칼날/두터운 갑옷과 광분/재생력 강화로 성장합니다.</p>
      </div>
      <div class="panel-card">
        <h3>현재 획득한 액티브 스킬</h3>
        <div class="active-skill-list">${activeHtml}</div>
      </div>
    </div>
    <div class="skill-tree-wrap skill-tree-horizontal">
      <svg class="skill-lines" viewBox="0 0 100 100" preserveAspectRatio="none">${lines}</svg>
      ${nodes}
    </div>
  `, { type: 'skill', pause: true });
}

function openWorldMapModal() {
  openModal(`
    <h2>월드 맵 / 포탈</h2>
    <div class="panel-card">
      <p>현재 입장 가능한 사냥터를 선택하세요. 몬스터보다 내 레벨이 2 이상 높으면 경험치를 얻지 못합니다.</p>
      <div class="student-grid">
        <div class="student-item">
          <div class="badge">Lv.1 지역</div>
          <h3>고요한 숲</h3>
          <p>버섯돌이와 숲 깊은 곳의 Lv.3 슬라임이 등장합니다.</p>
          <button class="primary wide" onclick="enterForest()">입장하기</button>
        </div>
        <div class="student-item">
          <div class="badge gold">Lv.4 입장 가능</div>
          <h3>황량한 사막</h3>
          <p>스톰프와 스네이크가 등장하는 두 번째 사냥터입니다.</p>
          <button class="primary wide" onclick="enterDesert()">입장하기</button>
        </div>
      </div>
    </div>
  `, { type: 'worldmap', pause: true });
}

function renderCombatMenu(message = '무엇을 할까?') {
  const monster = currentCombatMonster();
  const noEscape = monster?.noEscape;
  renderCombatFrame(message, `
    <div class="combat-menu">
      <button class="primary" onclick="chooseCombatAction('attack')">공격</button>
      <button class="primary" onclick="chooseCombatAction('skill')">스킬</button>
      <button class="ghost" ${noEscape ? 'disabled' : ''} onclick="escapeCombat()">${noEscape ? '도망 불가' : '도망'}</button>
    </div>
    <p class="muted">공격이나 스킬을 누르면 문제가 출제됩니다. 정답이면 행동 성공, 이후 몬스터가 반격합니다.</p>
  `);
}

function renderNpcDialogue() {
  const q = getQuestState('mushroom_hunt');
  const def = QUEST_DEFS.mushroom_hunt;
  const page = game.dialogue.page || 0;
  let text = '안녕! 가운데 포탈로 들어가면 Lv.1 고요한 숲으로 갈 수 있단다. 문제를 맞히며 사냥하면 레벨업할 수 있어.';
  let options = [];

  if (game.dialogue.mode === 'quest') {
    text = def.pages[page] || def.pages[def.pages.length - 1];
    options.push({ label: page < def.pages.length - 1 ? '다음 이야기' : '퀘스트 수락', action: page < def.pages.length - 1 ? 'nextDialoguePage()' : 'acceptMushroomQuest()' });
    if (page > 0) options.push({ label: '이전 이야기', action: 'prevDialoguePage()' });
    options.push({ label: '기본 대화로 돌아가기', action: 'openQuestNpc()' });
  } else {
    if (!q) options.push({ label: '! 퀘스트 이야기 듣기', action: 'startQuestStory()' });
    else if (q.status === 'accepted') options.push({ label: `진행 중: ${q.progress || 0}/${def.target}`, action: 'startQuestStory()' });
    else if (q.status === 'ready') options.push({ label: '! 퀘스트 완료 보고', action: 'completeMushroomQuest()' });
    else options.push({ label: '완료한 퀘스트 다시 보기', action: 'startQuestStory()' });
    options.push({ label: '대화 종료', action: 'closeModal()' });
  }

  const selected = Math.min(game.dialogue.selected || 0, options.length - 1);
  game.dialogue.selected = selected;
  openModal(`
    <div class="dialogue-box">
      <div class="dialogue-speaker">
        <h2>명진쌤 ${hasAvailableQuest() ? '<span class="badge">!</span>' : ''}</h2>
        <div class="badge">E키로 진행</div>
      </div>
      <div class="dialogue-text">${escapeHtml(text)}</div>
      <div class="dialogue-options">
        ${options.map((opt, i) => `<button class="${i === selected ? 'selected' : ''}" onclick="${opt.action}">${escapeHtml(opt.label)}</button>`).join('')}
      </div>
    </div>
  `, { type: 'dialogue', pause: true });
}

function resetForestMonsters(mapKey = game.currentMap) {
  if (mapKey === 'bossRoom') return;
  game.forestMonsters = mapKey === 'desert' ? createDesertMonsters() : createForestMonsters();
  delete game.stagePortals[mapKey];
  ensureStagePortals(mapKey);
}

function updateQuestTracker() {
  const tracker = $('questTracker');
  if (!tracker || !game.player) return;
  const q = getQuestState('mushroom_hunt');
  const def = QUEST_DEFS.mushroom_hunt;
  if (!q || q.status === 'completed') {
    tracker.classList.add('hidden');
    tracker.innerHTML = '';
    return;
  }
  const pct = Math.round(((q.progress || 0) / def.target) * 100);
  tracker.classList.remove('hidden');
  tracker.innerHTML = `
    <h3>${escapeHtml(def.title)}</h3>
    <p>${escapeHtml(def.desc)}</p>
    <p><b>진행도:</b> ${q.progress || 0}/${def.target} ${q.status === 'ready' ? '· 보고 가능' : ''}</p>
    <div class="quest-progress-bar"><div class="quest-progress-fill" style="width:${pct}%"></div></div>
  `;
}

/* =========================
   v17 patch: 늪지/치명타/보스포탈/퀘스트 체인/테스트 이속
   ========================= */
(function yuksamV17Patch(){
  // 신규 지역 정의
  worldDefs.swamp = WORLD_PATCHES_V17.swamp;

  // 기본 늪지 문제집 보강
  function ensureSwampWorkbook() {
    const stored = readWorkbookStorage();
    if (stored.status === 'corrupt') return;
    const books = stored.status === 'valid' ? stored.workbooks : getWorkbooks();
    if (books.some((wb) => wb.zone === 'spooky_swamp')) return;
    const id = 'wb_swamp_basic_' + uid();
    books.push({
      id,
      name: '문제집3 - 으스스한 늪지 기본 문제 세트',
      zone: 'spooky_swamp',
      subject: '복습',
      prompt: '늪지 기본 문제',
      createdAt: Date.now(),
      questions: [
        { id: uid(), workbookId: id, zone: 'spooky_swamp', q: '15 × 4 = ?', choices: ['50','55','60','65'], answer: '60', source: '기본' },
        { id: uid(), workbookId: id, zone: 'spooky_swamp', q: '72 ÷ 8 = ?', choices: ['7','8','9','10'], answer: '9', source: '기본' },
        { id: uid(), workbookId: id, zone: 'spooky_swamp', q: "'spider'의 뜻은?", choices: ['거미','뱀','나무','버섯'], answer: '거미', source: '기본' },
        { id: uid(), workbookId: id, zone: 'spooky_swamp', q: "'zombie'의 뜻과 가장 가까운 것은?", choices: ['좀비','기사','마법사','상인'], answer: '좀비', source: '기본' },
      ],
    });
    saveWorkbooks(books);
  }
  ensureSwampWorkbook();

  // 몬스터 스탯/배치 재정의
  function applyZoneScaleV42(monster, zone) {
    if (!monster || !['desert', 'swamp'].includes(zone) || monster.__zoneScale === zone) return monster;
    const scaled = YuksamCombatRules.scaleMonsterStats({
      type: monster.type,
      hp: monster.maxHp || monster.hp,
      attack: monster.attack,
    }, zone);
    monster.maxHp = scaled.hp;
    monster.hp = scaled.hp;
    monster.attack = scaled.attack;
    Object.defineProperty(monster, '__zoneScale', { value: zone, enumerable: false, configurable: true });
    return monster;
  }
  function polishNormalMonsterV2(monster) {
    if (!monster || monster.elite) return monster;
    Object.assign(monster, YuksamGameplayPolishV2.tuneNormalMonster(monster));
    Object.defineProperty(monster, '__gameplayPolishV2', {
      value:true, enumerable:false, configurable:true,
    });
    return monster;
  }
  createForestMonsters = function createForestMonstersV17() {
    const mushrooms = [
      { x: 760, y: 1600 }, { x: 1040, y: 1380 }, { x: 1320, y: 1660 },
      { x: 1560, y: 1260 }, { x: 1780, y: 1580 }, { x: 1980, y: 1360 },
    ].map((p, i) => polishNormalMonsterV2(monsterBase({
      id: 'mushroom_' + i, type: 'mushroom', name: '버섯돌이', level: 1,
      x: p.x, y: p.y, r: 20, hp: randomInt(9, 11), exp: 1, gold: 2,
      attack: randomInt(3, 5), speed: 0.92, aggro: 220, // [피드백] 공격 +2
    })));
    const slimes = [
      { x: 2280, y: 520 }, { x: 2520, y: 860 }, { x: 2700, y: 1230 },
      { x: 2860, y: 1580 }, { x: 3020, y: 760 }, { x: 3060, y: 1900 },
    ].map((p, i) => polishNormalMonsterV2(monsterBase({
      id: 'slime_' + i, type: 'slime', name: '슬라임', level: 3,
      x: p.x, y: p.y, r: 24, hp: randomInt(18, 21), exp: 3, gold: 4,
      attack: randomInt(3, 5), speed: 0.78, aggro: 250,
    })));
    return [...mushrooms, ...slimes];
  };

  createDesertMonsters = function createDesertMonstersV17() {
    const stomps = [
      { x: 820, y: 1600 }, { x: 1120, y: 1180 }, { x: 1440, y: 1500 },
      { x: 1760, y: 980 }, { x: 1940, y: 1780 },
    ].map((p, i) => monsterBase({
      id: 'stomp_' + i, type: 'stomp', name: '스톰프', level: 5,
      x: p.x, y: p.y, r: 34, hp: randomInt(28, 31), exp: 6, gold: 9,
      attack: randomInt(5, 7), speed: 0.66, aggro: 260,
    }));
    const snakes = [
      { x: 2320, y: 560 }, { x: 2520, y: 1020 }, { x: 2740, y: 1460 },
      { x: 3040, y: 820 }, { x: 3180, y: 1840 },
    ].map((p, i) => monsterBase({
      id: 'snake_' + i, type: 'snake', name: '스네이크', level: 7,
      x: p.x, y: p.y, r: 26, hp: randomInt(38, 41), exp: 9, gold: 12,
      attack: randomInt(7, 9), speed: 0.95, aggro: 280,
    }));
    return [...stomps, ...snakes].map((monster) => applyZoneScaleV42(monster, 'desert'));
  };

  window.createSwampMonsters = function createSwampMonsters() {
    const spiders = [
      { x: 900, y: 1740 }, { x: 1240, y: 1380 }, { x: 1520, y: 1660 },
      { x: 1840, y: 1220 }, { x: 2060, y: 1880 }, { x: 2260, y: 1480 },
    ].map((p, i) => monsterBase({
      id: 'tarantula_' + i, type: 'tarantula', name: '타란튤라', level: 9,
      x: p.x, y: p.y, r: 29, hp: randomInt(48, 51), exp: 12, gold: 15,
      attack: randomInt(9, 11), speed: 0.90, aggro: 290,
    }));
    const zombies = [
      { x: 2580, y: 420 }, { x: 2820, y: 860 }, { x: 3050, y: 1320 },
      { x: 3220, y: 1810 }, { x: 3380, y: 680 }, { x: 3420, y: 2100 },
    ].map((p, i) => monsterBase({
      id: 'zombie_' + i, type: 'zombie', name: '좀비', level: 11,
      x: p.x, y: p.y, r: 32, hp: randomInt(70, 73), exp: 16, gold: 20,
      attack: randomInt(20, 23), speed: 0.70, aggro: 310,
    }));
    return [...spiders, ...zombies].map((monster) => applyZoneScaleV42(monster, 'swamp'));
  };

  function addBossPortalGuards(mapKey) {
    const portals = ensureStagePortals(mapKey);
    if (!portals?.bossPortal) return;
    const p = portals.bossPortal;
    const guardDefs = {
      forest: { type: 'slime', name: '슬라임', level: 3, hp: () => randomInt(18, 21), attack: () => randomInt(3, 5), r: 24, exp: 3, gold: 4, speed: .82, aggro: 270 },
      desert: { type: 'snake', name: '스네이크', level: 7, hp: () => randomInt(38, 41), attack: () => randomInt(7, 9), r: 26, exp: 9, gold: 12, speed: .98, aggro: 300 },
      swamp: { type: 'zombie', name: '좀비', level: 11, hp: () => randomInt(70, 73), attack: () => randomInt(20, 23), r: 32, exp: 16, gold: 20, speed: .74, aggro: 330 },
    };
    const def = guardDefs[mapKey];
    if (!def) return;
    for (let i = 0; i < 3; i += 1) {
      const a = (i / 3) * Math.PI * 2 + Math.random() * .45;
      const d = 130 + Math.random() * 110;
      const x = clamp(p.x + Math.cos(a) * d, 90, worldDefs[mapKey].width - 90);
      const y = clamp(p.y + Math.sin(a) * d, 90, worldDefs[mapKey].height - 90);
      const guard = applyZoneScaleV42(monsterBase({
        id: `boss_guard_${mapKey}_${i}_${uid()}`,
        type: def.type, name: def.name, level: def.level, x, y, r: def.r,
        hp: def.hp(), exp: def.exp, gold: def.gold, attack: def.attack(), speed: def.speed, aggro: def.aggro,
      }), mapKey);
      game.forestMonsters.push(mapKey === 'forest' ? polishNormalMonsterV2(guard) : guard);
    }
  }

  resetForestMonsters = function resetForestMonstersV17(mapKey = game.currentMap) {
    if (mapKey === 'bossRoom') return;
    if (mapKey === 'desert') game.forestMonsters = createDesertMonsters();
    else if (mapKey === 'swamp') game.forestMonsters = window.createSwampMonsters();
    else game.forestMonsters = createForestMonsters();
    delete game.stagePortals[mapKey];
    ensureStagePortals(mapKey);
    addBossPortalGuards(mapKey);
  };

  // 보스 포탈 위치: 북쪽/동북/동남/남쪽/동쪽 중 하나
  function pickBossPortalSpot(mapKey) {
    const w = worldDefs[mapKey].width;
    const h = worldDefs[mapKey].height;
    const candidates = [
      () => ({ x: randomInt(Math.floor(w * .46), Math.floor(w * .74)), y: randomInt(120, 310), region: '북쪽' }),
      () => ({ x: randomInt(Math.floor(w * .82), w - 140), y: randomInt(120, 430), region: '동북쪽 끝' }),
      () => ({ x: randomInt(Math.floor(w * .82), w - 140), y: randomInt(h - 460, h - 130), region: '동남쪽 끝' }),
      () => ({ x: randomInt(Math.floor(w * .42), Math.floor(w * .76)), y: randomInt(h - 360, h - 120), region: '남쪽 끝' }),
      () => ({ x: randomInt(Math.floor(w * .88), w - 120), y: randomInt(Math.floor(h * .35), Math.floor(h * .68)), region: '동쪽 끝' }),
    ];
    let spot = candidates[randomInt(0, candidates.length - 1)]();
    if (distance(spot, worldDefs[mapKey].playerSpawn) < 1200) spot = candidates[randomInt(1, candidates.length - 1)]();
    return spot;
  }

  ensureStagePortals = function ensureStagePortalsV17(mapKey) {
    if (!['forest', 'desert', 'swamp'].includes(mapKey)) return null;
    if (!game.stagePortals[mapKey]) {
      const world = worldDefs[mapKey];
      const boss = pickBossPortalSpot(mapKey);
      game.stagePortals[mapKey] = {
        returnPortal: { x: world.playerSpawn.x, y: world.playerSpawn.y, r: 64 },
        bossPortal: { x: boss.x, y: boss.y, r: 58, region: boss.region },
      };
    }
    return game.stagePortals[mapKey];
  };

  // BGM 패턴: 늪지는 파일이 없으므로 WebAudio 패턴 사용
  const oldGetDesiredAudioFile = getDesiredAudioFile;
  getDesiredAudioFile = function getDesiredAudioFileV17() {
    if (screens.game.classList.contains('active') && game.currentMap === 'swamp') return null;
    return oldGetDesiredAudioFile();
  };
  const oldGetCurrentBgmPattern = getCurrentBgmPattern;
  getCurrentBgmPattern = function getCurrentBgmPatternV17() {
    if ((game.currentMap || '') === 'swamp') {
      return { step: 560, arp: [196, 246.94, 293.66, 349.23, 329.63, 293.66, 246.94, 220], bass: [49, 61.74, 73.42, 55] };
    }
    return oldGetCurrentBgmPattern();
  };

  // 늪지 드로잉
  window.drawSwamp = function drawSwamp() {
    const ctx = game.ctx;
    const world = worldDefs.swamp;
    const g = ctx.createLinearGradient(0, 0, 0, game.height);
    g.addColorStop(0, '#22443d'); g.addColorStop(.55, '#172b2d'); g.addColorStop(1, '#0b1518');
    ctx.fillStyle = g; ctx.fillRect(0, 0, game.width, game.height);
    drawTerrainDots(ctx, world, '#a7f3d0', .035, 88, 18);
    drawSwampPools();
    drawSwampPath();
    const swampTrees = (typeof scatterPointsV37 === 'function') ? scatterPointsV37('swampTrees', 28, world.width, world.height, 210) : null;
    for (let i = 0; i < 28; i += 1) {
      const p = swampTrees ? swampTrees[i] : { x: 220 + (i * 137) % 3300, y: 170 + (i * 191) % 2200, s: .72 + (i % 4) * .1 };
      if (p) drawDeadTreeWorld(p.x, p.y, .62 + p.s * .38);
    }
    if (typeof drawMapDetailV36 === 'function') drawMapDetailV36('swamp');
    drawStagePortals(world.key);
    drawTitleLabel(world.label);
    game.forestMonsters.forEach((m) => { if (m.alive) drawMushroomWorld(m); });
  };
  function drawSwampPools() {
    const ctx = game.ctx;
    const pools = [[780,1520,170,62],[1450,980,210,78],[2280,1480,190,70],[3050,880,230,84],[3150,1940,170,58]];
    pools.forEach(([x,y,rx,ry], i) => {
      const p = worldToScreen(x,y);
      const grad = ctx.createRadialGradient(p.x,p.y,10,p.x,p.y,rx);
      grad.addColorStop(0,'rgba(45,212,191,.45)'); grad.addColorStop(1,'rgba(15,118,110,.18)');
      ctx.fillStyle = grad; ctx.beginPath(); ctx.ellipse(p.x,p.y,rx,ry, i*.2, 0, Math.PI*2); ctx.fill();
      ctx.strokeStyle = 'rgba(153,246,228,.18)'; ctx.lineWidth = 4; ctx.stroke();
    });
  }
  function drawSwampPath() {
    const ctx = game.ctx;
    const points = [[500,1980],[980,1760],[1500,1540],[2050,1400],[2550,1180],[3180,820]];
    ctx.save(); ctx.strokeStyle = 'rgba(68,64,60,.58)'; ctx.lineWidth = 76; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(...screenPair(points[0])); for (let i=1;i<points.length;i++) ctx.lineTo(...screenPair(points[i])); ctx.stroke(); ctx.restore();
  }
  window.drawDeadTreeWorld = function drawDeadTreeWorld(x, y, scale = 1) {
    const p = worldToScreen(x,y), ctx = game.ctx;
    drawShadow(ctx, p.x, p.y + 28*scale, 22*scale, 8*scale, .20);
    ctx.save(); ctx.translate(p.x,p.y); ctx.scale(scale,scale);
    ctx.strokeStyle = '#3f2f25'; ctx.lineWidth = 8; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0,38); ctx.lineTo(0,-38); ctx.moveTo(0,-14); ctx.lineTo(-26,-42); ctx.moveTo(2,-20); ctx.lineTo(28,-52); ctx.moveTo(-2,6); ctx.lineTo(-32,-8); ctx.stroke();
    ctx.fillStyle = 'rgba(34,197,94,.14)'; ctx.beginPath(); ctx.ellipse(-16,34,22,7,0,0,Math.PI*2); ctx.fill();
    ctx.restore();
  };

  // 몬스터 스프라이트 추가
  const baseDrawMonsterSpriteV17 = drawMonsterSprite;
  drawMonsterSprite = function drawMonsterSpriteV17(ctx, x, y, monster, scale = 1) {
    if (!monster) return;
    const eliteScale = monster.elite ? 1.32 : 1;
    if (monster.elite) {
      ctx.save(); ctx.translate(x,y); ctx.globalAlpha = .95; ctx.strokeStyle = 'rgba(153,27,27,.96)'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.ellipse(0,8,56*eliteScale,56*eliteScale,0,0,Math.PI*2); ctx.stroke(); ctx.restore();
    }
    if (monster.type === 'tarantula') return drawTarantulaSprite(ctx, x, y, monster, scale * eliteScale);
    if (monster.type === 'zombie') return drawZombieSprite(ctx, x, y, monster, scale * eliteScale);
    return baseDrawMonsterSpriteV17(ctx, x, y, monster, scale);
  };
  window.drawTarantulaSprite = function drawTarantulaSprite(ctx, x, y, monster, scale = 1) {
    const t = performance.now()/1000;
    drawShadow(ctx, x, y + 24*scale, 38*scale, 10*scale, .26);
    ctx.save(); ctx.translate(x, y + Math.sin(t*5 + monster.spawnX*.01)*2*scale); ctx.scale(scale, scale);
    ctx.strokeStyle = monster.chasing ? '#f97316' : '#3f2439'; ctx.lineWidth = 6; ctx.lineCap = 'round';
    for (let side of [-1,1]) for (let i=0;i<4;i++) { const yy=-10+i*9; ctx.beginPath(); ctx.moveTo(side*8, yy); ctx.lineTo(side*(28+i*4), yy-14+i*5); ctx.lineTo(side*(44+i*2), yy-4+i*7); ctx.stroke(); }
    const grad = ctx.createRadialGradient(-5,-10,4,0,0,34); grad.addColorStop(0,'#a78bfa'); grad.addColorStop(.55,'#6d28d9'); grad.addColorStop(1,'#2e1065');
    ctx.fillStyle = grad; ctx.beginPath(); ctx.ellipse(0,0,30,24,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = '#111827'; ctx.beginPath(); ctx.arc(-8,-4,3,0,Math.PI*2); ctx.arc(8,-4,3,0,Math.PI*2); ctx.fill();
    ctx.restore();
  };
  window.drawZombieSprite = function drawZombieSprite(ctx, x, y, monster, scale = 1) {
    const t = performance.now()/1000; const sway = Math.sin(t*2.4 + monster.spawnX*.01)*.08;
    drawShadow(ctx, x, y + 30*scale, 26*scale, 9*scale, .28);
    ctx.save(); ctx.translate(x, y); ctx.rotate(sway); ctx.scale(scale, scale);
    ctx.fillStyle = '#86efac'; ctx.beginPath(); ctx.arc(0,-24,15,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = monster.chasing ? '#4c1d95' : '#374151'; roundRect(ctx,-18,-8,36,46,10); ctx.fill();
    ctx.strokeStyle = '#86efac'; ctx.lineWidth = 7; ctx.lineCap='round'; ctx.beginPath(); ctx.moveTo(-15,0); ctx.lineTo(-30,18); ctx.moveTo(15,0); ctx.lineTo(32,14); ctx.stroke();
    ctx.fillStyle = '#111827'; ctx.beginPath(); ctx.arc(-5,-25,2.3,0,Math.PI*2); ctx.arc(5,-25,2.3,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#111827'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-7,-17); ctx.lineTo(7,-17); ctx.stroke();
    ctx.restore();
  };

  drawMonsterNameplate = function drawMonsterNameplateV17(ctx, x, y, monster) {
    ctx.save(); ctx.textAlign = 'center';
    const label = `Lv.${monster.level || 1} ${monster.name}`;
    ctx.font = '900 14px Noto Sans KR, Jua, system-ui';
    const w = Math.max(74, ctx.measureText(label).width + 24);
    ctx.fillStyle = monster.elite ? 'rgba(69,10,10,.86)' : 'rgba(7,16,27,.75)';
    roundRect(ctx, x - w/2, y - 78, w, 24, 999); ctx.fill();
    ctx.fillStyle = monster.elite ? '#ff4d4d' : '#f8fafc';
    ctx.fillText(label, x, y - 61);
    ctx.restore();
  };

  // 보스 생성/방 라벨
  createEliteBoss = function createEliteBossV17(mapKey) {
    const table = {
      forest: { type: 'slime', name: '엘리트 슬라임', level: 3, hp: randomInt(18, 21) * 2, attack: randomInt(3, 5) * 2, exp: 6, gold: 8, r: 34 },
      desert: { type: 'snake', name: '엘리트 스네이크', level: 7, hp: randomInt(38, 41) * 2, attack: randomInt(7, 9) * 2, exp: 18, gold: 24, r: 34 },
      swamp: { type: 'zombie', name: '엘리트 좀비', level: 11, hp: Math.round(randomInt(70, 73) * 4.2), attack: Math.ceil(randomInt(20, 23) * 2 * .60), exp: 30, gold: 40, r: 40 },
    };
    const base = table[mapKey] || table.forest;
    const boss = applyZoneScaleV42(monsterBase({ id: 'elite_' + mapKey + '_' + uid(), ...base, x: 820, y: 430, speed: 0.0, aggro: 9999 }), mapKey);
    boss.elite = true; boss.noEscape = true; boss.chasing = true;
    return boss;
  };

  enterBossPortal = function enterBossPortalV17(mapKey) {
    if (game.transitionLock && Date.now() < game.transitionLock) return;
    game.transitionLock = Date.now() + 1500;
    closeModal();
    const boss = createEliteBoss(mapKey);
    game.bossReturnMap = mapKey;
    if (game.player) game.player.bossReturnMap = mapKey;
    worldDefs.bossRoom.label = mapKey === 'desert' ? '황량한 사막 보스 방' : mapKey === 'swamp' ? '으스스한 늪지 보스 방' : '고요한 숲 보스 방';
    worldDefs.bossRoom.zoneKey = worldDefs[mapKey].zoneKey;
    showLoadingTransition('보스 방으로 이동중입니다.', () => {
      game.currentMap = 'bossRoom'; game.player.map = 'bossRoom';
      game.player.x = worldDefs.bossRoom.playerSpawn.x; game.player.y = worldDefs.bossRoom.playerSpawn.y;
      game.forestMonsters = [boss];
      $('returnTownBtn').classList.remove('hidden'); updateHud(); savePlayer(); playSfx('transition');
      showCinematicMessage('보스 방에 진입합니다', `${boss.name}이(가) 기다리고 있습니다.`, 1100);
    });
  };

  const oldDrawBossRoomV17 = drawBossRoom;
  drawBossRoom = function drawBossRoomV17() {
    const ctx = game.ctx;
    const mapKey = game.bossReturnMap || game.player?.bossReturnMap || 'forest';
    const g = ctx.createLinearGradient(0, 0, 0, game.height);
    if (mapKey === 'desert') { g.addColorStop(0, '#70421e'); g.addColorStop(.55, '#3f2413'); g.addColorStop(1, '#180f0a'); }
    else if (mapKey === 'swamp') { g.addColorStop(0, '#19352f'); g.addColorStop(.55, '#101f25'); g.addColorStop(1, '#070d12'); }
    else { g.addColorStop(0, '#173d2a'); g.addColorStop(.55, '#0f2418'); g.addColorStop(1, '#07120d'); }
    ctx.fillStyle = g; ctx.fillRect(0,0,game.width,game.height);
    const dotColor = mapKey === 'desert' ? '#fde68a' : mapKey === 'swamp' ? '#99f6e4' : '#bbf7d0';
    drawTerrainDots(ctx, worldDefs.bossRoom, dotColor, .045, 86, 14);
    const cx = game.width/2, cy = game.height/2 + 45;
    ctx.save(); ctx.strokeStyle = mapKey === 'desert' ? 'rgba(250,204,21,.30)' : mapKey === 'swamp' ? 'rgba(45,212,191,.30)' : 'rgba(134,239,172,.30)';
    ctx.fillStyle = mapKey === 'desert' ? 'rgba(120,65,28,.18)' : mapKey === 'swamp' ? 'rgba(13,148,136,.15)' : 'rgba(22,101,52,.18)';
    ctx.lineWidth = 9; ctx.beginPath(); ctx.ellipse(cx, cy, 330, 180, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke(); ctx.restore();
    const exit = worldToScreen(worldDefs.bossRoom.exit.x, worldDefs.bossRoom.exit.y);
    drawPortalSprite(ctx, exit.x, exit.y, 24, performance.now()/760, '#22c55e');
    drawFloatingLabel(ctx, exit.x, exit.y - 48, '퇴장 포탈');
    game.forestMonsters.forEach((m) => { if (m.alive) drawMushroomWorld(m); });
    drawTitleLabel(worldDefs.bossRoom.label);
  };

  // 월드맵/입장
  function showLevelGateMessage(title, needLv) {
    const msg = `레벨이 부족합니다. ${title}은 Lv.${needLv}부터 입장할 수 있습니다.`;
    toast(msg, 2400); appendChatMessage('system', '입장 제한', msg); showCinematicMessage('레벨이 부족합니다', msg, 1500);
  }
  window.enterDesert = function enterDesertV17() {
    if ((game.player?.level || 1) < 4) return showLevelGateMessage('황량한 사막', 4);
    closeModal();
    showLoadingTransition('황량한 사막으로 이동중입니다.', () => {
      game.currentMap = 'desert'; game.player.map = 'desert';
      const portals = ensureStagePortals('desert');
      game.player.x = portals.returnPortal.x + 180; game.player.y = portals.returnPortal.y + 20; game.lastMove = { x: 1, y: 0 };
      resetForestMonsters('desert'); $('returnTownBtn').classList.remove('hidden'); updateHud(); savePlayer(); appendChatMessage('system','이동','황량한 사막에 입장했습니다.');
    });
  };
  window.enterSwamp = function enterSwamp() {
    if ((game.player?.level || 1) < 7) return showLevelGateMessage('으스스한 늪지', 7);
    closeModal(); ensureSwampWorkbook();
    showLoadingTransition('으스스한 늪지로 이동중입니다.', () => {
      game.currentMap = 'swamp'; game.player.map = 'swamp';
      const portals = ensureStagePortals('swamp');
      game.player.x = portals.returnPortal.x + 185; game.player.y = portals.returnPortal.y + 20; game.lastMove = { x: 1, y: 0 };
      resetForestMonsters('swamp'); $('returnTownBtn').classList.remove('hidden'); updateHud(); savePlayer(); appendChatMessage('system','이동','으스스한 늪지에 입장했습니다.');
    });
  };

  // 상호작용 후보의 늪지 지원은 기본 레지스트리 fallback에 통합했다.
  getNearbyMonster = function getNearbyMonsterV17(range = 42) {
    if (!['forest','desert','swamp','bossRoom'].includes(game.currentMap)) return null;
    const now = Date.now();
    const alive = game.forestMonsters.filter((m) => m.alive && now >= m.ignorePlayerUntil);
    let nearest = null, nearestD = Infinity;
    alive.forEach((m) => { const d = distance(game.player, m); if (d < range && d < nearestD) { nearest = m; nearestD = d; } });
    return nearest;
  };
  updateForestMonsters = function updateForestMonstersV17(dt) {
    if (!['forest','desert','swamp','bossRoom'].includes(game.currentMap)) return;
    const now = Date.now();
    game.forestMonsters.forEach((m) => {
      if (!m.alive) {
        if (now >= m.respawnAt) { m.alive = true; m.hp = m.maxHp; m.x = m.spawnX; m.y = m.spawnY; m.ignorePlayerUntil = now + 1500; m.chasing = false; }
        return;
      }
      if (now < m.ignorePlayerUntil) return;
      const d = distance(game.player, m);
      if (d < m.aggro) m.chasing = true;
      if (m.chasing && !m.elite && d > m.aggro * 1.75) { m.chasing = false; return; }
      if (m.chasing && d > 10) { const step = m.speed * Math.min(dt / 16.67, 2); m.x += ((game.player.x - m.x) / d) * step; m.y += ((game.player.y - m.y) / d) * step; }
      if (d < m.r + 32) openCombat(m);
    });
  };
  // 관리자 테스트 이동속도
  game.adminSpeedBoost = false;
  const speedBtn = $('testSpeedBtn');
  if (speedBtn) speedBtn.addEventListener('click', async () => {
    if (!(await window.requireTeacherCheatAccessV3?.())) return;
    game.adminSpeedBoost = !game.adminSpeedBoost;
    speedBtn.textContent = game.adminSpeedBoost ? '이속 5배 ON' : '이속 5배 OFF';
    appendChatMessage('system', '관리자', game.adminSpeedBoost ? '이동속도 5배 모드 ON' : '이동속도 5배 모드 OFF');
  });
  const oldUpdateFn = update;
  update = function updateV17(dt) {
    if (!game.player || !screens.game.classList.contains('active')) return;
    reconcileWorldPlayerPositionV1('update');
    if (!isPaused()) {
      const speed = 3.2 * (game.adminSpeedBoost ? 5 : 1) * Math.min(dt / 16.67, 2);
      let dx = 0, dy = 0;
      if (game.keys.w) dy -= speed; if (game.keys.s) dy += speed; if (game.keys.a) dx -= speed; if (game.keys.d) dx += speed;
      const keyboardMoving = !!(dx || dy);
      if (keyboardMoving) clickMovementArrivalLockV1 = null;
      const clickMovementResultV1 = clickMovementControllerV1.update({
        dt,
        keyboardMoving,
        speedMultiplier:game.adminSpeedBoost ? 5 : 1,
      });
      game.clickMovement = clickMovementControllerV1.getState();
      game.isMoving = keyboardMoving || clickMovementResultV1.moving || clickMovementResultV1.moved;
      if (dx || dy) {
        game.lastMove = { x: dx || game.lastMove.x, y: dy || game.lastMove.y };
        const world = worldDefs[game.currentMap];
        const nx = clamp(game.player.x + dx, 38, world.width - 38); const ny = clamp(game.player.y + dy, 48, world.height - 48);
        if (canPlayerMoveTo(nx, game.player.y)) game.player.x = nx;
        if (canPlayerMoveTo(game.player.x, ny)) game.player.y = ny;
        savePlayerPositionThrottled();
      }
      if (clickMovementArrivalLockV1 !== game.currentMap) checkAutoTransitions();
      if (['forest','desert','swamp','bossRoom'].includes(game.currentMap)) { updateForestMonsters(dt); updateStagePortalInteractions(); }
      if (game.attackTimer > 0) game.attackTimer = Math.max(0, game.attackTimer - dt);
      if (game.danceTimer > 0) game.danceTimer = Math.max(0, game.danceTimer - dt);
    } else game.isMoving = false;
    updateInteractionHint(); drawWorld();
  };

  // 데미지 공식과 치명타
  function triggerScreenShake() {
    const el = $('gameCanvas') || document.body;
    el.classList.remove('screen-shake');
    void el.offsetWidth;
    el.classList.add('screen-shake');
    setTimeout(() => el.classList.remove('screen-shake'), 460);
  }
  function rollPlayerCritical() { return Math.random() < 0.15; }
  function rollMonsterCritical() { return Math.random() < 0.15; }



  const QUEST_ORDER_V17 = QUEST_ORDER;
  QUEST_DEFS.mushroom_hunt.targetTypes = ['mushroom'];
  QUEST_DEFS.mushroom_hunt.pages[2] = '고요한 숲으로 가서 버섯돌이 4마리를 막아주겠니? 사냥터에 가려면 마을 가운데에 있는 포탈로 가렴. 마을 친구들이 네 도움을 기다리고 있어. 무리하지 말고 차근차근 하렴.';
  function getCurrentQuestIdForNpc() {
    for (let i = 0; i < QUEST_ORDER_V17.length; i += 1) {
      const id = QUEST_ORDER_V17[i];
      const state = getQuestState(id);
      if (state && state.status !== 'completed') return id;
      if (!state) {
        if (i === 0) return id;
        const prev = getQuestState(QUEST_ORDER_V17[i - 1]);
        if (prev?.status === 'completed') return id;
        return null;
      }
    }
    return null;
  }
  completeQuest = function completeQuestV17(id) {
    const q = getQuestState(id); const def = QUEST_DEFS[id];
    if (!q || q.status !== 'ready' || !def) return;
    q.status = 'completed'; q.completedAt = Date.now();
    if (def.reward?.exp) addExp(def.reward.exp);
    game.player.gold += Number(def.reward?.gold || 0); game.player.building += Number(def.reward?.building || 0);
    if (def.reward?.item && window.grantQuestRewardItemV38) window.grantQuestRewardItemV38(def.reward.item);
    savePlayer(); updateHud();
    toast(`퀘스트 완료! EXP +${def.reward.exp}, Gold +${def.reward.gold}, 빌딩 +${def.reward.building}`);
  };
  renderNpcDialogue = function renderNpcDialogueV17() {
    const currentId = getCurrentQuestIdForNpc();
    const q = currentId ? getQuestState(currentId) : null;
    const def = currentId ? QUEST_DEFS[currentId] : null;
    const page = game.dialogue.page || 0;
    let text = '오늘도 차근차근 성장해보자! 문제를 풀어 몬스터에게 데미지를 입히렴. 포탈 너머에서는 위험하니 조심하렴.';
    let options = [];
    if (!def) {
      options = [{ label: '대화 종료', action: 'closeModal()' }];
      text = '정말 많이 성장했구나! 지금까지의 모험을 잘 기억해두렴.';
    } else if (game.dialogue.mode === 'quest') {
      text = def.pages[page] || def.pages[def.pages.length - 1];
      options.push({ label: page < def.pages.length - 1 ? '다음 이야기' : '퀘스트 수락', action: page < def.pages.length - 1 ? 'nextDialoguePage()' : `acceptCurrentQuest('${def.id}')` });
      if (page > 0) options.push({ label: '이전 이야기', action: 'prevDialoguePage()' });
      options.push({ label: '기본 대화로 돌아가기', action: 'openQuestNpc()' });
    } else {
      if (!q) options.push({ label: `! ${def.title} 이야기 듣기`, action: 'startQuestStory()' });
      else if (q.status === 'accepted') options.push({ label: `진행 중: ${q.progress || 0}/${def.target}`, action: 'startQuestStory()' });
      else if (q.status === 'ready') options.push({ label: `! ${def.title} 완료 보고`, action: `completeCurrentQuest('${def.id}')` });
      else options.push({ label: '완료한 퀘스트 다시 보기', action: 'startQuestStory()' });
      options.push({ label: '대화 종료', action: 'closeModal()' });
    }
    const selected = Math.min(game.dialogue.selected || 0, options.length - 1); game.dialogue.selected = selected;
    openModal(`<div class="dialogue-box"><div class="dialogue-speaker"><h2>명진쌤 ${hasAvailableQuest() ? '<span class="badge">!</span>' : ''}</h2><div class="badge">E키로 진행</div></div><div class="dialogue-text">${escapeHtml(text)}</div><div class="dialogue-options">${options.map((opt,i)=>`<button class="${i===selected?'selected':''}" onclick="${opt.action}">${escapeHtml(opt.label)}</button>`).join('')}</div></div>`, { type:'dialogue', pause:true });
  };

  // 로그인 안내 문구 개선
  const oldStudentBtn = $('studentLoginBtn');
  if (oldStudentBtn) {
    oldStudentBtn.replaceWith(oldStudentBtn.cloneNode(true));
    $('studentLoginBtn').addEventListener('click', handleStudentLogin);
  }

  // 효과음: 치명타

  // 새로고침 없이 즉시 UI 동기화
  updateHud();
})();

/* v18: delayed monster defeat animation + class skill trees */
(() => {
  Object.assign(SKILL_DEFS, V18_SKILL_PATCHES);
  SKILL_LINES.push(...V18_SKILL_LINES);

  function classAttackStatName() {
    if (game.player?.class === 'mage') return '지능';
    if (game.player?.class === 'priest') return '정신';
    return '힘';
  }


  const oldDrawCombatCanvasesV18 = drawCombatCanvases;

  function finishDefeatedMonster(defeatedMonster, expGain) {
    game.currentCombatMonsterId = null;
    game.currentQuestion = null;
    game.currentCombatAction = null;
    game.combatHpDisplay = null;
    closeModal();
    game.modalState = { type: 'cinematic', pause: true };
    if (expGain > 0) addExp(expGain);
    addGold(defeatedMonster.gold);
    incrementQuestProgressByMonster(defeatedMonster);
    const expText = expGain > 0 ? `EXP +${expGain}` : '레벨 차이로 EXP 없음';
    showCinematicMessage('몬스터를 처치했습니다!', `${defeatedMonster.name} · ${expText} · Gold +${defeatedMonster.gold}`, 2040);
    appendChatMessage('system', '전투', `${defeatedMonster.name} 처치! ${expText}, Gold +${defeatedMonster.gold}`);
    savePlayer();
  }




  appendChatMessage?.('system', '패치', 'v18: 몬스터 사망 연출과 직업별 스킬트리가 적용되었습니다.');
})();

/* =========================
   v19 patch: specialization passives / healing well / quest rewards / elite quests / longer critical shake
   ========================= */
(function yuksamV19Patch(){
  if (!window.__YUKSAM_V19_PATCH__) window.__YUKSAM_V19_PATCH__ = true;

  // 명진쌤 위치를 포탈과 덜 겹치게 오른쪽 위로 이동
  if (worldDefs?.town?.npc) {
    worldDefs.town.npc.x = 1435;
    worldDefs.town.npc.y = 755;
  }

  // 포탈 근처 치유의 우물 오브젝트
  if (worldDefs?.town) {
    worldDefs.town.healingWell = { x: 1038, y: 968, r: 42, name: '치유의 우물' };
  }

  // 전문화가 실제 전투에 영향을 주도록 최소 패시브를 적용한다.
  totalStatsPipeline.register({
    id:'stats-specialization-v19',
    priority:190,
    apply:(total) => {
      const spec = game.player?.spec;
      const klass = game.player?.class;
      if (klass === 'warrior' && spec === '방어') {
        total.체력 = (total.체력 || 0) + 3;
      } else if (klass === 'warrior' && spec === '무기') {
        total.힘 = (total.힘 || 0) + 2;
      } else if (klass === 'mage' && spec === '냉기') {
        total.지능 = (total.지능 || 0) + 1;
        total.체력 = (total.체력 || 0) + 1;
      } else if (klass === 'mage' && spec === '화염') {
        total.지능 = (total.지능 || 0) + 2;
      } else if (klass === 'priest' && spec === '신성') {
        total.정신 = (total.정신 || 0) + 2;
        total.체력 = (total.체력 || 0) + 1;
      } else if (klass === 'priest' && spec === '암흑') {
        total.정신 = (total.정신 || 0) + 2;
      }
    },
  });

  function getSpecDamageMultiplier() {
    const spec = game.player?.spec;
    const klass = game.player?.class;
    if (klass === 'warrior' && spec === '무기') return 1.15;
    if (klass === 'warrior' && spec === '방어') return 0.95;
    if (klass === 'mage' && spec === '화염') return 1.18;
    if (klass === 'mage' && spec === '냉기') return 1.05;
    if (klass === 'priest' && spec === '암흑') return 1.15;
    if (klass === 'priest' && spec === '신성') return 1.00;
    return 1;
  }

  function getSpecIncomingMultiplier(monster) {
    const spec = game.player?.spec;
    const klass = game.player?.class;
    let mult = 1;
    if (klass === 'warrior' && spec === '방어') mult *= 0.85;
    if (klass === 'mage' && spec === '냉기' && monster?.chillTurns > 0) mult *= 0.85;
    if (klass === 'priest' && spec === '신성') mult *= 0.92;
    return mult;
  }

  function applySpecAfterSuccessfulHit(monster, dealtDamage) {
    const spec = game.player?.spec;
    const klass = game.player?.class;
    if (!monster || dealtDamage <= 0) return '';
    if (klass === 'mage' && spec === '냉기') {
      monster.chillTurns = 2;
      return ' 냉기가 스며들어 적의 다음 공격이 약해집니다.';
    }
    return '';
  }

  // 전문화 선택 직후 최대체력/현재체력 갱신

  // 치명타 흔들림 시간을 기존의 약 2배로 연장
  function triggerScreenShakeV19() {
    const el = $('gameCanvas') || document.body;
    el.classList.remove('screen-shake');
    void el.offsetWidth;
    el.classList.add('screen-shake');
    setTimeout(() => el.classList.remove('screen-shake'), 920);
  }

  function rollPlayerCriticalV19() { return Math.random() < 0.15; }
  function rollMonsterCriticalV19() { return Math.random() < 0.15; }

  // 전투 내 몬스터 반격 재정의: 전문화 방어/냉기/신성, 치명타 흔들림 2배 반영

  function calculateActionDamageV19() {
    let damage = getPlayerAttackPower();
    let actionMsg = `정답! ${damage} 피해를 주었습니다. `;
    if (String(game.currentCombatAction || '').startsWith('active:')) {
      const skillId = String(game.currentCombatAction).slice(7);
      const skill = SKILL_DEFS[skillId];
      if (skill?.active?.type === 'damage') {
        damage = Math.max(1, Math.ceil(getPlayerAttackPower() * skill.active.multiplier));
        actionMsg = `정답! ${skill.active.name}으로 ${damage} 피해를 주었습니다. `;
      } else if (skill?.active?.type === 'shield') {
        damage = 0;
        const pct = skill.active.shieldPct || .30;
        game.combatShield += Math.max(1, Math.ceil(game.player.maxHp * pct));
        actionMsg = `정답! ${skill.active.name}로 보호막 ${game.combatShield}을 얻었습니다. `;
      } else if (skill?.active?.type === 'healBuff') {
        damage = 0;
        const heal = Math.max(1, Math.ceil((game.player.maxHp - game.player.hp) * (skill.active.healLostPct || .15)));
        game.player.hp = Math.min(game.player.maxHp, game.player.hp + heal);
        game.combatStatuses.battleRoar = 2;
        actionMsg = `정답! ${skill.active.name}로 HP ${heal} 회복, 전투 의지가 타오릅니다. `;
      }
      setSkillCooldown(skillId, skill?.active?.cooldown || 3);
    }

    if (damage > 0) {
      damage = Math.max(1, Math.ceil(damage * getSpecDamageMultiplier()));
      const critical = rollPlayerCriticalV19();
      if (critical) {
        // 데미지 계산을 모두 마친 뒤 15% 확률로 최종 데미지 2배
        damage = Math.max(1, damage * 2);
        actionMsg = '치명타! ' + actionMsg.replace(/\d+ 피해/, `${damage} 피해`);
        triggerScreenShakeV19();
      }
      return { damage, actionMsg, critical };
    }
    return { damage, actionMsg, critical: false };
  }

  // 플레이어 공격 재정의: 최종 데미지 계산 후 15% 치명타, 전문화 효과, 죽음 연출 유지


  // 치유의 우물 그리기
  function drawHealingWellWorld() {
    const well = worldDefs.town.healingWell;
    if (!well) return;
    const p = worldToScreen(well.x, well.y);
    const ctx = game.ctx;
    const t = performance.now() / 1000;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (game.player && distance(game.player, well) < 92) {
      const glow = .55 + Math.sin(t * 5) * .2;
      ctx.strokeStyle = `rgba(74,222,128,${glow})`;
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(0, 36, 50, 15, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(0,0,0,.22)';
    ctx.beginPath(); ctx.ellipse(0, 36, 48, 13, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#64748b';
    roundRect(ctx, -42, -8, 84, 44, 14); ctx.fill();
    ctx.fillStyle = '#94a3b8';
    roundRect(ctx, -36, -18, 72, 20, 12); ctx.fill();
    const water = ctx.createRadialGradient(0, -8, 4, 0, -8, 34);
    water.addColorStop(0, '#e0f7ff'); water.addColorStop(.55, '#38bdf8'); water.addColorStop(1, '#0ea5e9');
    ctx.fillStyle = water;
    ctx.beginPath(); ctx.ellipse(0, -8, 31 + Math.sin(t * 3) * 2, 11, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(186,230,253,.75)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, -8, 38 + Math.sin(t * 2.3) * 3, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(7,16,27,.72)';
    roundRect(ctx, -56, 44, 112, 24, 999); ctx.fill();
    ctx.fillStyle = '#dff8ff'; ctx.textAlign = 'center'; ctx.font = '800 14px Jua, Noto Sans KR, sans-serif';
    ctx.fillText('치유의 우물', 0, 61);
    ctx.restore();
  }

  const oldDrawTownV19 = drawTown;
  drawTown = function drawTownV19() {
    oldDrawTownV19();
    drawHealingWellWorld();
  };

  function getHealingQuestion() {
    const candidates = getQuestions().filter((q) => q.zone === 'silent_forest');
    return candidates[Math.floor(Math.random() * candidates.length)] || { q: '7 + 5 = ?', choices: ['10','11','12','13'], answer: '12' };
  }

  window.openHealingWellModal = function openHealingWellModal() {
    game.healingQuestion = getHealingQuestion();
    const q = game.healingQuestion;
    const choices = Array.isArray(q.choices) && q.choices.length === 4 ? q.choices : null;
    const answerUi = choices ? `<div class="choice-grid healing-well-choice-grid">${choices.map((c) => `<button class="primary" onclick="submitHealingAnswer('${escapeJs(c)}')">${escapeHtml(c)}</button>`).join('')}</div>` : `
      <div class="answer-row"><input id="healingAnswer" placeholder="정답 입력" onkeydown="if(event.key==='Enter') submitHealingAnswer(this.value)" autofocus /><button class="primary" onclick="submitHealingAnswer(document.getElementById('healingAnswer').value)">회복</button></div>`;
    openModal(`
      <h2>치유의 우물</h2>
      <div class="panel-card">
        <p class="healing-well-intro">치유의 우물이다!<br><strong>문제를 맞히면 HP가 모두 회복됩니다!</strong></p>
        <img class="healing-well-quiz-image" src="assets/치유의 우물.png" alt="치유의 우물">
        <h3>${escapeHtml(q.q)}</h3>
        ${answerUi}
        <p class="muted">실패하면 다시 우물에 말을 걸어야 합니다.</p>
      </div>
    `, { type: 'healingWell', pause: true });
    setTimeout(() => $('healingAnswer')?.focus(), 60);
  };

  window.submitHealingAnswer = function submitHealingAnswer(given) {
    const q = game.healingQuestion;
    if (!q) return closeModal();
    if (normalize(given) === normalize(q.answer)) {
      game.player.hp = game.player.maxHp;
      window.recordHealingQuestSuccessV3?.();
      savePlayer(); updateHud(); closeModal();
      playSfx('quest');
      showCinematicMessage('회복 완료!', '치유의 우물빛이 몸을 감싸며 HP가 모두 회복되었습니다.', 1500);
      appendChatMessage('system', '치유의 우물', '문제를 맞혀 HP를 모두 회복했습니다.');
    } else {
      closeModal();
      playSfx('hit');
      showCinematicMessage('회복 실패', '정답이 아닙니다. 다시 우물에 말을 걸어 도전하세요.', 1500);
      appendChatMessage('system', '치유의 우물', '회복 문제에 실패했습니다.');
    }
    game.healingQuestion = null;
  };

  const QUEST_ORDER_V19 = QUEST_ORDER;

  function getCurrentQuestIdForNpcV19() {
    for (let i = 0; i < QUEST_ORDER_V19.length; i += 1) {
      const id = QUEST_ORDER_V19[i];
      const state = getQuestState(id);
      if (!state) {
        if (i === 0) return id;
        const prev = getQuestState(QUEST_ORDER_V19[i - 1]);
        return prev?.status === 'completed' ? id : null;
      }
      if (state.status !== 'completed') return id;
    }
    return null;
  }




  function applyQuestRewardV19(id) {
    const q = getQuestState(id);
    const def = QUEST_DEFS[id];
    if (!q || !def || q.status !== 'ready') return null;
    q.status = 'completed';
    q.completedAt = Date.now();
    const reward = def.reward || {};
    if (reward.exp) addExp(reward.exp);
    if (reward.gold) addGold(reward.gold);
    if (reward.building) addBuilding(reward.building);
    savePlayer(); updateQuestTracker(); updateHud();
    return reward;
  }

  function renderNpcDialogueV19() {
    const currentId = getCurrentQuestIdForNpcV19();
    const q = currentId ? getQuestState(currentId) : null;
    const def = currentId ? QUEST_DEFS[currentId] : null;
    let text = '오늘도 차근차근 성장해보자!';
    let options = [];
    const selected = 0;
    if (!def) {
      text = '정말 고생했다. 지금까지 해낸 것만으로도 충분히 멋진 성장이다!';
      options.push({ label: '고마워요!', action: 'closeModal()' });
    } else if (game.dialogue.mode === 'quest') {
      const page = game.dialogue.page || 0;
      text = def.pages?.[page] || def.desc;
      options.push({ label: page < (def.pages?.length || 1) - 1 ? '다음 이야기' : '퀘스트 수락', action: page < (def.pages?.length || 1) - 1 ? 'nextDialoguePage()' : `acceptCurrentQuest('${def.id}')` });
      options.push({ label: '기본 대화로 돌아가기', action: 'openQuestNpc()' });
    } else if (q?.status === 'ready') {
      const praises = [
        '정말 고생했다. 끝까지 포기하지 않은 게 가장 멋졌어.',
        '훌륭해! 오늘의 성장은 분명히 너의 힘이 될 거야.',
        '잘해냈구나. 차근차근 쌓은 실력이 보이고 있어.',
        '위험한 길이었을 텐데 침착하게 해냈구나. 자랑스럽다!'
      ];
      text = def.done || praises[Math.floor(Math.random() * praises.length)]; // [피드백] 퀘스트별 완료 대사 우선
      options.push({ label: '보상 받기', action: `claimQuestReward('${def.id}')` });
      options.push({ label: '조금 있다 받을게요', action: 'closeModal()' });
    } else {
      text = '문제를 풀어 몬스터에게 데미지를 입히렴. 포탈 너머에서는 위험하니 조심하렴.';
      if (!q) options.push({ label: `! ${def.title} 이야기 듣기`, action: 'startQuestStory()' });
      else if (q.status === 'accepted') options.push({ label: `진행 중: ${q.progress || 0}/${def.target}`, action: 'startQuestStory()' });
      else options.push({ label: '완료한 퀘스트 다시 보기', action: 'startQuestStory()' });
      options.push({ label: '대화 종료', action: 'closeModal()' });
    }
    openModal(`<div class="dialogue-box"><div class="dialogue-speaker"><h2>명진쌤 ${hasAvailableQuest() ? '<span class="badge">!</span>' : ''}</h2><div class="badge">E키로 진행</div></div><div class="dialogue-text">${escapeHtml(text)}</div><div class="dialogue-options">${options.map((opt,i)=>`<button class="${i===selected?'selected':''}" onclick="${opt.action}">${escapeHtml(opt.label)}</button>`).join('')}</div></div>`, { type:'dialogue', pause:true });
  }


  // 퀘스트 수락 함수가 현재 def.target을 제대로 반영하도록 보강

  appendChatMessage?.('system', '패치', 'v19: 전문화 효과, 치명타 연출, 치유의 우물, 퀘스트 보상/엘리트 퀘스트가 적용되었습니다.');
})();

/* =========================
   v20 patch: UX polish / swamp BGM / gate cards / skill tree redesign / slower battle
   ========================= */
(function yuksamV20Patch(){
  if (window.__YUKSAM_V20_PATCH__) return;
  window.__YUKSAM_V20_PATCH__ = true;

  // 1) 치유의 우물 위치를 포탈 왼쪽으로 더 분리
  if (worldDefs?.town) {
    worldDefs.town.healingWell = { x: 930, y: 1035, r: 42, name: '치유의 우물' };
  }

  // 2) 로그인/캐릭터 생성 화면용 톱니바퀴 복구 및 인게임 숨김
  const settingsBtn = $('settingsBtn');
  if (settingsBtn) {
    settingsBtn.textContent = '⚙';
    settingsBtn.setAttribute('title', '환경설정');
    settingsBtn.setAttribute('aria-label', '환경설정');
    settingsBtn.classList.add('settings-gear-only');
  }
  const oldShowScreenV20 = showScreen;
  showScreen = function showScreenV20(name) {
    oldShowScreenV20(name);
    const btn = $('settingsBtn');
    if (btn) btn.classList.toggle('hidden', name === 'game');
  };

  // 3) 늪지 음악 파일 추가
  function ensureSwampAudioV20() {
    initAudio();
    if (!game.audio || !game.audio.ctx) return;
    if (!game.audio.swampFile) {
      game.audio.swampFile = new Audio(window.getAudioAsset?.('swampBgm')?.src || '');
      game.audio.swampFile.loop = true;
      game.audio.swampFile.preload = 'auto';
      game.audio.swampFile.volume = game.settings.bgmEnabled ? Math.min(1, Math.max(0, game.settings.bgmVolume)) : 0;
    }
  }
  const oldGetDesiredAudioFileV20 = getDesiredAudioFile;
  getDesiredAudioFile = function getDesiredAudioFileV20() {
    ensureSwampAudioV20();
    if (!game.settings.bgmEnabled) return null;
    if (screens.game.classList.contains('active') && game.currentMap === 'swamp') return game.audio.swampFile || null;
    return oldGetDesiredAudioFileV20();
  };
  syncAudioFileBgm = function syncAudioFileBgmV20() {
    initAudio();
    ensureSwampAudioV20();
    const files = [game.audio.file, game.audio.forestFile, game.audio.desertFile, game.audio.swampFile].filter(Boolean);
    const desired = getDesiredAudioFile();
    files.forEach((file) => {
      file.volume = game.settings.bgmEnabled ? Math.min(1, Math.max(0, game.settings.bgmVolume)) : 0;
      if (file === desired) file.play().catch(() => {});
      else file.pause();
    });
  };
  audioVolumePipeline.register({
    id:'audio-volume-v20',
    priority:200,
    after:() => {
      ensureSwampAudioV20();
      if (game.audio.swampFile) game.audio.swampFile.volume = game.settings.bgmEnabled ? Math.min(1, Math.max(0, game.settings.bgmVolume)) : 0;
    },
  });

  // 4) 문 여닫는 효과음 추가 및 건물 입출입에 연결
  audioAdapters.doorSynth = function playDoorSynthV20() {
    resumeAudio();
    if (!game.settings.sfxEnabled) return;
    playTone(220, .07, 'triangle', .18);
    setTimeout(() => playTone(145, .10, 'sine', .13), 55);
    setTimeout(() => playTone(95, .06, 'triangle', .09), 140);
  };
  audioAdapters.door = audioAdapters.doorSynth;
  const oldEnterEquipmentShopV20 = enterEquipmentShop;
  enterEquipmentShop = function enterEquipmentShopV20() { playSfx('door'); oldEnterEquipmentShopV20(); };
  const oldEnterBuildingShopInteriorV20 = enterBuildingShopInterior;
  enterBuildingShopInterior = function enterBuildingShopInteriorV20() { playSfx('door'); oldEnterBuildingShopInteriorV20(); };
  // 5) 캐릭터 신규 생성 시 검은 시네마틱 화면 후 생성창 표시
  const secureHandleStudentLoginV2 = handleStudentLogin;
  handleStudentLogin = function handleStudentLoginV20() {
    if (typeof isServerOpen === 'function' && !isServerOpen()) { toast('지금은 서버가 닫혀 있어요. 선생님이 열어주면 접속할 수 있습니다!'); return; }
    if (secureStudentAccess.enabled) {
      resumeAudio();
      return secureHandleStudentLoginV2();
    }
    const name = String($('loginName').value ?? '').trim().normalize('NFC');
    const password = $('loginPassword').value.trim();
    if (!name) { toast('캐릭터 이름을 입력하세요.'); return; }
    if (!password) { toast('비밀번호를 입력하세요.'); return; }
    resumeAudio();
    game.currentName = name;
    game.currentPassword = password;
    const stored = readPlayerStorage(name);
    if (stored.status === 'corrupt') {
      game.player = null;
      toast('저장 데이터가 손상되어 로그인할 수 없습니다.');
      showCinematicMessage('로그인 실패', '저장 데이터를 초기화하기 전에는 같은 이름으로 캐릭터를 만들 수 없습니다.', 1800);
      return;
    }
    const existing = stored.player;
    if (existing) {
      if (existing.password !== password) {
        toast('비밀번호가 틀렸습니다.');
        showCinematicMessage('로그인 실패', '비밀번호가 틀렸습니다.', 1200);
        return;
      }
      game.player = existing;
      playSfx('world');
      startGame(true);
      return;
    }
    const checkedNewName = validateCharacterName(name);
    if (!checkedNewName.ok) { toast(checkedNewName.message); return; }
    game.currentName = checkedNewName.name;
    showNewCharacterCreatorTransition(game.currentName);
  };
  const studentBtn = $('studentLoginBtn');
  if (studentBtn) {
    studentBtn.replaceWith(studentBtn.cloneNode(true));
    $('studentLoginBtn').addEventListener('click', handleStudentLogin);
  }

  // 6) 포탈 사냥터 선택 UI: 레벨 부족 지역 회색 음영 처리
  function dungeonCardV20({ level, title, desc, onclick, locked, lockText }) {
    return `<div class="student-item dungeon-card-v20 ${locked ? 'locked' : ''}">
      <div class="badge ${locked ? 'danger' : 'gold'}">Lv.${level} ${locked ? '입장 제한' : '입장 가능'}</div>
      <h3>${title}</h3>
      <p>${desc}</p>
      ${locked ? `<p class="lock-reason">${lockText}</p><button class="wide" disabled>레벨 부족</button>` : `<button class="primary wide" onclick="${onclick}">입장하기</button>`}
    </div>`;
  }

  // 7) 스킬창 재디자인 + 상단 UI 버튼 재연결
  function skillIconV20(skill) {
    if (skill.kind === 'ultimate') return '✦';
    if (skill.kind === 'guard') return '🛡';
    if (skill.kind === 'power') return '⚔';
    if (skill.kind === 'frost') return '❄';
    if (skill.kind === 'fire') return '🔥';
    if (skill.kind === 'holy') return '✚';
    if (skill.kind === 'shadow') return '☾';
    return '◆';
  }
  const skillBtn = $('openSkillTreeBtn');
  if (skillBtn) {
    skillBtn.replaceWith(skillBtn.cloneNode(true));
    $('openSkillTreeBtn').addEventListener('click', openSkillTreeModal);
  }

  // 8) 전투 체감 속도 20% 완화: 체력바/후속 동작 기본 지연을 보강
  // 핵심 타이밍은 파일 본문에서 620→760, 900→1080, 1850→2220으로 조정했고,
  // 여기서는 CSS 클래스와 전투 잠금 시간을 추가로 보강한다.
  combatFramePipeline.register({
    id:'combat-frame-v20',
    priority:200,
    after:() => {
      const box = $('modalContent')?.querySelector('.combat-scene');
      if (box) box.classList.add('combat-slower-v20');
    },
  });

  // 설정 버튼 초기 가시성 동기화
  showScreen(screens.game.classList.contains('active') ? 'game' : (screens.creator.classList.contains('active') ? 'creator' : 'landing'));
  appendChatMessage?.('system', '패치', 'v20: 늪지 BGM, 포탈 잠금 카드, 스킬창 디자인, 전투 속도 조정이 적용되었습니다.');
})();

/* =========================
   v21 patch: dialogue quest markers / story quest line / in-game settings / vertical skill tree / boss music / final boss portal
   ========================= */
(function yuksamV21Patch(){
  if (window.__YUKSAM_V21_PATCH__) return;
  window.__YUKSAM_V21_PATCH__ = true;

  Object.assign(game.settings, window.YuksamAudioDefaults.defaultSettings());
  try { updateAudioVolumes(); } catch {}

  // 인게임 환경설정 버튼 복구
  function ensureInGameSettingsButton() {
    if ($('gameSettingsBtn')) return;
    const shell = document.querySelector('.game-shell');
    if (!shell) return;
    const btn = document.createElement('button');
    btn.id = 'gameSettingsBtn';
    btn.className = 'ingame-settings-gear';
    btn.title = '환경설정';
    btn.setAttribute('aria-label', '환경설정');
    btn.textContent = '⚙';
    btn.addEventListener('click', () => { resumeAudio(); openSettingsModal(); });
    shell.appendChild(btn);
  }
  ensureInGameSettingsButton();

  // 보스방 음악 파일 추가
  function ensureBossAudioV21() {
    initAudio();
    if (!game.audio || !game.audio.ctx) return;
    if (!game.audio.bossFile) {
      game.audio.bossFile = new Audio(window.getAudioAsset?.('bossBgm')?.src || '');
      game.audio.bossFile.loop = true;
      game.audio.bossFile.preload = 'auto';
      game.audio.bossFile.volume = game.settings.bgmEnabled ? Math.min(1, Math.max(0, game.settings.bgmVolume)) : 0;
    }
    if (!game.audio.battleFile) {
      game.audio.battleFile = new Audio(window.getAudioAsset?.('battleBgm')?.src || '');
      game.audio.battleFile.loop = true;
      game.audio.battleFile.preload = 'auto';
      game.audio.battleFile.volume = game.settings.bgmEnabled ? Math.min(1, Math.max(0, game.settings.bgmVolume)) : 0;
    }
  }
  const oldGetDesiredAudioFileV21 = getDesiredAudioFile;
  getDesiredAudioFile = function getDesiredAudioFileV21() {
    ensureBossAudioV21();
    if (!game.settings.bgmEnabled) return null;
    const activePvpV21 = window.getActivePvpMatchV1?.();
    if (activePvpV21 && !['finished', 'cancelled'].includes(activePvpV21.phase)) return game.audio.battleFile || null;
    if (screens.game.classList.contains('active') && (game.currentMap === 'bossRoom' || game.currentMap === 'finalBossRoom')) return game.audio.bossFile || null;
    return oldGetDesiredAudioFileV21();
  };
  const oldSyncAudioFileBgmV21 = syncAudioFileBgm;
  syncAudioFileBgm = function syncAudioFileBgmV21() {
    initAudio();
    ensureBossAudioV21();
    const files = [game.audio.loginFile, game.audio.file, game.audio.forestFile, game.audio.desertFile, game.audio.swampFile, game.audio.bossFile, game.audio.battleFile].filter(Boolean);
    const desired = getDesiredAudioFile();
    files.forEach((file) => {
      file.volume = game.settings.bgmEnabled ? Math.min(1, Math.max(0, game.settings.bgmVolume)) : 0;
      if (file === desired) file.play().catch(() => {});
      else if (file && file !== desired) file.pause();
    });
  };
  window.syncPvpBgmV1 = function syncPvpBgmV1() {
    resumeAudio();
  };
  audioVolumePipeline.register({
    id:'audio-volume-v21',
    priority:210,
    after:() => {
      ensureBossAudioV21();
      if (game.audio.bossFile) game.audio.bossFile.volume = game.settings.bgmEnabled ? Math.min(1, Math.max(0, game.settings.bgmVolume)) : 0;
      if (game.audio.battleFile) game.audio.battleFile.volume = game.settings.bgmEnabled ? Math.min(1, Math.max(0, game.settings.bgmVolume)) : 0;
    },
  });

  // 객관식 보기 순서 랜덤화
  const oldGetQuestionForZoneV21 = getQuestionForZone;
  getQuestionForZone = function getQuestionForZoneV21(zoneKey) {
    const q = oldGetQuestionForZoneV21(zoneKey);
    if (q && Array.isArray(q.choices) && q.choices.length > 1) {
      const choices = q.choices.slice();
      for (let i = choices.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [choices[i], choices[j]] = [choices[j], choices[i]];
      }
      return { ...q, choices };
    }
    return q;
  };

  const QUEST_ORDER_V21 = QUEST_ORDER;
  const QUEST_NPC_IDS_V3 = Object.freeze({
    weapon:'tut_shop',
    armor:'tut_shop',
    accessory:'tut_accessory',
    costume:'tut_costume',
    enhance:'tut_enhance',
  });
  let questNpcContinuationV3 = null;

  function migrateTutorialQuestsV3() {
    const changed = window.YuksamQuestTutorialPolishV3?.migrateHealingQuest(game.player?.quests);
    if (changed) savePlayer();
    return !!changed;
  }

  window.openQuestNpcIntroV3 = function openQuestNpcIntroV3(kind, continuation) {
    const questId = QUEST_NPC_IDS_V3[kind];
    const state = questId ? getQuestState(questId) : null;
    const intro = window.YuksamQuestTutorialPolishV3?.getNpcIntro(kind, state);
    if (!intro) return false;
    questNpcContinuationV3 = typeof continuation === 'function' ? continuation : null;
    const action = intro.gift ? 'receiveQuestCostumeV3()' : `continueQuestNpcIntroV3('${kind}')`;
    const label = intro.gift ? '선물 받기' : '알겠어요!';
    openModal(`
      <div class="dialogue-box">
        <div class="dialogue-speaker"><h2>${kind === 'costume' ? '옷 상인 상남' : kind === 'accessory' ? '특별 상인 새나리' : kind === 'enhance' ? '대장장이 진명' : kind === 'armor' ? '방어구 상인 상미' : '무기 상인 의석'}</h2></div>
        <div class="dialogue-text">${YuksamQuestText.emphasize(intro.text)}</div>
        <div class="dialogue-options"><button class="selected" onclick="${action}">${label}</button></div>
      </div>
    `, { type:'dialogue', pause:true });
    return true;
  };

  window.continueQuestNpcIntroV3 = function continueQuestNpcIntroV3(kind) {
    const questId = QUEST_NPC_IDS_V3[kind];
    window.YuksamQuestTutorialPolishV3?.markNpcIntroSeen(getQuestState(questId));
    savePlayer();
    closeModal();
    const continuation = questNpcContinuationV3;
    questNpcContinuationV3 = null;
    continuation?.();
  };

  window.receiveQuestCostumeV3 = function receiveQuestCostumeV3() {
    const result = window.YuksamQuestTutorialPolishV3?.grantQuestCostume({
      player:game.player,
      questState:getQuestState('tut_costume'),
      itemId:'cs_questSproutRibbon',
    });
    savePlayer();
    updateHud();
    updateQuestTracker();
    closeModal();
    if (result?.granted) {
      playSfx('quest');
      showCinematicMessage('새싹 리본 획득!', '상남에게 특별한 퀘스트 코스튬을 선물받았습니다.', 2200);
      appendChatMessage('system', '코스튬 선물', '새싹 리본을 받았습니다.');
    } else {
      toast('이미 새싹 리본을 가지고 있습니다.');
    }
    questNpcContinuationV3 = null;
  };

  window.recordHealingQuestSuccessV3 = function recordHealingQuestSuccessV3() {
    const changed = window.YuksamQuestTutorialPolishV3?.recordHealingSuccess(getQuestState('tut_healing_well'));
    if (changed) {
      savePlayer();
      updateQuestTracker();
    }
    return !!changed;
  };

  let healingTrainingAttackTimerV61 = null;
  function triggerHealingTrainingShakeV61() {
    const el = $('gameCanvas') || document.body;
    el.classList.remove('screen-shake');
    void el.offsetWidth;
    el.classList.add('screen-shake');
    setTimeout(() => el.classList.remove('screen-shake'), 920);
  }

  function applyHealingTrainingAcceptV3(id) {
    if (id !== 'tut_healing_well') return false;
    const questState = getQuestState(id);
    const trainingPlayer = game.player;
    const hpBeforeAttack = Math.max(1, Number(trainingPlayer?.hp) || 1);
    const result = window.YuksamQuestTutorialPolishV3?.applyTrainingAccept({
      questId:id,
      player:trainingPlayer,
      questState,
    });
    if (!result?.applied) {
      if (!questState || questState.status !== 'accepted' || Number(trainingPlayer?.hp) <= 1) return false;
      questState.trainingApplied = true;
      trainingPlayer.hp = 1;
    }
    trainingPlayer.hp = hpBeforeAttack;
    game.combatImpact = { target:'player', until:Date.now() + 900 };
    playSfx('enemyAttack');
    triggerHealingTrainingShakeV61();
    playSfx('critical');
    showCinematicMessage('치명타!', '명진쌤의 안전한 훈련 공격! HP가 1이 되었어요. 치유의 우물에서 문제를 풀어 회복해 보세요.', 2600);
    appendChatMessage('system', '회복 훈련', '명진쌤의 훈련 공격으로 HP가 1이 되었습니다.');
    if (healingTrainingAttackTimerV61) clearTimeout(healingTrainingAttackTimerV61);
    healingTrainingAttackTimerV61 = setTimeout(() => {
      healingTrainingAttackTimerV61 = null;
      if (game.player !== trainingPlayer) return;
      trainingPlayer.hp = 1;
      savePlayer();
      updateHud();
    }, 650);
    return true;
  }

  function getCurrentQuestIdForNpcV21() {
    migrateTutorialQuestsV3();
    for (let i = 0; i < QUEST_ORDER_V21.length; i += 1) {
      const id = QUEST_ORDER_V21[i];
      const state = getQuestState(id);
      if (!state) {
        if (i === 0) return id;
        const prev = getQuestState(QUEST_ORDER_V21[i - 1]);
        return prev?.status === 'completed' ? id : null;
      }
      if (state.status !== 'completed') return id;
    }
    return null;
  }
  function getNpcQuestMarkerV21() {
    const id = getCurrentQuestIdForNpcV21();
    if (!id) return '';
    const q = getQuestState(id);
    if (!q) return '!';
    if (q.status === 'ready') return '?';
    return '';
  }
  hasAvailableQuest = function hasAvailableQuestV21() { return !!getNpcQuestMarkerV21(); };

  const oldDrawNpcSpriteV21 = drawNpcSprite;
  drawNpcSprite = function drawNpcSpriteV21(ctx, x, y, name, hasQuest = false, scale = 1, highlighted = false, klass = 'priest') {
    if (String(name).includes('명진쌤')) {
      oldDrawNpcSpriteV21(ctx, x, y, name, false, scale, highlighted, klass);
      const mark = getNpcQuestMarkerV21();
      if (mark) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.font = `${Math.round(30 * scale)}px Jua, Noto Sans KR, system-ui`;
        ctx.lineWidth = 5 * scale;
        ctx.strokeStyle = 'rgba(20,20,20,.85)';
        ctx.strokeText(mark, x, y - 52 * scale);
        ctx.fillStyle = mark === '?' ? '#60a5fa' : '#ffd84d';
        ctx.fillText(mark, x, y - 52 * scale);
        ctx.restore();
      }
      return;
    }
    oldDrawNpcSpriteV21(ctx, x, y, name, hasQuest, scale, highlighted, klass);
  };

  function renderNpcDialogueV21() {
    const currentId = getCurrentQuestIdForNpcV21();
    const q = currentId ? getQuestState(currentId) : null;
    const def = currentId ? QUEST_DEFS[currentId] : null;
    let text = '오늘도 차근차근 성장해보자! 문제를 풀어 몬스터에게 데미지를 입히렴. 포탈 너머에서는 위험하니 조심하렴.';
    let options = [];
    const selected = Math.max(0, game.dialogue.selected || 0);
    const marker = getNpcQuestMarkerV21();
    if (!def) {
      text = '정말 고생했다. 63마을을 위해 끝까지 모험해준 너의 용기가 모두에게 힘이 되었어.';
      options.push({ label: '고마워요!', action: 'closeModal()' });
    } else if (game.dialogue.mode === 'quest') {
      const page = game.dialogue.page || 0;
      text = def.pages?.[page] || def.desc;
      options.push({ label: page < (def.pages?.length || 1) - 1 ? '다음 이야기' : '퀘스트 수락', action: page < (def.pages?.length || 1) - 1 ? 'nextDialoguePage()' : `acceptCurrentQuest('${def.id}')` });
      options.push({ label: '기본 대화로 돌아가기', action: 'openQuestNpc()' });
    } else if (q?.status === 'ready') {
      const praises = [
        '정말 고생했다. 어려운 길이었을 텐데 끝까지 해냈구나.',
        '훌륭해! 63마을 친구들이 네 덕분에 한숨 돌릴 수 있게 되었어.',
        '잘해냈구나. 차근차근 쌓은 실력이 이제 정말 빛나고 있어.',
        '위험한 길에서도 침착하게 해냈구나. 선생님이 정말 자랑스럽다!'
      ];
      text = def.done || praises[Math.floor(Math.random() * praises.length)]; // [피드백] 퀘스트별 완료 대사 우선
      options.push({ label: '보상 받기', action: `claimQuestReward('${def.id}')` });
      options.push({ label: '조금 있다 받을게요', action: 'closeModal()' });
    } else {
      if (!q) options.push({ label: `! ${def.title} 이야기 듣기`, action: 'startQuestStory()' });
      else if (q.status === 'accepted') options.push({ label: `진행 중: ${q.progress || 0}/${def.target}`, action: 'startQuestStory()' });
      else options.push({ label: '완료한 퀘스트 다시 보기', action: 'startQuestStory()' });
      options.push({ label: '대화 종료', action: 'closeModal()' });
    }
    game.dialogue.selected = Math.min(selected, Math.max(0, options.length - 1));
    const dialogueTheme = window.YuksamQuestDialogueTheme?.classSuffix({
      mode:game.dialogue.mode,
      questStatus:q?.status,
      hasQuest:!!def,
    }) || '';
    openModal(`<div class="dialogue-box${dialogueTheme}"><div class="dialogue-speaker"><h2>명진쌤 ${marker ? `<span class="badge quest-marker-badge">${marker}</span>` : ''}</h2><div class="badge">E키로 진행</div></div><div class="dialogue-text">${YuksamQuestText.emphasize(text)}</div><div class="dialogue-options">${options.map((opt,i)=>`<button class="${i===game.dialogue.selected?'selected':''}" onclick="${opt.action}">${YuksamQuestText.emphasize(opt.label)}</button>`).join('')}</div></div>`, { type:'dialogue', pause:true });
  }
  window.startQuestStory = function startQuestStoryV21() { game.dialogue = { page: 0, selected: 0, mode: 'quest' }; renderNpcDialogueV21(); };
  window.nextDialoguePage = function nextDialoguePageV21() { const id = getCurrentQuestIdForNpcV21(); const def = QUEST_DEFS[id]; game.dialogue.page = Math.min((def?.pages?.length || 1) - 1, (game.dialogue.page || 0) + 1); renderNpcDialogueV21(); };
  window.prevDialoguePage = function prevDialoguePageV21() { game.dialogue.page = Math.max(0, (game.dialogue.page || 0) - 1); renderNpcDialogueV21(); };
  openQuestNpc = function openQuestNpcV21() { game.dialogue = { page: 0, selected: 0, mode: 'base' }; renderNpcDialogueV21(); };

  acceptQuest = function acceptQuestV21(id = 'mushroom_hunt') {
    const def = QUEST_DEFS[id]; if (!def) return;
    if (!game.player.quests) game.player.quests = {};
    game.player.quests[id] = { id, status:'accepted', progress:0, target:def.target, acceptedAt:Date.now() };
    // [피드백] 수락 즉시 지급(보급품/자금): grantOnAccept { item, building, gold }
    const grant = def.grantOnAccept;
    if (grant) {
      if (grant.item && window.grantQuestRewardItemV38) window.grantQuestRewardItemV38(grant.item);
      if (grant.building) { addBuilding(grant.building); toast(`🏢 빌딩 화폐 ${grant.building}개를 받았습니다!`); }
      if (grant.gold) { addGold(grant.gold); toast(`💰 ${grant.gold}골드를 받았습니다!`); }
    }
    if (id === 'tut_skill' && Object.values(game.player.skills || {}).some((rank) => Number(rank) > 0)) {
      game.player.quests[id].progress = def.target;
      game.player.quests[id].status = 'ready';
    }
    savePlayer(); updateQuestTracker();
  };
  window.acceptCurrentQuest = function acceptCurrentQuestV21(id) {
    const existingQuest = getQuestState(id);
    if (existingQuest) {
      if (id === 'tut_healing_well' && existingQuest.status === 'accepted' && Number(game.player?.hp) > 1) {
        closeModal();
        applyHealingTrainingAcceptV3(id);
        return;
      }
      toast('이미 받은 퀘스트입니다.');
      return;
    }
    if (id !== 'tut_healing_well') playSfx('quest');
    acceptQuest(id);
    closeModal();
    if (!applyHealingTrainingAcceptV3(id)) {
      showCinematicMessage('퀘스트 수락!', `${QUEST_DEFS[id].title} 퀘스트를 시작합니다.`, 1600);
    }
    appendChatMessage('system', '퀘스트', `${QUEST_DEFS[id].title} 수락`);
  };
  function applyQuestRewardV21(id) { const q = getQuestState(id); const def = QUEST_DEFS[id]; if (!q || q.status !== 'ready' || !def) return null; q.status = 'completed'; q.completedAt = Date.now(); const r = def.reward || {}; if (r.exp) addExp(r.exp); if (r.gold) addGold(r.gold); if (r.building) addBuilding(r.building); if (r.item && window.grantQuestRewardItemV38) window.grantQuestRewardItemV38(r.item); savePlayer(); updateHud(); updateQuestTracker(); return r; }
  window.claimQuestReward = function claimQuestRewardV21(id) {
    const def = QUEST_DEFS[id];
    const reward = applyQuestRewardV21(id);
    if (!reward) { toast('받을 수 있는 보상이 없습니다.'); return; }
    closeModal();
    if (!window.playQuestCompletionSoundV42?.()) playSfx('quest');
    const rewardText = `EXP +${reward.exp || 0} · Gold +${reward.gold || 0} · 빌딩 +${reward.building || 0}`;
    showRewardSequenceV2('퀘스트 보상 획득!', `${def.title} 완료`, reward);
    appendChatMessage('system', '퀘스트 보상', `${def.title}: ${rewardText}`);
  };
  window.completeCurrentQuest = function completeCurrentQuestV21(id) { game.dialogue = { page:0, selected:0, mode:'base' }; renderNpcDialogueV21(); };
  updateQuestTracker = function updateQuestTrackerV21() {
    const tracker = $('questTracker');
    if (!tracker || !game.player) return;
    const activeId = QUEST_ORDER_V21.find((id) => { const q = getQuestState(id); return q && q.status !== 'completed'; });
    if (!activeId) { tracker.classList.add('hidden'); tracker.innerHTML = ''; return; }
    const q = getQuestState(activeId); const def = QUEST_DEFS[activeId];
    const pct = Math.min(100, Math.round(((q.progress || 0) / (q.target || def.target)) * 100));
    tracker.classList.remove('hidden');
    tracker.innerHTML = `<h3>${YuksamQuestText.emphasize(def.title)}</h3><p>${YuksamQuestText.emphasize(def.desc)}</p><p><b>진행도:</b> ${q.progress || 0}/${def.target} ${q.status === 'ready' ? '· 보고 가능' : ''}</p><div class="quest-progress-bar"><div class="quest-progress-fill" style="width:${pct}%"></div></div>`;
  };
  window.incrementQuestProgressByMonster = function incrementQuestProgressByMonsterV21(monster) {
    if (!monster || !game.player?.quests) return;
    if (monster.elite && monster.type === 'zombie') {
      game.finalBossPortalUnlocked = true; // [피드백] 세션 한정 — 방을 나가면 사라짐
      appendChatMessage('system', '수상한 기운', '엘리트 좀비가 쓰러진 자리에 ??? 포탈의 기운이 생겨났습니다.');
    }
    QUEST_ORDER_V21.forEach((id) => {
      const q = getQuestState(id); const def = QUEST_DEFS[id];
      if (!q || q.status !== 'accepted' || !def) return;
      if (def.eliteOnly && !monster.elite) return;
      if (!def.eliteOnly && monster.elite) return;
      if (!def.targetTypes?.includes(monster.type)) return;
      q.progress = Math.min(def.target, (q.progress || 0) + 1);
      if (q.progress >= def.target) { q.status = 'ready'; appendChatMessage('system', '퀘스트', `${def.title} 목표 달성! 명진쌤에게 돌아가세요.`); toast('퀘스트 목표 달성! 명진쌤에게 돌아가세요.'); }
    });
    savePlayer(); updateQuestTracker();
  };

  // E키로 대화 선택지 진행
  YuksamInputRouter.register({ id:'dialogue-confirm', type:'keydown', priority:85, handle:(e) => {
    if (e.key?.toLowerCase() === 'e' && game.modalState?.type === 'dialogue') {
      e.preventDefault();
      e.stopImmediatePropagation();
      confirmDialogueSelection();
      return true;
    }
  }});

  // 전투 도망 연출: 플레이어가 왼쪽으로 사라짐

  // 전투 캔버스 보정: 엘리트 스네이크가 잘리지 않도록 축소, 최종 보스 명진쌤 표시

  // 보스방 내 ??? 포탈 및 최종 보스방
  worldDefs.finalBossRoom = WORLD_PATCHES_V21.finalBossRoom;
  function drawFinalBossPortalV21(ctx) {
    if (!(game.finalBossPortalUnlocked && game.bossReturnMap === 'swamp')) return; // [피드백] 늪 보스방 한정·일시적
    const p = worldToScreen(910, 500);
    drawPortalSprite(ctx, p.x, p.y, 34, performance.now()/500, '#7f1d1d');
    ctx.save(); ctx.textAlign='center'; ctx.font='900 20px Jua, Noto Sans KR'; ctx.fillStyle='#fee2e2'; ctx.strokeStyle='rgba(0,0,0,.65)'; ctx.lineWidth=4; ctx.strokeText('???', p.x, p.y - 50); ctx.fillText('???', p.x, p.y - 50); ctx.restore();
  }
  const oldDrawBossRoomV21 = drawBossRoom;
  drawBossRoom = function drawBossRoomV21() { oldDrawBossRoomV21(); drawFinalBossPortalV21(game.ctx); };
  function drawFinalBossRoomV21() {
    const ctx = game.ctx;
    ctx.clearRect(0,0,game.width,game.height);
    const g = ctx.createRadialGradient(game.width/2, game.height/2, 30, game.width/2, game.height/2, 520);
    g.addColorStop(0, '#26111d'); g.addColorStop(.55, '#110716'); g.addColorStop(1, '#030206');
    ctx.fillStyle = g; ctx.fillRect(0,0,game.width,game.height);
    ctx.save(); ctx.strokeStyle='rgba(248,113,113,.24)'; ctx.lineWidth=8; ctx.beginPath(); ctx.ellipse(game.width/2, game.height/2+50, 380, 210, 0, 0, Math.PI*2); ctx.stroke(); ctx.restore();
    const exit = worldToScreen(worldDefs.finalBossRoom.exit.x, worldDefs.finalBossRoom.exit.y);
    drawPortalSprite(ctx, exit.x, exit.y, 28, performance.now()/700, '#64748b');
    drawTitleLabel('???');
  }
  window.confirmFinalBossPortalV21 = function confirmFinalBossPortalV21() {
    openModal(`<h2>???</h2><div class="panel-card"><p>정체를 알 수 없는 포탈입니다. 들어가시겠습니까?</p><div class="action-row"><button class="primary" onclick="enterFinalBossRoomV21()">들어가기</button><button class="ghost" onclick="closeModal()">취소</button></div></div>`, { type:'finalBossConfirm', pause:true });
  };
  const oldUpdateForestMonstersV21 = updateForestMonsters;
  updateForestMonsters = function updateForestMonstersV21(dt) {
    if (game.currentMap === 'finalBossRoom') {
      game.forestMonsters.forEach((m) => { if (m.alive && distance(game.player, m) < m.r + 44) openCombat(m); });
      return;
    }
    oldUpdateForestMonstersV21(dt);
  };
  const oldGetNearbyMonsterV21 = getNearbyMonster;
  getNearbyMonster = function getNearbyMonsterV21(range = 42) {
    if (game.currentMap === 'finalBossRoom') {
      return game.forestMonsters.find((m) => m.alive && distance(game.player, m) < range + 60) || null;
    }
    return oldGetNearbyMonsterV21(range);
  };

  // 스킬창 세로형 재디자인
  function skillIconV21(skill) {
    if (skill.kind === 'ultimate') return '✦'; if (skill.kind === 'guard') return '🛡'; if (skill.kind === 'power') return '⚔'; if (skill.kind === 'frost') return '❄'; if (skill.kind === 'fire') return '🔥'; if (skill.kind === 'holy') return '✚'; if (skill.kind === 'shadow') return '☾'; return '◆';
  }
  const btn = $('openSkillTreeBtn');
  if (btn) { btn.replaceWith(btn.cloneNode(true)); $('openSkillTreeBtn').onclick = () => openSkillTreeModal(); }

  // 초기 동기화
  try { updateHud(); syncAudioFileBgm(); } catch {}
  appendChatMessage?.('system', '패치', 'v21: 퀘스트 표식/스토리, E키 대화 진행, 인게임 설정, 스킬창 개선, 최종 보스 포탈, 보스 BGM이 적용되었습니다.');
})();

/* v22: escape consistency / defeat animation restore / door asset / shield and priest polish */
(() => {
  // 사제 전문화 명칭은 표시상 '암흑'으로 통일하되, 기존 내부 효과와 호환되도록 내부값은 '암흑'을 허용합니다.
  const displaySpecV22 = (spec) => spec === '암흑' ? '암흑' : spec;
  if (CLASS_META.priest) CLASS_META.priest.specs = ['신성', '암흑'];
  const oldChooseSpecV22 = window.chooseSpec;
  hudUpdatePipeline.register({
    id:'hud-display-v22',
    priority:220,
    after:() => { if ($('hudSpec')) $('hudSpec').textContent = displaySpecV22($('hudSpec').textContent); },
  });

  drawPlayerNameplate = function drawPlayerNameplateV22(ctx, x, y, player) {
    const className = CLASS_META[player.class]?.name || '모험가';
    const spec = displaySpecV22(player.spec || '');
    const roleLine = `LV.${player.level} ${spec ? spec + ' ' : ''}${className}`;
    const line1 = `${player.name}`;
    const top = y + 58;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '900 18px Jua, Noto Sans KR, system-ui';
    const w = Math.max(ctx.measureText(line1).width, ctx.measureText(roleLine).width) + 34;
    const glow = performance.now() / 1000;
    ctx.shadowColor = 'rgba(0,0,0,.92)';
    ctx.shadowBlur = 8;
    ctx.fillStyle = 'rgba(4,11,22,.82)';
    roundRect(ctx, x - w / 2, top, w, 50, 16); ctx.fill();
    ctx.strokeStyle = `rgba(139,230,255,${0.70 + Math.sin(glow * 2.2) * .10})`;
    ctx.lineWidth = 2;
    roundRect(ctx, x - w / 2, top, w, 50, 16); ctx.stroke();
    ctx.shadowBlur = 5;
    ctx.fillStyle = '#fff7b0';
    ctx.fillText(line1, x, top + 21);
    ctx.font = '900 14px Noto Sans KR, Jua, system-ui';
    ctx.fillStyle = player.spec ? '#7fffd4' : '#d7ecff';
    ctx.fillText(roleLine, x, top + 39);
    ctx.restore();
  };


  // 보호막 계열 스킬은 수치 +10%p. 남은 보호막은 기존처럼 전투 종료 전까지 계속 유지됩니다.
  ['warrior_defense_stance', 'mage_crystal_barrier', 'priest_guardian_prayer'].forEach((id) => {
    if (SKILL_DEFS[id]?.active?.type === 'shield') {
      SKILL_DEFS[id].active.shieldPct = Math.min(1, Number(SKILL_DEFS[id].active.shieldPct || 0) + 0.10);
      SKILL_DEFS[id].desc = SKILL_DEFS[id].desc.replace(/(25|30)%/, (m) => String(Number(m) + 10) + '%');
    }
  });

  // 첨부한 문 여닫는 소리 파일 사용.
  const oldResumeAudioV22 = resumeAudio;
  resumeAudio = function resumeAudioV22() {
    oldResumeAudioV22();
    if (!game.audio.doorFile) {
      game.audio.doorFile = new Audio(window.getAudioAsset?.('door')?.src || '');
      game.audio.doorFile.preload = 'auto';
      game.audio.doorFile.volume = game.settings.sfxEnabled ? Math.min(1, Math.max(0, game.settings.sfxVolume)) : 0;
    }
  };
  audioVolumePipeline.register({
    id:'audio-volume-v22',
    priority:220,
    after:() => {
      if (game.audio?.doorFile) game.audio.doorFile.volume = game.settings.sfxEnabled ? Math.min(1, Math.max(0, game.settings.sfxVolume)) : 0;
    },
  });
  audioAdapters.door = function playDoorFileV22() {
    try {
      resumeAudio();
      if (game.audio.doorFile) {
        game.audio.doorFile.pause();
        game.audio.doorFile.currentTime = 0;
        game.audio.doorFile.volume = game.settings.sfxEnabled ? Math.min(1, Math.max(0, game.settings.sfxVolume)) : 0;
        game.audio.doorFile.play().catch(() => playSynthSfx('open'));
        return;
      }
    } catch {}
    audioAdapters.doorSynth?.();
  };

  // 기본 상점 출구 후보는 레지스트리 fallback에서 제외해 자동 퇴장만 허용한다.

  // 보스방 입장 확인창/??? 확인창에서 E키를 누르면 현재 주 선택지를 클릭합니다.
  YuksamInputRouter.register({ id:'boss-confirm', type:'keydown', priority:85, handle:(e) => {
    const k = e.key?.toLowerCase();
    if (k === 'e' && ['bossConfirm', 'finalBossConfirm'].includes(game.modalState?.type)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const btn = document.querySelector('#modalContent .primary');
      if (btn) btn.click();
      return true;
    }
  }});

  // 사제 책 아이콘/손에 든 책 색상 차별화.
  if (ITEM_DEFS.prayerBook) ITEM_DEFS.prayerBook.visual = 'prayerBookOrange';
  if (ITEM_DEFS.silverBook) ITEM_DEFS.silverBook.visual = 'silverBookBlue';
  if (ITEM_DEFS.dawnTome) {
    ITEM_DEFS.dawnTome.name = '새벽의 성서';
    ITEM_DEFS.dawnTome.visual = 'dawnBookRed';
  }
  const oldItemIconV22 = itemIcon;
  itemIcon = function itemIconV22(item) {
    if (!item) return oldItemIconV22(item);
    if (item.id === 'training_book') return '📗';
    if (item.id === 'holyBook') return '📒';
    if (item.id === 'prayerBook') return '📙';
    if (item.id === 'silverBook') return '📘';
    if (item.id === 'dawnTome') return '📕';
    return oldItemIconV22(item);
  };
  const oldDrawWeaponV22 = drawWeapon;
  drawWeapon = function drawWeaponV22(ctx, klass, scale, swing, isNpc, itemId = null, spec = null) {
    if (klass !== 'priest') return oldDrawWeaponV22(ctx, klass, scale, swing, isNpc, itemId, spec);
    ctx.save();
    const item = itemId ? getItemDefinition(itemId, klass) : null;
    const variant = item?.id || '';
    const palette = {
      training_book: ['#86efac', '#15803d'],
      holyBook: ['#fde68a', '#f59e0b'],
      prayerBook: ['#fdba74', '#ea580c'],
      silverBook: ['#bfdbfe', '#2563eb'],
      dawnTome: ['#fecaca', '#dc2626'],
    }[variant] || ['#f8fafc', '#93c5fd'];
    ctx.translate(20 * scale + swing * 4 * scale, 6 * scale);
    ctx.rotate(-.10 + swing * .2);
    ctx.fillStyle = palette[0];
    roundRect(ctx, -6 * scale, -11 * scale, 16 * scale, 18 * scale, 3 * scale); ctx.fill();
    ctx.strokeStyle = palette[1];
    ctx.lineWidth = 1.8 * scale;
    ctx.strokeRect(-4 * scale, -9 * scale, 12 * scale, 14 * scale);
    ctx.beginPath(); ctx.moveTo(2 * scale, -9 * scale); ctx.lineTo(2 * scale, 5 * scale); ctx.stroke();
    ctx.restore();
  };

  // 몬스터 사망 애니메이션 복구: v18 방식의 흑백/쓰러짐 처리와 HP 0 연출을 마지막 draw override에 다시 반영.
  drawCombatCanvases = function drawCombatCanvasesV22() {
    const pc = $('combatPlayerCanvas');
    const mc = $('combatMonsterCanvas');
    if (pc) {
      const c = pc.getContext('2d'); c.clearRect(0,0,pc.width,pc.height);
      drawPlayerSprite(c, pc.width/2, 140, game.player.appearance, game.player.class, { attack: game.attackTimer, moving: false, equipment: game.player.equipment, weaponTierStyle: getEquippedWeaponTierStyle(game.player) }, 1.9, game.player.spec);
    }
    if (mc) {
      const c = mc.getContext('2d'); c.clearRect(0,0,mc.width,mc.height);
      const fake = currentCombatMonster();
      if (!fake) return;
      const baseScale = fake?.type === 'teacherBoss' ? 1.8 : (fake.elite && fake.type === 'snake' ? 1.35 : (fake.elite ? 1.7 : 2.2));
      if (fake.dying) {
        const p = Math.min(1, Math.max(0, (Date.now() - (fake.deathStartedAt || Date.now())) / 1500));
        c.save();
        c.filter = 'grayscale(1) contrast(.82)';
        c.globalAlpha = Math.max(.14, 1 - p * .78);
        c.translate(mc.width/2, 124 + p * 42);
        c.rotate(-0.18 * p);
        c.scale(1 - p * .18, 1 - p * .26);
        if (fake.type === 'teacherBoss') drawNpcSprite(c, 0, 0, '명진쌤', false, baseScale, false, 'priest');
        else drawMonsterSprite(c, 0, 0, fake, baseScale);
        c.restore();
        c.save();
        c.globalAlpha = Math.max(0, .52 - p * .52);
        c.fillStyle = 'rgba(148,163,184,.55)';
        c.beginPath(); c.ellipse(mc.width/2, 166 + p * 20, 52 + p * 20, 11, 0, 0, Math.PI * 2); c.fill();
        c.restore();
        if (p < 1 && game.modalState?.type === 'combat') setTimeout(drawCombatCanvases, 70);
        return;
      }
      if (fake.type === 'teacherBoss') drawNpcSprite(c, mc.width/2, 118, '명진쌤', false, baseScale, false, 'priest');
      else drawMonsterSprite(c, mc.width/2, 124, fake, baseScale);
    }
  };

  // 도망 처리: ESC와 버튼이 같은 로직/애니메이션을 사용. 실패하면 그 전투에서 재도망 불가.
  combatEntryPipeline.register({
    id:'combat-entry-v22',
    priority:220,
    handle:(context, next) => {
      game.escapeFailedThisCombat = false;
      game.escapeResolving = false;
      return next();
    },
  });

  renderCombatMenu = function renderCombatMenuV22(message = '무엇을 할까?') {
    const monster = currentCombatMonster();
    const noEscape = monster?.noEscape;
    const escapeLocked = !!game.escapeFailedThisCombat;
    renderCombatFrame(message, `
      <div class="combat-menu">
        <button class="primary" data-tooltip="기본 공격&#10;문제를 맞히면 현재 공격력만큼 피해를 줍니다." onclick="chooseCombatAction('attack')">공격</button>
        <button class="primary" data-tooltip="스킬&#10;배운 액티브 스킬 목록을 엽니다." onclick="chooseCombatAction('skill')">스킬</button>
        <button class="ghost" data-tooltip="도망&#10;성공 확률은 상대 레벨에 따라 다릅니다. 실패하면 반격을 받고, 이 전투에서 다시 도망칠 수 없습니다." ${(noEscape || escapeLocked) ? 'disabled' : ''} onclick="escapeCombat()">${noEscape ? '도망 불가' : (escapeLocked ? '도망 실패' : '도망')}</button>
      </div>
      <p class="muted">공격이나 스킬을 누르면 문제가 출제됩니다. 정답이면 행동 성공, 이후 몬스터가 반격합니다.${escapeLocked ? ' 이 전투에서는 더 이상 도망칠 수 없습니다.' : ''}</p>
    `);
  };

  function finishEscapeSuccessV22(monster) {
    const vx = game.player.x - monster.x;
    const vy = game.player.y - monster.y;
    const len = Math.hypot(vx, vy) || 1;
    const world = worldDefs[game.currentMap] || worldDefs.forest;
    game.player.x = clamp(game.player.x + (vx / len) * 140, 40, world.width - 40);
    game.player.y = clamp(game.player.y + (vy / len) * 140, 40, world.height - 40);
    monster.ignorePlayerUntil = Date.now() + 1800;
    monster.chasing = true;
    game.currentCombatMonsterId = null;
    game.currentQuestion = null;
    game.currentCombatAction = null;
    game.combatShield = 0;
    game.combatHpDisplay = null;
    game.escapeResolving = false;
    closeModal();
    savePlayer();
    showCinematicMessage('도망치는데 성공했다!', `${monster.name}에게서 거리를 벌렸습니다.`, 1500);
    appendChatMessage('system', '도망', `${monster.name}에게서 도망쳤습니다.`);
  }

  window.escapeCombat = function escapeCombatV22() {
    const monster = currentCombatMonster();
    if (!monster) { closeModal(); return; }
    if (game.escapeResolving) return;
    if (monster.noEscape) { renderCombatMenu('보스 전투에서는 도망칠 수 없습니다!'); return; }
    if (game.escapeFailedThisCombat) { renderCombatMenu('이미 도망에 실패했습니다. 이 전투에서는 더 이상 도망칠 수 없습니다!'); return; }

    const successRate = (monster.level || 1) <= (game.player.level || 1) ? 0.80 : 0.50;
    const success = Math.random() < successRate;
    game.escapeResolving = true;

    if (!success) {
      game.escapeFailedThisCombat = true;
      renderCombatFrame('도망 실패!', `<div class="flee-note-v21">${escapeHtml(game.player.name)}이(가) 빠져나가려 했지만 ${escapeHtml(monster.name)}이(가) 길을 막았습니다. 이 전투에서는 더 이상 도망칠 수 없습니다.</div>`);
      playSfx('hit');
      setTimeout(() => { game.escapeResolving = false; monsterCounterAttack('도망 실패! '); }, 1050);
      return;
    }

    renderCombatFrame('도망을 시도합니다!', `<div class="flee-note-v21">${escapeHtml(game.player.name)}이(가) 몸을 돌려 조금씩 물러납니다…!</div>`);
    playSfx('step');
    // [재설계] 도망 모션: CSS 애니메이션은 요소 교체·인트로 애니메이션(playerReadyIn)과
    // 충돌해 실행마다 다르게 보였다 — JS가 전역 시계 기준으로 매 틱 위치를 직접 계산해
    // 요소가 교체되어도 처음부터 다시 시작하지 않는 "결정적 2단계 후퇴" 모션을 적용한다.
    const fleeStart = Date.now();
    const FLEE_MS = 1120;
    const fleeIv = setInterval(() => {
      const p = Math.min(1, (Date.now() - fleeStart) / FLEE_MS);
      const el = document.querySelector('.combat-player');
      if (el) {
        // 0~35%: 1차 후퇴(-46px) → 35~55%: 멈칫 → 55~100%: 이탈(-240px) + 페이드
        let dist;
        let alpha = 1;
        if (p < 0.35) { dist = -46 * (p / 0.35); }
        else if (p < 0.55) { dist = -46 - 6 * ((p - 0.35) / 0.2); }
        else { const q = (p - 0.55) / 0.45; dist = -52 - 188 * q; alpha = 1 - q; }
        el.style.animation = 'none'; // 기존 CSS 애니메이션과의 충돌 차단
        el.style.transform = `translateX(${dist}px)`;
        el.style.opacity = String(Math.max(0, alpha));
      }
      if (p >= 1) clearInterval(fleeIv);
    }, 40);
    setTimeout(() => finishEscapeSuccessV22(monster), FLEE_MS);
  };

  // ESC는 버튼 도망과 완전히 동일한 로직을 사용하고, 기존 리스너가 중복 실행하지 않도록 캡처 단계에서 차단.
  YuksamInputRouter.register({ id:'combat-escape', type:'keydown', priority:80, handle:(e) => {
    if (e.key === 'Escape' && game.modalState?.type === 'combat') {
      e.preventDefault();
      e.stopImmediatePropagation();
      window.escapeCombat();
      return true;
    }
  }});

  try { updateHud(); } catch {}
  appendChatMessage?.('system', '패치', 'v22: 도망/ESC 일치, 사망 애니메이션 복구, 보호막/사제 장비/문 효과음이 적용되었습니다.');
})();

/* =========================
   v23 patch: building exits / in-game settings / critical feedback / specialization identity
   ========================= */
(function yuksamV23Patch(){
  if (window.__YUKSAM_V23_PATCH__) return;
  window.__YUKSAM_V23_PATCH__ = true;

  // 0) 전문화 명칭 정리: 암흑 사제 -> 암흑 사제
  if (CLASS_META?.priest) CLASS_META.priest.specs = ['신성', '암흑'];
  function normalizeSpecV23(spec) { return spec === '암흑' ? '암흑' : spec; }
  function migratePlayerSpecV23() {
    if (game.player && game.player.spec === '암흑') {
      game.player.spec = '암흑';
      savePlayer?.();
    }
  }

  // 1) 인게임 HUD에 환경설정 버튼을 확실하게 추가
  function ensureHudSettingsButtonV23() {
    let btn = $('hudSettingsBtnV23');
    if (!btn) {
      const holder = document.querySelector('.hud-buttons') || document.querySelector('.hud');
      if (!holder) return;
      btn = document.createElement('button');
      btn.id = 'hudSettingsBtnV23';
      btn.className = 'small ingame-settings-hud-v23';
      btn.title = '환경설정';
      btn.setAttribute('aria-label', '환경설정');
      btn.textContent = '⚙ 환경설정';
      const logout = $('logoutBtn');
      if (logout && logout.parentNode === holder) holder.insertBefore(btn, logout);
      else holder.appendChild(btn);
    }
    btn.onclick = () => { resumeAudio?.(); openSettingsModal?.(); };
  }
  ensureHudSettingsButtonV23();
  const oldShowScreenV23 = showScreen;
  showScreen = function showScreenV23(name) {
    oldShowScreenV23(name);
    ensureHudSettingsButtonV23();
    const btn = $('hudSettingsBtnV23');
    if (btn) btn.classList.toggle('hidden', name !== 'game');
  };

  // 2) 건물에서 나갈 때 63마을 중앙이 아니라 해당 건물 앞에 나오도록 수정
  function exitBuildingToTownV23(kind) {
    if (!game.player) return;
    playSfx?.('door');
    closeModal?.();
    game.transitionLock = Date.now() + 850;
    game.currentMap = 'town';
    game.player.map = 'town';
    const town = worldDefs.town;
    const door = kind === 'building' ? town.buildingShop : town.shop;
    game.player.x = door.doorX;
    game.player.y = door.doorY + 115;
    game.lastMove = { x: 0, y: 1 };
    $('returnTownBtn')?.classList.add('hidden');
    updateHud?.();
    savePlayer?.();
    appendChatMessage?.('system', '이동', `${door.name} 밖으로 나왔습니다.`);
  }
  window.exitBuildingToTownV23 = exitBuildingToTownV23;
  worldNavigationRegistry.registerTransition({ id:'shop-exits-v23', priority:230, handle:() => {
    if (game.currentMap === 'equipmentShop' && distance(game.player, worldDefs.equipmentShop.exit) < 42) { exitBuildingToTownV23('equipment'); return true; }
    if (game.currentMap === 'buildingShopInterior' && distance(game.player, worldDefs.buildingShopInterior.exit) < 42) { exitBuildingToTownV23('building'); return true; }
    return false;
  }});

  // 3) 전투 메시지의 데미지/HP 감소/회복 숫자를 빨간 굵은 숫자로 강조
  function highlightCombatDamageV23(text) {
    let safe = escapeHtml(String(text || ''));
    safe = safe.replace(/(HP\s*-)(\d+)/g, '$1<span class="damage-number-v23">$2</span>');
    safe = safe.replace(/(\d+)(\s*피해)/g, '<span class="damage-number-v23">$1</span>$2');
    safe = safe.replace(/(\d+)(\s*회복)/g, '<span class="damage-number-v23">$1</span>$2');
    safe = safe.replace(/(보호막\s*)(\d+)/g, '$1<span class="damage-number-v23">$2</span>');
    return safe;
  }
  combatFramePipeline.register({
    id:'combat-frame-v23',
    priority:230,
    after:({ message }) => {
      const h3 = $('modalContent')?.querySelector('.combat-layout .panel-card h3, .panel-card h3');
      if (h3) h3.innerHTML = highlightCombatDamageV23(message);
    },
  });

  // 4) 치명타 이펙트 강화: 화면 색상 플래시 + 기존 흔들림 유지
  function triggerCriticalFlashV23(source = 'player') {
    const prev = document.querySelector('.critical-flash-v23');
    if (prev) prev.remove();
    const flash = document.createElement('div');
    flash.className = 'critical-flash-v23 ' + (source === 'enemy' ? 'enemy' : 'player');
    document.body.appendChild(flash);
    const canvas = $('gameCanvas') || document.body;
    canvas.classList.remove('screen-shake');
    void canvas.offsetWidth;
    canvas.classList.add('screen-shake');
    setTimeout(() => canvas.classList.remove('screen-shake'), 1100);
    setTimeout(() => flash.remove(), 900);
  }
  audioAdapters.criticalVisuals.push(triggerCriticalFlashV23);

  // 5) 전문화별 컨셉을 전투에 더 강하게 반영
  totalStatsPipeline.register({
    id:'stats-specialization-v23',
    priority:230,
    apply:(total) => {
      const klass = game.player?.class;
      const spec = normalizeSpecV23(game.player?.spec);
      if (klass === 'warrior' && spec === '방어') {
        total.체력 = (total.체력 || 0) + 6;
      } else if (klass === 'warrior' && spec === '무기') {
        total.힘 = (total.힘 || 0) + 3;
        total.체력 = (total.체력 || 0) + 3;
      } else if (klass === 'mage' && spec === '냉기') {
        total.지능 = (total.지능 || 0) + 2;
        total.체력 = (total.체력 || 0) + 2;
      } else if (klass === 'mage' && spec === '화염') {
        total.지능 = (total.지능 || 0) + 4;
      } else if (klass === 'priest' && spec === '신성') {
        total.정신 = (total.정신 || 0) + 3;
        total.체력 = (total.체력 || 0) + 2;
      } else if (klass === 'priest' && spec === '암흑') {
        total.정신 = (total.정신 || 0) + 4;
      }
    },
  });

  // 스킬 자체도 전문화 방향이 보이도록 간단히 개편
  Object.entries(V23_SKILL_OVERRIDES).forEach(([id, patch]) => {
    SKILL_DEFS[id] = { ...SKILL_DEFS[id], ...patch };
  });

  function getSpecDamageMultiplierV23() {
    const klass = game.player?.class;
    const spec = normalizeSpecV23(game.player?.spec);
    if (klass === 'warrior' && spec === '방어') return 0.82;
    if (klass === 'warrior' && spec === '무기') return 1.28;
    if (klass === 'mage' && spec === '냉기') return 1.00;
    if (klass === 'mage' && spec === '화염') return 1.10;
    if (klass === 'priest' && spec === '신성') return 0.98;
    if (klass === 'priest' && spec === '암흑') return 1.10;
    return 1;
  }
  function getPlayerCritChanceV23() {
    return game.player?.class === 'mage' && normalizeSpecV23(game.player?.spec) === '화염' ? 0.35 : 0.15;
  }
  function getPlayerCritMultiplierV23() {
    return game.player?.class === 'mage' && normalizeSpecV23(game.player?.spec) === '화염' ? 3.0 : 2.0;
  }
  function getIncomingMultiplierV23(monster) {
    const klass = game.player?.class;
    const spec = normalizeSpecV23(game.player?.spec);
    let mult = 1;
    if (klass === 'warrior' && spec === '방어') mult *= 0.72;
    if (klass === 'priest' && spec === '신성') mult *= 0.90;
    if (monster?.chillTurns > 0) mult *= 0.50;
    return mult;
  }
  function rollMonsterCriticalV23() {
    const spec = normalizeSpecV23(game.player?.spec);
    const chance = spec === '방어' ? 0.10 : 0.15;
    return Math.random() < chance;
  }
  function rollPlayerCriticalV23() { return Math.random() < getPlayerCritChanceV23(); }

  function applySpecOnSuccessfulHitV23(monster, damage, skill) {
    const klass = game.player?.class;
    const spec = normalizeSpecV23(game.player?.spec);
    let msg = '';
    if (!monster || damage <= 0) return msg;
    if (klass === 'mage' && spec === '냉기') {
      const force = !!skill?.active?.forceChill;
      if (force || Math.random() < 0.20) {
        monster.chillTurns = Math.max(monster.chillTurns || 0, 2);
        msg += ' 냉기 상태! 적의 다음 공격 데미지가 50% 감소합니다.';
      }
    }
    if (klass === 'priest' && spec === '암흑') {
      monster.shadowStacks = Math.min(20, (monster.shadowStacks || 0) + 1);
      msg += ` 암흑 중첩 ${monster.shadowStacks}회.`;
    }
    return msg;
  }

  function applyShadowDotBeforeCounterV23(monster) {
    if (!monster || monster.hp <= 0 || !(monster.shadowStacks > 0)) return '';
    const dot = Math.max(1, Math.ceil((monster.shadowStacks || 0) * Math.max(1, getPlayerAttackPower() * 0.22)));
    monster.hp = Math.max(0, monster.hp - dot);
    game.combatImpact = { target: 'monster', until: Date.now() + 820 };
    return ` 암흑 중첩이 폭발해 ${dot} 피해!`;
  }

  function calculateActionDamageV23() {
    let baseDamage = getPlayerAttackPower();
    let skill = null;
    let skillId = null;
    let actionMsg = `정답! ${baseDamage} 피해를 주었습니다. `;
    let noCounter = false;

    if (String(game.currentCombatAction || '').startsWith('active:')) {
      skillId = String(game.currentCombatAction).slice(7);
      skill = SKILL_DEFS[skillId];
      if (skill?.active?.type === 'damage' || skill?.active?.type === 'damageHeal' || skill?.active?.type === 'shadowDot') {
        baseDamage = Math.max(1, Math.ceil(getPlayerAttackPower() * (skill.active.multiplier || 1)));
        actionMsg = `정답! ${skill.active.name}으로 ${baseDamage} 피해를 주었습니다. `;
      } else if (skill?.active?.type === 'shield') {
        const shieldGain = Math.max(1, Math.ceil(game.player.maxHp * (skill.active.shieldPct || .40)));
        game.combatShield += shieldGain;
        actionMsg = `정답! ${skill.active.name}로 보호막 ${shieldGain}을 얻었습니다. `;
        baseDamage = 0;
      } else if (skill?.active?.type === 'healBuff') {
        const heal = Math.max(1, Math.ceil((game.player.maxHp - game.player.hp) * (skill.active.healLostPct || .20)));
        game.player.hp = Math.min(game.player.maxHp, game.player.hp + heal);
        game.combatStatuses.battleRoar = 2;
        actionMsg = `정답! ${skill.active.name}로 HP ${heal} 회복, 전투 의지가 타오릅니다. `;
        baseDamage = 0;
      }
      if (skill?.active?.type === 'damageHeal') {
        const heal = Math.max(1, Math.ceil(baseDamage * (skill.active.healRate || .50)));
        game.player.hp = Math.min(game.player.maxHp, game.player.hp + heal);
        actionMsg += `HP ${heal} 회복. `;
      }
      if (skill?.active?.type === 'shadowDot') {
        // 실제 중첩은 피해 성공 후 monster에 적용
        actionMsg += '암흑의 씨앗을 심었습니다. ';
      }
      setSkillCooldown(skillId, skill?.active?.cooldown || 3);
    }

    let damage = baseDamage > 0 ? Math.max(1, Math.ceil(baseDamage * getSpecDamageMultiplierV23())) : 0;
    let critical = false;
    if (damage > 0 && rollPlayerCriticalV23()) {
      critical = true;
      damage = Math.max(1, Math.ceil(damage * getPlayerCritMultiplierV23()));
      actionMsg = `치명타! ` + actionMsg.replace(/\d+ 피해/, `${damage} 피해`);
      triggerCriticalFlashV23('player');
    }
    return { damage, actionMsg, critical, skill, skillId, noCounter };
  }

  function finishMonsterDefeatV23(monster, defeatedMonster, expGain) {
    game.currentCombatMonsterId = null;
    game.currentQuestion = null;
    game.currentCombatAction = null;
    game.combatHpDisplay = null;
    closeModal();
    game.modalState = { type: 'cinematic', pause: true };
    if (expGain > 0) addExp(expGain);
    addGold(defeatedMonster.gold || 0);
    incrementQuestProgressByMonster(defeatedMonster);
    const expText = expGain > 0 ? `EXP +${expGain}` : '레벨 차이로 EXP 없음';
    showCinematicMessage('몬스터를 처치했습니다!', `${defeatedMonster.name} · ${expText} · Gold +${defeatedMonster.gold || 0}`, 2240);
    appendChatMessage('system', '전투', `${defeatedMonster.name} 처치! ${expText}, Gold +${defeatedMonster.gold || 0}`);
    savePlayer();
  }

  function startMonsterDefeatSequenceV23(monster, actionMsg = '') {
    monster.hp = 0;
    monster.dying = true;
    monster.deathStartedAt = Date.now();
    monster.chasing = false;
    game.currentQuestion = null;
    game.currentCombatAction = null;
    game.transitionLock = Date.now() + 4600;
    renderCombatFrame(actionMsg + `${monster.name}의 HP가 0이 되었습니다!`, `<p class="muted">${escapeHtml(monster.name)}이(가) 힘을 잃고 쓰러집니다...</p>`);
    playSfx('hit');
    const defeatedMonster = { ...monster, hp: 0 };
    const expGain = getMonsterExpGain(defeatedMonster);
    setTimeout(() => {
      monster.alive = false;
      monster.respawnAt = Date.now() + 30000;
      playSfx('victory');
      renderCombatFrame(`${defeatedMonster.name}을(를) 처치했습니다!`, `<p class="muted">전투가 종료됩니다...</p>`);
    }, 1320);
    setTimeout(() => finishMonsterDefeatV23(monster, defeatedMonster, expGain), 2640);
  }

  // 몬스터 반격: 냉기 50% 감소, 방어/신성 피해감소, 암흑 DOT, 치명타 강화

  // 플레이어 공격: 계산 완료 후 전문화별 치명타/부가효과 적용, 사망 연출 유지


  // 스킬창 설명에 전문화 컨셉을 더 명확히 보여준다.
  const skillBtn = $('openSkillTreeBtn');
  if (skillBtn) skillBtn.onclick = () => openSkillTreeModal();

  hudUpdatePipeline.register({
    id:'hud-settings-v23',
    priority:230,
    before:() => migratePlayerSpecV23(),
    after:() => ensureHudSettingsButtonV23(),
  });

  // 선택창도 암흑 표기로 열리도록 보정
  const oldOpenSpecModalV23 = openSpecModal;
  openSpecModal = function openSpecModalV23() {
    if (game.player?.class === 'priest') CLASS_META.priest.specs = ['신성', '암흑'];
    oldOpenSpecModalV23();
  };

  appendChatMessage?.('system', '패치', 'v23: 환경설정 버튼, 건물 퇴장 위치, 데미지 숫자 강조, 치명타 플래시, 전문화별 전투 컨셉 개편이 적용되었습니다.');
})();

/* =========================
   v24 patch: defeat movement fix / specialization-gated 9-point skill trees / stronger critical feedback
   ========================= */
(function yuksamV24Patch(){
  if (window.__YUKSAM_V24_PATCH__) return;
  window.__YUKSAM_V24_PATCH__ = true;

  function classNameOf(klass) { return CLASS_META?.[klass]?.name || klass || '직업'; }
  function normalizeSpecV24(spec) { return spec === '분노' ? '무기' : (spec || null); }
  function currentSpecV24() { return normalizeSpecV24(game.player?.spec); }

  // 치명타 연출 보강: 기존 플래시/흔들림 위에 2배 길이의 추가 플래시를 겹쳐 놓는다.
  function strongCriticalFeedbackV24(source = 'player') {
    const canvas = $('gameCanvas');
    if (canvas) {
      canvas.classList.remove('screen-shake-v24');
      void canvas.offsetWidth;
      canvas.classList.add('screen-shake-v24');
      clearTimeout(canvas._shakeV24Timer);
      canvas._shakeV24Timer = setTimeout(() => canvas.classList.remove('screen-shake-v24'), 1900);
    }
    const old = document.querySelector('.critical-flash-v24');
    if (old) old.remove();
    const flash = document.createElement('div');
    flash.className = 'critical-flash-v24 ' + (source === 'enemy' ? 'enemy' : 'player');
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 1850);
  }
  audioAdapters.criticalVisuals.push(strongCriticalFeedbackV24);

  // 사망 후 마을 복귀 시 이전 defeat/loading 상태가 남아 움직이지 않는 문제를 강제로 정리한다.
  handlePlayerDefeat = function handlePlayerDefeatV24() {
    if (!game.player) return;
    playSfx('defeat');
    closeModal();
    game.modalState = { type: 'defeat', pause: true };
    game.currentCombatMonsterId = null;
    game.currentQuestion = null;
    game.currentCombatAction = null;
    game.combatShield = 0;
    game.combatHpDisplay = null;
    game.combatStatuses = {};
    game.keys = {};
    game.isMoving = false;

    const oldGold = Number(game.player.gold || 0);
    const lostGold = Math.floor(oldGold / 2);
    game.player.gold = oldGold - lostGold;
    const deathMinExpV50 = minExpForLevel(game.player.level);
    const expProtectedV2 = !game.player.spec;
    game.player.exp = YuksamGameplayPolishV2.deathExperience({
      currentExp:game.player.exp,
      levelStartExp:deathMinExpV50,
      hasSpecialization:Boolean(game.player.spec),
    });
    game.player.level = computeLevelFromExp(game.player.exp);
    ensurePlayerHp();

    const overlay = document.createElement('div');
    overlay.className = 'death-overlay';
    const expMessageV2 = expProtectedV2 ? '전문화 전 EXP 보호' : '현재 레벨 EXP 진행도 절반 보호';
    overlay.innerHTML = `<div class="death-message">으윽.. 쓰러졌다..!</div><div class="death-sub">Gold -${lostGold} · ${expMessageV2}</div>`;
    document.body.classList.add('defeated');
    document.body.appendChild(overlay);

    setTimeout(() => {
      overlay.classList.add('leaving');
      setTimeout(() => {
        overlay.remove();
        document.body.classList.remove('defeated');
        // showLoadingTransition이 이전 pause 상태를 복구하지 않도록, 호출 직전에 해제 상태를 기준으로 잡는다.
        game.modalState = { type: null, pause: false };
        showLoadingTransition('63마을로 이동중입니다.', () => {
          closeModal();
          game.currentMap = 'town';
          game.player.map = 'town';
          game.player.x = worldDefs.town.playerSpawn.x;
          game.player.y = worldDefs.town.playerSpawn.y;
          game.player.hp = game.player.maxHp;
          game.forestMonsters = [];
          if ($('returnTownBtn')) $('returnTownBtn').classList.add('hidden');
          game.keys = {};
          game.isMoving = false;
          game.transitionLock = 0;
          updateHud();
          savePlayer();
          showScreen('game');
          appendChatMessage('system', '부활', '63마을에서 체력을 회복한 상태로 눈을 떴습니다.');
        });
        setTimeout(() => {
          game.modalState = { type: null, pause: false };
          game.transitionLock = 0;
          game.keys = {};
        }, 3100);
      }, 350);
    }, 5000);
  };

  Object.values(SKILL_DEFS).forEach((s) => { if (s) s.maxPoints = 1; });
  Object.assign(SKILL_DEFS, V24_SKILLS);
  const V24_IDS = new Set(Object.keys(V24_SKILLS));
  // 선행조건 폐지 → 레벨 게이트: line 1~4=Lv1, 5~6=Lv5, 7~8=Lv7, 최종=Lv10
  Object.keys(V24_SKILLS).forEach((id) => {
    const s = SKILL_DEFS[id];
    if (!s) return;
    const line = Number(s.line) || 1;
    s.unlockLevel = line <= 4 ? 1 : line <= 6 ? 5 : line <= 8 ? 7 : 10;
  });

  function syncV24SkillPoints() {
    if (!game.player) return;
    game.player.skills = game.player.skills || {};
    Object.keys(game.player.skills).forEach((id) => { if (!V24_IDS.has(id)) delete game.player.skills[id]; });
    Object.keys(game.player.skills).forEach((id) => { const mp = SKILL_DEFS[id]?.maxPoints || 1; game.player.skills[id] = Math.min(mp, Math.max(0, Math.floor(Number(game.player.skills[id]) || 0))); });
    const spent = Object.keys(game.player.skills).reduce((sum, id) => sum + (V24_IDS.has(id) ? getSkillRank(id) : 0), 0);
    const totalByLevel = Math.max(0, ((game.player.level || 1) - 1) * 2); // [재구조] 레벨업당 2포인트
    game.player.skillPoints = Math.max(0, totalByLevel - spent);
  }

  function skillUnlockLevelV24(skill) {
    if (!skill) return 1;
    if (Number.isFinite(Number(skill.unlockLevel))) return Number(skill.unlockLevel);
    const line = Number(skill.line) || 1;
    return line <= 4 ? 1 : line <= 6 ? 5 : line <= 8 ? 7 : 10;
  }
  function skillBlockReasonV24(skill) {
    if (!game.player || !skill) return '스킬 정보를 확인할 수 없습니다.';
    if (!getQuestState('tut_skill')) return '아직 명진쌤의 가르침을 받지 못했습니다!';
    if (skill.classOnly && skill.classOnly !== game.player.class) return '이 직업의 능력이 아닙니다.';
    if (getSkillRank(skill.id) >= (skill.maxPoints || 1)) return '이미 최대 랭크입니다.';
    const needLv = skillUnlockLevelV24(skill);
    if ((game.player.level || 1) < needLv) return `Lv.${needLv}에 해금됩니다.`;
    if (skill.specOnly && currentSpecV24() !== skill.specOnly) {
      return game.player.spec ? '이 능력은 배울 수 없습니다.(전문화 확인)' : 'Lv.5에서 전문화를 선택해야 배울 수 있습니다.';
    }
    if ((skill.prereq || []).some((id) => !isSkillLearned(id))) return '아래 레벨 줄의 스킬을 먼저 배워야 합니다.';
    if ((skill.prereqAny || []).length && !skill.prereqAny.some(isSkillLearned)) return '아래 레벨 줄의 스킬 중 하나를 먼저 배워야 합니다.';
    if ((game.player.skillPoints || 0) < (skill.cost || 1)) return '스킬 포인트가 부족합니다.';
    return '';
  }

  canLearnSkill = function canLearnSkillV24(skill) {
    if (!skill?.v24) return false;
    return !skillBlockReasonV24(skill);
  };

  getLearnedActiveSkills = function getLearnedActiveSkillsV24() {
    if (!game.player?.skills) return [];
    return Object.keys(game.player.skills)
      .filter((id) => V24_IDS.has(id))
      .map((id) => SKILL_DEFS[id])
      .filter((skill) => skill?.active && (!skill.specOnly || skill.specOnly === currentSpecV24()));
  };

  window.learnSkill = function learnSkillV24(skillId) {
    syncV24SkillPoints();
    const skill = SKILL_DEFS[skillId];
    const reason = skillBlockReasonV24(skill);
    if (reason) { toast(reason, 1600); appendChatMessage?.('system', '스킬', reason); return; }
    game.player.skills = game.player.skills || {};
    game.player.skills[skillId] = Math.min(skill.maxPoints || 1, getSkillRank(skillId) + 1);
    syncV24SkillPoints();
    ensurePlayerHp();
    savePlayer();
    updateHud();
    window.recordQuestActionV38?.('learnSkill');
    playSfx('quest');
    openSkillTreeModal();
    const rankNow = getSkillRank(skillId), maxP = skill.maxPoints || 1;
    toast(maxP > 1 ? `${skill.name} 습득! (${rankNow}/${maxP})` : `${skill.name} 습득!`);
  };

  function v24ClassSkills(classKey) {
    return Object.values(V24_SKILLS).filter((s) => s.classOnly === classKey).sort((a,b)=>a.line-b.line || String(a.specOnly||'').localeCompare(String(b.specOnly||'')) || a.name.localeCompare(b.name, 'ko'));
  }
  function v24Icon(skill) { return skill.icon || (skill.kind === 'ultimate' ? '✦' : skill.kind === 'guard' ? '🛡' : skill.kind === 'frost' ? '❄' : skill.kind === 'fire' ? '🔥' : skill.kind === 'holy' ? '✚' : skill.kind === 'shadow' ? '☾' : '◆'); }
  function v24SpecLabel(skill) { return skill.specOnly ? skill.specOnly : '공용'; }


  const oldChooseSpecV24 = window.chooseSpec;
  window.chooseSpec = function chooseSpecV24(spec) {
    const before = game.player?.spec;
    oldChooseSpecV24(spec);
    if (game.player && before !== game.player.spec) {
      syncV24SkillPoints();
      savePlayer();
    }
  };

  hudUpdatePipeline.register({
    id:'hud-skill-points-v24',
    priority:240,
    before:() => { if (game.player) syncV24SkillPoints(); },
  });

  // 전투 시작 시 사망/로딩 후 남은 키 상태도 초기화한다.
  combatEntryPipeline.register({
    id:'combat-entry-v24',
    priority:240,
    handle:(context, next) => {
    if (isPaused()) return;
    game.keys = {};
      return next();
    },
  });

  // 초기 실행 중인 캐릭터가 있으면 포인트 동기화
  if (game.player) { syncV24SkillPoints(); savePlayer(); updateHud(); }
  appendChatMessage?.('system', '패치', 'v24: 사망 후 이동 불가 버그 수정, 전문화별 스킬 제한, Lv.10 기준 9포인트 스킬트리가 적용되었습니다.');
})();

/* =========================
   v25 patch: world-map keyboard, critical SFX asset, compact skill UI, combat timing, respawn reset, DOT order
   ========================= */
(function yuksamV25Patch(){
  if (window.__YUKSAM_V25_PATCH__) return;
  window.__YUKSAM_V25_PATCH__ = true;

  const COMBAT_NOTICE_DELAY_V25 = YuksamCombatRules.shortenCombatDelay(YuksamCombatRules.combatNoticeDelay(1920));
  const COMBAT_CUSTOM_NOTICE_DELAY_V43 = YuksamCombatRules.shortenCombatDelay(1000);
  const PLAYER_ATTACK_NOTICE_DELAY_V46 = COMBAT_CUSTOM_NOTICE_DELAY_V43 + 400;
  const CORRECT_ANSWER_NOTICE_DELAY_V48 = 800;
  const CHARGE_NOTICE_DELAY_V48 = 1500;
  const CHARGE_RELEASE_HIT_NOTICE_DELAY_V48 = 1500;
  const DOT_NOTICE_DELAY_V25 = YuksamCombatRules.shortenCombatDelay(YuksamCombatRules.combatNoticeDelay(2000));
  const combatResolutionEventsV42 = new Map();
  const combatFloatingDamageV45 = new Set();
  const combatFloatingDamageTimersV45 = new Set();
  let combatImpactTimerV44 = null;
  function clearCombatImpactV44() {
    if (combatImpactTimerV44) clearTimeout(combatImpactTimerV44);
    combatImpactTimerV44 = null;
    game.combatImpact = null;
    $('modalContent')?.querySelectorAll('.combat-sprite.impact').forEach((actor) => actor.classList.remove('impact'));
  }
  function setCombatImpactV44(target, duration) {
    clearCombatImpactV44();
    const impact = { target, until:Date.now() + Math.max(0, Number(duration) || 0) };
    game.combatImpact = impact;
    $('modalContent')?.querySelector(target === 'player' ? '.combat-player' : '.combat-monster')?.classList.add('impact');
    combatImpactTimerV44 = setTimeout(() => {
      if (game.combatImpact === impact) game.combatImpact = null;
      $('modalContent')?.querySelector(target === 'player' ? '.combat-player' : '.combat-monster')?.classList.remove('impact');
      combatImpactTimerV44 = null;
    }, Math.max(0, Number(duration) || 0));
    return impact;
  }
  function clearCombatFloatingDamageV45() {
    combatFloatingDamageTimersV45.forEach((timer) => clearTimeout(timer));
    combatFloatingDamageTimersV45.clear();
    combatFloatingDamageV45.forEach((number) => number.remove());
    combatFloatingDamageV45.clear();
  }
  function showCombatFloatingNumberV49(target, amount, kind, critical = false) {
    const value = Math.max(0, Math.floor(Number(amount) || 0));
    const stage = $('modalContent')?.querySelector('.combat-stage');
    const actor = stage?.querySelector(target === 'player' ? '.combat-player' : '.combat-monster');
    if (!value || !actor || !['damage', 'heal', 'shield', 'shield-damage'].includes(kind)) return;
    const stageRect = stage.getBoundingClientRect();
    const rect = actor.getBoundingClientRect();
    const number = document.createElement('div');
    number.className = `combat-floating-damage ${target} ${kind}${critical ? ' critical' : ''}`;
    number.textContent = kind === 'damage' || kind === 'shield-damage' ? `-${value}` : `+${value}`;
    number.style.left = `${rect.left - stageRect.left + rect.width * .5}px`;
    number.style.top = `${rect.top - stageRect.top + rect.height * .5}px`;
    stage.appendChild(number);
    combatFloatingDamageV45.add(number);
    const timer = setTimeout(() => {
      combatFloatingDamageTimersV45.delete(timer);
      combatFloatingDamageV45.delete(number);
      number.remove();
    }, 1200);
    combatFloatingDamageTimersV45.add(timer);
  }
  window.clearCombatImpactV44 = clearCombatImpactV44;
  const currentEffectMonsterV43 = (effect) => {
    if (effect.combatId !== game.currentCombatMonsterId) return null;
    const monster = currentCombatMonster();
    return monster && monster.alive && !monster.dying ? monster : null;
  };
  const combatEffectFeedbackV46 = new Map();
  function queueCombatEffectFeedbackV46(effectId, feedback) {
    if (effectId == null || typeof feedback !== 'function') return;
    combatEffectFeedbackV46.set(effectId, feedback);
  }
  function flushCombatEffectFeedbackV46(effectId) {
    if (effectId == null) return;
    const feedback = combatEffectFeedbackV46.get(effectId);
    combatEffectFeedbackV46.delete(effectId);
    feedback?.();
  }
  const combatEffectHandlerV42 = YuksamCombatRules.createCombatEffectHandler({
    'monster-damage': (effect) => {
      const monster = currentEffectMonsterV43(effect);
      if (!monster) return;
      const shieldBefore = Math.max(0, Number(monster.shield) || 0);
      const shieldResult = YuksamCombatRules.resolveShieldedDamage(
        effect.amount,
        effect.ignoreShield === true ? 0 : shieldBefore,
      );
      const hpBefore = monster.hp;
      applyDamageToMonsterV40(monster, effect.amount, { ignoreShield:effect.ignoreShield === true });
      if (effect.consumeCharge) game.chargeActive = false;
      const actualDamage = Math.max(0, hpBefore - monster.hp);
      const { shieldDamage, fullyBlocked } = shieldResult;
      queueCombatEffectFeedbackV46(effect.id, () => {
        setCombatImpactV44('monster', effect.critical ? 1150 : 900);
        if (shieldDamage > 0) showCombatFloatingNumberV49('monster', shieldDamage, 'shield-damage');
        if (actualDamage > 0) showCombatFloatingNumberV49('monster', actualDamage, 'damage', effect.critical);
        if (fullyBlocked) playSfx('shieldBlock');
        if (effect.critical) playSfx('critical');
      });
      if (effect.finalHit && monster.hp > 0) {
        const resolutionEvents = [];
        if (effect.executePct > 0 && monster.hp / monster.maxHp <= effect.executePct) {
          monster.hp = 0;
          resolutionEvents.push({ type:'enemy-status', text:'처형 효과 발동!', audioId:'execution' });
        } else if (effect.executeHp > 0 && monster.hp <= effect.executeHp) {
          // [v51] 즉시 0 처리 대신, 처형 데미지가 별도 순간으로 들어가도록 이벤트에 위임
          const executeRemainV51 = monster.hp;
          resolutionEvents.push({
            type:'enemy-status',
            text:`✨ 원소 폭발! 남은 생명력 ${executeRemainV51}을 불태워 처형했다!`,
            audioId:'execution',
            duration:1700,
            effect:{ id:`${effect.id}:execute`, type:'monster-damage', combatId:effect.combatId, amount:executeRemainV51, ignoreShield:true, critical:true },
            fx:{ source:'player', target:'monster', mode:'impact', motion:'cast', impact:'arcane-burst', tier:2, particleCount:10, travelMs:140, lingerMs:820, shakePx:4, shakeMs:260, hitStage:'primary', skillId:null },
          });
        }
        if (effect.resolutionId && resolutionEvents.length) combatResolutionEventsV42.set(effect.resolutionId, resolutionEvents);
      }
      updateHud?.();
    },
    'monster-status': (effect) => {
      const monster = currentEffectMonsterV43(effect);
      if (!monster) return;
      if (effect.status === 'chill') {
        monster.chillTurns = effect.mode === 'max'
          ? Math.max(monster.chillTurns || 0, effect.turns)
          : effect.turns;
      } else if (effect.status === 'stun') {
        monster.stunTurns = effect.mode === 'max'
          ? Math.max(monster.stunTurns || 0, effect.turns)
          : effect.turns;
      } else if (effect.status === 'shadow' && effect.mode === 'add') {
        const nextStacks = Math.max(0, monster.shadowStacks || 0) + effect.stacks;
        monster.shadowStacks = effect.maxStacks > 0 ? Math.min(effect.maxStacks, nextStacks) : nextStacks;
      }
      updateHud?.();
    },
    'monster-shield': (effect) => {
      const monster = currentEffectMonsterV43(effect);
      if (!monster) return;
      const shieldBefore = Math.max(0, Number(monster.shield) || 0);
      monster.shield = shieldBefore + Math.max(0, Number(effect.amount) || 0);
      const actualShield = Math.max(0, monster.shield - shieldBefore);
      queueCombatEffectFeedbackV46(effect.id, () => {
        if (actualShield > 0) showCombatFloatingNumberV49('monster', actualShield, 'shield');
      });
      updateHud?.();
    },
    'monster-heal': (effect) => {
      const monster = currentEffectMonsterV43(effect);
      if (!monster) return;
      const hpBefore = monster.hp;
      monster.hp = Math.min(monster.maxHp || monster.hp, monster.hp + Math.max(0, Number(effect.amount) || 0));
      const actualHeal = Math.max(0, monster.hp - hpBefore);
      queueCombatEffectFeedbackV46(effect.id, () => {
        if (actualHeal > 0) showCombatFloatingNumberV49('monster', actualHeal, 'heal');
      });
      updateHud?.();
    },
    'player-status': (effect) => {
      if (!currentEffectMonsterV43(effect)) return;
      if (effect.status === 'shield') {
        const shieldBefore = Math.max(0, Number(game.combatShield) || 0);
        game.combatShield = shieldBefore + Math.max(0, Number(effect.damage) || 0);
        const actualShield = Math.max(0, game.combatShield - shieldBefore);
        queueCombatEffectFeedbackV46(effect.id, () => {
          if (actualShield > 0) showCombatFloatingNumberV49('player', actualShield, 'shield');
        });
      } else if (effect.status === 'poison') {
        game.playerAilments ||= {};
        game.playerAilments.poisonTurns = Math.max(game.playerAilments.poisonTurns || 0, effect.turns);
        game.playerAilments.poisonDmg = Math.max(1, effect.damage || 1);
      } else if (effect.status === 'stun') {
        game.playerAilments ||= {};
        game.playerAilments.stunTurns = Math.max(game.playerAilments.stunTurns || 0, effect.turns);
      } else if (effect.status === 'chill') {
        game.playerChillTurns = Math.max(game.playerChillTurns || 0, effect.turns);
      } else if (effect.status === 'cleanse') {
        game.playerAilments = {};
      }
      updateHud?.();
    },
    'player-support': (effect) => {
      if (!currentEffectMonsterV43(effect)) return;
      if (effect.kind === 'shield') {
        const shieldBefore = Math.max(0, Number(game.combatShield) || 0);
        game.combatShield = shieldBefore + Math.max(0, Number(effect.amount) || 0);
        const actualShield = Math.max(0, game.combatShield - shieldBefore);
        queueCombatEffectFeedbackV46(effect.id, () => {
          if (actualShield > 0) showCombatFloatingNumberV49('player', actualShield, 'shield');
        });
      } else if (effect.kind === 'heal') {
        const hpBefore = game.player.hp;
        game.player.hp = Math.min(game.player.maxHp, game.player.hp + Math.max(0, Number(effect.amount) || 0));
        const actualHeal = Math.max(0, game.player.hp - hpBefore);
        queueCombatEffectFeedbackV46(effect.id, () => {
          if (actualHeal > 0) showCombatFloatingNumberV49('player', actualHeal, 'heal');
        });
      } else if (effect.kind === 'int-buff') {
        game.combatBuffs ||= {};
        game.combatBuffs.intBuffTurns = effect.turns;
        game.combatBuffs.intBuffPct = effect.pct;
      } else if (effect.kind === 'battle-roar') {
        game.combatStatuses ||= {};
        game.combatStatuses.battleRoar = effect.turns;
      } else if (effect.kind === 'charge') {
        game.chargeActive = true;
      } else if (effect.kind === 'consume-charge') {
        game.chargeActive = false;
      }
      updateHud?.();
    },
    'player-damage': (effect) => {
      const monster = currentEffectMonsterV43(effect);
      if (!monster || game.player.hp <= 0) return;
      const shieldResult = YuksamCombatRules.resolveShieldedDamage(
        effect.amount,
        effect.pierceDefense ? 0 : game.combatShield,
      );
      const { shieldDamage, hpDamage, remainingShield, fullyBlocked } = shieldResult;
      if (!effect.pierceDefense) game.combatShield = remainingShield;
      const hpBefore = game.player.hp;
      game.player.hp = Math.max(0, game.player.hp - hpDamage);
      const actualDamage = Math.max(0, hpBefore - game.player.hp);
      const monsterHpBefore = monster.hp;
      if (effect.monsterHeal > 0) monster.hp = Math.min(monster.maxHp || monster.hp, monster.hp + effect.monsterHeal);
      const actualMonsterHeal = Math.max(0, monster.hp - monsterHpBefore);
      queueCombatEffectFeedbackV46(effect.id, () => {
        setCombatImpactV44('player', effect.hitIndex > 0 ? 420 : 960);
        if (shieldDamage > 0) showCombatFloatingNumberV49('player', shieldDamage, 'shield-damage');
        showCombatFloatingNumberV49('player', actualDamage, 'damage', effect.critical);
        if (fullyBlocked) playSfx('shieldBlock');
        if (actualMonsterHeal > 0) showCombatFloatingNumberV49('monster', actualMonsterHeal, 'heal');
        if (effect.critical) playSfx('critical'); // [v50] 일반 명중음은 notice의 enemyAttack으로 대체
      });
      savePlayer?.();
      updateHud?.();
    },
    'retaliation': (effect) => {
      const monster = currentEffectMonsterV43(effect);
      if (!monster || game.player.hp <= 0 || monster.hp <= 0) return;
      const monsterHpBefore = monster.hp;
      applyDamageToMonsterV40(monster, effect.amount);
      const actualDamage = Math.max(0, monsterHpBefore - monster.hp);
      const heal = Math.max(0, Number(effect.heal) || 0);
      const playerHpBefore = game.player.hp;
      game.player.hp = Math.min(game.player.maxHp, game.player.hp + heal);
      const actualHeal = Math.max(0, game.player.hp - playerHpBefore);
      queueCombatEffectFeedbackV46(effect.id, () => {
        setCombatImpactV44('monster', 700);
        if (actualDamage > 0) showCombatFloatingNumberV49('monster', actualDamage, 'damage');
        if (actualHeal > 0) showCombatFloatingNumberV49('player', actualHeal, 'heal');
      });
      savePlayer?.();
      updateHud?.();
    },
    'player-dot': (effect) => {
      if (!currentEffectMonsterV43(effect) || game.player.hp <= 0) return;
      const hpBefore = game.player.hp;
      game.player.hp = Math.max(0, game.player.hp - effect.amount);
      const actualDamage = Math.max(0, hpBefore - game.player.hp);
      queueCombatEffectFeedbackV46(effect.id, () => {
        setCombatImpactV44('player', effect.critical ? 1150 : 700);
        showCombatFloatingNumberV49('player', actualDamage, 'damage', effect.critical);
        if (effect.critical && actualDamage > 0) playSfx('critical');
      });
      if (effect.status === 'poison' && effect.consumeTurn && game.playerAilments?.poisonTurns > 0) {
        game.playerAilments.poisonTurns -= 1;
        if (game.playerAilments.poisonTurns <= 0) {
          delete game.playerAilments.poisonTurns;
          delete game.playerAilments.poisonDmg;
        }
      }
      appendChatMessage?.('system', '전투', `중독 피해 ${effect.amount}`);
      savePlayer?.();
      updateHud?.();
    },
    'monster-dot': (effect) => {
      const monster = currentEffectMonsterV43(effect);
      if (!monster) return;
      const hpBefore = monster.hp;
      applyDamageToMonsterV40(monster, effect.amount);
      const actualDamage = Math.max(0, hpBefore - monster.hp);
      let actualLifesteal = 0;
      if (effect.shadowLifesteal && actualDamage > 0 && game.player.hp > 0) {
        const playerHpBefore = game.player.hp;
        const healAmount = applyHealBoostV25(actualDamage);
        game.player.hp = Math.min(game.player.maxHp, game.player.hp + healAmount);
        actualLifesteal = Math.max(0, game.player.hp - playerHpBefore);
      }
      queueCombatEffectFeedbackV46(effect.id, () => {
        setCombatImpactV44('monster', effect.critical ? 1150 : 900);
        showCombatFloatingNumberV49('monster', actualDamage, 'damage', effect.critical);
        if (actualLifesteal > 0) showCombatFloatingNumberV49('player', actualLifesteal, 'heal');
        if (effect.critical) playSfx('critical');
      });
      if (actualLifesteal > 0) appendChatMessage?.('system', '전투', `🩸 암흑 집중 흡혈로 생명력 ${actualLifesteal} 회복!`);
      savePlayer?.();
      updateHud?.();
    },
  });

  const combatSequenceControllerV47 = YuksamCombatSequenceController.create({
    initialGeneration:game.combatSequenceGeneration,
    readCombatId:() => game.currentCombatMonsterId,
    writeState:({ generation, active }) => {
      game.combatSequenceGeneration = generation;
      game.combatSequenceActive = active;
    },
    resetTransient:() => {
      clearCombatImpactV44();
      clearCombatFloatingDamageV45();
      combatEffectFeedbackV46.clear();
      combatResolutionEventsV42.clear();
      YuksamCombatFx.cancelAllCombatFx();
    },
  });

  function invalidateCombatSequenceV42() {
    combatSequenceControllerV47.invalidate();
  }

  function queueCombatSequence(events, onComplete) {
    const queue = YuksamCombatRules.buildCombatSequence(YuksamCombatRules.deduplicateCombatStatusEvents(events));
    const sequenceToken = combatSequenceControllerV47.begin();
    let index = 0;
    const showNext = () => {
      if (!combatSequenceControllerV47.isCurrent(sequenceToken)) return;
      const fresh = currentCombatMonster();
      if (!fresh || !fresh.alive || fresh.dying) { combatSequenceControllerV47.finish(sequenceToken); return; }
      if (index >= queue.length) {
        combatSequenceControllerV47.finish(sequenceToken);
        onComplete?.();
        return;
      }
      const notice = queue[index];
      index += 1;
      const applyNoticeEffect = () => {
        if (!combatSequenceControllerV47.isCurrent(sequenceToken)) return false;
        return combatEffectHandlerV42.apply(notice.effect);
      };
      let noticeEmitted = false;
      let noticeAudioPlayed = false;
      let noticeRendered = false;
      let noticeCompleted = false;
      const emitNotice = () => {
        if (noticeEmitted) return;
        noticeEmitted = true;
        window.onCombatSequenceEventV42?.(notice);
      };
      const renderNotice = () => {
        if (!combatSequenceControllerV47.isCurrent(sequenceToken)) return;
        if (noticeRendered) return true;
        noticeRendered = true;
        applyNoticeEffect();
        renderCombatFrame(notice.text, notice.detail ? `<p class="muted">${escapeHtml(notice.detail)}</p>` : '');
        const heading = $('modalContent')?.querySelector('.combat-layout .panel-card h3, .panel-card h3');
        if (heading) heading.className = `combat-notice ${notice.tone || ''}`.trim();
        if (notice.audioId && !noticeAudioPlayed) {
          noticeAudioPlayed = true;
          const fallback = notice.fallbackSfx ? () => playSfx(notice.fallbackSfx) : null;
          if (!window.playMappedAudio?.(notice.audioId, { onFallback:fallback })) fallback?.();
        }
        if (notice.ultimateId) window.playUltimateFxV41?.(notice.ultimateId);
        flushCombatEffectFeedbackV46(notice.effect?.id);
        return true;
      };
      const completeNotice = () => {
        if (noticeCompleted || !combatSequenceControllerV47.isCurrent(sequenceToken)) return;
        noticeCompleted = true;
        emitNotice();
        if (!combatSequenceControllerV47.isCurrent(sequenceToken)) return;
        let duration = notice.duration == null ? COMBAT_NOTICE_DELAY_V25 : Math.max(0, Number(notice.duration) || 0);
        if (notice.type === 'monster-action') duration = Math.round(duration * 0.6); // [v51] 적 행동 로그 40% 단축
        if (window.__combatLogFastV50 && !notice.preserveDuration) duration = Math.ceil(duration / 2); // 정답 표시는 2초 이상 유지
        if (duration === 0) showNext();
        else combatSequenceControllerV47.schedule(sequenceToken, showNext, duration);
      };
      const showNotice = ({ deferCompletion = false } = {}) => {
        if (!renderNotice()) return false;
        if (!deferCompletion) completeNotice();
        return true;
      };
      if (notice.fx?.source === 'monster' && notice.fx.phase === 'impact') {
        let monsterImpactShown = false;
        Promise.resolve().then(() => {
          if (!combatSequenceControllerV47.isCurrent(sequenceToken)) return false;
          return YuksamCombatFx.playMonsterActionFx(notice.fx, () => {
            monsterImpactShown = showNotice({ deferCompletion:true });
          });
        }).then(() => {
          if (!combatSequenceControllerV47.isCurrent(sequenceToken)) return;
          if (monsterImpactShown) completeNotice();
          else showNotice();
        }, () => {
          if (combatSequenceControllerV47.isCurrent(sequenceToken)) showNotice();
        });
      } else if (notice.fx?.source === 'monster' && notice.fx.motion) {
        emitNotice();
        if (!combatSequenceControllerV47.isCurrent(sequenceToken)) return;
        Promise.resolve().then(() => {
          if (!combatSequenceControllerV47.isCurrent(sequenceToken)) return false;
          return YuksamCombatFx.playMonsterActionFx(notice.fx);
        }).then(showNotice, showNotice);
      } else if (notice.fx?.source === 'player' && notice.fx.motion) {
        let playerImpactShown = false;
        Promise.resolve().then(() => {
          if (!combatSequenceControllerV47.isCurrent(sequenceToken)) return false;
          return YuksamCombatFx.playPlayerActionFx(notice.fx, () => {
            playerImpactShown = true;
            showNotice();
          });
        }).then(() => {
          if (!playerImpactShown) showNotice();
        }, () => showNotice());
      } else {
        showNotice();
      }
    };
    showNext();
  }
  function queueCombatNoticesV42(notices, onComplete) {
    const events = (notices || []).filter(Boolean).map((notice) => {
      if (typeof notice === 'string') return { type:'player-status', text:notice };
      return { type:notice.type || 'player-status', ...notice };
    });
    queueCombatSequence(events, onComplete);
  }
  const oldEscapeCombatV25 = window.escapeCombat;
  window.escapeCombat = function escapeCombatV25() {
    if (combatSequenceControllerV47.isActive()) {
      toast('전투 행동이 끝난 뒤 도망칠 수 있습니다.');
      return false;
    }
    invalidateCombatSequenceV42();
    return oldEscapeCombatV25?.();
  };
  window.queueCombatSequence = queueCombatSequence;
  window.queueCombatNoticesV42 = queueCombatNoticesV42;
  window.invalidateCombatSequenceV42 = invalidateCombatSequenceV42;

  // 1) 테스트 버튼 보강: HP 100% 회복 / 스킬 쿨타임 전체 회복
  function ensureTestButtonsV25() {
    const row = document.querySelector('.hud-buttons');
    if (!row) return;
    if (!$('testHealBtn')) {
      const btn = document.createElement('button');
      btn.id = 'testHealBtn'; btn.className = 'small test heal-test'; btn.textContent = 'HP 100%';
      const anchor = $('testSpeedBtn') || $('logoutBtn');
      row.insertBefore(btn, anchor ? anchor.nextSibling : null);
    }
    if (!$('testCooldownBtn')) {
      const btn = document.createElement('button');
      btn.id = 'testCooldownBtn'; btn.className = 'small test cooldown-test'; btn.textContent = '쿨타임 회복';
      const anchor = $('testHealBtn') || $('testSpeedBtn') || $('logoutBtn');
      row.insertBefore(btn, anchor ? anchor.nextSibling : null);
    }
    const healBtn = $('testHealBtn');
    if (healBtn && !healBtn.dataset.boundV25) {
      healBtn.dataset.boundV25 = '1';
      healBtn.addEventListener('click', async () => {
        if (!(await window.requireTeacherCheatAccessV3?.())) return;
        await window.adminApplyCurrentStudentCheatV3?.('heal');
        game.combatShield = Math.max(0, game.combatShield || 0);
        if (game.modalState?.type === 'combat') renderCombatMenu('테스트: HP를 전부 회복했습니다.');
      });
    }
    const cdBtn = $('testCooldownBtn');
    if (cdBtn && !cdBtn.dataset.boundV25) {
      cdBtn.dataset.boundV25 = '1';
      cdBtn.addEventListener('click', async () => {
        if (!(await window.requireTeacherCheatAccessV3?.())) return;
        if (!game.player) return;
        game.player.skillCooldowns = game.player.skillCooldowns || {};
        Object.keys(game.player.skillCooldowns).forEach((id) => { game.player.skillCooldowns[id] = 0; });
        savePlayer?.(); updateHud?.();
        appendChatMessage?.('system', '테스트', '모든 스킬 쿨타임 회복');
        toast('테스트: 모든 스킬 쿨타임 회복');
        if (game.modalState?.type === 'combat') renderCombatMenu('테스트: 모든 스킬 쿨타임이 회복되었습니다.');
      });
    }
  }
  ensureTestButtonsV25();
  hudUpdatePipeline.register({
    id:'hud-test-buttons-v25',
    priority:250,
    after:() => ensureTestButtonsV25(),
  });

  // 2) 첨부 효과음을 치명타 사운드로 사용
  function ensureCriticalAudioV25() {
    try {
      if (!game.audio.criticalFile) {
        game.audio.criticalFile = new Audio(window.getAudioAsset?.('critical')?.src || '');
        game.audio.criticalFile.preload = 'auto';
      }
      game.audio.criticalFile.volume = game.settings.sfxEnabled ? Math.min(1, Math.max(0, Number(game.settings.sfxVolume ?? 1))) : 0;
    } catch {}
  }
  const oldResumeAudioV25 = resumeAudio;
  resumeAudio = function resumeAudioV25() { oldResumeAudioV25(); ensureCriticalAudioV25(); };
  audioVolumePipeline.register({
    id:'audio-volume-v25',
    priority:250,
    after:() => ensureCriticalAudioV25(),
  });

  // 3) 월드맵: 좌우 방향키로 카드 이동, E키로 현재 선택 사냥터 입장
  function clampWorldSelectedV25() {
    const n = DUNGEONS_V25.length;
    game.worldMapSelectedIndex = ((Number(game.worldMapSelectedIndex) || 0) % n + n) % n;
  }
  function levelGateMessageV25(title, needLv) {
    const msg = `레벨이 부족합니다. ${title}은 Lv.${needLv}부터 입장할 수 있습니다.`;
    toast(msg, 2400); appendChatMessage?.('system', '입장 제한', msg); showCinematicMessage?.('레벨이 부족합니다', msg, 1500);
  }
  function renderWorldMapV25() {
    const lv = game.player?.level || 1;
    clampWorldSelectedV25();
    const cards = DUNGEONS_V25.map((d, i) => {
      const locked = lv < d.level;
      const selected = i === game.worldMapSelectedIndex;
      const badgeCls = locked ? 'danger' : 'gold';
      return `<div class="student-item dungeon-card-v20 ${locked ? 'locked' : ''} ${selected ? 'world-selected-v25' : ''}" data-dungeon-index="${i}">
        <div class="badge ${badgeCls}">Lv.${d.level} ${locked ? '입장 제한' : '입장 가능'}</div>
        <h3>${escapeHtml(d.title)}</h3>
        <p>${escapeHtml(d.desc)}</p>
        ${locked ? `<p class="lock-reason">Lv.${d.level}부터 입장할 수 있습니다.</p><button class="wide" disabled>레벨 부족</button>` : `<button class="primary wide" onclick="${d.enter}">입장하기</button>`}
      </div>`;
    }).join('');
    openModal(`<h2>월드 맵 / 포탈</h2>
      <div class="panel-card worldmap-v20 worldmap-v25">
        <p>입장할 사냥터를 선택하세요. <b>←/→</b>로 사냥터를 고르고 <b>E</b>로 입장할 수 있습니다.</p>
        <div class="student-grid dungeon-grid-v20">${cards}</div>
        <p class="worldmap-help-v25">현재 선택: ${escapeHtml(DUNGEONS_V25[game.worldMapSelectedIndex].title)}</p>
      </div>`, { type:'worldmap', pause:true });
  }
  openWorldMapModal = function openWorldMapModalV25() {
    if (typeof game.worldMapSelectedIndex !== 'number') game.worldMapSelectedIndex = 0;
    renderWorldMapV25();
  };
  window.enterSelectedDungeonV25 = function enterSelectedDungeonV25() {
    clampWorldSelectedV25();
    const d = DUNGEONS_V25[game.worldMapSelectedIndex];
    if (!d) return;
    if ((game.player?.level || 1) < d.level) return levelGateMessageV25(d.title, d.level);
    if (d.key === 'forest') return window.enterForest();
    if (d.key === 'desert') return window.enterDesert();
    if (d.key === 'swamp') return window.enterSwamp();
  };
  YuksamInputRouter.register({ id:'world-map', type:'keydown', priority:90, handle:(e) => {
    if (game.modalState?.type !== 'worldmap') return;
    const k = e.key?.toLowerCase();
    if (k === 'arrowleft' || k === 'a') { e.preventDefault(); e.stopImmediatePropagation(); game.worldMapSelectedIndex = (Number(game.worldMapSelectedIndex) || 0) - 1; renderWorldMapV25(); }
    else if (k === 'arrowright' || k === 'd') { e.preventDefault(); e.stopImmediatePropagation(); game.worldMapSelectedIndex = (Number(game.worldMapSelectedIndex) || 0) + 1; renderWorldMapV25(); }
    else if (k === 'e' || k === 'enter') { e.preventDefault(); e.stopImmediatePropagation(); window.enterSelectedDungeonV25(); }
    return ['arrowleft','a','arrowright','d','e','enter'].includes(k);
  }});

  // 4) 전투 메시지 색상: 내 이름은 초록, 적 이름은 빨강으로 구분하고
  // 피해·회복·보호막 숫자는 기존 색을 유지한다.
  function highlightCombatNumbersV25(safe) {
    return String(safe || '').replace(/HP\s*-\s*\d+|\d+\s*피해|\d+\s*회복|보호막\s*\d+/g, (m) => {
      if (/^HP\s*-/.test(m)) {
        const n = m.match(/\d+/)?.[0] || '';
        return m.replace(n, `<span class="damage-number-v25-player">${n}</span>`);
      }
      if (/피해/.test(m)) {
        const n = m.match(/\d+/)?.[0] || '';
        return m.replace(n, `<span class="damage-number-v25-enemy">${n}</span>`);
      }
      const n = m.match(/\d+/)?.[0] || '';
      return m.replace(n, `<span class="damage-number-v25-generic">${n}</span>`);
    });
  }
  function highlightCombatMessageV25(text) {
    const source = String(text || '');
    const entities = [
      { name:String(game.player?.name || ''), className:'combat-log-name-player', color:'#4ade80' },
      { name:String(currentCombatMonster?.()?.name || ''), className:'combat-log-name-enemy', color:'#fb7185' },
    ].filter((entry) => entry.name).sort((a, b) => b.name.length - a.name.length);
    let html = '';
    let cursor = 0;
    while (cursor < source.length) {
      let match = null;
      entities.forEach((entity) => {
        const index = source.indexOf(entity.name, cursor);
        if (index < 0) return;
        if (!match || index < match.index || (index === match.index && entity.name.length > match.entity.name.length)) {
          match = { index, entity };
        }
      });
      if (!match) {
        html += highlightCombatNumbersV25(escapeHtml(source.slice(cursor)));
        break;
      }
      html += highlightCombatNumbersV25(escapeHtml(source.slice(cursor, match.index)));
      html += `<span class="${match.entity.className}" style="color:${match.entity.color};font-weight:900">${escapeHtml(match.entity.name)}</span>`;
      cursor = match.index + match.entity.name.length;
    }
    return html;
  }
  combatFramePipeline.register({
    id:'combat-frame-v25',
    priority:250,
    after:({ message }) => {
      const h3 = $('modalContent')?.querySelector('.combat-layout .panel-card h3, .panel-card h3');
      if (h3) h3.innerHTML = highlightCombatMessageV25(message);
    },
  });

  // 5) 사냥터 몬스터 리젠 시 죽음 애니메이션 잔여 상태 초기화
  function resetRespawnedMonsterStateV25(m, assignNewId = false) {
    if (!m || !m.alive || m.hp <= 0) return;
    if (m.dying || m.deathStartedAt || m.shadowStacks || m.chillTurns || m.escapeFailedThisCombat) {
      m.dying = false;
      m.deathStartedAt = 0;
      m.shadowStacks = 0;
      m.chillTurns = 0;
      m.escapeFailedThisCombat = false;
      m.combatFinished = false;
      if (assignNewId && typeof uid === 'function') m.id = `${m.type || 'monster'}_${uid()}`;
    }
  }
  const oldUpdateForestMonstersV25 = updateForestMonsters;
  updateForestMonsters = function updateForestMonstersV25(dt) {
    const before = new Map((game.forestMonsters || []).map((m) => [m, !!m.alive]));
    oldUpdateForestMonstersV25(dt);
    (game.forestMonsters || []).forEach((m) => {
      const wasAlive = before.get(m);
      resetRespawnedMonsterStateV25(m, wasAlive === false);
    });
  };
  combatEntryPipeline.register({
    id:'combat-entry-v25',
    priority:250,
    handle:({ monster }, next) => {
      invalidateCombatSequenceV42();
      if (monster && monster.alive && monster.hp > 0) resetRespawnedMonsterStateV25(monster, false);
      return next();
    },
  });

  // 6) 전투 계산/암흑 DOT 순서 재정의
  function normalizeSpecV25(spec) { return spec === '분노' ? '무기' : (spec || null); }
  function currentSpecV25() { return normalizeSpecV25(game.player?.spec); }
  function getAttackStatValueV25() {
    const stats = computeTotalStats();
    if (game.player?.class === 'mage') return Math.max(1, Number(stats.지능 || 1));
    if (game.player?.class === 'priest') return Math.max(1, Number(stats.정신 || 1));
    return Math.max(1, Number(stats.힘 || 1));
  }
  getPlayerAttackPower = function getPlayerAttackPowerV25() {
    const stat = getAttackStatValueV25();
    const base = stat / 2;
    let minBonus = -stat * .20;
    let maxBonus = stat * .20;
    if (game.combatStatuses?.battleRoar) { minBonus = stat * .05; maxBonus = stat * .15; }
    let power = base + minBonus + Math.random() * (maxBonus - minBonus);
    let powerMax = base + maxBonus;
    // [시트개편] 환기 버프: 마법사 지능 +30% (3턴)
    if (game.player?.class === 'mage' && game.combatBuffs?.intBuffTurns > 0) {
      const intMult = 1 + (game.combatBuffs.intBuffPct || .30);
      power *= intMult; powerMax *= intMult;
    }
    game.__atkRollPowerV50 = Math.max(1, Math.round(power));
    game.__atkRollMaxV50 = Math.max(1, Math.round(powerMax));
    return game.__atkRollPowerV50;
  };
  // [시트개편] 치유 숙련: 모든 회복량 +50/100/150%
  function applyHealBoostV25(amount) {
    const rank = getSkillRank('priest_holy_grace_v24');
    if (rank <= 0 || amount <= 0) return amount;
    const arr = SKILL_DEFS.priest_holy_grace_v24?.healBoost || [];
    return Math.max(1, Math.round(amount * (1 + (arr[rank] || 0))));
  }
  function specDamageMultV25() {
    return 1; // [피드백] 전문화 공격 상수 전부 1.0 고정 (개별 스킬로만 차별화)
  }
  function playerCritChanceV25() {
    let c = 0.15; // [피드백] 화염 포함 기본 치명타 15% (스킬로 최대 +30%p)
    if (game.player?.class === 'mage' && currentSpecV25() === '화염') {
      const fRank = getSkillRank('mage_fire_focus_v24');
      if (fRank > 0) c += (SKILL_DEFS.mage_fire_focus_v24?.critChanceBonus || [])[fRank] || 0;
    }
    return Math.min(1, c);
  }
  function playerCritMultV25(isSkillHit = false) {
    const isFireSkill = isSkillHit && game.player?.class === 'mage' && currentSpecV25() === '화염';
    let m = isFireSkill ? 2.0 : 1.5;
    if (isFireSkill) {
      const eRank = getSkillRank('mage_fire_ember_v24');
      if (eRank > 0) m += (SKILL_DEFS.mage_fire_ember_v24?.critDmgBonus || [])[eRank] || 0;
    }
    return m;
  }
  function critRollV25(dmg, isSkillHit) {
    if (dmg <= 0) return { dmg: 0, crit: false };
    if (Math.random() < playerCritChanceV25()) {
      const criticalDamage = !isSkillHit
        ? YuksamCombatRules.mageBasicCriticalDamage(dmg)
        : Math.max(1, Math.ceil(dmg * playerCritMultV25(true)));
      return { dmg: criticalDamage, crit: true };
    }
    return { dmg, crit: false };
  }
  function incomingMultV25(monster) {
    let mult = 1;
    const k = game.player?.class, spec = currentSpecV25();
    if (k === 'warrior' && spec === '방어') mult *= 0.72;
    if (k === 'priest' && spec === '신성') mult *= 0.90;
    return mult;
  }
  function monsterCritV25() { return Math.random() < (currentSpecV25() === '방어' ? 0.10 : 0.15); }
  function buildSpecOnHitEffectsV25(monster, damage, skill) {
    const notices = [];
    if (!monster || damage <= 0) return notices;
    const k = game.player?.class, spec = currentSpecV25();
    if (k === 'mage' && spec === '냉기') {
      const force = !!skill?.active?.forceChill;
      if (force || Math.random() < 0.20) {
        notices.push({ text:'냉기 상태! 적의 다음 공격 데미지가 50% 감소합니다.', status:'chill', turns:2, mode:'max' });
      }
    }
    if (k === 'priest' && spec === '암흑') {
      const isShadowSkill = !!skill && (skill.kind === 'shadow' || String(skill.id || '').startsWith('priest_shadow_'));
      if (!isShadowSkill) notices.push({ text:'암흑 중첩 1회 추가.', status:'shadow', stacks:1, mode:'add', maxStacks:20 });
    }
    return notices;
  }
  function applyPlayerChillToActionV25(damage, hitInfo) {
    if (damage <= 0) return { damage, hitInfo };
    const sourceHits = hitInfo?.length ? hitInfo : [{ dmg: damage, crit: false, label: '' }];
    const chilled = YuksamCombatRules.applyChillToAttack(sourceHits.map((hit) => hit.dmg), game.playerChillTurns);
    game.playerChillTurns = chilled.chillTurns;
    const chilledHitInfo = sourceHits.map((hit, index) => ({ ...hit, dmg: chilled.damages[index] }));
    return {
      damage: chilledHitInfo.reduce((total, hit) => total + hit.dmg, 0),
      hitInfo: chilledHitInfo,
    };
  }
  function calculateActionDamageV25() {
    const isSkill = String(game.currentCombatAction || '').startsWith('active:');
    let skill = null, skillId = null, active = null;
    if (isSkill) { skillId = String(game.currentCombatAction).slice(7); skill = SKILL_DEFS[skillId]; active = skill?.active || {}; }
    const supportEffects = [];
    const support = (kind, data, text, phase = 'after', duration) => ({
      kind, ...data, text, phase,
      ...(duration == null ? {} : { duration }),
    });
    let chargeRelease = false;

    // === 비피해 계열 액티브 ===
    if (active && active.type === 'shield') {
      const shieldGain = Math.max(1, Math.ceil(game.player.maxHp * (active.shieldPct || .4)));
      setSkillCooldown(skillId, active.cooldown || 3);
      supportEffects.push(support('shield', { amount:shieldGain }, `${active.name}로 보호막 ${shieldGain}을 얻었습니다.`));
      return { damage: 0, actionMsg: `정답! ${active.name}로 보호막 ${shieldGain}을 얻었습니다. `, critical: false, skill, skillId, supportEffects };
    }
    if (active && active.type === 'shieldBash') {
      // [피드백] 방패 돌진: 보호막을 먼저 얻고, 현재 보호막 수치만큼 피해
      const shieldGain = Math.max(1, Math.ceil(game.player.maxHp * (active.shieldPct || .6)));
      const bashMissed = YuksamCombatRules.rollHostileHit(0.10, Math.random()).missed;
      const bashCritical = !bashMissed && Math.random() < playerCritChanceV25();
      const shieldCharge = YuksamCombatRules.shieldChargeDamage(Math.max(0, game.combatShield || 0) + shieldGain, bashCritical);
      const bashDmg = bashMissed ? 0 : shieldCharge.damage;
      const bashHitInfo = [{ dmg:bashDmg, crit:!bashMissed && bashCritical, missed:bashMissed, label:active.name }];
      const chilled = applyPlayerChillToActionV25(bashDmg, bashHitInfo);
      setSkillCooldown(skillId, active.cooldown || 4);
      supportEffects.push(support('shield', { amount:shieldGain }, `${active.name}으로 보호막 ${shieldGain}을 생성했다!`, 'before'));
      return { damage: chilled.damage, actionMsg: `정답! ${active.name}! 보호막 ${shieldGain}을 얻고, 보호막의 힘으로 ${chilled.damage}의 피해를 주었다! `, critical: false, skill, skillId, hitInfo: chilled.hitInfo, supportEffects };
    }
    if (active && active.type === 'buff') {
      setSkillCooldown(skillId, active.cooldown || 4);
      supportEffects.push(support('int-buff', { turns:active.buffTurns || 3, pct:active.buffPct || .30 }, `${active.name}! ${active.buffTurns || 3}턴간 지능이 ${Math.round((active.buffPct || .30) * 100)}% 상승합니다.`));
      if (active.healMaxPct > 0) {
        const buffHeal = applyHealBoostV25(Math.max(1, Math.ceil(game.player.maxHp * active.healMaxPct)));
        const actualBuffHeal = Math.min(Math.max(0, game.player.maxHp - game.player.hp), buffHeal);
        if (actualBuffHeal > 0) supportEffects.push(support('heal', { amount:actualBuffHeal }, `HP ${actualBuffHeal} 회복했다.`));
      }
      return { damage: 0, actionMsg: `정답! ${active.name}! ${active.buffTurns || 3}턴간 지능이 ${Math.round((active.buffPct || .30) * 100)}% 상승합니다. `, critical: false, skill, skillId, supportEffects };
    }
    if (active && active.type === 'charge') {
      setSkillCooldown(skillId, active.cooldown || 5);
      supportEffects.push(support('charge', {}, `${active.name}! 힘을 모읍니다... 다음 공격이 폭발한다!`, 'after', CHARGE_NOTICE_DELAY_V48 + 600));
      return { damage: 0, actionMsg: `정답! ${active.name}! 힘을 모읍니다... 다음 공격이 폭발한다! `, critical: false, skill, skillId, supportEffects };
    }
    if (active && active.type === 'healBuff') {
      const heal = applyHealBoostV25(Math.max(1, Math.ceil((game.player.maxHp - game.player.hp) * (active.healLostPct || .20))));
      const actualHeal = Math.min(Math.max(0, game.player.maxHp - game.player.hp), heal);
      setSkillCooldown(skillId, active.cooldown || 3);
      if (actualHeal > 0) supportEffects.push(support('heal', { amount:actualHeal }, `${active.name}로 HP ${actualHeal} 회복했다.`));
      supportEffects.push(support('battle-roar', { turns:2 }, '전투 의지가 타오릅니다.'));
      return { damage: 0, actionMsg: `정답! ${active.name}로 HP ${actualHeal} 회복, 전투 의지가 타오릅니다. `, critical: false, skill, skillId, supportEffects };
    }
    if (active && active.type === 'healAllies') {
      const healingPlan = YuksamCombatRules.planLivingAllyHeals([game.player], active.healMaxPct || .5);
      const totalHeal = healingPlan.reduce((sum, entry) => sum + entry.amount, 0);
      setSkillCooldown(skillId, active.cooldown || 4);
      if (totalHeal > 0) supportEffects.push(support('heal', { amount:totalHeal }, `${active.name}! 모든 생존 아군의 체력을 회복했다. 내 HP +${totalHeal}`));
      else return { damage: 0, actionMsg: `정답! ${active.name}! 모든 생존 아군의 체력이 이미 가득 차 있다.`, critical: false, skill, skillId, supportEffects };
      return { damage: 0, actionMsg: `정답! ${active.name}! 모든 생존 아군의 체력을 회복했다. 내 HP +${totalHeal} `, critical: false, skill, skillId, supportEffects };
    }

    // === 피해 계열 (일반 공격 또는 피해 액티브) ===
    const specMult = specDamageMultV25();
    let hits = [];
    let hitInfo = []; // [연출] 타격별 {dmg, crit, label} — 다단히트 순차 표시용
    let critical = false;
    const rollHit = (raw, hitLabelTxt, isSkillHit = isSkill, canCrit = true) => {
      const missed = YuksamCombatRules.rollHostileHit(0.10, Math.random()).missed;
      const labelText = hitLabelTxt || '';
      if (missed) {
        hitInfo.push({ dmg:0, crit:false, missed:true, label:labelText });
        return 0;
      }
      const d = raw > 0 ? Math.max(1, Math.ceil(raw * specMult)) : 0;
      if (d <= 0 || !canCrit) {
        hitInfo.push({ dmg:d, crit:false, missed:false, label:labelText });
        return d;
      }
      const r = critRollV25(d, isSkillHit);
      if (r.crit) {
        critical = true;
        // [v50] 치명타 하한: 같은 행동의 최대 일반 데미지 이상 보장
        const usedPower = Number(game.__atkRollPowerV50) || 0;
        const maxPower = Number(game.__atkRollMaxV50) || 0;
        if (raw > 0 && usedPower > 0 && maxPower > usedPower) {
          const critFloor = Math.ceil((raw / usedPower) * maxPower * specMult);
          if (r.dmg < critFloor) r.dmg = critFloor;
        }
      }
      hitInfo.push({ dmg:r.dmg, crit:r.crit, missed:false, label:labelText });
      return r.dmg;
    };

    let prefix = '';
    let label = '공격';
    let hitLabel = '';

    if (active && ['damage', 'damageHeal', 'shadowDot'].includes(active.type)) {
      label = active.name;
      if (active.hits && active.hits > 1) {
        for (let i = 0; i < active.hits; i++) hits.push(rollHit(getPlayerAttackPower() * (active.hitMult || 1)));
        hitLabel = `${active.hits}회 타격, `;
      } else if (active.multiplier === 0) {
        hits.push(rollHit(0, active.name, true, false)); // 피해 없는 적대 주문도 적중 여부 판정
      } else {
        hits.push(rollHit(getPlayerAttackPower() * (active.multiplier || 1)));
      }
    } else {
      // 일반 공격
      hits.push(rollHit(getPlayerAttackPower(), '', false));
      // 공세 갑옷: 최대체력 % 추가 피해 (일반 공격에만)
      const armorRank = getSkillRank('warrior_def_armor');
      if (armorRank > 0) {
        const arr = SKILL_DEFS.warrior_def_armor?.armorBonusPct || [];
        const extra = Math.max(1, Math.ceil(game.player.maxHp * (arr[armorRank] || 0)));
        hits.push(rollHit(extra, '공세 갑옷', false, false));
      }
      // 더블 어택: 2번째 타격 (개별 치명타)
      const dblRank = getSkillRank('warrior_weapon_breaker');
      if (dblRank > 0) {
        const arr = SKILL_DEFS.warrior_weapon_breaker?.doubleAttackPct || [];
        hits.push(rollHit(getPlayerAttackPower() * (arr[dblRank] || 0), '더블 어택', false));
        prefix = '더블 어택! ';
      }
    }

    let damage = hits.reduce((a, b) => a + Math.max(0, b), 0);

    // 차지(최후의 심판): 모아둔 힘으로 다음 공격 x4.5 — 타격별로 분배 적용
    if (damage > 0 && game.chargeActive) {
      const chargeMult = SKILL_DEFS.warrior_weapon_judgment?.active?.chargeMult || 4.5;
      hitInfo = hitInfo.map((h) => ({ ...h, dmg: h.dmg > 0 ? Math.max(1, Math.ceil(h.dmg * chargeMult)) : 0 }));
      damage = hitInfo.reduce((a, h) => a + Math.max(0, h.dmg), 0);
      chargeRelease = true;
      prefix = '💥 모아둔 힘 폭발! ' + prefix;
    }

    if (damage > 0) ({ damage, hitInfo } = applyPlayerChillToActionV25(damage, hitInfo));

    let healMsg = '';
    if (active && damage > 0) {
      if (active.type === 'damageHeal') {
        const heal = applyHealBoostV25(Math.max(1, Math.ceil(damage * (active.healRate || .5))));
        const actualHeal = Math.min(Math.max(0, game.player.maxHp - game.player.hp), heal);
        if (actualHeal > 0) supportEffects.push(support('heal', { amount:actualHeal }, `HP ${actualHeal} 회복했다.`));
        healMsg += `HP ${actualHeal} 회복. `;
      }
      if (active.healMaxPct) {
        const heal = applyHealBoostV25(Math.max(1, Math.ceil(game.player.maxHp * active.healMaxPct)));
        const actualHeal = Math.min(Math.max(0, game.player.maxHp - game.player.hp), heal);
        if (actualHeal > 0) supportEffects.push(support('heal', { amount:actualHeal }, `HP ${actualHeal} 회복했다.`));
        healMsg += `HP ${actualHeal} 회복. `;
      }
    }

    // 방패 돌진 등: 피해와 함께 보호막 획득
    if (active && active.bonusShieldPct) {
      const sg = Math.max(1, Math.ceil(game.player.maxHp * active.bonusShieldPct));
      supportEffects.push(support('shield', { amount:sg }, `보호막 ${sg}을 획득했다.`));
      healMsg += `보호막 ${sg} 획득. `;
    }

    if (active) setSkillCooldown(skillId, active.cooldown || 3);

    let actionMsg;
    if (damage > 0) actionMsg = `정답! ${prefix}${label}${label === '공격' ? '으로' : '으로'} ${hitLabel}${damage} 피해를 주었습니다. ${healMsg}`;
    // (hitInfo는 아래 return에서 함께 반환)
    else actionMsg = `정답! ${label} 시전! ${healMsg}`;

    if (critical) {
      actionMsg = '치명타! ' + actionMsg;
    }
    return { damage, actionMsg, critical, skill, skillId, hitInfo, supportEffects, chargeRelease, ignoreShield:active?.ignoreShield === true };
  }
  function takePendingPlayerPoisonV42() {
    if (!(game.playerAilments?.poisonTurns > 0)) return null;
    const damage = Math.max(1, game.playerAilments.poisonDmg || 1);
    return { damage, text:`중독으로 독이 몸을 갉아먹습니다! HP -${damage}` };
  }
  function applyPendingPlayerPoisonV42(pending) {
    if (!pending) return null;
    return {
      type:'player-dot',
      text:pending.text,
      tone:'enemy-action',
      duration:COMBAT_CUSTOM_NOTICE_DELAY_V43,
      effect:{
        id:`${game.currentCombatMonsterId}:player-dot:${game.combatEffectSerial = (Number(game.combatEffectSerial) || 0) + 1}`,
        type:'player-dot',
        combatId:game.currentCombatMonsterId,
        amount:pending.damage,
        status:'poison',
        consumeTurn:true,
      },
      fx:{ source:'monster-dot', target:'player' },
    };
  }
  function applyShadowDotAfterEnemyAttackV25(monster) {
    if (!monster || monster.hp <= 0 || !(monster.shadowStacks > 0)) return { dot:0, msg:'' };
    // [피드백] 암흑 중첩 = 중첩 수만큼 고정 피해 (5중첩=5). 중첩은 사라지지 않고 무한 누적.
    let dot = Math.max(1, Math.floor(monster.shadowStacks || 0));
    let crit = false;
    const vRank = getSkillRank('priest_shadow_void_v24');
    if (vRank > 0) {
      const arr = SKILL_DEFS.priest_shadow_void_v24?.shadowCritChance || [];
      if (Math.random() < (arr[vRank] || 0)) { dot = Math.max(1, Math.ceil(dot * 2.0)); crit = true; }
    }
    // [암흑 집중] 포인트별 확률로 암흑 중첩 데미지만큼 생명력 흡혈
    let lifesteal = false;
    const focusRank = getSkillRank('priest_shadow_focus_v24');
    if (focusRank > 0) {
      const arr = SKILL_DEFS.priest_shadow_focus_v24?.shadowLifestealChance || [];
      if (Math.random() < (arr[focusRank] || 0)) lifesteal = true;
    }
    return { dot, crit, lifesteal, msg:`${crit ? '🌑💥 암흑 치명타! ' : ''}암흑 중첩(${monster.shadowStacks})이 ${dot} 피해를 입혔습니다!` };
  }
  function finishMonsterDefeatV25(defeatedMonster, expGain) {
    game.currentCombatMonsterId = null;
    syncAudioFileBgm();
    game.currentQuestion = null;
    game.currentCombatAction = null;
    game.combatHpDisplay = null;
    closeModal();
    game.transitionLock = 0;
    if (expGain > 0) addExp(expGain);
    addGold(defeatedMonster.gold || 0);
    if (typeof incrementQuestProgressByMonster === 'function') incrementQuestProgressByMonster(defeatedMonster);
    // [피드백] 전투 승리 시 10% 확률로 빌딩 화폐 1개 드랍
    let buildingGain = 0;
    if (Math.random() < 0.10) {
      buildingGain = 1;
      addBuilding(1);
    }
    const expText = expGain > 0 ? `EXP +${expGain}` : '레벨 차이로 EXP 없음';
    showRewardSequenceV2('몬스터를 처치했습니다!', defeatedMonster.name, {
      exp:expGain,
      gold:defeatedMonster.gold || 0,
      building:buildingGain,
    }, { monsterRandomBuilding:buildingGain > 0 });
    const buildingText = buildingGain > 0 ? `, 빌딩 +${buildingGain}` : '';
    appendChatMessage?.('system', '전투', `${defeatedMonster.name} 처치! ${expText}, Gold +${defeatedMonster.gold || 0}${buildingText}`);
    savePlayer?.();
  }
  function startMonsterDefeatSequenceV25(monster, actionMsg = '') {
    if (!monster || monster.dying) return;
    monster.hp = 0;
    monster.dying = true;
    monster.deathStartedAt = Date.now();
    monster.chasing = false;
    game.currentQuestion = null;
    game.currentCombatAction = null;
    game.transitionLock = Date.now() + 5200;
    renderCombatFrame(actionMsg + `${monster.name}의 HP가 0이 되었습니다!`, `<p class="muted">${escapeHtml(monster.name)}이(가) 힘을 잃고 쓰러집니다...</p>`);
    playSfx('hit');
    const defeatedMonster = { ...monster, hp:0, alive:false };
    const expGain = getMonsterExpGain(defeatedMonster);
    setTimeout(() => {
      monster.alive = false;
      monster.respawnAt = Date.now() + 30000;
      playSfx('victory');
      renderCombatFrame(`${defeatedMonster.name}을(를) 처치했습니다!`, `<p class="muted">전투가 종료됩니다...</p>`);
    }, 1520);
    setTimeout(() => finishMonsterDefeatV25(defeatedMonster, expGain), 3040);
  }
  window.startMonsterDefeatSequenceV25 = startMonsterDefeatSequenceV25; // [v41] 치트: 몬스터 즉시 처치용 노출
  window.currentCombatMonster = currentCombatMonster; // [v41] 치트: 현재 전투 몬스터 접근용 노출

  monsterCounterAttack = function monsterCounterAttackV25(messagePrefix = '') {
    const monster = currentCombatMonster();
    if (!monster || !monster.alive || monster.dying) return;
    Object.assign(monster, YuksamCombatRules.normalizeCombatStatuses(monster));
    delete monster.weakenTurns;
    delete monster.chilledTurns;
    const pendingPoison = takePendingPlayerPoisonV42();
    const effectBatchId = `${monster.id}:counter:${game.combatEffectSerial = (Number(game.combatEffectSerial) || 0) + 1}`;
    let effectIndex = 0;
    const makeCounterEffect = (type, metadata = {}) => ({
      id:`${effectBatchId}:${effectIndex++}`,
      type,
      combatId:monster.id,
      ...metadata,
    });

    // === 라운드 유지 효과 감소 ===
    if (game.combatBuffs?.intBuffTurns > 0) game.combatBuffs.intBuffTurns -= 1;
    if (game.bastionCd > 0) game.bastionCd -= 1;

    const regenRank = getSkillRank('warrior_regeneration');
    if (regenRank > 0) {
      const rates = [0, .015, .03];
      const heal = Math.max(1, Math.floor(game.player.maxHp * (rates[regenRank] || 0)));
      game.player.hp = Math.min(game.player.maxHp, game.player.hp + heal);
    }

    // 불굴의 의지: 전투 단계 가장 마지막에 상태이상 해제 판정 (성공 시 로그 출력)
    const buildResistCleanseNoticeV50 = (poisonTicked, pendingStatuses = []) => {
      const resistRank = getSkillRank('warrior_def_resist');
      if (!(resistRank > 0)) return null;
      const names = [];
      if (Math.max(0, (game.playerAilments?.poisonTurns || 0) - (poisonTicked ? 1 : 0)) > 0 || pendingStatuses.includes('poison')) names.push('중독');
      if ((game.playerAilments?.stunTurns || 0) > 0 || pendingStatuses.includes('stun')) names.push('기절');
      if (!names.length) return null;
      const arr = SKILL_DEFS.warrior_def_resist?.cleanseChance || [];
      if (!(Math.random() < (arr[resistRank] || 0))) return null;
      return {
        type:'player-cleanse',
        text:`불굴의 의지로 ${names.join('과 ')}에서 풀려났다!`,
        tone:'player-action',
        effect:makeCounterEffect('player-status', { status:'cleanse' }),
      };
    };

    // 막기 훈련: 적 반격 직전 현재 체력 % 보호막 생성
    const guardRank = getSkillRank('warrior_basic_guard');
    let guardGain = 0;
    if (guardRank > 0) {
      const arr = SKILL_DEFS.warrior_basic_guard?.guardShieldPct || [];
      const guardShieldPct = Number(arr[guardRank] || 0);
      if (game.player.hp > 0 && guardShieldPct > 0) {
        guardGain = Math.max(1, Math.floor(game.player.hp * guardShieldPct));
      }
    }
    const blockTrainingNotice = guardGain > 0 ? {
      type:'enemy-status',
      text:`막기 훈련으로 보호막 ${guardGain}을 생성했다!`,
      tone:'player-action',
      audioId:'blockShield',
      effect:makeCounterEffect('player-status', { status:'shield', damage:guardGain }),
    } : null;

    // === 기절: 적이 이번 턴 공격하지 못함 ===
    if (monster.stunTurns > 0) {
      const stunMsg = `${messagePrefix}💫 ${monster.name}이(가) 기절해 공격하지 못했다!`;
      const stunEvents = [];
      if (blockTrainingNotice) stunEvents.push(blockTrainingNotice);
      stunEvents.push({ type:'monster-action', text:stunMsg, tone:'enemy-action' });
      const { dot, crit, lifesteal, msg } = applyShadowDotAfterEnemyAttackV25(monster);
      if (dot > 0) stunEvents.push({
        type:'player-dot',
        text:msg,
        effect:makeCounterEffect('monster-dot', { amount:dot, ...(crit ? { critical:true } : {}), ...(lifesteal ? { shadowLifesteal:true } : {}) }),
        audioId:'shadowStackHit',
        fx:{ source:'player-dot', target:'monster' },
      });
      const poisonEvent = applyPendingPlayerPoisonV42(pendingPoison);
      if (poisonEvent) stunEvents.push(poisonEvent);
      const stunPathCleanse = buildResistCleanseNoticeV50(!!poisonEvent);
      if (stunPathCleanse) stunEvents.push(stunPathCleanse);
      queueCombatSequence(stunEvents, () => {
        if (monster.stunTurns > 0) monster.stunTurns -= 1;
        tickSkillCooldowns();
        savePlayer?.(); updateHud?.();
        const fresh = currentCombatMonster();
        if (!fresh || !fresh.alive || fresh.dying) return;
        if (game.player.hp <= 0) { handlePlayerDefeat(); return; }
        if (fresh.hp <= 0) { startMonsterDefeatSequenceV25(fresh, ''); return; }
        game.currentQuestion = null; game.currentCombatAction = null;
        renderCombatMenu(stunEvents.at(-1)?.text || stunMsg);
      });
      return;
    }

    let incoming = monster.attack || 1;
    if (monster.type === 'teacherBoss') incoming = Math.ceil(incoming * 1.2);
    // [추가] 최종보스 명진쌤은 방어력(피해 감소 계열)을 전부 무시하는 데미지
    const pierceDefense = monster.type === 'teacherBoss';

    // ══ [피드백] 몬스터 특수 공격 패턴 ══
    const PATTERNS_V40 = {
      mushroom:  [{ c:.22, k:'poison', turns:2, n:'포자 뿌리기' }],
      slime:     [{ c:.25, k:'selfShield', pct:.35, n:'점액 방패' }],
      stomp:     [{ c:.25, k:'heavy', mult:1.5, stun:1, n:'대지 찍기' }, { c:.20, k:'selfShield', pct:.30, n:'대지 방패' }],
      snake:     [{ c:.25, k:'poison', turns:3, n:'맹독니' }, { c:.15, k:'crit', n:'급소 노리기' }],
      tarantula: [{ c:.30, k:'multi', hits:2, mult:.62, n:'연속 물기' }, { c:.20, k:'heavy', mult:1.3, stun:1, n:'마비 독니' }],
      zombie:    [{ c:.25, k:'lifesteal', pct:1.0, n:'물어뜯기' }],
      teacherBoss: [{ c:.25, k:'heavy', mult:1.6, n:'사랑의 매' }, { c:.20, k:'multi', hits:2, mult:.72, n:'숙제 폭탄' }, { c:.15, k:'chillPlayer', n:'따끔한 꾸중' }],
    };
    let patterns = (PATTERNS_V40[monster.type] || []).slice();
    if (monster.elite && monster.type !== 'teacherBoss') {
      patterns = patterns.map((pt) => ({ ...pt, c: Math.min(.5, pt.c + .12) }));
      patterns.push({ c: .18, k: 'heavy', mult: 1.5, n: '분노의 일격' });
      patterns.push({ c: .15, k: 'selfShield', pct: .225, n: '단단해지기' });
    }
    let pattern = null;
    for (const pt of patterns) { if (Math.random() < pt.c) { pattern = pt; break; } }
    const eliteSelfShieldTurn = pattern?.k === 'selfShield'; // [v50] 보호막 기술은 공격하지 않음(점액 방패 포함)
    let techniqueNotices = [];
    let techniqueStatusEffect = null;
    let forceCrit = false;
    let extraHit = 0;
    let lifestealPct = 0;
    if (pattern) {
      const techniqueEffect = { name: pattern.n, kind: pattern.k };
      if (pattern.k === 'heavy') incoming = Math.ceil(incoming * pattern.mult);
      else if (pattern.k === 'crit') forceCrit = true;
      else if (pattern.k === 'multi') { extraHit = Math.ceil(incoming * pattern.mult); incoming = Math.ceil(incoming * pattern.mult); }
      else if (pattern.k === 'poison') {
        const poisonDamage = Math.max(1, Math.ceil((monster.attack || 1) * 0.3));
        techniqueEffect.poisonTurns = pattern.turns;
        techniqueStatusEffect = makeCounterEffect('player-status', {
          status:'poison',
          turns:pattern.turns,
          damage:poisonDamage,
        });
      }
      else if (pattern.k === 'selfShield') {
        const shieldGain = Math.ceil((monster.maxHp || 10) * pattern.pct);
        techniqueEffect.shield = shieldGain;
        techniqueStatusEffect = makeCounterEffect('monster-shield', { amount:shieldGain });
      }
      else if (pattern.k === 'lifesteal') { lifestealPct = pattern.pct; }
      else if (pattern.k === 'chillPlayer') {
        techniqueEffect.kind = 'chill';
        techniqueStatusEffect = makeCounterEffect('player-status', { status:'chill', turns:1 });
      }
      if (pattern.stun > 0) {
        techniqueEffect.kind = 'stun';
        techniqueEffect.stunTurns = pattern.stun;
        techniqueStatusEffect = makeCounterEffect('player-status', { status:'stun', turns:pattern.stun });
      }
      techniqueNotices = YuksamCombatRules.buildMonsterTechniqueNotices(techniqueEffect);
    }

    // 모든 적대 타격은 기본 10%, 신앙의 광채는 추가 확률로 개별 빗나감 판정
    const lifeRank = getSkillRank('priest_basic_life');
    const faithMissChance = !pierceDefense && lifeRank > 0
      ? (SKILL_DEFS.priest_basic_life?.monsterMissChance || [])[lifeRank] || 0
      : 0;
    const monsterMissChance = YuksamCombatRules.combinedMonsterMissChance(faithMissChance);

    const armorRank = getSkillRank('warrior_thick_armor');
    if (!pierceDefense && armorRank > 0) {
      const reductions = [0, .05, .10];
      incoming = Math.max(0, Math.ceil(incoming * (1 - (reductions[armorRank] || 0))));
    }
    incoming = Math.max(0, Math.ceil(incoming * (pierceDefense ? 1 : incomingMultV25(monster))));
    const chilledAttack = YuksamCombatRules.applyChillToAttack([incoming, extraHit], monster.chillTurns);
    [incoming, extraHit] = chilledAttack.damages;
    const consumedChillEffect = chilledAttack.chillTurns !== (monster.chillTurns || 0)
      ? makeCounterEffect('monster-status', { status:'chill', turns:chilledAttack.chillTurns })
      : null;

    const plannedAmounts = eliteSelfShieldTurn ? [] : [incoming, extraHit];
    const hitMissPlans = plannedAmounts.map((amount) => {
      if (!(amount > 0)) return { missed:false, missedByFaith:false };
      const roll = Math.random();
      const missed = YuksamCombatRules.rollHostileHit(monsterMissChance, roll).missed;
      const universalMiss = YuksamCombatRules.rollHostileHit(0.10, roll).missed;
      return { missed, missedByFaith:missed && !universalMiss && faithMissChance > 0 };
    });
    const critical = !eliteSelfShieldTurn && !hitMissPlans[0].missed && (forceCrit || monsterCritV25());
    if (critical) incoming = Math.max(1, Math.ceil(incoming * 1.8));
    if (!eliteSelfShieldTurn) {
      plannedAmounts[0] = incoming;
      plannedAmounts[1] = extraHit;
    }

    // 기도의 방벽: 받은 피해 반사(보호막 적용 전 원 피해 기준) + 회복
    let reflectDmg = 0;
    if (!eliteSelfShieldTurn && !hitMissPlans[0].missed && incoming > 0) {
      const prayerRank = getSkillRank('priest_basic_prayer');
      if (prayerRank > 0) {
        const arr = SKILL_DEFS.priest_basic_prayer?.reflectPct || [];
        reflectDmg = Math.floor(incoming * (arr[prayerRank] || 0));
      }
    }
    let masteryReflectDmg = 0;
    if (critical && incoming > 0) {
      const masteryRank = getSkillRank('warrior_weapon_mastery');
      if (masteryRank > 0) {
        const arr = SKILL_DEFS.warrior_weapon_mastery?.reflectPct || [];
        masteryReflectDmg = Math.floor(incoming * (arr[masteryRank] || 0));
      }
    }

    const hitPlans = [];
    let projectedShield = Math.max(0, game.combatShield || 0) + guardGain;
    let projectedHp = Math.min(game.player.maxHp, Math.max(0, game.player.hp || 0));
    let totalPlayerDamage = 0;
    for (const [hitIndex, amount] of plannedAmounts.entries()) {
      if (!(amount > 0) || projectedHp <= 0) continue;
      const missPlan = hitMissPlans[hitIndex];
      if (missPlan.missed) {
        hitPlans.push({ hitIndex, amount, missed:true, missedByFaith:missPlan.missedByFaith, critical:false });
        continue;
      }
      const blocked = pierceDefense ? 0 : Math.min(projectedShield, amount);
      projectedShield -= blocked;
      const damage = Math.max(0, amount - blocked);
      projectedHp = Math.max(0, projectedHp - damage);
      totalPlayerDamage += damage;
      hitPlans.push({
        hitIndex,
        amount,
        missed:false,
        blocked,
        damage,
        remainingShield:projectedShield,
        critical:hitIndex === 0 && critical,
      });
    }
    const monsterHeal = lifestealPct > 0 && totalPlayerDamage > 0
      ? Math.ceil(totalPlayerDamage * lifestealPct)
      : 0;
    const predictedFatal = projectedHp <= 0;
    const poisonEvent = applyPendingPlayerPoisonV42(pendingPoison);
    const monsterActionFxProfile = YuksamCombatFx.getMonsterActionFxProfile(monster, pattern);
    const monsterActionAudioId = null; // [v50] 공격 소리는 명중 시점으로 이동, 시전은 합성 신호음
    const monsterEvents = [];
    if (blockTrainingNotice) monsterEvents.push(blockTrainingNotice);
    const actionText = techniqueNotices[0] || `${monster.name}의 ${critical ? '치명적인 ' : ''}공격!`;
    monsterEvents.push({
      type:'monster-action',
      text:actionText,
      tone:'enemy-action',
      fx:monsterActionFxProfile,
      ...(pattern?.k === 'selfShield' ? {} : { audioId:'synthWindupCue', fallbackSfx:'hit' }),
      ...(consumedChillEffect ? { effect:consumedChillEffect } : {}),
    });
    const techniqueStatusLands = pattern?.k === 'selfShield' || !hitMissPlans[0].missed;
    (techniqueStatusLands ? techniqueNotices.slice(1) : []).forEach((text, index) => monsterEvents.push({
      type:'player-status',
      text,
      tone:'enemy-action',
      ...(index === 0 && techniqueStatusEffect ? { effect:techniqueStatusEffect } : {}),
      ...(index === 0 && techniqueStatusEffect?.status === 'stun' ? { audioId:'stunned' } : {}),
      ...(index === 0 && pattern?.k === 'selfShield' ? { audioId:'defensiveStance' } : {}),
    }));

    hitPlans.forEach((hit, index) => {
      if (hit.missed) {
        monsterEvents.push({
          type:'player-damage',
          text:hit.missedByFaith
            ? `${monster.name}의 공격! 신앙의 광채로 인해 공격이 빗나갔다!`
            : `${monster.name}의 공격이 빗나갔다!`,
          tone:'enemy-action',
          audioId:'miss',
        });
        return;
      }
      const damageParts = [];
      if (hit.blocked > 0) damageParts.push(`🛡️ 보호막이 ${hit.blocked}을 막아냈다!`);
      if (hit.damage > 0) damageParts.push(`${hit.damage}의 피해를 받았다!`);
      if (hit.blocked > 0 && hit.damage > 0) damageParts.push(`(총 ${hit.blocked + hit.damage}의 데미지)`);
      if (pierceDefense) damageParts.push('⚡ 방어력과 보호막을 무시하는 피해다!');
      if (hit.remainingShield > 0) damageParts.push(`남은 보호막 ${hit.remainingShield}`);
      const isLastHit = index === hitPlans.length - 1;
      const monsterHitFxProfile = YuksamCombatFx.getMonsterHitFxProfile(monster, pattern);
      monsterEvents.push({
        type:'player-damage',
        text:damageParts.join(' ') || '공격을 막아냈다!',
        tone:'enemy-action',
        effect:makeCounterEffect('player-damage', {
          amount:hit.amount,
          pierceDefense,
          hitIndex:hit.hitIndex,
          ...(hit.critical ? { critical:true } : {}),
          ...(isLastHit && monsterHeal > 0 ? { monsterHeal } : {}),
        }),
        audioId:'enemyAttack',
        ...(monsterHitFxProfile ? { fx:monsterHitFxProfile } : {}),
      });
    });
    if (monsterHeal > 0 && monster.hp > 0) {
      monsterEvents.push({
        type:'monster-lifesteal',
        text:`${monster.name}이(가) 체력을 ${monsterHeal}만큼 회복했다!`,
        tone:'enemy-action',
      });
    }
    if (reflectDmg > 0 && !predictedFatal && monster.hp > 0) {
      const plannedPrayerHeal = applyHealBoostV25(reflectDmg);
      const actualPrayerHeal = Math.min(
        Math.max(0, game.player.maxHp - projectedHp),
        plannedPrayerHeal,
      );
      monsterEvents.push({
        type:'retaliation',
        text:`기도의 방벽이 발동했다! ${monster.name}에게 반사 피해 ${reflectDmg}! 실제 회복 ${actualPrayerHeal}!`,
        audioId:'prayerBarrier',
        effect:makeCounterEffect('retaliation', {
          amount:reflectDmg,
          heal:actualPrayerHeal,
        }),
      });
    }
    if (masteryReflectDmg > 0 && !predictedFatal && monster.hp > 0) {
      monsterEvents.push({
        type:'retaliation',
        text:`무기 숙련이 발동했다! ${monster.name}에게 반사 피해 ${masteryReflectDmg}!`,
        audioId:'prayerBarrier',
        effect:makeCounterEffect('retaliation', { amount:masteryReflectDmg }),
      });
    }

    const { dot, crit:dotCritical, lifesteal:dotLifesteal, msg } = applyShadowDotAfterEnemyAttackV25(monster);
    if (dot > 0) monsterEvents.push({
      type:'player-dot',
      text:msg,
      effect:makeCounterEffect('monster-dot', { amount:dot, ...(dotCritical ? { critical:true } : {}), ...(dotLifesteal ? { shadowLifesteal:true } : {}) }),
      audioId:'shadowStackHit',
      fx:{ source:'player-dot', target:'monster' },
    });
    if (poisonEvent) monsterEvents.push(poisonEvent);
    const pendingCleanseStatusesV50 = techniqueStatusLands && techniqueStatusEffect?.status ? [techniqueStatusEffect.status] : [];
    const resistCleanseNotice = buildResistCleanseNoticeV50(!!poisonEvent, pendingCleanseStatusesV50);
    if (resistCleanseNotice) monsterEvents.push(resistCleanseNotice);

    const bastionRank = getSkillRank('warrior_def_bastion');
    let bastionReserved = false;
    if (predictedFatal && bastionRank > 0 && !game.bastionUsed) {
      game.bastionUsed = true;
      game.bastionCd = SKILL_DEFS.warrior_def_bastion?.reviveCooldown || 10;
      bastionReserved = true;
      savePlayer?.(); updateHud?.();
    }

    const counterMsg = monsterEvents.at(-1)?.text || actionText;
    queueCombatSequence(monsterEvents, () => {
      tickSkillCooldowns();
      savePlayer?.(); updateHud?.();
      const fresh = currentCombatMonster();
      if (!fresh || !fresh.alive || fresh.dying) return;
      if (game.player.hp <= 0) {
        const canRevive = bastionReserved || (bastionRank > 0 && !game.bastionUsed);
        if (canRevive) {
          if (!bastionReserved) {
            game.bastionUsed = true;
            game.bastionCd = SKILL_DEFS.warrior_def_bastion?.reviveCooldown || 10;
          }
          const healPct = SKILL_DEFS.warrior_def_bastion?.reviveHealPct || 1.0;
          game.combatShield = 0;
          game.player.hp = Math.max(1, Math.round(game.player.maxHp * healPct));
          savePlayer?.(); updateHud?.();
          renderCombatFrame('🌟 수호자의 맹세! 다시 일어난다!', `<p class="muted">다시 전투 태세를 갖춥니다.</p>`);
          window.playGuardianReviveFxV41?.();
          combatSequenceControllerV47.defer(() => {
            const revivedMonster = currentCombatMonster();
            if (!revivedMonster || !revivedMonster.alive || revivedMonster.dying) return;
            game.currentQuestion = null; game.currentCombatAction = null;
            renderCombatMenu('수호자의 맹세로 부활했다! 다시 싸우자!');
          }, COMBAT_NOTICE_DELAY_V25);
          return;
        }
        renderCombatFrame(`${fresh.name}의 공격으로 쓰러졌다!`, `<p class="muted">쓰러지는 중...</p>`);
        combatSequenceControllerV47.defer(handlePlayerDefeat, 1220);
        return;
      }
      if (fresh.hp <= 0) { startMonsterDefeatSequenceV25(fresh, ''); return; }
      game.currentQuestion = null;
      game.currentCombatAction = null;
      if (game.playerAilments?.stunTurns > 0) {
        queueCombatSequence([{ type:'player-status', text:'기절로 인해 다음 행동을 할 수 없습니다!', tone:'enemy-action' }], () => {
          if (game.playerAilments?.stunTurns > 0) game.playerAilments.stunTurns -= 1;
          monsterCounterAttack('');
        });
      } else {
        renderCombatMenu(counterMsg);
      }
    });
  };
  window.submitCombatAnswer = function submitCombatAnswerV25() {
    const monster = currentCombatMonster();
    if (!monster || !game.currentQuestion || monster.dying || game.wrongAnswerReviewing) return;
    const answer = normalize(game.currentQuestion.answer);
    const given = normalize($('combatAnswer')?.value || '');
    if (!given) { toast('정답을 입력하세요.'); return; }
    if (given !== answer) {
      if (game.player) {
        if (!game.player.records) game.player.records = { answered: 0, correct: 0, wrongLog: [] };
        game.player.records.answered = (game.player.records.answered || 0) + 1;
        if (!Array.isArray(game.player.records.wrongLog)) game.player.records.wrongLog = [];
        game.player.records.wrongLog.push({ q: game.currentQuestion.q, a: game.currentQuestion.answer, mine: $('combatAnswer')?.value || '', at: Date.now() });
        if (game.player.records.wrongLog.length > 30) game.player.records.wrongLog.splice(0, game.player.records.wrongLog.length - 30);
        savePlayer();
      }
      game.wrongAnswerReviewing = true;
      YuksamWrongAnswerReview.reveal({
        root:$('modalContent'),
        correctAnswer:game.currentQuestion.answer,
        onComplete:() => {
          game.wrongAnswerReviewing = false;
          const fresh = currentCombatMonster();
          if (!fresh || fresh.id !== monster.id || fresh.dying || !game.currentQuestion) return;
          resolveWrongAnswerV2(fresh);
        },
      });
      return;
    }
    if (game.player) {
      if (!game.player.records) game.player.records = { answered: 0, correct: 0, wrongLog: [] };
      game.player.records.answered = (game.player.records.answered || 0) + 1;
      game.player.records.correct = (game.player.records.correct || 0) + 1;
    }

    const result = calculateActionDamageV25();
    let { damage, actionMsg, skill } = result;
    game.attackTimer = 260;

    const isSkillAction = String(game.currentCombatAction || '').startsWith('active:');
    const activeSkill = isSkillAction ? SKILL_DEFS[String(game.currentCombatAction).slice(7)] : null;
    const act = activeSkill?.active || {};
    const activeFxProfile = activeSkill
      ? { ...YuksamCombatFx.getSkillFxProfile(activeSkill.id, activeSkill), source:'player' }
      : YuksamCombatFx.getBasicAttackFxProfile(game.player?.class);
    const actionAudioId = result.chargeRelease
      ? window.YuksamAudioManifest?.skillSounds?.warrior_weapon_judgment
      : activeSkill
      ? window.YuksamAudioManifest?.skillSounds?.[activeSkill.id]
      : window.YuksamAudioManifest?.classBasicSounds?.[game.player?.class];
    const ultimateId = result.chargeRelease
      ? 'warrior_weapon_judgment'
      : activeSkill?.kind === 'ultimate' ? activeSkill.id : null;

    const actionHits = (result.hitInfo || []).filter((h) => h.dmg > 0 || h.missed);
    const firstDamageHitIndex = actionHits.findIndex((hit) => hit.dmg > 0);
    let lastDamageHitIndex = -1;
    actionHits.forEach((hit, index) => { if (hit.dmg > 0) lastDamageHitIndex = index; });
    const effectBatchId = `${monster.id}:player:${game.combatEffectSerial = (Number(game.combatEffectSerial) || 0) + 1}`;
    const elementalExecuteHp = YuksamCombatRules.executeHpThreshold(getSkillRank('mage_basic_element'));
    const skillLogDelay = activeSkill ? PLAYER_ATTACK_NOTICE_DELAY_V46 + 1000 : PLAYER_ATTACK_NOTICE_DELAY_V46;
    const playerEvents = [{ type:'answer-correct', text:'정답!', duration:CORRECT_ANSWER_NOTICE_DELAY_V48 }];
    if (actionHits.length) {
      actionHits.forEach((hit, index) => {
        const source = hit.label || act.name || '';
        const finalHit = index === lastDamageHitIndex;
        const meteorReplay = activeSkill?.id === 'mage_fire_meteor_v24';
        const hitAudioId = hit.missed
          ? 'miss'
          : result.chargeRelease
            ? actionAudioId
            : hit.label === '더블 어택'
              ? window.YuksamAudioManifest?.classBasicSounds?.[game.player?.class]
              : index === 0 || meteorReplay ? actionAudioId : null;
        playerEvents.push({
          type:index === 0 ? 'player-hit' : 'player-extra-hit',
          text:hit.missed
            ? `${source || act.name || '공격'}이 빗나갔다!`
            : `${hit.crit ? '💥 치명타! ' : ''}${hit.dmg}의 피해${source ? ` (${source})` : ''}를 주었다!`,
          duration:result.chargeRelease ? CHARGE_RELEASE_HIT_NOTICE_DELAY_V48 : skillLogDelay,
          ...(!hit.missed ? { effect:{
            id:`${effectBatchId}:${index}`,
            type:'monster-damage',
            combatId:monster.id,
            amount:hit.dmg,
            ignoreShield:result.ignoreShield === true,
            ...(result.chargeRelease && index === firstDamageHitIndex ? { consumeCharge:true } : {}),
            ...(hit.crit ? { critical:true } : {}),
            finalHit,
            resolutionId:effectBatchId,
            executePct:finalHit && activeSkill ? Number(act.executePct) || 0 : 0,
            executeHp:finalHit ? elementalExecuteHp : 0,
          } } : {}),
          fx:{
            ...activeFxProfile,
            motion:hit.label === '공세 갑옷' ? 'offensive-armor-bump' : activeFxProfile.motion,
            ...(hit.label === '공세 갑옷' ? { motionTravelPct:.35, travelMs:230, actionMs:420 } : {}),
            hitIndex:index,
            hitStage:index === 0 ? 'primary' : 'follow-up',
          },
          ...(hitAudioId ? { audioId:hitAudioId } : {}),
          ...(ultimateId && (index === 0 || (result.chargeRelease && !hit.missed)) ? { ultimateId } : {}),
          ...(!hit.missed && hit.label === '공세 갑옷' ? { audioId:'offensiveArmor', fallbackSfx:'hit' } : {}),
        });
      });
    } else if (damage > 0) {
      playerEvents.push({
        type:'player-hit',
        text:`${damage}의 피해를 주었다!`,
        duration:result.chargeRelease ? CHARGE_RELEASE_HIT_NOTICE_DELAY_V48 : skillLogDelay,
        effect:{
          id:`${effectBatchId}:0`,
          type:'monster-damage',
          combatId:monster.id,
          amount:damage,
          ignoreShield:result.ignoreShield === true,
          ...(result.chargeRelease ? { consumeCharge:true } : {}),
          ...(result.critical ? { critical:true } : {}),
          finalHit:true,
          resolutionId:effectBatchId,
          executePct:activeSkill ? Number(act.executePct) || 0 : 0,
          executeHp:elementalExecuteHp,
        },
        fx:{ ...activeFxProfile, hitIndex:0, hitStage:'primary' },
        ...(actionAudioId ? { audioId:actionAudioId } : {}),
        ...(ultimateId ? { ultimateId } : {}),
      });
    } else {
      if (!result.supportEffects?.length) {
        playerEvents.push({
          type:'player-hit',
          text:String(actionMsg || '').replace(/^치명타!\s*/, '').replace(/^정답!\s*/, '').trim(),
          duration:skillLogDelay,
          fx:{ ...activeFxProfile, hitStage:'primary' },
          ...(actionAudioId ? { audioId:actionAudioId } : {}),
          ...(ultimateId ? { ultimateId } : {}),
        });
      }
    }
    finishPlayerActionV39(monster, result, activeSkill, act, skill, actionMsg, playerEvents, effectBatchId);
  };

  function calculateWrongActionDamageV2() {
    const skillId = String(game.currentCombatAction || '').startsWith('active:')
      ? String(game.currentCombatAction).slice(7)
      : null;
    const skill = skillId ? SKILL_DEFS[skillId] : null;
    const active = skill?.active || null;
    const damagingSkill = active && ['damage', 'damageHeal', 'shadowDot'].includes(active.type);
    const rawHits = [];
    if (skillId && !damagingSkill) return { hitInfo:[], ignoreShield:false };
    if (damagingSkill && Number(active.multiplier) === 0 && !(Number(active.hits) > 1)) {
      return { hitInfo:[], ignoreShield:active.ignoreShield === true };
    }
    if (damagingSkill) {
      const count = Math.max(1, Number(active.hits) || 1);
      const multiplier = count > 1 ? Number(active.hitMult) || 1 : Number(active.multiplier) || 1;
      for (let i = 0; i < count; i += 1) rawHits.push(getPlayerAttackPower() * multiplier);
      setSkillCooldown(skillId, active.cooldown || 3);
    } else {
      rawHits.push(getPlayerAttackPower());
    }
    const specMult = specDamageMultV25();
    return {
      hitInfo:rawHits.map((raw) => ({
        dmg:YuksamGameplayPolishV2.wrongHitDamage(Math.max(1, Math.ceil(raw * specMult))),
        crit:false,
        missed:false,
        label:active?.name || '',
      })),
      ignoreShield:active?.ignoreShield === true,
    };
  }

  function resolveWrongAnswerV2(monster) {
    const correctAnswer = game.currentQuestion?.answer ?? '';
    const result = calculateWrongActionDamageV2();
    const wrongHits = result.hitInfo;
    const wrongSkillId = String(game.currentCombatAction || '').startsWith('active:')
      ? String(game.currentCombatAction).slice(7)
      : null;
    const wrongActionAudioId = wrongSkillId
      ? window.YuksamAudioManifest?.skillSounds?.[wrongSkillId]
        || window.YuksamAudioManifest?.classBasicSounds?.[game.player?.class]
      : window.YuksamAudioManifest?.classBasicSounds?.[game.player?.class];
    const effectBatchId = `${monster.id}:wrong:${game.combatEffectSerial = (Number(game.combatEffectSerial) || 0) + 1}`;
    const events = [
      {
        type:'answer-wrong',
        text:`오답입니다! 정답은 ${correctAnswer} (오답이라 데미지가 절반만 들어갑니다)`,
        tone:'correct-answer',
        duration:2200,
        preserveDuration:true,
      },
    ];
    wrongHits.forEach((hit, index) => {
      events.push({
        type:index === 0 ? 'player-hit' : 'player-extra-hit',
        text:`오답 공격으로 ${hit.dmg}의 피해를 주었습니다.`,
        duration:PLAYER_ATTACK_NOTICE_DELAY_V46,
        ...(index === 0 && wrongActionAudioId
          ? { audioId:wrongActionAudioId, fallbackSfx:'hit' }
          : {}),
        effect:{
          id:`${effectBatchId}:${index}`,
          type:'monster-damage',
          combatId:monster.id,
          amount:hit.dmg,
          ...(result.ignoreShield === true ? { ignoreShield:true } : {}),
        },
      });
    });
    queueCombatSequence(events, () => {
      const fresh = currentCombatMonster();
      if (!fresh || !fresh.alive || fresh.dying) return;
      if (fresh.hp <= 0) startMonsterDefeatSequenceV25(fresh, '');
      else monsterCounterAttack('');
    });
  }

  // [연출 리팩터] 플레이어 행동 후처리: 부가효과 → 처치 판정 → 반격 예약
  // (단일 타격/다단히트 순차 연출이 공유)
  // [패턴] 몬스터 보호막을 먼저 소모하는 피해 적용 헬퍼
  function applyDamageToMonsterV40(monster, dmg, { ignoreShield = false } = {}) {
    let remain = Math.max(0, Math.floor(dmg));
    if (!ignoreShield && monster.shield > 0 && remain > 0) {
      const b = Math.min(monster.shield, remain);
      monster.shield -= b; remain -= b;
    }
    monster.hp = Math.max(0, monster.hp - remain);
    return remain;
  }
  window.applyDamageToMonsterV40 = applyDamageToMonsterV40;

  function finishPlayerActionV39(monster, result, activeSkill, act, skill, actionMsg, playerEvents = [], effectBatchId = '') {
    const damage = result.damage;
    const hitInfo = Array.isArray(result.hitInfo) ? result.hitInfo : [];
    const landedAction = hitInfo.some((hit) => !hit.missed);
    const statusEvents = [];
    const supportEvents = (result.supportEffects || []).map((entry, index) => ({
      type:entry.phase === 'before' ? 'player-support-before' : 'player-support',
      text:entry.text,
      duration:entry.duration == null ? COMBAT_CUSTOM_NOTICE_DELAY_V43 : entry.duration,
      effect:{
        id:`${effectBatchId}:support:${index}`,
        type:'player-support',
        combatId:monster.id,
        kind:entry.kind,
        amount:entry.amount,
        turns:entry.turns,
        pct:entry.pct,
      },
      ...(entry.phase === 'before' && entry.kind === 'shield' && activeSkill ? {
        fx:YuksamCombatFx.getPlayerSupportFxProfile(activeSkill.id, activeSkill, entry.kind),
        audioId:'defensiveStance',
      } : index === 0 && !damage && activeSkill ? {
        fx:{ ...YuksamCombatFx.getSkillFxProfile(activeSkill.id, activeSkill), source:'player', hitStage:'primary' },
        audioId:window.YuksamAudioManifest?.skillSounds?.[activeSkill.id],
        ...(activeSkill.kind === 'ultimate' ? { ultimateId:activeSkill.id } : {}),
      } : {}),
    }));
    let statusIndex = 0;
    const addMonsterStatusEvent = (text, metadata) => {
      statusEvents.push({
        type:'enemy-status',
        text,
        ...(metadata?.status === 'shadow' && metadata.mode === 'add' ? { audioId:'shadowStackGain' } : {}),
        ...(metadata?.status === 'stun' ? { audioId:'stunned' } : {}),
        effect:{
          id:`${effectBatchId}:status:${statusIndex++}`,
          type:'monster-status',
          combatId:monster.id,
          ...metadata,
        },
      });
    };

    // === 스킬 부가 효과 (피해 0이어도 적용: 암흑 낙인 등) ===
    if (activeSkill && landedAction) {
      if (act.type === 'shadowDot') {
        const stacks = Math.max(1, Number(act.stacks) || 1);
        addMonsterStatusEvent(`🌑 암흑 중첩 ${(monster.shadowStacks || 0) + stacks}회.`, {
          status:'shadow', stacks, mode:'add',
        });
      }
      if (act.stun) {
        addMonsterStatusEvent(`💫 기절 ${act.stun}턴!`, { status:'stun', turns:act.stun, mode:'max' });
      }
      const chillTurns = Math.max(Number(act.chillTurns) || 0, Number(act.weakenTurns) || 0);
      if (chillTurns > 0) {
        addMonsterStatusEvent(`❄️ 냉기 ${chillTurns}턴! 다음 공격 데미지가 50% 감소합니다.`, {
          status:'chill', turns:chillTurns, mode:'max',
        });
      }
      // 냉기 집중: 공격 주문 적중 시 기절 확률
      if (damage > 0 && ['damage', 'shadowDot', 'damageHeal'].includes(act.type)) {
        const stunRank = getSkillRank('mage_frost_focus_v24');
        if (stunRank > 0 && Math.random() < ((SKILL_DEFS.mage_frost_focus_v24?.activeStunChance || [])[stunRank] || 0)) {
          addMonsterStatusEvent('상대는 강력한 냉기에 의해 얼어붙어 기절했다!', { status:'stun', turns:1, mode:'max' });
        }
      }
    }

    if (damage > 0) {
      buildSpecOnHitEffectsV25(monster, damage, skill).forEach((notice) => {
        if (notice.status) {
          addMonsterStatusEvent(notice.text, {
            status:notice.status,
            turns:notice.turns,
            stacks:notice.stacks,
            mode:notice.mode,
            maxStacks:notice.maxStacks,
          });
        } else if (notice.text) {
          statusEvents.push({ type:'enemy-status', text:notice.text });
        }
      });
    }

    playerEvents.push(...supportEvents, ...statusEvents);
    updateHud?.();

    const finalizeTurn = () => {
      if (monster.hp <= 0) {
        startMonsterDefeatSequenceV25(monster, '');
        return;
      }
      game.currentQuestion = null;
      game.currentCombatAction = null;
      monsterCounterAttack('');
    };
    const resolveAfterHits = () => {
      const resolutionEvents = combatResolutionEventsV42.get(effectBatchId) || [];
      combatResolutionEventsV42.delete(effectBatchId);
      if (damage > 0 && hitInfo.filter((hit) => hit.dmg > 0).length > 1) resolutionEvents.push({ type:'player-total', text:`총 ${damage}의 피해를 주었다!` });
      if (resolutionEvents.length) queueCombatSequence(resolutionEvents, finalizeTurn);
      else finalizeTurn();
    };
    queueCombatSequence(playerEvents, resolveAfterHits);
  };

  window.submitObjectiveAnswer = function submitObjectiveAnswerV25(choice) {
    const prev = $('combatAnswer'); if (prev) prev.remove();
    const hidden = document.createElement('input');
    hidden.id = 'combatAnswer'; hidden.value = choice; hidden.className = 'hidden';
    $('modalContent')?.appendChild(hidden);
    window.submitCombatAnswer();
  };

  try { updateHud(); } catch {}
  appendChatMessage?.('system', '패치', 'v25: 월드맵 키보드 선택, 치명타 효과음, 스킬창 축소, 테스트 회복/쿨타임 버튼, 전투 안내 시간, 리젠 상태 초기화, 암흑 DOT 순서가 적용되었습니다.');
})();

/* =========================
   v26 patch: v21-style compact vertical skill tree, combat clarity, final-boss NPC flow, inventory tooltips
   ========================= */
(function yuksamV26Patch(){
  if (window.__YUKSAM_V26_PATCH__) return;
  window.__YUKSAM_V26_PATCH__ = true;

  function normalizeSpecV26(spec) { return spec === '분노' ? '무기' : (spec || null); }
  function currentSpecV26() { return normalizeSpecV26(game.player?.spec); }
  function classNameV26(klass) { return CLASS_META?.[klass]?.name || klass || '직업'; }
  function skillIconV26(skill) {
    return skill?.icon || (skill?.kind === 'ultimate' ? '✦' : skill?.kind === 'guard' ? '🛡' : skill?.kind === 'frost' ? '❄' : skill?.kind === 'fire' ? '🔥' : skill?.kind === 'holy' ? '✚' : skill?.kind === 'shadow' ? '☾' : '◆');
  }
  function skillToneV26(skill) {
    const spec = normalizeSpecV26(skill?.specOnly);
    if (spec === '방어') return 'defense';
    if (spec === '무기') return 'weapon';
    if (spec === '냉기') return 'frost';
    if (spec === '화염') return 'fire';
    if (spec === '신성') return 'holy';
    if (spec === '암흑') return 'shadow';
    return 'common';
  }
  function skillLabelV26(skill) { return skill?.specOnly ? `${skill.specOnly} 전용` : '직업 공용'; }
  function skillShortEffectV26(skill) {
    if (!skill) return '';
    if (skill.active) return `액티브 · 쿨타임 ${skill.active.cooldown || 0}턴`;
    return skill.passiveText || Object.entries(skill.bonuses || {}).map(([k,v]) => `${k} +${v}`).join(' · ') || '패시브';
  }
  function skillBlockReasonV26(skill) {
    if (!game.player || !skill) return '스킬 정보를 확인할 수 없습니다.';
    if (!getQuestState('tut_skill')) return '아직 명진쌤의 가르침을 받지 못했습니다!';
    if (skill.classOnly && skill.classOnly !== game.player.class) return '이 직업의 능력이 아닙니다.';
    if (getSkillRank(skill.id) >= 1) return '이미 배운 능력입니다.';
    if (skill.specOnly && currentSpecV26() !== normalizeSpecV26(skill.specOnly)) return game.player.spec ? '이 능력은 배울 수 없습니다.(전문화 확인)' : 'Lv.5에서 전문화를 선택해야 배울 수 있습니다.';
    const prereq = skill.prereq || [];
    if (prereq.length && !prereq.every(isSkillLearned)) return '선행 능력을 먼저 배워야 합니다.';
    if ((game.player.skillPoints || 0) < (skill.cost || 1)) return '스킬 포인트가 부족합니다.';
    return '';
  }
  function v26ClassSkills(classKey) {
    return Object.values(SKILL_DEFS)
      .filter((s) => s && s.v24 && s.classOnly === classKey)
      .sort((a,b) => (a.line || 0) - (b.line || 0) || String(a.specOnly || '').localeCompare(String(b.specOnly || ''), 'ko') || String(a.name || '').localeCompare(String(b.name || ''), 'ko'));
  }
  function v26LineStatus(skill) {
    const learned = getSkillRank(skill.id) > 0;
    const learnable = canLearnSkill(skill);
    const specMismatch = skill.specOnly && currentSpecV26() !== normalizeSpecV26(skill.specOnly);
    return { learned, learnable, specMismatch, reason: skillBlockReasonV26(skill) };
  }

  const skillBtnV26 = $('openSkillTreeBtn');
  if (skillBtnV26) skillBtnV26.onclick = () => openSkillTreeModal();

  // 전투창 배경을 현재 맵 분위기에 맞게 보정한다.
  combatFramePipeline.register({
    id:'combat-frame-v26',
    priority:260,
    after:() => {
      const stage = $('modalContent')?.querySelector('.combat-stage');
      if (stage) {
        stage.classList.add('combat-bg-v26', `combat-bg-${game.currentMap || 'town'}-v26`);
        const monster = currentCombatMonster?.();
        if (monster?.type === 'teacherBoss') stage.classList.add('combat-bg-teacher-v26');
      }
    },
  });

  // 모든 선택지형 모달에서 방향키로 선택하고 E/Enter로 실행한다.
  function modalChoiceButtonsV26() {
    const modal = $('modalContent');
    if (!modal || modal.classList.contains('hidden')) return [];
    if (document.activeElement && ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) return [];
    if (game.modalState?.type === 'skill' || game.modalState?.type === 'character' || game.modalState?.type === 'settings') return [];
    return Array.from(modal.querySelectorAll('.dialogue-options button, .action-row button, .choice-list button, .choice-grid button, .combat-choice-grid button, .worldmap-v25 button, .worldmap-v20 button'))
      .filter((btn) => !btn.disabled && btn.offsetParent !== null);
  }
  function setChoiceIndexV26(buttons, index) {
    if (!buttons.length) return;
    const len = buttons.length;
    const next = ((index % len) + len) % len;
    buttons.forEach((btn, i) => btn.classList.toggle('keyboard-selected-v26', i === next));
    buttons[next].focus({ preventScroll: true });
    $('modalContent').dataset.choiceIndexV26 = String(next);
  }
  function moveChoiceGridV62(buttons, index, key) {
    const current = buttons[index];
    const grid = current?.closest?.('.choice-grid, .combat-choice-grid');
    if (!grid) return null;
    const gridButtons = Array.from(grid.querySelectorAll('button')).filter((button) => !button.disabled);
    const gridIndex = gridButtons.indexOf(current);
    if (gridIndex < 0) return null;
    const columns = 2;
    const row = Math.floor(gridIndex / columns);
    const column = gridIndex % columns;
    const rows = Math.ceil(gridButtons.length / columns);
    let targetRow = row;
    let targetColumn = column;
    if (key === 'arrowup' || key === 'w') targetRow = Math.max(0, row - 1);
    else if (key === 'arrowdown' || key === 's') targetRow = Math.min(rows - 1, row + 1);
    else if (key === 'arrowleft' || key === 'a') targetColumn = Math.max(0, column - 1);
    else if (key === 'arrowright' || key === 'd') targetColumn = Math.min(columns - 1, column + 1);
    let targetGridIndex = targetRow * columns + targetColumn;
    if (targetGridIndex >= gridButtons.length) targetGridIndex = gridButtons.length - 1;
    return buttons.indexOf(gridButtons[targetGridIndex]);
  }
  YuksamInputRouter.register({ id:'v26-modal-choices', type:'keydown', priority:70, handle:(e) => {
    const k = e.key?.toLowerCase();
    const buttons = modalChoiceButtonsV26();
    if (!buttons.length) return;
    let idx = Number($('modalContent')?.dataset.choiceIndexV26 || buttons.findIndex((b) => b.classList.contains('selected')) || 0);
    if (!Number.isFinite(idx) || idx < 0) idx = 0;
    if (['arrowleft','arrowup','a','w','arrowright','arrowdown','d','s'].includes(k)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const gridIndex = moveChoiceGridV62(buttons, idx, k);
      const fallbackStep = ['arrowleft','arrowup','a','w'].includes(k) ? -1 : 1;
      setChoiceIndexV26(buttons, gridIndex === null || gridIndex < 0 ? idx + fallbackStep : gridIndex);
    }
    else if (k === 'e' || k === 'enter') { e.preventDefault(); e.stopImmediatePropagation(); setChoiceIndexV26(buttons, idx); buttons[Math.max(0, Math.min(buttons.length - 1, idx))].click(); }
    return ['arrowleft','arrowup','a','w','arrowright','arrowdown','d','s','e','enter'].includes(k);
  }});
  const oldOpenModalV26 = openModal;
  openModal = function openModalV26(html, state) {
    oldOpenModalV26(html, state);
    setTimeout(() => {
      const buttons = modalChoiceButtonsV26();
      if (buttons.length) {
        const preferred = buttons.findIndex((button) => button.dataset.defaultAction === 'true');
        setChoiceIndexV26(buttons, preferred >= 0 ? preferred : 0);
      }
    }, 30);
  };

  // 최종 보스방: 명진쌤을 자동 전투 몬스터가 아니라 대화형 최종 보스 NPC로 표시한다.
  function ensureFinalTeacherBossV26() {
    if (!Array.isArray(game.forestMonsters)) game.forestMonsters = [];
    let boss = game.forestMonsters.find((m) => m.type === 'teacherBoss');
    if (!boss) {
      boss = monsterBase({ id:'teacher_final_'+uid(), type:'teacherBoss', name:'명진쌤', level:99, hp:9999, attack:10, x:820, y:420, r:50, exp:0, gold:0, speed:0, aggro:0 });
      game.forestMonsters.push(boss);
    }
    Object.assign(boss, { name:'명진쌤', level:99, maxHp:9999, hp: Math.min(9999, Math.max(1, boss.hp || 9999)), attack:10, elite:true, noEscape:true, chasing:false, speed:0, aggro:0, alive: boss.alive !== false });
    return boss;
  }
  const oldUpdateForestMonstersV26 = updateForestMonsters;
  updateForestMonsters = function updateForestMonstersV26(dt) {
    if (game.currentMap === 'finalBossRoom') { ensureFinalTeacherBossV26(); return; }
    return oldUpdateForestMonstersV26(dt);
  };
  const oldGetNearbyMonsterV26 = getNearbyMonster;
  getNearbyMonster = function getNearbyMonsterV26(range = 42) {
    if (game.currentMap === 'finalBossRoom') return null;
    return oldGetNearbyMonsterV26(range);
  };

  window.startFinalTeacherBattleV26 = function startFinalTeacherBattleV26() {
    const boss = ensureFinalTeacherBossV26();
    closeModal();
    setTimeout(() => openCombat(boss), 80);
  };
  function drawFinalTeacherBubbleV26(ctx, x, y) {
    const arr = ['여기까지 왔구나.', '성장은 언제나 시련 뒤에 찾아온단다.', '나를 뛰어넘어 보거라.'];
    const cycle = 12000, now = Date.now(), phase = now % cycle;
    if (phase > 5600) return;
    const text = arr[Math.floor(now / cycle) % arr.length];
    ctx.save(); ctx.textAlign='center'; ctx.font='900 13px Jua, Noto Sans KR, system-ui';
    const w = Math.min(260, ctx.measureText(text).width + 36);
    const bx = x - w/2, by = y - 118;
    ctx.globalAlpha = Math.min(1, phase/500) * Math.min(1, (5600-phase)/500);
    ctx.fillStyle = 'rgba(20,8,32,.92)'; ctx.strokeStyle='rgba(216,180,254,.60)'; ctx.lineWidth=1.5;
    roundRect(ctx, bx, by, w, 34, 14); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#f5e8ff'; ctx.fillText(text, x, by + 22); ctx.restore();
  }

  // 인벤토리/상태창: 평소에는 아이콘+이름 위주, 상세 설명은 마우스오버 title로 제공한다. 상태 기본 정보도 보강한다.
  function itemTooltipV26(item) {
    if (!item) return '';
    const stats = Object.entries(item.stats || {}).map(([k,v]) => `${k} +${v}`).join(', ');
    return [item.name, slotLabel(item.slot), item.classOnly ? `${classNameV26(item.classOnly)} 전용` : '공용', item.levelReq ? `Lv.${item.levelReq} 이상` : '', stats, item.desc].filter(Boolean).join('\n');
  }

  // 아이콘/인게임 지팡이 색상 보정.
  const oldItemIconV26 = itemIcon;
  itemIcon = function itemIconV26(item) {
    if (!item) return oldItemIconV26(item);
    const custom = {
      training_greatsword: '<span class="item-icon-wood-v26">🗡</span>',
      bronzeGreatsword: '<span class="item-icon-wood-v26">🗡</span>',
      training_staff: '<span class="item-icon-staff-basic-v26">🪄</span>',
      crystalStaff: '<span class="item-icon-staff-crystal-v26">🪄</span>',
      oakStaff: '<span class="item-icon-staff-oak-v26">🪄</span>',
      ironwoodStaff: '<span class="item-icon-staff-ironwood-v26">🪄</span>',
      mithrilStaff: '<span class="item-icon-staff-mithril-v26">🪄</span>'
    }[item.id];
    if (custom) return custom;
    return oldItemIconV26(item);
  };
  const oldDrawWeaponV26 = drawWeapon;
  drawWeapon = function drawWeaponV26(ctx, klass, scale, swing, isNpc, itemId = null, spec = null) {
    if (klass !== 'mage') return oldDrawWeaponV26(ctx, klass, scale, swing, isNpc, itemId, spec);
    ctx.save();
    const item = itemId ? getItemDefinition(itemId, klass) : null;
    const variant = item?.id || '';
    const palette = {
      training_staff: ['#8b5cf6','#dbeafe'],
      crystalStaff: ['#38bdf8','#e0f2fe'],
      oakStaff: ['#8b5a2b','#bbf7d0'],
      ironwoodStaff: ['#334155','#fde68a'],
      mithrilStaff: ['#60a5fa','#c4b5fd']
    }[variant] || ['#8b5cf6','#dbeafe'];
    ctx.translate(14 * scale + swing * 6 * scale, 7 * scale);
    ctx.rotate(.15 + swing * .3);
    ctx.fillStyle = palette[0]; roundRect(ctx, -2.2 * scale, -18 * scale, 4.4 * scale, 32 * scale, 2 * scale); ctx.fill();
    ctx.fillStyle = palette[1]; ctx.beginPath(); ctx.arc(0, -23 * scale, 6.5 * scale, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.72)'; ctx.lineWidth = 1.6 * scale; ctx.stroke();
    ctx.restore();
  };

  try { updateHud?.(); } catch {}
  appendChatMessage?.('system', '패치', 'v26: 세로형 스킬창 재설계, 전투 배경/안내 정리, 최종 보스 NPC 대화, 인벤토리 툴팁, 장비 아이콘 보정이 적용되었습니다.');
})();


/* =========================
   v27 patch: battle layout rollback / pet shop / weapon enhancement / clearer status panel
   ========================= */
(function yuksamV27Patch(){
  if (window.__YUKSAM_V27_PATCH__) return;
  window.__YUKSAM_V27_PATCH__ = true;

  // 1) v26에서 전투 배경 보정 과정으로 붙은 전투 배경 클래스를 제거하여
  //    전투 화면의 원래 배치와 레이아웃을 되돌린다. 메시지 하이라이트/시간 조정은 유지한다.
  combatFramePipeline.register({
    id:'combat-frame-v27',
    priority:270,
    after:() => {
      const stage = $('modalContent')?.querySelector('.combat-stage');
      if (stage) {
        Array.from(stage.classList).forEach((cls) => {
          if (cls.startsWith('combat-bg-') || cls === 'combat-bg-v26') stage.classList.remove(cls);
        });
        stage.classList.add('combat-layout-rollback-v27');
      }
    },
  });

  // 2) 신규 마을 건물: 펫 상점 / 강화 상점
  Object.assign(worldDefs.town, WORLD_PATCHES_V27.town);
  worldDefs.petShopInterior = WORLD_PATCHES_V27.maps.petShopInterior;
  worldDefs.upgradeShopInterior = WORLD_PATCHES_V27.maps.upgradeShopInterior;

  window.PET_DEFS_V27 = PET_DEFS_V27;

  window.TIER_INFO_V27 = TIER_INFO_V27;

  function ensurePlayerV27Fields() {
    if (!game.player) return;
    if (!Array.isArray(game.player.pets)) game.player.pets = [];
    if (!game.player.activePet || !PET_DEFS_V27[game.player.activePet]) game.player.activePet = null;
    if (!game.player.weaponUpgrades || typeof game.player.weaponUpgrades !== 'object') game.player.weaponUpgrades = {};
    if (!game.player.equipment) game.player.equipment = {};
    if (!game.player.equipment.weapon) game.player.equipment.weapon = defaultWeaponIdForClass(game.player.class);
  }
  window.ensurePlayerV27Fields = ensurePlayerV27Fields;

  function petStatsTextV27(pet) {
    if (!pet?.stats) return '스탯 없음';
    return Object.entries(pet.stats).map(([k,v]) => `${k} +${v}`).join(' · ');
  }
  function getWeaponTierV27(itemId) {
    ensurePlayerV27Fields();
    return Math.max(0, Math.min(4, Number(game.player?.weaponUpgrades?.[itemId] || 0)));
  }
  function tierLabelV27(tier) { return TIER_INFO_V27[tier]?.name || '일반'; }
  function tierClassV27(tier) { return TIER_INFO_V27[tier]?.cls || 'tier-0'; }
  function enhancedStatsTextV27(item) {
    if (!item?.stats) return '';
    const tier = item.slot === 'weapon' ? getWeaponTierV27(item.id) : 0;
    return Object.entries(item.stats).map(([k,v]) => {
      const bonus = item.slot === 'weapon' && tier > 0 ? Math.max(1, Math.ceil(Number(v || 0) * tier * .45)) : 0;
      return `${k} +${Number(v || 0) + bonus}${bonus ? ` (강화 +${bonus})` : ''}`;
    }).join(', ');
  }
  function displayItemNameV27(item) {
    if (!item) return '';
    if (item.slot !== 'weapon') return item.name;
    const tier = getWeaponTierV27(item.id);
    return tier > 0 ? `[${tierLabelV27(tier)}] ${item.name}` : item.name;
  }
  function itemTooltipV27(item) {
    if (!item) return '';
    const tier = item.slot === 'weapon' ? `강화 등급: ${tierLabelV27(getWeaponTierV27(item.id))}` : '';
    return [displayItemNameV27(item), slotLabel(item.slot), tier, item.classOnly ? `${CLASS_META[item.classOnly]?.name || item.classOnly} 전용` : '공용', item.levelReq ? `Lv.${item.levelReq} 이상` : '', enhancedStatsTextV27(item), item.desc].filter(Boolean).join('\n');
  }

  // 3) 펫과 무기 강화 능력치가 실제 총 스탯에 반영되도록 보정
  totalStatsPipeline.register({
    id:'stats-pet-enhancement-v27',
    priority:270,
    prepare:() => ensurePlayerV27Fields(),
    apply:(total) => {
      const activePet = PET_DEFS_V27[game.player?.activePet];
      if (activePet?.stats) {
        Object.entries(activePet.stats).forEach(([k,v]) => { total[k] = (total[k] || 0) + Number(v || 0); });
      }
      const weaponId = game.player?.equipment?.weapon;
      const item = weaponId ? getItemDefinition(weaponId, game.player.class) : null;
      const tier = item?.slot === 'weapon' ? getWeaponTierV27(item.id) : 0;
      if (item?.stats && tier > 0) {
        Object.entries(item.stats).forEach(([k,v]) => {
          const extra = Math.max(1, Math.ceil(Number(v || 0) * tier * .45));
          total[k] = (total[k] || 0) + extra;
        });
      }
    },
  });

  // 4) 건물 내부 그래픽
  function drawPetShopInteriorV27() {
    const ctx = game.ctx, world = worldDefs.petShopInterior;
    ctx.clearRect(0,0,game.width,game.height);
    const g = ctx.createLinearGradient(0,0,0,game.height);
    g.addColorStop(0,'#49325f'); g.addColorStop(.48,'#2f2449'); g.addColorStop(1,'#141827');
    ctx.fillStyle = g; ctx.fillRect(0,0,game.width,game.height);
    drawTerrainDots(ctx, world, '#ffffff', .05, 58, 12);
    const orb = worldToScreen(world.orb.x, world.orb.y);
    drawCrystalPedestalWorld(world.orb.x, world.orb.y, '#f9a8d4');
    ctx.save();
    const t = performance.now()/520;
    const halo = ctx.createRadialGradient(orb.x, orb.y-34, 5, orb.x, orb.y-34, 82);
    halo.addColorStop(0,'rgba(251,207,232,.70)'); halo.addColorStop(.55,'rgba(217,70,239,.22)'); halo.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(orb.x, orb.y-34, 82, 0, Math.PI*2); ctx.fill();
    ctx.font = '900 34px Noto Sans KR, system-ui'; ctx.textAlign='center';
    ['🐤','🍄','🐉','🐱','🐶'].forEach((ic,i)=>{ const a=t+i*1.25; ctx.fillText(ic, orb.x + Math.cos(a)*70, orb.y-46 + Math.sin(a)*24); });
    ctx.restore();
    const ex = worldToScreen(world.exit.x, world.exit.y); drawExitMarker(ex.x, ex.y); drawTitleLabel('펫 상점');
  }
  function drawUpgradeShopInteriorV27() {
    const ctx = game.ctx, world = worldDefs.upgradeShopInterior;
    ctx.clearRect(0,0,game.width,game.height);
    const g = ctx.createLinearGradient(0,0,0,game.height);
    g.addColorStop(0,'#4a2a18'); g.addColorStop(.48,'#2f2018'); g.addColorStop(1,'#111827');
    ctx.fillStyle = g; ctx.fillRect(0,0,game.width,game.height);
    drawTerrainDots(ctx, world, '#fbbf24', .055, 64, 10);
    const p = worldToScreen(world.blacksmith.x, world.blacksmith.y);
    drawShopCounter(world.blacksmith.x, world.blacksmith.y + 75, '강화 대장간', '#f97316');
    drawNpcSprite(ctx, p.x, p.y, '도담', false, NPC_WORLD_SCALE, isNearPoint(world.blacksmith, 90), 'warrior');
    ctx.save();
    ctx.globalAlpha = .55 + Math.sin(performance.now()/170)*.18;
    ctx.fillStyle = 'rgba(245,158,11,.45)'; ctx.beginPath(); ctx.ellipse(p.x, p.y+78, 82, 18, 0, 0, Math.PI*2); ctx.fill();
    ctx.font = '900 26px Noto Sans KR, system-ui'; ctx.textAlign='center'; ctx.fillStyle='#fde68a'; ctx.fillText('✦ 강화 ✦', p.x, p.y - 84);
    ctx.restore();
    const ex = worldToScreen(world.exit.x, world.exit.y); drawExitMarker(ex.x, ex.y); drawTitleLabel('강화 상점');
  }
  window.drawPetShopInteriorV27 = drawPetShopInteriorV27;
  window.drawUpgradeShopInteriorV27 = drawUpgradeShopInteriorV27;

  const oldDrawTownV27 = drawTown;
  drawTown = function drawTownV27() {
    oldDrawTownV27();
    const town = worldDefs.town;
    drawFancyBuildingWorld(town.petShop.x, town.petShop.y, town.petShop.w, town.petShop.h, '#f0abfc', town.petShop.name, 'pet');
    drawFancyBuildingWorld(town.upgradeShop.x, town.upgradeShop.y, town.upgradeShop.w, town.upgradeShop.h, '#fb923c', town.upgradeShop.name, 'anvil');
    drawEntranceGlowWorld(town.petShop.doorX, town.petShop.doorY, '#f9a8d4');
    drawEntranceGlowWorld(town.upgradeShop.doorX, town.upgradeShop.doorY, '#f97316');
  };

  // 건물 아이콘 확장
  const oldDrawFancyBuildingV27 = drawFancyBuilding;
  drawFancyBuilding = function drawFancyBuildingV27(ctx, x, y, w, h, roofColor, label, icon = 'none') {
    oldDrawFancyBuildingV27(ctx, x, y, w, h, roofColor, label, icon);
    if (icon !== 'pet' && icon !== 'anvil') return;
    ctx.save(); ctx.translate(x,y); ctx.textAlign='center'; ctx.font='900 27px Noto Sans KR, system-ui';
    ctx.fillStyle = icon === 'pet' ? '#fff7ed' : '#ffedd5';
    ctx.fillText(icon === 'pet' ? '🐾' : '⚒', 0, -h * .18);
    ctx.restore();
  };


  // 5) 펫 팔로워 그래픽
  function drawPetFollowerV27(ctx) {
    if (!game.player) return;
    ensurePlayerV27Fields();
    const pet = PET_DEFS_V27[game.player.activePet];
    if (!pet) return;
    const now = performance.now();
    const dir = game.lastMove || { x: 1, y: 0 };
    const moving = !!game.isMoving;
    const dancing = (game.danceTimer || 0) > 0;
    const backX = Math.abs(dir.x) > 0.1 ? -Math.sign(dir.x) * 62 : -52;
    const backY = Math.abs(dir.y) > 0.1 ? -Math.sign(dir.y) * 42 : 42;
    const hop = moving ? Math.abs(Math.sin(now / 115 + pet.bob)) * 12 : Math.sin(now / 330 + pet.bob) * 3;
    const danceX = dancing ? Math.sin(now / 80 + pet.bob) * 18 : 0;
    const danceRot = dancing ? Math.sin(now / 95 + pet.bob) * 0.32 : Math.sin(now / 420 + pet.bob) * 0.04;
    const wx = game.player.x + backX + danceX;
    const wy = game.player.y + backY - hop;
    const p = worldToScreen(wx, wy);
    ctx.save();
    drawShadow(ctx, p.x, p.y + 25, 20, 6, .20);
    ctx.translate(p.x, p.y);
    ctx.rotate(danceRot);
    const scale = dancing ? (1.02 + Math.sin(now / 70) * .08) : (1 + Math.sin(now / 520 + pet.bob) * .03);
    ctx.scale(scale, scale);
    // 원형 캡슐 제거: 펫 자체가 캐릭터 뒤를 졸졸 따라오는 느낌으로 표시한다.
    ctx.font = '900 34px Noto Sans KR, Apple Color Emoji, Segoe UI Emoji, system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(15,23,42,.55)';
    ctx.strokeText(pet.icon, 0, 0);
    ctx.fillText(pet.icon, 0, 0);
    if (moving) {
      ctx.fillStyle = pet.color || '#fde68a';
      ctx.globalAlpha = .75;
      ctx.beginPath(); ctx.ellipse(-9, 22, 5, 3, 0, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(9, 22, 5, 3, 0, 0, Math.PI*2); ctx.fill();
    }
    if (dancing) {
      ctx.globalAlpha = .9;
      ctx.font = '900 15px Jua, Noto Sans KR, system-ui';
      ctx.fillStyle = pet.color || '#fde68a';
      ctx.fillText('♪', -27, -25 + Math.sin(now/90) * 4);
      ctx.fillText('♬', 27, -31 + Math.cos(now/100) * 4);
    }
    ctx.restore();
    ctx.save();
    ctx.font = '900 10px Jua, Noto Sans KR, system-ui';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillStyle = 'rgba(15,23,42,.72)';
    roundRect(ctx, p.x - 32, p.y - 43, 64, 17, 999); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(pet.name, p.x, p.y - 34);
    ctx.restore();
  }
  window.drawPetFollowerV27 = drawPetFollowerV27;

  // 6) 상호작용/자동 이동
  function enterPetShopInteriorV27() {
    if (game.transitionLock && Date.now() < game.transitionLock) return;
    game.transitionLock = Date.now() + 700;
    playSfx('door'); closeModal();
    game.currentMap = 'petShopInterior'; game.player.map = 'petShopInterior';
    game.player.x = worldDefs.petShopInterior.playerSpawn.x; game.player.y = worldDefs.petShopInterior.playerSpawn.y;
    $('returnTownBtn')?.classList.remove('hidden'); updateHud(); savePlayer();
    appendChatMessage('system','이동','펫 상점 내부로 들어왔습니다.');
  }
  function enterUpgradeShopInteriorV27() {
    if (game.transitionLock && Date.now() < game.transitionLock) return;
    game.transitionLock = Date.now() + 700;
    playSfx('door'); closeModal();
    game.currentMap = 'upgradeShopInterior'; game.player.map = 'upgradeShopInterior';
    game.player.x = worldDefs.upgradeShopInterior.playerSpawn.x; game.player.y = worldDefs.upgradeShopInterior.playerSpawn.y;
    $('returnTownBtn')?.classList.remove('hidden'); updateHud(); savePlayer();
    appendChatMessage('system','이동','강화 상점 내부로 들어왔습니다.');
  }
  function exitBuildingToTownV27(kind) {
    if (game.transitionLock && Date.now() < game.transitionLock) return;
    game.transitionLock = Date.now() + 700;
    playSfx('door'); closeModal();
    game.currentMap = 'town'; game.player.map = 'town';
    const town = worldDefs.town;
    const door = kind === 'pet' ? town.petShop : (kind === 'upgrade' ? town.upgradeShop : town.shop);
    game.player.x = door.doorX;
    game.player.y = door.doorY + 115;
    game.lastMove = {x:0,y:1};
    $('returnTownBtn')?.classList.add('hidden'); updateHud(); savePlayer();
    appendChatMessage('system','이동',`${door.name} 밖으로 나왔습니다.`);
  }
  window.enterPetShopInteriorV27 = enterPetShopInteriorV27;
  window.enterUpgradeShopInteriorV27 = enterUpgradeShopInteriorV27;
  window.exitBuildingToTownV27 = exitBuildingToTownV27;


  const oldStartGameV27 = startGame;
  startGame = function startGameV27(existing = false, options = {}) {
    oldStartGameV27(existing, options);
    ensurePlayerV27Fields();
    if (['petShopInterior','upgradeShopInterior'].includes(game.currentMap)) $('returnTownBtn')?.classList.remove('hidden');
  };

  // 7) 펫 상점
  function openPetShopModalV27() {
    ensurePlayerV27Fields();
    const pets = Object.values(PET_DEFS_V27).map((pet) => {
      const owned = game.player.pets.includes(pet.id);
      const active = game.player.activePet === pet.id;
      return `<div class="pet-card-v27 ${owned ? 'owned' : ''} ${active ? 'active' : ''}">
        <div class="pet-face-v27" style="--pet-color:${pet.color}">${pet.icon}</div>
        <div><h3>${pet.name}</h3><p>${pet.desc}</p><small>${petStatsTextV27(pet)}</small></div>
        ${owned ? `<button class="${active ? 'ghost' : 'primary'} small" ${active ? 'disabled' : ''} onclick="equipPetV27('${pet.id}')">${active ? '동행 중' : '동행'}</button>` : '<span class="badge">미보유</span>'}
      </div>`;
    }).join('');
    openModal(`<h2>펫 수정구</h2>
      <div class="panel-card pet-shop-hero-v27"><div><b>랜덤 펫 소환</b><p>10빌딩을 내면 삐약이, 미니버섯돌이, 용용이, 냥냥이, 멍멍이 중 하나를 얻습니다.</p></div><button class="primary" onclick="rollPetV27()">10빌딩으로 소환</button></div>
      <div class="panel-card"><b>보유 빌딩:</b> ${game.player.building}</div>
      <div class="pet-grid-v27">${pets}</div>`, { type:'petShop', pause:true });
  }
  window.openPetShopModalV27 = openPetShopModalV27;
  window.rollPetV27 = function rollPetV27() {
    ensurePlayerV27Fields();
    if ((game.player.building || 0) < 10) { toast('빌딩 화폐가 부족합니다. 펫 소환에는 10빌딩이 필요합니다.'); return; }
    const ids = Object.keys(PET_DEFS_V27);
    const notOwned = ids.filter((id) => !game.player.pets.includes(id));
    const pool = notOwned.length ? notOwned : ids;
    const id = pool[Math.floor(Math.random() * pool.length)];
    const pet = PET_DEFS_V27[id];
    game.player.building -= 10;
    if (!game.player.pets.includes(id)) game.player.pets.push(id);
    game.player.activePet = id;
    ensurePlayerHp(); savePlayer(); updateHud(); playSfx('coin');
    showCinematicMessage('펫을 얻었습니다!', `${pet.icon} ${pet.name}이(가) 동행합니다. · ${petStatsTextV27(pet)}`, 1800);
    setTimeout(openPetShopModalV27, 350);
  };
  window.equipPetV27 = function equipPetV27(id) {
    ensurePlayerV27Fields();
    if (!PET_DEFS_V27[id] || !game.player.pets.includes(id)) { toast('아직 보유하지 않은 펫입니다.'); return; }
    game.player.activePet = id; ensurePlayerHp(); savePlayer(); updateHud(); playSfx('open'); openPetShopModalV27();
    toast(`${PET_DEFS_V27[id].name}이(가) 동행합니다.`);
  };
  window.unequipPetV27 = function unequipPetV27() {
    ensurePlayerV27Fields(); game.player.activePet = null; ensurePlayerHp(); savePlayer(); updateHud(); openCharacterPanel(); toast('펫 동행을 해제했습니다.');
  };

  // 8) 강화 상점
  function openUpgradeShopModalV27() {
    ensurePlayerV27Fields();
    const weaponId = game.player.equipment?.weapon;
    const item = weaponId ? getItemDefinition(weaponId, game.player.class) : null;
    const tier = item ? getWeaponTierV27(item.id) : 0;
    const next = TIER_INFO_V27[tier + 1];
    const current = TIER_INFO_V27[tier];
    const chance = next ? Math.round(next.chance * 100) : 0;
    openModal(`<h2>강화 장인 도담</h2>
      <div class="panel-card upgrade-hero-v27">
        <div class="upgrade-weapon-v27 ${tierClassV27(tier)}"><div class="upgrade-icon-v27">${item ? itemIcon(item) : '▫️'}</div><div><b>${item ? displayItemNameV27(item) : '무기 없음'}</b><p>${item ? enhancedStatsTextV27(item) : '장착한 무기가 없습니다.'}</p><small>현재 등급: ${current.name}</small></div></div>
        <div class="upgrade-info-v27"><b>강화 비용: 3빌딩</b><p>${next ? `성공 시 ${next.name} 등급으로 상승 · 성공률 ${chance}%` : '이미 전설 등급입니다.'}</p><p class="muted">실패 시 한 등급 아래로 하락합니다.</p><button class="primary wide" ${(!item || !next) ? 'disabled' : ''} onclick="upgradeCurrentWeaponV27()">무기 강화</button></div>
      </div>
      <div class="panel-card"><b>보유 빌딩:</b> ${game.player.building}</div>`, { type:'upgradeShop', pause:true });
  }
  window.openUpgradeShopModalV27 = openUpgradeShopModalV27;
  window.upgradeCurrentWeaponV27 = function upgradeCurrentWeaponV27() {
    ensurePlayerV27Fields();
    const weaponId = game.player.equipment?.weapon;
    const item = weaponId ? getItemDefinition(weaponId, game.player.class) : null;
    if (!item || item.slot !== 'weapon') { toast('강화할 무기를 장착해 주세요.'); return; }
    const tier = getWeaponTierV27(item.id);
    if (tier >= 4) { toast('이미 전설 등급입니다.'); return; }
    if ((game.player.building || 0) < 3) { toast('빌딩 화폐가 부족합니다. 강화에는 3빌딩이 필요합니다.'); return; }
    const next = TIER_INFO_V27[tier + 1];
    game.player.building -= 3;
    const success = Math.random() < next.chance;
    const newTier = success ? tier + 1 : Math.max(0, tier - 1);
    game.player.weaponUpgrades[item.id] = newTier;
    ensurePlayerHp(); savePlayer(); updateHud(); playSfx(success ? 'quest' : 'hit');
    const msg = success ? `${item.name} 강화 성공! ${next.name} 등급이 되었습니다.` : `${item.name} 강화 실패... ${tierLabelV27(newTier)} 등급으로 하락했습니다.`;
    toast(msg, 2400); appendChatMessage('system', '강화', msg);
    openUpgradeShopModalV27();
  };

  // 9) 상태창 UI 재설계 + 펫 칸/강화 테두리 반영
  function classNameV27(klass) { return CLASS_META[klass]?.name || klass || '직업'; }
  function openCharacterPanelV27() {
    ensurePlayerV27Fields(); ensurePlayerHp();
    const stats = computeTotalStats();
    const expNext = XP_REQUIREMENTS?.[game.player.level] || null;
    const pet = PET_DEFS_V27[game.player.activePet];
    const slotHtml = (slot, extraClass) => {
      const itemId = game.player.equipment[slot];
      const item = itemId ? getItemDefinition(itemId, game.player.class) : null;
      const tier = item?.slot === 'weapon' ? getWeaponTierV27(item.id) : 0;
      return `<div class="equip-slot paper-slot ${extraClass} compact-item-slot-v26 equip-card-v27 ${item?.slot === 'weapon' ? tierClassV27(tier) : ''}" title="${escapeHtml(item ? itemTooltipV27(item) : '가방 아이템을 이 칸으로 드래그해 장착')}" ondragover="allowItemDrop(event)" ondrop="dropItemOnEquip(event, '${slot}')">
        ${item && slot !== 'weapon' ? `<button class="unequip-btn" title="장착 해제" onclick="unequipSlot('${slot}')">×</button>` : ''}
        <div class="slot-name">${slotLabel(slot)}</div><div class="slot-icon ${item ? 'filled' : ''}">${item ? itemIcon(item) : '＋'}</div><b>${item ? displayItemNameV27(item) : '비어 있음'}</b>
      </div>`;
    };
    const statIcons = { 힘:'⚔', 지능:'✦', 정신:'✚', 체력:'❤' };
    const statHtml = Object.entries(stats).map(([k,v]) => `<div class="mini-stat stat-card-v27" title="현재 총 ${k}"><span>${statIcons[k] || '◆'} ${k}</span><b>${v}</b></div>`).join('');
    const progressPct = expNext ? Math.max(0, Math.min(100, Math.round(((game.player.exp - minExpForLevel(game.player.level)) / Math.max(1, expNext - minExpForLevel(game.player.level))) * 100))) : 100;
    const statusHtml = `<div class="status-hero-v27"><div><span>LV</span><b>${game.player.level}</b></div><section><strong>${escapeHtml(game.player.name)}</strong><p>${classNameV27(game.player.class)} · ${game.player.spec || '전문화 미선택'}</p></section></div>
      <div class="status-bars-v27"><label>HP <b>${game.player.hp}/${game.player.maxHp}</b></label><div class="meter-v27"><i style="width:${Math.round((game.player.hp/game.player.maxHp)*100)}%"></i></div><label>EXP <b>${expNext ? `${game.player.exp}/${expNext}` : game.player.exp}</b></label><div class="meter-v27 exp"><i style="width:${progressPct}%"></i></div></div>
      <div class="wallet-row-v27"><span>🪙 Gold <b>${game.player.gold}</b></span><span>🏢 빌딩 <b>${game.player.building}</b></span><span>✨ 스킬P <b>${game.player.skillPoints || 0}</b></span></div>`;
    const petSlot = `<div class="pet-slot-v27 ${pet ? 'active' : ''}" title="${escapeHtml(pet ? `${pet.name}\n${pet.desc}\n${petStatsTextV27(pet)}` : '펫 상점에서 펫을 얻으면 이 칸에 장착할 수 있습니다.')}"><div class="pet-face-v27" style="--pet-color:${pet?.color || '#475569'}">${pet?.icon || '＋'}</div><div><span>동행 펫</span><b>${pet?.name || '비어 있음'}</b><small>${pet ? petStatsTextV27(pet) : '펫 상점에서 획득'}</small></div>${pet ? '<button class="ghost small" onclick="unequipPetV27()">해제</button>' : ''}</div>`;
    const inventory = Array.isArray(game.player.inventory) ? [...game.player.inventory] : [];
    const bagSlots = [];
    for (let idx=0; idx<20; idx+=1) {
      const itemId = inventory[idx];
      if (itemId) {
        const item = getItemDefinition(itemId, game.player.class); const can = canEquip(item, game.player); const equipped = Object.values(game.player.equipment).includes(itemId);
        const tier = item?.slot === 'weapon' ? getWeaponTierV27(item.id) : 0;
        bagSlots.push(`<div class="bag-slot compact-item-slot-v26 bag-card-v27 ${item?.slot === 'weapon' ? tierClassV27(tier) : ''}" title="${escapeHtml(itemTooltipV27(item))}" draggable="true" ondragstart="dragItemStart(event, ${idx})" ondragover="allowItemDrop(event)" ondrop="dropItemOnBag(event, ${idx})"><div class="bag-icon item-${item.slot}">${itemIcon(item)}</div><b>${displayItemNameV27(item)}</b><small>${slotLabel(item.slot)}</small><button ${!can || equipped ? 'disabled' : ''} class="primary small" onclick="equipItem('${itemId}')">${equipped ? '장착 중' : '장착'}</button></div>`);
      } else bagSlots.push(`<div class="bag-slot empty compact-item-slot-v26 bag-card-v27" ondragover="allowItemDrop(event)" ondrop="dropItemOnBag(event, ${idx})"><div class="bag-icon">＋</div><small>빈 칸</small></div>`);
    }
    openModal(`<div class="character-window-v27"><header class="character-head-v27"><h2>인벤토리 / 상태창 <span class="badge">C 키</span></h2><p>장비와 펫을 확인하고, 아이템 위에 마우스를 올려 상세 능력치를 봅니다.</p></header>
      <div class="character-panel character-panel-v7 character-panel-v26 character-panel-v27">
        <div class="panel-card paperdoll-card-v7 status-panel-v27"><h3>캐릭터 상태</h3>${statusHtml}<div class="paperdoll paperdoll-v7"><canvas id="characterPanelCanvas" width="420" height="420"></canvas>${slotHtml('head','slot-head-v7')}${slotHtml('armor','slot-armor-v7')}${slotHtml('weapon','slot-weapon-v7')}${slotHtml('accessory','slot-accessory-v7')}</div>${petSlot}<div class="mini-stat-grid mini-stat-grid-v7 stat-grid-v27">${statHtml}</div></div>
        <div class="panel-card bag-panel-v27"><h3>가방</h3><p class="muted">평소에는 아이콘과 이름만 보이고, 상세 능력치는 마우스오버로 확인합니다.</p><div class="bag-grid">${bagSlots.join('')}</div></div>
      </div></div>`, { type:'character', pause:true });
    setTimeout(drawCharacterPanelCanvas, 20);
  }
  openCharacterPanel = openCharacterPanelV27;
  window.openCharacterPanel = openCharacterPanelV27;
  window.openStatsModal = openCharacterPanelV27;
  window.openEquipmentModal = openCharacterPanelV27;

  // 장비 장착/드롭 시 v27 상태 보정
  const oldEquipItemV27 = window.equipItem;
  window.equipItem = function equipItemV27(itemId) {
    oldEquipItemV27(itemId);
    ensurePlayerV27Fields(); ensurePlayerHp(); savePlayer();
  };

  // 기존 버튼에서 새 맵도 상태 동기화
  hudUpdatePipeline.register({
    id:'hud-player-fields-v27',
    priority:270,
    before:() => ensurePlayerV27Fields(),
  });

  appendChatMessage?.('system', '패치', 'v27: 전투창 배치 복구, 펫 상점, 강화 상점, 상태창 개선이 적용되었습니다.');
})();

/* =========================
   v28 patch: enhancement audio/3s forging flow + pet follower animation
   ========================= */
(function yuksamV28Patch(){
  if (window.__YUKSAM_V28_PATCH__) return;
  window.__YUKSAM_V28_PATCH__ = true;

  try { document.title = '63월드'; } catch {}

  const TIER_INFO_V28 = window.TIER_INFO_V27 || [
    { name:'일반', cls:'tier-0', color:'#cbd5e1', chance:null },
    { name:'고급', cls:'tier-1', color:'#22c55e', chance:.70 },
    { name:'희귀', cls:'tier-2', color:'#3b82f6', chance:.50 },
    { name:'에픽', cls:'tier-3', color:'#a855f7', chance:.30 },
    { name:'전설', cls:'tier-4', color:'#f59e0b', chance:.10 },
  ];
  window.TIER_INFO_V28 = TIER_INFO_V28;

  function ensurePlayerV28Fields() {
    try { ensurePlayerV27Fields?.(); } catch {}
    if (!game.player) return;
    if (!game.player.weaponUpgrades || typeof game.player.weaponUpgrades !== 'object') game.player.weaponUpgrades = {};
  }
  function getWeaponTierV28(itemId) {
    ensurePlayerV28Fields();
    return Math.max(0, Math.min(4, Number(game.player?.weaponUpgrades?.[itemId] || 0)));
  }
  function tierLabelV28(tier) { return TIER_INFO_V28[tier]?.name || '일반'; }
  function tierClassV28(tier) { return TIER_INFO_V28[tier]?.cls || 'tier-0'; }
  function enhancedStatsTextV28(item) {
    if (!item?.stats) return '';
    const tier = item.slot === 'weapon' ? getWeaponTierV28(item.id) : 0;
    return Object.entries(item.stats).map(([k, v]) => {
      const base = Number(v || 0);
      const bonus = item.slot === 'weapon' && tier > 0 ? Math.max(1, Math.ceil(base * tier * .45)) : 0;
      return `${k} +${base + bonus}${bonus ? ` (강화 +${bonus})` : ''}`;
    }).join(', ');
  }
  function displayItemNameV28(item) {
    if (!item) return '';
    if (item.slot !== 'weapon') return item.name;
    const tier = getWeaponTierV28(item.id);
    return tier > 0 ? `[${tierLabelV28(tier)}] ${item.name}` : item.name;
  }

  // 첨부 파일 1/2/3을 강화 진행/성공/실패 효과음으로 사용한다.
  function ensureUpgradeAudioV28() {
    try {
      initAudio?.();
      if (!game.audio) return;
      if (!game.audio.upgradeChargeFile) {
        game.audio.upgradeChargeFile = new Audio(window.getAudioAsset?.('upgradeCharge')?.src || '');
        game.audio.upgradeChargeFile.preload = 'auto';
      }
      if (!game.audio.upgradeSuccessFile) {
        game.audio.upgradeSuccessFile = new Audio(window.getAudioAsset?.('upgradeSuccess')?.src || '');
        game.audio.upgradeSuccessFile.preload = 'auto';
      }
      if (!game.audio.upgradeFailFile) {
        game.audio.upgradeFailFile = new Audio(window.getAudioAsset?.('upgradeFail')?.src || '');
        game.audio.upgradeFailFile.preload = 'auto';
      }
      const vol = game.settings?.sfxEnabled ? Math.min(1, Math.max(0, Number(game.settings.sfxVolume ?? 1))) : 0;
      game.audio.upgradeChargeFile.volume = vol;
      game.audio.upgradeSuccessFile.volume = vol;
      game.audio.upgradeFailFile.volume = vol;
    } catch {}
  }
  const oldResumeAudioV28 = resumeAudio;
  resumeAudio = function resumeAudioV28() { oldResumeAudioV28(); ensureUpgradeAudioV28(); };
  audioVolumePipeline.register({
    id:'audio-volume-v28',
    priority:280,
    after:() => ensureUpgradeAudioV28(),
  });
  function playUpgradeFileV28(file) {
    try {
      resumeAudio(); ensureUpgradeAudioV28();
      if (!file || !game.settings?.sfxEnabled) return false;
      file.pause(); file.currentTime = 0;
      file.play().catch(() => {});
      return true;
    } catch { return false; }
  }
  audioAdapters.upgrade = function playUpgradeV28(name) {
    if (name === 'upgradeCharge') return playUpgradeFileV28(game.audio?.upgradeChargeFile);
    if (name === 'upgradeSuccess') return playUpgradeFileV28(game.audio?.upgradeSuccessFile);
    if (name === 'upgradeFail') return playUpgradeFileV28(game.audio?.upgradeFailFile);
    return false;
  };
  activePlaySfx = window.YuksamAudioDispatcher.create({
    playSynth:playSynthSfx,
    playMapped:(audioId, fallback) => window.playMappedAudio?.(audioId, { onFallback:fallback }) || false,
    playDoor:() => audioAdapters.door?.(),
    playUpgrade:(name) => audioAdapters.upgrade?.(name) || false,
    playCriticalVisuals:(source) => audioAdapters.criticalVisuals.forEach((callback) => callback(source)),
    getCriticalSource:() => game.combatImpact?.target === 'player' ? 'enemy' : 'player',
    playPlayerHitFallback:playPlayerHitSfx,
  });

  function upgradeRatesHtmlV28() {
    const rows = TIER_INFO_V28.slice(1).map((tier, index) =>
      `<div><span class="tier-dot tier-${index + 1}"></span>${tier.name} 성공률 <strong>${tier.chance}%</strong></div>`
    ).join('');
    return `<div class="upgrade-rates-v28"><b>강화 확률 안내</b>${rows}<small>강화 비용은 3빌딩이며, 실패하면 한 등급 아래로 하락합니다.</small></div>`;
  }

  function openUpgradeShopModalV28() {
    ensurePlayerV28Fields();
    const weaponId = game.player?.equipment?.weapon;
    const item = weaponId ? getItemDefinition(weaponId, game.player.class) : null;
    const tier = item ? getWeaponTierV28(item.id) : 0;
    const next = TIER_INFO_V28[tier + 1];
    const current = TIER_INFO_V28[tier] || TIER_INFO_V28[0];
    const chance = next ? Math.round(next.chance * 100) : 0;
    openModal(`<h2>강화 장인 도담</h2>
      <div class="panel-card upgrade-intro-v28">
        <b>무기 강화소</b>
        <p>장착 중인 무기만 강화할 수 있습니다. 강화 등급이 오르면 무기 능력치가 함께 상승합니다.</p>
        ${upgradeRatesHtmlV28()}
      </div>
      <div class="panel-card upgrade-hero-v27 upgrade-hero-v28">
        <div class="upgrade-weapon-v27 ${tierClassV28(tier)}"><div class="upgrade-icon-v27">${item ? itemIcon(item) : '▫️'}</div><div><b>${item ? displayItemNameV28(item) : '무기 없음'}</b><p>${item ? enhancedStatsTextV28(item) : '장착한 무기가 없습니다.'}</p><small>현재 등급: ${current.name}</small></div></div>
        <div class="upgrade-info-v27"><b>강화 비용: 3빌딩</b><p>${next ? `성공 시 ${next.name} 등급으로 상승 · 성공률 ${chance}%` : '이미 전설 등급입니다.'}</p><p class="muted">강화에는 약 3초가 걸립니다.</p><button class="primary wide" ${(!item || !next || game.upgradeInProgress) ? 'disabled' : ''} onclick="upgradeCurrentWeaponV27()">무기 강화</button></div>
      </div>
      <div class="resource-balance-banner resource-building"><span>현재 보유 빌딩 화폐</span><b>🏢 ${game.player?.building || 0}</b><small>강화 1회에 3빌딩이 필요합니다</small></div>`, { type:'upgradeShop', pause:true });
  }
  window.openUpgradeShopModalV28 = openUpgradeShopModalV28;

  function renderUpgradeProgressV28(item, next) {
    openModal(`<h2>강화 장인 도담</h2>
      <div class="upgrade-progress-v28">
        <div class="forge-ring-v28"><span>⚒</span><i></i><i></i><i></i></div>
        <h3>강화중...</h3>
        <p>${escapeHtml(item.name)}을(를) ${next.name} 등급으로 강화하고 있습니다.</p>
        <div class="upgrade-loading-bar-v28"><b></b></div>
        <small>도담이 무기에 빌딩의 기운을 불어넣고 있습니다.</small>
      </div>`, { type:'upgradeProgress', pause:true });
  }
  function renderUpgradeResultV28(success, item, newTier, oldTier, next) {
    const cls = success ? 'success' : 'fail';
    const title = success ? '강화 성공!' : '강화 실패...';
    const sub = success ? `${item.name}이(가) ${tierLabelV28(newTier)} 등급이 되었습니다.` : `${item.name}의 강화가 불안정해져 ${tierLabelV28(newTier)} 등급이 되었습니다.`;
    openModal(`<h2>강화 장인 도담</h2>
      <div class="upgrade-result-v28 ${cls}">
        <div class="upgrade-burst-v28">${success ? '✦' : '⌁'}</div>
        <h3>${title}</h3>
        <p>${sub}</p>
        <div class="upgrade-tier-change-v28"><span>${tierLabelV28(oldTier)}</span><b>→</b><span>${tierLabelV28(newTier)}</span></div>
        <button class="primary wide" onclick="openUpgradeShopModalV28()">확인</button>
      </div>`, { type:'upgradeResult', pause:true });
  }

  window.upgradeCurrentWeaponV28 = function upgradeCurrentWeaponV28() {
    ensurePlayerV28Fields();
    if (game.upgradeInProgress) return;
    const weaponId = game.player?.equipment?.weapon;
    const item = weaponId ? getItemDefinition(weaponId, game.player.class) : null;
    if (!item || item.slot !== 'weapon') { toast('강화할 무기를 장착해 주세요.'); return; }
    const tier = getWeaponTierV28(item.id);
    if (tier >= 4) { toast('이미 전설 등급입니다.'); return; }
    if ((game.player.building || 0) < 3) { toast('빌딩 화폐가 부족합니다. 강화에는 3빌딩이 필요합니다.'); return; }
    const next = TIER_INFO_V28[tier + 1];
    game.upgradeInProgress = true;
    game.player.building -= 3;
    updateHud?.(); savePlayer?.();
    renderUpgradeProgressV28(item, next);
    playSfx('upgradeCharge');
    setTimeout(() => {
      const success = Math.random() < next.chance;
      const newTier = success ? tier + 1 : Math.max(0, tier - 1);
      game.player.weaponUpgrades[item.id] = newTier;
      ensurePlayerHp?.(); savePlayer?.(); updateHud?.();
      game.upgradeInProgress = false;
      playSfx(success ? 'upgradeSuccess' : 'upgradeFail');
      if (success) {
        try { showCinematicMessage('강화 성공!', `${item.name} · ${tierLabelV28(newTier)} 등급`, 1600); } catch {}
      }
      const msg = success ? `${item.name} 강화 성공! ${tierLabelV28(newTier)} 등급이 되었습니다.` : `${item.name} 강화 실패... ${tierLabelV28(newTier)} 등급으로 하락했습니다.`;
      appendChatMessage?.('system', '강화', msg);
      renderUpgradeResultV28(success, item, newTier, tier, next);
    }, 3000);
  };


  try { appendChatMessage?.('system', '패치', 'v28: 강화 3초 연출/효과음, 강화 확률 안내, 펫 팔로워 애니메이션이 적용되었습니다.'); } catch {}
})();


/* =========================
   v29 patch: forge/pet interiors polish + fixed pet follow + paperdoll layout refinement
   ========================= */
(function yuksamV29Patch(){
  if (window.__YUKSAM_V29_PATCH__) return;
  window.__YUKSAM_V29_PATCH__ = true;

  try { document.title = '63월드'; } catch {}

  // 이름/위치 정리
  if (worldDefs?.town?.upgradeShop) worldDefs.town.upgradeShop.name = '대장간';
  if (worldDefs?.town?.petShop) worldDefs.town.petShop.name = '펫 상점';
  if (worldDefs?.upgradeShopInterior) {
    worldDefs.upgradeShopInterior.label = '대장간 내부';
    worldDefs.upgradeShopInterior.width = 1500;
    worldDefs.upgradeShopInterior.height = 940;
    worldDefs.upgradeShopInterior.playerSpawn = { x: 750, y: 780 };
    worldDefs.upgradeShopInterior.exit = { x: 750, y: 862, r: 72 };
    worldDefs.upgradeShopInterior.blacksmith = { x: 760, y: 390, r: 48, name: '대장장이 진명' };
  }
  worldDefs.petShopInterior = WORLD_PATCHES_V29.petShopInterior;

  // 스타일 오버라이드
  try {
    const style = document.createElement('style');
    style.id = 'yuksam-v29-style';
    style.textContent = `
      .paperdoll-v7{
        min-height: 520px;
        background:
          radial-gradient(circle at 50% 30%, rgba(125,211,252,.16), rgba(255,255,255,.03) 36%, rgba(0,0,0,.08) 64%),
          linear-gradient(180deg, rgba(18,30,54,.96), rgba(8,14,28,.98));
      }
      .paperdoll-v7 #characterPanelCanvas{
        width: 400px;height: 400px; margin-top:-8px;
      }
      .paper-slot{
        width: 188px; min-height: 126px; border-radius: 24px;
        background: linear-gradient(180deg, rgba(9,22,43,.78), rgba(7,16,28,.66));
        border:1px solid rgba(125,211,252,.16);
        box-shadow: 0 14px 36px rgba(0,0,0,.24), inset 0 1px 0 rgba(255,255,255,.06);
      }
      .slot-head-v7{ left: 18px; top: 30px; }
      .slot-weapon-v7{ right: 18px; top: 106px; }
      .slot-armor-v7{ left: 18px; top: 274px; }
      .slot-accessory-v7{ right: 18px; top: 360px; }
      .slot-connector-v29{
        position:absolute; height:4px; border-radius:999px; 
        background: linear-gradient(90deg, rgba(59,130,246,.12), rgba(96,165,250,.75), rgba(59,130,246,.12));
        box-shadow: 0 0 14px rgba(96,165,250,.22);
        z-index:2; pointer-events:none;
      }
      .slot-connector-v29.head{ left: 186px; top: 134px; width: 98px; transform: rotate(34deg); }
      .slot-connector-v29.weapon{ right: 188px; top: 220px; width: 96px; transform: rotate(-30deg); }
      .slot-connector-v29.armor{ left: 188px; top: 332px; width: 92px; transform: rotate(-26deg); }
      .slot-connector-v29.accessory{ right: 186px; top: 412px; width: 112px; transform: rotate(28deg); }
      .status-panel-v29 .info-grid.compact-info-v26{
        display:grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap:8px;
        background: rgba(4,10,20,.34); padding:10px; border-radius:16px; border:1px solid rgba(148,163,184,.10);
      }
      .status-panel-v29 .info-chip{ background:linear-gradient(180deg, rgba(15,23,42,.82), rgba(2,6,23,.7)); border:1px solid rgba(96,165,250,.12); }
      .status-panel-v29 .mini-stat-grid-v7{ grid-template-columns: repeat(4,minmax(0,1fr)); gap:8px; }
      .status-panel-v29 .mini-stat{ background:linear-gradient(180deg, rgba(13,24,45,.88), rgba(7,13,24,.82)); border:1px solid rgba(148,163,184,.12); }
      .status-panel-v29 .pet-slot-v27{ margin-top: 12px; }
      .pet-shop-hero-v29 b{ display:block; margin-bottom:4px; }
      .forge-intro-v29 .npc-name{ color:#fde68a; font-weight:800; }
    `;
    document.head.appendChild(style);
  } catch {}

  function drawSpeechBubbleV29(ctx, x, y, text, opts = {}) {
    const padding = opts.padding || 14;
    ctx.save();
    ctx.font = opts.font || '900 14px Jua, Noto Sans KR, system-ui';
    ctx.textAlign = 'center';
    const w = Math.min(opts.maxWidth || 280, ctx.measureText(text).width + padding * 2);
    const h = opts.height || 34;
    const bx = x - w / 2;
    const by = y - (opts.offsetY || 86);
    ctx.fillStyle = opts.bg || 'rgba(12,18,30,.90)';
    ctx.strokeStyle = opts.stroke || 'rgba(255,255,255,.20)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, bx, by, w, h, 14); ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 8, by + h - 2); ctx.lineTo(x, by + h + 10); ctx.lineTo(x + 8, by + h - 2); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = opts.color || '#f8fafc';
    ctx.fillText(text, x, by + h / 2 + 5);
    ctx.restore();
  }

  function drawForgeDecorationV29(world) {
    const ctx = game.ctx;
    const anvil = worldToScreen(540, 520);
    const furnace = worldToScreen(1030, 450);
    const rack = worldToScreen(1160, 305);

    // anvil
    ctx.save();
    ctx.fillStyle = '#1f2937';
    roundRect(ctx, anvil.x - 58, anvil.y - 18, 116, 28, 10); ctx.fill();
    ctx.fillStyle = '#334155';
    roundRect(ctx, anvil.x - 24, anvil.y - 38, 72, 24, 8); ctx.fill();
    ctx.fillStyle = '#475569';
    ctx.fillRect(anvil.x - 12, anvil.y - 6, 24, 54);
    drawShadow(ctx, anvil.x, anvil.y + 40, 54, 10, .18);

    // furnace
    ctx.fillStyle = '#5b341d';
    roundRect(ctx, furnace.x - 80, furnace.y - 90, 160, 190, 24); ctx.fill();
    ctx.fillStyle = '#7c2d12';
    roundRect(ctx, furnace.x - 52, furnace.y - 42, 104, 90, 14); ctx.fill();
    const glow = ctx.createRadialGradient(furnace.x, furnace.y + 4, 10, furnace.x, furnace.y + 4, 72);
    glow.addColorStop(0, 'rgba(254,215,170,.96)'); glow.addColorStop(.35, 'rgba(249,115,22,.82)'); glow.addColorStop(1, 'rgba(124,45,18,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(furnace.x, furnace.y + 4, 72, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f97316';
    for (let i = 0; i < 6; i += 1) {
      const t = performance.now() / 200 + i * 0.8;
      ctx.globalAlpha = 0.45 + Math.sin(t) * 0.18;
      ctx.beginPath(); ctx.arc(furnace.x - 34 + i * 14, furnace.y - 28 - Math.sin(t) * 14, 4 + (i % 2), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // tool rack
    ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(rack.x - 70, rack.y); ctx.lineTo(rack.x + 70, rack.y); ctx.stroke();
    ctx.font = '900 26px Noto Sans KR, Apple Color Emoji, Segoe UI Emoji'; ctx.textAlign = 'center';
    ctx.fillText('🔨', rack.x - 36, rack.y + 32);
    ctx.fillText('⚒', rack.x, rack.y + 32);
    ctx.fillText('🗡️', rack.x + 36, rack.y + 32);
    ctx.restore();
  }

  function drawPetShopDecorV29(world) {
    const ctx = game.ctx;
    const crystals = [
      { x: 360, y: 462, c:'#f0abfc' }, { x: 822, y: 470, c:'#93c5fd' },
      { x: 940, y: 250, c:'#fde68a' }, { x: 250, y: 260, c:'#c084fc' }
    ];
    crystals.forEach((cr) => {
      const p = worldToScreen(cr.x, cr.y);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.fillStyle = cr.c; ctx.globalAlpha = .35;
      ctx.beginPath(); ctx.moveTo(0, -24); ctx.lineTo(22, 0); ctx.lineTo(0, 30); ctx.lineTo(-22, 0); ctx.closePath(); ctx.fill();
      ctx.restore();
    });
    const paw = worldToScreen(590, 530);
    ctx.save();
    ctx.textAlign='center'; ctx.font='900 74px Apple Color Emoji, Segoe UI Emoji'; ctx.globalAlpha=.13;
    ctx.fillText('🐾', paw.x, paw.y);
    ctx.restore();
  }

  function drawPetShopInteriorV29() {
    const ctx = game.ctx, world = worldDefs.petShopInterior;
    ctx.clearRect(0,0,game.width,game.height);
    const g = ctx.createLinearGradient(0,0,0,game.height);
    g.addColorStop(0,'#432f56'); g.addColorStop(.5,'#281f3f'); g.addColorStop(1,'#111827');
    ctx.fillStyle = g; ctx.fillRect(0,0,game.width,game.height);
    drawTerrainDots(ctx, world, '#ffffff', .038, 30, 9);
    drawPetShopDecorV29(world);
    drawCrystalPedestalWorld(world.orb.x, world.orb.y, '#f9a8d4');
    const orb = worldToScreen(world.orb.x, world.orb.y);
    ctx.save();
    const halo = ctx.createRadialGradient(orb.x, orb.y - 30, 8, orb.x, orb.y - 30, 94);
    halo.addColorStop(0, 'rgba(244,114,182,.65)'); halo.addColorStop(.5, 'rgba(217,70,239,.18)'); halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(orb.x, orb.y - 30, 94, 0, Math.PI * 2); ctx.fill();
    ctx.font = '900 15px Jua, Noto Sans KR, system-ui';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff7ed'; ctx.strokeStyle='rgba(15,23,42,.7)'; ctx.lineWidth=4;
    ctx.strokeText('펫 수정구', orb.x, orb.y - 82); ctx.fillText('펫 수정구', orb.x, orb.y - 82);
    const lines = ['반짝이는 친구를 만나볼래?', '귀여운 펫들이 기다리고 있어!', '10빌딩으로 새로운 동행을 소환해봐!'];
    const idx = Math.floor(Date.now() / 5000) % lines.length;
    drawSpeechBubbleV29(ctx, orb.x, orb.y - 10, lines[idx], { bg:'rgba(56,35,74,.92)', stroke:'rgba(244,114,182,.45)', color:'#fdf2f8', offsetY:118, maxWidth:260 });
    ctx.restore();
    const ex = worldToScreen(world.exit.x, world.exit.y); drawExitMarker(ex.x, ex.y); drawTitleLabel('펫 상점');
  }

  function drawUpgradeShopInteriorV29() {
    const ctx = game.ctx, world = worldDefs.upgradeShopInterior;
    ctx.clearRect(0,0,game.width,game.height);
    const g = ctx.createLinearGradient(0,0,0,game.height);
    g.addColorStop(0,'#4a2817'); g.addColorStop(.48,'#2f1d16'); g.addColorStop(1,'#0f172a');
    ctx.fillStyle = g; ctx.fillRect(0,0,game.width,game.height);
    drawTerrainDots(ctx, world, '#fbbf24', .042, 34, 9);
    drawForgeDecorationV29(world);
    const p = worldToScreen(world.blacksmith.x, world.blacksmith.y);
    drawShopCounter(world.blacksmith.x, world.blacksmith.y + 84, '대장간', '#f97316');
    drawNpcSprite(ctx, p.x, p.y, '대장장이 진명', false, NPC_WORLD_SCALE, isNearPoint(world.blacksmith, 96), 'warrior');
    ctx.save();
    ctx.font='900 24px Noto Sans KR, Apple Color Emoji, Segoe UI Emoji';
    ctx.textAlign='center'; ctx.fillStyle='#fde68a';
    ctx.fillText('🔨', p.x + 40, p.y + 4);
    ctx.restore();
    const chats = ['무기를 벼려 더 강해져 보게.', '등급이 오를수록 빛이 달라지지.', '강화에는 3빌딩이 필요하네.'];
    drawSpeechBubbleV29(ctx, p.x, p.y, chats[Math.floor(Date.now()/5500)%chats.length], { bg:'rgba(63,29,13,.92)', stroke:'rgba(251,191,36,.38)', color:'#fff7ed', offsetY:118, maxWidth:240 });
    const ex = worldToScreen(world.exit.x, world.exit.y); drawExitMarker(ex.x, ex.y); drawTitleLabel('대장간');
  }

  function drawPetFollowerV29(ctx) {
    if (!game.player) return;
    const petDefs = window.PET_DEFS_V27 || {};
    const pet = petDefs[game.player.activePet];
    if (!pet) return;
    const now = performance.now();
    const dir = game.lastMove || { x: 1, y: 0 };
    if (Math.abs(dir.x) > 0.1) game.player._petSide = dir.x > 0 ? 'left' : 'right';
    const side = game.player._petSide || 'left';
    const moving = !!game.isMoving;
    const dancing = (game.danceTimer || 0) > 0;
    const wx = game.player.x + (side === 'left' ? -54 : 54) + (dancing ? Math.sin(now / 90) * 4 : 0);
    const wy = game.player.y + 8 - (moving ? Math.abs(Math.sin(now / 120 + (pet.bob || 0))) * 11 : Math.sin(now / 340 + (pet.bob || 0)) * 2.5);
    const p = worldToScreen(wx, wy);
    ctx.save();
    drawShadow(ctx, p.x, p.y + 24, 18, 6, .16);
    ctx.translate(p.x, p.y);
    ctx.rotate(dancing ? Math.sin(now / 95 + (pet.bob || 0)) * 0.2 : Math.sin(now / 500 + (pet.bob || 0)) * 0.03);
    const bounce = dancing ? 1.08 + Math.sin(now / 70) * .06 : 1 + Math.sin(now / 460 + (pet.bob || 0)) * .02;
    ctx.scale(bounce, bounce);
    ctx.font = '900 33px Noto Sans KR, Apple Color Emoji, Segoe UI Emoji, system-ui';
    ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.lineWidth=4; ctx.strokeStyle='rgba(15,23,42,.52)';
    ctx.strokeText(pet.icon, 0, 0); ctx.fillText(pet.icon, 0, 0);
    if (moving) {
      ctx.fillStyle = pet.color || '#fde68a'; ctx.globalAlpha = .74;
      ctx.beginPath(); ctx.ellipse(-8, 20, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(8, 20, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
    }
    if (dancing) {
      ctx.globalAlpha = .92; ctx.font = '900 15px Jua, Noto Sans KR, system-ui'; ctx.fillStyle = pet.color || '#fde68a';
      ctx.fillText('♪', -22, -24); ctx.fillText('♬', 22, -30);
    }
    ctx.restore();
  }


  // 캐릭터 상태창 레이아웃/가시성 업그레이드
  const oldOpenCharacterPanelV29 = window.openCharacterPanel || openCharacterPanel;
  function applyPaperdollDecorV29() {
    const paper = document.querySelector('.paperdoll-v7');
    const statusPanel = document.querySelector('.status-panel-v27');
    if (statusPanel) statusPanel.classList.add('status-panel-v29');
    if (!paper || paper.querySelector('.slot-connector-v29')) return;
    ['head','weapon','armor','accessory'].forEach((name) => {
      const d = document.createElement('div');
      d.className = `slot-connector-v29 ${name}`;
      paper.appendChild(d);
    });
  }
  window.openCharacterPanel = openCharacterPanel;
  window.openStatsModal = openCharacterPanel;
  window.openEquipmentModal = openCharacterPanel;

  const oldDrawCharacterPanelCanvasV29 = drawCharacterPanelCanvas;
  drawCharacterPanelCanvas = function drawCharacterPanelCanvasV29() {
    const canvas = $('characterPanelCanvas');
    if (!canvas || !game.player) return oldDrawCharacterPanelCanvasV29();
    const c = canvas.getContext('2d');
    c.clearRect(0,0,canvas.width,canvas.height);
    const bg = c.createRadialGradient(canvas.width/2, canvas.height/2-10, 20, canvas.width/2, canvas.height/2, 160);
    bg.addColorStop(0, 'rgba(125,211,252,.18)');
    bg.addColorStop(.45, 'rgba(59,130,246,.06)');
    bg.addColorStop(1, 'rgba(255,255,255,.01)');
    c.fillStyle = bg; c.fillRect(0,0,canvas.width,canvas.height);
    drawPedestal(c, canvas.width/2, 312, 1.85);
    drawPlayerSprite(c, canvas.width/2, 197, game.player.appearance, game.player.class, { attack: 0, moving: false, equipment: game.player.equipment }, 3.2, game.player.spec);
  };

  // 상점 모달 명칭 보강
  if (typeof window.openUpgradeShopModalV28 === 'function') {
    const baseUpgradeModal = window.openUpgradeShopModalV28;
    window.openUpgradeShopModalV28 = function() { baseUpgradeModal(); const h = document.querySelector('#modalContent h2'); if (h) h.textContent = '대장장이 진명'; };
  }
  if (typeof window.openPetShopModalV27 === 'function') {
    const oldPetModal = window.openPetShopModalV27;
    window.openPetShopModalV27 = function() { oldPetModal(); const hero = document.querySelector('.pet-shop-hero-v27'); if (hero) hero.classList.add('pet-shop-hero-v29'); const h2 = document.querySelector('#modalContent h2'); if (h2) h2.textContent = '펫 수정구'; };
  }

  // 입장/퇴장 문구 보정
  if (typeof window.enterUpgradeShopInteriorV27 === 'function') {
    const oldEnterUpgrade = window.enterUpgradeShopInteriorV27;
    window.enterUpgradeShopInteriorV27 = function(){ oldEnterUpgrade(); appendChatMessage?.('system','이동','대장간 내부로 들어왔습니다.'); };
  }
  if (typeof window.enterPetShopInteriorV27 === 'function') {
    const oldEnterPet = window.enterPetShopInteriorV27;
    window.enterPetShopInteriorV27 = function(){ oldEnterPet(); appendChatMessage?.('system','이동','펫 상점 내부로 들어왔습니다.'); };
  }
  if (typeof window.exitBuildingToTownV27 === 'function') {
    const oldExit = window.exitBuildingToTownV27;
    window.exitBuildingToTownV27 = function(kind){ oldExit(kind); };
  }

  appendChatMessage?.('system', '패치', 'v29: 대장간/펫 상점 내부 연출, 펫 동행 위치 안정화, 상태창 레이아웃 개선이 적용되었습니다.');
})();



/* =========================
   v30 patch: character panel slot correction + interior collision + fixed shop exits
   ========================= */
(function yuksamV30Patch(){
  if (window.__YUKSAM_V30_PATCH__) return;
  window.__YUKSAM_V30_PATCH__ = true;

  try { document.title = '63월드'; } catch {}

  // 내부 공간을 방어구/특별 상점처럼 작은 고정 룸 느낌으로 통일해서 출구 위치가 화면에서 흔들리지 않도록 한다.
  worldDefs.petShopInterior = WORLD_PATCHES_V30.petShopInterior;
  worldDefs.upgradeShopInterior = WORLD_PATCHES_V30.upgradeShopInterior;
  if (worldDefs.town?.upgradeShop) worldDefs.town.upgradeShop.name = WORLD_PATCHES_V30.townUpgradeShopName;

  try {
    const style = document.createElement('style');
    style.id = 'yuksam-v30-style';
    style.textContent = `
      .character-panel-v7.character-panel-v27{
        grid-template-columns:minmax(460px,.82fr) minmax(360px,1fr);
      }
      .paperdoll-v7{
        min-height:405px !important;
        max-height:430px;
        overflow:hidden;
        border-radius:24px;
      }
      .paperdoll-v7 #characterPanelCanvas{
        width:340px !important;
        height:340px !important;
        margin-top:8px !important;
      }
      .paper-slot{
        width:156px !important;
        min-height:98px !important;
        padding:10px 10px !important;
        border-radius:20px !important;
        z-index:5 !important;
      }
      .paper-slot .slot-icon{
        min-height:36px !important;
        font-size:24px !important;
      }
      .paper-slot b{
        font-size:12px !important;
        line-height:1.25 !important;
        display:block;
        white-space:normal;
      }
      .paper-slot .slot-name{font-size:12px !important;}
      .slot-head-v7{left:56px !important; top:8px !important;}
      .slot-armor-v7{left:56px !important; top:198px !important;}
      .slot-weapon-v7{right:56px !important; top:30px !important;}
      .slot-accessory-v7{right:56px !important; top:182px !important;}
      .slot-connector-v29{display:none !important;}
      .status-panel-v29 .pet-slot-v27{margin-top:10px !important;}
      .status-panel-v29 .mini-stat-grid-v7{margin-top:10px !important;}
      .status-panel-v29 .info-grid.compact-info-v26{gap:7px !important; padding:8px !important;}
      .character-head-v27{padding-bottom:6px !important;}
      .character-window-v27 .panel-card{padding:14px !important;}
    `;
    document.head.appendChild(style);
  } catch {}

  function drawSpeechBubbleV30(ctx, x, y, text, opts = {}) {
    ctx.save();
    ctx.font = opts.font || '900 14px Jua, Noto Sans KR, system-ui';
    ctx.textAlign = 'center';
    const w = Math.min(opts.maxWidth || 280, ctx.measureText(text).width + 28);
    const h = opts.height || 34;
    const bx = x - w / 2, by = y - (opts.offsetY || 90);
    ctx.fillStyle = opts.bg || 'rgba(12,18,30,.90)';
    ctx.strokeStyle = opts.stroke || 'rgba(255,255,255,.20)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, bx, by, w, h, 14); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 8, by + h - 2); ctx.lineTo(x, by + h + 10); ctx.lineTo(x + 8, by + h - 2); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = opts.color || '#f8fafc';
    ctx.fillText(text, x, by + h / 2 + 5);
    ctx.restore();
  }

  function drawBlacksmithJinmyeongV30(ctx, x, y, scale = 1, highlighted = false) {
    if (highlighted) {
      ctx.save();
      const pulse = .6 + Math.sin(performance.now() / 180) * .22;
      ctx.strokeStyle = `rgba(251,191,36,${pulse})`;
      ctx.lineWidth = 4 * scale;
      ctx.beginPath(); ctx.ellipse(x, y + 24 * scale, 32 * scale, 13 * scale, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    drawShadow(ctx, x, y + 30 * scale, 24 * scale, 8 * scale, .28);
    ctx.translate(x, y);
    // 다리
    ctx.fillStyle = '#374151';
    roundRect(ctx, -13*scale, 8*scale, 10*scale, 30*scale, 5*scale); ctx.fill();
    roundRect(ctx, 4*scale, 8*scale, 10*scale, 30*scale, 5*scale); ctx.fill();
    // 몸통/앞치마
    ctx.fillStyle = '#b45309';
    roundRect(ctx, -18*scale, -18*scale, 36*scale, 34*scale, 12*scale); ctx.fill();
    ctx.fillStyle = '#78350f';
    roundRect(ctx, -15*scale, -8*scale, 30*scale, 28*scale, 8*scale); ctx.fill();
    // 팔
    ctx.strokeStyle = '#f1d2b6'; ctx.lineWidth = 8*scale; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(-18*scale, -4*scale); ctx.lineTo(-30*scale, 8*scale); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(18*scale, -5*scale); ctx.lineTo(35*scale, -22*scale); ctx.stroke();
    // 큰 망치
    ctx.save();
    ctx.translate(39*scale, -28*scale);
    ctx.rotate(-0.55 + Math.sin(performance.now()/260)*0.04);
    ctx.fillStyle = '#92400e';
    roundRect(ctx, -3*scale, -2*scale, 7*scale, 44*scale, 4*scale); ctx.fill();
    ctx.fillStyle = '#64748b';
    roundRect(ctx, -16*scale, -13*scale, 34*scale, 17*scale, 5*scale); ctx.fill();
    ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1.4*scale; ctx.strokeRect(-13*scale, -10*scale, 28*scale, 11*scale);
    ctx.restore();
    // 머리
    ctx.fillStyle = '#fff1df';
    ctx.beginPath(); ctx.arc(0, -34*scale, 16*scale, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#3b2415';
    ctx.beginPath(); ctx.arc(0, -43*scale, 15*scale, Math.PI, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#111827';
    ctx.beginPath(); ctx.arc(-5*scale, -35*scale, 1.7*scale, 0, Math.PI*2); ctx.arc(5*scale, -35*scale, 1.7*scale, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#7c2d12'; ctx.lineWidth = 1.2*scale;
    ctx.beginPath(); ctx.arc(0, -30*scale, 4*scale, 0, Math.PI); ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.textAlign='center'; ctx.font=`${Math.round(14*scale)}px Jua, Noto Sans KR, system-ui`;
    const name = '대장장이 진명';
    const nameW = ctx.measureText(name).width + 22 * scale;
    ctx.fillStyle='rgba(7,16,27,.78)'; roundRect(ctx, x-nameW/2, y+45*scale, nameW, 26*scale, 999); ctx.fill();
    ctx.fillStyle='#fff7ed'; ctx.fillText(name, x, y+63*scale);
    ctx.restore();
  }

  function drawForgeDecorationV30() {
    const ctx = game.ctx;
    const anvil = worldToScreen(390, 470);
    const furnace = worldToScreen(890, 390);
    const rack = worldToScreen(980, 260);

    ctx.save();
    // 모루
    ctx.fillStyle = '#1f2937';
    roundRect(ctx, anvil.x - 58, anvil.y - 18, 116, 28, 10); ctx.fill();
    ctx.fillStyle = '#475569';
    roundRect(ctx, anvil.x - 28, anvil.y - 40, 82, 26, 8); ctx.fill();
    ctx.fillStyle = '#334155'; ctx.fillRect(anvil.x - 12, anvil.y - 6, 24, 54);
    drawShadow(ctx, anvil.x, anvil.y + 42, 54, 10, .19);
    ctx.fillStyle='#e2e8f0'; ctx.font='900 18px Jua, Noto Sans KR'; ctx.textAlign='center'; ctx.fillText('모루', anvil.x, anvil.y + 74);

    // 용광로
    ctx.fillStyle = '#5b341d';
    roundRect(ctx, furnace.x - 80, furnace.y - 90, 160, 190, 24); ctx.fill();
    ctx.fillStyle = '#7c2d12';
    roundRect(ctx, furnace.x - 52, furnace.y - 42, 104, 90, 14); ctx.fill();
    const glow = ctx.createRadialGradient(furnace.x, furnace.y + 4, 10, furnace.x, furnace.y + 4, 72);
    glow.addColorStop(0, 'rgba(254,215,170,.95)'); glow.addColorStop(.35, 'rgba(249,115,22,.82)'); glow.addColorStop(1, 'rgba(124,45,18,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(furnace.x, furnace.y + 4, 72, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f97316';
    for (let i = 0; i < 7; i += 1) {
      const t = performance.now() / 200 + i * .7;
      ctx.globalAlpha = .42 + Math.sin(t) * .18;
      ctx.beginPath(); ctx.arc(furnace.x - 38 + i * 13, furnace.y - 26 - Math.sin(t) * 14, 4 + (i % 2), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle='#ffedd5'; ctx.fillText('용광로', furnace.x, furnace.y + 122);

    // 공구 걸이
    ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(rack.x - 70, rack.y); ctx.lineTo(rack.x + 70, rack.y); ctx.stroke();
    ctx.font = '900 28px Noto Sans KR, Apple Color Emoji, Segoe UI Emoji'; ctx.fillStyle='#fff7ed';
    ctx.fillText('🔨', rack.x - 40, rack.y + 34);
    ctx.fillText('⚒', rack.x, rack.y + 34);
    ctx.fillText('🪚', rack.x + 42, rack.y + 34);
    ctx.restore();
  }

  function drawPetShopDecorV30() {
    const ctx = game.ctx;
    const crystals = [
      { x: 310, y: 455, c:'#f0abfc' }, { x: 870, y: 460, c:'#93c5fd' },
      { x: 960, y: 230, c:'#fde68a' }, { x: 230, y: 245, c:'#c084fc' }
    ];
    crystals.forEach((cr) => {
      const p = worldToScreen(cr.x, cr.y);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.fillStyle = cr.c; ctx.globalAlpha = .38;
      ctx.beginPath(); ctx.moveTo(0, -24); ctx.lineTo(22, 0); ctx.lineTo(0, 30); ctx.lineTo(-22, 0); ctx.closePath(); ctx.fill();
      ctx.restore();
    });
    const paw = worldToScreen(590, 520);
    ctx.save(); ctx.textAlign='center'; ctx.font='900 76px Apple Color Emoji, Segoe UI Emoji'; ctx.globalAlpha=.13; ctx.fillText('🐾', paw.x, paw.y); ctx.restore();
  }

  function drawPetShopInteriorV30() {
    const ctx = game.ctx, world = worldDefs.petShopInterior;
    ctx.clearRect(0,0,game.width,game.height);
    const g = ctx.createLinearGradient(0,0,0,game.height);
    g.addColorStop(0,'#432f56'); g.addColorStop(.5,'#281f3f'); g.addColorStop(1,'#111827');
    ctx.fillStyle = g; ctx.fillRect(0,0,game.width,game.height);
    drawTerrainDots(ctx, world, '#ffffff', .038, 30, 9);
    drawPetShopDecorV30();
    drawCrystalPedestalWorld(world.orb.x, world.orb.y, '#f9a8d4');
    const orb = worldToScreen(world.orb.x, world.orb.y);
    const t = performance.now() / 520;
    ctx.save();
    const halo = ctx.createRadialGradient(orb.x, orb.y - 30, 8, orb.x, orb.y - 30, 102);
    halo.addColorStop(0, 'rgba(244,114,182,.65)'); halo.addColorStop(.5, 'rgba(217,70,239,.18)'); halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(orb.x, orb.y - 30, 102, 0, Math.PI * 2); ctx.fill();
    // v27에서 좋았던 펫 위성 애니메이션 복구
    ['🐤','🍄','🐉','🐱','🐶'].forEach((ic,i) => {
      const a = t + i * 1.25;
      ctx.font = '900 30px Noto Sans KR, Apple Color Emoji, Segoe UI Emoji, system-ui';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.globalAlpha = .92;
      ctx.fillText(ic, orb.x + Math.cos(a) * 78, orb.y - 46 + Math.sin(a) * 28);
    });
    ctx.globalAlpha = 1;
    ctx.font = '900 15px Jua, Noto Sans KR, system-ui';
    ctx.fillStyle = '#fff7ed'; ctx.strokeStyle='rgba(15,23,42,.7)'; ctx.lineWidth=4;
    ctx.strokeText('펫 수정구', orb.x, orb.y - 92); ctx.fillText('펫 수정구', orb.x, orb.y - 92);
    const lines = ['반짝이는 친구를 만나볼래?', '귀여운 펫들이 기다리고 있어!', '10빌딩으로 새로운 동행을 소환해봐!'];
    drawSpeechBubbleV30(ctx, orb.x, orb.y - 10, lines[Math.floor(Date.now() / 5000) % lines.length], { bg:'rgba(56,35,74,.92)', stroke:'rgba(244,114,182,.45)', color:'#fdf2f8', offsetY:122, maxWidth:260 });
    ctx.restore();
    const ex = worldToScreen(world.exit.x, world.exit.y); drawExitMarker(ex.x, ex.y); drawTitleLabel('펫 상점');
  }

  function drawUpgradeShopInteriorV30() {
    const ctx = game.ctx, world = worldDefs.upgradeShopInterior;
    ctx.clearRect(0,0,game.width,game.height);
    const g = ctx.createLinearGradient(0,0,0,game.height);
    g.addColorStop(0,'#4a2817'); g.addColorStop(.48,'#2f1d16'); g.addColorStop(1,'#0f172a');
    ctx.fillStyle = g; ctx.fillRect(0,0,game.width,game.height);
    drawTerrainDots(ctx, world, '#fbbf24', .042, 34, 9);
    drawForgeDecorationV30();
    const p = worldToScreen(world.blacksmith.x, world.blacksmith.y);
    drawShopCounter(world.blacksmith.x, world.blacksmith.y + 92, '대장간', '#f97316');
    drawBlacksmithJinmyeongV30(ctx, p.x, p.y, NPC_WORLD_SCALE, isNearPoint(world.blacksmith, 96));
    const chats = ['무기를 벼려 더 강해져 보게.', '등급이 오를수록 빛이 달라지지.', '강화에는 3빌딩이 필요하네.'];
    drawSpeechBubbleV30(ctx, p.x, p.y, chats[Math.floor(Date.now()/5500)%chats.length], { bg:'rgba(63,29,13,.92)', stroke:'rgba(251,191,36,.38)', color:'#fff7ed', offsetY:120, maxWidth:240 });
    const ex = worldToScreen(world.exit.x, world.exit.y); drawExitMarker(ex.x, ex.y); drawTitleLabel('대장간');
  }

  function drawPetFollowerV30(ctx) {
    if (!game.player) return;
    const petDefs = window.PET_DEFS_V27 || {};
    const pet = petDefs[game.player.activePet];
    if (!pet) return;
    const now = performance.now();
    const dir = game.lastMove || { x: 1, y: 0 };
    if (Math.abs(dir.x) > 0.1) game.player._petSide = dir.x > 0 ? 'left' : 'right';
    const side = game.player._petSide || 'left';
    const moving = !!game.isMoving;
    const dancing = (game.danceTimer || 0) > 0;
    const wx = game.player.x + (side === 'left' ? -54 : 54) + (dancing ? Math.sin(now / 90) * 4 : 0);
    const wy = game.player.y + 8 - (moving ? Math.abs(Math.sin(now / 120 + (pet.bob || 0))) * 11 : Math.sin(now / 340 + (pet.bob || 0)) * 2.5);
    const p = worldToScreen(wx, wy);
    ctx.save();
    drawShadow(ctx, p.x, p.y + 24, 18, 6, .16);
    ctx.translate(p.x, p.y);
    ctx.rotate(dancing ? Math.sin(now / 95 + (pet.bob || 0)) * 0.2 : Math.sin(now / 500 + (pet.bob || 0)) * 0.03);
    const bounce = dancing ? 1.08 + Math.sin(now / 70) * .06 : 1 + Math.sin(now / 460 + (pet.bob || 0)) * .02;
    ctx.scale(bounce, bounce);
    ctx.font = '900 33px Noto Sans KR, Apple Color Emoji, Segoe UI Emoji, system-ui';
    ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.lineWidth=4; ctx.strokeStyle='rgba(15,23,42,.52)';
    ctx.strokeText(pet.icon, 0, 0); ctx.fillText(pet.icon, 0, 0);
    if (moving) {
      ctx.fillStyle = pet.color || '#fde68a'; ctx.globalAlpha = .74;
      ctx.beginPath(); ctx.ellipse(-8, 20, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(8, 20, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
    }
    if (dancing) {
      ctx.globalAlpha = .92; ctx.font = '900 15px Jua, Noto Sans KR, system-ui'; ctx.fillStyle = pet.color || '#fde68a';
      ctx.fillText('♪', -22, -24); ctx.fillText('♬', 22, -30);
    }
    ctx.restore();
  }

  // 실내 오브젝트/NPC 충돌 추가
  // 실내 렌더링과 펫 중복 표시 방지

  // 상태창이 열려있는 DOM에 즉시 레이아웃 보정 적용
  function applyCharacterPanelV30() {
    const statusPanel = document.querySelector('.status-panel-v27');
    if (statusPanel) statusPanel.classList.add('status-panel-v29');
    const paper = document.querySelector('.paperdoll-v7');
    if (paper) paper.querySelectorAll('.slot-connector-v29').forEach((el) => el.remove());
    try { drawCharacterPanelCanvas(); } catch {}
  }
  const oldOpenCharacterPanelV30 = window.openCharacterPanel || openCharacterPanel;
  window.openCharacterPanel = openCharacterPanel;
  window.openStatsModal = openCharacterPanel;
  window.openEquipmentModal = openCharacterPanel;


  appendChatMessage?.('system', '패치', 'v30: 상태창 슬롯 위치 재조정, 실내 충돌, 고정 출구, 펫 수정구 위성 애니메이션 복구가 적용되었습니다.');
})();


/* =========================
   v31 patch: v26 paperdoll restore + game tooltip + pet summon flow + final boss room player visibility
   ========================= */
(function yuksamV31Patch(){
  if (window.__YUKSAM_V31_PATCH__) return;
  window.__YUKSAM_V31_PATCH__ = true;

  try { document.title = '63월드'; } catch {}

  // 1) 캐릭터/장비가 보이는 paperdoll 영역은 v26 느낌으로 복구하고,
  //    위 상태 정보/아래 동행 펫/스탯 영역은 유지한다.
  try {
    const style = document.createElement('style');
    style.id = 'yuksam-v31-style';
    style.textContent = `
      .character-panel-v7.character-panel-v27{
        grid-template-columns:minmax(520px,.95fr) minmax(360px,1.05fr) !important;
      }
      .paperdoll-v7{
        min-height:500px !important;
        max-height:none !important;
        overflow:hidden !important;
        display:grid !important;
        place-items:center !important;
        border-radius:28px !important;
        background:
          radial-gradient(circle at 50% 38%, rgba(92,200,255,.18), rgba(255,255,255,.035) 42%, rgba(0,0,0,.10)),
          linear-gradient(180deg, rgba(255,255,255,.04), rgba(255,255,255,.02)) !important;
        border:1px solid rgba(255,255,255,.10) !important;
      }
      .paperdoll-v7 #characterPanelCanvas{
        width:420px !important;
        height:420px !important;
        align-self:center !important;
        justify-self:center !important;
        margin-top:-12px !important;
        background:transparent !important;
        border:0 !important;
      }
      .paper-slot{
        position:absolute !important;
        width:148px !important;
        min-height:118px !important;
        padding:12px !important;
        z-index:3 !important;
        backdrop-filter:blur(10px) !important;
        background:rgba(7,16,28,.62) !important;
        border-color:rgba(139,230,255,.22) !important;
        box-shadow:0 14px 35px rgba(0,0,0,.20) !important;
        border-radius:22px !important;
      }
      .paper-slot .slot-icon{
        min-height:44px !important;
        font-size:26px !important;
      }
      .paper-slot b{
        font-size:13px !important;
        line-height:1.28 !important;
        display:block;
        white-space:normal;
      }
      .paper-slot .slot-name{font-size:12px !important;}
      .slot-head-v7{left:18px !important; top:28px !important;}
      .slot-armor-v7{left:18px !important; bottom:34px !important; top:auto !important;}
      .slot-weapon-v7{right:18px !important; top:28px !important;}
      .slot-accessory-v7{right:18px !important; bottom:34px !important; top:auto !important;}
      .slot-connector-v29{display:none !important;}
      .ys-tooltip-v31{
        position:fixed;
        z-index:99999;
        min-width:210px;
        max-width:340px;
        pointer-events:none;
        opacity:0;
        transform:translateY(4px) scale(.98);
        transition:opacity .08s ease, transform .08s ease;
        padding:13px 14px;
        border-radius:16px;
        background:
          radial-gradient(circle at 18% 0%, rgba(96,165,250,.18), transparent 32%),
          linear-gradient(180deg, rgba(15,23,42,.97), rgba(2,6,23,.96));
        border:1px solid rgba(125,211,252,.34);
        box-shadow:0 18px 50px rgba(0,0,0,.50), inset 0 1px 0 rgba(255,255,255,.08);
        color:#e5f2ff;
        font-family:Noto Sans KR, system-ui, sans-serif;
        font-size:13px;
        line-height:1.45;
        white-space:pre-line;
      }
      .ys-tooltip-v31.show{opacity:1; transform:translateY(0) scale(1);}
      .ys-tooltip-v31 .tt-name{
        display:block;
        font-weight:900;
        font-size:15px;
        color:#fff;
        margin-bottom:6px;
        padding-bottom:7px;
        border-bottom:1px solid rgba(148,163,184,.20);
      }
      .ys-tooltip-v31 .tt-line{display:block; color:#bfdbfe; margin:2px 0;}
      .ys-tooltip-v31 .tt-muted{display:block; color:#94a3b8; margin-top:6px; font-size:12px;}
      .pet-summon-modal-v31{
        position:fixed;
        inset:0;
        z-index:99998;
        display:grid;
        place-items:center;
        background:radial-gradient(circle at 50% 45%, rgba(147,51,234,.22), rgba(0,0,0,.92) 56%, rgba(0,0,0,.98));
        color:#fff;
        text-align:center;
      }
      .pet-summon-box-v31{
        min-width:360px;
        padding:34px 38px;
        border-radius:28px;
        background:linear-gradient(180deg, rgba(30,18,48,.88), rgba(8,12,24,.88));
        border:1px solid rgba(244,114,182,.30);
        box-shadow:0 30px 90px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.08);
      }
      .pet-orb-loader-v31{
        width:108px;height:108px;margin:0 auto 18px;border-radius:999px;
        background:radial-gradient(circle at 38% 28%, #fff, #f9a8d4 30%, #9333ea 62%, #312e81);
        box-shadow:0 0 42px rgba(217,70,239,.60);
        animation:petOrbPulseV31 1.2s infinite ease-in-out;
      }
      .pet-icon-result-v31{font-size:76px; margin:4px 0 14px; filter:drop-shadow(0 10px 20px rgba(0,0,0,.36));}
      .pet-loading-bar-v31{
        height:11px;border-radius:999px;overflow:hidden;background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.12);margin-top:18px;
      }
      .pet-loading-bar-v31 b{
        display:block;height:100%;width:0%;
        background:linear-gradient(90deg,#f9a8d4,#a78bfa,#67e8f9);
        animation:petLoadingV31 5s linear forwards;
      }
      @keyframes petOrbPulseV31{0%,100%{transform:scale(.96);opacity:.86}50%{transform:scale(1.06);opacity:1}}
      @keyframes petLoadingV31{to{width:100%}}
    `;
    document.head.appendChild(style);
  } catch {}


  if (!window.__YUKSAM_V31_DRAWWEAPON_PATCH__) {
    window.__YUKSAM_V31_DRAWWEAPON_PATCH__ = true;
    const oldDrawWeaponV31 = drawWeapon;
  drawWeapon = function drawWeaponV31(...args) {
    if (window.__YUKSAM_DRAWING_JINMYEONG__) return;
    const result = oldDrawWeaponV31(...args);
    const [ctx, klass, scale, swing, , itemId, , tierStyle] = args;
    drawWeaponTierOutline(ctx, klass, scale, swing, itemId, tierStyle);
    return result;
  };
  }

  // 2) title 기본 툴팁 대신 게임식 커스텀 툴팁을 즉시 표시한다.
  function ensureGameTooltipV31() {
    let el = document.querySelector('.ys-tooltip-v31');
    if (!el) {
      el = document.createElement('div');
      el.className = 'ys-tooltip-v31';
      document.body.appendChild(el);
    }
    return el;
  }
  function formatTooltipV31(raw) {
    const lines = String(raw || '').split(/\n+/).filter(Boolean);
    if (!lines.length) return '';
    const [name, ...rest] = lines;
    return `<span class="tt-name">${escapeHtml(name)}</span>${rest.map((line, idx) => {
      const cls = idx >= rest.length - 1 ? 'tt-muted' : 'tt-line';
      return `<span class="${cls}">${escapeHtml(line)}</span>`;
    }).join('')}`;
  }
  function moveTooltipV31(e) {
    const tip = ensureGameTooltipV31();
    const pad = 18;
    const rectW = Math.min(340, Math.max(210, tip.offsetWidth || 240));
    const rectH = tip.offsetHeight || 120;
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    if (x + rectW > window.innerWidth - 10) x = e.clientX - rectW - pad;
    if (y + rectH > window.innerHeight - 10) y = e.clientY - rectH - pad;
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${Math.max(8, y)}px`;
  }
  document.addEventListener('mouseover', (e) => {
    const target = e.target.closest('[title], [data-tooltip]');
    if (!target) return;
    if (target.title) {
      target.dataset.tooltip = target.title;
      target.dataset.nativeTitle = target.title;
      target.removeAttribute('title');
    }
    const raw = target.dataset.tooltip;
    if (!raw) return;
    const tip = ensureGameTooltipV31();
    tip.innerHTML = formatTooltipV31(raw);
    moveTooltipV31(e);
    requestAnimationFrame(() => tip.classList.add('show'));
  }, true);
  document.addEventListener('mousemove', (e) => {
    const tip = document.querySelector('.ys-tooltip-v31.show');
    if (tip) moveTooltipV31(e);
  }, true);
  document.addEventListener('mouseout', (e) => {
    const target = e.target.closest('[data-tooltip]');
    if (!target) return;
    const to = e.relatedTarget;
    if (to && target.contains(to)) return;
    const tip = ensureGameTooltipV31();
    tip.classList.remove('show');
  }, true);


  function drawSpeechBubbleV31(ctx, x, y, text, opts = {}) {
    ctx.save();
    ctx.font = opts.font || '900 14px Jua, Noto Sans KR, system-ui';
    ctx.textAlign = 'center';
    const w = Math.min(opts.maxWidth || 280, ctx.measureText(text).width + 28);
    const h = opts.height || 34;
    const bx = x - w / 2, by = y - (opts.offsetY || 90);
    ctx.fillStyle = opts.bg || 'rgba(12,18,30,.90)';
    ctx.strokeStyle = opts.stroke || 'rgba(255,255,255,.20)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, bx, by, w, h, 14); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 8, by + h - 2); ctx.lineTo(x, by + h + 10); ctx.lineTo(x + 8, by + h - 2); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = opts.color || '#f8fafc';
    ctx.fillText(text, x, by + h / 2 + 5);
    ctx.restore();
  }

  function drawPetShopDecorV31() {
    const ctx = game.ctx;
    const crystals = [
      { x: 310, y: 455, c:'#f0abfc' }, { x: 870, y: 460, c:'#93c5fd' },
      { x: 960, y: 230, c:'#fde68a' }, { x: 230, y: 245, c:'#c084fc' }
    ];
    crystals.forEach((cr) => {
      const p = worldToScreen(cr.x, cr.y);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.fillStyle = cr.c; ctx.globalAlpha = .38;
      ctx.beginPath(); ctx.moveTo(0, -24); ctx.lineTo(22, 0); ctx.lineTo(0, 30); ctx.lineTo(-22, 0); ctx.closePath(); ctx.fill();
      ctx.restore();
    });
    const paw = worldToScreen(590, 520);
    ctx.save(); ctx.textAlign='center'; ctx.font='900 76px Apple Color Emoji, Segoe UI Emoji'; ctx.globalAlpha=.13; ctx.fillText('🐾', paw.x, paw.y); ctx.restore();
  }

  function drawPetFollowerV31(ctx) {
    if (!game.player) return;
    const petDefs = window.PET_DEFS_V27 || {};
    const pet = petDefs[game.player.activePet];
    if (!pet) return;
    const now = performance.now();
    const dir = game.lastMove || { x: 1, y: 0 };
    if (Math.abs(dir.x) > 0.1) game.player._petSide = dir.x > 0 ? 'left' : 'right';
    const side = game.player._petSide || 'left';
    const moving = !!game.isMoving;
    const dancing = (game.danceTimer || 0) > 0;
    const wx = game.player.x + (side === 'left' ? -54 : 54) + (dancing ? Math.sin(now / 90) * 4 : 0);
    const wy = game.player.y + 8 - (moving ? Math.abs(Math.sin(now / 120 + (pet.bob || 0))) * 11 : Math.sin(now / 340 + (pet.bob || 0)) * 2.5);
    const p = worldToScreen(wx, wy);
    ctx.save();
    drawShadow(ctx, p.x, p.y + 24, 18, 6, .16);
    ctx.translate(p.x, p.y);
    ctx.rotate(dancing ? Math.sin(now / 95 + (pet.bob || 0)) * 0.2 : Math.sin(now / 500 + (pet.bob || 0)) * 0.03);
    const bounce = dancing ? 1.08 + Math.sin(now / 70) * .06 : 1 + Math.sin(now / 460 + (pet.bob || 0)) * .02;
    ctx.scale(bounce, bounce);
    ctx.font = '900 33px Noto Sans KR, Apple Color Emoji, Segoe UI Emoji, system-ui';
    ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.lineWidth=4; ctx.strokeStyle='rgba(15,23,42,.52)';
    ctx.strokeText(pet.icon, 0, 0); ctx.fillText(pet.icon, 0, 0);
    if (moving) {
      ctx.fillStyle = pet.color || '#fde68a'; ctx.globalAlpha = .74;
      ctx.beginPath(); ctx.ellipse(-8, 20, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(8, 20, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
    }
    if (dancing) {
      ctx.globalAlpha = .92; ctx.font = '900 15px Jua, Noto Sans KR, system-ui'; ctx.fillStyle = pet.color || '#fde68a';
      ctx.fillText('♪', -22, -24); ctx.fillText('♬', 22, -30);
    }
    ctx.restore();
  }

  // 3) 대장간 오브젝트 글자 삭제 및 길 확보: 모루/용광로 위치를 가장자리 쪽으로 이동.
  function drawForgeDecorationV31() {
    const ctx = game.ctx;
    const anvil = worldToScreen(285, 475);
    const furnace = worldToScreen(930, 402);
    const rack = worldToScreen(980, 238);
    ctx.save();
    // 모루
    ctx.fillStyle = '#1f2937';
    roundRect(ctx, anvil.x - 54, anvil.y - 18, 108, 28, 10); ctx.fill();
    ctx.fillStyle = '#475569';
    roundRect(ctx, anvil.x - 28, anvil.y - 40, 78, 26, 8); ctx.fill();
    ctx.fillStyle = '#334155'; ctx.fillRect(anvil.x - 12, anvil.y - 6, 24, 54);
    drawShadow(ctx, anvil.x, anvil.y + 42, 54, 10, .19);

    // 용광로
    ctx.fillStyle = '#5b341d';
    roundRect(ctx, furnace.x - 72, furnace.y - 86, 144, 178, 24); ctx.fill();
    ctx.fillStyle = '#7c2d12';
    roundRect(ctx, furnace.x - 46, furnace.y - 38, 92, 84, 14); ctx.fill();
    const glow = ctx.createRadialGradient(furnace.x, furnace.y + 4, 10, furnace.x, furnace.y + 4, 72);
    glow.addColorStop(0, 'rgba(254,215,170,.95)'); glow.addColorStop(.35, 'rgba(249,115,22,.82)'); glow.addColorStop(1, 'rgba(124,45,18,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(furnace.x, furnace.y + 4, 72, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f97316';
    for (let i = 0; i < 7; i += 1) {
      const t = performance.now() / 200 + i * .7;
      ctx.globalAlpha = .42 + Math.sin(t) * .18;
      ctx.beginPath(); ctx.arc(furnace.x - 38 + i * 13, furnace.y - 26 - Math.sin(t) * 14, 4 + (i % 2), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 공구 걸이
    ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(rack.x - 70, rack.y); ctx.lineTo(rack.x + 70, rack.y); ctx.stroke();
    ctx.font = '900 28px Noto Sans KR, Apple Color Emoji, Segoe UI Emoji'; ctx.textAlign='center';
    ctx.fillText('🔨', rack.x - 40, rack.y + 34);
    ctx.fillText('⚒', rack.x, rack.y + 34);
    ctx.fillText('🪚', rack.x + 42, rack.y + 34);
    ctx.restore();
  }

  // 4) 진명은 기본 NPC와 같은 몸체를 사용하되, 무기 대신 큰 망치만 추가한다.
  function drawBlacksmithJinmyeongV31(ctx, x, y, scale = 1, highlighted = false) {
    // 기존 우리 게임 NPC 스타일 그대로 사용하되, 기본 책/검 무기만 숨긴다.
    window.__YUKSAM_DRAWING_JINMYEONG__ = true;
    try { drawNpcSprite(ctx, x, y, '대장장이 진명', false, scale, highlighted, 'priest'); }
    finally { window.__YUKSAM_DRAWING_JINMYEONG__ = false; }
    ctx.save();
    ctx.translate(x + 30 * scale, y - 17 * scale);
    ctx.rotate(-0.55 + Math.sin(performance.now() / 280) * 0.035);
    ctx.fillStyle = '#92400e';
    roundRect(ctx, -3 * scale, -2 * scale, 7 * scale, 52 * scale, 4 * scale); ctx.fill();
    ctx.fillStyle = '#64748b';
    roundRect(ctx, -20 * scale, -15 * scale, 42 * scale, 20 * scale, 6 * scale); ctx.fill();
    ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1.5 * scale;
    ctx.strokeRect(-16 * scale, -11 * scale, 34 * scale, 12 * scale);
    ctx.restore();
  }

  function drawUpgradeShopInteriorV31() {
    const ctx = game.ctx, world = worldDefs.upgradeShopInterior;
    ctx.clearRect(0,0,game.width,game.height);
    const g = ctx.createLinearGradient(0,0,0,game.height);
    g.addColorStop(0,'#4a2817'); g.addColorStop(.48,'#2f1d16'); g.addColorStop(1,'#0f172a');
    ctx.fillStyle = g; ctx.fillRect(0,0,game.width,game.height);
    drawTerrainDots(ctx, world, '#fbbf24', .042, 34, 9);
    drawForgeDecorationV31();
    const p = worldToScreen(world.blacksmith.x, world.blacksmith.y);
    drawShopCounter(world.blacksmith.x, world.blacksmith.y + 92, '대장간', '#f97316');
    drawBlacksmithJinmyeongV31(ctx, p.x, p.y, NPC_WORLD_SCALE, isNearPoint(world.blacksmith, 102));
    const chats = ['무기를 벼려 더 강해져 보게.', '등급이 오를수록 빛이 달라지지.', '강화에는 3빌딩이 필요하네.'];
    drawSpeechBubbleV31(ctx, p.x, p.y, chats[Math.floor(Date.now()/5500)%chats.length], { bg:'rgba(63,29,13,.92)', stroke:'rgba(251,191,36,.38)', color:'#fff7ed', offsetY:120, maxWidth:240 });
    const ex = worldToScreen(world.exit.x, world.exit.y); drawExitMarker(ex.x, ex.y); drawTitleLabel('대장간');
  }

  // 5) 펫 수정구: 상호작용 범위 확장, 말풍선은 이름을 가리지 않도록 조금 위로 이동.
  function drawPetShopInteriorV31() {
    const ctx = game.ctx, world = worldDefs.petShopInterior;
    ctx.clearRect(0,0,game.width,game.height);
    const g = ctx.createLinearGradient(0,0,0,game.height);
    g.addColorStop(0,'#432f56'); g.addColorStop(.5,'#281f3f'); g.addColorStop(1,'#111827');
    ctx.fillStyle = g; ctx.fillRect(0,0,game.width,game.height);
    drawTerrainDots(ctx, world, '#ffffff', .038, 30, 9);
    drawPetShopDecorV31();
    drawCrystalPedestalWorld(world.orb.x, world.orb.y, '#f9a8d4');
    const orb = worldToScreen(world.orb.x, world.orb.y);
    const t = performance.now() / 520;
    ctx.save();
    const halo = ctx.createRadialGradient(orb.x, orb.y - 30, 8, orb.x, orb.y - 30, 102);
    halo.addColorStop(0, 'rgba(244,114,182,.65)'); halo.addColorStop(.5, 'rgba(217,70,239,.18)'); halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(orb.x, orb.y - 30, 102, 0, Math.PI * 2); ctx.fill();
    ['🐤','🍄','🐉','🐱','🐶'].forEach((ic,i) => {
      const a = t + i * 1.25;
      ctx.font = '900 30px Noto Sans KR, Apple Color Emoji, Segoe UI Emoji, system-ui';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.globalAlpha = .92;
      ctx.fillText(ic, orb.x + Math.cos(a) * 78, orb.y - 46 + Math.sin(a) * 28);
    });
    ctx.globalAlpha = 1;
    ctx.font = '900 15px Jua, Noto Sans KR, system-ui';
    ctx.fillStyle = '#fff7ed'; ctx.strokeStyle='rgba(15,23,42,.7)'; ctx.lineWidth=4;
    ctx.strokeText('펫 수정구', orb.x, orb.y - 92); ctx.fillText('펫 수정구', orb.x, orb.y - 92);
    const lines = ['반짝이는 친구를 만나볼래?', '귀여운 펫들이 기다리고 있어!', '10빌딩으로 새로운 동행을 소환해봐!'];
    drawSpeechBubbleV31(ctx, orb.x, orb.y - 22, lines[Math.floor(Date.now() / 5000) % lines.length], { bg:'rgba(56,35,74,.92)', stroke:'rgba(244,114,182,.45)', color:'#fdf2f8', offsetY:144, maxWidth:260 });
    ctx.restore();
    const ex = worldToScreen(world.exit.x, world.exit.y); drawExitMarker(ex.x, ex.y); drawTitleLabel('펫 상점');
  }

  // 6) 펫 상점 대화창은 목록 제거, 중앙 소환 버튼만 표시.
  function openPetShopModalV31() {
    ensurePlayerV27Fields?.();
    openModal(`<h2>펫 수정구</h2>
      <div class="panel-card pet-shop-hero-v27 pet-shop-hero-v29" style="text-align:center;display:grid;gap:14px;place-items:center;">
        <div><b>랜덤 펫 소환</b><p>수정구의 빛을 따라 새로운 동행을 만납니다.</p><p class="muted">비용: 10빌딩</p></div>
        <button class="primary" onclick="rollPetV31()">랜덤 펫 소환</button>
      </div>
      <div class="panel-card" style="text-align:center"><b>보유 빌딩:</b> ${game.player?.building || 0}</div>`, { type:'petShop', pause:true });
  }

  window.rollPetV31 = function rollPetV31() {
    ensurePlayerV27Fields?.();
    if ((game.player.building || 0) < 10) { toast('빌딩 화폐가 부족합니다. 펫 소환에는 10빌딩이 필요합니다.'); return; }
    const ids = Object.keys(window.PET_DEFS_V27 || {});
    const notOwned = ids.filter((id) => !game.player.pets.includes(id));
    const pool = notOwned.length ? notOwned : ids;
    const id = pool[Math.floor(Math.random() * pool.length)];
    const pet = window.PET_DEFS_V27[id];
    if (!pet) return;
    closeModal();
    playSfx?.('open');
    const overlay = document.createElement('div');
    overlay.className = 'pet-summon-modal-v31';
    overlay.innerHTML = `<div class="pet-summon-box-v31">
      <div class="pet-orb-loader-v31"></div>
      <h2>펫을 만나는 중...</h2>
      <p>수정구 너머에서 작은 친구가 다가오고 있습니다.</p>
      <div class="pet-loading-bar-v31"><b></b></div>
    </div>`;
    document.body.appendChild(overlay);
    setTimeout(() => {
      game.player.building -= 10;
      if (!game.player.pets.includes(id)) game.player.pets.push(id);
      game.player.activePet = id;
      ensurePlayerHp?.(); savePlayer?.(); updateHud?.(); playSfx?.('coin');
      overlay.innerHTML = `<div class="pet-summon-box-v31">
        <div class="pet-icon-result-v31">${pet.icon}</div>
        <h2>${escapeHtml(pet.name)}을(를) 만났습니다!</h2>
        <button class="primary wide" onclick="closePetSummonResultV31()">확인</button>
      </div>`;
      appendChatMessage?.('system', '펫', `${pet.name}을(를) 만났습니다.`);
    }, 5000);
  };
  window.closePetSummonResultV31 = function closePetSummonResultV31() {
    document.querySelector('.pet-summon-modal-v31')?.remove();
    closeModal?.();
  };

  // 7) 실내 충돌을 새 위치에 맞게 갱신 + 펫 수정구 대화 범위 약간 확대.


  function applyCharacterPanelV31() {
    const statusPanel = document.querySelector('.status-panel-v27');
    if (statusPanel) statusPanel.classList.add('status-panel-v29');
    const paper = document.querySelector('.paperdoll-v7');
    if (paper) paper.querySelectorAll('.slot-connector-v29').forEach((el) => el.remove());
    try { drawCharacterPanelCanvas(); } catch {}
  }
  const oldOpenCharacterPanelV31 = window.openCharacterPanel || openCharacterPanel;
  openCharacterPanel = function openCharacterPanelV31() {
    oldOpenCharacterPanelV31();
    setTimeout(applyCharacterPanelV31, 30);
  };
  window.openCharacterPanel = openCharacterPanel;
  window.openStatsModal = openCharacterPanel;
  window.openEquipmentModal = openCharacterPanel;

  appendChatMessage?.('system', '패치', 'v31: 장비창 캐릭터 영역 v26 복구, 게임식 툴팁, 펫 소환 연출, 최종 보스방 플레이어 표시 보정이 적용되었습니다.');
})();

/* =========================
   v32 patch: character panel resource column + destroy button + forge/pet shop polish
   ========================= */
(function yuksamV32Patch(){
  if (window.__YUKSAM_V32_PATCH__) return;
  window.__YUKSAM_V32_PATCH__ = true;

  try { document.title = '63월드'; } catch {}

  // 신규 강화 진행음 교체 후, 대장간/펫상점에서도 마을 BGM이 계속 흐르도록 보정한다.
  const oldGetDesiredAudioFileV32 = getDesiredAudioFile;
  getDesiredAudioFile = function getDesiredAudioFileV32() {
    if (!game.settings?.bgmEnabled) return null;
    if (screens.game.classList.contains('active') && ['petShopInterior','upgradeShopInterior'].includes(game.currentMap || '')) return game.audio.file || null;
    return oldGetDesiredAudioFileV32();
  };

  try {
    const style = document.createElement('style');
    style.id = 'yuksam-v32-style';
    style.textContent = `
      .character-panel-v32{grid-template-columns:minmax(520px,.95fr) minmax(390px,1.05fr)!important;align-items:start;}
      .character-left-v32 .identity-strip-v32{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:10px;}
      .identity-chip-v32{border-radius:14px;padding:9px 10px;background:rgba(15,23,42,.62);border:1px solid rgba(148,163,184,.14);}
      .identity-chip-v32 span{display:block;font-size:11px;color:#9fb7d4;font-weight:800;}
      .identity-chip-v32 b{display:block;color:#f8fafc;font-size:14px;margin-top:2px;}
      .character-right-v32{display:flex;flex-direction:column;gap:12px;min-width:0;}
      .resource-panel-v32{background:linear-gradient(180deg,rgba(12,21,38,.92),rgba(5,10,22,.88));border:1px solid rgba(125,211,252,.16);border-radius:20px;padding:14px;box-shadow:inset 0 1px 0 rgba(255,255,255,.06);}
      .resource-row-v32{display:grid;grid-template-columns:56px 1fr auto;gap:8px;align-items:center;margin:8px 0;font-size:12px;font-weight:900;color:#dbeafe;}
      .resource-bar-v32{height:13px;border-radius:999px;overflow:hidden;background:rgba(15,23,42,.9);border:1px solid rgba(255,255,255,.10);}
      .resource-bar-v32 b{display:block;height:100%;border-radius:999px;box-shadow:0 0 16px rgba(255,255,255,.16) inset;}
      .resource-bar-v32.hp b{background:linear-gradient(90deg,#ef4444,#fb7185);}
      .resource-bar-v32.exp b{background:linear-gradient(90deg,#22c55e,#67e8f9);}
      .wallet-grid-v32{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:10px;}
      .wallet-chip-v32{border-radius:14px;background:rgba(2,6,23,.42);border:1px solid rgba(148,163,184,.13);padding:9px;text-align:center;}
      .wallet-chip-v32 span{display:block;font-size:11px;color:#94a3b8;font-weight:800;}
      .wallet-chip-v32 b{font-size:15px;color:#fff;}
      .bag-panel-v32{min-width:0;}
      .bag-panel-v32 .bag-grid{max-height:410px;overflow:auto;padding-right:4px;}
      .bag-card-v32{position:relative;padding-top:12px!important;}
      .destroy-item-btn-v32{position:absolute;right:7px;top:7px;width:22px;height:22px;border-radius:999px;border:1px solid rgba(248,113,113,.35);background:rgba(127,29,29,.72);color:#fecaca;font-size:14px;font-weight:900;line-height:1;display:grid;place-items:center;cursor:pointer;z-index:6;padding:0;}
      .destroy-item-btn-v32:hover{background:rgba(220,38,38,.92);color:#fff;transform:scale(1.04);}
      .destroy-item-btn-v32:disabled{opacity:.25;cursor:not-allowed;filter:grayscale(1);}
      .destroy-confirm-v32{text-align:center;display:grid;gap:14px;}
      .destroy-confirm-v32 .item-name{font-size:18px;color:#fee2e2;font-weight:900;}
      .destroy-confirm-v32 .buttons{display:flex;gap:10px;justify-content:center;}
      .forge-name-clean-v32{display:none!important;}
    `;
    document.head.appendChild(style);
  } catch {}

  function tooltipAttrV32(text) { return escapeHtml(String(text || '')).replace(/\n/g, '&#10;'); }
  function getWeaponTierV32(itemId) { return Math.max(0, Math.min(4, Number(game.player?.weaponUpgrades?.[itemId] || 0))); }
  function tierInfoV32(tier) { return (window.TIER_INFO_V27 || [])[tier] || { name:'일반', cls:'tier-0' }; }
  function tierClassV32(tier) { return tierInfoV32(tier).cls || 'tier-0'; }
  function slotLabelV32(slot) { return ({ weapon:'무기', head:'머리', armor:'방어구', accessory:'악세서리' })[slot] || slot; }
  function classNameV32(cls) { return CLASS_META[cls]?.name || cls || '-'; }
  function enhancedStatsTextV32(item) {
    if (!item?.stats) return '';
    const tier = item.slot === 'weapon' ? getWeaponTierV32(item.id) : 0;
    return Object.entries(item.stats).map(([k,v]) => {
      const base = Number(v || 0);
      const bonus = item.slot === 'weapon' && tier > 0 ? Math.max(1, Math.ceil(base * tier * .45)) : 0;
      return `${k} +${base + bonus}${bonus ? ` (강화 +${bonus})` : ''}`;
    }).join(', ');
  }
  function displayItemNameV32(item) {
    if (!item) return '';
    if (item.slot !== 'weapon') return item.name;
    const tier = getWeaponTierV32(item.id);
    return tier > 0 ? `[${tierInfoV32(tier).name}] ${item.name}` : item.name;
  }
  function itemTooltipV32(item) {
    if (!item) return '';
    const tier = item.slot === 'weapon' ? `강화 등급: ${tierInfoV32(getWeaponTierV32(item.id)).name}` : '';
    return [displayItemNameV32(item), slotLabelV32(item.slot), tier, item.classOnly ? `${classNameV32(item.classOnly)} 전용` : '공용', item.levelReq ? `Lv.${item.levelReq} 이상` : '', enhancedStatsTextV32(item), item.desc].filter(Boolean).join('\n');
  }

  function openCharacterPanelV32() {
    ensurePlayerHp?.();
    try { ensurePlayerV27Fields?.(); } catch {}
    const stats = computeTotalStats();
    const expNext = XP_REQUIREMENTS?.[game.player.level] || null;
    const hpPct = Math.max(0, Math.min(100, Math.round((game.player.hp / Math.max(1, game.player.maxHp)) * 100)));
    const expPct = expNext ? Math.max(0, Math.min(100, Math.round((game.player.exp / expNext) * 100))) : 100;
    const pet = window.PET_DEFS_V27?.[game.player.activePet];
    const petStatsText = (p) => p?.stats ? Object.entries(p.stats).map(([k,v]) => `${k} +${v}`).join(' · ') : '스탯 없음';
    const slotHtml = (slot, extraClass) => {
      const itemId = game.player.equipment?.[slot];
      const item = itemId ? getItemDefinition(itemId, game.player.class) : null;
      const tier = item?.slot === 'weapon' ? getWeaponTierV32(item.id) : 0;
      return `<div class="equip-slot paper-slot ${extraClass} compact-item-slot-v26 ${item?.slot === 'weapon' ? tierClassV32(tier) : ''}" data-tooltip="${tooltipAttrV32(item ? itemTooltipV32(item) : '가방 아이템을 이 칸으로 드래그해 장착')}" ondragover="allowItemDrop(event)" ondrop="dropItemOnEquip(event, '${slot}')">
        ${item && slot !== 'weapon' ? `<button class="unequip-btn" title="장착 해제" onclick="unequipSlot('${slot}')">×</button>` : ''}
        <div class="slot-name">${slotLabelV32(slot)}</div><div class="slot-icon ${item ? 'filled' : ''}">${item ? itemIcon(item) : '＋'}</div><b>${item ? displayItemNameV32(item) : '비어 있음'}</b>
      </div>`;
    };
    const statHtml = Object.entries(stats).map(([k,v]) => `<div class="mini-stat" title="현재 총 ${k}"><span>${k}</span><b>${v}</b></div>`).join('');
    const identityHtml = `<div class="identity-strip-v32">
      <div class="identity-chip-v32"><span>레벨</span><b>Lv.${game.player.level}</b></div>
      <div class="identity-chip-v32"><span>직업</span><b>${classNameV32(game.player.class)}</b></div>
      <div class="identity-chip-v32"><span>전문화</span><b>${game.player.spec || '잠김'}</b></div>
    </div>`;
    const resourceHtml = `<div class="resource-panel-v32">
      <div class="resource-row-v32"><span>HP</span><div class="resource-bar-v32 hp"><b style="width:${hpPct}%"></b></div><strong>${game.player.hp}/${game.player.maxHp}</strong></div>
      <div class="resource-row-v32"><span>EXP</span><div class="resource-bar-v32 exp"><b style="width:${expPct}%"></b></div><strong>${expNext ? `${game.player.exp}/${expNext}` : game.player.exp}</strong></div>
      <div class="wallet-grid-v32">
        <div class="wallet-chip-v32"><span>Gold</span><b>${game.player.gold || 0}</b></div>
        <div class="wallet-chip-v32"><span>빌딩</span><b>${game.player.building || 0}</b></div>
        <div class="wallet-chip-v32"><span>스킬P</span><b>${game.player.skillPoints || 0}</b></div>
      </div>
    </div>`;
    const petSlot = `<div class="pet-slot-v27 ${pet ? 'active' : ''}" data-tooltip="${tooltipAttrV32(pet ? `${pet.name}\n${pet.desc}\n${petStatsText(pet)}` : '펫 상점에서 펫을 얻으면 이 칸에 장착할 수 있습니다.')}"><div class="pet-face-v27" style="--pet-color:${pet?.color || '#475569'}">${pet?.icon || '＋'}</div><div><span>동행 펫</span><b>${pet?.name || '비어 있음'}</b><small>${pet ? petStatsText(pet) : '펫 상점에서 획득'}</small></div>${pet ? '<button class="ghost small" onclick="unequipPetV27()">해제</button>' : ''}</div>`;
    const inventory = Array.isArray(game.player.inventory) ? [...game.player.inventory] : [];
    const bagSlots = [];
    for (let idx=0; idx<20; idx+=1) {
      const itemId = inventory[idx];
      if (itemId) {
        const item = getItemDefinition(itemId, game.player.class);
        const can = canEquip(item, game.player);
        const equipped = Object.values(game.player.equipment || {}).includes(itemId);
        const tier = item?.slot === 'weapon' ? getWeaponTierV32(item.id) : 0;
        bagSlots.push(`<div class="bag-slot compact-item-slot-v26 bag-card-v27 bag-card-v32 ${item?.slot === 'weapon' ? tierClassV32(tier) : ''}" data-tooltip="${tooltipAttrV32(itemTooltipV32(item))}" draggable="true" ondragstart="dragItemStart(event, ${idx})" ondragover="allowItemDrop(event)" ondrop="dropItemOnBag(event, ${idx})">
          <button class="destroy-item-btn-v32" ${equipped ? 'disabled' : ''} title="${equipped ? '착용 중인 아이템은 파괴할 수 없습니다.' : '아이템 파괴'}" onclick="confirmDestroyItemV32(event, ${idx})">×</button>
          <div class="bag-icon item-${item.slot}">${itemIcon(item)}</div><b>${displayItemNameV32(item)}</b><small>${slotLabelV32(item.slot)}</small><button ${!can || equipped ? 'disabled' : ''} class="primary small" onclick="equipItem('${itemId}')">${equipped ? '장착 중' : '장착'}</button>
        </div>`);
      } else bagSlots.push(`<div class="bag-slot empty compact-item-slot-v26 bag-card-v27" ondragover="allowItemDrop(event)" ondrop="dropItemOnBag(event, ${idx})"><div class="bag-icon">＋</div><small>빈 칸</small></div>`);
    }
    openModal(`<div class="character-window-v27 character-window-v32"><header class="character-head-v27"><h2>인벤토리 / 상태창 <span class="badge">C 키</span></h2><p>장비와 펫을 확인하고, 아이템 위에 마우스를 올려 상세 능력치를 봅니다.</p></header>
      <div class="character-panel character-panel-v7 character-panel-v26 character-panel-v27 character-panel-v32">
        <div class="panel-card paperdoll-card-v7 status-panel-v27 status-panel-v29 character-left-v32"><h3>캐릭터 상태</h3>${identityHtml}<div class="paperdoll paperdoll-v7"><canvas id="characterPanelCanvas" width="420" height="420"></canvas>${slotHtml('head','slot-head-v7')}${slotHtml('armor','slot-armor-v7')}${slotHtml('weapon','slot-weapon-v7')}${slotHtml('accessory','slot-accessory-v7')}</div><div class="mini-stat-grid mini-stat-grid-v7 stat-grid-v27">${statHtml}</div></div>
        <div class="character-right-v32"><div class="panel-card">${resourceHtml}</div><div class="panel-card">${petSlot}</div><div class="panel-card bag-panel-v27 bag-panel-v32"><h3>가방</h3><p class="muted">아이템 위에 마우스를 올리면 상세 능력치를 확인할 수 있습니다.</p><div class="bag-grid">${bagSlots.join('')}</div></div></div>
      </div></div>`, { type:'character', pause:true });
    setTimeout(() => { document.querySelectorAll('.slot-connector-v29').forEach((el)=>el.remove()); drawCharacterPanelCanvas?.(); }, 20);
  }
  openCharacterPanel = openCharacterPanelV32;
  window.openCharacterPanel = openCharacterPanelV32;
  window.openStatsModal = openCharacterPanelV32;
  window.openEquipmentModal = openCharacterPanelV32;

  window.confirmDestroyItemV32 = function confirmDestroyItemV32(event, idx) {
    try { event?.preventDefault?.(); event?.stopPropagation?.(); } catch {}
    const itemId = game.player?.inventory?.[idx];
    const item = itemId ? getItemDefinition(itemId, game.player.class) : null;
    if (!item) return;
    if (Object.values(game.player.equipment || {}).includes(itemId)) { toast('착용 중인 아이템은 파괴할 수 없습니다.'); return; }
    openModal(`<div class="destroy-confirm-v32"><h2>아이템 파괴</h2><p><span class="item-name">${escapeHtml(displayItemNameV32(item))}</span> 아이템을 완전히 파괴하시겠습니까?</p><p class="muted">파괴한 아이템은 복구할 수 없습니다.</p><div class="buttons"><button class="danger" onclick="destroyInventoryItemV32(${idx})">네, 파괴합니다</button><button class="ghost" onclick="openCharacterPanel()">취소</button></div></div>`, { type:'destroyItem', pause:true });
  };
  window.destroyInventoryItemV32 = function destroyInventoryItemV32(idx) {
    const itemId = game.player?.inventory?.[idx];
    const item = itemId ? getItemDefinition(itemId, game.player.class) : null;
    if (!item) { openCharacterPanel(); return; }
    if (Object.values(game.player.equipment || {}).includes(itemId)) { toast('착용 중인 아이템은 파괴할 수 없습니다.'); openCharacterPanel(); return; }
    game.player.inventory.splice(idx, 1);
    savePlayer?.(); updateHud?.(); playSfx?.('error');
    toast(`${item.name}을(를) 파괴했습니다.`);
    openCharacterPanel();
  };

  // 다른 NPC와 동일한 흰색 말풍선 스타일로 진명/펫 수정구 대사를 출력한다.
  drawNpcIdleBubble = function drawNpcIdleBubbleV32(ctx, x, y, name, scale = 1) {
    const lines = {
      '명진쌤': ['오늘도 차근차근 성장해보자!', '문제를 풀어 몬스터에게 데미지를 입히렴.', '포탈 너머에서는 위험하니 조심하렴.'],
      '무기 상인 의석': ['좋은 무기는 바른 자세에서 시작되지.', '손에 맞는 무기를 골라봐.'],
      '방어구 상인 상미': ['방어구는 생존의 기본이야.', '망토는 뒤로 자연스럽게 흐르는 게 예쁘지.'],
      '특별 상인 새나리': ['빌딩은 특별한 보상 화폐야.', '빛나는 아이템을 구경해봐!'],
      '옷 상인 상남': ['멋과 귀여움은 능력치보다 중요하지!', '코스튬은 성능은 그대로, 모습만 바꿔줘.'],
      '대장장이 진명': ['무기를 벼려 더 강해져 보게.', '등급이 오르면 빛이 달라진다네.', '강화에는 3빌딩이 필요하네.'],
      '펫 수정구': ['반짝이는 친구를 만나볼래?', '귀여운 펫들이 기다리고 있어!', '10빌딩으로 새로운 동행을 소환해봐!'],
    };
    const arr = lines[name] || ['어서 와!'];
    const cycle = 12000;
    // [v60] 같은 방의 NPC들이 동시에 말하지 않도록 이름 기반 고정 오프셋을 준다
    const OFFSETS = {
      '명진쌤': 0,
      '무기 상인 의석': 0,
      '방어구 상인 상미': 6000,
      '특별 상인 새나리': 0,
      '옷 상인 상남': 6000,
      '대장장이 진명': 0,
      '펫 수정구': 6000,
    };
    let offset = OFFSETS[name];
    if (offset == null) { // 미등록 NPC는 이름 해시로 분산
      let h = 0;
      for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) % cycle;
      offset = h;
    }
    const now = Date.now() + offset;
    const phase = now % cycle;
    if (phase > 5000) return;
    const idx = Math.floor(now / cycle) % arr.length;
    const text = arr[idx];
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `${Math.round(13 * scale)}px Jua, Noto Sans KR, system-ui`;
    const w = Math.min(210 * scale, ctx.measureText(text).width + 30 * scale);
    const bx = x - w / 2;
    const by = y - 104 * scale;
    ctx.globalAlpha = Math.min(1, (5000 - phase) / 500) * Math.min(1, phase / 500);
    ctx.fillStyle = 'rgba(255,255,255,.94)';
    roundRect(ctx, bx, by, w, 30 * scale, 12 * scale); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - 7 * scale, by + 27 * scale); ctx.lineTo(x, by + 38 * scale); ctx.lineTo(x + 7 * scale, by + 27 * scale); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#102033';
    ctx.fillText(text, x, by + 20 * scale);
    ctx.restore();
  };

  function drawPetShopDecorV32() {
    const ctx = game.ctx;
    const crystals = [
      { x: 310, y: 455, c:'#f0abfc' }, { x: 870, y: 460, c:'#93c5fd' },
      { x: 960, y: 230, c:'#fde68a' }, { x: 230, y: 245, c:'#c084fc' }
    ];
    crystals.forEach((cr) => {
      const p = worldToScreen(cr.x, cr.y);
      ctx.save(); ctx.translate(p.x, p.y); ctx.fillStyle = cr.c; ctx.globalAlpha = .38;
      ctx.beginPath(); ctx.moveTo(0, -24); ctx.lineTo(22, 0); ctx.lineTo(0, 30); ctx.lineTo(-22, 0); ctx.closePath(); ctx.fill(); ctx.restore();
    });
    const paw = worldToScreen(590, 520);
    ctx.save(); ctx.textAlign='center'; ctx.font='900 76px Apple Color Emoji, Segoe UI Emoji'; ctx.globalAlpha=.13; ctx.fillText('🐾', paw.x, paw.y); ctx.restore();
  }
  function drawPetShopInteriorV32() {
    const ctx = game.ctx, world = worldDefs.petShopInterior;
    ctx.clearRect(0,0,game.width,game.height);
    const g = ctx.createLinearGradient(0,0,0,game.height);
    g.addColorStop(0,'#432f56'); g.addColorStop(.5,'#281f3f'); g.addColorStop(1,'#111827');
    ctx.fillStyle = g; ctx.fillRect(0,0,game.width,game.height);
    drawTerrainDots(ctx, world, '#ffffff', .038, 30, 9);
    drawPetShopDecorV32();
    drawCrystalPedestalWorld(world.orb.x, world.orb.y, '#f9a8d4');
    const orb = worldToScreen(world.orb.x, world.orb.y);
    const t = performance.now() / 520;
    ctx.save();
    const halo = ctx.createRadialGradient(orb.x, orb.y - 30, 8, orb.x, orb.y - 30, 102);
    halo.addColorStop(0, 'rgba(244,114,182,.65)'); halo.addColorStop(.5, 'rgba(217,70,239,.18)'); halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(orb.x, orb.y - 30, 102, 0, Math.PI * 2); ctx.fill();
    ['🐤','🍄','🐉','🐱','🐶'].forEach((ic,i) => {
      const a = t + i * 1.25;
      ctx.font = '900 30px Noto Sans KR, Apple Color Emoji, Segoe UI Emoji, system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.globalAlpha = .92;
      ctx.fillText(ic, orb.x + Math.cos(a) * 78, orb.y - 46 + Math.sin(a) * 28);
    });
    ctx.globalAlpha = 1;
    ctx.font = '900 15px Jua, Noto Sans KR, system-ui'; ctx.textAlign='center'; ctx.fillStyle = '#fff7ed'; ctx.strokeStyle='rgba(15,23,42,.7)'; ctx.lineWidth=4;
    ctx.strokeText('펫 수정구', orb.x, orb.y - 92); ctx.fillText('펫 수정구', orb.x, orb.y - 92);
    ctx.restore();
    drawNpcIdleBubble(ctx, orb.x, orb.y - 56, '펫 수정구', 1);
    const ex = worldToScreen(world.exit.x, world.exit.y); drawExitMarker(ex.x, ex.y); drawTitleLabel('펫 상점');
  }

  function drawForgeDecorationV32() {
    const ctx = game.ctx;
    const anvil = worldToScreen(205, 545);
    const furnace = worldToScreen(985, 430);
    const rack = worldToScreen(995, 230);
    ctx.save();
    ctx.fillStyle = '#1f2937'; roundRect(ctx, anvil.x - 50, anvil.y - 16, 100, 26, 10); ctx.fill();
    ctx.fillStyle = '#475569'; roundRect(ctx, anvil.x - 26, anvil.y - 38, 74, 24, 8); ctx.fill();
    ctx.fillStyle = '#334155'; ctx.fillRect(anvil.x - 10, anvil.y - 4, 20, 48); drawShadow(ctx, anvil.x, anvil.y + 38, 48, 9, .18);
    ctx.fillStyle = '#5b341d'; roundRect(ctx, furnace.x - 66, furnace.y - 82, 132, 170, 22); ctx.fill();
    ctx.fillStyle = '#7c2d12'; roundRect(ctx, furnace.x - 42, furnace.y - 36, 84, 78, 13); ctx.fill();
    const glow = ctx.createRadialGradient(furnace.x, furnace.y + 4, 8, furnace.x, furnace.y + 4, 70);
    glow.addColorStop(0, 'rgba(254,215,170,.95)'); glow.addColorStop(.35, 'rgba(249,115,22,.82)'); glow.addColorStop(1, 'rgba(124,45,18,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(furnace.x, furnace.y + 4, 70, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f97316';
    for (let i=0;i<7;i+=1){ const tt=performance.now()/200+i*.7; ctx.globalAlpha=.42+Math.sin(tt)*.18; ctx.beginPath(); ctx.arc(furnace.x-34+i*12, furnace.y-24-Math.sin(tt)*14, 4+(i%2),0,Math.PI*2); ctx.fill(); }
    ctx.globalAlpha=1;
    ctx.strokeStyle='rgba(255,255,255,.25)'; ctx.lineWidth=6; ctx.beginPath(); ctx.moveTo(rack.x-70,rack.y); ctx.lineTo(rack.x+70,rack.y); ctx.stroke();
    ctx.font='900 28px Noto Sans KR, Apple Color Emoji, Segoe UI Emoji'; ctx.textAlign='center'; ctx.fillText('🔨',rack.x-40,rack.y+34); ctx.fillText('⚒',rack.x,rack.y+34); ctx.fillText('🪚',rack.x+42,rack.y+34);
    ctx.restore();
  }
  function drawBlacksmithJinmyeongV32(ctx, x, y, scale = 1, highlighted = false) {
    window.__YUKSAM_DRAWING_JINMYEONG__ = true;
    try { drawNpcSprite(ctx, x, y, '대장장이 진명', false, scale, highlighted, 'warrior'); }
    finally { window.__YUKSAM_DRAWING_JINMYEONG__ = false; }
    // 손에서 이어지는 큰 망치. 손잡이가 손에 닿도록 기준점을 낮춘다.
    ctx.save();
    ctx.translate(x + 26 * scale, y + 2 * scale);
    ctx.rotate(-0.62 + Math.sin(performance.now()/280)*0.035);
    ctx.fillStyle = '#92400e';
    roundRect(ctx, -3 * scale, -4 * scale, 7 * scale, 54 * scale, 4 * scale); ctx.fill();
    ctx.fillStyle = '#64748b';
    roundRect(ctx, -20 * scale, -17 * scale, 42 * scale, 20 * scale, 6 * scale); ctx.fill();
    ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1.5 * scale; ctx.strokeRect(-16*scale,-13*scale,34*scale,12*scale);
    ctx.restore();
  }
  function drawUpgradeShopInteriorV32() {
    const ctx = game.ctx, world = worldDefs.upgradeShopInterior;
    ctx.clearRect(0,0,game.width,game.height);
    const g = ctx.createLinearGradient(0,0,0,game.height);
    g.addColorStop(0,'#4a2817'); g.addColorStop(.48,'#2f1d16'); g.addColorStop(1,'#0f172a');
    ctx.fillStyle = g; ctx.fillRect(0,0,game.width,game.height);
    drawTerrainDots(ctx, world, '#fbbf24', .042, 34, 9);
    drawForgeDecorationV32();
    const p = worldToScreen(world.blacksmith.x, world.blacksmith.y);
    drawShopCounter(world.blacksmith.x, world.blacksmith.y + 108, '대장간', '#f97316');
    drawBlacksmithJinmyeongV32(ctx, p.x, p.y, NPC_WORLD_SCALE, isNearPoint(world.blacksmith, 102));
    const ex = worldToScreen(world.exit.x, world.exit.y); drawExitMarker(ex.x, ex.y); drawTitleLabel('대장간');
  }

  // 새 위치 기준으로 대장간 중앙 통로를 넓힌다.
  function enterPetShopInteriorV32() {
    if (game.transitionLock && Date.now() < game.transitionLock) return;
    game.transitionLock = Date.now() + 700;
    playSfx?.('door'); closeModal?.();
    game.currentMap = 'petShopInterior'; game.player.map = 'petShopInterior';
    game.player.x = worldDefs.petShopInterior.playerSpawn.x; game.player.y = worldDefs.petShopInterior.playerSpawn.y;
    $('returnTownBtn')?.classList.remove('hidden'); updateHud?.(); syncAudioFileBgm?.(); savePlayer?.();
    appendChatMessage?.('system','이동','펫 상점 내부로 들어왔습니다.');
  }
  function enterUpgradeShopInteriorV32() {
    if (game.transitionLock && Date.now() < game.transitionLock) return;
    game.transitionLock = Date.now() + 700;
    playSfx?.('door'); closeModal?.();
    game.currentMap = 'upgradeShopInterior'; game.player.map = 'upgradeShopInterior';
    game.player.x = worldDefs.upgradeShopInterior.playerSpawn.x; game.player.y = worldDefs.upgradeShopInterior.playerSpawn.y;
    $('returnTownBtn')?.classList.remove('hidden'); updateHud?.(); syncAudioFileBgm?.(); savePlayer?.();
    appendChatMessage?.('system','이동','대장간 내부로 들어왔습니다.');
  }
  function exitBuildingToTownV32(kind) {
    if (game.transitionLock && Date.now() < game.transitionLock) return;
    game.transitionLock = Date.now() + 700;
    playSfx?.('door'); closeModal?.();
    game.currentMap = 'town'; game.player.map = 'town';
    const town = worldDefs.town;
    const door = kind === 'pet' ? town.petShop : (kind === 'upgrade' ? town.upgradeShop : town.shop);
    game.player.x = door.doorX; game.player.y = door.doorY + 115; game.lastMove = {x:0,y:1};
    $('returnTownBtn')?.classList.add('hidden'); updateHud?.(); syncAudioFileBgm?.(); savePlayer?.();
    appendChatMessage?.('system','이동',`${door.name} 밖으로 나왔습니다.`);
  }
  function drawPetFollowerV32(ctx) {
    if (!game.player) return;
    const petDefs = window.PET_DEFS_V27 || {};
    const pet = petDefs[game.player.activePet];
    if (!pet) return;
    const now = performance.now();
    const dir = game.lastMove || { x: 1, y: 0 };
    if (Math.abs(dir.x) > 0.1) game.player._petSide = dir.x > 0 ? 'left' : 'right';
    const side = game.player._petSide || 'left';
    const moving = !!game.isMoving;
    const dancing = (game.danceTimer || 0) > 0;
    const wx = game.player.x + (side === 'left' ? -54 : 54) + (dancing ? Math.sin(now / 90) * 4 : 0);
    const wy = game.player.y + 8 - (moving ? Math.abs(Math.sin(now / 120 + (pet.bob || 0))) * 11 : Math.sin(now / 340 + (pet.bob || 0)) * 2.5);
    const p = worldToScreen(wx, wy);
    ctx.save();
    drawShadow(ctx, p.x, p.y + 24, 18, 6, .16);
    ctx.translate(p.x, p.y);
    ctx.rotate(dancing ? Math.sin(now / 95 + (pet.bob || 0)) * 0.2 : Math.sin(now / 500 + (pet.bob || 0)) * 0.03);
    const bounce = dancing ? 1.08 + Math.sin(now / 70) * .06 : 1 + Math.sin(now / 460 + (pet.bob || 0)) * .02;
    ctx.scale(bounce, bounce);
    ctx.font = '900 33px Noto Sans KR, Apple Color Emoji, Segoe UI Emoji, system-ui';
    ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.lineWidth=4; ctx.strokeStyle='rgba(15,23,42,.52)';
    ctx.strokeText(pet.icon, 0, 0); ctx.fillText(pet.icon, 0, 0);
    if (moving) {
      ctx.fillStyle = pet.color || '#fde68a'; ctx.globalAlpha = .74;
      ctx.beginPath(); ctx.ellipse(-8, 20, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(8, 20, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
    }
    if (dancing) {
      ctx.globalAlpha = .92; ctx.font = '900 15px Jua, Noto Sans KR, system-ui'; ctx.fillStyle = pet.color || '#fde68a';
      ctx.fillText('♪', -22, -24); ctx.fillText('♬', 22, -30);
    }
    ctx.restore();
  }

  appendChatMessage?.('system','패치','v32: 장비창 오른쪽 정보 배치, 아이템 파괴, NPC 말풍선 통일, 대장간 동선, 대장간 BGM/효과음 교체가 적용되었습니다.');
})();


/* =========================
   v33 patch: character panel pet slot + hammer flip + pet/forge audio and summon polish
   ========================= */
(function yuksamV33Patch(){
  if (window.__YUKSAM_V33_PATCH__) return;
  window.__YUKSAM_V33_PATCH__ = true;

  try { document.title = '63월드'; } catch {}

  // 펫 상점 마을 위치를 개울/연못과 겹치지 않는 상단 잔디 구역으로 이동
  if (worldDefs?.town?.petShop) {
    worldDefs.town.petShop = { x: 410, y: 360, w: 250, h: 190, name: '펫 상점', doorX: 410, doorY: 474 };
  }
  if (worldDefs?.town?.upgradeShop) worldDefs.town.upgradeShop.name = '대장간';

  // 대장간 중앙 통로 확보: 오브젝트를 더 구석으로 이동
  if (worldDefs?.upgradeShopInterior) {
    worldDefs.upgradeShopInterior.blacksmith = { x: 590, y: 276, r: 50, name: '대장장이 진명' };
    worldDefs.upgradeShopInterior.playerSpawn = { x: 590, y: 610 };
    worldDefs.upgradeShopInterior.exit = { x: 590, y: 684, r: 68 };
  }
  if (worldDefs?.petShopInterior) {
    worldDefs.petShopInterior.orb = { x: 590, y: 268, r: 50, name: '펫 수정구' };
    worldDefs.petShopInterior.playerSpawn = { x: 590, y: 610 };
    worldDefs.petShopInterior.exit = { x: 590, y: 684, r: 68 };
  }

  try {
    const style = document.createElement('style');
    style.id = 'yuksam-v33-style';
    style.textContent = `
      .character-panel-v33{grid-template-columns:minmax(520px,.95fr) minmax(390px,1.05fr)!important;align-items:start;}
      .character-status-title-v60{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:12px;margin-bottom:10px;}
      .character-status-title-v60 h3{margin:0!important;white-space:nowrap;}
      .character-name-line-v60{min-width:0;display:flex;align-items:center;gap:10px;padding:7px 12px;border-radius:14px;background:rgba(74,222,128,.14);border:1px solid rgba(74,222,128,.32);overflow:hidden;}
      .character-name-line-v60 span{flex:0 0 auto;color:#bbf7d0;font-size:12px;font-weight:900;}
      .character-name-line-v60 b{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#fff;font-size:20px;line-height:1.05;font-weight:950;text-shadow:0 0 10px rgba(74,222,128,.24);}
      .identity-strip-v33{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:10px;}
      .identity-chip-v33{border-radius:14px;padding:9px 10px;background:rgba(15,23,42,.62);border:1px solid rgba(148,163,184,.14);}
      .identity-chip-v33 span{display:block;font-size:11px;color:#9fb7d4;font-weight:800;}
      .identity-chip-v33 b{display:flex;align-items:baseline;gap:9px;color:#f8fafc;font-size:14px;margin-top:2px;}
      .character-right-v33{display:flex;flex-direction:column;gap:12px;min-width:0;}
      .paperdoll-v7{min-height:500px!important;max-height:none!important;}
      .slot-pet-v33{
        position:absolute;
        left:50%;
        bottom:36px;
        transform:translateX(-50%);
        width:116px;
        min-height:106px;
        border-radius:24px;
        display:grid;
        place-items:center;
        gap:4px;
        cursor:pointer;
        z-index:4;
        background:
          radial-gradient(circle at 50% 24%, rgba(251,207,232,.38), transparent 46%),
          linear-gradient(180deg, rgba(76,29,149,.66), rgba(30,18,48,.70));
        border:1px solid rgba(244,114,182,.38);
        box-shadow:0 14px 34px rgba(0,0,0,.24), inset 0 1px 0 rgba(255,255,255,.08);
        color:#fdf2f8;
        font-family:Noto Sans KR, system-ui, sans-serif;
      }
      .slot-pet-v33:hover{filter:brightness(1.08); transform:translateX(-50%) translateY(-1px);}
      .slot-pet-v33 .pet-face-v33{font-size:34px;line-height:1;filter:drop-shadow(0 5px 10px rgba(0,0,0,.24));}
      .slot-pet-v33 b{font-size:12px;line-height:1.2;text-align:center;max-width:94px;white-space:normal;}
      .slot-pet-v33 small{font-size:10px;color:#fbcfe8;font-weight:800;}
      .pet-equip-grid-v33{display:grid;gap:10px;margin-top:12px;}
      .pet-equip-card-v33{display:grid;grid-template-columns:52px 1fr auto;gap:10px;align-items:center;border-radius:16px;padding:10px;background:rgba(15,23,42,.54);border:1px solid rgba(244,114,182,.18);}
      .pet-equip-card-v33.active{border-color:rgba(244,114,182,.55);background:rgba(76,29,149,.36);}
      .pet-equip-card-v33 .pet-icon{font-size:32px;text-align:center;}
      .pet-equip-card-v33 h3{margin:0;font-size:15px;}
      .pet-equip-card-v33 p{margin:3px 0 0;color:#cbd5e1;font-size:12px;}
      .pet-shop-summon-v33{max-width:420px;margin:0 auto;text-align:center;}
      .pet-shop-summon-v33 .panel-card{padding:24px!important;}
      .pet-shop-summon-v33 .summon-btn-v33{font-size:17px;padding:14px 24px;min-width:230px;margin-top:12px;}
      .upgrade-loading-bar-v28 b{animation-duration:4s!important;}
      /* D. 상태창 가시성: 헤더 강조 + 재화 아이콘/색 */
      .identity-chip-v33 span{font-weight:900;color:#b6ccec;}
      .identity-chip-v33 b{font-weight:800;font-size:15px;}
      .identity-chip-v33 b em{font-style:normal;font-weight:800;color:#7dd3fc;}
      /* 신분 칩 4색 배경 (요청 4) */
      .identity-chip-lv{background:rgba(56,189,248,.16);border-color:rgba(56,189,248,.34);}
      .identity-chip-job{background:rgba(251,146,60,.15);border-color:rgba(251,146,60,.34);}
      .identity-chip-spec{background:rgba(192,132,252,.15);border-color:rgba(192,132,252,.34);}
      .identity-chip-pvp{background:rgba(244,63,94,.13);border-color:rgba(251,113,133,.32);}
      .identity-chip-pvp b{color:#fecdd3;white-space:nowrap;}
      .wallet-chip-v32 span{font-size:12px;font-weight:900;}
      .wallet-chip-v32 b{display:block;margin-top:4px;font-size:20px;line-height:1;font-weight:950;}
      .wallet-gold-v33{background:rgba(245,158,11,.15);border-color:rgba(251,191,36,.34);}
      .wallet-building-v33{background:rgba(139,92,246,.16);border-color:rgba(167,139,250,.34);}
      .wallet-skillp-v33{background:rgba(14,165,233,.16);border-color:rgba(56,189,248,.34);}
      .wallet-gold-v33 b{color:#fbbf24;}
      .wallet-building-v33 b{color:#c4b5fd;}
      .wallet-skillp-v33 b{color:#7dd3fc;}
      /* E. 스킬창/장비창 스크롤 제거 한정 조정 */
      .skill-window-v35{max-height:92vh;gap:10px;}
      .skill-tree-v35{gap:10px;max-height:none;overflow:visible;}
      .skill-lane-v35{padding:10px;}
      .lane-title-v35{margin-bottom:8px;font-size:14px;}
      .skill-node-v35{grid-template-columns:38px minmax(0,1fr) 22px;gap:8px;padding:8px 9px;}
      .skill-icon-v35{width:38px;height:38px;font-size:19px;border-radius:12px;}
      .skill-body-v35 b{font-size:13px;}
      .skill-desc-v35{font-size:10.5px;line-height:1.32;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
      .skill-tag-v35{font-size:10px;margin-top:1px;}
      .skill-active-section-v35 h3{margin:0 0 6px;font-size:14px;}
      .skill-active-strip-v35{padding:9px;gap:8px;}
      .character-window-v33 .bag-grid{gap:8px;}
      .character-window-v33 .bag-slot{padding:7px;}
      .character-window-v33 .character-head-v27 p{font-size:12px;}
    `;
    document.head.appendChild(style);
  } catch {}

  function tooltipAttrV33(text) { return escapeHtml(String(text || '')).replace(/\n/g, '&#10;'); }
  function tierInfoV33(tier) { return (window.TIER_INFO_V27 || [])[tier] || { name:'일반', cls:'tier-0' }; }
  function getWeaponTierV33(itemId) { return Math.max(0, Math.min(4, Number(game.player?.weaponUpgrades?.[itemId] || 0))); }
  function tierClassV33(tier) { return tier > 0 ? (tierInfoV33(tier).cls || '') : ''; }
  function getWeaponTierDomAttrsV33(itemId) {
    const tier = getWeaponTierV33(itemId);
    if (tier <= 0) return null;
    const tierStyle = getEquippedWeaponTierStyle({
      ...game.player,
      equipment: { ...game.player.equipment, weapon: itemId },
    });
    return `weapon-tier-equipped ${tierStyle.className} weapon-tier-intensity-${game.player.class}" style="--weapon-tier-color:${tierStyle.color};--weapon-tier-intensity:${tierStyle.intensity}`;
  }
  function slotLabelV33(slot) { return ({ weapon:'무기', head:'머리', armor:'방어구', accessory:'악세서리' })[slot] || slot; }
  function classNameV33(cls) { return CLASS_META[cls]?.name || cls || '-'; }
  function enhancedStatsTextV33(item) {
    if (!item?.stats) return '';
    const tier = item.slot === 'weapon' ? getWeaponTierV33(item.id) : 0;
    return Object.entries(item.stats).map(([k,v]) => {
      const base = Number(v || 0);
      const bonus = item.slot === 'weapon' && tier > 0 ? Math.max(1, Math.ceil(base * tier * .45)) : 0;
      return `${k} +${base + bonus}${bonus ? ` (강화 +${bonus})` : ''}`;
    }).join(', ');
  }
  function displayItemNameV33(item) {
    if (!item) return '';
    if (item.slot !== 'weapon') return item.name;
    const tier = getWeaponTierV33(item.id);
    return tier > 0 ? `[${tierInfoV33(tier).name}] ${item.name}` : item.name;
  }
  function itemTooltipV33(item) {
    if (!item) return '';
    const tier = item.slot === 'weapon' ? `강화 등급: ${tierInfoV33(getWeaponTierV33(item.id)).name}` : '';
    return [displayItemNameV33(item), slotLabelV33(item.slot), tier, item.classOnly ? `${classNameV33(item.classOnly)} 전용` : '공용', item.levelReq ? `Lv.${item.levelReq} 이상` : '', enhancedStatsTextV33(item), item.desc].filter(Boolean).join('\n');
  }
  function petStatsTextV33(pet) {
    return pet?.stats ? Object.entries(pet.stats).map(([k,v]) => `${k} +${v}`).join(' · ') : '스탯 없음';
  }

  // 장비창 재구성: 동행 펫은 paperdoll 안의 방어구/악세서리 사이에 배치
  function openCharacterPanelV33() {
    ensurePlayerHp?.();
    try { ensurePlayerV27Fields?.(); } catch {}
    const stats = computeTotalStats();
    const expNext = XP_REQUIREMENTS?.[game.player.level] || null;
    const hpPct = Math.max(0, Math.min(100, Math.round((game.player.hp / Math.max(1, game.player.maxHp)) * 100)));
    const expPct = expNext ? Math.max(0, Math.min(100, Math.round((game.player.exp / expNext) * 100))) : 100;
    const pet = window.PET_DEFS_V27?.[game.player.activePet];
    const ownedPets = Array.isArray(game.player.pets) ? game.player.pets : [];
    const equippedWeaponTierStyle = getEquippedWeaponTierStyle(game.player);

    const slotHtml = (slot, extraClass) => {
      const itemId = game.player.equipment?.[slot];
      const item = itemId ? getItemDefinition(itemId, game.player.class) : null;
      const weaponTierAttrs = item?.slot === 'weapon'
        ? (getWeaponTierDomAttrsV33(item.id) || '')
        : '';
      return `<div class="equip-slot paper-slot ${extraClass} compact-item-slot-v26 ${weaponTierAttrs}" data-tooltip="${tooltipAttrV33(item ? itemTooltipV33(item) : '가방 아이템을 이 칸으로 드래그해 장착')}" ondragover="allowItemDrop(event)" ondrop="dropItemOnEquip(event, '${slot}')">
        ${item && slot !== 'weapon' ? `<button class="unequip-btn" data-tooltip="장착 해제" onclick="unequipSlot('${slot}')">×</button>` : ''}
        <div class="slot-name">${slotLabelV33(slot)}</div><div class="slot-icon ${item ? 'filled' : ''}">${item ? itemIcon(item) : '＋'}</div><b>${item ? displayItemNameV33(item) : '비어 있음'}</b>
      </div>`;
    };
    const statTipMapV33 = {
      '힘': '힘은 전사의 공격력에 작용하는 능력치입니다.',
      '지능': '지능은 마법사의 공격력에 작용하는 능력치입니다.',
      '정신': '정신은 사제의 공격력에 작용하는 능력치입니다.',
      '체력': '체력은 캐릭터의 체력을 올려주는 능력치입니다.',
    };
    const statHtml = Object.entries(stats).map(([k,v]) => `<div class="mini-stat" data-tooltip="${tooltipAttrV33((statTipMapV33[k] ? `${k}\n${statTipMapV33[k]}` : `현재 총 ${k}`))}"><span>${k}</span><b>${v}</b></div>`).join('');
    const identityHtml = `<div class="identity-strip-v33">
      <div class="identity-chip-v33 identity-chip-lv"><span>레벨</span><b><em>Lv.${game.player.level}</em></b></div>
      <div class="identity-chip-v33 identity-chip-job"><span>직업</span><b>${classNameV33(game.player.class)}</b></div>
      <div class="identity-chip-v33 identity-chip-spec"><span>전문화</span><b>${game.player.spec || '잠김'}</b></div>
      <div class="identity-chip-v33 identity-chip-pvp"><span>PVP 전적</span><b id="characterPvpRecordV33">확인 중…</b></div>
    </div>`;
    const resourceHtml = `<div class="resource-panel-v32">
      <div class="resource-row-v32"><span>HP</span><div class="resource-bar-v32 hp"><b style="width:${hpPct}%"></b></div><strong>${game.player.hp}/${game.player.maxHp}</strong></div>
      <div class="resource-row-v32"><span>EXP</span><div class="resource-bar-v32 exp"><b style="width:${expPct}%"></b></div><strong>${expNext ? `${game.player.exp}/${expNext}` : game.player.exp}</strong></div>
      <div class="wallet-grid-v32">
        <div class="wallet-chip-v32 wallet-gold-v33"><span>🪙 Gold</span><b>${game.player.gold || 0}</b></div>
        <div class="wallet-chip-v32 wallet-building-v33"><span>🏢 빌딩</span><b>${game.player.building || 0}</b></div>
        <div class="wallet-chip-v32 wallet-skillp-v33"><span>✨ 스킬포인트</span><b>${game.player.skillPoints || 0}</b></div>
      </div>
    </div>`;
    const petTitle = pet ? `${pet.name}\n${pet.desc}\n${petStatsTextV33(pet)}\n클릭해서 보유 펫 중 동행 펫을 바꿀 수 있습니다.` : (ownedPets.length ? '클릭해서 보유 펫 중 동행 펫을 선택합니다.' : '펫 상점에서 펫을 얻으면 이 칸에서 장착할 수 있습니다.');
    const petSlot = `<button class="slot-pet-v33" data-tooltip="${tooltipAttrV33(petTitle)}" onclick="openPetEquipModalV33()">
      <span class="pet-face-v33">${pet?.icon || '＋'}</span>
      <b>${pet?.name || (ownedPets.length ? '펫 선택' : '동행 펫')}</b>
      <small>${pet ? '동행 중' : '비어 있음'}</small>
    </button>`;

    const inventory = Array.isArray(game.player.inventory) ? [...game.player.inventory] : [];
    const bagSlots = [];
    for (let idx=0; idx<20; idx+=1) {
      const itemId = inventory[idx];
      if (itemId) {
        const item = getItemDefinition(itemId, game.player.class);
        const can = canEquip(item, game.player);
        const equipped = Object.values(game.player.equipment || {}).includes(itemId);
        const weaponTierAttrs = item?.slot === 'weapon' ? (getWeaponTierDomAttrsV33(item.id) || '') : '';
        bagSlots.push(`<div class="bag-slot compact-item-slot-v26 bag-card-v27 bag-card-v32 ${weaponTierAttrs}" data-tooltip="${tooltipAttrV33(itemTooltipV33(item))}" draggable="true" ondragstart="dragItemStart(event, ${idx})" ondragover="allowItemDrop(event)" ondrop="dropItemOnBag(event, ${idx})">
          <button class="destroy-item-btn-v32" ${equipped ? 'disabled' : ''} data-tooltip="${equipped ? '착용 중인 아이템은 파괴할 수 없습니다.' : '아이템 파괴'}" onclick="confirmDestroyItemV33(event, ${idx})">×</button>
          <div class="bag-icon item-${item.slot}">${itemIcon(item)}</div><b>${displayItemNameV33(item)}</b><small class="bag-effect-v36">${itemStatShortV36(item)}</small><small>${slotLabelV33(item.slot)}</small><button ${!can || equipped ? 'disabled' : ''} class="primary small" onclick="equipItem('${itemId}')">${equipped ? '장착 중' : '장착'}</button>
        </div>`);
      } else bagSlots.push(`<div class="bag-slot empty compact-item-slot-v26 bag-card-v27" ondragover="allowItemDrop(event)" ondrop="dropItemOnBag(event, ${idx})"><div class="bag-icon">＋</div><small>빈 칸</small></div>`);
    }

    openModal(`<div class="character-window-v27 character-window-v32 character-window-v33"><header class="character-head-v27"><h2>인벤토리 / 상태창 <span class="badge">C 키</span></h2><p>장비와 펫을 확인하고, 아이템 위에 마우스를 올려 상세 능력치를 봅니다.</p></header>
      <div class="character-panel character-panel-v7 character-panel-v26 character-panel-v27 character-panel-v32 character-panel-v33">
        <div class="panel-card paperdoll-card-v7 status-panel-v27 status-panel-v29 character-left-v32"><div class="character-status-title-v60"><h3>캐릭터 상태</h3><div class="character-name-line-v60"><span>이름</span><b>${escapeHtml(game.player.name || '이름없음')}</b></div></div>${identityHtml}<div class="paperdoll paperdoll-v7"><canvas id="characterPanelCanvas" width="420" height="420"></canvas>${slotHtml('head','slot-head-v7')}${slotHtml('armor','slot-armor-v7')}${slotHtml('weapon','slot-weapon-v7')}${slotHtml('accessory','slot-accessory-v7')}${petSlot}</div><div class="mini-stat-grid mini-stat-grid-v7 stat-grid-v27">${statHtml}</div></div>
        <div class="character-right-v33"><div class="panel-card">${resourceHtml}</div><div class="panel-card bag-panel-v27 bag-panel-v32"><h3>가방</h3><p class="muted">아이템 위에 마우스를 올리면 상세 능력치를 확인할 수 있습니다.</p><div class="bag-grid">${bagSlots.join('')}</div></div></div>
      </div></div>`, { type:'character', pause:true });
    setTimeout(() => {
      document.querySelectorAll('.slot-connector-v29').forEach((el)=>el.remove());
      drawCharacterPanelCanvas?.();
      const recordElement = document.getElementById('characterPvpRecordV33');
      if (!recordElement || typeof window.getMyPvpRecordV1 !== 'function') {
        if (recordElement) recordElement.textContent = '확인 불가';
        return;
      }
      window.getMyPvpRecordV1()
        .then((record) => {
          const current = document.getElementById('characterPvpRecordV33');
          if (!current) return;
          current.textContent = `${Math.max(0, Number(record?.wins) || 0)}승 ${Math.max(0, Number(record?.losses) || 0)}패`;
        })
        .catch(() => {
          const current = document.getElementById('characterPvpRecordV33');
          if (current) current.textContent = '확인 불가';
        });
    }, 20);
  }
  openCharacterPanel = openCharacterPanelV33;
  window.openCharacterPanel = openCharacterPanelV33;
  window.openStatsModal = openCharacterPanelV33;
  window.openEquipmentModal = openCharacterPanelV33;

  window.equipPetFromPanelV33 = function equipPetFromPanelV33(id) {
    const petDefs = window.PET_DEFS_V27 || {};
    if (!petDefs[id] || !(game.player.pets || []).includes(id)) { toast('아직 보유하지 않은 펫입니다.'); return; }
    game.player.activePet = id;
    ensurePlayerHp?.(); savePlayer?.(); updateHud?.(); playSfx?.('open');
    openCharacterPanel();
    toast(`${petDefs[id].name}이(가) 동행합니다.`);
  };

  window.confirmDestroyItemV33 = function confirmDestroyItemV33(event, idx) {
    try { event?.preventDefault?.(); event?.stopPropagation?.(); } catch {}
    const itemId = game.player?.inventory?.[idx];
    const item = itemId ? getItemDefinition(itemId, game.player.class) : null;
    if (!item) return;
    if (Object.values(game.player.equipment || {}).includes(itemId)) { toast('착용 중인 아이템은 파괴할 수 없습니다.'); return; }
    openModal(`<div class="destroy-confirm-v32"><h2>아이템 파괴</h2><p><span class="item-name">${escapeHtml(displayItemNameV33(item))}</span> 아이템을 완전히 파괴하시겠습니까?</p><p class="muted">파괴한 아이템은 복구할 수 없습니다.</p><div class="buttons"><button class="danger" onclick="destroyInventoryItemV33(${idx})">네, 파괴합니다</button><button class="ghost" onclick="openCharacterPanel()">취소</button></div></div>`, { type:'destroyItem', pause:true });
  };
  window.destroyInventoryItemV33 = function destroyInventoryItemV33(idx) {
    const itemId = game.player?.inventory?.[idx];
    const item = itemId ? getItemDefinition(itemId, game.player.class) : null;
    if (!item) { openCharacterPanel(); return; }
    if (Object.values(game.player.equipment || {}).includes(itemId)) { toast('착용 중인 아이템은 파괴할 수 없습니다.'); openCharacterPanel(); return; }
    game.player.inventory.splice(idx, 1);
    savePlayer?.(); updateHud?.(); playSfx?.('error');
    toast(`${item.name}을(를) 파괴했습니다.`);
    openCharacterPanel();
  };

  // 대장간과 펫상점은 마을 BGM 유지
  const oldGetDesiredAudioFileV33 = getDesiredAudioFile;
  getDesiredAudioFile = function getDesiredAudioFileV33() {
    if (!game.settings?.bgmEnabled) return null;
    if (screens.game.classList.contains('active') && ['petShopInterior','upgradeShopInterior'].includes(game.currentMap || '')) return game.audio.file || null;
    return oldGetDesiredAudioFileV33();
  };

  function ensureSpecialAudioV33() {
    try {
      initAudio?.();
      if (!game.audio) return;
      if (!game.audio.petSummonFile) {
        game.audio.petSummonFile = new Audio(window.getAudioAsset?.('petDraw')?.src || '');
        game.audio.petSummonFile.preload = 'auto';
      }
      const vol = game.settings?.sfxEnabled ? Math.min(1, Math.max(0, Number(game.settings.sfxVolume ?? 1))) : 0;
      game.audio.petSummonFile.volume = vol;
      // 성공/실패 파일은 같은 파일명으로 교체되어 있으므로 기존 Audio 객체를 새로 고정한다.
      if (!game.audio.upgradeSuccessFileV33) {
        game.audio.upgradeSuccessFile = new Audio(window.getAudioAsset?.('upgradeSuccess')?.src || '');
        game.audio.upgradeSuccessFileV33 = true;
      }
      if (!game.audio.upgradeFailFileV33) {
        game.audio.upgradeFailFile = new Audio(window.getAudioAsset?.('upgradeFail')?.src || '');
        game.audio.upgradeFailFileV33 = true;
      }
      game.audio.upgradeSuccessFile.volume = vol;
      game.audio.upgradeFailFile.volume = vol;
    } catch {}
  }
  const oldResumeAudioV33 = resumeAudio;
  resumeAudio = function resumeAudioV33() { oldResumeAudioV33(); ensureSpecialAudioV33(); };
  audioVolumePipeline.register({
    id:'audio-volume-v33',
    priority:330,
    after:() => ensureSpecialAudioV33(),
  });

  function playPetSummonSfxV33() {
    try {
      resumeAudio(); ensureSpecialAudioV33();
      const file = game.audio?.petSummonFile;
      if (!file || !game.settings?.sfxEnabled) return;
      file.pause(); file.currentTime = 0;
      file.play().catch(()=>{});
    } catch {}
  }

  // 대장간 오브젝트를 더 구석으로 옮기고 중앙 통로 확보
  function drawForgeDecorationV33() {
    const ctx = game.ctx;
    const anvil = worldToScreen(160, 555);
    const furnace = worldToScreen(1038, 428);
    const rack = worldToScreen(1010, 220);
    ctx.save();
    ctx.fillStyle = '#1f2937'; roundRect(ctx, anvil.x - 48, anvil.y - 16, 96, 26, 10); ctx.fill();
    ctx.fillStyle = '#475569'; roundRect(ctx, anvil.x - 26, anvil.y - 38, 72, 24, 8); ctx.fill();
    ctx.fillStyle = '#334155'; ctx.fillRect(anvil.x - 10, anvil.y - 4, 20, 48); drawShadow(ctx, anvil.x, anvil.y + 38, 48, 9, .18);

    ctx.fillStyle = '#5b341d'; roundRect(ctx, furnace.x - 62, furnace.y - 78, 124, 160, 22); ctx.fill();
    ctx.fillStyle = '#7c2d12'; roundRect(ctx, furnace.x - 39, furnace.y - 33, 78, 72, 13); ctx.fill();
    const glow = ctx.createRadialGradient(furnace.x, furnace.y + 4, 8, furnace.x, furnace.y + 4, 66);
    glow.addColorStop(0, 'rgba(254,215,170,.95)'); glow.addColorStop(.35, 'rgba(249,115,22,.82)'); glow.addColorStop(1, 'rgba(124,45,18,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(furnace.x, furnace.y + 4, 66, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f97316';
    for (let i=0;i<7;i+=1){ const tt=performance.now()/200+i*.7; ctx.globalAlpha=.42+Math.sin(tt)*.18; ctx.beginPath(); ctx.arc(furnace.x-31+i*11, furnace.y-22-Math.sin(tt)*13, 4+(i%2),0,Math.PI*2); ctx.fill(); }
    ctx.globalAlpha=1;

    ctx.strokeStyle='rgba(255,255,255,.25)'; ctx.lineWidth=6; ctx.beginPath(); ctx.moveTo(rack.x-70,rack.y); ctx.lineTo(rack.x+70,rack.y); ctx.stroke();
    ctx.font='900 28px Noto Sans KR, Apple Color Emoji, Segoe UI Emoji'; ctx.textAlign='center'; ctx.fillText('🔨',rack.x-40,rack.y+34); ctx.fillText('⚒',rack.x,rack.y+34); ctx.fillText('🪚',rack.x+42,rack.y+34);
    ctx.restore();
  }

  // 진명 망치: 좌우 반전, 막대 손잡이 부분이 손에 닿도록 재배치
  function drawBlacksmithJinmyeongV33(ctx, x, y, scale = 1, highlighted = false) {
    window.__YUKSAM_DRAWING_JINMYEONG__ = true;
    try { drawNpcSprite(ctx, x, y, '대장장이 진명', false, scale, highlighted, 'warrior'); }
    finally { window.__YUKSAM_DRAWING_JINMYEONG__ = false; }

    ctx.save();
    // 오른손 위치에 손잡이 아래쪽을 맞춘다.
    const handX = x + 22 * scale;
    const handY = y + 7 * scale;
    ctx.translate(handX, handY);
    // 이전 방향에서 좌우반전된 느낌
    ctx.rotate(0.68 + Math.sin(performance.now()/280)*0.025);
    ctx.fillStyle = '#92400e';
    roundRect(ctx, -3.5 * scale, -58 * scale, 7 * scale, 60 * scale, 4 * scale); ctx.fill();
    ctx.fillStyle = '#64748b';
    roundRect(ctx, -21 * scale, -75 * scale, 42 * scale, 20 * scale, 6 * scale); ctx.fill();
    ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1.5 * scale; ctx.strokeRect(-17*scale,-71*scale,34*scale,12*scale);
    // 손이 손잡이를 잡는 느낌
    ctx.fillStyle = '#f1d2b6';
    ctx.beginPath(); ctx.arc(0, 0, 4.5 * scale, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawUpgradeShopInteriorV33() {
    const ctx = game.ctx, world = worldDefs.upgradeShopInterior;
    ctx.clearRect(0,0,game.width,game.height);
    const g = ctx.createLinearGradient(0,0,0,game.height);
    g.addColorStop(0,'#4a2817'); g.addColorStop(.48,'#2f1d16'); g.addColorStop(1,'#0f172a');
    ctx.fillStyle = g; ctx.fillRect(0,0,game.width,game.height);
    drawTerrainDots(ctx, world, '#fbbf24', .042, 34, 9);
    drawForgeDecorationV33();
    const p = worldToScreen(world.blacksmith.x, world.blacksmith.y);
    drawShopCounter(world.blacksmith.x, world.blacksmith.y + 108, '대장간', '#f97316');
    drawBlacksmithJinmyeongV33(ctx, p.x, p.y, NPC_WORLD_SCALE, isNearPoint(world.blacksmith, 102));
    const ex = worldToScreen(world.exit.x, world.exit.y); drawExitMarker(ex.x, ex.y); drawTitleLabel('대장간');
  }

  function drawPetShopInteriorV33() {
    const ctx = game.ctx, world = worldDefs.petShopInterior;
    ctx.clearRect(0,0,game.width,game.height);
    const g = ctx.createLinearGradient(0,0,0,game.height);
    g.addColorStop(0,'#432f56'); g.addColorStop(.5,'#281f3f'); g.addColorStop(1,'#111827');
    ctx.fillStyle = g; ctx.fillRect(0,0,game.width,game.height);
    drawTerrainDots(ctx, world, '#ffffff', .038, 30, 9);
    // v32 장식 함수가 없을 경우 안전하게 직접 장식
    if (typeof drawPetShopDecorV32 === 'function') drawPetShopDecorV32();
    else {
      const paw = worldToScreen(590, 520);
      ctx.save(); ctx.textAlign='center'; ctx.font='900 76px Apple Color Emoji, Segoe UI Emoji'; ctx.globalAlpha=.13; ctx.fillText('🐾', paw.x, paw.y); ctx.restore();
    }
    drawCrystalPedestalWorld(world.orb.x, world.orb.y, '#f9a8d4');
    const orb = worldToScreen(world.orb.x, world.orb.y);
    const t = performance.now() / 520;
    ctx.save();
    const halo = ctx.createRadialGradient(orb.x, orb.y - 30, 8, orb.x, orb.y - 30, 102);
    halo.addColorStop(0, 'rgba(244,114,182,.65)'); halo.addColorStop(.5, 'rgba(217,70,239,.18)'); halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(orb.x, orb.y - 30, 102, 0, Math.PI * 2); ctx.fill();
    ['🐤','🍄','🐉','🐱','🐶'].forEach((ic,i) => {
      const a = t + i * 1.25;
      ctx.font = '900 30px Noto Sans KR, Apple Color Emoji, Segoe UI Emoji, system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.globalAlpha = .92;
      ctx.fillText(ic, orb.x + Math.cos(a) * 78, orb.y - 46 + Math.sin(a) * 28);
    });
    ctx.globalAlpha = 1;
    ctx.font = '900 15px Jua, Noto Sans KR, system-ui'; ctx.textAlign='center'; ctx.fillStyle = '#fff7ed'; ctx.strokeStyle='rgba(15,23,42,.7)'; ctx.lineWidth=4;
    ctx.strokeText('펫 수정구', orb.x, orb.y - 92); ctx.fillText('펫 수정구', orb.x, orb.y - 92);
    ctx.restore();
    drawNpcIdleBubble(ctx, orb.x, orb.y - 62, '펫 수정구', 1);
    const ex = worldToScreen(world.exit.x, world.exit.y); drawExitMarker(ex.x, ex.y); drawTitleLabel('펫 상점');
  }

  // 충돌도 새 위치 기준

  function enterPetShopInteriorV33() {
    if (game.transitionLock && Date.now() < game.transitionLock) return;
    game.transitionLock = Date.now() + 700;
    playSfx?.('door'); closeModal?.();
    game.currentMap = 'petShopInterior'; game.player.map = 'petShopInterior';
    game.player.x = worldDefs.petShopInterior.playerSpawn.x; game.player.y = worldDefs.petShopInterior.playerSpawn.y;
    $('returnTownBtn')?.classList.remove('hidden'); updateHud?.(); syncAudioFileBgm?.(); savePlayer?.();
    appendChatMessage?.('system','이동','펫 상점 내부로 들어왔습니다.');
  }
  function enterUpgradeShopInteriorV33() {
    if (game.transitionLock && Date.now() < game.transitionLock) return;
    game.transitionLock = Date.now() + 700;
    playSfx?.('door'); closeModal?.();
    game.currentMap = 'upgradeShopInterior'; game.player.map = 'upgradeShopInterior';
    game.player.x = worldDefs.upgradeShopInterior.playerSpawn.x; game.player.y = worldDefs.upgradeShopInterior.playerSpawn.y;
    $('returnTownBtn')?.classList.remove('hidden'); updateHud?.(); syncAudioFileBgm?.(); savePlayer?.();
    appendChatMessage?.('system','이동','대장간 내부로 들어왔습니다.');
  }
  function exitBuildingToTownV33(kind) {
    if (game.transitionLock && Date.now() < game.transitionLock) return;
    game.transitionLock = Date.now() + 700;
    playSfx?.('door'); closeModal?.();
    game.currentMap = 'town'; game.player.map = 'town';
    const town = worldDefs.town;
    const door = kind === 'pet' ? town.petShop : (kind === 'upgrade' ? town.upgradeShop : town.shop);
    game.player.x = door.doorX; game.player.y = door.doorY + 115; game.lastMove = {x:0,y:1};
    $('returnTownBtn')?.classList.add('hidden'); updateHud?.(); syncAudioFileBgm?.(); savePlayer?.();
    appendChatMessage?.('system','이동',`${door.name} 밖으로 나왔습니다.`);
  }
  worldNavigationRegistry.registerTransition({ id:'pet-upgrade-transitions-v33', priority:330, handle:() => {
    const p = game.player;
    if (game.currentMap === 'town') {
      const town = worldDefs.town;
      if (distance(p, {x:town.petShop.doorX, y:town.petShop.doorY}) < 42) { enterPetShopInteriorV33(); return true; }
      if (distance(p, {x:town.upgradeShop.doorX, y:town.upgradeShop.doorY}) < 42) { enterUpgradeShopInteriorV33(); return true; }
    }
    if (game.currentMap === 'petShopInterior' && distance(p, worldDefs.petShopInterior.exit) < 42) { exitBuildingToTownV33('pet'); return true; }
    if (game.currentMap === 'upgradeShopInterior' && distance(p, worldDefs.upgradeShopInterior.exit) < 42) { exitBuildingToTownV33('upgrade'); return true; }
    return false;
  }});

  // 펫 수정구 대화창 축소 + 버튼 강조
  function openPetShopModalV33() {
    try { ensurePlayerV27Fields?.(); } catch {}
    openModal(`<div class="pet-shop-summon-v33"><h2>펫 수정구</h2>
      <div class="panel-card">
        <b>랜덤 펫 소환</b>
        <p>수정구의 빛을 따라 새로운 동행을 만납니다.</p>
        <p class="muted">비용: 10빌딩 · 보유 빌딩: ${game.player?.building || 0}</p>
        <br>
        <button class="primary summon-btn-v33" onclick="rollPetV33()">랜덤 펫 소환</button>
      </div></div>`, { type:'petShop', pause:true });
  }

  window.rollPetV33 = function rollPetV33() {
    try { ensurePlayerV27Fields?.(); } catch {}
    if ((game.player.building || 0) < 10) { toast('빌딩 화폐가 부족합니다. 펫 소환에는 10빌딩이 필요합니다.'); return; }
    const ids = Object.keys(window.PET_DEFS_V27 || {});
    const notOwned = ids.filter((id) => !game.player.pets.includes(id));
    const pool = notOwned.length ? notOwned : ids;
    const id = pool[Math.floor(Math.random() * pool.length)];
    const pet = window.PET_DEFS_V27?.[id];
    if (!pet) return;
    closeModal();
    playPetSummonSfxV33();
    const overlay = document.createElement('div');
    overlay.className = 'pet-summon-modal-v31';
    overlay.innerHTML = `<div class="pet-summon-box-v31">
      <div class="pet-orb-loader-v31"></div>
      <h2>펫을 만나는 중...</h2>
      <p>수정구 너머에서 작은 친구가 다가오고 있습니다.</p>
      <div class="pet-loading-bar-v31"><b></b></div>
    </div>`;
    document.body.appendChild(overlay);
    setTimeout(() => {
      game.player.building -= 10;
      if (!game.player.pets.includes(id)) game.player.pets.push(id);
      game.player.activePet = id;
      ensurePlayerHp?.(); savePlayer?.(); updateHud?.(); playSfx?.('coin');
      overlay.innerHTML = `<div class="pet-summon-box-v31">
        <div class="pet-icon-result-v31">${pet.icon}</div>
        <h2>${escapeHtml(pet.name)}을(를) 만났습니다!</h2>
        <button class="primary wide" onclick="closePetSummonResultV31()">확인</button>
      </div>`;
      appendChatMessage?.('system', '펫', `${pet.name}을(를) 만났습니다.`);
    }, 5000);
  };

  // 강화창: 진명 명칭, 4초 진행, 새 성공/실패 파일 적용
  function upgradeRatesHtmlV33() {
    const rows = TIER_INFO_V27.slice(1).map((tier) => `<div><span class="tier-dot ${tier.cls}"></span>${tier.name} 성공률 <strong>${Math.round(tier.chance * 100)}%</strong></div>`).join('');
    return `<div class="upgrade-rates-v28">
      <b>강화 확률 안내</b>
      ${rows}
      <small>강화 비용은 3빌딩이며, 실패하면 한 등급 아래로 하락합니다.</small>
    </div>`;
  }
  function openUpgradeShopModalV33() {
    try { ensurePlayerV27Fields?.(); } catch {}
    const weaponId = game.player?.equipment?.weapon;
    const item = weaponId ? getItemDefinition(weaponId, game.player.class) : null;
    const equippedWeaponTierStyle = getEquippedWeaponTierStyle(game.player);
    const tier = item ? equippedWeaponTierStyle.tier : 0;
    const weaponTierAttrs = item ? (getWeaponTierDomAttrsV33(item.id) || '') : '';
    const next = (window.TIER_INFO_V27 || [])[tier + 1];
    const current = tierInfoV33(tier);
    const chance = next ? Math.round(next.chance * 100) : 0;
    openModal(`<h2>대장장이 진명</h2>
      <div class="panel-card upgrade-intro-v28">
        <b>무기 강화소</b>
        <p>장착 중인 무기만 강화할 수 있습니다. 강화 등급이 오르면 무기 능력치가 함께 상승합니다.</p>
        ${upgradeRatesHtmlV33()}
      </div>
      <div class="panel-card upgrade-hero-v27 upgrade-hero-v28">
        <div class="upgrade-weapon-v27 ${weaponTierAttrs}"><div class="upgrade-icon-v27">${item ? itemIcon(item) : '▫️'}</div><div><b>${item ? displayItemNameV33(item) : '무기 없음'}</b><p>${item ? enhancedStatsTextV33(item) : '장착한 무기가 없습니다.'}</p><small>현재 등급: ${current.name}</small></div></div>
        <div class="upgrade-info-v27"><b>강화 비용: 3빌딩</b><p>${next ? `성공 시 ${next.name} 등급으로 상승 · 성공률 ${chance}%` : '이미 전설 등급입니다.'}</p><p class="muted">강화에는 약 4초가 걸립니다.</p><button class="primary wide" ${(!item || !next || game.upgradeInProgress) ? 'disabled' : ''} onclick="upgradeCurrentWeaponV33()">무기 강화</button></div>
      </div>
      <div class="panel-card"><b>보유 빌딩:</b> ${game.player?.building || 0}</div>`, { type:'upgradeShop', pause:true });
  }
  window.openUpgradeShopModalV33 = openUpgradeShopModalV33;

  function renderUpgradeProgressV33(item, next) {
    openModal(`<h2>대장장이 진명</h2>
      <div class="upgrade-progress-v28">
        <div class="forge-ring-v28"><span>⚒</span><i></i><i></i><i></i></div>
        <h3>강화중...</h3>
        <p>${escapeHtml(item.name)}을(를) ${next.name} 등급으로 강화하고 있습니다.</p>
        <div class="upgrade-loading-bar-v28"><b></b></div>
        <small>진명이 무기에 빌딩의 기운을 불어넣고 있습니다.</small>
      </div>`, { type:'upgradeProgress', pause:true });
  }
  function renderUpgradeResultV33(success, item, newTier, oldTier) {
    const cls = success ? 'success' : 'fail';
    const title = success ? '강화 성공!' : '강화 실패...';
    const sub = success ? `${item.name}이(가) ${tierInfoV33(newTier).name} 등급이 되었습니다.` : `${item.name}의 강화가 불안정해져 ${tierInfoV33(newTier).name} 등급이 되었습니다.`;
    openModal(`<h2>대장장이 진명</h2>
      <div class="upgrade-result-v28 ${cls}">
        <div class="upgrade-burst-v28">${success ? '✦' : '⌁'}</div>
        <h3>${title}</h3>
        <p>${sub}</p>
        <div class="upgrade-tier-change-v28"><span>${tierInfoV33(oldTier).name}</span><b>→</b><span>${tierInfoV33(newTier).name}</span></div>
        <button class="primary wide" onclick="openUpgradeShopModalV33()">확인</button>
      </div>`, { type:'upgradeResult', pause:true });
  }
  window.upgradeCurrentWeaponV33 = function upgradeCurrentWeaponV33() {
    try { ensurePlayerV27Fields?.(); } catch {}
    if (game.upgradeInProgress) return;
    const weaponId = game.player?.equipment?.weapon;
    const item = weaponId ? getItemDefinition(weaponId, game.player.class) : null;
    if (!item || item.slot !== 'weapon') { toast('강화할 무기를 장착해 주세요.'); return; }
    const tier = getWeaponTierV33(item.id);
    if (tier >= 4) { toast('이미 전설 등급입니다.'); return; }
    if ((game.player.building || 0) < 3) { toast('빌딩 화폐가 부족합니다. 강화에는 3빌딩이 필요합니다.'); return; }
    const next = (window.TIER_INFO_V27 || [])[tier + 1];
    game.upgradeInProgress = true;
    game.player.building -= 3;
    try { window.recordQuestActionV38 && window.recordQuestActionV38('enhance'); } catch {}
    updateHud?.(); savePlayer?.();
    renderUpgradeProgressV33(item, next);
    playSfx?.('upgradeCharge');
    setTimeout(() => {
      const success = YuksamCombatRules.rollEnhancement(next.chance, Math.random());
      const newTier = success ? tier + 1 : Math.max(0, tier - 1);
      game.player.weaponUpgrades[item.id] = newTier;
      ensurePlayerHp?.(); savePlayer?.(); updateHud?.();
      game.upgradeInProgress = false;
      playSfx?.(success ? 'upgradeSuccess' : 'upgradeFail');
      if (success) {
        try { showCinematicMessage('강화 성공!', `${item.name} · ${tierInfoV33(newTier).name} 등급`, 1600); } catch {}
      }
      const msg = success ? `${item.name} 강화 성공! ${tierInfoV33(newTier).name} 등급이 되었습니다.` : `${item.name} 강화 실패... ${tierInfoV33(newTier).name} 등급으로 하락했습니다.`;
      appendChatMessage?.('system', '강화', msg);
      renderUpgradeResultV33(success, item, newTier, tier);
    }, 4000);
  };

  worldRenderPipeline.registerOwner({
    id:'upgrade-shop-v33',
    priority:330,
    owns:({ map }) => map === 'upgradeShopInterior',
    render:() => { updateCamera(); drawUpgradeShopInteriorV33(); },
  });


  appendChatMessage?.('system','패치','v33: 장비창 펫 슬롯 이동, 펫 장착 선택, 강화/펫 효과음 교체, 진명 망치 방향 보정, 펫 상점 위치 이동이 적용되었습니다.');
})();


/* =========================
   v34 patch: town shop collisions + final boss room redesign + tooltip cleanup + legendary pet
   ========================= */
(function yuksamV34Patch(){
  if (window.__YUKSAM_V34_PATCH__) return;
  window.__YUKSAM_V34_PATCH__ = true;

  try { document.title = '63월드'; } catch {}

  // 펫상점/대장간 위치와 최종보스방을 안정적으로 고정
  if (worldDefs?.town?.petShop) {
    worldDefs.town.petShop = { x: 410, y: 360, w: 250, h: 190, name: '펫 상점', doorX: 410, doorY: 474 };
  }
  if (worldDefs?.town?.upgradeShop) {
    worldDefs.town.upgradeShop = WORLD_PATCHES_V34.townUpgradeShop;
  }
  worldDefs.finalBossRoom = WORLD_PATCHES_V34.finalBossRoom;
  if (worldDefs?.petShopInterior) {
    worldDefs.petShopInterior.orb = WORLD_PATCHES_V34.petShopOrb;
  }
  if (worldDefs?.upgradeShopInterior) {
    worldDefs.upgradeShopInterior.blacksmith = { x:590, y:276, r:50, name:'대장장이 진명' };
  }

  try {
    const style = document.createElement('style');
    style.id = 'yuksam-v34-style';
    style.textContent = `
      .toast:not(.hidden){display:block!important;}
      .toast.resource-warning-v34{
        background:linear-gradient(180deg,rgba(127,29,29,.98),rgba(69,10,10,.96))!important;
        border-color:rgba(252,165,165,.40)!important;
        color:#fff!important;
        box-shadow:0 16px 46px rgba(0,0,0,.42),0 0 0 1px rgba(248,113,113,.18) inset!important;
        font-weight:900;
      }
      .modal-box.pet-modal-box-v34{
        width:min(520px,100%)!important;
      }
      .pet-shop-summon-v33,
      .pet-shop-summon-v34{max-width:420px;margin:0 auto;text-align:center;}
      .pet-shop-summon-v34 .panel-card{padding:22px!important;}
      .pet-shop-summon-v34 .summon-btn-v34{font-size:17px;padding:14px 24px;min-width:230px;margin-top:14px;}
      .ys-tooltip-v31:not(.show){display:none!important;}
      .ys-tooltip-v31.show{display:block!important;}
      .finalboss-hint-v34{
        position:fixed;left:50%;bottom:28px;transform:translateX(-50%);
        z-index:30;padding:10px 16px;border-radius:999px;
        background:rgba(2,6,23,.72);border:1px solid rgba(216,180,254,.28);
        color:#f5e8ff;font-weight:900;font-size:13px;
        pointer-events:none;
      }
    `;
    document.head.appendChild(style);
  } catch {}

  function hideGameTooltipV34() {
    try {
      document.querySelectorAll('.ys-tooltip-v31, .ys-tooltip-v34').forEach((el) => {
        el.classList.remove('show');
        el.style.opacity = '0';
        el.style.display = 'none';
      });
    } catch {}
  }
  worldInteractionBeforeDispatch = hideGameTooltipV34;

  // 모달이 닫히거나 새 모달이 열릴 때 툴팁/펫모달 스타일을 정리
  const oldCloseModalV34 = closeModal;
  closeModal = function closeModalV34() {
    hideGameTooltipV34();
    document.querySelector('.modal-box')?.classList.remove('pet-modal-box-v34');
    return oldCloseModalV34();
  };
  window.closeModal = closeModal;

  const oldOpenModalV34 = openModal;
  openModal = function openModalV34(html, options = {}) {
    hideGameTooltipV34();
    document.querySelector('.modal-box')?.classList.remove('pet-modal-box-v34');
    return oldOpenModalV34(html, options);
  };
  window.openModal = openModal;

  YuksamInputRouter.register({ id:'tooltip-escape', type:'keydown', priority:100, handle:(e) => {
    if (e.key === 'Escape') hideGameTooltipV34();
    return false;
  }});
  document.addEventListener('mouseleave', hideGameTooltipV34, true);

  // 자원 부족 알림이 실제로 보이도록 toast 보강
  const oldToastV34 = toast;
  toast = function toastV34(msg, ms = 1800) {
    const text = String(msg || '');
    const isShortage = /부족|모자랍니다|필요합니다/.test(text);
    oldToastV34(isShortage && !text.startsWith('⚠') ? `⚠ ${text}` : text, isShortage ? Math.max(ms, 2400) : ms);
    const el = $('toast');
    if (el) {
      el.classList.toggle('resource-warning-v34', isShortage);
      clearTimeout(el._warningTimer);
      if (isShortage) {
        el._warningTimer = setTimeout(() => el.classList.remove('resource-warning-v34'), Math.max(ms, 2400));
      }
    }
  };
  window.toast = toast;

  // 펫상점/대장간 마을 건물 충돌을 직접 보강
  function extraTownBuildingCollidersV34() {
    const t = worldDefs.town;
    const cols = [];
    if (t?.petShop) cols.push({ type:'rect', x:t.petShop.x, y:t.petShop.y + 18, w:t.petShop.w * .9, h:t.petShop.h * .82 });
    if (t?.upgradeShop) cols.push({ type:'rect', x:t.upgradeShop.x, y:t.upgradeShop.y + 18, w:t.upgradeShop.w * .9, h:t.upgradeShop.h * .82 });
    return cols;
  }
  worldNavigationRegistry.registerCollider({ id:'final-shop-colliders-v34', priority:340, resolve:() => {
    if (game.currentMap === 'town') {
      return [...getBaseMapColliders(), ...extraTownBuildingCollidersV34()];
    }
    if (game.currentMap === 'petShopInterior') {
      const s = worldDefs.petShopInterior;
      return [
        { type:'circle', x:s.orb.x, y:s.orb.y - 20, r:76 },
        { type:'circle', x:310, y:455, r:36 },
        { type:'circle', x:870, y:460, r:36 },
        { type:'circle', x:960, y:230, r:34 },
        { type:'circle', x:230, y:245, r:34 },
      ];
    }
    if (game.currentMap === 'upgradeShopInterior') {
      const s = worldDefs.upgradeShopInterior;
      return [
        { type:'circle', x:s.blacksmith.x, y:s.blacksmith.y, r:52 },
        { type:'rect', x:160, y:555, w:124, h:104 },
        { type:'rect', x:1038, y:428, w:138, h:178 },
        { type:'rect', x:1010, y:244, w:168, h:78 },
      ];
    }
    return null;
  }});

  // 펫 수정구 내부 오브젝트/위성 펫 복구
  function drawPetShopDecorV34() {
    const ctx = game.ctx;
    const crystals = [
      { x:310, y:455, c:'#f0abfc' },
      { x:870, y:460, c:'#93c5fd' },
      { x:960, y:230, c:'#fde68a' },
      { x:230, y:245, c:'#c084fc' },
      { x:400, y:210, c:'#f9a8d4' },
      { x:780, y:210, c:'#a78bfa' },
    ];
    crystals.forEach((cr) => {
      const p = worldToScreen(cr.x, cr.y);
      ctx.save();
      ctx.translate(p.x, p.y);
      const pulse = .34 + Math.sin(performance.now()/420 + cr.x) * .06;
      ctx.fillStyle = cr.c;
      ctx.globalAlpha = pulse;
      ctx.beginPath();
      ctx.moveTo(0, -26); ctx.lineTo(22, -2); ctx.lineTo(10, 30); ctx.lineTo(-10, 30); ctx.lineTo(-22, -2); ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = pulse * .7;
      ctx.strokeStyle = cr.c; ctx.lineWidth = 2; ctx.stroke();
      ctx.restore();
    });
    const paw = worldToScreen(590, 520);
    ctx.save();
    ctx.textAlign='center';
    ctx.font='900 76px Apple Color Emoji, Segoe UI Emoji';
    ctx.globalAlpha=.13;
    ctx.fillText('🐾', paw.x, paw.y);
    ctx.restore();
  }

  function drawPetShopInteriorV34() {
    const ctx = game.ctx, world = worldDefs.petShopInterior;
    ctx.clearRect(0,0,game.width,game.height);
    const g = ctx.createLinearGradient(0,0,0,game.height);
    g.addColorStop(0,'#432f56');
    g.addColorStop(.5,'#281f3f');
    g.addColorStop(1,'#111827');
    ctx.fillStyle = g;
    ctx.fillRect(0,0,game.width,game.height);
    drawTerrainDots(ctx, world, '#ffffff', .038, 30, 9);
    drawPetShopDecorV34();
    drawCrystalPedestalWorld(world.orb.x, world.orb.y, '#f9a8d4');
    const orb = worldToScreen(world.orb.x, world.orb.y);
    const t = performance.now() / 520;
    ctx.save();
    const halo = ctx.createRadialGradient(orb.x, orb.y - 30, 8, orb.x, orb.y - 30, 108);
    halo.addColorStop(0, 'rgba(244,114,182,.70)');
    halo.addColorStop(.5, 'rgba(217,70,239,.20)');
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(orb.x, orb.y - 30, 108, 0, Math.PI * 2);
    ctx.fill();
    ['🐤','🍄','🐉','🐱','🐶','🏢'].forEach((ic,i) => {
      const a = t + i * 1.05;
      ctx.font = '900 30px Noto Sans KR, Apple Color Emoji, Segoe UI Emoji, system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = ic === '🏢' ? .72 : .92;
      ctx.fillText(ic, orb.x + Math.cos(a) * 82, orb.y - 46 + Math.sin(a) * 30);
    });
    ctx.globalAlpha = 1;
    ctx.font = '900 15px Jua, Noto Sans KR, system-ui';
    ctx.textAlign='center';
    ctx.fillStyle = '#fff7ed';
    ctx.strokeStyle='rgba(15,23,42,.7)';
    ctx.lineWidth=4;
    ctx.strokeText('펫 수정구', orb.x, orb.y - 92);
    ctx.fillText('펫 수정구', orb.x, orb.y - 92);
    ctx.restore();
    drawNpcIdleBubble(ctx, orb.x, orb.y - 62, '펫 수정구', 1);
    const ex = worldToScreen(world.exit.x, world.exit.y);
    drawExitMarker(ex.x, ex.y);
    drawTitleLabel('펫 상점');
  }

  // 펫 팔로워는 상점/대장간에서도 동일하게 표시
  function drawPetFollowerV34(ctx) {
    if (!game.player) return;
    const petDefs = window.PET_DEFS_V27 || {};
    const pet = petDefs[game.player.activePet];
    if (!pet) return;
    const now = Date.now();
    const dir = game.lastMove || { x: 1, y: 0 };
    if (Math.abs(dir.x) > 0.1) game.player._petSide = dir.x > 0 ? 'left' : 'right';
    const side = game.player._petSide || 'left';
    const moving = !!game.isMoving;
    const dancing = (game.danceTimer || 0) > 0;
    const wx = game.player.x + (side === 'left' ? -54 : 54) + (dancing ? Math.sin(now / 90) * 4 : 0);
    const wy = game.player.y + 8 - (moving ? Math.abs(Math.sin(now / 120 + (pet.bob || 0))) * 11 : Math.sin(now / 340 + (pet.bob || 0)) * 2.5);
    const p = worldToScreen(wx, wy);
    ctx.save();
    drawShadow(ctx, p.x, p.y + 24, 18, 6, .16);
    ctx.translate(p.x, p.y);
    ctx.rotate(dancing ? Math.sin(now / 95 + (pet.bob || 0)) * 0.2 : Math.sin(now / 500 + (pet.bob || 0)) * 0.03);
    const bounce = dancing ? 1.08 + Math.sin(now / 70) * .06 : 1 + Math.sin(now / 460 + (pet.bob || 0)) * .02;
    ctx.scale(bounce, bounce);
    ctx.font = pet.legendary ? '900 36px Noto Sans KR, Apple Color Emoji, Segoe UI Emoji, system-ui' : '900 33px Noto Sans KR, Apple Color Emoji, Segoe UI Emoji, system-ui';
    ctx.textAlign='center';
    ctx.textBaseline='middle';
    ctx.lineWidth=4;
    ctx.strokeStyle='rgba(15,23,42,.52)';
    ctx.strokeText(pet.icon, 0, 0);
    ctx.fillText(pet.icon, 0, 0);
    if (pet.legendary) {
      ctx.globalAlpha = .85;
      ctx.strokeStyle = 'rgba(251,191,36,.65)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 25 + Math.sin(now/240)*3, 0, Math.PI*2);
      ctx.stroke();
    }
    if (moving) {
      ctx.fillStyle = pet.color || '#fde68a';
      ctx.globalAlpha = .74;
      ctx.beginPath(); ctx.ellipse(-8, 20, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(8, 20, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
    }
    if (dancing) {
      ctx.globalAlpha = .92;
      ctx.font = '900 15px Jua, Noto Sans KR, system-ui';
      ctx.fillStyle = pet.color || '#fde68a';
      ctx.fillText('♪', -22, -24);
      ctx.fillText('♬', 22, -30);
    }
    ctx.restore();
  }

  // 펫 소환 확률: 일반 5종 각 19%, 전설 육삼이 5%
  // rollWeightedPetV34는 v35에서도 쓰도록 최상위 복원 섹션으로 이동됨

  function openPetShopModalV34() {
    try { ensurePlayerV27Fields?.(); } catch {}
    openModal(`<div class="pet-shop-summon-v34"><h2>펫 수정구</h2>
      <div class="panel-card">
        <b>랜덤 펫 소환</b>
        <p>수정구의 빛을 따라 새로운 동행을 만납니다.</p>
        <p class="muted">일반 펫 각 19% · 전설 펫 육삼이 5%</p>
        <p class="muted">소환 비용: 10빌딩</p>
        <div class="resource-balance-banner resource-building"><span>현재 보유 빌딩 화폐</span><b>🏢 ${game.player?.building || 0}</b></div>
        <br>
        <button class="primary summon-btn-v34" onclick="rollPetV34()">랜덤 펫 소환</button>
      </div></div>`, { type:'petShop', pause:true });
    document.querySelector('.modal-box')?.classList.add('pet-modal-box-v34');
  }
  window.openPetShopModalV34 = openPetShopModalV34;


  // 펫 장착창에도 육삼이 표시/툴팁 반영
  const oldOpenPetEquipModalV34 = window.openPetEquipModalV33;
  window.openPetEquipModalV33 = function openPetEquipModalV34() {
    try { ensurePlayerV27Fields?.(); } catch {}
    const petDefs = window.PET_DEFS_V27 || {};
    const owned = (game.player.pets || []).filter((id) => petDefs[id]);
    if (!owned.length) {
      openModal(`<h2>동행 펫</h2><div class="panel-card"><p>아직 보유한 펫이 없습니다.</p><p class="muted">펫 상점의 수정구에서 랜덤 펫을 먼저 만나보세요.</p></div><button class="primary wide" onclick="openCharacterPanel()">돌아가기</button>`, { type:'petEquip', pause:true });
      return;
    }
    const cards = owned.map((id) => {
      const p = petDefs[id];
      const active = game.player.activePet === id;
      return `<div class="pet-equip-card-v33 ${active ? 'active' : ''}">
        <div class="pet-icon">${p.icon}</div>
        <div><h3>${escapeHtml(p.name)} ${p.legendary ? '<span class="badge gold">전설</span>' : ''}</h3><p>${escapeHtml(p.desc)} · ${escapeHtml(Object.entries(p.stats || {}).map(([k,v]) => `${k} +${v}`).join(' · '))}</p></div>
        <button class="${active ? 'ghost' : 'primary'} small" ${active ? 'disabled' : ''} onclick="equipPetFromPanelV33('${id}')">${active ? '동행 중' : '동행'}</button>
      </div>`;
    }).join('');
    openModal(`<h2>동행 펫 선택</h2><p class="muted">보유한 펫 중 하나를 선택해 캐릭터 옆에 함께 다니게 합니다.</p><div class="pet-equip-grid-v33">${cards}</div><div style="margin-top:12px"><button class="ghost wide" onclick="openCharacterPanel()">돌아가기</button></div>`, { type:'petEquip', pause:true });
  };

  // 최종 보스방 완전 재설계
  function ensureFinalTeacherBossV34() {
    const def = worldDefs.finalBossRoom.teacher;
    if (!game.finalTeacherBossV34 || game.finalTeacherBossV34.alive === false) {
      game.finalTeacherBossV34 = monsterBase({
        id:'teacher_final_v34',
        type:'teacherBoss',
        name:'명진쌤',
        level:99,
        hp:999,   // [밸런스] 사실상 못 깨는 히든보스 컨셉 (사용자 지정)
        attack:20 + Math.floor(Math.random() * 6), // 공격 20~25 난수
        x:def.x,
        y:def.y,
        r:def.r,
        exp:363,  // [밸런스] 최종보스 보상 (기존 0)
        gold:363,
        speed:0,
        aggro:0,
      });
    }
    Object.assign(game.finalTeacherBossV34, {
      x:def.x, y:def.y, r:def.r,
      name:'명진쌤',
      level:99,
      maxHp:999,
      hp: Math.min(999, Math.max(1, game.finalTeacherBossV34.hp || 999)),
      attack:20 + Math.floor(Math.random() * 6),
      elite:true,
      noEscape:true,
      chasing:false,
      speed:0,
      aggro:0,
      alive:true,
    });
    return game.finalTeacherBossV34;
  }

  function exitFinalBossRoomV34() {
    closeModal();
    hideGameTooltipV34();
    const ret = game.finalBossReturn || { map:'bossRoom', x:760, y:540 };
    game.currentMap = ret.map || 'bossRoom';
    game.player.map = game.currentMap;
    game.player.x = ret.x || 760;
    game.player.y = ret.y || 540;
    game.keys = {};
    game.isMoving = false;
    game.modalState = { type:null, pause:false };
    if (game.currentMap === 'bossRoom') {
      try { resetForestMonsters('bossRoom'); } catch {}
      // ??? 포탈은 유지
      game.finalBossPortalUnlocked = true; // [피드백] 세션 한정 — 방을 나가면 사라짐
    }
    updateHud?.();
    syncAudioFileBgm?.();
    savePlayer?.();
    appendChatMessage?.('system','이동','???에서 빠져나왔습니다.');
  }
  window.exitFinalBossRoomV34 = exitFinalBossRoomV34;

  window.openFinalTeacherDialogueV26 = function openFinalTeacherDialogueV34() {
    openModal(`<div class="dialogue-box final-teacher-dialogue-v26">
      <div class="dialogue-speaker"><h2>LV.99 명진쌤 <span class="badge danger">최종 보스</span></h2><div class="badge">E키로 진행</div></div>
      <div class="dialogue-text">여기까지 오다니… 대단하구나!<br>하지만 이 모든 것은 너의 성장을 위한 것이었다.<br>이제 나를 뛰어넘어보거라!</div>
      <div class="dialogue-options"><button class="primary" onclick="startFinalTeacherBattleV34()">도전한다</button><button class="ghost" onclick="closeModal()">아직 준비가 안 됐습니다</button></div>
    </div>`, { type:'dialogue', pause:true });
  };
  window.startFinalTeacherBattleV34 = function startFinalTeacherBattleV34() {
    const boss = ensureFinalTeacherBossV34();
    boss.hp = boss.maxHp; // [피드백] 재도전 시 항상 풀피로 시작
    boss.alive = true; boss.dying = false;
    closeModal();
    setTimeout(() => openCombat(boss), 90);
  };
  window.startFinalTeacherBattleV26 = window.startFinalTeacherBattleV34;

  function drawFinalTeacherBubbleV34(ctx, x, y) {
    const arr = ['여기까지 왔구나.', '성장은 언제나 시련 뒤에 찾아온단다.', '나를 뛰어넘어 보거라.'];
    const cycle = 12000;
    const now = Date.now();
    const phase = now % cycle;
    if (phase > 5600) return;
    const text = arr[Math.floor(now / cycle) % arr.length];
    ctx.save();
    ctx.textAlign='center';
    ctx.font='900 13px Jua, Noto Sans KR, system-ui';
    const w = Math.min(270, ctx.measureText(text).width + 36);
    const bx = x - w/2, by = y - 118;
    ctx.globalAlpha = Math.min(1, phase/500) * Math.min(1, (5600-phase)/500);
    ctx.fillStyle = 'rgba(255,255,255,.94)';
    ctx.strokeStyle='rgba(216,180,254,.56)';
    ctx.lineWidth=1.5;
    roundRect(ctx, bx, by, w, 34, 14);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 8, by + 30);
    ctx.lineTo(x, by + 42);
    ctx.lineTo(x + 8, by + 30);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#221133';
    ctx.fillText(text, x, by + 22);
    ctx.restore();
  }

  function drawFinalBossRoomV34() {
    const ctx = game.ctx;
    const world = worldDefs.finalBossRoom;
    ctx.clearRect(0,0,game.width,game.height);
    updateCamera();

    const g = ctx.createRadialGradient(game.width/2, game.height/2, 40, game.width/2, game.height/2, 620);
    g.addColorStop(0, '#2a1024');
    g.addColorStop(.48, '#12081a');
    g.addColorStop(1, '#020104');
    ctx.fillStyle = g;
    ctx.fillRect(0,0,game.width,game.height);

    ctx.save();
    const t = performance.now();
    ctx.strokeStyle = 'rgba(168,85,247,.18)';
    ctx.lineWidth = 8;
    for (let i=0;i<4;i+=1) {
      ctx.beginPath();
      ctx.ellipse(game.width/2, game.height/2 + 70, 330 + i*58 + Math.sin(t/600+i)*6, 170 + i*30, 0, 0, Math.PI*2);
      ctx.stroke();
    }
    ctx.strokeStyle='rgba(244,114,182,.13)';
    ctx.lineWidth=2;
    for (let x=80; x<game.width; x+=120) {
      ctx.beginPath();
      ctx.moveTo(x + Math.sin(t/900+x)*10, 0);
      ctx.lineTo(x - 80, game.height);
      ctx.stroke();
    }
    ctx.restore();

    // 출구 포탈
    const ex = worldToScreen(world.exit.x, world.exit.y);
    drawPortalSprite(ctx, ex.x, ex.y, 32, performance.now()/650, '#64748b');
    ctx.save();
    ctx.textAlign='center';
    ctx.font='900 15px Jua, Noto Sans KR, system-ui';
    ctx.fillStyle='#e5e7eb';
    ctx.fillText('나가기', ex.x, ex.y - 48);
    ctx.restore();

    // 최종 보스 NPC
    const boss = ensureFinalTeacherBossV34();
    const bp = worldToScreen(boss.x, boss.y);
    ctx.save();
    const pulse = .55 + Math.sin(performance.now()/260) * .22;
    const aura = ctx.createRadialGradient(bp.x, bp.y+18, 8, bp.x, bp.y+18, 112);
    aura.addColorStop(0, `rgba(168,85,247,${0.42+pulse*.16})`);
    aura.addColorStop(.55, 'rgba(88,28,135,.26)');
    aura.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(bp.x, bp.y+18, 112, 0, Math.PI*2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(216,180,254,.65)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8,8]);
    ctx.beginPath();
    ctx.arc(bp.x, bp.y+18, 78 + Math.sin(performance.now()/300)*6, 0, Math.PI*2);
    ctx.stroke();
    ctx.restore();

    drawNpcSprite(ctx, bp.x, bp.y, '명진쌤', false, 1.55, isNearPoint({x:boss.x,y:boss.y}, 118), 'priest');
    drawNameLabel(ctx, bp.x, bp.y, 'LV.99 명진쌤', 1.05);
    drawFinalTeacherBubbleV34(ctx, bp.x, bp.y);

    // 플레이어는 반드시 최종 레이어에 다시 그림
    if (!Number.isFinite(game.player.x) || !Number.isFinite(game.player.y)) {
      game.player.x = world.playerSpawn.x;
      game.player.y = world.playerSpawn.y;
    }
    const ps = worldToScreen(game.player.x, game.player.y);
    drawPetFollowerV34(ctx);
    drawPlayerSprite(ctx, ps.x, ps.y, game.player.appearance, game.player.class, { attack:game.attackTimer, moving:game.isMoving, dance:game.danceTimer, equipment:game.player.equipment }, PLAYER_WORLD_SCALE, game.player.spec);
    drawPlayerNameplate(ctx, ps.x, ps.y, game.player);
    drawTitleLabel?.('???');
  }

  worldRenderPipeline.registerOwner({
    id:'shops-v34',
    priority:340,
    owns:({ map }) => map === 'petShopInterior',
    render:() => { updateCamera(); drawPetShopInteriorV34(); },
  });
  worldRenderPipeline.registerLayer({
    id:'shop-actors-v34',
    priority:340,
    when:({ map }) => map === 'petShopInterior' || map === 'upgradeShopInterior',
    render:() => {
      if (!game.player) return;
      const ctx = game.ctx;
      const ps = worldToScreen(game.player.x, game.player.y);
      drawPetFollowerV34(ctx);
      drawPlayerSprite(ctx, ps.x, ps.y, game.player.appearance, game.player.class, { attack:game.attackTimer, moving:game.isMoving, dance:game.danceTimer, equipment:game.player.equipment }, PLAYER_WORLD_SCALE, game.player.spec);
      drawPlayerNameplate(ctx, ps.x, ps.y, game.player);
    },
  });
  worldRenderPipeline.registerLayer({
    id:'pet-follower-v34',
    priority:341,
    when:({ map }) => !['petShopInterior', 'upgradeShopInterior', 'finalBossRoom', 'raidTower'].includes(map),
    render:() => drawPetFollowerV34(game.ctx),
  });


  const oldGetNearbyMonsterV34 = getNearbyMonster;
  getNearbyMonster = function getNearbyMonsterV34(range = 42) {
    if (game.currentMap === 'finalBossRoom') return null;
    return oldGetNearbyMonsterV34(range);
  };


  worldNavigationRegistry.registerTransition({ id:'navigation-guard-v34', priority:340, handle:() => {
    if (!game.player) return true;
    if (game.transitionLock && Date.now() < game.transitionLock) return true;
    return game.currentMap === 'finalBossRoom';
  }});

  // 시작 시 최종방에 저장된 캐릭터가 있으면 안전 위치로 복구
  const oldStartGameV34 = startGame;
  startGame = function startGameV34(existing = false, options = {}) {
    oldStartGameV34(existing, options);
    if (game.currentMap === 'finalBossRoom' && game.player) {
      game.player.x = worldDefs.finalBossRoom.playerSpawn.x;
      game.player.y = worldDefs.finalBossRoom.playerSpawn.y;
      game.player.map = 'finalBossRoom';
      game.keys = {};
      ensureFinalTeacherBossV34();
      updateHud?.();
    }
  };

  appendChatMessage?.('system','패치','v34: 마을 신규 건물 충돌, 최종 보스방 재설계, 툴팁 잔상 제거, 펫 수정구 오브젝트 복구, 육삼이 전설 펫이 적용되었습니다.');
})();

/* =========================
   v35 patch: skill layout redesign / tooltip restore / pet shop placement / simple ??? room
   ========================= */
(function yuksamV35Patch(){
  if (window.__YUKSAM_V35_PATCH__) return;
  window.__YUKSAM_V35_PATCH__ = true;

  try { document.title = '63월드'; } catch {}

  // 1) 마을 펫 상점 위치 재배치 (남서쪽 끝과 중심 포탈의 중간 지점 느낌)
  if (worldDefs?.town?.petShop) {
    worldDefs.town.petShop = { x: 620, y: 1360, w: 248, h: 186, name: '펫 상점', doorX: 620, doorY: 1466 };
  }

  // 4) 커스텀 툴팁 복구/안정화
  function ensureV35TooltipTarget() {
    return document.querySelector('.ys-tooltip-v31') || (typeof ensureGameTooltipV31 === 'function' ? ensureGameTooltipV31() : null);
  }
  function showTooltipV35(target, evt) {
    const raw = target?.dataset?.tooltip || target?.getAttribute?.('title');
    if (!raw) return;
    const tip = ensureV35TooltipTarget();
    if (!tip) return;
    if (target.title) {
      target.dataset.tooltip = target.title;
      target.removeAttribute('title');
    }
    if (typeof formatTooltipV31 === 'function') tip.innerHTML = formatTooltipV31(raw);
    else tip.textContent = raw;
    tip.style.display = 'block';
    if (typeof moveTooltipV31 === 'function' && evt) moveTooltipV31(evt);
    tip.classList.add('show');
  }
  function hideTooltipV35() {
    const tip = ensureV35TooltipTarget();
    if (!tip) return;
    tip.classList.remove('show');
    tip.style.display = 'none';
  }
  document.addEventListener('mouseenter', (e) => {
    const target = e.target.closest('[data-tooltip], [title]');
    if (!target) return;
    showTooltipV35(target, e);
  }, true);
  document.addEventListener('mousemove', (e) => {
    const tip = document.querySelector('.ys-tooltip-v31.show');
    if (!tip) return;
    if (typeof moveTooltipV31 === 'function') moveTooltipV31(e);
  }, true);
  document.addEventListener('mouseout', (e) => {
    const target = e.target.closest?.('[data-tooltip], [title]');
    if (!target) return;
    const rel = e.relatedTarget;
    if (rel && target.contains(rel)) return;
    hideTooltipV35();
  }, true);
  document.addEventListener('focusin', (e) => {
    const target = e.target.closest?.('[data-tooltip], [title]');
    if (target) showTooltipV35(target, { clientX: 100, clientY: 100 });
  }, true);
  document.addEventListener('focusout', hideTooltipV35, true);
  const oldCloseModalV35 = closeModal;
  closeModal = function closeModalV35(){ hideTooltipV35(); return oldCloseModalV35(); };
  window.closeModal = closeModal;

  // 5) 펫 소환 효과음 복구 및 결과창에 육삼이 얼굴 표현
  function playPetSummonSfxV35() {
    try {
      resumeAudio?.();
      if (!game.audio) game.audio = {};
      if (!game.audio.petSummonFileV35) {
        game.audio.petSummonFileV35 = new Audio(window.getAudioAsset?.('petDraw')?.src || '');
        game.audio.petSummonFileV35.preload = 'auto';
      }
      const file = game.audio.petSummonFileV35;
      const vol = game.settings?.sfxEnabled ? Math.min(1, Math.max(0, Number(game.settings.sfxVolume ?? 1))) : 0;
      file.volume = vol;
      if (!game.settings?.sfxEnabled) return;
      file.pause(); file.currentTime = 0;
      file.play().catch(()=>{});
    } catch {}
  }
  window.playPetSummonSfxV35 = playPetSummonSfxV35;
  function renderPetIconV35(pet) {
    if (!pet) return '＋';
    if (pet.id === 'yuksam') return `<span class="yuksam-face-icon-v35">🏢<span class="face">•‿•</span></span>`;
    return escapeHtml(pet.icon || '＋');
  }
  window.rollPetV34 = function rollPetV35() {
    try { ensurePlayerV27Fields?.(); } catch {}
    if ((game.player.building || 0) < 10) { toast('빌딩 화폐가 부족합니다. 펫 소환에는 10빌딩이 필요합니다.'); return; }
    const id = (typeof rollWeightedPetV34 === 'function') ? rollWeightedPetV34() : 'chick';
    const pet = window.PET_DEFS_V27?.[id];
    if (!pet) return;
    closeModal();
    playPetSummonSfxV35();
    const overlay = document.createElement('div');
    overlay.className = 'pet-summon-modal-v31';
    overlay.innerHTML = `<div class="pet-summon-box-v31"><div class="pet-orb-loader-v31"></div><h2>펫을 만나는 중...</h2><p>수정구 너머에서 작은 친구가 다가오고 있습니다.</p><div class="pet-loading-bar-v31"><b></b></div></div>`;
    document.body.appendChild(overlay);
    setTimeout(() => {
      game.player.building -= 10;
      if (!game.player.pets.includes(id)) game.player.pets.push(id);
      game.player.activePet = id;
      try { window.recordQuestActionV38 && window.recordQuestActionV38('pet'); } catch {}
      ensurePlayerHp?.(); savePlayer?.(); updateHud?.();
      overlay.innerHTML = `<div class="pet-summon-box-v31"><div class="pet-icon-result-v31">${renderPetIconV35(pet)}</div><h2>${escapeHtml(pet.name)}을(를) 만났습니다!</h2>${pet.legendary ? '<p class="badge gold">전설 펫</p>' : ''}<button class="primary wide" onclick="closePetSummonResultV31()">확인</button></div>`;
      appendChatMessage?.('system', '펫', `${pet.name}을(를) 만났습니다.`);
    }, 5000);
  };

  // 6) 육삼이 펫 팔로워 얼굴 추가
  function drawYuksamPetV35(ctx, p, dancing, moving, pet, now = Date.now()) {
    ctx.save();
    ctx.translate(p.x, p.y);
    const wobble = dancing ? Math.sin(now/95)*0.18 : Math.sin(now/520)*0.03;
    ctx.rotate(wobble);
    ctx.font = '900 34px Noto Sans KR, Apple Color Emoji, Segoe UI Emoji, system-ui';
    ctx.textAlign='center';
    ctx.textBaseline='middle';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(15,23,42,.55)';
    ctx.strokeText('🏢', 0, 0);
    ctx.fillText('🏢', 0, 0);
    ctx.fillStyle = '#1f2937';
    ctx.beginPath(); ctx.arc(-6, -1, 2.1, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(6, -1, 2.1, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#1f2937'; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.arc(0, 5, 6, 0.2, Math.PI - 0.2); ctx.stroke();
    ctx.strokeStyle = 'rgba(251,191,36,.76)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 25 + Math.sin(now/240)*3, 0, Math.PI*2); ctx.stroke();
    if (moving) {
      ctx.fillStyle = pet.color || '#fbbf24';
      ctx.globalAlpha = .7;
      ctx.beginPath(); ctx.ellipse(-8, 20, 5, 3, 0, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(8, 20, 5, 3, 0, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }
  // Realtime friends use this exact painter too, including 육삼이's eyes and smile.
  window.drawYuksamPetV35 = drawYuksamPetV35;
  worldRenderPipeline.registerOwner({
    id:'final-boss-room-v35',
    priority:350,
    owns:({ map }) => map === 'finalBossRoom',
    render:() => drawFinalBossRoomV35(),
  });
  worldRenderPipeline.registerLayer({
    id:'legendary-pet-v35',
    priority:350,
    when:({ map }) => !['finalBossRoom', 'raidTower'].includes(map),
    render:() => {
      try {
        const petDefs = window.PET_DEFS_V27 || {};
        const pet = petDefs[game.player?.activePet];
        if (!pet) return;
        const ctx = game.ctx;
        const now = Date.now();
        const dir = game.lastMove || { x: 1, y: 0 };
        if (Math.abs(dir.x) > 0.1) game.player._petSide = dir.x > 0 ? 'left' : 'right';
        const side = game.player._petSide || 'left';
        const moving = !!game.isMoving;
        const dancing = (game.danceTimer || 0) > 0;
        const wx = game.player.x + (side === 'left' ? -54 : 54) + (dancing ? Math.sin(now / 90) * 4 : 0);
        const wy = game.player.y + 8 - (moving ? Math.abs(Math.sin(now / 120 + (pet.bob || 0))) * 11 : Math.sin(now / 340 + (pet.bob || 0)) * 2.5);
        const p = worldToScreen(wx, wy);
        if (pet.id === 'yuksam') drawYuksamPetV35(ctx, p, dancing, moving, pet, now);
      } catch {}
    },
  });

  // 7) 스킬창 배치 재설계 (상단 공용 + 하단 좌우 전문화)
  function skillToneV35(spec) {
    const s = String(spec || '').trim();
    if (s === '공용') return 'common';
    if (s === '방어') return 'defense';
    if (s === '무기') return 'weapon';
    if (s === '냉기') return 'frost';
    if (s === '화염') return 'fire';
    if (s === '신성') return 'holy';
    if (s === '암흑') return 'shadow';
    return 'common';
  }

  // 공용은 자유롭게, 전문화는 같은 레벨의 두 스킬 중 어느 쪽이든 선택할 수 있다.
  // 다음 레벨 줄은 바로 아래 줄에서 하나 이상 배운 뒤 열린다.
  (function prepareSkillRowsV60() {
    const all = Object.values(SKILL_DEFS).filter((skill) => skill?.v24);
    all.filter((skill) => !skill.specOnly).forEach((skill) => {
      skill.prereq = [];
      skill.prereqAny = [];
    });
    const groups = new Map();
    all.filter((skill) => skill.specOnly).forEach((skill) => {
      const key = `${skill.classOnly}:${normalizeSpecV26(skill.specOnly)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(skill);
    });
    groups.forEach((group) => {
      const level5 = group.filter((skill) => (Number(skill.unlockLevel) || 1) === 5).map((skill) => skill.id);
      const level7 = group.filter((skill) => (Number(skill.unlockLevel) || 1) === 7).map((skill) => skill.id);
      group.forEach((skill) => {
        const level = Number(skill.unlockLevel) || 1;
        skill.prereq = [];
        skill.prereqAny = level <= 5 ? [] : level <= 7 ? [...level5] : [...level7];
      });
    });
  })();

  openSkillTreeModal = function openSkillTreeModalV35() {
    if (!game.player) return;
    try { if (typeof updateHud === 'function') updateHud(); } catch {}
    const classKey = game.player.class;
    const className = (CLASS_META?.[classKey]?.name) || classKey || '직업';
    const spec = currentSpecV26();
    const specLabel = spec || '전문화 없음';
    const concepts = {
      '방어': '높은 체력 · 보호막 · 피해 감소 중심',
      '무기': '높은 체력 · 높은 직접 피해 중심',
      '냉기': '공격 시 냉기로 적의 다음 공격 데미지 50% 감소',
      '화염': '치명타 확률 35% · 치명타 피해 300%',
      '신성': '피해와 회복을 함께 수행하는 흡수형 전투',
      '암흑': '암흑 중첩을 쌓아 턴마다 강해지는 DOT',
      '전문화 없음': 'Lv.5까지는 공용 기본기를 먼저 익힙니다.'
    };
    const skills = Object.values(SKILL_DEFS).filter((s) => s && s.v24 && s.classOnly === classKey);
    const sortByLine = (a, b) => (a.line || 0) - (b.line || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'ko');
    const common = skills.filter((s) => !s.specOnly).sort(sortByLine);
    const specs = (CLASS_META?.[classKey]?.specs || []).map(normalizeSpecV26);

    function skillNodeV35(skill) {
      const rank = getSkillRank(skill.id);
      const maxP = skill.maxPoints || 1;
      const learned = rank > 0;
      const maxed = rank >= maxP;
      const learnable = !maxed && canLearnSkill(skill);
      const locked = !learned && !learnable;
      const ultimate = skill.kind === 'ultimate';
      const tone = skillToneV35(skill.specOnly || '공용');
      const cls = ['skill-node-v35', 'tone-' + tone];
      if (maxed) cls.push('learned');
      else if (learnable) cls.push('learnable');
      else if (learned) cls.push('learned', 'partial');
      else cls.push('locked');
      if (ultimate) cls.push('ultimate');
      const state = maxed ? '✓' : (locked ? '🔒' : '＋');
      const unlockLv = Number(skill.unlockLevel) || 1;
      const lvLocked = (game.player.level || 1) < unlockLv;
      const unlockBadge = lvLocked ? `<small class="skill-unlock-v35">Lv.${unlockLv} 해금</small>` : '';
      const rankDots = maxP > 1 ? `<small class="skill-rank-v35">${'●'.repeat(rank)}${'○'.repeat(Math.max(0, maxP - rank))} ${rank}/${maxP}</small>` : '';
      const tag = skill.active
        ? `<small class="skill-tag-v35 active">액티브 · 쿨타임 ${skill.active.cooldown || 0}턴</small>`
        : `<small class="skill-tag-v35 passive">패시브</small>`;
      const desc = skill.desc || skillShortEffectV26(skill);
      const tooltip = escapeHtml([skill.name, desc].filter(Boolean).join('\n')).replace(/\n/g, '&#10;');
      return `<div class="${cls.join(' ')}" data-tooltip="${tooltip}" onclick="learnSkill('${skill.id}')">
        <div class="skill-icon-v35">${skillIconV26(skill)}</div>
        <div class="skill-body-v35">
          <b>${escapeHtml(skill.name)}</b>
          <small class="skill-desc-v35">${escapeHtml(desc)}</small>
          ${tag}${rankDots}${unlockBadge}
        </div>
        <div class="skill-state-v35">${state}</div>
      </div>`;
    }

    const linkHtml = ''; // [재구조] 선행 조건 폐지 — 연결선 제거
    const commonLane = `<section class="skill-lane-v35 common-grid-v35">
      <div class="lane-title-v35">◆ 기본기 <small>전문화와 관계없이 배울 수 있어요</small></div>
      <div class="skill-common-grid-v35">${common.map(skillNodeV35).join(linkHtml)}</div>
    </section>`;

    const specLanes = specs.map((sp) => {
      const list = skills.filter((s) => normalizeSpecV26(s.specOnly || '') === sp).sort(sortByLine);
      const isMine = spec === sp;
      const specLocked = !spec;
      const laneCls = ['skill-lane-v35', 'tone-' + skillToneV35(sp)];
      if (!specLocked && !isMine) laneCls.push('dimmed');
      if (specLocked) laneCls.push('spec-locked');
      const note = specLocked ? 'Lv.5 전문화 선택 후'
        : (isMine ? '나의 길!' : '다른 길을 선택했습니다');
      const levelGroups = [5, 7, 10].map((level) => ({
        level,
        skills:list.filter((skill) => (Number(skill.unlockLevel) || 1) === level),
      }));
      const progression = levelGroups.map((group, index) => {
        const single = group.skills.length === 1 ? ' single' : '';
        const cards = `<div class="skill-spec-level-v35${single}" data-level="${group.level}">${group.skills.map(skillNodeV35).join('')}</div>`;
        if (index >= levelGroups.length - 1) return cards;
        const nextLevel = levelGroups[index + 1].level;
        return `${cards}<div class="skill-tier-link-v35" aria-hidden="true"><span></span><b>Lv.${nextLevel} 해금</b><i>▼</i></div>`;
      }).join('');
      return `<section class="${laneCls.join(' ')}">
        <div class="lane-title-v35">${escapeHtml(sp)} 전문화 <small>${escapeHtml(note)}</small></div>
        <div class="skill-spec-grid-v35">${progression}</div>
      </section>`;
    }).join('');

    const activeSkills = getLearnedActiveSkills();
    const activeHtml = activeSkills.length
      ? activeSkills.map((skill) => `<div class="skill-active-card-v35 tone-${skillToneV35(skill.specOnly || '공용')}" data-tooltip="${escapeHtml([skill.active?.name || skill.name, skill.desc || skillShortEffectV26(skill)].filter(Boolean).join('\n')).replace(/\n/g, '&#10;')}"><span>${skillIconV26(skill)}</span><div><b>${escapeHtml(skill.active?.name || skill.name)}</b><small>${escapeHtml(skillShortEffectV26(skill))}</small></div></div>`).join('')
      : '<div class="empty-state">아직 획득한 액티브 스킬이 없습니다.</div>';
    const pointHintHtml = (game.player.skillPoints || 0) > 0
      ? `<div class="skillpoint-hint-v42">사용하지 않은 스킬포인트가 있습니다! <b>${game.player.skillPoints}포인트</b></div>`
      : '';

    openModal(`<div class="skill-window-v35">
      <header class="skill-head-v35"><div><h2>${escapeHtml(className)} 스킬창 <span class="badge">N 키</span></h2><p><b>${escapeHtml(specLabel)}</b> · ${escapeHtml(concepts[specLabel] || concepts['전문화 없음'])}</p></div><div class="skill-points-v35"><span>남은 포인트</span><b>${game.player.skillPoints || 0} / ${Math.max(0, ((game.player.level || 1) - 1) * 2)}</b></div></header>
      <div class="skill-tree-v35">
        ${commonLane}
        ${specLanes}
      </div>
      ${pointHintHtml}
      <section class="skill-active-section-v35"><h3>현재 사용 가능 액티브</h3><div class="skill-active-strip-v35">${activeHtml}</div></section>
    </div>`, { type: 'skill', pause: true });
  };
  const skillBtnV35 = $('openSkillTreeBtn');
  if (skillBtnV35) skillBtnV35.onclick = () => openSkillTreeModal();

  // 8) ??? 포탈 안 새 맵 단순 재구성
  worldDefs.finalBossRoom = WORLD_PATCHES_V35.finalBossRoom;
  function setupFinalBossRoomV35() {
    game.currentMap = 'finalBossRoom';
    game.player.map = 'finalBossRoom';
    game.player.x = worldDefs.finalBossRoom.playerSpawn.x;
    game.player.y = worldDefs.finalBossRoom.playerSpawn.y;
    game.keys = {};
    game.isMoving = false;
    game.forestMonsters = [];
    game.finalBossRoomState = { teacherTalkIndex: 0 };
    updateHud?.();
    syncAudioFileBgm?.();
    showCinematicMessage('???', '무엇인가 익숙한듯 새로운 공간이 나타납니다.', 1800);
  }
  window.enterFinalBossRoomV21 = function enterFinalBossRoomV35() {
    closeModal();
    game.finalBossReturn = { map:'bossRoom', x:760, y:540 };
    showLoadingTransition('???로 이동중입니다.', () => setupFinalBossRoomV35());
  };
  function drawFinalBossRoomV35() {
    updateCamera();
    const ctx = game.ctx;
    const world = worldDefs.finalBossRoom;
    ctx.clearRect(0,0,game.width,game.height);
    const bg = ctx.createRadialGradient(game.width*0.55, game.height*0.45, 10, game.width*0.5, game.height*0.5, Math.max(game.width, game.height)*0.8);
    bg.addColorStop(0, '#211033');
    bg.addColorStop(0.48, '#0d0818');
    bg.addColorStop(1, '#020204');
    ctx.fillStyle = bg;
    ctx.fillRect(0,0,game.width,game.height);
    ctx.save();
    ctx.strokeStyle='rgba(147,51,234,.18)';
    ctx.lineWidth=2;
    for(let i=0;i<6;i++){
      const r=100+i*55+Math.sin(performance.now()/600+i)*5;
      ctx.beginPath();
      ctx.ellipse(game.width*0.58, game.height*0.56, r*1.3, r*0.66, 0, 0, Math.PI*2);
      ctx.stroke();
    }
    ctx.restore();

    const ex = worldToScreen(world.exit.x, world.exit.y);
    drawPortalSprite(ctx, ex.x, ex.y, 28, performance.now()/760, '#6b7280');
    ctx.save(); ctx.textAlign='center'; ctx.font='900 14px Jua, Noto Sans KR, system-ui'; ctx.fillStyle='#e2e8f0'; ctx.fillText('나가기', ex.x, ex.y - 42); ctx.restore();

    const tp = worldToScreen(world.teacher.x, world.teacher.y);
    ctx.save();
    const aura = ctx.createRadialGradient(tp.x, tp.y+10, 5, tp.x, tp.y+10, 92);
    aura.addColorStop(0,'rgba(168,85,247,.45)');
    aura.addColorStop(.5,'rgba(88,28,135,.18)');
    aura.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=aura; ctx.beginPath(); ctx.arc(tp.x,tp.y+12,92,0,Math.PI*2); ctx.fill();
    ctx.restore();
    drawNpcSprite(ctx, tp.x, tp.y, '명진쌤', false, 1.45, isNearPoint({x:world.teacher.x,y:world.teacher.y}, 110), 'priest');
    // [수정] drawNpcSprite가 이미 이름표를 그리므로 위쪽 중복 이름표(drawNameLabel) 호출 제거
    // [수정] drawNpcSprite가 이미 대사 말풍선을 그리므로 중복 호출 제거

    const ps = worldToScreen(game.player.x, game.player.y);
    drawPlayerSprite(ctx, ps.x, ps.y, game.player.appearance, game.player.class, { attack:game.attackTimer, moving:game.isMoving, dance:game.danceTimer, equipment:game.player.equipment }, PLAYER_WORLD_SCALE, game.player.spec);
    drawPlayerNameplate(ctx, ps.x, ps.y, game.player);
    drawTitleLabel?.('???');
  }
  function openFinalTeacherDialogueV35() {
    // [수정] v35가 보스전 진입을 끊고 티저 대사만 남겨두었던 것을, 살아있는 v34 전투 함수로 다시 연결.
    openModal(`<div class="dialogue-box final-teacher-dialogue-v26"><div class="dialogue-speaker"><h2>LV.99 명진쌤 <span class="badge danger">최종 보스</span></h2><div class="badge">E키로 진행</div></div><div class="dialogue-text">여기까지 오다니… 정말 대단하구나!<br>하지만 이 모든 모험은 너희의 성장을 위한 것이었단다.<br>이제, 나를 뛰어넘어 보렴!</div><div class="dialogue-options"><button class="primary" onclick="startFinalTeacherBattleV34()">도전한다</button><button class="ghost" onclick="closeModal()">아직 준비가 안 됐습니다</button></div></div>`, { type:'dialogue', pause:true });
  }
  function enterPetShopFromInteractionV35() {
    if (game.transitionLock && Date.now() < game.transitionLock) return;
    game.transitionLock = Date.now() + 700;
    playSfx?.('door');
    closeModal?.();
    game.currentMap = 'petShopInterior';
    game.player.map = 'petShopInterior';
    game.player.x = worldDefs.petShopInterior.playerSpawn.x;
    game.player.y = worldDefs.petShopInterior.playerSpawn.y;
    $('returnTownBtn')?.classList.remove('hidden');
    updateHud?.();
    syncAudioFileBgm?.();
    savePlayer?.();
    appendChatMessage?.('system', '이동', '펫 상점 내부로 들어왔습니다.');
  }
  function exitFinalBossRoomV35() {
    closeModal();
    hideTooltipV35();
    const ret = game.finalBossReturn || { map:'bossRoom', x:760, y:540 };
    game.currentMap = ret.map; game.player.map = ret.map; game.player.x = ret.x; game.player.y = ret.y;
    game.keys = {}; game.isMoving = false; updateHud?.(); syncAudioFileBgm?.(); savePlayer?.();
  }
  worldInteractionRegistry.registerCandidate({ id:'final-world-candidates-v35', priority:350, find:() => {
    if (game.currentMap === 'finalBossRoom') {
      const p = game.player;
      if (distance(p, worldDefs.finalBossRoom.exit) < worldDefs.finalBossRoom.exit.r + 18) return { type:'finalBossExitV35', label:'E: 나가기' };
      if (distance(p, worldDefs.finalBossRoom.teacher) < 108) return { type:'finalTeacherNpcV35', label:'E: 명진쌤과 대화' };
      return YuksamWorldInteractionRegistry.STOP;
    }
    const p = game.player;
    if (p && game.currentMap === 'bossRoom' && game.finalBossPortalUnlocked && game.bossReturnMap === 'swamp' && distance(p, {x:910,y:500}) < 92) {
      return { type:'finalBossPortal', label:'E: ??? 포탈 - 들어가기' };
    }
    if (p && game.currentMap === 'town') {
      const town = worldDefs.town;
      if (distance(p, {x:town.petShop.doorX,y:town.petShop.doorY}) < 100) return { type:'petShopDoor', label:'빛나는 입구에 접근하면 펫 상점으로 이동' };
      if (distance(p, {x:town.upgradeShop.doorX,y:town.upgradeShop.doorY}) < 100) return { type:'upgradeShopDoor', label:'빛나는 입구에 접근하면 대장간으로 이동' };
      if (worldDefs.town.healingWell && distance(p, worldDefs.town.healingWell) < 92) return { type:'healingWell', label:'E: 치유의 우물 - 문제를 풀고 회복' };
    }
    if (p && game.currentMap === 'petShopInterior') {
      const shop = worldDefs.petShopInterior;
      if (distance(p, shop.exit) < shop.exit.r) return { type:'petShopExit', label:'출구로 접근하면 마을로 나가기' };
      if (distance(p, shop.orb) < 122) return { type:'petOrbNpc', label:'E: 펫 수정구와 대화' };
    }
    if (p && game.currentMap === 'upgradeShopInterior') {
      const shop = worldDefs.upgradeShopInterior;
      if (distance(p, shop.exit) < shop.exit.r) return { type:'upgradeShopExit', label:'출구로 접근하면 마을로 나가기' };
      if (distance(p, shop.blacksmith) < 108) return { type:'upgradeNpc', label:'E: 대장장이 진명과 대화' };
    }
    return null;
  }});
  worldInteractionRegistry.registerAction({
    id:'final-world-actions-v35',
    priority:350,
    types:['healingWell', 'petShopDoor', 'petShopExit', 'upgradeShopExit', 'petOrbNpc', 'upgradeNpc', 'finalBossPortal', 'finalBossExitV35', 'finalTeacherNpcV35'],
    handle:(nearest) => {
      if (nearest.type === 'healingWell') window.openHealingWellModal();
      else if (nearest.type === 'petShopDoor') enterPetShopFromInteractionV35();
      else if (nearest.type === 'petOrbNpc') window.openPetShopModalV34();
      else if (nearest.type === 'upgradeNpc') {
        if (!window.openQuestNpcIntroV3?.('enhance', () => window.openUpgradeShopModalV33())) window.openUpgradeShopModalV33();
      }
      else if (nearest.type === 'finalBossPortal') window.confirmFinalBossPortalV21?.();
      else if (nearest.type === 'finalBossExitV35') exitFinalBossRoomV35();
      else if (nearest.type === 'finalTeacherNpcV35') openFinalTeacherDialogueV35();
      return true;
    },
  });

  appendChatMessage?.('system', '패치', 'v35: 스킬창 3분할 배치, 펫 상점 위치 조정, 툴팁 복구, 육삼이 표정 추가, ??? 포탈 내부 맵 단순화가 적용되었습니다.');
})();


/* =========================
   v38 patch: 행동형(튜토리얼) 퀘스트 인프라 + 퀘스트 보상 아이템 지급
   - recordQuestActionV38: 수락 상태의 actionType 퀘스트 진행도 기록
   - grantQuestRewardItemV38: def.reward.item 인벤 지급 (중복 생략)
   ========================= */
(function yuksamV38Patch(){
  if (window.__YUKSAM_V38_PATCH__) return;
  window.__YUKSAM_V38_PATCH__ = true;

  // 수락 상태의 튜토리얼(actionType) 퀘스트 진행도 +1. 목표 도달 시 보고 대기(ready).
  window.recordQuestActionV38 = function recordQuestActionV38(kind) {
    if (!kind || !game.player?.quests) return;
    let changed = false;
    QUEST_ORDER.forEach((id) => {
      const q = getQuestState(id); const def = QUEST_DEFS[id];
      if (!q || q.status !== 'accepted' || !def) return;
      if (def.actionType !== kind) return;
      q.progress = Math.min(def.target, (q.progress || 0) + 1);
      changed = true;
      if (q.progress >= def.target) {
        q.status = 'ready';
        appendChatMessage?.('system', '퀘스트', `${def.title} 목표 달성! 명진쌤에게 보고하세요.`);
        toast('퀘스트 목표 달성! 명진쌤에게 보고하세요');
      }
    });
    if (changed) { updateQuestTracker(); savePlayer(); }
  };

  // 퀘스트 보상 아이템을 인벤토리에 추가(중복 보유 시 생략)하고 토스트로 알린다.
  window.grantQuestRewardItemV38 = function grantQuestRewardItemV38(itemId) {
    const def = ITEM_DEFS[itemId];
    if (!def) return;
    if (!Array.isArray(game.player.inventory)) game.player.inventory = [];
    if (!game.player.inventory.includes(itemId)) game.player.inventory.push(itemId);
    toast(`🎁 ${def.name} 획득!`);
  };

  appendChatMessage?.('system', '패치', 'v38: 행동형 튜토리얼 퀘스트와 퀘스트 보상 아이템이 추가되었습니다.');
})();

window.cheatUpgradeEquippedWeapon = async function cheatUpgradeEquippedWeapon() {
  if (!(await window.requireTeacherCheatAccessV3?.())) return false;
  const player = game.player;
  const weaponId = player?.equipment?.weapon;
  const item = weaponId ? getItemDefinition(weaponId, player.class) : null;
  if (!item || item.slot !== 'weapon') {
    toast('강화할 무기를 먼저 장착해 주세요.');
    return false;
  }
  const currentStyle = getEquippedWeaponTierStyle(player);
  if (currentStyle.tier >= 4) {
    toast('이미 전설 등급입니다.');
    return false;
  }
  if (!player.weaponUpgrades || typeof player.weaponUpgrades !== 'object') player.weaponUpgrades = {};
  player.weaponUpgrades[weaponId] = currentStyle.tier + 1;
  savePlayer();
  updateHud();
  const nextStyle = getEquippedWeaponTierStyle(player);
  if (game.modalState?.type === 'character') openCharacterPanel();
  else if (['upgradeShop', 'upgradeResult', 'upgradeProgress'].includes(game.modalState?.type)) openUpgradeShopModalV33();
  else if (game.modalState?.type === 'combat') drawCombatCanvases();
  appendChatMessage('system', '치트', `${item.name} 즉시 강화: ${nextStyle.name} 등급`);
  toast(`${item.name}: ${nextStyle.name} 등급으로 즉시 강화했습니다.`);
  return true;
};

/* Early-game polish v2: hunting-map healing wells */
(function yuksamHealingWellsV2() {
  if (window.__YUKSAM_HEALING_WELLS_V2__) return;
  window.__YUKSAM_HEALING_WELLS_V2__ = true;

  function drawHuntingHealingWellV2(well) {
    const ctx = game.ctx;
    const p = worldToScreen(well.x, well.y);
    const pulse = Math.sin(performance.now() / 420) * 2;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (game.player && distance(game.player, well) < 92) {
      const glow = .55 + Math.sin(performance.now() / 180) * .2;
      ctx.strokeStyle = `rgba(74,222,128,${glow})`;
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(0, 29, 43, 13, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(0,0,0,.24)';
    ctx.beginPath(); ctx.ellipse(0, 29, 40, 11, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#64748b';
    roundRect(ctx, -34, -6, 68, 35, 11); ctx.fill();
    ctx.fillStyle = '#94a3b8';
    roundRect(ctx, -30, -15, 60, 17, 9); ctx.fill();
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath(); ctx.ellipse(0, -7, 25 + pulse, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(186,230,253,.85)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, -7, 31 + pulse, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(7,16,27,.76)';
    roundRect(ctx, -47, 36, 94, 22, 999); ctx.fill();
    ctx.fillStyle = '#dff8ff';
    ctx.textAlign = 'center';
    ctx.font = '800 13px Jua, Noto Sans KR, sans-serif';
    ctx.fillText('치유의 우물', 0, 51);
    ctx.restore();
  }

  worldRenderPipeline.registerLayer({
    id:'hunting-healing-wells-v2',
    priority:360,
    when:({ map }) => ['forest', 'desert', 'swamp'].includes(map),
    render:() => {
      YuksamGameplayPolishV2.getHealingWells(game.currentMap).forEach(drawHuntingHealingWellV2);
    },
  });

  worldNavigationRegistry.registerCollider({
    id:'hunting-healing-well-colliders-v2',
    priority:900,
    resolve:() => {
      if (!['forest', 'desert', 'swamp'].includes(game.currentMap)) return null;
      const wells = YuksamGameplayPolishV2.getHealingWells(game.currentMap)
        .map((well) => ({ type:'circle', x:well.x, y:well.y, r:38 }));
      return [...getBaseMapColliders(), ...wells];
    },
  });

  worldInteractionRegistry.registerCandidate({
    id:'hunting-healing-wells-v2',
    priority:900,
    find:() => {
      if (!game.player || !['forest', 'desert', 'swamp'].includes(game.currentMap)) return null;
      const well = YuksamGameplayPolishV2.getHealingWells(game.currentMap)
        .find((entry) => distance(game.player, entry) < 92);
      return well ? { type:'huntingHealingWellV2', label:'E: 치유의 우물 - 문제를 풀고 회복', well } : null;
    },
  });
  worldInteractionRegistry.registerAction({
    id:'hunting-healing-well-actions-v2',
    priority:900,
    types:['huntingHealingWellV2'],
    handle:() => {
      window.openHealingWellModal();
      return true;
    },
  });
})();

/* Shared world nameplates.
   Local and realtime characters pass through the same renderer. Future
   nameplate cosmetics can register a theme and choose it with one resolver. */
(function installYuksamPlayerNameplateV1() {
  if (window.YuksamPlayerNameplateV1) return;

  const themes = new Map();
  let themeResolver = () => 'default';

  function modelFor(player, meta = {}) {
    const klass = player?.class || 'warrior';
    const spec = player?.spec === '분노' ? '무기' : String(player?.spec || '');
    const className = CLASS_META[klass]?.name || '모험가';
    const level = Math.max(1, Math.trunc(Number(player?.level) || 1));
    return Object.freeze({
      name:String(player?.name || '이름없음'),
      level,
      klass,
      spec,
      className,
      roleLine:`LV.${level} ${spec ? `${spec} ` : ''}${className}`,
      source:meta.source === 'remote' ? 'remote' : 'local',
      userId:String(meta.userId || ''),
      cosmetics:player?.nameplate && typeof player.nameplate === 'object'
        ? { ...player.nameplate }
        : {},
    });
  }

  function drawDefaultNameplate(ctx, x, y, model) {
    const top = y + 58;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '900 18px Jua, Noto Sans KR, system-ui';
    const width = Math.max(
      ctx.measureText(model.name).width,
      ctx.measureText(model.roleLine).width,
    ) + 34;
    const glow = (window.performance?.now?.() || Date.now()) / 1000;
    ctx.shadowColor = 'rgba(0,0,0,.92)';
    ctx.shadowBlur = 8;
    ctx.fillStyle = 'rgba(4,11,22,.82)';
    roundRect(ctx, x - width / 2, top, width, 50, 16); ctx.fill();
    ctx.strokeStyle = `rgba(139,230,255,${0.70 + Math.sin(glow * 2.2) * 0.10})`;
    ctx.lineWidth = 2;
    roundRect(ctx, x - width / 2, top, width, 50, 16); ctx.stroke();
    ctx.shadowBlur = 5;
    ctx.fillStyle = '#fff7b0';
    ctx.fillText(model.name, x, top + 21);
    ctx.font = '900 14px Noto Sans KR, Jua, system-ui';
    ctx.fillStyle = model.spec ? '#7fffd4' : '#d7ecff';
    ctx.fillText(model.roleLine, x, top + 39);
    ctx.restore();
  }

  themes.set('default', drawDefaultNameplate);

  const api = Object.freeze({
    draw(ctx, x, y, player, meta = {}) {
      if (!ctx || !player) return null;
      const model = modelFor(player, meta);
      let themeId = 'default';
      try { themeId = String(themeResolver(model, meta) || 'default'); } catch {}
      const renderer = themes.get(themeId) || themes.get('default');
      renderer(ctx, x, y, model, meta);
      return model;
    },
    registerTheme(id, renderer) {
      const key = String(id || '').trim();
      if (!key || key === 'default' || typeof renderer !== 'function') return false;
      themes.set(key, renderer);
      return true;
    },
    setThemeResolver(resolver) {
      themeResolver = typeof resolver === 'function' ? resolver : () => 'default';
    },
    modelFor,
  });

  window.YuksamPlayerNameplateV1 = api;
  drawPlayerNameplate = function drawPlayerNameplateSharedV1(ctx, x, y, player) {
    return api.draw(ctx, x, y, player, { source:'local' });
  };
})();
