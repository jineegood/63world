import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const read = (file) => readFileSync(join(root, file), 'utf8');
const gameSource = read('game.js');
const indexSource = read('index.html');
const styleSource = read('style.css');

test('weapon tiers suppress tier zero effects and restrain higher tiers by class', () => {
  assert.match(gameSource, /if \(!tierStyle \|\| tierStyle\.tier <= 0\) return;/);
  assert.match(gameSource, /warrior:\s*0\.8/);
  assert.match(gameSource, /mage:\s*0\.6/);
  assert.match(gameSource, /priest:\s*0\.6/);
  assert.match(gameSource, /weaponTierStyle && weaponTierStyle\.tier > 0/);
  assert.match(gameSource, /className:\s*tier > 0 \?/);
  assert.match(styleSource, /--weapon-tier-intensity/);
});

test('DOM weapon cards omit tier zero effects and share class intensity for tiers one through four', () => {
  assert.doesNotMatch(styleSource, /\.tier-0\s*\{/);
  assert.match(gameSource, /function getWeaponTierDomAttrsV33\(itemId\)/);
  assert.match(gameSource, /if \(tier <= 0\) return null;/);
  assert.match(gameSource, /weapon-tier-equipped \$\{tierStyle\.className\} weapon-tier-intensity-\$\{game\.player\.class\}/);
  assert.match(gameSource, /--weapon-tier-intensity:\$\{tierStyle\.intensity\}/);

  const characterPanel = gameSource.slice(
    gameSource.indexOf('function openCharacterPanelV33'),
    gameSource.indexOf('function openUpgradeShopModalV33'),
  );
  const upgradePanel = gameSource.slice(gameSource.indexOf('function openUpgradeShopModalV33'));
  assert.match(characterPanel, /getWeaponTierDomAttrsV33\(item\.id\)/);
  assert.doesNotMatch(characterPanel, /tierClassV33\(tier\)/);
  assert.match(upgradePanel, /getWeaponTierDomAttrsV33\(item\.id\)/);
});

test('guardian aura renders as a foot ring behind the character sprite', () => {
  const drawPlayerSprite = gameSource.slice(
    gameSource.indexOf('function drawPlayerSprite'),
    gameSource.indexOf('function drawSpecOrbit'),
  );
  assert.match(drawPlayerSprite, /ctx\.ellipse\(x, y \+ 28 \* scale/);
  assert.match(drawPlayerSprite, /ctx\.stroke\(\)/);
  assert.doesNotMatch(drawPlayerSprite, /createRadialGradient/);
  assert.ok(
    drawPlayerSprite.indexOf('ctx.ellipse') < drawPlayerSprite.indexOf('drawHumanoid'),
    'the foot ring must draw before the sprite',
  );
});

test('transient zone banners are absent while ordinary cinematics and the HUD map name remain', () => {
  assert.equal(existsSync(join(root, 'src/zone-banner.js')), false);
  assert.doesNotMatch(indexSource, /src\/zone-banner\.js/);
  assert.doesNotMatch(gameSource, /zone-entry/);
  assert.doesNotMatch(styleSource, /\.cinematic-overlay\.zone-entry/);
  assert.match(gameSource, /function showCinematicMessage\(title, sub = '', ms = 1200\) \{/);
  assert.match(gameSource, /\$\('zoneBadge'\)\.textContent = worldDefs\[game\.currentMap\]\.label;/);
  assert.match(indexSource, /<div id="zoneBadge" class="zone-badge">63마을<\/div>/);
});
