/* Supabase 연결 설정 — 아래 두 값을 채우면 클라우드 동기화가 켜집니다.
   (docs/Supabase_설정_가이드.md 의 3단계에서 복사해 붙여넣으세요)
   값이 비어 있으면 기존처럼 이 컴퓨터(localStorage)에만 저장됩니다. */
window.YUKSAM_CLOUD = {
  securityV2Enabled: true, // Supabase 보안 로그인 사용
  serverAuthorityV3Enabled: true, // 성장·전투·상점·퀘스트·PvP를 서버에서 판정
  url: 'https://eabxfedywcxbnfyyufcs.supabase.co/rest/v1/',      // 
  anonKey: 'sb_publishable_ouCM28TznJ203HdBOTW9BQ__liCiBJ-',  // 
};
