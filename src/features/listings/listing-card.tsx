import { LinearGradient } from 'expo-linear-gradient';
import { BadgeCheck, Images, MapPin, Rotate3d } from 'lucide-react-native';
import { useLayoutEffect, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { formatArea, formatRate, priceParts } from '@/lib/format';
import type { Listing, ListingWithOwner } from '@/lib/types';
import { colors, radius, shadow, space } from '@/theme/tokens';
import { Chip } from '@/ui/chip';
import { PressableScale } from '@/ui/pressable-scale';
import { Label, Text } from '@/ui/text';

import { ContourArt } from './graphics/contour-art';
import { ParcelGlyph } from './graphics/parcel-glyph';
import { CardPager } from './media/card-pager';
import type { PhotoSize } from './media/image-variants';
import { Photo } from './media/photo';
import { warmDetail } from './media/photo-cache';
import { LAND_TINT, STATUS_META, landTypeLabel, withAlpha } from './meta';
import { SaveButton } from './save-button';
import { SkeletonBlock } from './skeleton';

const FEED_PAD = space[2];
const FEED_RADIUS = radius.xl;
const MEDIA_RADIUS = FEED_RADIUS - FEED_PAD;
const MEDIA_HEIGHT = 208;

const COMPACT_PAD = space[2];
const COMPACT_RADIUS = radius.lg;
const THUMB = 84;
const THUMB_RADIUS = COMPACT_RADIUS - COMPACT_PAD;

export type ListingCardProps = {
  listing: ListingWithOwner | Listing;
  onPress?: () => void;
  variant?: 'feed' | 'compact';
  saved?: boolean;
  /** Shows the bookmark when provided. */
  onToggleSave?: () => void;
  /** Compact only: extra row under the card body (manage actions, stats). */
  footer?: ReactNode;
};

/** ₹ amount in figure style with the L / Cr unit set smaller beside it. */
export function PriceFigure({ inr, size = 'small', tone = 'ink' }: { inr: number; size?: 'small' | 'large'; tone?: 'ink' | 'onDark' }) {
  const { amount, unit } = priceParts(inr);
  return (
    <View style={styles.price}>
      <Text variant={size === 'large' ? 'figure' : 'figureSmall'} tone={tone} numberOfLines={1}>
        {`₹${amount}`}
      </Text>
      {unit ? (
        <Text variant="captionStrong" tone={tone === 'onDark' ? 'onDarkSecondary' : 'secondary'} numberOfLines={1}>
          {unit}
        </Text>
      ) : null}
    </View>
  );
}

function Media({ listing, size }: { listing: Listing; size: PhotoSize }) {
  const cover = listing.images[0];
  if (cover) {
    return (
      <Photo
        uri={cover}
        size={size}
        tint={LAND_TINT[listing.land_type].wash}
        priority="high"
        recyclingKey={`${listing.id}:0`}
      />
    );
  }
  return <ContourArt seed={listing.id} landType={listing.land_type} style={StyleSheet.absoluteFill} />;
}

/** Photos a feed card lets you swipe through before opening the listing. */
const SCRUB_MAX = 5;

// Feed cards rise in the first time each listing appears. Explore staggers the first screenful
// itself, so cards bound in the opening moments of the session skip their own entrance.
const appeared = new Set<string>();
let sessionStart = 0;
const OPENING_MS = 1200;

function useFirstAppearance(id: string) {
  const reduceMotion = useReducedMotion();
  const shown = useSharedValue(1);
  useLayoutEffect(() => {
    if (appeared.has(id)) return;
    appeared.add(id);
    const now = Date.now();
    if (!sessionStart) sessionStart = now;
    if (reduceMotion || now - sessionStart < OPENING_MS) return;
    shown.set(withSequence(withTiming(0, { duration: 0 }), withTiming(1, { duration: 380, easing: Easing.out(Easing.cubic) })));
  }, [id, reduceMotion, shown]);
  return useAnimatedStyle(() => ({
    opacity: shown.get(),
    transform: [{ translateY: (1 - shown.get()) * space[2] }],
  }));
}

function TypePill({ listing }: { listing: Listing }) {
  return (
    <View style={styles.overlayPill}>
      <View style={[styles.dot, { backgroundColor: LAND_TINT[listing.land_type].base }]} />
      <Text variant="captionStrong">{landTypeLabel(listing.land_type)}</Text>
    </View>
  );
}

function FeedCard({ listing, onPress, saved, onToggleSave }: ListingCardProps) {
  const count = listing.images.length;
  const hasImages = count > 0;
  const hasPanorama = !!listing.panorama_url;
  const scrub = Math.min(count, SCRUB_MAX);
  const status = listing.status !== 'active' ? STATUS_META[listing.status] : null;
  const entrance = useFirstAppearance(listing.id);

  return (
    <Animated.View style={entrance}>
      <PressableScale onPress={onPress} to={0.985} style={styles.feed} accessibilityLabel={listing.title}>
        {/* A finger landing on the card starts the detail hero download before navigation. */}
        <View style={styles.media} onTouchStart={() => warmDetail(listing)}>
          {scrub > 1 ? (
            // Keyed by listing so a recycled cell never inherits another listing's page.
            <CardPager
              key={listing.id}
              listingId={listing.id}
              images={listing.images.slice(0, SCRUB_MAX)}
              tint={LAND_TINT[listing.land_type].wash}
            />
          ) : (
            <>
              <Media listing={listing} size="card" />
              {hasImages ? (
                <LinearGradient
                  colors={[withAlpha(colors.ink, 0), colors.scrim]}
                  locations={[0.45, 1]}
                  style={StyleSheet.absoluteFill}
                  pointerEvents="none"
                />
              ) : null}
            </>
          )}

          <View style={styles.mediaTop} pointerEvents="box-none">
            <View style={styles.pillRow} pointerEvents="none">
              <TypePill listing={listing} />
              {status ? <Chip label={status.label} tone={status.tone} mono /> : null}
            </View>
            {onToggleSave ? <SaveButton saved={!!saved} onToggle={onToggleSave} /> : null}
          </View>

          <View style={styles.mediaBottom} pointerEvents="none">
            {listing.verified ? (
              <View style={styles.overlayPill}>
                <BadgeCheck size={15} color={colors.accent} strokeWidth={2.2} />
                <Text variant="captionStrong">Verified</Text>
              </View>
            ) : (
              <View />
            )}
            <View style={styles.badges}>
              {hasPanorama ? (
                <View style={styles.count}>
                  <Rotate3d size={13} color={colors.accentBright} strokeWidth={2.1} />
                  <Label tone="onDark">360°</Label>
                </View>
              ) : null}
              {hasImages ? (
                <View style={styles.count}>
                  <Images size={13} color={colors.inkOnDark} strokeWidth={2} />
                  <Label tone="onDark" style={styles.tabular}>
                    {String(count)}
                  </Label>
                </View>
              ) : (
                <View style={styles.surveyTag}>
                  <Label tone="secondary">Survey preview</Label>
                </View>
              )}
            </View>
          </View>
        </View>

        <View style={styles.body}>
          <View style={styles.titleBlock}>
            <Text variant="heading" numberOfLines={1}>
              {listing.title}
            </Text>
            <View style={styles.place}>
              <MapPin size={14} color={colors.inkTertiary} strokeWidth={2} />
              <Text variant="caption" tone="secondary" numberOfLines={1} style={styles.flex}>
                {`${listing.locality} · ${listing.district}`}
              </Text>
            </View>
          </View>

          <View style={styles.figures}>
            <View style={styles.figureCol}>
              <PriceFigure inr={listing.price_total} />
              <Label numberOfLines={1}>{formatRate(listing.price_total, listing.area_value, listing.area_unit)}</Label>
            </View>
            <View style={styles.vRule} />
            <View style={styles.figureCol}>
              <Text variant="figureSmall" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                {formatArea(listing.area_value, listing.area_unit)}
              </Text>
              <Label numberOfLines={1}>{listing.negotiable ? 'Negotiable' : 'Fixed price'}</Label>
            </View>
            <View style={styles.glyph}>
              <ParcelGlyph boundary={listing.boundary} seed={listing.id} landType={listing.land_type} />
            </View>
          </View>
        </View>
      </PressableScale>
    </Animated.View>
  );
}

function CompactCard({ listing, onPress, saved, onToggleSave, footer }: ListingCardProps) {
  const status = listing.status !== 'active' ? STATUS_META[listing.status] : null;
  return (
    <View style={styles.compact}>
      <PressableScale
        onPress={onPress}
        onTouchStart={() => warmDetail(listing)}
        to={0.985}
        style={styles.compactRow}
        accessibilityLabel={listing.title}>
        <View style={styles.thumb}>
          <Media listing={listing} size="thumb" />
          {listing.panorama_url ? (
            <View style={styles.thumbBadge} pointerEvents="none">
              <Label tone="onDark">360°</Label>
            </View>
          ) : null}
        </View>
        <View style={styles.compactBody}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {listing.title}
          </Text>
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            {`${listing.locality} · ${listing.district}`}
          </Text>
          <View style={styles.compactFigures}>
            <PriceFigure inr={listing.price_total} />
            <Text variant="caption" tone="tertiary">
              ·
            </Text>
            <Text variant="captionStrong" tone="secondary" numberOfLines={1} style={styles.flexShrink}>
              {formatArea(listing.area_value, listing.area_unit)}
            </Text>
          </View>
        </View>
        {onToggleSave ? (
          <SaveButton saved={!!saved} onToggle={onToggleSave} size={40} variant="sunken" />
        ) : !footer && status ? (
          <Chip label={status.label} tone={status.tone} mono style={styles.compactStatus} />
        ) : null}
      </PressableScale>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  );
}

/** The listing card used by Explore, Saved, My land and anywhere a listing is referenced. */
export function ListingCard(props: ListingCardProps) {
  return props.variant === 'compact' ? <CompactCard {...props} /> : <FeedCard {...props} />;
}

export function ListingCardSkeleton({ variant = 'feed' }: { variant?: 'feed' | 'compact' }) {
  if (variant === 'compact') {
    return (
      <View style={[styles.compact, styles.compactRow]}>
        <SkeletonBlock width={THUMB} height={THUMB} r={THUMB_RADIUS} />
        <View style={styles.compactBody}>
          <SkeletonBlock width="70%" height={16} />
          <SkeletonBlock width="45%" height={12} />
          <SkeletonBlock width="55%" height={18} />
        </View>
      </View>
    );
  }
  return (
    <View style={styles.feed}>
      <SkeletonBlock height={MEDIA_HEIGHT} r={MEDIA_RADIUS} />
      <View style={styles.body}>
        <View style={styles.titleBlock}>
          <SkeletonBlock width="68%" height={20} />
          <SkeletonBlock width="42%" height={14} />
        </View>
        <View style={styles.figures}>
          <SkeletonBlock width={92} height={36} />
          <SkeletonBlock width={92} height={36} />
          <View style={styles.flex} />
          <SkeletonBlock width={44} height={44} r={radius.sm} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  feed: {
    padding: FEED_PAD,
    borderRadius: FEED_RADIUS,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    boxShadow: shadow.card,
  },
  media: {
    height: MEDIA_HEIGHT,
    borderRadius: MEDIA_RADIUS,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: colors.surfaceSunken,
  },
  mediaTop: {
    position: 'absolute',
    top: space[3],
    left: space[3],
    right: space[3],
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  pillRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexShrink: 1, paddingTop: space[1] },
  mediaBottom: {
    position: 'absolute',
    left: space[3],
    right: space[3],
    bottom: space[3],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  overlayPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1] + 2,
    height: 30,
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    backgroundColor: withAlpha(colors.surface, 0.94),
    boxShadow: shadow.hair,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  count: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    height: 26,
    paddingHorizontal: space[2] + 2,
    borderRadius: radius.pill,
    backgroundColor: withAlpha(colors.ink, 0.36),
  },
  badges: { flexDirection: 'row', alignItems: 'center', gap: space[1] + 2 },
  surveyTag: {
    height: 26,
    justifyContent: 'center',
    paddingHorizontal: space[2] + 2,
    borderRadius: radius.pill,
    backgroundColor: withAlpha(colors.surface, 0.86),
  },
  tabular: { fontVariant: ['tabular-nums'] },
  thumbBadge: {
    position: 'absolute',
    left: space[1],
    bottom: space[1],
    paddingHorizontal: space[1] + 1,
    height: 18,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: withAlpha(colors.ink, 0.56),
  },
  body: { paddingHorizontal: space[3], paddingTop: space[4], paddingBottom: space[3], gap: space[4] },
  titleBlock: { gap: space[1] },
  place: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  figures: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  figureCol: { gap: 2, flexShrink: 1 },
  vRule: { width: StyleSheet.hairlineWidth * 2, alignSelf: 'stretch', backgroundColor: colors.hairlineStrong },
  glyph: {
    marginLeft: 'auto',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#E6F4EC',
    borderWidth: 1,
    borderColor: 'rgba(16,32,28,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  price: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  compact: {
    padding: COMPACT_PAD,
    borderRadius: COMPACT_RADIUS,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    boxShadow: shadow.card,
  },
  compactRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB_RADIUS,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: colors.surfaceSunken,
  },
  compactBody: { flex: 1, gap: 2, paddingVertical: space[1] },
  compactFigures: { flexDirection: 'row', alignItems: 'baseline', gap: space[2], marginTop: 2 },
  compactStatus: { marginRight: space[2] },
  footer: { paddingHorizontal: space[1], paddingTop: space[2] },
});
