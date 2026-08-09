/* =========================================================
   raid-run-ui.js — 63빌딩 던전 화면

   화면 세 개를 담당한다.
     1) 대형 배치 — 셋을 앞줄·중간·뒷줄에 세운다
     2) 이동 연출 — 셋이 다음 층으로 걸어간다
     3) 전투 — 몬스터 하나와 셋이 싸운다

   규칙과 진행은 raid-rules.js / raid-run.js가 이미 다 계산해 둔다.
   여기서는 그 상태를 읽어 그리고, 학생의 입력을 되돌려 줄 뿐이다.
   그래서 나중에 진행을 서버가 대신 굴려도 이 파일은 거의 그대로 쓴다.

   style.css는 건드리지 않고 필요한 스타일만 이 파일이 넣는다.
   ========================================================= */
(function initYuksamRaidRunUi(global) {
  'use strict';

  if (global.__YUKSAM_RAID_RUN_UI_V1__) return;
  global.__YUKSAM_RAID_RUN_UI_V1__ = true;

  const G = () => (typeof game !== 'undefined' ? game : null);
  const core = () => global.YuksamCore || {};
  const rules = () => global.YuksamRaidRules;
  const runApi = () => global.YuksamRaidRun;
  const call = (name, ...args) => (typeof global[name] === 'function' ? global[name](...args) : undefined);
  const esc = (value) => (core().escapeHtml ? core().escapeHtml(value) : String(value == null ? '' : value));
  const norm = (value) => (core().normalize ? core().normalize(value) : String(value == null ? '' : value).trim());

  /* 셋 다 준비되면 세는 시간(초)과 한 칸의 길이(밀리초). 검사에서는 짧게 줄인다. */
  let READY_COUNTDOWN = 5;
  let COUNTDOWN_STEP_MS = 1000;
  const PARTY_COMPOSITION_MESSAGE = '더 다양한 직업군으로 파티를 구성해야 합니다!';

  let active = null;      // 지금 돌고 있는 판
  let question = null;    // 지금 화면에 뜬 문제
  let busy = false;       // 연출 재생 중에는 입력을 막는다
  let formationAnimationFrame = null;
  let formationAnimationToken = 0;
  let raidPetAnchor = null;
  let networkSession = null;
  let raidPartyClient = null;
  let networkUnsubscribe = null;
  let networkHeartbeatTimer = null;
  let networkRefreshPending = false;
  let networkRefreshAgain = false;
  let networkDraftPlacement = {};
  let networkSelectedMemberId = null;
  let networkStarting = false;
  let networkLobbyCountdownTimer = null;
  let networkLobbyCountdownKey = '';
  let networkLobbyCountdownValue = 0;
  let networkLobbyStartPending = false;
  let raidQuestionTimerInterval = null;
  let raidQuestionReadyRetryTimer = null;

  function raidIdentity() {
    return global.getPvpIdentityV1?.() || global.secureStudentAccessV2?.getIdentity?.() || null;
  }

  function isMine(member) {
    const userId = networkSession ? String(raidIdentity()?.userId || '') : '';
    return userId ? String(member?.id || '') === userId : member?.isPlayer === true;
  }

  function getRaidPartyClient() {
    if (raidPartyClient) return raidPartyClient;
    const access = global.secureStudentAccessV2;
    const client = access?.getClient?.();
    if (!client || !raidIdentity() || typeof global.YuksamRaidPartyClient?.create !== 'function') return null;
    raidPartyClient = global.YuksamRaidPartyClient.create({
      client,
      getIdentity:() => raidIdentity(),
    });
    return raidPartyClient;
  }

  /* ---------- 스타일 ---------- */

  function ensureStyles() {
    if (global.document.getElementById('raidRunStylesV1')) return;
    const style = global.document.createElement('style');
    style.id = 'raidRunStylesV1';
    style.textContent = `
      .raid-hint{font-size:12px;color:#9fb3cd;margin-top:2px}
      .raid-error{font-size:13px;color:#fca5a5;margin-top:6px}
      .raid-room-head{display:flex;align-items:center;justify-content:space-between;gap:12px;
        margin-bottom:10px;padding:10px 14px;border-radius:13px;background:rgba(14,36,61,.86);
        border:1px solid rgba(125,211,252,.28)}
      .raid-room-code{display:inline-flex;align-items:center;gap:9px;color:#bae6fd;font-size:14px}
      .raid-room-code strong{font-size:30px;letter-spacing:7px;color:#fde68a;font-variant-numeric:tabular-nums}
      .raid-room-count{font-size:18px;font-weight:900;color:#e0f2fe}
      .raid-room-wait{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:12px 0}
      .raid-room-member{min-height:170px;border:1px solid rgba(148,163,184,.35);border-radius:14px;
        padding:8px;text-align:center;background:rgba(15,23,42,.78);display:flex;flex-direction:column;
        align-items:center;justify-content:center;gap:4px}
      .raid-room-member.empty{border-style:dashed;color:#64748b;font-weight:800;font-size:15px}
      .raid-room-member.ready{border-color:#4ade80;box-shadow:0 0 0 2px rgba(74,222,128,.2)}
      .raid-room-member canvas{display:block}
      .raid-room-status{text-align:center;min-height:24px;color:#cbd5e1;font-weight:700;margin:8px 0}
      .raid-room-status.good{color:#86efac}.raid-room-status.warn{color:#fde68a}
      .raid-room-actions{display:flex;align-items:center;justify-content:center;gap:9px;flex-wrap:wrap}
      /* 던전은 전용 방 나가기/포기 버튼으로만 끝낸다. 모달의 공용 X는
         실수 한 번에 파티방이 닫히므로 던전 내용이 떠 있을 때만 감춘다. */
      #modal:has(#modalContent [class*="raid-"]) > .modal-box > #modalClose,
      #modal:has(#modalContent [id^="raid"]) > .modal-box > #modalClose{display:none!important}

      /* 대형 화면 — 위 세 자리, 아래 대기칸 */
      .raid-posts{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:12px 0 16px}
      .raid-post{border-radius:14px;padding:10px 8px 12px;text-align:center;min-height:210px;
        display:flex;flex-direction:column;align-items:center;gap:6px;position:relative}
      /* 빈 자리는 + 버튼이 칸 한가운데에 오도록 남는 공간을 나눠 준다 */
      .raid-post.empty{border:2px dashed rgba(125,211,252,.55);background:rgba(8,17,30,.55);
        justify-content:center}
      .raid-post.empty .raid-post-title{position:absolute;top:10px;left:0;right:0}
      .raid-post.filled{border:1px solid rgba(148,163,184,.4);background:rgba(15,23,42,.78);
        justify-content:flex-start}
      /* 파란 테두리는 "지금 이 화면을 보고 있는 사람"의 캐릭터 표시다.
         각자 자기 화면에서 자기 캐릭터만 파랗게 보인다. */
      .raid-post.filled.mine,
      .raid-post.filled.on{border-color:#38bdf8;box-shadow:0 0 0 2px rgba(56,189,248,.35)}
      /* 방장이 배치하려고 고른 캐릭터는 은은하게 밝히기만 한다(테두리는 안 건드린다). */
      .raid-post.filled.picking{background:rgba(56,189,248,.14)}
      .raid-post.ready{border-color:#4ade80;box-shadow:0 0 0 2px rgba(74,222,128,.35)}
      /* 자리 이름은 크게 — 한눈에 앞/가운데/뒤를 알 수 있게 */
      .raid-post-title{font-size:39px;font-weight:900;color:#e2e8f0;line-height:1.1}
      .raid-host-crown{display:inline-flex;align-items:center;margin-right:5px;color:#fde68a;
        font-size:12px;font-weight:900;vertical-align:middle;filter:drop-shadow(0 1px 3px rgba(0,0,0,.65))}
      .raid-ready-badge{margin-top:auto;font-size:20px;font-weight:900;color:#4ade80;
        text-shadow:0 2px 6px rgba(0,0,0,.6)}
      .raid-plus{width:88px;height:88px;border-radius:999px;font-size:46px;line-height:1;
        border:2px solid rgba(125,211,252,.75);background:rgba(56,189,248,.16);color:#7dd3fc;cursor:pointer}
      .raid-plus:hover{background:rgba(56,189,248,.34);color:#e0f2fe}
      .raid-plus.small{width:34px;height:34px;font-size:20px;border-width:1px}
      .raid-countdown{text-align:center;font-size:30px;font-weight:900;color:#fbbf24;
        margin:10px 0;text-shadow:0 2px 8px rgba(0,0,0,.6)}
      .raid-actions{display:flex;gap:10px;justify-content:center;margin-top:12px}
      .raid-figure{cursor:pointer;display:flex;flex-direction:column;align-items:center}
      .raid-figure-name{font-size:13px;font-weight:700;margin-top:2px}
      .raid-figure-sub{font-size:11px;color:#9fb3cd}
      .raid-face{display:block}
      .raid-bench-wrap{border-top:1px solid rgba(148,163,184,.28);padding-top:10px}
      .raid-bench-head{display:flex;align-items:center;gap:8px;font-size:13px;color:#cbd5e1;margin-bottom:8px}
      .raid-bench{display:flex;gap:10px;flex-wrap:wrap;min-height:110px}
      .raid-bench-card{cursor:pointer;border:1px solid rgba(148,163,184,.35);border-radius:12px;
        background:rgba(15,23,42,.7);padding:6px 10px 8px;text-align:center}
      .raid-bench-card.mine,
      .raid-bench-card.on{border-color:#38bdf8;box-shadow:0 0 0 2px rgba(56,189,248,.35)}
      .raid-unlock-note{margin-top:8px;color:#fbbf24;font-weight:900}
      .raid-bench-card.picking{background:rgba(56,189,248,.14)}
      /* "준비를 눌러주세요!" 는 대기칸 한가운데에 크게 */
      .raid-bench-empty{font-size:30px;font-weight:900;color:#7dd3fc;
        flex:1;display:flex;align-items:center;justify-content:center;text-align:center}
      /* 전투 — 일반 전투 무대를 그대로 쓰고 왼쪽에 세 명이 선다.
         체력창은 무대 위쪽에 가로로 놓아 캐릭터를 가리지 않게 한다. */
      .raid-stage{min-height:470px}
      /* 세 명은 서로 겹치지 않게 넉넉히 벌려 세운다.
         각자 머리 위에 자기 체력바를 달고 있어 누가 위험한지 바로 보인다. */
      .raid-ally-sprite{width:150px;height:164px;overflow:visible}
      .raid-ally-0{bottom:10px;left:34%;z-index:4}
      .raid-ally-1{bottom:96px;left:18%;z-index:3}
      .raid-ally-2{bottom:182px;left:2%;z-index:2}
      .raid-ally-sprite.down{opacity:.35;filter:grayscale(.8)}
      /* 전체 공격이 덮칠 때 각자 자리에 이는 충격파 */
      .raid-ally-sprite.raid-storm-hit::after{content:'';position:absolute;inset:-14px 2px 6px;
        border-radius:50%;pointer-events:none;z-index:5;
        background:radial-gradient(circle,rgba(248,113,113,.42),rgba(248,113,113,0) 68%);
        animation:raidStormHit .5s ease-out forwards}
      @keyframes raidStormHit{
        0%{opacity:0;transform:scale(.55)}
        35%{opacity:1;transform:scale(1.06)}
        100%{opacity:0;transform:scale(1.3)}
      }
      .raid-monster-sprite{display:grid;place-items:center;right:5%;top:104px;width:236px;height:216px}
      /* 머리 위 체력창 — 사냥터 .combat-hpbox를 그대로 쓰되 자리만 잡아 준다.
         사냥터: min-width 230px / padding 10px 12px / radius 16px / 체력바 9px
         여기  : 폭 168px 로 줄이고 나머지 비율은 그대로 둔다. */
      .raid-ally-hp{position:absolute;left:50%;bottom:100%;transform:translateX(-50%);
        margin-bottom:6px;width:168px;min-width:0;z-index:6;
        padding:7px 9px;border-radius:13px;font-size:12px;line-height:1.3;text-align:center}
      .raid-ally-hp .hpbar{margin-top:6px}
      /* 내 체력은 한눈에 찾을 수 있게 배경과 테두리를 다르게 준다 */
      .raid-ally-hp.me{border-color:rgba(56,189,248,.85);
        background:linear-gradient(180deg, rgba(14,58,86,.95), rgba(8,25,42,.95));
        box-shadow:0 0 0 2px rgba(56,189,248,.28), 0 6px 18px rgba(0,0,0,.35)}
      .raid-ally-hp.me b{color:#a5e9ff}
      .raid-ally-hp.slot-front{border-color:rgba(74,222,128,.5);
        background:linear-gradient(180deg,rgba(27,55,42,.91),rgba(10,25,21,.94));
        box-shadow:0 0 0 1px rgba(74,222,128,.1)}
      .raid-ally-hp.slot-middle{border-color:rgba(250,204,21,.48);
        background:linear-gradient(180deg,rgba(58,51,29,.91),rgba(27,24,16,.94));
        box-shadow:0 0 0 1px rgba(250,204,21,.1)}
      .raid-ally-hp.slot-back{border-color:rgba(96,165,250,.5);
        background:linear-gradient(180deg,rgba(31,49,70,.91),rgba(14,25,39,.94));
        box-shadow:0 0 0 1px rgba(96,165,250,.1)}
      .raid-ally-hp.slot-front b{color:#86efac}.raid-ally-hp.slot-front .hpfill{background:#22c55e}
      .raid-ally-hp.slot-middle b{color:#fde047}.raid-ally-hp.slot-middle .hpfill{background:#eab308}
      .raid-ally-hp.slot-back b{color:#93c5fd}.raid-ally-hp.slot-back .hpfill{background:#3b82f6}
      .raid-ally-hp.down{opacity:.45}
      .raid-ally-hp b{display:block;font-size:13px;overflow:hidden;
        text-overflow:ellipsis;white-space:nowrap}
      .raid-ally-slot{color:#9fb3cd;margin-left:5px;font-size:11px;font-weight:800}
      .raid-ally-num{font-size:12px;color:#e2e8f0;margin-top:2px}
      /* 상태 배지는 사냥터와 같은 모양, 좁은 자리라 가운데로 모은다 */
      .raid-ally-hp .raid-status-row{justify-content:center;gap:4px;margin-top:4px}
      .raid-ally-hp .raid-status-row:empty{display:none}
      .raid-combat .combat-hpbox.monster{right:5%;top:auto;bottom:16px;min-width:250px}
      .raid-combat .combat-hpbox.monster{border-color:rgba(251,113,133,.82);
        background:linear-gradient(180deg,rgba(88,24,38,.94),rgba(45,11,21,.95))}
      .raid-combat .combat-hpbox.monster b{color:#fda4af}
      .raid-question-timer{position:absolute;left:50%;top:86px;transform:translateX(-50%);z-index:13;
        min-width:150px;padding:7px 15px;border-radius:999px;text-align:center;font-size:24px;
        line-height:1;font-weight:950;font-variant-numeric:tabular-nums;color:#f8fafc;
        background:rgba(6,13,24,.9);border:2px solid rgba(125,211,252,.72);
        box-shadow:0 5px 18px rgba(0,0,0,.42)}
      .raid-question-timer.warning{color:#fff1a8;border-color:#fbbf24;animation:raidTimerPulse .72s ease-in-out infinite alternate}
      .raid-question-timer.danger{color:#fecaca;border-color:#fb7185}
      .raid-question-timer[hidden]{display:none}
      @keyframes raidTimerPulse{from{transform:translateX(-50%) scale(1)}to{transform:translateX(-50%) scale(1.06)}}
      .raid-next-hint{font-size:11px;color:#fbbf24;margin-top:3px}
      .raid-next-hint.warn{font-weight:800}
      .raid-next-technique{color:#fbbf24;font-weight:950}
      .raid-status-row{display:flex;gap:4px;flex-wrap:wrap;margin-top:4px}
      .raid-status-badge{display:inline-flex;padding:2px 6px;border-radius:999px;font-size:10px;
        font-weight:900;background:rgba(30,41,59,.92);border:1px solid rgba(148,163,184,.45);color:#e2e8f0}
      .raid-status-badge.stun{border-color:#fde047;color:#fef08a}
      .raid-status-badge.chill{border-color:#67e8f9;color:#a5f3fc}
      .raid-status-badge.shadow{border-color:#c084fc;color:#e9d5ff}
      .raid-shield-text{color:#93c5fd;font-weight:900;margin-left:5px}
      .raid-log-name{font-weight:950;text-shadow:0 1px 5px rgba(0,0,0,.72)}
      .raid-log-name.slot-front{color:#4ade80}.raid-log-name.slot-middle{color:#fde047}
      .raid-log-name.slot-back{color:#60a5fa}.raid-log-name.enemy{color:#fb7185}

      /* 피해 숫자는 사냥터의 .combat-floating-damage를 그대로 쓴다.
         색·글꼴·크기·애니메이션이 style.css 한 곳에서 관리된다.
         여기서는 던전에만 있는 MISS 표시와 얹을 자리만 더한다. */
      .raid-float-layer{position:absolute;inset:0;pointer-events:none;z-index:12}
      .raid-float-layer .combat-floating-damage{z-index:12}
      .combat-floating-damage.raid-miss{color:#cbd5e1;font-size:20px;
        -webkit-text-stroke-color:rgba(15,23,42,.92);
        text-shadow:0 2px 3px rgba(0,0,0,.95),0 0 8px rgba(100,116,139,.85)}
      .raid-ally-sprite.raid-shake,.raid-monster-sprite.raid-shake{
        animation:raidShake .42s ease-in-out both!important}
      @keyframes raidShake{
        0%,100%{transform:translateX(0)}
        20%{transform:translateX(-8px)} 40%{transform:translateX(7px)}
        60%{transform:translateX(-5px)} 80%{transform:translateX(3px)}
      }
      /* 기본 대기 애니메이션보다 우선해 실제로 앞으로 나갔다 돌아오게 한다. */
      .raid-ally-sprite.raid-party-lunge{
        animation:raidPartyLunge .56s cubic-bezier(.18,.82,.24,1) both!important}
      .raid-monster-sprite.raid-monster-lunge{
        animation:raidMonsterLunge .62s cubic-bezier(.18,.82,.24,1) both!important}
      @keyframes raidPartyLunge{
        0%,100%{transform:translateX(0);filter:none}
        22%{transform:translateX(-5px)}
        58%{transform:translateX(38px);filter:brightness(1.28)}
      }
      @keyframes raidMonsterLunge{
        0%,100%{transform:translateX(0);filter:none}
        22%{transform:translateX(9px)}
        58%{transform:translateX(-52px);filter:brightness(1.28)}
      }
      .raid-stage.raid-danger{box-shadow:inset 0 0 0 3px rgba(251,191,36,.75)}
      /* 치명타가 터지면 무대가 번쩍인다 */
      .raid-stage.raid-crit{animation:raidCritFlash .45s ease-out}
      @keyframes raidCritFlash{
        0%{box-shadow:inset 0 0 0 0 rgba(251,191,36,0)}
        30%{box-shadow:inset 0 0 90px 12px rgba(251,191,36,.55)}
        100%{box-shadow:inset 0 0 0 0 rgba(251,191,36,0)}
      }
      /* 쓰러진 몬스터는 어두워지며 넘어간다 */
      .raid-monster-sprite.raid-dying canvas{
        filter:brightness(.25) grayscale(1);opacity:.35;
        transform:rotate(-10deg) translateY(14px);
        transition:filter .6s ease, opacity .6s ease, transform .6s ease}
      .raid-ally-sprite.down canvas{filter:grayscale(.9);opacity:.4}
    `;
    global.document.head.appendChild(style);
  }


  function roomMemberToCombatMember(row) {
    const profile = row?.profile || row?.profile_snapshot || {};
    const state = row?.state || row?.combat_state || {};
    const id = String(row?.userId || row?.user_id || profile.userId || '');
    const maxHp = Math.max(1, Math.floor(Number(state.maxHp ?? profile.maxHp) || 1));
    const hp = Math.max(0, Math.min(maxHp, Math.floor(Number(state.hp ?? profile.hp ?? maxHp) || 0)));
    return {
      id,
      name:String(profile.name || '학생'),
      klass:profile.className || profile.klass || 'warrior',
      spec:profile.spec || '',
      level:Math.max(1, Math.floor(Number(profile.level) || 1)),
      // 서버에서 아직 자리를 정하지 않은 대기 인원은 반드시 대기칸에 둔다.
      // null을 가운데로 바꾸면 세 명 모두 같은 칸에 겹쳐 로비가 멈춘 것처럼 보인다.
      slot:row?.slot || null,
      maxHp,
      hp,
      shield:Math.max(0, Math.floor(Number(state.shield ?? profile.shield) || 0)),
      // PvP 프로필의 attack은 이미 주 능력치의 절반이다. 던전 순수 계산기는
      // 사냥터와 같이 원래 주 능력치를 받아 내부에서 30~70%를 굴린다.
      attack:Math.max(1, Math.floor(Number(profile.primaryStat) || Number(profile.attack) * 2 || 1)),
      defense:Math.max(0, Math.floor(Number(profile.defense) || 0)),
      skills:{ ...(profile.skills || {}) },
      cooldowns:{ ...(state.cooldowns || profile.cooldowns || {}) },
      statuses:{ ...(state.statuses || {}) },
      buffs:{ ...(state.buffs || {}) },
      appearance:{ ...(profile.appearance || {}) },
      equipment:{ ...(profile.equipment || {}) },
      costume:{ ...(profile.costume || {}) },
      activePet:profile.activePet || '',
      weaponTier:Math.max(0, Math.min(4, Math.trunc(Number(profile.weaponTier) || 0))),
      /* 이 학생이 깬 던전 구간. 서버 프로필에서 온다.
         파티원 셋이 모두 열어야 그 구간에 들어갈 수 있는지 판단하는 데 쓴다. */
      raidTopGroup:Math.max(0, Math.trunc(Number(profile.raidTopGroup) || 0)),
      isPlayer:id === String(raidIdentity()?.userId || ''),
    };
  }

  function roomMembers() {
    return (networkSession?.members || [])
      .filter((row) => row && row.active !== false)
      .sort((a, b) => Number(a.joinOrder || a.join_order || 0) - Number(b.joinOrder || b.join_order || 0))
      .map(roomMemberToCombatMember);
  }

  /* 같은 전문화 세 명만 모이면 각 역할의 차이가 사라진다.
     빈 전문화도 우회 수단이 되지 않도록 세 명 모두 전문화가 있고,
     그중 둘 이상이 서로 달라야 준비할 수 있게 한다. */
  function partyCompositionState(members = roomMembers()) {
    const roster = Array.isArray(members) ? members.filter(Boolean) : [];
    const specs = roster.map((member) => norm(member?.spec)).filter(Boolean);
    return {
      ok:roster.length === 3 && specs.length === 3 && new Set(specs).size >= 2,
      specs,
    };
  }

  function memberPlaybackRound(row) {
    return Math.max(0, Math.trunc(Number(row?.playbackRound ?? row?.playback_round) || 0));
  }

  function memberQuestionReadyRound(row) {
    return Math.max(0, Math.trunc(Number(row?.questionReadyRound ?? row?.question_ready_round) || 0));
  }

  /* heartbeat와 realtime 조회가 겹치면 오래된 응답이 나중에 도착할 수 있다.
     같은 방 버전에서는 전투 상태가 같으므로, 재생 완료 번호만 절대로
     뒤로 가지 않게 합친다. */
  function mergeNetworkMembers(currentRows, incomingRows) {
    const currentById = new Map((currentRows || []).map((row) => [
      String(row?.userId || row?.user_id || ''), row,
    ]));
    return (incomingRows || []).map((row) => {
      const id = String(row?.userId || row?.user_id || '');
      const previous = currentById.get(id);
      const playbackRound = Math.max(memberPlaybackRound(previous), memberPlaybackRound(row));
      const questionReadyRound = Math.max(memberQuestionReadyRound(previous), memberQuestionReadyRound(row));
      return {
        ...row,
        playbackRound,
        playback_round:playbackRound,
        questionReadyRound,
        question_ready_round:questionReadyRound,
      };
    });
  }

  /* ---------- 구간 해금 ---------- */

  const progressApi = () => global.YuksamRaidProgress;

  /* 지금 방이 도전 중인 구간 번호(1~7). 혼자 연습할 때는 1. */
  function currentFloorGroup() {
    const room = networkSession?.room;
    const raw = room?.floorGroup ?? room?.floor_group;
    const group = Math.max(1, Math.trunc(Number(raw) || 0));
    return progressApi()?.groupById(group) ? group : 1;
  }

  function currentStartFloor() {
    return progressApi()?.floorForGroup(currentFloorGroup()) || 1;
  }

  function currentGroupLabel() {
    return progressApi()?.labelFor(currentFloorGroup()) || '1–10층';
  }

  /* 복도 끝에 도착한 화면은 서버가 문제를 발급하기 전까지 잠깐 서버보다
     한 장면 앞선다. 이 정상적인 틈에 heartbeat의 travel 스냅샷을 그대로
     넣으면 battle이 travel로 되감겨 "몬스터가 나타났다!"에서 멈춘다. */
  function localEncounterAwaitingQuestion(session = networkSession) {
    if (!session || !active || session.room?.phase !== 'travel' || active.phase !== 'battle') return false;
    const localIndex = Math.max(0, Math.trunc(Number(active.snapshot()?.encounterIndex) || 0));
    const serverIndex = Math.max(0, Math.trunc(Number(session.room?.encounterIndex) || 0));
    return localIndex === serverIndex;
  }

  /* 파티 셋이 모두 이 구간을 열었는지. 한 명이라도 못 열었으면 이름을 돌려준다. */
  function partyUnlockState() {
    const P = progressApi();
    if (!P) return { ok:true, lockedNames:[] };
    return P.partyUnlockCheck(roomMembers(), currentFloorGroup());
  }

  /* 캔버스 하나에 캐릭터 한 명을 그린다. 대형 화면과 전투 화면이 함께 쓴다. */
  function raidSpriteState(member, overrides = {}) {
    return global.YuksamAvatarVisualSync?.spriteStateFor(member, overrides) || {
      ...overrides,
      equipment:member?.equipment,
      costume:member?.costume,
    };
  }

  function paintMember(canvas, member, scale = 1.5, spriteState = null) {
    if (!canvas || !member) return;
    const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    const draw = global.drawPlayerSprite;
    if (!ctx || typeof draw !== 'function') return;
    const moving = spriteState?.moving === true;
    try {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      /* 스프라이트는 기준점 아래로 발이 더 그려진다.
         0.78에 두면 발끝이 잘리므로 조금 더 위에서 시작한다. */
      draw(
        ctx,
        canvas.width / 2,
        canvas.height * 0.62,
        member.appearance || {},
        member.klass || 'warrior',
        raidSpriteState(member, { attack:Number(spriteState?.attack) || 0, moving }),
        scale,
        member.spec || null,
      );
      canvas.dataset.moving = moving ? 'true' : 'false';
      canvas.dataset.paintCount = String((Number(canvas.dataset.paintCount) || 0) + 1);
    } catch (_) { /* 그리기 실패가 진행을 막지 않게 한다 */ }
  }

  function paintAll(selector, lookup, scale, spriteState = null) {
    global.document.querySelectorAll(selector).forEach((canvas) => {
      const member = lookup(canvas.dataset.member);
      if (member) paintMember(canvas, member, scale, spriteState);
    });
  }

  function stopFormationAnimation() {
    formationAnimationToken += 1;
    if (formationAnimationFrame != null && typeof global.cancelAnimationFrame === 'function') {
      global.cancelAnimationFrame(formationAnimationFrame);
    }
    formationAnimationFrame = null;
  }

  /* 배치 화면은 게임 자체가 일시 정지되므로 월드 루프에 기대지 않고
     캔버스를 계속 다시 그려 세 캐릭터가 제자리걸음을 하게 한다. */
  function startFormationAnimation(memberById) {
    stopFormationAnimation();
    const token = formationAnimationToken;
    let lastPaintAt = 0;
    const frame = (now = Date.now()) => {
      const modalType = G()?.modalState?.type;
      if (token !== formationAnimationToken || (!active && !networkSession)
        || !['raidFormation', 'raidNetworkLobby'].includes(modalType)) {
        formationAnimationFrame = null;
        return;
      }
      if (now - lastPaintAt >= 40) {
        paintAll('.raid-face', memberById, 1.35, { moving:true });
        lastPaintAt = now;
      }
      if (typeof global.requestAnimationFrame === 'function') {
        formationAnimationFrame = global.requestAnimationFrame(frame);
      }
    };
    frame(global.performance?.now?.() || Date.now());
  }

  /* ---------- 문제 ---------- */

  function pickQuestion() {
    const selected = global.YuksamCombatRules?.selectEnabledQuestion?.(
      call('getWorkbooks') || [],
      call('getQuestions') || [],
      Math.random,
    );
    if (selected) return selected;
    return { q:'7 + 5 = ?', choices:['10', '11', '12', '13'], answer:'12' };
  }

  function pickDistinctQuestions(count) {
    const wanted = Math.max(1, Math.trunc(Number(count) || 1));
    const picked = [];
    const used = new Set();
    for (let attempt = 0; attempt < wanted * 20 && picked.length < wanted; attempt += 1) {
      const candidate = pickQuestion();
      const key = `${candidate?.id || ''}\u0000${candidate?.q || candidate?.prompt || candidate?.question || ''}`;
      if (!key.replace('\u0000', '') || used.has(key)) continue;
      used.add(key);
      picked.push(candidate);
    }
    if (picked.length < wanted) {
      throw new Error('던전에는 서로 다른 활성 문제 3개 이상이 필요합니다. 선생님이 문제집을 확인해 주세요.');
    }
    return picked;
  }

  /* ---------- 실제 3인 파티 방 ---------- */

  function setNetworkData(data, { initial = false } = {}) {
    if (!networkSession || !data) return;
    const incomingRoom = data.room || null;
    const currentVersion = Math.max(0, Number(networkSession.room?.version) || 0);
    const incomingVersion = Math.max(0, Number(incomingRoom?.version) || 0);
    /* 먼저 보낸 heartbeat가 늦게 돌아와 최신 publish 결과를 덮으면
       한 화면만 이전 체력·이전 단계로 돌아간다. 방 version이 낮은 응답은
       이벤트만 챙기고 상태 스냅샷으로는 절대 사용하지 않는다. */
    const staleSnapshot = !!incomingRoom && currentVersion > 0 && incomingVersion > 0
      && incomingVersion < currentVersion;
    if (!staleSnapshot && incomingRoom) networkSession.room = incomingRoom;
    if (!staleSnapshot && Array.isArray(data.members)) {
      networkSession.members = mergeNetworkMembers(networkSession.members, data.members);
    }
    if (!staleSnapshot && data.answerKeys && networkSession.room?.round) {
      networkSession.answerKeys = networkSession.answerKeys || {};
      networkSession.answerKeys[networkSession.room.round] = { ...data.answerKeys };
    }
    if (!staleSnapshot && data.completion && typeof data.completion === 'object') {
      networkSession.completion = data.completion;
    }
    if (networkSession.room?.question) {
      networkSession.lastQuestion = publicRaidQuestion(networkSession.room.question);
      question = networkSession.lastQuestion;
    }
    const events = Array.isArray(data.events) ? data.events : [];
    if (initial) {
      networkSession.lastSequence = events.reduce(
        (maximum, row) => Math.max(maximum, Number(row?.sequenceNo || row?.sequence_no) || 0),
        Number(networkSession.lastSequence) || 0,
      );
    } else {
      handleNetworkEvents(events);
    }
    if (!staleSnapshot) {
      networkSession.submissions = Array.isArray(data.submissions) ? data.submissions : [];
      if (data.submitted === true && networkSession.room?.round) {
        networkSession.submittedRounds = networkSession.submittedRounds || new Set();
        networkSession.submittedRounds.add(Math.max(1, Number(networkSession.room.round) || 1));
      }
      /* 결과 전송 응답을 잃어도 다음 sync에서 서버 반영을 확인하면
         보관해 둔 재시도 자료를 정리한다. */
      if (networkSession.room?.phase !== 'resolving' && networkSession.pendingRoundPublishes) {
        const serverRound = Math.max(0, Number(networkSession.room?.round) || 0);
        [...networkSession.pendingRoundPublishes.keys()]
          .filter((round) => round <= serverRound)
          .forEach((round) => networkSession.pendingRoundPublishes.delete(round));
      }
    }

    const phase = networkSession.room?.phase || 'lobby';
    if (phase !== 'lobby') cancelNetworkLobbyCountdown();

    /* 세 답이 모두 모인 뒤에는 더 이상 친구의 문제 풀이를 기다리는 단계가
       아니다. 서버가 결과를 확정하는 짧은 구간임을 정확히 안내한다. */
    if (active?.phase === 'battle' && phase === 'resolving'
      && !networkSession.playbackActive && !networkSession.playbackQueue?.length) {
      busy = true;
      panelMode = 'playing';
      panelMessage = networkQuestionWaitMessage();
      if (G()?.modalState?.type === 'raidBattle') renderBattle();
    }

    /* 보정 — 재생이 모두 끝난 조용한 순간에는 화면 값을 서버 값과 맞춘다.
       실시간 알림과 폴링이 겹쳐 로그 몇 줄을 놓치더라도, 다음 문제가 나오기
       전에 세 화면의 숫자가 반드시 같아진다. */
    const waitingForPlaybackBarrier = playbackBarrierNeeded(networkSession)
      && !allMembersFinishedPlayback(Number(networkSession.room?.round) || 0, networkSession);
    if (active && !networkSession.playbackActive && !networkSession.playbackQueue?.length
      && !waitingForPlaybackBarrier
      && !localEncounterAwaitingQuestion(networkSession)
      && ['question', 'waiting', 'travel', 'effects'].includes(phase)) {
      importNetworkTruth();
      syncViewToTruth();
      if (G()?.modalState?.type === 'raidBattle') updateBattleView();
    }

    /* 끝났는데 결과 화면이 안 뜨는 사람이 없게 한다.
       실제 사고: 둘은 '1–10층 돌파' 축하와 보상을 받았는데 한 명만 아무것도
       뜨지 않고 진행이 멈췄다. 재생이 밀리는 사이 완료 처리를 놓친 것이다.
       방이 끝났다고 말하면, 보여 줄 로그를 다 보여 준 뒤 반드시 마무리한다. */
    if (active?.phase === 'battle' && ['question', 'waiting'].includes(phase)) {
      startRaidQuestionTimer();
    } else if (raidQuestionTimerInterval) {
      updateRaidQuestionTimer();
      stopRaidQuestionTimer();
    }
    /* 세 화면이 함께 복도를 출발해도 백그라운드 탭의 RAF는 느릴 수 있다.
       서버가 이미 문제/판정 단계라면 느린 화면의 복도 연출을 취소하고
       현재 전투로 즉시 따라잡는다. */
    if (active?.phase === 'battle' && ['question', 'waiting', 'resolving'].includes(phase)
      && !networkSession.playbackActive && !networkSession.playbackQueue?.length
      && G()?.currentMap === MAP_KEY && G()?.modalState?.type !== 'raidBattle') {
      cancelTravelWatchdog();
      travelAnimationToken += 1;
      encounterMonster = null;
      encounterStartedAt = 0;
      walkProgress = 1;
      openBattleScreen({ resumed:true });
    }
    if (active?.phase === 'battle' && ['question', 'waiting'].includes(phase)) {
      reconcileNetworkQuestionRound();
    }
    if (phase === 'cancelled') {
      stopNetworkTransport();
      call('openModal', `
        <h2>던전 도전 종료</h2>
        <div class="panel-card">
          <p>파티원이 방을 나가 이번 도전이 종료되었습니다.</p>
          <div class="raid-actions"><button class="primary" id="raidCancelledDoneBtn">마을로 돌아가기</button></div>
        </div>
      `, { type:'raidResult', pause:true });
      const done = global.document.getElementById('raidCancelledDoneBtn');
      if (done) done.onclick = () => leaveNetworkRoom({ returnToTown:G()?.currentMap === MAP_KEY });
      return;
    }
    if (phase === 'lobby') {
      renderNetworkLobby();
      return;
    }
    if (!active && !networkStarting) beginNetworkRun();
    if (active && !networkSession.playbackActive && !networkSession.playbackQueue?.length
      && !localEncounterAwaitingQuestion(networkSession)
      && ['effects', 'travel', 'cleared', 'wiped'].includes(phase)) {
      continueAfterNetworkPlayback();
    }
    if (['question', 'waiting'].includes(phase)) maybeAutoSubmitDeadNetworkTurn();
    if (phase === 'resolving') maybeResolveNetworkRound();
  }

  async function refreshNetworkRoom() {
    if (!networkSession) return;
    if (networkRefreshPending) {
      /* 조회 중 도착한 realtime 알림을 버리지 않는다. 현재 조회가 끝나자마자
         한 번 더 읽어 새 phase와 이벤트를 가져온다. */
      networkRefreshAgain = true;
      return;
    }
    const session = networkSession;
    networkRefreshPending = true;
    do {
      networkRefreshAgain = false;
      try {
        const data = await session.client.sync(session.room.id, session.lastSequence || 0);
        if (networkSession !== session) return;
        setNetworkData(data);
      } catch (error) {
        if (networkSession === session && session.room?.phase === 'lobby') {
          renderNetworkLobby(error?.message || '방 정보를 다시 불러오는 중입니다.');
        }
      }
    } while (networkSession === session && networkRefreshAgain);
    if (networkSession === session) {
      networkRefreshPending = false;
    } else {
      networkRefreshPending = false;
      networkRefreshAgain = false;
    }
  }

  function stopNetworkTransport() {
    if (networkUnsubscribe) {
      try { networkUnsubscribe(); } catch (_) {}
      networkUnsubscribe = null;
    }
    if (networkHeartbeatTimer) {
      global.clearInterval(networkHeartbeatTimer);
      networkHeartbeatTimer = null;
    }
    if (raidQuestionReadyRetryTimer) {
      global.clearTimeout(raidQuestionReadyRetryTimer);
      raidQuestionReadyRetryTimer = null;
    }
  }

  function startNetworkTransport() {
    stopNetworkTransport();
    if (!networkSession) return;
    const session = networkSession;
    networkUnsubscribe = session.client.subscribe(session.room.id, () => refreshNetworkRoom(), refreshNetworkRoom);
    networkHeartbeatTimer = global.setInterval(async () => {
      if (networkSession !== session) return;
      try {
        const data = await session.client.heartbeat(session.room.id, session.lastSequence || 0);
        if (networkSession === session) setNetworkData(data);
      } catch (_) { /* 다음 heartbeat/sync에서 다시 이어진다. */ }
    }, 3000);
  }

  function resetNetworkSession() {
    stopNetworkTransport();
    cancelNetworkLobbyCountdown();
    stopRaidQuestionTimer();
    travelAnimationToken += 1;
    networkSession = null;
    networkRefreshPending = false;
    networkRefreshAgain = false;
    networkDraftPlacement = {};
    networkSelectedMemberId = null;
    networkStarting = false;
    finishedRunKey = '';   // 다음 판은 다시 결과 화면을 띄울 수 있어야 한다
  }

  function raidQuestionDeadlineMs() {
    const raw = networkSession?.room?.questionDeadline ?? networkSession?.room?.question_deadline;
    if (raw == null || raw === '') return 0;
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(String(raw));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function raidQuestionTimerActive() {
    const phase = networkSession?.room?.phase;
    return !!networkSession && active?.phase === 'battle'
      && ['question', 'waiting'].includes(phase) && raidQuestionDeadlineMs() > 0;
  }

  function updateRaidQuestionTimer() {
    const node = global.document.getElementById('raidQuestionTimer');
    if (!node) return;
    if (!raidQuestionTimerActive()) {
      node.hidden = true;
      node.classList?.remove('warning', 'danger');
      return;
    }
    const seconds = Math.max(0, Math.ceil((raidQuestionDeadlineMs() - Date.now()) / 1000));
    node.hidden = false;
    node.textContent = `⏱ ${seconds}초`;
    node.classList?.toggle('warning', seconds > 0 && seconds <= 10);
    node.classList?.toggle('danger', seconds <= 5);
  }

  function stopRaidQuestionTimer() {
    if (raidQuestionTimerInterval) global.clearInterval(raidQuestionTimerInterval);
    raidQuestionTimerInterval = null;
  }

  function startRaidQuestionTimer() {
    stopRaidQuestionTimer();
    updateRaidQuestionTimer();
    if (raidQuestionTimerActive()) {
      raidQuestionTimerInterval = global.setInterval(updateRaidQuestionTimer, 250);
    }
  }

  function scheduleQuestionReadyRefresh(session, round) {
    if (!session || networkSession !== session || raidQuestionReadyRetryTimer) return;
    raidQuestionReadyRetryTimer = global.setTimeout(() => {
      raidQuestionReadyRetryTimer = null;
      if (networkSession !== session) return;
      const sameRound = Math.max(0, Number(session.room?.round) || 0) === round;
      const waiting = ['question', 'waiting'].includes(session.room?.phase)
        && raidQuestionDeadlineMs() <= 0;
      if (sameRound && waiting) refreshNetworkRoom();
    }, 350);
  }

  /* 문제를 받았다는 것과 문제를 풀 수 있다는 것은 다르다. 세 브라우저가
     전투 화면을 실제로 만든 뒤 준비 확인을 보내고, 서버가 세 확인을 모두
     받은 시점부터만 공통 30초를 시작한다. */
  function acknowledgeNetworkQuestionReady(round) {
    const session = networkSession;
    const safeRound = Math.max(0, Math.trunc(Number(round) || 0));
    if (!session || safeRound < 1 || raidQuestionDeadlineMs() > 0
      || typeof session.client?.ackQuestionReady !== 'function') return;
    if (G()?.modalState?.type !== 'raidBattle' || session.playbackActive || session.playbackQueue?.length) return;

    const me = String(raidIdentity()?.userId || '');
    const mine = (session.members || []).find((row) => String(row?.userId || row?.user_id || '') === me);
    if (memberQuestionReadyRound(mine) >= safeRound) {
      scheduleQuestionReadyRefresh(session, safeRound);
      return;
    }

    session.ackingQuestionReadyRounds = session.ackingQuestionReadyRounds || new Set();
    if (session.ackingQuestionReadyRounds.has(safeRound)) return;
    session.ackingQuestionReadyRounds.add(safeRound);
    Promise.resolve(session.client.ackQuestionReady(session.room.id, safeRound, session.lastSequence || 0))
      .then((data) => {
        if (networkSession === session) setNetworkData(data);
      })
      .catch(() => {
        if (networkSession === session) scheduleQuestionReadyRefresh(session, safeRound);
      })
      .finally(() => {
        if (networkSession !== session) return;
        session.ackingQuestionReadyRounds.delete(safeRound);
        if (raidQuestionDeadlineMs() <= 0) scheduleQuestionReadyRefresh(session, safeRound);
      });
  }

  function networkQuestionGateDecision({ phase, round, hasQuestion, deadline, submitted, down } = {}) {
    if (!['question', 'waiting'].includes(phase) || !(Number(round) > 0) || !hasQuestion) return 'none';
    if (!(Number(deadline) > 0)) return 'server-wait';
    if (submitted) return 'submitted';
    if (down) return 'down';
    return 'open';
  }

  function networkQuestionWaitMessage({ submitted = false, down = false } = {}) {
    if (!submitted) return '서버 대기중…';
    const downNotice = down ? '쓰러져 있어 이번 전투에서는 행동하지 않습니다. ' : '';
    return `${downNotice}친구들의 문제 풀이를 기다리는 중…`;
  }

  /* wait/effects 화면에서 곧바로 question 스냅샷으로 건너뛰어도 입력 잠금이
     남지 않게 하는 단일 복구 지점이다. 이미 답을 보낸 라운드는 반대로 절대
     입력창을 다시 열지 않는다. */
  function reconcileNetworkQuestionRound() {
    const session = networkSession;
    const phase = session?.room?.phase;
    const round = Math.max(0, Math.trunc(Number(session?.room?.round) || 0));
    const publicQuestion = publicRaidQuestion(session?.room?.question || session?.lastQuestion);
    if (!session || !active || active.phase !== 'battle'
      || session.playbackActive || session.playbackQueue?.length) return false;

    question = publicQuestion;
    const submitted = session.submittedRounds?.has(round) === true
      || session.deadSubmittedRounds?.has(round) === true;
    const localMember = myActiveRaidMember();
    const down = !!localMember && localMember.hp <= 0;
    const gate = networkQuestionGateDecision({
      phase,
      round,
      hasQuestion:!!publicQuestion?.q,
      deadline:raidQuestionDeadlineMs(),
      submitted,
      down,
    });
    if (gate === 'none') return false;

    if (gate === 'server-wait') {
      busy = true;
      chosenAction = null;
      panelMode = 'playing';
      panelMessage = networkQuestionWaitMessage();
      if (G()?.modalState?.type === 'raidBattle') {
        renderBattle();
        acknowledgeNetworkQuestionReady(round);
      }
      return true;
    }

    if (raidQuestionReadyRetryTimer) {
      global.clearTimeout(raidQuestionReadyRetryTimer);
      raidQuestionReadyRetryTimer = null;
    }
    if (gate === 'submitted') {
      busy = true;
      panelMode = 'playing';
      panelMessage = networkQuestionWaitMessage({ submitted:true, down });
      if (G()?.modalState?.type === 'raidBattle') renderBattle();
      return true;
    }
    if (gate === 'down') {
      maybeAutoSubmitDeadNetworkTurn();
      return true;
    }

    session.questionUnlockedRounds = session.questionUnlockedRounds || new Set();
    if (!session.questionUnlockedRounds.has(round)) {
      session.questionUnlockedRounds.add(round);
      busy = false;
      chosenAction = null;
      panelMode = 'menu';
      panelMessage = '무엇을 할까?';
      if (G()?.modalState?.type === 'raidBattle') renderBattle();
    }
    return true;
  }

  async function leaveNetworkRoom({ returnToTown = false } = {}) {
    const session = networkSession;
    resetNetworkSession();
    if (session) {
      try { await session.client.leave(session.room.id); } catch (_) {}
    }
    active = null;
    question = null;
    busy = false;
    call('closeModal');
    if (returnToTown && G()?.currentMap === MAP_KEY) leaveDungeonMap();
  }

  async function openNetworkLobby(options = {}) {
    ensureStyles();
    const client = getRaidPartyClient();
    if (!client) {
      call('toast', '로그인한 학생 3명이 있어야 던전에 들어갈 수 있습니다.');
      return false;
    }

    call('openModal', `
      <h2>63빌딩 던전</h2>
      <div class="panel-card"><p class="raid-room-status">실시간 대기실에 연결하는 중…</p></div>
    `, { type:'raidNetworkLobby', pause:true });

    try {
      await global.flushLocalPlayerForPvpV1?.();
      const data = options.mode === 'join'
        ? await client.join({ code:String(options.code || '') })
        : await client.create({ floorGroup:Number(options.floorGroup) || 1 });
      if (!data?.room?.id) throw new Error('대기실 정보를 받지 못했습니다.');
      resetNetworkSession();
      networkSession = {
        client,
        room:data.room,
        members:Array.isArray(data.members) ? data.members : [],
        submissions:[],
        lastSequence:0,
        handledRounds:new Set(),
        resolvingRounds:new Set(),
        deadSubmittedRounds:new Set(),
        submittedRounds:new Set(),
        questionUnlockedRounds:new Set(),
        ackingQuestionReadyRounds:new Set(),
        pendingRoundPublishes:new Map(),
        ackingPlaybackRounds:new Set(),
        travelPlaybackKeys:new Set(),
        completion:null,
      };
      setNetworkData(data, { initial:true });
      startNetworkTransport();
      /* 새로 만든 방이 아니라 진행 중이던 방으로 돌아온 경우에는 반드시 알린다.
         모르면 "방을 만든 적도 없는데 왜 셋이 들어가 있지?"가 된다. */
      if (data.resumed) {
        call('toast', '진행 중이던 던전 방으로 돌아왔습니다. 새로 시작하려면 방에서 나가 주세요.');
      }
      return true;
    } catch (error) {
      call('openModal', `
        <h2>대기실 연결 실패</h2>
        <div class="panel-card">
          <p class="raid-error">${esc(error?.message || '던전 서버에 연결하지 못했습니다.')}</p>
          <div class="raid-actions"><button class="primary" id="raidEntryRetryBtn">입장 화면으로</button></div>
        </div>
      `, { type:'raidNetworkLobby', pause:true });
      const retry = global.document.getElementById('raidEntryRetryBtn');
      if (retry) retry.onclick = () => global.YuksamRaidEntryUi?.open?.();
      return false;
    }
  }

  function networkMemberCanvas(member) {
    return `<canvas class="raid-face" data-member="${esc(member.id)}" width="116" height="116"></canvas>`;
  }

  function networkPlacementFor(roster) {
    const ids = new Set(roster.map((member) => member.id));
    Object.keys(networkDraftPlacement).forEach((id) => { if (!ids.has(id)) delete networkDraftPlacement[id]; });
    roster.forEach((member) => {
      if (!Object.hasOwn(networkDraftPlacement, member.id)) networkDraftPlacement[member.id] = member.slot || null;
      if (member.slot) networkDraftPlacement[member.id] = member.slot;
    });
    return networkDraftPlacement;
  }

  function cancelNetworkLobbyCountdown() {
    if (networkLobbyCountdownTimer) global.clearTimeout(networkLobbyCountdownTimer);
    networkLobbyCountdownTimer = null;
    networkLobbyCountdownKey = '';
    networkLobbyCountdownValue = 0;
    networkLobbyStartPending = false;
  }

  function networkLobbyStillReady() {
    if (!networkSession || networkSession.room?.phase !== 'lobby') return false;
    const rows = (networkSession.members || []).filter((row) => row && row.active !== false);
    const slots = rows.map((row) => row.slot).filter(Boolean);
    return rows.length === 3
      && partyCompositionState(rows.map(roomMemberToCombatMember)).ok
      && rows.every((row) => row.ready === true)
      && slots.length === 3
      && new Set(slots).size === 3;
  }

  function playNetworkLobbyCountdownSound() {
    // 메뉴에서 이미 쓰는 짧은 확인음을 재사용해 매초 또렷하게 들려준다.
    call('playSfx', 'open');
  }

  async function startNetworkRoomAfterCountdown() {
    const session = networkSession;
    if (!session || !isNetworkHost() || networkLobbyStartPending || !networkLobbyStillReady()) return;
    networkLobbyStartPending = true;
    try {
      const data = await session.client.start(session.room.id);
      if (networkSession === session) setNetworkData(data);
    } catch (error) {
      if (networkSession !== session) return;
      cancelNetworkLobbyCountdown();
      renderNetworkLobby(error?.message || '던전을 시작하지 못했습니다. 다시 출발을 준비합니다.');
    }
  }

  function scheduleNetworkLobbyCountdown(key) {
    networkLobbyCountdownTimer = global.setTimeout(() => {
      networkLobbyCountdownTimer = null;
      if (networkLobbyCountdownKey !== key || !networkLobbyStillReady()) {
        cancelNetworkLobbyCountdown();
        if (networkSession?.room?.phase === 'lobby') renderNetworkLobby();
        return;
      }
      networkLobbyCountdownValue -= 1;
      if (networkLobbyCountdownValue > 0) {
        playNetworkLobbyCountdownSound();
        renderNetworkLobby();
        if (networkLobbyCountdownKey === key) scheduleNetworkLobbyCountdown(key);
        return;
      }
      networkLobbyCountdownValue = 0;
      renderNetworkLobby();
      // 세 화면 모두 같은 카운트다운을 보지만 서버 출발 요청은 방장만 한 번 보낸다.
      if (isNetworkHost()) startNetworkRoomAfterCountdown();
    }, COUNTDOWN_STEP_MS);
  }

  function syncNetworkLobbyCountdown(shouldRun) {
    if (!shouldRun) {
      if (networkLobbyCountdownKey || networkLobbyCountdownTimer) cancelNetworkLobbyCountdown();
      return 0;
    }
    const room = networkSession?.room || {};
    const key = `${room.id || ''}:${room.version || 0}:${room.updatedAt || room.updated_at || ''}`;
    if (networkLobbyCountdownKey === key) return networkLobbyCountdownValue;
    cancelNetworkLobbyCountdown();
    networkLobbyCountdownKey = key;
    networkLobbyCountdownValue = READY_COUNTDOWN;
    playNetworkLobbyCountdownSound();
    scheduleNetworkLobbyCountdown(key);
    return networkLobbyCountdownValue;
  }

  function networkHostCrown(member) {
    return String(member?.id || '') === String(networkSession?.room?.hostId || '')
      ? '<span class="raid-host-crown" title="방장" aria-label="방장">👑 방장</span>'
      : '';
  }

  function renderNetworkLobby(message = '') {
    if (!networkSession || networkSession.room?.phase !== 'lobby') return;
    ensureStyles();
    const R = rules();
    const roster = roomMembers();
    const placement = networkPlacementFor(roster);
    const me = String(raidIdentity()?.userId || '');
    const host = String(networkSession.room.hostId || '') === me;
    const memberById = (id) => roster.find((member) => member.id === id) || null;
    const rowById = (id) => (networkSession.members || []).find(
      (row) => String(row.userId || row.user_id || '') === String(id),
    );
    const inSlot = (slot) => roster.find((member) => placement[member.id] === slot) || null;
    const waiting = roster.filter((member) => !placement[member.id]);
    const seated = roster.length === 3 && R.SLOTS.every((slot) => !!inSlot(slot));
    const savedFormation = seated && roster.every((member) => rowById(member.id)?.slot === placement[member.id]);
    const allReady = roster.length === 3 && roster.every((member) => rowById(member.id)?.ready === true);
    const myReady = rowById(me)?.ready === true;
    const partyDiverse = partyCompositionState(roster).ok;
    /* 구간을 못 연 사람이 있으면 카운트다운도 시작하지 않는다. */
    const partyUnlocked = roster.length === 3 ? partyUnlockState().ok : false;
    const countdown = syncNetworkLobbyCountdown(savedFormation && allReady && partyUnlocked && partyDiverse);

    if (!networkSelectedMemberId || !memberById(networkSelectedMemberId)) {
      networkSelectedMemberId = roster[0]?.id || null;
    }

    const slotHtml = (slot) => {
      const member = inSlot(slot);
      const label = esc(R.slotLabel(slot));
      if (!member) return `
        <div class="raid-post empty" data-slot="${slot}">
          <div class="raid-post-title">${label}</div>
          ${host && roster.length === 3 ? `<button class="raid-plus" data-network-slot="${slot}">+</button>` : ''}
        </div>`;
      const ready = rowById(member.id)?.ready === true;
      /* 파란 테두리는 '나', 노란 점선은 방장이 배치하려고 고른 사람. */
      const marks = `${isMine(member) ? ' mine' : ''}`
        + `${host && networkSelectedMemberId === member.id ? ' picking' : ''}`;
      return `
        <div class="raid-post filled${marks} ${ready ? 'ready' : ''}">
          <div class="raid-post-title">${label}</div>
          <div class="raid-figure" ${host ? `data-network-pick="${esc(member.id)}"` : ''}>
            ${networkMemberCanvas(member)}
            <div class="raid-figure-name">${networkHostCrown(member)}${esc(member.name)}${isMine(member) ? ' (나)' : ''}</div>
            <div class="raid-figure-sub">Lv.${member.level} · ${esc(member.spec || '전문화 없음')} · HP ${member.maxHp}</div>
          </div>
          ${ready ? '<div class="raid-ready-badge">Ready!</div>' : ''}
        </div>`;
    };

    const waitingCards = waiting.map((member) => {
      const ready = rowById(member.id)?.ready === true;
      const marks = `${isMine(member) ? ' mine' : ''}`
        + `${host && networkSelectedMemberId === member.id ? ' picking' : ''}`;
      return `<div class="raid-bench-card${marks} ${ready ? 'ready' : ''}"
          ${host ? `data-network-pick="${esc(member.id)}"` : ''}>
        ${networkMemberCanvas(member)}
        <div class="raid-figure-name">${networkHostCrown(member)}${esc(member.name)}${isMine(member) ? ' (나)' : ''}</div>
        <div class="raid-figure-sub">Lv.${member.level} · ${esc(member.spec || '전문화 없음')} · HP ${member.maxHp}</div>
      </div>`;
    }).join('');
    const emptyWaiting = Array.from({ length:Math.max(0, 3 - roster.length) }, (_, index) => `
      <div class="raid-room-member empty">친구를 기다리는 중…<small>${roster.length + index + 1}/3 자리</small></div>
    `).join('');

    /* 셋이 다 모이면 이 구간을 모두 열었는지 먼저 알려 준다.
       한 명이라도 못 열었으면 출발 자체가 막히므로 미리 보여 줘야 한다. */
    const unlock = roster.length === 3 ? partyUnlockState() : { ok:true, lockedNames:[] };
    const status = message || (roster.length < 3
      ? `친구 ${3 - roster.length}명이 더 들어오면 대형을 정할 수 있어요.`
      : !partyDiverse
        ? PARTY_COMPOSITION_MESSAGE
        : !unlock.ok
        ? `${unlock.lockedNames.join(', ')} 님이 아직 ${currentGroupLabel()} 구간을 열지 못했습니다. 앞 구간을 먼저 깨야 해요.`
        : !savedFormation
          ? (host ? '캐릭터를 골라 앞·가운데·뒤에 한 명씩 배치해 주세요.' : '방장이 대형을 정하고 있어요.')
          : !allReady
            ? '대형이 정해졌습니다. 각자 준비를 눌러 주세요.'
            : (countdown > 0 ? `${countdown}초 후 자동으로 출발합니다!` : '던전으로 출발하는 중입니다…'));

    call('openModal', `
      <h2>${esc(currentGroupLabel())} 파티 대기실</h2>
      <div class="raid-room-head">
        <div class="raid-room-code"><span>초대 코드</span><strong>${esc(networkSession.room.code || '----')}</strong></div>
        <div class="raid-room-count">${roster.length} / 3명</div>
      </div>
      <div class="panel-card raid-formation">
        <div class="raid-posts">${[...R.SLOTS].reverse().map(slotHtml).join('')}</div>
        <div class="raid-bench-wrap">
          <div class="raid-bench-head"><span>대기 중</span></div>
          <div class="raid-bench">${waitingCards}${emptyWaiting || (!waiting.length ? '<div class="raid-bench-empty">모두 자리를 정했습니다!</div>' : '')}</div>
        </div>
        ${allReady && partyDiverse && unlock.ok ? `<div class="raid-countdown">${countdown > 0 ? `${countdown}초 후 출발!` : '출발!'}</div>` : ''}
        <p class="raid-room-status ${allReady && unlock.ok && partyDiverse ? 'good' : (roster.length < 3 || !unlock.ok || !partyDiverse ? 'warn' : '')}">${esc(status)}</p>
        <div class="raid-room-actions">
          ${host && roster.length === 3 && !savedFormation ? '<button class="primary" id="raidSaveFormationBtn" disabled>대형 확정</button>' : ''}
          ${savedFormation ? `<button class="primary" id="raidReadyBtn" ${partyDiverse ? '' : 'disabled'}>${partyDiverse ? (myReady ? '준비 취소' : '준비') : '준비 불가'}</button>` : ''}
          <button class="ghost" id="raidNetworkLeaveBtn">방 나가기</button>
        </div>
      </div>
    `, { type:'raidNetworkLobby', pause:true });

    paintAll('.raid-face', memberById, 1.28, { moving:true });
    startFormationAnimation(memberById);

    global.document.querySelectorAll('[data-network-pick]').forEach((node) => {
      node.onclick = () => { networkSelectedMemberId = node.dataset.networkPick; renderNetworkLobby(); };
    });
    global.document.querySelectorAll('[data-network-slot]').forEach((button) => {
      button.onclick = () => {
        const selected = memberById(networkSelectedMemberId);
        if (!host || !selected) return;
        const targetSlot = button.dataset.networkSlot;
        const occupant = inSlot(targetSlot);
        if (occupant && occupant.id !== selected.id) {
          networkDraftPlacement[occupant.id] = networkDraftPlacement[selected.id] || null;
        }
        networkDraftPlacement[selected.id] = targetSlot;
        (networkSession.members || []).forEach((row) => { row.ready = false; });
        renderNetworkLobby();
      };
    });
    const save = global.document.getElementById('raidSaveFormationBtn');
    if (save) {
      save.disabled = !seated;
      save.onclick = async () => {
        save.disabled = true;
        try {
          const data = await networkSession.client.setFormation(networkSession.room.id, { ...networkDraftPlacement });
          setNetworkData(data);
        } catch (error) { renderNetworkLobby(error?.message || '대형을 저장하지 못했습니다.'); }
      };
    }
    const ready = global.document.getElementById('raidReadyBtn');
    if (ready) ready.onclick = async () => {
      if (!partyCompositionState().ok) {
        renderNetworkLobby(PARTY_COMPOSITION_MESSAGE);
        return;
      }
      ready.disabled = true;
      try { setNetworkData(await networkSession.client.ready(networkSession.room.id, !myReady)); }
      catch (error) { renderNetworkLobby(error?.message || '준비 상태를 바꾸지 못했습니다.'); }
    };
    const leave = global.document.getElementById('raidNetworkLeaveBtn');
    if (leave) leave.onclick = () => leaveNetworkRoom();
  }

  function isNetworkHost() {
    return !!networkSession
      && String(networkSession.room?.hostId || '') === String(raidIdentity()?.userId || '');
  }

  /* 던전 기술 순서는 각 탭의 로컬 round가 아니라 서버 방의 round가 기준이다.
     서버 round 1은 진행 엔진의 첫 공격(인덱스 0)에 해당한다. */
  function networkPatternRound(snapshot = active?.snapshot?.()) {
    const room = networkSession?.room;
    if (!room) return Math.max(0, Number(snapshot?.round) || 0);
    if (['question', 'waiting', 'resolving'].includes(room.phase)) {
      return Math.max(0, Math.trunc(Number(room.round) || 0) - 1);
    }
    const saved = Number(room.monsterState?.raidRound);
    return Number.isFinite(saved) && saved >= 0
      ? Math.trunc(saved)
      : Math.max(0, Number(snapshot?.round) || 0);
  }

  function networkPatternSeed(snapshot = active?.snapshot?.()) {
    return String(networkSession?.room?.id || snapshot?.patternSeed || '');
  }

  function beginNetworkRun() {
    if (!networkSession || active || networkStarting) return;
    const members = roomMembers();
    if (members.length !== 3) {
      renderNetworkLobby('세 명의 캐릭터 정보를 모두 불러오지 못했습니다.');
      return;
    }
    /* 구간 해금 — 셋이 모두 열어야 들어간다. */
    const unlock = partyUnlockState();
    if (!unlock.ok) {
      renderNetworkLobby(`${unlock.lockedNames.join(', ')} 님이 아직 ${currentGroupLabel()} 구간을 열지 못했습니다.`);
      return;
    }
    networkStarting = true;
    try {
      /* 방 id를 기술 순서의 씨앗으로 쓴다. 셋이 같은 값을 넣으므로
         각자 계산해도 같은 순서가 나온다(다음 턴 예고가 어긋나지 않는다). */
      /* 같은 레벨에 두 마리가 있는 자리는 무작위로 하나를 뽑는다.
         여기서 뽑기를 각자 Math.random으로 하면 화면마다 다른 몬스터가
         나온다(실제 사고: 한 명은 빌딩 스톰프, 둘은 고장 난 전화기).
         방 id에서 만든 같은 난수로 뽑아 셋이 반드시 같은 목록을 쓴다. */
      const roomSeed = String(networkSession.room?.id || '');
      const R = rules();
      const encounterIds = typeof R.rollEncounters === 'function' && typeof R.seededRng === 'function'
        ? R.rollEncounters(currentStartFloor(), R.seededRng(`encounters|${roomSeed}`))
        : null;
      active = runApi().createRun({
        floor:currentStartFloor(),
        members,
        patternSeed:roomSeed,
        encounterIds,
      });
      const assignments = Object.fromEntries(members.map((member) => [member.id, member.slot]));
      const confirmed = active.confirmFormation(assignments);
      if (!confirmed.ok) throw new Error(confirmed.reason || '대형을 불러오지 못했습니다.');
      const roomPhase = networkSession.room?.phase || 'travel';
      if (['question', 'waiting', 'resolving', 'effects'].includes(roomPhase)) {
        /* 첫 라운드는 아직 서버에 몬스터 체력 스냅샷이 올라가기 전일 수
           있으므로 조우 번호로 기본 몬스터를 먼저 복원한다. */
        active.importSnapshot({
          phase:'travel',
          encounterIndex:Number(networkSession.room?.encounterIndex) || 0,
          members,
        });
        active.arriveAtEncounter();
      }
      /* 새로 출발한 방은 travel 상태지만, 새로고침 뒤 되찾은 방은 이미
         문제 풀이·판정·전투 연출 단계일 수 있다. 서버의 최신 전투 상태를
         먼저 넣어야 처음부터 다시 걷거나 체력이 되돌아가지 않는다. */
      importNetworkTruth();
      question = null;
      busy = false;
      walkProgress = 1;
      enterDungeonMap(() => {
        networkStarting = false;
        if (!active || networkSession?.room?.phase === 'cancelled') return;
        /* 새로고침으로 전투 결과 연출을 건너뛴 화면도 현재 라운드를
           확인했다고 서버에 알린 뒤 다른 두 화면과 같은 경계에서 이어 간다. */
        if (playbackBarrierNeeded()) {
          if (active.phase === 'battle') openBattleScreen({ resumed:true });
          continueAfterNetworkPlayback();
          return;
        }
        if (active.phase === 'travel') {
          playTravelScene();
          return;
        }
        if (active.phase === 'cleared' || active.phase === 'wiped') {
          finishRun();
          return;
        }
        openBattleScreen({ resumed:true });
      });
    } catch (error) {
      networkStarting = false;
      active = null;
      call('toast', error?.message || '던전을 시작하지 못했습니다.');
    }
  }

  function publicRaidQuestion(source) {
    if (!source) return null;
    return {
      id:String(source.id || `raid-${Date.now()}`),
      prompt:String(source.prompt || source.q || source.question || ''),
      q:String(source.q || source.prompt || source.question || ''),
      choices:Array.isArray(source.choices) ? source.choices.map(String) : null,
    };
  }

  function myActiveRaidMember() {
    const me = String(raidIdentity()?.userId || '');
    return active?.snapshot?.().members?.find((member) => String(member.id) === me) || null;
  }

  /* 쓰러진 학생에게 문제를 풀게 하거나 30초 제한시간을 기다리게 하지 않는다.
     서버의 라운드 완료 조건은 여전히 세 명 제출이므로 빈 답을 자동 제출하되,
     전투 판정과 화면에서는 오답이 아니라 '행동 불가'로 취급한다. */
  function maybeAutoSubmitDeadNetworkTurn() {
    const session = networkSession;
    const phase = session?.room?.phase;
    const round = Math.max(0, Number(session?.room?.round) || 0);
    const member = myActiveRaidMember();
    if (!session || !active || active.phase !== 'battle'
      || !['question', 'waiting'].includes(phase) || round < 1
      || raidQuestionDeadlineMs() <= 0 || !member || member.hp > 0) return false;

    busy = true;
    chosenAction = null;
    panelMode = 'playing';
    panelMessage = networkQuestionWaitMessage({ submitted:true, down:true });
    if (G()?.modalState?.type === 'raidBattle') renderBattle();

    session.deadSubmittedRounds = session.deadSubmittedRounds || new Set();
    if (session.deadSubmittedRounds.has(round)) return true;
    session.deadSubmittedRounds.add(round);

    Promise.resolve(session.client.submit(session.room.id, round, 'basic', ''))
      .then(() => session.client.sync(session.room.id, session.lastSequence || 0))
      .then((data) => { if (networkSession === session) setNetworkData(data); })
      .catch((error) => {
        if (networkSession !== session) return;
        session.deadSubmittedRounds.delete(round);
        panelMessage = error?.message || '쓰러진 턴을 넘기지 못했습니다. 다시 연결하는 중…';
        if (G()?.modalState?.type === 'raidBattle') renderBattle();
      });
    return true;
  }

  /* 서버로 보낼 문제 꾸러미를 미리 검사한다.
     문제가 없으면 사람이 읽을 수 있는 이유를, 멀쩡하면 null을 돌려준다.
     서버의 검사 조건(세 명 / 각자 몫의 문제·정답)과 같은 것을 본다. */
  function describeRoundPayloadProblem(members, questionByUser, answerByUser) {
    const ids = members.map((member) => String(member.id || ''));
    if (ids.some((id) => !id)) return '학생 정보를 읽지 못했습니다. 방을 다시 만들어 주세요.';
    if (new Set(ids).size !== ids.length) {
      return '같은 학생이 두 번 들어와 있습니다. 방을 다시 만들어 주세요.';
    }
    const noQuestion = ids.filter((id) => !String(questionByUser[id]?.prompt || '').trim());
    if (noQuestion.length) {
      const who = noQuestion
        .map((id) => members.find((member) => String(member.id) === id)?.name || '학생')
        .join(', ');
      return `${who} 몫의 문제를 만들지 못했습니다. 선생님이 문제집을 확인해 주세요.`;
    }
    const noAnswer = ids.filter((id) => !String(answerByUser[id] ?? '').trim());
    if (noAnswer.length) {
      const who = noAnswer
        .map((id) => members.find((member) => String(member.id) === id)?.name || '학생')
        .join(', ');
      return `${who} 몫의 문제에 정답이 비어 있습니다. 선생님이 문제집에서 정답을 채워 주세요.`;
    }
    return null;
  }

  async function beginNetworkRound() {
    const session = networkSession;
    if (!session || !isNetworkHost() || !active || active.phase !== 'battle') return;
    if (!['travel', 'effects'].includes(session.room?.phase)) return;
    if (session.beginningRound) return;
    session.beginningRound = true;
    try {
      const members = roomMembers();
      /* 서버는 세 명분의 문제를 한꺼번에 받아야 한다. 한 명이라도 빠지면
         "요청이 올바르지 않습니다"로 막히므로 여기서 먼저 이유를 알려 준다. */
      if (members.length !== 3) {
        session.beginningRound = false;
        panelMessage = '파티원 한 명의 접속이 끊겼습니다. 다시 연결되면 문제가 나옵니다…';
        if (G()?.modalState?.type === 'raidBattle') renderBattle();
        return;
      }
      const selected = pickDistinctQuestions(members.length);
      const questionByUser = Object.fromEntries(members.map((member, index) => [
        String(member.id), publicRaidQuestion(selected[index]),
      ]));
      const answerByUser = Object.fromEntries(members.map((member, index) => [
        String(member.id), String(selected[index]?.answer ?? ''),
      ]));

      /* 보내기 전에 서버와 같은 조건을 그대로 확인한다.
         서버가 거절하면 "요청이 올바르지 않습니다"만 뜨고 끝이라, 무엇이
         비었는지 여기서 먼저 집어 준다. 선생님이 바로 고칠 수 있어야 한다. */
      const problem = describeRoundPayloadProblem(members, questionByUser, answerByUser);
      if (problem) {
        session.beginningRound = false;
        busy = false;
        panelMode = 'playing';
        panelMessage = problem;
        renderBattle();
        return;
      }

      const nextRound = Math.max(1, Number(session.room.round) + 1);
      session.answerKeys = session.answerKeys || {};
      session.answerKeys[nextRound] = answerByUser;
      const data = await session.client.beginRound(
        session.room.id,
        { byUser:questionByUser },
        JSON.stringify(answerByUser),
      );
      if (networkSession === session) setNetworkData(data);
    } catch (error) {
      if (networkSession === session) {
        busy = false;
        panelMode = 'playing';
        panelMessage = error?.message || '문제를 불러오지 못했습니다. 다시 시도하는 중입니다.';
        renderBattle();
      }
    } finally {
      if (networkSession === session) session.beginningRound = false;
    }
  }

  function publishMemberStates(snapshot) {
    return Object.fromEntries((snapshot?.members || []).map((member) => [member.id, {
      hp:member.hp,
      maxHp:member.maxHp,
      shield:member.shield || 0,
      cooldowns:{ ...(member.cooldowns || {}) },
      statuses:{ ...(member.statuses || {}) },
      buffs:{ ...(member.buffs || {}) },
      chargeActive:member.chargeActive === true,
      bastionUsed:member.bastionUsed === true,
    }]));
  }

  const PLAYBACK_BARRIER_PHASES = new Set(['effects', 'travel', 'cleared', 'wiped']);

  function playbackBarrierNeeded(session = networkSession) {
    const round = Math.max(0, Number(session?.room?.round) || 0);
    return !!session && round > 0 && PLAYBACK_BARRIER_PHASES.has(session.room?.phase);
  }

  function allMembersFinishedPlayback(round, session = networkSession) {
    const members = (session?.members || []).filter((row) => row && row.active !== false);
    const terminal = ['cleared', 'wiped'].includes(session?.room?.phase);
    /* 진행 중에는 반드시 원래 파티 3명이 모두 끝내야 한다. 다만 최종 결과를
       본 한 명이 확인을 눌러 서버 방을 나가면 그 사람은 active 목록에서 빠진다.
       이미 끝난 방에서까지 계속 3명을 요구하면 남은 둘의 보상창이 동기화
       대기창으로 되돌아가므로, 종료 단계에서는 남아 있는 사람들만 기다린다. */
    const rosterReady = terminal ? members.length > 0 : members.length === 3;
    return rosterReady && members.every((row) => memberPlaybackRound(row) >= round);
  }

  function showPlaybackBarrierWait() {
    busy = true;
    panelMode = 'playing';
    panelMessage = '서버 대기중…';
    if (G()?.modalState?.type === 'raidBattle') {
      updateBattleView();
      return;
    }
    call('openModal', `
      <h2>서버 대기중</h2>
      <div class="panel-card"><p class="raid-room-status">서버 대기중…</p></div>
    `, { type:'raidSyncWait', pause:true });
  }

  function acknowledgeNetworkPlayback(round) {
    const session = networkSession;
    const safeRound = Math.max(0, Math.trunc(Number(round) || 0));
    if (!session || safeRound < 1 || typeof session.client?.ackPlayback !== 'function') return;
    const me = String(raidIdentity()?.userId || '');
    const mine = (session.members || []).find((row) => String(row?.userId || row?.user_id || '') === me);
    if (memberPlaybackRound(mine) >= safeRound) return;
    session.ackingPlaybackRounds = session.ackingPlaybackRounds || new Set();
    if (session.ackingPlaybackRounds.has(safeRound)) return;
    session.ackingPlaybackRounds.add(safeRound);
    Promise.resolve(session.client.ackPlayback(session.room.id, safeRound, session.lastSequence || 0))
      .then((data) => {
        if (networkSession === session) setNetworkData(data);
      })
      .catch(() => {
        /* 다음 realtime/heartbeat 때 다시 시도한다. 진행을 먼저 열지는 않는다. */
        if (networkSession === session) global.setTimeout(refreshNetworkRoom, 350);
      })
      .finally(() => {
        if (networkSession === session) session.ackingPlaybackRounds.delete(safeRound);
      });
  }

  /* 전투 결과를 다 본 세 화면이 같은 경계에서 다음 문제·복도로 넘어간다.
     크롬의 백그라운드 탭이 느려도 먼저 끝난 탭이 혼자 진행하지 않는다. */
  function continueAfterNetworkPlayback() {
    const session = networkSession;
    if (!session || !active || session.playbackActive || session.playbackQueue?.length) return false;
    const round = Math.max(0, Number(session.room?.round) || 0);
    if (playbackBarrierNeeded(session)) {
      acknowledgeNetworkPlayback(round);
      if (!allMembersFinishedPlayback(round, session)) {
        showPlaybackBarrierWait();
        return false;
      }
    }

    importNetworkTruth();
    syncViewToTruth();
    syncMyRaidCooldowns();
    if (['question', 'waiting'].includes(session.room?.phase) && session.room?.question) {
      reconcileNetworkQuestionRound();
      return true;
    }
    question = null;
    chosenAction = null;

    if (active.phase === 'cleared' || active.phase === 'wiped') {
      finishRun();
      return true;
    }
    if (active.phase === 'travel') {
      const travelKey = `${round}:${active.snapshot().encounterIndex}`;
      session.travelPlaybackKeys = session.travelPlaybackKeys || new Set();
      if (!session.travelPlaybackKeys.has(travelKey)) {
        session.travelPlaybackKeys.add(travelKey);
        playTravelScene();
      }
      return true;
    }

    const localMember = myActiveRaidMember();
    const down = !!localMember && localMember.hp <= 0;
    const preparing = ['travel', 'effects'].includes(session.room?.phase);
    busy = down || preparing;
    panelMode = busy ? 'playing' : 'menu';
    panelMessage = down
      ? '쓰러져 있어 이번 전투에서는 행동하지 않습니다. 서버 대기중…'
      : preparing ? '서버 대기중…' : '무엇을 할까?';
    renderBattle();
    /* 방장 캐릭터가 쓰러져도 남은 두 사람의 라운드는 방장이 열어야 한다. */
    if (isNetworkHost()) beginNetworkRound();
    return true;
  }

  async function maybeResolveNetworkRound() {
    const session = networkSession;
    const round = Math.max(1, Number(session?.room?.round) || 1);
    const hasPendingResult = !!session?.pendingRoundPublishes?.has(round);
    if (!session || !isNetworkHost() || !active || (!hasPendingResult && active.phase !== 'battle')) return;
    if (session.room?.phase !== 'resolving' || session.resolvingRounds.has(round)) return;
    const inputs = Array.isArray(session.submissions) ? session.submissions : [];
    if (inputs.length !== 3) return;
    session.resolvingRounds.add(round);

    try {
      session.pendingRoundPublishes = session.pendingRoundPublishes || new Map();
      let pending = session.pendingRoundPublishes.get(round);
      if (!pending) {
        /* resolveRound은 로컬 상태를 실제로 변경한다. 결과 전송이 끊겼다고
           다시 호출하면 방장 화면만 같은 공격을 두 번 계산한다. 최초 계산
           결과를 보관하고 이후에는 같은 자료와 같은 요청 번호만 재전송한다. */
        /* 로컬 round가 한 칸 밀렸더라도 방장이 서버 round의 기술을 계산한다. */
        active.importSnapshot({
          round:networkPatternRound(active.snapshot()),
          patternSeed:networkPatternSeed(active.snapshot()),
        });
        const downAtRoundStart = new Set(active.snapshot().members
          .filter((member) => member.hp <= 0)
          .map((member) => String(member.id)));
        const submissions = Object.fromEntries(inputs.map((entry) => [String(entry.userId), {
          correct:entry.correct === true,
          actionId:String(entry.actionId || 'basic'),
        }]));
        const teacherKill = Math.max(0, Number(
          session.room?.teacherKillRound ?? session.room?.teacher_kill_round,
        ) || 0) === round;
        const result = active.resolveRound(submissions, { forceMonsterDefeat:teacherKill });
        if (!result.ok) throw new Error(result.reason || '전투 판정을 완료하지 못했습니다.');
        const snapshot = active.snapshot();
        const answerEvents = teacherKill ? [] : inputs.map((entry) => {
          const skipped = downAtRoundStart.has(String(entry.userId));
          const storedAnswers = session.answerKeys?.[round];
          const correctAnswer = String(
            storedAnswers && typeof storedAnswers === 'object'
              ? storedAnswers[String(entry.userId)] ?? storedAnswers.default ?? ''
              : storedAnswers ?? '',
          );
          return {
            kind:'round-answer',
            memberId:String(entry.userId),
            correct:skipped || entry.correct === true,
            skipped,
            timedOut:skipped ? false : entry.timedOut === true,
            correctAnswer:skipped ? '' : correctAnswer,
            text:skipped
              ? '쓰러져 있어 이번 전투에서는 행동하지 않습니다.'
              : entry.correct === true
                ? '정답!'
                : `오답입니다! 정답은 ${correctAnswer || '확인 중'} (피해가 절반만 들어갑니다)`,
          };
        });
        const nextPhase = snapshot.phase === 'battle' ? 'effects' : snapshot.phase;
        const monsterState = snapshot.monster ? { ...snapshot.monster, raidRound:snapshot.round } : {};
        const currentFloor = snapshot.phase === 'battle'
          ? displayFloorForProgress(snapshot, 1)
          : encounterFloors()[Math.max(0, Math.min(3, snapshot.encounterIndex - 1))];
        pending = {
          requestId:`raid-publish-${session.room.id}-${round}`,
          result:{
            nextPhase,
            encounterIndex:snapshot.encounterIndex,
            currentFloor,
            monsterState,
            memberStates:publishMemberStates(snapshot),
            events:[...answerEvents, ...(result.events || [])],
          },
        };
        session.pendingRoundPublishes.set(round, pending);
      }
      const data = await session.client.publishRound(
        session.room.id,
        round,
        pending.result,
        pending.requestId,
      );
      if (networkSession === session) {
        session.pendingRoundPublishes.delete(round);
        setNetworkData(data);
      }
    } catch (error) {
      session.resolvingRounds.delete(round);
      panelMode = 'playing';
      panelMessage = error?.message || '전투 결과를 동기화하지 못했습니다. 다시 연결하는 중입니다.';
      if (active) renderBattle();
    }
  }

  /* 서버가 말하는 조우 번호의 몬스터 '정체'를 목록에서 그대로 가져온다.
     목록은 층마다 정해져 있어 세 화면이 언제나 같은 답을 얻는다. */
  function encounterDefAt(index) {
    const snap = active?.snapshot?.();
    const list = rules()?.floorEncounters?.(currentStartFloor(), snap?.encounterIds) || [];
    return list[Math.max(0, Math.min(list.length - 1, Math.trunc(Number(index) || 0)))] || null;
  }

  function importNetworkTruth() {
    if (!networkSession || !active || typeof active.importSnapshot !== 'function') return;
    const room = networkSession.room || {};
    const current = active.snapshot();
    const preserveLocalArrival = localEncounterAwaitingQuestion(networkSession);
    const phase = preserveLocalArrival ? current.phase
      : ['question', 'waiting', 'resolving', 'effects'].includes(room.phase)
      ? 'battle'
      : ['travel', 'cleared', 'wiped'].includes(room.phase) ? room.phase : current.phase;

    /* 몬스터의 정체는 반드시 '서버가 말하는 조우 번호'에서 정한다.
       예전에는 내 화면이 들고 있던 몬스터에 방장의 상태를 덮어썼다. 그래서
       내가 아직 못 잡았는데 방장은 다음 몬스터로 넘어간 순간, 이름은 옛
       몬스터인데 체력은 새 몬스터인 뒤섞인 몬스터가 만들어졌다.
       (종이비둘기가 죽은 모습으로 남거나, 복도에서 만난 몬스터와 전투 중인
       몬스터가 다른 사고가 여기서 났다.) */
    const serverIndex = Math.max(0, Math.trunc(Number(room.encounterIndex) || 0));
    const def = encounterDefAt(serverIndex);
    const state = room.monsterState && Object.keys(room.monsterState).length ? room.monsterState : null;
    const stateMatchesEncounter = !!def && !!state && String(state.id || '') === String(def.id);
    let monster;
    if (def) {
      /* 상태가 그 몬스터의 것일 때만 얹는다. 아니면 새 몬스터를 온전한
         체력으로 세운다 — 다음 조우가 시작된 것이기 때문이다. */
      monster = preserveLocalArrival ? current.monster
        : stateMatchesEncounter
        ? { ...def, ...state }
        : { ...def, hp:def.hp, maxHp:def.hp };
    } else {
      monster = state ? { ...(current.monster || {}), ...state } : current.monster;
    }

    active.importSnapshot({
      phase,
      encounterIndex:serverIndex,
      /* 죽은 이전 몬스터의 raidRound를 다음 몬스터에 넘기지 않는다. */
      round:preserveLocalArrival ? current.round
        : stateMatchesEncounter ? (Number(state?.raidRound) || 0) : 0,
      monster,
      members:roomMembers(),
    });
  }

  function handleNetworkEvents(rows) {
    if (!networkSession || !Array.isArray(rows) || !rows.length) return;
    const session = networkSession;
    const fresh = rows
      .filter((row) => (Number(row?.sequenceNo || row?.sequence_no) || 0) > (session.lastSequence || 0))
      .sort((a, b) => Number(a.sequenceNo || a.sequence_no) - Number(b.sequenceNo || b.sequence_no));
    if (!fresh.length) return;
    fresh.forEach((row) => {
      session.lastSequence = Math.max(session.lastSequence || 0, Number(row.sequenceNo || row.sequence_no) || 0);
    });
    if (session.room?.phase === 'cancelled') return;
    const grouped = new Map();
    fresh.forEach((row) => {
      const round = Math.max(0, Number(row.round || row.round_no) || 0);
      if (!grouped.has(round)) grouped.set(round, []);
      grouped.get(round).push(row.event || row);
    });
    /* 화면에 보이는 체력은 로그 한 줄씩 깎아 내려간다. 그 출발점은 반드시
       '이번 라운드가 시작되기 전' 값이어야 한다.
       그런데 아래 importNetworkTruth()는 방장이 올린 '라운드가 끝난 뒤' 값을
       바로 덮어쓴다. 재생이 시작되기 전에 화면이 한 번이라도 다시 그려지면
       출발점이 끝난 뒤 값으로 잡히고, 거기서 피해를 또 빼서 혼자만 체력이
       낮게 보였다. 그래서 덮어쓰기 전에 출발점을 붙잡아 둔다. */
    const queue = session.playbackQueue = session.playbackQueue || [];
    const idle = !session.playbackActive && !queue.length;
    const baseline = idle ? captureViewBaseline() : null;

    let first = true;
    grouped.forEach((events, round) => {
      if (round <= 0 || session.handledRounds.has(round)) return;
      session.handledRounds.add(round);
      queue.push({ round, events, baseline:first ? baseline : null });
      first = false;
    });
    /* 최종 서버 상태는 로그 재생이 모두 끝난 뒤에만 가져온다.
       여기서 먼저 다음 몬스터로 바꾸면, 이전 몬스터 사망 로그를 보여 주는
       동안 이름은 이전 몬스터인데 HP 기준은 다음 몬스터가 된다. */
    playNextNetworkRound();
  }

  /* 지금 화면에 보이는 값을 그대로 복사해 둔다(없으면 현재 진행 상태에서 만든다). */
  function captureViewBaseline() {
    if (!view) syncViewToTruth();
    if (!view) return null;
    return {
      monsterHp:view.monsterHp,
      monsterShield:view.monsterShield,
      members:{ ...(view.members || {}) },
      memberShields:{ ...(view.memberShields || {}) },
      memberStatuses:Object.fromEntries(Object.entries(view.memberStatuses || {})
        .map(([id, statuses]) => [id, { ...(statuses || {}) }])),
      memberBuffs:Object.fromEntries(Object.entries(view.memberBuffs || {})
        .map(([id, buffs]) => [id, { ...(buffs || {}) }])),
      monsterStatuses:{ ...(view.monsterStatuses || {}) },
    };
  }

  /* 밀린 라운드 수에 따라 로그 재생 속도를 정한다.
     밀리지 않았으면 원래 속도(학생이 읽을 시간), 밀렸으면 점점 빠르게. */
  const NORMAL_EVENT_MS = 1500;

  function setPlaybackPace(behindRounds) {
    if (logSpeedOverride !== null) return;   // 검사에서 지정한 속도는 건드리지 않는다
    if (behindRounds <= 0) { eventDelayMs = NORMAL_EVENT_MS; return; }
    eventDelayMs = behindRounds >= 2 ? 120 : 420;
  }

  function playNextNetworkRound() {
    const session = networkSession;
    if (!session || session.playbackActive || !active) return;
    const entry = session.playbackQueue?.shift();
    if (!entry) return;
    session.playbackActive = true;
    /* 붙잡아 둔 출발점이 있으면 거기서부터 깎기 시작한다.
       (이 줄이 없으면 방장이 올린 '끝난 뒤' 값에서 또 빼게 된다.) */
    if (entry.baseline) view = { ...entry.baseline };

    /* 따라잡기 — 재생할 라운드가 밀려 있으면 한 화면만 계속 뒤처져
       "혼자 아직 첫 몬스터를 잡고 있는" 상태가 된다. 밀린 만큼 빠르게
       넘겨 다음 문제 전에 반드시 세 화면이 같은 자리에 서게 한다. */
    const behindRounds = session.playbackQueue?.length || 0;
    setPlaybackPace(behindRounds);

    const me = String(raidIdentity()?.userId || '');
    const answerEvent = entry.events.find((event) => event.kind === 'round-answer' && String(event.memberId) === me);
    const combatEvents = entry.events.filter((event) => event.kind !== 'round-answer');
    const opening = answerEvent || { kind:'answer-correct', text:'모두 답을 제출했습니다!' };
    const startPlayback = () => {
      showPlaybackPanel('전투 중…');
      playEvents([opening, ...combatEvents], () => {
        if (networkSession !== session || !active) return;
        session.playbackActive = false;
        syncMyRaidCooldowns();
        question = null;
        chosenAction = null;
        acknowledgeNetworkPlayback(entry.round);
        /* 예전 연결에서 밀린 라운드가 남아 있다면 화면 전환보다 재생을
           먼저 끝낸다. 마지막 라운드 뒤에만 세 명 완료 장벽을 확인한다. */
        if (session.playbackQueue?.length) {
          busy = true;
          panelMode = 'playing';
          panelMessage = '서버 대기중…';
          updateBattleView();
          playNextNetworkRound();
          return;
        }
        continueAfterNetworkPlayback();
      }, { syncAtEnd:false });
    };

    if (answerEvent?.skipped !== true && answerEvent?.correct === false && answerEvent.correctAnswer
      && typeof global.YuksamWrongAnswerReview?.reveal === 'function') {
      question = { ...(publicRaidQuestion(session.lastQuestion) || {}), answer:answerEvent.correctAnswer };
      panelMode = 'question';
      renderBattle();
      const host = global.document.querySelector('.raid-combat .panel-card');
      if (host) {
        global.YuksamWrongAnswerReview.reveal({
          root:host,
          correctAnswer:answerEvent.correctAnswer,
          onComplete:startPlayback,
        });
        return;
      }
    }
    startPlayback();
  }

  async function submitNetworkAnswer(given) {
    const session = networkSession;
    if (!session || busy || !active || active.phase !== 'battle') return;
    const phase = session.room?.phase;
    const round = Math.max(0, Math.trunc(Number(session.room?.round) || 0));
    if (!['question', 'waiting'].includes(phase)) {
      panelMode = 'playing';
      panelMessage = '서버 대기중…';
      renderBattle();
      return;
    }
    if (raidQuestionDeadlineMs() <= 0) {
      reconcileNetworkQuestionRound();
      return;
    }
    busy = true;
    const actionId = chosenAction === 'attack'
      ? 'basic'
      : String(chosenAction || '').replace(/^active:/, '') || 'basic';
    session.submittedRounds = session.submittedRounds || new Set();
    session.submittedRounds.add(round);
    showPlaybackPanel(`답을 제출했습니다. ${networkQuestionWaitMessage({ submitted:true })}`);
    try {
      await session.client.submit(session.room.id, round, actionId, String(given ?? ''));
      const data = await session.client.sync(session.room.id, session.lastSequence || 0);
      if (networkSession === session) setNetworkData(data);
    } catch (error) {
      session.submittedRounds.delete(round);
      busy = false;
      panelMode = 'menu';
      panelMessage = error?.message || '답을 전송하지 못했습니다. 다시 시도해 주세요.';
      renderBattle();
    }
  }

  /* ---------- 화면 1: 대형 배치 ---------- */

  /* 대형 화면
     - 위: 앞줄 / 중간 / 뒷줄 세 칸. 비어 있으면 큰 + 로 표시된다.
     - 아래: 아직 자리를 못 잡은 캐릭터들이 서 있는 대기칸.
     캐릭터를 먼저 고른 뒤 옮기고 싶은 칸의 + 를 누르면 그리로 간다.
     이미 배치된 캐릭터도 다른 빈칸이나 대기칸으로 다시 보낼 수 있다. */

  /* ---------- 던전 맵 (화면 전체) ---------- */

  const MAP_KEY = 'raidTower';
  const LOADING_TAIL_MS = 820;   // 로딩 오버레이가 완전히 걷힐 때까지 기다리는 시간
  let walkStartedAt = 0;   // 이동 연출 시작 시각
  let walkProgress = 1;    // 0=출발 지점, 1=몬스터 앞
  let travelAnimationToken = 0;
  let travelWatchdogTimer = null;

  function cancelTravelWatchdog() {
    if (travelWatchdogTimer != null) global.clearTimeout(travelWatchdogTimer);
    travelWatchdogTimer = null;
  }
  let returnMap = 'town';
  let returnPos = null;

  function ensureDungeonMap() {
    const worlds = global.YuksamData && global.YuksamData.worldDefs;
    if (!worlds || worlds[MAP_KEY]) return worlds;
    worlds[MAP_KEY] = {
      key:MAP_KEY,
      label:'63빌딩 던전 1–10층',
      width:1280,
      height:720,
      playerSpawn:{ x:200, y:520 },
    };
    return worlds;
  }

  /* 한 구간의 네 조우 지점은 그 구간의 3·5·8·10번째 층이다.
     11–20층 구간이면 13·15·18·20층이 된다.
     이동 중에는 직전 조우층에서 다음 조우층까지 자연스럽게 숫자가 올라간다. */
  const ENCOUNTER_OFFSETS = Object.freeze([3, 5, 8, 10]);
  const ENCOUNTER_START_OFFSETS = Object.freeze([1, 3, 5, 8]);

  function encounterFloors() {
    const base = currentStartFloor() - 1;
    return ENCOUNTER_OFFSETS.map((offset) => base + offset);
  }

  function encounterStartFloors() {
    const base = currentStartFloor() - 1;
    return ENCOUNTER_START_OFFSETS.map((offset) => base + offset);
  }

  function displayFloorForProgress(snapshot, progress = 0) {
    const floors = encounterFloors();
    const starts = encounterStartFloors();
    const index = Math.max(0, Math.min(
      floors.length - 1,
      Math.floor(Number(snapshot?.encounterIndex) || 0),
    ));
    const start = starts[index];
    const target = floors[index];
    if (snapshot?.phase === 'battle') return target;
    const ratio = Math.max(0, Math.min(1, Number(progress) || 0));
    return Math.max(start, Math.min(target, Math.floor(start + (target - start) * ratio + 0.35)));
  }

  /* 던전 내부를 화면 가득 그린다. 마을이 아니라 완전히 다른 장소로 보이게 한다. */
  function drawDungeon() {
    const g = G();
    const ctx = g?.ctx;
    if (!ctx) return;
    const w = g.width;
    const h = g.height;
    const t = (global.performance ? performance.now() : Date.now()) / 1000;

    // 바닥과 벽
    const wall = ctx.createLinearGradient(0, 0, 0, h);
    wall.addColorStop(0, '#0b1220');
    wall.addColorStop(0.52, '#16233a');
    wall.addColorStop(0.53, '#1f2a3c');
    wall.addColorStop(1, '#0d1522');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, w, h);

    /* 파티는 화면 왼쪽에 서 있고, 배경이 오른쪽에서 왼쪽으로 흘러간다.
       그래야 "복도를 따라 실제로 나아간다"는 느낌이 난다.
       scroll은 지금까지 지나온 거리(픽셀)다. */
    const scroll = travelScroll();

    // 안쪽으로 뻗은 복도 (원근감) — 가로선은 고정, 세로선만 흘러간다
    ctx.strokeStyle = 'rgba(148,163,184,.16)';
    ctx.lineWidth = 2;
    for (let i = 1; i <= 7; i += 1) {
      const y = h * 0.53 + (h * 0.47) * (i / 7) * (i / 7);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    const tileW = w / 10;
    for (let i = -1; i <= 11; i += 1) {
      const x = i * tileW - (scroll % tileW);
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.lineTo(w / 2 + (x - w / 2) * 0.22, h * 0.53);
      ctx.stroke();
    }

    // 벽면 창문 — 바깥 도시의 불빛. 함께 흘러간다.
    const winGap = (w - 80) / 9;
    for (let i = -1; i < 11; i += 1) {
      const x = 40 + i * winGap - (scroll * 0.82) % winGap - (Math.floor((scroll * 0.82) / winGap) % 1);
      const seed = ((i + Math.floor((scroll * 0.82) / winGap)) % 7 + 7) % 7;
      const lit = seed < 3;
      ctx.fillStyle = lit
        ? `rgba(255,214,120,${(0.35 + 0.25 * Math.sin(t * 1.1 + seed)).toFixed(3)})`
        : 'rgba(120,150,190,.12)';
      ctx.fillRect(x, h * 0.16, 62, 108);
      ctx.strokeStyle = 'rgba(10,16,26,.7)';
      ctx.lineWidth = 3;
      ctx.strokeRect(x, h * 0.16, 62, 108);
    }

    // 천장 형광등 (깜빡임) — 역시 흘러간다
    const lampGap = w * 0.22;
    for (let i = -1; i < 6; i += 1) {
      const x = w * 0.18 + i * lampGap - (scroll * 0.9) % lampGap;
      const seed = ((i + Math.floor((scroll * 0.9) / lampGap)) % 4 + 4) % 4;
      const flick = seed === 2 ? (Math.sin(t * 14) > -0.2 ? 1 : 0.25) : 1;
      const lamp = ctx.createRadialGradient(x, 40, 0, x, 40, 190);
      lamp.addColorStop(0, `rgba(200,230,255,${(0.20 * flick).toFixed(3)})`);
      lamp.addColorStop(1, 'rgba(200,230,255,0)');
      ctx.fillStyle = lamp;
      ctx.beginPath();
      ctx.arc(x, 40, 190, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(226,240,255,${(0.75 * flick).toFixed(3)})`;
      ctx.fillRect(x - 46, 24, 92, 7);
    }

    // 층 표시 — 1~10층을 실제로 올라가는 진행감을 보여 준다.
    const snap = active ? active.snapshot() : null;
    ctx.save();
    ctx.textAlign = 'center';
    if (snap) {
      const floor = displayFloorForProgress(snap, walkProgress);
      ctx.font = '900 31px Jua, Noto Sans KR, system-ui';
      ctx.lineWidth = 7;
      ctx.strokeStyle = 'rgba(5,10,20,.86)';
      const prefix = '현재 ';
      const floorLabel = `${floor}층`;
      const fullLabel = `${prefix}${floorLabel}`;
      const startX = w / 2 - ctx.measureText(fullLabel).width / 2;
      ctx.textAlign = 'left';
      ctx.strokeText(fullLabel, startX, 72);
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(prefix, startX, 72);
      ctx.fillStyle = '#fb7185';
      ctx.fillText(floorLabel, startX + ctx.measureText(prefix).width, 72);
    }
    ctx.restore();

    drawParty();
    drawApproachingMonster();
    drawEncounterBanner();
  }

  /* 이동이 끝날 무렵 오른쪽 복도 끝에서 몬스터가 걸어 나온다. */
  function drawApproachingMonster() {
    const g = G();
    const ctx = g?.ctx;
    if (!ctx || !active || !encounterMonster) return;
    const p = encounterProgress();
    if (p <= 0) return;
    const w = g.width;
    const h = g.height;
    // 복도 끝(오른쪽 밖)에서 화면 안쪽으로 들어온다.
    const x = w * (1.06 - 0.24 * p);
    const y = h * 0.74;
    const scale = 0.55 + 0.45 * p;

    ctx.save();
    ctx.globalAlpha = Math.min(1, p * 1.6);
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.translate(-x, -y);
    const painter = MONSTER_PAINTERS[encounterMonster.id] || MONSTER_PAINTERS.guardBot;
    // 바닥 그림자
    ctx.fillStyle = 'rgba(4,10,18,.35)';
    ctx.beginPath();
    ctx.ellipse(x, y + 62, 46, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    try {
      painter(ctx, x, y, (global.performance ? performance.now() : Date.now()) / 1000, encounterMonster);
    } catch (_) { /* 그리기 실패가 진행을 막지 않게 한다 */ }
    ctx.restore();
  }

  /* "적 등장!" 경고 문구 */
  function drawEncounterBanner() {
    const g = G();
    const ctx = g?.ctx;
    if (!ctx || !encounterMonster) return;
    const p = encounterProgress();
    if (p < 0.35) return;
    const w = g.width;
    const h = g.height;
    const alpha = Math.min(1, (p - 0.35) / 0.25);
    const pulse = 1 + 0.06 * Math.sin((global.performance ? performance.now() : Date.now()) / 90);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.translate(w / 2, h * 0.34);
    ctx.scale(pulse, pulse);
    ctx.font = '900 46px Jua, Noto Sans KR, system-ui';
    ctx.lineWidth = 9;
    ctx.strokeStyle = 'rgba(8,12,20,.9)';
    ctx.strokeText('적 등장!', 0, 0);
    ctx.fillStyle = '#fb7185';
    ctx.fillText('적 등장!', 0, 0);
    ctx.font = '700 20px Noto Sans KR, system-ui';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(8,12,20,.9)';
    ctx.strokeText(encounterMonster.name, 0, 38);
    ctx.fillStyle = '#ffe6a3';
    ctx.fillText(encounterMonster.name, 0, 38);
    ctx.restore();
  }

  /* 월드 공용 펫 레이어는 던전 좌표를 모르므로, 복도에서는 주인 옆에 직접 그린다. */
  function drawRaidPet(ctx, ownerX, ownerY, moving, owner = null) {
    const petId = owner?.activePet || '';
    const pet = global.PET_DEFS_V27?.[petId];
    if (!pet) {
      if (!owner || isMine(owner)) raidPetAnchor = null;
      return;
    }

    // Wall-clock animation keeps the pet at the same relative frame in every browser.
    const now = Date.now();
    const x = ownerX - 46;
    const y = ownerY + 24 - (moving ? Math.abs(Math.sin(now / 120 + (pet.bob || 0))) * 8 : 0);
    if (!owner || isMine(owner)) raidPetAnchor = { x, y, ownerX, ownerY };

    ctx.save();
    ctx.fillStyle = 'rgba(4,10,18,.25)';
    ctx.beginPath();
    ctx.ellipse(x, ownerY + 47, 18, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    if (pet.id === 'yuksam' && typeof global.drawYuksamPetV35 === 'function') {
      global.drawYuksamPetV35(ctx, { x, y }, false, moving, pet, now);
      ctx.restore();
      return;
    }
    ctx.translate(x, y);
    ctx.rotate(Math.sin(now / 500 + (pet.bob || 0)) * 0.035);
    const bounce = 1 + Math.sin(now / 460 + (pet.bob || 0)) * 0.025;
    ctx.scale(bounce, bounce);
    ctx.font = `${pet.legendary ? 36 : 33}px Noto Sans KR, Apple Color Emoji, Segoe UI Emoji, system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(15,23,42,.55)';
    ctx.strokeText(pet.icon || '🐾', 0, 0);
    ctx.fillText(pet.icon || '🐾', 0, 0);
    if (pet.legendary) {
      ctx.globalAlpha = .82;
      ctx.strokeStyle = 'rgba(251,191,36,.68)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 25 + Math.sin(now / 240) * 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (moving) {
      ctx.fillStyle = pet.color || '#fde68a';
      ctx.globalAlpha = .72;
      ctx.beginPath(); ctx.ellipse(-8, 20, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(8, 20, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  /* 파티 세 명을 대형 순서대로 그린다. 이동 중이면 걸어가는 것처럼 옮겨 준다. */
  function drawParty() {
    const g = G();
    const ctx = g?.ctx;
    const draw = global.drawPlayerSprite;
    if (!ctx || !active || typeof draw !== 'function') return;
    const R = rules();
    const snap = active.snapshot();
    const w = g.width;
    const h = g.height;

    /* 파티는 화면 왼쪽에 서 있다(배경이 흘러가며 나아가는 느낌).
       조우 연출 동안에는 몬스터 쪽을 향해 조금 더 앞으로 나선다. */
    const moving = walkProgress < 1;
    const baseX = w * (0.20 + 0.06 * encounterProgress());
    const order = { front:0, middle:1, back:2 };

    const positioned = snap.members.map((member) => {
      const index = order[member.slot] ?? 1;
      // 앞줄이 가장 앞(오른쪽), 뒷줄이 뒤에 선다.
      const x = baseX - index * 62;
      const y = h * 0.80 + index * 10;
      return { member, index, x, y };
    });

    raidPetAnchor = null;
    positioned.forEach(({ member, x, y }) => drawRaidPet(ctx, x, y, moving, member));

    positioned.forEach(({ member, index, x, y }) => {
      const step = moving ? Math.abs(Math.sin((walkProgress * 9) + index)) * 6 : 0;
      ctx.save();
      ctx.globalAlpha = member.hp > 0 ? 1 : 0.35;
      try {
        draw(ctx, x, y - step, member.appearance || {}, member.klass || 'warrior',
          raidSpriteState(member, { attack:0, moving }), 1.5, member.spec || null);
      } catch (_) { /* 그리기 실패가 진행을 막지 않게 한다 */ }
      ctx.restore();

      /* 발과 그림자 아래에 이름표를 둔다. */
      drawNameTag(ctx, x, y + 58, member.name, member.hp > 0);
    });
  }

  function drawNameTag(ctx, x, y, name, alive) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '700 13px Noto Sans KR, system-ui';
    const w = ctx.measureText(name).width + 18;
    const h = 22;
    const r = 8;
    ctx.globalAlpha = alive ? 1 : 0.5;
    ctx.fillStyle = 'rgba(7,16,27,.78)';
    ctx.beginPath();
    ctx.moveTo(x - w / 2 + r, y);
    ctx.arcTo(x + w / 2, y, x + w / 2, y + h, r);
    ctx.arcTo(x + w / 2, y + h, x - w / 2, y + h, r);
    ctx.arcTo(x - w / 2, y + h, x - w / 2, y, r);
    ctx.arcTo(x - w / 2, y, x + w / 2, y, r);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = alive ? '#edf5ff' : '#94a3b8';
    ctx.fillText(name, x, y + 15);
    ctx.restore();
  }

  function enterDungeonMap(onReady) {
    const g = G();
    const worlds = ensureDungeonMap();
    if (!g || !worlds) { onReady?.(); return; }
    returnMap = g.currentMap || 'town';
    returnPos = g.player ? { x:g.player.x, y:g.player.y } : null;

    const move = () => {
      g.currentMap = MAP_KEY;
      if (g.player) {
        g.player.map = MAP_KEY;
        g.player.x = worlds[MAP_KEY].playerSpawn.x;
        g.player.y = worlds[MAP_KEY].playerSpawn.y;
      }
      call('updateHud');
      call('syncAudioFileBgm');   // 던전 음악으로 갈아탄다
      toggleReturnButton(true);   // 던전 안에서도 언제든 마을로 나갈 수 있게
    };

    if (typeof global.showLoadingTransition === 'function') {
      /* showLoadingTransition은 콜백이 끝난 뒤에도 modalState를 'loading'으로
         다시 덮어쓰고, 약 720ms 뒤에야 되돌린다. 그 안에서 창을 열면
         modalState가 지워지므로 로딩이 완전히 걷힌 뒤에 연다. */
      global.showLoadingTransition('63빌딩 던전으로 들어갑니다.', () => {
        move();
        global.setTimeout(() => onReady?.(), LOADING_TAIL_MS);
      });
    } else {
      move();
      onReady?.();
    }
  }

  function leaveDungeonMap() {
    const g = G();
    const worlds = global.YuksamData && global.YuksamData.worldDefs;
    if (!g || !worlds) return;
    const back = () => {
      g.currentMap = returnMap || 'town';
      if (g.player) {
        g.player.map = g.currentMap;
        const spawn = returnPos || worlds[g.currentMap]?.playerSpawn || { x:1200, y:1700 };
        g.player.x = spawn.x;
        g.player.y = spawn.y;
      }
      call('updateHud');
      call('savePlayer');
      call('syncAudioFileBgm');   // 마을 음악으로 되돌린다
      toggleReturnButton(false);
    };
    if (typeof global.showLoadingTransition === 'function') {
      global.showLoadingTransition('마을로 돌아갑니다.', back);
    } else {
      back();
    }
  }

  /* ---------- 화면 2: 이동 (던전 맵 위에서) ---------- */

  /* 걷는 시간과 조우 연출 시간.
     복도를 지나는 느낌이 나도록 넉넉히 잡는다. */
  let WALK_MS = 4200;          // 배경이 흘러가는 구간
  /* 조우 효과음은 부저가 세 번 울린다. 세 번째 부저까지 들은 뒤 전투가 시작되도록
     연출을 넉넉히 잡는다(예전에는 두 번째 부저에서 전투가 시작됐다). */
  let ENCOUNTER_MS = 3400;     // 몬스터가 나타나 "적 등장!"이 뜨는 구간
  const SCROLL_SPEED = 240;    // 초당 흘러가는 픽셀

  let encounterMonster = null;
  let encounterStartedAt = 0;

  /* 지금까지 흘러온 배경 거리(픽셀). */
  function travelScroll() {
    return walkProgress * (WALK_MS / 1000) * SCROLL_SPEED;
  }

  /* 조우 연출 진행도 0~1. */
  function encounterProgress() {
    if (!encounterMonster || !encounterStartedAt) return 0;
    const now = (global.performance ? performance.now() : Date.now());
    return Math.max(0, Math.min(1, (now - encounterStartedAt) / ENCOUNTER_MS));
  }

  function playTravelScene() {
    // 모달을 닫아 던전 맵이 화면을 가득 채우게 한다.
    stopFormationAnimation();
    stopRaidQuestionTimer();
    call('closeModal');
    walkStartedAt = (global.performance ? performance.now() : Date.now());
    walkProgress = 0;
    encounterMonster = null;
    encounterStartedAt = 0;
    cancelTravelWatchdog();
    const travelToken = ++travelAnimationToken;

    // 다음에 만날 몬스터를 미리 알아 둔다(등장 연출에 필요).
    const R = rules();
    const snap = active.snapshot();
    const upcoming = R.floorEncounters(snap.floor)[snap.encounterIndex] || null;

    /* 백그라운드 탭에서는 requestAnimationFrame이 멎을 수 있다. 그 탭이
       방장이면 서버 문제도 영원히 시작되지 않으므로 실제 경과시간 기준의
       안전 타이머로 반드시 다음 장면까지 보낸다. */
    travelWatchdogTimer = global.setTimeout(() => {
      if (!active || travelToken !== travelAnimationToken) return;
      walkProgress = 1;
      finishTravel(travelToken);
    }, WALK_MS + ENCOUNTER_MS + 600);

    const tick = () => {
      if (!active || travelToken !== travelAnimationToken) return;
      const now = (global.performance ? performance.now() : Date.now());
      walkProgress = Math.min(1, (now - walkStartedAt) / WALK_MS);

      // 걷기가 끝나면 몬스터가 복도 끝에서 나타난다.
      if (walkProgress >= 1 && !encounterStartedAt) {
        if (!upcoming) { finishTravel(travelToken); return; }
        encounterMonster = upcoming;
        encounterStartedAt = now;
        playEncounterSound();
      }

      if (encounterStartedAt && encounterProgress() >= 1) { finishTravel(travelToken); return; }

      if (global.requestAnimationFrame) global.requestAnimationFrame(tick);
      else global.setTimeout(tick, 32);
    };

    if (global.requestAnimationFrame) global.requestAnimationFrame(tick);
    else global.setTimeout(tick, 32);
  }

  function finishTravel(travelToken = travelAnimationToken) {
    if (!active || travelToken !== travelAnimationToken) return;
    cancelTravelWatchdog();
    travelAnimationToken += 1;
    encounterMonster = null;
    encounterStartedAt = 0;
    const arrival = active.arriveAtEncounter();
    if (!arrival.ok) {
      /* 다른 화면이 먼저 도착해 서버가 이미 문제 단계라면 남은 복도
         연출을 버리고 서버가 가리키는 전투 화면으로 따라간다. */
      if (networkSession && active.phase === 'battle') openBattleScreen({ resumed:true });
      return;
    }
    if (arrival.cleared) { finishRun(); return; }
    openBattleScreen();
  }

  /* 매니페스트에 등록된 소리를 낸다.
     실제 API 이름은 window.playMappedAudio 다(예전에 잘못된 이름을 써서 소리가 나지 않았다). */
  function playAsset(audioId, fallbackSfx) {
    if (!audioId) return false;
    if (typeof global.playMappedAudio === 'function') {
      try {
        if (global.playMappedAudio(audioId)) return true;
      } catch (_) { /* 아래로 */ }
    }
    if (fallbackSfx) call('playSfx', fallbackSfx);
    return false;
  }

  /* 몬스터를 만나는 순간의 효과음. */
  function playEncounterSound() {
    playAsset('dungeonEncounter', 'hit');
  }

  /* ---------- 화면 3: 전투 ---------- */

  function openBattleScreen(options = {}) {
    ensureStyles();
    question = null;          // 문제는 공격/스킬을 고른 뒤에 나온다
    chosenAction = null;
    syncViewToTruth();

    const monster = active.snapshot().monster;

    /* 브라우저를 새로 열어 진행 중인 방으로 돌아온 경우에는 적 등장부터
       다시 재생하지 않고 서버가 가리키는 현재 단계에서 곧바로 이어 간다. */
    if (options.resumed && networkSession) {
      const roomPhase = networkSession.room?.phase || 'question';
      question = publicRaidQuestion(networkSession.room?.question || networkSession.lastQuestion);
      const resolving = roomPhase === 'resolving';
      const preparing = roomPhase === 'effects' || !question?.q;
      const waitingForServer = ['question', 'waiting'].includes(roomPhase)
        && !!question?.q && raidQuestionDeadlineMs() <= 0;
      busy = resolving || preparing || waitingForServer;
      panelMode = busy ? 'playing' : 'menu';
      panelMessage = busy ? '서버 대기중…' : '무엇을 할까?';
      renderBattle();
      if (['question', 'waiting'].includes(roomPhase)) reconcileNetworkQuestionRound();
      else maybeAutoSubmitDeadNetworkTurn();
      if (isNetworkHost()) {
        if (resolving) global.setTimeout(() => maybeResolveNetworkRound(), 0);
        else if (preparing) global.setTimeout(() => beginNetworkRound(), 0);
      }
      return;
    }

    busy = true;              // 등장 문구를 보여 주는 동안에는 입력을 막는다
    panelMode = 'playing';
    panelMessage = monster?.isBoss
      ? `레이드 보스 ${monster.name}이(가) 나타났다!`
      : `${monster?.name || '적'}이(가) 나타났다!`;
    renderBattle();

    // 등장 문구를 한 박자 보여 준 뒤 행동 메뉴로 넘어간다.
    global.setTimeout(() => {
      if (!active || active.phase !== 'battle') return;
      const waitingForServer = !!networkSession
        && (!networkSession.room?.question || raidQuestionDeadlineMs() <= 0);
      busy = waitingForServer;
      panelMode = waitingForServer ? 'playing' : 'menu';
      panelMessage = waitingForServer ? '서버 대기중…' : '무엇을 할까?';
      renderBattle();
      if (networkSession && isNetworkHost()) beginNetworkRound();
      if (networkSession?.room?.question) reconcileNetworkQuestionRound();
    }, eventDelayMs);
  }

  /* 왼쪽에 세 명이 대형 순서대로 선다(앞줄이 가장 앞). */
  function partySpriteHtml(members) {
    const order = { front:0, middle:1, back:2 };
    return [...members]
      .sort((a, b) => {
        const aOrder = a.hp > 0 ? (order[a.slot] ?? 1) : 3 + (order[a.originalSlot || a.slot] ?? 1);
        const bOrder = b.hp > 0 ? (order[b.slot] ?? 1) : 3 + (order[b.originalSlot || b.slot] ?? 1);
        return aOrder - bOrder;
      })
      /* combat-idle / combat-idle-player 는 사냥터 전투가 쓰는 클래스다.
         이걸 붙여야 캐릭터가 가만히 있을 때도 살짝살짝 움직인다.
         체력바는 각자의 머리 위에 함께 붙인다. */
      .map((member, index) => `
        <div class="combat-sprite combat-idle combat-idle-player raid-ally-sprite raid-ally-${index} ${member.hp <= 0 ? 'down' : ''}">
          ${allyHpHtml(member)}
          <canvas class="raid-battle-face" data-member="${esc(member.id)}" width="132" height="172"></canvas>
        </div>`).join('');
  }

  function raidSlotClass(slot) {
    return ['front', 'middle', 'back'].includes(slot) ? `slot-${slot}` : 'slot-middle';
  }

  /* 사냥터와 같은 모양의 보호막 표시. 사냥터는 툴팁 없이 방패와 숫자만 쓴다. */
  function shieldBadgeHtml(amount) {
    const value = Math.max(0, Math.trunc(Number(amount) || 0));
    return value > 0 ? ` <span class="shield-badge">🛡 ${value}</span>` : '';
  }

  function statusBadgeHtml(badge) {
    return `<span tabindex="0" class="combat-badge-v38 ${esc(badge.key)}" data-tooltip="${esc(`${badge.label}\n${badge.tooltip}`)}">${esc(badge.label)}</span>`;
  }

  function commonStatusBadges(source) {
    const status = { ...(source || {}) };
    status.stunTurns = Math.max(0, Number(status.stunTurns || status.stun) || 0);
    status.chillTurns = Math.max(0, Number(status.chillTurns || status.chill) || 0);
    status.poisonTurns = Math.max(0, Number(status.poisonTurns || status.poison) || 0);
    const builder = global.YuksamCombatRules?.buildStatusBadges;
    if (typeof builder === 'function') return builder(status);
    const badges = [];
    if (status.poisonTurns > 0) badges.push({ key:'poison', label:`중독 ${status.poisonTurns}`, tooltip:`턴마다 독 피해를 받습니다. 남은 ${status.poisonTurns}턴` });
    if (status.stunTurns > 0) badges.push({ key:'stun', label:`기절 ${status.stunTurns}`, tooltip:`행동할 수 없습니다. 남은 ${status.stunTurns}턴` });
    if (status.chillTurns > 0) badges.push({ key:'chill', label:`냉기 ${status.chillTurns}`, tooltip:'다음 공격 데미지가 50% 감소합니다.' });
    if (Number(status.intBuffTurns) > 0) badges.push({ key:'intBuff', label:`환기 ${status.intBuffTurns}`, tooltip:`지능이 30% 증가합니다. 남은 ${status.intBuffTurns}턴` });
    return badges;
  }

  function raidMessageHtml(value) {
    const source = String(value == null ? '' : value);
    const snap = active?.snapshot?.();
    const entities = [];
    displayPartyMembers(snap?.members || [], view?.members || {}).forEach((member) => {
      const name = String(member?.name || '');
      if (name) entities.push({ name, cls:`raid-log-name ${raidSlotClass(member.slot)}` });
    });
    const monsterName = String(snap?.monster?.name || '');
    if (monsterName) entities.push({ name:monsterName, cls:'raid-log-name enemy' });
    entities.sort((a, b) => b.name.length - a.name.length);

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
        html += esc(source.slice(cursor));
        break;
      }
      html += esc(source.slice(cursor, match.index));
      html += `<span class="${match.entity.cls}">${esc(match.entity.name)}</span>`;
      cursor = match.index + match.entity.name.length;
    }
    if (!source.length) html = '';

    return html.replace(/HP\s*-\s*\d+|\d+\s*(?:의\s*)?(?:피해|데미지)|\d+\s*회복|보호막\s*[+-]?\s*\d+/g, (matched) => {
      const number = matched.match(/\d+/)?.[0] || '';
      const cls = /^HP\s*-/.test(matched)
        ? 'damage-number-v25-player'
        : /피해|데미지/.test(matched) ? 'damage-number-v25-enemy' : 'damage-number-v25-generic';
      return matched.replace(number, `<span class="${cls}">${number}</span>`);
    });
  }

  /* 캐릭터 머리 위에 붙는 체력창.
     차례와 마크업은 사냥터의 .combat-hpbox와 똑같이 맞춘다.
       이름 → HP 숫자(+보호막) → 상태 배지 → 체력바
     크기만 머리 위에 얹을 수 있게 줄인다. */
  function allyHpHtml(member) {
    const R = rules();
    const percent = Math.max(0, Math.round((member.hp / member.maxHp) * 100));
    return `
      <div class="combat-hpbox raid-ally-hp ${raidSlotClass(member.slot)} ${member.hp <= 0 ? 'down' : ''} ${isMine(member) ? 'me' : ''}"
           data-member="${esc(member.id)}">
        <b>${esc(member.name)}${isMine(member) ? ' (나)' : ''}<span class="raid-ally-slot">${esc(R.slotLabel(member.slot))}</span></b>
        <div class="raid-ally-num">HP ${member.hp}/${member.maxHp}${shieldBadgeHtml(member.shield)}</div>
        ${memberStatusHtml(member)}
        <div class="hpbar"><div class="hpfill" style="width:${percent}%"></div></div>
      </div>`;
  }

  function memberStatusHtml(member) {
    return `<div class="combat-badges-v38 raid-status-row" data-raid-status-member="${esc(member?.id || '')}">${memberStatusBadgesHtml(member)}</div>`;
  }

  function memberStatusBadgesHtml(member) {
    const buffs = member?.buffs || {};
    const badges = commonStatusBadges({
      ...(member?.statuses || {}),
      intBuffTurns:Math.max(0, Number(buffs.intBuffTurns) || 0),
    });
    /* 던전 몬스터의 실명 패턴 — 남은 횟수만큼 공격이 그냥 빗나간다. */
    const blind = Math.max(0, Number(member?.statuses?.blindHits) || 0);
    if (blind > 0) badges.push({ key:'blind', label:`실명 ${blind}`, tooltip:`다음 공격 ${blind}회가 50% 확률로 빗나갑니다.` });
    return badges.map(statusBadgeHtml).join('');
  }

  function monsterStatusHtml(monster) {
    return `<div id="raidMonsterStatuses" class="combat-badges-v38 raid-status-row">${
      monsterStatusBadgesHtml(monster)
    }</div>`;
  }

  function monsterStatusBadgesHtml(monster) {
    const badges = commonStatusBadges({
      ...(monster?.statuses || {}),
      stunTurns:Number(monster?.stunTurns || monster?.statuses?.stunTurns) || 0,
      chillTurns:Number(monster?.chillTurns || monster?.statuses?.chillTurns) || 0,
      poisonTurns:Number(monster?.poisonTurns || monster?.statuses?.poisonTurns) || 0,
    });
    const stunBadge = badges.find((badge) => badge.key === 'stun');
    if (stunBadge && monster?.stunSourceName) {
      stunBadge.tooltip = `${monster.stunSourceName} 특성으로 기절했습니다. 남은 ${Math.max(0, Number(monster.stunTurns) || 0)}턴`;
    }
    const shadow = Object.values(monster?.shadowBySource || {}).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
    if (shadow > 0) badges.push({ key:'shadow', label:`암흑 ${shadow}`, tooltip:'누적되는 지속 데미지로 턴이 끝날 때 피해를 줍니다.' });
    /* 시트 패턴이 남긴 몬스터 쪽 상태도 보여 준다. */
    const empower = Math.max(0, Number(monster?.empowerTurns) || 0);
    if (empower > 0) badges.push({ key:'empower', label:`강화 ${empower}`, tooltip:`공격력이 올라간 상태입니다. 남은 ${empower}턴` });
    if (monster?.counterMode) badges.push({
      key:'counter', label:'반격',
      tooltip:monster.counterMode === 'all'
        ? '때릴 때마다 50% 확률로 파티 전체가 반격을 받습니다.'
        : '때릴 때마다 50% 확률로 때린 사람이 반격을 받습니다.',
    });
    if (monster?.chargedPlanName) badges.push({
      key:'charge', label:'예고',
      tooltip:`다음 턴에 ${monster.chargedPlanName}을(를) 두 배 피해로 사용합니다.`,
    });
    return badges.map(statusBadgeHtml).join('');
  }

  /* ---------- 아래 패널: 일반 전투와 같은 3단계 ----------
     menu    : 공격 / 스킬 / 포기
     skills  : 배운 액티브 스킬 목록
     question: 문제 풀이 (공격 또는 스킬을 고른 뒤)
     playing : 결과 재생 중 */
  let panelMode = 'menu';
  let chosenAction = null;      // 'attack' 또는 'active:스킬id'
  let panelMessage = '무엇을 할까?';

  function learnedSkills() {
    const list = call('getLearnedActiveSkills') || [];
    return Array.isArray(list) ? list : [];
  }

  function myCombatMember() {
    return active?.snapshot?.().members?.find((member) => isMine(member)) || null;
  }

  function raidSkillCooldown(skillId) {
    const member = myCombatMember();
    if (member?.cooldowns) return Math.max(0, Number(member.cooldowns[skillId]) || 0);
    return Math.max(0, Number(call('getSkillCooldown', skillId)) || 0);
  }

  function panelHtml() {
    /* 사냥터 전투처럼 별도의 로그 상자를 두지 않는다.
       이 자리(h3)의 글이 바뀌면서 그 자체가 전투 기록이 된다. */
    if (panelMode === 'playing') {
      return `<h3>${raidMessageHtml(panelMessage)}</h3>`;
    }

    if (panelMode === 'skills') {
      const skills = learnedSkills();
      if (!skills.length) {
        return '<h3>아직 획득한 액티브 스킬이 없습니다.</h3>'
          + '<div class="combat-menu"><button class="ghost" data-raid-menu="back">뒤로</button></div>';
      }
      const buttons = skills.map((skill) => {
        const cd = raidSkillCooldown(skill.id);
        return `<button class="primary" ${cd > 0 ? 'disabled' : ''} data-raid-skill="${esc(skill.id)}">`
          + `${esc(skill.active?.name || skill.name || '스킬')}${cd > 0 ? ` · ${cd}턴` : ''}</button>`;
      }).join('');
      return '<h3>사용할 스킬을 선택하세요.</h3>'
        + `<div class="combat-menu">${buttons}<button class="ghost" data-raid-menu="back">뒤로</button></div>`;
    }

    if (panelMode === 'question') {
      const choices = Array.isArray(question?.choices) && question.choices.length === 4 ? question.choices : null;
      const answer = choices
        ? `<div class="choice-grid">${choices.map((choice, i) => `
            <button class="primary raid-choice" data-choice="${i}" data-answer-key="${encodeURIComponent(String(choice))}">${esc(choice)}</button>`).join('')}</div>`
        : `<div class="answer-row">
            <input id="combatAnswer" placeholder="정답 입력" autocomplete="off" />
            <button class="primary" id="raidSubmitBtn">정답 제출</button>
          </div>`;
      return `<h3>${esc(question?.q || question?.prompt || '')}</h3>${answer}`
        + '<div class="combat-menu"><button class="ghost" data-raid-menu="back">뒤로</button></div>';
    }

    // 기본 메뉴 — 일반 전투와 같은 구성(도망 자리에 포기)
    return `<h3>${raidMessageHtml(panelMessage)}</h3>
      <div class="combat-menu">
        <button class="primary" data-raid-menu="attack">공격</button>
        <button class="primary" data-raid-menu="skill">스킬</button>
        <button class="ghost" data-raid-menu="giveup">포기</button>
      </div>`;
  }

  function bindPanel() {
    global.document.querySelectorAll('[data-raid-menu]').forEach((button) => {
      button.onclick = () => {
        const what = button.dataset.raidMenu;
        if (what === 'attack') startAction('attack');
        else if (what === 'skill') { panelMode = 'skills'; renderBattle(); }
        else if (what === 'back') { panelMode = 'menu'; panelMessage = '무엇을 할까?'; renderBattle(); }
        else if (what === 'giveup') confirmGiveUp();
      };
    });
    global.document.querySelectorAll('[data-raid-skill]').forEach((button) => {
      button.onclick = () => startAction(`active:${button.dataset.raidSkill}`);
    });
    global.document.querySelectorAll('.raid-choice').forEach((button) => {
      button.onclick = () => submitAnswer(question.choices[Number(button.dataset.choice)]);
    });
    const submitBtn = global.document.getElementById('raidSubmitBtn');
    const input = global.document.getElementById('combatAnswer');
    if (submitBtn && input) {
      submitBtn.onclick = () => submitAnswer(input.value);
      input.onkeydown = (event) => { if (event.key === 'Enter') submitAnswer(input.value); };
      input.focus();
    }
  }

  /* 체력바와 캐릭터 DOM은 그대로 두고 아래 문제 영역만 전투 문구로 바꾼다.
     사냥터처럼 제출 즉시 입력칸과 버튼이 사라지면서도, 체력바 전환은 끊기지 않는다. */
  function showPlaybackPanel(message = '전투 중…') {
    panelMode = 'playing';
    panelMessage = message;
    const panel = global.document.querySelector('.raid-combat > .panel-card');
    if (panel) panel.innerHTML = `<h3>${raidMessageHtml(message)}</h3>`;
  }

  /* 공격이나 스킬을 고르면 문제가 나온다(일반 전투와 같은 흐름). */
  function startAction(action) {
    if (String(action).startsWith('active:')) {
      const skillId = String(action).slice(7);
      const cooldown = raidSkillCooldown(skillId);
      if (cooldown > 0) {
        panelMode = 'skills';
        panelMessage = `아직 ${cooldown}턴 남았습니다.`;
        renderBattle();
        return;
      }
    }
    chosenAction = action;
    if (networkSession) {
      question = publicRaidQuestion(networkSession.room?.question || networkSession.lastQuestion);
      const round = Math.max(0, Math.trunc(Number(networkSession.room?.round) || 0));
      if (!question?.q || raidQuestionDeadlineMs() <= 0
        || networkSession.submittedRounds?.has(round)) {
        panelMode = 'playing';
        panelMessage = '서버 대기중…';
        renderBattle();
        if (isNetworkHost()) beginNetworkRound();
        return;
      }
    } else {
      question = question || pickQuestion();
    }
    panelMode = 'question';
    renderBattle();
  }

  /* 던전에서도 스킬 쿨타임이 실제로 돌아야 한다.
     사냥터 전투가 쓰는 쿨타임 장부를 그대로 쓴다. */
  function spendSkillCooldown() {
    if (!chosenAction || chosenAction === 'attack') return;
    const skillId = String(chosenAction).slice(7);
    const defs = global.SKILL_DEFS || global.YuksamData?.SKILL_DEFS || {};
    const cooldown = Number(defs[skillId]?.active?.cooldown) || 0;
    if (cooldown > 0) call('setSkillCooldown', skillId, cooldown);
  }

  /* 라운드가 끝날 때마다 쿨타임을 한 턴씩 깎는다. */
  function tickSkillCooldowns() {
    call('tickSkillCooldowns');
  }

  function syncMyRaidCooldowns() {
    const member = myCombatMember();
    const player = G()?.player;
    if (!member || !player) return;
    player.skillCooldowns = { ...(member.cooldowns || {}) };
  }

  /* 화면에 보여 줄 체력. 로그가 한 줄씩 재생되는 동안 이 값이 조금씩 따라간다.
     (진행 엔진은 라운드를 한 번에 계산하지만, 화면은 사냥터 전투처럼
      "때릴 때마다 체력바가 쭉 빠지는" 모습을 보여야 한다.) */
  let view = null;

  function syncViewToTruth() {
    const snap = active?.snapshot();
    if (!snap?.monster) { view = null; return; }
    view = {
      monsterHp: snap.monster.hp,
      monsterShield:Math.max(0, Number(snap.monster.shield) || 0),
      members: Object.fromEntries(snap.members.map((m) => [m.id, m.hp])),
      memberShields:Object.fromEntries(snap.members.map((m) => [m.id, Math.max(0, Number(m.shield) || 0)])),
      memberStatuses:Object.fromEntries(snap.members.map((m) => [m.id, { ...(m.statuses || {}) }])),
      memberBuffs:Object.fromEntries(snap.members.map((m) => [m.id, { ...(m.buffs || {}) }])),
      /* 몬스터 상태는 체력처럼 '표시용'을 따로 둔다.
         기절은 걸린 그 라운드 안에서 몬스터 턴에 바로 소모되기 때문에,
         최종 상태만 보면 배지가 한 번도 보이지 않는다. 사냥터에서는
         내 턴과 몬스터 턴이 따로 그려져 그 사이에 보이는 것이다. */
      monsterStatuses:{
        stunTurns:Math.max(0, Number(snap.monster.stunTurns) || 0),
        chillTurns:Math.max(0, Number(snap.monster.chillTurns) || 0),
        stunSourceName:String(snap.monster.stunSourceName || ''),
      },
    };
  }

  /* 다음 턴에 무엇이 오는지 한 줄로 알려 준다.
     패턴이 정해져 있으니 학생이 미리 자리를 바꾸거나 보호막을 준비할 수 있다. */
  const SLOT_WORD = { front:'앞', middle:'가운데', back:'뒤' };

  function displayPartyMembers(members, hpById = null) {
    const source = (Array.isArray(members) ? members : []).map((member) => ({
      ...member,
      originalSlot:member.originalSlot || member.slot,
      hp:Math.max(0, hpById?.[member.id] ?? member.hp),
    }));
    const R = rules();
    const order = { front:0, middle:1, back:2 };
    const slots = ['front', 'middle', 'back'];
    const alive = source.filter((member) => member.hp > 0)
      .sort((a, b) => (order[a.slot] ?? 1) - (order[b.slot] ?? 1));
    return source.map((member) => ({
      ...member,
      slot:member.hp > 0 && typeof R.effectiveSlot === 'function'
        ? R.effectiveSlot(source, member)
        : member.hp > 0 ? (slots[alive.findIndex((entry) => String(entry.id) === String(member.id))] || member.slot)
        : member.slot,
    }));
  }

  /* 예고 문구의 기술 이름은 패턴 종류와 관계없이 반드시 이 공통 경로를 거친다.
     예전에는 전체 공격/상태이상만 warn 클래스가 붙어 노란색이고,
     점액 방패나 야근의 손길 같은 지원·단일 기술은 회색으로 보였다. */
  function namedNextPlanHint(technique, suffix, { prefix = '다음은 ', warn = false } = {}) {
    const safeTechnique = String(technique || '공격');
    const safePrefix = String(prefix || '');
    const safeSuffix = String(suffix || '');
    return {
      warn,
      prefix:safePrefix,
      technique:safeTechnique,
      suffix:safeSuffix,
      text:`${safePrefix}${safeTechnique}${safeSuffix}`,
    };
  }

  function nextPlanHintHtml(hint) {
    if (!hint?.technique) return esc(hint?.text || '');
    return `${esc(hint.prefix)}<strong class="raid-next-technique">${esc(hint.technique)}</strong>${esc(hint.suffix)}`;
  }

  function nextPlanHint(monster, plan) {
    /* 기절한 몬스터는 다음 턴을 통째로 건너뛴다. 예정돼 있던 기술도 취소되고
       그 다음 턴에는 새로 뽑는다. 그러니 기술 이름을 보여 주면 거짓말이 된다. */
    const stun = Math.max(0, Number(monster?.stunTurns) || 0);
    if (stun > 0) {
      return { warn:false, text:`기절 ${stun}턴 — 다음 턴은 쉽니다` };
    }
    if (monster?.chargedPlanName) {
      return namedNextPlanHint(monster.chargedPlanName, ' — 두 배 피해!', {
        prefix:'⚠ 다음은 ', warn:true,
      });
    }
    const name = plan?.name && plan.name !== '공격' ? plan.name : null;
    const extras = [];
    if (plan?.stun) extras.push('기절');
    if (plan?.poison > 0) extras.push('독');
    if (plan?.chill) extras.push('냉기');
    if (plan?.drain) extras.push('흡혈');
    if (plan?.blind > 0) extras.push('실명');
    const tail = extras.length ? ` (${extras.join('·')})` : '';

    if (plan?.kind === 'none') {
      const support = plan.shieldPct > 0 ? '보호막'
        : plan.healPct > 0 ? '회복'
        : plan.empower > 0 ? '공격력 강화'
        : plan.counter ? '반격 자세'
        : plan.chargeNext ? '기술 예고'
        : '숨 고르기';
      return namedNextPlanHint(name || support, ` — ${support}`);
    }
    if (plan?.kind === 'all') {
      const hits = plan.hits > 1 ? `${plan.hits}연속 ` : '';
      return namedNextPlanHint(name || `${hits}전체 공격`, name ? ` — ${hits}전체 공격!${tail}` : `!${tail}`, {
        prefix:'⚠ 다음은 ', warn:true,
      });
    }
    const where = SLOT_WORD[plan?.target] || '앞';
    const hits = plan?.hits > 1 ? `${plan.hits}연속 ` : '';
    const aim = plan?.target === 'random' ? '무작위 한 명' : `${where}자리`;
    return namedNextPlanHint(name || `${hits}${aim}`, name ? ` — ${hits}${aim}${tail}` : tail, {
      warn:!!tail,
    });
  }

  function renderBattle() {
    const snap = active.snapshot();
    const truth = snap.monster;
    if (!truth) return;
    if (!view) syncViewToTruth();

    // 표시용 체력을 입혀 놓은 사본으로 그린다.
    const monster = {
      ...truth,
      hp:Math.max(0, view?.monsterHp ?? truth.hp),
      shield:Math.max(0, view?.monsterShield ?? truth.shield ?? 0),
    };
    const members = displayPartyMembers(snap.members.map((m) => ({
      ...m,
      hp: Math.max(0, view?.members?.[m.id] ?? m.hp),
      shield:Math.max(0, view?.memberShields?.[m.id] ?? m.shield ?? 0),
      statuses:{ ...(view?.memberStatuses?.[m.id] || m.statuses || {}) },
      buffs:{ ...(view?.memberBuffs?.[m.id] || m.buffs || {}) },
    })));
    const percent = Math.max(0, Math.round((monster.hp / monster.maxHp) * 100));
    const nextPlan = rules().attackPlanForRound(
      truth,
      networkPatternRound(snap),
      networkPatternSeed(snap),
    );
    const nextKind = nextPlan.kind;
    const nextHint = nextPlanHint(truth, nextPlan);

    // 일반 전투와 같은 무대(combat-stage)를 쓰되 왼쪽에 세 명이 선다.
    call('openModal', `
      <h2>전투</h2>
      <div class="combat-layout raid-combat">
        <div class="combat-stage raid-stage">
          <div id="raidQuestionTimer" class="raid-question-timer" hidden></div>
          <!-- 사냥터 몬스터 체력창과 같은 차례: 이름 → HP 숫자 → 상태 배지 → 체력바 -->
          <div class="combat-hpbox monster">
            <b>${monster.isBoss ? '👑 ' : ''}Lv.${monster.level} ${esc(monster.name)}</b>
            <div class="raid-hp-text">HP ${monster.hp}/${monster.maxHp}${shieldBadgeHtml(monster.shield)}</div>
            ${monsterStatusHtml(monster)}
            <div class="hpbar"><div class="hpfill" style="width:${percent}%"></div></div>
            <div class="raid-next-hint ${nextHint.warn ? 'warn' : ''}">
              ${nextPlanHintHtml(nextHint)}
            </div>
          </div>
          ${partySpriteHtml(members)}
          <div class="combat-sprite combat-idle combat-idle-monster combat-monster raid-monster-sprite ${monster.isBoss ? 'boss' : ''}">
            <canvas id="raidMonsterCanvas" width="230" height="210"></canvas>
          </div>
          <div id="raidFloatLayer" class="raid-float-layer"></div>
        </div>
        <div class="panel-card">${panelHtml()}</div>
      </div>
    `, { type:'raidBattle', pause:true });

    paintAll('.raid-battle-face', (id) => members.find((m) => m.id === id), 1.4);
    drawMonsterModel(global.document.getElementById('raidMonsterCanvas'), monster);
    bindPanel();
    startRaidQuestionTimer();
  }

  /* 소리는 게임의 오디오 목록을 그대로 쓴다. 없으면 조용히 넘어간다. */
  function playEventSound(event) {
    if (!event) return;

    /* 치명타 소리는 누가 터뜨렸든 반드시 난다.
       예전에는 아군 치명타는 스킬 소리에 가려 아예 안 났고, 몬스터 치명타도
       'critical' 음원이 없으면 그냥 평타 소리로 떨어졌다.
       playSfx('critical')은 사냥터와 같은 전용 경로라 화면 번쩍임까지 함께 온다. */
    if (event.critical === true && event.missed !== true) {
      call('playSfx', 'critical');
    }

    if (event.audioId) {
      /* 치명타 소리를 이미 냈으면 같은 소리를 두 번 겹치지 않는다. */
      if (event.audioId !== 'critical') {
        playAsset(event.audioId, event.audioId === 'miss' ? 'miss' : 'hit');
      }
      return;
    }
    if (event.kind === 'party-hit') call('playSfx', 'hit');
    else if (event.kind === 'monster-hit') call('playSfx', 'hit');
    else if (event.kind === 'party-heal') call('playSfx', 'heal');
    else if (event.kind === 'party-shield') call('playSfx', 'open');
    else if (event.kind === 'party-buff') call('playSfx', 'heal');
    else if (event.kind === 'member-revive') call('playSfx', 'quest');
    /* 사망음은 낮고 조용한 합성음이라 던전 음악에 묻힌다.
       선생님이 음원을 등록해 두었으면 그것을 먼저 쓰고, 없으면 합성음으로. */
    else if (event.kind === 'member-down') playAsset('defeat', 'defeat');
    else if (['monster-dot', 'party-retaliation'].includes(event.kind)) call('playSfx', 'hit');
    else if (['member-dot', 'monster-counter'].includes(event.kind)) call('playSfx', 'hit');
    else if (['monster-heal', 'monster-shield', 'monster-buff'].includes(event.kind)) call('playSfx', 'open');
    else if (['monster-blind', 'monster-counter-stance', 'monster-charge'].includes(event.kind)) call('playSfx', 'open');
    else if (event.kind === 'monster-down') call('playSfx', 'quest');
  }

  /* 일반 전투처럼 피해 숫자를 대상 위에 띄우고 맞은 쪽을 흔든다.
     학생이 자기 몫의 피해를 눈으로 확인할 수 있어야 하기 때문이다. */
  /* 피해·회복 숫자는 사냥터의 showCombatFloatingNumberV49와 똑같이 띄운다.
     같은 클래스(.combat-floating-damage), 같은 서식(-N / +N),
     같은 자리(대상 한가운데), 같은 시간(1.2초). */
  const FLOAT_KINDS = ['damage', 'heal', 'shield', 'shield-damage'];

  function floatCombatNumber(anchor, side, amount, kind, critical = false, offsetY = 0) {
    const value = Math.max(0, Math.floor(Number(amount) || 0));
    if (!value || !FLOAT_KINDS.includes(kind)) return;
    floatNode(anchor, side, kind + (critical ? ' critical' : ''),
      kind === 'damage' || kind === 'shield-damage' ? `-${value}` : `+${value}`, offsetY);
  }

  /* 빗나감은 사냥터에 없는 표시지만 던전은 셋이 동시에 굴리므로 꼭 필요하다.
     서식은 같은 글꼴·같은 애니메이션을 쓰고 색만 다르게 둔다. */
  function floatMiss(anchor, side) {
    floatNode(anchor, side, 'raid-miss', 'MISS', 0);
  }

  function floatNode(anchor, side, kindClass, text, offsetY) {
    const layer = global.document.getElementById('raidFloatLayer');
    const stage = global.document.querySelector('.raid-stage');
    if (!layer || !stage || !anchor) return;
    const box = anchor.getBoundingClientRect?.();
    const base = stage.getBoundingClientRect?.();
    if (!box || !base || !box.width) return;
    const node = global.document.createElement('div');
    node.className = `combat-floating-damage ${side} ${kindClass}`;
    node.textContent = text;
    node.style.left = `${box.left - base.left + box.width * 0.5}px`;
    node.style.top = `${box.top - base.top + box.height * 0.5 + Number(offsetY || 0)}px`;
    layer.appendChild(node);
    global.setTimeout(() => { try { node.remove(); } catch (_) {} }, 1200);
  }

  function shake(node) {
    if (!node || !node.classList) return;
    node.classList.remove('raid-shake');
    // 클래스를 다시 붙여야 애니메이션이 재생된다.
    void (node.offsetWidth);
    node.classList.add('combat-acting', 'raid-shake');
    global.setTimeout(() => {
      try {
        node.classList.remove('raid-shake');
        if (!node.classList.contains('raid-party-lunge') && !node.classList.contains('raid-monster-lunge')) {
          node.classList.remove('combat-acting');
        }
      } catch (_) {}
    }, 450);
  }

  function memberSpriteNode(memberId) {
    const canvas = global.document.querySelector(`.raid-battle-face[data-member="${memberId}"]`);
    return canvas ? canvas.parentNode : null;
  }

  function lunge(node, role) {
    if (!node?.classList) return;
    const motionClass = role === 'monster' ? 'raid-monster-lunge' : 'raid-party-lunge';
    if (node._raidLungeTimer) global.clearTimeout(node._raidLungeTimer);
    node.classList.remove('raid-party-lunge', 'raid-monster-lunge', 'combat-acting');
    void (node.offsetWidth);
    node.classList.add('combat-acting', motionClass);
    node._raidLungeTimer = global.setTimeout(() => {
      try { node.classList.remove(motionClass, 'combat-acting'); } catch (_) {}
      node._raidLungeTimer = null;
    }, role === 'monster' ? 640 : 580);
  }

  /* ---------- 투사체·타격 연출 ----------

     사냥터 전투가 쓰는 YuksamCombatFx를 그대로 빌려 쓴다. 그쪽 엔진은
     무대에서 `.combat-player` 하나와 `.combat-monster` 하나를 찾아
     그 사이로 투사체를 날린다. 던전은 사람이 셋이라 `.combat-player`가
     고정돼 있지 않으므로, 이번 연출에 관계된 사람에게만 잠깐 그 표를
     붙였다가 뗀다. 그러면 마법사 화염구·사제 신성탄이 사냥터와 똑같이
     그 캐릭터에게서 몬스터로 날아간다. */
  const FX_ANCHOR_MS = 1100;

  function withFxAnchor(memberId, run) {
    const doc = global.document;
    const node = memberSpriteNode(memberId);
    if (!node || !doc) return;
    /* 겹치면 엉뚱한 사람에게서 날아가므로 먼저 다른 표를 모두 뗀다. */
    doc.querySelectorAll('.raid-ally-sprite.combat-player')
      .forEach((other) => other.classList.remove('combat-player'));
    node.classList.add('combat-player');
    try { run(); } catch (_) {}
    global.setTimeout(() => {
      try { node.classList.remove('combat-player'); } catch (_) {}
    }, FX_ANCHOR_MS);
  }

  function skillDefFor(skillId) {
    return global.YuksamData?.SKILL_DEFS?.[skillId] || null;
  }

  /* 파티원 한 명이 때릴 때의 연출. 스킬이면 그 스킬 고유 연출, 아니면 직업 기본 공격. */
  function playPartyAttackFx(event) {
    const fx = global.YuksamCombatFx;
    if (!fx || event.missed) return;
    const member = active?.snapshot?.().members?.find((entry) => entry.id === event.memberId);
    const skillId = event.skillId;
    const profile = skillId
      ? { ...fx.getSkillFxProfile(skillId, skillDefFor(skillId)), source:'player', target:'monster' }
      : fx.getBasicAttackFxProfile(member?.klass || 'warrior');
    withFxAnchor(event.memberId, () => fx.playPlayerActionFx(profile));
  }

  /* 몬스터가 한 명을 때릴 때의 연출. 맞는 사람 쪽으로 날아간다. */
  function playMonsterAttackFx(event, monster) {
    const fx = global.YuksamCombatFx;
    if (!fx) return;
    const profile = fx.getMonsterHitFxProfile(
      { type:monster?.id || 'monster', level:monster?.level },
      null,
    );
    if (!profile) return;
    withFxAnchor(event.memberId, () => fx.playMonsterActionFx({ ...profile, target:'player' }));
  }

  /* 전체 공격(폭풍·파동)은 세 명 자리에 차례로 충격파가 인다.
     한 명씩 때리는 연출과 구분돼야 "전체 공격이 왔다"가 눈에 들어온다. */
  function playPartyWideStorm() {
    const doc = global.document;
    const stage = doc?.querySelector('.raid-stage');
    if (!stage) return;
    doc.querySelectorAll('.raid-ally-sprite').forEach((node, index) => {
      global.setTimeout(() => {
        if (!node.isConnected) return;
        node.classList.remove('raid-storm-hit');
        void (node.offsetWidth);
        node.classList.add('raid-storm-hit');
        global.setTimeout(() => {
          try { node.classList.remove('raid-storm-hit'); } catch (_) {}
        }, 520);
      }, index * 110);
    });
  }

  function showEventEffect(event) {
    if (!event) return;
    const monsterNode = global.document.querySelector('.raid-monster-sprite');

    /* 몬스터 상태 배지는 updateBattleView가 스냅샷을 보고 통째로 다시 그린다.
       (예전에는 여기서 배지 하나로 덮어써서 기절·강화가 서로를 지웠다.) */

    // 치명타는 무대 전체가 번쩍인다(사냥터 전투와 같다).
    if (event.critical && !event.missed) {
      const stage = global.document.querySelector('.raid-stage');
      if (stage) {
        stage.classList.remove('raid-crit');
        void (stage.offsetWidth);
        stage.classList.add('raid-crit');
        global.setTimeout(() => { try { stage.classList.remove('raid-crit'); } catch (_) {} }, 500);
      }
    }

    if (event.kind === 'party-hit') {
      playPartyAttackFx(event);
      if (event.missed) floatMiss(monsterNode, 'monster');
      else {
        const shieldDamage = Number(event.shieldDamage) || 0;
        const hpDamage = Number(event.hpDamage ?? event.damage) || 0;
        if (shieldDamage > 0) floatCombatNumber(monsterNode, 'monster', shieldDamage, 'shield-damage', false, hpDamage > 0 ? -22 : 0);
        if (hpDamage > 0) floatCombatNumber(monsterNode, 'monster', hpDamage, 'damage', event.critical, shieldDamage > 0 ? 22 : 0);
        shake(monsterNode);
      }
      // 명중 여부와 관계없이 공격을 시도한 사람은 앞으로 나갔다 돌아온다.
      const attacker = memberSpriteNode(event.memberId);
      lunge(attacker, 'party');
      return;
    }

    /* 몬스터 쪽 회복·보호막 (흡혈, 긴급 보수, 철갑 방벽 …) */
    if (event.kind === 'monster-heal') {
      floatCombatNumber(monsterNode, 'monster', event.amount, 'heal');
      return;
    }
    if (event.kind === 'monster-shield') {
      floatCombatNumber(monsterNode, 'monster', event.amount, 'shield');
      return;
    }

    /* 파티가 받는 독 피해와 반격 피해 */
    if (['member-dot', 'monster-counter'].includes(event.kind)) {
      const target = memberSpriteNode(event.memberId);
      const shieldDamage = Number(event.shieldDamage) || 0;
      const hpDamage = Number(event.hpDamage ?? event.damage) || 0;
      if (shieldDamage > 0) floatCombatNumber(target, 'player', shieldDamage, 'shield-damage', false, hpDamage > 0 ? -22 : 0);
      if (hpDamage > 0) floatCombatNumber(target, 'player', hpDamage, 'damage', false, shieldDamage > 0 ? 22 : 0);
      shake(target);
      if (event.kind === 'monster-counter') lunge(monsterNode, 'monster');
      return;
    }

    if (event.kind === 'monster-hit') {
      const target = memberSpriteNode(event.memberId);
      playMonsterAttackFx(event, active?.snapshot?.().monster);
      if (event.missed) { floatMiss(target, 'player'); return; }
      const shieldDamage = Number(event.shieldDamage) || 0;
      const hpDamage = Number(event.hpDamage ?? event.damage) || 0;
      if (shieldDamage > 0) floatCombatNumber(target, 'player', shieldDamage, 'shield-damage', false, hpDamage > 0 ? -22 : 0);
      if (hpDamage > 0) floatCombatNumber(target, 'player', hpDamage, 'damage', event.critical, shieldDamage > 0 ? 22 : 0);
      shake(target);
      return;
    }

    if (event.kind === 'party-heal') {
      floatCombatNumber(memberSpriteNode(event.targetMemberId || event.memberId), 'player', event.amount, 'heal');
      return;
    }

    if (event.kind === 'party-shield') {
      floatCombatNumber(memberSpriteNode(event.targetMemberId || event.memberId), 'player', event.amount, 'shield');
      return;
    }

    if (event.kind === 'party-buff' && Number(event.heal) > 0) {
      floatCombatNumber(memberSpriteNode(event.memberId), 'player', event.heal, 'heal');
      return;
    }

    if (event.kind === 'member-revive') {
      floatCombatNumber(memberSpriteNode(event.memberId), 'player', event.amount, 'heal');
      return;
    }

    if (['monster-dot', 'party-retaliation'].includes(event.kind)) {
      const damage = Number(event.totalDamage ?? event.hpDamage ?? event.amount) || 0;
      if (damage > 0) {
        floatCombatNumber(monsterNode, 'monster', damage, 'damage', event.critical);
        shake(monsterNode);
      }
      if (Number(event.heal) > 0 && event.targetMemberId) {
        floatCombatNumber(memberSpriteNode(event.targetMemberId), 'player', event.heal, 'heal', false, 22);
      }
      return;
    }

    if (event.kind === 'monster-windup') {
      /* 공격을 준비하는 순간 앞으로 나온다. 빗나가거나 보호막에 전부
         막혀도 몬스터가 실제로 공격했다는 움직임은 반드시 보여야 한다. */
      lunge(monsterNode, 'monster');
      const fx = global.YuksamCombatFx;
      const monster = active?.snapshot?.().monster;
      if (fx && monster) {
        const profile = fx.getMonsterActionFxProfile(
          { type:monster.id || 'monster', level:monster.level }, null,
        );
        if (profile) fx.playMonsterActionFx(profile);
      }
      if (event.all) {
        const stage = global.document.querySelector('.raid-stage');
        if (stage) {
          stage.classList.add('raid-danger');
          global.setTimeout(() => { try { stage.classList.remove('raid-danger'); } catch (_) {} }, 620);
        }
        /* 전체 공격은 파티 전원 자리에 폭풍이 한 번씩 인다. */
        playPartyWideStorm();
      }
    }
  }

  /* 한 라운드에서 일어난 일을 한 줄씩 차례로 보여 준다.
     한 줄이 나오면 이전 줄은 지워진다(일반 전투와 같다).
     각 줄은 최소 1.5초씩 보여 준다 — 학생이 읽을 시간이 필요하다. */
  let eventDelayMs = 1500;
  /* 검사에서 setLogSpeed로 지정한 속도. 지정돼 있으면 따라잡기가 건드리지 않는다. */
  let logSpeedOverride = null;

  function exactEventNumber(event, key) {
    if (!event || !Object.prototype.hasOwnProperty.call(event, key)) return null;
    const value = Number(event[key]);
    return Number.isFinite(value) ? value : null;
  }

  /* 서버의 최종 스냅샷을 기다리지 않고, 피격 로그가 재생되는 바로 그 순간
     해당 학생의 상태 배지를 갱신한다. 새 이벤트는 monster-hit에 정확한 상태
     사본을 싣고, 배포 전 방에서 온 옛 이벤트는 아래 개별 상태 로그로 보정한다. */
  function applyMemberStatusesToView(event) {
    const memberId = String(event?.memberId || event?.targetMemberId || '');
    if (!view || !memberId) return;
    const current = { ...(view.memberStatuses?.[memberId] || {}) };
    let next = null;

    if (event.kind === 'monster-hit' && event.memberStatuses && typeof event.memberStatuses === 'object') {
      next = { ...event.memberStatuses };
    } else if (event.kind === 'member-status') {
      next = current;
      const turns = Math.max(1, Number(event.turns) || 1);
      if (event.status === 'poison') {
        next.poisonTurns = Math.max(Number(next.poisonTurns) || 0, turns);
        next.poisonDamage = Math.max(Number(next.poisonDamage) || 0, Number(event.amount) || 0);
      } else if (event.status === 'stun') {
        next.stunTurns = Math.max(Number(next.stunTurns) || 0, turns);
      } else if (event.status === 'chill') {
        next.chillTurns = Math.max(Number(next.chillTurns) || 0, turns);
      }
    } else if (event.kind === 'member-dot' && event.status === 'poison') {
      next = current;
      next.poisonTurns = Math.max(0, Number(event.turns) || 0);
      if (next.poisonTurns <= 0) next.poisonDamage = 0;
    } else if (event.kind === 'party-skip' && event.status === 'stun') {
      next = current;
      next.stunTurns = Math.max(0, (Number(next.stunTurns) || 0) - 1);
    } else if (event.kind === 'party-cleanse') {
      next = { ...current, poisonTurns:0, poisonDamage:0, stunTurns:0 };
    }

    if (!next) return;
    view.memberStatuses = view.memberStatuses || {};
    view.memberStatuses[memberId] = next;
  }

  /* 이 한 줄이 일어난 만큼만 표시용 체력을 움직인다.
     그래서 "때릴 때마다 체력바가 쭉 빠지는" 모습이 나온다. */
  function applyEventToView(event) {
    if (!view || !event) return;
    if (['party-hit', 'monster-dot', 'party-retaliation', 'monster-execute'].includes(event.kind) && !event.missed) {
      const exactShield = exactEventNumber(event, 'remainingShield');
      const exactHp = exactEventNumber(event, 'monsterHp');
      view.monsterShield = exactShield === null
        ? Math.max(0, view.monsterShield - (Number(event.shieldDamage) || 0))
        : Math.max(0, exactShield);
      view.monsterHp = exactHp === null
        ? Math.max(0, view.monsterHp - (Number(event.hpDamage ?? event.damage ?? event.amount) || 0))
        : Math.max(0, exactHp);
      if (Number(event.heal) > 0 && event.targetMemberId) {
        const exactMemberHp = exactEventNumber(event, 'memberHp');
        view.members[event.targetMemberId] = exactMemberHp === null
          ? (view.members[event.targetMemberId] || 0) + Number(event.heal)
          : Math.max(0, exactMemberHp);
      }
    } else if (['monster-hit', 'member-dot', 'monster-counter'].includes(event.kind) && !event.missed) {
      const before = view.members[event.memberId] ?? 0;
      const exactShield = exactEventNumber(event, 'remainingShield');
      const exactHp = exactEventNumber(event, 'memberHp');
      view.memberShields[event.memberId] = exactShield === null
        ? Math.max(0, (view.memberShields[event.memberId] || 0) - (Number(event.shieldDamage) || 0))
        : Math.max(0, exactShield);
      view.members[event.memberId] = exactHp === null
        ? Math.max(0, before - (Number(event.hpDamage ?? event.damage) || 0))
        : Math.max(0, exactHp);
    } else if (event.kind === 'monster-heal') {
      const exactHp = exactEventNumber(event, 'monsterHp');
      view.monsterHp = exactHp === null
        ? view.monsterHp + (Number(event.amount) || 0)
        : Math.max(0, exactHp);
    } else if (event.kind === 'monster-shield') {
      const exactShield = exactEventNumber(event, 'shield');
      view.monsterShield = exactShield === null
        ? (Number(view.monsterShield) || 0) + (Number(event.amount) || 0)
        : Math.max(0, exactShield);
    } else if (event.kind === 'party-heal') {
      const id = event.targetMemberId || event.memberId;
      const before = view.members[id] ?? 0;
      const exactHp = exactEventNumber(event, 'memberHp');
      view.members[id] = exactHp === null ? before + (event.amount || 0) : Math.max(0, exactHp);
    } else if (event.kind === 'party-buff') {
      if (event.heal > 0) {
        const before = view.members[event.memberId] ?? 0;
        const exactHp = exactEventNumber(event, 'memberHp');
        view.members[event.memberId] = exactHp === null ? before + Number(event.heal || 0) : Math.max(0, exactHp);
      }
      if (event.status === 'intBuff') {
        view.memberBuffs = view.memberBuffs || {};
        view.memberBuffs[event.memberId] = {
          ...(view.memberBuffs[event.memberId] || {}),
          intBuffTurns:Math.max(1, Number(event.turns) || 1),
        };
      }
    } else if (event.kind === 'party-shield') {
      const id = event.targetMemberId || event.memberId;
      const exactShield = exactEventNumber(event, 'shield');
      view.memberShields[id] = exactShield === null
        ? (view.memberShields[id] || 0) + Number(event.amount || 0)
        : Math.max(0, exactShield);
    } else if (event.kind === 'member-revive') {
      view.members[event.memberId] = Math.max(1, Number(event.memberHp ?? event.amount) || 1);
    }

    applyMemberStatusesToView(event);

    /* 몬스터 상태 배지도 로그 한 줄에 맞춰 켜고 끈다.
       기절이 걸린 줄에서 배지가 켜지고, 몬스터가 건너뛰는 줄에서 꺼진다. */
    const statuses = view.monsterStatuses || (view.monsterStatuses = {});
    if (event.kind === 'monster-status') {
      const turns = Math.max(1, Number(event.turns) || 1);
      if (event.status === 'stun') statuses.stunTurns = Math.max(statuses.stunTurns || 0, turns);
      if (event.status === 'stun' && event.sourceName) statuses.stunSourceName = String(event.sourceName);
      if (event.status === 'chill') statuses.chillTurns = Math.max(statuses.chillTurns || 0, turns);
    } else if (event.kind === 'monster-skip' && event.status === 'stun') {
      statuses.stunTurns = Math.max(0, (statuses.stunTurns || 0) - 1);
      if (statuses.stunTurns <= 0) statuses.stunSourceName = '';
    }
  }

  function applyDynamicFormationToBattle(snapshot) {
    const doc = global.document;
    const order = { front:0, middle:1, back:2 };
    const members = displayPartyMembers(snapshot?.members || [], view?.members || {});
    const sorted = [...members].sort((a, b) => {
      const aOrder = a.hp > 0 ? (order[a.slot] ?? 1) : 3 + (order[a.originalSlot || a.slot] ?? 1);
      const bOrder = b.hp > 0 ? (order[b.slot] ?? 1) : 3 + (order[b.originalSlot || b.slot] ?? 1);
      return aOrder - bOrder;
    });
    sorted.forEach((member, index) => {
      const box = doc.querySelector(`.raid-ally-hp[data-member="${member.id}"]`);
      const sprite = box?.closest?.('.raid-ally-sprite');
      if (sprite) {
        sprite.classList.remove('raid-ally-0', 'raid-ally-1', 'raid-ally-2');
        sprite.classList.add(`raid-ally-${Math.min(2, index)}`);
      }
      if (box) {
        box.classList.remove('slot-front', 'slot-middle', 'slot-back');
        box.classList.add(raidSlotClass(member.slot));
        const label = box.querySelector('.raid-ally-slot');
        if (label) label.textContent = member.hp > 0 ? rules().slotLabel(member.slot) : '쓰러짐';
      }
    });
  }

  /* 재생 중에는 창을 다시 열지 않고 바뀐 곳만 고친다.
     창을 새로 열면 체력바가 매번 새로 만들어져 CSS 애니메이션이 죽는다.
     (사냥터 전투에서 체력바가 스르륵 줄어드는 것과 같은 이유다.) */
  function updateBattleView() {
    const snap = active?.snapshot();
    if (!snap?.monster || !view) return;
    const doc = global.document;

    /* 문구는 전투 로그를 보여 주는 중에만 고친다.
       문제를 읽고 있을 때 여기서 덮어쓰면 문제가 '무엇을 할까?'로 바뀌어 버린다. */
    if (panelMode === 'playing') {
      const heading = doc.querySelector('.raid-combat .panel-card h3');
      if (heading) heading.innerHTML = raidMessageHtml(panelMessage || '');
    }

    // 몬스터 체력
    const monsterHp = Math.max(0, view.monsterHp);
    const monsterPct = Math.max(0, Math.round((monsterHp / snap.monster.maxHp) * 100));
    const monsterFill = doc.querySelector('.combat-hpbox.monster .hpfill');
    const monsterText = doc.querySelector('.combat-hpbox.monster .raid-hp-text');
    if (monsterFill) monsterFill.style.width = `${monsterPct}%`;
    if (monsterText) {
      const shield = Math.max(0, Number(view.monsterShield) || 0);
      monsterText.innerHTML = `HP ${monsterHp}/${snap.monster.maxHp}${shieldBadgeHtml(shield)}`;
    }

    // 파티 체력
    snap.members.forEach((member) => {
      const hp = Math.max(0, view.members?.[member.id] ?? member.hp);
      const shield = Math.max(0, view.memberShields?.[member.id] ?? member.shield ?? 0);
      const pct = Math.max(0, Math.round((hp / member.maxHp) * 100));
      const box = doc.querySelector(`.raid-ally-hp[data-member="${member.id}"]`);
      if (box) {
        const fill = box.querySelector('.hpfill');
        const num = box.querySelector('.raid-ally-num');
        const status = box.querySelector('[data-raid-status-member]');
        if (fill) fill.style.width = `${pct}%`;
        /* 'HP' 글자를 빼먹으면 갱신될 때마다 글자가 붙었다 없어졌다 한다. */
        if (num) num.innerHTML = `HP ${hp}/${member.maxHp}${shieldBadgeHtml(shield)}`;
        if (status) {
          status.innerHTML = memberStatusBadgesHtml({
            ...member,
            statuses:{ ...(view.memberStatuses?.[member.id] || member.statuses || {}) },
            buffs:{ ...(view.memberBuffs?.[member.id] || member.buffs || {}) },
          });
        }
        box.classList.toggle('down', hp <= 0);
      }
      const sprite = memberSpriteNode(member.id);
      if (sprite) sprite.classList.toggle('down', hp <= 0);
    });
    applyDynamicFormationToBattle(snap);

    /* 다음 턴 예고는 여기서 고치지 않는다.
       한 턴(우리 공격 + 몬스터 반격)이 다 끝나고 다음 문제가 나올 때
       renderBattle이 새로 그린다. 재생 도중에 바꾸면 아직 이번 턴이
       끝나지도 않았는데 다음 기술 이름이 먼저 떠서 이상해 보인다. */

    /* 몬스터 상태 배지(기절·냉기·강화·예고 …).
       기절·냉기는 표시용 값을 얹어 로그가 흐르는 동안 실제로 보이게 한다. */
    const statusNode = doc.getElementById('raidMonsterStatuses');
    if (statusNode) {
      statusNode.innerHTML = monsterStatusBadgesHtml({
        ...snap.monster,
        ...(view.monsterStatuses || {}),
      });
    }

    // 쓰러진 몬스터는 사냥터처럼 어두워지며 사라진다.
    const monsterSprite = doc.querySelector('.raid-monster-sprite');
    if (monsterSprite) monsterSprite.classList.toggle('raid-dying', monsterHp <= 0);
  }

  function playEvents(events, onDone, { syncAtEnd = true } = {}) {
    let index = 0;
    const step = () => {
      if (!active) return;
      if (index >= events.length) {
        if (syncAtEnd) syncViewToTruth();
        onDone?.();
        return;
      }
      const event = events[index];
      index += 1;
      // 글은 '무엇을 할까?' 자리에 그대로 들어간다(별도 로그 상자 없음).
      panelMode = 'playing';
      panelMessage = event.text || '';
      applyEventToView(event);
      playEventSound(event);
      updateBattleView();       // 창을 새로 열지 않고 값만 고친다 → 체력바가 스르륵 줄어든다
      showEventEffect(event);   // 숫자와 흔들림은 그 위에 얹는다
      global.setTimeout(step, eventDelayMs);
    };
    step();
  }

  /* 파티원의 직업 기본 공격 소리(또는 고른 스킬 소리)를 낸다.
     세 명이 각자 때리므로 각자의 직업 소리가 순서대로 들린다. */
  function attackAudioIdFor(member) {
    const manifest = global.YuksamAudioManifest;
    if (!manifest) return null;
    // 내가 스킬을 골랐으면 내 공격만 스킬 소리로 낸다.
    if (isMine(member) && chosenAction && chosenAction !== 'attack') {
      const skillId = String(chosenAction).slice(7);
      return manifest.skillSounds?.[skillId] || manifest.classBasicSounds?.[member.klass] || null;
    }
    return manifest.classBasicSounds?.[member?.klass] || null;
  }

  /* 던전은 셋이 함께 하는 기능뿐이라 답 제출도 방을 거친다. */
  function submitAnswer(given) {
    if (busy || !active || active.phase !== 'battle' || !networkSession) return;
    submitNetworkAnswer(given);
  }


  /* ---------- 끝맺음 ---------- */

  /* 결과 화면과 보상은 한 판에 한 번만. 여러 경로에서 불릴 수 있어 잠근다. */
  let finishedRunKey = '';

  function finishRun() {
    if (!active) return;
    const snap = active.snapshot();
    const cleared = snap.phase === 'cleared';
    const session = networkSession;
    const completion = cleared && session ? session.completion : null;
    /* 온라인 보상은 방 클리어와 같은 서버 트랜잭션에서 확정된다. 아주 짧은
       순서 차이로 완료 정보가 아직 안 왔다면 로컬에서 먼저 더하지 않고 다시
       동기화한다. 결과 잠금도 이 뒤에 걸어야 보상창을 영원히 놓치지 않는다. */
    if (cleared && session && !completion?.player) {
      if (!session.completionRefreshPending) {
        session.completionRefreshPending = true;
        global.setTimeout(() => {
          if (networkSession !== session) return;
          session.completionRefreshPending = false;
          refreshNetworkRoom();
        }, 180);
      }
      return;
    }

    const key = `${session?.room?.id || 'solo'}|${snap.phase}`;
    if (finishedRunKey === key) return;
    finishedRunKey = key;
    stopRaidQuestionTimer();
    const reward = cleared && session
      ? (completion.reward || { exp:0, gold:0, building:0 })
      : (snap.reward || {});
    const alreadyRewarded = !!(cleared && session && completion.awarded !== true);
    const g = G();

    const group = currentFloorGroup();
    const groupLabel = currentGroupLabel();
    const P = progressApi();
    const nextLabel = P && group < P.LAST_GROUP ? P.labelFor(group + 1) : '';
    let unlockedNext = false;

    if (cleared && g?.player) {
      if (session) {
        /* 서버의 절대값으로 맞춘다. 같은 완료 응답이 다시 와도 보상이 더해지지
           않으며, 이 함수가 레벨업 연출·스킬 포인트·완전 회복까지 처리한다. */
        call('applyAuthoritySnapshotFromServerV3', {
          ...completion.player,
          fullyHealed:completion.fullyHealed === true || completion.player.fullyHealed === true,
        });
      } else {
        call('addExp', reward.exp || 0);
        call('addGold', reward.gold || 0);
        if (reward.building) g.player.building = (g.player.building || 0) + reward.building;
      }
      /* 이 구간을 깼으니 다음 구간을 연다. */
      unlockedNext = !!P && P.recordClear(g.player, group) && !!nextLabel;
      call('savePlayer');
      call('updateHud');
    }

    const bossName = snap.monster?.name || '구간의 보스';
    call('playSfx', cleared ? 'quest' : 'hit');
    call('openModal', `
      <h2>${cleared ? `🏆 ${esc(groupLabel)} 돌파!` : '전멸…'}</h2>
      <div class="panel-card">
        ${cleared
          ? `<p>${esc(bossName)}을(를) 쓰러뜨렸습니다!</p>
             ${alreadyRewarded
               ? '<p class="raid-unlock-note">이 구간의 첫 클리어 보상은 이미 받았습니다.</p>'
               : `<p>EXP +${reward.exp || 0} · Gold +${reward.gold || 0} · 빌딩 +${reward.building || 0}</p>`}
             ${unlockedNext ? `<p class="raid-unlock-note">🔓 <strong>${esc(nextLabel)}</strong> 구간이 열렸습니다!</p>` : ''}`
          : '<p>다음에는 대형을 바꿔서 다시 도전해 보세요.</p>'}
        <div class="answer-row"><button class="primary" id="raidDoneBtn">확인</button></div>
      </div>
    `, { type:'raidResult', pause:true });

    call('appendChatMessage', 'system', '63빌딩 던전',
      cleared ? `${groupLabel} 구간을 돌파했습니다!` : `${groupLabel} 구간에서 전멸했습니다.`);

    const doneBtn = global.document.getElementById('raidDoneBtn');
    if (doneBtn) {
      doneBtn.onclick = () => {
        if (networkSession) {
          leaveNetworkRoom({ returnToTown:true });
          return;
        }
        active = null;
        question = null;
        call('closeModal');
        leaveDungeonMap();   // 던전에서 마을로 실제로 돌아간다
      };
    }
  }

  /* ---------- 밖에서 부르는 입구 ---------- */

  /* ---------- 던전 몬스터 그림 ----------
     이모티콘 대신 버섯돌이·스톰프처럼 직접 그린 모델을 쓴다.
     캔버스 하나를 받아 가운데에 그린다. */

  function drawMonsterModel(canvas, monster, hurt = false) {
    if (!canvas || !monster) return;
    const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    if (!ctx) return;
    const cx = canvas.width / 2;
    const cy = canvas.height * 0.62;
    const t = (global.performance ? performance.now() : Date.now()) / 1000;
    try {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      if (hurt) ctx.globalAlpha = 0.75;
      // 바닥 그림자
      ctx.fillStyle = 'rgba(4,10,18,.35)';
      ctx.beginPath();
      ctx.ellipse(cx, cy + 62, 46, 13, 0, 0, Math.PI * 2);
      ctx.fill();
      const painter = MONSTER_PAINTERS[monster.id] || MONSTER_PAINTERS.guardBot;
      painter(ctx, cx, cy, t, monster);
      ctx.restore();
    } catch (_) { /* 그리기 실패가 전투를 막지 않게 한다 */ }
  }

  /* 사냥터에 이미 있는 몬스터 그림을 빌려 쓴다.
     같은 계열(버섯·슬라임·스톰프)은 새로 그리는 것보다 재사용이 자연스럽다. */
  function borrowSprite(name, ctx, cx, cy, scale) {
    const draw = global[name];
    if (typeof draw !== 'function') return false;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);
    try {
      draw(ctx, cx, cy, { type:'raid', chasing:false, spawnX:cx }, 1.9);
    } catch (_) { ctx.restore(); return false; }
    ctx.restore();
    return true;
  }

  /* 작은 도우미 — 몬스터 그림에서 자주 쓰는 모양들 */
  function blob(ctx, cx, cy, rx, ry, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  function eyes(ctx, cx, cy, dx, r, color = '#111827', glow = null) {
    ctx.fillStyle = glow || color;
    ctx.beginPath(); ctx.arc(cx - dx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + dx, cy, r, 0, Math.PI * 2); ctx.fill();
  }
  function box(ctx, x, y, w, h, fill, radius = 0) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    if (ctx.roundRect && radius) ctx.roundRect(x, y, w, h, radius);
    else ctx.rect(x, y, w, h);
    ctx.fill();
  }

  const MONSTER_PAINTERS = {
    /* ── Lv.5 ───────────────────────────────────────── */

    /* 버섯돌이킹 — 사냥터 버섯돌이에 왕관을 씌운 큰 버섯 */
    mushroomKing(ctx, cx, cy, t) {
      const bob = Math.sin(t * 2) * 4;
      ctx.save();
      ctx.translate(0, bob);
      if (!borrowSprite('drawMushroomSprite', ctx, cx, cy + 10, 1.5)) {
        blob(ctx, cx, cy + 18, 26, 30, '#e5dac4');
        ctx.fillStyle = '#d63b3b';
        ctx.beginPath();
        ctx.moveTo(cx - 56, cy); ctx.quadraticCurveTo(cx, cy - 66, cx + 56, cy);
        ctx.closePath(); ctx.fill();
        eyes(ctx, cx, cy + 20, 12, 4);
      }
      // 왕관
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.moveTo(cx - 26, cy - 52); ctx.lineTo(cx - 18, cy - 76); ctx.lineTo(cx - 8, cy - 58);
      ctx.lineTo(cx, cy - 82); ctx.lineTo(cx + 8, cy - 58); ctx.lineTo(cx + 18, cy - 76);
      ctx.lineTo(cx + 26, cy - 52);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    },

    /* 종이비둘기 — 접힌 종이 날개, 서류 무늬 */
    paperPigeon(ctx, cx, cy, t) {
      const flap = Math.sin(t * 6) * 16;
      ctx.save();
      ctx.translate(0, Math.sin(t * 2.4) * 6);
      // 날개
      ctx.fillStyle = '#eef2f7';
      ctx.beginPath();
      ctx.moveTo(cx, cy - 6); ctx.lineTo(cx - 74, cy - 30 - flap); ctx.lineTo(cx - 16, cy + 12);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx, cy - 6); ctx.lineTo(cx + 74, cy - 30 + flap); ctx.lineTo(cx + 16, cy + 12);
      ctx.closePath(); ctx.fill();
      // 몸통(접힌 종이)
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(cx - 26, cy - 10); ctx.lineTo(cx + 30, cy - 22);
      ctx.lineTo(cx + 16, cy + 30); ctx.lineTo(cx - 22, cy + 24);
      ctx.closePath(); ctx.fill();
      // 서류 줄
      ctx.strokeStyle = 'rgba(120,140,170,.6)'; ctx.lineWidth = 2;
      for (let i = 0; i < 3; i += 1) {
        ctx.beginPath();
        ctx.moveTo(cx - 18, cy - 2 + i * 9); ctx.lineTo(cx + 16, cy - 6 + i * 9);
        ctx.stroke();
      }
      // 부리와 눈
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.moveTo(cx + 30, cy - 22); ctx.lineTo(cx + 52, cy - 14); ctx.lineTo(cx + 30, cy - 8);
      ctx.closePath(); ctx.fill();
      eyes(ctx, cx + 16, cy - 14, 0, 3.5);
      ctx.restore();
    },

    /* ── Lv.6 ───────────────────────────────────────── */

    /* 빌딩 스톰프 — 사냥터 스톰프와 같은 둥근 몸·얼굴·잎 실루엣을 쓰되,
       몸통 전체가 철로 된 모습이다. 작은 갑옷을 덧씌운 것처럼 보이지 않게
       금속 몸통 자체에 창문과 이음새를 새긴다. */
    buildingStomp(ctx, cx, cy, t) {
      const stomp = Math.abs(Math.sin(t * 1.8)) * 6;
      ctx.save();
      ctx.translate(0, stomp);
      const steelBody = ctx.createLinearGradient(cx - 38, cy - 48, cx + 38, cy + 62);
      steelBody.addColorStop(0, '#e2e8f0');
      steelBody.addColorStop(0.42, '#94a3b8');
      steelBody.addColorStop(1, '#475569');
      box(ctx, cx - 38, cy - 48, 76, 110, steelBody, 20);

      // 스톰프의 몸통 세로결을 금속 판 이음새와 반사광으로 바꾼다.
      box(ctx, cx - 5, cy - 42, 10, 98, '#64748b', 5);
      ctx.strokeStyle = 'rgba(248,250,252,.62)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(cx - 27, cy - 30); ctx.lineTo(cx - 20, cy + 42);
      ctx.moveTo(cx + 26, cy - 30); ctx.lineTo(cx + 20, cy + 42);
      ctx.stroke();

      // 얼굴과 잎은 원래 스톰프와 같은 인상을 유지한다.
      eyes(ctx, cx, cy - 7, 13, 4, '#1e293b');
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(cx, cy + 7, 9, 0, Math.PI); ctx.stroke();
      blob(ctx, cx - 18, cy - 64, 26, 23, '#2f6c39');
      blob(ctx, cx + 14, cy - 68, 30, 25, '#2f6c39');
      blob(ctx, cx + 39, cy - 48, 23, 21, '#2f6c39');

      // 몸통 아래쪽의 창문도 철 몸체에 바로 박혀 있다.
      const windowGlow = 0.72 + Math.sin(t * 2.8) * 0.16;
      ctx.fillStyle = `rgba(125,211,252,${windowGlow.toFixed(3)})`;
      [[-27, 25], [11, 25], [-27, 42], [11, 42]].forEach(([dx, dy]) => {
        ctx.fillRect(cx + dx, cy + dy, 16, 10);
      });
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 2;
      ctx.strokeRect(cx - 28, cy + 24, 18, 12);
      ctx.strokeRect(cx + 10, cy + 24, 18, 12);
      ctx.strokeRect(cx - 28, cy + 41, 18, 12);
      ctx.strokeRect(cx + 10, cy + 41, 18, 12);

      // 아래 금속띠와 리벳으로 빌딩의 묵직한 바닥을 표현한다.
      box(ctx, cx - 36, cy + 55, 72, 8, '#64748b', 3);
      ctx.fillStyle = '#cbd5e1';
      [-27, -9, 9, 27].forEach((dx) => {
        ctx.beginPath();
        ctx.arc(cx + dx, cy + 59, 1.8, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    },

    /* 고장 난 전화기 — 수화기와 다이얼, 튀는 스파크 */
    brokenPhone(ctx, cx, cy, t) {
      ctx.save();
      ctx.translate(0, Math.sin(t * 2.2) * 3);
      box(ctx, cx - 42, cy - 6, 84, 54, '#1f2937', 10);   // 본체
      box(ctx, cx - 34, cy + 6, 68, 34, '#374151', 8);
      // 다이얼
      ctx.strokeStyle = '#9ca3af'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(cx, cy + 22, 14, 0, Math.PI * 2); ctx.stroke();
      // 수화기(흔들림)
      ctx.save();
      ctx.translate(cx, cy - 24);
      ctx.rotate(Math.sin(t * 5) * 0.28);
      box(ctx, -46, -12, 92, 20, '#111827', 10);
      blob(ctx, -44, -2, 12, 12, '#111827');
      blob(ctx, 44, -2, 12, 12, '#111827');
      ctx.restore();
      // 스파크
      const spark = Math.sin(t * 12) > 0.4;
      if (spark) {
        ctx.strokeStyle = '#fde68a'; ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx + 30, cy - 34); ctx.lineTo(cx + 40, cy - 48);
        ctx.lineTo(cx + 32, cy - 46); ctx.lineTo(cx + 44, cy - 62);
        ctx.stroke();
      }
      eyes(ctx, cx, cy + 40, 16, 4, '#fca5a5');
      ctx.restore();
    },

    /* ── Lv.7 ───────────────────────────────────────── */

    /* 오염된 슬라임 — 사각 틴트 없이 보라색 몸체를 직접 그린다. */
    pollutedSlime(ctx, cx, cy, t) {
      ctx.save();
      const squash = 1 + Math.sin(t * 4) * 0.08;
      ctx.translate(cx, cy + 8 + Math.sin(t * 3) * 3);
      ctx.scale(1 / squash, squash);
      const purple = ctx.createRadialGradient(-12, -16, 6, 0, 0, 58);
      purple.addColorStop(0, '#ddd6fe');
      purple.addColorStop(0.55, '#9333ea');
      purple.addColorStop(1, '#581c87');
      ctx.fillStyle = purple;
      ctx.beginPath();
      ctx.moveTo(-50, 14);
      ctx.quadraticCurveTo(-38, -44, 0, -52);
      ctx.quadraticCurveTo(40, -44, 52, 14);
      ctx.quadraticCurveTo(28, 46, -30, 38);
      ctx.quadraticCurveTo(-50, 32, -50, 14);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.52)';
      ctx.beginPath();
      ctx.ellipse(-18, -24, 13, 7, -0.5, 0, Math.PI * 2);
      ctx.fill();
      eyes(ctx, 0, -1, 16, 5, '#111827');
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 12, 10, 0.15, Math.PI - 0.15);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      // 떨어지는 오염 방울
      for (let i = 0; i < 3; i += 1) {
        const p = ((t * 0.8 + i * 0.33) % 1);
        ctx.globalAlpha = 1 - p;
        blob(ctx, cx - 34 + i * 34, cy + 30 + p * 34, 5, 7, '#c084fc');
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    },

    /* 폭주 복사기 — 용지가 계속 뿜어져 나온다 */
    rampageCopier(ctx, cx, cy, t) {
      ctx.save();
      ctx.translate(0, Math.sin(t * 2) * 3);
      box(ctx, cx - 50, cy - 34, 100, 78, '#cbd5e1', 8);   // 본체
      box(ctx, cx - 42, cy - 26, 84, 26, '#475569', 6);    // 스캐너 유리
      ctx.fillStyle = `rgba(125,211,252,${(0.35 + 0.4 * Math.abs(Math.sin(t * 4))).toFixed(3)})`;
      ctx.fillRect(cx - 40, cy - 24, 80, 22);
      // 배출되는 용지
      for (let i = 0; i < 4; i += 1) {
        const p = ((t * 1.1 + i * 0.25) % 1);
        ctx.save();
        ctx.translate(cx + 46 + p * 40, cy + 6 - p * 26);
        ctx.rotate(p * 1.4);
        ctx.globalAlpha = 1 - p * 0.8;
        box(ctx, -9, -12, 18, 24, '#ffffff', 2);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      box(ctx, cx - 34, cy + 8, 68, 12, '#94a3b8', 4);     // 배출구
      eyes(ctx, cx, cy + 30, 14, 4, '#ef4444');
      ctx.restore();
    },

    /* ── Lv.9 ───────────────────────────────────────── */

    /* 비상구 귀신 — 비상구 표지의 초록 인간 형상 */
    emergencyExitGhost(ctx, cx, cy, t) {
      const float = Math.sin(t * 1.7) * 8;
      ctx.save();
      ctx.translate(0, float);
      // 표지판 빛
      const glow = ctx.createRadialGradient(cx, cy, 6, cx, cy, 78);
      glow.addColorStop(0, 'rgba(34,197,94,.45)');
      glow.addColorStop(1, 'rgba(34,197,94,0)');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(cx, cy, 78, 0, Math.PI * 2); ctx.fill();
      // 달리는 사람 실루엣
      ctx.fillStyle = '#22c55e';
      blob(ctx, cx - 4, cy - 34, 11, 11, '#22c55e');            // 머리
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.sin(t * 3) * 0.06);
      box(ctx, -14, -20, 22, 34, '#22c55e', 6);                 // 몸통
      ctx.restore();
      ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 9; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - 6, cy + 12); ctx.lineTo(cx - 26, cy + 40);
      ctx.moveTo(cx + 4, cy + 12); ctx.lineTo(cx + 26, cy + 36);
      ctx.moveTo(cx - 10, cy - 10); ctx.lineTo(cx - 34, cy + 2);
      ctx.moveTo(cx + 6, cy - 12); ctx.lineTo(cx + 30, cy - 26);
      ctx.stroke();
      // 붉은 눈
      eyes(ctx, cx - 4, cy - 36, 4, 2.5, '#7f1d1d', '#fca5a5');
      ctx.restore();
    },

    /* ── Lv.10 ──────────────────────────────────────── */

    /* 엘리베이터 영혼 — 열린 문 사이로 보이는 혼 */
    elevatorSoul(ctx, cx, cy, t) {
      const gap = 16 + Math.abs(Math.sin(t * 1.4)) * 14;
      ctx.save();
      // 승강기 통로
      box(ctx, cx - 62, cy - 62, 124, 128, '#0b1220', 6);
      // 안쪽 혼
      const soul = ctx.createRadialGradient(cx, cy - 4, 4, cx, cy - 4, 46);
      soul.addColorStop(0, 'rgba(196,181,253,.95)');
      soul.addColorStop(1, 'rgba(139,92,246,.12)');
      ctx.fillStyle = soul;
      ctx.beginPath(); ctx.ellipse(cx, cy - 4, 30, 40, 0, 0, Math.PI * 2); ctx.fill();
      eyes(ctx, cx, cy - 14, 10, 4.5, '#1e1b4b');
      // 좌우 문
      box(ctx, cx - 62, cy - 62, 62 - gap, 128, '#94a3b8', 3);
      box(ctx, cx + gap, cy - 62, 62 - gap, 128, '#94a3b8', 3);
      // 층 표시등
      ctx.fillStyle = `rgba(251,191,36,${(0.5 + 0.4 * Math.sin(t * 3)).toFixed(3)})`;
      ctx.fillRect(cx - 16, cy - 78, 32, 9);
      ctx.restore();
    },

    /* ── Lv.11 ──────────────────────────────────────── */

    /* 유리창 망령 — 금이 간 유리에 비친 얼굴 */
    windowWraith(ctx, cx, cy, t) {
      ctx.save();
      ctx.translate(0, Math.sin(t * 1.6) * 5);
      // 유리판
      const glass = ctx.createLinearGradient(cx - 56, cy - 66, cx + 56, cy + 60);
      glass.addColorStop(0, 'rgba(186,230,253,.45)');
      glass.addColorStop(1, 'rgba(59,130,246,.20)');
      ctx.fillStyle = glass;
      ctx.fillRect(cx - 56, cy - 66, 112, 126);
      ctx.strokeStyle = 'rgba(226,240,255,.55)'; ctx.lineWidth = 3;
      ctx.strokeRect(cx - 56, cy - 66, 112, 126);
      // 금
      ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - 40, cy - 60); ctx.lineTo(cx - 6, cy - 10); ctx.lineTo(cx + 34, cy - 40);
      ctx.moveTo(cx - 6, cy - 10); ctx.lineTo(cx + 8, cy + 52);
      ctx.moveTo(cx - 6, cy - 10); ctx.lineTo(cx - 48, cy + 20);
      ctx.stroke();
      // 비친 얼굴
      ctx.globalAlpha = 0.55 + 0.25 * Math.sin(t * 2.2);
      blob(ctx, cx, cy - 6, 24, 30, 'rgba(224,242,254,.9)');
      eyes(ctx, cx, cy - 12, 9, 4, '#0f172a');
      ctx.globalAlpha = 1;
      ctx.restore();
    },

    /* 기계실 철갑거인 — 두꺼운 장갑과 증기 */
    engineIronGiant(ctx, cx, cy, t) {
      ctx.save();
      ctx.translate(0, Math.sin(t * 1.2) * 3);
      // 증기
      for (let i = 0; i < 3; i += 1) {
        const p = ((t * 0.6 + i * 0.33) % 1);
        ctx.globalAlpha = (1 - p) * 0.4;
        blob(ctx, cx - 46 + i * 46, cy - 60 - p * 34, 12 + p * 16, 9 + p * 12, '#e2e8f0');
      }
      ctx.globalAlpha = 1;
      // 다리
      box(ctx, cx - 34, cy + 30, 24, 34, '#475569', 5);
      box(ctx, cx + 10, cy + 30, 24, 34, '#475569', 5);
      // 몸통 장갑
      const armor = ctx.createLinearGradient(cx - 50, cy - 40, cx + 50, cy + 40);
      armor.addColorStop(0, '#94a3b8'); armor.addColorStop(1, '#475569');
      ctx.fillStyle = armor;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(cx - 50, cy - 40, 100, 76, 12); else ctx.rect(cx - 50, cy - 40, 100, 76);
      ctx.fill();
      // 리벳
      ctx.fillStyle = '#cbd5e1';
      [[-36, -26], [36, -26], [-36, 22], [36, 22]].forEach(([dx, dy]) => {
        ctx.beginPath(); ctx.arc(cx + dx, cy + dy, 4, 0, Math.PI * 2); ctx.fill();
      });
      // 팔
      ctx.strokeStyle = '#64748b'; ctx.lineWidth = 16; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - 50, cy - 18); ctx.lineTo(cx - 76, cy + 16);
      ctx.moveTo(cx + 50, cy - 18); ctx.lineTo(cx + 76, cy + 16);
      ctx.stroke();
      // 머리
      box(ctx, cx - 22, cy - 74, 44, 34, '#64748b', 8);
      ctx.fillStyle = `rgba(255,120,60,${(0.55 + 0.4 * Math.sin(t * 3.6)).toFixed(3)})`;
      ctx.fillRect(cx - 15, cy - 62, 30, 9);
      ctx.restore();
    },

    /* ── Lv.12~14 ───────────────────────────────────── */

    /* 불길한 층간 관리자 — 층 사이에 낀 그림자 관리인 */
    ominousFloorManager(ctx, cx, cy, t) {
      ctx.save();
      ctx.translate(0, Math.sin(t * 1.5) * 5);
      // 층 경계선
      ctx.strokeStyle = 'rgba(148,163,184,.35)'; ctx.lineWidth = 3;
      [-58, 62].forEach((dy) => {
        ctx.beginPath(); ctx.moveTo(cx - 84, cy + dy); ctx.lineTo(cx + 84, cy + dy); ctx.stroke();
      });
      // 몸통(정장)
      ctx.fillStyle = '#1f2937';
      ctx.beginPath();
      ctx.moveTo(cx - 34, cy - 22); ctx.lineTo(cx + 34, cy - 22);
      ctx.quadraticCurveTo(cx + 46, cy + 30, cx + 34, cy + 58);
      ctx.lineTo(cx - 34, cy + 58);
      ctx.quadraticCurveTo(cx - 46, cy + 30, cx - 34, cy - 22);
      ctx.closePath(); ctx.fill();
      // 넥타이
      ctx.fillStyle = '#7f1d1d';
      ctx.beginPath();
      ctx.moveTo(cx, cy - 18); ctx.lineTo(cx - 7, cy - 8); ctx.lineTo(cx, cy + 32); ctx.lineTo(cx + 7, cy - 8);
      ctx.closePath(); ctx.fill();
      // 머리(그림자)
      blob(ctx, cx, cy - 44, 22, 24, '#0b1020');
      const flick = Math.sin(t * 5) > 0 ? 1 : 0.4;
      eyes(ctx, cx, cy - 46, 9, 4.5, '#fbbf24', `rgba(251,191,36,${flick})`);
      // 클립보드
      box(ctx, cx + 40, cy + 2, 26, 34, '#e2e8f0', 3);
      ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 2;
      for (let i = 0; i < 3; i += 1) {
        ctx.beginPath(); ctx.moveTo(cx + 45, cy + 10 + i * 8); ctx.lineTo(cx + 61, cy + 10 + i * 8); ctx.stroke();
      }
      ctx.restore();
    },

    /* 존재하지 않는 층의 지배자 — 공허의 균열 */
    nonexistentFloorLord(ctx, cx, cy, t) {
      ctx.save();
      // 공허
      const void_ = ctx.createRadialGradient(cx, cy, 8, cx, cy, 92);
      void_.addColorStop(0, 'rgba(2,4,10,1)');
      void_.addColorStop(0.7, 'rgba(30,10,60,.85)');
      void_.addColorStop(1, 'rgba(30,10,60,0)');
      ctx.fillStyle = void_;
      ctx.beginPath(); ctx.arc(cx, cy, 92, 0, Math.PI * 2); ctx.fill();
      // 균열
      ctx.strokeStyle = `rgba(196,181,253,${(0.5 + 0.4 * Math.sin(t * 2.4)).toFixed(3)})`;
      ctx.lineWidth = 3;
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * Math.PI * 2 + t * 0.3;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * 78, cy + Math.sin(a) * 66);
        ctx.stroke();
      }
      // 존재하지 않는 층 표시
      ctx.textAlign = 'center';
      ctx.font = 'bold 30px Jua, Noto Sans KR, system-ui';
      ctx.fillStyle = `rgba(226,232,240,${(0.6 + 0.35 * Math.sin(t * 1.8)).toFixed(3)})`;
      ctx.fillText('??', cx, cy + 10);
      // 눈
      eyes(ctx, cx, cy - 26, 20, 5, '#c4b5fd', '#e9d5ff');
      ctx.restore();
    },

    /* 옥상의 명진쌤 로봇 — 마지막 관문 */
    rooftopMyeongjinRobot(ctx, cx, cy, t) {
      ctx.save();
      ctx.translate(0, Math.sin(t * 1.1) * 4);
      ctx.scale(1.12, 1.12);
      ctx.translate(-cx * 0.107, -cy * 0.107);
      // 다리
      box(ctx, cx - 30, cy + 34, 22, 32, '#334155', 5);
      box(ctx, cx + 8, cy + 34, 22, 32, '#334155', 5);
      // 몸통
      const body = ctx.createLinearGradient(cx, cy - 40, cx, cy + 40);
      body.addColorStop(0, '#e2e8f0'); body.addColorStop(1, '#94a3b8');
      ctx.fillStyle = body;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(cx - 44, cy - 34, 88, 76, 12); else ctx.rect(cx - 44, cy - 34, 88, 76);
      ctx.fill();
      // 명찰
      box(ctx, cx - 24, cy - 18, 48, 20, '#1e3a8a', 4);
      ctx.textAlign = 'center';
      ctx.font = 'bold 13px Noto Sans KR, system-ui';
      ctx.fillStyle = '#e0f2fe';
      ctx.fillText('명진', cx, cy - 4);
      // 팔 + 레이저 지시봉
      ctx.strokeStyle = '#64748b'; ctx.lineWidth = 12; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - 44, cy - 12); ctx.lineTo(cx - 70, cy + 18);
      ctx.moveTo(cx + 44, cy - 12); ctx.lineTo(cx + 68, cy - 4);
      ctx.stroke();
      ctx.strokeStyle = `rgba(248,113,113,${(0.6 + 0.4 * Math.sin(t * 6)).toFixed(3)})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(cx + 68, cy - 4); ctx.lineTo(cx + 104, cy - 24);
      ctx.stroke();
      // 머리
      box(ctx, cx - 28, cy - 78, 56, 44, '#cbd5e1', 10);
      ctx.fillStyle = `rgba(56,189,248,${(0.6 + 0.35 * Math.sin(t * 3.2)).toFixed(3)})`;
      ctx.fillRect(cx - 20, cy - 66, 40, 14);
      // 안테나
      ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cx, cy - 78); ctx.lineTo(cx, cy - 96); ctx.stroke();
      ctx.fillStyle = `rgba(251,191,36,${(0.5 + 0.5 * Math.sin(t * 4)).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(cx, cy - 98, 6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    },

    /* 경비 로봇 — 네모난 몸통, 하나뿐인 붉은 눈, 회전하는 경광등 */
    guardBot(ctx, cx, cy, t) {
      const bob = Math.sin(t * 2.2) * 3;
      ctx.save();
      ctx.translate(cx, cy + bob);
      // 다리(바퀴)
      ctx.fillStyle = '#334155';
      ctx.beginPath(); ctx.ellipse(0, 52, 30, 12, 0, 0, Math.PI * 2); ctx.fill();
      // 몸통
      const body = ctx.createLinearGradient(-34, -20, 34, 50);
      body.addColorStop(0, '#8b9cb3'); body.addColorStop(1, '#4a5a70');
      ctx.fillStyle = body;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-34, -18, 68, 66, 12) : ctx.rect(-34, -18, 68, 66);
      ctx.fill();
      // 가슴 표시등
      ctx.fillStyle = `rgba(120,220,255,${(0.4 + 0.4 * Math.sin(t * 3)).toFixed(3)})`;
      ctx.fillRect(-14, 4, 28, 8);
      // 팔
      ctx.strokeStyle = '#64748b'; ctx.lineWidth = 9; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-34, -4); ctx.lineTo(-50, 20 + Math.sin(t * 2) * 4);
      ctx.moveTo(34, -4); ctx.lineTo(50, 20 - Math.sin(t * 2) * 4);
      ctx.stroke();
      // 머리
      ctx.fillStyle = '#94a3b8';
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-24, -52, 48, 36, 10) : ctx.rect(-24, -52, 48, 36);
      ctx.fill();
      // 외눈
      ctx.fillStyle = '#7f1d1d';
      ctx.beginPath(); ctx.arc(0, -34, 12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(255,80,80,${(0.55 + 0.45 * Math.sin(t * 4)).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(0, -34, 7, 0, Math.PI * 2); ctx.fill();
      // 경광등
      ctx.fillStyle = `rgba(255,170,60,${(0.35 + 0.5 * Math.abs(Math.sin(t * 3.4))).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(0, -58, 7, Math.PI, Math.PI * 2); ctx.fill();
      ctx.restore();
    },

    /* 사무실 유령 — 반투명한 몸, 흩날리는 서류, 넥타이 */
    officeGhost(ctx, cx, cy, t) {
      const float = Math.sin(t * 1.6) * 7;
      ctx.save();
      ctx.translate(cx, cy + float);
      // 흩날리는 서류
      for (let i = 0; i < 5; i += 1) {
        const a = t * 1.1 + i * 1.26;
        ctx.save();
        ctx.translate(Math.cos(a) * 56, Math.sin(a * 1.3) * 34 - 6);
        ctx.rotate(a);
        ctx.fillStyle = 'rgba(240,246,255,.75)';
        ctx.fillRect(-8, -10, 16, 20);
        ctx.strokeStyle = 'rgba(120,140,170,.6)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(-5, -4); ctx.lineTo(5, -4); ctx.moveTo(-5, 1); ctx.lineTo(5, 1); ctx.stroke();
        ctx.restore();
      }
      // 몸통(아래가 흩어지는 유령 형태)
      const g = ctx.createLinearGradient(0, -46, 0, 54);
      g.addColorStop(0, 'rgba(214,232,255,.95)');
      g.addColorStop(1, 'rgba(150,180,220,.25)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-30, 20);
      ctx.quadraticCurveTo(-34, -46, 0, -46);
      ctx.quadraticCurveTo(34, -46, 30, 20);
      for (let i = 0; i < 4; i += 1) {
        const x0 = 30 - i * 15;
        ctx.quadraticCurveTo(x0 - 7, 44 + Math.sin(t * 3 + i) * 7, x0 - 15, 22);
      }
      ctx.closePath(); ctx.fill();
      // 눈
      ctx.fillStyle = '#1e293b';
      ctx.beginPath(); ctx.ellipse(-10, -24, 4.5, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(10, -24, 4.5, 7, 0, 0, Math.PI * 2); ctx.fill();
      // 넥타이
      ctx.fillStyle = '#b91c1c';
      ctx.beginPath();
      ctx.moveTo(0, -8); ctx.lineTo(-6, 0); ctx.lineTo(0, 26); ctx.lineTo(6, 0);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    },

    /* 정전 그림자 — 검은 덩어리에서 번지는 어둠과 번쩍이는 눈 */
    blackoutShade(ctx, cx, cy, t) {
      ctx.save();
      ctx.translate(cx, cy);
      // 퍼지는 어둠
      const dark = ctx.createRadialGradient(0, 0, 6, 0, 0, 76);
      dark.addColorStop(0, 'rgba(10,12,20,.95)');
      dark.addColorStop(1, 'rgba(10,12,20,0)');
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.arc(0, 0, 76, 0, Math.PI * 2); ctx.fill();
      // 일렁이는 몸
      ctx.fillStyle = '#0b1020';
      ctx.beginPath();
      for (let i = 0; i <= 24; i += 1) {
        const a = (i / 24) * Math.PI * 2;
        const r = 40 + Math.sin(a * 3 + t * 2.6) * 8 + Math.cos(a * 5 - t * 1.7) * 5;
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r * 0.92;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill();
      // 번쩍이는 눈 두 쌍
      const flash = Math.sin(t * 7) > 0.1 ? 1 : 0.25;
      ctx.fillStyle = `rgba(180,230,255,${(0.85 * flash).toFixed(3)})`;
      [[-14, -10], [14, -10], [-8, 8], [8, 8]].forEach(([ex, ey], i) => {
        const s = i < 2 ? 5 : 3;
        ctx.beginPath(); ctx.ellipse(ex, ey, s, s * 0.6, 0, 0, Math.PI * 2); ctx.fill();
      });
      ctx.restore();
    },

    /* 63빌딩 관리자 — 커다란 몸에 왕관, 빌딩 모양 지팡이 */
    towerWarden(ctx, cx, cy, t) {
      const bob = Math.sin(t * 1.4) * 4;
      ctx.save();
      ctx.translate(cx, cy + bob);
      ctx.scale(1.18, 1.18);
      // 망토
      ctx.fillStyle = '#3b1d4d';
      ctx.beginPath();
      ctx.moveTo(-26, -20);
      ctx.quadraticCurveTo(-58, 20, -40, 54);
      ctx.lineTo(40, 54);
      ctx.quadraticCurveTo(58, 20, 26, -20);
      ctx.closePath(); ctx.fill();
      // 몸통
      const body = ctx.createLinearGradient(0, -26, 0, 50);
      body.addColorStop(0, '#6d5b8f'); body.addColorStop(1, '#332748');
      ctx.fillStyle = body;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-26, -22, 52, 72, 14) : ctx.rect(-26, -22, 52, 72);
      ctx.fill();
      // 가슴의 63
      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 17px Jua, Noto Sans KR, system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('63', 0, 14);
      // 얼굴
      ctx.fillStyle = '#1f1730';
      ctx.beginPath(); ctx.arc(0, -40, 19, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(251,191,36,${(0.6 + 0.4 * Math.sin(t * 3.2)).toFixed(3)})`;
      ctx.beginPath(); ctx.ellipse(-7, -42, 4.5, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(7, -42, 4.5, 6, 0, 0, Math.PI * 2); ctx.fill();
      // 왕관
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.moveTo(-18, -56); ctx.lineTo(-12, -70); ctx.lineTo(-6, -58);
      ctx.lineTo(0, -74); ctx.lineTo(6, -58); ctx.lineTo(12, -70); ctx.lineTo(18, -56);
      ctx.closePath(); ctx.fill();
      // 빌딩 모양 지팡이
      ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(38, 50); ctx.lineTo(38, -30); ctx.stroke();
      ctx.fillStyle = '#64748b';
      ctx.fillRect(30, -54, 16, 26);
      ctx.fillStyle = `rgba(255,214,120,${(0.5 + 0.4 * Math.sin(t * 2.5)).toFixed(3)})`;
      for (let r = 0; r < 3; r += 1) {
        for (let c = 0; c < 2; c += 1) ctx.fillRect(33 + c * 6, -50 + r * 8, 4, 5);
      }
      ctx.restore();
    },
  };

  /* ---------- 던전 음악 ---------- */

  /* 던전 안에 있는 동안 전용 음악을 반복 재생한다.
     기존 BGM 선택기(getDesiredAudioFile)를 감싸서, 던전 맵일 때만 우리 파일을 고르게 한다.
     syncAudioFileBgm도 감싸야 나머지 곡이 제대로 멈춘다. */
  function ensureDungeonAudio() {
    const g = G();
    if (!g || !g.audio) return null;
    if (!g.audio.raidDungeonFile) {
      const src = global.getAudioAsset?.('dungeonBgm')?.src || '';
      if (!src || typeof global.Audio !== 'function') return null;
      const file = new global.Audio(src);
      file.loop = true;
      file.preload = 'auto';
      file.volume = g.settings?.bgmEnabled ? Math.min(1, Math.max(0, g.settings.bgmVolume)) : 0;
      g.audio.raidDungeonFile = file;
    }
    return g.audio.raidDungeonFile;
  }

  function installDungeonAudio() {
    if (typeof global.getDesiredAudioFile === 'function' && !global.__RAID_BGM_V1__) {
      global.__RAID_BGM_V1__ = true;
      const previousDesired = global.getDesiredAudioFile;
      global.getDesiredAudioFile = function getDesiredAudioFileWithRaid() {
        const g = G();
        if (g && g.currentMap === MAP_KEY) {
          if (!g.settings?.bgmEnabled) return null;
          const file = ensureDungeonAudio();
          if (file) return file;
        }
        return previousDesired();
      };

      const previousSync = global.syncAudioFileBgm;
      if (typeof previousSync === 'function') {
        global.syncAudioFileBgm = function syncAudioFileBgmWithRaid() {
          previousSync();
          const g = G();
          const file = g?.audio?.raidDungeonFile;
          if (!file) return;
          const desired = global.getDesiredAudioFile();
          file.volume = g.settings?.bgmEnabled ? Math.min(1, Math.max(0, g.settings.bgmVolume)) : 0;
          if (file === desired) file.play?.().catch?.(() => {});
          else file.pause?.();
        };
      }
    }
  }

  /* ---------- 던전에 갇히지 않게 하는 안전장치 ----------

     던전은 한 판 도는 동안만 머무는 곳이다. 그런데 던전 안에서 게임을 끄면
     저장된 맵이 raidTower로 남아, 다시 접속했을 때 아무것도 할 수 없는 곳에
     갇힌다. 아래 세 겹으로 막는다.
       1) 애초에 raidTower를 저장하지 않는다 (근본 차단)
       2) 그래도 던전에서 시작하게 되면 자동으로 마을로 내보낸다 (안전망)
       3) 던전 안에서 언제든 마을로 나갈 수 있는 버튼을 둔다 (사용자 탈출구) */

  function installStuckGuards() {
    if (global.__RAID_STUCK_GUARD_V1__) return;
    global.__RAID_STUCK_GUARD_V1__ = true;

    // 1) 저장에는 던전이 아니라 돌아갈 곳을 남긴다.
    if (typeof global.savePlayer === 'function') {
      const previousSave = global.savePlayer;
      global.savePlayer = function savePlayerWithoutRaidMap() {
        const g = G();
        const player = g?.player;
        if (player && player.map === MAP_KEY) {
          const safe = (returnMap && returnMap !== MAP_KEY) ? returnMap : 'town';
          const spawn = (global.YuksamData?.worldDefs || {})[safe]?.playerSpawn;
          player.map = safe;
          if (returnPos) { player.x = returnPos.x; player.y = returnPos.y; }
          else if (spawn) { player.x = spawn.x; player.y = spawn.y; }
        }
        return previousSave.apply(this, arguments);
      };
    }

    // 2) 그래도 던전에서 시작했다면 조용히 마을로 되돌린다.
    if (typeof global.showScreen === 'function') {
      const previousShowScreen = global.showScreen;
      global.showScreen = function showScreenWithRaidGuard(name) {
        const result = previousShowScreen.apply(this, arguments);
        if (name === 'game') global.setTimeout(rescueIfStranded, 0);
        return result;
      };
    }

    // 3) 마을 귀환 버튼이 눌렸을 때 던전 상태도 함께 정리한다.
    if (typeof global.returnTown === 'function') {
      const previousReturnTown = global.returnTown;
      global.returnTown = function returnTownWithRaidCleanup() {
        abandonRun();
        return previousReturnTown.apply(this, arguments);
      };
    }
  }

  /* 한 판이 돌고 있지 않은데 던전에 서 있으면 갇힌 것이다. */
  function rescueIfStranded() {
    const g = G();
    if (!g || g.currentMap !== MAP_KEY || active || networkSession) return;
    const worlds = global.YuksamData?.worldDefs || {};
    g.currentMap = 'town';
    if (g.player) {
      g.player.map = 'town';
      const spawn = worlds.town?.playerSpawn || { x:1190, y:1060 };
      g.player.x = spawn.x;
      g.player.y = spawn.y;
    }
    toggleReturnButton(false);
    call('updateHud');
    call('savePlayer');
    call('syncAudioFileBgm');
    call('appendChatMessage', 'system', '63빌딩 던전', '던전 밖으로 나와 마을에서 다시 시작합니다.');
  }

  /* 진행 중이던 판을 버린다(연출 중이어도 안전하게 멈춘다). */
  function abandonRun() {
    stopFormationAnimation();
    stopRaidQuestionTimer();
    const session = networkSession;
    if (session) {
      try { session.client.leave(session.room.id).catch?.(() => {}); } catch (_) {}
      resetNetworkSession();
    }
    active = null;
    question = null;
    busy = false;
    walkProgress = 1;
    raidPetAnchor = null;
  }

  function toggleReturnButton(show) {
    const button = global.document.getElementById('returnTownBtn');
    if (button) button.classList.toggle('hidden', !show);
  }

  /* 던전 화면 안에서 쓰는 탈출 버튼. */
  function leaveDungeonNow() {
    if (networkSession) {
      leaveNetworkRoom({ returnToTown:true });
      return;
    }
    abandonRun();
    call('closeModal');
    leaveDungeonMap();
  }

  /* 실수로 눌러 판을 날리지 않도록 한 번 물어본다. */
  function confirmGiveUp() {
    const openModal = global.openModal;
    if (typeof openModal !== 'function') { leaveDungeonNow(); return; }
    const snapshot = active ? active.snapshot() : null;
    openModal(`
      <h2>포기</h2>
      <div class="panel-card">
        <p>정말로 포기하시겠습니까?</p>
        <p class="raid-hint">${esc(snapshot?.title || '이번 층')}의 진행이 사라지고, 보상 없이 마을로 돌아갑니다.</p>
        <div class="action-row">
          <button class="primary" id="raidGiveUpYes">예, 포기합니다</button>
          <button class="ghost" id="raidGiveUpNo">아니오</button>
        </div>
      </div>
    `, { type:'raidGiveUp', pause:true });

    const yes = global.document.getElementById('raidGiveUpYes');
    const no = global.document.getElementById('raidGiveUpNo');
    if (yes) yes.onclick = () => leaveDungeonNow();
    if (no) {
      no.onclick = () => {
        // 전투로 되돌아간다. 행동 메뉴부터 다시 고르게 한다.
        if (!active) { leaveDungeonNow(); return; }
        busy = false;
        panelMode = 'menu';
        panelMessage = '무엇을 할까?';
        renderBattle();
      };
    }
  }

  /* 던전 맵을 화면 전체 렌더러로 등록한다(마을이 아닌 완전히 다른 장소). */
  function installDungeonRenderer() {
    const pipeline = (typeof worldRenderPipeline !== 'undefined') ? worldRenderPipeline : null;
    if (!pipeline || typeof pipeline.registerOwner !== 'function') return;
    ensureDungeonMap();
    pipeline.registerOwner({
      id:'raid-tower-map-v1',
      priority:420,
      owns:({ map }) => map === MAP_KEY,
      render:() => drawDungeon(),
    });
  }


  installDungeonRenderer();
  installDungeonAudio();
  installStuckGuards();

  global.YuksamRaidRunUi = Object.freeze({
    openNetworkLobby,
    isRunning:() => !!active,
    /* 전투 로그를 재생하는 중인지. 재생 중에는 다음 답을 받지 않는다. */
    isBusy:() => busy,
    /* 던전에서 나가기(진행 포기). 갇힘 방지용 탈출구. */
    leaveNow:() => leaveDungeonNow(),
    rescueIfStranded:() => rescueIfStranded(),
    /* 전투 로그 재생 속도(밀리초). 검사에서는 빠르게 돌린다. */
    setLogSpeed:(ms) => {
      logSpeedOverride = Math.max(0, Number(ms) || 0);
      eventDelayMs = logSpeedOverride;
    },
    /* 이동 연출 상태(검사용) — 배경이 얼마나 흘렀는지, 조우 연출이 어디까지 왔는지 */
    travelScrollForTest:() => travelScroll(),
    encounterProgressForTest:() => encounterProgress(),
    displayFloorForTest:(snapshot, progress) => displayFloorForProgress(snapshot, progress),
    petAnchorForTest:() => (raidPetAnchor ? { ...raidPetAnchor } : null),
    /* 이동 연출 길이(밀리초). 검사에서는 짧게 줄여 빠르게 돌린다. */
    /* 준비 카운트다운 길이(검사에서 짧게 줄이려고 연다). */
    setCountdownSpeed:(seconds, stepMs) => {
      READY_COUNTDOWN = Math.max(1, Number(seconds) || 1);
      COUNTDOWN_STEP_MS = Math.max(1, Number(stepMs) || 1);
    },
    setTravelSpeed:(walkMs, encounterMs) => {
      WALK_MS = Math.max(1, Number(walkMs) || 1);
      ENCOUNTER_MS = Math.max(1, Number(encounterMs) || 1);
    },
    /* 검사에서 쓰려고 지금 상태를 들여다볼 수 있게 열어 둔다. */
    peek:() => (active ? active.snapshot() : null),
    currentQuestion:() => question,
    submitAnswerForTest:(value) => submitAnswer(value),
    playbackReadyForTest:(round, session) => allMembersFinishedPlayback(round, session),
    questionGateDecisionForTest:(state) => networkQuestionGateDecision(state),
    questionWaitMessageForTest:(state) => networkQuestionWaitMessage(state),
    nextPlanHintForTest:(monster, plan) => nextPlanHint(monster, plan),
    nextPlanHintHtmlForTest:(hint) => nextPlanHintHtml(hint),
    memberStatusBadgesHtmlForTest:(member) => memberStatusBadgesHtml(member),
    monsterStatusBadgesHtmlForTest:(monster) => monsterStatusBadgesHtml(monster),
    displayPartyMembersForTest:(members, hpById) => displayPartyMembers(members, hpById),
  });
})(typeof window !== 'undefined' ? window : globalThis);
