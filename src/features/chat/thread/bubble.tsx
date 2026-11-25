import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { CheckCheck, Clock3, MapPin } from 'lucide-react-native';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, { withSpring, withTiming, type EntryExitAnimationFunction } from 'react-native-reanimated';

import { fetchListingCard } from '@/data/chat';
import { formatArea, formatPrice, formatTime } from '@/lib/format';
import type { Message } from '@/lib/types';
import { colors, duration, gutter, radius, shadow, space, spring } from '@/theme/tokens';
import { Avatar } from '@/ui/avatar';
import { PressableScale } from '@/ui/pressable-scale';
import { Label, Text } from '@/ui/text';

import { chatKeys } from '../api';

/** Corner radii: open corners, corners that touch a neighbour in the run, and the tail corner. */
const R_OPEN = radius.md;
const R_JOIN = radius.xs;
const R_TAIL = radius.xs / 2;
/** Media sits inside the bubble with a hairline of padding, so its radius is the bubble's minus that. */
const MEDIA_PAD = space[1];
const R_MEDIA = R_OPEN - MEDIA_PAD;
const MEDIA_W = 248;
const ROOM_AVATAR = 28;

export type DeliveryState = 'pending' | 'sent' | 'read';

/** Spring up from slightly below the final spot, fading in. Outgoing bubbles grow from the right edge. */
function bubbleIn(mine: boolean): EntryExitAnimationFunction {
  return () => {
    'worklet';
    return {
      initialValues: {
        opacity: 0,
        transform: [{ translateY: space[4] }, { translateX: mine ? space[3] : -space[3] }, { scale: 0.94 }],
      },
      animations: {
        opacity: withTiming(1, { duration: duration.base }),
        transform: [
          { translateY: withSpring(0, spring.gentle) },
          { translateX: withSpring(0, spring.gentle) },
          { scale: withSpring(1, spring.gentle) },
        ],
      },
    };
  };
}
const ENTER_MINE = bubbleIn(true);
const ENTER_THEIRS = bubbleIn(false);

// ── meta (time + ticks)

function Ticks({ state, onMedia }: { state: DeliveryState; onMedia?: boolean }) {
  const base = onMedia ? colors.inkOnDark : colors.inkTertiary;
  if (state === 'pending') return <Clock3 size={12} color={base} strokeWidth={2.2} />;
  return <CheckCheck size={15} color={state === 'read' ? (onMedia ? colors.accentBright : colors.accent) : base} strokeWidth={2.2} />;
}

function Meta({ time, mine, state, onMedia }: { time: string; mine: boolean; state: DeliveryState; onMedia?: boolean }) {
  return (
    <View style={[styles.meta, onMedia ? styles.metaOnMedia : null]}>
      <Label tone={onMedia ? 'onDark' : 'tertiary'} style={styles.metaText}>
        {time}
      </Label>
      {mine ? <Ticks state={state} onMedia={onMedia} /> : null}
    </View>
  );
}

/** Invisible copy of the meta that reserves room at the end of the last text line, WhatsApp-style. */
function MetaSpacer({ time, mine }: { time: string; mine: boolean }) {
  return (
    <Text variant="label" style={styles.metaSpacer}>
      {'   '}
      {time.replace(/ /g, ' ')}
      {mine ? '   ' : ''}
    </Text>
  );
}

// ── bubble

export type BubbleProps = {
  message: Message;
  mine: boolean;
  first: boolean;
  last: boolean;
  state: DeliveryState;
  animate: boolean;
  /** Rooms show who said what. */
  sender?: { name: string; seed: string; uri: string | null } | null;
  onOpenImage: (uri: string) => void;
};

export function Bubble({ message, mine, first, last, state, animate, sender, onOpenImage }: BubbleProps) {
  const time = formatTime(message.created_at);
  const showRoomAvatar = !mine && !!sender;

  const corners = mine
    ? {
        borderTopLeftRadius: R_OPEN,
        borderBottomLeftRadius: R_OPEN,
        borderTopRightRadius: first ? R_OPEN : R_JOIN,
        borderBottomRightRadius: last ? R_TAIL : R_JOIN,
      }
    : {
        borderTopRightRadius: R_OPEN,
        borderBottomRightRadius: R_OPEN,
        borderTopLeftRadius: first ? R_OPEN : R_JOIN,
        borderBottomLeftRadius: last ? R_TAIL : R_JOIN,
      };

  let content;
  if (message.kind === 'image' && message.meta.image_url) {
    const uri = message.meta.image_url;
    content = (
      <View style={[styles.bubble, styles.mediaBubble, corners, mine ? styles.out : styles.in]}>
        <PressableScale
          haptic={false}
          to={0.98}
          disabled={!!message.pending}
          accessibilityLabel="Open photo"
          onPress={() => onOpenImage(uri)}>
          <Image source={{ uri }} style={styles.media} contentFit="cover" transition={200} />
        </PressableScale>
        {message.pending ? (
          <View style={styles.mediaLoading} pointerEvents="none">
            <ActivityIndicator color={colors.inkOnDark} />
          </View>
        ) : null}
        <View style={styles.mediaMeta} pointerEvents="none">
          <Meta time={time} mine={mine} state={state} onMedia />
        </View>
      </View>
    );
  } else if (message.kind === 'listing' && message.meta.listing_id) {
    content = (
      <View style={[styles.bubble, styles.mediaBubble, corners, mine ? styles.out : styles.in]}>
        <ListingAttachment listingId={message.meta.listing_id} />
        {message.body ? (
          <Text variant="body" style={styles.mediaCaption}>
            {message.body}
            <MetaSpacer time={time} mine={mine} />
          </Text>
        ) : (
          <View style={styles.mediaCaptionSpacer} />
        )}
        <Meta time={time} mine={mine} state={state} />
      </View>
    );
  } else {
    content = (
      <View style={[styles.bubble, styles.textBubble, corners, mine ? styles.out : styles.in]}>
        <Text variant="body" selectable>
          {message.body}
          <MetaSpacer time={time} mine={mine} />
        </Text>
        <Meta time={time} mine={mine} state={state} />
      </View>
    );
  }

  return (
    <Animated.View
      key={message.id}
      entering={animate ? (mine ? ENTER_MINE : ENTER_THEIRS) : undefined}
      style={[styles.row, mine ? styles.rowMine : null, { paddingTop: first ? space[2] : 2 }]}>
      {showRoomAvatar ? (
        <View style={styles.roomAvatar}>
          {last ? <Avatar name={sender.name} seed={sender.seed} uri={sender.uri} size={ROOM_AVATAR} /> : null}
        </View>
      ) : null}
      <View style={[styles.column, mine ? styles.columnMine : null, message.pending ? styles.pending : null]}>
        {showRoomAvatar && first ? (
          <Text variant="captionStrong" tone="accent" numberOfLines={1} style={styles.senderName}>
            {sender.name}
          </Text>
        ) : null}
        {content}
      </View>
    </Animated.View>
  );
}

// ── listing attachment

function ListingAttachment({ listingId }: { listingId: string }) {
  const { data, isPending } = useQuery({
    queryKey: chatKeys.listingCard(listingId),
    queryFn: () => fetchListingCard(listingId),
    staleTime: 5 * 60_000,
  });

  if (isPending) {
    return (
      <View>
        <View style={[styles.media, styles.mediaPlaceholder]} />
        <View style={styles.listingText}>
          <View style={[styles.placeholderLine, { width: '70%' }]} />
          <View style={[styles.placeholderLine, { width: '45%' }]} />
        </View>
      </View>
    );
  }
  if (!data) {
    return (
      <View style={styles.listingText}>
        <Text variant="captionStrong" tone="secondary">
          This listing is no longer available
        </Text>
      </View>
    );
  }

  return (
    <PressableScale
      to={0.98}
      accessibilityLabel={`Open listing ${data.title}`}
      onPress={() => router.push({ pathname: '/listing/[id]', params: { id: data.id } })}>
      {data.images[0] ? (
        <Image source={{ uri: data.images[0] }} style={styles.media} contentFit="cover" transition={200} />
      ) : (
        <View style={[styles.media, styles.mediaPlaceholder, styles.center]}>
          <MapPin size={22} color={colors.accent} strokeWidth={2} />
        </View>
      )}
      <View style={styles.listingText}>
        <Label>Shared listing</Label>
        <Text variant="bodyStrong" numberOfLines={2}>
          {data.title}
        </Text>
        <View style={styles.listingFacts}>
          <Text variant="captionStrong" tone="accent" style={styles.tabular}>
            {formatPrice(data.price_total)}
          </Text>
          <Text variant="caption" tone="secondary" numberOfLines={1} style={[styles.tabular, styles.shrink]}>
            {formatArea(data.area_value, data.area_unit)} · {data.locality}
          </Text>
        </View>
      </View>
    </PressableScale>
  );
}

// ── centred rows

export function DayChip({ label }: { label: string }) {
  return (
    <View style={styles.centerRow}>
      <View style={styles.dayChip}>
        <Label tone="secondary">{label}</Label>
      </View>
    </View>
  );
}

export function SystemRow({ message }: { message: Message }) {
  return (
    <View style={styles.centerRow}>
      <View style={styles.systemChip}>
        <Text variant="caption" tone="secondary" center>
          {message.body}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: gutter, gap: space[2] },
  rowMine: { justifyContent: 'flex-end' },
  column: { maxWidth: '80%', flexShrink: 1, gap: space[1] },
  columnMine: { alignItems: 'flex-end' },
  pending: { opacity: 0.72 },
  roomAvatar: { width: ROOM_AVATAR },
  senderName: { paddingHorizontal: space[3] },
  bubble: { borderCurve: 'continuous', boxShadow: shadow.hair },
  out: { backgroundColor: colors.bubbleOut },
  in: { backgroundColor: colors.bubbleIn },
  textBubble: { paddingHorizontal: space[3], paddingTop: space[2] - 1, paddingBottom: space[2] - 1 },
  meta: {
    position: 'absolute',
    right: space[3] - 2,
    bottom: space[1] + 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  metaText: { fontVariant: ['tabular-nums'], letterSpacing: 0.4 },
  metaSpacer: { color: 'rgba(255,255,255,0.01)', letterSpacing: 0.4 },
  metaOnMedia: {
    position: 'relative',
    right: 0,
    bottom: 0,
    paddingHorizontal: space[2],
    height: 22,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(16,32,28,0.42)',
  },
  mediaBubble: { padding: MEDIA_PAD, width: MEDIA_W + MEDIA_PAD * 2 },
  media: {
    width: MEDIA_W,
    height: Math.round((MEDIA_W * 3) / 4),
    borderRadius: R_MEDIA,
    borderCurve: 'continuous',
    backgroundColor: colors.surfaceSunken,
  },
  mediaPlaceholder: { backgroundColor: colors.surfaceSunken },
  mediaLoading: {
    position: 'absolute',
    top: MEDIA_PAD,
    left: MEDIA_PAD,
    width: MEDIA_W,
    height: Math.round((MEDIA_W * 3) / 4),
    borderRadius: R_MEDIA,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.scrim,
  },
  mediaMeta: { position: 'absolute', right: MEDIA_PAD + space[2], bottom: MEDIA_PAD + space[2] },
  mediaCaption: { paddingHorizontal: space[2], paddingTop: space[2], paddingBottom: space[2] - 1 },
  mediaCaptionSpacer: { height: space[6] },
  listingText: { paddingHorizontal: space[2], paddingTop: space[2], gap: 2 },
  listingFacts: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  placeholderLine: { height: 12, borderRadius: radius.xs, backgroundColor: colors.surfaceSunken, marginTop: space[1] },
  center: { alignItems: 'center', justifyContent: 'center' },
  tabular: { fontVariant: ['tabular-nums'] },
  shrink: { flexShrink: 1 },
  centerRow: { alignItems: 'center', paddingHorizontal: gutter, paddingVertical: space[2] },
  dayChip: {
    paddingHorizontal: space[3],
    height: 26,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    boxShadow: shadow.hair,
  },
  systemChip: {
    paddingHorizontal: space[3],
    paddingVertical: space[1] + 2,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    backgroundColor: colors.surfaceSunken,
    maxWidth: '86%',
  },
});
