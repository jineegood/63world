import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/production-guard.js'), 'utf8');

function load(hostname) {
  const listeners = new Map();
  const window = { location:{ hostname } };
  const document = {
    addEventListener(type, listener, capture) {
      listeners.set(type, { listener, capture });
    },
  };
  vm.runInNewContext(source, { window, document });
  return { window, listeners };
}

test('guard stays off on local development addresses', () => {
  for (const hostname of ['localhost', '127.0.0.1', '::1']) {
    const { window, listeners } = load(hostname);
    assert.equal(window.__YUKSAM_PRODUCTION_GUARD__.enabled, false);
    assert.equal(listeners.size, 0);
  }
});

test('production guard deters developer shortcuts without swallowing normal keys', () => {
  const { window, listeners } = load('63world.vercel.app');
  assert.equal(window.__YUKSAM_PRODUCTION_GUARD__.enabled, true);
  const keydown = listeners.get('keydown');
  assert.equal(keydown.capture, true);

  const blocked = { key:'F12', preventDefault(){ this.prevented = true; }, stopImmediatePropagation(){ this.stopped = true; } };
  keydown.listener(blocked);
  assert.equal(blocked.prevented, true);
  assert.equal(blocked.stopped, true);

  const normal = { key:'e', preventDefault(){ this.prevented = true; }, stopImmediatePropagation(){ this.stopped = true; } };
  keydown.listener(normal);
  assert.equal(normal.prevented, undefined);
  assert.equal(normal.stopped, undefined);
});

test('context menu is hidden but event propagation remains available for PVP', () => {
  const { listeners } = load('63world.vercel.app');
  const contextmenu = listeners.get('contextmenu');
  const event = { preventDefault(){ this.prevented = true; } };
  contextmenu.listener(event);
  assert.equal(event.prevented, true);
  assert.equal(typeof event.stopPropagation, 'undefined');
  assert.doesNotMatch(source, /contextmenu[\s\S]{0,120}stopPropagation/);
});
