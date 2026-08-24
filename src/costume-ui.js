/* v55: 옷 상인 상남 코스튬 상점 + 코스튬 창 (성능 유지, 외형만 변경) */
(function costumeUiV55() {
  if (window.__COSTUME_UI_V55__) return;
  window.__COSTUME_UI_V55__ = true;

  const SLOTS = [['head', '머리'], ['armor', '옷'], ['accessory', '악세서리']];
  const g = () => (typeof game !== 'undefined' ? game : window.__G);
  const call = (n) => (typeof window[n] === 'function' ? window[n] : null);
  const esc = (t) => (call('escapeHtml') ? window.escapeHtml(t) : String(t));
  const defs = () => window.COSTUME_DEFS_V55 || {};

  function ensureFields() {
    const p = g()?.player;
    if (!p) return null;
    if (!p.costume || typeof p.costume !== 'object' || Array.isArray(p.costume)) p.costume = {};
    if (!Array.isArray(p.costumeInventory)) p.costumeInventory = [];
    return p;
  }
  function iconOf(item) {
    return ({
      cs_bunnyBand: '🐰', cs_catBand: '🐱', cs_flowerCrown: '🌸', cs_starCrown: '👑', cs_violetMagicHat: '🪄', cs_ninjaMask: '🥷', cs_spartanHelm: '🪖',
      cs_sailorCape: '🎀', cs_cloudHoodie: '☁️', cs_starryRobe: '🌌', cs_peachDress: '👗', cs_forestFairyCape: '🍃', cs_ninjaSuit: '🥷', cs_spartanArmor: '🛡️',
      cs_ribbon: '🎗️', cs_questSproutRibbon: '🌱', cs_goldenBell: '🔔', cs_giantFishPack: '🐟', cs_duckFloat: '🦆', cs_angelWing: '🎐', cs_strangeWing: '🪽', cs_rainbowAura: '🌈', cs_twilightBatWing: '🦇',
    })[item.id] || '✨';
  }

  /* ── 상점 ── */
  window.openCostumeShopV55 = function openCostumeShopV55() {
    const p = ensureFields(); if (!p) return;
    const shopItems = Object.values(defs()).filter((item) => !item.questOnly);
    const cardHtml = (item) => {
      const owned = p.costumeInventory.includes(item.id);
      const afford = (p.gold || 0) >= item.price;
      return `<article class="panel-card costume-shop-card">
        <div class="costume-shop-card-main">
          <div class="costume-shop-item-icon" aria-hidden="true">${iconOf(item)}</div>
          <div class="costume-shop-item-copy">
            <b>${esc(item.name)}</b>
            <p class="muted">${esc(item.desc)}</p>
          </div>
        </div>
        <div class="costume-shop-card-footer">
          <div class="costume-shop-price">🪙 ${item.price}</div>
          <button class="${owned ? 'ghost' : 'primary'} small" ${owned || !afford ? 'disabled' : ''} onclick="buyCostumeV55('${item.id}')">${owned ? '보유 중' : (afford ? '구매' : '골드 부족')}</button>
        </div>
      </article>`;
    };
    const sections = SLOTS.map(([slot, label]) => {
      const items = shopItems.filter((item) => item.slot === slot);
      return `<section class="costume-shop-section" data-costume-slot="${slot}">
        <h3 class="costume-shop-section-title"><span>${label}</span><small>${items.length}종</small></h3>
        <div class="costume-shop-grid">${items.map(cardHtml).join('')}</div>
      </section>`;
    }).join('');
    call('openModal')?.(`
      <div class="costume-shop">
        <h2>🧵 옷 상인 상남</h2>
        <p class="muted costume-shop-intro">“능력치는 안 오르지만, 멋과 귀여움은 확실히 올라!”<br>코스튬은 <b>성능은 그대로 두고 겉모습만</b> 바꿔줍니다. (상태창 → 코스튬 칸에서 착용)</p>
        <div class="resource-balance-banner resource-gold"><span>현재 보유 골드</span><b>🪙 ${p.gold || 0}</b></div>
        <div class="costume-shop-sections">${sections}</div>
        <button class="ghost wide" onclick="closeModal()" style="margin-top:12px">닫기</button>
      </div>
    `, { type: 'costumeShop', pause: true });
  };

  window.buyCostumeV55 = function buyCostumeV55(id) {
    const p = ensureFields(); const item = defs()[id];
    if (!p || !item) return;
    if (p.costumeInventory.includes(id)) { call('toast')?.('이미 가지고 있는 코스튬입니다.'); return; }
    if ((p.gold || 0) < item.price) { call('toast')?.('골드가 부족합니다.'); return; }
    p.gold -= item.price;
    p.costumeInventory.push(id);
    call('savePlayer')?.(); call('updateHud')?.(); call('playSfx')?.('coin');
    window.recordQuestActionV38?.('buyCostume');
    call('toast')?.(`${item.name}을(를) 구매했습니다!`);
    window.openCostumeShopV55();
  };

  /* ── 코스튬 창 ── */
  window.openCostumePanelV55 = function openCostumePanelV55() {
    const p = ensureFields(); if (!p) return;
    const slotHtml = SLOTS.map(([slot, label]) => {
      const id = p.costume[slot];
      const item = id ? defs()[id] : null;
      const posClass = { head: 'slot-head-v7', armor: 'slot-armor-v7', accessory: 'slot-accessory-v7' }[slot] || '';
      return `<div class="equip-slot paper-slot ${posClass} compact-item-slot-v26">
        ${item ? `<button class="unequip-btn" data-tooltip="코스튬 해제" onclick="unequipCostumeV55('${slot}')">×</button>` : ''}
        <div class="slot-name">${label}</div><div class="slot-icon ${item ? 'filled' : ''}">${item ? iconOf(item) : '＋'}</div><b>${item ? esc(item.name) : '기본 모습'}</b>
      </div>`;
    }).join('');
    const owned = p.costumeInventory.map((id) => defs()[id]).filter(Boolean);
    const bagCardHtml = (item) => {
      const on = p.costume[item.slot] === item.id;
      return `<div class="bag-slot compact-item-slot-v26 bag-card-v27">
        <div class="bag-icon">${iconOf(item)}</div>
        <b>${esc(item.name)}</b>
        <small>${SLOTS.find(([s]) => s === item.slot)?.[1] || item.slot}</small>
        <button class="${on ? 'ghost' : 'primary'} small" onclick="${on ? `unequipCostumeV55('${item.slot}')` : `equipCostumeV55('${item.id}')`}">${on ? '해제' : '착용'}</button>
      </div>`;
    };
    const bag = SLOTS.map(([slot, label]) => {
      const items = owned.filter((item) => item.slot === slot);
      const itemHtml = items.length
        ? items.map(bagCardHtml).join('')
        : `<p class="muted costume-inventory-empty">보유 중인 ${label} 코스튬이 없습니다.</p>`;
      return `<section class="costume-inventory-section" data-costume-inventory-slot="${slot}">
        <h4 class="costume-inventory-section-title"><span>${label}</span><small>${items.length}개</small></h4>
        <div class="bag-grid costume-inventory-grid">${itemHtml}</div>
      </section>`;
    }).join('');

    call('openModal')?.(`<div class="character-window-v27 character-window-v32">
      <header class="character-head-v27"><h2>🧵 코스튬</h2><p>능력치는 착용 중인 장비 그대로 유지되고, 보이는 모습만 코스튬으로 바뀝니다.</p></header>
      <div class="character-panel character-panel-v7 character-panel-v26 character-panel-v27">
        <div class="panel-card paperdoll-card-v7">
          <h3>미리보기</h3>
          <div class="paperdoll paperdoll-v7">
            <canvas id="costumePanelCanvasV55" width="420" height="420"></canvas>
            ${slotHtml}
          </div>
        </div>
        <div>
          <div class="panel-card">
            <h3>코스튬 보관함</h3>
            ${owned.length ? '' : '<p class="muted costume-inventory-intro">아직 코스튬이 없습니다. 특별 상점의 <b>옷 상인 상남</b>에게서 구매할 수 있어요.</p>'}
            <div class="costume-inventory-sections">${bag}</div>
          </div>
          <button class="primary wide" onclick="openCharacterPanel()" style="margin-top:10px">← 상태창으로 돌아가기</button>
        </div>
      </div>
    </div>`, { type: 'costume', pause: true });
    setTimeout(drawPreview, 20);
  };

  function drawPreview() {
    const p = g()?.player;
    const canvas = document.getElementById('costumePanelCanvasV55');
    const draw = call('drawPlayerSprite');
    if (!p || !canvas || !draw) return;
    const c = canvas.getContext('2d');
    c.clearRect(0, 0, canvas.width, canvas.height);
    const bg = c.createRadialGradient(canvas.width / 2, canvas.height / 2, 20, canvas.width / 2, canvas.height / 2, 150);
    bg.addColorStop(0, 'rgba(244,164,255,.16)');
    bg.addColorStop(1, 'rgba(255,255,255,.02)');
    c.fillStyle = bg; c.fillRect(0, 0, canvas.width, canvas.height);
    try { call('drawPedestal')?.(c, canvas.width / 2, 300, 1.8); } catch {}
    try {
      draw(c, canvas.width / 2, 205, p.appearance, p.class,
        { attack: 0, moving: false, equipment: p.equipment, costume: p.costume }, 3.25, p.spec);
    } catch {}
  }

  window.equipCostumeV55 = function equipCostumeV55(id) {
    const p = ensureFields(); const item = defs()[id];
    if (!p || !item || !p.costumeInventory.includes(id)) return;
    p.costume[item.slot] = id;
    call('savePlayer')?.(); call('playSfx')?.('open');
    window.openCostumePanelV55();
  };
  window.unequipCostumeV55 = function unequipCostumeV55(slot) {
    const p = ensureFields(); if (!p) return;
    delete p.costume[slot];
    call('savePlayer')?.(); call('playSfx')?.('open');
    window.openCostumePanelV55();
  };

  /* ── 상태창에 "코스튬" 버튼 주입 (늦은 바인딩) ── */
  function injectButton() {
    if (document.getElementById('openCostumeBtnV55')) return;
    const accessorySlot = document.querySelector('.paperdoll .slot-accessory-v7');
    const host = accessorySlot?.parentElement;
    if (!accessorySlot || !host) return;
    const btn = document.createElement('button');
    btn.id = 'openCostumeBtnV55';
    btn.className = 'primary small';
    btn.textContent = '🧵 코스튬 칸';
    btn.onclick = () => window.openCostumePanelV55();
    btn.style.cssText = 'position:absolute;z-index:5;white-space:nowrap;visibility:hidden';
    if (window.getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(btn);
    // 악세서리 칸 바로 위(0.3cm≈11px 간격), 오른쪽 끝을 악세서리 칸과 맞춤 — 실제 위치를 측정해 배치
    const place = () => {
      const hostRect = host.getBoundingClientRect();
      const slotRect = accessorySlot.getBoundingClientRect();
      if (!slotRect.height || !hostRect.height) return false;
      btn.style.right = Math.round(hostRect.right - slotRect.right) + 'px';
      btn.style.bottom = Math.round(hostRect.bottom - slotRect.top + 11) + 'px';
      btn.style.visibility = 'visible';
      return true;
    };
    if (!place()) {
      let tries = 0;
      const t = setInterval(() => {
        if (place()) { clearInterval(t); return; }
        if (++tries > 12) { // 측정 실패 시 CSS 기준 위치로 폴백
          const cs = window.getComputedStyle(accessorySlot);
          btn.style.right = (cs.right && cs.right !== 'auto') ? cs.right : '18px';
          btn.style.bottom = `calc(${(cs.bottom && cs.bottom !== 'auto') ? cs.bottom : '34px'} + 96px)`;
          btn.style.visibility = 'visible';
          clearInterval(t);
        }
      }, 80);
    }
  }
  setInterval(() => { if (g()?.modalState?.type === 'character') injectButton(); }, 400);
})();
