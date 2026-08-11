import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const coreSourcePath = join(root, 'src', 'core-utils.js');
const preGameModulePaths = [
  'audio-defaults.js',
  'audio-manifest.js',
  'audio-dispatcher.js',
  'player-store.js',
  'input-router.js',
  'world-interaction-registry.js',
  'world-navigation-registry.js',
  'click-movement.js',
  'world-render-pipeline.js',
  'hud-update-pipeline.js',
  'total-stats-pipeline.js',
  'combat-entry-pipeline.js',
  'combat-frame-pipeline.js',
  'audio-volume-pipeline.js',
  'student-access-v2.js',
  'pvp-client.js',
];
const dataSourcePath = join(root, 'src', 'game-data.js');
const questDataSourcePath = join(root, 'src', 'quest-data.js');
const questTextSourcePath = join(root, 'src', 'quest-text.js');
const patchDataSourcePath = join(root, 'src', 'patch-data.js');
const gameplayPolishSourcePath = join(root, 'src', 'gameplay-polish-v2.js');
const costumeDataSourcePath = join(root, 'src', 'costume-data.js');
const combatRulesSourcePath = join(root, 'src', 'combat-rules.js');
const combatSequenceSourcePath = join(root, 'src', 'combat-sequence-controller.js');
const combatFxSourcePath = join(root, 'src', 'combat-fx.js');
const sourcePath = join(root, 'game.js');
const outputPath = join(root, 'data', 'game-data.snapshot.json');
const fixedNow = Date.parse('2026-07-03T00:00:00.000Z');

function createClassList() {
  const classes = new Set();
  return {
    add: (...names) => names.forEach((name) => classes.add(String(name))),
    remove: (...names) => names.forEach((name) => classes.delete(String(name))),
    toggle: (name, force) => {
      const key = String(name);
      const shouldAdd = force === undefined ? !classes.has(key) : !!force;
      if (shouldAdd) classes.add(key);
      else classes.delete(key);
      return shouldAdd;
    },
    contains: (name) => classes.has(String(name)),
  };
}

function createCanvasContext() {
  const gradient = { addColorStop() {} };
  const noop = () => undefined;
  return new Proxy({}, {
    get(_target, prop) {
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
      if (prop === 'measureText') return (text) => ({ width: String(text ?? '').length * 9 });
      if (prop === 'canvas') return { width: 1280, height: 720 };
      return noop;
    },
    set() {
      return true;
    },
  });
}

class StubElement {
  constructor(id = '', tagName = 'DIV') {
    this.id = id;
    this.tagName = tagName;
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.attributes = new Map();
    this.classList = createClassList();
    this.parentNode = null;
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
    this.checked = false;
    this.disabled = false;
    this.width = id.toLowerCase().includes('canvas') ? 1280 : 0;
    this.height = id.toLowerCase().includes('canvas') ? 720 : 0;
  }

  addEventListener() {}
  removeEventListener() {}
  focus() {}
  blur() {}
  play() { return Promise.resolve(); }
  pause() {}
  load() {}
  remove() {}
  click() {}
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  insertBefore(child) { return this.appendChild(child); }
  replaceWith() {}
  cloneNode() { return new StubElement(this.id, this.tagName); }
  querySelector() { return new StubElement('', 'DIV'); }
  querySelectorAll() { return []; }
  closest() { return null; }
  contains(node) { return this.children.includes(node); }
  setAttribute(name, value) { this.attributes.set(String(name), String(value)); }
  getAttribute(name) { return this.attributes.get(String(name)) ?? null; }
  removeAttribute(name) { this.attributes.delete(String(name)); }
  getContext() { return createCanvasContext(); }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.width || 1280, height: this.height || 720 }; }
}

class FixedDate extends Date {
  constructor(...args) {
    super(args.length ? args[0] : fixedNow);
  }

  static now() {
    return fixedNow;
  }
}

FixedDate.parse = Date.parse;
FixedDate.UTC = Date.UTC;

function createSandbox() {
  const elements = new Map();
  const localItems = new Map();
  let uuidCounter = 0;

  const document = {
    title: '',
    body: new StubElement('body', 'BODY'),
    head: new StubElement('head', 'HEAD'),
    activeElement: new StubElement('active', 'BODY'),
    createElement(tagName) {
      return new StubElement('', String(tagName).toUpperCase());
    },
    getElementById(id) {
      if (!elements.has(id)) {
        const tagName = String(id).toLowerCase().includes('canvas') ? 'CANVAS' : 'DIV';
        elements.set(id, new StubElement(id, tagName));
      }
      return elements.get(id);
    },
    querySelector() {
      return new StubElement('', 'DIV');
    },
    querySelectorAll(selector) {
      if (selector === '.classBtn') {
        return ['warrior', 'mage', 'priest'].map((klass) => {
          const el = new StubElement('', 'BUTTON');
          el.dataset.class = klass;
          return el;
        });
      }
      return [];
    },
    addEventListener() {},
    removeEventListener() {},
  };

  const sandbox = {
    console,
    document,
    localStorage: {
      get length() { return localItems.size; },
      getItem(key) { return localItems.has(key) ? localItems.get(key) : null; },
      setItem(key, value) { localItems.set(String(key), String(value)); },
      removeItem(key) { localItems.delete(String(key)); },
      key(index) { return [...localItems.keys()][index] ?? null; },
      clear() { localItems.clear(); },
    },
    navigator: { userAgent: 'snapshot' },
    location: { href: 'http://snapshot.local/' },
    performance: { now: () => 1000 },
    Date: FixedDate,
    Math: Object.create(Math),
    setTimeout: () => 1,
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    Audio: class {
      constructor(src = '') {
        this.src = src;
        this.loop = false;
        this.preload = '';
        this.volume = 1;
        this.currentTime = 0;
      }
      play() { return Promise.resolve(); }
      pause() {}
    },
    Image: class {},
    addEventListener() {},
    removeEventListener() {},
    crypto: {
      randomUUID: () => {
        uuidCounter += 1;
        return `snapshot-id-${String(uuidCounter).padStart(4, '0')}`;
      },
    },
  };

  sandbox.Math.random = () => 0.42;
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  return sandbox;
}

function clean(value) {
  return JSON.parse(JSON.stringify(value));
}

function rowsFromMonsterFactory(factory) {
  if (typeof factory !== 'function') return [];
  try {
    return JSON.parse(JSON.stringify(factory())).map((monster) => ({
      id: monster.id,
      type: monster.type,
      name: monster.name,
      level: monster.level,
      hp: monster.maxHp ?? monster.hp,
      exp: monster.exp,
      gold: monster.gold,
      attack: monster.attack,
      speed: monster.speed,
      aggro: monster.aggro,
      x: monster.spawnX ?? monster.x,
      y: monster.spawnY ?? monster.y,
    }));
  } catch {
    return [];
  }
}

const coreSource = await readFile(coreSourcePath, 'utf8');
const preGameModules = await Promise.all(preGameModulePaths.map(async (name) => ({
  name,
  source:await readFile(join(root, 'src', name), 'utf8'),
})));
const dataSource = await readFile(dataSourcePath, 'utf8');
const questDataSource = await readFile(questDataSourcePath, 'utf8');
const questTextSource = await readFile(questTextSourcePath, 'utf8');
const patchDataSource = await readFile(patchDataSourcePath, 'utf8');
const gameplayPolishSource = await readFile(gameplayPolishSourcePath, 'utf8');
const costumeDataSource = await readFile(costumeDataSourcePath, 'utf8');
const combatRulesSource = await readFile(combatRulesSourcePath, 'utf8');
const combatSequenceSource = await readFile(combatSequenceSourcePath, 'utf8');
const combatFxSource = await readFile(combatFxSourcePath, 'utf8');
const source = await readFile(sourcePath, 'utf8');
const exportScript = `
;globalThis.__YUKSAM_EXPORT__ = {
  meta: {
    sourceFile: 'game.js',
    detectedVersion: String(document.title || '').match(/v\\\\d+/)?.[0] || 'v35',
    generatedAt: new Date().toISOString()
  },
  classes: CLASS_META,
  levels: { xpRequirements: XP_REQUIREMENTS },
  items: ITEM_DEFS,
  skills: SKILL_DEFS,
  quests: QUEST_DEFS,
  worlds: worldDefs,
  questions: defaultQuestions,
  workbooks: defaultWorkbooks,
  pets: globalThis.PET_DEFS_V27 || {},
  tiers: globalThis.TIER_INFO_V27 || [],
  monsters: {
    forest: (${rowsFromMonsterFactory.toString()})(typeof createForestMonsters === 'function' ? createForestMonsters : null),
    desert: (${rowsFromMonsterFactory.toString()})(typeof createDesertMonsters === 'function' ? createDesertMonsters : null),
    swamp: (${rowsFromMonsterFactory.toString()})(typeof globalThis.createSwampMonsters === 'function' ? globalThis.createSwampMonsters : null)
  }
};`;

const sandbox = createSandbox();
vm.createContext(sandbox);
vm.runInContext(coreSource, sandbox, {
  filename: 'src/core-utils.js',
  timeout: 1000,
});
for (const module of preGameModules) {
  vm.runInContext(module.source, sandbox, {
    filename:`src/${module.name}`,
    timeout:1000,
  });
}
vm.runInContext(dataSource, sandbox, {
  filename: 'src/game-data.js',
  timeout: 1000,
});
vm.runInContext(questDataSource, sandbox, {
  filename: 'src/quest-data.js',
  timeout: 1000,
});
vm.runInContext(questTextSource, sandbox, {
  filename: 'src/quest-text.js',
  timeout: 1000,
});
vm.runInContext(patchDataSource, sandbox, {
  filename: 'src/patch-data.js',
  timeout: 1000,
});
vm.runInContext(gameplayPolishSource, sandbox, {
  filename: 'src/gameplay-polish-v2.js',
  timeout: 1000,
});
vm.runInContext(costumeDataSource, sandbox, {
  filename: 'src/costume-data.js',
  timeout: 1000,
});
vm.runInContext(combatRulesSource, sandbox, {
  filename: 'src/combat-rules.js',
  timeout: 1000,
});
vm.runInContext(combatSequenceSource, sandbox, {
  filename: 'src/combat-sequence-controller.js',
  timeout: 1000,
});
vm.runInContext(combatFxSource, sandbox, {
  filename: 'src/combat-fx.js',
  timeout: 1000,
});
vm.runInContext(`${source}\n${exportScript}`, sandbox, {
  filename: 'game.js',
  timeout: 5000,
});

const snapshot = clean(sandbox.__YUKSAM_EXPORT__);
snapshot.meta.generatedAt = new Date().toISOString();

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

console.log(`Wrote ${outputPath}`);
