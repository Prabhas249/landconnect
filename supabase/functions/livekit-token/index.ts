// Mints a short-lived LiveKit room token for a call the signed-in user is allowed to join.
// Credentials: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET as function secrets, or in Supabase Vault (see 0005).
import { AccessToken } from 'npm:livekit-server-sdk@2.20.1';
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/** Function secrets win; otherwise the credentials come from Supabase Vault (migration 0005). */
async function livekitConfig() {
  const fromEnv = {
    url: Deno.env.get('LIVEKIT_URL'),
    apiKey: Deno.env.get('LIVEKIT_API_KEY'),
    apiSecret: Deno.env.get('LIVEKIT_API_SECRET'),
  };
  if (fromEnv.url && fromEnv.apiKey && fromEnv.apiSecret) return fromEnv;
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data } = await admin.rpc('livekit_config').maybeSingle<{ url: string; api_key: string; api_secret: string }>();
  return { url: data?.url, apiKey: data?.api_key, apiSecret: data?.api_secret };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const { url, apiKey, apiSecret } = await livekitConfig();
  if (!url || !apiKey || !apiSecret) return json({ error: 'Calling is not configured on the server.' }, 200);

  const authorization = req.headers.get('Authorization');
  if (!authorization) return json({ error: 'Not signed in.' }, 401);

  // Runs as the caller: row level security decides whether this call is visible to them.
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
  });

  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return json({ error: 'Not signed in.' }, 401);

  const { callId } = await req.json().catch(() => ({ callId: null }));
  if (!callId) return json({ error: 'callId is required.' }, 400);

  const { data: call } = await supabase
    .from('calls')
    .select('id, room_name, status, caller_id, callee_id, kind')
    .eq('id', callId)
    .maybeSingle();

  if (!call) return json({ error: 'You are not part of this call.' }, 403);
  if (!['ringing', 'accepted'].includes(call.status)) return json({ error: 'This call has ended.' }, 410);

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, handle, show_real_name')
    .eq('id', user.id)
    .maybeSingle();

  // Only the public name travels to other participants — never an email or phone number.
  const name = profile ? (profile.show_real_name ? profile.display_name : profile.handle) : 'Participant';

  const token = new AccessToken(apiKey, apiSecret, { identity: user.id, name, ttl: '2h' });
  token.addGrant({ roomJoin: true, room: call.room_name, canPublish: true, canSubscribe: true });

  return json({ token: await token.toJwt(), url });
});
