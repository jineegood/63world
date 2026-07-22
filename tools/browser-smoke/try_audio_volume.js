const run = require(require('path').join(__dirname, 'harness.js'));
const root = process.argv[2];

let pass = 0;
let fail = 0;
function check(name, condition, detail = '') {
  if (condition) {
    pass += 1;
    console.log(`PASS: ${name}${detail ? ` | ${detail}` : ''}`);
  } else {
    fail += 1;
    console.log(`FAIL: ${name}${detail ? ` | ${detail}` : ''}`);
  }
}

run(root, async ({ window, sleep, asyncErrors }) => {
  const G = window.__G;
  const created = [];
  window.Audio = class TrackedAudio {
    constructor(src = '') {
      this.src = src;
      this.volume = 1;
      this.currentTime = 0;
      this.loop = false;
      this.preload = '';
      created.push(this);
    }
    play() { return Promise.resolve(); }
    pause() {}
    load() {}
    addEventListener() {}
    removeEventListener() {}
  };

  const targets = [];
  const file = (src) => ({ src, volume:1, currentTime:0, play:() => Promise.resolve(), pause(){} });
  G.audio = {
    ctx:{ currentTime:12 },
    bgmGain:{ gain:{ setTargetAtTime:(value, time, constant) => targets.push({ value, time, constant }) } },
    file:file('town'), forestFile:file('forest'), desertFile:file('desert'), doorFile:null,
    swampFile:null, bossFile:null, criticalFile:null, upgradeChargeFile:null,
    upgradeSuccessFile:null, upgradeFailFile:null, petSummonFile:null,
    upgradeSuccessFileV33:false, upgradeFailFileV33:false,
  };
  Object.assign(G.settings, { bgmEnabled:true, bgmVolume:.37, sfxEnabled:true, sfxVolume:.64 });

  window.updateAudioVolumes();
  const bgmFiles = [G.audio.file, G.audio.forestFile, G.audio.desertFile, G.audio.swampFile, G.audio.bossFile];
  const sfxFiles = [G.audio.criticalFile, G.audio.upgradeChargeFile, G.audio.upgradeSuccessFile, G.audio.upgradeFailFile, G.audio.petSummonFile];
  const src = (key) => window.getAudioAsset?.(key)?.src || '';

  check('base BGM gain receives the configured raw value', targets.length === 1 && targets[0].value === .37 && targets[0].time === 12 && targets[0].constant === .04, JSON.stringify(targets));
  check('swamp and boss BGM are lazily initialized with BGM semantics', !!G.audio.swampFile && !!G.audio.bossFile && G.audio.swampFile.loop && G.audio.bossFile.loop && G.audio.swampFile.preload === 'auto' && G.audio.bossFile.preload === 'auto');
  check('all BGM file volumes use the configured value', bgmFiles.every((audio) => audio.volume === .37), bgmFiles.map((audio) => audio.volume).join(','));
  check('volume update does not lazily create the door file', G.audio.doorFile === null);
  check('critical, upgrade, and pet SFX are lazily initialized', sfxFiles.every(Boolean));
  check('all initialized SFX volumes use the configured value', sfxFiles.every((audio) => audio.volume === .64), sfxFiles.map((audio) => audio.volume).join(','));
  check('V33 replaces upgrade success and failure exactly once', G.audio.upgradeSuccessFileV33 === true && G.audio.upgradeFailFileV33 === true && created.filter((audio) => audio.src === src('upgradeSuccess')).length === 2 && created.filter((audio) => audio.src === src('upgradeFail')).length === 2, `created=${created.length}`);

  const identities = {
    swamp:G.audio.swampFile, boss:G.audio.bossFile, critical:G.audio.criticalFile,
    charge:G.audio.upgradeChargeFile, success:G.audio.upgradeSuccessFile,
    fail:G.audio.upgradeFailFile, pet:G.audio.petSummonFile,
  };
  const createdAfterFirst = created.length;
  window.updateAudioVolumes();
  check('repeated updates reuse every lazily initialized object', created.length === createdAfterFirst && Object.entries(identities).every(([key, value]) => G.audio[key === 'charge' ? 'upgradeChargeFile' : key === 'success' ? 'upgradeSuccessFile' : key === 'fail' ? 'upgradeFailFile' : key === 'pet' ? 'petSummonFile' : `${key}File`] === value));

  G.audio.doorFile = file('door');
  Object.assign(G.settings, { bgmEnabled:false, sfxEnabled:false });
  window.updateAudioVolumes();
  check('disabled BGM zeros gain and every BGM file', targets.at(-1).value === 0 && bgmFiles.every((audio) => audio.volume === 0));
  check('disabled SFX zeros door and every initialized SFX file', G.audio.doorFile.volume === 0 && sfxFiles.every((audio) => audio.volume === 0));

  Object.assign(G.settings, { bgmEnabled:true, bgmVolume:2, sfxEnabled:true, sfxVolume:-1 });
  window.updateAudioVolumes();
  check('file volumes clamp while the WebAudio target preserves its raw policy', targets.at(-1).value === 2 && bgmFiles.every((audio) => audio.volume === 1) && G.audio.doorFile.volume === 0 && sfxFiles.every((audio) => audio.volume === 0));

  await sleep(40);
  check('audio volume smoke has no async errors', asyncErrors.length === 0, asyncErrors.join(' | '));
  console.log(`RESULT: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 && asyncErrors.length === 0 ? 0 : 1);
}).catch((error) => {
  console.log(String(error?.stack || error));
  process.exit(1);
});
