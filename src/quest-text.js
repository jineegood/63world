(function initYuksamQuestText(global) {
  'use strict';

  const yellowTerms = [
    '장비창(C)', '스킬창(N)', '액티브 스킬', '스킬 포인트', '보스방 포탈', '치유의 우물',
    '특별 상점', '펫 상점', '코스튬 칸', '장비창', '스킬창', '상태창', '코스튬',
    '전문화', '알림', 'N키', 'C키', 'E키', '상점', '대장간',
    // [v59] 선생님 검토 반영: 마을 이름과 장비 개념도 눈에 띄게
    '63마을', '장비',
  ];
  const greenTerms = [
    '엘리트 슬라임', '버섯돌이', '슬라임', '스톰프', '스네이크', '엘리트 좀비',
    '마을 가운데의 포탈', '서쪽 장비 상점', '사냥터',
    '빌딩 화폐', '150골드', '골드', 'EXP', '처치', '구매', '장착', '강화', '회복', '보상',
  ];
  const tones = new Map([
    ...yellowTerms.map((term) => [term, 'yellow']),
    ...greenTerms.map((term) => [term, 'green']),
  ]);
  const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const termPattern = new RegExp(
    Array.from(tones.keys()).sort((a, b) => b.length - a.length).map(escapeRegExp).join('|'),
    'g',
  );
  const quantityPattern = /\d+(?:마리|회|개|골드|빌딩|층|레벨)/g;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function emphasize(value) {
    const text = String(value ?? '');
    const tokens = [];
    for (const match of text.matchAll(termPattern)) {
      tokens.push({ start:match.index, end:match.index + match[0].length, text:match[0], tone:tones.get(match[0]) });
    }
    for (const match of text.matchAll(quantityPattern)) {
      tokens.push({ start:match.index, end:match.index + match[0].length, text:match[0], tone:'green' });
    }
    tokens.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

    let cursor = 0;
    let html = '';
    tokens.forEach((token) => {
      if (token.start < cursor) return;
      html += escapeHtml(text.slice(cursor, token.start));
      html += `<strong class="quest-keyword-${token.tone}">${escapeHtml(token.text)}</strong>`;
      cursor = token.end;
    });
    return html + escapeHtml(text.slice(cursor));
  }

  global.YuksamQuestText = Object.freeze({ emphasize });
})(window);
