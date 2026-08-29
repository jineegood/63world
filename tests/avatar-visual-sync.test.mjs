import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

function loadVisualSync() {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('src/avatar-visual-sync.js'), sandbox);
  return sandbox.YuksamAvatarVisualSync;
}

test('authoritative weapon tier becomes an explicit sprite style', () => {
  const visuals = loadVisualSync();
  const tiers = [
    { name:'normal', cls:'tier-0', color:'#ccc' },
    { name:'fine', cls:'tier-1', color:'#0f0' },
    { name:'rare', cls:'tier-2', color:'#00f' },
    { name:'hero', cls:'tier-3', color:'#a0f' },
    { name:'legend', cls:'tier-4', color:'#fc0' },
  ];
  const style = visuals.weaponTierStyleFor({
    klass:'mage',
    equipment:{ weapon:'staff_1' },
    weaponTier:3,
  }, tiers);

  assert.equal(style.weaponId, 'staff_1');
  assert.equal(style.tier, 3);
  assert.equal(style.color, '#a0f');
  assert.equal(style.intensity, 0.6);
});

test('sprite state never borrows the viewing browser player upgrade', () => {
  const visuals = loadVisualSync();
  const state = visuals.spriteStateFor({
    klass:'warrior',
    equipment:{ weapon:'sword_1' },
    costume:{ head:'cap' },
    weaponTier:4,
  }, { moving:true });

  assert.equal(state.moving, true);
  assert.equal(state.weaponTierStyle.tier, 4);
  assert.deepEqual({ ...state.equipment }, { weapon:'sword_1' });
  assert.deepEqual({ ...state.costume }, { head:'cap' });
});

test('pet position is deterministic from the shared side and wall-clock time', () => {
  const visuals = loadVisualSync();
  const input = {
    ownerX:500,
    ownerY:700,
    side:'right',
    moving:true,
    dancing:false,
    bob:2,
    now:123456789,
  };
  const first = visuals.petWorldPosition(input);
  const second = visuals.petWorldPosition(input);

  assert.deepEqual(first, second);
  assert.equal(first.x, 554);
  assert.equal(visuals.petSideFromFacing('right', { x:0, y:-1 }), 'right');
  assert.equal(visuals.petSideFromFacing('right', { x:1, y:0 }), 'left');
});

test('raid and realtime player renderers carry the same profile visuals', () => {
  const raidUi = read('src/raid-run-ui.js');
  const raidRun = read('src/raid-run.js');
  const multiplayer = read('src/multiplayer.js');
  const profile = read('supabase/functions/_shared/pvp-profile.mjs');
  const html = read('index.html');

  assert.match(profile, /activePet,\s*\n\s*weaponTier,/);
  assert.match(raidUi, /weaponTier:Math\.max\([\s\S]*?profile\.weaponTier/);
  assert.match(raidRun, /weaponTier:Math\.max/);
  assert.match(raidUi, /raidSpriteState\(member/);
  assert.match(multiplayer, /activePet:[\s\S]*?petSide,[\s\S]*?weaponTier:/);
  assert.match(multiplayer, /function remoteSpriteState\(remote, moving\)[\s\S]*?spriteStateFor\([\s\S]*?weaponTier:remote\.weaponTier/);
  assert.match(multiplayer, /const spriteState = remoteSpriteState\(p, moving\)/);
  assert.doesNotMatch(multiplayer, /fillText\(pet\.name/);
  assert.ok(
    html.indexOf('src/avatar-visual-sync.js') < html.indexOf('src/raid-run-ui.js'),
    'avatar visual sync must load before the raid UI',
  );
});
