/* =========================================================
   ultimate-fx.js — 궁극기/부활 화면 연출 (v41)
   - window.playUltimateFxV41(skillId): 궁극기 계열별 화면 전체 오버레이
   - window.playGuardianReviveFxV41(): 수호자의 맹세 부활 전용 연출(전용 오디오 + 스프라이트 애니)
   game.js 훅은 1줄 호출만 사용한다. 여기서만 DOM/오디오를 생성한다.
   ========================================================= */
(function ultimateFxV41() {
  if (window.__ULTIMATE_FX_V41__) return;
  window.__ULTIMATE_FX_V41__ = true;

  // 계열별 테마 정의: cls(오버레이 클래스), shake(화면 흔들림), spark(파티클 개수/종류)
  const THEMES = {
    warrior_weapon_judgment: { cls: 'uf-judgment', shake: true, bolts: 6, tone: '#ff3b3b' },
    warrior_def_bastion:     { cls: 'uf-bastion',  shake: false, rays: 7, tone: '#ffd76a' },
    mage_frost_storm_v24:    { cls: 'uf-frost',    shake: false, shards: 22, tone: '#8fd6ff' },
    mage_fire_meteor_v24:    { cls: 'uf-meteor',   shake: true, meteors: 6, tone: '#ff9436' },
    priest_holy_judgment_v24:{ cls: 'uf-holy',     shake: false, rays: 9, tone: '#fff0a8' },
    priest_shadow_judgment_v24:{ cls: 'uf-shadow', shake: false, swirls: 5, tone: '#b47bff' },
    // 추가 궁극기(트리 밖) 대비 폴백 매핑
    mage_arcane_comet:       { cls: 'uf-frost',    shake: true, shards: 18, tone: '#a5b4ff' },
    priest_final_grace:      { cls: 'uf-holy',     shake: false, rays: 9, tone: '#fff0a8' },
  };
  const DEFAULT_THEME = { cls: 'uf-generic', shake: true, bolts: 4, tone: '#ffe08a' };

  function el(tag, cls) { const n = document.createElement(tag); if (cls) n.className = cls; return n; }

  function buildParticles(root, theme) {
    // 계열별 파티클을 절차적으로 뿌린다 — 모두 CSS 애니메이션으로 움직인다.
    const add = (cls, n, style) => {
      for (let i = 0; i < (n || 0); i++) {
        const p = el('span', cls);
        style && style(p, i, n);
        root.appendChild(p);
      }
    };
    add('uf-bolt', theme.bolts, (p, i, n) => {
      p.style.left = (8 + (84 / Math.max(1, n - 1)) * i + (Math.random() * 6 - 3)) + '%';
      p.style.animationDelay = (Math.random() * 0.28) + 's';
    });
    add('uf-shard', theme.shards, (p) => {
      p.style.left = (Math.random() * 100) + '%';
      p.style.top = (-10 + Math.random() * 20) + '%';
      p.style.animationDelay = (Math.random() * 0.5) + 's';
      p.style.transform = `rotate(${Math.random() * 360}deg)`;
    });
    add('uf-meteor-ball', theme.meteors, (p, i, n) => {
      p.style.left = (6 + (88 / Math.max(1, n - 1)) * i + (Math.random() * 8 - 4)) + '%';
      p.style.animationDelay = (Math.random() * 0.35) + 's';
    });
    add('uf-ray', theme.rays, (p, i, n) => {
      p.style.transform = `translateX(-50%) rotate(${(-60 + (120 / Math.max(1, n - 1)) * i)}deg)`;
      p.style.animationDelay = (Math.random() * 0.18) + 's';
    });
    add('uf-swirl', theme.swirls, (p, i) => {
      p.style.animationDelay = (i * 0.09) + 's';
      p.style.setProperty('--uf-swirl-scale', (0.5 + i * 0.28).toFixed(2));
    });
  }

  window.playUltimateFxV41 = function playUltimateFxV41(skillId) {
    try {
      const theme = THEMES[skillId] || DEFAULT_THEME;
      const overlay = el('div', 'ultimate-fx-overlay ' + theme.cls);
      overlay.setAttribute('data-skill', skillId || '');
      overlay.style.setProperty('--uf-tone', theme.tone || '#ffe08a');
      const flash = el('div', 'uf-flash');
      const vignette = el('div', 'uf-vignette');
      const field = el('div', 'uf-field');
      buildParticles(field, theme);
      overlay.appendChild(vignette);
      overlay.appendChild(field);
      overlay.appendChild(flash);
      document.body.appendChild(overlay);

      if (theme.shake) {
        const box = document.querySelector('.modal-box');
        if (box) {
          box.classList.add('uf-shake');
          setTimeout(() => box.classList.remove('uf-shake'), 620);
        }
      }
      setTimeout(() => { overlay.remove(); }, 1400);
      return overlay;
    } catch (e) { return null; }
  };

  // 수호자의 맹세 부활: 쓰러짐→기립 스프라이트 애니 + 금빛 오버레이
  window.playGuardianReviveFxV41 = function playGuardianReviveFxV41() {
    try {
      const sprite = document.querySelector('.combat-player');
      if (sprite) {
        sprite.classList.remove('guardian-oath-revive');
        // reflow로 애니메이션 재시작 보장
        void sprite.offsetWidth;
        sprite.classList.add('guardian-oath-revive');
        setTimeout(() => sprite.classList.remove('guardian-oath-revive'), 1600);
      }
    } catch (e) {}
    // 래핑된 궁극기 훅이 전용 오디오를 한 번만 재생하고 금빛 오버레이를 만든다.
    window.playUltimateFxV41('warrior_def_bastion');
  };
})();
