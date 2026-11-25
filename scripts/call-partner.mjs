#!/usr/bin/env node
// Plays the other side of a 1:1 call from a laptop, so calls can be tested with a single phone.
//
//   node scripts/call-partner.mjs                 # signs in as the demo seller and waits for calls
//   node scripts/call-partner.mjs --as broker     # any demo role
//   node scripts/call-partner.mjs --call video    # rings the phone instead (uses the most recent chat)
//
// Incoming call: press a to accept, r to reject. Once a call is accepted, the script prints a LiveKit Meet
// link: open it in a browser to talk to the phone with the laptop's camera and microphone.
// Press e to end the call from the laptop side, q to quit.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { emitKeypressEvents } from 'node:readline';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => line.includes('=') && !line.startsWith('#'))
    .map((line) => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()]),
);

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const role = arg('as', 'seller');
const outgoing = arg('call', null);
// --auto accept|reject answers incoming calls after 3 s, for hands-free testing.
const auto = arg('auto', null);

const supabase = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.EXPO_PUBLIC_SUPABASE_KEY, {
  auth: { persistSession: false },
});

const { data: auth, error: signInError } = await supabase.auth.signInWithPassword({
  email: `${role}@landconnect.demo`,
  password: 'landconnect123',
});
if (signInError) throw new Error(`Sign-in failed: ${signInError.message}`);
const me = auth.user.id;
await supabase.realtime.setAuth(auth.session.access_token);
console.log(`Signed in as the demo ${role}.`);

let current = null;

const setStatus = async (status) => {
  if (!current) return;
  const patch = { status };
  if (status === 'accepted') patch.answered_at = new Date().toISOString();
  else patch.ended_at = new Date().toISOString();
  const { error } = await supabase.from('calls').update(patch).eq('id', current.id);
  if (error) console.log(`Could not set ${status}: ${error.message}`);
};

const printJoinLink = async () => {
  const { data, error } = await supabase.functions.invoke('livekit-token', { body: { callId: current.id } });
  if (error || data?.error) return console.log(`Token error: ${error?.message ?? data.error}`);
  const link = `https://meet.livekit.io/custom?liveKitUrl=${encodeURIComponent(data.url)}&token=${encodeURIComponent(data.token)}`;
  console.log(`\nOpen this in a browser to join with the laptop camera and microphone:\n${link}\n`);
};

const answer = async (choice) => {
  if (current?.status !== 'ringing' || current.callee_id !== me) return;
  if (choice === 'reject') return setStatus('rejected');
  await setStatus('accepted');
  await printJoinLink();
};

supabase
  .channel('call-partner')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'calls' }, async ({ new: call }) => {
    if (!call?.id || (call.caller_id !== me && call.callee_id !== me)) return;
    if (call.status === 'ringing' && call.callee_id === me && current?.id !== call.id) {
      current = call;
      console.log(`\nIncoming ${call.kind} call. Press a to accept, r to reject.`);
      if (auto) setTimeout(() => answer(auto), 3000);
      return;
    }
    if (current?.id !== call.id) return;
    const before = current.status;
    current = call;
    if (call.status === before) return;
    console.log(`Call is now: ${call.status}`);
    if (call.status === 'accepted' && call.caller_id === me) await printJoinLink();
    if (!['ringing', 'accepted'].includes(call.status)) current = null;
  })
  .subscribe((state) => state === 'SUBSCRIBED' && console.log('Listening for calls… (q to quit)'));

if (outgoing) {
  // Row level security limits this to chats the demo account belongs to.
  const { data: chat } = await supabase
    .from('conversations')
    .select('id')
    .eq('kind', 'direct')
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!chat) throw new Error('This demo account has no direct chat yet. Message it from the phone first.');
  const { data: call, error } = await supabase.rpc('start_call', {
    conv: chat.id,
    call_kind: outgoing === 'video' ? 'video' : 'audio',
  });
  if (error) throw new Error(`start_call failed: ${error.message}`);
  current = call;
  console.log(`Ringing the phone (${call.kind})… press e to cancel.`);
}

emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on('keypress', async (_, key) => {
  if (key?.ctrl && key.name === 'c') process.exit(0);
  if (key?.name === 'q') process.exit(0);
  if (!current) return;
  if (key?.name === 'a') await answer('accept');
  else if (key?.name === 'r') await answer('reject');
  else if (key?.name === 'e') {
    await setStatus(current.status === 'ringing' ? 'cancelled' : 'ended');
  }
});
