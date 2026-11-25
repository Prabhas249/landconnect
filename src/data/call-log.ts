import { supabase } from '@/lib/supabase';
import type { Call, Profile } from '@/lib/types';
import { currentUserId } from '@/stores/session';

export type CallLogEntry = Call & { peer: Profile | null; outgoing: boolean };

/** Seconds the two sides were connected; 0 when the call was never answered. */
export function connectedSeconds(c: Pick<Call, 'answered_at' | 'ended_at'>) {
  if (!c.answered_at || !c.ended_at) return 0;
  return Math.max(0, (new Date(c.ended_at).getTime() - new Date(c.answered_at).getTime()) / 1000);
}

/** Recent 1:1 calls, newest first. Room sessions (no callee) are not part of the history. */
export async function fetchCallLog(): Promise<CallLogEntry[]> {
  const me = currentUserId();
  if (!me) return [];
  const { data, error } = await supabase
    .from('calls')
    .select('*, caller:profiles!calls_caller_id_fkey(*), callee:profiles!calls_callee_id_fkey(*)')
    .not('callee_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(60);
  if (error) throw new Error(error.message);

  return (data as unknown as (Call & { caller: Profile | null; callee: Profile | null })[]).map(
    ({ caller, callee, ...call }) => {
      const outgoing = call.caller_id === me;
      return { ...call, outgoing, peer: outgoing ? callee : caller };
    },
  );
}
