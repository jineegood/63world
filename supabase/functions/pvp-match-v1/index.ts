import { createClient } from 'npm:@supabase/supabase-js@2.110.8';
import { createPvpService } from '../_shared/pvp-service.mjs';
import { createSupabasePvpStore } from '../_shared/pvp-store.mjs';

const cors = {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers:cors });
  if (request.method !== 'POST') {
    return Response.json({ error:'METHOD_NOT_ALLOWED' }, { status:405, headers:cors });
  }
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
    const { data, error } = await authClient.auth.getUser();
    if (error || !data.user) throw Object.assign(new Error(), { code:'UNAUTHENTICATED' });
    const serviceClient = createClient(url, serviceKey, { auth:{ persistSession:false } });
    const store = createSupabasePvpStore(serviceClient);
    const service = createPvpService({
      store,
      now:Date.now,
      randomInt:(minimum, maximum) => crypto.getRandomValues(new Uint32Array(1))[0] % (maximum - minimum + 1) + minimum,
    });
    const body = await request.json();
    const result = await service.handle(data.user.id, body);
    return Response.json({ data:result }, { headers:{ ...cors, 'Content-Type':'application/json' } });
  } catch (error) {
    const code = String(error?.code || 'SERVER_ERROR');
    console.error('pvp-match-v1 request failed', {
      code,
      message:String(error?.message || '').slice(0, 300),
    });
    const status = code === 'UNAUTHENTICATED' ? 401 : code === 'SERVER_ERROR' ? 500 : 400;
    return Response.json({ error:code }, { status, headers:{ ...cors, 'Content-Type':'application/json' } });
  }
});
