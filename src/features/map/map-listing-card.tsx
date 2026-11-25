import { Image } from 'expo-image';
import { BadgeCheck, MapPin as MapPinIcon, Navigation } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, Polygon } from 'react-native-svg';

import { photoUrl } from '@/features/listings/media/image-variants';
import { formatArea, priceParts } from '@/lib/format';
import { LAND_TYPES, type LngLat } from '@/lib/types';
import { PressableScale } from '@/ui/pressable-scale';
import { Label, Text } from '@/ui/text';
import { colors, radius, shadow, space, type } from '@/theme/tokens';

import { LAND_COLORS, withAlpha, type MapListing } from './map-style';

const PAD = space[3];
/** Body rows: price 22 + title 18 + place 18 + directions row 32, plus 8 of spacing. */
const BODY_H = 98;
const THUMB_W = 84;
const THUMB_H = BODY_H;
const PARALLAX = 10;
/** Outer height of the card, used to lay out the carousel and camera padding. */
export const MAP_CARD_HEIGHT = BODY_H + PAD * 2;

const landLabel = Object.fromEntries(LAND_TYPES.map((t) => [t.value, t.label])) as Record<string, string>;

/** The parcel's own outline, fitted into the thumbnail, for listings without photos. */
function ParcelThumb({
  boundary,
  approximate,
  color,
}: {
  boundary: LngLat[] | null;
  approximate: boolean;
  color: string;
}) {
  if (approximate) {
    return (
      <Svg width={THUMB_W} height={THUMB_H}>
        <Circle cx={THUMB_W / 2} cy={THUMB_H / 2} r={30} fill={withAlpha(color, 0.12)} />
        <Circle
          cx={THUMB_W / 2}
          cy={THUMB_H / 2}
          r={30}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
        <Circle cx={THUMB_W / 2} cy={THUMB_H / 2} r={16} fill={withAlpha(color, 0.14)} />
      </Svg>
    );
  }
  if (!boundary) return <MapPinIcon size={22} color={colors.inkTertiary} strokeWidth={2} />;

  const lat0 = (boundary.reduce((s, p) => s + p[1], 0) / boundary.length) * (Math.PI / 180);
  const xs = boundary.map((p) => p[0] * Math.cos(lat0));
  const ys = boundary.map((p) => -p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const inner = THUMB_W - space[5] * 2;
  const k = inner / span;
  const ox = (THUMB_W - (maxX - minX) * k) / 2;
  const oy = (THUMB_H - (maxY - minY) * k) / 2;
  const points = xs.map((x, i) => `${ox + (x - minX) * k},${oy + (ys[i] - minY) * k}`).join(' ');

  return (
    <Svg width={THUMB_W} height={THUMB_H}>
      <Polygon points={points} fill={withAlpha(color, 0.16)} stroke={color} strokeWidth={2} strokeLinejoin="round" />
      {xs.map((x, i) => (
        <Circle
          key={i}
          cx={ox + (x - minX) * k}
          cy={oy + (ys[i] - minY) * k}
          r={2.6}
          fill={colors.surface}
          stroke={color}
          strokeWidth={1.4}
        />
      ))}
    </Svg>
  );
}

export type MapListingCardProps = {
  item: MapListing;
  index: number;
  /** Carousel scroll offset; each card derives its own emphasis from it. */
  scrollX: SharedValue<number>;
  itemWidth: number;
  width: number;
  /** Straight-line distance: "18 km away" / "32 km from city". */
  distance: string | null;
  onPress: () => void;
  /** Hands navigation to the phone's maps app (the caller passes the public point). */
  onDirections?: () => void;
};

/**
 * Compact horizontal card for the map carousel. Emphasis is scroll-linked: the centred card is
 * full strength and neighbours recede continuously as they slide, with a slight photo parallax.
 */
export function MapListingCard({
  item,
  index,
  scrollX,
  itemWidth,
  width,
  distance,
  onPress,
  onDirections,
}: MapListingCardProps) {
  const { listing, approximate, boundary } = item;
  const tone = LAND_COLORS[listing.land_type];

  const emphasis = useAnimatedStyle(() => {
    const d = Math.min(1, Math.abs((scrollX.get() - index * itemWidth) / itemWidth));
    return {
      opacity: interpolate(d, [0, 1], [1, 0.66]),
      transform: [{ scale: interpolate(d, [0, 1], [1, 0.93]) }, { translateY: interpolate(d, [0, 1], [0, 6]) }],
    };
  });
  const parallax = useAnimatedStyle(() => {
    const p = Math.max(-1, Math.min(1, (scrollX.get() - index * itemWidth) / itemWidth));
    return { transform: [{ translateX: -p * PARALLAX }] };
  });

  const price = priceParts(listing.price_total);
  const cover = listing.images[0];
  const place = [formatArea(listing.area_value, listing.area_unit), landLabel[listing.land_type], listing.locality]
    .filter(Boolean)
    .join(' · ');

  return (
    <Animated.View style={[{ width }, emphasis]}>
      <PressableScale
        onPress={onPress}
        to={0.98}
        accessibilityLabel={`${listing.title}, ₹${price.amount} ${price.unit}, ${listing.locality}`}
        style={styles.card}>
        <View style={styles.thumb}>
          {cover ? (
            <Animated.View style={[styles.parallax, parallax]}>
              <Image
                source={{ uri: photoUrl(cover, 'thumb') }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                transition={220}
                cachePolicy="memory-disk"
                recyclingKey={`${listing.id}:map`}
              />
            </Animated.View>
          ) : (
            <ParcelThumb boundary={boundary} approximate={approximate} color={tone.ink} />
          )}
        </View>

        <View style={styles.body}>
          <View style={styles.priceRow}>
            <Text style={type.figureSmall} numberOfLines={1}>
              {`₹${price.amount}`}
              {price.unit ? <Text variant="captionStrong" tone="secondary">{` ${price.unit}`}</Text> : null}
            </Text>
            {listing.verified ? (
              <View style={styles.verified} accessibilityLabel="Verified listing">
                <BadgeCheck size={15} color={colors.accent} strokeWidth={2.2} />
              </View>
            ) : null}
            {approximate ? (
              <View style={styles.approx}>
                <Label tone="highlight">Approx.</Label>
              </View>
            ) : null}
          </View>
          <Text variant="captionStrong" numberOfLines={1}>
            {listing.title}
          </Text>
          <View style={styles.placeRow}>
            <View style={[styles.dot, { backgroundColor: tone.fill }]} />
            <Text variant="caption" tone="secondary" numberOfLines={1} style={styles.flexShrink}>
              {place}
            </Text>
          </View>
          <View style={styles.footer}>
            {onDirections ? (
              <PressableScale
                onPress={onDirections}
                accessibilityLabel={approximate ? 'Directions to approximate area' : 'Directions'}
                style={styles.directions}>
                <Navigation size={13} color={colors.accent} fill={colors.accent} strokeWidth={2.2} />
                <Text variant="captionStrong" tone="accent" numberOfLines={1}>
                  {approximate ? 'Approx. area' : 'Directions'}
                </Text>
              </PressableScale>
            ) : null}
            {distance ? (
              <Label numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={styles.meta}>
                {distance}
              </Label>
            ) : null}
          </View>
        </View>
      </PressableScale>
    </Animated.View>
  );
}

/** Placeholder with the card's exact geometry while listings load. */
export function MapListingCardSkeleton({ width }: { width: number }) {
  return (
    <View style={[styles.card, { width }]}>
      <View style={styles.thumb} />
      <View style={[styles.body, styles.skeletonBody]}>
        <View style={[styles.bone, { width: '42%', height: 16 }]} />
        <View style={[styles.bone, { width: '78%' }]} />
        <View style={[styles.bone, { width: '56%' }]} />
        <View style={[styles.bone, styles.bonePill]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: space[3],
    height: MAP_CARD_HEIGHT,
    padding: PAD,
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    boxShadow: shadow.float,
  },
  thumb: {
    width: THUMB_W,
    height: THUMB_H,
    // Nested radius: radius.xl − padding.
    borderRadius: radius.md,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: colors.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  parallax: { position: 'absolute', top: 0, bottom: 0, left: -PARALLAX, right: -PARALLAX },
  body: { flex: 1, justifyContent: 'center', gap: 1 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: space[1] + 2 },
  verified: { marginTop: -1 },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: space[1] + 2 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  flexShrink: { flexShrink: 1 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: space[1] + 2 },
  directions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1] + 1,
    height: 32,
    paddingLeft: space[2] + 2,
    paddingRight: space[3],
    borderRadius: radius.pill,
    borderCurve: 'continuous',
    backgroundColor: colors.accentSoft,
  },
  meta: { flexShrink: 1, fontVariant: ['tabular-nums'] },
  approx: {
    paddingHorizontal: space[2],
    paddingVertical: 1,
    borderRadius: radius.pill,
    backgroundColor: colors.highlightSoft,
  },
  skeletonBody: { gap: space[2] },
  bone: { height: 11, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken },
  bonePill: { width: 96, height: 24 },
});
