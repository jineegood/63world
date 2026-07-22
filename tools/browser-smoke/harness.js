// 공용 하네스: ROOT의 게임을 부팅하고 플레이어 생성 후 콜백 실행
module.exports = async function run(root, actions, options = {}) {
  const path = require('path');
  root ||= path.join(__dirname, '..', '..');
  const { JSDOM } = require(path.join(root, '.codex_work', 'browser-smoke', 'node_modules', 'jsdom'));
  const fs = require('fs');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const asyncErrors = [];
  window.addEventListener('error', (e) => asyncErrors.push(String(e.error && e.error.stack || e.message).split('\n')[0]));
  window.HTMLCanvasElement.prototype.getContext = function () {
    return new Proxy({}, {
      get: (t, prop) => {
        if (prop === 'canvas') return {};
        return (...a) => {
          if (['createLinearGradient','createRadialGradient','createPattern'].includes(prop)) return { addColorStop: () => {} };
          if (prop === 'measureText') return { width: 10 };
          return undefined;
        };
      },
      set: () => true,
    });
  };
  const gainStub = () => ({ connect(){}, gain: { value:1, setValueAtTime(){}, linearRampToValueAtTime(){}, exponentialRampToValueAtTime(){}, cancelScheduledValues(){} } });
  window.Audio = class { constructor(){ this.volume=1; this.currentTime=0; this.loop=false; } play(){ return Promise.resolve(); } pause(){} load(){} addEventListener(){} removeEventListener(){} };
  window.AudioContext = window.webkitAudioContext = class {
    constructor(){ this.state='running'; this.destination={}; this.currentTime=0; }
    resume(){ return Promise.resolve(); }
    createGain(){ return gainStub(); }
    createOscillator(){ return { connect(){}, start(){}, stop(){}, frequency:{ value:0, setValueAtTime(){}, linearRampToValueAtTime(){}, exponentialRampToValueAtTime(){} }, type:'' }; }
    createBufferSource(){ return { connect(){}, start(){}, stop(){}, buffer:null }; }
    createBuffer(){ return { getChannelData: () => new Float32Array(8) }; }
  };
  window.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 16);
  window.matchMedia = () => ({ matches:false, addListener(){}, addEventListener(){} });
  const fsPath = (s) => path.join(root, s);
  // index.html의 <script src="..."></script> 태그를 파싱해 로컬 스크립트를 순서대로 로드한다.
  // (하드코딩 대신 동적 파싱 — 앞으로 스크립트 파일이 늘어도 하네스 수정 불필요)
  const scriptSrcs = [...html.matchAll(/<script\s+src=["']([^"']+)["']/gi)]
    .map((m) => m[1])
    .filter((src) => !/^https?:\/\//i.test(src));
  // 브라우저의 클래식 스크립트는 top-level const/let/function 스코프를 공유한다.
  // jsdom의 개별 window.eval은 스코프가 분리되어 파일 간 참조(예: admin-dashboard.js -> game.js의 const $)가 깨진다.
  // 따라서 모든 로컬 스크립트를 순서대로 이어붙여 한 번에 eval 해 브라우저 시맨틱을 재현한다.
  const combined = scriptSrcs.map((s) => {
    let code = fs.readFileSync(fsPath(s), 'utf8');
    if (s.replace(/\\/g, '/') === 'src/cloud-config.js') {
      code = "window.YUKSAM_CLOUD = { url: '', anonKey: '' };";
    }
    if (s === 'game.js') code += '\n;window.__G = game;';
    return code;
  }).join('\n;\n');
  if (typeof options.beforeLoad === 'function') {
    await options.beforeLoad({ window });
  }
  window.eval(combined);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
  window.dispatchEvent(new window.Event('load'));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (id) => window.document.getElementById(id);
  const click = (id) => $(id).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await actions({ window, $, click, sleep, asyncErrors });
  return asyncErrors;
};
