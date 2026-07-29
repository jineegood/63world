const SAFE_PVP_CODES = new Set([
  'UNAUTHENTICATED',
  'INVALID_TARGET',
  'OFFLINE',
  'TOWN_ONLY',
  'BUSY',
  'NO_QUESTIONS',
  'MATCH_CLOSED',
  'RECONNECTING',
  'PROFILE_MISSING',
  'NOT_INVITED',
  'INVITE_CLOSED',
  'NOT_PARTICIPANT',
  'MATCH_NOT_FOUND',
  'MATCH_STATE_MISSING',
  'ROUND_CHANGED',
  'ROUND_CLOSED',
  'INVALID_REQUEST',
  'INVALID_PVP_RESULT',
  'METHOD_NOT_ALLOWED',
]);

export function publicPvpErrorCode(error) {
  const direct = String(error?.code || '').trim();
  if (SAFE_PVP_CODES.has(direct)) return direct;
  const message = String(error?.message || '').trim();
  if (SAFE_PVP_CODES.has(message)) return message;
  return 'SERVER_ERROR';
}
