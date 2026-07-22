import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
  };
}

function loadFactory() {
  const source = fs.readFileSync(path.join(root, 'src/player-store.js'), 'utf8');
  const window = {};
  vm.runInNewContext(source, { window }, { filename:'src/player-store.js' });
  return window.YuksamPlayerStore;
}

function createStore(storage = memoryStorage()) {
  return loadFactory().create({
    storage,
    prefix:'ysb_player_',
    normalizePlayer:(player) => ({ ...player, normalized:true }),
  });
}

test('trimmed names produce one stable account key', () => {
  const store = createStore();
  assert.equal(store.key('  학생  '), 'ysb_player_학생');
});

test('read distinguishes absent, valid, and corrupt records without rewriting raw bytes', () => {
  const storage = memoryStorage({
    ysb_player_valid:JSON.stringify({ name:'valid', gold:3 }),
    ysb_player_broken:'{broken-json',
    ysb_player_array:'[]',
  });
  const store = createStore(storage);

  assert.equal(JSON.stringify(store.read('missing')), JSON.stringify({ status:'absent', player:null, raw:null }));
  const valid = store.read('valid');
  assert.equal(valid.status, 'valid');
  assert.equal(valid.player.normalized, true);
  assert.equal(valid.raw, JSON.stringify({ name:'valid', gold:3 }));
  assert.equal(JSON.stringify(store.read('broken')), JSON.stringify({ status:'corrupt', player:null, raw:'{broken-json' }));
  assert.equal(JSON.stringify(store.read('array')), JSON.stringify({ status:'corrupt', player:null, raw:'[]' }));
  assert.equal(storage.getItem('ysb_player_broken'), '{broken-json');
});

test('load returns only normalized valid players', () => {
  const store = createStore(memoryStorage({
    ysb_player_ok:'{"name":"ok"}',
    ysb_player_bad:'null',
  }));
  assert.equal(store.load('ok').normalized, true);
  assert.equal(store.load('bad'), null);
  assert.equal(store.load('missing'), null);
});

test('write persists the supplied record exactly without normalizing or mutating it', () => {
  const storage = memoryStorage();
  const store = createStore(storage);
  const player = { name:'  학생  ', pets:['owl'], updatedAt:12 };
  assert.equal(store.write(player), true);
  assert.equal(storage.getItem('ysb_player_학생'), JSON.stringify(player));
  assert.deepEqual(player, { name:'  학생  ', pets:['owl'], updatedAt:12 });
});

test('remove targets only the trimmed account key', () => {
  const storage = memoryStorage({ ysb_player_a:'{}', ysb_player_b:'{}' });
  const store = createStore(storage);
  store.remove(' a ');
  assert.equal(storage.getItem('ysb_player_a'), null);
  assert.equal(storage.getItem('ysb_player_b'), '{}');
});

test('list returns normalized valid player records and skips foreign or corrupt values', () => {
  const storage = memoryStorage({
    foreign:'{"name":"foreign"}',
    ysb_player_a:'{"name":"a"}',
    ysb_player_b:'{bad',
    ysb_player_c:'[]',
  });
  assert.equal(createStore(storage).list().map((player) => player.name).join(','), 'a');
});

test('factory validates dependencies and lets storage failures surface', () => {
  const api = loadFactory();
  assert.throws(() => api.create({}), /storage/);
  const brokenStorage = {
    get length() { return 0; }, key() { return null; },
    getItem() { throw new Error('storage blocked'); },
    setItem() { throw new Error('storage blocked'); }, removeItem() {},
  };
  const store = api.create({ storage:brokenStorage, prefix:'p_', normalizePlayer:(p) => p });
  assert.throws(() => store.read('a'), /storage blocked/);
  assert.throws(() => store.write({ name:'a' }), /storage blocked/);
});

test('production routes player storage and administrator writes through one boundary', () => {
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const game = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
  const admin = fs.readFileSync(path.join(root, 'src/admin-dashboard.js'), 'utf8');

  assert.match(index, /src\/player-store\.js/);
  assert.ok(index.indexOf('src/player-store.js') < index.indexOf('game.js'));
  assert.match(game, /YuksamPlayerStore\.create/);
  assert.doesNotMatch(game, /localStorage\.(?:getItem|setItem|removeItem)\(playerKey/);
  assert.doesNotMatch(game, /localStorage\.(?:length|key\()/);
  assert.doesNotMatch(admin, /localStorage\.setItem\(playerKey/);
  assert.equal((admin.match(/savePlayerRecord\(p\)/g) || []).length, 2);
});
