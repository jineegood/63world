import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');

function load(file, key) {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), { window }, { filename:file });
  return window[key];
}

const loadApi = () => load('src/chatgpt-prompt.js', 'YuksamChatGptPrompt');

test('the topic and count the teacher typed appear in the prompt', () => {
  const api = loadApi();
  const result = api.buildPrompt({ topic:'  초등 5학년   분수의 덧셈 ', count:12 });
  assert.equal(result.ok, true);
  assert.match(result.prompt, /초등 5학년 분수의 덧셈 주제로 4지선다 문제 12개를 만들어줘\./);
});

test('an empty topic is refused with a reason instead of a useless prompt', () => {
  const api = loadApi();
  assert.equal(api.buildPrompt({ topic:'   ', count:20 }).ok, false);
  assert.match(api.buildPrompt({}).reason, /주제/);
});

test('the count is clamped to the agreed one-to-twenty range', () => {
  const api = loadApi();
  assert.equal(api.normalizeCount(0), 1);
  assert.equal(api.normalizeCount(-5), 1);
  assert.equal(api.normalizeCount(21), 20);
  assert.equal(api.normalizeCount(999), 20);
  assert.equal(api.normalizeCount(7), 7);
  assert.equal(api.normalizeCount('열개'), api.DEFAULT_COUNT);
  assert.equal(api.normalizeCount(undefined), api.DEFAULT_COUNT);
  assert.match(api.buildPrompt({ topic:'수학', count:100 }).prompt, /문제 20개/);
});

test('the prompt states every rule the importer depends on', () => {
  const api = loadApi();
  const { prompt } = api.buildPrompt({ topic:'수학', count:5 });
  assert.match(prompt, /CSV/);
  assert.match(prompt, /문제,정답,보기1,보기2,보기3,보기4/);
  assert.match(prompt, /큰따옴표/);
  assert.match(prompt, /정답은 반드시 보기 4개 중 하나/);
  assert.match(prompt, /겹치면 안 돼/);
  assert.match(prompt, /머리글 줄은 넣지 마/);
});

test('an over-long topic is refused', () => {
  const api = loadApi();
  const long = '가'.repeat(api.MAX_TOPIC_LENGTH + 1);
  assert.match(api.buildPrompt({ topic:long }).reason, /자까지/);
});

test('output following this prompt imports cleanly, commas and all', () => {
  const api = loadApi();
  const importer = load('src/workbook-import.js', 'YuksamWorkbookImport');
  assert.match(api.buildPrompt({ topic:'수학', count:3 }).prompt, /CSV/);

  // 위 규칙을 그대로 지킨 ChatGPT 출력 예시
  const modelOutput = [
    '"7 × 8 = ?","56","54","56","62","48"',
    '"사과, 배, 감을 묶어 부르는 말은?","과일","채소","과일","곡식","생선"',
    '"12의 약수가 아닌 것은?","5","3","4","5","6"',
  ].join('\n');

  const result = importer.parseTable(modelOutput);
  assert.equal(result.skipped.length, 0);
  assert.equal(result.questions.length, 3);
  for (const question of result.questions) {
    assert.equal(question.choices.length, 4);
    assert.ok(question.choices.includes(question.answer), `${question.q}: 정답이 보기에 없습니다`);
  }
  assert.equal(result.questions[1].q, '사과, 배, 감을 묶어 부르는 말은?');
});

test('the teacher dashboard offers the copy button and no longer fakes AI generation', () => {
  const dashboard = fs.readFileSync(path.join(root, 'src/admin-dashboard.js'), 'utf8');
  assert.match(dashboard, /copyChatGptPrompt/);
  assert.doesNotMatch(dashboard, /generateAiQuestionSet/, '가짜 AI 생성 버튼이 남아 있습니다');
  assert.doesNotMatch(dashboard, /generateAiQuestions\(/, '가짜 AI 생성 호출이 남아 있습니다');

  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const moduleIndex = html.indexOf('<script src="src/chatgpt-prompt.js"></script>');
  const dashboardIndex = html.indexOf('<script src="src/admin-dashboard.js"></script>');
  assert.ok(moduleIndex > 0, '모듈이 index.html에 등록되지 않았습니다');
  assert.ok(moduleIndex < dashboardIndex, '모듈은 교사 화면보다 먼저 로드되어야 합니다');
});
