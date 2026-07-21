/*
 * map-decor.js — 맵 빈 공간 장식 (그래픽 채우기)
 * 기존 그래픽 스타일(단순 도형 + 낮은 알파)을 유지하면서 각 맵의 허전한 공간을
 * 시드 고정 프로시저럴 장식으로 채운다. game.js의 지형 함수(drawTown/drawForest/
 * drawDesert/drawSwamp)가 몬스터를 그리기 전에 drawMapDetailV36(mapKey)를 호출한다.
 * 배치가 매 프레임 동일하도록 맵별 시드 LCG를 사용한다. 게임플레이 영향 없음.
 */
(function () {
  'use strict';

  function makeRng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  // 맵별 장식 배치 캐시 (월드 좌표)
  const cache = {};

  function buildDecor(mapKey, w, h) {
    const rng = makeRng(mapKey.split('').reduce((a, c) => a + c.charCodeAt(0) * 31, 63));
    const list = [];
    const put = (kind, n, opts = {}) => {
      for (let i = 0; i < n; i++) {
        list.push({
          kind,
          x: 120 + rng() * (w - 240),
          y: 120 + rng() * (h - 240),
          s: 0.7 + rng() * 0.6,
          r: rng(),
          ...opts,
        });
      }
    };
    if (mapKey === 'town') {
      put('grassTuft', 26); put('flowerPatch', 8); put('stoneTile', 7); put('bush', 9); put('butterfly', 4);
    } else if (mapKey === 'forest') {
      put('grassTuft', 30); put('mushroomCluster', 11); put('fallenLeaf', 26); put('firefly', 9); put('bush', 7);
    } else if (mapKey === 'desert') {
      put('rock', 11); put('bone', 6); put('sandWave', 18); put('dryBush', 10);
    } else if (mapKey === 'swamp') {
      put('puddle', 9); put('glowShroom', 11); put('reed', 15); put('fogPatch', 6); put('lilyDot', 14);
    }
    return list;
  }

  function drawOne(ctx, d, sx, sy, t) {
    const s = d.s;
    ctx.save();
    ctx.translate(sx, sy);
    switch (d.kind) {
      case 'grassTuft':
        ctx.strokeStyle = 'rgba(190,242,100,.4)';
        ctx.lineWidth = 2 * s;
        ctx.lineCap = 'round';
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.moveTo(i * 4 * s, 6 * s);
          ctx.quadraticCurveTo(i * 5 * s, -2 * s, i * 8 * s, -8 * s);
          ctx.stroke();
        }
        break;
      case 'flowerPatch': {
        const colors = ['#fda4af', '#fde68a', '#c4b5fd', '#fdba74'];
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 + d.r * 6;
          const fx = Math.cos(a) * 14 * s, fy = Math.sin(a) * 9 * s;
          ctx.fillStyle = colors[(i + Math.floor(d.r * 4)) % 4];
          for (let k = 0; k < 5; k++) {
            const b = (k / 5) * Math.PI * 2;
            ctx.beginPath(); ctx.arc(fx + Math.cos(b) * 3 * s, fy + Math.sin(b) * 3 * s, 2 * s, 0, Math.PI * 2); ctx.fill();
          }
          ctx.fillStyle = '#fef9c3';
          ctx.beginPath(); ctx.arc(fx, fy, 1.8 * s, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case 'stoneTile':
        ctx.fillStyle = 'rgba(226,232,240,.16)';
        ctx.strokeStyle = 'rgba(226,232,240,.22)';
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 3; i++) {
          const ox = (i - 1) * 20 * s, oy = ((i * 7) % 3 - 1) * 10 * s;
          ctx.beginPath();
          ctx.ellipse(ox, oy, 12 * s, 8 * s, d.r + i, 0, Math.PI * 2);
          ctx.fill(); ctx.stroke();
        }
        break;
      case 'bush':
        ctx.fillStyle = 'rgba(34,120,60,.55)';
        ctx.beginPath(); ctx.arc(-8 * s, 0, 9 * s, 0, Math.PI * 2); ctx.arc(4 * s, -3 * s, 11 * s, 0, Math.PI * 2); ctx.arc(12 * s, 3 * s, 8 * s, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(74,180,100,.4)';
        ctx.beginPath(); ctx.arc(0, -6 * s, 7 * s, 0, Math.PI * 2); ctx.fill();
        break;
      case 'butterfly': {
        const bx = Math.sin(t * 1.3 + d.r * 9) * 26;
        const by = Math.cos(t * 1.7 + d.r * 7) * 14;
        const flap = Math.abs(Math.sin(t * 10 + d.r * 5));
        ctx.translate(bx, by);
        ctx.fillStyle = d.r > 0.5 ? 'rgba(253,164,175,.85)' : 'rgba(147,197,253,.85)';
        ctx.beginPath(); ctx.ellipse(-3 * s, 0, 4 * s * (0.4 + flap * 0.6), 3 * s, -0.4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(3 * s, 0, 4 * s * (0.4 + flap * 0.6), 3 * s, 0.4, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'mushroomCluster': {
        const caps = ['#f87171', '#fbbf24', '#f9a8d4'];
        for (let i = 0; i < 3; i++) {
          const ox = (i - 1) * 9 * s, oy = (i % 2) * 5 * s;
          const ms = s * (0.7 + (i % 3) * 0.25);
          ctx.fillStyle = '#fef3c7';
          ctx.fillRect(ox - 1.5 * ms, oy - 3 * ms, 3 * ms, 6 * ms);
          ctx.fillStyle = caps[(i + Math.floor(d.r * 3)) % 3];
          ctx.beginPath(); ctx.arc(ox, oy - 3 * ms, 5 * ms, Math.PI, 0); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,.7)';
          ctx.beginPath(); ctx.arc(ox - 2 * ms, oy - 5 * ms, 1 * ms, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case 'fallenLeaf':
        ctx.fillStyle = `rgba(${d.r > 0.5 ? '217,119,6' : '132,204,22'},.35)`;
        ctx.rotate(d.r * 6);
        ctx.beginPath(); ctx.ellipse(0, 0, 5 * s, 2.4 * s, 0, 0, Math.PI * 2); ctx.fill();
        break;
      case 'firefly': {
        const fx = Math.sin(t * 0.9 + d.r * 10) * 34;
        const fy = Math.cos(t * 1.2 + d.r * 8) * 22;
        const glow = 0.35 + 0.4 * Math.abs(Math.sin(t * 2.6 + d.r * 12));
        ctx.globalAlpha = glow;
        ctx.fillStyle = '#fde68a';
        ctx.beginPath(); ctx.arc(fx, fy, 2.2 * s, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = glow * 0.35;
        ctx.beginPath(); ctx.arc(fx, fy, 7 * s, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'rock':
        ctx.fillStyle = 'rgba(120,113,108,.75)';
        ctx.beginPath();
        ctx.moveTo(-12 * s, 8 * s); ctx.lineTo(-7 * s, -7 * s); ctx.lineTo(6 * s, -9 * s); ctx.lineTo(13 * s, 6 * s);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(214,211,209,.5)';
        ctx.beginPath(); ctx.moveTo(-7 * s, -7 * s); ctx.lineTo(6 * s, -9 * s); ctx.lineTo(2 * s, -1 * s); ctx.closePath(); ctx.fill();
        break;
      case 'bone':
        ctx.strokeStyle = 'rgba(254,243,199,.6)';
        ctx.lineWidth = 3.5 * s;
        ctx.lineCap = 'round';
        ctx.rotate(d.r * 3);
        ctx.beginPath(); ctx.moveTo(-9 * s, 0); ctx.lineTo(9 * s, 0); ctx.stroke();
        ctx.fillStyle = 'rgba(254,243,199,.6)';
        [[-10, -2.5], [-10, 2.5], [10, -2.5], [10, 2.5]].forEach(([ox, oy]) => {
          ctx.beginPath(); ctx.arc(ox * s, oy * s, 2.6 * s, 0, Math.PI * 2); ctx.fill();
        });
        break;
      case 'sandWave':
        ctx.strokeStyle = 'rgba(255,247,194,.25)';
        ctx.lineWidth = 2 * s;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-16 * s, 0);
        ctx.quadraticCurveTo(-6 * s, -5 * s, 2 * s, 0);
        ctx.quadraticCurveTo(10 * s, 5 * s, 18 * s, 0);
        ctx.stroke();
        break;
      case 'dryBush':
        ctx.strokeStyle = 'rgba(180,140,72,.6)';
        ctx.lineWidth = 1.8 * s;
        ctx.lineCap = 'round';
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath();
          ctx.moveTo(i * 2 * s, 6 * s);
          ctx.quadraticCurveTo(i * 5 * s, -3 * s, i * 8 * s, -9 * s);
          ctx.stroke();
        }
        break;
      case 'puddle':
        ctx.fillStyle = 'rgba(45,90,110,.4)';
        ctx.beginPath(); ctx.ellipse(0, 0, 22 * s, 10 * s, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(167,243,208,.2)';
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.ellipse(0, 0, 15 * s, 6 * s, 0, 0.3 + Math.sin(t + d.r * 8) * 0.1, Math.PI * 1.5); ctx.stroke();
        break;
      case 'glowShroom': {
        const glow = 0.4 + 0.35 * Math.sin(t * 2 + d.r * 10);
        ctx.fillStyle = 'rgba(139,123,184,.8)';
        ctx.fillRect(-1.6 * s, -2 * s, 3.2 * s, 8 * s);
        ctx.fillStyle = `rgba(167,139,250,${0.55 + glow * 0.4})`;
        ctx.beginPath(); ctx.arc(0, -2 * s, 6.5 * s, Math.PI, 0); ctx.fill();
        ctx.globalAlpha = glow * 0.3;
        ctx.fillStyle = '#a78bfa';
        ctx.beginPath(); ctx.arc(0, -3 * s, 13 * s, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'reed':
        ctx.strokeStyle = 'rgba(94,140,110,.55)';
        ctx.lineWidth = 2 * s;
        ctx.lineCap = 'round';
        for (let i = -1; i <= 1; i++) {
          const sway = Math.sin(t * 1.4 + d.r * 9 + i) * 2.5;
          ctx.beginPath();
          ctx.moveTo(i * 4 * s, 8 * s);
          ctx.quadraticCurveTo(i * 5 * s + sway, -4 * s, i * 6 * s + sway * 1.6, -14 * s);
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(120,90,60,.6)';
        ctx.beginPath(); ctx.ellipse(6 * s, -13 * s, 2 * s, 4.5 * s, 0.2, 0, Math.PI * 2); ctx.fill();
        break;
      case 'fogPatch': {
        const drift = Math.sin(t * 0.4 + d.r * 7) * 30;
        ctx.globalAlpha = 0.10 + 0.05 * Math.sin(t * 0.7 + d.r * 5);
        ctx.fillStyle = '#a7f3d0';
        ctx.beginPath(); ctx.ellipse(drift, 0, 90 * s, 26 * s, 0, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'lilyDot':
        ctx.fillStyle = 'rgba(74,160,100,.5)';
        ctx.beginPath(); ctx.arc(0, 0, 3.4 * s, 0.3, Math.PI * 2); ctx.fill();
        break;
    }
    ctx.restore();
  }

  // 자연스러운 나무/장식 산포: 지터 격자 방식 (일정 간격 사선 배열 문제 해결)
  // 셀마다 랜덤 오프셋 + 셀 일부 생략 → 겹치지 않으면서 자연스러운 분포. 시드 고정.
  const scatterCache = {};
  window.scatterPointsV37 = function scatterPointsV37(key, count, w, h, margin) {
    const ck = key + '|' + count + '|' + w + 'x' + h;
    if (scatterCache[ck]) return scatterCache[ck];
    const rng = makeRng(key.split('').reduce((a, c) => a + c.charCodeAt(0) * 37, 63));
    const iw = w - margin * 2, ih = h - margin * 2;
    const cols = Math.max(2, Math.round(Math.sqrt(count * (iw / ih)) * 1.25));
    const rows = Math.max(2, Math.ceil((count * 1.5) / cols));
    const cells = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) cells.push([c, r]);
    }
    // 셀 셔플 후 앞에서 count개만 사용 (빈 곳이 자연스럽게 생김)
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = cells[i]; cells[i] = cells[j]; cells[j] = t;
    }
    const pts = [];
    for (let i = 0; i < Math.min(count, cells.length); i++) {
      const c = cells[i][0], r = cells[i][1];
      pts.push({
        x: margin + ((c + 0.18 + rng() * 0.64) / cols) * iw,
        y: margin + ((r + 0.18 + rng() * 0.64) / rows) * ih,
        s: 0.72 + rng() * 0.45,
      });
    }
    scatterCache[ck] = pts;
    return pts;
  };

  // game.js 지형 함수에서 호출 — 몬스터/NPC보다 아래 레이어
  window.drawMapDetailV36 = function drawMapDetailV36(mapKey) {
    try {
      if (typeof game === 'undefined' || !game.ctx || typeof worldToScreen !== 'function') return;
      const world = (window.YuksamData && window.YuksamData.worldDefs || {})[mapKey] || (typeof worldDefs !== 'undefined' ? worldDefs[mapKey] : null);
      if (!world) return;
      const key = mapKey;
      if (!cache[key]) cache[key] = buildDecor(key, world.width || 2400, world.height || 1600);
      const ctx = game.ctx;
      const t = performance.now() / 1000;
      const margin = 120;
      for (const d of cache[key]) {
        const p = worldToScreen(d.x, d.y);
        if (p.x < -margin || p.y < -margin || p.x > game.width + margin || p.y > game.height + margin) continue;
        drawOne(ctx, d, p.x, p.y, t);
      }
    } catch (err) {
      // 장식은 실패해도 게임에 영향 없어야 한다.
    }
  };
})();
