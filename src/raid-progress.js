/* =========================================================
   raid-progress.js — 63빌딩 던전 구간 해금 규칙

   앞 구간을 깨야 다음 구간이 열린다. 그리고 던전은 셋이 함께 들어가므로
   "파티원 셋이 모두 열려 있어야" 그 구간에 도전할 수 있다.

   저장은 플레이어의 raidTopGroup 하나로 끝낸다(깬 구간 중 가장 높은 번호).
   화면·서버·저장을 건드리지 않는 순수 계산만 담는다.
   ========================================================= */
(function initYuksamRaidProgress(global) {
  'use strict';

  /* 구간 번호(1~7)와 실제 시작 층. raid-rules의 FLOORS와 같은 순서다. */
  const GROUPS = Object.freeze([
    Object.freeze({ id:1, floor:1,  label:'1–10층',  recommendedLevel:5 }),
    Object.freeze({ id:2, floor:11, label:'11–20층', recommendedLevel:6 }),
    Object.freeze({ id:3, floor:21, label:'21–30층', recommendedLevel:7 }),
    Object.freeze({ id:4, floor:31, label:'31–40층', recommendedLevel:8 }),
    Object.freeze({ id:5, floor:41, label:'41–50층', recommendedLevel:9 }),
    Object.freeze({ id:6, floor:51, label:'51–60층', recommendedLevel:10 }),
    Object.freeze({ id:7, floor:61, label:'61–63층', recommendedLevel:12 }),
  ]);

  const FIRST_GROUP = 1;
  const LAST_GROUP = GROUPS.length;

  const integer = (value) => {
    const number = Math.trunc(Number(value));
    return Number.isFinite(number) ? number : 0;
  };

  function groupById(id) {
    return GROUPS.find((group) => group.id === integer(id)) || null;
  }

  function groupForFloor(floor) {
    return GROUPS.find((group) => group.floor === integer(floor)) || null;
  }

  function floorForGroup(id) {
    return groupById(id)?.floor || 0;
  }

  /* 이 사람이 깬 구간 중 가장 높은 번호. 아직 하나도 못 깼으면 0. */
  function clearedGroup(source) {
    const raw = source && typeof source === 'object'
      ? (source.raidTopGroup ?? source.raid_top_group ?? 0)
      : source;
    return Math.max(0, Math.min(LAST_GROUP, integer(raw)));
  }

  /* 지금 도전할 수 있는 가장 높은 구간. 1구간은 언제나 열려 있다. */
  function highestUnlockedGroup(source) {
    return Math.max(FIRST_GROUP, Math.min(LAST_GROUP, clearedGroup(source) + 1));
  }

  function isUnlocked(source, groupId) {
    const id = integer(groupId);
    if (!groupById(id)) return false;
    return id <= highestUnlockedGroup(source);
  }

  function unlockedGroups(source) {
    return GROUPS.filter((group) => isUnlocked(source, group.id)).map((group) => group.id);
  }

  /* 파티 전체가 이 구간을 열었는가.
     한 명이라도 못 열었으면 그 사람 이름을 함께 돌려준다(안내 문구용). */
  function partyUnlockCheck(members, groupId) {
    const list = Array.isArray(members) ? members.filter(Boolean) : [];
    const locked = list.filter((member) => !isUnlocked(member, groupId));
    return {
      ok:list.length > 0 && locked.length === 0,
      lockedNames:locked.map((member) => String(member?.name || '친구')),
    };
  }

  /* 구간을 깼을 때의 새 진행도. 이미 더 앞서 있으면 그대로 둔다. */
  function nextClearedGroup(source, clearedGroupId) {
    const id = integer(clearedGroupId);
    if (!groupById(id)) return clearedGroup(source);
    return Math.max(clearedGroup(source), id);
  }

  /* 플레이어 객체에 직접 기록한다. 실제로 바뀌었을 때만 true.
     (저장은 부르는 쪽에서 savePlayer로 한다 — 이 모듈은 저장을 모른다.) */
  function recordClear(player, clearedGroupId) {
    if (!player || typeof player !== 'object') return false;
    const next = nextClearedGroup(player, clearedGroupId);
    if (next === clearedGroup(player)) return false;
    player.raidTopGroup = next;
    return true;
  }

  function labelFor(groupId) {
    return groupById(groupId)?.label || '';
  }

  global.YuksamRaidProgress = Object.freeze({
    GROUPS,
    FIRST_GROUP,
    LAST_GROUP,
    groupById,
    groupForFloor,
    floorForGroup,
    clearedGroup,
    highestUnlockedGroup,
    isUnlocked,
    unlockedGroups,
    partyUnlockCheck,
    nextClearedGroup,
    recordClear,
    labelFor,
  });
})(typeof window !== 'undefined' ? window : globalThis);
