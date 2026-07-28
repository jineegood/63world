import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Script, createContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const source = readFileSync(join(root, 'src', 'authoritative-combat-presentation-v3.js'), 'utf8');

function loadPresenter(options) {
  const context = createContext({ window:{} });
  new Script(source, { filename:'src/authoritative-combat-presentation-v3.js' }).runInContext(context);
  return context.window.YuksamAuthoritativeCombatPresentationV3.create(options);
}

test('server final state waits until the damage presentation has finished', () => {
  const visual = { monsterHp:10, playerHp:12, level:1, exp:0, gold:0 };
  const order = [];
  let finishNotices = null;
  const response = {
    requestId:'turn-1',
    session:{ revision:2, monster:{ hp:5 } },
    player:{ hp:12, level:2, exp:3, gold:7 },
    outcome:'continue',
  };
  const presenter = loadPresenter({
    playNotices:(notices, done) => {
      order.push('notices');
      assert.deepEqual(visual, { monsterHp:10, playerHp:12, level:1, exp:0, gold:0 });
      visual.monsterHp -= notices[0].amount;
      finishNotices = done;
    },
    reconcile:(serverResponse) => {
      order.push('reconcile');
      visual.monsterHp = serverResponse.session.monster.hp;
      Object.assign(visual, {
        playerHp:serverResponse.player.hp,
        level:serverResponse.player.level,
        exp:serverResponse.player.exp,
        gold:serverResponse.player.gold,
      });
    },
    finish:() => order.push('finish'),
  });

  assert.equal(presenter.present({
    response,
    notices:[{ type:'monster-damage', amount:5 }],
  }), true);
  assert.equal(presenter.isPresenting(), true);
  assert.deepEqual(visual, { monsterHp:5, playerHp:12, level:1, exp:0, gold:0 });
  assert.deepEqual(order, ['notices']);

  finishNotices();

  assert.equal(presenter.isPresenting(), false);
  assert.deepEqual(visual, { monsterHp:5, playerHp:12, level:2, exp:3, gold:7 });
  assert.deepEqual(order, ['notices', 'reconcile', 'finish']);
});

test('the same authoritative response is presented only once', () => {
  const order = [];
  const presenter = loadPresenter({
    playNotices:(_notices, done) => {
      order.push('notices');
      done();
    },
    reconcile:() => order.push('reconcile'),
    finish:() => order.push('finish'),
  });
  const turn = {
    response:{ requestId:'turn-duplicate', session:{ revision:4 } },
    notices:[],
  };

  assert.equal(presenter.present(turn), true);
  assert.equal(presenter.present(turn), false);
  assert.deepEqual(order, ['notices', 'reconcile', 'finish']);
});

test('a second response cannot replace one whose presentation is still active', () => {
  let finishFirst = null;
  const presenter = loadPresenter({
    playNotices:(_notices, done) => { finishFirst = done; },
    reconcile:() => {},
    finish:() => {},
  });

  assert.equal(presenter.present({
    response:{ requestId:'turn-active', session:{ revision:5 } },
    notices:[],
  }), true);
  assert.equal(presenter.present({
    response:{ requestId:'turn-too-early', session:{ revision:6 } },
    notices:[],
  }), false);

  finishFirst();
  assert.equal(presenter.isPresenting(), false);
});
