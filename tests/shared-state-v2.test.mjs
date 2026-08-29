import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const defaultBooks = [{ id:'default', name:'기본', zone:'silent_forest', subject:'수학', prompt:'기본', enabled:true, createdAt:1, questions:[] }];

function storage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem:k => map.get(k) ?? null, setItem:(k,v) => map.set(k, String(v)), removeItem:k => map.delete(k), map };
}

function loadApi() {
  const file = path.join(root, 'src/shared-state-v2.js');
  assert.ok(fs.existsSync(file), 'src/shared-state-v2.js must exist');
  const window = {};
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { window }, { filename:'src/shared-state-v2.js' });
  return window.YuksamSharedStateV2;
}

function setup(rows = {}, errors = {}) {
  const calls = [];
  const store = storage();
  const client = {
    from(table) {
      calls.push(['from', table]);
      return {
        select(columns) { calls.push(['select', columns]); return { eq(column, key) { calls.push(['eq', column, key]); return { async maybeSingle() {
          return { data:rows[key] ? { data:rows[key] } : null, error:errors[key] || null };
        } }; } }; },
        async upsert(payload, options) { calls.push(['upsert', payload, options]); return { error:errors.upsert || null }; },
      };
    },
  };
  return { calls, store, client };
}

test('remote classroom and workbooks are validated, frozen, and cached only under v2 keys', async () => {
  const remote = setup({
    classroom_settings:{ version:1, serverOpen:false, password:'hidden' },
    workbooks:{ version:1, items:[{ id:'wb1', name:'수학', zone:'silent_forest', subject:'수학', prompt:'연산', enabled:true, createdAt:1,
      questions:[{ id:'q1', workbookId:'wb1', zone:'silent_forest', q:'1+1?', answer:'2', choices:['1','2'], source:'교사', access_token:'hidden' }] }] },
  });
  const service = loadApi().create({ client:remote.client, storage:remote.store, defaultWorkbooks:defaultBooks });
  assert.equal((await service.refreshClassroomSettings()).serverOpen, false);
  const books = (await service.refreshWorkbooks()).workbooks;
  assert.equal(books[0].questions[0].q, '1+1?');
  assert.equal(Object.isFrozen(books), true);
  assert.doesNotMatch(JSON.stringify(books), /password|token|hidden/i);
  assert.equal(remote.store.map.has('ysb_shared_v2_classroom_settings'), true);
  assert.equal(remote.store.map.has('ysb_shared_v2_workbooks'), true);
  for (const legacy of ['ysb_teacher_v1','ysb_workbooks_v3','ysb_questions_v2']) assert.equal(remote.store.map.has(legacy), false);
});

test('network failure uses a verified cache but never unverified defaults', async () => {
  const failed = setup({}, { classroom_settings:new Error('Failed to fetch'), workbooks:new Error('Failed to fetch') });
  const service = loadApi().create({ client:failed.client, storage:failed.store, defaultWorkbooks:defaultBooks });
  assert.equal((await service.refreshClassroomSettings()).source, 'default');
  assert.equal((await service.refreshClassroomSettings()).serverOpen, true);
  await assert.rejects(service.refreshWorkbooks(), (error) => error.code === 'OFFLINE');

  const cachedBooks = [{ ...defaultBooks[0], id:'cached', name:'서버에서 확인한 문제집' }];
  const cached = setup({}, { workbooks:new Error('Failed to fetch') });
  cached.store.setItem('ysb_shared_v2_workbooks', JSON.stringify({ version:1, items:cachedBooks }));
  const cachedService = loadApi().create({ client:cached.client, storage:cached.store, defaultWorkbooks:defaultBooks });
  const cachedResult = await cachedService.refreshWorkbooks();
  assert.equal(cachedResult.source, 'cache');
  assert.equal(cachedResult.offline, true);
  assert.equal(cachedResult.workbooks[0].id, 'cached');

  const denied = setup({}, { classroom_settings:{ code:'42501', message:'permission denied' } });
  await assert.rejects(loadApi().create({ client:denied.client, storage:denied.store, defaultWorkbooks:defaultBooks }).refreshClassroomSettings(),
    (error) => error.code === 'FORBIDDEN');
});

test('an online workbook query returning zero rows fails closed instead of loading bundled questions', async () => {
  const remote = setup();
  const service = loadApi().create({ client:remote.client, storage:remote.store, defaultWorkbooks:defaultBooks });

  await assert.rejects(service.refreshWorkbooks(), (error) => error.code === 'LOAD_FAILED');
  assert.equal(service.getWorkbooks()[0].id, 'default');
  assert.equal(remote.store.map.has('ysb_shared_v2_workbooks'), false);
});

test('teacher writes exact fixed rows only after complete validation', async () => {
  const remote = setup();
  const service = loadApi().create({ client:remote.client, storage:remote.store, defaultWorkbooks:defaultBooks });
  await service.setServerOpen(false);
  await service.saveWorkbooks(defaultBooks);
  const writes = remote.calls.filter(([name]) => name === 'upsert');
  assert.deepEqual(JSON.parse(JSON.stringify(writes[0].slice(1))), [
    { key:'classroom_settings', data:{ version:1, serverOpen:false } }, { onConflict:'key' },
  ]);
  assert.equal(writes[1][1].key, 'workbooks');
  await assert.rejects(service.saveWorkbooks(Array.from({ length:51 }, (_, i) => ({ ...defaultBooks[0], id:`w${i}` }))),
    (error) => error.code === 'INVALID_SHARED_STATE');
});

test('a successful remote workbook save stays successful when browser cache writes fail', async () => {
  const remote = setup();
  const unavailableCache = {
    getItem() { return null; },
    setItem() { throw new Error('quota unavailable'); },
  };
  const service = loadApi().create({ client:remote.client, storage:unavailableCache, defaultWorkbooks:defaultBooks });
  const next = [...defaultBooks, { ...defaultBooks[0], id:'saved-without-cache', name:'캐시 없이 저장' }];

  await service.saveWorkbooks(next);

  assert.equal(service.getWorkbooks().length, 2);
  assert.equal(service.getWorkbooks()[1].id, 'saved-without-cache');
  assert.equal(remote.calls.filter(([name]) => name === 'upsert').length, 1);
});

test('local workbook preparation updates memory without writing cache or cloud', () => {
  const remote = setup();
  const service = loadApi().create({ client:remote.client, storage:remote.store, defaultWorkbooks:defaultBooks });
  const prepared = JSON.parse(JSON.stringify(service.getWorkbooks()));
  prepared.push({ ...defaultBooks[0], id:'prepared', name:'준비 문제집' });

  service.setLocalWorkbooks(prepared);

  assert.equal(service.getWorkbooks().length, 2);
  assert.equal(service.getWorkbooks()[1].id, 'prepared');
  assert.equal(Object.isFrozen(service.getWorkbooks()), true);
  assert.equal(remote.calls.some(([name]) => name === 'upsert'), false);
  assert.equal(remote.store.map.size, 0);
});

test('polling installs one 15000ms timer, reports changes, and cancels once', async () => {
  const remote = setup({ classroom_settings:{ version:1, serverOpen:true }, workbooks:{ version:1, items:defaultBooks } });
  const scheduled = [];
  const cancelled = [];
  const service = loadApi().create({
    client:remote.client, storage:remote.store, defaultWorkbooks:defaultBooks,
    schedule(fn, ms) { scheduled.push([fn, ms]); return 7; },
    cancelSchedule(id) { cancelled.push(id); },
  });
  service.startPolling({});
  service.startPolling({});
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0][1], 15000);
  service.stopPolling();
  assert.deepEqual(cancelled, [7]);
});
