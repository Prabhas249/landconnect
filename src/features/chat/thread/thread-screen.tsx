import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View, type ScrollViewProps } from 'react-native';
import { KeyboardChatScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { placeCall } from '@/features/calls/actions';
import { publicName } from '@/lib/format';
import type { CallKind, Profile } from '@/lib/types';
import { colors, gutter, radius, space } from '@/theme/tokens';
import { Screen } from '@/ui/screen';

import { Bone, EmptyState } from '../parts';
import { Bubble, DayChip, SystemRow, type DeliveryState } from './bubble';
import { CallCard } from './call-card';
import { Composer } from './composer';
import { ImageViewer } from './image-viewer';
import type { ThreadItem } from './items';
import { PinnedListing, ThreadHeader } from './thread-header';
import { PrivacyNotice } from './privacy-notice';
import { useThread } from './use-thread';

export function ThreadScreen({ id }: { id: string }) {
  const insets = useSafeAreaInsets();
  const thread = useThread(id);
  const [viewerUri, setViewerUri] = useState<string | null>(null);

  const { conversation, me, peerReadAt, animateIds } = thread;
  const isRoom = conversation?.kind === 'room';
  const members = new Map<string, Profile>((conversation?.members ?? []).map((p) => [p.id, p]));
  const typingName = thread.typingUserId ? publicName(members.get(thread.typingUserId)) : null;
  const missing = !thread.conversationLoading && !thread.conversationError && !conversation;

  // The chat scroll view lifts content with the keyboard; the composer absorbs the bottom safe area.
  const renderScroll = useCallback(
    (props: ScrollViewProps) => <KeyboardChatScrollView {...props} inverted offset={insets.bottom} />,
    [insets.bottom],
  );

  const callBack = useCallback((kind: CallKind) => placeCall(id, kind), [id]);

  const renderItem = ({ item }: ListRenderItemInfo<ThreadItem>) => {
    if (item.type === 'day') return <DayChip label={item.label} />;
    if (item.type === 'notice') return <PrivacyNotice />;
    const m = item.message;
    if (m.kind === 'system') return <SystemRow message={m} />;
    const mine = m.sender_id === me;
    if (m.kind === 'call') return <CallCard message={m} mine={mine} onCallBack={isRoom ? undefined : callBack} />;
    const state: DeliveryState = m.pending
      ? 'pending'
      : peerReadAt && new Date(peerReadAt).getTime() >= new Date(m.created_at).getTime()
        ? 'read'
        : 'sent';
    const author = isRoom && !mine ? members.get(m.sender_id) : undefined;
    return (
      <Bubble
        message={m}
        mine={mine}
        first={item.first}
        last={item.last}
        state={state}
        animate={animateIds.has(m.id)}
        sender={
          isRoom && !mine
            ? { name: publicName(author), seed: m.sender_id, uri: author?.avatar_url ?? null }
            : null
        }
        onOpenImage={setViewerUri}
      />
    );
  };

  let body;
  if (missing) {
    body = (
      <EmptyState
        art="error"
        title="This conversation is unavailable"
        body="It may have been left or blocked. Nothing from it is visible to anyone outside its members."
        action={{ label: 'Back to chats', onPress: () => (router.canGoBack() ? router.back() : router.replace('/chats')) }}
      />
    );
  } else if (thread.messagesLoading) {
    body = <ThreadSkeleton />;
  } else if (thread.messagesError) {
    body = (
      <EmptyState
        art="error"
        title="Messages did not load"
        body="Check the connection and try again."
        action={{ label: 'Try again', onPress: () => thread.refetchMessages() }}
      />
    );
  } else {
    body = (
      <>
        <FlashList
          data={thread.items}
          inverted
          renderItem={renderItem}
          keyExtractor={(item) => item.key}
          getItemType={(item) =>
            item.type === 'msg' ? `${item.message.kind}-${item.message.sender_id === me ? 'out' : 'in'}` : item.type
          }
          extraData={{ peerReadAt, isRoom, members: conversation?.members }}
          renderScrollComponent={renderScroll}
          // Anchoring would hold the old bottom message in place and hide new arrivals; in an
          // inverted list we want new messages to push the history up instead.
          maintainVisibleContentPosition={{ disabled: true }}
          // Inverted: top padding is the visual bottom, just above the composer.
          contentContainerStyle={{ paddingTop: space[3], paddingBottom: space[4] }}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        />
        {thread.isEmpty ? (
          <View style={styles.emptyOverlay} pointerEvents="box-none">
            <EmptyState
              art="thread"
              title={isRoom ? 'The room is quiet' : 'Start the conversation'}
              body={
                isRoom
                  ? 'Share the agenda or a listing before the meeting. Everyone here sees the same thread.'
                  : 'Messages and calls stay inside LandConnect. Your phone number and email are never shared.'
              }
            />
          </View>
        ) : null}
      </>
    );
  }

  return (
    <Screen>
      <ThreadHeader conversation={conversation} typingName={typingName} topInset={insets.top + space[2]} />
      {conversation?.listing ? <PinnedListing listing={conversation.listing} /> : null}
      <View style={styles.body}>
        {body}
      </View>
      <Composer
        bottomInset={insets.bottom}
        disabled={missing}
        onSend={thread.sendText}
        onPickImage={thread.sendImage}
        onTyping={thread.notifyTyping}
      />
      <ImageViewer uri={viewerUri} onClose={() => setViewerUri(null)} />
    </Screen>
  );
}

/** Bubble-shaped placeholders that match the real radii, alternating sides like a conversation. */
function ThreadSkeleton() {
  const rows: { mine: boolean; w: number; h: number }[] = [
    { mine: false, w: 62, h: 38 },
    { mine: false, w: 44, h: 38 },
    { mine: true, w: 56, h: 60 },
    { mine: false, w: 70, h: 82 },
    { mine: true, w: 40, h: 38 },
    { mine: true, w: 64, h: 38 },
  ];
  return (
    <View style={styles.skeleton}>
      {rows.map((r, i) => (
        <View key={i} style={[styles.skeletonRow, r.mine ? styles.skeletonMine : null]}>
          <Bone
            style={{
              width: `${r.w}%`,
              height: r.h,
              borderRadius: radius.md,
              backgroundColor: r.mine ? colors.bubbleOut : colors.surface,
            }}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, overflow: 'hidden' },
  emptyOverlay: { ...StyleSheet.absoluteFill, justifyContent: 'center' },
  skeleton: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: gutter, paddingBottom: space[4], gap: space[2] },
  skeletonRow: { flexDirection: 'row' },
  skeletonMine: { justifyContent: 'flex-end' },
});
