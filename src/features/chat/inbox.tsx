import { FlashList } from '@shopify/flash-list';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Plus, Search, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { fetchCallLog } from '@/data/call-log';
import { fetchConversations, subscribeInbox } from '@/data/chat';
import { qk } from '@/data/keys';
import { publicName } from '@/lib/format';
import type { ConversationSummary } from '@/lib/types';
import { useSession } from '@/stores/session';
import { colors, gutter, radius, space } from '@/theme/tokens';
import { Field } from '@/ui/field';
import { IconButton } from '@/ui/icon-button';
import { PressableScale } from '@/ui/pressable-scale';
import { LargeTitle, Screen, useScreenInsets } from '@/ui/screen';
import { Segmented } from '@/ui/segmented';
import { Text } from '@/ui/text';

import { CallRow, ConversationRow, RoomCard, groupCalls, type CallGroup } from './inbox-rows';
import { CardSkeleton, EmptyState, ListEnter, RowSkeleton } from './parts';

type Pane = 'chats' | 'rooms' | 'calls';

const PANES = [
  { value: 'chats', label: 'Chats' },
  { value: 'rooms', label: 'Rooms' },
  { value: 'calls', label: 'Calls' },
] as const;

const newRoom = () => router.push('/room/new');

export function InboxScreen() {
  const insets = useScreenInsets({ tabBar: true });
  const queryClient = useQueryClient();
  const [pane, setPane] = useState<Pane>('chats');
  const [query, setQuery] = useState('');

  const conversations = useQuery({ queryKey: qk.conversations, queryFn: fetchConversations });

  // Any change to my conversations (new message, new room, membership) refreshes the list.
  useEffect(() => {
    return subscribeInbox(() => {
      queryClient.invalidateQueries({ queryKey: qk.conversations });
      queryClient.invalidateQueries({ queryKey: qk.callLog });
    });
  }, [queryClient]);

  return (
    <Screen>
      <View style={{ paddingTop: insets.top + space[2] }}>
        <LargeTitle
          eyebrow="Private by design"
          title="Chats"
          trailing={
            <IconButton label="New meeting room" variant="accent" onPress={newRoom}>
              <Plus size={22} color={colors.inkOnDark} strokeWidth={2.3} />
            </IconButton>
          }
        />
        <View style={styles.controls}>
          <Segmented options={PANES} value={pane} onChange={setPane} />
          {pane === 'chats' ? (
            <Field
              placeholder="Search by name"
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              leading={<Search size={18} color={colors.inkTertiary} strokeWidth={2.1} />}
              trailing={
                query ? (
                  <IconButton label="Clear search" size={28} variant="plain" haptic="selection" onPress={() => setQuery('')}>
                    <X size={16} color={colors.inkSecondary} strokeWidth={2.2} />
                  </IconButton>
                ) : null
              }
            />
          ) : null}
        </View>
      </View>

      <Animated.View key={pane} entering={FadeIn.duration(180)} style={styles.flex}>
        {pane === 'chats' ? (
          <ChatsPane
            data={conversations.data}
            loading={conversations.isPending}
            error={conversations.isError}
            refetch={conversations.refetch}
            refreshing={conversations.isRefetching}
            query={query}
            bottom={insets.bottom}
          />
        ) : pane === 'rooms' ? (
          <RoomsPane
            data={conversations.data}
            loading={conversations.isPending}
            error={conversations.isError}
            refetch={conversations.refetch}
            refreshing={conversations.isRefetching}
            bottom={insets.bottom}
          />
        ) : (
          <CallsPane bottom={insets.bottom} />
        )}
      </Animated.View>
    </Screen>
  );
}

type PaneProps = {
  data: ConversationSummary[] | undefined;
  loading: boolean;
  error: boolean;
  refreshing: boolean;
  refetch: () => unknown;
  bottom: number;
};

function ChatsPane({ data, loading, error, refreshing, refetch, query, bottom }: PaneProps & { query: string }) {
  const me = useSession((s) => s.userId);
  const term = query.trim().toLowerCase();
  const direct = (data ?? []).filter(
    (c) => c.kind === 'direct' && (!term || publicName(c.peer).toLowerCase().includes(term)),
  );

  if (loading) {
    return (
      <View style={styles.pad}>
        <RowSkeleton />
      </View>
    );
  }
  if (error) {
    return (
      <EmptyState
        art="error"
        title="Chats did not load"
        body="Your conversations are safe. Check the connection and try again."
        action={{ label: 'Try again', onPress: () => refetch() }}
      />
    );
  }

  return (
    <FlashList
      data={direct}
      keyExtractor={(c) => c.id}
      renderItem={({ item, index }) => (
        <ListEnter index={index}>
          <ConversationRow item={item} me={me} />
        </ListEnter>
      )}
      contentContainerStyle={{ paddingHorizontal: gutter, paddingTop: space[2], paddingBottom: bottom }}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      refreshing={refreshing}
      onRefresh={() => refetch()}
      ListEmptyComponent={
        term ? (
          <EmptyState art="search" title="No one by that name" body="Names follow each person's privacy setting, so try their handle." />
        ) : (
          <EmptyState
            art="chats"
            title="No conversations yet"
            body="Message an owner from any listing. Your phone number and email are never shared."
            action={{ label: 'Explore land', onPress: () => router.navigate('/') }}
          />
        )
      }
    />
  );
}

function RoomsPane({ data, loading, error, refreshing, refetch, bottom }: PaneProps) {
  const rooms = (data ?? []).filter((c) => c.kind === 'room');

  if (loading) {
    return (
      <View style={styles.pad}>
        <CardSkeleton />
      </View>
    );
  }
  if (error) {
    return (
      <EmptyState
        art="error"
        title="Rooms did not load"
        body="Check the connection and try again."
        action={{ label: 'Try again', onPress: () => refetch() }}
      />
    );
  }

  return (
    <FlashList
      data={rooms}
      keyExtractor={(c) => c.id}
      renderItem={({ item, index }) => (
        <ListEnter index={index} style={styles.cardGap}>
          <RoomCard item={item} />
        </ListEnter>
      )}
      contentContainerStyle={{ paddingHorizontal: gutter, paddingTop: space[3], paddingBottom: bottom }}
      refreshing={refreshing}
      onRefresh={() => refetch()}
      ListHeaderComponent={
        rooms.length > 0 ? (
          <NewRoomBanner />
        ) : null
      }
      ListEmptyComponent={
        <EmptyState
          art="rooms"
          title="No meeting rooms"
          body="Bring a buyer, seller and broker together around one parcel, with video, audio and a shared chat."
          action={{ label: 'Create a room', onPress: newRoom, leading: <Plus size={16} color={colors.ink} strokeWidth={2.2} /> }}
        />
      }
    />
  );
}

function NewRoomBanner() {
  return (
    <PressableScale onPress={newRoom} accessibilityLabel="Create a meeting room" style={styles.banner}>
      <View style={styles.bannerIcon}>
        <Plus size={18} color={colors.inkOnDark} strokeWidth={2.3} />
      </View>
      <View style={styles.flex}>
        <Text variant="bodyStrong">Create a meeting room</Text>
        <Text variant="caption" tone="secondary">
          Invite people, set an agenda, meet on video.
        </Text>
      </View>
    </PressableScale>
  );
}

function CallsPane({ bottom }: { bottom: number }) {
  const log = useQuery({ queryKey: qk.callLog, queryFn: fetchCallLog });
  const groups = log.data ? groupCalls(log.data) : [];

  if (log.isPending) {
    return (
      <View style={styles.pad}>
        <RowSkeleton avatar={48} />
      </View>
    );
  }
  if (log.isError) {
    return (
      <EmptyState
        art="error"
        title="Call history did not load"
        body="Check the connection and try again."
        action={{ label: 'Try again', onPress: () => log.refetch() }}
      />
    );
  }

  return (
    <FlashList<CallGroup>
      data={groups}
      keyExtractor={(g) => g.key}
      renderItem={({ item, index }) => (
        <ListEnter index={index}>
          <CallRow group={item} />
        </ListEnter>
      )}
      contentContainerStyle={{ paddingHorizontal: gutter, paddingTop: space[2], paddingBottom: bottom }}
      refreshing={log.isRefetching}
      onRefresh={() => log.refetch()}
      ListEmptyComponent={
        <EmptyState
          art="calls"
          title="No calls yet"
          body="Tap the phone or video button in any chat. Calls run inside LandConnect, so neither side ever sees a phone number."
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  controls: { paddingHorizontal: gutter, gap: space[3], marginTop: space[4], paddingBottom: space[2] },
  pad: { paddingHorizontal: gutter },
  cardGap: { paddingBottom: space[4] },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    padding: space[3],
    marginBottom: space[4],
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.accentSoft,
  },
  bannerIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
