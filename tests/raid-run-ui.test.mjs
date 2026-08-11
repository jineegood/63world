import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync as readFileRaw } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const read = (name) => readFileRaw(join(root, name), 'utf8').replace(/\r\n/g, '\n');
const uiSource = read('src/raid-run-ui.js');
const entrySource = read('src/raid-entry-ui.js');
const dungeonSource = read('src/raid-dungeon.js');
const rulesSource = read('src/raid-rules.js');
const runSource = read('src/raid-run.js');
const combatSource = read('src/raid-combat-rules.js');
const htmlSource = read('index.html');
const styleSource = read('style.css');
const gameSource = read('game.js');
const multiplayerSource = read('src/multiplayer.js');

function networkUiHarness({ mode = 'create', identityUserId = 'alice' } = {}) {
  const calls = [];
  const styles = new Map();
  let html = '';
  const room = {
    id:'room-1', code:'0427', hostId:'alice', floorGroup:1, phase:'lobby',
    encounterIndex:0, currentFloor:1, round:0,
  };
  const members = [{
    roomId:'room-1', userId:'alice', joinOrder:1, slot:null, ready:false, active:true,
    profile:{ userId:'alice', name:'앨리스', className:'warrior', spec:'무기', level:5, maxHp:42, attack:9 },
    state:{ hp:42, maxHp:42, shield:0, cooldowns:{}, statuses:{} },
  }];
  const response = { room, members, events:[] };
  const partyClient = {
    async create(options) { calls.push(['create', options]); return structuredClone(response); },
    async join(options) { calls.push(['join', options]); return structuredClone(response); },
    async sync() { calls.push(['sync']); return structuredClone(response); },
    async start(roomId) {
      calls.push(['start', roomId]);
      room.phase = 'travel';
      return structuredClone(response);
    },
    subscribe(roomId, listener, onReady) {
      calls.push(['subscribe', roomId, listener, onReady]);
      return () => calls.push(['unsubscribe', roomId]);
    },
    async heartbeat() { return structuredClone(response); },
    async ackPlayback(roomId, round) {
      calls.push(['ackPlayback', roomId, round]);
      const mine = members.find((member) => member.userId === identityUserId);
      if (mine) mine.playbackRound = Math.max(Number(mine.playbackRound) || 0, Number(round) || 0);
      return structuredClone(response);
    },
    async leave() { calls.push(['leave']); return { left:true }; },
  };
  const game = { modalState:null, player:{ name:'앨리스' } };
  const document = {
    head:{ appendChild(node) { styles.set(node.id, node); } },
    createElement() { return { id:'', textContent:'' }; },
    getElementById(id) { return styles.get(id) || null; },
    querySelectorAll() { return []; },
    querySelector() { return null; },
  };
  const context = {
    console,
    game,
    document,
    performance:{ now:() => 100 },
    setTimeout,
    clearTimeout,
    setInterval(callback, milliseconds) { calls.push(['interval', milliseconds, callback]); return 11; },
    clearInterval(id) { calls.push(['clearInterval', id]); },
    openModal(nextHtml, options) {
      html = nextHtml;
      game.modalState = { type:options?.type || '', pause:options?.pause === true };
      calls.push(['modal', options?.type]);
    },
    closeModal() { calls.push(['closeModal']); },
    async flushLocalPlayerForPvpV1() { calls.push(['flush']); },
    getPvpIdentityV1:() => ({ userId:identityUserId, displayName:'앨리스', role:'student' }),
    playSfx(name) { calls.push(['sfx', name]); },
    secureStudentAccessV2:{ getClient:() => ({ fake:true }) },
    YuksamRaidPartyClient:{ create:() => partyClient },
    YuksamRaidRules:{
      SLOTS:Object.freeze(['front', 'middle', 'back']),
      slotLabel:(slot) => ({ front:'앞', middle:'가운데', back:'뒤' })[slot] || slot,
    },
    YuksamRaidRun:{},
    YuksamCore:{ escapeHtml:(value) => String(value), normalize:(value) => String(value ?? '').trim() },
  };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(uiSource, context, { filename:'raid-run-ui.js' });
  return { context, calls, partyClient, room, members, html:() => html, mode };
}

function fillReadyNetworkRoster(harness) {
  harness.members[0].slot = 'front';
  harness.members[0].ready = true;
  harness.members.push(
    {
      roomId:'room-1', userId:'bob', joinOrder:2, slot:'middle', ready:true, active:true,
      profile:{ userId:'bob', name:'보라', className:'mage', spec:'원소', level:6, maxHp:38, attack:11 },
      state:{ hp:38, maxHp:38, shield:0, cooldowns:{}, statuses:{} },
    },
    {
      roomId:'room-1', userId:'carol', joinOrder:3, slot:'back', ready:true, active:true,
      profile:{ userId:'carol', name:'초록', className:'priest', spec:'신성', level:5, maxHp:40, attack:8 },
      state:{ hp:40, maxHp:40, shield:0, cooldowns:{}, statuses:{} },
    },
  );
}

test('온라인 던전 모듈은 의존 순서대로 로드된다', () => {
  const files = [
    'src/raid-party-client.js',
    'src/raid-combat-rules.js',
    'src/raid-rules.js',
    'src/raid-run.js',
    'src/raid-run-ui.js',
    'src/raid-entry-ui.js',
    'src/raid-dungeon.js',
  ];
  const positions = files.map((name) => htmlSource.indexOf(`<script src="${name}"></script>`));
  assert.ok(positions.every((position) => position >= 0), '온라인 던전 스크립트가 모두 index.html에 있어야 한다');
  for (let index = 1; index < positions.length; index += 1) {
    assert.ok(positions[index] > positions[index - 1], `${files[index]}의 로드 순서가 잘못됐다`);
  }
});

test('화면은 피해 판정을 재정의하지 않고 진행·전투 규칙에 맡긴다', () => {
  assert.doesNotMatch(uiSource, /DAMAGE_TAKEN\s*=/);
  assert.doesNotMatch(uiSource, /CRIT_CHANCE\s*=|CRIT_MULTIPLIER\s*=|MISS_CHANCE\s*=/);
  assert.doesNotMatch(uiSource, /HEAL_RATIO\s*=|TRAVEL_RECOVERY\s*=/);
  assert.match(uiSource, /active\.resolveRound\(submissions, \{ forceMonsterDefeat:teacherKill \}\)/);
  assert.match(uiSource, /teacherKillRound/);
  /* 던전은 셋이 함께 하는 기능뿐이라 답 제출도 반드시 방을 거친다.
     혼자 도는 경로(NPC 동료 둘)는 게임에서 쓰이지 않아 걷어냈다. */
  assert.match(uiSource, /if \(busy \|\| !active \|\| active\.phase !== 'battle' \|\| !networkSession(?: \|\| teacherPaused\(\))?\) return;/);
  assert.doesNotMatch(uiSource, /rollAllyAnswers|buildParty|startRun|soloMode/);
  assert.match(runSource, /R\.resolvePartyCombatRound\(/);
  assert.match(rulesSource, /global\.YuksamRaidCombatRules/);
});

test('던전 스타일은 전용 style 태그로만 추가한다', () => {
  assert.doesNotMatch(styleSource, /raid-room-member|raid-party-hp|raid-status-badge/);
  assert.match(uiSource, /style\.id = 'raidRunStylesV1'/);
  assert.match(entrySource, /style\.id = 'raidEntryStylesV1'/);
});

test('던전 문은 예전 1층 연습 버튼이 아니라 방 생성·코드 입력 화면을 연다', () => {
  const block = dungeonSource.match(/function openTowerEntrance\(\) \{[\s\S]*?\n  \}/)?.[0] || '';
  assert.notEqual(block, '');
  assert.match(block, /global\.YuksamRaidEntryUi/);
  assert.match(block, /entryUi\.open\(\)/);
  assert.doesNotMatch(block, /startRun|raidEnterFloor1Btn|혼자/);
  assert.match(entrySource, /mode:'create'/);
  assert.match(entrySource, /mode:'join'/);
});

test('openNetworkLobby는 방 생성과 참가를 서버 클라이언트에 연결한다', async () => {
  const created = networkUiHarness();
  assert.equal(typeof created.context.YuksamRaidRunUi.openNetworkLobby, 'function');
  assert.equal(await created.context.YuksamRaidRunUi.openNetworkLobby({ mode:'create', floorGroup:1 }), true);
  const createCall = created.calls.find(([kind]) => kind === 'create');
  assert.equal(createCall?.[0], 'create');
  assert.equal(createCall?.[1]?.floorGroup, 1);
  assert.ok(created.calls.some(([kind, roomId]) => kind === 'subscribe' && roomId === 'room-1'));
  assert.match(created.html(), /초대 코드/);
  assert.match(created.html(), /0427/);
  assert.match(created.html(), /1 \/ 3명/);
  assert.equal((created.html().match(/친구를 기다리는 중/g) || []).length, 2);

  const joined = networkUiHarness({ mode:'join' });
  assert.equal(await joined.context.YuksamRaidRunUi.openNetworkLobby({ mode:'join', code:'0427' }), true);
  const joinCall = joined.calls.find(([kind]) => kind === 'join');
  assert.equal(joinCall?.[0], 'join');
  assert.equal(joinCall?.[1]?.code, '0427');
});

test('자리 미정인 실제 세 명은 모두 대기칸에 보이고 같은 가운데 칸에 겹치지 않는다', async () => {
  const lobby = networkUiHarness();
  lobby.members.push(
    {
      roomId:'room-1', userId:'bob', joinOrder:2, slot:null, ready:false, active:true,
      profile:{ userId:'bob', name:'보라', className:'mage', spec:'원소', level:6, maxHp:38, attack:11 },
      state:{ hp:38, maxHp:38, shield:0, cooldowns:{}, statuses:{} },
    },
    {
      roomId:'room-1', userId:'carol', joinOrder:3, slot:null, ready:false, active:true,
      profile:{ userId:'carol', name:'초록', className:'priest', spec:'신성', level:5, maxHp:40, attack:8 },
      state:{ hp:40, maxHp:40, shield:0, cooldowns:{}, statuses:{} },
    },
  );

  assert.equal(await lobby.context.YuksamRaidRunUi.openNetworkLobby({ mode:'create', floorGroup:1 }), true);
  const rendered = lobby.html();
  assert.equal((rendered.match(/class="raid-bench-card/g) || []).length, 3);
  assert.match(rendered, /앨리스 \(나\)/);
  assert.match(rendered, /보라/);
  assert.match(rendered, /초록/);
  assert.doesNotMatch(rendered, /모두 자리를 정했습니다/);
  assert.match(rendered, /id="raidSaveFormationBtn" disabled/);
});

test('대기실 파란 테두리는 내 캐릭터 표시이고 점선은 쓰지 않는다', () => {
  // 각자 자기 화면에서 자기 캐릭터만 파랗게 보인다(방장 고정이 아니다).
  assert.match(uiSource, /isMine\(member\) \? ' mine' : ''/);
  assert.match(uiSource, /\.raid-post\.filled\.mine,\s*\n\s*\.raid-post\.filled\.on\{border-color:#38bdf8/);
  // 방장은 왕관으로만 구분한다.
  assert.match(uiSource, /raid-host-crown[^>]*>👑 방장/);
  // 대기실 카드에는 점선을 쓰지 않는다(제작자 요청).
  const lobbyStyles = uiSource.match(/\.raid-post\.filled[\s\S]*?\.raid-bench-empty/)?.[0] || '';
  assert.notEqual(lobbyStyles, '');
  assert.doesNotMatch(lobbyStyles, /dashed/, '대기실 카드에 점선이 남아 있으면 안 된다');
});

test('던전 모달은 공용 X를 숨기고 방 나가기·포기 버튼을 사용한다', () => {
  assert.match(uiSource, /#modal:has\(#modalContent \[class\*="raid-"\]\)[\s\S]*?#modalClose\{display:none!important\}/);
  assert.match(uiSource, /id="raidNetworkLeaveBtn">방 나가기/);
  assert.match(uiSource, /data-raid-menu="giveup">포기/);
});

test('온라인 대기실은 정확히 세 명·대형 저장·전원 준비 후 자동 출발한다', () => {
  const block = uiSource.match(/function renderNetworkLobby\([\s\S]*?\n  \}\n\n  function isNetworkHost/)?.[0] || '';
  assert.notEqual(block, '');
  assert.match(block, /roster\.length === 3 && R\.SLOTS\.every/);
  assert.match(block, /roster\.length === 3 && roster\.every\(\(member\) => rowById\(member\.id\)\?\.ready === true\)/);
  assert.match(block, /id="raidSaveFormationBtn"/);
  assert.match(block, /networkSession\.client\.setFormation/);
  assert.match(block, /networkSession\.client\.ready/);
  // 구간을 못 연 사람이 있으면 카운트다운도 시작하지 않는다.
  assert.match(block, /syncNetworkLobbyCountdown\(savedFormation && allReady && partyUnlocked && partyDiverse\)/);
  assert.match(block, /partyUnlockState\(\)/);
  assert.doesNotMatch(block, /raidNetworkStartBtn|3명 출발!/);
  assert.match(uiSource, /if \(isNetworkHost\(\)\) startNetworkRoomAfterCountdown\(\)/);
  assert.match(uiSource, /session\.client\.start\(session\.room\.id\)/);
});

test('전원 준비 카운트다운은 모두에게 들리고 방장만 0에 서버 출발을 요청한다', async () => {
  const host = networkUiHarness();
  fillReadyNetworkRoster(host);
  host.context.YuksamRaidRunUi.setCountdownSpeed(5, 1);
  assert.equal(await host.context.YuksamRaidRunUi.openNetworkLobby({ mode:'create', floorGroup:1 }), true);
  assert.match(host.html(), /👑 방장/);
  assert.match(host.html(), /5초 후 출발!/);
  assert.doesNotMatch(host.html(), /3명 출발!/);
  await new Promise((resolve) => setTimeout(resolve, 90));
  assert.equal(host.calls.filter(([kind]) => kind === 'start').length, 1);
  assert.equal(host.calls.filter(([kind, name]) => kind === 'sfx' && name === 'open').length, 5);

  const guest = networkUiHarness({ mode:'join', identityUserId:'bob' });
  fillReadyNetworkRoster(guest);
  guest.context.YuksamRaidRunUi.setCountdownSpeed(5, 1);
  assert.equal(await guest.context.YuksamRaidRunUi.openNetworkLobby({ mode:'join', code:'0427' }), true);
  assert.match(guest.html(), /5초 후 출발!/);
  await new Promise((resolve) => setTimeout(resolve, 90));
  assert.equal(guest.calls.filter(([kind]) => kind === 'start').length, 0);
  assert.equal(guest.calls.filter(([kind, name]) => kind === 'sfx' && name === 'open').length, 5);
});

test('준비 취소가 동기화되면 진행 중이던 자동 출발 카운트다운도 취소된다', async () => {
  const host = networkUiHarness();
  fillReadyNetworkRoster(host);
  host.context.YuksamRaidRunUi.setCountdownSpeed(5, 4);
  assert.equal(await host.context.YuksamRaidRunUi.openNetworkLobby({ mode:'create', floorGroup:1 }), true);
  host.members[2].ready = false;
  const realtimeListener = host.calls.find(([kind]) => kind === 'subscribe')?.[2];
  realtimeListener?.();
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(host.calls.filter(([kind]) => kind === 'start').length, 0);
  assert.doesNotMatch(host.html(), /초 후 출발!/);
});

test('full lobby formation can swap two occupied seats without resetting the draft', () => {
  assert.match(uiSource, /data-network-slot="\$\{slot\}">이 자리로<\/button>/);
  assert.match(uiSource, /const occupant = inSlot\(targetSlot\)/);
  assert.match(uiSource, /networkDraftPlacement\[occupant\.id\] = networkDraftPlacement\[selected\.id\] \|\| null/);
  assert.match(uiSource, /networkDraftPlacement\[selected\.id\] = targetSlot/);
  assert.doesNotMatch(uiSource, /if \(member\.slot\) networkDraftPlacement\[member\.id\] = member\.slot/);
});

test('shield charge uses close-range travel motion in dungeon and PVP', () => {
  assert.match(uiSource, /const profile = partyAttackFxProfile\(event\)/);
  assert.match(uiSource, /profile\?\.motionTravelPct/);
  assert.match(styleSource, /\.combat-player\.combat-fx-motion-shield-charge/);
  assert.match(styleSource, /\.pvp-combat-stage-v2 \.combat-monster\.combat-fx-motion-shield-charge/);
});

test('teacher pause freezes the whole dungeon UI and resumes from the server state', () => {
  assert.match(uiSource, /function teacherPaused\(session = networkSession\)/);
  assert.match(uiSource, /type:'raidTeacherPause'/);
  assert.match(uiSource, /if \(teacherPaused\(networkSession\)\) \{[\s\S]*?showTeacherPauseScreen\(\);[\s\S]*?return;/);
  assert.match(uiSource, /if \(teacherPaused\(\)\) \{[\s\S]*?setTimeout\(step, 150\)/);
  assert.match(uiSource, /function updatePausedClock|const updatePausedClock/);
  assert.match(uiSource, /walkStartedAt \+= pausedFor/);
  assert.match(uiSource, /isTeacherPaused:\(\) => teacherPaused\(\)/);
  assert.match(uiSource, /function setTeacherPauseAudio\(paused\)/);
  assert.match(uiSource, /entry\?\.loop === true && typeof entry\.pause === 'function'/);
  assert.match(uiSource, /audio\?\.ctx\?\.suspend\?\.\(\)/);
  assert.match(uiSource, /audio\?\.ctx\?\.resume\?\.\(\)/);
  assert.match(uiSource, /setTeacherPauseAudio\(true\)/);
  assert.match(uiSource, /setTeacherPauseAudio\(false\)/);
});

test('같은 전문화 세 명은 준비할 수 없고 자동 출발도 시작되지 않는다', async () => {
  const host = networkUiHarness();
  fillReadyNetworkRoster(host);
  for (const member of host.members) {
    member.profile.className = 'warrior';
    member.profile.spec = '무기';
  }
  host.context.YuksamRaidRunUi.setCountdownSpeed(2, 1);
  assert.equal(await host.context.YuksamRaidRunUi.openNetworkLobby({ mode:'create', floorGroup:1 }), true);

  assert.match(host.html(), /더 다양한 직업군으로 파티를 구성해야 합니다!/);
  assert.match(host.html(), /id="raidReadyBtn" disabled>준비 불가<\/button>/);
  assert.doesNotMatch(host.html(), /초 후 출발!/);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(host.calls.filter(([kind]) => kind === 'start').length, 0);
  assert.equal(host.calls.filter(([kind, name]) => kind === 'sfx' && name === 'open').length, 0);
});

test('대기 캐릭터 카드에서 근거가 불분명한 공격 숫자를 보여주지 않는다', () => {
  const block = uiSource.match(/function renderNetworkLobby\([\s\S]*?\n  \}\n\n  function isNetworkHost/)?.[0] || '';
  assert.match(block, /Lv\.\$\{member\.level\}/);
  assert.match(block, /HP \$\{member\.maxHp\}/);
  assert.doesNotMatch(block, /공격\s*\$\{member\.attack\}|ATK\s*\$\{member\.attack\}/);
});

test('Realtime 알림과 heartbeat는 모두 같은 sync 경로로 방 상태를 갱신한다', () => {
  assert.match(uiSource, /session\.client\.subscribe\(session\.room\.id, \(\) => refreshNetworkRoom\(\), refreshNetworkRoom\)/);
  assert.match(uiSource, /session\.client\.sync\(session\.room\.id, session\.lastSequence \|\| 0\)/);
  assert.match(uiSource, /session\.client\.heartbeat\(session\.room\.id, session\.lastSequence \|\| 0\)/);
  assert.match(uiSource, /global\.setInterval\([\s\S]*?, 3000\)/);
  assert.match(uiSource, /stopNetworkTransport\(\)/);
});

test('늦게 도착한 옛 방 상태와 결과 재전송이 체력을 두 번 바꾸지 않는다', () => {
  assert.match(uiSource, /incomingVersion < currentVersion/);
  assert.match(uiSource, /if \(!staleSnapshot && incomingRoom\) networkSession\.room = incomingRoom/);
  assert.match(uiSource, /if \(networkRefreshPending\) \{[\s\S]*networkRefreshAgain = true/);
  assert.match(uiSource, /while \(networkSession === session && networkRefreshAgain\)/);
  assert.match(uiSource, /session\.pendingRoundPublishes\.get\(round\)/);
  assert.match(uiSource, /requestId:`raid-publish-\$\{session\.room\.id\}-\$\{round\}`/);
  assert.match(uiSource, /pending\.result,[\s\S]*pending\.requestId/);
});

test('세 명이 전투 로그를 모두 본 뒤에만 다음 문제나 복도로 넘어간다', () => {
  assert.match(uiSource, /function acknowledgeNetworkPlayback\(round\)/);
  assert.match(uiSource, /session\.client\.ackPlayback\(session\.room\.id, safeRound/);
  assert.match(uiSource, /function allMembersFinishedPlayback\(round, session = networkSession\)/);
  assert.match(uiSource, /terminal \? members\.length > 0 : members\.length === 3/);
  assert.match(uiSource, /panelMessage = '서버 대기중…'/);
  assert.doesNotMatch(uiSource, /친구들의 전투 연출이 끝나기를 기다리는 중/);
  assert.match(uiSource, /if \(!allMembersFinishedPlayback\(round, session\)\) \{/);
});

test('대기 화면에서 새 question으로 바로 건너뛰어도 세 클라이언트 모두 입력이 열린다', () => {
  const clients = ['alice', 'bob', 'carol'].map((identityUserId) => networkUiHarness({ identityUserId }));
  for (const client of clients) {
    const decide = client.context.YuksamRaidRunUi.questionGateDecisionForTest;
    assert.equal(decide({
      phase:'question', round:5, hasQuestion:true, deadline:0,
      submitted:false, down:false,
    }), 'server-wait', '세 화면 준비 전에는 서버 대기 상태여야 한다');
    assert.equal(decide({
      phase:'question', round:5, hasQuestion:true, deadline:123456,
      submitted:false, down:false,
    }), 'open', '서버가 공통 제한시각을 열면 기존 busy 상태와 무관하게 입력이 열려야 한다');
  }
  const decide = clients[0].context.YuksamRaidRunUi.questionGateDecisionForTest;
  assert.equal(decide({
    phase:'question', round:5, hasQuestion:true, deadline:123456,
    submitted:false, down:false, stunned:true,
  }), 'down', 'a stunned student must rest instead of opening a question');
  assert.equal(decide({
    phase:'waiting', round:5, hasQuestion:true, deadline:123456,
    submitted:true, down:false,
  }), 'submitted', '이미 제출한 화면은 같은 question을 다시 입력하게 하면 안 된다');
  assert.match(uiSource, /reconcileNetworkQuestionRound\(\)/);
  assert.match(uiSource, /session\.questionUnlockedRounds\.has\(round\)/);
  assert.match(uiSource, /session\.submittedRounds\?\.has\(round\)/);
});

test('문제 답변 대기와 서버 동기화 대기를 서로 다른 문구로 안내한다', () => {
  const harness = networkUiHarness();
  const message = harness.context.YuksamRaidRunUi.questionWaitMessageForTest;
  assert.equal(message({ submitted:false }), '서버 대기중…',
    '문제와 공통 제한시각을 준비하는 동안은 서버 대기라고 안내해야 한다');
  assert.equal(message({ submitted:true }), '친구들의 문제 풀이를 기다리는 중…',
    '내 답을 낸 뒤에는 무엇을 기다리는지 분명히 알려야 한다');
  assert.equal(
    message({ submitted:true, down:true }),
    '쓰러져 있어 이번 전투에서는 행동하지 않습니다. 친구들의 문제 풀이를 기다리는 중…',
    '쓰러진 파티원의 자동 제출도 친구 답변 대기로 구분해야 한다',
  );
  assert.equal(
    message({ submitted:true, stunned:true }),
    '기절해서 이번 턴은 쉬어갑니다. 친구들의 문제 풀이를 기다리는 중…',
    'a stunned student gets an explicit rest-turn message',
  );
  assert.match(uiSource, /phase === 'resolving'[\s\S]*?panelMessage = networkQuestionWaitMessage\(\)/,
    '세 답이 모두 모여 서버가 결과를 계산할 때는 서버 대기로 돌아가야 한다');
  assert.match(uiSource, /panelMessage = networkQuestionWaitMessage\(\{ submitted:true, down, stunned \}\)/);
  assert.match(uiSource, /showPlaybackPanel\(`답을 제출했습니다\. \$\{networkQuestionWaitMessage\(\{ submitted:true \}\)\}`\)/);
});

test('최종 보상창에서 한 명이 먼저 나가도 남은 화면은 연출 대기에 갇히지 않는다', () => {
  const harness = networkUiHarness();
  const ready = harness.context.YuksamRaidRunUi.playbackReadyForTest;
  const member = (userId, playbackRound) => ({ userId, active:true, playbackRound });

  const twoFinished = [member('alice', 7), member('bob', 7)];
  assert.equal(ready(7, { room:{ phase:'effects' }, members:twoFinished }), false,
    '진행 중에는 한 명이 빠졌다고 장벽을 열면 안 된다');
  assert.equal(ready(7, { room:{ phase:'cleared' }, members:twoFinished }), true,
    '클리어 뒤에는 확인을 누르고 나간 사람 때문에 남은 둘이 갇히면 안 된다');
  assert.equal(ready(7, { room:{ phase:'wiped' }, members:twoFinished }), true,
    '전멸 결과창도 같은 방식으로 안전하게 끝나야 한다');
  assert.equal(ready(7, {
    room:{ phase:'cleared' },
    members:[member('alice', 7), member('bob', 6)],
  }), false, '남아 있는 사람의 연출이 실제로 끝나기 전에는 열면 안 된다');
});

test('새로고침 뒤에는 진행 중인 방과 현재 전투 장면을 이어서 복원한다', () => {
  assert.match(uiSource, /create:\(\{ floorGroup = 1 \} = \{\}\) => enterOrResume|client\.create/);
  assert.match(uiSource, /\['question', 'waiting', 'resolving', 'effects'\]\.includes\(roomPhase\)/);
  assert.match(uiSource, /active\.importSnapshot\(\{[\s\S]*?encounterIndex:Number\(networkSession\.room\?\.encounterIndex\)/);
  assert.match(uiSource, /active\.arriveAtEncounter\(\)/);
  assert.match(uiSource, /openBattleScreen\(\{ resumed:true \}\)/);
  assert.match(uiSource, /if \(options\.resumed && networkSession\)/);
  assert.match(uiSource, /if \(resolving\) global\.setTimeout\(\(\) => maybeResolveNetworkRound\(\), 0\)/);
});

test('가짜 인증 계정 3개의 전체 방·라운드 계약이 통과한다', { timeout:15000 }, () => {
  const path = join(root, 'tests', 'raid-multiplayer-integration.test.mjs');
  const result = spawnSync(process.execPath, ['--test', path], { encoding:'utf8', timeout:10000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('서버 라운드는 세 명에게 서로 다른 문제를 주고 세 답을 모아 한 번만 발행한다', () => {
  assert.match(uiSource, /pickDistinctQuestions\(members\.length\)/);
  assert.match(uiSource, /\{ byUser:questionByUser \}/);
  assert.match(uiSource, /JSON\.stringify\(answerByUser\)/);
  assert.match(uiSource, /session\.client\.submit\(session\.room\.id, round, actionId/);
  assert.match(uiSource, /session\.room\?\.phase !== 'resolving'/);
  assert.match(uiSource, /inputs\.length !== 3/);
  assert.match(uiSource, /session\.resolvingRounds\.add\(round\)/);
  assert.match(uiSource, /session\.client\.publishRound/);
  assert.match(uiSource, /memberStates:publishMemberStates\(snapshot\)/);
  assert.match(uiSource, /events:\[\.\.\.answerEvents, \.\.\.\(result\.events \|\| \[\]\)\]/);
});

test('쓰러지거나 기절한 학생은 문제를 받지 않고 서버 제출만 자동 처리한다', () => {
  const autoSkip = uiSource.match(/function maybeAutoSubmitDeadNetworkTurn\(\) \{[\s\S]*?\n  \}/)?.[0] || '';
  assert.notEqual(autoSkip, '');
  assert.match(autoSkip, /const down = !!member && member\.hp <= 0/);
  assert.match(autoSkip, /Number\(member\.statuses\?\.stunTurns\) > 0/);
  assert.match(autoSkip, /\(!down && !stunned\)/);
  assert.match(autoSkip, /session\.deadSubmittedRounds\.has\(round\)/);
  assert.match(autoSkip, /session\.client\.submit\(session\.room\.id, round, 'basic', ''\)/);
  assert.match(autoSkip, /networkQuestionWaitMessage\(\{ submitted:true, down, stunned \}\)/);
  assert.match(uiSource, /skipped:skipped \|\| entry\.correct === true|correct:skipped \|\| entry\.correct === true/);
  assert.match(uiSource, /answerEvent\?\.skipped !== true/);
});

test('1–10층 복도는 1→3→5→8→10층 조우 진행을 표시한다', () => {
  const h = networkUiHarness();
  const floor = h.context.YuksamRaidRunUi.displayFloorForTest;
  assert.equal(typeof floor, 'function');
  assert.equal(floor({ encounterIndex:0, phase:'travel' }, 0), 1);
  assert.equal(floor({ encounterIndex:0, phase:'battle' }, 0), 3);
  assert.equal(floor({ encounterIndex:1, phase:'travel' }, 0), 3);
  assert.equal(floor({ encounterIndex:1, phase:'battle' }, 0), 5);
  assert.equal(floor({ encounterIndex:2, phase:'battle' }, 0), 8);
  assert.equal(floor({ encounterIndex:3, phase:'battle' }, 0), 10);
  assert.match(uiSource, /walkProgress = active\.phase === 'travel' \? 0 : 1/,
    'a new floor group must not render with stale completed travel progress');
  assert.match(uiSource, /const floorLabel = `\$\{floor\}층`/);
  assert.match(uiSource, /ctx\.fillStyle = '#fb7185';\s*ctx\.fillText\(floorLabel/);
  assert.doesNotMatch(uiSource, /다음 조우 \$\{Math\.min/);
});

test('던전은 마을과 분리된 전체 화면 맵이고 복도에 세 명을 직접 그린다', () => {
  assert.match(uiSource, /const MAP_KEY = 'raidTower'/);
  assert.match(uiSource, /owns:\(\{ map \}\) => map === MAP_KEY/);
  assert.match(uiSource, /function drawDungeon\(\)/);
  assert.match(uiSource, /function drawParty\(\)/);
  assert.match(uiSource, /function leaveDungeonMap\(\)/);
  assert.match(uiSource, /positioned\.forEach\(\(\{ member, index, x, y \}\) =>/);
});

test('복도 이름표와 각 학생의 펫은 같은 파티 좌표를 따른다', () => {
  assert.match(uiSource, /drawNameTag\(ctx, x, y \+ 58, member\.name/);
  assert.match(uiSource, /function drawRaidPet\(ctx, ownerX, ownerY, moving, owner = null\)/);
  assert.match(uiSource, /const petId = owner\?\.activePet \|\| ''/);
  assert.match(uiSource, /const now = Date\.now\(\)/);
  assert.match(uiSource, /positioned\.forEach\(\(\{ member, x, y \}\) => drawRaidPet\(ctx, x, y, moving, member\)\)/);
  assert.match(uiSource, /const x = ownerX - 46/);
  assert.match(uiSource, /pet\.id === 'yuksam'[\s\S]*?global\.drawYuksamPetV35\(ctx, \{ x, y \}, false, moving, pet, now\)/);
  assert.match(gameSource, /\['petShopInterior', 'upgradeShopInterior', 'finalBossRoom', 'raidTower'\]/);
  assert.match(multiplayerSource, /\['petShopInterior', 'upgradeShopInterior', 'raidTower'\]/);
});

test('대기실 캐릭터는 온라인 로비에서도 계속 제자리걸음한다', () => {
  assert.match(uiSource, /function startFormationAnimation\(memberById\)/);
  assert.match(uiSource, /\['raidFormation', 'raidNetworkLobby'\]\.includes\(modalType\)/);
  assert.match(uiSource, /paintAll\('\.raid-face', memberById, 1\.35, \{ moving:true \}\)/);
  assert.match(uiSource, /function stopFormationAnimation\(\)/);
  assert.match(uiSource, /function playTravelScene\(\) \{[\s\S]*?stopFormationAnimation\(\)/);
});

test('전투 패널은 일반 사냥처럼 공격·스킬·포기 뒤에 문제를 보여준다', () => {
  assert.match(uiSource, /data-raid-menu="attack">공격</);
  assert.match(uiSource, /data-raid-menu="skill">스킬</);
  assert.match(uiSource, /data-raid-menu="giveup">포기</);
  assert.match(uiSource, /class="combat-menu"/);
  assert.match(uiSource, /call\('getLearnedActiveSkills'\)/);
  assert.match(uiSource, /function raidSkillCooldown\(skillId\)/);
  assert.match(uiSource, /question = null;\s*\/\/ 문제는 공격\/스킬을 고른 뒤에 나온다/);
  assert.match(uiSource, /if \(networkSession\) \{[\s\S]*?publicRaidQuestion\(networkSession\.room\?\.question \|\| networkSession\.lastQuestion\)/);
  assert.match(uiSource, /if \(panelMode === 'question'\)[\s\S]*?data-raid-menu="back">뒤로/);
  assert.match(uiSource, /정말로 포기하시겠습니까\?/);
});

test('포기 확인창은 heartbeat와 Realtime 동기화가 전투창으로 덮지 않는다', () => {
  assert.match(uiSource, /let giveUpConfirmOpen = false/);
  const syncBlock = uiSource.match(/function setNetworkData\(data,[\s\S]*?\n  \}/)?.[0] || '';
  assert.notEqual(syncBlock, '');
  const guard = syncBlock.indexOf("if (giveUpConfirmOpen || G()?.modalState?.type === 'raidGiveUp') return;");
  const events = syncBlock.indexOf('const events = Array.isArray(data.events)');
  assert.ok(guard >= 0 && events > guard, `포기창 잠금이 이벤트 재생보다 앞서야 한다: ${guard}, ${events}`);
  assert.match(uiSource, /if \(giveUpConfirmOpen\) return;/);
  assert.match(uiSource, /giveUpConfirmOpen = false;\s*\n\s*leaveDungeonNow\(\)/);
});

test('답 제출 직후 입력 UI를 없애고 세 명의 결과를 기다린다', () => {
  assert.match(uiSource, /function showPlaybackPanel\(message = '전투 중…'\)/);
  assert.match(uiSource, /querySelector\('\.raid-combat > \.panel-card'\)/);
  assert.match(uiSource, /panel\.innerHTML = `<h3>/);
  assert.match(uiSource, /showPlaybackPanel\(`답을 제출했습니다\. \$\{networkQuestionWaitMessage\(\{ submitted:true \}\)\}`\)/);
  assert.match(uiSource, /id="combatAnswer"/);
  assert.match(uiSource, /data-answer-key=/);
});

test('아군과 몬스터는 공격할 때 앞으로 나가고 맞으면 흔들린다', () => {
  assert.match(uiSource, /\.raid-ally-sprite\.raid-party-lunge/);
  assert.match(uiSource, /\.raid-monster-sprite\.raid-monster-lunge/);
  assert.match(uiSource, /\.raid-ally-sprite\.raid-shake,\.raid-monster-sprite\.raid-shake/);
  assert.match(uiSource, /node\.classList\.add\('combat-acting', motionClass\)/);
  assert.match(uiSource, /lunge\(attacker, 'party'\)/);
  assert.match(uiSource, /lunge\(monsterNode, 'monster'\)/);
});

test('던전 전투 규칙은 기절·더블 어택·힐·보호막·쿨타임을 실제 결과에 반영한다', () => {
  assert.match(combatSource, /label:'더블 어택'/);
  assert.match(combatSource, /doubleAttack:true/);
  assert.match(combatSource, /addMonsterStatus\(monster, member, action, 'stun'/);
  assert.match(combatSource, /monster\.stunTurns > 0/);
  assert.match(uiSource, /event\.kind === 'monster-stun-break'[\s\S]*?statuses\.stunTurns = 0/);
  assert.match(combatSource, /kind:'party-heal'/);
  assert.match(combatSource, /kind:'party-shield'/);
  assert.match(combatSource, /member\.cooldowns\[action\.id\]/);
  assert.match(uiSource, /class="combat-badge-v38 \$\{esc\(badge\.key\)\}" data-tooltip=/);
  assert.match(uiSource, /buildStatusBadges/);
  /* 몬스터 상태 배지는 스냅샷 + 표시용 상태를 합쳐 통째로 다시 그린다.
     기절은 걸린 라운드 안에서 몬스터 턴에 바로 소모되므로, 최종 상태만
     보면 배지가 한 번도 보이지 않는다. 그래서 체력처럼 로그 한 줄마다
     표시용 값을 켜고 끈다. */
  assert.match(uiSource, /statusNode\.innerHTML = monsterStatusBadgesHtml\(\{\s*\n\s*\.\.\.snap\.monster,\s*\n\s*\.\.\.\(view\.monsterStatuses \|\| \{\}\),/);
  assert.match(uiSource, /function monsterStatusBadgesHtml\(monster\)/);
  assert.match(uiSource, /if \(event\.status === 'stun'\) statuses\.stunTurns = Math\.max/);
  assert.match(uiSource, /event\.kind === 'monster-skip' && event\.status === 'stun'/);
  /* 아군 상태도 최종 라운드가 아니라 피격 순간에 체력창 DOM으로 옮긴다. */
  assert.match(combatSource, /hitEvent\.memberStatuses = \{ \.\.\.\(member\.statuses \|\| \{\}\) \};/);
  assert.match(uiSource, /memberStatuses:Object\.fromEntries\(snap\.members\.map/);
  assert.match(uiSource, /function applyMemberStatusesToView\(event\)/);
  assert.match(uiSource, /event\.kind === 'monster-hit' && event\.memberStatuses/);
  assert.match(uiSource, /applyMemberStatusesToView\(event\);/);
  assert.match(uiSource, /box\.querySelector\('\[data-raid-status-member\]'\)/);
  assert.match(uiSource, /status\.innerHTML = memberStatusBadgesHtml\(/);
  assert.match(uiSource, /event\.kind === 'party-heal'/);
  assert.match(uiSource, /event\.kind === 'party-shield'/);
});

test('기절한 몬스터는 다음 턴 예고 대신 쉰다고 알려 준다', () => {
  /* 기절하면 예정돼 있던 기술이 취소되고 다음 턴에 새로 뽑는다.
     그런데도 예고에 그 기술 이름이 남아 있어 거짓 정보가 됐었다. */
  const block = uiSource.match(/function nextPlanHint\([\s\S]*?\n  \}/)?.[0] || '';
  assert.notEqual(block, '');
  assert.match(block, /Number\(monster\?\.stunTurns\)/);
  assert.match(block, /다음 턴은 쉽니다/);
  /* 예고는 한 턴이 다 끝나고 다음 문제가 나올 때만 바뀐다.
     재생 도중에 바꾸면 아직 이번 턴이 끝나지도 않았는데 다음 기술 이름이
     먼저 떠서 이상하다(제작자 지적). */
  assert.doesNotMatch(uiSource, /hintNode\.textContent = hint\.text/);
  assert.match(uiSource, /const nextHint = nextPlanHint\(truth, nextPlan\)/);
});

test('던전 왼쪽 위 장소명은 선택한 구간에 맞춰 매번 갱신된다', () => {
  assert.match(uiSource, /const label = `63빌딩 던전 \$\{currentGroupLabel\(\)\}`/);
  assert.match(uiSource, /worlds\[MAP_KEY\]\.label = label/);
  assert.doesNotMatch(uiSource, /label:'63빌딩 던전 1–10층'/);
});

test('다음 기술 예고와 실제 판정은 서버 라운드와 방 id를 기준으로 한다', () => {
  assert.match(uiSource, /function networkPatternRound\(snapshot/);
  assert.match(uiSource, /Math\.trunc\(Number\(room\.round\) \|\| 0\) - 1/);
  assert.match(uiSource, /function networkPatternSeed\(snapshot/);
  assert.match(uiSource, /networkSession\?\.room\?\.id/);
  assert.match(uiSource, /rules\(\)\.attackPlanForRound\(\s*truth,\s*networkPatternRound\(snap\),\s*networkPatternSeed\(snap\)/);
  assert.match(uiSource, /active\.importSnapshot\(\{\s*round:networkPatternRound/,
    '방장이 실제 판정하기 직전에도 서버 라운드를 강제해야 한다');
});

test('환기와 특성 원인은 던전 체력창 툴팁에 표시된다', () => {
  const { context } = networkUiHarness();
  const ui = context.YuksamRaidRunUi;
  const buff = ui.memberStatusBadgesHtmlForTest({
    id:'mage', statuses:{}, buffs:{ intBuffTurns:3 },
  });
  assert.match(buff, /환기 3/);
  assert.match(buff, /지능이 30% 증가/);
  const stun = ui.monsterStatusBadgesHtmlForTest({
    stunTurns:1, stunSourceName:'냉기 집중',
  });
  assert.match(stun, /냉기 집중 특성으로 기절/);
  assert.match(combatSource, /신앙의 광채로 인해/);
});

test('쓰러진 파티원이 생기면 화면에서도 생존자 자리를 앞으로 당긴다', () => {
  const { context } = networkUiHarness();
  const ui = context.YuksamRaidRunUi;
  const shifted = ui.displayPartyMembersForTest([
    { id:'a', slot:'front', hp:0 },
    { id:'b', slot:'middle', hp:10 },
    { id:'c', slot:'back', hp:10 },
  ]);
  assert.deepEqual(Array.from(shifted, (member) => [member.id, member.slot]), [
    ['a', 'front'], ['b', 'front'], ['c', 'middle'],
  ]);
  assert.match(uiSource, /function applyDynamicFormationToBattle\(snapshot\)/);
  assert.match(uiSource, /label\.textContent = member\.hp > 0 \? rules\(\)\.slotLabel\(member\.slot\) : '쓰러짐'/);
});

test('모든 다음 전투 예고는 같은 노란색 공통 서식을 쓴다', () => {
  const { context } = networkUiHarness();
  const ui = context.YuksamRaidRunUi;
  const cases = [
    {
      name:'점액 방패',
      monster:{},
      plan:{ name:'점액 방패', kind:'none', shieldPct:0.3 },
    },
    {
      name:'야근의 손길',
      monster:{},
      plan:{ name:'야근의 손길', kind:'single', target:'front', hits:1 },
    },
    {
      name:'야광등 폭발',
      monster:{},
      plan:{ name:'야광등 폭발', kind:'all', hits:2 },
    },
    {
      name:'대재앙',
      monster:{ chargedPlanName:'대재앙' },
      plan:{ name:'다른 기술', kind:'single', target:'back', hits:1 },
    },
  ];

  cases.forEach(({ name, monster, plan }) => {
    const hint = ui.nextPlanHintForTest(monster, plan);
    const html = ui.nextPlanHintHtmlForTest(hint);
    assert.equal(hint.technique, name);
    assert.match(html, new RegExp(`<strong class="raid-next-technique">${name}</strong>`));
    assert.equal((html.match(/raid-next-technique/g) || []).length, 1,
      `${name}은 공통 기술명 서식을 정확히 한 번만 거쳐야 한다`);
  });

  const rulesContext = {};
  rulesContext.window = rulesContext;
  rulesContext.globalThis = rulesContext;
  vm.runInNewContext(rulesSource, rulesContext, { filename:'raid-rules.js' });
  const configuredPlans = Object.values(rulesContext.YuksamRaidRules.MONSTERS)
    .flatMap((monster) => monster.pattern || []);
  assert.ok(configuredPlans.length > 0);
  configuredPlans.forEach((plan) => {
    const hint = ui.nextPlanHintForTest({}, plan);
    const html = ui.nextPlanHintHtmlForTest(hint);
    assert.equal(hint.technique, plan.name, `${plan.name} 기술명이 예고에서 보존되어야 한다`);
    assert.match(html, /<strong class="raid-next-technique">/,
      `${plan.name}도 공통 노란색 기술명 서식을 써야 한다`);
  });

  assert.match(uiSource, /\.raid-next-hint\{font-size:11px;color:#fbbf24/,
    '기술 종류와 관계없이 예고 문장 전체가 같은 노란색이어야 한다');
  assert.match(uiSource, /\.raid-next-technique\{color:#fbbf24;font-weight:950\}/);
  assert.doesNotMatch(uiSource, /\.raid-next-hint\.warn\{color:#fbbf24/,
    '일부 패턴의 전체 문장만 노란색이 되는 옛 분기를 남기면 안 된다');
  assert.match(uiSource, /\$\{nextPlanHintHtml\(nextHint\)\}/);
});

test('던전도 사냥터의 투사체 연출 엔진을 그대로 쓴다', () => {
  // 사냥터와 같은 YuksamCombatFx를 쓰고, 새로 만들지 않는다.
  assert.match(uiSource, /global\.YuksamCombatFx/);
  assert.match(uiSource, /fx\.getBasicAttackFxProfile\(member\?\.klass \|\| 'warrior'\)/);
  assert.match(uiSource, /fx\.getSkillFxProfile\(skillId, skillDefFor\(skillId\)\)/);
  assert.match(uiSource, /fx\.playPlayerActionFx\(profile\)/);
  assert.match(uiSource, /fx\.playMonsterActionFx\(/);
  /* 사냥터 엔진은 무대에서 .combat-player 하나를 찾는다. 던전은 셋이라
     연출에 관계된 사람에게만 잠깐 그 표를 붙였다 뗀다. */
  assert.match(uiSource, /function withFxAnchor\(memberId, run\)/);
  assert.match(uiSource, /node\.classList\.add\('combat-player'\)/);
  assert.match(uiSource, /node\.classList\.remove\('combat-player'\)/);
  // 전체 공격은 세 자리에 차례로 충격파가 인다.
  assert.match(uiSource, /function playPartyWideStorm\(\)/);
  assert.match(uiSource, /@keyframes raidStormHit/);
});

test('체력바는 각 캐릭터 머리 위에 붙고 세 명은 넉넉히 벌려 세운다', () => {
  // 위쪽 한 줄짜리 체력창은 없애고 캐릭터마다 하나씩 단다.
  assert.doesNotMatch(uiSource, /class="raid-party-hp"/);
  assert.match(uiSource, /function allyHpHtml\(member\)/);
  assert.match(uiSource, /\$\{allyHpHtml\(member\)\}\s*\n\s*<canvas class="raid-battle-face"/);
  assert.match(uiSource, /\.raid-ally-hp\{position:absolute;left:50%;bottom:100%/);
  // 서로 겹치지 않게 자리 간격을 벌린다.
  assert.match(uiSource, /\.raid-ally-0\{bottom:10px;left:34%/);
  assert.match(uiSource, /\.raid-ally-1\{bottom:96px;left:18%/);
  assert.match(uiSource, /\.raid-ally-2\{bottom:182px;left:2%/);
});

test('직업 공격·스킬·회복 효과음은 매니페스트와 실제 재생 API를 쓴다', () => {
  assert.match(uiSource, /function attackAudioIdFor\(member\)/);
  assert.match(uiSource, /manifest\.classBasicSounds\?\.\[member\?\.klass\]/);
  assert.match(uiSource, /manifest\.skillSounds\?\.\[skillId\]/);
  assert.match(uiSource, /global\.playMappedAudio === 'function'/);
  assert.doesNotMatch(uiSource, /playAudioAssetV42/);
  assert.match(uiSource, /playAsset\('dungeonEncounter', 'hit'\)/);
  assert.match(combatSource, /audioId:actionAudioId/);
});

test('몬스터와 세 캐릭터의 체력·보호막·상태를 전투 로그 한 줄씩 갱신한다', () => {
  assert.match(uiSource, /function raidMessageHtml\(value\)/);
  assert.match(uiSource, /raid-log-name \$\{raidSlotClass\(member\.slot\)\}/);
  assert.match(uiSource, /raid-log-name enemy/);
  // 보호막 표시는 사냥터와 완전히 같은 모양이다(툴팁 없이 방패와 숫자만).
  assert.match(uiSource, /return value > 0 \? ` <span class="shield-badge">🛡 \$\{value\}<\/span>` : '';/);
  assert.match(uiSource, /panelMessage = event\.text \|\| ''/);
  assert.match(uiSource, /function applyEventToView\(event\)/);
  assert.match(uiSource, /exactEventNumber\(event, 'remainingShield'\)/);
  assert.match(uiSource, /exactEventNumber\(event, 'monsterHp'\)/);
  assert.match(uiSource, /exactEventNumber\(event, 'memberHp'\)/);
  assert.match(uiSource, /'monster-execute'/);
  assert.match(uiSource, /function playEvents\(events, onDone, \{ syncAtEnd = true \} = \{\}\)/);
  assert.match(uiSource, /playEventSound\(event\);\s*\n\s*updateBattleView\(\);/);
  assert.match(uiSource, /let eventDelayMs = 1500/);
});

test('세 화면의 체력 숫자가 어긋나지 않는다', () => {
  /* 실제 사고: 세 명이 같이 하는데 한 명 화면만 몬스터 체력이 낮게 보였다.
     화면 값은 로그 한 줄씩 깎아 내려가는데, 그 출발점이 방장이 올린
     '라운드가 끝난 뒤' 값으로 잡히면 거기서 피해를 또 빼기 때문이다.
     그래서 덮어쓰기 전에 출발점을 붙잡아 두고, 재생을 그 값에서 시작한다. */
  assert.match(uiSource, /function captureViewBaseline\(\)/);
  const start = uiSource.indexOf('function handleNetworkEvents(rows)');
  const end = uiSource.indexOf('function captureViewBaseline()');
  assert.ok(start > 0 && end > start, 'handleNetworkEvents를 찾지 못했다');
  const handler = uiSource.slice(start, end);
  /* 출발점을 붙잡고, 재생 중에는 다음 몬스터의 서버 상태를 미리
     덮어쓰지 않아야 한다. */
  const capturedAt = handler.indexOf('const baseline = idle ? captureViewBaseline()');
  assert.ok(capturedAt > 0, '전투 로그의 출발점을 붙잡아야 한다');
  assert.doesNotMatch(handler, /\n    importNetworkTruth\(\);/,
    '이전 몬스터 로그를 재생하는 동안 다음 몬스터 상태를 미리 넣으면 안 된다');
  assert.match(uiSource, /if \(entry\.baseline\) view = \{ \.\.\.entry\.baseline \};/);

  /* 재생할 라운드가 남아 있는 동안에는 화면 전환을 하지 않고,
     마지막 로그 뒤에는 세 명의 완료 확인을 기다린다. */
  assert.match(uiSource, /if \(session\.playbackQueue\?\.length\) \{/);
  assert.match(uiSource, /acknowledgeNetworkPlayback\(entry\.round\);/);
  assert.match(uiSource, /continueAfterNetworkPlayback\(\);/);
  assert.match(uiSource, /\}, \{ syncAtEnd:false \}\);/);

  /* 로그를 몇 줄 놓치더라도 조용한 순간에 반드시 서버 값과 맞춘다. */
  assert.match(uiSource, /!networkSession\.playbackActive && !networkSession\.playbackQueue\?\.length/);
});

test('던전 문제 제한시간은 서버의 30초 deadline을 화면 중앙 위에 표시한다', () => {
  assert.match(uiSource, /questionDeadline \?\? networkSession\?\.room\?\.question_deadline/);
  assert.match(uiSource, /id="raidQuestionTimer" class="raid-question-timer"/);
  assert.match(uiSource, /node\.textContent = `⏱ \$\{seconds\}초`/);
  assert.match(uiSource, /global\.setInterval\(updateRaidQuestionTimer, 250\)/);
  assert.match(uiSource, /\['question', 'waiting'\]\.includes\(phase\)\)[\s\S]*?startRaidQuestionTimer\(\)/);
  assert.match(uiSource, /stopRaidQuestionTimer\(\)/);
});

test('아군이 쓰러지면 모든 참가자 재생 흐름에서 사망 효과음을 낸다', () => {
  /* 합성 사망음은 낮고 조용해 던전 음악에 묻힌다.
     등록된 음원이 있으면 그것을 먼저 쓰고, 없으면 기존 합성음으로 떨어진다. */
  assert.match(uiSource, /event\.kind === 'member-down'\) playAsset\('defeat', 'defeat'\)/);
});

test('파티 체력창은 앞·가운데·뒤 색을 구분하고 사냥터 보호막 모양을 재사용한다', () => {
  assert.match(uiSource, /raid-ally-hp \$\{raidSlotClass\(member\.slot\)\}/);
  assert.match(uiSource, /\.raid-ally-hp\.slot-front/);
  assert.match(uiSource, /\.raid-ally-hp\.slot-middle/);
  assert.match(uiSource, /\.raid-ally-hp\.slot-back/);
  assert.match(uiSource, /class="shield-badge"/);
});

test('체력창과 피해 숫자는 사냥터와 같은 모양·차례를 쓴다', () => {
  /* 사냥터 .combat-hpbox 차례: 이름 → HP 숫자(+보호막) → 상태 배지 → 체력바.
     던전도 같은 클래스와 같은 차례를 써야 서식이 어긋나지 않는다. */
  assert.match(uiSource, /class="combat-hpbox raid-ally-hp/);
  const allyBox = uiSource.match(/function allyHpHtml\(member\)[\s\S]*?\n  \}/)?.[0] || '';
  assert.notEqual(allyBox, '');
  const order = ['<b>', 'raid-ally-num', 'memberStatusHtml(member)', 'class="hpbar"']
    .map((token) => allyBox.indexOf(token));
  assert.ok(order.every((at, index) => at > 0 && (index === 0 || at > order[index - 1])),
    `사냥터와 같은 차례여야 한다: ${order.join(',')}`);

  // 몬스터 체력창도 배지가 체력바보다 위에 온다.
  const monsterBox = uiSource.match(/<div class="combat-hpbox monster">[\s\S]*?<\/div>\s*<!--|<div class="combat-hpbox monster">[\s\S]*?raid-next-hint/)?.[0] || '';
  assert.ok(monsterBox.indexOf('monsterStatusHtml(monster)') < monsterBox.indexOf('class="hpbar"'));

  /* 피해 숫자도 사냥터와 같은 클래스·서식을 쓴다. 던전 전용 숫자 서식은 없앤다. */
  assert.match(uiSource, /node\.className = `combat-floating-damage \$\{side\} \$\{kindClass\}`/);
  assert.match(uiSource, /kind === 'damage' \|\| kind === 'shield-damage' \? `-\$\{value\}` : `\+\$\{value\}`/);
  assert.doesNotMatch(uiSource, /\.raid-float\{/, '던전 전용 숫자 서식이 남아 있으면 안 된다');
  assert.doesNotMatch(uiSource, /🛡 -\$\{shieldDamage\}/, '보호막 피해도 사냥터처럼 숫자만 띄운다');
  // 보호막 피해는 사냥터와 같은 shield-damage 색을 쓴다.
  assert.match(uiSource, /'shield-damage'/);
});

test('사냥터 전투 로그도 내 이름과 몬스터 이름을 초록·빨강으로 구분한다', () => {
  assert.match(gameSource, /className:'combat-log-name-player', color:'#4ade80'/);
  assert.match(gameSource, /className:'combat-log-name-enemy', color:'#fb7185'/);
  assert.match(gameSource, /currentCombatMonster\?\.\(\)\?\.name/);
  assert.match(gameSource, /h3\.innerHTML = highlightCombatMessageV25\(message\)/);
});

test('오답은 정답을 보여준 뒤 절반 피해 로그와 함께 진행한다', () => {
  assert.match(uiSource, /YuksamWrongAnswerReview\?\.reveal/);
  assert.match(uiSource, /correctAnswer:answerEvent\.correctAnswer/);
  assert.match(uiSource, /오답입니다! 정답은 \$\{correctAnswer \|\| '확인 중'\} \(피해가 절반만 들어갑니다\)/);
  assert.match(uiSource, /correct:entry\.correct === true/);
});

test('시트의 17마리가 모두 이모티콘 대신 직접 그린 모델을 가진다', () => {
  assert.doesNotMatch(uiSource, /raid-monster-face/);
  assert.match(uiSource, /id="raidMonsterCanvas"/);
  assert.match(uiSource, /const MONSTER_PAINTERS = \{/);
  // 규칙 파일에 있는 몬스터 id를 그대로 가져와 그림이 하나도 빠지지 않았는지 본다.
  const ids = [...read('src/raid-rules.js').matchAll(/id:'([a-zA-Z]+)', name:'/g)].map((m) => m[1]);
  assert.equal(ids.length, 17, '시트의 몬스터는 17마리다');
  for (const id of ids) {
    assert.match(uiSource, new RegExp(`^    ${id}\\(ctx, cx, cy, t`, 'm'), `${id} 그림 함수가 필요하다`);
  }
});

test('새로 그린 몬스터는 사냥터 스프라이트를 빌려 쓰거나 직접 그린다', () => {
  // 같은 계열은 사냥터 그림을 그대로 재사용한다(같은 세계관).
  assert.match(uiSource, /function borrowSprite\(name, ctx, cx, cy, scale\)/);
  assert.match(uiSource, /borrowSprite\('drawMushroomSprite'/);
  assert.match(gameSource, /function drawMushroomSprite\(/);
  /* 빌딩 스톰프는 원본의 둥근 몸·얼굴·잎 실루엣을 유지하되
     작은 갑옷이 아니라 몸통 전체가 철색이어야 한다. */
  const stomp = uiSource.match(/buildingStomp\(ctx, cx, cy, t\)[\s\S]*?\n    \},/)?.[0] || '';
  assert.notEqual(stomp, '');
  assert.match(gameSource, /function drawStompSprite\(/);
  assert.match(stomp, /const steelBody/);
  assert.match(stomp, /#e2e8f0/);
  assert.match(stomp, /#94a3b8/);
  assert.match(stomp, /#475569/);
  assert.match(stomp, /windowGlow/);
  assert.match(stomp, /금속띠/);
  assert.match(stomp, /#2f6c39/, '스톰프의 잎은 유지해야 한다');
  assert.doesNotMatch(stomp, /borrowSprite\('drawStompSprite'|#a56636|#5b321e/, '나무 몸통이나 작은 갑옷으로 돌아가면 안 된다');
});

test('전투 재생 로그는 교사용 세분화 창에도 같은 순서로 전달된다', () => {
  assert.match(uiSource, /YuksamCombatDetailLog\?\.record\?\.\(event, active\?\.snapshot\?\.\(\)\)/);
});

test('암흑 중첩 배지는 최종 서버 상태가 아니라 해당 상태 로그 시점에 나타난다', () => {
  assert.match(uiSource, /shadowBySource:\{ \.\.\.\(snap\.monster\.shadowBySource \|\| \{\}\) \}/);
  assert.match(uiSource, /event\.status === 'shadow'[\s\S]*?event\.memberStacks/);
  assert.match(uiSource, /shadowBySource:\{ \.\.\.\(view\.monsterStatuses\?\.shadowBySource \|\| \{\}\) \}/);
});

test('오염된 슬라임은 몸과 오염 방울이 보라색 계열이다', () => {
  const slime = uiSource.match(/pollutedSlime\(ctx, cx, cy, t\)[\s\S]*?\n    \},/)?.[0] || '';
  assert.notEqual(slime, '');
  assert.doesNotMatch(slime, /borrowSprite|fillRect/);
  assert.match(slime, /#ddd6fe/);
  assert.match(slime, /#9333ea/);
  assert.match(slime, /#581c87/);
  assert.match(slime, /#c084fc/);
  assert.doesNotMatch(slime, /#65a30d|#a3e635/);
});

test('던전 전용 음악은 던전 맵에서만 재생된다', () => {
  const manifest = read('src/audio-manifest.js');
  assert.match(manifest, /dungeonBgm: \{ src:'assets\/1\. 던전 음악\.mp3'/);
  assert.match(uiSource, /if \(g && g\.currentMap === MAP_KEY\) \{[\s\S]*?ensureDungeonAudio\(\)/);
  assert.match(uiSource, /global\.syncAudioFileBgm = function syncAudioFileBgmWithRaid/);
});

test('아바타·장비·코스튬·펫·쿨타임 상태는 진행 엔진과 서버 스냅샷을 통과한다', () => {
  assert.match(runSource, /appearance:member\.appearance \|\| null/);
  assert.match(runSource, /equipment:member\.equipment \|\| null/);
  assert.match(runSource, /costume:member\.costume \|\| null/);
  assert.match(runSource, /activePet:member\.activePet \|\| ''/);
  assert.match(runSource, /cooldowns:copyNumberMap/);
  assert.match(uiSource, /appearance:\{ \.\.\.\(profile\.appearance \|\| \{\}\) \}/);
  assert.match(uiSource, /activePet:profile\.activePet \|\| ''/);
});

test('온라인 세션도 포함해 던전 갇힘과 이탈을 정리한다', () => {
  assert.match(uiSource, /global\.savePlayer = function savePlayerWithoutRaidMap/);
  assert.match(uiSource, /if \(player && player\.map === MAP_KEY\)/);
  assert.match(uiSource, /if \(!g \|\| g\.currentMap !== MAP_KEY \|\| active \|\| networkSession\) return/);
  assert.match(uiSource, /global\.showScreen = function showScreenWithRaidGuard/);
  assert.match(uiSource, /global\.returnTown = function returnTownWithRaidCleanup/);
  assert.match(uiSource, /session\.client\.leave\(session\.room\.id\)/);
  assert.match(uiSource, /function abandonRun\(\)/);
  assert.match(uiSource, /toggleReturnButton\(true\)/);
});

test('로딩 전환이 끝난 뒤에만 다음 던전 화면을 연다', () => {
  assert.match(uiSource, /const LOADING_TAIL_MS = \d+/);
  assert.match(uiSource, /global\.setTimeout\(\(\) => onReady\?\.\(\), LOADING_TAIL_MS\)/);
});

test('던전 안쪽을 실제 브라우저에서 3인 방 경로로 끝까지 돌린다', { timeout:90000 }, () => {
  /* 예전에는 '혼자 도는 경로'로 던전 안을 검사했는데, 그 경로가 게임에서
     쓰이지 않아 걷어냈다. 이제 가짜 방 서버를 붙여 진짜 3인 경로를 태운다.
     대기실 → 대형 → 출발 → 복도 → 전투 → 재생 → 포기 → 갇힘 구조까지. */
  const script = join(root, 'tools', 'browser-smoke', 'try_raid_party.js');
  const result = spawnSync(process.execPath, [script, root], { encoding:'utf8', timeout:80000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  for (const line of [
    '내 캐릭터에만 파란 테두리가 붙는다',
    '출발하면 던전 맵으로 들어간다',
    '복도 배경이 실제로 흘러간다',
    '복도 끝에서 전투가 시작된다',
    '등장 중 늦은 이동 신호가 와도 전투가 멈추지 않는다',
    '체력창이 각 캐릭터 머리 위에 붙는다',
    '정답을 넣으면 몬스터 체력이 줄어든다',
    '몬스터를 잡으면 다음 조우로 넘어간다',
    '포기하면 마을로 돌아간다',
    '진행 없이 던전에 있으면 자동으로 마을로 나온다',
    '비동기 오류 없음',
  ]) {
    assert.ok(result.stdout.includes(`PASS: ${line}`), `${line}\n${result.stdout}`);
  }
  assert.match(result.stdout, /요약: PASS \d+ \/ FAIL 0/);
});

test('세 화면이 같은 몬스터를 만난다', () => {
  /* 실제 사고: 한 명은 빌딩 스톰프, 나머지 둘은 고장 난 전화기가 나왔다.
     이제 층마다 몬스터가 못박혀 있어 갈라질 여지가 없다. */
  const context = vm.createContext({ window:{} });
  vm.runInContext(rulesSource, context, { filename:'raid-rules.js' });
  const R = context.window.YuksamRaidRules;
  R.availableFloors().forEach((floor) => {
    const a = [...R.floorEncounters(floor).map((m) => m.id)];
    const b = [...R.floorEncounters(floor).map((m) => m.id)];
    assert.deepEqual(a, b, `${floor}층은 언제나 같은 몬스터`);
    assert.deepEqual(a, [...R.getFloor(floor).encounters], `${floor}층 배정표와 일치`);
  });

  /* 몬스터의 정체는 내 화면이 들고 있던 것이 아니라 서버가 말하는
     조우 번호에서 정한다. 그러지 않으면 이름은 옛 몬스터인데 체력은 새
     몬스터인 뒤섞인 몬스터가 만들어진다. */
  assert.match(uiSource, /function encounterDefAt\(index\)/);
  const block = uiSource.match(/function importNetworkTruth\(\)[\s\S]*?\n  \}/)?.[0] || '';
  assert.notEqual(block, '');
  assert.match(block, /const def = encounterDefAt\(serverIndex\);/);
  assert.match(block, /String\(state\.id \|\| ''\) === String\(def\.id\)/);
  assert.doesNotMatch(block, /\{ \.\.\.\(current\.monster \|\| \{\}\), \.\.\.room\.monsterState \}/);
});

test('끝난 판은 누구도 결과 화면을 놓치지 않고, 보상은 한 번만 준다', () => {
  /* 실제 사고: 둘은 돌파 축하와 보상을 받았는데 한 명만 아무것도 뜨지 않고
     진행이 멈췄다. 방이 끝났다고 하면 로그를 다 보여 준 뒤 반드시 마무리한다. */
  assert.match(uiSource, /PLAYBACK_BARRIER_PHASES = new Set\(\['effects', 'travel', 'cleared', 'wiped'\]\)/);
  assert.match(uiSource, /allMembersFinishedPlayback\(round, session\)/);
  assert.match(uiSource, /if \(active\.phase === 'cleared' \|\| active\.phase === 'wiped'\) \{/);
  assert.match(uiSource, /networkSession\.completion = data\.completion/);
  // 여러 경로에서 불려도 보상이 두 번 들어가면 안 된다.
  assert.match(uiSource, /let finishedRunKey = ''/);
  assert.match(uiSource, /if \(finishedRunKey === key\) return;/);
  assert.match(uiSource, /finishedRunKey = '';   \/\/ 다음 판은 다시 결과 화면을 띄울 수 있어야 한다/);
  const finish = uiSource.match(/function finishRun\(\) \{[\s\S]*?\/\* ---------- 밖에서 부르는 입구/)?.[0] || '';
  assert.match(finish, /if \(cleared && session && !completion\?\.player\)/,
    '서버 보상 정보가 오기 전에는 결과 처리를 잠그지 않는다');
  assert.match(finish, /applyAuthoritySnapshotFromServerV3/,
    '온라인 보상은 서버의 절대 저장값으로 맞춘다');
  assert.match(finish, /completion\.awarded !== true/);
  assert.match(finish, /첫 클리어 보상은 이미 받았습니다/);
  const onlineBranch = finish.match(/if \(session\) \{[\s\S]*?\} else \{/)?.[0] || '';
  assert.doesNotMatch(onlineBranch, /addExp|addGold|reward\.building/,
    '온라인 완료 응답을 다시 받아도 로컬 가산으로 중복 지급하면 안 된다');
});

test('방 만들기는 예전 방을 정리하고 새로 시작한다', () => {
  /* 실제 사고: 방 만들기를 눌렀는데 예전에 하던 전투가 그대로 이어졌다.
     복구는 게임을 켤 때 자동으로 하는 것이고, 방 만들기는 새 판이다. */
  const clientSource = read('src/raid-party-client.js');
  assert.match(clientSource, /if \(body\?\.op === 'create' && existing\?\.room\?\.id\) \{/);
  assert.match(clientSource, /op:'leave', roomId:existing\.room\.id/);
  assert.doesNotMatch(clientSource, /const stale = existing\?\.room\?\.id && existing\.room\.phase === 'lobby'/);
});

test('치명타 소리는 아군·몬스터 가리지 않고 난다', () => {
  /* 예전에는 아군 치명타가 스킬 소리에 가려 아예 안 났고,
     몬스터 치명타도 음원이 없으면 평타 소리로 떨어졌다. */
  const block = uiSource.match(/function playEventSound\(event\)[\s\S]*?\n  \}/)?.[0] || '';
  assert.notEqual(block, '');
  assert.match(block, /event\.critical === true && event\.missed !== true/);
  assert.match(block, /call\('playSfx', 'critical'\)/);
  // 같은 소리를 두 번 겹치지 않는다.
  assert.match(block, /event\.audioId !== 'critical'/);
});

test('사망음은 배경음악에 묻히지 않을 만큼 크다', () => {
  const defeat = gameSource.match(/if \(name === 'defeat'\) \{[\s\S]*?\n  \}/)?.[0] || '';
  assert.notEqual(defeat, '');
  // 예전 음량 .16으로는 던전 음악에 묻혔다.
  assert.doesNotMatch(defeat, /'sine', \.16\)/);
  assert.match(defeat, /playTone\(110, \.30, 'sawtooth', \.34\)/);
});

test('반격 안내에 50% 확률이 적혀 있다', () => {
  assert.match(uiSource, /때릴 때마다 50% 확률로 파티 전체가 반격을 받습니다/);
  assert.match(uiSource, /때릴 때마다 50% 확률로 때린 사람이 반격을 받습니다/);
  assert.match(combatSource, /50% 확률로 파티 전체에 반격합니다/);
  assert.match(combatSource, /50% 확률로 반격합니다/);
});
