const PUBLIC_CODES = new Set([
  'UNAUTHENTICATED',
  'INVALID_REQUEST',
  'FLOOR_LOCKED',
  'PROFILE_MISSING',
  'ROOM_NOT_FOUND',
  'ROOM_FULL',
  'ROOM_CLOSED',
  'ALREADY_IN_ROOM',
  'NOT_MEMBER',
  'HOST_ONLY',
  'PARTY_INCOMPLETE',
  'FORMATION_INVALID',
  'NOT_READY',
  'ROUND_CHANGED',
  'ROUND_CLOSED',
  'JOIN_RATE_LIMIT',
  'TEMPORARY_UNAVAILABLE',
]);

const TRANSIENT_CODES = new Set([
  'PGRST000', 'PGRST001', 'PGRST002', 'PGRST003',
  '08000', '08001', '08003', '08004', '08006', '08007', '08P01',
  '40001', '40P01', '53300', '57P01', '57P02', '57P03',
]);

export function isTransientRaidRoomError(error) {
  const code = String(error?.code || '').toUpperCase();
  const status = Number(error?.status || error?.context?.status || 0);
  const message = String(error?.message || '').toLowerCase();
  return TRANSIENT_CODES.has(code)
    || status === 408 || status === 429 || status >= 500
    || message.includes('failed to fetch')
    || message.includes('network')
    || message.includes('timeout')
    || message.includes('schema cache');
}

export function publicRaidRoomErrorCode(error) {
  const direct = String(error?.code || '').toUpperCase();
  if (PUBLIC_CODES.has(direct)) return direct;
  const message = String(error?.message || '').toUpperCase();
  const embedded = [...PUBLIC_CODES].find((code) => message.includes(code));
  if (embedded) return embedded;
  if (error instanceof SyntaxError) return 'INVALID_REQUEST';
  if (isTransientRaidRoomError(error)) return 'TEMPORARY_UNAVAILABLE';
  return 'SERVER_ERROR';
}

export function failRaidRoom(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}
