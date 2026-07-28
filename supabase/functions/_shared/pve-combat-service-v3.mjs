import {
  buildCombatant,
  startEncounter,
  resolveEscapeAttempt,
  resolveTurn,
} from './pve-combat-rules-v3.mjs';
import { MONSTER_COMBAT_V3 } from './generated-combat-catalog-v3.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONSTER_ID = /^[a-z0-9][a-z0-9_]{0,79}$/;
const ACTION_ID = /^(?:basic|active:[a-z0-9][a-z0-9_]{0,79})$/;
const fail = (code) => {
  const error = new Error(code);
  error.code = code;
  throw error;
};
const validRequest = (value) => UUID.test(String(value || ''));
const validRevision = (value) => Number.isSafeInteger(Number(value)) && Number(value) >= 1;

function publicSafe(value) {
  if (Array.isArray(value)) return value.map(publicSafe);
  if (!value || typeof value !== 'object') return value;
  const safe = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'answerKey' || key === 'answer_key' || key === 'submittedAnswer') continue;
    safe[key] = publicSafe(entry);
  }
  const serialized = JSON.stringify(safe);
  if (serialized.length > 65536) fail('RESPONSE_TOO_LARGE');
  return safe;
}

function stateFromSession(session) {
  const monster = MONSTER_COMBAT_V3[session?.monsterKey];
  if (!monster) fail('UNKNOWN_MONSTER');
  return {
    monsterKey:session.monsterKey,
    playerHp:session.playerHp,
    playerMaxHp:session.playerMaxHp,
    playerShield:session.playerShield,
    monsterHp:session.monsterHp,
    monsterMaxHp:session.monsterMaxHp,
    monsterAttack:session.monsterAttack,
    monsterShield:session.monsterShield,
    playerStatuses:session.playerStatuses || {},
    monsterStatuses:session.monsterStatuses || {},
    cooldowns:session.cooldowns || {},
    escapeFailed:session.escapeFailed === true,
    turnNumber:session.turnNumber,
    status:session.status,
    monsterPatterns:monster.patterns,
  };
}

export function createPveCombatService({ store, random = Math.random } = {}) {
  if (!store || typeof random !== 'function') throw new Error('Combat service dependencies are required');

  async function start(userId, body) {
    if (!MONSTER_ID.test(String(body.monsterKey || '')) || !validRequest(body.requestId)) {
      fail('INVALID_REQUEST');
    }
    const projection = await store.readCombatant(userId);
    if (!projection) fail('PLAYER_NOT_FOUND');
    const player = buildCombatant(projection);
    const state = startEncounter({
      player,
      monsterKey:String(body.monsterKey),
      initialCooldowns:projection.combatCooldowns || projection.cooldowns || {},
      random,
    });
    return publicSafe(await store.start({
      userId,
      monsterKey:String(body.monsterKey),
      expectedPlayerRevision:Number(projection.revision),
      state,
      requestId:String(body.requestId),
    }));
  }

  async function submitTurn(userId, body) {
    if (!UUID.test(String(body.questionToken || ''))
      || !validRevision(body.sessionRevision)
      || !validRequest(body.requestId)
      || !ACTION_ID.test(String(body.actionId || ''))
      || String(body.answer ?? '').length > 512) {
      fail('INVALID_REQUEST');
    }
    const prepared = await store.prepareTurn({
      userId,
      questionToken:String(body.questionToken),
      expectedSessionRevision:Number(body.sessionRevision),
      requestId:String(body.requestId),
    });
    if (prepared?.replayed) return publicSafe(prepared.response);
    if (!prepared?.session || !prepared?.player || typeof prepared.answerKey !== 'string') {
      fail('COMBAT_STATE_MISSING');
    }
    const player = buildCombatant(prepared.player);
    const outcome = resolveTurn({
      state:stateFromSession(prepared.session),
      player,
      actionId:String(body.actionId),
      answer:String(body.answer ?? ''),
      answerKey:prepared.answerKey,
      random,
    });
    const committed = await store.commitTurn({
      userId,
      expectedSessionRevision:Number(body.sessionRevision),
      expectedPlayerRevision:Number(prepared.session.playerRevision),
      requestId:String(body.requestId),
      outcome:{ ...outcome, submittedAnswer:String(body.answer ?? '') },
    });
    if (typeof store.persistCooldowns === 'function') {
      await store.persistCooldowns({ userId, cooldowns:outcome.state?.cooldowns || {} });
    }
    return publicSafe(committed);
  }

  async function surrender(userId, body) {
    if (!validRevision(body.sessionRevision) || !validRequest(body.requestId)) fail('INVALID_REQUEST');
    return publicSafe(await store.surrender({
      userId,
      expectedSessionRevision:Number(body.sessionRevision),
      requestId:String(body.requestId),
    }));
  }

  async function attemptEscape(userId, body) {
    if (!validRevision(body.sessionRevision) || !validRequest(body.requestId)) {
      fail('INVALID_REQUEST');
    }
    const prepared = await store.prepareEscape({
      userId,
      expectedSessionRevision:Number(body.sessionRevision),
      requestId:String(body.requestId),
    });
    if (prepared?.replayed) return publicSafe(prepared.response);
    if (!prepared?.session || !prepared?.player) fail('COMBAT_STATE_MISSING');
    const player = buildCombatant(prepared.player);
    const outcome = resolveEscapeAttempt({
      state:stateFromSession(prepared.session),
      player,
      random,
    });
    return publicSafe(await store.commitEscape({
      userId,
      expectedSessionRevision:Number(body.sessionRevision),
      expectedPlayerRevision:Number(prepared.session.playerRevision),
      requestId:String(body.requestId),
      outcome,
    }));
  }

  async function startHealing(userId, body) {
    if (!validRevision(body.expectedRevision) || !validRequest(body.requestId)) fail('INVALID_REQUEST');
    return publicSafe(await store.startHealing({
      userId,
      expectedRevision:Number(body.expectedRevision),
      requestId:String(body.requestId),
    }));
  }

  async function submitHealing(userId, body) {
    if (!UUID.test(String(body.questionToken || ''))
      || String(body.answer ?? '').length > 512
      || !validRevision(body.expectedRevision)
      || !validRequest(body.requestId)) fail('INVALID_REQUEST');
    return publicSafe(await store.submitHealing({
      userId,
      questionToken:String(body.questionToken),
      answer:String(body.answer ?? ''),
      expectedRevision:Number(body.expectedRevision),
      requestId:String(body.requestId),
    }));
  }

  async function handle(userId, body = {}) {
    if (!userId) fail('UNAUTHENTICATED');
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail('INVALID_REQUEST');
    switch (body.op) {
      case 'start': return start(userId, body);
      case 'submit_turn': return submitTurn(userId, body);
      case 'attempt_escape': return attemptEscape(userId, body);
      case 'surrender': return surrender(userId, body);
      case 'resume': return publicSafe(await store.resume(userId));
      case 'start_healing': return startHealing(userId, body);
      case 'submit_healing': return submitHealing(userId, body);
      default: fail('INVALID_OPERATION');
    }
  }

  return Object.freeze({ handle });
}
