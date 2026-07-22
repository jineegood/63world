import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const read = (file) => readFileSync(join(root, file), 'utf8');

test('required runtime files exist with expected baseline size', () => {
  const files = [
    ['index.html', 6000],
    ['style.css', 80000],
    ['game.js', 583743],
    ['schema.sql', 5000],
  ];

  for (const [file, minBytes] of files) {
    const fullPath = join(root, file);
    assert.equal(existsSync(fullPath), true, `${file} should exist`);
    assert.ok(statSync(fullPath).size >= minBytes, `${file} should keep its baseline scale`);
  }
});

test('game.js passes JavaScript syntax check', () => {
  const result = spawnSync(process.execPath, ['--check', 'game.js'], {
    cwd: root,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('default runner covers every production script and standalone unit suite', () => {
  const html = read('index.html');
  const runner = read('tools/run-baseline.ps1');
  const scripts = [...html.matchAll(/<script\s+src=["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter((src) => !/^https?:\/\//i.test(src));

  for (const script of scripts) {
    assert.ok(runner.includes(`'${script}'`), `${script} should be syntax checked by the default runner`);
  }
  assert.ok(runner.includes("'tests/audio-manifest.test.mjs'"));
  assert.ok(runner.includes("'tests/weapon-tier.test.mjs'"));
});

test('index.html keeps core static game contracts', () => {
  const html = read('index.html');

  assert.match(html, /<html lang="ko">/);
  assert.match(html, /<link rel="stylesheet" href="style\.css"/);
  assert.match(html, /<script src="game\.js"><\/script>/);
  assert.match(html, /id="studentLoginBtn"/);
  assert.match(html, /id="createCharacterBtn"/);
  assert.match(html, /id="gameCanvas"/);
  assert.match(html, /id="modalContent"/);
});

test('referenced asset files exist', () => {
  const sources = ['index.html', 'style.css', 'game.js', 'src/audio-manifest.js'].map(read).join('\n');
  const assetRefs = [...sources.matchAll(/['"](assets\/[^'"]+)['"]/g)]
    .map((match) => normalize(match[1]))
    .filter((value, index, array) => array.indexOf(value) === index)
    .sort();

  assert.ok(assetRefs.length >= 8, 'expected several asset references in source files');

  for (const assetRef of assetRefs) {
    assert.equal(existsSync(join(root, assetRef)), true, `${assetRef} should exist`);
  }
});

test('known patch chain remains explicit before refactoring', () => {
  const js = read('game.js');
  const patches = [...js.matchAll(/yuksamV(\d+)Patch/g)]
    .map((match) => Number(match[1]))
    .filter((value, index, array) => array.indexOf(value) === index)
    .sort((a, b) => a - b);

  // [v38 갱신] 행동형 튜토리얼 퀘스트/보상 아이템 패치(yuksamV38Patch) 추가.
  assert.deepEqual(patches, [17, 19, 20, 21, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 38]);
});

test('living specialization cards state the approved balance identities', () => {
  const js = read('game.js');
  const specMetaStart = js.indexOf('const SPEC_META_V37 = {');
  const specMetaEnd = js.indexOf('const cards = specs.map', specMetaStart);
  const specMeta = js.slice(specMetaStart, specMetaEnd);

  assert.ok(specMetaStart >= 0 && specMetaEnd > specMetaStart, 'SPEC_META_V37 should be the live specialization-card copy');
  assert.match(specMeta, /치명타 확률 최대 45% · 스킬 치명타 피해 최대 300%/);
  assert.match(specMeta, /신성[^\n]*흡수형 전투/);
});

test('core game markers remain present', () => {
  const js = read('game.js');
  const dataJs = read('src/game-data.js');
  const runtimeSources = `${dataJs}\n${js}`;
  const markers = [
    'const CLASS_META',
    'const XP_REQUIREMENTS',
    'const ITEM_DEFS',
    'const SKILL_DEFS',
    'const worldDefs',
    'function createNewPlayer',
    'function updateHud',
    'function openCombat',
    'function startGame',
    'function bindEvents',
    "document.title = '63월드'",
  ];

  for (const marker of markers) {
    assert.ok(runtimeSources.includes(marker), `${marker} should remain present`);
  }
});
