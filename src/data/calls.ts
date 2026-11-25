import { need, supabase } from '@/lib/supabase';
import type { Call, CallKind } from '@/lib/types';
import { currentUserId } from '@/stores/session';

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

export type LiveKitCredentials = { token: string; url: string };

/** Asks the `livekit-token` edge function for a short-lived room token. The function re-checks membership. */
export async function fetchLiveKitToken(callId: string): Promise<LiveKitCredentials> {
  const { data, error } = await supabase.functions.invoke('livekit-token', { body: { callId } });
  if (error) throw new Error(error.message || 'Could not connect the call.');
  if (!data?.token || !data?.url) throw new Error(data?.error ?? 'Calling is not configured on the server.');
  return data as LiveKitCredentials;
}
