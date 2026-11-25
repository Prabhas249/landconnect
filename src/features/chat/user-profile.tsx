import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Ban, Lock, MapPin, MessageCircle, Phone, ShieldCheck, Video } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { Alert, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { openDirectConversation } from '@/data/chat';
import { qk } from '@/data/keys';
import { fetchListings } from '@/data/listings';
import { fetchProfile, isBlockedByMe, setBlocked } from '@/data/profiles';
import { placeCall } from '@/features/calls/actions';
import { ListingCard } from '@/features/listings/listing-card';
import { formatPresence, isOnline, publicName } from '@/lib/format';
import { errorMessage } from '@/lib/supabase';
import type { CallKind } from '@/lib/types';
import { useSession } from '@/stores/session';
import { colors, gutter, palette, radius, shadow, space } from '@/theme/tokens';
import { Avatar } from '@/ui/avatar';
import { Button } from '@/ui/button';
import { Card } from '@/ui/card';
import { Chip } from '@/ui/chip';
import { Enter } from '@/ui/enter';
import { PressableScale } from '@/ui/pressable-scale';
import { Header, Screen, useScreenInsets } from '@/ui/screen';
import { Label, Text } from '@/ui/text';

import { chatKeys } from './api';
import { Bone, EmptyState, RoleChip, VerifiedTick } from './parts';

const HERO_H = 200;
const AVATAR = 96;

export function UserProfileScreen({ id }: { id: string }) {
  const insets = useScreenInsets();
  const queryClient = useQueryClient();
  const me = useSession((s) => s.userId);
  const isMe = me === id;
  const [busy, setBusy] = useState<null | 'message' | CallKind>(null);

  const profile = useQuery({ queryKey: qk.profile(id), queryFn: () => fetchProfile(id) });
  const blocked = useQuery({ queryKey: chatKeys.blockedUser(id), queryFn: () => isBlockedByMe(id), enabled: !isMe });
  const listings = useQuery({
    queryKey: chatKeys.userListings(id),
    queryFn: async () =>
      (await fetchListings()).filter((l) => l.owner_id === id && (l.status === 'active' || l.status === 'under_offer')),
  });

  const p = profile.data;
  const name = publicName(p);
  const isBlocked = !!blocked.data;

  const block = useMutation({
    mutationFn: (next: boolean) => setBlocked(id, next),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chatKeys.blockedUser(id) });
      queryClient.invalidateQueries({ queryKey: qk.blocked });
      queryClient.invalidateQueries({ queryKey: qk.conversations });
    },
    onError: (e) => Alert.alert('Could not update', errorMessage(e)),
  });

  const confirmBlock = () => {
    if (isBlocked) {
      Alert.alert(`Unblock ${name}?`, 'They will be able to message and call you again.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Unblock', onPress: () => block.mutate(false) },
      ]);
      return;
    }
    Alert.alert(
      `Block ${name}?`,
      'They will not be able to message you, call you or add you to rooms. They are not told that you blocked them.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Block', style: 'destructive', onPress: () => block.mutate(true) },
      ],
    );
  };

  /** Every contact route goes through a conversation, so no number or address is ever exchanged. */
  const contact = async (action: 'message' | CallKind) => {
    setBusy(action);
    try {
      const conversationId = await openDirectConversation(id);
      queryClient.invalidateQueries({ queryKey: qk.conversations });
      if (action === 'message') router.push({ pathname: '/chat/[id]', params: { id: conversationId } });
      else await placeCall(conversationId, action);
    } catch (e) {
      Alert.alert('Unavailable', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  let content: ReactNode;
  if (profile.isPending) {
    content = <ProfileSkeleton />;
  } else if (profile.isError || !p) {
    content = (
      <EmptyState
        art="error"
        title={profile.isError ? 'Profile did not load' : 'Profile unavailable'}
        body={
          profile.isError
            ? 'Check the connection and try again.'
            : 'This account may be closed, or one of you has blocked the other.'
        }
        action={profile.isError ? { label: 'Try again', onPress: () => profile.refetch() } : undefined}
      />
    );
  } else {
    const presence = formatPresence(p);
    const actionsOff = isMe || isBlocked;
    const active = listings.data ?? [];

    content = (
      <View style={styles.stack}>
        <View style={styles.hero}>
          <SoftHalo />
          <Enter index={0} style={styles.heroInner}>
            <Avatar name={name} seed={p.id} uri={p.avatar_url} size={AVATAR} online={isOnline(p)} ring />
            <View style={styles.nameRow}>
              <Text variant="title" numberOfLines={1} style={styles.shrink}>
                {name}
              </Text>
              {p.verified ? <VerifiedTick size={20} /> : null}
            </View>
            <Label>{p.show_real_name ? p.handle : 'Anonymous handle'}</Label>
            <View style={styles.chips}>
              <RoleChip role={p.role} />
              {p.verified ? <Chip mono label="Verified" tone="accent" /> : null}
              {p.city ? (
                <Chip mono label={p.city} leading={<MapPin size={11} color={colors.inkSecondary} strokeWidth={2.2} />} />
              ) : null}
            </View>
            {presence ? (
              <Text variant="caption" tone={presence === 'online' ? 'accent' : 'tertiary'}>
                {presence}
              </Text>
            ) : null}
          </Enter>
        </View>

        <View style={styles.body}>
          {!isMe ? (
            <Enter index={1} style={styles.actions}>
              <ActionTile
                label="Message"
                icon={<MessageCircle size={20} color={colors.accent} strokeWidth={2.1} />}
                disabled={actionsOff}
                loading={busy === 'message'}
                onPress={() => contact('message')}
              />
              <ActionTile
                label="Audio"
                icon={<Phone size={20} color={colors.accent} strokeWidth={2.1} />}
                disabled={actionsOff || p.allow_calls === 'nobody'}
                loading={busy === 'audio'}
                onPress={() => contact('audio')}
              />
              <ActionTile
                label="Video"
                icon={<Video size={20} color={colors.accent} strokeWidth={2.1} />}
                disabled={actionsOff || p.allow_calls === 'nobody'}
                loading={busy === 'video'}
                onPress={() => contact('video')}
              />
            </Enter>
          ) : null}

          {p.about ? (
            <Enter index={2}>
              <Card padding={5}>
                <Label>About</Label>
                <Text variant="body" style={styles.about}>
                  {p.about}
                </Text>
              </Card>
            </Enter>
          ) : null}

          <Enter index={3}>
            <Card tone="accent" padding={5} style={styles.privacy}>
              <View style={styles.privacyIcon}>
                <ShieldCheck size={20} color={colors.accent} strokeWidth={2.1} />
              </View>
              <View style={styles.flex}>
                <Text variant="bodyStrong">Contact details stay private</Text>
                <Text variant="caption" tone="secondary">
                  Phone numbers and email addresses are never shown to anyone. Messages and calls run inside
                  LandConnect{p.allow_calls === 'nobody' ? `, and ${name} is not taking calls right now` : ''}.
                </Text>
              </View>
            </Card>
          </Enter>

          <Enter index={4} style={styles.section}>
            <Label>{active.length > 0 ? `Active listings · ${active.length}` : 'Active listings'}</Label>
            {listings.isPending ? (
              <Bone style={{ height: 100, borderRadius: radius.lg }} />
            ) : active.length === 0 ? (
              <Card tone="muted" padding={5} elevated={false}>
                <Text variant="caption" tone="secondary">
                  {isMe ? 'You have no active listings.' : `${name} has no active listings right now.`}
                </Text>
              </Card>
            ) : (
              <View style={styles.listings}>
                {active.map((l) => (
                  <ListingCard
                    key={l.id}
                    listing={l}
                    variant="compact"
                    onPress={() => router.push({ pathname: '/listing/[id]', params: { id: l.id } })}
                  />
                ))}
              </View>
            )}
          </Enter>

          {!isMe ? (
            <Enter index={5}>
              <Card padding={5} style={styles.blockCard}>
                <View style={styles.blockHead}>
                  <View style={[styles.privacyIcon, styles.blockIcon]}>
                    {isBlocked ? (
                      <Lock size={18} color={colors.danger} strokeWidth={2.1} />
                    ) : (
                      <Ban size={18} color={colors.danger} strokeWidth={2.1} />
                    )}
                  </View>
                  <View style={styles.flex}>
                    <Text variant="bodyStrong">{isBlocked ? `You blocked ${name}` : `Block ${name}`}</Text>
                    <Text variant="caption" tone="secondary">
                      {isBlocked
                        ? 'They cannot message you, call you or add you to rooms. Unblock to talk again.'
                        : 'Stops all messages, calls and room invites from them. They are not notified.'}
                    </Text>
                  </View>
                </View>
                <Button
                  label={isBlocked ? 'Unblock' : 'Block'}
                  variant={isBlocked ? 'soft' : 'danger'}
                  size="md"
                  loading={block.isPending}
                  disabled={blocked.isPending}
                  onPress={confirmBlock}
                />
              </Card>
            </Enter>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <Screen>
      <View style={{ paddingTop: insets.top }}>
        <Header title="Profile" />
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom }} showsVerticalScrollIndicator={false}>
        {content}
      </ScrollView>
    </Screen>
  );
}

function ActionTile({
  label,
  icon,
  disabled,
  loading,
  onPress,
}: {
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  loading?: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled || loading}
      haptic="medium"
      accessibilityLabel={label}
      style={styles.tile}>
      <View style={styles.tileIcon}>{icon}</View>
      <Text variant="captionStrong">{loading ? 'Opening…' : label}</Text>
    </PressableScale>
  );
}

/** Soft mint glow behind the avatar, fading into the canvas at the edges. */
function SoftHalo() {
  const { width } = useWindowDimensions();
  return (
    <Svg width={width} height={HERO_H + 60} style={styles.halo} pointerEvents="none">
      <Defs>
        <RadialGradient id="halo" cx="50%" cy="40%" rx="55%" ry="55%">
          <Stop offset="0" stopColor={palette.mintWash} stopOpacity={1} />
          <Stop offset="1" stopColor={colors.canvas} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x={0} y={0} width={width} height={HERO_H + 60} fill="url(#halo)" />
    </Svg>
  );
}

function ProfileSkeleton() {
  return (
    <View style={styles.skeleton}>
      <Bone style={{ width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2 }} />
      <Bone style={{ width: 180, height: 26, borderRadius: radius.xs }} />
      <Bone style={{ width: 120, height: 14, borderRadius: radius.xs }} />
      <View style={styles.skeletonTiles}>
        <Bone style={styles.skeletonTile} />
        <Bone style={styles.skeletonTile} />
        <Bone style={styles.skeletonTile} />
      </View>
      <Bone style={{ alignSelf: 'stretch', height: 110, borderRadius: radius.xl }} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  stack: { gap: space[5] },
  hero: { minHeight: HERO_H, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', top: -40, left: 0 },
  heroInner: { alignItems: 'center', gap: space[2], paddingHorizontal: gutter },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: space[2] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space[2], marginTop: space[1] },
  body: { paddingHorizontal: gutter, gap: space[5] },
  actions: { flexDirection: 'row', gap: space[3] },
  tile: {
    flex: 1,
    alignItems: 'center',
    gap: space[2],
    paddingVertical: space[4],
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    boxShadow: shadow.card,
  },
  tileIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  about: { marginTop: space[2] },
  privacy: { flexDirection: 'row', gap: space[4], alignItems: 'flex-start' },
  privacyIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: { gap: space[3] },
  listings: { gap: space[3] },
  blockCard: { gap: space[4] },
  blockHead: { flexDirection: 'row', gap: space[4], alignItems: 'flex-start' },
  blockIcon: { backgroundColor: colors.dangerSoft },
  skeleton: { alignItems: 'center', gap: space[3], paddingHorizontal: gutter, paddingTop: space[8] },
  skeletonTiles: { flexDirection: 'row', gap: space[3], alignSelf: 'stretch', marginTop: space[4] },
  skeletonTile: { flex: 1, height: 96, borderRadius: radius.lg },
});
