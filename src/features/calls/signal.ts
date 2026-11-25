import { AppState } from 'react-native';

import { fetchCall } from '@/data/calls';
import { supabase } from '@/lib/supabase';
import type { Call, CallStatus } from '@/lib/types';

/**
 * Race-safe helpers on top of the `calls` signalling table.
 *
 * Why not a plain status update and one shared subscription per call?
 *
 * 1. Compare-and-set. Two people can act on the same row at the same instant
 *    (callee accepts while the caller cancels, both hang up together). A plain
 *    `update … where id = X` is last-write-wins, which can resurrect a cancelled
 *    call as "accepted" and leave the callee in a zombie call. Every transition
 *    here is `update … where id = X and status in (<allowed from-states>)`, so
 *    exactly one side wins and the loser re-reads the row.
 *
 * 2. Unique channel topics. realtime-js returns the *existing* channel when a
 *    topic is reused, and only forgets a channel once the server acknowledges
 *    the unsubscribe. Re-subscribing to `call:<id>` while a previous screen's
 *    channel is still closing (overlay → call screen hand-off, leaving and
 *    re-joining a room, StrictMode / Fast Refresh) silently yields a dead
 *    channel. A per-subscription suffix avoids that entirely.
 *
 * 3. Realtime is a fast path, not the source of truth: a follower also
 *    re-reads the row on subscribe, on foreground and on a slow poll, so a
 *    dropped websocket frame can never leave a call ringing forever.
 */

/** Ringing gives up after this long (both sides enforce it). */
export const RING_TIMEOUT_MS = 40_000;
/** Foreground re-check for rings whose realtime INSERT was lost. */
const RING_POLL_MS = 10_000;

const TERMINAL = new Set<CallStatus>(['rejected', 'missed', 'cancelled', 'ended']);
export const isTerminal = (status: CallStatus) => TERMINAL.has(status);

let topicSeq = 0;
function uniqueTopic(base: string) {
  topicSeq += 1;
  return `${base}:${Date.now().toString(36)}-${topicSeq}`;
}

/**
 * Moves a call to `to` only if it is currently in one of `from`.
 * Resolves with the updated row when this client won, or `null` when the row
 * had already moved on (the caller should then reconcile with `fetchCall`).
 * Stamps answered_at on accept and ended_at on any end.
 */
export async function transitionCall(id: string, to: CallStatus, from: CallStatus[]): Promise<Call | null> {
  const now = new Date().toISOString();
  const patch: Partial<Call> = { status: to };
  if (to === 'accepted') patch.answered_at = now;
  if (to !== 'accepted' && to !== 'ringing') patch.ended_at = now;
  const { data, error } = await supabase.from('calls').update(patch).eq('id', id).in('status', from).select('*');
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Call[];
  return rows[0] ?? null;
}

/** Best-effort transition that never throws — for hang-ups and timeouts where the UI has already moved on. */
export async function tryTransition(id: string, to: CallStatus, from: CallStatus[]): Promise<Call | null> {
  try {
    return await transitionCall(id, to, from);
  } catch {
    return null;
  }
}

export async function readCall(id: string): Promise<Call | null> {
  try {
    return await fetchCall(id);
  } catch {
    return null;
  }
}

/**
 * Follows one call row. Emits only when status / answered_at / ended_at change.
 * Realtime UPDATEs give low latency; a re-read on subscribe, on app foreground and
 * every `pollMs` guarantees convergence even if a websocket frame is lost.
 */
export function followCall(id: string, onChange: (call: Call) => void, pollMs = 4000): () => void {
  let closed = false;
  let lastSignature = '';

  const emit = (call: Call | null) => {
    if (closed || !call || call.id !== id) return;
    const signature = `${call.status}|${call.answered_at ?? ''}|${call.ended_at ?? ''}`;
    if (signature === lastSignature) return;
    lastSignature = signature;
    onChange(call);
  };
  const reconcile = () => {
    readCall(id).then(emit);
  };

  const channel = supabase
    .channel(uniqueTopic(`call:${id}`))
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'calls', filter: `id=eq.${id}` },
      (payload) => emit(payload.new as Call),
    )
    .subscribe((status) => {
      // Anything that changed between our initial read and the subscription going live is caught here.
      if (status === 'SUBSCRIBED') reconcile();
    });

  const timer = setInterval(reconcile, pollMs);
  const appState = AppState.addEventListener('change', (state) => {
    if (state === 'active') reconcile();
  });

  return () => {
    closed = true;
    clearInterval(timer);
    appState.remove();
    supabase.removeChannel(channel);
  };
}

/** The newest call still ringing for `userId` that is young enough to answer (cold open / missed websocket frame). */
export async function findRingingCall(userId: string): Promise<Call | null> {
  const since = new Date(Date.now() - RING_TIMEOUT_MS).toISOString();
  const { data, error } = await supabase
    .from('calls')
    .select('*')
    .eq('callee_id', userId)
    .eq('status', 'ringing')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data as Call | null) ?? null;
}

/**
 * Listens for calls ringing the user. Realtime INSERTs where callee_id is the user, plus:
 * a catch-up query once the channel is live and whenever the app returns to the
 * foreground, so a ring that arrived while the socket was down still surfaces.
 * Duplicates are expected — the store de-duplicates by call id.
 */
export function listenForRings(userId: string, onRing: (call: Call) => void): () => void {
  let closed = false;
  const catchUp = () => {
    findRingingCall(userId).then((call) => {
      if (!closed && call) onRing(call);
    });
  };

  const channel = supabase
    .channel(uniqueTopic(`incoming-calls:${userId}`))
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'calls', filter: `callee_id=eq.${userId}` },
      (payload) => {
        const call = payload.new as Call;
        if (!closed && call.status === 'ringing') onRing(call);
      },
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') catchUp();
    });

  const appState = AppState.addEventListener('change', (state) => {
    if (state === 'active') catchUp();
  });
  catchUp();
  // A socket that dies silently (network switch, expired channel token) only resubscribes after
  // its heartbeat notices; a slow foreground poll keeps a 40 s ring from being missed meanwhile.
  const timer = setInterval(() => {
    if (AppState.currentState === 'active') catchUp();
  }, RING_POLL_MS);

  return () => {
    closed = true;
    clearInterval(timer);
    appState.remove();
    supabase.removeChannel(channel);
  };
}

/** ms left before a ringing call should be marked missed. Clamped so device clock skew cannot zero it out. */
export function ringTimeLeft(call: Pick<Call, 'created_at'>) {
  const age = Date.now() - new Date(call.created_at).getTime();
  return Math.min(RING_TIMEOUT_MS, Math.max(5_000, RING_TIMEOUT_MS - age));
}

/** Whole seconds between answer and end (or now), never negative. */
export function callDurationS(call: Pick<Call, 'answered_at' | 'ended_at'>, now = Date.now()) {
  if (!call.answered_at) return 0;
  const end = call.ended_at ? new Date(call.ended_at).getTime() : now;
  return Math.max(0, Math.round((end - new Date(call.answered_at).getTime()) / 1000));
}
