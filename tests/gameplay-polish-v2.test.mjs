import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');

function loadApi() {
  const file = path.join(root, 'src/gameplay-polish-v2.js');
  assert.ok(fs.existsSync(file), 'src/gameplay-polish-v2.js must exist');
  const window = {};
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { window }, { filename:'src/gameplay-polish-v2.js' });
  return window.YuksamGameplayPolishV2;
}

test('death experience is protected before specialization and halved afterward', () => {
  const api = loadApi();
  assert.equal(api.deathExperience({ currentExp:145, levelStartExp:100, hasSpecialization:false }), 145);
  assert.equal(api.deathExperience({ currentExp:145, levelStartExp:100, hasSpecialization:true }), 123);
});

test('normal mushroom attack and slime hp are tuned without changing elites or input', () => {
  const api = loadApi();
  const mushroom = { type:'mushroom', attack:5, hp:10, maxHp:10, elite:false };
  const slime = { type:'slime', attack:4, hp:20, maxHp:20, elite:false };
  const elite = { type:'slime', attack:8, hp:40, maxHp:40, elite:true };
  assert.deepEqual({ ...api.tuneNormalMonster(mushroom) }, { ...mushroom, attack:4 });
  assert.deepEqual({ ...api.tuneNormalMonster(slime) }, { ...slime, hp:22, maxHp:22 });
  assert.equal(api.tuneNormalMonster(elite).maxHp, 40);
  assert.equal(mushroom.attack, 5);
  assert.equal(slime.maxHp, 20);
});

test('wrong answer damage is half with a minimum of one', () => {
  const api = loadApi();
  assert.equal(api.wrongHitDamage(9), 4);
  assert.equal(api.wrongHitDamage(1), 1);
  assert.equal(api.wrongHitDamage(0), 0);
});

test('costume tutorial compatibility requires every shop costume, not merely one', () => {
  const api = loadApi();
  assert.equal(api.ownsAllCostumes(['hat'], ['hat', 'cape']), false);
  assert.equal(api.ownsAllCostumes(['hat', 'cape'], ['hat', 'cape']), true);
  assert.equal(api.ownsAllCostumes([], []), false);
});

test('reward steps use fixed dramatic timing and omit empty optional rewards', () => {
  const api = loadApi();
  const simplify = (steps) => Array.from(steps, ({ kind, amount, delayMs, durationMs, tone, sfx }) => ({
    kind, amount, delayMs, durationMs, tone, sfx,
  }));
  assert.deepEqual(simplify(api.rewardSteps({ exp:5, gold:4, building:1 })), [
    { kind:'exp', amount:5, delayMs:0, durationMs:1000, tone:'exp', sfx:'quest' },
    { kind:'gold', amount:4, delayMs:1000, durationMs:1000, tone:'gold', sfx:'coin' },
    { kind:'building', amount:1, delayMs:2000, durationMs:1000, tone:'building', sfx:'open' },
  ]);
  assert.deepEqual(simplify(api.rewardSteps({ exp:0, gold:4, building:0 })), [
    { kind:'exp', amount:0, delayMs:0, durationMs:1000, tone:'exp', sfx:'quest' },
    { kind:'gold', amount:4, delayMs:1000, durationMs:1000, tone:'gold', sfx:'coin' },
  ]);
});

test('each hunting map has two frozen healing wells at approved coordinates', () => {
  const api = loadApi();
  const expected = {
    forest:[{ id:'forest-entrance', x:560, y:1780 }, { id:'forest-advanced', x:2100, y:1120 }],
    desert:[{ id:'desert-entrance', x:620, y:1840 }, { id:'desert-advanced', x:2140, y:1180 }],
    swamp:[{ id:'swamp-entrance', x:680, y:1940 }, { id:'swamp-advanced', x:2400, y:1220 }],
  };
  for (const [mapKey, wells] of Object.entries(expected)) {
    const actual = api.getHealingWells(mapKey);
    assert.deepEqual(JSON.parse(JSON.stringify(actual)), wells);
    assert.equal(Object.isFrozen(actual), true);
    assert.equal(actual.every(Object.isFrozen), true);
  }
  assert.deepEqual(Array.from(api.getHealingWells('town')), []);
});
