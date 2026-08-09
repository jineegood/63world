/* =========================================================
   raid-visual-lab.js — 로컬 전용 던전 1인 시각 검사실

   실제 raid-rules / raid-run / raid-run-ui를 그대로 실행하되,
   Supabase와 캐릭터 저장 모듈은 아예 불러오지 않는다. 이 파일의 가짜 방과
   가짜 파티원은 새로고침하면 사라지는 메모리 값뿐이다.
   ========================================================= */

/* raid-run-ui는 본편의 전역 game 상태를 읽는다. 검사실에는 저장 기능이 없는
   아주 작은 가짜 game만 제공한다. classic script의 전역 var여야 다음 script의
   `typeof game` 검사에서도 보인다. */
var game = {
  currentMap:'town',
  modalState:null,
  settings:{ bgmEnabled:true, bgmVolume:0.15, sfxEnabled:true, sfxVolume:0.60 },
  audio:{},
  player:{
    name:'던전 검사자', map:'town', x:1190, y:1060,
    level:10, exp:0, gold:0, building:0, skillPoints:0,
    hp:999, maxHp:999, raidTopGroup:7, raidRewardVersion:7,
    skillCooldowns:{},
  },
};

(function installRaidVisualLab(global) {
  'use strict';

  const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
  const isLocal = LOCAL_HOSTS.has(String(global.location?.hostname || '').toLowerCase());
  const PLAYER_ID = 'local-raid-inspector';
  const clone = (value) => value == null ? value : structuredClone(value);
  const wait = (ms) => new Promise((resolve) => global.setTimeout(resolve, ms));

  function markRuntimeError(error) {
    const message = String(error?.message || error || 'unknown').slice(0, 180);
    global.document.documentElement.dataset.raidVisualLabError = message;
  }
  global.addEventListener('error', (event) => markRuntimeError(event.error || event.message));
  global.addEventListener('unhandledrejection', (event) => markRuntimeError(event.reason));

  /* 실제 저장소나 통신 모듈은 이 페이지에 로드되지 않는다. 아래 도우미도
     전부 화면만 움직이며 localStorage/fetch/Supabase를 호출하지 않는다. */
  global.YuksamData = {
    worldDefs:{ town:{ playerSpawn:{ x:1190, y:1060 } } },
    SKILL_DEFS:{},
  };
  global.SKILL_DEFS = {};
  global.getPvpIdentityV1 = () => ({ userId:PLAYER_ID, displayName:'던전 검사자', role:'teacher-local' });
  global.flushLocalPlayerForPvpV1 = async () => {};
  global.secureStudentAccessV2 = {
    getIdentity:global.getPvpIdentityV1,
    getClient:() => ({ localRaidVisualLab:true }),
  };
  global.savePlayer = () => true;
  global.updateHud = () => {};
  global.showScreen = () => {};
  global.returnTown = () => {};
  global.applyAuthoritySnapshotFromServerV3 = () => true;
  global.addExp = () => {};
  global.addGold = () => {};
  global.getLearnedActiveSkills = () => [];
  global.getSkillCooldown = () => 0;
  global.setSkillCooldown = () => {};
  global.tickSkillCooldowns = () => {};
  global.getYuksamAudioSettings = () => ({ ...game.settings });
  global.getDesiredAudioFile = () => null;
  global.syncAudioFileBgm = () => {
    if (game.currentMap !== 'raidTower') game.audio?.raidDungeonFile?.pause?.();
  };

  const labQuestions = Object.freeze([
    Object.freeze({ id:'lab-q-1', workbookId:'lab', q:'검사용 문제 1', choices:['정답', '보기 2', '보기 3', '보기 4'], answer:'정답' }),
    Object.freeze({ id:'lab-q-2', workbookId:'lab', q:'검사용 문제 2', choices:['정답', '보기 2', '보기 3', '보기 4'], answer:'정답' }),
    Object.freeze({ id:'lab-q-3', workbookId:'lab', q:'검사용 문제 3', choices:['정답', '보기 2', '보기 3', '보기 4'], answer:'정답' }),
  ]);
  global.getWorkbooks = () => [{ id:'lab', name:'던전 검사 전용', enabled:true }];
  global.getQuestions = () => labQuestions.map((question) => ({ ...question }));

  function showToast(message) {
    const node = global.document.getElementById('toast');
    if (!node) return;
    node.textContent = String(message || '');
    node.classList.remove('hidden');
    global.clearTimeout(showToast.timer);
    showToast.timer = global.setTimeout(() => node.classList.add('hidden'), 1800);
  }
  global.toast = showToast;

  global.openModal = (html, options = {}) => {
    const modal = global.document.getElementById('modal');
    const content = global.document.getElementById('modalContent');
    if (content) content.innerHTML = String(html || '');
    modal?.classList.remove('hidden');
    game.modalState = { type:String(options.type || ''), pause:options.pause === true };
  };
  global.closeModal = () => {
    global.document.getElementById('modal')?.classList.add('hidden');
    game.modalState = null;
  };
  global.appendChatMessage = (_kind, _name, message) => {
    global.RaidVisualLab?.setStatus?.(String(message || ''));
  };

  /* 검사실에서도 실제 mp3 매니페스트를 사용한다. 합성음 전용 이름은 가장
     가까운 기존 mp3로만 치환한다. */
  const sfxAudio = Object.freeze({
    hit:'enemyAttack', miss:'miss', critical:'critical', heal:'holyShared',
    open:'blockShield', quest:'questComplete', defeat:'upgradeFail', stunned:'stunned',
  });
  global.playSfx = (name) => {
    const audioId = sfxAudio[String(name || '')];
    return audioId ? global.playMappedAudio?.(audioId) === true : false;
  };

  /* 아군은 테스트용 단순 인형이다. 몬스터 모델·전투 효과는 raid-run-ui의
     실제 코드를 사용하므로 검사 대상에는 손대지 않는다. */
  const classColor = Object.freeze({ warrior:'#ef4444', mage:'#60a5fa', priest:'#f8fafc' });
  global.drawPlayerSprite = (ctx, x, y, _appearance, klass = 'warrior', state = {}, scale = 1) => {
    const bob = state.moving ? Math.sin(performance.now() / 110) * 2 : Math.sin(performance.now() / 550) * 1.4;
    ctx.save();
    ctx.translate(x, y + bob);
    ctx.scale(scale, scale);
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.beginPath(); ctx.ellipse(0, 18, 18, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = classColor[klass] || '#cbd5e1';
    ctx.beginPath(); ctx.roundRect?.(-13, -18, 26, 34, 8); ctx.fill();
    ctx.fillStyle = '#fde7cf';
    ctx.beginPath(); ctx.arc(0, -28, 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#172033';
    ctx.beginPath(); ctx.arc(-4, -29, 1.7, 0, Math.PI * 2); ctx.arc(4, -29, 1.7, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(11, -8); ctx.lineTo(22, -22); ctx.stroke();
    ctx.restore();
  };

  /* 빌린 사냥터 스프라이트가 없어도 검사 모델이 빈칸이 되지 않게 하는
     최소 그림. 빌딩 스톰프/버섯킹의 추가 장식은 실제 raid-run-ui가 그린다. */
  global.drawMushroomSprite = (ctx, x, y) => {
    ctx.save();
    ctx.fillStyle = '#eadfcb'; ctx.beginPath(); ctx.roundRect?.(x - 22, y - 8, 44, 52, 17); ctx.fill();
    ctx.fillStyle = '#dc3f4d'; ctx.beginPath();
    ctx.moveTo(x - 48, y - 6); ctx.quadraticCurveTo(x, y - 64, x + 48, y - 6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#172033'; ctx.beginPath(); ctx.arc(x - 8, y + 10, 3, 0, Math.PI * 2); ctx.arc(x + 8, y + 10, 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  };
  global.drawStompSprite = (ctx, x, y) => {
    ctx.save();
    const trunk = ctx.createLinearGradient(x, y - 55, x, y + 55);
    trunk.addColorStop(0, '#a66a38'); trunk.addColorStop(1, '#55301d');
    ctx.fillStyle = trunk; ctx.beginPath(); ctx.roundRect?.(x - 39, y - 48, 78, 108, 21); ctx.fill();
    ctx.fillStyle = '#2f6f3d';
    [[-22,-62,28,23],[12,-68,31,25],[38,-48,23,21]].forEach(([dx,dy,rx,ry]) => {
      ctx.beginPath(); ctx.ellipse(x + dx, y + dy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    });
    ctx.fillStyle = '#261a12'; ctx.beginPath(); ctx.arc(x - 13, y - 7, 4, 0, Math.PI * 2); ctx.arc(x + 13, y - 7, 4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  };

  class MemoryRaidRoom {
    constructor() {
      this.listeners = new Set();
      this.sequence = 0;
      this.reset(1);
    }

    reset(floorGroup) {
      this.sequence = 0;
      this.events = [];
      this.submissions = [];
      this.answerKeys = {};
      this.completion = null;
      this.room = {
        id:`local-inspection-${Number(floorGroup) || 1}`,
        code:'LOCAL', hostId:PLAYER_ID, floorGroup:Number(floorGroup) || 1,
        phase:'travel', encounterIndex:0, currentFloor:1, round:0,
        monsterState:{}, question:null, questionDeadline:0, version:1,
      };
      const profile = (userId, name, className, spec, slot, joinOrder) => ({
        roomId:this.room.id, userId, joinOrder, slot, ready:true, active:true, playbackRound:0,
        profile:{
          userId, name, className, spec, level:10, maxHp:999, primaryStat:1, attack:1,
          defense:0, raidTopGroup:7, skills:{}, appearance:{}, equipment:{}, costume:{},
        },
        state:{ hp:999, maxHp:999, shield:0, cooldowns:{}, statuses:{}, buffs:{} },
      });
      this.members = [
        profile(PLAYER_ID, '검사자', 'warrior', '무기', 'front', 1),
        profile('local-lab-mage', '자동 마법사', 'mage', '화염', 'middle', 2),
        profile('local-lab-priest', '자동 사제', 'priest', '신성', 'back', 3),
      ];
      global.RaidVisualLab?.resetMonsterChecklist?.();
    }

    bump() {
      this.room.version += 1;
    }

    response(afterSequence = 0) {
      const mine = this.room.question?.byUser
        ? this.room.question.byUser[PLAYER_ID]
        : this.room.question;
      return clone({
        room:{ ...this.room, question:mine || null },
        members:this.members,
        submissions:this.submissions,
        events:this.events.filter((row) => row.sequenceNo > Number(afterSequence || 0)),
        answerKeys:this.answerKeys,
        completion:this.completion,
      });
    }

    notify() {
      this.listeners.forEach((listener) => {
        try { listener({ type:'local-inspection' }); } catch (_) {}
      });
    }

    forceMonsterHpOne() {
      const snapshot = global.YuksamRaidRunUi?.peek?.();
      if (!snapshot?.monster || snapshot.phase !== 'battle') return false;
      this.room.monsterState = { ...snapshot.monster, hp:1, maxHp:snapshot.monster.maxHp, raidRound:snapshot.round };
      this.bump();
      this.notify();
      return true;
    }

    createClient() {
      const memory = this;
      return Object.freeze({
        async create({ floorGroup = 1 } = {}) {
          memory.reset(floorGroup);
          return memory.response();
        },
        async join() { return memory.response(); },
        async sync(_roomId, afterSequence = 0) { return memory.response(afterSequence); },
        async heartbeat(_roomId, afterSequence = 0) { return memory.response(afterSequence); },
        subscribe(_roomId, listener, onReady) {
          memory.listeners.add(listener);
          global.setTimeout(() => onReady?.(), 0);
          return () => memory.listeners.delete(listener);
        },
        async setFormation() { return memory.response(); },
        async ready() { return memory.response(); },
        async start() { return memory.response(); },
        async beginRound(_roomId, questionPublic, answerKey) {
          if (!['travel', 'effects'].includes(memory.room.phase)) throw new Error('아직 다음 패턴을 시작할 수 없습니다.');
          memory.room.phase = 'question';
          memory.room.round += 1;
          memory.room.question = clone(questionPublic);
          memory.room.questionDeadline = Date.now() + 60_000;
          try { memory.answerKeys = JSON.parse(String(answerKey || '{}')); }
          catch (_) { memory.answerKeys = {}; }
          memory.submissions = [];
          memory.bump();
          return memory.response();
        },
        async submit(_roomId, round, actionId) {
          if (Number(round) !== Number(memory.room.round)) throw new Error('이미 다음 패턴으로 넘어갔습니다.');
          memory.submissions = [
            { userId:PLAYER_ID, actionId:String(actionId || 'basic'), correct:true, timedOut:false },
            { userId:'local-lab-mage', actionId:'basic', correct:true, timedOut:false },
            { userId:'local-lab-priest', actionId:'basic', correct:true, timedOut:false },
          ];
          memory.room.phase = 'resolving';
          memory.bump();
          return { waiting:false, received:3, required:3 };
        },
        async publishRound(_roomId, round, result) {
          if (Number(round) !== Number(memory.room.round)) throw new Error('이미 처리한 패턴입니다.');
          memory.room.phase = String(result.nextPhase || 'effects');
          memory.room.encounterIndex = Math.max(0, Number(result.encounterIndex) || 0);
          memory.room.currentFloor = Math.max(1, Number(result.currentFloor) || 1);
          memory.room.monsterState = clone(result.monsterState || {});
          memory.room.question = null;
          memory.room.questionDeadline = 0;
          Object.entries(result.memberStates || {}).forEach(([userId, state]) => {
            const member = memory.members.find((entry) => entry.userId === userId);
            if (member) member.state = clone(state);
          });
          const rows = (result.events || []).map((event) => ({
            sequenceNo:++memory.sequence,
            round:Number(round) || 0,
            event:clone(event),
          }));
          memory.events.push(...rows);
          memory.bump();
          global.RaidVisualLab?.onRoundPublished?.(result.events || []);
          if (memory.room.phase === 'cleared') {
            memory.completion = {
              awarded:false, firstClear:false, reward:{ exp:0, gold:0, building:0 },
              player:{ level:10, exp:0, skillPoints:0, gold:0, building:0, hp:999, maxHp:999, raidTopGroup:7, raidRewardVersion:7 },
            };
          }
          return memory.response(memory.sequence - rows.length);
        },
        async ackPlayback(_roomId, round) {
          memory.members.forEach((member) => {
            member.playbackRound = Math.max(Number(member.playbackRound) || 0, Number(round) || 0);
          });
          memory.bump();
          return memory.response(memory.sequence);
        },
        async leave() { return { left:true }; },
        close() {},
      });
    }
  }

  const memoryRoom = new MemoryRaidRoom();
  const memoryClient = memoryRoom.createClient();
  global.YuksamRaidPartyClient = Object.freeze({ create:() => memoryClient });

  const controller = {
    running:false,
    auto:false,
    finishing:false,
    actionPending:false,
    monsterId:'',
    seen:new Set(),

    setStatus(message) {
      const node = global.document.getElementById('labStatusText');
      if (node) node.textContent = String(message || '');
    },

    currentMonster() {
      return global.YuksamRaidRunUi?.peek?.()?.monster || null;
    },

    currentPatternNames() {
      return (this.currentMonster()?.pattern || []).map((plan) => String(plan?.name || '공격'));
    },

    resetMonsterChecklist() {
      this.monsterId = '';
      this.seen = new Set();
      this.renderChecklist();
    },

    syncMonsterChecklist() {
      const monster = this.currentMonster();
      const id = String(monster?.id || '');
      if (id && id !== this.monsterId) {
        this.monsterId = id;
        this.seen = new Set();
      }
      this.renderChecklist();
    },

    renderChecklist() {
      const node = global.document.getElementById('labPatternList');
      if (!node) return;
      const monster = this.currentMonster();
      const names = this.currentPatternNames();
      node.innerHTML = names.map((name) => (
        `<span class="lab-pattern ${this.seen.has(name) ? 'seen' : ''}">${name}</span>`
      )).join('');
      if (monster) {
        const count = names.filter((name) => this.seen.has(name)).length;
        this.setStatus(`${monster.name} · 패턴 ${count}/${names.length} 확인${this.auto ? ' · 자동 검사 중' : ''}`);
      }
      const finish = global.document.getElementById('labFinishBtn');
      if (finish) finish.disabled = !monster || this.finishing;
    },

    onRoundPublished(events) {
      this.syncMonsterChecklist();
      const allowed = new Set(this.currentPatternNames());
      (events || []).forEach((event) => {
        const name = String(event?.planName || '');
        if (allowed.has(name)) this.seen.add(name);
      });
      this.renderChecklist();
      if (this.auto && this.allPatternsSeen()) {
        this.auto = false;
        this.updateButtons();
        this.setStatus(`${this.currentMonster()?.name || '몬스터'}의 모든 패턴을 확인했습니다. 다음 몬스터로 버튼을 누르세요.`);
      }
    },

    allPatternsSeen() {
      const names = this.currentPatternNames();
      return names.length > 0 && names.every((name) => this.seen.has(name));
    },

    updateButtons() {
      const active = this.running && !!global.YuksamRaidRunUi?.isRunning?.();
      const one = global.document.getElementById('labOneTurnBtn');
      const auto = global.document.getElementById('labAutoBtn');
      const finish = global.document.getElementById('labFinishBtn');
      const stop = global.document.getElementById('labStopBtn');
      if (one) one.disabled = !active || this.actionPending || this.finishing;
      if (auto) {
        auto.disabled = !active || this.finishing;
        auto.classList.toggle('on', this.auto);
        auto.textContent = this.auto ? '자동 검사 멈춤' : '이 몬스터 자동 검사';
      }
      if (finish) finish.disabled = !active || !this.currentMonster() || this.finishing;
      if (stop) stop.disabled = !active;
    },

    async waitFor(selector, timeoutMs = 12_000) {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        const node = global.document.querySelector(selector);
        if (node && !node.disabled) return node;
        if (!this.running) return null;
        await wait(80);
      }
      return null;
    },

    async playOneTurn({ allowWhileFinishing = false } = {}) {
      if (!this.running || this.actionPending || (this.finishing && !allowWhileFinishing)) return false;
      this.actionPending = true;
      this.updateButtons();
      try {
        const attack = await this.waitFor('[data-raid-menu="attack"]', 15_000);
        if (!attack) return false;
        attack.click();
        const choice = await this.waitFor('.raid-choice', 8_000);
        if (choice) {
          choice.click();
          return true;
        }
        const input = await this.waitFor('#combatAnswer', 1_000);
        const submit = global.document.getElementById('raidSubmitBtn');
        if (input && submit) {
          input.value = '정답';
          submit.click();
          return true;
        }
        return false;
      } finally {
        this.actionPending = false;
        this.updateButtons();
      }
    },

    async autoLoop() {
      while (this.running && this.auto) {
        this.syncMonsterChecklist();
        if (this.allPatternsSeen()) {
          this.auto = false;
          break;
        }
        if (!global.YuksamRaidRunUi?.isBusy?.()) await this.playOneTurn();
        await wait(180);
      }
      this.updateButtons();
    },

    async finishMonster() {
      if (!this.running || this.finishing) return;
      this.auto = false;
      this.finishing = true;
      this.updateButtons();
      const beforeId = String(this.currentMonster()?.id || '');
      this.setStatus('현재 몬스터를 마무리하고 다음 조우로 이동합니다…');
      try {
        const deadline = Date.now() + 35_000;
        while (this.running && Date.now() < deadline) {
          const snapshot = global.YuksamRaidRunUi?.peek?.();
          const id = String(snapshot?.monster?.id || '');
          if (!snapshot || snapshot.phase === 'cleared' || (id && beforeId && id !== beforeId)) break;
          if (snapshot.phase === 'battle' && !global.YuksamRaidRunUi?.isBusy?.()) {
            memoryRoom.forceMonsterHpOne();
            await wait(220);
            await this.playOneTurn({ allowWhileFinishing: true });
          }
          await wait(180);
        }
      } finally {
        this.finishing = false;
        this.resetMonsterChecklist();
        this.updateButtons();
      }
    },

    async start() {
      if (!isLocal) return;
      this.auto = false;
      this.finishing = false;
      this.actionPending = false;
      if (global.YuksamRaidRunUi?.isRunning?.()) {
        global.YuksamRaidRunUi.leaveNow();
        await wait(100);
      }
      const floorGroup = Number(global.document.getElementById('labFloorSelect')?.value) || 1;
      this.running = true;
      this.resetMonsterChecklist();
      this.setStatus('가짜 파티를 만들고 첫 몬스터에게 이동합니다…');
      global.YuksamRaidRunUi?.setTravelSpeed?.(160, 260);
      global.YuksamRaidRunUi?.setLogSpeed?.(720);
      const opened = await global.YuksamRaidRunUi?.openNetworkLobby?.({ mode:'create', floorGroup });
      if (!opened) {
        this.running = false;
        this.setStatus('검사 화면을 열지 못했습니다. 새로고침 후 다시 시도하세요.');
      }
      this.updateButtons();
    },

    stop() {
      this.auto = false;
      this.finishing = false;
      this.running = false;
      global.YuksamRaidRunUi?.leaveNow?.();
      global.YuksamCombatFx?.cancelAllCombatFx?.();
      this.resetMonsterChecklist();
      this.setStatus('검사를 종료했습니다. 실제 서버와 캐릭터 기록에는 아무것도 저장되지 않았습니다.');
      this.updateButtons();
    },
  };

  global.RaidVisualLab = controller;

  function initialize() {
    const block = global.document.getElementById('labLocalBlock');
    if (!isLocal) {
      block?.classList.add('on');
      return;
    }
    const select = global.document.getElementById('labFloorSelect');
    const groups = global.YuksamRaidProgress?.GROUPS || [];
    if (select) {
      select.innerHTML = groups.map((group) => (
        `<option value="${group.id}">${group.label} · 추천 Lv.${group.recommendedLevel}</option>`
      )).join('');
    }
    global.document.getElementById('labStartBtn')?.addEventListener('click', () => controller.start());
    global.document.getElementById('labOneTurnBtn')?.addEventListener('click', () => controller.playOneTurn());
    global.document.getElementById('labAutoBtn')?.addEventListener('click', () => {
      controller.auto = !controller.auto;
      controller.updateButtons();
      if (controller.auto) controller.autoLoop();
    });
    global.document.getElementById('labFinishBtn')?.addEventListener('click', () => controller.finishMonster());
    global.document.getElementById('labStopBtn')?.addEventListener('click', () => controller.stop());
    global.setInterval(() => {
      if (!controller.running) return;
      controller.syncMonsterChecklist();
      controller.updateButtons();
    }, 350);
    controller.updateButtons();
    global.document.documentElement.dataset.raidVisualLab = 'ready';
    const query = new URLSearchParams(global.location.search);
    if (query.get('autostart') === '1') {
      global.setTimeout(async () => {
        await controller.start();
        if (query.get('autoturn') === '1') await controller.playOneTurn();
      }, 0);
    }
  }

  if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', initialize);
  else initialize();
})(window);
