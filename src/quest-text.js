(function initYuksamQuestText(global) {
  'use strict';

  const yellowTerms = [
    '장비창(C)', '스킬창(N)', '액티브 스킬', '스킬 포인트', '보스방 포탈', '치유의 우물',
    '특별 상점', '펫 상점', '코스튬 칸', '장비창', '스킬창', '상태창', '코스튬',
    '전문화', '알림', 'N키', 'C키', 'E키', '상점', '대장간',
  ];
  const greenTerms = [
    '엘리트 슬라임', '버섯돌이', '슬라임', '스톰프', '스네이크', '엘리트 좀비',
    '빌딩 화폐', '150골드', '골드', 'EXP', '처치', '구매', '장착', '강화', '회복', '보상',
  ];
  const tones = new Map([
    ...yellowTerms.map((term) => [term, 'yellow']),
    ...greenTerms.map((term) => [term, 'green']),
  ]);
  const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    Array.from(tones.keys()).sort((a, b) => b.length - a.length).map(escapeRegExp).join('|'),
    'g',
  );

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
    let cursor = 0;
    let html = '';
    text.replace(pattern, (match, offset) => {
      html += escapeHtml(text.slice(cursor, offset));
      html += `<strong class="quest-keyword-${tones.get(match)}">${escapeHtml(match)}</strong>`;
      cursor = offset + match.length;
      return match;
    });
    return html + escapeHtml(text.slice(cursor));
  }

  global.YuksamQuestText = Object.freeze({ emphasize });
})(window);
