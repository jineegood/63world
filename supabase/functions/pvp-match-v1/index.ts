import { createClient } from 'npm:@supabase/supabase-js@2.110.8';
import { createPvpService } from '../_shared/pvp-service.mjs';
import { createSupabasePvpStore } from '../_shared/pvp-store.mjs';
import { isTransientPvpError, publicPvpErrorCode } from '../_shared/pvp-error.mjs';

const cors = {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Expose-Headers':'x-pvp-trace-id',
};
const RETRYABLE_OPERATIONS = new Set(['presence', 'profile', 'sync', 'heartbeat', 'cleanup']);
const retryDelay = () => new Promise((resolve) => setTimeout(resolve, 90));

Deno.serve(async (request) => {
  const traceId = crypto.randomUUID();
  const responseHeaders = { ...cors, 'Content-Type':'application/json', 'x-pvp-trace-id':traceId };
  if (request.method === 'OPTIONS') return new Response('ok', { headers:cors });
  if (request.method !== 'POST') {
    return Response.json({ error:'METHOD_NOT_ALLOWED' }, { status:405, headers:responseHeaders });
  }
  let operation = '';
  try {
    const authorization = request.headers.get('Authorization') || '';
    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !anonKey || !serviceKey || !authorization) throw Object.assign(new Error(), { code:'UNAUTHENTICATED' });
    const authClient = createClient(url, anonKey, {
      global:{ headers:{ Authorization:authorization } },
      auth:{ persistSession:false },
    });
    let authResult = await authClient.auth.getUser();
    if (authResult.error && isTransientPvpError(authResult.error)) {
      await retryDelay();
      authResult = await authClient.auth.getUser();
    }
    if (authResult.error) {
      if (isTransientPvpError(authResult.error)) throw authResult.error;
      throw Object.assign(new Error(), { code:'UNAUTHENTICATED' });
    }
    if (!authResult.data.user) throw Object.assign(new Error(), { code:'UNAUTHENTICATED' });
    const serviceClient = createClient(url, serviceKey, { auth:{ persistSession:false } });
    const store = createSupabasePvpStore(serviceClient);
    const service = createPvpService({
      store,
      now:Date.now,
      randomInt:(minimum, maximum) => crypto.getRandomValues(new Uint32Array(1))[0] % (maximum - minimum + 1) + minimum,
    });
    const body = await request.json();
    operation = String(body?.op || '').slice(0, 24);
    let result;
    try {
      result = await service.handle(authResult.data.user.id, body);
    } catch (error) {
      if (!RETRYABLE_OPERATIONS.has(operation) || !isTransientPvpError(error)) throw error;
      console.warn('[pvp-match-v1] transient retry', JSON.stringify({ traceId, operation }));
      await retryDelay();
      result = await service.handle(authResult.data.user.id, body);
    }
    return Response.json({ data:result }, { headers:responseHeaders });
  } catch (error) {
    const code = publicPvpErrorCode(error);
    const status = code === 'UNAUTHENTICATED'
      ? 401
      : ['SERVER_ERROR', 'TEMPORARY_UNAVAILABLE'].includes(code) ? 503 : 400;
    const sourceError = error && typeof error === 'object'
      ? error as { code?:unknown; status?:unknown; context?:{ status?:unknown } }
      : {};
    console.error('[pvp-match-v1] request failed', JSON.stringify({
      traceId,
      operation,
      code,
      sourceCode:String(sourceError.code || '').slice(0, 32),
      sourceStatus:Number(sourceError.status || sourceError.context?.status) || undefined,
    }));
    return Response.json(
      { error:code, traceId },
      {
        status,
        headers:code === 'TEMPORARY_UNAVAILABLE'
          ? { ...responseHeaders, 'Retry-After':'1' }
          : responseHeaders,
      },
    );
  }
});
