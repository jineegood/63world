import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const game = fs.readFileSync(path.join(root, 'game.js'), 'utf8');

/* 오른쪽 클릭 프로필의 얼굴이 동그라미 밖으로 밀려나 보이지 않던 것을 막는다. */

function headOffsetUnits() {
  const declared = game.match(/const PORTRAIT_HEAD_OFFSET_UNITS = (\d+);/);
  assert.ok(declared, '머리 위치 상수를 찾지 못했습니다');
  return Number(declared[1]);
}

test('the portrait offset matches where the sprite actually draws the head', () => {
  // drawPlayerSprite의 머리: ctx.arc(0, -16 * scale, 12 * scale, ...)
  const drawn = game.match(/\/\/ head\s*\n\s*ctx\.fillStyle = skin;\s*\n\s*ctx\.beginPath\(\);\s*\n\s*ctx\.arc\(0, -(\d+) \* scale, (\d+) \* scale/);
  assert.ok(drawn, '스프라이트의 머리 그리는 부분을 찾지 못했습니다');
  assert.equal(
    headOffsetUnits(),
    Number(drawn[1]),
    '스프라이트 머리 위치가 바뀌었는데 프로필 보정값이 따라가지 않았습니다',
  );
});

test('the face lands in the middle of the circle for the profile canvas', () => {
  const scale = Number(game.match(/const portraitScale = ([\d.]+);/)?.[1]);
  assert.ok(Number.isFinite(scale), '초상화 배율을 찾지 못했습니다');
  assert.match(game, /canvas\.height \/ 2 \+ headOffset/);

  // pvp-ui.js가 쓰는 실제 캔버스 크기
  const pvpUi = fs.readFileSync(path.join(root, 'src/pvp-ui.js'), 'utf8');
  const size = Number(pvpUi.match(/id="pvpProfilePortraitV1" width="(\d+)"/)?.[1]);
  assert.ok(Number.isFinite(size), '프로필 캔버스 크기를 찾지 못했습니다');

  // 그려지는 자리를 그대로 계산해 본다
  const anchorY = size / 2 + headOffsetUnits() * scale;
  const headCentreY = anchorY - headOffsetUnits() * scale;
  const headRadius = 12 * scale;
  const circleRadius = Math.min(size, size) / 2 - 4;

  assert.equal(headCentreY, size / 2, '얼굴이 캔버스 한가운데에 오지 않습니다');
  assert.ok(headCentreY - headRadius > 0, '머리 위쪽이 캔버스 밖으로 나갑니다');
  assert.ok(headCentreY + headRadius < size, '머리 아래쪽이 캔버스 밖으로 나갑니다');
  assert.ok(headRadius < circleRadius, '얼굴이 동그라미보다 큽니다');
});

test('the old off-canvas anchor is gone for good', () => {
  assert.doesNotMatch(game, /canvas\.height \+ 48/, '얼굴을 화면 밖으로 밀어내던 예전 계산이 남아 있습니다');
});
