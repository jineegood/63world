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
  'TEMPORARY_UNAVAILABLE',
  'METHOD_NOT_ALLOWED',
]);

const TRANSIENT_DATABASE_CODES = new Set([
  '40001', '40P01', '53300', '53400',
  '57P01', '57P02', '57P03',
  '08000', '08001', '08003', '08004', '08006', '08007', '08P01',
  'PGRST000', 'PGRST001', 'PGRST002', 'PGRST003', 'PGRST504',
  'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT',
]);

export function isTransientPvpError(error) {
  const code = String(error?.code || '').trim().toUpperCase();
  if (TRANSIENT_DATABASE_CODES.has(code)) return true;
  const status = Number(error?.status || error?.context?.status);
  if ([429, 502, 503, 504].includes(status)) return true;
  const message = String(error?.message || '').toLowerCase();
  return /failed to fetch|fetch failed|network|timed?\s*out|connection (?:closed|reset|refused)|temporarily unavailable/.test(message);
}

export function publicPvpErrorCode(error) {
  const direct = String(error?.code || '').trim();
  if (SAFE_PVP_CODES.has(direct)) return direct;
  const message = String(error?.message || '').trim();
  if (SAFE_PVP_CODES.has(message)) return message;
  if (error instanceof SyntaxError) return 'INVALID_REQUEST';
  if (isTransientPvpError(error)) return 'TEMPORARY_UNAVAILABLE';
  return 'SERVER_ERROR';
}
