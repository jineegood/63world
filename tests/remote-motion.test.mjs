import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');

function loadApi() {
  const window = {};
  const source = fs.readFileSync(path.join(root, 'src/remote-motion.js'), 'utf8');
  vm.runInNewContext(source, { window }, { filename:'src/remote-motion.js' });
  return window.YuksamRemoteMotion;
}

test('nothing is drawn before the first position arrives', () => {
  const motion = loadApi().create();
  assert.equal(motion.sample(1000), null);
});

test('the first position appears immediately without sliding in', () => {
  const motion = loadApi().create();
  motion.push(100, 200, 1000);
  const at = motion.sample(1000);
  assert.equal(at.x, 100);
  assert.equal(at.y, 200);
  assert.equal(at.moving, false);
});

test('a later position is filled in smoothly instead of jumping', () => {
  const motion = loadApi().create();
  motion.push(0, 0, 1000);
  motion.push(220, 0, 1220);

  const start = motion.sample(1220);
  assert.equal(Math.round(start.x), 0);

  const middle = motion.sample(1330);
  assert.ok(middle.x > 80 && middle.x < 140, `중간 위치가 어긋남: ${middle.x}`);
  assert.equal(middle.moving, true);

  const end = motion.sample(1440);
  assert.equal(Math.round(end.x), 220);
  assert.equal(end.moving, false);
});

test('the drawn position never overshoots the last known point', () => {
  const motion = loadApi().create();
  motion.push(0, 0, 1000);
  motion.push(100, 0, 1220);
  const late = motion.sample(9000);
  assert.equal(late.x, 100);
  assert.equal(late.moving, false);
});

test('a portal jump snaps instead of gliding across the map', () => {
  const api = loadApi();
  const motion = api.create();
  motion.push(0, 0, 1000);
  motion.push(api.SNAP_DISTANCE + 50, 0, 1220);
  const at = motion.sample(1230);
  assert.equal(at.x, api.SNAP_DISTANCE + 50);
  assert.equal(at.moving, false);
});

test('an explicit snap request moves at once even over a short distance', () => {
  const motion = loadApi().create();
  motion.push(0, 0, 1000);
  motion.push(40, 0, 1220, { snap:true });
  assert.equal(motion.sample(1225).x, 40);
});

test('a long network gap is capped so the character does not crawl', () => {
  const api = loadApi();
  const motion = api.create();
  motion.push(0, 0, 1000);
  motion.push(50, 0, 1100);
  // 5초 끊긴 뒤 도착한 위치도 MAX_STEP_MS 안에 따라잡는다
  motion.push(100, 0, 6100);
  const caughtUp = motion.sample(6100 + api.MAX_STEP_MS);
  assert.equal(Math.round(caughtUp.x), 100);
});

test('a very fast burst still uses a sane minimum duration', () => {
  const api = loadApi();
  const motion = api.create();
  motion.push(0, 0, 1000);
  motion.push(10, 0, 1005);
  const midway = motion.sample(1005 + Math.round(api.MIN_STEP_MS / 2));
  assert.ok(midway.x > 0 && midway.x < 10, `최소 보간 시간이 지켜지지 않음: ${midway.x}`);
});

test('broken coordinates are ignored rather than blanking the character', () => {
  const motion = loadApi().create();
  motion.push(70, 80, 1000);
  motion.push(Number.NaN, 10, 1220);
  motion.push(undefined, undefined, 1300);
  const at = motion.sample(1400);
  assert.equal(at.x, 70);
  assert.equal(at.y, 80);
});

test('diagonal movement interpolates both axes together', () => {
  const motion = loadApi().create();
  motion.push(0, 0, 1000);
  motion.push(200, 100, 1220);
  const middle = motion.sample(1330);
  assert.ok(middle.x > 70 && middle.x < 130, `x 보간 어긋남: ${middle.x}`);
  assert.ok(middle.y > 35 && middle.y < 65, `y 보간 어긋남: ${middle.y}`);
});
