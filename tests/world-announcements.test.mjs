import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/world-announcements.js'), 'utf8');
const migration = fs.readFileSync(path.join(
  root,
  'supabase/migrations/202608280001_world_announcements_and_special_actions_v1.sql',
), 'utf8');
const expansion = fs.readFileSync(path.join(
  root,
  'supabase/migrations/202608310001_expand_channels_and_teacher_announcements_v1.sql',
), 'utf8');
const milestoneExpansion = fs.readFileSync(path.join(
  root,
  'supabase/migrations/202609010003_elite_and_level_announcements_v1.sql',
), 'utf8');
const legendaryEnhancementBalance = fs.readFileSync(path.join(
  root,
  'supabase/migrations/202609010011_legendary_enhancement_success_rate_v1.sql',
), 'utf8');

function loadAnnouncements({ sessionStorage } = {}) {
  const chats = [];
  const timers = [];
  const attributes = new Map();
  const classes = new Set();
  const region = {
    textContent:'',
    classList:{
      add:(value) => classes.add(value),
      remove:(value) => classes.delete(value),
    },
    setAttribute:(name, value) => attributes.set(name, value),
    removeAttribute:(name) => attributes.delete(name),
  };
  const window = {
    location:{ protocol:'https:', hostname:'63world.example' },
    sessionStorage,
    crypto:{ randomUUID:() => '00000000-0000-4000-8000-000000000001' },
    document:{ getElementById:(id) => id === 'worldAnnouncementRegion' ? region : null },
    appendChatMessage:(type, sender, message) => chats.push({ type, sender, message }),
    setTimeout:(fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout() {},
    YuksamData:{ ITEM_DEFS:{
      mithrilSword:{ id:'mithrilSword', name:'미스릴 검', slot:'weapon' },
      forestCloak:{ id:'forestCloak', name:'숲 망토', slot:'armor' },
    } },
  };
  vm.runInNewContext(source, { window, Math, BigInt, Set, Map, Object, String, Number, Array, JSON, Uint8Array });
  return { api:window.YuksamWorldAnnouncementsV1, window, chats, timers, region, attributes, classes };
}

function createStorage() {
  const values = new Map();
  return {
    getItem:(key) => values.has(key) ? values.get(key) : null,
    setItem:(key, value) => values.set(key, String(value)),
    removeItem:(key) => values.delete(key),
  };
}

test('verified notices format, deduplicate, persist to chat, and queue one small banner', () => {
  const { api, chats, timers, region, classes } = loadAnnouncements();
  const accepted = api.consume([
    { id:'9007199254740993', kind:'legendary_upgrade', actorName:'가람', subjectId:'mithrilSword' },
    { id:'9007199254740994', kind:'legendary_pet', actorName:'나리', subjectId:'yuksam' },
    { id:'9007199254740995', kind:'raid_clear', partyNames:['가람', '나리', '다온'], floor:40 },
    { id:'9007199254740996', kind:'teacher_notice', message:'1분 뒤 서버가 종료됩니다!' },
    { id:'9007199254740997', kind:'elite_defeat', actorName:'라온', subjectId:'desert_elite_snake' },
    { id:'9007199254740998', kind:'level_ten', actorName:'마루' },
  ]);

  assert.equal(accepted.length, 6);
  assert.equal(api.getCursor(), '9007199254740998', 'cursor must not lose bigint precision');
  assert.deepEqual(chats.map(({ message }) => message), [
    '✨ 가람 님이 미스릴 검 전설 강화에 성공했습니다!',
    '🌟 나리 님이 전설 펫 육삼이를 획득했습니다!',
    '🏆 가람, 나리, 다온 님이 40층을 클리어하셨습니다!',
    '📢 1분 뒤 서버가 종료됩니다!',
    '👑 라온 님이 엘리트 스네이크를 처치했습니다!',
    '🎊 마루 님이 10레벨을 달성했습니다!',
  ]);
  assert.equal(region.textContent, chats[0].message);
  assert.equal(classes.has('is-visible'), true);
  assert.equal(timers[0].ms, 4200);

  api.consume([{ id:'9007199254740994', kind:'legendary_pet', actorName:'나리', subjectId:'yuksam' }]);
  assert.equal(chats.length, 6, 'a replayed presence page must not duplicate chat or banners');
});

test('announcement input is bounded and local fallback is restricted to file/loopback', () => {
  const { api } = loadAnnouncements();
  assert.equal(api.normalizeAnnouncement({ id:'1', kind:'legendary_upgrade', actorName:'A', subjectId:'../bad' }), null);
  assert.equal(api.normalizeAnnouncement({ id:'2', kind:'raid_clear', partyNames:['A'], floor:62 }), null);
  assert.equal(api.normalizeAnnouncement({ id:'3', kind:'legendary_pet', actorName:'A\u0000', subjectId:'yuksam' }), null);
  assert.equal(api.normalizeAnnouncement({ id:'4', kind:'legendary_pet', actorName:'A', subjectId:'chick' }), null,
    'only the legendary yuksam pet may produce a legendary-pet notice');
  assert.equal(api.normalizeAnnouncement({ id:'5', kind:'teacher_notice', message:'' }), null);
  assert.equal(api.normalizeAnnouncement({ id:'6', kind:'teacher_notice', message:'A\u0000B' }), null);
  assert.equal(api.normalizeAnnouncement({ id:'7', kind:'teacher_notice', message:'가'.repeat(121) }), null);
  assert.equal(api.normalizeAnnouncement({ id:'9', kind:'elite_defeat', actorName:'A', subjectId:'final_teacher' }), null);
  assert.equal(api.normalizeAnnouncement({ id:'10', kind:'elite_defeat', actorName:'A\u0000', subjectId:'forest_elite_slime' }), null);
  assert.equal(api.normalizeAnnouncement({ id:'11', kind:'level_ten', actorName:'' }), null);
  assert.deepEqual(
    JSON.parse(JSON.stringify(api.normalizeAnnouncement({ id:'8', kind:'teacher_notice', message:'  수업   종료  ' }))),
    { id:'8', kind:'teacher_notice', message:'수업 종료' },
  );
  assert.equal(api.isLocalTestEnvironment({ protocol:'file:', hostname:'' }), true);
  assert.equal(api.isLocalTestEnvironment({ protocol:'http:', hostname:'localhost' }), true);
  assert.equal(api.isLocalTestEnvironment({ protocol:'https:', hostname:'63world.example' }), false);
  assert.match(api.requestId(), /^[0-9a-f-]{36}$/);
});

test('ambiguous special actions survive a reload with their original weapon context', () => {
  const sessionStorage = createStorage();
  const userId = '10000000-0000-4000-8000-000000000001';
  const requestId = '20000000-0000-4000-8000-000000000002';
  const first = loadAnnouncements({ sessionStorage }).api;
  const remembered = first.rememberPending('enhance', userId, {
    requestId,
    weaponId:'mithrilSword',
    oldTier:3,
  });
  assert.equal(remembered.weaponId, 'mithrilSword');

  const reloaded = loadAnnouncements({ sessionStorage }).api;
  assert.deepEqual(JSON.parse(JSON.stringify(reloaded.loadPending('enhance', userId))), {
    requestId,
    weaponId:'mithrilSword',
    oldTier:3,
  });
  assert.equal(reloaded.clearPending('enhance', userId), true);
  assert.equal(loadAnnouncements({ sessionStorage }).api.loadPending('enhance', userId), null);
  assert.equal(first.rememberPending('enhance', userId, {
    requestId,
    weaponId:'../bad',
    oldTier:3,
  }), null);
});

test('migration keeps notices private and all special outcomes atomic and idempotent', () => {
  assert.match(migration, /create table if not exists public\.world_announcements_v1/i);
  assert.match(migration, /alter table public\.world_announcements_v1 force row level security/i);
  assert.match(migration, /revoke all on table public\.world_announcements_v1 from public, anon, authenticated/i);
  assert.match(migration, /create table if not exists public\.student_special_action_receipts_v1/i);
  assert.match(migration, /primary key \(user_id, request_id\)/i);
  assert.match(migration, /create table if not exists public\.student_special_action_rate_v1/i);
  assert.match(migration, /on conflict \(user_id, action_name\) do update[\s\S]*interval '2 seconds'[\s\S]*if not found then[\s\S]*'RATE_LIMITED'/i);
  assert.match(migration, /world_announcements_v1_created_idx[\s\S]*created_at desc, id desc/i);
  assert.match(migration, /create or replace function public\.perform_world_special_action_v1\(\s*p_action text,\s*p_request_id uuid/i);
  assert.match(migration, /from public\.player_profiles_v2 profile[\s\S]*for update;[\s\S]*Two simultaneous retries[\s\S]*from public\.student_special_action_receipts_v1 receipt/i);
  assert.match(migration, /v_success := pg_catalog\.random\(\) < v_chance/i);
  assert.match(migration, /if v_success and v_new_tier = 4 then[\s\S]*'legendary_upgrade'/i);
  assert.match(migration, /if v_pet_id = 'yuksam' then[\s\S]*'legendary_pet'/i);
  assert.match(migration, /after update of phase on public\.raid_rooms_v1[\s\S]*private_announce_raid_clear_v1/i);
  assert.match(migration, /create or replace function public\.sync_world_presence_v2\(p_state jsonb\)/i);
  assert.match(migration, /announcement\.id > v_last_announcement_id[\s\S]*interval '5 minutes'[\s\S]*limit 30/i);
  assert.match(migration, /revoke all on function public\.perform_world_special_action_v1\(text, uuid\)[\s\S]*grant execute[\s\S]*to authenticated/i);
  assert.match(migration, /revoke all on function public\.sync_world_presence_v2\(jsonb\)[\s\S]*grant execute[\s\S]*to authenticated/i);
});

test('additive migration lowers only the authoritative legendary roll to fifteen percent', () => {
  assert.match(migration, /v_chance := case v_old_tier[\s\S]*when 3 then 0\.20/i,
    'the applied historical migration must remain immutable');
  assert.match(legendaryEnhancementBalance,
    /create or replace function public\.perform_world_special_action_v1\(\s*p_action text,\s*p_request_id uuid/i);
  assert.match(legendaryEnhancementBalance,
    /v_chance := case v_old_tier\s*when 0 then 0\.80\s*when 1 then 0\.60\s*when 2 then 0\.40\s*when 3 then 0\.15\s*else 0\s*end;/i);
  assert.doesNotMatch(legendaryEnhancementBalance, /when 3 then 0\.20/i);
  assert.match(legendaryEnhancementBalance, /v_success := pg_catalog\.random\(\) < v_chance/i);
  assert.match(legendaryEnhancementBalance,
    /if v_success and v_new_tier = 4 then[\s\S]*'legendary_upgrade'/i);
  assert.match(legendaryEnhancementBalance,
    /revoke all on function public\.perform_world_special_action_v1\(text, uuid\)[\s\S]*grant execute[\s\S]*to authenticated/i);
});

test('production UI uses the RPC while random outcome fallback stays behind the local-only gate', () => {
  const game = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
  const multiplayer = fs.readFileSync(path.join(root, 'src/multiplayer.js'), 'utf8');
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

  assert.match(game, /isLocalWorldSpecialActionFallbackV1\(\)[\s\S]*performWorldSpecialAction\('enhance', requestId\)/);
  assert.match(game, /performWorldSpecialAction\('summonPet', requestId\)/);
  assert.match(game, /pendingUpgradeRequestIdV1[\s\S]*pendingPetSummonRequestIdV1/);
  assert.match(game, /loadPendingWorldSpecialActionV1\('enhance'\)[\s\S]*resultItem/);
  assert.match(game, /rollEnhancement\(next\.successChance, Math\.random\(\)\)/);
  assert.match(game, /rememberPendingWorldSpecialActionV1\('summonPet'/);
  assert.match(multiplayer, /payload\.lastAnnouncementId = worldAnnouncements\?\.getCursor/);
  assert.match(multiplayer, /client\.rpc\('sync_world_presence_v4'/);
  assert.match(multiplayer, /worldAnnouncements\?\.consume\?\.\(data\.announcements\)/);
  assert.match(index, /id="worldAnnouncementRegion"[\s\S]*src="src\/world-announcements\.js"/);
  assert.match(css, /\.world-announcement-banner[\s\S]*\.chat-line\.announcement/);
  assert.match(css, /\.world-announcement-banner\[data-kind="teacher_notice"\]/);
});

test('teacher notices are authorized, bounded, idempotent, rate-limited, and projected through the locked feed', () => {
  assert.match(expansion, /world_announcements_v1_kind_check[\s\S]*'teacher_notice'/i);
  assert.match(expansion, /create or replace function public\.teacher_broadcast_world_announcement_v1\(\s*p_message text,\s*p_request_id uuid/i);
  assert.match(expansion, /security definer\s+set search_path = ''/i);
  assert.match(expansion, /v_user_id uuid := auth\.uid\(\)/i);
  assert.match(expansion, /v_user_id is null or not public\.is_teacher\(\)/i);
  assert.match(expansion, /char_length\(v_message\) not between 1 and 120[\s\S]*v_message ~ '\[\[:cntrl:\]\]'/i);
  assert.match(expansion, /pg_advisory_xact_lock[\s\S]*yuksam-teacher-announcement-v1/i);
  assert.match(expansion, /where announcement\.kind = 'teacher_notice'[\s\S]*announcement\.source_id = p_request_id/i);
  assert.match(expansion, /v_existing\.actor_user_id is distinct from v_user_id/i);
  assert.match(expansion, /announcement request id was already used/i);
  assert.match(expansion, /interval '2 seconds'[\s\S]*detail = 'RATE_LIMITED'/i);
  assert.match(expansion, /insert into public\.world_announcements_v1[\s\S]*'teacher_notice', p_request_id, v_user_id/i);
  assert.match(expansion, /revoke all on function public\.teacher_broadcast_world_announcement_v1\(text, uuid\)[\s\S]*from public, anon, authenticated/i);
  assert.match(expansion, /grant execute on function public\.teacher_broadcast_world_announcement_v1\(text, uuid\)[\s\S]*to authenticated/i);
  assert.match(expansion, /'message', recent\.payload ->> 'message'/i);
  assert.match(expansion, /announcement\.id > v_last_announcement_id[\s\S]*limit 30/i);
});

test('elite defeats and first level-ten transitions come only from protected core and combat state', () => {
  assert.match(milestoneExpansion, /world_announcements_v1_kind_check[\s\S]*'elite_defeat'[\s\S]*'level_ten'/i);
  assert.match(milestoneExpansion, /world_announcements_v1_level_ten_once[\s\S]*where kind = 'level_ten'/i);
  assert.match(milestoneExpansion, /create or replace function public\.private_announce_core_milestones_v1\(\)[\s\S]*security definer[\s\S]*set search_path = ''/i);
  assert.match(milestoneExpansion, /old\.level < 10 and new\.level = 10[\s\S]*'level_ten', new\.user_id, new\.user_id/i);
  assert.match(milestoneExpansion, /from public\.player_combat_sessions_v3 combat[\s\S]*join public\.game_monster_catalog_v3 monster/i);
  assert.match(milestoneExpansion, /combat\.user_id = new\.user_id[\s\S]*combat\.status = 'active'/i);
  assert.match(milestoneExpansion, /monster\.elite[\s\S]*not monster\.boss[\s\S]*'forest_elite_slime'[\s\S]*'desert_elite_snake'[\s\S]*'swamp_elite_zombie'/i);
  assert.match(milestoneExpansion, /new\.gold - old\.gold = monster\.gold_reward/i);
  assert.match(milestoneExpansion, /'elite_defeat', v_combat_id, new\.user_id, v_monster_key/i);
  assert.match(milestoneExpansion, /on conflict \(kind, source_id\) do nothing/i);
  assert.match(milestoneExpansion, /after update of level, gold on public\.player_core_v3[\s\S]*private_announce_core_milestones_v1/i);
  assert.match(milestoneExpansion, /revoke all on function public\.private_announce_core_milestones_v1\(\)[\s\S]*from public, anon, authenticated/i);
  assert.doesNotMatch(milestoneExpansion, /after update of data on public\.player_profiles_v2/i,
    'browser-writable profile JSON must never be treated as proof of an elite victory');
});
