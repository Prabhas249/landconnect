import { supabase } from '@/lib/supabase';
import type { Call, CallKind, CallStatus } from '@/lib/types';
import { currentUserId } from '@/stores/session';

function need<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

/**
 * Signalling lives in the `calls` table (Postgres + Realtime); media goes through LiveKit.
 * Neither side ever sees the other's phone number — a call is addressed by conversation.
 */

/** Rings the other member of a direct conversation. Server enforces blocks and "who can call me". */
export async function startCall(conversationId: string, kind: CallKind): Promise<Call> {
  return need(await supabase.rpc('start_call', { conv: conversationId, call_kind: kind })) as Call;
}

/** Starts (or returns the live) session of a meeting room. Nobody is rung; members join when ready. */
export async function startRoomSession(conversationId: string, kind: CallKind = 'video'): Promise<Call> {
  const me = currentUserId();
  if (!me) throw new Error('Not signed in.');

  const live = await fetchLiveRoomSession(conversationId);
  if (live) return live;

  return need(
    await supabase
      .from('calls')
      .insert({
        conversation_id: conversationId,
        caller_id: me,
        callee_id: null,
        kind,
        status: 'accepted',
        room_name: `room-${conversationId}`,
        answered_at: new Date().toISOString(),
      })
      .select('*')
      .single(),
  ) as Call;
}

export async function fetchLiveRoomSession(conversationId: string): Promise<Call | null> {
  const res = await supabase
    .from('calls')
    .select('*')
    .eq('conversation_id', conversationId)
    .is('callee_id', null)
    .eq('status', 'accepted')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return need(res) as Call | null;
}

export async function fetchCall(id: string): Promise<Call | null> {
  return need(await supabase.from('calls').select('*').eq('id', id).maybeSingle()) as Call | null;
}

/** accept / reject / cancel / end. Stamps answered_at and ended_at as appropriate. */
export async function setCallStatus(id: string, status: CallStatus): Promise<void> {
  const now = new Date().toISOString();
  const patch: Partial<Call> = { status };
  if (status === 'accepted') patch.answered_at = now;
  if (status !== 'accepted' && status !== 'ringing') patch.ended_at = now;
  const { error } = await supabase.from('calls').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}

export type LiveKitCredentials = { token: string; url: string };

/** Asks the `livekit-token` edge function for a short-lived room token. The function re-checks membership. */
export async function fetchLiveKitToken(callId: string): Promise<LiveKitCredentials> {
  const { data, error } = await supabase.functions.invoke('livekit-token', { body: { callId } });
  if (error) throw new Error(error.message || 'Could not connect the call.');
  if (!data?.token || !data?.url) throw new Error(data?.error ?? 'Calling is not configured on the server.');
  return data as LiveKitCredentials;
}

// ── realtime

/** Fires for every new ringing call addressed to the user. */
export function subscribeIncomingCalls(userId: string, onRing: (call: Call) => void): () => void {
  const channel = supabase
    .channel(`incoming-calls:${userId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'calls', filter: `callee_id=eq.${userId}` },
      (payload) => {
        const call = payload.new as Call;
        if (call.status === 'ringing') onRing(call);
      },
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

/** Follows one call's status so both sides tear down together. */
export function subscribeCall(callId: string, onUpdate: (call: Call) => void): () => void {
  const channel = supabase
    .channel(`call:${callId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'calls', filter: `id=eq.${callId}` },
      (payload) => onUpdate(payload.new as Call),
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
