import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { CalendarClock, LogOut, MessageCircle, Phone, UserRound, Video } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { fetchLiveRoomSession } from '@/data/calls';
import { fetchConversation, leaveConversation } from '@/data/chat';
import { qk } from '@/data/keys';
import { joinRoom } from '@/features/calls/actions';
import { formatAgo, formatDateTime, publicName } from '@/lib/format';
import { errorMessage } from '@/lib/supabase';
import type { Profile } from '@/lib/types';
import { useSession } from '@/stores/session';
import { colors, gutter, radius, space } from '@/theme/tokens';
import { Avatar } from '@/ui/avatar';
import { Button } from '@/ui/button';
import { Card, Divider } from '@/ui/card';
import { Enter } from '@/ui/enter';
import { PressableScale } from '@/ui/pressable-scale';
import { Header, Screen, useScreenInsets } from '@/ui/screen';
import { Label, Text } from '@/ui/text';

import { Bone, EmptyState, LiveBadge, LiveDot, RoleChip, VerifiedTick } from './parts';
import { RoundTable } from './round-table';

const goBack = () => (router.canGoBack() ? router.back() : router.replace('/chats'));

export function RoomLobby({ id }: { id: string }) {
  const insets = useScreenInsets();
  const queryClient = useQueryClient();
  const me = useSession((s) => s.userId);
  const [leaving, setLeaving] = useState(false);

  const room = useQuery({ queryKey: qk.conversation(id), queryFn: () => fetchConversation(id) });
  const live = useQuery({
    queryKey: qk.roomSession(id),
    queryFn: () => fetchLiveRoomSession(id),
    refetchInterval: 15_000,
  });

  const data = room.data;
  const session = live.data ?? null;

  const confirmLeave = () => {
    Alert.alert(
      'Leave this room?',
      'You will stop receiving its messages and will need a new invite to rejoin. Others keep the history.',
      [
        { text: 'Stay', style: 'cancel' },
        {
          text: 'Leave room',
          style: 'destructive',
          onPress: async () => {
            setLeaving(true);
            try {
              await leaveConversation(id);
              await queryClient.invalidateQueries({ queryKey: qk.conversations });
              queryClient.removeQueries({ queryKey: qk.conversation(id) });
              router.dismissTo('/chats');
            } catch (e) {
              Alert.alert('Could not leave', errorMessage(e));
            } finally {
              setLeaving(false);
            }
          },
        },
      ],
    );
  };

  let content;
  if (room.isPending) {
    content = <LobbySkeleton />;
  } else if (room.isError || !data || data.kind !== 'room') {
    content = (
      <EmptyState
        art="error"
        title={room.isError ? 'The room did not load' : 'This room is unavailable'}
        body={room.isError ? 'Check the connection and try again.' : 'You may have left it, or it was closed by the host.'}
        action={room.isError ? { label: 'Try again', onPress: () => room.refetch() } : { label: 'Back to chats', onPress: goBack }}
      />
    );
  } else {
    const host = data.members.find((p) => p.id === data.created_by);
    // Host first, then me, then everyone else by name, so the seating reads naturally.
    const rank = (p: Profile) => (p.id === data.created_by ? 0 : p.id === me ? 1 : 2);
    const members = [...data.members].sort((a, b) => rank(a) - rank(b) || publicName(a).localeCompare(publicName(b)));

    content = (
      <>
        <RoundTable members={members} live={!!session} hostId={data.created_by} />

        <View style={styles.body}>
          <Enter index={0} style={styles.titleBlock}>
            <View style={styles.eyebrow}>
              <Label>Meeting room</Label>
              {session ? <LiveBadge label="Live now" /> : null}
            </View>
            <Text variant="title">{data.title?.trim() || 'Untitled room'}</Text>
            {data.agenda ? (
              <Text variant="body" tone="secondary">
                {data.agenda}
              </Text>
            ) : null}
          </Enter>

          <Enter index={1}>
            <Card padding={4}>
              <View style={styles.fact}>
                <View style={styles.factIcon}>
                  <CalendarClock size={18} color={colors.accent} strokeWidth={2.1} />
                </View>
                <View style={styles.flex}>
                  <Label>Scheduled</Label>
                  <Text variant="bodyStrong" style={styles.tabular}>
                    {data.scheduled_at ? formatDateTime(data.scheduled_at) : 'Any time'}
                  </Text>
                </View>
              </View>
              <View style={styles.factDivider}>
                <Divider inset={44 + space[3]} />
              </View>
              <View style={styles.fact}>
                <View style={[styles.factIcon, session ? styles.factIconLive : null]}>
                  {session ? <LiveDot size={8} color={colors.accent} /> : <Video size={18} color={colors.inkTertiary} strokeWidth={2.1} />}
                </View>
                <View style={styles.flex}>
                  <Label>Session</Label>
                  <Text variant="bodyStrong" tone={session ? 'accent' : 'ink'} style={styles.tabular}>
                    {session ? `Live, started ${formatAgo(session.answered_at ?? session.created_at)}` : 'Nobody in the room yet'}
                  </Text>
                </View>
              </View>
              {host ? (
                <>
                  <View style={styles.factDivider}>
                    <Divider inset={44 + space[3]} />
                  </View>
                  <View style={styles.fact}>
                    <View style={styles.factIcon}>
                      <UserRound size={18} color={colors.inkSecondary} strokeWidth={2.1} />
                    </View>
                    <View style={styles.flex}>
                      <Label>Hosted by</Label>
                      <Text variant="bodyStrong" numberOfLines={1}>
                        {host.id === me ? 'You' : publicName(host)}
                      </Text>
                    </View>
                  </View>
                </>
              ) : null}
            </Card>
          </Enter>

          <Enter index={2} style={styles.actions}>
            <Button
              label={session ? 'Join with video' : 'Start with video'}
              variant="accent"
              haptic="medium"
              leading={<Video size={19} color={colors.inkOnDark} strokeWidth={2.2} />}
              onPress={() => joinRoom(id, 'video')}
            />
            <View style={styles.actionRow}>
              <Button
                label="Join with audio"
                variant="soft"
                size="md"
                style={styles.flex}
                leading={<Phone size={17} color={colors.ink} strokeWidth={2.1} />}
                onPress={() => joinRoom(id, 'audio')}
              />
              <Button
                label="Room chat"
                variant="soft"
                size="md"
                style={styles.flex}
                leading={<MessageCircle size={17} color={colors.ink} strokeWidth={2.1} />}
                onPress={() => router.push({ pathname: '/chat/[id]', params: { id } })}
              />
            </View>
          </Enter>

          <Enter index={3}>
            <Card padding={4}>
              <Label style={styles.cardLabel}>
                {members.length} {members.length === 1 ? 'member' : 'members'}
              </Label>
              {members.map((p, i) => (
                <View key={p.id}>
                  {i > 0 ? <Divider inset={40 + space[3]} /> : null}
                  <MemberRow profile={p} isHost={p.id === data.created_by} isMe={p.id === me} />
                </View>
              ))}
            </Card>
          </Enter>

          <Enter index={4}>
            <PressableScale onPress={confirmLeave} disabled={leaving} style={styles.leave} accessibilityLabel="Leave room">
              <LogOut size={18} color={colors.danger} strokeWidth={2.1} />
              <Text variant="bodyStrong" tone="danger">
                Leave room
              </Text>
            </PressableScale>
          </Enter>
        </View>
      </>
    );
  }

  return (
    <Screen>
      <View style={{ paddingTop: insets.top }}>
        <Header title="Room" onBack={goBack} />
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom }} showsVerticalScrollIndicator={false}>
        {content}
      </ScrollView>
    </Screen>
  );
}

function MemberRow({ profile, isHost, isMe }: { profile: Profile; isHost: boolean; isMe: boolean }) {
  const name = publicName(profile);
  return (
    <PressableScale
      haptic={isMe ? false : 'selection'}
      to={isMe ? 1 : 0.98}
      accessibilityLabel={`${name}${isHost ? ', host' : ''}`}
      onPress={isMe ? undefined : () => router.push({ pathname: '/user/[id]', params: { id: profile.id } })}
      style={styles.member}>
      <Avatar name={name} seed={profile.id} uri={profile.avatar_url} size={40} />
      <View style={styles.flex}>
        <View style={styles.nameRow}>
          <Text variant="bodyStrong" numberOfLines={1} style={styles.shrink}>
            {isMe ? `${name} (you)` : name}
          </Text>
          {profile.verified ? <VerifiedTick size={14} /> : null}
        </View>
        {profile.city ? (
          <Text variant="caption" tone="tertiary" numberOfLines={1}>
            {profile.city}
          </Text>
        ) : null}
      </View>
      {isHost ? <HostChip label="Host" /> : null}
      <RoleChip role={profile.role} />
    </PressableScale>
  );
}

function HostChip({ label }: { label: string }) {
  return (
    <View style={styles.hostChip}>
      <Label tone="accent">{label}</Label>
    </View>
  );
}

function LobbySkeleton() {
  return (
    <View style={styles.skeleton}>
      <View style={styles.skeletonHero}>
        <Bone style={{ width: 240, height: 116, borderRadius: radius.pill }} />
      </View>
      <View style={styles.body}>
        <Bone style={{ width: '60%', height: 28, borderRadius: radius.xs }} />
        <Bone style={{ width: '85%', height: 16, borderRadius: radius.xs }} />
        <Bone style={{ height: 150, borderRadius: radius.xl }} />
        <Bone style={{ height: 56, borderRadius: radius.pill }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  tabular: { fontVariant: ['tabular-nums'] },
  body: { paddingHorizontal: gutter, gap: space[5] },
  titleBlock: { gap: space[2], marginTop: -space[4] },
  eyebrow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  fact: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  factIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  factIconLive: { backgroundColor: colors.accentSoft },
  factDivider: { marginVertical: space[3] },
  actions: { gap: space[3] },
  actionRow: { flexDirection: 'row', gap: space[3] },
  cardLabel: { marginBottom: space[1] },
  member: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[3] },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  hostChip: {
    height: 24,
    paddingHorizontal: space[2] + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    justifyContent: 'center',
  },
  leave: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.dangerSoft,
  },
  skeleton: { gap: space[5] },
  skeletonHero: { height: 260, alignItems: 'center', justifyContent: 'center' },
});
