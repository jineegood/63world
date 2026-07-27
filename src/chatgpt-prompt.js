/* ChatGPT 웹에 그대로 붙여넣을 문장을 만든다.
   나온 결과를 교사 화면의 '엑셀 · CSV로 문제 추가' 칸에 붙여넣으면 바로 등록된다.
   API를 쓰지 않으므로 추가 요금이 들지 않는다. */
(function installChatGptPrompt(global) {
  'use strict';

  const DEFAULT_COUNT = 20;
  const MIN_COUNT = 1;
  const MAX_COUNT = 20;   // 한 번에 최대 20문제
  const MAX_TOPIC_LENGTH = 200;

  function clean(value) {
    return String(value == null ? '' : value).normalize('NFKC').trim().replace(/\s+/g, ' ');
  }

  function normalizeCount(value) {
    const number = Math.floor(Number(value));
    if (!Number.isFinite(number)) return DEFAULT_COUNT;
    return Math.min(MAX_COUNT, Math.max(MIN_COUNT, number));
  }

  /* topic이 비어 있으면 이유를 돌려준다. 그 외에는 붙여넣을 문장을 만들어 준다. */
  function buildPrompt(input) {
    const topic = clean(input && input.topic);
    if (!topic) return { ok:false, reason:'어떤 문제를 만들지 주제를 적어주세요.' };
    if (topic.length > MAX_TOPIC_LENGTH) {
      return { ok:false, reason:`주제는 ${MAX_TOPIC_LENGTH}자까지 쓸 수 있어요.` };
    }
    const count = normalizeCount(input && input.count);
    const prompt = [
      `${topic} 주제로 4지선다 문제 ${count}개를 만들어줘.`,
      '아래 규칙을 반드시 지켜줘.',
      '',
      '1. CSV 형식으로 코드블록 안에만 출력해. 설명, 인사말, 번호는 절대 붙이지 마.',
      '2. 한 줄에 한 문제. 칸 순서는 문제,정답,보기1,보기2,보기3,보기4 여섯 칸이야.',
      '3. 모든 칸을 큰따옴표로 감싸. 예: "7 × 8 = ?","56","56","54","62","48"',
      '4. 정답은 반드시 보기 4개 중 하나와 완전히 똑같아야 해. 이게 제일 중요해.',
      '5. 보기 4개는 서로 겹치면 안 돼.',
      '6. 정답이 항상 첫 번째 보기에 오지 않도록 위치를 섞어줘.',
      '7. 머리글 줄은 넣지 마.',
    ].join('\n');
    return { ok:true, prompt, count, topic };
  }

  global.YuksamChatGptPrompt = Object.freeze({
    buildPrompt,
    normalizeCount,
    DEFAULT_COUNT,
    MIN_COUNT,
    MAX_COUNT,
    MAX_TOPIC_LENGTH,
  });
})(window);
