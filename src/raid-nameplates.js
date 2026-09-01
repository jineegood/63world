/* 63-building raid milestone nameplates: definitions, safe normalization, UI, and canvas themes. */
(function initYuksamRaidNameplatesV1(global) {
  'use strict';

  if (global.YuksamRaidNameplatesV1) return;

  const DEFAULT_THEME = 'default';
  const DEFINITIONS = Object.freeze([
    Object.freeze({
      id:'raid_20_steel',
      floorGroup:2,
      floorLabel:'20층',
      questTitle:'[파티] 함께 오른 스무 층',
      name:'강철 승강기 이름표',
      shortName:'강철 승강기',
      description:'차가운 강철판과 주황색 승강기 표시등으로 만든 이름표',
      icon:'▣',
      cssClass:'raid-nameplate-steel-20',
      possessStats:Object.freeze({ 체력:2 }),
    }),
    Object.freeze({
      id:'raid_40_twilight',
      floorGroup:4,
      floorLabel:'40층',
      questTitle:'[파티] 빌딩의 허리를 넘어서',
      name:'황혼의 창 이름표',
      shortName:'황혼의 창',
      description:'보랏빛 창문과 저녁 노을이 겹쳐지는 이중 테두리 이름표',
      icon:'◆',
      cssClass:'raid-nameplate-twilight-40',
      possessStats:Object.freeze({ 체력:3 }),
    }),
    Object.freeze({
      id:'raid_63_summit',
      floorGroup:7,
      floorLabel:'63층',
      questTitle:'[파티] 육삼의 정상',
      name:'육삼 정상 이름표',
      shortName:'육삼의 정상',
      description:'청록빛과 자홍빛 네온, 황금 테두리와 왕관이 빛나는 최종 이름표',
      icon:'♛',
      cssClass:'raid-nameplate-summit-63',
      possessStats:Object.freeze({ 체력:4 }),
    }),
  ]);
  const BY_ID = new Map(DEFINITIONS.map((definition) => [definition.id, definition]));
  const BY_GROUP = new Map(DEFINITIONS.map((definition) => [definition.floorGroup, definition]));

  function escapeHtml(value) {
    if (typeof global.escapeHtml === 'function') return global.escapeHtml(String(value ?? ''));
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function normalizeOwned(value) {
    const input = Array.isArray(value) ? value : [];
    const requested = new Set(input.map((item) => String(item || '')));
    return DEFINITIONS.map((definition) => definition.id).filter((id) => requested.has(id));
  }

  function requestedTheme(source) {
    if (!source || typeof source !== 'object') return DEFAULT_THEME;
    if (source.nameplate && typeof source.nameplate === 'object' && !Array.isArray(source.nameplate)) {
      return String(source.nameplate.theme || DEFAULT_THEME);
    }
    return String(source.nameplateTheme || DEFAULT_THEME);
  }

  function normalizePlayerFields(source = {}) {
    const safeSource = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
    const owned = normalizeOwned(safeSource.raidNameplates ?? safeSource.raid_nameplates);
    const requested = requestedTheme(safeSource);
    const theme = requested === DEFAULT_THEME || owned.includes(requested) ? requested : DEFAULT_THEME;
    return Object.freeze({
      raidNameplates:Object.freeze([...owned]),
      nameplate:Object.freeze({ theme }),
    });
  }

  function rewardForGroup(floorGroup) {
    return BY_GROUP.get(Math.trunc(Number(floorGroup) || 0)) || null;
  }

  function definition(themeId) {
    return BY_ID.get(String(themeId || '')) || null;
  }

  function possessionStats(source = {}) {
    const rawOwned = Array.isArray(source)
      ? source
      : source?.raidNameplates ?? source?.raid_nameplates;
    const total = { 체력:0 };
    normalizeOwned(rawOwned).forEach((id) => {
      const stats = BY_ID.get(id)?.possessStats || {};
      Object.entries(stats).forEach(([key, value]) => {
        const amount = Number(value);
        if (Number.isFinite(amount)) total[key] = (Number(total[key]) || 0) + amount;
      });
    });
    return Object.freeze(total);
  }

  function equip(player, themeId) {
    if (!player || typeof player !== 'object') return false;
    const id = String(themeId || DEFAULT_THEME);
    const owned = normalizeOwned(player.raidNameplates);
    if (id !== DEFAULT_THEME && !owned.includes(id)) return false;
    player.raidNameplates = owned;
    player.nameplate = { theme:id };
    return true;
  }

  function applyServerSnapshot(player, snapshot) {
    if (!player || !snapshot || typeof snapshot !== 'object') return false;
    if (!Object.prototype.hasOwnProperty.call(snapshot, 'raidNameplates')) return false;
    const normalized = normalizePlayerFields({
      raidNameplates:snapshot.raidNameplates,
      nameplate:snapshot.nameplate ?? player.nameplate,
    });
    player.raidNameplates = [...normalized.raidNameplates];
    player.nameplate = { ...normalized.nameplate };
    return true;
  }

  function roleLineFor(player) {
    const classes = { warrior:'전사', mage:'마법사', priest:'성직자' };
    const level = Math.max(1, Math.trunc(Number(player?.level) || 1));
    const spec = player?.spec === '분노' ? '무기' : String(player?.spec || '');
    return `LV.${level} ${spec ? `${spec} ` : ''}${classes[player?.class] || '모험가'}`;
  }

  function previewMarkup(definitionValue, player, { locked = false, equipped = false } = {}) {
    const name = escapeHtml(player?.name || '모험가');
    const roleLine = escapeHtml(roleLineFor(player));
    return `<div class="raid-nameplate-preview-v1 ${definitionValue.cssClass}${locked ? ' locked' : ''}" aria-hidden="true">
      <i>${escapeHtml(definitionValue.icon)}</i>
      <span><b>${name}</b><small>${roleLine}</small></span>
      ${equipped ? '<em>장착 중</em>' : ''}
    </div>`;
  }

  function pickerMarkup(player) {
    const normalized = normalizePlayerFields(player || {});
    const owned = new Set(normalized.raidNameplates);
    const equipped = normalized.nameplate.theme;
    const defaultEquipped = equipped === DEFAULT_THEME;
    const cards = DEFINITIONS.map((entry) => {
      const hasItem = owned.has(entry.id);
      const isEquipped = equipped === entry.id;
      return `<article class="raid-nameplate-card-v1${hasItem ? '' : ' locked'}${isEquipped ? ' equipped' : ''}">
        ${previewMarkup(entry, player, { locked:!hasItem, equipped:isEquipped })}
        <div class="raid-nameplate-card-copy-v1">
          <b>${escapeHtml(entry.name)}</b>
          <p>${escapeHtml(entry.description)}</p>
          <small class="raid-nameplate-stat-v1">보유 효과 · 체력 +${Number(entry.possessStats?.체력) || 0}</small>
          <small class="raid-nameplate-quest-v1">${escapeHtml(entry.questTitle)}</small>
          <small>${hasItem ? `${entry.floorLabel} 최초 돌파 보상 · 영구 보유` : `🔒 파티 던전 ${entry.floorLabel} 최초 돌파 시 획득`}</small>
        </div>
        <button class="${isEquipped ? 'ghost' : 'primary'} small" ${hasItem ? '' : 'disabled'} onclick="equipRaidNameplateV1('${entry.id}')">${isEquipped ? '장착 중' : (hasItem ? '장착' : '잠김')}</button>
      </article>`;
    }).join('');
    return `<section class="raid-nameplate-picker-v1">
      <div class="raid-nameplate-picker-head-v1">
        <div><h3>🏅 이름표 스킨</h3><p>파티 던전 이정표를 달성하면 영구 해금됩니다. 장착하지 않아도 보유 효과가 모두 적용됩니다.</p></div>
        <button class="${defaultEquipped ? 'ghost' : 'primary'} small" onclick="equipRaidNameplateV1('default')">${defaultEquipped ? '기본 이름표 사용 중' : '기본 이름표로 변경'}</button>
      </div>
      <div class="raid-nameplate-grid-v1">${cards}</div>
    </section>`;
  }

  function rewardMarkup(themeId) {
    const entry = definition(themeId);
    if (!entry) return '';
    return `<div class="raid-nameplate-reward-v1 ${entry.cssClass}">
      <div class="raid-nameplate-reward-icon-v1">${escapeHtml(entry.icon)}</div>
      <div><small>이름표 보상 획득 · ${escapeHtml(entry.questTitle)}</small><strong>${escapeHtml(entry.name)}</strong><p>${escapeHtml(entry.description)} · 보유 효과: 체력 +${Number(entry.possessStats?.체력) || 0}</p></div>
      <button class="primary small" id="raidEquipNameplateBtnV1">바로 장착</button>
    </div>`;
  }

  function nowSeconds() {
    const reduced = global.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
    if (reduced) return 0;
    return Number(global.performance?.now?.() || Date.now()) / 1000;
  }

  function roundedPath(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, width, height, radius);
      return;
    }
    const r = Math.min(radius, width / 2, height / 2);
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y); ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r); ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height); ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function plateMetrics(ctx, x, y, model) {
    const top = y + 58;
    ctx.font = '900 18px Jua, Noto Sans KR, system-ui';
    const textWidth = Math.max(ctx.measureText(model.name).width, ctx.measureText(model.roleLine).width);
    /* The costume-picker preview has an icon column followed by the centered
       name copy. Keep the live canvas plate on that exact visual layout. */
    const width = textWidth + 46;
    const left = x - width / 2;
    return {
      top,
      left,
      width,
      height:52,
      iconX:left + 16,
      textX:left + 32 + textWidth / 2,
    };
  }

  function pickerPlateMetrics(ctx, x, y, model, borderWidth) {
    ctx.font = '900 14px Jua, Noto Sans KR, system-ui';
    const nameWidth = ctx.measureText(model.name).width;
    ctx.font = '400 9px Noto Sans KR, Jua, system-ui';
    const roleWidth = ctx.measureText(model.roleLine).width;
    const textWidth = Math.max(nameWidth, roleWidth);
    /* CSS picker layout: border + 8px padding + 16px icon + 6px gap
       + text column + 8px padding + border. */
    const width = Math.ceil(textWidth + borderWidth * 2 + 38);
    const left = x - width / 2;
    return {
      top:y + 58,
      left,
      width,
      height:52,
      iconX:left + borderWidth + 16,
      textX:left + borderWidth + 30 + textWidth / 2,
    };
  }

  function drawPlateText(ctx, metrics, model, nameColor, roleColor, glow = null) {
    ctx.textAlign = 'center';
    ctx.shadowColor = glow?.name || 'rgba(0,0,0,.94)';
    ctx.shadowBlur = Number(glow?.nameBlur) || 5;
    ctx.font = '900 18px Jua, Noto Sans KR, system-ui';
    ctx.fillStyle = nameColor;
    ctx.fillText(model.name, metrics.textX, metrics.top + 21);
    ctx.shadowColor = glow?.role || 'rgba(0,0,0,.94)';
    ctx.shadowBlur = Number(glow?.roleBlur) || 5;
    ctx.font = '900 14px Noto Sans KR, Jua, system-ui';
    ctx.fillStyle = roleColor;
    ctx.fillText(model.roleLine, metrics.textX, metrics.top + 40);
  }

  function drawPlateIcon(ctx, metrics, icon, color, shadowColor = 'rgba(0,0,0,.7)', shadowBlur = 4) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 18px Segoe UI Symbol, Noto Sans Symbols, system-ui';
    ctx.shadowColor = shadowColor;
    ctx.shadowBlur = shadowBlur;
    ctx.fillStyle = color;
    ctx.fillText(icon, metrics.iconX, metrics.top + metrics.height / 2);
    ctx.textBaseline = 'alphabetic';
  }

  function drawPickerPlateText(ctx, metrics, model, nameColor, roleColor) {
    ctx.textAlign = 'center';
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.font = '900 14px Jua, Noto Sans KR, system-ui';
    ctx.fillStyle = nameColor;
    ctx.fillText(model.name, metrics.textX, metrics.top + 24);
    ctx.font = '400 9px Noto Sans KR, Jua, system-ui';
    ctx.fillStyle = roleColor;
    ctx.fillText(model.roleLine, metrics.textX, metrics.top + 39);
  }

  function drawPickerPlateIcon(ctx, metrics, icon, color, shadowColor = 'transparent', shadowBlur = 0) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '400 16px Segoe UI Symbol, Noto Sans Symbols, system-ui';
    ctx.shadowColor = shadowColor;
    ctx.shadowBlur = shadowBlur;
    ctx.fillStyle = color;
    ctx.fillText(icon, metrics.iconX, metrics.top + 26);
    ctx.textBaseline = 'alphabetic';
  }

  function fillAngledPanel(ctx, metrics, color, startRatio, endRatio, slant = 13) {
    const start = metrics.left + metrics.width * startRatio;
    const end = metrics.left + metrics.width * endRatio;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(start + slant, metrics.top);
    ctx.lineTo(end + slant, metrics.top);
    ctx.lineTo(end - slant, metrics.top + metrics.height);
    ctx.lineTo(start - slant, metrics.top + metrics.height);
    ctx.closePath?.();
    ctx.fill();
  }

  const pickerFrameCache = new Map();

  function paintPickerFrame(ctx, metrics, themeId, useGradient) {
    const steel = themeId === 'raid_20_steel';
    const borderWidth = steel ? 2 : 3;
    const radius = steel ? 10 : 14;
    const colors = steel
      ? ['#181f26', '#313c48']
      : ['#1e1b4b', '#4c1d95', '#7c2d12'];
    roundedPath(
      ctx,
      metrics.left + borderWidth / 2,
      metrics.top + borderWidth / 2,
      metrics.width - borderWidth,
      metrics.height - borderWidth,
      radius - borderWidth / 2,
    );
    const gradient = useGradient && typeof ctx.createLinearGradient === 'function'
      ? ctx.createLinearGradient(metrics.left, metrics.top, metrics.left + metrics.width, metrics.top + metrics.height)
      : null;
    if (gradient) {
      gradient.addColorStop(0, colors[0]);
      if (!steel) gradient.addColorStop(.56, colors[1]);
      gradient.addColorStop(1, colors.at(-1));
      ctx.fillStyle = gradient;
      ctx.fill();
    } else {
      ctx.fillStyle = colors[0];
      ctx.fill();
      ctx.save();
      roundedPath(ctx, metrics.left, metrics.top, metrics.width, metrics.height, radius);
      ctx.clip?.();
      if (steel) {
        fillAngledPanel(ctx, metrics, colors[1], .42, 1.18, 10);
      } else {
        fillAngledPanel(ctx, metrics, colors[1], .32, .78, 11);
        fillAngledPanel(ctx, metrics, colors[2], .72, 1.18, 11);
      }
      ctx.restore();
    }
    roundedPath(
      ctx,
      metrics.left + borderWidth / 2,
      metrics.top + borderWidth / 2,
      metrics.width - borderWidth,
      metrics.height - borderWidth,
      radius - borderWidth / 2,
    );
    ctx.strokeStyle = steel ? '#94a3b8' : '#c4b5fd';
    ctx.lineWidth = borderWidth;
    ctx.stroke();
    const insetWidth = steel ? 3 : 1;
    const inset = borderWidth + insetWidth / 2;
    roundedPath(
      ctx,
      metrics.left + inset,
      metrics.top + inset,
      metrics.width - inset * 2,
      metrics.height - inset * 2,
      Math.max(2, radius - inset),
    );
    ctx.strokeStyle = steel ? '#26323d' : 'rgba(251,146,60,.86)';
    ctx.lineWidth = insetWidth;
    ctx.stroke();
  }

  function pickerFrameTexture(themeId, width, height) {
    const documentValue = global.document;
    if (!documentValue?.createElement) return null;
    const pixelWidth = Math.max(1, Math.ceil(width));
    const pixelHeight = Math.max(1, Math.ceil(height));
    const key = `${themeId}:${pixelWidth}x${pixelHeight}`;
    if (pickerFrameCache.has(key)) return pickerFrameCache.get(key);
    const canvas = documentValue.createElement('canvas');
    if (!canvas) return null;
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    const frameContext = canvas.getContext?.('2d');
    if (!frameContext) return null;
    paintPickerFrame(frameContext, {
      left:0,
      top:0,
      width:pixelWidth,
      height:pixelHeight,
    }, themeId, true);
    if (pickerFrameCache.size >= 96) {
      const oldestKey = pickerFrameCache.keys().next().value;
      if (oldestKey) pickerFrameCache.delete(oldestKey);
    }
    pickerFrameCache.set(key, canvas);
    return canvas;
  }

  function drawPickerFrame(ctx, metrics, themeId) {
    const texture = pickerFrameTexture(themeId, metrics.width, metrics.height);
    if (texture && typeof ctx.drawImage === 'function') {
      ctx.drawImage(texture, metrics.left, metrics.top, metrics.width, metrics.height);
      return;
    }
    paintPickerFrame(ctx, metrics, themeId, false);
  }

  function drawSteel20(ctx, x, y, model) {
    const metrics = pickerPlateMetrics(ctx, x, y, model, 2);
    ctx.save();
    drawPickerFrame(ctx, metrics, 'raid_20_steel');
    drawPickerPlateIcon(ctx, metrics, '▣', '#fb923c', '#fb923c', 7);
    drawPickerPlateText(ctx, metrics, model, '#fff7ed', '#fdba74');
    ctx.restore();
  }

  function drawTwilight40(ctx, x, y, model) {
    const metrics = pickerPlateMetrics(ctx, x, y, model, 3);
    ctx.save();
    drawPickerFrame(ctx, metrics, 'raid_40_twilight');
    drawPickerPlateIcon(ctx, metrics, '◆', '#fb923c');
    drawPickerPlateText(ctx, metrics, model, '#fff7ed', '#ddd6fe');
    ctx.restore();
  }

  function drawSummit63(ctx, x, y, model) {
    const metrics = plateMetrics(ctx, x, y, model);
    const pulse = (Math.sin(nowSeconds() * 2.4) + 1) / 2;
    const cyanAlpha = .68 + pulse * .30;
    const magentaAlpha = .98 - pulse * .26;
    ctx.save();
    ctx.shadowColor = pulse > .5 ? '#22d3ee' : '#e879f9'; ctx.shadowBlur = 12 + pulse * 6;
    roundedPath(ctx, metrics.left, metrics.top, metrics.width, metrics.height, 13);
    ctx.fillStyle = '#03071c'; ctx.fill();
    ctx.save();
    roundedPath(ctx, metrics.left, metrics.top, metrics.width, metrics.height, 13);
    ctx.clip?.();
    fillAngledPanel(ctx, metrics, '#08304b', .18, .53);
    fillAngledPanel(ctx, metrics, '#581c87', .49, .82);
    fillAngledPanel(ctx, metrics, '#4c0519', .78, 1.18);
    const sweep = ((nowSeconds() % 2.1) / 2.1) * 1.8 - .4;
    fillAngledPanel(ctx, metrics, 'rgba(255,255,255,.22)', sweep, sweep + .10, 9);
    ctx.restore();
    roundedPath(ctx, metrics.left, metrics.top, metrics.width, metrics.height, 13);
    ctx.strokeStyle = pulse > .5
      ? `rgba(240,171,252,${magentaAlpha})`
      : `rgba(103,232,249,${cyanAlpha})`;
    ctx.lineWidth = 3; ctx.stroke();
    roundedPath(ctx, metrics.left + 4, metrics.top + 4, metrics.width - 8, metrics.height - 8, 9);
    ctx.strokeStyle = `rgba(250,204,21,${magentaAlpha})`; ctx.lineWidth = 1.4; ctx.stroke();
    drawPlateIcon(ctx, metrics, '♛', '#fef08a', pulse > .5 ? '#e879f9' : '#22d3ee', 9);
    drawPlateText(ctx, metrics, model, '#ffffff', '#a5f3fc', {
      name:pulse > .5 ? '#d946ef' : '#22d3ee',
      nameBlur:9,
      role:'#0891b2',
      roleBlur:6,
    });
    ctx.restore();
  }

  function installCanvasThemes() {
    const renderer = global.YuksamPlayerNameplateV1;
    if (!renderer?.registerTheme || !renderer?.setThemeResolver) return false;
    renderer.registerTheme('raid_20_steel', drawSteel20);
    renderer.registerTheme('raid_40_twilight', drawTwilight40);
    renderer.registerTheme('raid_63_summit', drawSummit63);
    renderer.setThemeResolver((model) => (
      BY_ID.has(String(model?.cosmetics?.theme || '')) ? String(model.cosmetics.theme) : DEFAULT_THEME
    ));
    return true;
  }

  const api = Object.freeze({
    DEFAULT_THEME,
    definitions:DEFINITIONS,
    definition,
    rewardForGroup,
    possessionStats,
    normalizeOwned,
    normalizePlayerFields,
    applyServerSnapshot,
    equip,
    pickerMarkup,
    rewardMarkup,
    installCanvasThemes,
  });
  global.YuksamRaidNameplatesV1 = api;
  global.renderRaidNameplatePickerV1 = pickerMarkup;
  global.renderRaidNameplateRewardV1 = rewardMarkup;
  global.equipRaidNameplateV1 = function equipRaidNameplateV1(themeId) {
    const currentGame = typeof game !== 'undefined' ? game : global.__G;
    const player = currentGame?.player;
    const entry = definition(themeId);
    if (!equip(player, themeId)) {
      global.toast?.('아직 획득하지 않은 이름표입니다.');
      return false;
    }
    global.savePlayer?.();
    global.playSfx?.('open');
    global.toast?.(themeId === DEFAULT_THEME ? '기본 이름표로 변경했습니다.' : `${entry?.name || '이름표'}을(를) 장착했습니다.`);
    if (currentGame?.modalState?.type === 'costume') global.openCostumePanelV55?.();
    return true;
  };
  installCanvasThemes();
})(window);
