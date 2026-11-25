import { supabase } from '@/lib/supabase';
import type { Conversation, ConversationSummary, Listing, Message, MessageKind, MessageMeta, Profile } from '@/lib/types';
import { currentUserId } from '@/stores/session';

function need<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

type MemberRow = { user_id: string; last_read_at: string; profile: Profile };
type ConversationRow = Conversation & {
  listing: ConversationSummary['listing'];
  conversation_members: MemberRow[];
};

const SUMMARY = `*,
  listing:listings(id, title, images, locality, price_total),
  conversation_members(user_id, last_read_at, profile:profiles(*))`;

function toSummary(row: ConversationRow, me: string, unread = 0): ConversationSummary {
  const { conversation_members, ...conv } = row;
  const members = conversation_members.map((m) => m.profile).filter(Boolean);
  const mine = conversation_members.find((m) => m.user_id === me);
  return {
    ...conv,
    members,
    peer: conv.kind === 'direct' ? (members.find((p) => p.id !== me) ?? null) : null,
    unread,
    my_last_read_at: mine?.last_read_at ?? conv.created_at,
  };
}

/** Chat list: direct chats and meeting rooms the user belongs to, newest first, with unread counts. */
export async function fetchConversations(): Promise<ConversationSummary[]> {
  const me = currentUserId();
  if (!me) return [];
  const rows = need(
    await supabase.from('conversations').select(SUMMARY).order('last_message_at', { ascending: false }),
  ) as unknown as ConversationRow[];

  const summaries = rows.map((r) => toSummary(r, me));

  // Unread = messages from others newer than my last read marker.
  await Promise.all(
    summaries.map(async (s) => {
      if (s.last_message_sender === me || new Date(s.last_message_at) <= new Date(s.my_last_read_at)) return;
      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', s.id)
        .neq('sender_id', me)
        .gt('created_at', s.my_last_read_at);
      s.unread = count ?? 0;
    }),
  );
  return summaries;
}

export async function fetchConversation(id: string): Promise<ConversationSummary | null> {
  const me = currentUserId();
  if (!me) return null;
  const row = need(await supabase.from('conversations').select(SUMMARY).eq('id', id).maybeSingle()) as unknown as
    | ConversationRow
    | null;
  return row ? toSummary(row, me) : null;
}

/** How many messages a thread loads; fewer back means the whole history is on screen. */
export const MESSAGE_PAGE = 80;

/** Newest first — feed directly into an inverted list. */
export async function fetchMessages(conversationId: string, limit = MESSAGE_PAGE): Promise<Message[]> {
  return need(
    await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit),
  ) as Message[];
}

export async function sendMessage(
  conversationId: string,
  body: string,
  kind: MessageKind = 'text',
  meta: MessageMeta = {},
): Promise<Message> {
  const me = currentUserId();
  if (!me) throw new Error('Not signed in.');
  return need(
    await supabase
      .from('messages')
      .insert({ conversation_id: conversationId, sender_id: me, kind, body, meta })
      .select('*')
      .single(),
  ) as Message;
}

export async function markRead(conversationId: string): Promise<void> {
  const me = currentUserId();
  if (!me) return;
  await supabase
    .from('conversation_members')
    .update({ last_read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('user_id', me);
}

/** Opens (or reuses) the direct chat with another user, optionally pinned to a listing. Returns the conversation id. */
export async function openDirectConversation(otherUserId: string, listingId?: string | null): Promise<string> {
  return need(
    await supabase.rpc('open_direct_conversation', { other_user: otherUserId, about_listing: listingId ?? null }),
  ) as string;
}

export type RoomInput = {
  title: string;
  agenda?: string;
  scheduledAt?: Date | null;
  memberIds: string[];
  listingId?: string | null;
};

/** Creates a meeting room. Returns the conversation id. */
export async function createRoom(input: RoomInput): Promise<string> {
  return need(
    await supabase.rpc('create_room', {
      room_title: input.title.trim(),
      room_agenda: input.agenda?.trim() || null,
      starts_at: input.scheduledAt ? input.scheduledAt.toISOString() : null,
      member_ids: input.memberIds,
      about_listing: input.listingId ?? null,
    }),
  ) as string;
}

export async function leaveConversation(conversationId: string): Promise<void> {
  const me = currentUserId();
  if (!me) return;
  await supabase.from('conversation_members').delete().eq('conversation_id', conversationId).eq('user_id', me);
}

/** People the user already talks to — used to invite members to a room. */
export async function fetchContacts(): Promise<Profile[]> {
  const me = currentUserId();
  if (!me) return [];
  const convs = await fetchConversations();
  const seen = new Map<string, Profile>();
  for (const c of convs) for (const p of c.members) if (p.id !== me) seen.set(p.id, p);
  return [...seen.values()];
}

/** Find people by public name or handle. Personal contact details are never searchable. */
export async function searchProfiles(query: string): Promise<Profile[]> {
  const me = currentUserId();
  const term = query.trim().replace(/[%,()]/g, ' ');
  let q = supabase.from('profiles').select('*').limit(30);
  if (term) q = q.or(`display_name.ilike.%${term}%,handle.ilike.%${term}%,city.ilike.%${term}%`);
  const rows = need(await q) as Profile[];
  // Hide the real name of anyone who has opted out, so search cannot be used to unmask a handle.
  return rows.filter((p) => p.id !== me && (p.show_real_name || !term || p.handle.toLowerCase().includes(term.toLowerCase())));
}

export async function fetchListingCard(id: string): Promise<Pick<Listing, 'id' | 'title' | 'images' | 'locality' | 'price_total' | 'area_value' | 'area_unit'> | null> {
  return need(
    await supabase
      .from('listings')
      .select('id, title, images, locality, price_total, area_value, area_unit')
      .eq('id', id)
      .maybeSingle(),
  );
}

// ── realtime

/** Live messages for one conversation. Returns an unsubscribe function. */
export function subscribeMessages(conversationId: string, onInsert: (m: Message) => void): () => void {
  const channel = supabase
    .channel(`messages:${conversationId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
      (payload) => onInsert(payload.new as Message),
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

/** Fires whenever any of the user's conversations changes (new message, new room, read state). */
export function subscribeInbox(onChange: () => void): () => void {
  const channel = supabase
    .channel(`inbox:${currentUserId() ?? 'anon'}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, onChange)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversation_members' }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

/** Ephemeral typing indicator over a broadcast channel (nothing is stored). */
export function typingChannel(conversationId: string, onTyping: (userId: string) => void) {
  const me = currentUserId();
  const channel = supabase
    .channel(`typing:${conversationId}`)
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (payload?.userId && payload.userId !== me) onTyping(payload.userId as string);
    })
    .subscribe();
  return {
    send: () => channel.send({ type: 'broadcast', event: 'typing', payload: { userId: me } }),
    close: () => {
      supabase.removeChannel(channel);
    },
  };
}
