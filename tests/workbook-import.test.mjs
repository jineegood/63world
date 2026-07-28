import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');

function loadApi() {
  const window = {};
  const source = fs.readFileSync(path.join(root, 'src/workbook-import.js'), 'utf8');
  vm.runInNewContext(source, { window }, { filename:'src/workbook-import.js' });
  return window.YuksamWorkbookImport;
}

test('excel paste with two columns becomes questions without forced choices', () => {
  const api = loadApi();
  const result = api.parseTable('7 × 8 = ?\t56\n대한민국의 수도는?\t서울');
  assert.equal(result.skipped.length, 0);
  assert.equal(result.questions.length, 2);
  assert.equal(JSON.stringify(result.questions[0]), JSON.stringify({ q:'7 × 8 = ?', answer:'56', choices:null }));
  assert.equal(JSON.stringify(result.questions[1]), JSON.stringify({ q:'대한민국의 수도는?', answer:'서울', choices:null }));
});

test('six columns keep the teacher supplied choices in order', () => {
  const api = loadApi();
  const result = api.parseTable('가장 큰 수는?\t9\t3\t9\t5\t7');
  assert.equal(result.questions.length, 1);
  assert.equal(JSON.stringify(result.questions[0].choices), JSON.stringify(['3', '9', '5', '7']));
});

test('an answer missing from the choices is inserted so the question stays solvable', () => {
  const api = loadApi();
  const result = api.parseTable('수도는?\t서울\t부산\t대구\t광주\t인천');
  const [question] = result.questions;
  assert.ok(question.choices.includes('서울'));
  assert.equal(question.choices.length, api.MAX_CHOICES);
  assert.equal(question.choices[0], '서울');
});

test('duplicate choices collapse and blank choice cells are dropped', () => {
  const api = loadApi();
  const result = api.parseTable('답은?\t4\t4\t\t2\t4');
  assert.equal(JSON.stringify(result.questions[0].choices), JSON.stringify(['4', '2']));
});

test('csv quoting keeps commas and doubled quotes inside one cell', () => {
  const api = loadApi();
  const result = api.parseTable('"사과, 배, 감은 모두 무엇인가?",과일\n"그는 ""안녕""이라고 했다. 무슨 말?",안녕');
  assert.equal(result.skipped.length, 0);
  assert.equal(result.questions[0].q, '사과, 배, 감은 모두 무엇인가?');
  assert.equal(result.questions[0].answer, '과일');
  assert.equal(result.questions[1].q, '그는 "안녕"이라고 했다. 무슨 말?');
});

test('a header row is recognised and skipped only at the top', () => {
  const api = loadApi();
  const result = api.parseTable('문제,정답\n1+1은?,2');
  assert.equal(result.questions.length, 1);
  assert.equal(result.questions[0].q, '1+1은?');
});

test('the legacy "question = answer" paste still works', () => {
  const api = loadApi();
  const result = api.parseTable('7 × 8 = ? = 56\n대한민국의 수도는? = 서울');
  assert.equal(result.questions.length, 2);
  assert.equal(result.questions[0].q, '7 × 8 = ?');
  assert.equal(result.questions[0].answer, '56');
});

test('rows without an answer are reported instead of silently vanishing', () => {
  const api = loadApi();
  const result = api.parseTable('정답없는문제\t\n좋은문제\t답');
  assert.equal(result.questions.length, 1);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].line, 1);
  assert.match(result.skipped[0].reason, /정답/);
});

test('duplicates inside the paste and against the workbook are both reported', () => {
  const api = loadApi();
  const result = api.parseTable('같은문제\t답\n같은문제\t답\n이미있음\t답', {
    existingQuestions:[{ q:'이미있음', answer:'답' }],
  });
  assert.equal(result.questions.length, 1);
  assert.equal(result.skipped.length, 2);
  assert.match(result.skipped[0].reason, /중복/);
  assert.match(result.skipped[1].reason, /이미/);
});

test('overlong questions and answers are refused at the server limits', () => {
  const api = loadApi();
  const longQuestion = 'ㄱ'.repeat(api.MAX_QUESTION_LENGTH + 1);
  const longAnswer = 'ㄴ'.repeat(api.MAX_ANSWER_LENGTH + 1);
  const result = api.parseTable(`${longQuestion}\t답\n문제\t${longAnswer}`);
  assert.equal(result.questions.length, 0);
  assert.equal(result.skipped.length, 2);
  assert.match(result.skipped[0].reason, /길어요/);
  assert.match(result.skipped[1].reason, /길어요/);
});

test('a single paste cannot exceed the row cap', () => {
  const api = loadApi();
  const lines = [];
  for (let i = 0; i < api.MAX_ROWS + 3; i += 1) lines.push(`문제${i}\t답${i}`);
  const result = api.parseTable(lines.join('\n'));
  assert.equal(result.questions.length, api.MAX_ROWS);
  assert.equal(result.skipped.length, 3);
  assert.match(result.skipped[0].reason, new RegExp(String(api.MAX_ROWS)));
});

test('blank lines are ignored and tab wins over comma when both appear', () => {
  const api = loadApi();
  assert.equal(api.detectDelimiter('a\tb,c'), '\t');
  assert.equal(api.detectDelimiter('a,b'), ',');
  const result = api.parseTable('\n\n사과, 배는?\t과일\n\n');
  assert.equal(result.questions.length, 1);
  assert.equal(result.questions[0].q, '사과, 배는?');
});
