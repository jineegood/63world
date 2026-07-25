import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const rulesUrl = pathToFileURL(path.join(root, 'supabase/functions/_shared/pvp-rules.mjs'));

function sequence(values) {
  let index = 0;
  return (min, max) => {
    const value = values[index++];
    assert.ok(value >= min && value <= max);
    return value;
  };
}

function fighter(id, overrides = {}) {
  return {
    userId:id,
    name:id.toUpperCase(),
    level:10,
    className:'warrior',
    spec:'무기',
    maxHp:200,
    hp:200,
    shield:0,
    attack:50,
    defense:10,
    skills:{ warrior_basic_strike:1 },
    cooldowns:{},
    statuses:{ stun:0, chill:0, shadow:0 },
    ...overrides,
  };
}

test('committed PvP catalog matches current game skills', () => {
  execFileSync(process.execPath, ['tools/build-pvp-catalog.mjs', '--check'], {
    cwd:root,
    stdio:'pipe',
  });
});

test('30-sided initiative rerolls ties and picks the higher player', async () => {
  const rules = await import(rulesUrl.href);
  assert.deepEqual(rules.rollInitiative(sequence([29, 29, 4, 18])), {
    rolls:[{ a:29, b:29 }, { a:4, b:18 }],
    first:'b',
  });
});

test('snapshot normalization drops unknown fields and clamps combat values', async () => {
  const rules = await import(rulesUrl.href);
  assert.deepEqual(rules.normalizeSnapshot({
    ...fighter('student-a'),
    maxHp:9999999,
    hp:-4,
    attack:999999,
    password:'secret',
    skills:{ warrior_basic_strike:99, hacked_skill:1 },
  }), {
    userId:'student-a',
    name:'STUDENT-A',
    level:10,
    className:'warrior',
    spec:'무기',
    maxHp:100000,
    hp:0,
    shield:0,
    attack:10000,
    defense:10,
    skills:{ warrior_basic_strike:1 },
    cooldowns:{},
    statuses:{ stun:0, chill:0, shadow:0 },
  });
});

test('both players receive the same question while the private answer stays server-side', async () => {
  const rules = await import(rulesUrl.href);
  const picked = rules.selectQuestion([
    { enabled:true, questions:[
      { id:'q1', prompt:'2 + 3 = ?', answer:'5', choices:['4', '5', '6'] },
    ] },
  ], sequence([0]));
  assert.equal(rules.judgeAnswer(picked, ' 5 '), true);
  assert.equal(rules.judgeAnswer(picked, '4'), false);
  assert.deepEqual(rules.publicQuestion(picked), {
    id:'q1',
    prompt:'2 + 3 = ?',
    choices:['4', '5', '6'],
  });
});

test('wrong answers deal half damage and first-strike KO cancels the second action', async () => {
  const rules = await import(rulesUrl.href);
  const resolved = rules.resolveRound({
    match:{ id:'match-1', round:1 },
    a:{ player:fighter('a', { attack:100 }), actionId:'warrior_basic_strike', correct:false },
    b:{ player:fighter('b', { hp:50, attack:100 }), actionId:'warrior_basic_strike', correct:true },
    randomInt:sequence([30, 1, 100, 100]),
  });
  const damageEvents = resolved.events.filter((event) => event.kind === 'damage');
  assert.equal(resolved.initiative.first, 'a');
  assert.equal(damageEvents.length, 1);
  assert.equal(damageEvents[0].source, 'a');
  assert.equal(damageEvents[0].amount, 50);
  assert.equal(damageEvents[0].requestedAmount, 85);
  assert.equal(resolved.state.b.hp, 0);
});

test('shield absorbs damage before HP and effects are assigned stable event ids', async () => {
  const rules = await import(rulesUrl.href);
  const resolved = rules.resolveRound({
    match:{ id:'match-2', round:3 },
    a:{ player:fighter('a', { attack:50 }), actionId:'basic', correct:true },
    b:{ player:fighter('b', { shield:30 }), actionId:'basic', correct:true },
    randomInt:sequence([20, 10, 100, 100]),
  });
  assert.equal(resolved.state.b.shield, 0);
  assert.equal(resolved.state.b.hp, 190);
  assert.equal(resolved.events[0].id, 'match-2:3:0');
  assert.equal(resolved.events[0].absorbed, 30);
});
