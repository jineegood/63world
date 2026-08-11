// v41 연출/UI 검증: 궁극기 오버레이 / 치트 꾸러미 / 스킬포인트 힌트 / 부활 연출
const path = require('path');
const run = require(path.join(__dirname, 'harness.js'));
const root = process.argv[2] || path.join(__dirname, '..', '..');
run(root, async ({ window, $, click, sleep, asyncErrors }) => {
  const G = () => window.__G;
  let pass = 0, fail = 0;
  const chk = (cond, name, extra) => { if (cond) { pass++; console.log('PASS:', name, extra || ''); } else { fail++; console.log('FAIL:', name, extra || ''); } };

  $('loginName').value = '연출검증'; $('loginPassword').value = '1';
  click('studentLoginBtn'); await sleep(1300);
  // 전사로 생성 (기본 선택이 warrior)
  click('createCharacterBtn'); await sleep(2600);
  chk(G().player && G().player.name === '연출검증', '플레이어 생성', 'class=' + G().player?.class);

  // ===== (a) 궁극기 오버레이 생성 → 자동 제거 =====
  chk(typeof window.playUltimateFxV41 === 'function', 'playUltimateFxV41 전역 노출');
  window.playUltimateFxV41('mage_fire_meteor_v24');
  let overlay = window.document.querySelector('.ultimate-fx-overlay');
  chk(!!overlay, '오버레이 생성됨', overlay ? overlay.className : '없음');
  chk(overlay && overlay.querySelectorAll('.uf-meteor-ball').length > 0, '메테오 파티클 존재', overlay ? 'n=' + overlay.querySelectorAll('.uf-meteor-ball').length : '');
  chk(overlay && overlay.style.pointerEvents !== 'auto', '오버레이 pointer-events 차단(pointer-events:none)');
  await sleep(1600);
  chk(!window.document.querySelector('.ultimate-fx-overlay'), '1.6초 내 오버레이 자동 제거');

  // ===== (c) 스킬포인트 인라인 안내 =====
  chk(typeof window.__skillPointHintTickV42 === 'function', '스킬포인트 힌트 모듈 로드');
  G().player.level = 3;
  G().player.skills = {};
  click('openSkillTreeBtn');
  let bubble = window.document.querySelector('.skill-window-v35 .skillpoint-hint-v42');
  chk(!!bubble, 'skillPoints>0 → 스킬창 하단 안내 표시');
  G().player.level = 1;
  click('openSkillTreeBtn');
  bubble = window.document.querySelector('.skill-window-v35 .skillpoint-hint-v42');
  chk(!bubble, 'skillPoints=0 → 스킬창 안내 숨김');
  G().player.level = 10;
  G().player.spec = '방어';

  // ===== (b1) 치트 패널 토글로 버튼 9개 노출 =====
  /* 치트 패널과 각 치트 버튼은 이제 교사 서버 인증(requireTeacherCheatAccessV3)을 통과해야 열리고,
     그래서 모든 처리가 async가 되었다. 여기서는 "인증을 통과한 교사"를 가정하고 치트 동작만 본다.
     인증을 반드시 거치는지는 tests/combat-flow.test.mjs가 소스에서 따로 확인한다. */
  window.requireTeacherCheatAccessV3 = async () => true;

  const toggle = window.document.getElementById('cheatToggleBtn');
  chk(!!toggle, '치트 토글 버튼 존재');
  const panel = window.document.getElementById('cheatPanel');
  chk(panel && panel.classList.contains('hidden'), '초기 패널 접힘');
  toggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(20); // 교사 인증 확인이 async라 한 틱 기다린다
  chk(panel && !panel.classList.contains('hidden'), '토글 후 패널 펼침');
  const btnCount = panel ? panel.querySelectorAll('.cheat-panel-grid button').length : 0;
  chk(btnCount === 14, '치트 버튼 14개 노출', 'n=' + btnCount);

  // ===== (b2) 퀘스트 즉시 완료: accepted → ready =====
  const qid = Object.keys(window.QUEST_DEFS || {})[0] || 'testQuest';
  G().player.quests = G().player.quests || {};
  G().player.quests[qid] = { id: qid, status: 'accepted', progress: 0, target: 3, acceptedAt: Date.now() };
  window.document.getElementById('cheatCompleteQuestBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(20);
  chk(G().player.quests[qid].status === 'ready', '퀘스트 즉시완료 accepted→ready', 'status=' + G().player.quests[qid].status);

  // ===== 전투 진입 =====
  window.enterForest(); await sleep(1600);
  const m0 = (G().forestMonsters || []).find((m) => !m.dead);
  chk(!!m0, '숲 몬스터 존재');
  G().player.x = m0.x; G().player.y = m0.y;
  await sleep(800);
  chk(G().modalState?.type === 'combat', '전투 모달 진입', 'type=' + G().modalState?.type);
  // 행동 선택(공격)으로 문제 출제
  // Exercise the fatal counterattack path directly: the old question-selection loop
  // could finish before the combat intro made an answer input available.

  // ===== (b3) 몬스터 즉시 처치 (전투 중) =====
  const cm = window.currentCombatMonster ? window.currentCombatMonster() : null;
  chk(!!cm, '현재 전투 몬스터 접근');
  window.document.getElementById('cheatKillMonsterBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(20);
  chk(cm && (cm.dying === true || cm.hp === 0), '몬스터 즉시 처치(죽음 처리)', cm ? 'dying=' + cm.dying + ' hp=' + cm.hp : '');
  await sleep(3300); // 처치 시퀀스 정리 대기

  // ===== (d) 수호자의 맹세 부활: 전용 오디오 + 애니 클래스 =====
  // 새 전투 진입
  window.enterForest(); await sleep(1400);
  const m1 = (G().forestMonsters || []).find((m) => !m.dead && !m.dying && m.alive !== false);
  chk(!!m1, '부활용 몬스터 존재');
  G().player.x = m1.x; G().player.y = m1.y;
  await sleep(800);
  if (!G().currentQuestion) {
    const btn = window.document.querySelector('#modalContent button.primary, #modalContent .combat-menu button');
    if (btn) { window.eval(btn.getAttribute('onclick')); await sleep(400); }
  }
  // 부활 스킬 학습 + 빈사 상태 세팅
  G().player.skills = Object.assign({}, G().player.skills, { warrior_def_bastion: 1 });
  G().bastionUsed = false;
  G().combatShield = 0;
  G().player.hp = 1;
  m1.attack = Math.max(999999, Number(m1.attack || 0));
  // Audio 생성 스파이 설치
  const audioSrcs = [];
  const OrigAudio = window.Audio;
  window.Audio = function SpyAudio(src) { audioSrcs.push(String(src || '')); return new OrigAudio(src); };
  window.Audio.prototype = OrigAudio.prototype;
  const nativeRandom = window.Math.random;
  window.Math.random = () => 0.99;
  window.monsterCounterAttack('');
  window.Math.random = nativeRandom;
  const revived = G().bastionUsed === true && G().player.hp > 0;
  let spriteRevive = null;
  let guardianAudioPlayed = false;
  for (let attempt = 0; attempt < 80 && !(spriteRevive && guardianAudioPlayed); attempt += 1) {
    spriteRevive = window.document.querySelector('.combat-player.guardian-oath-revive');
    guardianAudioPlayed ||= audioSrcs.filter((src) => src.includes('수호자의 맹세 소리')).length === 1;
    if (!(spriteRevive && guardianAudioPlayed)) await sleep(100);
  }
  chk(revived, '수호자의 맹세 부활 발동(bastionUsed)');
  chk(!!spriteRevive, '부활 스프라이트 애니 클래스 부여(.guardian-oath-revive)');
  chk(guardianAudioPlayed, '수호자의 맹세 오디오가 한 번 생성됨', 'srcs=' + JSON.stringify(audioSrcs.filter((s)=>s.indexOf('.mp3')>=0)));
  window.Audio = OrigAudio;

  await sleep(300);
  console.log('----');
  console.log('요약: PASS=' + pass + ' FAIL=' + fail);
  console.log(asyncErrors.length ? '!!! 비동기 오류 ' + asyncErrors.length + '건: ' + asyncErrors.slice(0, 3).join(' || ') : '비동기 오류 없음');
  process.exit(fail === 0 && asyncErrors.length === 0 ? 0 : 1);
}).catch((e) => { console.log('!!! 하네스 실패:', String(e && e.stack || e).split('\n').slice(0, 4).join(' / ')); process.exit(1); });
