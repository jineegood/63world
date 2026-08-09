import { createClient } from 'npm:@supabase/supabase-js@2.110.8';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(['exp20', 'exp100', 'gold3000', 'building200', 'heal', 'raidKill']);
const XP_REQUIREMENTS: Record<number, number> = {
  1:10, 2:40, 3:80, 4:130, 5:200, 6:280, 7:370, 8:470, 9:580, 10:700,
};
const RESPONSE_HEADERS = {
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store',
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers:RESPONSE_HEADERS });
}

function safeInteger(value: unknown, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1_000_000_000, Math.trunc(number)));
}

function levelFromExp(exp: number) {
  let level = 1;
  for (const [rawLevel, requirement] of Object.entries(XP_REQUIREMENTS)) {
    if (exp >= requirement) level = Math.max(level, Number(rawLevel) + 1);
  }
  return Math.min(10, level);
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
  const userId = body.userId;
  const action = body.action;
  if (typeof userId !== 'string' || !UUID.test(userId)
    || typeof action !== 'string' || !ACTIONS.has(action)) {
    return json(400, { ok:false, code:'INVALID_REQUEST' });
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth:{ persistSession:false, autoRefreshToken:false },
  });
  const { data:profile, error:profileError } = await serviceClient
    .from('player_profiles_v2')
    .select('display_name,data')
    .eq('user_id', userId)
    .maybeSingle();
  if (profileError) return json(500, { ok:false, code:'CHEAT_FAILED' });
  if (!profile) return json(404, { ok:false, code:'STUDENT_NOT_FOUND' });

  if (action === 'raidKill') {
    const { data:raidResult, error:raidError } = await serviceClient.rpc(
      'private_teacher_kill_raid_monster_v1',
      { p_target_user_id:userId, p_killed_at:new Date().toISOString() },
    );
    if (raidError) {
      const message = String(raidError.message || '');
      if (message.includes('RAID_NOT_IN_BATTLE')) {
        return json(200, { ok:false, code:'RAID_NOT_IN_BATTLE' });
      }
      if (message.includes('RAID_PARTY_INCOMPLETE')) {
        return json(200, { ok:false, code:'RAID_PARTY_INCOMPLETE' });
      }
      return json(500, { ok:false, code:'CHEAT_FAILED' });
    }
    return json(200, {
      ok:true,
      displayName:profile.display_name,
      action,
      roomId:raidResult?.roomId,
      round:raidResult?.round,
      monsterName:raidResult?.monsterName,
    });
  }

  const current = profile.data && typeof profile.data === 'object' && !Array.isArray(profile.data)
    ? { ...profile.data }
    : {};
  const oldLevel = Math.max(1, Math.min(10, safeInteger(current.level, 1)));

  if (action === 'exp20' || action === 'exp100') {
    current.exp = safeInteger(current.exp) + (action === 'exp20' ? 20 : 100);
    current.level = levelFromExp(current.exp);
    const gainedLevels = Math.max(0, current.level - oldLevel);
    if (gainedLevels > 0) {
      current.skillPoints = safeInteger(current.skillPoints) + gainedLevels * 2;
      current.hp = Math.max(1, safeInteger(current.maxHp, safeInteger(current.hp, 1)));
    }
  } else if (action === 'gold3000') {
    current.gold = safeInteger(current.gold) + 3000;
  } else if (action === 'building200') {
    current.building = safeInteger(current.building) + 200;
  } else if (action === 'heal') {
    current.hp = Math.max(1, safeInteger(current.maxHp, safeInteger(current.hp, 1)));
  }
  current.updatedAt = Date.now();

  const { error:updateError } = await serviceClient
    .from('player_profiles_v2')
    .update({ data:current, updated_at:new Date().toISOString() })
    .eq('user_id', userId);
  if (updateError) return json(500, { ok:false, code:'CHEAT_FAILED' });

  return json(200, {
    ok:true,
    displayName:profile.display_name,
    snapshot:{
      exp:safeInteger(current.exp),
      level:Math.max(1, Math.min(10, safeInteger(current.level, 1))),
      skillPoints:safeInteger(current.skillPoints),
      gold:safeInteger(current.gold),
      building:safeInteger(current.building),
      hp:safeInteger(current.hp),
      maxHp:safeInteger(current.maxHp),
      fullyHealed:action === 'heal' || Number(current.level) > oldLevel,
    },
  });
});
