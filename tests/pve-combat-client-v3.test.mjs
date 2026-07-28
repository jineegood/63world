import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/pve-combat-client-v3.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function harness(responses = []) {
  const calls = [];
  let index = 0;
  const client = {
    functions:{
      async invoke(name, options) {
        calls.push({ name, body:options.body });
        return responses[index++] || { data:{ data:{ ok:true } }, error:null };
      },
    },
  };
  const window = {};
  const crypto = {
    randomUUID:() => '11111111-1111-4111-8111-111111111111',
    getRandomValues:(array) => array.fill(1),
  };
  vm.runInNewContext(source, {
    window,
    crypto,
    setTimeout,
    clearTimeout,
    Date,
    Promise,
    Object,
    Error,
  });
  const api = window.YuksamPveCombatClientV3.create({ client, timeoutMs:1000 });
  return { api, calls };
}

test('combat client sends only bounded action identifiers to the secure endpoint', async () => {
  const { api, calls } = harness();
  await api.start('forest_mushroom');
  await api.submitTurn(
    '22222222-2222-4222-8222-222222222222',
    2,
    'basic',
    '4',
  );
  await api.surrender(3);
  await api.resume();
  await api.startHealing(7);
  await api.submitHealing(
    '33333333-3333-4333-8333-333333333333',
    '4',
    7,
  );

  assert.equal(calls.every((call) => call.name === 'student-combat-v3'), true);
  assert.deepEqual(calls.map((call) => call.body.op), [
    'start', 'submit_turn', 'surrender', 'resume', 'start_healing', 'submit_healing',
  ]);
  for (const call of calls) {
    assert.equal('userId' in call.body, false);
    assert.equal('damage' in call.body, false);
    assert.equal('correct' in call.body, false);
    assert.equal('rewards' in call.body, false);
    assert.equal('answerKey' in call.body, false);
  }
  assert.match(calls[0].body.requestId, /^[0-9a-f-]{36}$/i);
  assert.equal(calls[1].body.sessionRevision, 2);
  assert.equal(calls[1].body.answer, '4');
  assert.equal(calls[4].body.expectedRevision, 7);
  assert.equal(calls[5].body.answer, '4');
});

test('duplicate pending submissions share one network request', async () => {
  let release;
  const delayed = new Promise((resolve) => { release = resolve; });
  const calls = [];
  const client = {
    functions:{
      async invoke(name, options) {
        calls.push({ name, body:options.body });
        await delayed;
        return { data:{ data:{ ok:true } }, error:null };
      },
    },
  };
  const window = {};
  vm.runInNewContext(source, {
    window,
    crypto:{ randomUUID:() => '11111111-1111-4111-8111-111111111111' },
    setTimeout,
    clearTimeout,
    Date,
    Promise,
    Object,
    Error,
  });
  const api = window.YuksamPveCombatClientV3.create({ client, timeoutMs:1000 });
  const first = api.submitTurn('22222222-2222-4222-8222-222222222222', 2, 'basic', '4');
  const second = api.submitTurn('22222222-2222-4222-8222-222222222222', 2, 'basic', '4');
  release();
  assert.deepEqual(await first, await second);
  assert.equal(calls.length, 1);
});

test('safe server responses are validated, deeply frozen, and may reveal only correctAnswer', async () => {
  const response = {
    ok:true,
    correct:false,
    correctAnswer:'4',
    session:{
      combatId:'33333333-3333-4333-8333-333333333333',
      monsterKey:'forest_mushroom',
      playerRevision:4,
      sessionRevision:3,
      turnNumber:1,
      status:'active',
      playerHp:20,
      playerMaxHp:22,
      playerShield:0,
      monsterHp:7,
      monsterMaxHp:9,
      monsterAttack:2,
      monsterShield:0,
      playerStatuses:{},
      monsterStatuses:{},
      cooldowns:{},
      question:{
        questionToken:'44444444-4444-4444-8444-444444444444',
        questionId:'q2',
        prompt:'3 + 3 = ?',
        choices:['5', '6'],
      },
    },
    events:[{ type:'answer-wrong', minimumDurationMs:2000 }],
  };
  const { api } = harness([{ data:{ data:response }, error:null }]);
  const result = await api.resume();
  assert.equal(result.correctAnswer, '4');
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.session.question), true);
});

test('answer-key and service-secret fields fail closed anywhere in a response', async () => {
  for (const unsafe of [
    { ok:true, answerKey:'secret' },
    { ok:true, session:{ question:{ answer_key:'secret' } } },
    { ok:true, serviceRoleKey:'secret' },
  ]) {
    const { api } = harness([{ data:{ data:unsafe }, error:null }]);
    await assert.rejects(api.resume(), (error) => error.code === 'UNSAFE_SERVER_RESPONSE');
  }
});

test('network failures are sanitized and retrying can reuse an explicit request id', async () => {
  const requestId = '55555555-5555-4555-8555-555555555555';
  const { api, calls } = harness([
    { data:null, error:{ message:'Failed to fetch: https://private-host/path' } },
    { data:{ data:{ ok:true } }, error:null },
  ]);
  await assert.rejects(
    api.start('forest_mushroom', requestId),
    (error) => error.code === 'COMBAT_NETWORK_ERROR'
      && !error.message.includes('private-host'),
  );
  await api.start('forest_mushroom', requestId);
  assert.equal(calls[0].body.requestId, requestId);
  assert.equal(calls[1].body.requestId, requestId);
});

test('safe combat rejections explain what will happen instead of hiding every cause', async () => {
  const expected = [
    ['MONSTER_MAP_MISMATCH', '몬스터 위치 정보가 달라 전투를 다시 불러옵니다.'],
    ['COMBAT_STATE_MISSING', '전투 기록을 찾지 못해 전투를 안전하게 종료합니다.'],
    ['PLAYER_NOT_FOUND', '캐릭터 정보를 찾지 못했습니다. 다시 로그인해 주세요.'],
    ['UNKNOWN_MONSTER', '몬스터 정보를 찾지 못했습니다.'],
    ['SESSION_REVISION_CONFLICT', '전투 상태가 바뀌었습니다. 최신 상태를 다시 불러옵니다.'],
    ['PLAYER_REVISION_CONFLICT', '캐릭터 상태가 바뀌었습니다. 최신 상태를 다시 불러옵니다.'],
  ];

  for (const [code, message] of expected) {
    const { api } = harness([{ data:{ error:code }, error:{ message:code } }]);
    await assert.rejects(
      api.resume(),
      (error) => error.code === code && error.message === message,
      code,
    );
  }
});

test('client bundle never contains a service-role credential and loads before game', () => {
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|service_role\s*[:=]/i);
  const clientIndex = html.indexOf('src/pve-combat-client-v3.js');
  const accessIndex = html.indexOf('src/student-access-v2.js');
  const gameIndex = html.indexOf('game.js');
  assert.ok(accessIndex >= 0 && accessIndex < clientIndex && clientIndex < gameIndex);
});
