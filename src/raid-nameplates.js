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
    }),
    Object.freeze({
      id:'raid_63_summit',
      floorGroup:7,
      floorLabel:'63층',
      questTitle:'[파티] 육삼의 정상',
      name:'육삼 정상 이름표',
      shortName:'육삼의 정상',
      description:'먹빛 하늘, 무광 금빛 테두리와 옥상 안테나를 담은 이름표',
      icon:'♛',
      cssClass:'raid-nameplate-summit-63',
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
          <small class="raid-nameplate-quest-v1">${escapeHtml(entry.questTitle)}</small>
          <small>${hasItem ? `${entry.floorLabel} 최초 돌파 보상 · 영구 보유` : `🔒 파티 던전 ${entry.floorLabel} 최초 돌파 시 획득`}</small>
        </div>
        <button class="${isEquipped ? 'ghost' : 'primary'} small" ${hasItem ? '' : 'disabled'} onclick="equipRaidNameplateV1('${entry.id}')">${isEquipped ? '장착 중' : (hasItem ? '장착' : '잠김')}</button>
      </article>`;
    }).join('');
    return `<section class="raid-nameplate-picker-v1">
      <div class="raid-nameplate-picker-head-v1">
        <div><h3>🏅 이름표 스킨</h3><p>파티 던전 이정표를 달성하면 영구 해금됩니다. 능력치는 오르지 않습니다.</p></div>
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
      <div><small>꾸미기 아이템 획득 · ${escapeHtml(entry.questTitle)}</small><strong>${escapeHtml(entry.name)}</strong><p>${escapeHtml(entry.description)}</p></div>
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
    const width = Math.max(ctx.measureText(model.name).width, ctx.measureText(model.roleLine).width) + 42;
    return { top, left:x - width / 2, width, height:50 };
  }

  function drawPlateText(ctx, x, metrics, model, nameColor, roleColor) {
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,.94)';
    ctx.shadowBlur = 5;
    ctx.font = '900 18px Jua, Noto Sans KR, system-ui';
    ctx.fillStyle = nameColor;
    ctx.fillText(model.name, x, metrics.top + 21);
    ctx.font = '900 14px Noto Sans KR, Jua, system-ui';
    ctx.fillStyle = roleColor;
    ctx.fillText(model.roleLine, x, metrics.top + 39);
  }

  function drawSteel20(ctx, x, y, model) {
    const metrics = plateMetrics(ctx, x, y, model);
    const pulse = .76 + Math.sin(nowSeconds() * 1.45) * .16;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.94)'; ctx.shadowBlur = 9;
    roundedPath(ctx, metrics.left, metrics.top, metrics.width, metrics.height, 10);
    ctx.fillStyle = 'rgba(24,31,38,.95)'; ctx.fill();
    ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 2; ctx.stroke();
    roundedPath(ctx, metrics.left + 4, metrics.top + 4, metrics.width - 8, metrics.height - 8, 7);
    ctx.strokeStyle = 'rgba(71,85,105,.95)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.shadowColor = '#fb923c'; ctx.shadowBlur = 8;
    ctx.fillStyle = `rgba(251,146,60,${pulse})`;
    [metrics.left + 10, metrics.left + metrics.width - 10].forEach((lightX) => {
      ctx.beginPath(); ctx.arc(lightX, metrics.top + 25, 3.5, 0, Math.PI * 2); ctx.fill();
    });
    drawPlateText(ctx, x, metrics, model, '#fff7ed', '#fdba74');
    ctx.restore();
  }

  function drawTwilight40(ctx, x, y, model) {
    const metrics = plateMetrics(ctx, x, y, model);
    const t = nowSeconds();
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.94)'; ctx.shadowBlur = 9;
    roundedPath(ctx, metrics.left, metrics.top, metrics.width, metrics.height, 14);
    const gradient = typeof ctx.createLinearGradient === 'function'
      ? ctx.createLinearGradient(metrics.left, metrics.top, metrics.left + metrics.width, metrics.top + metrics.height)
      : null;
    if (gradient) {
      gradient.addColorStop(0, 'rgba(30,27,75,.96)');
      gradient.addColorStop(.55, 'rgba(76,29,149,.95)');
      gradient.addColorStop(1, 'rgba(124,45,18,.94)');
    }
    ctx.fillStyle = gradient || 'rgba(55,31,103,.96)'; ctx.fill();
    ctx.strokeStyle = '#c4b5fd'; ctx.lineWidth = 3; ctx.stroke();
    roundedPath(ctx, metrics.left + 4, metrics.top + 4, metrics.width - 8, metrics.height - 8, 10);
    ctx.strokeStyle = 'rgba(251,146,60,.82)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.shadowBlur = 0;
    for (let index = 0; index < 4; index += 1) {
      const glow = .18 + ((Math.sin(t * .75 + index * 1.7) + 1) / 2) * .34;
      ctx.fillStyle = `rgba(251,191,36,${glow})`;
      ctx.fillRect(metrics.left + 12 + index * ((metrics.width - 30) / 3), metrics.top + 8, 4, 5);
    }
    drawPlateText(ctx, x, metrics, model, '#fff7ed', '#ddd6fe');
    ctx.restore();
  }

  function drawSummit63(ctx, x, y, model) {
    const metrics = plateMetrics(ctx, x, y, model);
    const blink = .62 + Math.sin(nowSeconds() * 1.1) * .2;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.96)'; ctx.shadowBlur = 11;
    roundedPath(ctx, metrics.left, metrics.top, metrics.width, metrics.height, 13);
    ctx.fillStyle = 'rgba(5,10,20,.97)'; ctx.fill();
    ctx.strokeStyle = '#d6b96b'; ctx.lineWidth = 3; ctx.stroke();
    roundedPath(ctx, metrics.left + 4, metrics.top + 4, metrics.width - 8, metrics.height - 8, 9);
    ctx.strokeStyle = 'rgba(255,251,235,.68)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#d6b96b'; ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x - 13, metrics.top); ctx.lineTo(x - 7, metrics.top - 6);
    ctx.lineTo(x - 2, metrics.top); ctx.lineTo(x + 3, metrics.top - 10);
    ctx.lineTo(x + 8, metrics.top); ctx.lineTo(x + 14, metrics.top - 5); ctx.stroke();
    ctx.strokeStyle = '#f8fafc'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + 3, metrics.top - 10); ctx.lineTo(x + 3, metrics.top - 16); ctx.stroke();
    ctx.shadowColor = '#f87171'; ctx.shadowBlur = 7;
    ctx.fillStyle = `rgba(248,113,113,${blink})`;
    ctx.beginPath(); ctx.arc(x + 3, metrics.top - 17, 2.2, 0, Math.PI * 2); ctx.fill();
    drawPlateText(ctx, x, metrics, model, '#fff7d6', '#e7d59b');
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
