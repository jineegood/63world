import { createClient } from 'npm:@supabase/supabase-js@2.110.8';
import { createRaidRoomService } from '../_shared/raid-room-service.mjs';
import { createSupabaseRaidRoomStore } from '../_shared/raid-room-store.mjs';
import {
  isTransientRaidRoomError,
  publicRaidRoomErrorCode,
} from '../_shared/raid-room-error.mjs';

const cors = {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Expose-Headers':'x-raid-trace-id',
};
const RETRYABLE_OPERATIONS = new Set(['sync', 'heartbeat']);
const retryDelay = () => new Promise((resolve) => setTimeout(resolve, 90));

Deno.serve(async (request) => {
  const traceId = crypto.randomUUID();
  const responseHeaders = {
    ...cors,
    'Content-Type':'application/json',
    'x-raid-trace-id':traceId,
  };
  if (request.method === 'OPTIONS') return new Response('ok', { headers:cors });
  if (request.method !== 'POST') {
    return Response.json({ error:'INVALID_REQUEST', traceId }, { status:405, headers:responseHeaders });
  }

  let operation = '';
  try {
    const authorization = request.headers.get('Authorization') || '';
    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !anonKey || !serviceKey || !authorization) {
      throw Object.assign(new Error(), { code:'UNAUTHENTICATED' });
    }

    const authClient = createClient(url, anonKey, {
      global:{ headers:{ Authorization:authorization } },
      auth:{ persistSession:false },
    });
    let authResult = await authClient.auth.getUser();
    if (authResult.error && isTransientRaidRoomError(authResult.error)) {
      await retryDelay();
      authResult = await authClient.auth.getUser();
    }
    if (authResult.error) {
      if (isTransientRaidRoomError(authResult.error)) throw authResult.error;
      throw Object.assign(new Error(), { code:'UNAUTHENTICATED' });
    }
    const userId = authResult.data.user?.id;
    if (!userId) throw Object.assign(new Error(), { code:'UNAUTHENTICATED' });

    const body = await request.json();
    operation = String(body?.op || '').slice(0, 24);
    const serviceClient = createClient(url, serviceKey, { auth:{ persistSession:false } });
    const service = createRaidRoomService({
      store:createSupabaseRaidRoomStore(serviceClient),
      now:Date.now,
    });

    let result;
    try {
      result = await service.handle(userId, body);
    } catch (error) {
      if (!RETRYABLE_OPERATIONS.has(operation) || !isTransientRaidRoomError(error)) throw error;
      console.warn('[raid-room-v1] transient retry', JSON.stringify({ traceId, operation }));
      await retryDelay();
      result = await service.handle(userId, body);
    }
    return Response.json({ data:result }, { headers:responseHeaders });
  } catch (error) {
    const code = publicRaidRoomErrorCode(error);
    const status = code === 'UNAUTHENTICATED'
      ? 401
      : code === 'TEMPORARY_UNAVAILABLE' ? 503 : 400;
    console.error('[raid-room-v1] request failed', JSON.stringify({ traceId, operation, code }));
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
