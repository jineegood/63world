import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync as readFileRaw, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const readFileSync = (path, options) => readFileRaw(path, options).replace(/\r\n/g, '\n');
const hallSource = readFileSync(join(root, 'src', 'hall-of-fame.js'), 'utf8');
const studentAccessSource = readFileSync(join(root, 'src', 'student-access-v2.js'), 'utf8');
const style = readFileSync(join(root, 'style.css'), 'utf8');
const rankingMigration = readFileSync(join(
  root, 'supabase', 'migrations', '202608280003_hall_rankings_v1.sql',
), 'utf8');

function latestHallOfFameSql() {
  const dir = join(root, 'supabase', 'migrations');
  const files = readdirSync(dir).filter((name) => name.endsWith('.sql')).sort();
  let latest = '';
  for (const name of files) {
    const sql = readFileSync(join(dir, name), 'utf8');
    if (/create or replace function public\.load_hall_of_fame_v4/.test(sql)) latest = sql;
  }
  return latest;
}

test('명예의 전당 v4는 보호된 이름과 여섯 TOP 5의 공통 시각 정보를 내려 준다', () => {
  const sql = latestHallOfFameSql();
  assert.notEqual(sql, '', 'load_hall_of_fame_v4 마이그레이션을 찾지 못했다');
  assert.match(sql, /'name', ranked\.display_name/);
  assert.match(sql, /v_scope not in \('all', 'warrior', 'mage', 'priest', 'raid', 'pvp'\)/i);
  assert.match(sql, /profile\.data ->> 'class' in \('warrior', 'mage', 'priest'\)/i);
  assert.match(sql, /v_scope = 'all' or profile\.data ->> 'class' = v_scope[\s\S]*limit 5/i,
    '직업 필터를 적용한 다음 다섯 명만 뽑아야 한다');
  assert.match(sql, /'weaponUpgrades'/, '무기 강화 정보가 빠지면 색이 보이지 않는다');
  assert.match(sql, /'activePet'/, '펫 정보가 빠지면 펫이 보이지 않는다');
  assert.match(sql, /'nameplate'[\s\S]*'theme'/, '장착 이름표가 빠지면 스킨을 그릴 수 없다');
  assert.match(sql, /profile\.data <> '\{\}'::jsonb/, '캐릭터가 없는 빈 프로필은 제외해야 한다');
  assert.match(sql, /if auth\.uid\(\) is null then[\s\S]*errcode = '42501'/i);
  assert.match(sql, /revoke all on function public\.load_hall_of_fame_v4\(text\)[\s\S]*from public, anon/i);
  assert.match(sql, /grant execute on function public\.load_hall_of_fame_v4\(text\)[\s\S]*to authenticated/i);
});

test('학생 접근 경계는 허용된 여섯 scope만 v4 RPC에 전달하고 시각·랭킹 필드를 보존한다', () => {
  assert.match(studentAccessSource, /new Set\(\['all', 'warrior', 'mage', 'priest', 'raid', 'pvp'\]\)/);
  assert.match(studentAccessSource, /loadHallOfFame\(scope = 'all'\)/);
  assert.match(studentAccessSource, /client\.rpc\('load_hall_of_fame_v4', \{[\s\S]*p_scope:normalizedScope/);
  for (const field of [
    'appearance', 'equipment', 'costume', 'weaponUpgrades', 'activePet', 'nameplate',
    'floorGroup', 'reachedFloor', 'encounterIndex', 'cleared', 'wins', 'losses',
  ]) {
    assert.match(
      studentAccessSource,
      new RegExp(`(?:${field}:|result\\.${field}\\s*=)`),
      `${field} sanitizer가 빠졌다`,
    );
  }
});

test('명예의 전당은 전체·세 직업·던전·PvP TOP 5 버튼과 새 무대 그래픽을 제공한다', () => {
  for (const id of ['all', 'warrior', 'mage', 'priest', 'raid', 'pvp']) {
    assert.match(hallSource, new RegExp(`id:'${id}'`));
  }
  assert.match(hallSource, /label:'던전 진행'/);
  assert.match(hallSource, /label:'PvP'/);
  assert.match(hallSource, /data-hof-scope-v58/);
  assert.match(hallSource, /aria-pressed/);
  assert.match(hallSource, /hof-stage-v58/);
  assert.match(hallSource, /hof-spotlights-v58/);
  assert.match(hallSource, /\[3, 1, 0, 2, 4\]/);
  assert.match(style, /\.modal-box:has\(\.hof-shell-v58\)/);
  assert.match(style, /\.hof-podium-v58/);
  assert.match(style, /\.hof-board-v58[\s\S]*overflow-x:\s*auto/);
});

test('던전 진행 원장은 학생에게 잠겨 있고 실제 cleared/wiped 방 전이만 멤버별 UPSERT한다', () => {
  assert.match(rankingMigration, /create table if not exists public\.raid_best_progress_v1/i);
  assert.match(rankingMigration, /floor_group[\s\S]*reached_floor[\s\S]*encounter_index[\s\S]*cleared/i);
  assert.match(rankingMigration, /encounter_index smallint not null check \(encounter_index between 0 and 4\)/i);
  assert.match(rankingMigration, /enable row level security[\s\S]*force row level security/i);
  assert.match(rankingMigration, /revoke all on table public\.raid_best_progress_v1[\s\S]*public, anon, authenticated/i);
  assert.doesNotMatch(rankingMigration, /grant\s+(?:select|insert|update|delete)[^;]*raid_best_progress_v1[^;]*authenticated/i);
  assert.match(rankingMigration, /new\.phase in \('cleared', 'wiped'\)[\s\S]*old\.phase is distinct from new\.phase/i);
  assert.match(rankingMigration, /from public\.raid_room_members_v1 member[\s\S]*where member\.room_id = new\.id[\s\S]*and member\.active[\s\S]*on conflict \(user_id\) do update/i);
  assert.match(rankingMigration, /after update of phase on public\.raid_rooms_v1/i);
  assert.match(rankingMigration, /where room\.phase in \('cleared', 'wiped'\)[\s\S]*best_historical_progress[\s\S]*on conflict \(user_id\) do update/i);
  assert.match(rankingMigration, /member\.active[\s\S]*member\.left_at >= coalesce\(room\.finished_at/i,
    '과거 방은 종결 시점까지 남아 있던 멤버만 복원해야 한다');
  assert.doesNotMatch(rankingMigration, /private_teacher_advance_raid_progress_v1/i,
    'teacher +10 함수와 던전 랭킹 원장을 연결하면 안 된다');
});

test('던전은 더 깊은 몬스터 도전을 우선하고 PvP는 서버 승패만 정렬한다', () => {
  assert.match(rankingMigration, /order by progress\.user_id,[\s\S]*progress\.floor_group desc,[\s\S]*progress\.reached_floor desc,[\s\S]*progress\.encounter_index desc,[\s\S]*progress\.cleared desc/i);
  assert.match(rankingMigration, /order by progress\.floor_group desc,[\s\S]*progress\.reached_floor desc,[\s\S]*progress\.encounter_index desc,[\s\S]*progress\.cleared desc[\s\S]*limit 5/i);
  assert.match(rankingMigration, /from public\.pvp_records_v1 record/i);
  assert.match(rankingMigration, /where record\.wins \+ record\.losses > 0/i);
  assert.match(rankingMigration, /order by record\.wins desc, record\.losses asc[\s\S]*limit 5/i);
  assert.match(rankingMigration, /record\.updated_at asc, profile\.user_id/i,
    '완전 동률이어도 TOP 5 순서가 흔들리면 안 된다');
  assert.match(hallSource, /\$\{encounter \+ 1\}번째 몬스터 도전/);
  assert.match(hallSource, /PVP \$\{wins\.toLocaleString\('ko-KR'\)\}승/);
});

test('명예의 전당이 무기·펫 다음에 별도 캔버스로 실제 장착 이름표를 그린다', () => {
  assert.match(hallSource, /weaponTierStyle:call\('getEquippedWeaponTierStyle'\)/);
  assert.match(hallSource, /draw\(ctx, canvas\.width \/ 2[\s\S]*?remote:true,[\s\S]*?attack:0/,
    '다른 학생은 remote sprite로 그려 로컬 레벨업 오라를 복제하지 않아야 한다');
  assert.match(hallSource, /function drawPetBeside\(/);
  assert.match(hallSource, /PET_DEFS_V27/);
  assert.match(hallSource, /id="hofNameplateV58_\$\{rank\}"/);
  assert.match(hallSource, /YuksamPlayerNameplateV1/);
  assert.match(hallSource, /renderer\.draw\(ctx, canvas\.width \/ 2, NAMEPLATE_DRAW_Y, player, \{ source:'remote' \}\)/);
  const pet = hallSource.indexOf('drawPetBeside(ctx, canvas, player, rank');
  const player = hallSource.indexOf('draw(ctx, canvas.width / 2');
  const nameplate = hallSource.indexOf('drawHallNameplate(player, rank)', player);
  assert.ok(pet > -1 && player > pet && nameplate > player, '펫 → 캐릭터 → 이름표 순서여야 한다');
  assert.match(hallSource, /pet\.legendary/);
  assert.match(hallSource, /const NAMEPLATE_H = 76/);
  assert.match(hallSource, /const NAMEPLATE_DRAW_Y = -38/);
});

test('명예의 전당 캐릭터는 기존 1cm 상승 위치를 유지한다', () => {
  assert.match(hallSource, /const HALL_AVATAR_RAISE_Y = 38;/);
  assert.match(hallSource, /const CANVAS_H = 210 \+ HALL_AVATAR_RAISE_Y/);
  assert.match(hallSource, /margin-top:-\$\{HALL_AVATAR_RAISE_Y\}px/);
  assert.match(hallSource, /canvas\.height - 58 - HALL_AVATAR_RAISE_Y/);
  assert.match(hallSource, /canvas\.height - 66 - HALL_AVATAR_RAISE_Y \+ bob/);
  assert.match(hallSource, /canvas\.height - 46 - HALL_AVATAR_RAISE_Y/);
});

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

function player(name, klass) {
  return {
    name, class:klass, spec:null, level:5, exp:100,
    appearance:{}, equipment:{}, costume:{}, nameplate:{ theme:'default' },
  };
}

function harness(loader, localPlayers = []) {
  const renders = [];
  const game = { modalState:{ type:'none' } };
  const window = {
    __G:game,
    secureStudentAccessV2:{ loadHallOfFame:loader },
    getAllPlayers:() => localPlayers,
    escapeHtml:(value) => String(value),
    openModal:(html, options) => {
      renders.push(html);
      game.modalState = { type:options.type };
    },
  };
  const document = {
    querySelectorAll:() => [],
    getElementById:() => null,
  };
  vm.runInNewContext(hallSource, {
    window, document,
    performance:{ now:() => 100 },
    requestAnimationFrame:() => 1,
    cancelAnimationFrame:() => {},
    CLASS_META:{ warrior:{name:'전사'}, mage:{name:'마법사'}, priest:{name:'사제'} },
    Map, Set, Object, Array, Number, String, Math, Promise,
  });
  return { window, game, renders };
}

test('빈 원격 직업 순위는 정상 빈 화면이며 로컬의 다른 직업을 섞지 않는다', async () => {
  const h = harness(async () => [], [player('로컬전사', 'warrior')]);
  await h.window.openHallOfFameV52();
  assert.match(h.renders.at(-1), /전체 모험가 기록이 아직 없습니다/);
  assert.doesNotMatch(h.renders.at(-1), /로컬전사/);
});

test('직업 필터 응답 순서가 뒤집혀도 마지막 선택만 화면에 남는다', async () => {
  const warrior = deferred();
  const mage = deferred();
  const h = harness(async (scope) => {
    if (scope === 'warrior') return warrior.promise;
    if (scope === 'mage') return mage.promise;
    return [];
  });
  await h.window.openHallOfFameV52();
  const warriorRun = h.window.selectHallScopeV58('warrior');
  const mageRun = h.window.selectHallScopeV58('mage');
  mage.resolve([player('마법영웅', 'mage')]);
  await mageRun;
  const latestAfterMage = h.renders.at(-1);
  warrior.resolve([player('전사영웅', 'warrior')]);
  await warriorRun;
  assert.equal(h.renders.at(-1), latestAfterMage);
  assert.match(h.renders.at(-1), /마법영웅/);
  assert.doesNotMatch(h.renders.at(-1), /전사영웅/);
});

test('불러오는 중 명예의 전당을 닫으면 늦은 응답이 모달을 다시 열지 않는다', async () => {
  const priest = deferred();
  const h = harness(async (scope) => (scope === 'priest' ? priest.promise : []));
  await h.window.openHallOfFameV52();
  const pending = h.window.selectHallScopeV58('priest');
  const renderCountAfterLoading = h.renders.length;
  h.game.modalState = { type:'combat' };
  priest.resolve([player('사제영웅', 'priest')]);
  await pending;
  assert.equal(h.renders.length, renderCountAfterLoading);
  assert.doesNotMatch(h.renders.at(-1), /사제영웅/);
});

test('던전·PvP 원격 호출 실패는 로컬 EXP 학생으로 대체하지 않는다', async () => {
  const h = harness(async (scope) => {
    if (scope === 'raid' || scope === 'pvp') throw new Error('offline');
    return [];
  }, [player('로컬경험치영웅', 'warrior')]);
  await h.window.openHallOfFameV52();

  await h.window.selectHallScopeV58('raid');
  assert.match(h.renders.at(-1), /던전 진행 기록이 아직 없습니다/);
  assert.doesNotMatch(h.renders.at(-1), /로컬경험치영웅/);

  await h.window.selectHallScopeV58('pvp');
  assert.match(h.renders.at(-1), /PvP 승리 기록이 아직 없습니다/);
  assert.doesNotMatch(h.renders.at(-1), /로컬경험치영웅/);
});

test('던전 세 번째 몬스터 도전과 PvP 서버 승패를 카드 지표로 표시한다', async () => {
  const h = harness(async (scope) => {
    if (scope === 'raid') {
      return [{ ...player('등반영웅', 'warrior'), floorGroup:3, reachedFloor:28, encounterIndex:2, cleared:false }];
    }
    if (scope === 'pvp') {
      return [{ ...player('결투영웅', 'mage'), wins:7, losses:2 }];
    }
    return [];
  });
  await h.window.openHallOfFameV52();

  await h.window.selectHallScopeV58('raid');
  assert.match(h.renders.at(-1), /28층 · 3번째 몬스터 도전/);

  await h.window.selectHallScopeV58('pvp');
  assert.match(h.renders.at(-1), /PVP 7승 2패/);
});
