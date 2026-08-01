import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync as readFileRaw, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const readFileSync = (path, options) => readFileRaw(path, options).replace(/\r\n/g, '\n');
const hallSource = readFileSync(join(root, 'src', 'hall-of-fame.js'), 'utf8');

/* 명예의 전당은 서버가 내려 준 값만 그린다.
   서버 함수가 무기 강화·펫을 빼먹으면 화면에서도 보이지 않는다. */
function latestHallOfFameSql() {
  const dir = join(root, 'supabase', 'migrations');
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  let latest = '';
  for (const name of files) {
    const sql = readFileSync(join(dir, name), 'utf8');
    if (/create or replace function public\.load_hall_of_fame_v2/.test(sql)) latest = sql;
  }
  return latest;
}

test('명예의 전당 서버 함수가 무기 강화 등급을 함께 내려 준다', () => {
  const sql = latestHallOfFameSql();
  assert.notEqual(sql, '', 'load_hall_of_fame_v2 마이그레이션을 찾지 못했다');
  assert.match(sql, /'weaponUpgrades'/, '무기 강화 정보가 빠지면 색이 보이지 않는다');
});

test('명예의 전당 서버 함수가 장착 펫을 함께 내려 준다', () => {
  const sql = latestHallOfFameSql();
  assert.match(sql, /'activePet'/, '펫 정보가 빠지면 펫이 보이지 않는다');
});

test('명예의 전당이 무기 강화 등급을 그리기에 넘긴다', () => {
  assert.match(hallSource, /weaponTierStyle: call\('getEquippedWeaponTierStyle'\)/);
});

test('명예의 전당이 장착 펫을 캐릭터 옆에 그린다', () => {
  assert.match(hallSource, /function drawPetBeside\(/);
  assert.match(hallSource, /PET_DEFS_V27/);
  // 캐릭터를 그리기 전에 펫을 먼저 그려 뒤쪽에 놓는다.
  const order = hallSource.indexOf('drawPetBeside(ctx, canvas, p, rank');
  const drawPlayer = hallSource.indexOf('draw(ctx, canvas.width / 2');
  assert.ok(order > -1 && drawPlayer > -1 && order < drawPlayer,
    '펫은 캐릭터보다 먼저 그려야 겹칠 때 자연스럽다');
  // 전설 펫은 눈에 띄게 표시한다.
  assert.match(hallSource, /pet\.legendary/);
});
