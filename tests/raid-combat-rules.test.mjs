import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync as readFileRaw } from 'node:fs';
import { dirname, join } from 'node:path';
import { Script, createContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const read = (file) => readFileRaw(join(root, file), 'utf8').replace(/\r\n/g, '\n');

function loadApi() {
  let uid = 0;
  const window = {
    YuksamCore:{ uid:() => `test-${++uid}` },
    YuksamAudioManifest:{
      classBasicSounds:{ warrior:'warriorBasic', mage:'mageBasic', priest:'priestBasic' },
      skillSounds:{
        warrior_def_stance:'defensiveStance',
        warrior_weapon_slash:'shatteringStrike',
        mage_fireball_v24:'fireball',
        mage_frost_lance_v24:'frostLance',
        priest_holy_absorb_v24:'holyShared',
        priest_shadow_seed_v24:'shadowSeed',
      },
      assets:{ shadowStackGain:{} },
    },
  };
  const context = createContext({ window, globalThis:window });
  new Script(read('src/game-data.js'), { filename:'src/game-data.js' }).runInContext(context);
  Object.assign(window.YuksamData.SKILL_DEFS, window.YuksamData.V24_SKILLS);
  for (const file of ['src/raid-combat-rules.js', 'src/raid-rules.js', 'src/raid-run.js']) {
    new Script(read(file), { filename:file }).runInContext(context);
  }
  return window;
}

const api = loadApi();
const combat = api.YuksamRaidCombatRules;
const raid = api.YuksamRaidRules;

const member = (id, extra = {}) => combat.normalizeMember({
  id,
  name:id,
  klass:'warrior',
  spec:'무기',
  slot:'front',
  maxHp:100,
  hp:100,
  attack:100,
  skills:{},
  ...extra,
});

const monster = (extra = {}) => combat.normalizeMonster({
  id:'monster',
  name:'연습 몬스터',
  maxHp:2000,
  hp:2000,
  attack:10,
  ...extra,
});

const constant = (value = 0.5) => () => value;
const sequence = (values, fallback = 0.5) => {
  const queue = [...values];
  return () => queue.length ? queue.shift() : fallback;
};

function resolve({ members, target = monster(), submissions, rng = constant(), attackKind = 'single' }) {
  return combat.resolveRound({
    members,
    monster:target,
    submissions,
    attackKind,
    monsterAttack:target.attack,
    rng,
    raidRules:raid,
  });
}

test('member normalization preserves independent skill, cooldown, shield, status, and passive state', () => {
  const original = {
    id:'a', maxHp:80, hp:70, attack:12,
    skills:{ warrior_weapon_breaker:2 },
    skillCooldowns:{ warrior_weapon_slash:3 },
    shield:4,
    statuses:{ stun:1, chill:2 },
    buffs:{ intBuffTurns:2, intBuffPct:0.3 },
    chargeActive:true,
    bastionUsed:true,
  };
  const normalized = combat.normalizeMember(original);
  assert.deepEqual({ ...normalized.skills }, { warrior_weapon_breaker:2 });
  assert.deepEqual({ ...normalized.cooldowns }, { warrior_weapon_slash:3 });
  assert.equal(normalized.shield, 4);
  assert.equal(normalized.statuses.stunTurns, 1);
  assert.equal(normalized.statuses.chillTurns, 2);
  assert.equal(normalized.buffs.intBuffTurns, 2);
  assert.equal(normalized.chargeActive, true);
  assert.equal(normalized.bastionUsed, true);
  original.skills.warrior_weapon_breaker = 0;
  assert.equal(normalized.skills.warrior_weapon_breaker, 2);
});

test('server primaryStat takes priority over the obsolete half-sized attack field', () => {
  const normalized = combat.normalizeMember({
    id:'stat', maxHp:20, hp:20, primaryStat:40, attack:20,
  });
  assert.equal(normalized.attack, 40);
});

test('basic attack matches the hunting v50 low-roll critical floor exactly', () => {
  const fighter = member('fighter', { attack:100 });
  const result = resolve({
    members:[fighter],
    submissions:{ fighter:{ correct:true, actionId:'basic' } },
    /* 사냥터 순서: 공격력 난수 0 → 명중 0.5 → 치명타 0. */
    rng:sequence([0, 0.5, 0]),
  });
  const hit = result.events.find((event) => event.kind === 'party-hit');
  /* 주 능력치 100: 굴림 30, 최대 일반 피해 70, 치명타 45 → v50 하한 70. */
  assert.equal(hit.damage, 70);
  assert.equal(hit.critical, true);
});

test('basic attack applies hunting order: critical floor, then charge, then chill', () => {
  const fighter = member('fighter', {
    attack:100,
    chargeActive:true,
    statuses:{ chillTurns:1 },
  });
  const result = resolve({
    members:[fighter],
    submissions:{ fighter:{ correct:true, actionId:'basic' } },
    rng:sequence([0, 0.5, 0]),
  });
  const hit = result.events.find((event) => event.kind === 'party-hit');
  assert.equal(hit.damage, 98, '치명타 하한 70 × 차지 2.8 × 냉기 0.5');
  assert.equal(fighter.chargeActive, false);
  assert.equal(fighter.statuses.chillTurns, 0);
});

test('double attack adds the learned percentage as a separate basic hit', () => {
  const fighter = member('fighter', { skills:{ warrior_weapon_breaker:3 } });
  const result = resolve({
    members:[fighter],
    submissions:{ fighter:{ correct:true, actionId:'basic' } },
  });
  const hits = result.events.filter((event) => event.kind === 'party-hit');
  assert.equal(hits.length, 2);
  assert.equal(hits[0].damage, 50);
  assert.equal(hits[1].damage, 38);
  assert.equal(hits[1].label, '더블 어택');
  assert.equal(hits[1].audioId, 'warriorBasic');
});

test('multi-hit skills create every hit and carry their skill sound metadata', () => {
  const mage = member('mage', {
    klass:'mage', spec:'화염', skills:{ mage_fireball_v24:1 },
  });
  const result = resolve({
    members:[mage],
    submissions:{ mage:{ correct:true, actionId:'mage_fireball_v24' } },
  });
  const hits = result.events.filter((event) => event.kind === 'party-hit');
  assert.equal(hits.length, 2);
  assert.deepEqual(Array.from(hits, (event) => event.damage), [53, 53]);
  assert.equal(hits[0].audioId, 'fireball');
  assert.equal(hits[1].audioId, null);
});

test('a landed shattering strike stuns the monster and skips its counterattack', () => {
  const fighter = member('fighter', { skills:{ warrior_weapon_slash:1 } });
  const result = resolve({
    members:[fighter],
    submissions:{ fighter:{ correct:true, actionId:'warrior_weapon_slash' } },
  });
  assert.ok(result.events.some((event) => event.kind === 'monster-status' && event.status === 'stun'));
  assert.ok(result.events.some((event) => event.kind === 'monster-skip' && event.status === 'stun'));
  assert.ok(!result.events.some((event) => event.kind === 'monster-hit'));
});

test('a missed hostile skill cancels stun and every attached status effect', () => {
  const fighter = member('fighter', { skills:{ warrior_weapon_slash:1 } });
  const result = resolve({
    members:[fighter],
    submissions:{ fighter:{ correct:true, actionId:'warrior_weapon_slash' } },
    rng:sequence([0.5, 0.01]),
  });
  assert.ok(result.events.some((event) => event.kind === 'party-hit' && event.missed));
  assert.ok(!result.events.some((event) => event.kind === 'monster-status'));
  assert.ok(result.events.some((event) => event.kind === 'monster-hit'));
});

test('wrong damaging answers deal half damage without applying the skill status', () => {
  const fighter = member('fighter', { skills:{ warrior_weapon_slash:1 } });
  const result = resolve({
    members:[fighter],
    submissions:{ fighter:{ correct:false, actionId:'warrior_weapon_slash' } },
  });
  const hit = result.events.find((event) => event.kind === 'party-hit');
  assert.equal(hit.damage, 45);
  assert.equal(hit.correct, false);
  assert.ok(!result.events.some((event) => event.kind === 'monster-status'));
  assert.equal(fighter.cooldowns.warrior_weapon_slash, 4, '5턴을 사용하고 살아 있는 적의 턴 뒤 1 감소');
});

test('wrong support answers neither heal nor spend the support cooldown', () => {
  const priest = member('priest', {
    klass:'priest', spec:'신성', hp:10,
    skills:{ priest_holy_absorb_v24:1 },
  });
  const result = resolve({
    members:[priest],
    submissions:{ priest:{ correct:false, actionId:'priest_holy_absorb_v24' } },
  });
  assert.ok(!result.events.some((event) => event.kind === 'party-heal'));
  assert.equal(priest.cooldowns.priest_holy_absorb_v24 || 0, 0);
});

test('light flash heals every living ally, clamps HP, and exposes the real skill audio', () => {
  const priest = member('priest', {
    klass:'priest', spec:'신성', slot:'back', hp:100,
    skills:{ priest_holy_absorb_v24:1 },
  });
  const tank = member('tank', { slot:'front', hp:10 });
  const mage = member('mage', { klass:'mage', slot:'middle', hp:70 });
  const result = resolve({
    members:[tank, mage, priest],
    submissions:{
      tank:{ correct:false, actionId:'basic' },
      mage:{ correct:false, actionId:'basic' },
      priest:{ correct:true, actionId:'priest_holy_absorb_v24' },
    },
  });
  const heals = result.events.filter((event) => event.kind === 'party-heal');
  assert.equal(mage.hp, 100);
  assert.ok(heals.some((event) => event.memberId === 'tank' && event.amount === 50));
  assert.ok(heals.some((event) => event.memberId === 'mage' && event.amount === 30));
  assert.equal(heals.find((event) => event.audioId)?.audioId, 'holyShared');
  assert.ok(heals.every((event) => event.healerId === 'priest'));
});

test('all shields have a minimum value of one and split shield damage from HP damage', () => {
  const tank = member('tank', {
    maxHp:5, hp:5, attack:1, spec:'방어',
    skills:{ warrior_def_stance:1 },
  });
  const target = monster({ attack:1 });
  const result = resolve({
    members:[tank], target,
    submissions:{ tank:{ correct:true, actionId:'warrior_def_stance' } },
  });
  const shield = result.events.find((event) => event.kind === 'party-shield' && !event.passive);
  const hit = result.events.find((event) => event.kind === 'monster-hit' && !event.missed);
  assert.equal(shield.amount, 1);
  assert.equal(hit.shieldDamage, 1);
  assert.equal(hit.hpDamage, 2, '던전 몬스터 60% 강화 뒤 남은 피해는 HP에 들어가야 한다');
});

test('block training creates at least one shield even at very low HP', () => {
  const tank = member('tank', {
    maxHp:20, hp:1, attack:1, spec:'방어',
    skills:{ warrior_basic_guard:1 },
  });
  const result = resolve({
    members:[tank],
    submissions:{ tank:{ correct:true, actionId:'basic' } },
  });
  const shield = result.events.find((event) => event.kind === 'party-shield' && event.passive);
  assert.equal(shield.amount, 1);
  assert.equal(shield.audioId, 'blockShield');
});

test('frost status halves the next monster attack and is consumed by one turn', () => {
  const mage = member('mage', {
    klass:'mage', spec:'냉기', skills:{ mage_frost_lance_v24:1 },
  });
  const target = monster({ attack:10 });
  const result = resolve({
    members:[mage], target,
    submissions:{ mage:{ correct:true, actionId:'mage_frost_lance_v24' } },
  });
  const hit = result.events.find((event) => event.kind === 'monster-hit' && !event.missed);
  assert.equal(hit.requestedDamage, 19, '60% 강화된 집중 공격도 냉기로 절반이 되어야 한다');
  assert.equal(target.chillTurns, 1, '강제 냉기 2턴 중 공격 한 번으로 1턴이 소비되어야 한다');
});

test('charge persists for one turn and multiplies the next damaging action', () => {
  const fighter = member('fighter', { skills:{ warrior_weapon_judgment:1 } });
  const target = monster({ attack:1 });
  const first = resolve({
    members:[fighter], target,
    submissions:{ fighter:{ correct:true, actionId:'warrior_weapon_judgment' } },
  });
  assert.ok(first.events.some((event) => event.kind === 'party-charge'));
  assert.equal(fighter.chargeActive, true);
  const second = resolve({
    members:[fighter], target,
    submissions:{ fighter:{ correct:true, actionId:'basic' } },
  });
  const hit = second.events.find((event) => event.kind === 'party-hit');
  assert.equal(hit.damage, 140);
  assert.equal(hit.chargeReleased, true);
  assert.equal(fighter.chargeActive, false);
});

test('charge and player chill remain when every attack hit misses', () => {
  const fighter = member('fighter', {
    chargeActive:true,
    statuses:{ chillTurns:1 },
  });
  resolve({
    members:[fighter],
    submissions:{ fighter:{ correct:true, actionId:'basic' } },
    rng:sequence([0.5, 0.01, 0.5, 0.5]),
  });
  assert.equal(fighter.chargeActive, true);
  assert.equal(fighter.statuses.chillTurns, 1);
});

test('elemental explosion executes a monster left at the learned HP threshold', () => {
  const mage = member('mage', {
    klass:'mage', attack:10, skills:{ mage_basic_element:5 },
  });
  const target = monster({ maxHp:200, hp:20, attack:1 });
  const result = resolve({
    members:[mage], target,
    submissions:{ mage:{ correct:true, actionId:'basic' } },
  });
  assert.equal(target.hp, 0);
  assert.ok(result.events.some((event) => event.kind === 'monster-execute' && event.audioId === 'execution'));
});

test('a wrong zero-damage shadow mark neither adds stacks nor spends cooldown', () => {
  const priest = member('priest', {
    klass:'priest', spec:'암흑', skills:{ priest_shadow_mark_v24:1 },
  });
  const target = monster();
  const result = resolve({
    members:[priest], target,
    submissions:{ priest:{ correct:false, actionId:'priest_shadow_mark_v24' } },
  });
  assert.equal(priest.cooldowns.priest_shadow_mark_v24 || 0, 0);
  assert.equal(target.shadowBySource.priest || 0, 0);
  assert.ok(!result.events.some((event) => event.kind === 'party-hit'));
});

test('shadow stacks share the hunting limit of twenty across the whole party', () => {
  const target = monster({ attack:1 });
  const priests = ['one', 'two', 'three'].map((id, index) => member(id, {
    klass:'priest', spec:'암흑', slot:['front', 'middle', 'back'][index],
    skills:{ priest_shadow_mark_v24:1 },
  }));
  resolve({
    members:priests,
    target,
    submissions:Object.fromEntries(priests.map((entry) => [entry.id, {
      correct:true, actionId:'priest_shadow_mark_v24',
    }])),
  });
  const total = Object.values(target.shadowBySource).reduce((sum, value) => sum + value, 0);
  assert.equal(total, 20);
});

test('shadow stacks tick after the monster turn and stay attributed to their caster', () => {
  const priest = member('priest', {
    klass:'priest', spec:'암흑', skills:{ priest_shadow_seed_v24:1 },
  });
  const target = monster({ attack:1 });
  const result = resolve({
    members:[priest], target,
    submissions:{ priest:{ correct:true, actionId:'priest_shadow_seed_v24' } },
  });
  assert.equal(target.shadowBySource.priest, 4);
  const dot = result.events.find((event) => event.kind === 'monster-dot');
  assert.equal(dot.memberId, 'priest');
  assert.equal(dot.stacks, 4);
  assert.equal(dot.damage, 4);
  assert.equal(dot.audioId, 'shadowStackHit');
});

test('guardian oath revives a defeated warrior once per encounter', () => {
  const tank = member('tank', {
    maxHp:20, hp:1, attack:1, spec:'방어',
    skills:{ warrior_def_bastion:1 },
  });
  const target = monster({ attack:100 });
  const first = resolve({
    members:[tank], target,
    submissions:{ tank:{ correct:true, actionId:'basic' } },
  });
  assert.ok(first.events.some((event) => event.kind === 'member-revive'));
  assert.equal(tank.hp, 20);
  assert.equal(tank.bastionUsed, true);
  const second = resolve({
    members:[tank], target,
    submissions:{ tank:{ correct:true, actionId:'basic' } },
  });
  assert.ok(!second.events.some((event) => event.kind === 'member-revive'));
  assert.equal(tank.hp, 0);
  assert.ok(second.events.some((event) => event.kind === 'member-down' && event.memberId === 'tank'));
});

test('a downed member takes no later turn, cannot be targeted, and has no cooldown progress', () => {
  const front = member('front', {
    slot:'front', maxHp:1, hp:1, attack:1,
    cooldowns:{ warrior_weapon_slash:3 },
  });
  const middle = member('middle', { slot:'middle', maxHp:100, hp:100, attack:1 });
  const back = member('back', { slot:'back', maxHp:100, hp:100, attack:1 });
  const target = monster({ attack:10 });
  const submissions = {
    front:{ correct:true, actionId:'basic' },
    middle:{ correct:true, actionId:'basic' },
    back:{ correct:true, actionId:'basic' },
  };

  const first = resolve({ members:[back, front, middle], target, submissions });
  assert.equal(front.hp, 0);
  assert.ok(first.events.some((event) => event.kind === 'member-down' && event.memberId === 'front'));
  assert.equal(front.cooldowns.warrior_weapon_slash, 3, '죽은 턴에는 쿨타임도 진행하지 않는다');

  const second = resolve({ members:[back, front, middle], target, submissions });
  assert.ok(!second.events.some((event) => event.kind === 'party-action' && event.memberId === 'front'));
  assert.ok(!second.events.some((event) => event.kind === 'party-hit' && event.memberId === 'front'));
  assert.ok(!second.events.some((event) => event.kind === 'monster-hit' && event.memberId === 'front'));
  assert.equal(front.cooldowns.warrior_weapon_slash, 3);
});

test('structured whole-party damage events are always front, middle, back', () => {
  const front = member('front', { slot:'front', attack:1 });
  const middle = member('middle', { slot:'middle', attack:1 });
  const back = member('back', { slot:'back', attack:1 });
  const target = monster({ attack:10 });
  const result = resolve({
    members:[back, front, middle],
    target,
    attackKind:'all',
    submissions:{
      front:{ correct:true, actionId:'basic' },
      middle:{ correct:true, actionId:'basic' },
      back:{ correct:true, actionId:'basic' },
    },
  });
  const targetOrder = Array.from(
    result.events.filter((event) => event.kind === 'monster-hit'),
    (event) => event.memberId,
  );
  assert.deepEqual(targetOrder, ['front', 'middle', 'back']);
});

test('raid-run revives a genuinely downed structured-combat member at exactly 1 HP for the next monster', () => {
  const run = api.YuksamRaidRun.createRun({
    floor:1,
    rng:constant(),
    members:[
      member('front', { slot:'front', maxHp:1, hp:1, attack:1 }),
      member('middle', { slot:'middle', maxHp:100, hp:100, attack:1 }),
      member('back', { slot:'back', maxHp:100, hp:100, attack:1 }),
    ],
  });
  run.confirmFormation({ front:'front', middle:'middle', back:'back' });
  run.arriveAtEncounter();
  const submissions = {
    front:{ correct:true, actionId:'basic' },
    middle:{ correct:true, actionId:'basic' },
    back:{ correct:true, actionId:'basic' },
  };
  run.resolveRound(submissions);
  assert.equal(run.members.find((entry) => entry.id === 'front').hp, 0);

  run.members.find((entry) => entry.id === 'middle').attack = 500;
  run.members.find((entry) => entry.id === 'back').attack = 500;
  const defeated = run.resolveRound(submissions);
  assert.equal(defeated.monsterDown, true);
  assert.equal(run.phase, 'travel');

  run.members.find((entry) => entry.id === 'middle').hp = 77;
  run.arriveAtEncounter();
  assert.equal(run.members.find((entry) => entry.id === 'front').hp, 1);
  assert.equal(run.members.find((entry) => entry.id === 'middle').hp, 77);
});

test('raid-run accepts structured submissions and snapshots nested combat state defensively', () => {
  const run = api.YuksamRaidRun.createRun({
    floor:1,
    rng:constant(),
    members:[
      member('me', { slot:'front', skills:{ warrior_weapon_breaker:1 }, isPlayer:true }),
      member('middle', { slot:'middle' }),
      member('back', { slot:'back' }),
    ],
  });
  assert.equal(run.confirmFormation({ me:'front', middle:'middle', back:'back' }).ok, true);
  run.arriveAtEncounter();
  const result = run.resolveRound({
    me:{ correct:true, actionId:'basic' },
    middle:{ correct:true, actionId:'basic' },
    back:{ correct:true, actionId:'basic' },
  });
  assert.equal(result.ok, true);
  assert.ok(result.events.some((event) => event.kind === 'party-hit' && event.label === '더블 어택'));
  const snap = run.snapshot();
  snap.members[0].skills.warrior_weapon_breaker = 0;
  snap.members[0].cooldowns.fake = 99;
  assert.equal(run.members[0].skills.warrior_weapon_breaker, 1);
  assert.equal(run.members[0].cooldowns.fake, undefined);
});

test('raid-run keeps level, defense, costume, and active pet in member snapshots', () => {
  const run = api.YuksamRaidRun.createRun({
    floor:1,
    members:[
      member('me', {
        level:7,
        defense:19,
        costume:{ hat:'quest_hat', body:'green_coat' },
        activePet:'cloud_cat',
        appearance:{ hair:'#123456' },
        equipment:{ weapon:'wood_sword' },
      }),
      member('middle', { slot:'middle' }),
      member('back', { slot:'back' }),
    ],
  });
  const mine = run.snapshot().members.find((entry) => entry.id === 'me');
  assert.equal(mine.level, 7);
  assert.equal(mine.defense, 19);
  assert.equal(mine.costume.hat, 'quest_hat');
  assert.equal(mine.activePet, 'cloud_cat');
});

test('raid-run safely imports a partial host snapshot without erasing local visuals', () => {
  const run = api.YuksamRaidRun.createRun({
    floor:1,
    members:[
      member('me', {
        hp:90,
        level:7,
        defense:19,
        isPlayer:true,
        appearance:{ hair:'#123456' },
        equipment:{ weapon:'wood_sword' },
        costume:{ hat:'quest_hat' },
        activePet:'cloud_cat',
      }),
      member('middle', { slot:'middle' }),
      member('back', { slot:'back' }),
    ],
  });
  const result = run.importSnapshot({
    phase:'battle',
    round:3,
    encounterIndex:1,
    members:[{
      id:'me', hp:44, shield:8, isPlayer:false,
      skills:{ warrior_weapon_breaker:2 },
      cooldowns:{ warrior_weapon_slash:3 },
    }],
    monster:{ id:'officeGhost', name:'사무실 유령', maxHp:224, hp:111, attack:10, stunTurns:1 },
  });
  assert.equal(result.ok, true);
  const mine = run.members.find((entry) => entry.id === 'me');
  assert.equal(run.phase, 'battle');
  assert.equal(run.snapshot().round, 3);
  assert.equal(run.snapshot().encounterIndex, 1);
  assert.equal(mine.hp, 44);
  assert.equal(mine.shield, 8);
  assert.equal(mine.isPlayer, true, 'isPlayer는 브라우저마다 다른 로컬 정보다');
  assert.equal(mine.appearance.hair, '#123456');
  assert.equal(mine.equipment.weapon, 'wood_sword');
  assert.equal(mine.costume.hat, 'quest_hat');
  assert.equal(mine.activePet, 'cloud_cat');
  assert.equal(mine.level, 7);
  assert.equal(mine.defense, 19);
  assert.equal(run.monster.hp, 111);
  assert.equal(run.monster.stunTurns, 1);
});

test('raid-run imports explicit appearance data defensively and rejects another floor', () => {
  const run = api.YuksamRaidRun.createRun({
    floor:1,
    members:[
      member('me', { isPlayer:true, appearance:{ hair:'old' } }),
      member('middle', { slot:'middle' }),
      member('back', { slot:'back' }),
    ],
  });
  const appearance = { hair:'new' };
  assert.equal(run.importSnapshot({ members:[{ id:'me', appearance }] }).ok, true);
  appearance.hair = 'mutated-outside';
  assert.equal(run.members.find((entry) => entry.id === 'me').appearance.hair, 'new');

  const before = run.snapshot();
  const rejected = run.importSnapshot({ floor:2, phase:'battle', round:99 });
  assert.equal(rejected.ok, false);
  assert.equal(run.phase, before.phase);
  assert.equal(run.snapshot().round, before.round);
});
