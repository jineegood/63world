import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const snapshotPath = join(root, 'data', 'game-data.snapshot.json');
const sheetDir = join(root, '시트');
const outputPath = join(sheetDir, '육삼빌딩의_세계_게임데이터_마스터_v35.xlsx');
const oldPath = join(sheetDir, '육삼빌딩의_세계_게임데이터_마스터_v25.xlsx');

const snapshot = JSON.parse(await fs.readFile(snapshotPath, 'utf8'));

function json(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return JSON.stringify(value, null, 0);
}

function stat(value, key) {
  return value?.stats?.[key] ?? value?.baseStats?.[key] ?? '';
}

function reward(quest, key) {
  return quest?.reward?.[key] ?? '';
}

function toMatrix(title, description, headers, rows) {
  const width = headers.length;
  const pad = (row) => [...row, ...Array(Math.max(0, width - row.length)).fill('')].slice(0, width);
  return [
    pad([title]),
    pad([description]),
    pad([]),
    headers,
    ...rows.map(pad),
  ];
}

function applyBaseStyle(sheet, rowCount, colCount) {
  sheet.showGridLines = false;
  sheet.freezePanes.freezeRows(4);

  const title = sheet.getRangeByIndexes(0, 0, 1, colCount);
  title.format = {
    fill: '#102A43',
    font: { bold: true, color: '#FFFFFF' },
  };

  const subtitle = sheet.getRangeByIndexes(1, 0, 1, colCount);
  subtitle.format = {
    fill: '#D9EAF7',
    font: { color: '#102A43' },
  };

  const header = sheet.getRangeByIndexes(3, 0, 1, colCount);
  header.format = {
    fill: '#1F7A8C',
    font: { bold: true, color: '#FFFFFF' },
    borders: { preset: 'outside', style: 'thin', color: '#9FB3C8' },
  };

  if (rowCount > 4) {
    const body = sheet.getRangeByIndexes(4, 0, rowCount - 4, colCount);
    body.format = {
      borders: { preset: 'inside', style: 'thin', color: '#D9E2EC' },
      wrapText: true,
    };
  }

  const used = sheet.getRangeByIndexes(0, 0, rowCount, colCount);
  used.format.autofitColumns();
  used.format.autofitRows();
}

function addSheet(workbook, name, title, description, headers, rows) {
  const sheet = workbook.worksheets.add(name);
  const matrix = toMatrix(title, description, headers, rows);
  sheet.getRangeByIndexes(0, 0, matrix.length, headers.length).values = matrix;
  applyBaseStyle(sheet, matrix.length, headers.length);
  return sheet;
}

function objectEntries(object) {
  return Object.entries(object || {});
}

function sortedValues(object) {
  return objectEntries(object).map(([, value]) => value);
}

function flattenMonsters(monsters) {
  return Object.entries(monsters || {}).flatMap(([map, rows]) => (rows || []).map((monster) => ({ map, ...monster })));
}

function npcRows(worlds) {
  const rows = [];
  for (const [mapKey, world] of objectEntries(worlds)) {
    for (const [objectKey, value] of objectEntries(world)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      if (!('x' in value) && !('doorX' in value)) continue;
      rows.push([
        mapKey,
        objectKey,
        value.name || value.label || '',
        value.x ?? value.doorX ?? '',
        value.y ?? value.doorY ?? '',
        value.r ?? '',
        value.w ?? '',
        value.h ?? '',
        json(value),
      ]);
    }
  }
  return rows;
}

function assetRows() {
  return [
    ['login_bg.png', 'Image', '로그인 배경', 'assets/login_bg.png'],
    ['Path_to_the_Great_Oak.mp3', 'BGM', '고요한 숲', 'assets/Path_to_the_Great_Oak.mp3'],
    ['Noon_at_the_Dry_Well.mp3', 'BGM', '63마을', 'assets/Noon_at_the_Dry_Well.mp3'],
    ['Eight_Legged_Loop.mp3', 'BGM', '늪지', 'assets/Eight_Legged_Loop.mp3'],
    ['Bog_King_s_Advance.mp3', 'BGM', '보스/최종 보스', 'assets/Bog_King_s_Advance.mp3'],
    ['Where_Moss_Glows.mp3', 'BGM', '펫/상점 계열', 'assets/Where_Moss_Glows.mp3'],
    ['enhance_charge_3s.mp3', 'SFX', '강화 진행', 'assets/enhance_charge_3s.mp3'],
    ['enhance_success.mp3', 'SFX', '강화 성공', 'assets/enhance_success.mp3'],
    ['enhance_fail.mp3', 'SFX', '강화 실패', 'assets/enhance_fail.mp3'],
    ['pet_summon_chime.mp3', 'SFX', '펫 소환', 'assets/pet_summon_chime.mp3'],
    ['dragon-studio-opening-door-450444.mp3', 'SFX', '문 열기', 'assets/dragon-studio-opening-door-450444.mp3'],
    ['freesound_community-knife-slice-41231.mp3', 'SFX', '베기 공격', 'assets/freesound_community-knife-slice-41231.mp3'],
  ];
}

const workbook = Workbook.create();

addSheet(
  workbook,
  '00_대시보드',
  '육삼빌딩의 세계 게임 데이터 마스터 v35',
  `현재 game.js에서 ${snapshot.meta.generatedAt}에 추출한 데이터입니다. 구버전 v25 시트를 대체합니다.`,
  ['항목', '값', '메모'],
  [
    ['소스 파일', snapshot.meta.sourceFile, '브라우저 런타임 파일'],
    ['감지 버전', snapshot.meta.detectedVersion, 'document.title 기준'],
    ['직업 수', objectEntries(snapshot.classes).length, 'CLASS_META'],
    ['스킬 수', objectEntries(snapshot.skills).length, 'SKILL_DEFS 최종 상태'],
    ['아이템 수', objectEntries(snapshot.items).length, 'ITEM_DEFS 최종 상태'],
    ['맵 수', objectEntries(snapshot.worlds).length, 'worldDefs 최종 상태'],
    ['퀘스트 수', objectEntries(snapshot.quests).length, 'QUEST_DEFS 최종 상태'],
    ['기본 문제 수', snapshot.questions.length, 'defaultQuestions'],
    ['펫 수', objectEntries(snapshot.pets).length, 'PET_DEFS_V27 최종 상태'],
    ['강화 등급 수', snapshot.tiers.length, 'TIER_INFO_V27'],
  ],
);

addSheet(
  workbook,
  '01_수정가이드',
  '수정 가이드',
  '노란색으로 직접 표시하지는 않았지만, 이름/설명/수치/보상/가격 열을 우선 수정 대상으로 보면 됩니다.',
  ['구분', '수정 우선 열', '주의사항'],
  [
    ['ID/코드', 'ID는 가급적 유지', '코드에서 참조하는 값이므로 이름보다 위험합니다.'],
    ['밸런스 수치', '가격, EXP, Gold, HP, 공격력, 스킬 배율', '수정 후 테스트에서 전투/보상 검증이 필요합니다.'],
    ['표시 텍스트', '이름, 설명, 대화문', '가장 안전한 수정 영역입니다.'],
    ['온라인 전환', '서버 권한 여부', '보상/강화/펫/전투 판정은 서버에서 처리해야 합니다.'],
  ],
);

addSheet(
  workbook,
  '02_직업전문화',
  '직업과 전문화',
  'CLASS_META 기준 직업 기본 정보입니다.',
  ['직업코드', '직업명', '전문화', '기본무기', '힘', '지능', '정신', '체력', '대표색'],
  objectEntries(snapshot.classes).flatMap(([code, meta]) => (meta.specs || []).map((spec) => [
    code,
    meta.name,
    spec,
    meta.weapon,
    meta.baseStats?.['힘'] ?? '',
    meta.baseStats?.['지능'] ?? '',
    meta.baseStats?.['정신'] ?? '',
    meta.baseStats?.['체력'] ?? '',
    meta.color,
  ])),
);

addSheet(
  workbook,
  '03_레벨경험치',
  '레벨 경험치',
  'XP_REQUIREMENTS 기준입니다.',
  ['레벨', '다음 레벨 필요 EXP', '누적 스킬포인트 추정', '전문화 선택 가능'],
  objectEntries(snapshot.levels.xpRequirements).map(([level, exp]) => [
    Number(level),
    exp,
    Math.max(0, Number(level) - 1),
    Number(level) >= 5 ? '가능' : '불가',
  ]),
);

addSheet(
  workbook,
  '04_스킬트리',
  '스킬트리',
  'SKILL_DEFS 최종 상태입니다. v24 플래그가 있는 스킬이 현재 주력 스킬트리입니다.',
  ['스킬ID', '직업', '전문화', '라인', '아이콘', '스킬명', '구분', '비용', '최대포인트', '선행조건', '액티브', '쿨타임', '효과', '설명'],
  sortedValues(snapshot.skills).map((skill) => [
    skill.id,
    skill.classOnly || '',
    skill.specOnly || '공용',
    skill.line ?? '',
    skill.icon || '',
    skill.name,
    skill.kind || '',
    skill.cost ?? '',
    skill.maxPoints ?? '',
    json(skill.prereq || skill.prereqAny || skill.prereqPoints || skill.prereqTotal || ''),
    skill.active?.name || '',
    skill.active?.cooldown ?? '',
    json(skill.active || skill.bonuses || skill.passiveText || ''),
    skill.desc || '',
  ]),
);

addSheet(
  workbook,
  '05_아이템장비',
  '아이템과 장비',
  'ITEM_DEFS 최종 상태입니다.',
  ['아이템ID', '이름', '슬롯', '직업제한', 'Gold가격', '빌딩가격', '레벨제한', '힘', '지능', '정신', '체력', '비주얼', '설명'],
  objectEntries(snapshot.items).map(([id, item]) => [
    id,
    item.name,
    item.slot,
    item.classOnly || '',
    item.price ?? '',
    item.buildingPrice ?? '',
    item.levelReq ?? '',
    stat(item, '힘'),
    stat(item, '지능'),
    stat(item, '정신'),
    stat(item, '체력'),
    item.visual || '',
    item.desc || '',
  ]),
);

addSheet(
  workbook,
  '06_지역월드',
  '지역과 월드',
  'worldDefs 최종 상태입니다.',
  ['맵키', '표시명', '폭', '높이', '스폰X', '스폰Y', 'zoneKey', '출구/포탈', '주요 오브젝트 JSON'],
  objectEntries(snapshot.worlds).map(([key, world]) => [
    key,
    world.label,
    world.width,
    world.height,
    world.playerSpawn?.x ?? '',
    world.playerSpawn?.y ?? '',
    world.zoneKey || '',
    json({ exit: world.exit, portal: world.portal }),
    json(world),
  ]),
);

addSheet(
  workbook,
  '07_몬스터',
  '몬스터 샘플',
  '현재 몬스터 생성 함수에서 deterministic snapshot으로 추출한 샘플입니다.',
  ['맵', '몬스터ID', '타입', '이름', '레벨', 'HP', '공격력', 'EXP', 'Gold', '속도', '감지거리', '스폰X', '스폰Y'],
  flattenMonsters(snapshot.monsters).map((monster) => [
    monster.map,
    monster.id,
    monster.type,
    monster.name,
    monster.level,
    monster.hp,
    monster.attack,
    monster.exp,
    monster.gold,
    monster.speed,
    monster.aggro,
    monster.x,
    monster.y,
  ]),
);

addSheet(
  workbook,
  '08_퀘스트',
  '퀘스트',
  'QUEST_DEFS 최종 상태입니다.',
  ['퀘스트ID', '제목', '대상', '목표수', '설명', '보상EXP', '보상Gold', '보상빌딩', '대화문'],
  objectEntries(snapshot.quests).map(([id, quest]) => [
    id,
    quest.title,
    json(quest.targetTypes || quest.targetType || ''),
    quest.target ?? '',
    quest.desc || '',
    reward(quest, 'exp'),
    reward(quest, 'gold'),
    reward(quest, 'building'),
    json(quest.pages || []),
  ]),
);

addSheet(
  workbook,
  '09_문제집',
  '문제집',
  '기본 내장 문제집입니다.',
  ['문제집ID', '이름', 'zone', '과목', '프롬프트', '문항수', '생성시각'],
  snapshot.workbooks.map((workbookDef) => [
    workbookDef.id,
    workbookDef.name,
    workbookDef.zone,
    workbookDef.subject,
    workbookDef.prompt,
    workbookDef.questions?.length ?? 0,
    workbookDef.createdAt,
  ]),
);

addSheet(
  workbook,
  '10_문제',
  '기본 문제',
  'defaultQuestions 기준입니다.',
  ['문제ID', 'zone', '문제집ID', '문제', '정답', '보기', '출처'],
  snapshot.questions.map((question) => [
    question.id,
    question.zone,
    question.workbookId || '',
    question.q,
    question.answer,
    json(question.choices || ''),
    question.source,
  ]),
);

addSheet(
  workbook,
  '11_NPC오브젝트',
  'NPC와 오브젝트',
  'worldDefs 안의 좌표성 오브젝트를 펼친 목록입니다.',
  ['맵키', '오브젝트키', '이름', 'x', 'y', 'r', 'w', 'h', '원본JSON'],
  npcRows(snapshot.worlds),
);

addSheet(
  workbook,
  '12_펫',
  '펫',
  'PET_DEFS_V27 최종 상태입니다.',
  ['펫ID', '이름', '아이콘', '전설', '힘', '지능', '정신', '체력', '색상', '설명'],
  objectEntries(snapshot.pets).map(([id, pet]) => [
    id,
    pet.name,
    pet.icon,
    pet.legendary ? '예' : '',
    stat(pet, '힘'),
    stat(pet, '지능'),
    stat(pet, '정신'),
    stat(pet, '체력'),
    pet.color,
    pet.desc,
  ]),
);

addSheet(
  workbook,
  '13_강화등급',
  '강화 등급',
  'TIER_INFO_V27 최종 상태입니다.',
  ['등급', '이름', 'CSS클래스', '색상', '다음 등급 성공률'],
  snapshot.tiers.map((tier, index) => [
    index,
    tier.name,
    tier.cls,
    tier.color,
    tier.chance == null ? '' : tier.chance,
  ]),
);

addSheet(
  workbook,
  '14_오디오에셋',
  '오디오와 이미지 에셋',
  '현재 소스에서 참조되는 주요 에셋입니다.',
  ['파일명', '종류', '사용처', '경로'],
  assetRows(),
);

addSheet(
  workbook,
  '15_온라인전환',
  '온라인 전환 설계 메모',
  '30명 접속형 웹앱으로 바꿀 때 서버가 책임져야 할 데이터입니다.',
  ['영역', '현재 위치', '온라인 전환 방향', '우선순위'],
  [
    ['로그인/비밀번호', 'localStorage 평문', '서버 인증 + bcrypt/argon2 해시', '상'],
    ['캐릭터 저장', 'ysb_player_{name}', 'users/characters 테이블', '상'],
    ['전투 보상', '클라이언트 계산', '서버 권한 판정 + battle_logs', '상'],
    ['강화/펫 확률', '클라이언트 Math.random', '서버 권한 RNG + 결과 로그', '상'],
    ['문제집', 'localStorage', 'question_workbooks/questions 테이블', '상'],
    ['채팅', '메모리 배열', 'Socket.IO room 기반 실시간 채팅', '중'],
    ['위치 동기화', '클라이언트 단독', '낮은 빈도 위치 브로드캐스트', '중'],
  ],
);

addSheet(
  workbook,
  '16_시트목록',
  '시트 목록',
  'v35 마스터 파일에 포함된 시트입니다.',
  ['시트명', '설명'],
  [
    ['00_대시보드', '현재 스냅샷 요약'],
    ['01_수정가이드', '수정 우선순위와 주의사항'],
    ['02_직업전문화', '직업, 전문화, 기본 능력치'],
    ['03_레벨경험치', '레벨별 필요 EXP'],
    ['04_스킬트리', '스킬 정의'],
    ['05_아이템장비', '아이템과 장비'],
    ['06_지역월드', '맵과 월드 정의'],
    ['07_몬스터', '몬스터 생성 샘플'],
    ['08_퀘스트', '퀘스트 체인'],
    ['09_문제집', '기본 문제집'],
    ['10_문제', '기본 문제'],
    ['11_NPC오브젝트', 'NPC와 상호작용 오브젝트'],
    ['12_펫', '펫 정의'],
    ['13_강화등급', '장비 강화 등급'],
    ['14_오디오에셋', '에셋 목록'],
    ['15_온라인전환', '온라인화 설계 메모'],
  ],
);

await fs.mkdir(sheetDir, { recursive: true });
const preview = await workbook.render({
  sheetName: '00_대시보드',
  autoCrop: 'all',
  scale: 1,
  format: 'png',
});
await fs.writeFile(join(sheetDir, '육삼빌딩의_세계_게임데이터_마스터_v35_preview.png'), new Uint8Array(await preview.arrayBuffer()));

const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(outputPath);

if (existsSync(oldPath)) {
  await fs.unlink(oldPath);
}

console.log(`Wrote ${outputPath}`);
