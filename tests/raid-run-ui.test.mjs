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
  assert.match(uiSource, /active\.resolveRound\(submissions\)/);
  assert.match(uiSource, /active\.resolveRound\(answers\)/);
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
  assert.match(block, /syncNetworkLobbyCountdown\(savedFormation && allReady\)/);
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
  assert.match(uiSource, /session\.client\.submit\(session\.room\.id, Number\(session\.room\.round\), actionId/);
  assert.match(uiSource, /session\.room\?\.phase !== 'resolving'/);
  assert.match(uiSource, /inputs\.length !== 3/);
  assert.match(uiSource, /session\.resolvingRounds\.add\(round\)/);
  assert.match(uiSource, /session\.client\.publishRound/);
  assert.match(uiSource, /memberStates:publishMemberStates\(snapshot\)/);
  assert.match(uiSource, /events:\[\.\.\.answerEvents, \.\.\.\(result\.events \|\| \[\]\)\]/);
});

test('쓰러진 학생은 문제를 받지 않고 서버 제출만 자동 처리한다', () => {
  const autoSkip = uiSource.match(/function maybeAutoSubmitDeadNetworkTurn\(\) \{[\s\S]*?\n  \}/)?.[0] || '';
  assert.notEqual(autoSkip, '');
  assert.match(autoSkip, /member\.hp > 0/);
  assert.match(autoSkip, /session\.deadSubmittedRounds\.has\(round\)/);
  assert.match(autoSkip, /session\.client\.submit\(session\.room\.id, round, 'basic', ''\)/);
  assert.match(autoSkip, /이번 전투에서는 행동하지 않습니다/);
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

test('답 제출 직후 입력 UI를 없애고 세 명의 결과를 기다린다', () => {
  assert.match(uiSource, /function showPlaybackPanel\(message = '전투 중…'\)/);
  assert.match(uiSource, /querySelector\('\.raid-combat > \.panel-card'\)/);
  assert.match(uiSource, /panel\.innerHTML = `<h3>/);
  assert.match(uiSource, /showPlaybackPanel\('답을 제출했습니다\. 다른 친구들의 답을 기다리는 중…'\)/);
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
  assert.match(combatSource, /kind:'party-heal'/);
  assert.match(combatSource, /kind:'party-shield'/);
  assert.match(combatSource, /member\.cooldowns\[action\.id\]/);
  assert.match(uiSource, /class="combat-badge-v38 \$\{esc\(badge\.key\)\}" data-tooltip=/);
  assert.match(uiSource, /buildStatusBadges/);
  assert.match(uiSource, /event\.kind === 'monster-status'[\s\S]*?raidMonsterStatuses/);
  assert.match(uiSource, /event\.kind === 'party-heal'/);
  assert.match(uiSource, /event\.kind === 'party-shield'/);
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
  assert.match(uiSource, /class="shield-badge" data-tooltip=/);
  assert.match(uiSource, /panelMessage = event\.text \|\| ''/);
  assert.match(uiSource, /function applyEventToView\(event\)/);
  assert.match(uiSource, /view\.monsterShield = Math\.max/);
  assert.match(uiSource, /view\.monsterHp = Math\.max/);
  assert.match(uiSource, /view\.memberShields\[event\.memberId\] = Math\.max/);
  assert.match(uiSource, /function playEvents\(events, onDone\)/);
  assert.match(uiSource, /playEventSound\(event\);\s*\n\s*updateBattleView\(\);/);
  assert.match(uiSource, /let eventDelayMs = 1500/);
});

test('던전 문제 제한시간은 서버의 30초 deadline을 화면 중앙 위에 표시한다', () => {
  assert.match(uiSource, /questionDeadline \?\? networkSession\?\.room\?\.question_deadline/);
  assert.match(uiSource, /id="raidQuestionTimer" class="raid-question-timer"/);
  assert.match(uiSource, /node\.textContent = `⏱ \$\{seconds\}초`/);
  assert.match(uiSource, /global\.setInterval\(updateRaidQuestionTimer, 250\)/);
  assert.match(uiSource, /\['question', 'waiting'\]\.includes\(phase\)\)[\s\S]*?startRaidQuestionTimer\(\)/);
  assert.match(uiSource, /stopRaidQuestionTimer\(\)/);
});

test('아군이 쓰러지면 모든 참가자 재생 흐름에서 기존 사망 효과음을 낸다', () => {
  assert.match(uiSource, /event\.kind === 'member-down'\) call\('playSfx', 'defeat'\)/);
});

test('파티 체력창은 앞·가운데·뒤 색을 구분하고 사냥터 보호막 모양을 재사용한다', () => {
  assert.match(uiSource, /raid-ally-hp \$\{raidSlotClass\(member\.slot\)\}/);
  assert.match(uiSource, /\.raid-ally-hp\.slot-front/);
  assert.match(uiSource, /\.raid-ally-hp\.slot-middle/);
  assert.match(uiSource, /\.raid-ally-hp\.slot-back/);
  assert.match(uiSource, /class="shield-badge"/);
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
  // 버섯·슬라임·스톰프 계열은 사냥터 그림을 그대로 재사용한다(같은 세계관).
  assert.match(uiSource, /function borrowSprite\(name, ctx, cx, cy, scale, tint\)/);
  for (const sprite of ['drawMushroomSprite', 'drawSlimeSprite', 'drawStompSprite']) {
    assert.match(uiSource, new RegExp(`borrowSprite\\('${sprite}'`), `${sprite}를 빌려 써야 한다`);
    assert.match(gameSource, new RegExp(`function ${sprite}\\(`), `${sprite}가 game.js에 있어야 한다`);
  }
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
