import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { MESSAGE_PAGE, fetchConversation, fetchMessages, markRead, sendMessage, subscribeMessages, typingChannel } from '@/data/chat';
import { qk } from '@/data/keys';
import { uploadImage } from '@/data/listings';
import { errorMessage } from '@/lib/supabase';
import type { ConversationSummary, Message, MessageKind, MessageMeta } from '@/lib/types';
import { useSession } from '@/stores/session';

import { chatKeys, fetchMemberReads, subscribeMemberReads, type MemberRead } from '../api';
import { buildThreadItems, sortNewestFirst } from './items';

const TYPING_SEND_EVERY_MS = 2500;
const TYPING_VISIBLE_MS = 3500;

function insertMessage(list: Message[] | undefined, m: Message) {
  const current = list ?? [];
  if (current.some((x) => x.id === m.id)) return current;
  return sortNewestFirst([m, ...current]);
}

/**
 * Everything the thread screen needs: conversation, messages (server + optimistic),
 * live inserts, read markers, typing, and send actions.
 */
export function useThread(id: string) {
  const queryClient = useQueryClient();
  const me = useSession((s) => s.userId);
  const myProfile = useSession((s) => s.profile);
  const focused = useIsFocused();

  const conversation = useQuery({
    queryKey: qk.conversation(id),
    queryFn: () => fetchConversation(id),
    // The inbox already has this row; show it instantly while the full fetch runs.
    placeholderData: () =>
      queryClient.getQueryData<ConversationSummary[]>(qk.conversations)?.find((c) => c.id === id) ?? undefined,
    // Keeps the peer's presence line honest without a dedicated presence channel.
    refetchInterval: 60_000,
  });

  const messages = useQuery({ queryKey: qk.messages(id), queryFn: () => fetchMessages(id) });
  const reads = useQuery({ queryKey: chatKeys.memberReads(id), queryFn: () => fetchMemberReads(id) });

  // Optimistic messages live outside the query cache so a background refetch cannot drop them.
  const [pending, setPending] = useState<Message[]>([]);
  // Ids that should play the entrance animation once (new arrivals, never history).
  const animateIds = useRef(new Set<string>());
  const [typingUserId, setTypingUserId] = useState<string | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typing = useRef<ReturnType<typeof typingChannel> | null>(null);
  const lastTypingSent = useRef(0);

  // ── live messages
  useEffect(() => {
    return subscribeMessages(id, (m) => {
      if (m.sender_id === me) {
        // Our own insert echoing back: retire the matching optimistic bubble without re-animating.
        setPending((list) => {
          const i = list.findIndex((p) => p.kind === m.kind && p.body === m.body);
          return i < 0 ? list : list.filter((_, j) => j !== i);
        });
      } else {
        animateIds.current.add(m.id);
        setTypingUserId((u) => (u === m.sender_id ? null : u));
      }
      queryClient.setQueryData<Message[]>(qk.messages(id), (old) => insertMessage(old, m));
    });
  }, [id, me, queryClient]);

  // ── read markers
  useEffect(() => {
    return subscribeMemberReads(id, (read) => {
      queryClient.setQueryData<MemberRead[]>(chatKeys.memberReads(id), (old) => {
        const rest = (old ?? []).filter((r) => r.user_id !== read.user_id);
        return [...rest, read];
      });
    });
  }, [id, queryClient]);

  // ── typing
  useEffect(() => {
    const channel = typingChannel(id, (userId) => {
      setTypingUserId(userId);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setTypingUserId(null), TYPING_VISIBLE_MS);
    });
    typing.current = channel;
    return () => {
      if (typingTimer.current) clearTimeout(typingTimer.current);
      channel.close();
      typing.current = null;
    };
  }, [id]);

  const notifyTyping = () => {
    const now = Date.now();
    if (now - lastTypingSent.current < TYPING_SEND_EVERY_MS) return;
    lastTypingSent.current = now;
    typing.current?.send();
  };

  // ── mark read on focus and whenever someone else's message lands
  const serverMessages = messages.data ?? [];
  const newestIncomingId = serverMessages.find((m) => m.sender_id !== me)?.id ?? null;
  useEffect(() => {
    if (!focused) return;
    let cancelled = false;
    markRead(id).then(() => {
      if (!cancelled) queryClient.invalidateQueries({ queryKey: qk.conversations });
    });
    return () => {
      cancelled = true;
    };
  }, [focused, id, newestIncomingId, queryClient]);

  // ── send
  async function send(kind: MessageKind, body: string, meta: MessageMeta, upload?: string) {
    if (!me) return false;
    const temp: Message = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      conversation_id: id,
      sender_id: me,
      kind,
      body,
      meta,
      created_at: new Date().toISOString(),
      pending: true,
    };
    animateIds.current.add(temp.id);
    setPending((list) => [temp, ...list]);

    try {
      const finalMeta = upload ? { ...meta, image_url: await uploadImage(upload) } : meta;
      const stored = await sendMessage(id, body, kind, finalMeta);
      queryClient.setQueryData<Message[]>(qk.messages(id), (old) => insertMessage(old, stored));
      setPending((list) => list.filter((p) => p.id !== temp.id));
      queryClient.invalidateQueries({ queryKey: qk.conversations });
      return true;
    } catch (e) {
      setPending((list) => list.filter((p) => p.id !== temp.id));
      Alert.alert('Message not sent', errorMessage(e));
      return false;
    }
  }

  const sendText = (text: string) => send('text', text, {});
  // The local file shows immediately; the bubble swaps to the stored copy once the upload lands.
  const sendImage = (localUri: string) => send('image', '', { image_url: localUri }, localUri);

  const all = pending.length > 0 ? [...pending, ...serverMessages] : serverMessages;
  const items = buildThreadItems(all, serverMessages.length < MESSAGE_PAGE);

  const convo = conversation.data ?? null;
  const peer = convo?.peer ?? null;
  const peerReadAt = peer ? (reads.data?.find((r) => r.user_id === peer.id)?.last_read_at ?? null) : null;
  // Read state is mutual: both people must have receipts switched on.
  const receiptsOn = !!myProfile?.read_receipts && !!peer?.read_receipts;

  return {
    me,
    conversation: convo,
    conversationLoading: conversation.isPending,
    conversationError: conversation.isError,
    messagesLoading: messages.isPending,
    messagesError: messages.isError,
    refetchMessages: messages.refetch,
    items,
    isEmpty: all.length === 0,
    animateIds: animateIds.current,
    typingUserId,
    notifyTyping,
    sendText,
    sendImage,
    peerReadAt: receiptsOn ? peerReadAt : null,
  };
}
