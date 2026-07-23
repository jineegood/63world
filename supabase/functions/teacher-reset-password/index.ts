import { createClient } from 'npm:@supabase/supabase-js@2.110.8';

const RESPONSE_HEADERS = {
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store',
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers:RESPONSE_HEADERS });
}

function normalizedStudentName(value: unknown) {
  if (typeof value !== 'string') return null;
  const unicodeName = value.normalize('NFKC');
  if (/[\u0000-\u001f\u007f-\u009f]/.test(unicodeName)) return null;
  const normalizedName = unicodeName.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ko-KR');
  const length = Array.from(normalizedName).length;
  return length >= 1 && length <= 20 ? normalizedName : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status:204, headers:RESPONSE_HEADERS });
  if (req.method !== 'POST') return json(405, { ok:false, code:'METHOD_NOT_ALLOWED' });

  const authorization = req.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return json(401, { ok:false, code:'UNAUTHORIZED' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json(500, { ok:false, code:'SERVER_CONFIG' });

  const callerClient = createClient(supabaseUrl, anonKey, {
    global:{ headers:{ Authorization:authorization } },
    auth:{ persistSession:false, autoRefreshToken:false },
  });
  const { data:callerData, error:callerError } = await callerClient.auth.getUser();
  if (callerError || !callerData.user) return json(401, { ok:false, code:'UNAUTHORIZED' });
  if (callerData.user.app_metadata?.role !== 'teacher') {
    return json(403, { ok:false, code:'FORBIDDEN' });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch (_) {
    return json(400, { ok:false, code:'INVALID_REQUEST' });
  }
  const normalizedName = normalizedStudentName(body.normalizedName);
  const newPassword = body.newPassword;
  if (!normalizedName || typeof newPassword !== 'string'
    || newPassword.length < 6 || newPassword.length > 72) {
    return json(400, { ok:false, code:'INVALID_REQUEST' });
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth:{ persistSession:false, autoRefreshToken:false },
  });
  const { data:profile, error:profileError } = await serviceClient
    .from('player_profiles_v2')
    .select('user_id, display_name')
    .eq('normalized_name', normalizedName)
    .maybeSingle();
  if (profileError) return json(500, { ok:false, code:'RESET_FAILED' });
  if (!profile) return json(404, { ok:false, code:'STUDENT_NOT_FOUND' });

  const { error:updateError } = await serviceClient.auth.admin.updateUserById(profile.user_id, {
    password:newPassword,
  });
  if (updateError) return json(500, { ok:false, code:'RESET_FAILED' });

  return json(200, { ok:true, displayName:profile.display_name });
});
