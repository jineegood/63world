(function installWorldAnnouncementsV1(global) {
  'use strict';

  const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
  const VALID_KINDS = new Set([
    'legendary_upgrade', 'legendary_pet', 'raid_clear', 'teacher_notice',
    'elite_defeat', 'level_ten',
  ]);
  const VALID_ACTIONS = new Set(['enhance', 'summonPet']);
  const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const USER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const ITEM_ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/;
  const ELITE_MONSTERS = Object.freeze({
    forest_elite_slime:Object.freeze({ name:'엘리트 슬라임', particle:'을' }),
    desert_elite_snake:Object.freeze({ name:'엘리트 스네이크', particle:'를' }),
    swamp_elite_zombie:Object.freeze({ name:'엘리트 좀비', particle:'를' }),
  });
  const PENDING_KEY_PREFIX = 'ysb_world_special_action_v1:';
  const MAX_SEEN_IDS = 500;
  const BANNER_MS = 4200;
  let cursor = '0';
  let seenIds = new Set();
  let seenOrder = [];
  let bannerQueue = [];
  let bannerTimer = null;
  let bannerVisible = false;
  const pendingMemory = new Map();

  function isLocalTestEnvironment(locationValue = global.location) {
    if (!locationValue) return true;
    const protocol = String(locationValue.protocol || '').toLowerCase();
    const hostname = String(locationValue.hostname || '').toLowerCase();
    return protocol === 'file:' || LOCAL_HOSTS.has(hostname);
  }

  function requestId() {
    try {
      const value = global.crypto?.randomUUID?.();
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
        return value.toLowerCase();
      }
    } catch {}
    let bytes;
    if (typeof global.crypto?.getRandomValues === 'function') {
      bytes = Array.from(global.crypto.getRandomValues(new Uint8Array(16)));
    } else if (isLocalTestEnvironment()) {
      bytes = Array.from({ length:16 }, () => Math.floor(Math.random() * 256));
    } else {
      throw new Error('secure request UUID generation is unavailable');
    }
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = bytes.map((value) => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function pendingKey(action, userId) {
    const safeAction = String(action || '');
    const safeUserId = String(userId || '').toLowerCase();
    if (!VALID_ACTIONS.has(safeAction) || !USER_ID_RE.test(safeUserId)) return '';
    return `${PENDING_KEY_PREFIX}${safeUserId}:${safeAction}`;
  }

  function normalizePending(action, value) {
    if (!VALID_ACTIONS.has(action) || !value || typeof value !== 'object' || Array.isArray(value)) return null;
    const safeRequestId = String(value.requestId || '').toLowerCase();
    if (!REQUEST_ID_RE.test(safeRequestId)) return null;
    if (action === 'summonPet') return Object.freeze({ requestId:safeRequestId });
    const weaponId = String(value.weaponId || '');
    const oldTier = Number(value.oldTier);
    if (!ITEM_ID_RE.test(weaponId) || !Number.isInteger(oldTier) || oldTier < 0 || oldTier > 3) return null;
    return Object.freeze({ requestId:safeRequestId, weaponId, oldTier });
  }

  function rememberPending(action, userId, value) {
    const key = pendingKey(action, userId);
    const pending = normalizePending(action, value);
    if (!key || !pending) return null;
    pendingMemory.set(key, pending);
    try { global.sessionStorage?.setItem?.(key, JSON.stringify(pending)); } catch {}
    return pending;
  }

  function loadPending(action, userId) {
    const key = pendingKey(action, userId);
    if (!key) return null;
    const remembered = pendingMemory.get(key);
    if (remembered) return remembered;
    let parsed = null;
    try { parsed = JSON.parse(global.sessionStorage?.getItem?.(key) || 'null'); } catch {}
    const pending = normalizePending(action, parsed);
    if (!pending) {
      try { global.sessionStorage?.removeItem?.(key); } catch {}
      return null;
    }
    pendingMemory.set(key, pending);
    return pending;
  }

  function clearPending(action, userId) {
    const key = pendingKey(action, userId);
    if (!key) return false;
    pendingMemory.delete(key);
    try { global.sessionStorage?.removeItem?.(key); } catch {}
    return true;
  }

  function normalizeId(value) {
    const text = String(value ?? '');
    if (!/^[1-9][0-9]{0,18}$/.test(text)) return null;
    try {
      const parsed = BigInt(text);
      if (parsed > 9223372036854775807n) return null;
      return parsed.toString();
    } catch {
      return null;
    }
  }

  function isNewerId(left, right) {
    try { return BigInt(left) > BigInt(right); } catch { return false; }
  }

  function cleanName(value) {
    const text = String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
    if (!text || text.length > 20 || /[\u0000-\u001f\u007f-\u009f]/.test(text)) return '';
    return text;
  }

  function cleanNotice(value) {
    const text = String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
    if (!text || text.length > 120 || /[\u0000-\u001f\u007f-\u009f]/.test(text)) return '';
    return text;
  }

  function normalizeAnnouncement(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const id = normalizeId(value.id);
    const kind = String(value.kind || '');
    if (!id || !VALID_KINDS.has(kind)) return null;

    if (kind === 'teacher_notice') {
      const message = cleanNotice(value.message);
      return message ? Object.freeze({ id, kind, message }) : null;
    }

    if (kind === 'legendary_upgrade' || kind === 'legendary_pet') {
      const actorName = cleanName(value.actorName);
      if (!actorName) return null;
      const subjectId = String(value.subjectId || '');
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(subjectId)) return null;
      if (kind === 'legendary_pet' && subjectId !== 'yuksam') return null;
      return Object.freeze({ id, kind, actorName, subjectId });
    }

    if (kind === 'elite_defeat') {
      const actorName = cleanName(value.actorName);
      const subjectId = String(value.subjectId || '');
      if (!actorName || !ELITE_MONSTERS[subjectId]) return null;
      return Object.freeze({ id, kind, actorName, subjectId });
    }

    if (kind === 'level_ten') {
      const actorName = cleanName(value.actorName);
      return actorName ? Object.freeze({ id, kind, actorName }) : null;
    }

    const partyNames = Array.isArray(value.partyNames)
      ? value.partyNames.map(cleanName).filter(Boolean).slice(0, 3)
      : [];
    const floor = Math.trunc(Number(value.floor));
    if (!partyNames.length || ![10, 20, 30, 40, 50, 60, 63].includes(floor)) return null;
    return Object.freeze({ id, kind, partyNames:Object.freeze(partyNames), floor });
  }

  function formatAnnouncement(announcement) {
    if (!announcement) return '';
    if (announcement.kind === 'teacher_notice') {
      return `📢 ${announcement.message}`;
    }
    if (announcement.kind === 'legendary_upgrade') {
      const item = global.YuksamData?.ITEM_DEFS?.[announcement.subjectId];
      const weaponName = item?.slot === 'weapon' && cleanName(item.name) ? cleanName(item.name) : '무기';
      return `✨ ${announcement.actorName} 님이 ${weaponName} 전설 강화에 성공했습니다!`;
    }
    if (announcement.kind === 'legendary_pet') {
      return `🌟 ${announcement.actorName} 님이 전설 펫 육삼이를 획득했습니다!`;
    }
    if (announcement.kind === 'raid_clear') {
      return `🏆 ${announcement.partyNames.join(', ')} 님이 ${announcement.floor}층을 클리어하셨습니다!`;
    }
    if (announcement.kind === 'elite_defeat') {
      const monster = ELITE_MONSTERS[announcement.subjectId];
      if (!monster) return '';
      return `👑 ${announcement.actorName} 님이 ${monster.name}${monster.particle} 처치했습니다!`;
    }
    if (announcement.kind === 'level_ten') {
      return `🎊 ${announcement.actorName} 님이 10레벨을 달성했습니다!`;
    }
    return '';
  }

  function finishBanner() {
    const region = global.document?.getElementById?.('worldAnnouncementRegion');
    if (region) {
      region.classList?.remove?.('is-visible');
      region.removeAttribute?.('data-kind');
    }
    bannerVisible = false;
    bannerTimer = null;
    if (bannerQueue.length) global.setTimeout?.(showNextBanner, 180);
  }

  function showNextBanner() {
    if (bannerVisible || !bannerQueue.length) return;
    const next = bannerQueue.shift();
    const region = global.document?.getElementById?.('worldAnnouncementRegion');
    if (!region) return;
    region.textContent = next.message;
    region.setAttribute?.('data-kind', next.kind);
    region.classList?.add?.('is-visible');
    bannerVisible = true;
    bannerTimer = global.setTimeout?.(finishBanner, BANNER_MS) ?? null;
  }

  function rememberId(id) {
    if (seenIds.has(id)) return false;
    seenIds.add(id);
    seenOrder.push(id);
    while (seenOrder.length > MAX_SEEN_IDS) seenIds.delete(seenOrder.shift());
    return true;
  }

  function consume(items) {
    if (!Array.isArray(items)) return Object.freeze([]);
    const accepted = [];
    items.forEach((value) => {
      const id = normalizeId(value?.id);
      if (id && isNewerId(id, cursor)) cursor = id;
      const announcement = normalizeAnnouncement(value);
      if (!announcement || !rememberId(announcement.id)) return;
      const message = formatAnnouncement(announcement);
      if (!message) return;
      accepted.push(announcement);
      bannerQueue.push({ kind:announcement.kind, message });
      try { global.appendChatMessage?.('announcement', '전체 알림', message); } catch {}
    });
    showNextBanner();
    return Object.freeze(accepted);
  }

  function reset() {
    cursor = '0';
    seenIds = new Set();
    seenOrder = [];
    bannerQueue = [];
    if (bannerTimer !== null) global.clearTimeout?.(bannerTimer);
    bannerTimer = null;
    bannerVisible = false;
    const region = global.document?.getElementById?.('worldAnnouncementRegion');
    if (region) {
      region.textContent = '';
      region.classList?.remove?.('is-visible');
      region.removeAttribute?.('data-kind');
    }
  }

  global.YuksamWorldAnnouncementsV1 = Object.freeze({
    clearPending,
    consume,
    formatAnnouncement,
    getCursor:() => cursor,
    isLocalTestEnvironment,
    loadPending,
    normalizeAnnouncement,
    rememberPending,
    requestId,
    reset,
  });
})(window);
