import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');

function loadApi() {
  const context = vm.createContext({ window:{} });
  vm.runInContext(
    fs.readFileSync(path.join(root, 'src/authority-action-runner-v3.js'), 'utf8'),
    context,
  );
  return context.window.YuksamAuthorityActionRunnerV3;
}

test('disabled runner performs no server action', async () => {
  const api = loadApi();
  let called = false;
  const runner = api.create({
    service:{ async purchaseItem() { called = true; } },
    isEnabled:() => false,
    getRevision:() => 7,
    applySnapshot() {},
  });
  const result = await runner.run('purchaseItem', { itemId:'noviceHat' });
  assert.equal(result.handled, false);
  assert.equal(called, false);
});

test('enabled runner waits for the server before applying authoritative state', async () => {
  const api = loadApi();
  let resolve;
  const events = [];
  const response = { player:{ gold:10 }, revision:8 };
  const runner = api.create({
    service:{
      purchaseItem(input) {
        events.push(['call', JSON.parse(JSON.stringify(input))]);
        return new Promise((done) => { resolve = done; });
      },
    },
    isEnabled:() => true,
    getRevision:() => 7,
    applySnapshot(result) { events.push(['apply', result.revision]); },
  });
  const pending = runner.run('purchaseItem', { itemId:'noviceHat' });
  await Promise.resolve();
  assert.equal(JSON.stringify(events), JSON.stringify([
    ['call', { itemId:'noviceHat', expectedRevision:7 }],
  ]));
  resolve(response);
  const result = await pending;
  assert.equal(JSON.stringify(events), JSON.stringify([
    ['call', { itemId:'noviceHat', expectedRevision:7 }],
    ['apply', 8],
  ]));
  assert.equal(result.handled, true);
});

test('pending keys block duplicate spending and conflicts apply the newest snapshot', async () => {
  const api = loadApi();
  let reject;
  let calls = 0;
  const applied = [];
  const runner = api.create({
    service:{
      enhanceWeapon() {
        calls += 1;
        return new Promise((resolve, fail) => { reject = fail; });
      },
    },
    isEnabled:() => true,
    getRevision:() => 7,
    applySnapshot(result) { applied.push(result.revision); },
  });
  const first = runner.run('enhanceWeapon', {}, { pendingKey:'enhance' });
  const duplicate = await runner.run('enhanceWeapon', {}, { pendingKey:'enhance' });
  assert.equal(duplicate.pending, true);
  assert.equal(calls, 1);
  reject(Object.assign(new Error('conflict'), {
    code:'REVISION_CONFLICT',
    player:{ gold:9 },
    revision:9,
  }));
  await assert.rejects(first, (error) => error.code === 'REVISION_CONFLICT');
  assert.equal(JSON.stringify(applied), JSON.stringify([9]));
  assert.equal(runner.isPending('enhance'), false);
});

