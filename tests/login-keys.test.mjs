import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');

function loadApi(extra = {}) {
  const listeners = [];
  const window = {
    addEventListener:(type, fn) => listeners.push({ type, fn }),
    document:{ getElementById:() => null },
    ...extra,
  };
  const source = fs.readFileSync(path.join(root, 'src/login-keys.js'), 'utf8');
  vm.runInNewContext(source, { window }, { filename:'src/login-keys.js' });
  return { api:window.YuksamLoginKeys, listeners };
}

function fakeDoc(buttons) {
  return { getElementById:(id) => buttons[id] || null };
}

function fakeButton() {
  const button = { disabled:false, clicks:0 };
  button.click = () => { button.clicks += 1; };
  return button;
}

function keyEvent(key, id, options = {}) {
  const event = { key, target:{ id }, prevented:false, ...options };
  event.preventDefault = () => { event.prevented = true; };
  return event;
}

test('enter in the student name box presses the login button', () => {
  const { api } = loadApi();
  const button = fakeButton();
  const result = api.handleKeyDown(keyEvent('Enter', 'loginName'), fakeDoc({ studentLoginBtn:button }));
  assert.equal(result, 'studentLoginBtn');
  assert.equal(button.clicks, 1);
});

test('enter in the password box presses the same login button', () => {
  const { api } = loadApi();
  const button = fakeButton();
  api.handleKeyDown(keyEvent('Enter', 'loginPassword'), fakeDoc({ studentLoginBtn:button }));
  assert.equal(button.clicks, 1);
});

test('enter in the teacher email box presses the teacher login button', () => {
  const { api } = loadApi();
  const button = fakeButton();
  const result = api.handleKeyDown(keyEvent('Enter', 'teacherEmail'), fakeDoc({ teacherLoginBtn:button }));
  assert.equal(result, 'teacherLoginBtn');
  assert.equal(button.clicks, 1);
});

test('a login already in progress is never submitted twice', () => {
  const { api } = loadApi();
  const button = fakeButton();
  button.disabled = true;
  const result = api.handleKeyDown(keyEvent('Enter', 'loginName'), fakeDoc({ studentLoginBtn:button }));
  assert.equal(result, null);
  assert.equal(button.clicks, 0);
});

test('holding enter down does not fire repeatedly', () => {
  const { api } = loadApi();
  const button = fakeButton();
  const result = api.handleKeyDown(keyEvent('Enter', 'loginName', { repeat:true }), fakeDoc({ studentLoginBtn:button }));
  assert.equal(result, null);
  assert.equal(button.clicks, 0);
});

test('enter while composing korean confirms the characters instead of logging in', () => {
  const { api } = loadApi();
  const button = fakeButton();
  const result = api.handleKeyDown(keyEvent('Enter', 'loginName', { isComposing:true }), fakeDoc({ studentLoginBtn:button }));
  assert.equal(result, null);
  assert.equal(button.clicks, 0);
});

test('other keys and other input boxes are left alone', () => {
  const { api } = loadApi();
  const button = fakeButton();
  const doc = fakeDoc({ studentLoginBtn:button });
  assert.equal(api.handleKeyDown(keyEvent('a', 'loginName'), doc), null);
  assert.equal(api.handleKeyDown(keyEvent('Enter', 'chatInput'), doc), null);
  assert.equal(api.handleKeyDown(keyEvent('Enter', 'combatAnswer'), doc), null);
  assert.equal(button.clicks, 0);
});

test('a missing button is handled without throwing', () => {
  const { api } = loadApi();
  assert.equal(api.handleKeyDown(keyEvent('Enter', 'loginName'), fakeDoc({})), null);
});

test('enter is consumed so the browser does not also submit the form', () => {
  const { api } = loadApi();
  const event = keyEvent('Enter', 'loginName');
  api.handleKeyDown(event, fakeDoc({ studentLoginBtn:fakeButton() }));
  assert.equal(event.prevented, true);
});

test('the module registers exactly one keydown listener on load', () => {
  const { listeners } = loadApi();
  assert.equal(listeners.length, 1);
  assert.equal(listeners[0].type, 'keydown');
});
