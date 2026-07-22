import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Script, createContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const read = (file) => readFileSync(join(root, file), 'utf8');

function runBrowserModule(file, context) {
  new Script(read(file), { filename: file }).runInContext(context);
}

test('quest data is split into a browser global module loaded before game.js', () => {
  assert.equal(existsSync(join(root, 'src', 'quest-data.js')), true, 'src/quest-data.js should exist');

  const html = read('index.html');
  const gameDataScriptIndex = html.indexOf('<script src="src/game-data.js"></script>');
  const questDataScriptIndex = html.indexOf('<script src="src/quest-data.js"></script>');
  const patchDataScriptIndex = html.indexOf('<script src="src/patch-data.js"></script>');
  const gameScriptIndex = html.indexOf('<script src="game.js"></script>');

  assert.ok(gameDataScriptIndex > -1, 'index.html should load src/game-data.js');
  assert.ok(questDataScriptIndex > gameDataScriptIndex, 'src/quest-data.js should load after game-data');
  assert.ok(patchDataScriptIndex > questDataScriptIndex, 'src/patch-data.js should load after quest-data');
  assert.ok(gameScriptIndex > patchDataScriptIndex, 'game.js should load after src/patch-data.js');
});

test('quest data module exposes mutable quest definitions', () => {
  const context = createContext({ window: {}, Math, Date });
  context.globalThis = context.window;

  runBrowserModule('src/quest-data.js', context);

  const data = context.window.YuksamQuestData;
  assert.equal(typeof data, 'object');
  // [v38 갱신] 기존 처치형 퀘스트 필드는 유지되지만, 스토리 보강으로 pages 길이는 더 이상 3으로 고정 검사하지 않는다.
  assert.equal(data.QUEST_DEFS.mushroom_hunt.id, 'mushroom_hunt');
  assert.equal(data.QUEST_DEFS.mushroom_hunt.title, '작물밭을 뒤덮은 버섯돌이');
  assert.equal(data.QUEST_DEFS.mushroom_hunt.target, 4);
  assert.equal(data.QUEST_DEFS.mushroom_hunt.reward.building, 3); // [피드백] 빌딩 보상 3배
  assert.ok(data.QUEST_DEFS.mushroom_hunt.pages.length >= 2, 'quest pages should have at least 2 story pages');
  // [v38 갱신] 행동형 튜토리얼 4종(tut_equip/tut_shop/tut_enhance/tut_pet)이 기존 처치형과 함께 존재한다.
  assert.deepEqual(Object.keys(data.QUEST_DEFS).sort(), [
    'elite_slime_hunt',
    'elite_snake_hunt',
    'mushroom_hunt',
    'slime_hunt',
    'snake_hunt',
    'stomp_hunt',
    'swamp_king_hunt',
    'swamp_spider_hunt',
    'swamp_zombie_hunt',
    'tut_accessory', // [피드백] 악세서리 구매 튜토리얼
    'tut_enhance',
    'tut_equip',
    'tut_pet',
    'tut_shop',
  ]);
  assert.equal(data.QUEST_DEFS.elite_slime_hunt.eliteOnly, true);
  assert.equal(data.QUEST_DEFS.elite_snake_hunt.reward.building, 15); // [피드백] 빌딩 보상 3배
  // [v38 신규] 튜토리얼 퀘스트는 targetTypes 대신 actionType 을 갖는다.
  assert.equal(data.QUEST_DEFS.tut_equip.actionType, 'equip');
  assert.equal(data.QUEST_DEFS.tut_shop.actionType, 'buy');
  assert.equal(data.QUEST_DEFS.tut_enhance.actionType, 'enhance');
  assert.equal(data.QUEST_DEFS.tut_pet.actionType, 'pet');
  // 수정시트 기준 보상 아이템: 엘리트 슬라임=명예 왕관, 엘리트 스네이크=별빛 망토.
  assert.equal(data.QUEST_DEFS.elite_slime_hunt.reward.item, 'honorCrown');
  assert.equal(data.QUEST_DEFS.stomp_hunt.reward.item, undefined);
  assert.equal(data.QUEST_DEFS.elite_snake_hunt.reward.item, 'starCape'); // [피드백] 11번째 보상으로 이동
  // [v38 갱신] 튜토리얼이 처치형 사이에 끼어든 새 진행 순서.
  assert.deepEqual(Array.from(data.QUEST_ORDER), [
    'tut_equip',
    'mushroom_hunt',
    'tut_shop',
    'slime_hunt',
    'tut_accessory',
    'elite_slime_hunt',
    'tut_enhance',
    'stomp_hunt',
    'snake_hunt',
    'tut_pet',
    'elite_snake_hunt',
    'swamp_spider_hunt',
    'swamp_zombie_hunt',
    'swamp_king_hunt', // [피드백] 최종 퀘스트는 삭제 — 히든보스는 퀘스트 없이 도전
  ]);

  data.QUEST_DEFS.testQuest = { id: 'testQuest' };
  assert.equal(data.QUEST_DEFS.testQuest.id, 'testQuest', 'later patch blocks must be able to extend quests');
});

test('game.js consumes split quest data instead of defining it locally', () => {
  const js = read('game.js');

  assert.match(js, /const YuksamQuestData = window\.YuksamQuestData;/);
  assert.match(js, /const QUEST_DEFS = YuksamQuestData\.QUEST_DEFS;/);
  assert.match(js, /const QUEST_ORDER = YuksamQuestData\.QUEST_ORDER;/);
  assert.doesNotMatch(js, /const QUEST_DEFS = \{/);
  assert.doesNotMatch(js, /const QUEST_ORDER_V\d+\s*=\s*\[/);
  assert.doesNotMatch(js, /Object\.assign\(QUEST_DEFS,/);
});

test('quest data matches the July 12 edited quest workbook', () => {
  const context = createContext({ window:{} });
  context.globalThis = context.window;
  runBrowserModule('src/quest-data.js', context);
  const { QUEST_DEFS: quests, QUEST_ORDER: order } = context.window.YuksamQuestData;

  assert.equal(order.length, 14);
  assert.deepEqual(Array.from(order), [
    'tut_equip','mushroom_hunt','tut_shop','slime_hunt','tut_accessory','elite_slime_hunt','tut_enhance',
    'stomp_hunt','snake_hunt','tut_pet','elite_snake_hunt','swamp_spider_hunt','swamp_zombie_hunt','swamp_king_hunt',
  ]);
  assert.equal(quests.mushroom_hunt.target, 4);
  assert.equal(quests.slime_hunt.target, 4);
  assert.equal(quests.stomp_hunt.target, 4);
  assert.equal(quests.snake_hunt.target, 4);
  assert.equal(quests.swamp_spider_hunt.target, 4);
  assert.equal(quests.swamp_zombie_hunt.target, 4);
  assert.equal(quests.elite_slime_hunt.reward.item, 'honorCrown');
  assert.equal(quests.stomp_hunt.reward.item, undefined);
  assert.equal(quests.elite_snake_hunt.reward.item, 'starCape');
  assert.equal(quests.tut_accessory.grantOnAccept.building, 5);
  assert.match(quests.tut_accessory.pages[1], /새나리 쌤/);
  assert.match(quests.swamp_king_hunt.done, /명진쌤 보스/);
});
