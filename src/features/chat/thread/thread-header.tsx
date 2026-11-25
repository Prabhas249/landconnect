import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { ChevronLeft, ChevronRight, Lock, MapPin, Phone, Video } from 'lucide-react-native';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { fetchLiveRoomSession } from '@/data/calls';
import { qk } from '@/data/keys';
import { joinRoom, placeCall } from '@/features/calls/actions';
import { photoUrl } from '@/features/listings/media/image-variants';
import { formatPresence, formatPrice, isOnline, publicName } from '@/lib/format';
import type { ConversationSummary } from '@/lib/types';
import { colors, gutter, radius, shadow, space } from '@/theme/tokens';
import { Avatar } from '@/ui/avatar';
import { Button } from '@/ui/button';
import { IconButton } from '@/ui/icon-button';
import { PressableScale } from '@/ui/pressable-scale';
import { Label, Text } from '@/ui/text';

import { LiveDot, RoleChip, VerifiedTick } from '../parts';
import { callTint } from '../tints';

// ── typing dots

function Dot({ t, index }: { t: SharedValue<number>; index: number }) {
  const style = useAnimatedStyle(() => {
    // Each dot peaks a third of a cycle after the previous one.
    const phase = (t.get() + 1 - index / 3) % 1;
    const lift = phase < 0.5 ? Math.sin(phase * Math.PI * 2) : 0;
    return { opacity: 0.4 + lift * 0.6, transform: [{ translateY: -lift * 2.5 }] };
  });
  return <Animated.View style={[styles.dot, style]} />;
}

export function TypingDots() {
  const t = useSharedValue(0);
  useEffect(() => {
    t.set(withRepeat(withSequence(withTiming(1, { duration: 1100 }), withTiming(0, { duration: 0 })), -1, false));
  }, [t]);
  return (
    <View style={styles.dots}>
      <Dot t={t} index={0} />
      <Dot t={t} index={1} />
      <Dot t={t} index={2} />
    </View>
  );
}

// ── header

export function ThreadHeader({
  conversation,
  typingName,
  topInset,
}: {
  conversation: ConversationSummary | null;
  typingName: string | null;
  topInset: number;
}) {
  const isRoom = conversation?.kind === 'room';
  const peer = conversation?.peer ?? null;
  const id = conversation?.id;

  const { data: live } = useQuery({
    queryKey: qk.roomSession(id ?? ''),
    queryFn: () => fetchLiveRoomSession(id!),
    enabled: !!id && isRoom,
    refetchInterval: 20_000,
  });

  const name = !conversation
    ? ' '
    : isRoom
      ? conversation.title?.trim() || 'Meeting room'
      : peer
        ? publicName(peer)
        : 'Former member';

  // Direct chats always carry the privacy story: who is anonymous, and that numbers never travel.
  let status: string;
  if (!conversation) status = ' ';
  else if (isRoom) status = `${conversation.members.length} members${live ? ' · live now' : ''}`;
  else if (peer) status = [formatPresence(peer), peer.show_real_name ? null : 'anonymous', 'number hidden'].filter(Boolean).join(' · ');
  else status = 'No longer available';
  const online = !isRoom && !!peer && isOnline(peer);

  const openDetails = () => {
    if (!conversation) return;
    if (isRoom) router.push({ pathname: '/room/[id]', params: { id: conversation.id } });
    else if (peer) router.push({ pathname: '/user/[id]', params: { id: peer.id } });
  };

  return (
    <View style={[styles.header, { paddingTop: topInset }]}>
      <IconButton label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/chats'))}>
        <ChevronLeft size={22} color={colors.ink} strokeWidth={2.2} />
      </IconButton>

      <PressableScale
        haptic="selection"
        to={0.98}
        style={styles.identity}
        accessibilityLabel={isRoom ? 'Room details' : 'View profile'}
        onPress={openDetails}>
        {conversation ? (
          <Avatar
            name={name}
            seed={isRoom ? conversation.id : (peer?.id ?? conversation.id)}
            uri={isRoom ? null : peer?.avatar_url}
            size={40}
            online={online}
          />
        ) : (
          <View style={styles.avatarGhost} />
        )}
        <View style={styles.identityText}>
          <View style={styles.nameRow}>
            <Text variant="bodyStrong" numberOfLines={1} style={styles.shrink}>
              {name}
            </Text>
            {!isRoom && peer?.verified ? <VerifiedTick size={14} /> : null}
            {!isRoom && peer ? <RoleChip role={peer.role} /> : null}
          </View>
          {typingName ? (
            <Animated.View key="typing" entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={styles.statusRow}>
              <TypingDots />
              <Text variant="caption" tone="accent" numberOfLines={1}>
                {isRoom ? `${typingName} is typing…` : 'typing…'}
              </Text>
            </Animated.View>
          ) : (
            <Animated.View key="status" entering={FadeIn.duration(160)} style={styles.statusRow}>
              {isRoom && live ? <LiveDot size={6} color={colors.accent} /> : null}
              {!isRoom && peer ? (
                <Lock size={11} color={online ? colors.accent : colors.inkTertiary} strokeWidth={2.4} />
              ) : null}
              <Text
                variant="caption"
                tone={online ? 'accent' : 'secondary'}
                numberOfLines={1}
                style={styles.tabular}>
                {status}
              </Text>
            </Animated.View>
          )}
        </View>
      </PressableScale>

      {conversation && !isRoom && peer ? (
        <View style={styles.actions}>
          <IconButton
            label={`Voice call ${name}`}
            size={40}
            variant="plain"
            haptic="medium"
            style={{ backgroundColor: callTint.voice.wash }}
            onPress={() => placeCall(conversation.id, 'audio')}>
            <Phone size={18} color={callTint.voice.ink} strokeWidth={2.2} />
          </IconButton>
          <IconButton
            label={`Video call ${name}`}
            size={40}
            variant="plain"
            haptic="medium"
            style={{ backgroundColor: callTint.video.wash }}
            onPress={() => placeCall(conversation.id, 'video')}>
            <Video size={19} color={callTint.video.ink} strokeWidth={2.2} />
          </IconButton>
        </View>
      ) : null}
      {conversation && isRoom ? (
        <Button
          label={live ? 'Join' : 'Start'}
          size="sm"
          variant="accent"
          block={false}
          haptic="medium"
          leading={<Video size={15} color={colors.inkOnDark} strokeWidth={2.2} />}
          onPress={() => joinRoom(conversation.id)}
        />
      ) : null}
    </View>
  );
}

// ── pinned listing

export function PinnedListing({ listing }: { listing: NonNullable<ConversationSummary['listing']> }) {
  return (
    <Animated.View entering={FadeIn.duration(220)} style={styles.pinWrap}>
      <PressableScale
        to={0.98}
        accessibilityLabel={`Open listing ${listing.title}`}
        onPress={() => router.push({ pathname: '/listing/[id]', params: { id: listing.id } })}
        style={styles.pin}>
        {listing.images[0] ? (
          <Image
            source={{ uri: photoUrl(listing.images[0], 'thumb') }}
            style={styles.pinThumb}
            contentFit="cover"
            transition={160}
            cachePolicy="memory-disk"
          />
        ) : (
          <View style={[styles.pinThumb, styles.pinThumbEmpty]}>
            <MapPin size={16} color={colors.accent} strokeWidth={2.2} />
          </View>
        )}
        <View style={styles.pinText}>
          <Label>About · {listing.locality}</Label>
          <Text variant="captionStrong" numberOfLines={1}>
            {listing.title}
          </Text>
        </View>
        <Text variant="captionStrong" tone="accent" style={styles.tabular}>
          {formatPrice(listing.price_total)}
        </Text>
        <ChevronRight size={16} color={colors.inkTertiary} strokeWidth={2.2} />
      </PressableScale>
    </Animated.View>
  );
}

/** The pinned bar sits on a card: thumb radius = card radius − inset. */
const PIN_INSET = space[1];
const PIN_RADIUS = radius.md;

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingHorizontal: gutter,
    paddingBottom: space[2],
    backgroundColor: colors.canvas,
  },
  identity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 44 },
  avatarGhost: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken },
  identityText: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space[1] + 2, height: 18 },
  actions: { flexDirection: 'row', gap: space[2] },
  shrink: { flexShrink: 1 },
  tabular: { fontVariant: ['tabular-nums'] },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 18 },
  dot: { width: 5, height: 5, borderRadius: radius.pill, backgroundColor: colors.accent },
  pinWrap: { paddingHorizontal: gutter, paddingBottom: space[2], backgroundColor: colors.canvas },
  pin: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    padding: PIN_INSET,
    paddingRight: space[3],
    borderRadius: PIN_RADIUS,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    boxShadow: shadow.card,
  },
  pinThumb: { width: 40, height: 40, borderRadius: PIN_RADIUS - PIN_INSET, borderCurve: 'continuous' },
  pinThumbEmpty: { backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  pinText: { flex: 1, gap: 1 },
});
