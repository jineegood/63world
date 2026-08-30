/* v55: 학급용 멀티플레이.
   명단·검증된 외형·위치·채팅·전역 알림·채널 인원은 인증 DB RPC가 2초마다
   동기화한다. 일반 채팅과 캐릭터 명단은 같은 월드 채널(1~5) 안에서만 공유된다. */
(function multiplayerV55() {
  if (window.__MULTIPLAYER_V54__) return;
  window.__MULTIPLAYER_V54__ = true;
  window.__MULTIPLAYER_V53__ = true; // 기존 진단·테스트 호환 이름

  const cfg = window.YUKSAM_CLOUD || {};
  const avatarVisualSync = window.YuksamAvatarVisualSync;
  const worldAnnouncements = window.YuksamWorldAnnouncementsV1;
  const g = () => (typeof game !== 'undefined' ? game : window.__G);
  const enabled = typeof cfg.url === 'string' && cfg.url.startsWith('http')
    && typeof cfg.anonKey === 'string' && cfg.anonKey.length > 20
    && typeof window.secureStudentAccessV2?.getClient === 'function';
  const MAINTENANCE_MS = 220;
  const PRESENCE_SYNC_MS = 2000;
  const RPC_TIMEOUT_MS = 4500;
  const STALE_MS = 10000;
  const CHANNEL_COUNT = 5;
  const CHANNEL_CAPACITY = 8;
  const CHANNEL_SWITCH_COOLDOWN_MS = 3000;
  const CHANNEL_STORAGE_KEY = 'yuksam_world_channel_v1';
  const CONTROL_CHARACTERS_RE = /[\u0000-\u001f\u007f-\u009f]/;
  const remotes = new Map(); // name -> server-verified current-map state
  const motions = new Map(); // name -> 도착한 위치 사이를 부드럽게 이어주는 계산기
  let remoteBounds = [];
  let activeClient = null;
  let presenceSyncPromise = null;
  let lastSuccessfulSyncAt = 0;
  const pendingChats = [];
  const seenChatIds = new Set();
  const seenChatOrder = [];
  const visualCache = new Map(); // userId -> server-verified appearance + version
  let lastChatId = '0';
  let sameMapRosterSize = 1;
  let visibleSameMapSize = 1;
  let lastBadgeText = '';
  let onlineBadgeElement = null;
  let rosterMap = null;
  const channelListeners = new Set();
  const channelCounts = Object.fromEntries(
    Array.from({ length:CHANNEL_COUNT }, (_, index) => [String(index + 1), 0]),
  );
  let currentChannel = readPreferredChannel();
  let channelJoined = false;
  let channelStatus = enabled ? 'waiting-login' : 'off';
  let channelSwitching = false;
  let channelCooldownUntil = 0;
  let channelReason = null;
  let lastChannelStateSignature = '';

  function normalizeChannel(value) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 1 && number <= CHANNEL_COUNT ? number : null;
  }

  function readPreferredChannel() {
    try {
      return normalizeChannel(window.localStorage?.getItem?.(CHANNEL_STORAGE_KEY)) || 1;
    } catch { return 1; }
  }

  function savePreferredChannel(channel) {
    try { window.localStorage?.setItem?.(CHANNEL_STORAGE_KEY, String(channel)); } catch {}
  }

  function normalizeChannelCounts(value) {
    for (let channel = 1; channel <= CHANNEL_COUNT; channel += 1) {
      const count = Number(value?.[String(channel)] ?? value?.[channel]);
      channelCounts[String(channel)] = Number.isFinite(count)
        ? Math.max(0, Math.min(CHANNEL_CAPACITY, Math.round(count)))
        : 0;
    }
  }

  function activityBlockReason() {
    const G = g();
    if (!G?.player || !document.querySelector?.('#game.active')) return 'NOT_IN_GAME';
    const modalType = String(G.modalState?.type || '');
    if (G.currentCombatMonsterId || G.currentMap === 'raidTower'
      || window.getActivePvpMatchV1?.()
      || window.YuksamRaidRunUi?.hasSession?.()
      || /^raid/i.test(modalType)) return 'IN_ACTIVITY';
    return null;
  }

  function getChannelState() {
    const now = Date.now();
    const activityReason = activityBlockReason();
    const cooldown = now < channelCooldownUntil;
    const reason = channelSwitching
      ? 'SWITCHING'
      : cooldown ? 'COOLDOWN'
        : activityReason || channelReason;
    return Object.freeze({
      channel:currentChannel,
      channelCounts:Object.freeze({ ...channelCounts }),
      maxChannels:CHANNEL_COUNT,
      capacity:CHANNEL_CAPACITY,
      status:channelStatus,
      switching:channelSwitching,
      cooldownUntil:channelCooldownUntil,
      canChange:!channelSwitching && !cooldown && !activityReason,
      reason:reason || null,
    });
  }

  function notifyChannelState(force = false) {
    const state = getChannelState();
    const signature = JSON.stringify(state);
    if (!force && signature === lastChannelStateSignature) return;
    lastChannelStateSignature = signature;
    channelListeners.forEach((listener) => {
      try { listener(state); } catch {}
    });
  }

  function subscribeChannelState(listener) {
    if (typeof listener !== 'function') return () => {};
    channelListeners.add(listener);
    try { listener(getChannelState()); } catch {}
    return () => channelListeners.delete(listener);
  }

  window.YuksamWorldChannelsV1 = Object.freeze({
    getState:getChannelState,
    changeChannel,
    subscribe:subscribeChannelState,
  });

  // 위치가 띄엄띄엄 도착해도 화면에서는 이어 보이게 한다. 모듈이 없으면 예전처럼 그대로 그린다.
  function trackRemoteMotion(name, x, y, snap) {
    const api = window.YuksamRemoteMotion;
    if (!api || typeof x !== 'number' || typeof y !== 'number') return;
    let motion = motions.get(name);
    if (!motion) {
      motion = api.create({
        defaultStepMs:PRESENCE_SYNC_MS,
        maxStepMs:PRESENCE_SYNC_MS + 300,
        snapDistance:800,
      });
      motions.set(name, motion);
    }
    motion.push(x, y, Date.now(), { snap });
  }

  function forgetRemote(name) {
    remotes.delete(name);
    motions.delete(name);
    if (remotes.size === 0) {
      remoteBounds = [];
      visibleSameMapSize = 1;
    }
  }

  window.__remotePlayersV53 = remotes;
  window.__multiplayerStatusV53 = enabled ? 'waiting-login' : 'off';
  window.__multiplayerPresenceStatusV1 = enabled ? 'waiting-login' : 'off';
  if (!enabled) return;

  function copyObject(value, maxBytes = 5000) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    try {
      const raw = JSON.stringify(value);
      if (raw.length > maxBytes) return {};
      return JSON.parse(raw);
    } catch { return {}; }
  }

  function normalizeVisualPayload(value) {
    if (!value || typeof value !== 'object') return null;
    const userId = String(value.u || '').slice(0, 80);
    const name = String(value.name || '').normalize('NFKC').trim().slice(0, 20);
    const visualVersion = String(value.v || '').slice(0, 32);
    if (!userId || !name || !/^[0-9a-f]{32}$/.test(visualVersion)) return null;
    return {
      userId,
      name,
      visualVersion,
      level:Math.max(1, Math.min(100, Math.round(Number(value.level) || 1))),
      class:String(value.class || 'warrior').slice(0, 40),
      spec:value.spec == null ? null : String(value.spec).slice(0, 40),
      equipment:copyObject(value.equipment),
      appearance:copyObject(value.appearance),
      costume:copyObject(value.costume),
      nameplate:value.nameplate && typeof value.nameplate === 'object'
        ? copyObject(value.nameplate, 1000)
        : null,
      activePet:typeof value.activePet === 'string' ? value.activePet.slice(0, 80) : null,
      weaponTier:Math.max(0, Math.min(4, Math.round(Number(value.weaponTier) || 0))),
    };
  }

  function normalizeCompactPayload(value, map) {
    if (!value || typeof value !== 'object') return null;
    const userId = String(value.u || '').slice(0, 80);
    const visualVersion = String(value.v || '').slice(0, 32);
    const x = Number(value.x);
    const y = Number(value.y);
    const facing = copyObject(value.f, 200);
    if (!userId || !/^[0-9a-f]{32}$/.test(visualVersion)
      || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    return {
      userId,
      visualVersion,
      map,
      x:Math.round(x),
      y:Math.round(y),
      facing:{ x:Number(facing.x) || 0, y:Number(facing.y) || 1 },
      petSide:value.ps === 'right' ? 'right' : 'left',
      pvpAvailable:value.pv === true,
      moving:value.mv === true,
      dance:value.dn === true,
    };
  }

  // visual은 서버 버전이 바뀔 때만 한 번 정규화된다. 매 2초 위치 snapshot마다
  // equipment/appearance/costume를 JSON 복제하면 28명 환경에서 주기적인 끊김이
  // 생기므로, 검증된 visual 객체를 그대로 재사용하고 작은 위치 필드만 합친다.
  function mergeVerifiedRemotePayload(visual, compact) {
    return {
      type:'pos',
      userId:compact.userId,
      name:visual.name,
      map:compact.map,
      visualVersion:compact.visualVersion,
      x:compact.x,
      y:compact.y,
      level:visual.level,
      class:visual.class,
      spec:visual.spec,
      equipment:visual.equipment,
      appearance:visual.appearance,
      costume:visual.costume,
      nameplate:visual.nameplate,
      activePet:visual.activePet,
      weaponTier:visual.weaponTier,
      facing:compact.facing,
      petSide:compact.petSide,
      pvpAvailable:compact.pvpAvailable,
      moving:compact.moving,
      dance:compact.dance,
    };
  }

  function localPresencePayload(G, chat, channel = currentChannel, resetCursor = false) {
    const weaponId = G.player.equipment?.weapon || null;
    const petSide = avatarVisualSync?.petSideFromFacing(G.player._petSide, G.lastMove)
      || G.player._petSide
      || 'left';
    G.player._petSide = petSide;
    const payload = {
      userId:window.getPvpIdentityV1?.()?.userId || null,
      name:G.player.name,
      map:G.currentMap,
      channel,
      x:Math.round(G.player.x), y:Math.round(G.player.y),
      level:G.player.level, class:G.player.class, spec:G.player.spec || null,
      equipment:G.player.equipment || {}, appearance:G.player.appearance || {},
      costume:G.player.costume || {},
      nameplate:G.player.nameplate && typeof G.player.nameplate === 'object'
        ? { ...G.player.nameplate }
        : null,
      activePet:typeof G.player.activePet === 'string' ? G.player.activePet : null,
      petSide,
      weaponTier:avatarVisualSync?.normalizeTier(
        weaponId ? G.player.weaponUpgrades?.[weaponId] : 0,
      ) || 0,
      facing:{ x:Number(G.lastMove?.x) || 0, y:Number(G.lastMove?.y) || 1 },
      pvpAvailable:G.currentMap === 'town' && !G.modalState?.pause && !G.currentCombatMonsterId,
      moving:!!G.isMoving,
      dance:Number(G.danceTimer || 0) > 0,
    };
    const knownVisuals = {};
    if (!resetCursor) {
      visualCache.forEach((visual, userId) => {
        if (visual?.visualVersion) knownVisuals[userId] = visual.visualVersion;
      });
    }
    payload.knownVisuals = knownVisuals;
    payload.lastChatId = resetCursor ? '0' : lastChatId;
    payload.lastAnnouncementId = worldAnnouncements?.getCursor?.() || '0';
    if (chat) payload.chat = { id:chat.id, text:chat.text };
    return payload;
  }

  function updateOnlineBadge() {
    const badge = onlineBadgeElement || document.getElementById?.('onlineBadge');
    if (!badge) return;
    onlineBadgeElement = badge;
    const status = window.__multiplayerPresenceStatusV1;
    const label = status === 'online'
      ? `채널 ${currentChannel} · 같은 지역 ${sameMapRosterSize}명 · 화면 ${visibleSameMapSize}명`
      : status === 'offline' ? `채널 ${currentChannel} · 동기화 재시도 중`
        : `채널 ${currentChannel} · 동기화 중`;
    if (label === lastBadgeText) return;
    lastBadgeText = label;
    badge.textContent = label;
    badge.dataset.state = status;
  }

  function applyPresenceSnapshot(items, visualItems, map) {
    const G = g();
    if (!G?.player || map !== G.currentMap || !Array.isArray(items) || !Array.isArray(visualItems)) return false;
    visualItems.forEach((item) => {
      const visual = normalizeVisualPayload(item);
      if (visual) {
        visualCache.set(visual.userId, visual);
      }
    });
    const now = Date.now();
    const me = window.getPvpIdentityV1?.();
    const seenIds = new Set();
    let validCount = 0;
    items.forEach((item) => {
      const compact = normalizeCompactPayload(item, map);
      const visual = compact ? visualCache.get(compact.userId) : null;
      if (!compact || !visual || visual.visualVersion !== compact.visualVersion) return;
      const p = mergeVerifiedRemotePayload(visual, compact);
      if (!p || p.map !== map) return;
      validCount += 1;
      seenIds.add(p.userId);
      if ((me?.userId && p.userId === me.userId) || p.name === G.player.name) return;
      let previous = remotes.get(p.name);
      if (!previous) {
        const renamed = [...remotes.entries()].find(([, remote]) => remote?.userId === p.userId);
        if (renamed) {
          previous = renamed[1];
          forgetRemote(renamed[0]);
        }
      }
      remotes.set(p.name, {
        ...(previous || {}), ...p,
        bubble:previous?.bubble,
        at:now,
        _presenceV54:true,
      });
      trackRemoteMotion(p.name, p.x, p.y, !previous || previous.map !== p.map);
    });
    remotes.forEach((remote, name) => {
      if (remote?._presenceV54 && remote.map === map && !seenIds.has(remote.userId)) forgetRemote(name);
    });
    visualCache.forEach((_, userId) => {
      if (!seenIds.has(userId)) visualCache.delete(userId);
    });
    sameMapRosterSize = Math.max(1, validCount);
    refreshCrowdOffsets(G);
    window.__multiplayerPresenceStatusV1 = 'online';
    updateOnlineBadge();
    return validCount === items.length;
  }

  function clearRemoteRoster(clearVisuals = true) {
    remotes.forEach((_, name) => forgetRemote(name));
    motions.clear();
    remoteBounds = [];
    sameMapRosterSize = 1;
    visibleSameMapSize = 1;
    rosterMap = null;
    if (clearVisuals) visualCache.clear();
  }

  function clearPresenceState(status = 'waiting-login') {
    activeClient = null;
    lastSuccessfulSyncAt = 0;
    pendingChats.length = 0;
    seenChatIds.clear();
    seenChatOrder.length = 0;
    clearRemoteRoster(true);
    worldAnnouncements?.reset?.();
    lastChatId = '0';
    channelJoined = false;
    channelStatus = status;
    channelReason = null;
    window.__multiplayerStatusV53 = status;
    window.__multiplayerPresenceStatusV1 = status;
    updateOnlineBadge();
    notifyChannelState();
  }

  function ensureRpcClient(G) {
    const client = window.secureStudentAccessV2?.getClient?.() || null;
    if (!client || typeof client.rpc !== 'function' || !G?.player) {
      if (activeClient) clearPresenceState('waiting-login');
      return null;
    }
    if (client !== activeClient) {
      clearPresenceState('connecting');
      activeClient = client;
    }
    return client;
  }

  function normalizeChatMessage(value) {
    if (!value || typeof value !== 'object') return null;
    const id = String(value.id || '').slice(0, 80);
    const userId = String(value.userId || '').slice(0, 80);
    const name = String(value.name || '').normalize('NFKC').trim().slice(0, 20);
    const text = String(value.text || '').normalize('NFKC').trim().slice(0, 120);
    if (!/^\d+$/.test(id) || !userId || !name || !text || CONTROL_CHARACTERS_RE.test(text)) return null;
    return { id, userId, name, text };
  }

  function rememberChatId(id) {
    if (seenChatIds.has(id)) return false;
    seenChatIds.add(id);
    seenChatOrder.push(id);
    while (seenChatOrder.length > 500) seenChatIds.delete(seenChatOrder.shift());
    return true;
  }

  function applyChatMessages(items) {
    if (!Array.isArray(items)) return;
    const me = window.getPvpIdentityV1?.();
    items.forEach((item) => {
      const message = normalizeChatMessage(item);
      if (!message) return;
      lastChatId = message.id;
      if (!rememberChatId(message.id)) return;
      if ((me?.userId && message.userId === me.userId) || message.name === g()?.player?.name) return;
      const found = [...remotes.entries()].find(([name, remote]) => (
        remote?.userId === message.userId || name === message.name
      ));
      if (found) {
        remotes.set(found[0], {
          ...found[1],
          bubble:{ text:message.text, until:Date.now() + 4200 },
          at:Date.now(),
        });
      }
      try { window.appendChatMessage?.('user', message.name, message.text); } catch {}
    });
  }

  function createMessageId() {
    try {
      const value = window.crypto?.randomUUID?.();
      if (value) return value;
    } catch {}
    const bytes = Array.from({ length:16 }, () => Math.floor(Math.random() * 256));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = bytes.map((value) => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  window.__mpBroadcastChatV53 = function (text) {
    const G = g();
    if (!ensureRpcClient(G)) return false;
    const message = String(text || '').normalize('NFKC').trim().slice(0, 120);
    if (!message || CONTROL_CHARACTERS_RE.test(message)) return false;
    if (pendingChats.length >= 20) {
      try { window.toast?.('채팅 전송이 잠시 밀렸어요. 잠깐 뒤 다시 보내 주세요.'); } catch {}
      return false;
    }
    pendingChats.push({ id:createMessageId(), text:message });
    return true;
  };

  function rpcWithTimeout(client, payload) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('WORLD_PRESENCE_TIMEOUT')), RPC_TIMEOUT_MS);
    });
    return Promise.race([
      Promise.resolve(client.rpc('sync_world_presence_v3', { p_state:payload })),
      timeout,
    ]).finally(() => clearTimeout(timer));
  }

  function leastAvailableChannel(excludedChannel = null) {
    return Array.from({ length:CHANNEL_COUNT }, (_, index) => index + 1)
      .filter((channel) => channel !== excludedChannel && channelCounts[String(channel)] < CHANNEL_CAPACITY)
      .sort((left, right) => (
        channelCounts[String(left)] - channelCounts[String(right)] || left - right
      ))[0] || null;
  }

  async function performPresenceSync(options = {}) {
    const G = g();
    if (!G?.player || !document.querySelector('#game.active')) return false;
    const client = ensureRpcClient(G);
    if (!client) return false;
    const sentMap = G.currentMap;
    let requestedChannel = normalizeChannel(options.channel) || currentChannel;
    const changingChannel = channelJoined && requestedChannel !== currentChannel;
    const resetCursor = changingChannel || !channelJoined;
    const sentChat = changingChannel ? null : (pendingChats[0] || null);
    try {
      let response = await rpcWithTimeout(
        client,
        localPresencePayload(G, sentChat, requestedChannel, resetCursor),
      );
      let data = response?.data;
      if (response?.error) throw response.error;
      if (client !== activeClient || g()?.currentMap !== sentMap) return false;
      if (data?.ok === false && data?.code === 'CHANNEL_FULL') {
        normalizeChannelCounts(data.channelCounts);
        const fallback = !channelJoined && options.manual !== true
          ? leastAvailableChannel(requestedChannel)
          : null;
        if (fallback != null) {
          requestedChannel = fallback;
          response = await rpcWithTimeout(
            client,
            localPresencePayload(G, null, requestedChannel, true),
          );
          data = response?.data;
          if (response?.error) throw response.error;
          if (client !== activeClient || g()?.currentMap !== sentMap) return false;
        }
      }
      if (data?.ok === false && data?.code === 'CHANNEL_FULL') {
        normalizeChannelCounts(data.channelCounts);
        channelStatus = channelJoined ? 'online' : 'full';
        channelReason = 'CHANNEL_FULL';
        notifyChannelState(true);
        updateOnlineBadge();
        return Object.freeze({
          ok:false,
          code:'CHANNEL_FULL',
          channel:normalizeChannel(data.channel) || requestedChannel,
          previousChannel:normalizeChannel(data.previousChannel),
          channelCounts:Object.freeze({ ...channelCounts }),
        });
      }
      const responseChannel = normalizeChannel(data?.channel);
      if (!data || data.ok !== true || data.map !== sentMap || responseChannel !== requestedChannel
        || !Array.isArray(data.players) || !Array.isArray(data.visuals)
        || !Array.isArray(data.messages) || !Array.isArray(data.announcements)) {
        throw new Error('WORLD_PRESENCE_INVALID');
      }
      normalizeChannelCounts(data.channelCounts);
      const channelChanged = channelJoined && currentChannel !== responseChannel;
      if (channelChanged) {
        clearRemoteRoster(true);
        seenChatIds.clear();
        seenChatOrder.length = 0;
        lastChatId = '0';
        if (pendingChats.length) {
          pendingChats.length = 0;
          try { window.toast?.('채널을 변경해 전송 대기 중이던 채팅을 비웠어요.'); } catch {}
        }
      } else if (rosterMap != null && rosterMap !== sentMap) {
        clearRemoteRoster(false);
      }
      currentChannel = responseChannel;
      rosterMap = sentMap;
      channelJoined = true;
      savePreferredChannel(currentChannel);
      if (!applyPresenceSnapshot(data.players, data.visuals, sentMap)) {
        throw new Error('WORLD_PRESENCE_VISUAL_MISSING');
      }
      applyChatMessages(data.messages);
      worldAnnouncements?.consume?.(data.announcements);
      if (sentChat && data.acceptedChatId === sentChat.id && pendingChats[0]?.id === sentChat.id) {
        pendingChats.shift();
      }
      lastSuccessfulSyncAt = Date.now();
      window.__multiplayerStatusV53 = 'online';
      window.__multiplayerPresenceStatusV1 = 'online';
      channelStatus = 'online';
      channelReason = null;
      updateOnlineBadge();
      notifyChannelState(true);
      return Object.freeze({
        ok:true,
        channel:currentChannel,
        channelCounts:Object.freeze({ ...channelCounts }),
      });
    } catch (error) {
      if (client === activeClient) {
        window.__multiplayerStatusV53 = 'offline';
        window.__multiplayerPresenceStatusV1 = 'offline';
        channelStatus = 'offline';
        channelReason = String(error?.code || error?.message || 'SYNC_FAILED').slice(0, 80);
        updateOnlineBadge();
        notifyChannelState(true);
      }
      return false;
    }
  }

  function syncPresence(options = {}) {
    if (presenceSyncPromise) {
      if (options.waitForCurrent === true) {
        return presenceSyncPromise.then(() => syncPresence({ ...options, waitForCurrent:false }));
      }
      return Promise.resolve(false);
    }
    const task = performPresenceSync(options);
    presenceSyncPromise = task.finally(() => {
      if (presenceSyncPromise === wrapped) presenceSyncPromise = null;
    });
    const wrapped = presenceSyncPromise;
    return wrapped;
  }

  async function changeChannel(value) {
    const target = normalizeChannel(value);
    if (target == null) return Object.freeze({ ok:false, code:'INVALID_CHANNEL', state:getChannelState() });
    const blockReason = activityBlockReason();
    if (channelSwitching) return Object.freeze({ ok:false, code:'SWITCHING', state:getChannelState() });
    if (Date.now() < channelCooldownUntil) {
      return Object.freeze({ ok:false, code:'COOLDOWN', state:getChannelState() });
    }
    if (blockReason) return Object.freeze({ ok:false, code:blockReason, state:getChannelState() });
    if (channelJoined && target === currentChannel) {
      return Object.freeze({ ok:true, code:'ALREADY_IN_CHANNEL', channel:currentChannel, state:getChannelState() });
    }
    channelSwitching = true;
    channelReason = null;
    notifyChannelState(true);
    let outcome = null;
    try {
      const result = await syncPresence({ channel:target, manual:true, waitForCurrent:true });
      if (result?.ok === true && result.channel === target) {
        channelCooldownUntil = Date.now() + CHANNEL_SWITCH_COOLDOWN_MS;
        channelReason = null;
        setTimeout(() => notifyChannelState(true), CHANNEL_SWITCH_COOLDOWN_MS + 25);
        outcome = result;
      } else {
        if (result?.code === 'CHANNEL_FULL') channelReason = 'CHANNEL_FULL';
        outcome = result || { ok:false, code:'SYNC_FAILED' };
      }
    } finally {
      channelSwitching = false;
      notifyChannelState(true);
    }
    return Object.freeze({ ...outcome, state:getChannelState() });
  }

  function tick() {
    const G = g();
    const now = Date.now();
    remotes.forEach((value, name) => {
      if (now - (value.at || 0) > STALE_MS) forgetRemote(name);
    });
    if (G?.player && document.querySelector('#game.active')) {
      ensureRpcClient(G);
      if (lastSuccessfulSyncAt && now - lastSuccessfulSyncAt > STALE_MS) {
        window.__multiplayerStatusV53 = 'offline';
        window.__multiplayerPresenceStatusV1 = 'offline';
        channelStatus = 'offline';
        channelReason = 'SYNC_STALE';
      }
    } else if (activeClient) {
      clearPresenceState('waiting-login');
    }
    updateOnlineBadge();
    notifyChannelState();
  }

  setInterval(tick, MAINTENANCE_MS);
  setInterval(() => { syncPresence(); }, PRESENCE_SYNC_MS);
  window.__mpSyncPresenceV54 = syncPresence;
  window.__mpPendingChatCountV54 = () => pendingChats.length;
  window.__mpMultiplayerCountsV54 = () => Object.freeze({
    sameMap:sameMapRosterSize,
    visible:visibleSameMapSize,
  });
  window.addEventListener('beforeunload', () => clearPresenceState('waiting-login'));

  /* ── 렌더: 같은 맵의 다른 플레이어 그리기 ── */
  function drawRemotePet(ctx, remote, worldX, worldY, toScreen, now, moving) {
    const pet = window.PET_DEFS_V27?.[String(remote?.activePet || '')];
    if (!pet) return;
    const dancing = remote.dance === true;
    const side = avatarVisualSync?.petSideFromFacing(remote?.petSide, remote?.facing)
      || remote?.petSide
      || 'left';
    const worldPoint = avatarVisualSync?.petWorldPosition({
      ownerX:worldX,
      ownerY:worldY,
      side,
      moving,
      dancing,
      bob:pet.bob,
      now,
    }) || { x:worldX - 54, y:worldY + 8 };
    const point = toScreen(worldPoint.x, worldPoint.y);
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#020617';
    ctx.beginPath();
    ctx.ellipse(point.x, point.y + 24, 18, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    if (pet.id === 'yuksam' && typeof window.drawYuksamPetV35 === 'function') {
      ctx.restore();
      // 육삼이는 일반 건물 아이콘과 겹쳐 그리지 않고 얼굴이 들어간 공용 그림만 쓴다.
      window.drawYuksamPetV35(ctx, point, dancing, moving, pet, now);
      return;
    }
    ctx.translate(point.x, point.y);
    ctx.rotate(dancing
      ? Math.sin(now / 95 + Number(pet.bob || 0)) * 0.2
      : Math.sin(now / 500 + Number(pet.bob || 0)) * 0.03);
    const bounce = dancing
      ? 1.08 + Math.sin(now / 70) * 0.06
      : 1 + Math.sin(now / 460 + Number(pet.bob || 0)) * 0.02;
    ctx.scale(bounce, bounce);
    ctx.font = `900 ${pet.legendary ? 36 : 33}px "Noto Sans KR", "Apple Color Emoji", "Segoe UI Emoji", system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(15,23,42,.55)';
    ctx.strokeText?.(pet.icon, 0, 0);
    ctx.fillText(pet.icon, 0, 0);
    if (pet.legendary) {
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = 'rgba(251,191,36,.65)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 25 + Math.sin(now / 240) * 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (moving) {
      ctx.fillStyle = pet.color || '#fde68a';
      ctx.globalAlpha = 0.74;
      ctx.beginPath(); ctx.ellipse(-8, 20, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(8, 20, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
    }
    if (dancing) {
      ctx.globalAlpha = 0.92;
      ctx.font = '900 15px "Noto Sans KR", system-ui';
      ctx.fillStyle = pet.color || '#fde68a';
      ctx.fillText('♪', -22, -24);
      ctx.fillText('♬', 22, -30);
    }
    ctx.restore();
  }

  function drawRemoteNameplate(ctx, point, remote) {
    const renderer = window.YuksamPlayerNameplateV1;
    if (typeof renderer?.draw !== 'function') return;
    renderer.draw(ctx, point.x, point.y, {
      name:remote?.name,
      level:remote?.level,
      class:remote?.class,
      spec:remote?.spec,
      nameplate:remote?.nameplate,
    }, {
      source:'remote',
      userId:String(remote?.userId || ''),
    });
  }

  // 신규 학생들이 같은 스폰 좌표에 정확히 겹치면 28명이 한 명처럼 보인다.
  // 실제 충돌 좌표는 바꾸지 않고 화면상의 원격 캐릭터만 펼친다. 계산은 새
  // presence snapshot이 왔을 때 한 번, 군집별 정렬도 한 번만 한다.
  function refreshCrowdOffsets(G) {
    const members = [{
      id:String(window.getPvpIdentityV1?.()?.userId || G?.player?.name || 'me'),
      x:Number(G?.player?.x),
      y:Number(G?.player?.y),
      remote:null,
    }];
    remotes.forEach((remote, name) => {
      if (!remote || remote.map !== G?.currentMap) return;
      remote._crowdOffset = { x:0, y:0 };
      members.push({
        id:String(remote.userId || name),
        x:Number(remote.x),
        y:Number(remote.y),
        remote,
      });
    });
    const visited = new Set();
    members.forEach((seed, seedIndex) => {
      if (visited.has(seedIndex)) return;
      const queue = [seedIndex];
      const cluster = [];
      visited.add(seedIndex);
      while (queue.length) {
        const index = queue.shift();
        const current = members[index];
        cluster.push(current);
        members.forEach((candidate, candidateIndex) => {
          if (visited.has(candidateIndex)) return;
          if (Math.hypot(candidate.x - current.x, candidate.y - current.y) > 16) return;
          visited.add(candidateIndex);
          queue.push(candidateIndex);
        });
      }
      if (cluster.length < 2) return;
      cluster.sort((a, b) => a.id.localeCompare(b.id));
      cluster.forEach((member, index) => {
        if (!member.remote) return;
        const ringIndex = Math.floor(index / 10);
        const ringStart = ringIndex * 10;
        const ringSize = Math.min(10, cluster.length - ringStart);
        const angle = ((index - ringStart) / Math.max(1, ringSize)) * Math.PI * 2 - Math.PI / 2;
        const radius = 30 + ringIndex * 24;
        member.remote._crowdOffset = {
          x:Math.cos(angle) * radius,
          y:Math.sin(angle) * radius * 0.58,
        };
      });
    });
  }

  function remoteSpriteState(remote, moving) {
    return avatarVisualSync?.spriteStateFor({
      class:remote.class,
      equipment:remote.equipment || {},
      costume:remote.costume || {},
      weaponTier:remote.weaponTier,
    }, {
      attack:0,
      moving,
      dance:remote.dance ? 1 : 0,
      remote:true,
    }) || {
      attack:0,
      moving,
      dance:remote.dance ? 1 : 0,
      remote:true,
      equipment:remote.equipment || {},
      costume:remote.costume || {},
    };
  }

  function renderRemotes() {
    const G = g();
    // 혼자 접속한 경우 멀티플레이 렌더 계층은 프레임 작업을 전혀 하지 않는다.
    // 빈 명단에서도 진단 계산과 DOM 상태 확인이 매 프레임 반복되던 회귀를 막는다.
    if (!G?.player || !G.ctx || remotes.size === 0) return;
    const draw = (typeof drawPlayerSprite === 'function') ? drawPlayerSprite : null;
    const toScreen = (typeof worldToScreen === 'function') ? worldToScreen : null;
    if (!draw || !toScreen) return;
    const ctx = G.ctx;
    remoteBounds = [];
    const now = Date.now();
    let visibleRemotes = 0;
    remotes.forEach((p, name) => {
      if (!p || p.map !== G.currentMap || typeof p.x !== 'number') return;
      // 마지막으로 받은 좌표로 튀지 않고, 두 지점 사이를 채운 위치에 그린다
      const eased = motions.get(name)?.sample(now) || null;
      const baseX = eased ? eased.x : p.x;
      const baseY = eased ? eased.y : p.y;
      const worldX = baseX + (Number(p._crowdOffset?.x) || 0);
      const worldY = baseY + (Number(p._crowdOffset?.y) || 0);
      const s = toScreen(worldX, worldY);
      if (s.x < -120 || s.y < -120 || s.x > G.width + 120 || s.y > G.height + 120) return;
      visibleRemotes += 1;
      drawRemotePet(ctx, p, worldX, worldY, toScreen, now, !!p.moving || !!eased?.moving);
      ctx.save();
      ctx.globalAlpha = 0.96;
      try {
        const moving = !!p.moving || !!eased?.moving;
        const spriteState = remoteSpriteState(p, moving);
        draw(ctx, s.x, s.y, p.appearance || {}, p.class || 'warrior',
          spriteState,
          (typeof PLAYER_WORLD_SCALE !== 'undefined' ? PLAYER_WORLD_SCALE : 1.26), p.spec || null);
      } catch {}
      ctx.restore();
      if (p.userId) {
        remoteBounds.push({
          userId:String(p.userId),
          left:s.x - 46,
          right:s.x + 46,
          top:s.y - 90,
          bottom:s.y + 24,
          centerX:s.x,
          centerY:s.y - 30,
        });
      }
      // Local and remote characters share one below-the-feet nameplate renderer.
      try { drawRemoteNameplate(ctx, s, p); } catch {}

      // 말풍선은 이름표와 별개로 캐릭터 머리 위에 둔다.
      if (p.bubble && p.bubble.until > now) {
        ctx.save();
        ctx.font = '700 12px "Noto Sans KR", sans-serif';
        ctx.textAlign = 'center';
        const t = p.bubble.text;
        const bw = Math.min(220, ctx.measureText(t).width + 18);
        ctx.fillStyle = 'rgba(255,255,255,.94)';
        ctx.beginPath(); ctx.roundRect(s.x - bw / 2, s.y - 92, bw, 24, 10); ctx.fill();
        ctx.fillStyle = '#0f172a';
        ctx.fillText(t, s.x, s.y - 75);
        ctx.restore();
      }
    });
    visibleSameMapSize = 1 + visibleRemotes;
  }

  g()?.canvas?.addEventListener?.('contextmenu', (event) => {
    const G = g();
    const rect = G?.canvas?.getBoundingClientRect?.();
    if (!rect?.width || !rect?.height) return;
    const x = (event.clientX - rect.left) * (G.canvas.width / rect.width);
    const y = (event.clientY - rect.top) * (G.canvas.height / rect.height);
    const target = remoteBounds
      .filter((bounds) => x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom)
      .sort((a, b) => Math.hypot(x - a.centerX, y - a.centerY) - Math.hypot(x - b.centerX, y - b.centerY))[0];
    if (!target) return;
    event.preventDefault();
    window.openRemoteProfileV1?.(target.userId);
  });

  function attachLayer() {
    if (typeof worldRenderPipeline !== 'undefined' && worldRenderPipeline?.registerLayer) {
      worldRenderPipeline.registerLayer({
        id: 'remote-players-v53',
        priority: 335, // 플레이어(340)보다 살짝 뒤
        when: ({ map }) => remotes.size > 0
          && !['petShopInterior', 'upgradeShopInterior', 'raidTower'].includes(map),
        render: renderRemotes,
      });
      return true;
    }
    return false;
  }
  if (!attachLayer()) {
    const t = setInterval(() => { if (attachLayer()) clearInterval(t); }, 300);
  }
})();
