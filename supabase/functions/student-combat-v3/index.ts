import { createClient } from 'npm:@supabase/supabase-js@2.110.8';
import { createPveCombatService } from '../_shared/pve-combat-service-v3.mjs';
import { createSupabasePveCombatStore } from '../_shared/pve-combat-store-v3.mjs';

const PUBLIC_ERRORS = new Set([
  'UNAUTHENTICATED',
  'ORIGIN_NOT_ALLOWED',
  'METHOD_NOT_ALLOWED',
  'INVALID_CONTENT_TYPE',
  'REQUEST_TOO_LARGE',
  'INVALID_JSON',
  'INVALID_REQUEST',
  'INVALID_OPERATION',
  'PLAYER_NOT_FOUND',
  'UNKNOWN_MONSTER',
  'MONSTER_MAP_MISMATCH',
  'NO_QUESTIONS',
  'COMBAT_NOT_ACTIVE',
  'COMBAT_STATE_MISSING',
  'QUESTION_TOKEN_MISMATCH',
  'SESSION_REVISION_CONFLICT',
  'PLAYER_REVISION_CONFLICT',
  'REQUEST_ID_REUSED',
  'ACTION_NOT_LEARNED',
  'ACTION_ON_COOLDOWN',
  'INVALID_ACTION',
]);

function publicErrorCode(error: unknown) {
  const code = String((error as { code?:unknown })?.code || '');
  return PUBLIC_ERRORS.has(code) ? code : 'SERVER_ERROR';
}

function allowedOrigins() {
  return new Set(
    String(Deno.env.get('ALLOWED_ORIGINS') || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function originHeaders(request: Request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = allowedOrigins();
  const local = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin);
  if (origin && !local && !allowed.has(origin)) {
    throw Object.assign(new Error('ORIGIN_NOT_ALLOWED'), { code:'ORIGIN_NOT_ALLOWED' });
  }
  return {
    ...(origin ? { 'Access-Control-Allow-Origin':origin, Vary:'Origin' } : {}),
    'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods':'POST, OPTIONS',
  };
}

function jsonResponse(body: unknown, status: number, headers: Record<string, string>) {
  return Response.json(body, {
    status,
    headers:{ ...headers, 'Content-Type':'application/json' },
  });
}

Deno.serve(async (request) => {
  let cors:Record<string, string> = {};
  try {
    cors = originHeaders(request);
    if (request.method === 'OPTIONS') return new Response('ok', { headers:cors });
    if (request.method !== 'POST') {
      return jsonResponse({ error:'METHOD_NOT_ALLOWED' }, 405, cors);
    }
    if (!String(request.headers.get('Content-Type') || '').toLowerCase().startsWith('application/json')) {
      return jsonResponse({ error:'INVALID_CONTENT_TYPE' }, 415, cors);
    }
    const declaredLength = Number(request.headers.get('content-length') || 0);
    if (Number.isFinite(declaredLength) && declaredLength > 16384) {
      return jsonResponse({ error:'REQUEST_TOO_LARGE' }, 413, cors);
    }
    const authorization = request.headers.get('Authorization') || '';
    const bearer = /^Bearer\s+([^\s]+)$/i.exec(authorization);
    if (!bearer) return jsonResponse({ error:'UNAUTHENTICATED' }, 401, cors);

    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 16384) {
      return jsonResponse({ error:'REQUEST_TOO_LARGE' }, 413, cors);
    }
    let body:unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return jsonResponse({ error:'INVALID_JSON' }, 400, cors);
    }

    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !anonKey || !serviceKey) throw new Error('SERVER_CONFIG');
    const authClient = createClient(url, anonKey, {
      global:{ headers:{ Authorization:authorization } },
      auth:{ persistSession:false },
    });
    const { data, error } = await authClient.auth.getUser();
    if (error || !data.user) {
      return jsonResponse({ error:'UNAUTHENTICATED' }, 401, cors);
    }
    const serviceClient = createClient(url, serviceKey, { auth:{ persistSession:false } });
    const service = createPveCombatService({
      store:createSupabasePveCombatStore(serviceClient),
      random:() => crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000,
    });
    const result = await service.handle(data.user.id, body as Record<string, unknown>);
    return jsonResponse({ data:result }, 200, cors);
  } catch (error) {
    const code = publicErrorCode(error);
    const status = code === 'UNAUTHENTICATED' ? 401
      : code === 'ORIGIN_NOT_ALLOWED' ? 403
      : code === 'SERVER_ERROR' ? 500
      : 400;
    return jsonResponse({ error:code }, status, cors);
  }
});
