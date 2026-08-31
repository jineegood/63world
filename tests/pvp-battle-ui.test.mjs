import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const sourcePath = path.join(root, 'src/pvp-battle.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const styleSource = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

function createClassList(element, initial = '') {
  const names = new Set(String(initial).split(/\s+/).filter(Boolean));
  const sync = () => { element.className = [...names].join(' '); };
  sync();
  return {
    add(...values) {
      values.forEach((value) => names.add(value));
      sync();
    },
    remove(...values) {
      values.forEach((value) => names.delete(value));
      sync();
    },
    toggle(value, force) {
      const enabled = force === undefined ? !names.has(value) : Boolean(force);
      if (enabled) names.add(value);
      else names.delete(value);
      sync();
      return enabled;
    },
    contains(value) {
      return names.has(value);
    },
  };
}

function createElement(id = '', className = '') {
  const element = {
    id,
    className:'',
    textContent:'',
    value:'',
    style:{},
    children:[],
    focused:false,
    removed:false,
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    focus() {
      this.focused = true;
    },
    remove() {
      this.removed = true;
    },
  };
  element.classList = createClassList(element, className);
  return element;
}

function visibleText(html) {
  return String(html || '').replace(/<[^>]*>/g, '');
}

function harness({ viewerId = 'a', submitResult = { waiting:true, round:1 } } = {}) {
  const opened = [];
  const calls = [];
  const draws = [];
  const elements = new Map();
  const actors = {
    player:createElement('', 'combat-player'),
    monster:createElement('', 'combat-monster'),
    stage:createElement('', 'pvp-combat-stage-v2'),
  };
  const timeouts = new Map();
  const intervals = new Map();
  let timeoutId = 0;
  let intervalId = 0;
  let now = 1_800_000_000_000;
  let listener = null;
  let heartbeatResult;
  let syncResult = null;

  function refreshElements(html) {
    elements.clear();
    const tagPattern = /<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi;
    let match;
    while ((match = tagPattern.exec(html))) {
      const attributes = match[2];
      const id = match[3];
      const className = attributes.match(/\bclass="([^"]*)"/i)?.[1] || '';
      const element = createElement(id, className);
      const immediateText = html.slice(tagPattern.lastIndex).match(/^([^<]*)/)?.[1] || '';
      element.textContent = immediateText.replace(/&[^;]+;/g, '').trim();
      elements.set(id, element);
    }
  }

  function openModal(html, options) {
    opened.push({ html, options });
    refreshElements(html);
  }

  function setTimeoutFake(fn, delay = 0) {
    const id = ++timeoutId;
    timeouts.set(id, { id, due:now + Math.max(0, Number(delay) || 0), fn });
    return id;
  }

  function clearTimeoutFake(id) {
    timeouts.delete(id);
  }

  async function flushMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  async function advance(milliseconds) {
    const target = now + Math.max(0, Number(milliseconds) || 0);
    let guard = 0;
    while (guard < 10000) {
      guard += 1;
      await flushMicrotasks();
      const next = [...timeouts.values()]
        .filter((timer) => timer.due <= target)
        .sort((left, right) => left.due - right.due || left.id - right.id)[0];
      if (!next) break;
      now = Math.max(now, next.due);
      timeouts.delete(next.id);
      next.fn();
    }
    if (guard >= 10000) throw new Error('fake timer runaway');
    now = target;
    await flushMicrotasks();
  }

  function setIntervalFake(fn) {
    const id = ++intervalId;
    intervals.set(id, fn);
    return id;
  }

  function tickIntervals() {
    [...intervals.values()].forEach((fn) => fn());
  }

  class FakeDate extends Date {
    static now() {
      return now;
    }
  }

  const client = {
    subscribe(_id, fn) {
      listener = fn;
      return () => calls.push(['unsubscribe']);
    },
    async submit(...args) {
      calls.push(['submit', ...args]);
      return submitResult;
    },
    async ready(id, round) {
      calls.push(['ready', id, round]);
      return { ready:true };
    },
    async heartbeat(id) {
      calls.push(['heartbeat', id]);
      return heartbeatResult;
    },
    async surrender(id) {
      calls.push(['surrender', id]);
      return { finished:true };
    },
    async sync(id) {
      calls.push(['sync', id]);
      return syncResult;
    },
  };

  const window = {
    getPvpClientV1:() => client,
    getPvpIdentityV1:() => ({ userId:viewerId, displayName:viewerId.toUpperCase(), role:'student' }),
    openModal,
    closeModal:() => calls.push(['close']),
    renderPlayerCombatantForPvpV1:(canvas, profile, flipped) => {
      draws.push({ canvasId:canvas?.id, profile, flipped });
    },
    toast:(message) => calls.push(['toast', message]),
    playSfx:(id) => calls.push(['sfx', id]),
    playMappedAudio:(id) => {
      calls.push(['mappedAudio', id]);
      return true;
    },
    syncPvpBgmV1:() => calls.push(['pvpBgmSync']),
    YuksamInputRouter:{
      register({ handle }) {
        window.escapeHandler = handle;
      },
    },
    YuksamData:{ V24_SKILLS:{} },
  };

  const document = {
    getElementById:(id) => elements.get(id) || null,
    querySelector:(selector) => {
      if (selector.includes('.combat-player')) return actors.player;
      if (selector.includes('.combat-monster')) return actors.monster;
      if (selector.includes('.pvp-combat-stage-v2')) return actors.stage;
      return null;
    },
    createElement:() => createElement(),
  };

  vm.runInNewContext(source, {
    window,
    document,
    setInterval:setIntervalFake,
    clearInterval:(id) => intervals.delete(id),
    setTimeout:setTimeoutFake,
    clearTimeout:clearTimeoutFake,
    Date:FakeDate,
    Math,
    Promise,
    console,
  });

  const match = {
    id:'m1',
    round:1,
    phase:'question',
    deadline:now + 30_000,
    playerAId:'a',
    playerBId:'b',
    playerAState:{
      userId:'a',
      name:'A',
      level:5,
      hp:100,
      maxHp:100,
      shield:0,
      skills:{},
      appearance:{ hair:'a-hair' },
    },
    playerBState:{
      userId:'b',
      name:'B',
      level:6,
      hp:100,
      maxHp:100,
      shield:0,
      skills:{},
      appearance:{ hair:'b-hair' },
    },
    question:{
      prompt:'2 + 3 = ?',
      choices:['3', '4', '5', '6'],
    },
  };

  return {
    window,
    opened,
    calls,
    draws,
    elements,
    actors,
    client,
    match,
    emit:(event) => listener?.(event),
    setHeartbeatResult:(result) => { heartbeatResult = result; },
    setSyncResult:(result) => { syncResult = result; },
    advance,
    now:() => now,
    tickIntervals,
    lastHtml:() => opened.at(-1)?.html || '',
  };
}

test('PvP reuses the normal combat stage and keeps the local player on the left even as player B', () => {
  const ui = harness({ viewerId:'b' });
  ui.window.enterPvpMatchV1(ui.match);

  const html = ui.lastHtml();
  assert.match(html, /class="combat-layout"/);
  assert.match(html, /class="combat-stage [^"]*pvp-combat-stage-v2"/);
  assert.match(html, /class="combat-hpbox player"/);
  assert.match(html, /class="combat-hpbox monster"/);
  assert.match(html, /class="combat-sprite combat-player/);
  assert.match(html, /class="combat-sprite combat-monster/);
  assert.doesNotMatch(html, /pvp-arena-v1|pvp-fighter-v1|pvp-center-v1/);

  const [localDraw, opponentDraw] = ui.draws.slice(-2);
  assert.equal(localDraw.canvasId, 'pvpPlayerCanvasV2');
  assert.equal(localDraw.profile.name, 'B');
  assert.equal(localDraw.flipped, false);
  assert.equal(opponentDraw.canvasId, 'pvpOpponentCanvasV2');
  assert.equal(opponentDraw.profile.name, 'A');
  assert.equal(opponentDraw.flipped, true);
  assert.ok(html.indexOf('Lv.6 B') < html.indexOf('Lv.5 A'));
});

test('round and countdown share a centered header while the countdown stays prominent', () => {
  const ui = harness();
  ui.window.enterPvpMatchV1(ui.match);

  const html = ui.lastHtml();
  assert.match(
    html,
    /<div class="pvp-battle-header-v4">\s*<h2>전투<\/h2>\s*<span class="pvp-round-badge-v2">친선 대전 · 1라운드\s*<b id="pvpRoundTimerV2">30초<\/b>/,
  );
  assert.match(styleSource, /\.pvp-battle-header-v4\{[\s\S]*justify-content:center/);
  assert.match(styleSource, /\.pvp-battle-header-v4>h2\{position:absolute;left:0/);
  assert.match(styleSource, /\.pvp-round-badge-v2 b\{[\s\S]*font-size:25px;line-height:1/);
});

test('PvP opens with a short named versus intro without blocking the battle panel', async () => {
  const ui = harness();
  ui.window.enterPvpMatchV1(ui.match);

  assert.match(ui.lastHtml(), /pvp-battle-intro-v5/);
  assert.match(ui.lastHtml(), /친선 대전/);
  assert.match(ui.lastHtml(), /<strong>A<\/strong>[\s\S]*<span>VS<\/span>[\s\S]*<strong>B<\/strong>/);
  assert.match(ui.lastHtml(), /전투 시작!/);
  assert.match(ui.lastHtml(), />공격<\/button>/);

  await ui.advance(1_800);
  assert.doesNotMatch(ui.lastHtml(), /pvp-battle-intro-v5/);
  assert.match(styleSource, /@keyframes pvpBattleIntroV5/);
});

test('finished PvP result omits the world-health and resources explanation', () => {
  const ui = harness();
  ui.window.enterPvpMatchV1({
    ...ui.match,
    phase:'finished',
    winnerId:'a',
    loserId:'b',
  });

  assert.match(ui.lastHtml(), /🏆 승리!/);
  assert.doesNotMatch(ui.lastHtml(), /월드 체력과 보유 자원은 그대로 유지됩니다/);
});

test('PvP switches to battle BGM and plays the victory sound once after winning', async () => {
  const ui = harness();
  ui.window.enterPvpMatchV1(ui.match);
  assert.deepEqual(ui.calls.filter(([type]) => type === 'pvpBgmSync'), [['pvpBgmSync']]);

  const finished = {
    ...ui.match,
    phase:'finished',
    winnerId:'a',
    loserId:'b',
  };
  ui.emit({ type:'match', match:finished });
  await ui.advance(1_200);

  assert.deepEqual(
    ui.calls.filter(([type]) => type === 'mappedAudio'),
    [['mappedAudio', 'pvpVictory']],
  );
  ui.window.enterPvpMatchV1(finished);
  await ui.advance(100);
  assert.equal(ui.calls.filter(([type]) => type === 'mappedAudio').length, 1);
});

test('the losing player hears the failure sound, while a cancelled match stays silent', () => {
  const loser = harness({ viewerId:'b' });
  loser.window.enterPvpMatchV1({
    ...loser.match,
    phase:'finished',
    winnerId:'a',
    loserId:'b',
  });
  assert.deepEqual(
    loser.calls.filter(([type]) => type === 'mappedAudio'),
    [['mappedAudio', 'upgradeFail']],
  );

  const cancelled = harness();
  cancelled.window.enterPvpMatchV1({ ...cancelled.match, phase:'cancelled' });
  assert.equal(cancelled.calls.some(([type]) => type === 'mappedAudio'), false);
});

test('leaving PvP resynchronizes the current map music', () => {
  const ui = harness();
  ui.window.enterPvpMatchV1(ui.match);
  ui.window.leavePvpScreenV1();

  assert.equal(ui.calls.filter(([type]) => type === 'pvpBgmSync').length, 2);
});

test('PvP combat logs keep the prior pacing plus one extra second', () => {
  assert.match(source, /const LOG_HOLD_SCALE = 1\.6;/);
  assert.match(source, /const LOG_HOLD_EXTRA_MS = 1000;/);
  assert.match(source, /action:700 \* LOG_HOLD_SCALE \+ LOG_HOLD_EXTRA_MS/);
  assert.match(source, /damage:850 \* LOG_HOLD_SCALE \+ LOG_HOLD_EXTRA_MS/);
  assert.match(source, /heal:750 \* LOG_HOLD_SCALE \+ LOG_HOLD_EXTRA_MS/);
  assert.match(source, /shield:750 \* LOG_HOLD_SCALE \+ LOG_HOLD_EXTRA_MS/);
  assert.match(source, /status:700 \* LOG_HOLD_SCALE \+ LOG_HOLD_EXTRA_MS/);
});

test('later rounds wait for both playbacks and then show a fresh thirty-second timer', async () => {
  const ui = harness();
  ui.window.enterPvpMatchV1(ui.match);
  ui.emit({
    type:'match',
    match:{
      ...ui.match,
      round:2,
      deadline:ui.now() + 60_000,
      timerStartedRound:1,
      question:{ prompt:'6 + 7 = ?', choices:['11', '12', '13', '14'] },
    },
  });
  await ui.advance(1_200);
  assert.match(ui.lastHtml(), /상대 화면도 준비되는 중/);
  assert.equal(ui.calls.some(([type, id, round]) => (
    type === 'ready' && id === 'm1' && round === 2
  )), true);

  ui.emit({
    type:'match',
    match:{
      ...ui.match,
      round:2,
      deadline:ui.now() + 30_000,
      timerStartedRound:2,
      question:{ prompt:'6 + 7 = ?', choices:['11', '12', '13', '14'] },
    },
  });
  await ui.advance(800);
  assert.match(ui.lastHtml(), /2라운드! 무엇을 할까요/);
  assert.match(ui.lastHtml(), />30초</);
});

test('attack opens the shared question as a four-choice 2x2 grid', () => {
  const ui = harness();
  ui.window.enterPvpMatchV1(ui.match);
  assert.match(ui.lastHtml(), />공격<\/button>/);
  assert.doesNotMatch(ui.lastHtml(), /2 \+ 3 = \?/);

  ui.window.choosePvpActionV1('basic');
  const html = ui.lastHtml();
  assert.match(html, /2 \+ 3 = \?/);
  assert.match(html, /class="choice-grid"/);
  assert.equal((html.match(/data-answer-key=/g) || []).length, 4);
  assert.deepEqual(
    [...html.matchAll(/class="objective-chip">(\d)<\/span>/g)].map((match) => match[1]),
    ['1', '2', '3', '4'],
  );
  assert.doesNotMatch(html, /<select\b|pvpActionV1/);
});

test('submitting early locks the answer and waits without revealing correctness', async () => {
  const ui = harness();
  ui.window.enterPvpMatchV1(ui.match);
  ui.window.choosePvpActionV1('basic');
  await ui.window.submitPvpChoiceV1(encodeURIComponent('5'));

  assert.deepEqual(
    ui.calls.find(([type]) => type === 'submit'),
    ['submit', 'm1', 1, 'basic', '5'],
  );
  const html = ui.lastHtml();
  assert.match(html, /상대가 문제를 풀고 있어요|상대를 기다리는 중/);
  assert.doesNotMatch(html, /정답입니다|오답입니다|정답은|correctAnswer|answerKey/);
  assert.doesNotMatch(html, /2 \+ 3 = \?/);
});

test('same-round waiting match update cannot unlock an already submitted round', async () => {
  const ui = harness();
  ui.window.enterPvpMatchV1(ui.match);
  ui.window.choosePvpActionV1('basic');
  await ui.window.submitPvpChoiceV1(encodeURIComponent('5'));

  ui.emit({
    type:'match',
    match:{
      ...ui.match,
      phase:'waiting',
    },
  });
  await ui.advance(800);

  assert.match(ui.lastHtml(), /상대가 문제를 풀고 있어요|상대를 기다리는 중/);
  assert.doesNotMatch(ui.lastHtml(), />공격<\/button>|>스킬<\/button>/);
  assert.doesNotMatch(ui.lastHtml(), /class="choice-grid"/);
});

test('dice visibly rolls and settles before queued damage is applied', async () => {
  const ui = harness();
  ui.window.enterPvpMatchV1(ui.match);

  ui.emit({
    type:'event',
    round:1,
    sequenceNo:1,
    kind:'dice',
    rolls:[{ a:27, b:4 }],
    first:'a',
  });
  ui.emit({
    type:'event',
    round:1,
    sequenceNo:2,
    kind:'damage',
    source:'a',
    target:'b',
    amount:15,
    absorbed:0,
    hpDamage:15,
  });

  assert.match(ui.lastHtml(), /pvp-dice-overlay-v2/);
  assert.match(ui.lastHtml(), /pvp-dice-stage-v3/);
  assert.match(ui.lastHtml(), /pvp-dice-floor-v3/);
  assert.equal((ui.lastHtml().match(/pvp-die-runner-v3/g) || []).length, 2);
  assert.equal((ui.lastHtml().match(/pvp-die-facet-v3/g) || []).length, 6);
  assert.equal((ui.lastHtml().match(/pvp-die-v2 rolling/g) || []).length, 2);
  assert.match(ui.lastHtml(), /HP 100\/100/);
  assert.equal(ui.calls.some(([type, id]) => type === 'sfx' && id === 'transition'), true);
  assert.equal(ui.calls.some(([type, id]) => type === 'sfx' && id === 'hit'), false);

  await ui.advance(1_530);
  assert.equal(ui.elements.get('pvpLeftDieValueV3')?.textContent, '27');
  assert.equal(ui.elements.get('pvpRightDieValueV3')?.textContent, '4');
  assert.equal(ui.elements.get('pvpLeftDieV2')?.classList.contains('rolling'), false);
  assert.equal(ui.elements.get('pvpLeftDieV2')?.classList.contains('settled'), true);
  assert.equal(ui.calls.filter(([type, id]) => type === 'sfx' && id === 'open').length, 1);
  assert.equal(ui.calls.some(([type, id]) => type === 'sfx' && id === 'hit'), false);

  await ui.advance(1_000);
  assert.match(ui.lastHtml(), /HP 85\/100/);
  assert.match(visibleText(ui.lastHtml()), /A 학생이 B 학생에게 총 15의 피해를 주었습니다! \(체력 15\)/);
  assert.equal(ui.calls.filter(([type, id]) => type === 'sfx' && id === 'hit').length, 1);
});

test('dice CSS travels, bounces, tumbles on multiple axes, and visibly brakes', () => {
  assert.match(styleSource, /@keyframes pvpDieRunLeftV3[\s\S]*translate3d\(-145px,-\d+px,70px\)[\s\S]*translate3d\(0,0,0\)/);
  assert.match(styleSource, /@keyframes pvpDieRunRightV3[\s\S]*translate3d\(145px,-\d+px,80px\)[\s\S]*translate3d\(0,0,0\)/);
  assert.match(styleSource, /@keyframes pvpDieTumbleFastV3[\s\S]*rotateX\([\d]+deg\)[\s\S]*rotateY\([\d]+deg\)[\s\S]*rotateZ\([\d]+deg\)/);
  assert.match(styleSource, /\.pvp-die-v2\.rolling\.motion-brake\{animation:pvpDieTumbleBrakeV3/);
  assert.match(styleSource, /@keyframes pvpDieShadowBounceV3/);
  assert.match(styleSource, /@keyframes pvpDieDustV3/);
});

test('damage split across shield and HP shows the total log and two floating numbers', async () => {
  const ui = harness();
  ui.window.enterPvpMatchV1({
    ...ui.match,
    playerBState:{ ...ui.match.playerBState, shield:7 },
  });
  ui.emit({
    type:'event',
    round:1,
    sequenceNo:8,
    kind:'damage',
    source:'a',
    target:'b',
    amount:15,
    absorbed:7,
    hpDamage:8,
  });

  await ui.advance(70);
  assert.match(
    visibleText(ui.lastHtml()),
    /A 학생이 B 학생에게 총 15의 피해를 주었습니다! \(보호막 7, 체력 8\)/,
  );
  const numbers = ui.actors.stage.children.filter((child) => /combat-floating-damage/.test(child.className));
  assert.equal(numbers.length, 2);
  assert.deepEqual(numbers.map((child) => child.textContent), ['-7', '-8']);
  assert.match(numbers[0].className, /shield-damage/);
  assert.match(numbers[1].className, /damage/);
  assert.notEqual(numbers[0].style.left, numbers[1].style.left);
});

test('a missed PvP hit leaves HP and visuals unchanged while logging and playing miss audio', async () => {
  const ui = harness();
  ui.window.enterPvpMatchV1(ui.match);
  ui.emit({
    type:'event',
    round:1,
    sequenceNo:81,
    kind:'damage',
    source:'a',
    target:'b',
    amount:0,
    absorbed:0,
    hpDamage:0,
    missed:true,
    label:'기본 공격',
  });

  await ui.advance(70);
  assert.match(ui.lastHtml(), /HP 100\/100/);
  assert.match(visibleText(ui.lastHtml()), /A 학생의 기본 공격이 B 학생에게 빗나갔습니다!/);
  assert.equal(
    ui.actors.stage.children.some((child) => /combat-floating-damage/.test(child.className)),
    false,
  );
  assert.equal(ui.actors.monster.classList.contains('impact'), false);
  assert.deepEqual(
    ui.calls.filter(([type]) => type === 'mappedAudio'),
    [['mappedAudio', 'miss']],
  );
  assert.equal(ui.calls.some(([type, id]) => type === 'sfx' && id === 'hit'), false);
  assert.equal(ui.calls.some(([type, id]) => type === 'sfx' && id === 'critical'), false);
});

test('critical damage split marks only the HP number critical and plays the critical cue', async () => {
  const ui = harness();
  ui.window.enterPvpMatchV1({
    ...ui.match,
    playerBState:{ ...ui.match.playerBState, shield:7 },
  });
  ui.emit({
    type:'event',
    round:1,
    sequenceNo:82,
    kind:'damage',
    source:'a',
    target:'b',
    amount:15,
    absorbed:7,
    hpDamage:8,
    critical:true,
  });

  await ui.advance(70);
  assert.match(
    visibleText(ui.lastHtml()),
    /💥 치명타! A 학생이 B 학생에게 총 15의 피해를 주었습니다! \(보호막 7, 체력 8\)/,
  );
  const numbers = ui.actors.stage.children.filter((child) => /combat-floating-damage/.test(child.className));
  assert.equal(numbers.length, 2);
  assert.match(numbers[0].className, /shield-damage/);
  assert.doesNotMatch(numbers[0].className, /\bcritical\b/);
  assert.match(numbers[1].className, /\bdamage\b/);
  assert.match(numbers[1].className, /\bcritical\b/);
  assert.equal(ui.calls.filter(([type, id]) => type === 'sfx' && id === 'critical').length, 1);
  assert.equal(ui.calls.some(([type, id]) => type === 'sfx' && id === 'hit'), false);
});

test('a critical fully absorbed by shield plays both shield-block and critical cues', async () => {
  const ui = harness();
  ui.window.enterPvpMatchV1({
    ...ui.match,
    playerBState:{ ...ui.match.playerBState, shield:12 },
  });
  ui.emit({
    type:'event',
    round:1,
    sequenceNo:83,
    kind:'damage',
    source:'a',
    target:'b',
    amount:12,
    absorbed:12,
    hpDamage:0,
    critical:true,
  });

  await ui.advance(70);
  assert.match(ui.lastHtml(), /HP 100\/100/);
  assert.match(
    visibleText(ui.lastHtml()),
    /💥 치명타! A 학생이 B 학생에게 총 12의 피해를 주었습니다! \(보호막 12\)/,
  );
  const numbers = ui.actors.stage.children.filter((child) => /combat-floating-damage/.test(child.className));
  assert.equal(numbers.length, 1);
  assert.match(numbers[0].className, /shield-damage/);
  assert.doesNotMatch(numbers[0].className, /\bcritical\b/);
  assert.equal(ui.calls.filter(([type, id]) => type === 'sfx' && id === 'shieldBlock').length, 1);
  assert.equal(ui.calls.filter(([type, id]) => type === 'sfx' && id === 'critical').length, 1);
  assert.equal(ui.calls.some(([type, id]) => type === 'sfx' && id === 'hit'), false);
});

test('a tied server roll lands, then launches both dice again and settles on the final roll', async () => {
  const ui = harness();
  ui.window.enterPvpMatchV1(ui.match);
  ui.emit({
    type:'event',
    round:1,
    sequenceNo:20,
    kind:'dice',
    rolls:[
      { a:12, b:12 },
      { a:5, b:28 },
    ],
    first:'b',
  });

  await ui.advance(1_530);
  assert.equal(ui.elements.get('pvpLeftDieValueV3')?.textContent, '12');
  assert.equal(ui.elements.get('pvpRightDieValueV3')?.textContent, '12');
  assert.match(ui.elements.get('pvpDiceCaptionV2')?.textContent || '', /동점/);
  assert.equal(ui.elements.get('pvpLeftDieV2')?.classList.contains('settled'), true);

  await ui.advance(650);
  assert.match(ui.lastHtml(), /pvp-dice-overlay-v2 rerolling/);
  assert.equal(ui.elements.get('pvpLeftDieV2')?.classList.contains('rolling'), true);
  assert.match(ui.elements.get('pvpDiceHistoryV3')?.textContent || '', /12 : 12/);

  await ui.advance(1_530);
  assert.equal(ui.elements.get('pvpLeftDieValueV3')?.textContent, '5');
  assert.equal(ui.elements.get('pvpRightDieValueV3')?.textContent, '28');
  assert.match(ui.elements.get('pvpDiceCaptionV2')?.textContent || '', /B 학생이 먼저 공격합니다/);
  assert.equal(ui.calls.filter(([type, id]) => type === 'sfx' && id === 'transition').length, 2);
  assert.equal(ui.calls.filter(([type, id]) => type === 'sfx' && id === 'open').length, 2);
});

test('heartbeat replay events finish before the next-round menu is shown', async () => {
  const ui = harness();
  ui.window.enterPvpMatchV1(ui.match);
  ui.setHeartbeatResult({
    resolved:true,
    round:1,
    replayEvents:[
      {
        round:1,
        sequenceNo:1001,
        kind:'dice',
        rolls:[{ a:24, b:7 }],
        first:'a',
      },
      {
        round:1,
        sequenceNo:1002,
        kind:'damage',
        source:'a',
        target:'b',
        amount:15,
        absorbed:0,
        hpDamage:15,
      },
    ],
    match:{
      ...ui.match,
      round:2,
      phase:'question',
      playerBState:{
        ...ui.match.playerBState,
        hp:85,
      },
      question:{
        prompt:'6 + 7 = ?',
        choices:['11', '12', '13', '14'],
      },
    },
  });

  ui.tickIntervals();
  await ui.advance(0);
  assert.match(ui.lastHtml(), /pvp-dice-overlay-v2/);
  assert.doesNotMatch(ui.lastHtml(), /2라운드! 무엇을 할까요/);

  await ui.advance(1_530);
  assert.equal(ui.elements.get('pvpLeftDieValueV3')?.textContent, '24');
  assert.equal(ui.elements.get('pvpRightDieValueV3')?.textContent, '7');
  assert.equal(ui.calls.some(([type, id]) => type === 'sfx' && id === 'hit'), false);

  await ui.advance(3_700);
  assert.match(ui.lastHtml(), /친선 대전 · 2라운드/);
  assert.match(ui.lastHtml(), /2라운드! 무엇을 할까요\?/);
  assert.match(ui.lastHtml(), /HP 85\/100/);
  assert.match(ui.lastHtml(), />공격<\/button>/);
  assert.equal(ui.calls.filter(([type, id]) => type === 'sfx' && id === 'hit').length, 1);
});

test('re-entering the same match does not reset an in-progress dice queue', async () => {
  const ui = harness();
  ui.window.enterPvpMatchV1(ui.match);
  ui.emit({
    type:'event',
    round:1,
    sequenceNo:11,
    kind:'dice',
    rolls:[{ a:22, b:6 }],
    first:'a',
  });
  ui.emit({
    type:'event',
    round:1,
    sequenceNo:12,
    kind:'damage',
    source:'a',
    target:'b',
    amount:10,
    absorbed:0,
    hpDamage:10,
  });
  await ui.advance(300);
  const rollingHtml = ui.lastHtml();
  assert.match(rollingHtml, /pvp-dice-overlay-v2/);

  ui.window.enterPvpMatchV1({
    ...ui.match,
    playerBState:{
      ...ui.match.playerBState,
      hp:90,
    },
  });
  assert.equal(ui.lastHtml(), rollingHtml);
  assert.equal(ui.calls.some(([type]) => type === 'unsubscribe'), false);

  await ui.advance(3_400);
  assert.match(ui.lastHtml(), /HP 90\/100/);
  assert.equal(ui.calls.filter(([type, id]) => type === 'sfx' && id === 'hit').length, 1);
});

test('wrong-answer action log is complete before minimum guard shield playback', async () => {
  const ui = harness();
  ui.window.enterPvpMatchV1(ui.match);

  ui.emit({
    type:'event',
    round:1,
    sequenceNo:3,
    kind:'action',
    source:'a',
    target:'b',
    actionId:'basic',
    correct:false,
    correctAnswer:'5',
  });
  ui.emit({
    type:'event',
    round:1,
    sequenceNo:4,
    kind:'shield',
    source:'b',
    target:'b',
    amount:1,
    skillId:'warrior_basic_guard',
    passive:true,
  });

  await ui.advance(70);
  const actionNotice = ui.lastHtml().match(/<h3 class="combat-notice[^"]*">([\s\S]*?)<\/h3>/)?.[1];
  assert.equal(
    visibleText(actionNotice),
    'A: 오답입니다! 정답은 5 (오답이라 데미지가 절반만 들어갑니다)',
  );
  assert.match(ui.lastHtml(), /pvp-wrong-review-v5/);
  assert.match(ui.lastHtml(), /class="correct-answer-review"[\s\S]*>5/);
  assert.doesNotMatch(ui.lastHtml(), /막기 훈련|보호막 1 생성/);

  await ui.advance(4_119);
  assert.doesNotMatch(ui.lastHtml(), /막기 훈련|보호막 1 생성/);

  await ui.advance(1);
  const shieldNotice = ui.lastHtml().match(/<h3 class="combat-notice[^"]*">([\s\S]*?)<\/h3>/)?.[1];
  assert.equal(visibleText(shieldNotice), 'B 학생의 막기 훈련! 보호막 1 생성!');
  assert.match(ui.lastHtml(), /HP 100\/100 <span class="shield-badge">🛡 1<\/span>/);
});

test('combat log safely colors local and opponent names plus damage breakdown numbers', async () => {
  const ui = harness();
  ui.window.enterPvpMatchV1({
    ...ui.match,
    playerAState:{ ...ui.match.playerAState, name:'나<용사>' },
    playerBState:{ ...ui.match.playerBState, name:'상대.*[마왕]', shield:4 },
  });

  ui.emit({
    type:'event',
    round:1,
    sequenceNo:31,
    kind:'damage',
    source:'a',
    target:'b',
    absorbed:4,
    hpDamage:8,
  });
  await ui.advance(70);

  const html = ui.lastHtml();
  assert.match(
    html,
    /<span class="pvp-combat-name-me" style="color:#4ade80;font-weight:900">나&lt;용사&gt;<\/span>/,
  );
  assert.match(
    html,
    /<span class="pvp-combat-name-opponent" style="color:#fca5a5;font-weight:900">상대\.\*\[마왕\]<\/span>/,
  );
  assert.doesNotMatch(html, /<용사>/);
  assert.match(html, /총\s*<span class="damage-number-v25-enemy">12<\/span>의 피해/);
  assert.match(html, /보호막\s*<span class="damage-number-v25-generic">4<\/span>/);
  assert.match(html, /체력\s*<span class="damage-number-v25-enemy">8<\/span>/);
});

test('combat log reuses the hunting number class for recovery', async () => {
  const ui = harness();
  ui.window.enterPvpMatchV1({
    ...ui.match,
    playerAState:{ ...ui.match.playerAState, hp:90 },
  });
  ui.emit({
    type:'event',
    round:1,
    sequenceNo:32,
    kind:'heal',
    source:'a',
    target:'a',
    amount:7,
  });
  await ui.advance(70);

  assert.match(
    ui.lastHtml(),
    /<span class="pvp-combat-name-me" style="color:#4ade80;font-weight:900">A<\/span> 학생의 체력이 <span class="damage-number-v25-generic">7<\/span> 회복/,
  );
});

test('a wrong typed answer displays the correct answer in a green readonly field for two seconds', async () => {
  const ui = harness();
  ui.window.enterPvpMatchV1({
    ...ui.match,
    question:{ prompt:'12 ÷ 3 = ?' },
  });
  ui.emit({
    type:'event',
    round:1,
    sequenceNo:30,
    kind:'action',
    source:'a',
    target:'b',
    actionId:'basic',
    correct:false,
    correctAnswer:'4',
  });

  await ui.advance(70);
  assert.match(ui.lastHtml(), /pvp-wrong-review-v5/);
  assert.match(ui.lastHtml(), /<input value="4" readonly class="correct-answer-review"/);
  await ui.advance(1_999);
  assert.match(ui.lastHtml(), /pvp-wrong-review-v5/);
  await ui.advance(1);
  assert.doesNotMatch(ui.lastHtml(), /pvp-wrong-review-v5/);
});

test('the same realtime event is ignored when it is delivered twice', async () => {
  const ui = harness();
  ui.window.enterPvpMatchV1(ui.match);
  const damage = {
    type:'event',
    round:1,
    sequenceNo:7,
    kind:'damage',
    source:'a',
    target:'b',
    amount:10,
    absorbed:0,
    hpDamage:10,
  };

  ui.emit(damage);
  ui.emit({ ...damage });
  await ui.advance(2_000);

  assert.match(ui.lastHtml(), /HP 90\/100/);
  assert.doesNotMatch(ui.lastHtml(), /HP 80\/100/);
  assert.equal(ui.calls.filter(([type, id]) => type === 'sfx' && id === 'hit').length, 1);
});

test('cancelled server snapshot shows a safe exit instead of the attack menu', async () => {
  const ui = harness();
  ui.window.enterPvpMatchV1(ui.match);
  ui.setHeartbeatResult({
    cancelled:true,
    round:1,
    match:{
      ...ui.match,
      phase:'cancelled',
    },
  });

  ui.tickIntervals();
  await ui.advance(120);

  assert.match(ui.lastHtml(), /대전을 안전하게 종료했습니다/);
  assert.match(ui.lastHtml(), /대전이 종료되었습니다/);
  assert.match(ui.lastHtml(), /승패에는 반영되지 않습니다/);
  assert.match(ui.lastHtml(), />마을로 돌아가기<\/button>/);
  assert.doesNotMatch(ui.lastHtml(), />공격<\/button>|>스킬<\/button>|>항복<\/button>/);
});

test('surrender requires confirmation and does not grant local world rewards', async () => {
  const ui = harness();
  ui.window.enterPvpMatchV1(ui.match);
  ui.window.surrenderPvpV1();
  assert.match(ui.lastHtml(), /정말 항복할까요\?/);

  await ui.window.confirmSurrenderPvpV1();
  assert.deepEqual(
    ui.calls.find(([type]) => type === 'surrender'),
    ['surrender', 'm1'],
  );
  assert.match(ui.lastHtml(), /대전이 끝났습니다|다음엔 이길 수 있어요/);
  assert.doesNotMatch(ui.lastHtml(), /경험치|골드|빌딩/);
  assert.deepEqual(
    ui.calls.filter(([type]) => type === 'mappedAudio'),
    [['mappedAudio', 'upgradeFail']],
  );
});

test('Escape opens surrender confirmation instead of silently closing an active match', () => {
  const ui = harness();
  ui.window.enterPvpMatchV1(ui.match);
  const event = {
    key:'Escape',
    preventDefault() {
      ui.calls.push(['prevent']);
    },
  };

  assert.equal(ui.window.escapeHandler(event), true);
  assert.match(ui.lastHtml(), /정말 항복할까요\?/);
  assert.deepEqual(ui.calls.at(-1), ['prevent']);
  assert.equal(ui.calls.some(([type]) => type === 'close'), false);
});

test('countdown refresh cannot overwrite surrender confirmation', () => {
  const ui = harness();
  ui.window.enterPvpMatchV1(ui.match);
  ui.window.surrenderPvpV1();
  const confirmationHtml = ui.lastHtml();

  ui.tickIntervals();
  assert.equal(ui.lastHtml(), confirmationHtml);
  assert.match(ui.lastHtml(), /정말 항복할까요\?/);

  ui.window.restorePvpMatchV1();
  assert.match(ui.lastHtml(), /친선 대전/);
  assert.match(ui.lastHtml(), />공격<\/button>/);
});
