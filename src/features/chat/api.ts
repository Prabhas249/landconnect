import { supabase } from '@/lib/supabase';

/**
 * Chat-only reads the shared data layer does not expose yet.
 * Kept here (not in `src/data`) so this feature owns its own keys and channels.
 */

export const chatKeys = {
  memberReads: (conversationId: string) => ['member-reads', conversationId] as const,
  listingCard: (listingId: string) => ['listing-card', listingId] as const,
  blockedUser: (userId: string) => ['blocked', 'user', userId] as const,
  userListings: (userId: string) => ['listings', 'owner', userId] as const,
  profileSearch: (query: string) => ['profile-search', query] as const,
};

export type MemberRead = { user_id: string; last_read_at: string };

/** Every member's read marker — powers the accent "read" ticks in direct chats. */
export async function fetchMemberReads(conversationId: string): Promise<MemberRead[]> {
  const { data, error } = await supabase
    .from('conversation_members')
    .select('user_id, last_read_at')
    .eq('conversation_id', conversationId);
  if (error) throw new Error(error.message);
  return (data ?? []) as MemberRead[];
}

/** Read markers move whenever a member opens the chat; follow them live. */
export function subscribeMemberReads(conversationId: string, onChange: (read: MemberRead) => void): () => void {
  const channel = supabase
    .channel(`member-reads:${conversationId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'conversation_members', filter: `conversation_id=eq.${conversationId}` },
      (payload) => {
        const row = payload.new as Partial<MemberRead>;
        if (row.user_id && row.last_read_at) onChange({ user_id: row.user_id, last_read_at: row.last_read_at });
      },
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
