import { PVP_SKILLS } from './pvp-catalog.mjs';

const LIMITS = Object.freeze({
  level:[1, 100],
  maxHp:[1, 100000],
  attack:[1, 10000],
  defense:[0, 10000],
});
const CLASS_SPECS = Object.freeze({
  warrior:new Set(['방어', '무기']),
  mage:new Set(['냉기', '화염']),
  priest:new Set(['신성', '암흑']),
});
export const PVP_DAMAGE_MULTIPLIER = 0.5;

function clamp(value, [minimum, maximum]) {
  const number = Number(value);
  return Math.max(minimum, Math.min(maximum, Number.isFinite(number) ? number : minimum));
}

function boundedText(value, maximum = 48) {
  return String(value ?? '').trim().slice(0, maximum);
}

function cleanNumberMap(raw, maximum = 99) {
  const result = {};
  if (!raw || typeof raw !== 'object') return result;
  for (const [key, value] of Object.entries(raw)) {
    const number = Math.trunc(Number(value));
    if (PVP_SKILLS[key] && Number.isFinite(number) && number > 0) {
      result[key] = Math.min(maximum, number);
    }
  }
  return result;
}

export function normalizeSnapshot(raw = {}) {
  const className = CLASS_SPECS[raw.className] ? raw.className : 'warrior';
  const maxHp = Math.trunc(clamp(raw.maxHp, LIMITS.maxHp));
  const skills = cleanNumberMap(raw.skills, 5);
  for (const id of Object.keys(skills)) {
    skills[id] = Math.min(skills[id], Math.max(1, Number(PVP_SKILLS[id].maxPoints) || 1));
  }
  return {
    userId:boundedText(raw.userId, 80),
    name:boundedText(raw.name || '학생', 24),
    level:Math.trunc(clamp(raw.level, LIMITS.level)),
    className,
    spec:CLASS_SPECS[className].has(raw.spec) ? raw.spec : '',
    maxHp,
    hp:Math.trunc(Math.max(0, Math.min(maxHp, Number(raw.hp) || 0))),
    shield:Math.trunc(Math.max(0, Math.min(maxHp * 3, Number(raw.shield) || 0))),
    attack:Math.trunc(clamp(raw.attack, LIMITS.attack)),
    defense:Math.trunc(clamp(raw.defense, LIMITS.defense)),
    appearance:raw.appearance && typeof raw.appearance === 'object' && !Array.isArray(raw.appearance)
      ? { ...raw.appearance }
      : {},
    equipment:raw.equipment && typeof raw.equipment === 'object' && !Array.isArray(raw.equipment)
      ? { ...raw.equipment }
      : {},
    costume:raw.costume && typeof raw.costume === 'object' && !Array.isArray(raw.costume)
      ? { ...raw.costume }
      : {},
    skills,
    cooldowns:cleanNumberMap(raw.cooldowns),
    elementalBarrierUsed:raw.elementalBarrierUsed === true,
    statuses:raw.statuses && typeof raw.statuses === 'object' ? {
      stun:Math.max(0, Math.trunc(Number(raw.statuses.stun) || 0)),
      chill:Math.max(0, Math.trunc(Number(raw.statuses.chill) || 0)),
      shadow:Math.max(0, Math.trunc(Number(raw.statuses.shadow) || 0)),
    } : {},
  };
}

export function selectQuestion(workbooks, randomInt) {
  const questions = (Array.isArray(workbooks) ? workbooks : [])
    .filter((workbook) => workbook?.enabled === true)
    .flatMap((workbook) => Array.isArray(workbook.questions) ? workbook.questions : [])
    .filter((question) => boundedText(question?.q || question?.prompt || question?.question, 500));
  if (!questions.length) return null;
  const index = randomInt(0, questions.length - 1);
  const selected = questions[Math.max(0, Math.min(questions.length - 1, index))];
  return Object.freeze({
    id:boundedText(selected.id || `question-${index}`, 100),
    prompt:boundedText(selected.q || selected.prompt || selected.question, 500),
    choices:Array.isArray(selected.choices) ? selected.choices.slice(0, 8).map((choice) => boundedText(choice, 120)) : [],
    answer:boundedText(selected.answer, 120),
  });
}

export function publicQuestion(question) {
  if (!question) return null;
  return {
    id:question.id,
    prompt:question.prompt,
    choices:[...(question.choices || [])],
  };
}

export function judgeAnswer(question, submittedAnswer) {
  return boundedText(submittedAnswer, 120).toLocaleLowerCase('ko-KR')
    === boundedText(question?.answer, 120).toLocaleLowerCase('ko-KR');
}

export function rollInitiative(randomInt) {
  const rolls = [];
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const roll = { a:randomInt(1, 30), b:randomInt(1, 30) };
    rolls.push(roll);
    if (roll.a !== roll.b) return { rolls, first:roll.a > roll.b ? 'a' : 'b' };
  }
  return { rolls, first:'a' };
}

function actionFor(player, actionId) {
  if (!actionId || actionId === 'basic') return { id:'basic', active:{ type:'damage', multiplier:1 } };
  const skill = PVP_SKILLS[actionId];
  if (
    !skill || !skill.active || !player.skills[actionId]
    || (skill.classOnly && skill.classOnly !== player.className)
    || (skill.specOnly && skill.specOnly !== player.spec)
    || Number(player.cooldowns[actionId] || 0) > 0
  ) return { id:'basic', active:{ type:'damage', multiplier:1 } };
  return skill;
}

function damageAmount(source, target, active, factor) {
  const multiplier = Number(active.multiplier ?? active.hitMult ?? 1);
  return Math.max(1, Math.round(Math.max(1, source.attack * multiplier - target.defense) * factor));
}

function applyDamage(sourceKey, targetKey, state, amount, active, events) {
  const target = state[targetKey];
  const bypass = active.ignoreShield === true;
  const absorbed = bypass ? 0 : Math.min(target.shield, amount);
  target.shield -= absorbed;
  const hpDamage = Math.min(target.hp, amount - absorbed);
  target.hp -= hpDamage;
  events.push({
    kind:'damage',
    source:sourceKey,
    target:targetKey,
    amount:hpDamage + absorbed,
    requestedAmount:amount,
    absorbed,
    hpDamage,
  });
}

function applyBlockTraining(ownerKey, state, events) {
  const owner = state[ownerKey];
  if (owner.className !== 'warrior') return;
  const rank = Math.max(0, Math.trunc(Number(owner.skills.warrior_basic_guard) || 0));
  const rates = PVP_SKILLS.warrior_basic_guard?.guardShieldPct || [];
  const rate = Number(rates[rank] || 0);
  if (!(owner.hp > 0) || !(rank > 0) || !(rate > 0)) return;
  const amount = Math.max(1, Math.floor(owner.hp * rate));
  owner.shield += amount;
  events.push({
    kind:'shield',
    source:ownerKey,
    target:ownerKey,
    skillId:'warrior_basic_guard',
    passive:true,
    amount,
  });
}

function applyElementalBarrierAfterDamage(ownerKey, state, hpBefore, events) {
  const owner = state[ownerKey];
  const rank = Math.max(0, Math.trunc(Number(owner.skills.mage_basic_element) || 0));
  const skill = PVP_SKILLS.mage_basic_element || {};
  const triggerHpPct = Number(skill.triggerHpPct || 0);
  const shieldPct = Number(skill.emergencyShieldPct?.[rank] || 0);
  if (
    owner.elementalBarrierUsed
    || owner.className !== 'mage'
    || !(rank > 0)
    || !(shieldPct > 0)
    || !(owner.hp > 0)
    || !(owner.hp < hpBefore)
    || !(owner.hp / Math.max(1, owner.maxHp) <= triggerHpPct)
  ) return;
  owner.elementalBarrierUsed = true;
  const amount = Math.max(1, Math.ceil(owner.maxHp * shieldPct));
  owner.shield += amount;
  events.push({
    kind:'shield', source:ownerKey, target:ownerKey,
    skillId:'mage_basic_element', passive:true, amount,
  });
}

function applyAction(sourceKey, targetKey, entry, state, events) {
  const source = state[sourceKey];
  const target = state[targetKey];
  if (source.hp <= 0 || source.statuses.stun > 0) return;
  const skill = actionFor(source, entry.actionId);
  const active = skill.active;
  /* 친선 PVP는 캐릭터의 원래 능력치를 쓰되, 한 방 결판을 줄이기 위해
     모든 공격 피해를 절반으로 낮춘다. 오답이면 거기서 다시 절반이다. */
  const factor = PVP_DAMAGE_MULTIPLIER * (entry.correct === true ? 1 : 0.5);
  if (skill.id !== 'basic') {
    source.cooldowns[skill.id] = Math.max(0, Number(active.cooldown) || 0);
    events.push({ kind:'cooldown', source:sourceKey, target:sourceKey, skillId:skill.id, amount:source.cooldowns[skill.id] });
  }
  if (active.type === 'shield' || active.type === 'shieldBash') {
    const shield = Math.max(1, Math.round(source.maxHp * Number(active.shieldPct || 0) * factor));
    source.shield += shield;
    events.push({ kind:'shield', source:sourceKey, target:sourceKey, amount:shield });
    if (active.type === 'shield') return;
  }
  if (active.type === 'buff') {
    const heal = Math.round(source.maxHp * Number(active.healMaxPct || 0) * factor);
    source.hp = Math.min(source.maxHp, source.hp + heal);
    events.push({ kind:'heal', source:sourceKey, target:sourceKey, amount:heal });
    return;
  }
  if (active.type === 'healAllies') {
    const heal = Math.round(source.maxHp * Number(active.healMaxPct || 0) * factor);
    source.hp = Math.min(source.maxHp, source.hp + heal);
    events.push({ kind:'heal', source:sourceKey, target:sourceKey, amount:heal });
    return;
  }
  const hits = Math.max(1, Math.trunc(Number(active.hits) || 1));
  for (let hit = 0; hit < hits && target.hp > 0; hit += 1) {
    const amount = active.type === 'shieldBash'
      ? Math.max(1, Math.round(source.shield * factor))
      : damageAmount(source, target, active, factor);
    applyDamage(sourceKey, targetKey, state, amount, active, events);
  }
  const healRate = Number(active.healRate || 0);
  const healMaxPct = Number(active.healMaxPct || 0);
  if ((healRate || healMaxPct) && source.hp > 0) {
    const dealt = events.filter((event) => event.source === sourceKey && event.kind === 'damage')
      .reduce((sum, event) => sum + event.hpDamage, 0);
    const heal = Math.round((healRate ? dealt * healRate : source.maxHp * healMaxPct) * factor);
    source.hp = Math.min(source.maxHp, source.hp + heal);
    events.push({ kind:'heal', source:sourceKey, target:sourceKey, amount:heal });
  }
  if (active.stun || active.forceChill || active.chillTurns) {
    const status = active.stun ? 'stun' : 'chill';
    const turns = Math.max(1, Number(active.stun || active.chillTurns || 1));
    target.statuses[status] = Math.max(target.statuses[status] || 0, turns);
    events.push({ kind:'status', source:sourceKey, target:targetKey, status, turns, amount:turns });
  }
  if (active.stacks) {
    target.statuses.shadow = Math.min(99, (target.statuses.shadow || 0) + Number(active.stacks));
    events.push({ kind:'status', source:sourceKey, target:targetKey, status:'shadow', turns:target.statuses.shadow, amount:Number(active.stacks) });
  }
}

function tickState(player) {
  for (const key of Object.keys(player.cooldowns)) player.cooldowns[key] = Math.max(0, player.cooldowns[key] - 1);
  for (const key of ['stun', 'chill']) {
    if (player.statuses[key]) player.statuses[key] = Math.max(0, player.statuses[key] - 1);
  }
}

export function resolveRound({ match, a, b, randomInt }) {
  const state = { a:normalizeSnapshot(a.player), b:normalizeSnapshot(b.player) };
  const initiative = rollInitiative(randomInt);
  const events = [];
  const order = initiative.first === 'a' ? [['a', 'b', a], ['b', 'a', b]] : [['b', 'a', b], ['a', 'b', a]];
  for (const [sourceKey, targetKey, entry] of order) {
    if (state[sourceKey].hp <= 0 || state[targetKey].hp <= 0) break;
    events.push({
      kind:'action',
      source:sourceKey,
      target:targetKey,
      actionId:actionFor(state[sourceKey], entry.actionId).id,
      correct:entry.correct === true,
      prevented:state[sourceKey].statuses.stun > 0 ? 'stun' : null,
    });
    const targetHpBefore = state[targetKey].hp;
    applyAction(sourceKey, targetKey, entry, state, events);
    applyElementalBarrierAfterDamage(targetKey, state, targetHpBefore, events);
    /* 일반 사냥과 같은 순서: 막기 훈련은 상대에게 맞기 직전 갑자기
       생기는 방어 보너스가 아니라, 자신의 행동을 마친 뒤 다음 반격을
       대비해 만드는 보호막이다. 전투가 끝났다면 불필요하게 생성하지 않는다. */
    if (state[sourceKey].hp > 0 && state[targetKey].hp > 0) {
      applyBlockTraining(sourceKey, state, events);
    }
  }
  tickState(state.a);
  tickState(state.b);
  const matchId = boundedText(match?.id || 'match', 100);
  const round = Math.max(1, Math.trunc(Number(match?.round) || 1));
  return {
    state,
    initiative,
    events:events.map((event, index) => Object.freeze({ ...event, id:`${matchId}:${round}:${index}` })),
    winner:state.a.hp <= 0 ? 'b' : state.b.hp <= 0 ? 'a' : null,
  };
}
