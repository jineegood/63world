import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const coreSource = () => fs.readFileSync(path.join(root, 'src/multiplayer-core.js'), 'utf8');
const multiplayerSource = () => fs.readFileSync(path.join(root, 'src/multiplayer.js'), 'utf8');
const remoteMotionSource = () => fs.readFileSync(path.join(root, 'src/remote-motion.js'), 'utf8');
const avatarVisualSyncSource = () => fs.readFileSync(path.join(root, 'src/avatar-visual-sync.js'), 'utf8');
const gameSource = () => fs.readFileSync(path.join(root, 'game.js'), 'utf8');
const raidNameplateSource = () => fs.readFileSync(path.join(root, 'src/raid-nameplates.js'), 'utf8');
const presenceMigrationSource = () => fs.readFileSync(
  path.join(root, 'supabase/migrations/202608270003_world_presence_v1.sql'),
  'utf8',
);

test('character names share one visual-width limit for Hangul and English', () => {
  const source = gameSource();
  const start = source.indexOf('const CHARACTER_NAME_MAX_VISUAL_UNITS = 14;');
  const end = source.indexOf('const secureStudentAccess =', start);
  assert.ok(start >= 0 && end > start);
  const window = {};
  vm.runInNewContext(source.slice(start, end), { window });
  const rules = window.YuksamCharacterNameRules;

  assert.equal(rules.validate('가나다라마바사').ok, true);
  assert.equal(rules.validate('가나다라마바사').units, 14);
  assert.equal(rules.validate('가나다라마바사아').ok, false);
  assert.match(rules.validate('가나다라마바사아').message, /한글 최대 7자/);
  assert.equal(rules.validate('abcdefghijklmn').ok, true);
  assert.equal(rules.validate('abcdefghijklmno').ok, false);
  assert.doesNotMatch(source, /\$\('loginName'\)\.maxLength = 14/);
  assert.match(source, /const checkedNewName = validateCharacterName/);
  assert.ok((source.match(/validateCharacterName\(/g) || []).length >= 4);
});

test('shared nameplate model renders below both local and remote characters and supports themes', () => {
  const source = gameSource();
  const start = source.indexOf('/* Shared world nameplates.');
  assert.ok(start >= 0);
  const rects = [];
  const text = [];
  const window = { performance:{ now:() => 1000 } };
  const context = {
    window,
    CLASS_META:{ warrior:{ name:'전사' } },
    roundRect:(ctx, x, y, width, height, radius) => rects.push({ x, y, width, height, radius }),
    Date,
    Math,
  };
  vm.runInNewContext(source.slice(start), context);
  const ctx = {
    save() {}, restore() {}, fill() {}, stroke() {},
    measureText:(value) => ({ width:String(value).length * 10 }),
    fillText:(value, x, y) => text.push({ value, x, y }),
  };
  const api = window.YuksamPlayerNameplateV1;
  const model = api.draw(ctx, 300, 200, {
    name:'둘째', level:6, class:'warrior', spec:'무기',
  }, { source:'remote', userId:'user-2' });

  assert.equal(model.source, 'remote');
  assert.equal(model.roleLine, 'LV.6 무기 전사');
  assert.equal(rects[0].y, 258);
  assert.equal(text[0].value, '둘째');
  let themed = false;
  assert.equal(api.registerTheme('gold', () => { themed = true; }), true);
  api.setThemeResolver(() => 'gold');
  api.draw(ctx, 300, 200, { name:'둘째', class:'warrior' }, { source:'remote' });
  assert.equal(themed, true);
});

test('raid milestones normalize ownership, expose quest goals, and register three distinct themes', () => {
  const registered = new Map();
  let resolver = null;
  const window = {
    performance:{ now:() => 1000 },
    YuksamPlayerNameplateV1:{
      registerTheme:(id, draw) => { registered.set(id, draw); return true; },
      setThemeResolver:(next) => { resolver = next; },
    },
  };
  vm.runInNewContext(raidNameplateSource(), { window, Date, Math, Map, Set, Object, String, Number, Array });
  const api = window.YuksamRaidNameplatesV1;

  assert.deepEqual(
    JSON.parse(JSON.stringify(api.definitions.map(({ id, floorGroup }) => ({ id, floorGroup })))),
    [
      { id:'raid_20_steel', floorGroup:2 },
      { id:'raid_40_twilight', floorGroup:4 },
      { id:'raid_63_summit', floorGroup:7 },
    ],
  );
  const normalized = api.normalizePlayerFields({
    raidNameplates:['fake_theme', 'raid_40_twilight', 'raid_20_steel', 'raid_20_steel'],
    nameplate:{ theme:'fake_theme' },
  });
  assert.deepEqual([...normalized.raidNameplates], ['raid_20_steel', 'raid_40_twilight']);
  assert.equal(normalized.nameplate.theme, 'default');
  assert.equal(api.equip({ raidNameplates:[] }, 'raid_63_summit'), false);
  assert.equal(api.rewardForGroup(2).questTitle, '[파티] 함께 오른 스무 층');
  assert.equal(api.rewardForGroup(4).questTitle, '[파티] 빌딩의 허리를 넘어서');
  assert.equal(api.rewardForGroup(7).questTitle, '[파티] 육삼의 정상');
  assert.match(api.rewardForGroup(7).description, /먹빛 하늘.*무광 금빛/);
  const picker = api.pickerMarkup({
    name:'철벽', class:'warrior', level:5,
    raidNameplates:['raid_20_steel'], nameplate:{ theme:'raid_20_steel' },
  });
  assert.equal((picker.match(/class="raid-nameplate-card-v1/g) || []).length, 3);
  assert.match(picker, /강철 승강기 이름표[\s\S]*?장착 중/);
  assert.match(picker, /\[파티\] 함께 오른 스무 층/);
  assert.match(picker, /\[파티\] 빌딩의 허리를 넘어서/);
  assert.match(picker, /\[파티\] 육삼의 정상/);
  assert.deepEqual([...registered.keys()], ['raid_20_steel', 'raid_40_twilight', 'raid_63_summit']);
  assert.equal(resolver({ cosmetics:{ theme:'raid_20_steel' } }), 'raid_20_steel');
  assert.equal(resolver({ cosmetics:{ theme:'unowned' } }), 'default');

  const colors = [];
  let gradientCalls = 0;
  let arcCalls = 0;
  const ctx = {
    save() {}, restore() {}, beginPath() {}, roundRect() {}, fill() {}, stroke() {},
    moveTo() {}, lineTo() {},
    arc() { arcCalls += 1; },
    createLinearGradient() {
      gradientCalls += 1;
      return { addColorStop() {} };
    },
    fillText() {}, measureText:(value) => ({ width:String(value).length * 10 }),
    set fillStyle(value) { colors.push(value); }, get fillStyle() { return colors.at(-1); },
    set strokeStyle(value) { colors.push(value); }, get strokeStyle() { return colors.at(-1); },
  };
  registered.get('raid_20_steel')(ctx, 300, 200, { name:'철벽', roleLine:'LV.5 무기 전사' });
  assert.ok(colors.includes('#94a3b8'));
  assert.ok(colors.some((value) => String(value).startsWith('rgba(251,146,60,')),
    '20층은 기본 청록과 다른 주황 표시등이어야 한다');
  colors.length = 0;
  arcCalls = 0;
  registered.get('raid_63_summit')(ctx, 300, 200, { name:'정상', roleLine:'LV.63 무기 전사' });
  assert.ok(colors.includes('rgba(5,10,20,.97)'));
  assert.ok(colors.includes('#d6b96b'), '63층은 강철 이름표와 다른 무광 금빛 테두리를 써야 한다');
  assert.equal(gradientCalls, 0, '상시 렌더되는 최종 이름표는 매 프레임 그라디언트를 만들지 않는다');
  assert.equal(arcCalls, 1, '최종 이름표는 안테나 표시등 하나만 그린다');
});

test('Supabase REST configuration normalizes to one Realtime websocket endpoint', () => {
  const window = {};
  vm.runInNewContext(coreSource(), { window, URL });
  assert.equal(
    window.YuksamMultiplayerCore.realtimeWebSocketUrl(
      'https://example.supabase.co/rest/v1/',
      'public key',
    ),
    'wss://example.supabase.co/realtime/v1/websocket?apikey=public+key&vsn=1.0.0',
  );
});

test('world roster, chat, and position stay server-verified on the Friday 2-second RPC path', () => {
  const sql = presenceMigrationSource();
  const multiplayer = multiplayerSource();

  assert.match(sql, /user_id uuid primary key references auth\.users\(id\) on delete cascade/i);
  assert.match(sql, /alter table public\.world_presence_v1 force row level security/i);
  assert.match(sql, /revoke all on table public\.world_presence_v1 from public, anon, authenticated/i);
  assert.match(sql, /create table if not exists public\.world_chat_v1/i);
  assert.match(sql, /unique \(user_id, client_message_id\)/i);
  assert.match(sql, /alter table public\.world_chat_v1 force row level security/i);
  assert.match(sql, /revoke all on table public\.world_chat_v1 from public, anon, authenticated/i);
  assert.match(sql, /revoke all on sequence public\.world_chat_v1_id_seq from public, anon, authenticated/i);
  assert.match(sql, /security definer\s+set search_path = ''/i);
  assert.match(sql, /v_user_id uuid := auth\.uid\(\)/i);
  assert.match(sql, /from public\.player_profiles_v2 as profile[\s\S]*where profile\.user_id = v_user_id/i);
  assert.match(sql, /octet_length\(p_state::text\) > 8192/i);
  assert.match(sql, /v_map !~ '\^\[A-Za-z\]\[A-Za-z0-9_-\]\{0,39\}\$'/i);
  assert.match(sql, /v_x not between 0 and 8192 or v_y not between 0 and 8192/i);
  assert.match(sql, /candidate\.last_seen_at >= v_now - interval '8 seconds'/i);
  assert.match(sql, /jsonb_object_agg\(item\.key, item\.value[\s\S]*into v_known_visuals/i);
  assert.match(sql, /v_last_chat_id := \(p_state ->> 'lastChatId'\)::bigint/i);
  assert.match(sql, /v_chat_id := \(p_state -> 'chat' ->> 'id'\)::uuid/i);
  assert.match(sql, /char_length\(v_chat_text\) not between 1 and 120/i);
  assert.match(sql, /on conflict \(user_id, client_message_id\) do nothing[\s\S]*returning client_message_id into v_chat_accepted_id/i);
  assert.match(sql, /recent_message\.created_at > v_now - interval '750 milliseconds'/i);
  assert.match(sql, /where recent\.user_id = v_user_id[\s\S]*limit 8/i);
  assert.match(sql, /candidate\.state - array\['facing', 'petSide', 'pvpAvailable', 'moving', 'dance'\] as visual_state/i);
  assert.match(sql, /pg_catalog\.md5\([\s\S]*as visual_version/i);
  assert.match(sql, /'u', active\.user_id[\s\S]*'v', active\.visual_version/i);
  assert.match(sql, /v_known_visuals ->> active\.user_id::text/i);
  assert.match(sql, /message\.id > v_last_chat_id[\s\S]*message\.created_at >= v_now - interval '5 minutes'[\s\S]*limit 60/i);
  assert.match(sql, /'players', coalesce\(v_players, '\[\]'::jsonb\)[\s\S]*'visuals', coalesce\(v_visuals, '\[\]'::jsonb\)[\s\S]*'messages', coalesce\(v_messages, '\[\]'::jsonb\)[\s\S]*'acceptedChatId', v_chat_accepted_id/i);
  assert.match(sql, /revoke all on function public\.sync_world_presence_v1\(jsonb\)[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.sync_world_presence_v1\(jsonb\)[\s\S]*to authenticated/i);
  assert.match(multiplayer, /const CHANNEL_COUNT = 5/);
  assert.match(multiplayer, /const CHANNEL_CAPACITY = 8/);
  assert.match(multiplayer, /const RPC_TIMEOUT_MS = 4500/);
  assert.match(multiplayer, /const MOTION_BROADCAST_MS = 220/);
  assert.match(multiplayer, /const MOTION_IDLE_KEEPALIVE_MS = 2000/);
  assert.match(multiplayer, /const PRESENCE_SYNC_MS = 2000/);
  assert.match(multiplayer, /motion = api\.create\(\)/,
    'the 220ms stream must reuse the original 90-600ms interpolation and portal snap defaults');
  assert.match(multiplayer, /CONTROL_CHARACTERS_RE = \/\[\\u0000-\\u001f\\u007f-\\u009f\]\//);
  assert.match(multiplayer, /payload\.knownVisuals = knownVisuals[\s\S]*payload\.lastChatId = resetCursor \? '0' : lastChatId[\s\S]*payload\.lastAnnouncementId/);
  assert.match(multiplayer, /client\.rpc\('sync_world_presence_v3'/);
  assert.match(multiplayer, /window\.YuksamWorldChannelsV1 = Object\.freeze/);
  assert.match(multiplayer, /channelStatus = 'online'/);
  assert.match(multiplayer, /MOTION_TOPIC_PREFIX = 'world-motion-v1:channel-'/);
  assert.match(multiplayer, /client\.channel\(`\$\{MOTION_TOPIC_PREFIX\}\$\{channel\}`,[\s\S]*private:true/);
  assert.match(multiplayer, /\.on\('broadcast', \{ event:'motion' \}/);
  assert.match(multiplayer, /setInterval\(broadcastMotion, MOTION_BROADCAST_MS\)/);
  assert.match(multiplayer, /preserveLiveMotion[\s\S]*next\.x = previous\.x/,
    'a slower DB roster snapshot must not rewind a fresh Realtime position');
  assert.doesNotMatch(multiplayer, /setInterval\([^\n]*250/,
    'the restored movement cadence must be exactly the original 220ms, not 250ms');
  assert.match(multiplayer, /function remoteSpriteState[\s\S]*remote:true/);
  assert.match(multiplayer, /draw\(ctx, s\.x, s\.y/);
  assert.doesNotMatch(multiplayer,
    /OffscreenCanvas|ImageBitmap|createImageBitmap|transferToImageBitmap|remoteSpriteCache|REMOTE_SPRITE_WIDTH|cachePaints|cacheHits|createElement\(\s*['"]canvas['"]\s*\)|\.drawImage\s*\(|\.putImageData\s*\(/,
    'multiplayer rendering must not recreate a bitmap cache or canvas-compositing path');
  const renderStart = multiplayer.indexOf('function renderRemotes()');
  const renderEnd = multiplayer.indexOf('\n  g()?.canvas', renderStart);
  assert.ok(renderStart >= 0 && renderEnd > renderStart);
  const renderBody = multiplayer.slice(renderStart, renderEnd);
  assert.doesNotMatch(renderBody, /updateOnlineBadge|document\.|textContent|innerHTML|dataset/,
    'the per-frame remote renderer must never touch DOM state');
  assert.doesNotMatch(renderBody, /setTimeout|setInterval|requestAnimationFrame/,
    'remote sprite rendering must follow the world frame callback without its own FPS throttle');
  assert.doesNotMatch(renderBody, /performance\.now|estimatedFps|render(?:Last|Ema|Max)Ms|renderCalls|directPaints/,
    'per-frame performance diagnostics must stay out of the renderer');
  assert.doesNotMatch(multiplayer, /__mpRemoteRenderStatsV54/,
    'the removed diagnostics API must not keep render counters alive');
  assert.match(multiplayer, /Promise\.race\(\[/);
});

test('five channels isolate 28-player rosters/chat/220ms motion while direct rendering follows each world frame', async () => {
  const presenceRows = new Map();
  const chatRows = [];
  const topics = new Map();
  let rpcCalls = 0;

  function channelCounts() {
    return Object.fromEntries(Array.from({ length:5 }, (_, index) => {
      const channel = index + 1;
      return [String(channel), [...presenceRows.values()].filter((row) => row.channel === channel).length];
    }));
  }

  function splitPresence(row) {
    const {
      userId, name, map, channel, x, y, facing, petSide, pvpAvailable, moving, dance, ...visual
    } = row;
    const raw = JSON.stringify(visual);
    let hash = 2166136261;
    for (let index = 0; index < raw.length; index += 1) {
      hash ^= raw.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    const chunk = (hash >>> 0).toString(16).padStart(8, '0');
    return {
      version:chunk.repeat(4),
      visual:{ ...visual, u:userId, name, v:chunk.repeat(4) },
      compact:{
        u:userId, x, y, v:chunk.repeat(4), f:facing, ps:petSide,
        mv:moving === true, dn:dance === true, pv:pvpAvailable === true,
      },
    };
  }

  function removeRealtimeChannel(channel) {
    topics.get(channel.topic)?.delete(channel);
  }

  class FakeRealtimeChannel {
    constructor(client, topic) {
      this.client = client;
      this.topic = topic;
      this.motionListener = null;
    }
    on(type, filter, listener) {
      assert.equal(type, 'broadcast');
      assert.equal(filter.event, 'motion');
      this.motionListener = listener;
      return this;
    }
    subscribe(onStatus) {
      const selected = Number(this.topic.split('-').at(-1));
      assert.equal(this.client.authorizedChannel, selected,
        'the server presence admission must precede the private motion subscription');
      if (!topics.has(this.topic)) topics.set(this.topic, new Set());
      topics.get(this.topic).add(this);
      onStatus?.('SUBSCRIBED');
      return this;
    }
    async send(message) {
      assert.equal(message.type, 'broadcast');
      assert.equal(message.event, 'motion');
      for (const target of topics.get(this.topic) || []) {
        if (target !== this) target.motionListener?.({ payload:JSON.parse(JSON.stringify(message.payload)) });
      }
      return 'ok';
    }
  }

  class FakeClient {
    constructor(identity) {
      this.identity = identity;
      this.authorizedChannel = null;
      this.authSteps = [];
      this.removedTopics = [];
      this.auth = {
        getSession:async () => {
          this.authSteps.push('getSession');
          return { data:{ session:{ access_token:`token-${identity.userId}` } } };
        },
      };
      this.realtime = {
        setAuth:async (token) => {
          assert.equal(token, `token-${identity.userId}`);
          this.authSteps.push('setAuth');
        },
      };
    }
    channel(topic, options) {
      assert.equal(options?.config?.private, true);
      assert.deepEqual(this.authSteps.slice(-2), ['getSession', 'setAuth']);
      return new FakeRealtimeChannel(this, topic);
    }
    removeChannel(channel) {
      this.removedTopics.push(channel.topic);
      removeRealtimeChannel(channel);
    }
    async rpc(name, { p_state:state }) {
      assert.equal(name, 'sync_world_presence_v3');
      assert.ok(Number.isInteger(state.channel) && state.channel >= 1 && state.channel <= 5);
      rpcCalls += 1;
      const previous = presenceRows.get(this.identity.userId) || null;
      const activeOthers = [...presenceRows.values()].filter((row) => (
        row.channel === state.channel && row.userId !== this.identity.userId
      )).length;
      if (activeOthers >= 8 && previous?.channel !== state.channel) {
        return { data:{
          ok:false, code:'CHANNEL_FULL', map:state.map, channel:state.channel,
          previousChannel:previous?.channel || null, channelCounts:channelCounts(),
          players:[], visuals:[], messages:[], announcements:[],
        }, error:null };
      }
      const copied = JSON.parse(JSON.stringify(state));
      const submittedChat = copied.chat || null;
      const knownVisuals = copied.knownVisuals || {};
      const lastChatId = Number(copied.lastChatId) || 0;
      let acceptedChatId = null;
      delete copied.chat;
      delete copied.knownVisuals;
      delete copied.lastChatId;
      delete copied.lastAnnouncementId;
      const saved = {
        ...copied,
        userId:this.identity.userId,
        name:this.identity.displayName,
      };
      presenceRows.set(this.identity.userId, saved);
      this.authorizedChannel = saved.channel;
      if (submittedChat && !this.rejectChat && !chatRows.some((row) => (
        row.userId === this.identity.userId && row.clientId === submittedChat.id
      ))) {
        chatRows.push({
          id:String(chatRows.length + 1), clientId:submittedChat.id, channel:saved.channel,
          userId:this.identity.userId, name:this.identity.displayName, text:submittedChat.text,
        });
        acceptedChatId = submittedChat.id;
      }
      const sameRoster = [...presenceRows.values()]
        .filter((row) => row.map === saved.map && row.channel === saved.channel)
        .sort((left, right) => left.userId.localeCompare(right.userId));
      const split = sameRoster.map(splitPresence);
      const data = {
        ok:true,
        map:saved.map,
        channel:saved.channel,
        channelCounts:channelCounts(),
        players:split.map(({ compact }) => compact),
        visuals:split.filter(({ visual, version }) => knownVisuals[visual.u] !== version)
          .map(({ visual }) => visual),
        messages:chatRows.filter((row) => row.channel === saved.channel && Number(row.id) > lastChatId)
          .slice(0, 60),
        announcements:[],
        acceptedChatId,
      };
      this.lastResponseBytes = Buffer.byteLength(JSON.stringify(data));
      return { data, error:null };
    }
  }

  function createSession(index, preferredChannel) {
    const name = `학생${String(index + 1).padStart(2, '0')}`;
    const identity = { userId:`id-${String(index).padStart(2, '0')}`, displayName:name, role:'student' };
    const client = new FakeClient(identity);
    const intervals = [];
    const chats = [];
    const drawn = [];
    const paintedText = [];
    const nameplates = [];
    const yuksamPaints = [];
    const bitmapDraws = [];
    const canvasListeners = new Map();
    const layers = [];
    const domActivity = {
      querySelector:0,
      getElementById:0,
      badgeTextWrites:0,
      badgeStateWrites:0,
    };
    let badgeText = '';
    const badgeDataset = {};
    const badge = {
      get textContent() { return badgeText; },
      set textContent(value) {
        badgeText = String(value);
        domActivity.badgeTextWrites += 1;
      },
      dataset:new Proxy(badgeDataset, {
        set(target, property, value) {
          target[property] = String(value);
          domActivity.badgeStateWrites += 1;
          return true;
        },
      }),
    };
    const storage = new Map([['yuksam_world_channel_v1', String(preferredChannel)]]);
    let messageCounter = 0;
    let performanceClock = 0;
    const window = {
      YUKSAM_CLOUD:{ url:'https://example.supabase.co/rest/v1/', anonKey:'x'.repeat(30) },
      secureStudentAccessV2:{ getClient:() => client },
      localStorage:{
        getItem:(key) => storage.get(key) ?? null,
        setItem:(key, value) => storage.set(key, String(value)),
      },
      performance:{ now:() => { performanceClock += 0.5; return performanceClock; } },
      crypto:{
        randomUUID:() => `00000000-0000-4000-8000-${String(index * 100 + (++messageCounter)).padStart(12, '0')}`,
      },
      addEventListener() {},
      appendChatMessage:(type, sender, message) => chats.push({ type, sender, message }),
      toast:(message) => chats.push({ type:'toast', message }),
      getPvpIdentityV1:() => identity,
      getActivePvpMatchV1:() => null,
      openRemoteProfileV1:(userId) => chats.push({ type:'profile', userId }),
      YuksamPlayerNameplateV1:{
        draw:(ctx, sx, sy, player, meta) => nameplates.push({ x:sx, y:sy, player, meta }),
      },
      drawYuksamPetV35:(ctx, point, dancing, moving, pet, now) => {
        yuksamPaints.push({ point, dancing, moving, petId:pet.id, now });
      },
      PET_DEFS_V27:{
        chick:{ id:'chick', name:'삐약이', icon:'🐤', color:'#fde68a', bob:0 },
        yuksam:{ id:'yuksam', name:'육삼이', icon:'🏢', color:'#fbbf24', bob:6, legendary:true },
      },
    };
    const game = {
      player:{ name, x:300, y:200, level:1, class:'warrior', equipment:{ weapon:'sword_1' },
        weaponUpgrades:{ sword_1:3 }, appearance:{}, costume:{ head:'blue-cap' }, activePet:'chick',
        nameplate:{ theme:'sparkle' } },
      lastMove:{ x:1, y:0 },
      currentMap:'town',
      isMoving:false,
      currentCombatMonsterId:null,
      modalState:{ pause:false, type:'settings' },
      canvas:{
        addEventListener:(type, fn) => canvasListeners.set(type, fn),
        getBoundingClientRect:() => ({ left:0, top:0, width:800, height:450 }),
        width:800, height:450,
      },
      width:800, height:450,
      ctx:{
        save() {}, restore() {}, measureText:() => ({ width:50 }),
        beginPath() {}, roundRect() {}, fill() {}, ellipse() {}, arc() {}, stroke() {},
        translate() {}, rotate() {}, scale() {},
        drawImage(...args) { bitmapDraws.push(args); },
        fillText(text) { paintedText.push(String(text)); },
        strokeText(text) { paintedText.push(String(text)); },
      },
    };
    const context = {
      window,
      game,
      document:{
        querySelector:() => {
          domActivity.querySelector += 1;
          return {};
        },
        getElementById:(id) => {
          domActivity.getElementById += 1;
          return id === 'onlineBadge' ? badge : null;
        },
      },
      Date, Math, JSON, Object, String, Number, Array, Map, Set,
      setInterval:(fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
      clearInterval() {},
      setTimeout:() => 1,
      clearTimeout() {},
      worldRenderPipeline:{ registerLayer(layer) { layers.push(layer); } },
      drawPlayerSprite:(ctx, sx, sy, appearance, cls, state) => {
        drawn.push({ x:sx, y:sy, moving:state?.moving, dance:Boolean(state?.dance),
          remote:state?.remote, weaponTier:state?.weaponTierStyle?.tier });
      },
      worldToScreen:(px, py) => ({ x:px, y:py }),
      PLAYER_WORLD_SCALE:1.26,
    };
    vm.runInNewContext(remoteMotionSource(), context);
    vm.runInNewContext(avatarVisualSyncSource(), context);
    vm.runInNewContext(multiplayerSource(), context);
    return { window, game, intervals, chats, canvasListeners, layers, drawn, paintedText,
      nameplates, yuksamPaints, bitmapDraws, badge, domActivity, identity, client, storage };
  }

  async function settleRealtime() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  // Eight students fill channel 1; the remaining twenty are distributed five per channel.
  const preferred = (index) => index < 8 ? 1 : 2 + ((index - 8) % 4);
  const sessions = Array.from({ length:28 }, (_, index) => createSession(index, preferred(index)));
  await Promise.all(sessions.map((session) => session.window.__mpSyncPresenceV54()));
  await settleRealtime();
  rpcCalls = 0;
  await Promise.all(sessions.map((session) => session.window.__mpSyncPresenceV54()));
  await settleRealtime();

  assert.equal(rpcCalls, 28, 'each student still uses one bounded 2-second roster poll');
  assert.ok(sessions.every((session) => session.window.__multiplayerStatusV53 === 'online'));
  assert.equal(sessions[0].window.__remotePlayersV53.size, 7);
  assert.equal(sessions[8].window.__remotePlayersV53.size, 4);
  assert.equal(sessions[0].window.__remotePlayersV53.has('학생09'), false,
    'a different channel must not enter this roster');
  assert.equal(sessions[0].window.__remotePlayersV53.get('학생02').costume.head, 'blue-cap');
  assert.deepEqual(
    JSON.parse(JSON.stringify(sessions[0].window.YuksamWorldChannelsV1.getState())),
    {
      channel:1, channelCounts:{ 1:8, 2:5, 3:5, 4:5, 5:5 }, maxChannels:5, capacity:8,
      status:'online', switching:false, cooldownUntil:0, canChange:true, reason:null,
    },
  );
  assert.match(sessions[0].badge.textContent, /채널 1 · 같은 지역 8명/);
  assert.ok(sessions.every((session) => session.client.authSteps.includes('setAuth')));
  assert.ok(sessions.every((session) => (
    session.intervals.some(({ ms }) => ms === 2000)
      && session.intervals.filter(({ ms }) => ms === 220).length >= 2
      && session.intervals.every(({ ms }) => ms !== 250)
  )), 'every session must keep the 2-second roster poll and restore the original 220ms motion timer');
  const occupancy = Object.values(sessions[0].window.YuksamWorldChannelsV1.getState().channelCounts);
  assert.equal(occupancy.reduce((sum, count) => sum + count, 0), 28);
  assert.equal(Math.max(...occupancy), 8);
  assert.equal(topics.size, 5, 'all five private motion channels should be active');

  // Only visual motion takes the low-latency path, and it stays inside the server-approved channel.
  sessions[0].game.player.x = 377;
  sessions[0].game.isMoving = true;
  sessions[0].intervals.find((entry) => entry.fn.name === 'broadcastMotion').fn();
  await settleRealtime();
  assert.equal(sessions[1].window.__remotePlayersV53.get('학생01').x, 377);
  assert.equal(sessions[8].window.__remotePlayersV53.has('학생01'), false);

  // A slower DB snapshot still contains the sender's previous x=300 and must not rewind x=377.
  await sessions[1].window.__mpSyncPresenceV54();
  assert.equal(sessions[1].window.__remotePlayersV53.get('학생01').x, 377);

  assert.equal(sessions[0].window.__mpBroadcastChatV53(`막힘\u0085문자`), false);
  sessions[0].window.__mpBroadcastChatV53('1채널 안녕!');
  await sessions[0].window.__mpSyncPresenceV54();
  await sessions[1].window.__mpSyncPresenceV54();
  await sessions[8].window.__mpSyncPresenceV54();
  assert.deepEqual(sessions[1].chats.at(-1), { type:'user', sender:'학생01', message:'1채널 안녕!' });
  assert.equal(sessions[8].chats.some(({ message }) => message === '1채널 안녕!'), false);

  const first = sessions[0];
  first.layers[0].render();
  assert.equal(first.drawn.length, 7);
  assert.ok(first.drawn.every(({ remote }) => remote === true), 'remote drawing must disable local-only aura work');
  assert.ok(new Set(first.drawn.map(({ x, y }) => `${Math.round(x)},${Math.round(y)}`)).size >= 6);
  assert.equal(first.paintedText.includes('🐤'), true);
  assert.equal(first.nameplates.length, 7);
  assert.equal(first.bitmapDraws.length, 0, 'the large per-player bitmap cache must be absent');

  for (let frame = 0; frame < 60; frame += 1) first.layers[0].render();
  assert.equal(first.drawn.length, 7 * 61,
    'the regression checks direct renderer routing per callback; it does not promise device FPS');

  const assertEveryRemotePaintsEveryFrame = (label, updateRemote) => {
    first.window.__remotePlayersV53.forEach(updateRemote);
    const frames = 12;
    const drawsBefore = first.drawn.length;
    const bitmapsBefore = first.bitmapDraws.length;
    for (let frame = 0; frame < frames; frame += 1) first.layers[0].render();
    assert.equal(first.drawn.length - drawsBefore, 7 * frames,
      `${label} remote sprites must be repainted by every world frame callback`);
    assert.equal(first.bitmapDraws.length, bitmapsBefore,
      `${label} remote sprites must not be composited from a bitmap cache`);
  };
  assertEveryRemotePaintsEveryFrame('idle', (remote) => {
    remote.moving = false;
    remote.dance = false;
  });
  assertEveryRemotePaintsEveryFrame('moving', (remote) => {
    remote.moving = true;
    remote.dance = false;
  });
  assertEveryRemotePaintsEveryFrame('dancing', (remote) => {
    remote.moving = false;
    remote.dance = true;
  });
  first.window.__remotePlayersV53.forEach((remote) => {
    remote.moving = false;
    remote.dance = false;
  });

  sessions[1].game.player.activePet = 'yuksam';
  sessions[1].game.danceTimer = 3000;
  await sessions[1].window.__mpSyncPresenceV54();
  await sessions[0].window.__mpSyncPresenceV54();
  first.layers[0].render();
  assert.equal(first.window.__remotePlayersV53.get('학생02').activePet, 'yuksam');
  assert.equal(first.yuksamPaints.at(-1).petId, 'yuksam');

  const stateEvents = [];
  const unsubscribe = sessions[8].window.YuksamWorldChannelsV1.subscribe((state) => stateEvents.push(state));
  const full = await sessions[8].window.YuksamWorldChannelsV1.changeChannel(1);
  assert.equal(full.ok, false);
  assert.equal(full.code, 'CHANNEL_FULL');
  assert.equal(sessions[8].window.YuksamWorldChannelsV1.getState().channel, 2);
  const changed = await sessions[8].window.YuksamWorldChannelsV1.changeChannel(3);
  await settleRealtime();
  assert.equal(changed.ok, true);
  assert.equal(sessions[8].window.YuksamWorldChannelsV1.getState().channel, 3);
  assert.equal(sessions[8].storage.get('yuksam_world_channel_v1'), '3');
  assert.ok(sessions[8].client.removedTopics.includes('world-motion-v1:channel-2'));
  assert.equal(sessions[8].window.__remotePlayersV53.has('학생13'), false,
    'the old channel roster must be cleared after switching');
  assert.equal((await sessions[8].window.YuksamWorldChannelsV1.changeChannel(6)).code, 'INVALID_CHANNEL');
  unsubscribe();
  assert.ok(stateEvents.length >= 3);

  const solo = createSession(98, 5);
  solo.game.currentMap = 'soloProbe';
  await solo.window.__mpSyncPresenceV54();
  await settleRealtime();
  assert.equal(solo.window.__remotePlayersV53.size, 0);
  const soloLayer = solo.layers[0];
  const soloContext = { map:solo.game.currentMap };
  assert.equal(soloLayer.when(soloContext), false,
    'the world pipeline must skip the multiplayer renderer when no remote player exists');
  const soloBefore = {
    drawn:solo.drawn.length,
    bitmapDraws:solo.bitmapDraws.length,
    ...solo.domActivity,
  };
  for (let frame = 0; frame < 300; frame += 1) {
    if (soloLayer.when(soloContext)) soloLayer.render(soloContext);
    // The renderer also keeps a defensive no-op in case another caller invokes it directly.
    soloLayer.render(soloContext);
  }
  assert.deepEqual({
    drawn:solo.drawn.length,
    bitmapDraws:solo.bitmapDraws.length,
    ...solo.domActivity,
  }, soloBefore, '300 solo frames must perform no multiplayer canvas, diagnostic, query, or badge DOM work');
});

test('remote 육삼이 reuses the local face painter and old overhead labels are gone', () => {
  const game = gameSource();
  const multiplayer = multiplayerSource();
  assert.match(game, /window\.drawYuksamPetV35 = drawYuksamPetV35/);
  assert.match(game, /ctx\.arc\(-6, -1, 2\.1/);
  assert.match(game, /ctx\.arc\(6, -1, 2\.1/);
  assert.match(multiplayer, /window\.drawYuksamPetV35\(ctx, point, dancing, moving, pet, now\)/);
  assert.match(multiplayer, /drawRemoteNameplate\(ctx, s, p\)/);
  assert.doesNotMatch(multiplayer, /const label = `\$\{p\.name\} \(Lv\./);
  assert.doesNotMatch(multiplayer, /s\.y - 62/);
});
